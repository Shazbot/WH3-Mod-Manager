export type VanillaDbCacheBuildPhase =
  | "indexing"
  | "parsing"
  | "encoding"
  | "validating"
  | "writing"
  | "complete"
  /** Vanilla pack index only: reading each vanilla pack's file list. */
  | "reading-packs";

export type VanillaDbCacheBuildStatus = "running" | "complete" | "failed" | "cancelled";

/**
 * Which cache a report is about.
 *
 * Both caches are built lazily, block the main process while they run, and want to say the same
 * four things, so they share this channel and its card rather than each growing their own. Absent
 * means the database cache, which had the channel first.
 */
export type CacheBuildKind = "db" | "packIndex";

export interface VanillaDbCacheBuildProgress {
  buildId: string;
  game: string;
  kind?: CacheBuildKind;
  phase: VanillaDbCacheBuildPhase;
  status: VanillaDbCacheBuildStatus;
  /** Stage-weighted progress. Parsing and encoding do not expose granular callbacks yet. */
  percent: number;
  detail?: string;
}

export type VanillaDbCacheBuildProgressReporter = (progress: VanillaDbCacheBuildProgress) => void;

let reporter: VanillaDbCacheBuildProgressReporter | undefined;

/** Main-process integration installs this once IPC windows are available. */
export const setVanillaDbCacheBuildProgressReporter = (
  nextReporter: VanillaDbCacheBuildProgressReporter | undefined,
): void => {
  reporter = nextReporter;
};

export const reportVanillaDbCacheBuildProgress = (progress: VanillaDbCacheBuildProgress): void => {
  reporter?.(progress);
};
