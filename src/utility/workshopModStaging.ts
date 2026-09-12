import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";

import {
  analyzeCompressionPacks,
  compressStagedPack,
  type CompressionCodecs,
  type CompressStagedPackResult,
} from "../compressionAnalysis";
import type { VanillaCompressionExtensionRecord } from "../compressionAnalysis/vanillaGuardrail";

export const WORKSHOP_MOD_STAGING_FOLDER = "whmm_copied_mods";
export const WORKSHOP_MOD_STAGING_MANIFEST_FILENAME = ".whmm-staging-manifest.json";
export const WORKSHOP_MOD_STAGING_MANIFEST_VERSION = 1;
export const WORKSHOP_MOD_STAGING_POLICY_ID = "workshop-mod-staging-v2";

export type WorkshopModStagingMode = "disabled" | "copy" | "symlink";

export interface WorkshopStagingMod {
  name: string;
  path: string;
  isEnabled: boolean;
}

export type WorkshopStagingAction = "copy" | "symlink" | "unchanged";

export interface WorkshopStagingFingerprint {
  size: number;
  mtimeMs: number;
}

export type WorkshopStagingCompressionStatus = "compressed" | "noEligibleFiles" | "failed";

export interface WorkshopStagingCompressionResult {
  name: string;
  status: WorkshopStagingCompressionStatus;
  success: boolean;
  compressedFileCount: number;
  originalSize?: number;
  compressedSize?: number;
  warnings: string[];
}

export interface WorkshopStagingCompressionRunnerOptions {
  includeRigidModelV2: boolean;
  codecs?: Partial<CompressionCodecs>;
}

/**
 * Overrides the default analyzer/compressor in focused tests and embedders. The default runner
 * only receives a path inside the manager-owned staging directory, so it cannot mutate a Workshop
 * source file.
 */
export type WorkshopStagingCompressionRunner = (
  packPath: string,
  options: WorkshopStagingCompressionRunnerOptions,
) => Promise<CompressStagedPackResult | WorkshopStagingCompressionResult>;

export interface WorkshopStagingManifestPolicy {
  id: string;
  mode: Exclude<WorkshopModStagingMode, "disabled">;
  compressMods: boolean;
  includeRigidModelV2: boolean;
}

export interface WorkshopStagingManifestEntry {
  name: string;
  sourcePath: string;
  sourceFingerprint: WorkshopStagingFingerprint;
  destinationFingerprint: WorkshopStagingFingerprint;
  /** `true` means the destination was transformed; false means it is a source-identical copy. */
  compressed: boolean;
  /** A stable no-op is cacheable; failures are deliberately not written to the manifest. */
  compressionStatus: "compressed" | "noEligibleFiles" | "notRequested";
}

export interface WorkshopStagingManifest {
  version: number;
  policy: WorkshopStagingManifestPolicy;
  entries: Record<string, WorkshopStagingManifestEntry>;
}

export interface WorkshopStagingPlanEntry {
  name: string;
  sourcePath: string;
  destinationPath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  sourceFingerprint: WorkshopStagingFingerprint;
  action: WorkshopStagingAction;
}

export interface WorkshopStagingPlan {
  destinationPath: string;
  manifestPath: string;
  entries: WorkshopStagingPlanEntry[];
  stagedModNames: string[];
  requiredBytes: number;
  availableBytes: number;
  recreateDestination: boolean;
  mode: Exclude<WorkshopModStagingMode, "disabled">;
  compressMods: boolean;
  includeRigidModelV2: boolean;
  compressionWarnings: string[];
}

export interface WorkshopStagingResult extends WorkshopStagingPlan {
  changedEntries: WorkshopStagingPlanEntry[];
  compressionResults: WorkshopStagingCompressionResult[];
}

export type WorkshopModStagingErrorCode =
  "INSUFFICIENT_SPACE" | "SYMLINK_UNAVAILABLE" | "INVALID_DESTINATION" | "STAGING_FAILED" | "CLEANUP_FAILED";

export class WorkshopModStagingError extends Error {
  readonly code: WorkshopModStagingErrorCode;
  readonly requiredBytes?: number;
  readonly availableBytes?: number;
  readonly destinationPath?: string;

