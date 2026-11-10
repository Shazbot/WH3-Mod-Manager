import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appControlEndpoint } from "../appControl/endpoint";
import {
  APP_CONTROL_INFO_FILE_NAME,
  APP_CONTROL_PROTOCOL_VERSION,
  type AppControlErrorCode,
  type AppControlMethod,
  type AppControlModsResult,
  type AppControlResponse,
  type AppControlStatus,
} from "../appControl/protocol";
import { AutomationError, automationErrorFromUnknown, throwIfAborted, type AutomationDiagnostic } from "./errors";
import type { AutomationContext } from "./operations";

/**
 * CLI/MCP side of the control pipe to the running WHMM app (src/appControl/server.ts).
 * Under WSL the app's Windows pipe is not reachable from Linux sockets, so each request is
 * relayed through powershell.exe.
 */

const appInputs = {
  startApp: z.boolean().default(true),
  startTimeoutSeconds: z.number().int().min(1).max(600).default(60),
  appPath: z.string().min(1).optional(),
};
const selectionInputs = {
  preset: z.string().min(1).optional(),
  only: z.array(z.string().min(1)).max(5000).optional(),
  enable: z.array(z.string().min(1)).max(5000).optional(),
  disable: z.array(z.string().min(1)).max(5000).optional(),
  order: z.array(z.string().min(1)).max(5000).optional(),
};

export const appStatusSchema = z.object({ operation: z.literal("app_status") }).strict();
export const modsListSchema = z
  .object({ operation: z.literal("mods_list"), enabledOnly: z.boolean().default(false), ...appInputs })
  .strict();
export const modsSetSchema = z
  .object({ operation: z.literal("mods_set"), ...selectionInputs, dryRun: z.boolean().default(false), ...appInputs })
  .strict();
export const gameStopSchema = z
  .object({
    operation: z.literal("game_stop"),
    stopTimeoutSeconds: z.number().int().min(1).max(600).default(30),
    ...appInputs,
  })
  .strict();
export const gameLaunchSchema = z
  .object({
    operation: z.literal("game_launch"),
    ...selectionInputs,
    temporary: z.boolean().default(false),
    continueLastSave: z.boolean().default(false),
    save: z.string().min(1).optional(),
    game: z.string().min(1).optional(),
    options: z
      .object({
        skipIntroMovies: z.boolean().optional(),
        scriptLogging: z.boolean().optional(),
        autoStartCustomBattle: z.boolean().optional(),
        autoStartNewCampaign: z.boolean().optional(),
        makeUnitsGenerals: z.boolean().optional(),
        closeAppOnPlay: z.boolean().optional(),
      })
      .strict()
      .optional(),
    launchTimeoutSeconds: z.number().int().min(10).max(3600).default(900),
    restart: z.boolean().default(false),
    stopTimeoutSeconds: z.number().int().min(1).max(600).default(30),
    ...appInputs,
  })
  .strict();

const hasSelection = (value: {
  preset?: string;
  only?: string[];
  enable?: string[];
  disable?: string[];
  order?: string[];
}) => Boolean(value.preset || value.only || value.enable?.length || value.disable?.length || value.order?.length);

type AppOptions = { startApp: boolean; startTimeoutSeconds: number; appPath?: string };

class AppNotRunning extends Error {}

const isWsl = () =>
  process.platform === "linux" && Boolean(process.env["WSL_DISTRO_NAME"] || process.env["WSL_INTEROP"]);

const runCommand = (command: string, args: string[], signal?: AbortSignal) =>
  new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true, signal },
      (error, stdout) => {
        if (error && typeof (error as { code?: unknown }).code !== "number") reject(error);
        else resolve({ code: error ? Number((error as { code?: number }).code) : 0, stdout });
      },
    );
  });

const powershell = (script: string, signal?: AbortSignal) =>
  runCommand(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    signal,
  );

