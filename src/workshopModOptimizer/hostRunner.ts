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
  | { kind: "failed"; exitCode: number | null; message: string; stderr?: string }
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
 * Seconds each host stage took in a measured run on a large mod (`!ak_teb3`, 112 s, from the
 * arrival timestamps of the host's stdout). They only set the shape of the bar: how big each stage's
 * share of it is. A stage name the host repeats after later stages (it runs "Pruning unused assets"
 * and "Texture downscale analysis" twice) has its own "#2" entry for the second run.
 */
const STAGE_SECONDS: ReadonlyArray<readonly [string, number]> = [
  ["Loading source pack", 0.6],
  ["Validating VMD roots", 0.3],
  ["Resolving unit categories", 8.9],
  ["Selecting atlas VMD population", 0.3],
  ["Scanning source dependencies", 1.2],
  ["Copying source pack", 0.3],
  ["Auditing LODs", 3.9],
  ["Asset checks: reading materials", 0.3],
  ["Asset checks: comparing textures", 0.3],
  ["Asset checks: decoding alpha", 2.9],
  ["Asset checks: comparing rigid parts", 0.3],
  ["Auditing bone weights", 0.6],
  ["Indexing WSModels", 3.4],
  ["Analyzing structural mesh merges", 0.5],
  ["Texture downscale early estimate", 0.3],
  ["Texture downscale analysis", 1.1],
  ["Vanilla texture coverage", 4.6],
  ["Per-unit texture repack estimate", 0.3],
  ["Analyzing cross-rigid merges", 43.8],
  ["Emitting cross-rigid merges", 2.3],
  ["Shared texture repack", 8.3],
  ["Merging compatible mesh parts", 1.6],
  ["Optimizing geometry", 4.4],
  ["Serializing modified rigids", 10.1],
  ["Serializing modified WSModels", 0.3],
  ["Serializing modified VMDs", 0.3],
  ["Replacing modified assets", 0.3],
  ["Scanning rewritten dependencies", 1.4],
  ["Pruning unused assets", 0.3],
  ["Finding unused assets", 0.3],
  ["Checking retained references", 1.6],
  ["Pruning unused assets#2", 0.3],
  ["Texture downscale analysis#2", 1.3],
  ["Downscaling textures", 0.3],
  ["Exact texture compaction", 1.5],
  ["Compacting textures", 1.1],
  ["Validating output", 0.3],
  ["Validating modified VMDs", 0.3],
  ["Validating modified rigids", 0.4],
  ["Validating WSModels", 0.4],
  ["Validating generated materials", 1.2],
  ["Saving output pack", 3.7],
];

const STAGE_TOTAL_SECONDS = STAGE_SECONDS.reduce((total, [, seconds]) => total + seconds, 0);
const STAGE_BANDS = (() => {
  let start = 0;
  return new Map(
    STAGE_SECONDS.map(([name, seconds]) => {
      const band = { start: start / STAGE_TOTAL_SECONDS, end: (start + seconds) / STAGE_TOTAL_SECONDS };
      start += seconds;
      return [name, band] as const;
    }),
  );
})();
const STAGE_ORDER = new Map(STAGE_SECONDS.map(([name], index) => [name, index] as const));

/**
 * Turns the host's progress lines into a share (0..1) of one host run that never goes backwards.
 * - A stage inside its band only moves with current/total of that stage.
 * - A stage the table does not know holds the last value instead of jumping.
 * - A stage name that comes again after other stages uses its "#2" entry, or holds when it has none.
 */
export class HostProgressTracker {
  private last = 0;
  private lastStage: string | undefined;
  private lastOrder = -1;
  private readonly occurrences = new Map<string, number>();

  get fraction(): number {
    return this.last;
  }

  update(stage: string, current = 0, total = 0): number {
    if (stage !== this.lastStage) {
      this.occurrences.set(stage, (this.occurrences.get(stage) ?? 0) + 1);
      this.lastStage = stage;
    }

    const occurrence = this.occurrences.get(stage) ?? 1;
    const key = occurrence > 1 ? `${stage}#${occurrence}` : stage;
    const band = STAGE_BANDS.get(key);
    const order = STAGE_ORDER.get(key);
    if (!band || order === undefined || order < this.lastOrder) return this.last;

    this.lastOrder = order;
    const within = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
    this.last = Math.max(this.last, band.start + (band.end - band.start) * within);
    return this.last;
  }

  /** The host reported its result. */
  finish(): number {
    this.last = 1;
    return 1;
  }
}

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
        stderr: stderrTail,
      });
    });

    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
