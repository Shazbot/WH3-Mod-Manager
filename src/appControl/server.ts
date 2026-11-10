import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { app, ipcMain, type BrowserWindow, type WebContents } from "electron";
import appData from "../appData";
import { gameToProcessName } from "../supportedGames";
import { findGameProcessIds, terminateGameProcess } from "../utility/gameProcess";
import { isGameLaunchInProgress, waitForGameLaunchOutcome } from "./launchOutcome";
import { appControlEndpoint } from "./endpoint";
import {
  APP_CONTROL_INFO_FILE_NAME,
  APP_CONTROL_PROTOCOL_VERSION,
  type AppControlErrorCode,
  type AppControlLaunchParams,
  type AppControlRequest,
  type AppControlResponse,
  type AppControlStatus,
  type AppControlStopParams,
  type AppControlStopResult,
} from "./protocol";

/**
 * Local control pipe for the CLI and MCP (docs/HEADLESS.md, "Control the running app").
 * Main answers `status` itself and forwards the mod and launch requests to the main window,
 * which owns the mod list. Only the current user can connect: a per-user Windows pipe
 * (default DACL denies other users write access) or a 0600 Unix socket.
 */
const MAX_LINE_BYTES = 1024 * 1024;
const RENDERER_REPLY_TIMEOUT_MS = 30_000;
const DEFAULT_LAUNCH_TIMEOUT_SECONDS = 15 * 60;
const DEFAULT_STOP_TIMEOUT_SECONDS = 30;
/** How long the running-game poll (every ~2 s in index.ts) may take to notice the exit. */
const EXIT_NOTICE_TIMEOUT_MS = 15_000;
/** Same pause the Play button leaves between the game exiting and relaunching it. */
const RELAUNCH_DELAY_MS = 1500;

class StopError extends Error {}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitUntil = async (check: () => boolean | Promise<boolean>, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) return false;
    await delay(500);
  }
  return true;
};

const positiveSeconds = (value: unknown, fallback: number) =>
  typeof value === "number" && value > 0 ? value : fallback;

type Pending = { resolve: (response: AppControlResponse) => void; timer: NodeJS.Timeout };

