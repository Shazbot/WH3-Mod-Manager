import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";

export const WORKSHOP_MOD_STAGING_FOLDER = "whmm_copied_mods";

export type WorkshopModStagingMode = "disabled" | "copy" | "symlink";

export interface WorkshopStagingMod {
  name: string;
  path: string;
  isEnabled: boolean;
}

export type WorkshopStagingAction = "copy" | "symlink" | "unchanged";

export interface WorkshopStagingPlanEntry {
  name: string;
  sourcePath: string;
  destinationPath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  action: WorkshopStagingAction;
}

export interface WorkshopStagingPlan {
  destinationPath: string;
  entries: WorkshopStagingPlanEntry[];
  stagedModNames: string[];
  requiredBytes: number;
  availableBytes: number;
  recreateDestination: boolean;
}

export interface WorkshopStagingResult extends WorkshopStagingPlan {
  changedEntries: WorkshopStagingPlanEntry[];
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
}: BuildWorkshopStagingPlanOptions): Promise<WorkshopStagingPlan> => {
  const destinationPath = nodePath.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER);
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
    let action: WorkshopStagingAction = "copy";

    if (mode === "symlink") {
      action =
        destinationStats &&
        (await hasCorrectSymbolicLinkTarget(destinationPackPath, mod.path, destinationStats, platform))
          ? "unchanged"
          : "symlink";
    } else if (
      destinationStats &&
      !destinationStats.isSymbolicLink() &&
      destinationStats.isFile() &&
      destinationStats.size === sourceStats.size &&
      sameModificationTime(destinationStats.mtimeMs, sourceStats.mtimeMs)
    ) {
      action = "unchanged";
    }

    entries.push({
      name: mod.name,
      sourcePath: mod.path,
      destinationPath: destinationPackPath,
      sourceSize: sourceStats.size,
      sourceMtimeMs: sourceStats.mtimeMs,
      action,
    });
  }

  const requiredBytes = entries.reduce((total, entry) => total + (entry.action === "copy" ? entry.sourceSize : 0), 0);
  const availableBytes =
    (await getFreeBytes(gameFolder)) + (recreateDestination ? await getReclaimableBytes(destinationPath) : 0);

  return {
    destinationPath,
    entries,
    stagedModNames: entries.map((entry) => entry.name),
    requiredBytes,
    availableBytes,
    recreateDestination,
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

const executeWorkshopStagingPlan = async (plan: WorkshopStagingPlan) => {
  if (plan.recreateDestination) await removeDestination(plan.destinationPath);
  if (plan.entries.length === 0) return;
  await fs.promises.mkdir(plan.destinationPath, { recursive: true });
  for (const entry of plan.entries) {
    if (entry.action === "unchanged") continue;
    if (entry.action === "copy") {
      await copyFileAtomically(entry);
      continue;
    }

    await removeDestination(entry.destinationPath);
    await fs.promises.symlink(nodePath.resolve(entry.sourcePath), entry.destinationPath, "file");
  }
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

  try {
    if (plan.entries.length > 0 || plan.recreateDestination) await executeWorkshopStagingPlan(plan);
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
