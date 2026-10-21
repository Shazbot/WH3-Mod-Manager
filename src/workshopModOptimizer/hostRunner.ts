import { type ChildProcess, spawn } from "node:child_process";

/**
 * Runs `WH3AssetHost.exe optimize` once and reads its stdout protocol: one JSON object per line
 * (`progress`, then `result`, `probe` or `error`) and an exit code of 0 succeeded, 1 failed,
 * 2 invalid request, 3 canceled. No Electron imports, so it can be tested with a fake process.
 */

/** The optimizer options a Workshop launch uses: the measured set, atlasing off. */
export const WORKSHOP_OPTIMIZER_HOST_OPTIONS = {
  mergeCompatibleMeshes: true,
  shareAtlasesAcrossVmds: true,
  optimizeGeometry: true,
  lodAwareAtlasPlanning: true,
  crossRigidMerges: true,
  buildAtlases: false,
  downscaleTextures: true,
  sharedTextureRepack: true,
  compactTextures: true,
  dropUnreadAlpha: true,
} as const;

/** Bumped when the option set or the meaning of an optimized result changes. */
export const WORKSHOP_OPTIMIZER_PROFILE_ID = "wh3-visual-v1";

export interface HostConsumerReasons {
  frozenFiles: number;
  usedFiles: number;
  dbMentions: number;
  undecodableTables: number;
  vanillaOverridesReached: number;
}

export interface HostConsumerPack {
  path: string;
  relevant: boolean;
  reasons: HostConsumerReasons;
}

export interface HostProgressLine {
  type: "progress";
  stage: string;
  item?: string | null;
  current: number;
  total: number;
}

export interface HostResultLine {
  type: "result";
  status: "succeeded" | "cancelled" | string;
  outputPackPath: string;
  reportPath: string;
  elapsedSeconds?: number;
  warnings?: string[];
  hostVersion?: string;
  consumerPacks?: HostConsumerPack[];
}

export interface HostProbeLine {
  type: "probe";
  hostVersion: string;
  consumers: HostConsumerPack[];
  elapsedSeconds?: number;
}

export interface HostErrorLine {
  type: "error";
  message: string;
  exceptionType?: string;
}

export type HostLine = HostProgressLine | HostResultLine | HostProbeLine | HostErrorLine;

export type HostRunOutcome =
  | { kind: "result"; result: HostResultLine }
  | { kind: "probe"; probe: HostProbeLine }
  | { kind: "version"; text: string }
  | { kind: "ok" }
  | { kind: "failed"; exitCode: number | null; message: string }
  | { kind: "canceled" };

/** The part of a child process this runner uses; tests supply a fake. */
export interface HostChildProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(): boolean;
}

export type SpawnHostProcess = (executablePath: string, args: string[]) => HostChildProcess;

export const defaultSpawnHostProcess: SpawnHostProcess = (executablePath, args) =>
  spawn(executablePath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }) as ChildProcess &
    HostChildProcess;

export const parseHostLine = (line: string): HostLine | undefined => {
  const text = line.trim();
  if (!text.startsWith("{")) return undefined;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    switch (value.type) {
      case "progress":
        return {
          type: "progress",
          stage: String(value.stage ?? ""),
          item: typeof value.item === "string" ? value.item : null,
          current: Number(value.current) || 0,
          total: Number(value.total) || 0,
        };
      case "result":
      case "probe":
      case "error":
        return value as unknown as HostLine;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
};

/**
 * A rough share of the whole run (0..1) each named host stage starts at, from the phase timings of
 * a measured run on a large mod. It only has to move the bar in the right direction.
 */
const STAGE_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["Loading source pack", 4],
  ["Validating VMD roots", 1],
  ["Resolving unit categories", 11],
  ["Selecting atlas VMD population", 0.5],
  ["Scanning source dependencies", 2],
  ["Copying source pack", 3],
  ["Auditing LODs", 8],
  ["Asset checks: reading materials", 1.5],
  ["Asset checks: comparing textures", 1.5],
  ["Asset checks: decoding alpha", 1.5],
  ["Asset checks: comparing rigid parts", 1.5],
  ["Auditing bone weights", 1.5],
  ["Indexing WSModels", 2],
  ["Analyzing structural mesh merges", 5],
  ["Texture downscale early estimate", 2.5],
  ["Texture downscale analysis", 1.5],
  ["Vanilla texture coverage", 8],
  ["Per-unit texture repack estimate", 0.5],
  ["Analyzing cross-rigid merges", 60],
  ["Emitting cross-rigid merges", 4.5],
  ["Shared texture repack", 9],
  ["Merging compatible mesh parts", 1.5],
  ["Optimizing geometry", 5],
  ["Serializing modified rigids", 8],
  ["Serializing modified WSModels", 1],
  ["Serializing modified VMDs", 1],
  ["Replacing modified assets", 1],
  ["Scanning rewritten dependencies", 2.5],
  ["Pruning unused assets", 1.5],
  ["Finding unused assets", 1],
  ["Checking retained references", 1],
  ["Downscaling textures", 2],
  ["Exact texture compaction", 0.5],
  ["Compacting textures", 3.5],
  ["Validating output", 2],
  ["Validating modified VMDs", 0.5],
  ["Validating modified rigids", 0.5],
  ["Validating WSModels", 0.5],
  ["Validating generated materials", 0.5],
  ["Saving output pack", 5],
];

