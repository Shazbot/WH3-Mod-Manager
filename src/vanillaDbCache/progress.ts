export type VanillaDbCacheBuildPhase =
  | "indexing"
  | "parsing"
  | "encoding"
  | "validating"
  | "writing"
  | "complete";

export type VanillaDbCacheBuildStatus = "running" | "complete" | "failed" | "cancelled";

export interface VanillaDbCacheBuildProgress {
  buildId: string;
  game: string;
  phase: VanillaDbCacheBuildPhase;
  status: VanillaDbCacheBuildStatus;
  /** Stage-weighted progress. Parsing and encoding do not expose granular callbacks yet. */
  percent: number;
  detail?: string;
}

export type VanillaDbCacheBuildProgressReporter = (
  progress: VanillaDbCacheBuildProgress,
) => void;

let reporter: VanillaDbCacheBuildProgressReporter | undefined;

/** Main-process integration installs this once IPC windows are available. */
export const setVanillaDbCacheBuildProgressReporter = (
  nextReporter: VanillaDbCacheBuildProgressReporter | undefined,
): void => {
  reporter = nextReporter;
};

export const reportVanillaDbCacheBuildProgress = (
  progress: VanillaDbCacheBuildProgress,
): void => {
  reporter?.(progress);
};
