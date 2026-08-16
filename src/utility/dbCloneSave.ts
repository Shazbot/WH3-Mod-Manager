import { randomUUID } from "crypto";
import * as fsExtra from "fs-extra";

export const describeDBCloneSaveError = (error: unknown, targetPath?: string) => {
  const errno = error as NodeJS.ErrnoException;
  if (errno?.code === "ENOSPC") {
    return `Not enough free disk space to write${targetPath ? ` ${targetPath}` : " the DB Clone pack"}. Free some space and try again.`;
  }
  return `DB duplication failed: ${error instanceof Error ? error.message : String(error)}`;
};

/** Writes outside the watched `.pack` path, then publishes the completed file in one move. */
export const writeDBClonePackAtomically = async (
  targetPath: string,
  writeTemporaryPack: (temporaryPath: string) => Promise<void>,
) => {
  const temporaryPath = `${targetPath}.dbclone-${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeTemporaryPack(temporaryPath);
    await fsExtra.move(temporaryPath, targetPath, { overwrite: true });
  } catch (error) {
    await fsExtra.remove(temporaryPath).catch(() => undefined);
    throw error;
  }
};
