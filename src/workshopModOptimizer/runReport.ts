import type { OptimizerLaunchMod, OptimizerModRecord } from "./logFormat";
import type { WorkshopStagingOptimizerSummary } from "../utility/workshopModStaging";

/**
 * The per-mod result of the latest launch that ran "Optimize mods", for the results report. Built from
 * what the optimizer already knows (the staging outcomes, the host's savings summary and the skip
 * reasons the launch log uses); the window only formats it. Kept as plain JSON so it survives restarts.
 */
export type OptimizerRunSkipReason =
  "noVisualAssets" | "dataFolder" | "notStaged" | "userSkipped" | "hostUnavailable" | "previouslyFailed";

export type OptimizerRunModStatus = "optimized" | "alreadyOptimal" | "skipped" | "failed";

export interface OptimizerRunModEntry {
  /** The mod's name as shown in the mod list. */
  name: string;
  packName: string;
  status: OptimizerRunModStatus;
  skipReason?: OptimizerRunSkipReason;
  failureMessage?: string;
  /** The result was reused from an earlier run or made in the background, not made during this launch. */
  reused?: boolean;
  /** Bytes; absent when the optimizer did not report them (skipped or failed mods, older cached results). */
  sourceBytes?: number;
  outputBytes?: number;
  textureBytesSaved?: number;
  drawCallsEliminated?: number;
  mergedModelsGenerated?: number;
}

export interface OptimizerRunReport {
  version: 1;
  /** Epoch milliseconds. */
  createdAt: number;
  game: string;
  mods: OptimizerRunModEntry[];
}

export interface OptimizerRunTotals {
  optimized: number;
  alreadyOptimal: number;
  skipped: number;
  failed: number;
  sourceBytes: number;
  outputBytes: number;
  savedBytes: number;
  drawCallsEliminated: number;
}

export interface BuildOptimizerRunReportOptions {
  game: string;
  now?: number;
  /** Enabled mods in load order. */
  mods: readonly (OptimizerLaunchMod & { humanName?: string })[];
  dataPackNames: ReadonlySet<string>;
  stagedDirectories: ReadonlySet<string>;
  comparableDirectory: (directory: string) => string;
  recordFor: (path: string) => OptimizerModRecord | undefined;
  outcomes: ReadonlyArray<{
    name: string;
    status: "optimized" | "restored" | "skipped" | "failed";
    message?: string;
    summary?: WorkshopStagingOptimizerSummary;
  }>;
  userSkipped: boolean;
}

/** Whether the host found something to improve; a result that is not smaller and merges nothing is "already optimal". */
const hasImprovement = (summary: WorkshopStagingOptimizerSummary): boolean =>
  summary.outputBytes < summary.sourceBytes ||
  summary.drawCallsEliminated > 0 ||
  summary.mergedModelsGenerated > 0 ||
  summary.textureBytesSaved > 0;

export const buildOptimizerRunReport = ({
  game,
  now = Date.now(),
  mods,
  dataPackNames,
  stagedDirectories,
  comparableDirectory,
  recordFor,
  outcomes,
  userSkipped,
}: BuildOptimizerRunReportOptions): OptimizerRunReport => ({
  version: 1,
  createdAt: now,
  game,
  mods: mods.map((mod): OptimizerRunModEntry => {
    const base = { name: mod.humanName || mod.name, packName: mod.name };
    const record = recordFor(mod.path);
    if (mod.sourceKind === "data" || mod.isInModding || dataPackNames.has(mod.name.toLowerCase())) {
      return { ...base, status: "skipped", skipReason: "dataFolder" };
    }
    const staged = mod.sourceKind === "workshop" || stagedDirectories.has(comparableDirectory(mod.modDirectory));
    if (!staged) return { ...base, status: "skipped", skipReason: "notStaged" };

    const outcome = outcomes.find((item) => item.name.toLowerCase() === mod.name.toLowerCase());
    if (outcome?.status === "failed") {
      return { ...base, status: "failed", failureMessage: outcome.message };
    }
    if (outcome?.status === "optimized" || outcome?.status === "restored") {
      const summary = outcome.summary;
      return {
        ...base,
        status: summary && !hasImprovement(summary) ? "alreadyOptimal" : "optimized",
        reused: outcome.status === "restored",
        ...(summary ? { ...summary } : {}),
      };
    }
    let skipReason: OptimizerRunSkipReason;
    switch (record?.skipReason) {
      case "host-unavailable":
        skipReason = "hostUnavailable";
        break;
      case "cached-failure":
        skipReason = "previouslyFailed";
        break;
      case "user-skipped":
        skipReason = "userSkipped";
        break;
      case "no-visual-assets":
        skipReason = "noVisualAssets";
        break;
      default:
        skipReason = outcome || userSkipped ? "userSkipped" : "noVisualAssets";
    }
    return {
      ...base,
      status: "skipped",
      skipReason,
      ...(skipReason === "previouslyFailed" && record?.failureMarker
        ? { failureMessage: record.failureMarker.message }
        : {}),
    };
  }),
});

export const totalOptimizerRun = (report: OptimizerRunReport): OptimizerRunTotals => {
  const totals: OptimizerRunTotals = {
    optimized: 0,
    alreadyOptimal: 0,
    skipped: 0,
    failed: 0,
    sourceBytes: 0,
    outputBytes: 0,
    savedBytes: 0,
    drawCallsEliminated: 0,
  };
  for (const mod of report.mods) {
    totals[mod.status] += 1;
    if (mod.sourceBytes === undefined || mod.outputBytes === undefined) continue;
    totals.sourceBytes += mod.sourceBytes;
    totals.outputBytes += mod.outputBytes;
    totals.savedBytes += Math.max(0, mod.sourceBytes - mod.outputBytes);
    totals.drawCallsEliminated += Math.max(0, mod.drawCallsEliminated ?? 0);
  }
  return totals;
};
