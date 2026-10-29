import { type ChildProcess, spawn } from "node:child_process";
import * as os from "node:os";

/**
 * Runs `WH3AssetHost.exe optimize` (or `check`) once and reads its stdout protocol: one JSON object per
 * line (`progress`, then `result`, `probe`, `check` or `error`) and an exit code of 0 succeeded, 1 failed,
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
  // Rebuild LOD1+ of rigids whose LODs AssetEditor's old decimator generated (hosts before output 32 ignore it).
  remakeEditorLods: true,
  // Remove source files nothing reaches or names: authoring leftovers, backup/test meshes, orphan textures
  // (hosts before output 33 ignore it).
  pruneDeadFiles: true,
  // Move alpha-tested character materials whose base colour is opaque to the non-alpha twin shader
  // (hosts before output 33 ignore it).
  switchOpaqueAlphaShaders: true,
  // The host writes the output's rigid models LZ4-compressed the way whmm's staging compressor does, so
  // optimized results need no compression step here.
  compressRigidModels: true,
} as const;

/**
 * Options sent with an optimize request but kept out of the cache key because they do not change the
 * output pack. `reportDiagnostics: false` skips the report-only audits (~10 % of a run); hosts that
 * predate it ignore it.
 */
export const WORKSHOP_OPTIMIZER_REQUEST_ONLY_OPTIONS = {
  reportDiagnostics: false,
} as const;

/** The host option set for a launch; `compressRigidModels` follows the user's rigid-model compression setting. */
export const buildHostOptions = (compressRigidModels: boolean) => ({
  ...WORKSHOP_OPTIMIZER_HOST_OPTIONS,
  compressRigidModels,
});

export interface HostVersions {
  hostVersion: string;
  outputVersion: number;
  scanVersion: number;
  /** The version of the host's `check` action; absent on a host that predates it. */
  checkVersion?: number;
}

/** Parses the line `WH3AssetHost --version` prints: "0.6.0+abc123 output=1 scan=1 check=1". */
export const parseHostVersionLine = (text: string): HostVersions | undefined => {
  const output = /\boutput=(\d+)/.exec(text);
  const scan = /\bscan=(\d+)/.exec(text);
  if (!output || !scan) return undefined;
  const check = /\bcheck=(\d+)/.exec(text);
  return {
    hostVersion: text.trim().split(/\s+/)[0] ?? "",
    outputVersion: Number(output[1]),
    scanVersion: Number(scan[1]),
    ...(check ? { checkVersion: Number(check[1]) } : {}),
  };
};

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

/** What a run saved, as the host reports it. Sizes are bytes. */
export interface HostSummaryLine {
  sourceBytes: number;
  outputBytes: number;
  textureBytesSaved: number;
  drawCallsEliminated: number;
  mergedModelsGenerated: number;
}

export interface HostSourceProbe {
  sourcePackPath: string;
  consumers: HostConsumerPack[];
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
  outputVersion?: number;
  summary?: HostSummaryLine;
}

export interface HostProbeLine {
  type: "probe";
  hostVersion: string;
  consumers: HostConsumerPack[];
  elapsedSeconds?: number;
  outputVersion?: number;
  scanVersion?: number;
  /** Present for a batch probe (`probeSources`). */
  sources?: HostSourceProbe[];
  packsScanned?: number;
  scanCacheHits?: number;
  scanSeconds?: number;
}

export type HostCheckSeverity = "error" | "warning" | "info";

/** One finding of the host's visual-asset check (`WH3AssetHost check`). */
export interface HostCheckFinding {
  severity: HostCheckSeverity;
  /** Stable identifier of the kind of finding, e.g. "MissingTexture". */
  code: string;
  category: string;
  message: string;
  /** The pack file the finding is about, or the path that cannot be resolved. May be empty. */
  path: string;
  relatedPaths: string[];
  /** The real number of related paths; `relatedPaths` is capped. */
  relatedCount: number;
  details?: string | null;
  /**
   * Whether a unit in the game data reaches the asset: true, false (only unused variant meshes do; the
   * severity is already one level lower), or null when unknown (no DB schema, or the data could not be resolved).
   */
  usedByGame: boolean | null;
}

