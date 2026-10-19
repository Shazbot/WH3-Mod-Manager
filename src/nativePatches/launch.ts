import { spawn, type ChildProcess } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import { execFileSync } from "child_process";
import * as nodePath from "path";
import type { NativePatchLaunchPlan } from "./planner";
import type { NativePatchSkippedPackage } from "./manifest";
import { skipFailedNativePatches } from "./failurePolicy";
import { findExecutableOnPath, type GameLaunchCommand } from "../utility/gameLaunch";

const STATUS_POLL_MS = 200;
const MANAGER_ACTIVATION_TIMEOUT_MS = 120_000;
const CANCEL_ACK_TIMEOUT_MS = 12_000;

export type NativePatchLaunchFiles = {
  runDirectory: string;
  planPath: string;
  statusPath: string;
  releasePath: string;
  cancelPath: string;
  decisionPath: string;
};

export type NativePatchLaunchInvocation = {
  command: string;
  args: string[];
  helperPath: string;
  launcher: "windows" | "protontricks" | "flatpak-protontricks";
};

export type NativePatchHelperStatus = {
  protocol: 1;
  runId: string;
  state: "starting" | "prepared" | "activated" | "release_ready" | "released" | "failed";
  message?: string;
  pid?: number;
  processCreationTime?: string;
  failedPackageIds?: string[];
  terminationConfirmed?: boolean;
  retryable?: boolean;
};

export type NativePatchLaunchResult =
  | { started: true; status: NativePatchHelperStatus }
  | {
      started: false;
      message: string;
      cancellationAcknowledged: boolean;
      failedPackageIds?: string[];
      retryable?: boolean;
    };

export const nativePatchHelperResourcePath = () => {
  const packaged = nodePath.join(process.resourcesPath, "WH3NativePatchHelper.exe");
  if (fs.existsSync(packaged)) return packaged;
  return nodePath.resolve(__dirname, "../../tools/nativePatchHelper/WH3NativePatchHelper.exe");
};

