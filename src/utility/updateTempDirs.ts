import { promises as fsPromises } from "fs";
import nodePath from "path";

export const UPDATE_TEMP_DIR_PREFIX = "wh3mm-update-";

const updateTempDirPattern = new RegExp(`^${UPDATE_TEMP_DIR_PREFIX}(\\d+)$`);

/** The staging area one update attempt owns: the downloaded archive, its contents and the helper scripts. */
export const buildUpdateTempDirPath = (tempRoot: string, processId: number) =>
  nodePath.join(tempRoot, `${UPDATE_TEMP_DIR_PREFIX}${processId}`);

export interface RemoveStaleUpdateTempDirsResult {
  removed: string[];
  failed: { path: string; error: Error }[];
}

/**
 * Removes the staging areas left behind by earlier updates - each one holds the release archive plus
 * its extracted copy, so they run to hundreds of megabytes apiece.
 *
 * The helper cannot do this itself: cmd keeps the .cmd it is running open for the whole update, so
 * the directory is still locked when the last line of the script executes. Running it at startup
 * instead means the update that produced the directory has finished by definition. Anything that is
 * somehow still in use is left for the next launch rather than reported as an error.
 */
export const removeStaleUpdateTempDirs = async (
  tempRoot: string,
  currentProcessId: number,
): Promise<RemoveStaleUpdateTempDirsResult> => {
  const result: RemoveStaleUpdateTempDirsResult = { removed: [], failed: [] };

  let entries;
  try {
    entries = await fsPromises.readdir(tempRoot, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = updateTempDirPattern.exec(entry.name);
    if (!match) continue;
    // The directory this run would use for an update of its own, which the update flow recreates.
    if (Number(match[1]) === currentProcessId) continue;

    const staleDirPath = nodePath.join(tempRoot, entry.name);
    try {
      await fsPromises.rm(staleDirPath, { recursive: true, force: true });
      result.removed.push(staleDirPath);
    } catch (error) {
      result.failed.push({ path: staleDirPath, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  return result;
};