  constructor(
    code: WorkshopModStagingErrorCode,
    message: string,
    details: { requiredBytes?: number; availableBytes?: number; destinationPath?: string } = {},
  ) {
    super(message);
    this.name = "WorkshopModStagingError";
    this.code = code;
    this.requiredBytes = details.requiredBytes;
    this.availableBytes = details.availableBytes;
    this.destinationPath = details.destinationPath;
  }
}

export type GetFreeBytes = (path: string) => Promise<number>;

export interface BuildWorkshopStagingPlanOptions {
  gameFolder: string;
  mode: Exclude<WorkshopModStagingMode, "disabled">;
  workshopMods: WorkshopStagingMod[];
  realDataPackNames?: Iterable<string>;
  getFreeBytes?: GetFreeBytes;
  canCreateSymbolicLinks?: boolean;
  platform?: NodeJS.Platform;
  /** Cleanup-enabled launches rebuild the manager-owned directory instead of reusing cached entries. */
  recreateDestination?: boolean;
  /** Compress copied packs after staging. Ignored for symlink mode. */
  compressMods?: boolean;
  /** Include the conservative `.rigid_model_v2` compression path when compressing. */
  includeRigidModelV2?: boolean;
  /** Optional codec overrides for staging compression tests/embedders. */
  compressionCodecs?: Partial<CompressionCodecs>;
  /** Optional checked-in vanilla guardrail override for staging compression tests/embedders. */
  compressionVanillaCsv?: string;
  /** Optional parsed vanilla guardrail override for staging compression tests/embedders. */
  compressionVanillaRecords?: Map<string, VanillaCompressionExtensionRecord>;
  /** Optional staging compressor override for tests/embedders. */
  compressionRunner?: WorkshopStagingCompressionRunner;
}

export type StageWorkshopModsOptions = BuildWorkshopStagingPlanOptions;

export interface WorkshopStagingWorkingDirectoryMod {
  name: string;
  modDirectory: string;
  isInModding?: boolean;
  isWorkshop: boolean;
}

export interface BuildWorkshopStagingWorkingDirectoryLinesOptions {
  dataFolder: string;
  destinationPath: string;
  stagedModNames: Iterable<string>;
  mods: WorkshopStagingWorkingDirectoryMod[];
  realDataPackNames?: Iterable<string>;
  pathPrefix?: string;
}

const defaultGetFreeBytes: GetFreeBytes = async (path) => {
  const stats = await fs.promises.statfs(path);
  const blockSize = Number(stats.bsize || 1);
  return Number(stats.bavail) * blockSize;
};

const comparableName = (name: string) => name.toLowerCase();

// A copy can round-trip a timestamp with a tiny sub-millisecond difference depending on the
// filesystem. Treat that representation noise as the same mtime while still detecting ordinary edits.
const sameModificationTime = (first: number, second: number) => Math.abs(first - second) < 1;

const comparablePath = (path: string, platform = process.platform) => {
  const resolved = nodePath.resolve(path);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
};

const isSafePackName = (name: string) => nodePath.basename(name) === name && name !== "." && name !== "..";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isFingerprint = (value: unknown): value is WorkshopStagingFingerprint =>
  isRecord(value) && isFiniteNumber(value.size) && value.size >= 0 && isFiniteNumber(value.mtimeMs);

const isManifestEntry = (value: unknown): value is WorkshopStagingManifestEntry =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.sourcePath === "string" &&
  isFingerprint(value.sourceFingerprint) &&
  isFingerprint(value.destinationFingerprint) &&
  typeof value.compressed === "boolean" &&
  (value.compressionStatus === "compressed" ||
    value.compressionStatus === "noEligibleFiles" ||
    value.compressionStatus === "notRequested");

const isManifestPolicy = (value: unknown): value is WorkshopStagingManifestPolicy =>
  isRecord(value) &&
  typeof value.id === "string" &&
  (value.mode === "copy" || value.mode === "symlink") &&
  typeof value.compressMods === "boolean" &&
  typeof value.includeRigidModelV2 === "boolean";

const isManifest = (value: unknown): value is WorkshopStagingManifest => {
  if (!isRecord(value) || value.version !== WORKSHOP_MOD_STAGING_MANIFEST_VERSION || !isManifestPolicy(value.policy)) {
    return false;
  }
  if (!isRecord(value.entries)) return false;
  return Object.values(value.entries).every(isManifestEntry);
};