const parseResponse = (line: string): AppControlResponse => {
  try {
    return JSON.parse(line) as AppControlResponse;
  } catch {
    throw new AutomationError("INTERNAL", "WHMM sent an unreadable response");
  }
};

const exchangeDirect = (line: string, signal?: AbortSignal) =>
  new Promise<AppControlResponse>((resolve, reject) => {
    let connected = false;
    let settled = false;
    let buffer = "";
    const socket = net.connect(appControlEndpoint());
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      action();
    };
    const onAbort = () => settle(() => reject(new AutomationError("CANCELLED", "Operation was cancelled")));
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      connected = true;
      socket.write(`${line}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      settle(() => {
        try {
          resolve(parseResponse(buffer.slice(0, newline)));
        } catch (error) {
          reject(error);
        }
      });
    });
    socket.once("error", (error: NodeJS.ErrnoException) =>
      settle(() =>
        reject(!connected && ["ENOENT", "ECONNREFUSED"].includes(error.code ?? "") ? new AppNotRunning() : error),
      ),
    );
    socket.once("close", () =>
      settle(() => reject(new AutomationError("INTERNAL", "WHMM closed the connection without answering"))),
    );
  });

/** Exit 3: no pipe. Exit 4: the app hung up. The pipe name must match appControlPipeName(). */
const exchangeThroughWindows = async (line: string, signal?: AbortSignal) => {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$name='wh3mm-control-'+$env:USERNAME.ToLower()",
    "$pipe=New-Object System.IO.Pipes.NamedPipeClientStream('.',$name,[System.IO.Pipes.PipeDirection]::InOut)",
    "try { $pipe.Connect(1000) } catch { exit 3 }",
    "$enc=New-Object System.Text.UTF8Encoding($false)",
    "$writer=New-Object System.IO.StreamWriter($pipe,$enc); $writer.AutoFlush=$true",
    "$reader=New-Object System.IO.StreamReader($pipe,$enc)",
    `$writer.WriteLine($enc.GetString([Convert]::FromBase64String('${Buffer.from(line, "utf8").toString("base64")}')))`,
    "$response=$reader.ReadLine()",
    "if ($null -eq $response) { exit 4 }",
    "[Console]::Out.Write([Convert]::ToBase64String($enc.GetBytes($response)))",
  ].join("\n");
  const { code, stdout } = await powershell(script, signal);
  if (code === 3) throw new AppNotRunning();
  if (code === 4) throw new AutomationError("INTERNAL", "WHMM closed the connection without answering");
  if (code !== 0) throw new AutomationError("IO_ACCESS", `Could not reach WHMM through powershell.exe (exit ${code})`);
  return parseResponse(Buffer.from(stdout.trim(), "base64").toString("utf8"));
};

const exchange = (method: AppControlMethod, params: unknown, signal?: AbortSignal) => {
  const line = JSON.stringify({ v: APP_CONTROL_PROTOCOL_VERSION, id: randomUUID(), method, params });
  return isWsl() ? exchangeThroughWindows(line, signal) : exchangeDirect(line, signal);
};

const toLocalPath = async (value: string) => {
  if (!isWsl() || !/^(?:[a-z]:[\\/]|\\\\)/i.test(value)) return value;
  const { code, stdout } = await runCommand("wslpath", ["-u", "--", value]);
  if (code !== 0) throw new AutomationError("IO_ACCESS", `Could not convert the Windows path: ${value}`);
  return stdout.trim();
};

/** The user data folder of a packaged WHMM, where it records its executable path. */
const userDataDirectory = async (signal?: AbortSignal): Promise<string | undefined> => {
  if (process.platform === "win32") return process.env["APPDATA"] && path.join(process.env["APPDATA"], "wh3mm");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "wh3mm");
  if (!isWsl()) return path.join(process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"), "wh3mm");
  const { code, stdout } = await powershell(
    "[Console]::Out.Write([Environment]::GetFolderPath('ApplicationData'))",
    signal,
  );
  return code === 0 && stdout.trim() ? path.join(await toLocalPath(stdout.trim()), "wh3mm") : undefined;
};

const findAppExecutable = async (options: AppOptions, signal?: AbortSignal): Promise<string> => {
  const explicit = options.appPath ?? process.env["WHMM_APP_PATH"];
  if (explicit) return toLocalPath(explicit);
  // whmm-cli.exe runs the packaged wh3mm.exe in Node mode.
  if (process.versions.electron && process.env["ELECTRON_RUN_AS_NODE"]) return process.execPath;
  const directory = await userDataDirectory(signal);
  if (directory) {
    try {
      const info = JSON.parse(await fs.readFile(path.join(directory, APP_CONTROL_INFO_FILE_NAME), "utf8"));
      if (typeof info?.exePath === "string") {
        const exePath = await toLocalPath(info.exePath);
        await fs.access(exePath);
        return exePath;
      }
    } catch {
      throwIfAborted(signal);
    }
  }
  throw new AutomationError(
    "IO_ACCESS",
    "WHMM is not running and its executable is unknown. Pass --app-path or set WHMM_APP_PATH, or start WHMM once so it records its location.",
  );
};

const startApp = async (options: AppOptions, signal?: AbortSignal) => {
  const exePath = await findAppExecutable(options, signal);
  if (isWsl()) {
    // Start-Process detaches the app from this WSL process.
    const { stdout } = await runCommand("wslpath", ["-w", "--", exePath]);
    const windowsPath = stdout.trim().replace(/'/g, "''");
    const { code } = await powershell(`Start-Process -FilePath '${windowsPath}'`, signal);
    if (code !== 0) throw new AutomationError("IO_ACCESS", `Could not start WHMM: ${exePath}`);
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exePath, [], { cwd: path.dirname(exePath), detached: true, stdio: "ignore", env });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", (error) => reject(new AutomationError("IO_ACCESS", `Could not start WHMM: ${error.message}`)));
  });
  child.unref();
};

const errorCodes: Record<AppControlErrorCode, AutomationError["code"]> = {
  NOT_READY: "IO_ACCESS",
  DISABLED: "IO_ACCESS",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  CONFLICT: "CONFLICT",
  VALIDATION: "VALIDATION",
  LAUNCH_FAILED: "INTERNAL",
  STOP_FAILED: "INTERNAL",
  INTERNAL: "INTERNAL",
};

const delay = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AutomationError("CANCELLED", "Operation was cancelled"));
      },
      { once: true },
    );
  });

/** Sends one request, starting the app and waiting for it to load when allowed. */
const requestApp = async (
  method: Exclude<AppControlMethod, "status">,
  params: unknown,
  options: AppOptions,
  context: AutomationContext,
): Promise<{ result: unknown; startedApp: boolean }> => {
  const deadline = Date.now() + options.startTimeoutSeconds * 1000;
  let startedApp = false;
  for (;;) {
    throwIfAborted(context.signal);
    let response: AppControlResponse | undefined;
    try {
      response = await exchange(method, params, context.signal);
    } catch (error) {
      if (!(error instanceof AppNotRunning)) throw automationErrorFromUnknown(error);
      if (!options.startApp)
        throw new AutomationError("IO_ACCESS", "WHMM is not running. Start it, or run without --no-start-app.");
      if (!startedApp) {
        context.progress?.({ stage: "starting", message: "Starting WHMM" });
        await startApp(options, context.signal);
        startedApp = true;
      }
    }
    if (response?.ok) return { result: response.result, startedApp };
    if (response && response.error.code !== "NOT_READY")
      throw new AutomationError(errorCodes[response.error.code] ?? "INTERNAL", response.error.message, {
        appCode: response.error.code,
        ...(response.error.details === undefined ? {} : { appDetails: response.error.details }),
      });
    if (Date.now() >= deadline)
      throw new AutomationError(
        "IO_ACCESS",
        `WHMM did not finish loading within ${options.startTimeoutSeconds} seconds`,
      );
    context.progress?.({ stage: "waiting", message: "Waiting for WHMM to load" });
    await delay(1000, context.signal);
  }
};

const appOptions = (request: AppOptions): AppOptions => ({
  startApp: request.startApp,
  startTimeoutSeconds: request.startTimeoutSeconds,
  ...(request.appPath ? { appPath: request.appPath } : {}),
});

const warningsToDiagnostics = (result: unknown): AutomationDiagnostic[] => {
  const warnings = (result as { warnings?: unknown })?.warnings;
  return Array.isArray(warnings)
    ? warnings.map((message) => ({
        code: "APP_CONTROL_WARNING",
        message: String(message),
        severity: "warning" as const,
      }))
    : [];
};

export const runAppStatus = async (_request: z.output<typeof appStatusSchema>, context: AutomationContext) => {
  try {
    const response = await exchange("status", undefined, context.signal);
    if (!response.ok) throw new AutomationError("INTERNAL", response.error.message);
    return { data: { running: true, ...(response.result as AppControlStatus) }, diagnostics: [] };
  } catch (error) {
    if (error instanceof AppNotRunning) return { data: { running: false }, diagnostics: [] };
    throw automationErrorFromUnknown(error);
  }
};

export const runModsList = async (request: z.output<typeof modsListSchema>, context: AutomationContext) => {
  const { result, startedApp } = await requestApp("listMods", {}, appOptions(request), context);
  const data = result as AppControlModsResult;
  return {
    data: { ...data, mods: request.enabledOnly ? data.mods.filter((mod) => mod.isEnabled) : data.mods, startedApp },
    diagnostics: [],
  };
};

export const runModsSet = async (request: z.output<typeof modsSetSchema>, context: AutomationContext) => {
  const { preset, only, enable, disable, order, dryRun } = request;
  if (!hasSelection(request))
    throw new AutomationError("INVALID_ARGUMENT", "Provide a preset, only, enable, disable, or order");
  const { result, startedApp } = await requestApp(
    "setMods",
    { preset, only, enable, disable, order, dryRun },
    appOptions(request),
    context,
  );
  return { data: { ...(result as object), startedApp }, diagnostics: warningsToDiagnostics(result) };
};

export const runGameLaunch = async (request: z.output<typeof gameLaunchSchema>, context: AutomationContext) => {
  const { preset, only, enable, disable, order, temporary, continueLastSave, save, game, options } = request;
  if (save && continueLastSave) throw new AutomationError("INVALID_ARGUMENT", "Use save or continueLastSave, not both");
  if (options?.autoStartCustomBattle && options.autoStartNewCampaign)
    throw new AutomationError("INVALID_ARGUMENT", "Use autoStartCustomBattle or autoStartNewCampaign, not both");
  if (temporary && !hasSelection(request))
    throw new AutomationError("INVALID_ARGUMENT", "A temporary launch needs a preset, only, enable, disable, or order");
  context.progress?.({
    stage: "launching",
    message: request.restart ? "Relaunching the game" : "Launching the game",
  });
  const { result, startedApp } = await requestApp(
    "launch",
    {
      preset,
      only,
      enable,
      disable,
      order,
      temporary,
      continueLastSave,
      save,
      game,
      options,
      timeoutSeconds: request.launchTimeoutSeconds,
      restart: request.restart,
      stopTimeoutSeconds: request.stopTimeoutSeconds,
    },
    appOptions(request),
    context,
  );
  return { data: { ...(result as object), startedApp }, diagnostics: warningsToDiagnostics(result) };
};

/** Force-kills the running game through the app and waits until it has exited. */
export const runGameStop = async (request: z.output<typeof gameStopSchema>, context: AutomationContext) => {
  context.progress?.({ stage: "stopping", message: "Stopping the game" });
  const { result, startedApp } = await requestApp(
    "stopGame",
    { timeoutSeconds: request.stopTimeoutSeconds },
    appOptions(request),
    context,
  );
  return { data: { ...(result as object), startedApp }, diagnostics: [] };
};
