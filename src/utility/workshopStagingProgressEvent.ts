import type { WorkshopStagingProgress } from "./workshopModStaging";

/** Maps a staging update to the event the renderer's progress card shows. */
export const workshopStagingStageForPhase = (phase: WorkshopStagingProgress["phase"]): string => {
  switch (phase) {
    case "planning":
      return "preparing";
    case "pruning":
      return "cleaning";
    case "copying":
      return "copying";
    case "compressing":
      return "compressing";
    case "optimizing":
      return "optimizing";
    case "checkpointing":
      return "saving";
    case "completed":
      return "complete";
    case "canceled":
      return "cleaning";
    default:
      return phase;
  }
};

export const makeWorkshopStagingProgressEvent = (
  runId: string,
  progress: WorkshopStagingProgress,
  status: WorkshopModStagingProgressStatus,
  overrides: Partial<WorkshopModStagingProgressEvent> = {},
): WorkshopModStagingProgressEvent => {
  const total = Number.isFinite(progress.total) ? Math.max(0, progress.total) : 0;
  const completed = Number.isFinite(progress.current) ? Math.max(0, Math.min(total, progress.current)) : 0;
  const byteFraction =
    progress.bytesCopied !== undefined && progress.totalBytes !== undefined && progress.totalBytes > 0
      ? Math.min(1, Math.max(0, progress.bytesCopied / progress.totalBytes))
      : undefined;
  const fileFraction =
    progress.fileIndex !== undefined && progress.fileCount !== undefined && progress.fileCount > 0
      ? Math.min(1, Math.max(0, progress.fileIndex / progress.fileCount))
      : undefined;
  const itemFraction = byteFraction ?? fileFraction ?? 0;
  // While mods are being staged the run supplies one overall fraction that only grows and counts the
  // mods that have work; before that, and for the other phases, the counts above decide.
  const planning = progress.phase === "planning";
  const overall =
    progress.fraction !== undefined && Number.isFinite(progress.fraction)
      ? Math.min(1, Math.max(0, progress.fraction))
      : undefined;
  return {
    runId,
    status,
    stage: workshopStagingStageForPhase(progress.phase),
    // Planning (which includes the optimizer's probe) has its own counters and no measure of how long
    // it takes; it shows an indeterminate bar rather than a percent the copy phase would reset.
    ...(planning
      ? {}
      : overall !== undefined
        ? { percent: Math.round(overall * 100) }
        : total > 0
          ? { percent: Math.round(((completed + itemFraction) / total) * 100) }
          : {}),
    ...(planning
      ? {}
      : {
          completedMods: overall !== undefined && progress.modsDone !== undefined ? progress.modsDone : completed,
          totalMods: overall !== undefined && progress.modsTotal !== undefined ? progress.modsTotal : total,
        }),
    ...(progress.fromCache ? { fromCache: true } : {}),
    ...(progress.bytesCopied !== undefined ? { bytesCopied: progress.bytesCopied } : {}),
    ...(progress.totalBytes !== undefined ? { totalBytes: progress.totalBytes } : {}),
    ...(progress.fileIndex !== undefined ? { fileIndex: progress.fileIndex } : {}),
    ...(progress.fileCount !== undefined ? { fileCount: progress.fileCount } : {}),
    ...(progress.modName ? { currentMod: progress.modName } : {}),
    ...(progress.phase === "compressing" && progress.message ? { currentFile: progress.message } : {}),
    ...(progress.message ? { detail: progress.message } : {}),
    ...overrides,
  };
};