export const startAppControlServer = (
  getMainWindow: () => BrowserWindow | undefined,
  /** Post-exit work a relaunch must wait for (Workshop staging cleanup). */
  afterGameExit: () => Promise<void>,
) => {
  const pending = new Map<string, Pending>();
  /** A stop or launch request is being handled; covers the gaps around startGame. */
  let isGameRequestBusy = false;
  let readyWebContentsId: number | undefined;
  const trackedWebContents = new WeakSet<WebContents>();

  ipcMain.on("appControlReady", (event) => {
    readyWebContentsId = event.sender.id;
    if (trackedWebContents.has(event.sender)) return;
    trackedWebContents.add(event.sender);
    // A reload or crash drops the renderer's handler until it reports ready again.
    const reset = () => {
      if (readyWebContentsId === event.sender.id) readyWebContentsId = undefined;
    };
    // Not did-start-loading: that also fires for in-page hash changes, such as clicking an
    // href="#" link, which keep the handler alive and never report ready again.
    event.sender.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) reset();
    });
    event.sender.on("render-process-gone", reset);
    event.sender.once("destroyed", reset);
  });
  ipcMain.on("appControlResponse", (_event, response: AppControlResponse) => {
    const entry = pending.get(response?.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    entry.resolve(response);
  });

  const failure = (id: string, code: AppControlErrorCode, message: string): AppControlResponse => ({
    v: APP_CONTROL_PROTOCOL_VERSION,
    id,
    ok: false,
    error: { code, message },
  });

  const mainWindowIfReady = () => {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || window.webContents.id !== readyWebContentsId) return undefined;
    return window;
  };

  const status = (): AppControlStatus => ({
    appVersion: app.getVersion(),
    ready: mainWindowIfReady() !== undefined,
    controlEnabled: appData.isAppControlEnabled,
    game: appData.currentGame,
    isGameRunning: appData.isWH3Running,
    launchInProgress: isGameLaunchInProgress() || isGameRequestBusy,
    enabledModCount: appData.enabledMods.length,
  });

  const forward = (window: BrowserWindow, request: AppControlRequest) =>
    new Promise<AppControlResponse>((resolve) => {
      const rendererId = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(rendererId);
        resolve(failure(request.id, "INTERNAL", "The app did not answer the request in time."));
      }, RENDERER_REPLY_TIMEOUT_MS);
      pending.set(rendererId, {
        timer,
        resolve: (response) => resolve({ ...response, id: request.id }),
      });
      window.webContents.send("appControlRequest", { ...request, id: rendererId });
    });

  /**
   * Force-kills the game like the sidebar's terminate button, then waits until the process is gone,
   * the app has noticed, and its post-exit cleanup has finished, so a launch can follow safely.
   */
  const stopGame = async (timeoutSeconds: number): Promise<AppControlStopResult> => {
    const game = appData.currentGame;
    const processName = gameToProcessName[game];
    const isProcessGone = async () => (await findGameProcessIds(processName)).length === 0;
    if (!appData.isWH3Running && (await isProcessGone())) return { game, wasRunning: false };
    // taskkill also fails when the game exited on its own meanwhile; the wait below decides.
    await terminateGameProcess(processName).catch((error) => console.log("[appControl] Kill failed:", error));
    if (!(await waitUntil(isProcessGone, timeoutSeconds * 1000)))
      throw new StopError(`The game is still running ${timeoutSeconds} seconds after being stopped.`);
    if (!(await waitUntil(() => !appData.isWH3Running, EXIT_NOTICE_TIMEOUT_MS)))
      throw new StopError("The game stopped, but WHMM did not notice it exit.");
    await afterGameExit();
    return { game, wasRunning: true };
  };

  const handleRequest = async (request: AppControlRequest): Promise<AppControlResponse> => {
    const id = typeof request?.id === "string" ? request.id : "";
    if (request?.v !== APP_CONTROL_PROTOCOL_VERSION)
      return failure(
        id,
        "INVALID_ARGUMENT",
        `Protocol version ${String(request?.v)} is not supported; the app speaks version ${APP_CONTROL_PROTOCOL_VERSION}. Use a matching CLI.`,
      );
    if (request.method === "status") return { v: APP_CONTROL_PROTOCOL_VERSION, id, ok: true, result: status() };
    if (!["listMods", "setMods", "launch", "stopGame"].includes(request.method))
      return failure(id, "INVALID_ARGUMENT", `Unknown method: ${String(request.method)}`);
    if (!appData.isAppControlEnabled)
      return failure(id, "DISABLED", "Command-line control is turned off in WHMM's options.");
    const window = mainWindowIfReady();
    if (!window) return failure(id, "NOT_READY", "WHMM is still loading.");
    if (request.method === "listMods" || request.method === "setMods") return forward(window, request);

    if (isGameLaunchInProgress() || isGameRequestBusy)
      return failure(id, "CONFLICT", "A game launch or stop is already in progress.");
    isGameRequestBusy = true;
    try {
      return await handleGameRequest(window, request, id);
    } finally {
      isGameRequestBusy = false;
    }
  };

  const handleGameRequest = async (
    window: BrowserWindow,
    request: AppControlRequest,
    id: string,
  ): Promise<AppControlResponse> => {
    if (request.method === "stopGame") {
      const params = (request.params ?? {}) as AppControlStopParams;
      try {
        const result = await stopGame(positiveSeconds(params.timeoutSeconds, DEFAULT_STOP_TIMEOUT_SECONDS));
        return { v: APP_CONTROL_PROTOCOL_VERSION, id, ok: true, result };
      } catch (error) {
        if (error instanceof StopError) return failure(id, "STOP_FAILED", error.message);
        throw error;
      }
    }

    const params = (request.params ?? {}) as AppControlLaunchParams & { timeoutSeconds?: number };
    let restarted = false;
    if (appData.isWH3Running) {
      if (!params.restart)
        return failure(id, "CONFLICT", "The game is already running. Use restart to stop it and launch again.");
      // Check everything first, so a mistyped mod or save doesn't stop the game for nothing.
      const validation = await forward(window, { ...request, params: { ...params, validateOnly: true } });
      if (!validation.ok) return validation;
      try {
        restarted = (await stopGame(positiveSeconds(params.stopTimeoutSeconds, DEFAULT_STOP_TIMEOUT_SECONDS)))
          .wasRunning;
      } catch (error) {
        if (error instanceof StopError) return failure(id, "STOP_FAILED", error.message);
        throw error;
      }
      await delay(RELAUNCH_DELAY_MS);
    }
    const timeoutSeconds = positiveSeconds(params.timeoutSeconds, DEFAULT_LAUNCH_TIMEOUT_SECONDS);
    const outcome = waitForGameLaunchOutcome(timeoutSeconds * 1000);
    const response = await forward(window, request);
    if (!response.ok) {
      outcome.cancel();
      return response;
    }
    const result = await outcome.promise;
    if (!result.started) return failure(id, "LAUNCH_FAILED", result.message || "The game did not start.");
    return { ...response, result: { ...(response.result as object), started: true, restarted } };
  };

  const onConnection = (socket: net.Socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let request: AppControlRequest;
        try {
          request = JSON.parse(line);
        } catch {
          socket.write(`${JSON.stringify(failure("", "INVALID_ARGUMENT", "Request is not valid JSON."))}\n`);
          continue;
        }
        void handleRequest(request)
          .catch((error) =>
            failure(request?.id ?? "", "INTERNAL", error instanceof Error ? error.message : String(error)),
          )
          .then((response) => {
            if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
          });
      }
    });
  };

  const endpoint = appControlEndpoint();
  const server = net.createServer(onConnection);
  const listen = (retryAfterStaleSocket: boolean) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (retryAfterStaleSocket && error.code === "EADDRINUSE" && process.platform !== "win32") {
        // A crashed run can leave the socket file behind; probe it before removing it.
        const probe = net.connect(endpoint);
        probe.once("connect", () => {
          probe.destroy();
          console.log("[appControl] Another WHMM instance owns the control socket; control is unavailable.");
        });
        probe.once("error", () => {
          fs.rmSync(endpoint, { force: true });
          listen(false);
        });
        return;
      }
      console.log("[appControl] Control pipe unavailable:", error.message);
    });
    server.listen(endpoint, () => {
      if (process.platform !== "win32") fs.chmodSync(endpoint, 0o600);
      console.log(`[appControl] Listening on ${endpoint}`);
      // Lets the CLI start this app later when it isn't running. Dev runs would record electron.exe.
      if (app.isPackaged) {
        const info = { exePath: process.execPath, protocolVersion: APP_CONTROL_PROTOCOL_VERSION };
        fs.promises
          .writeFile(path.join(app.getPath("userData"), APP_CONTROL_INFO_FILE_NAME), JSON.stringify(info))
          .catch((error) => console.log("[appControl] Could not record the app path:", error));
      }
    });
  };
  listen(true);
  app.once("will-quit", () => {
    server.close();
    if (process.platform !== "win32") fs.rmSync(endpoint, { force: true });
  });
};
