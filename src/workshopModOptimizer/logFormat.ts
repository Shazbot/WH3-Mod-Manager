/**
 * One main.log line per enabled mod per launch when optimization is on. Pure formatting; the
 * optimizer collects the facts (see `OptimizerModRecord`) and the launch adds what staging decided.
 */

export type OptimizerModSource = "workshop" | "custom folder" | "data";

export type OptimizerSkipReason =
  "no-visual-assets" | "host-unavailable" | "cached-failure" | "data-folder" | "user-skipped" | "not-staged";

export interface OptimizerModRecord {
  keyKind?: "narrow (alias hit)" | "narrow (probed)" | "narrow (no other mods)" | "exact (probe unavailable)";
  probeSeconds?: number;
  /** How many mods the probe answered at once. */
  probeBatchSize?: number;
  /** The result was made by a background job that the launch waited for. */
  joinedBackground?: boolean;
  /** File names of the consumers the probe called relevant. */
  relevantConsumers?: string[];
  probeError?: string;
  skipReason?: OptimizerSkipReason;
  failureMarker?: { message: string; createdAt: number };
  /** Wall time of the host run plus compression. */
  seconds?: number;
  exitCode?: number | null;
  hostLogPath?: string;
}

export interface OptimizerLogInput {
  pack: string;
  source: OptimizerModSource;
  /** Staged with the rest of its custom folder although it has nothing to optimize. */
  stagedWithFolder?: boolean;
  status?: "optimized" | "restored" | "skipped" | "failed";
  failureMessage?: string;
  record?: OptimizerModRecord;
  /** How the result got into the staging folder. */
  placement?: "hard link" | "copy";
  placementReason?: string;
}

const formatDate = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 10);

const skipText = (input: OptimizerLogInput): string => {
  const record = input.record;
  switch (record?.skipReason) {
    case "data-folder":
      return "skipped: data folder";
    case "host-unavailable":
      return "skipped: host unavailable -> plain copy";
    case "user-skipped":
      return "skipped: user chose Launch without optimizing -> plain copy";
    case "cached-failure": {
      const marker = record.failureMarker;
      return `skipped: failed before for this input${
        marker ? ` (${formatDate(marker.createdAt)}: ${marker.message})` : ""
      } -> plain copy`;
    }
    case "not-staged":
      return "skipped: not staged -> loaded from its own folder";
    case "no-visual-assets":
    default:
      return `skipped: no .variantmeshdefinition/.wsmodel${input.stagedWithFolder ? " (copied with its folder)" : ""}`;
  }
};

export const formatOptimizerLogLine = (input: OptimizerLogInput): string => {
  const record = input.record;
  let outcome: string;
  const placed = input.placement
    ? ` (${input.placement === "copy" ? `copied${input.placementReason ? `, linking failed: ${input.placementReason}` : ""}` : "hard link"})`
    : "";
  if (input.status === "optimized") {
    outcome = `optimized in ${Math.round(record?.seconds ?? 0)} s${placed}`;
  } else if (input.status === "restored") {
    outcome = `restored from cache${record?.joinedBackground ? " (made by the background job)" : ""}${placed}`;
  } else if (input.status === "failed") {
    outcome =
      `failed: ${input.failureMessage ?? "unknown error"}` +
      (record?.exitCode !== undefined && record.exitCode !== null ? ` (exit code ${record.exitCode})` : "") +
      (record?.hostLogPath ? ` (host log: ${record.hostLogPath})` : "") +
      " -> fell back to plain copy";
  } else if (input.status === "skipped" && !record?.skipReason) {
    outcome = "skipped: user chose Launch without optimizing -> plain copy";
  } else {
    outcome = skipText(input);
  }

  const details: string[] = [];
  if (record?.keyKind) details.push(`key: ${record.keyKind}`);
  if (record?.probeSeconds !== undefined) {
    details.push(
      `probe ${record.probeSeconds.toFixed(1)} s${
        record.probeBatchSize && record.probeBatchSize > 1 ? ` (batch of ${record.probeBatchSize})` : ""
      }, relevant consumers: ` +
        (record.relevantConsumers && record.relevantConsumers.length > 0
          ? record.relevantConsumers.join(", ")
          : "none"),
    );
  }
  if (record?.probeError) details.push(`probe failed: ${record.probeError}`);
  if (input.status === "optimized" && record?.exitCode !== undefined && record.exitCode !== null) {
    details.push(`host exit code ${record.exitCode}`);
  }

  return `Optimizer: ${input.pack} (${input.source}) -> ${outcome}${details.length > 0 ? ` | ${details.join(" | ")}` : ""}`;
};

export interface OptimizerLaunchMod {
  name: string;
  path: string;
  modDirectory: string;
  sourceKind: "workshop" | "custom" | "data";
  isInModding?: boolean;
}

export interface BuildOptimizerLaunchLogOptions {
  /** Enabled mods in load order. */
  mods: readonly OptimizerLaunchMod[];
  /** Lowercase names present in the game's Data folders. */
  dataPackNames: ReadonlySet<string>;
  /** Comparable custom folders staged whole this launch, and how to compare a directory. */
  stagedDirectories: ReadonlySet<string>;
  comparableDirectory: (directory: string) => string;
  /** The optimizer's per-mod facts, by comparable source path. */
  recordFor: (path: string) => OptimizerModRecord | undefined;
  outcomes: ReadonlyArray<{
    name: string;
    status: "optimized" | "restored" | "skipped" | "failed";
    message?: string;
    placement?: "hard link" | "copy";
    placementReason?: string;
  }>;
  userSkipped: boolean;
}

/** The lines for one launch, in load order. */
export const buildOptimizerLaunchLog = ({
  mods,
  dataPackNames,
  stagedDirectories,
  comparableDirectory,
  recordFor,
  outcomes,
  userSkipped,
}: BuildOptimizerLaunchLogOptions): string[] =>
  mods.map((mod) => {
    const source: OptimizerModSource =
      mod.sourceKind === "custom" ? "custom folder" : mod.sourceKind === "data" ? "data" : "workshop";
    const record = { ...(recordFor(mod.path) ?? {}) };
    if (mod.sourceKind === "data" || mod.isInModding || dataPackNames.has(mod.name.toLowerCase())) {
      record.skipReason = "data-folder";
      return formatOptimizerLogLine({ pack: mod.name, source, record });
    }

    const staged = mod.sourceKind === "workshop" || stagedDirectories.has(comparableDirectory(mod.modDirectory));
    if (!staged) {
      record.skipReason = "not-staged";
      return formatOptimizerLogLine({ pack: mod.name, source, record });
    }

    const outcome = outcomes.find((item) => item.name.toLowerCase() === mod.name.toLowerCase());
    if (!outcome && !record.skipReason && userSkipped) record.skipReason = "user-skipped";
    return formatOptimizerLogLine({
      pack: mod.name,
      source,
      record,
      status: outcome?.status,
      failureMessage: outcome?.message,
      placement: outcome?.placement,
      placementReason: outcome?.placementReason,
      stagedWithFolder: mod.sourceKind === "custom",
    });
  });