const STAGE_TOTAL_WEIGHT = STAGE_WEIGHTS.reduce((total, [, weight]) => total + weight, 0);

/** Fraction (0..1) of a host run done when `stage` is reported, optionally with its item progress. */
export const hostStageFraction = (stage: string, current = 0, total = 0): number | undefined => {
  let before = 0;
  for (const [name, weight] of STAGE_WEIGHTS) {
    if (name === stage) {
      const within = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
      return Math.min(1, (before + weight * within) / STAGE_TOTAL_WEIGHT);
    }
    before += weight;
  }
  return undefined;
};

export interface RunHostOptions {
  executablePath: string;
  args: string[];
  signal?: AbortSignal;
  onProgress?: (line: HostProgressLine) => void;
  spawnProcess?: SpawnHostProcess;
}

const MAX_STDERR_CHARS = 16 * 1024;

/**
 * Starts the host and resolves with how it ended. An abort kills the process and resolves
 * `canceled`; the caller removes the temp files the host may have left.
 */
export const runHost = (options: RunHostOptions): Promise<HostRunOutcome> =>
  new Promise<HostRunOutcome>((resolve) => {
    const spawnProcess = options.spawnProcess ?? defaultSpawnHostProcess;
    let child: HostChildProcess;
    try {
      child = spawnProcess(options.executablePath, options.args);
    } catch (error) {
      resolve({ kind: "failed", exitCode: null, message: error instanceof Error ? error.message : String(error) });
      return;
    }

    let settled = false;
    let result: HostResultLine | undefined;
    let probe: HostProbeLine | undefined;
    let errorLine: HostErrorLine | undefined;
    let versionText = "";
    let stderrTail = "";
    let buffer = "";
    const finish = (outcome: HostRunOutcome) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // The process may already be gone.
      }
      finish({ kind: "canceled" });
    };

    const handleLine = (rawLine: string) => {
      const line = parseHostLine(rawLine);
      if (!line) {
        if (rawLine.trim()) versionText = rawLine.trim();
        return;
      }
      if (line.type === "progress") {
        try {
          options.onProgress?.(line);
        } catch {
          // A progress consumer must never stop the run.
        }
      } else if (line.type === "result") result = line;
      else if (line.type === "probe") probe = line;
      else if (line.type === "error") errorLine = line;
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-MAX_STDERR_CHARS);
    });
    child.on("error", (error) => finish({ kind: "failed", exitCode: null, message: error.message }));
    child.on("exit", (code) => {
      if (buffer.trim()) handleLine(buffer);
      buffer = "";
      if (options.signal?.aborted) return finish({ kind: "canceled" });
      if (code === 3 || (result && result.status === "cancelled")) return finish({ kind: "canceled" });
      if (code === 0) {
        if (probe) return finish({ kind: "probe", probe });
        if (result) return finish({ kind: "result", result });
        return finish(versionText ? { kind: "version", text: versionText } : { kind: "ok" });
      }
      finish({
        kind: "failed",
        exitCode: code,
        message: errorLine?.message || stderrTail.trim().split("\n").slice(-3).join(" ") || `exit code ${code}`,
      });
    });

    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