export interface HostCheckSummary {
  errors: number;
  warnings: number;
  infos: number;
  byCode: Record<string, number>;
  byCategory: Record<string, number>;
  findingsUsed: number;
  findingsUnused: number;
  findingsUnknown: number;
  /** Whether findings could be marked used or unused. */
  usageKnown: boolean;
  vmdsUsed: number;
  vmdsUnused: number;
}

export interface HostCheckLine {
  type: "check";
  status: "succeeded" | "cancelled" | string;
  hostVersion?: string;
  findings: HostCheckFinding[];
  summary: HostCheckSummary;
  /** The text report the host wrote, or empty when none was requested. */
  reportPath: string;
  elapsedSeconds?: number;
  vmdCount?: number;
  wsModelCount?: number;
  rigidCount?: number;
  materialCount?: number;
}

export interface HostErrorLine {
  type: "error";
  message: string;
  exceptionType?: string;
}

export type HostLine = HostProgressLine | HostResultLine | HostProbeLine | HostCheckLine | HostErrorLine;

export type HostRunOutcome =
  | { kind: "result"; result: HostResultLine }
  | { kind: "probe"; probe: HostProbeLine }
  | { kind: "check"; check: HostCheckLine }
  | { kind: "version"; text: string }
  | { kind: "ok" }
  | { kind: "failed"; exitCode: number | null; message: string; stderr?: string }
  | { kind: "canceled" };

/** The part of a child process this runner uses; tests supply a fake. */
export interface HostChildProcess {
  pid?: number;
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

const SEVERITIES: ReadonlySet<string> = new Set(["error", "warning", "info"]);
const asCount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const asCounts = (value: unknown): Record<string, number> =>
  value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, count]) => [key, asCount(count)]))
    : {};

/** Normalizes the host's `check` line: missing arrays and counts become empty, unknown severities become "info". */
export const parseHostCheckLine = (value: Record<string, unknown>): HostCheckLine => {
  const summary = (value.summary ?? {}) as Record<string, unknown>;
  const findings = Array.isArray(value.findings) ? (value.findings as Record<string, unknown>[]) : [];
  return {
    type: "check",
    status: String(value.status ?? ""),
    hostVersion: typeof value.hostVersion === "string" ? value.hostVersion : undefined,
    findings: findings.map((finding) => {
      const relatedPaths = Array.isArray(finding.relatedPaths) ? finding.relatedPaths.map(String) : [];
      return {
        severity: SEVERITIES.has(String(finding.severity)) ? (finding.severity as HostCheckSeverity) : "info",
        code: String(finding.code ?? ""),
        category: String(finding.category ?? ""),
        message: String(finding.message ?? ""),
        path: String(finding.path ?? ""),
        relatedPaths,
        relatedCount: typeof finding.relatedCount === "number" ? finding.relatedCount : relatedPaths.length,
        details: typeof finding.details === "string" ? finding.details : null,
        usedByGame: typeof finding.usedByGame === "boolean" ? finding.usedByGame : null,
      };
    }),
    summary: {
      errors: asCount(summary.errors),
      warnings: asCount(summary.warnings),
      infos: asCount(summary.infos),
      byCode: asCounts(summary.byCode),
      byCategory: asCounts(summary.byCategory),
      findingsUsed: asCount(summary.findingsUsed),
      findingsUnused: asCount(summary.findingsUnused),
      findingsUnknown: asCount(summary.findingsUnknown),
      usageKnown: summary.usageKnown === true,
      vmdsUsed: asCount(summary.vmdsUsed),
      vmdsUnused: asCount(summary.vmdsUnused),
    },
    reportPath: String(value.reportPath ?? ""),
    elapsedSeconds: typeof value.elapsedSeconds === "number" ? value.elapsedSeconds : undefined,
    vmdCount: asCount(value.vmdCount),
    wsModelCount: asCount(value.wsModelCount),
    rigidCount: asCount(value.rigidCount),
    materialCount: asCount(value.materialCount),
  };
};

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
      case "check":
        return parseHostCheckLine(value);
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

