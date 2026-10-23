import type { OptimizerSummary } from "./cache";

/**
 * The savings of a launch's optimized mods, for one short line ("2 mods optimized: -336 MB, ~145 fewer
 * draw calls"). Only mods that were optimized (made now, restored from the cache or made in the
 * background) count; each contributes what its own run measured.
 */
export interface OptimizationTotals {
  mods: number;
  savedBytes: number;
  drawCalls: number;
}

export const totalOptimizations = (
  summaries: readonly (OptimizerSummary | undefined)[],
): OptimizationTotals | undefined => {
  const known = summaries.filter((summary): summary is OptimizerSummary => !!summary);
  if (known.length === 0) return undefined;
  return {
    mods: known.length,
    savedBytes: known.reduce((total, item) => total + Math.max(0, item.sourceBytes - item.outputBytes), 0),
    drawCalls: known.reduce((total, item) => total + Math.max(0, item.drawCallsEliminated), 0),
  };
};

/** "336 MB", "1.4 GB"; sizes are binary (1 MB = 1024 * 1024 bytes) like the rest of the options drawer. */
export const formatSavedBytes = (bytes: number): string => {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} GB`;
  return `${Math.round(megabytes)} MB`;
};