const ensureHelperInAppData = (appDataPath: string, sourcePath: string): string => {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Native patch helper is missing: ${sourcePath}`);
  }
  const targetDirectory = nodePath.join(appDataPath, "nativePatchHelper");
  fs.mkdirSync(targetDirectory, { recursive: true });
  const targetPath = nodePath.join(targetDirectory, "WH3NativePatchHelper.exe");
  const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
  let existingHash: string | undefined;
  if (fs.existsSync(targetPath))
    existingHash = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
  if (sourceHash !== existingHash) fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
};

const toWinePath = (absolutePath: string) => {
  const resolved = nodePath.resolve(absolutePath);
  if (!nodePath.isAbsolute(resolved)) throw new Error(`Expected an absolute path for Proton: ${absolutePath}`);
  return `Z:${resolved.replace(/\//g, "\\")}`;
};

export const writeNativePatchLaunchFiles = (input: {
  plan: NativePatchLaunchPlan;
  appDataPath: string;
  platform: NodeJS.Platform;
  gameArguments: string[];
  gameWorkingDirectory: string;
}): NativePatchLaunchFiles => {
  const root = nodePath.join(input.appDataPath, "nativePatchRuns");
  fs.mkdirSync(root, { recursive: true });
  const runDirectory = nodePath.join(root, input.plan.runId);
  fs.mkdirSync(runDirectory, { recursive: false, mode: 0o700 });
  const payloadDirectory = nodePath.join(runDirectory, "payloads");
  fs.mkdirSync(payloadDirectory, { mode: 0o700 });
  const planPath = nodePath.join(runDirectory, "plan.json");
  const statusPath = nodePath.join(runDirectory, "status.json");
  const releasePath = nodePath.join(runDirectory, "release.signal");
  const cancelPath = nodePath.join(runDirectory, "cancel.signal");
  const decisionPath = nodePath.join(runDirectory, "decision.json");
  const toHelperPath = (path: string) => (input.platform === "linux" ? toWinePath(path) : path);
  const packages = input.plan.packages.map((prepared, packageIndex) => ({
    id: prepared.manifest.package.id,
    version: prepared.manifest.package.version,
    targetSha256: prepared.manifest.target.sha256,
    allocation_policy: prepared.manifest.allocation_policy,
    signatures: prepared.manifest.signatures ?? [],
    symbols: prepared.manifest.symbols,
    guards: prepared.manifest.guards,
    writes: prepared.manifest.writes,
    fixups: prepared.manifest.fixups,
    runtime_functions: prepared.manifest.runtime_functions,
    blocks: prepared.blocks.map((block, blockIndex) => {
      const fileName = `p${packageIndex}_b${blockIndex}.bin`;
      const filePath = nodePath.join(payloadDirectory, fileName);
      const bytes = Buffer.from(block.bytesBase64, "base64");
      if (bytes.length !== block.size)
        throw new Error(`Prepared block ${prepared.manifest.package.id}.${block.id} changed size`);
      fs.writeFileSync(filePath, bytes, { flag: "wx", mode: 0o600 });
      return {
        id: block.id,
        size: block.size,
        alignment: block.alignment,
        protection: block.protection,
        payload_path: toHelperPath(filePath),
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  }));
  const helperPlan = {
    protocol: 1,
    runId: input.plan.runId,
    targetPath: toHelperPath(input.plan.targetPath),
    targetWorkingDirectory: toHelperPath(input.gameWorkingDirectory),
    targetSha256: input.plan.targetSha256,
    targetArguments: input.gameArguments,
    sessionTimeoutMs: MANAGER_ACTIVATION_TIMEOUT_MS,
    packages,
  };
  fs.writeFileSync(planPath, JSON.stringify(helperPlan), { flag: "wx", mode: 0o600 });
  return { runDirectory, planPath, statusPath, releasePath, cancelPath, decisionPath };
};

export const resolveNativePatchLaunchInvocation = (input: {
  appDataPath: string;
  helperResourcePath?: string;
  planFiles: NativePatchLaunchFiles;
  platform: NodeJS.Platform;
  steamId: string;
  findExecutable?: (command: string) => string | undefined;
}): NativePatchLaunchInvocation => {
  if (input.platform !== "win32" && input.platform !== "linux") {
    throw new Error(`Native patch startup is supported on Windows and Linux only (received ${input.platform}).`);
  }
  const sourcePath = input.helperResourcePath ?? nativePatchHelperResourcePath();
  const helperPath = ensureHelperInAppData(input.appDataPath, sourcePath);
  if (input.platform !== "linux") {
    return {
      command: helperPath,
      args: [
        "--plan",
        input.planFiles.planPath,
        "--status",
        input.planFiles.statusPath,
        "--release",
        input.planFiles.releasePath,
        "--cancel",
        input.planFiles.cancelPath,
        "--decision",
        input.planFiles.decisionPath,
      ],
      helperPath,
      launcher: "windows",
    };
  }

  const findExecutable = input.findExecutable ?? findExecutableOnPath;
  const protontricks = findExecutable("protontricks-launch");
  const flatpak = protontricks ? undefined : findExecutable("flatpak");
  const hasFlatpakProtontricks = (() => {
    if (!flatpak) return false;
    try {
      execFileSync(flatpak, ["info", "com.github.Matoking.protontricks"], { stdio: "ignore", timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  })();
  if (!protontricks && !hasFlatpakProtontricks) {
    throw new Error("Native patch startup requires native or Flatpak Protontricks for Steam app 1142710.");
  }
  const helperArgs = [
    "--plan",
    toWinePath(input.planFiles.planPath),
    "--status",
    toWinePath(input.planFiles.statusPath),
    "--release",
    toWinePath(input.planFiles.releasePath),
    "--cancel",
    toWinePath(input.planFiles.cancelPath),
    "--decision",
    toWinePath(input.planFiles.decisionPath),
  ];
  if (protontricks) {
    return {
      command: protontricks,
      args: ["--cwd-app", "--appid", input.steamId, helperPath, ...helperArgs],
      helperPath,
      launcher: "protontricks",
    };
  }
  return {
    command: flatpak as string,
    args: [
      "run",
      `--filesystem=${nodePath.dirname(helperPath)}:rw`,
      `--filesystem=${input.planFiles.runDirectory}:rw`,
      "--command=protontricks-launch",
      "com.github.Matoking.protontricks",
      "--cwd-app",
      "--appid",
      input.steamId,
      helperPath,
      ...helperArgs,
    ],
    helperPath,
    launcher: "flatpak-protontricks",
  };
};

const readStatus = (path: string, runId: string): NativePatchHelperStatus | undefined => {
  try {
    const raw = JSON.parse(fs.readFileSync(path, "utf8")) as NativePatchHelperStatus;
    if (raw.protocol !== 1 || raw.runId !== runId) return undefined;
    return raw;
  } catch {
    return undefined;
  }
};

const writeSignal = (path: string, runId: string) => {
  try {
    fs.writeFileSync(path, `${runId}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!fs.existsSync(path)) throw error;
  }
};

const writeDecision = (path: string, runId: string, decision: "release" | "cancel") => {
  try {
    fs.writeFileSync(path, JSON.stringify({ protocol: 1, runId, decision }), { flag: "wx", mode: 0o600 });
    return decision;
  } catch (error) {
    if (!fs.existsSync(path)) throw error;
    try {
      const existing = JSON.parse(fs.readFileSync(path, "utf8")) as {
        protocol?: number;
        runId?: string;
        decision?: string;
      };
      return existing.protocol === 1 &&
        existing.runId === runId &&
        (existing.decision === "release" || existing.decision === "cancel")
        ? existing.decision
        : undefined;
    } catch {
      return undefined;
    }
  }
};

const sleep = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

/** Waits for activation, explicitly releases the held game, and cancels/awaits the helper on failure. */
export const launchNativePatchHelper = async (input: {
  invocation: NativePatchLaunchInvocation;
  planFiles: NativePatchLaunchFiles;
  runId: string;
  cwd: string;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
}): Promise<NativePatchLaunchResult> => {
  const timeoutMs = input.timeoutMs ?? MANAGER_ACTIVATION_TIMEOUT_MS;
  const spawnProcess = input.spawnProcess ?? spawn;
  let child: ChildProcess;
  let childExit: string | undefined;
  try {
    child = spawnProcess(input.invocation.command, input.invocation.args, {
      cwd: input.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    return {
      started: false,
      message: error instanceof Error ? error.message : String(error),
      cancellationAcknowledged: true,
    };
  }
  child.once("error", (error) => {
    childExit = `helper error: ${error.message}`;
  });
  child.once("exit", (code, signal) => {
    childExit = `helper exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`;
  });

  const startedAt = Date.now();
  let current: NativePatchHelperStatus | undefined;
  try {
    while (Date.now() - startedAt < timeoutMs) {
      current = readStatus(input.planFiles.statusPath, input.runId);
      if (current?.state === "failed")
        throw new Error(current.message || "Native patch helper failed before activation.");
      if (current?.state === "activated") break;
      if (childExit && input.invocation.launcher === "windows") throw new Error(childExit);
      await sleep(STATUS_POLL_MS);
    }
    if (current?.state !== "activated") throw new Error("Native patch helper timed out before activation completed.");
    writeSignal(input.planFiles.releasePath, input.runId);
    const releaseStartedAt = Date.now();
    while (Date.now() - releaseStartedAt < 15_000) {
      current = readStatus(input.planFiles.statusPath, input.runId);
      if (
        current?.state === "release_ready" &&
        writeDecision(input.planFiles.decisionPath, input.runId, "release") !== "release"
      ) {
        throw new Error("Native patch helper did not accept the release decision.");
      }
      if (current?.state === "released") {
        child.unref();
        return { started: true, status: current };
      }
      if (current?.state === "failed")
        throw new Error(current.message || "Native patch helper failed while releasing the game.");
      if (childExit && input.invocation.launcher === "windows") throw new Error(childExit);
      await sleep(STATUS_POLL_MS);
    }
    throw new Error("Native patch helper did not acknowledge game release.");
  } catch (error) {
    if (current?.state === "released") {
      child.unref();
      return { started: true, status: current };
    }
    const decision = writeDecision(input.planFiles.decisionPath, input.runId, "cancel");
    if (decision === "release") {
      const releaseDeadline = Date.now() + CANCEL_ACK_TIMEOUT_MS;
      while (Date.now() < releaseDeadline) {
        current = readStatus(input.planFiles.statusPath, input.runId);
        if (current?.state === "released") {
          child.unref();
          return { started: true, status: current };
        }
        await sleep(STATUS_POLL_MS);
      }
      return {
        started: false,
        message: "The game release decision was already committed, but the helper did not acknowledge it.",
        cancellationAcknowledged: false,
      };
    }
    try {
      writeSignal(input.planFiles.cancelPath, input.runId);
    } catch {
      // A helper that has already exited cannot acknowledge a cancellation signal.
    }
    const cancelStartedAt = Date.now();
    while (Date.now() - cancelStartedAt < CANCEL_ACK_TIMEOUT_MS) {
      current = readStatus(input.planFiles.statusPath, input.runId);
      if (current?.state === "failed" || current?.state === "released") break;
      if (childExit && input.invocation.launcher === "windows") break;
      await sleep(STATUS_POLL_MS);
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      started: false,
      message: current?.state === "failed" && current.message ? current.message : message,
      cancellationAcknowledged:
        current?.state === "failed"
          ? current.terminationConfirmed !== false
          : childExit !== undefined && input.invocation.launcher === "windows",
      failedPackageIds: current?.state === "failed" ? current.failedPackageIds : undefined,
      retryable: current?.state === "failed" ? current.retryable : undefined,
    };
  }
};

export const cleanupNativePatchLaunchFiles = (files: NativePatchLaunchFiles) => {
  fs.rmSync(files.runDirectory, { recursive: true, force: true });
};

/** Each failed startup is terminated before retrying with a smaller package set. */
export const launchNativePatchPlan = async (input: {
  plan: NativePatchLaunchPlan;
  appDataPath: string;
  platform: NodeJS.Platform;
  steamId: string;
  gameArguments: string[];
  gameWorkingDirectory: string;
  onSkippedPackage?: (notice: NativePatchSkippedPackage) => void;
  onAttempt?: (invocation: NativePatchLaunchInvocation) => void;
}): Promise<
  { kind: "started" } | { kind: "unpatched" } | { kind: "failed"; message: string; cancellationAcknowledged: boolean }
> => {
  let packages = input.plan.packages;
  while (packages.length) {
    const plan = {
      ...input.plan,
      runId: crypto.randomUUID(),
      packages,
      targetSha256: packages.find((item) => item.manifest.target.sha256)?.manifest.target.sha256,
    };
    let files: NativePatchLaunchFiles | undefined;
    let safeToCleanup = true;
    let failure: Extract<NativePatchLaunchResult, { started: false }>;
    try {
      files = writeNativePatchLaunchFiles({ ...input, plan });
      const invocation = resolveNativePatchLaunchInvocation({ ...input, planFiles: files });
      input.onAttempt?.(invocation);
      safeToCleanup = false;
      const result = await launchNativePatchHelper({
        invocation,
        planFiles: files,
        runId: plan.runId,
        cwd: input.gameWorkingDirectory,
      });
      safeToCleanup = result.started || result.cancellationAcknowledged;
      if (result.started) return { kind: "started" };
      failure = result;
    } catch (error) {
      failure = {
        started: false,
        message: error instanceof Error ? error.message : String(error),
        cancellationAcknowledged: safeToCleanup,
      };
    } finally {
      if (files && safeToCleanup) {
        try {
          cleanupNativePatchLaunchFiles(files);
        } catch (error) {
          console.error("Failed to clean native patch launch files", error);
        }
      }
    }
    if (!failure.cancellationAcknowledged)
      return { kind: "failed", message: failure.message, cancellationAcknowledged: false };
    if (failure.retryable === false)
      return { kind: "failed", message: failure.message, cancellationAcknowledged: true };
    try {
      packages = skipFailedNativePatches(
        packages,
        failure.failedPackageIds ?? [],
        failure.message,
        input.onSkippedPackage,
      );
    } catch (error) {
      return {
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
        cancellationAcknowledged: true,
      };
    }
  }
  return { kind: "unpatched" };
};