/**
 * Seconds each stage of `WH3AssetHost check` took on the same mod (about 14 s warm), measured the same way.
 * The loading share also holds the host's start-up, which happens before its first progress line.
 */
export const CHECK_STAGE_SECONDS: ReadonlyArray<readonly [string, number]> = [
  ["Loading source pack", 0.6],
  ["Validating VMD roots", 0.1],
  ["Indexing WSModels", 0.1],
  ["Resolving unit categories", 8.5],
  ["Indexing mesh dependencies", 0.2],
  ["Auditing LODs", 7.8],
  ["Asset checks: reading materials", 0.3],
  ["Asset checks: comparing textures", 0.6],
  ["Asset checks: decoding alpha", 3.3],
  ["Auditing bone weights", 1.7],
  ["Collecting findings", 0.1],
];

type StageTable = ReadonlyArray<readonly [string, number]>;
const buildStageBands = (stages: StageTable) => {
  const total = stages.reduce((sum, [, seconds]) => sum + seconds, 0);
  let start = 0;
  return new Map(
    stages.map(([name, seconds]) => {
      const band = { start: start / total, end: (start + seconds) / total };
      start += seconds;
      return [name, band] as const;
    }),
  );
};
const STAGE_BANDS = buildStageBands(STAGE_SECONDS);
const STAGE_ORDER = new Map(STAGE_SECONDS.map(([name], index) => [name, index] as const));

/**
 * Turns the host's progress lines into a share (0..1) of one host run that never goes backwards.
 * - A stage inside its band only moves with current/total of that stage.
 * - A stage the table does not know holds the last value instead of jumping.
 * - A stage name that comes again after other stages uses its "#2" entry, or holds when it has none.
 */
export class HostProgressTracker {
  private readonly bands: ReturnType<typeof buildStageBands>;
  private readonly order: Map<string, number>;
  private last = 0;
  private lastStage: string | undefined;
  private lastOrder = -1;
  private readonly occurrences = new Map<string, number>();

  /** `stages` defaults to the optimizer's stage table; the check passes `CHECK_STAGE_SECONDS`. */
  constructor(stages?: StageTable) {
    this.bands = stages ? buildStageBands(stages) : STAGE_BANDS;
    this.order = stages ? new Map(stages.map(([name], index) => [name, index] as const)) : STAGE_ORDER;
  }

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
    const band = this.bands.get(key);
    const order = this.order.get(key);
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
  /** Run below normal priority (background optimization), so the game and the manager stay responsive. */
  lowPriority?: boolean;
  /** Lowers a process's priority; defaults to `os.setPriority` (a seam for tests). */
  setPriority?: (pid: number, priority: number) => void;
  /** Receives the process id once it started. */
  onStarted?: (pid: number | undefined) => void;
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

    if (options.lowPriority && child.pid) {
      try {
        (options.setPriority ?? os.setPriority)(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // A host that cannot be lowered still runs, just at normal priority.
      }
    }
    options.onStarted?.(child.pid);

    let settled = false;
    let result: HostResultLine | undefined;
    let probe: HostProbeLine | undefined;
    let check: HostCheckLine | undefined;
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
      else if (line.type === "check") check = line;
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
      if (code === 3 || (result && result.status === "cancelled") || (check && check.status === "cancelled")) {
        return finish({ kind: "canceled" });
      }
      if (code === 0) {
        if (check) return finish({ kind: "check", check });
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