const fingerprintMatches = (first: WorkshopStagingFingerprint, second: WorkshopStagingFingerprint) =>
  first.size === second.size && sameModificationTime(first.mtimeMs, second.mtimeMs);

const fingerprintForStats = (stats: fs.Stats): WorkshopStagingFingerprint => ({
  size: stats.size,
  mtimeMs: stats.mtimeMs,
});

interface WorkshopStagingManifestRead {
  manifest?: WorkshopStagingManifest;
  present: boolean;
  warning?: string;
}

const manifestPathFor = (destinationPath: string) =>
  nodePath.join(destinationPath, WORKSHOP_MOD_STAGING_MANIFEST_FILENAME);

const readWorkshopStagingManifest = async (manifestPath: string): Promise<WorkshopStagingManifestRead> => {
  let contents: string;
  try {
    contents = await fs.promises.readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { present: false };
    return {
      present: true,
      warning: `Unable to read Workshop staging manifest ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  try {
    const parsed: unknown = JSON.parse(contents);
    if (!isManifest(parsed)) {
      return {
        present: true,
        warning: `Ignoring invalid Workshop staging manifest ${manifestPath}; staged packs will be refreshed.`,
      };
    }
    return { manifest: parsed, present: true };
  } catch (error) {
    return {
      present: true,
      warning: `Ignoring unreadable Workshop staging manifest ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};

const writeWorkshopStagingManifestAtomically = async (
  manifestPath: string,
  manifest: WorkshopStagingManifest,
): Promise<void> => {
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      await fs.promises.rename(temporaryPath, manifestPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      // Windows does not replace an existing file with rename. Remove only the known manifest
      // path, then complete the same-directory rename; the temp file is never exposed as the
      // manifest itself.
      await fs.promises.rm(manifestPath, { force: true });
      await fs.promises.rename(temporaryPath, manifestPath);
    }
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
};

const readDestination = async (destinationPath: string): Promise<fs.Stats | undefined> => {
  try {
    return await fs.promises.lstat(destinationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const hasCorrectSymbolicLinkTarget = async (
  destinationPath: string,
  sourcePath: string,
  stats: fs.Stats,
  platform: NodeJS.Platform,
) => {
  if (!stats.isSymbolicLink()) return false;
  try {
    const target = await fs.promises.readlink(destinationPath);
    return (
      comparablePath(nodePath.resolve(nodePath.dirname(destinationPath), target), platform) ===
      comparablePath(sourcePath, platform)
    );
  } catch {
    return false;
  }
};

const validateDestinationDirectory = async (destinationPath: string) => {
  try {
    const stats = await fs.promises.lstat(destinationPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new WorkshopModStagingError(
        "INVALID_DESTINATION",
        `Workshop staging destination is not a normal directory: ${destinationPath}`,
        { destinationPath },
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof WorkshopModStagingError) throw error;
    throw new WorkshopModStagingError(
      "INVALID_DESTINATION",
      `Unable to inspect workshop staging destination ${destinationPath}: ${error instanceof Error ? error.message : String(error)}`,
      { destinationPath },
    );
  }
};

const getReclaimableBytes = async (destinationPath: string): Promise<number> => {
  let stats: fs.Stats;
  try {
    stats = await fs.promises.lstat(destinationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  if (stats.isSymbolicLink()) return 0;
  if (stats.isFile()) return stats.blocks ? stats.blocks * 512 : stats.size;
  if (!stats.isDirectory()) return 0;

  const entries = await fs.promises.readdir(destinationPath);
  const childSizes = await Promise.all(
    entries.map((entry) => getReclaimableBytes(nodePath.join(destinationPath, entry))),
  );
  return childSizes.reduce((total, size) => total + size, 0);
};

const dedupeWorkshopMods = (mods: WorkshopStagingMod[]) => {
  const seenNames = new Set<string>();
  return mods.filter((mod) => {
    const key = comparableName(mod.name);
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });
};

const manifestEntryFor = (manifest: WorkshopStagingManifest | undefined, name: string) =>
  manifest?.entries[comparableName(name)];

const manifestPolicyMatches = (
  policy: WorkshopStagingManifestPolicy,
  mode: Exclude<WorkshopModStagingMode, "disabled">,
  compressMods: boolean,
  includeRigidModelV2: boolean,
) =>
  policy.id === WORKSHOP_MOD_STAGING_POLICY_ID &&
  policy.mode === mode &&
  policy.compressMods === compressMods &&
  policy.includeRigidModelV2 === includeRigidModelV2;

const manifestEntryCanBeReused = (
  manifestRead: WorkshopStagingManifestRead,
  policy: WorkshopStagingManifestPolicy,
  name: string,
  sourcePath: string,
  sourceFingerprint: WorkshopStagingFingerprint,
  destinationFingerprint: WorkshopStagingFingerprint | undefined,
  platform: NodeJS.Platform,
) => {
  if (
    !manifestRead.manifest ||
    !manifestPolicyMatches(manifestRead.manifest.policy, policy.mode, policy.compressMods, policy.includeRigidModelV2)
  ) {
    return false;
  }
  const entry = manifestEntryFor(manifestRead.manifest, name);
  if (!entry || !destinationFingerprint) return false;
  if (entry.name.toLowerCase() !== name.toLowerCase()) return false;
  if (comparablePath(entry.sourcePath, platform) !== comparablePath(sourcePath, platform)) return false;
  if (!fingerprintMatches(entry.sourceFingerprint, sourceFingerprint)) return false;
  if (!fingerprintMatches(entry.destinationFingerprint, destinationFingerprint)) return false;
  if (policy.compressMods) {
    return entry.compressed ? entry.compressionStatus === "compressed" : entry.compressionStatus === "noEligibleFiles";
  }
  return !entry.compressed && entry.compressionStatus === "notRequested";
};

/**
 * Builds the complete plan without creating the destination folder or changing any staging entry.
 * This separation is what lets callers reject an insufficient disk before any staging mutation.
 */
export const buildWorkshopStagingPlan = async ({
  gameFolder,
  mode,
  workshopMods,
  realDataPackNames = [],
  getFreeBytes = defaultGetFreeBytes,
  canCreateSymbolicLinks = true,
  platform = process.platform,
  recreateDestination = false,
  compressMods = false,
  includeRigidModelV2 = false,
}: BuildWorkshopStagingPlanOptions): Promise<WorkshopStagingPlan> => {
  const destinationPath = nodePath.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER);
  const manifestPath = manifestPathFor(destinationPath);
  const compressionEnabled = mode === "copy" && compressMods;
  const effectiveIncludeRigidModelV2 = compressionEnabled && includeRigidModelV2;
  const policy: WorkshopStagingManifestPolicy = {
    id: WORKSHOP_MOD_STAGING_POLICY_ID,
    mode,
    compressMods: compressionEnabled,
    includeRigidModelV2: effectiveIncludeRigidModelV2,
  };
  const compressionWarnings: string[] = [];
  if (compressMods && mode !== "copy") {
    compressionWarnings.push('Workshop mod compression is only available with "copy mod files" staging.');
  }
  if (mode === "symlink" && platform === "win32" && !canCreateSymbolicLinks) {
    throw new WorkshopModStagingError(
      "SYMLINK_UNAVAILABLE",
      "Symbolic-link staging is unavailable. Run the manager as administrator or enable Windows Developer Mode.",
      { destinationPath },
    );
  }

  const selectedDataNames = new Set([...realDataPackNames].map(comparableName));
  const selectedMods = dedupeWorkshopMods(
    workshopMods.filter((mod) => mod.isEnabled && !selectedDataNames.has(comparableName(mod.name))),
  );
  await validateDestinationDirectory(destinationPath);

  const manifestRead: WorkshopStagingManifestRead =
    mode === "copy" ? await readWorkshopStagingManifest(manifestPath) : { present: false };
  if (manifestRead.warning) compressionWarnings.push(manifestRead.warning);

  const entries: WorkshopStagingPlanEntry[] = [];
  for (const mod of selectedMods) {
    if (!isSafePackName(mod.name)) {
      throw new WorkshopModStagingError("STAGING_FAILED", `Invalid Workshop pack name: ${mod.name}`, {
        destinationPath,
      });
    }

    const sourceStats = await fs.promises.stat(mod.path);
    if (!sourceStats.isFile()) {
      throw new WorkshopModStagingError("STAGING_FAILED", `Workshop mod is not a file: ${mod.path}`, {
        destinationPath,
      });
    }

    const destinationPackPath = nodePath.join(destinationPath, mod.name);
    const destinationStats = recreateDestination ? undefined : await readDestination(destinationPackPath);
    const sourceFingerprint = fingerprintForStats(sourceStats);
    let action: WorkshopStagingAction = "copy";

    if (mode === "symlink") {
      action =
        destinationStats &&
        (await hasCorrectSymbolicLinkTarget(destinationPackPath, mod.path, destinationStats, platform))
          ? "unchanged"
          : "symlink";
    } else if (destinationStats && !destinationStats.isSymbolicLink() && destinationStats.isFile()) {
      const destinationFingerprint = fingerprintForStats(destinationStats);
      if (manifestRead.present) {
        if (
          manifestEntryCanBeReused(
            manifestRead,
            policy,
            mod.name,
            mod.path,
            sourceFingerprint,
            destinationFingerprint,
            platform,
          )
        ) {
          action = "unchanged";
        }
      } else if (!compressionEnabled && fingerprintMatches(sourceFingerprint, destinationFingerprint)) {
        // Legacy staging folders did not have a manifest. A stat match is safe for the original
        // uncompressed copy mode and the first successful run will migrate it to the manifest.
        action = "unchanged";
      }
    }

    entries.push({
      name: mod.name,
      sourcePath: mod.path,
      destinationPath: destinationPackPath,
      sourceSize: sourceStats.size,
      sourceMtimeMs: sourceStats.mtimeMs,
      sourceFingerprint,
      action,
    });
  }

  const requiredBytes = entries.reduce((total, entry) => total + (entry.action === "copy" ? entry.sourceSize : 0), 0);
  const availableBytes =
    (await getFreeBytes(gameFolder)) + (recreateDestination ? await getReclaimableBytes(destinationPath) : 0);

  return {
    destinationPath,
    manifestPath,
    entries,
    stagedModNames: entries.map((entry) => entry.name),
    requiredBytes,
    availableBytes,
    recreateDestination,
    mode,
    compressMods: compressionEnabled,
    includeRigidModelV2: effectiveIncludeRigidModelV2,
    compressionWarnings,
  };
};

/** Builds the game-script working-directory lines without exposing the staging folder to mod scans. */
export const buildWorkshopStagingWorkingDirectoryLines = ({
  dataFolder,
  destinationPath,
  stagedModNames,
  mods,
  realDataPackNames = [],
  pathPrefix = "",
}: BuildWorkshopStagingWorkingDirectoryLinesOptions) => {
  const stagedNames = new Set([...stagedModNames].map(comparableName));
  const dataNames = new Set([...realDataPackNames].map(comparableName));
  const workingDirectories = new Set<string>();

  if (stagedNames.size > 0) workingDirectories.add(`${pathPrefix}${destinationPath}`);

  for (const mod of mods) {
    const name = comparableName(mod.name);
    if (mod.isInModding) continue;
    if (mod.isWorkshop && (stagedNames.has(name) || dataNames.has(name))) continue;
    if (nodePath.relative(dataFolder, mod.modDirectory) === "") continue;
    workingDirectories.add(`${pathPrefix}${mod.modDirectory}`);
  }

  return [...workingDirectories].map((directory) => `add_working_directory "${directory}";`);
};

const removeDestination = async (destinationPath: string) => {
  await fs.promises.rm(destinationPath, { recursive: true, force: true });
};

const copyFileAtomically = async (entry: WorkshopStagingPlanEntry) => {
  const temporaryPath = nodePath.join(
    nodePath.dirname(entry.destinationPath),
    `.${nodePath.basename(entry.destinationPath)}.${randomUUID()}.tmp`,
  );
  try {
    await fs.promises.copyFile(entry.sourcePath, temporaryPath);
    // Pass fractional seconds rather than Date objects so filesystems that expose sub-millisecond
    // mtimes can round-trip the source timestamp and be recognized as unchanged next launch.
    const sourceMtime = entry.sourceMtimeMs / 1000;
    await fs.promises.utimes(temporaryPath, sourceMtime, sourceMtime);

    try {
      // On POSIX this replaces the old entry atomically. Windows rejects the rename when the old
      // entry exists, in which case the fallback below still avoids exposing a partial copy.
      await fs.promises.rename(temporaryPath, entry.destinationPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY" && code !== "EISDIR" && code !== "ENOTDIR") {
        throw error;
      }
      await removeDestination(entry.destinationPath);
      await fs.promises.rename(temporaryPath, entry.destinationPath);
    }
    await fs.promises.utimes(entry.destinationPath, sourceMtime, sourceMtime);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
};

const uniqueWarnings = (warnings: Iterable<string>) => {
  const seen = new Set<string>();
  return [...warnings].filter((warning) => {
    if (seen.has(warning)) return false;
    seen.add(warning);
    return true;
  });
};

const defaultWorkshopStagingCompressionRunner = async (
  packPath: string,
  options: WorkshopStagingCompressionRunnerOptions & {
    vanillaCsv?: string;
    vanillaRecords?: Map<string, VanillaCompressionExtensionRecord>;
  },
): Promise<WorkshopStagingCompressionResult> => {
  let analysisResult;
  try {
    analysisResult = await analyzeCompressionPacks([packPath], {
      codecs: options.codecs,
      vanillaCsv: options.vanillaCsv,
      vanillaRecords: options.vanillaRecords,
    });
  } catch (error) {
    return {
      name: nodePath.basename(packPath),
      status: "failed",
      success: false,
      compressedFileCount: 0,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }

  const analysis = analysisResult.packs[0];
  if (!analysis) {
    return {
      name: nodePath.basename(packPath),
      status: "failed",
      success: false,
      compressedFileCount: 0,
      warnings: [analysisResult.error || "The staged pack could not be analyzed."],
    };
  }

  const hasEligibleFile = analysis.fileResults.some(
    (file) =>
      file.status === "accepted" && !!file.selectedCodec && (options.includeRigidModelV2 || !file.isRigidModelV2),
  );
  if (analysis.errorCount > 0 && !hasEligibleFile) {
    const firstFileError = analysis.fileResults.find((file) => file.error)?.error;
    return {
      name: nodePath.basename(packPath),
      status: "failed",
      success: false,
      compressedFileCount: 0,
      warnings: [analysis.errors[0] || firstFileError || "All eligible file compression checks failed."],
    };
  }

  const result = await compressStagedPack(packPath, analysis, {
    includeRigidModelV2: options.includeRigidModelV2,
    codecs: options.codecs,
  });
  return {
    name: nodePath.basename(packPath),
    status: result.status,
    success: result.success,
    compressedFileCount: result.compressedFileCount,
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    warnings:
      result.status === "failed" ? [result.error || analysis.errors[0] || "Staged pack compression failed."] : [],
  };
};

const normalizeCompressionResult = (
  name: string,
  result: CompressStagedPackResult | WorkshopStagingCompressionResult,
): WorkshopStagingCompressionResult => {
  const warnings = "warnings" in result && Array.isArray(result.warnings) ? result.warnings : [];
  const status: WorkshopStagingCompressionStatus =
    result.success && (result.status === "compressed" || result.status === "noEligibleFiles")
      ? result.status
      : "failed";
  const error = "error" in result ? result.error : undefined;
  return {
    name,
    status,
    success: status !== "failed" && result.success,
    compressedFileCount: result.compressedFileCount || 0,
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    warnings: status === "failed" ? uniqueWarnings([...warnings, ...(error ? [error] : [])]) : [],
  };
};

interface WorkshopStagingExecutionResult {
  compressionResults: WorkshopStagingCompressionResult[];
  compressionWarnings: string[];
  compressionByName: Map<string, WorkshopStagingCompressionResult>;
}

const ensureRegularDestinationAfterCompressionFailure = async (entry: WorkshopStagingPlanEntry) => {
  try {
    const stats = await fs.promises.lstat(entry.destinationPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("the destination is no longer a regular file");
    }
  } catch (error) {
    throw new WorkshopModStagingError(
      "STAGING_FAILED",
      `Compression failed for ${entry.name}, and its staged destination could not be preserved: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { destinationPath: entry.destinationPath },
    );
  }
};

const executeWorkshopStagingPlan = async (
  plan: WorkshopStagingPlan,
  options: StageWorkshopModsOptions,
): Promise<WorkshopStagingExecutionResult> => {
  const compressionResults: WorkshopStagingCompressionResult[] = [];
  const compressionWarnings = [...plan.compressionWarnings];
  const compressionByName = new Map<string, WorkshopStagingCompressionResult>();
  if (plan.recreateDestination) await removeDestination(plan.destinationPath);
  if (plan.entries.length === 0) return { compressionResults, compressionWarnings, compressionByName };
  await fs.promises.mkdir(plan.destinationPath, { recursive: true });
  for (const entry of plan.entries) {
    if (entry.action === "unchanged") continue;
    if (entry.action === "copy") {
      await copyFileAtomically(entry);
      if (plan.compressMods) {
        let compressionResult: WorkshopStagingCompressionResult;
        try {
          const rawResult = options.compressionRunner
            ? await options.compressionRunner(entry.destinationPath, {
                includeRigidModelV2: plan.includeRigidModelV2,
                codecs: options.compressionCodecs,
              })
            : await defaultWorkshopStagingCompressionRunner(entry.destinationPath, {
                includeRigidModelV2: plan.includeRigidModelV2,
                codecs: options.compressionCodecs,
                vanillaCsv: options.compressionVanillaCsv,
                vanillaRecords: options.compressionVanillaRecords,
              });
          compressionResult = normalizeCompressionResult(entry.name, rawResult);
        } catch (error) {
          compressionResult = {
            name: entry.name,
            status: "failed",
            success: false,
            compressedFileCount: 0,
            warnings: [error instanceof Error ? error.message : String(error)],
          };
        }
        compressionResults.push(compressionResult);
        compressionByName.set(comparableName(entry.name), compressionResult);
        compressionWarnings.push(...compressionResult.warnings.map((warning) => `${entry.name}: ${warning}`));
        if (compressionResult.status === "failed") {
          // A failed compressor is retryable, but only when its rollback guarantees that the
          // freshly copied uncompressed destination still exists.
          await ensureRegularDestinationAfterCompressionFailure(entry);
        }
      }
      continue;
    }

    await removeDestination(entry.destinationPath);
    await fs.promises.symlink(nodePath.resolve(entry.sourcePath), entry.destinationPath, "file");
  }
  return { compressionResults, compressionWarnings: uniqueWarnings(compressionWarnings), compressionByName };
};

const writePlanManifest = async (
  plan: WorkshopStagingPlan,
  execution: WorkshopStagingExecutionResult,
): Promise<string[]> => {
  if (plan.mode !== "copy" || plan.entries.length === 0) return [];

  const warnings: string[] = [];
  const previous = await readWorkshopStagingManifest(plan.manifestPath);
  if (previous.warning) warnings.push(previous.warning);
  const policy: WorkshopStagingManifestPolicy = {
    id: WORKSHOP_MOD_STAGING_POLICY_ID,
    mode: plan.mode,
    compressMods: plan.compressMods,
    includeRigidModelV2: plan.includeRigidModelV2,
  };
  const entries: Record<string, WorkshopStagingManifestEntry> = {};

  for (const entry of plan.entries) {
    let destinationStats: fs.Stats;
    try {
      destinationStats = await fs.promises.lstat(entry.destinationPath);
    } catch (error) {
      warnings.push(
        `Unable to record Workshop staging cache for ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (destinationStats.isSymbolicLink() || !destinationStats.isFile()) {
      warnings.push(`Unable to record Workshop staging cache for ${entry.name}: destination is not a regular file.`);
      continue;
    }

    const compressionResult = execution.compressionByName.get(comparableName(entry.name));
    let compressionStatus: WorkshopStagingManifestEntry["compressionStatus"];
    if (plan.compressMods) {
      if (compressionResult?.status === "compressed") compressionStatus = "compressed";
      else if (compressionResult?.status === "noEligibleFiles") compressionStatus = "noEligibleFiles";
      else {
        const previousEntry = manifestEntryFor(previous.manifest, entry.name);
        if (entry.action === "unchanged" && previousEntry && previousEntry.compressed) {
          compressionStatus = "compressed";
        } else if (entry.action === "unchanged" && previousEntry) {
          compressionStatus = previousEntry.compressionStatus;
        } else {
          // A failed compression is intentionally absent from the new manifest. The next launch
          // will copy and retry rather than accepting an uncompressed result as a cache hit.
          continue;
        }
      }
    } else {
      compressionStatus = "notRequested";
    }

    entries[comparableName(entry.name)] = {
      name: entry.name,
      sourcePath: entry.sourcePath,
      sourceFingerprint: entry.sourceFingerprint,
      destinationFingerprint: fingerprintForStats(destinationStats),
      compressed: compressionStatus === "compressed",
      compressionStatus,
    };
  }

  const manifest: WorkshopStagingManifest = {
    version: WORKSHOP_MOD_STAGING_MANIFEST_VERSION,
    policy,
    entries,
  };
  try {
    await fs.promises.mkdir(plan.destinationPath, { recursive: true });
    await writeWorkshopStagingManifestAtomically(plan.manifestPath, manifest);
  } catch (error) {
    warnings.push(
      `Unable to persist Workshop staging manifest ${plan.manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return uniqueWarnings(warnings);
};

export const stageWorkshopMods = async (options: StageWorkshopModsOptions): Promise<WorkshopStagingResult> => {
  let plan: WorkshopStagingPlan;
  try {
    plan = await buildWorkshopStagingPlan(options);
  } catch (error) {
    if (error instanceof WorkshopModStagingError) throw error;
    const destinationPath = nodePath.join(options.gameFolder, WORKSHOP_MOD_STAGING_FOLDER);
    throw new WorkshopModStagingError(
      "STAGING_FAILED",
      `Failed to prepare Workshop mod staging in ${destinationPath}: ${error instanceof Error ? error.message : String(error)}`,
      { destinationPath },
    );
  }
  if (plan.requiredBytes > plan.availableBytes) {
    throw new WorkshopModStagingError(
      "INSUFFICIENT_SPACE",
      `Not enough free space for Workshop mod staging: ${plan.requiredBytes} bytes required, ${plan.availableBytes} bytes available.`,
      {
        requiredBytes: plan.requiredBytes,
        availableBytes: plan.availableBytes,
        destinationPath: plan.destinationPath,
      },
    );
  }

  let execution: WorkshopStagingExecutionResult = {
    compressionResults: [],
    compressionWarnings: [...plan.compressionWarnings],
    compressionByName: new Map(),
  };
  try {
    if (plan.entries.length > 0 || plan.recreateDestination) {
      execution = await executeWorkshopStagingPlan(plan, options);
      execution.compressionWarnings.push(...(await writePlanManifest(plan, execution)));
      execution.compressionWarnings = uniqueWarnings(execution.compressionWarnings);
    }
  } catch (error) {
    if (plan.recreateDestination) await removeDestination(plan.destinationPath).catch(() => undefined);
    if (error instanceof WorkshopModStagingError) throw error;
    throw new WorkshopModStagingError(
      "STAGING_FAILED",
      `Failed to stage Workshop mods in ${plan.destinationPath}: ${error instanceof Error ? error.message : String(error)}`,
      { destinationPath: plan.destinationPath },
    );
  }

  return {
    ...plan,
    changedEntries: plan.entries.filter((entry) => entry.action !== "unchanged"),
    compressionResults: execution.compressionResults,
    compressionWarnings: execution.compressionWarnings,
  };
};

export const cleanupWorkshopModStaging = async (gameFolder: string): Promise<boolean> => {
  const destinationPath = nodePath.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER);
  try {
    const stats = await fs.promises.lstat(destinationPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new WorkshopModStagingError(
        "CLEANUP_FAILED",
        `Refusing to remove a non-directory Workshop staging destination: ${destinationPath}`,
        { destinationPath },
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    if (error instanceof WorkshopModStagingError) throw error;
    throw new WorkshopModStagingError(
      "CLEANUP_FAILED",
      `Unable to inspect Workshop staging destination ${destinationPath}: ${error instanceof Error ? error.message : String(error)}`,
      { destinationPath },
    );
  }

  try {
    await fs.promises.rm(destinationPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    throw new WorkshopModStagingError(
      "CLEANUP_FAILED",
      `Unable to clean Workshop staging destination ${destinationPath}: ${error instanceof Error ? error.message : String(error)}`,
      { destinationPath },
    );
  }
};
