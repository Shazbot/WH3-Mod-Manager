import * as crypto from "crypto";
import * as fs from "fs";

export interface PublishCacheFilesRequest {
  cachePath: string;
  cacheBytes: Uint8Array;
  stampPath?: string;
  stampBytes?: Uint8Array;
  /** Runs after staging and immediately before synchronous publication. */
  shouldPublish?: () => boolean;
}

/** Stages each publisher's files privately, then renames them without yielding between publications. */
export const publishCacheFiles = async ({
  cachePath,
  cacheBytes,
  stampPath,
  stampBytes,
  shouldPublish,
}: PublishCacheFilesRequest): Promise<boolean> => {
  if ((stampPath === undefined) !== (stampBytes === undefined)) {
    throw new Error("Cache stamp path and bytes must be provided together");
  }

  const publicationId = crypto.randomUUID();
  const temporaryCachePath = `${cachePath}.${publicationId}.building`;
  const temporaryStampPath = stampPath === undefined ? undefined : `${stampPath}.${publicationId}.building`;
  try {
    await fs.promises.writeFile(temporaryCachePath, cacheBytes);
    if (temporaryStampPath && stampBytes) await fs.promises.writeFile(temporaryStampPath, stampBytes);
    if (shouldPublish && !shouldPublish()) return false;

    // Keep the cache and its optional stamp in one synchronous turn. A cancellation or another
    // publisher cannot interleave between the guard and these renames.
    fs.renameSync(temporaryCachePath, cachePath);
    if (temporaryStampPath && stampPath) fs.renameSync(temporaryStampPath, stampPath);
    return true;
  } finally {
    // UUID paths are owned by this publisher; never remove another build's staging files.
    try {
      fs.rmSync(temporaryCachePath, { force: true });
    } catch {
      // Leave a stale private temp file rather than hiding the original publication error.
    }
    if (temporaryStampPath) {
      try {
        fs.rmSync(temporaryStampPath, { force: true });
      } catch {
        // Leave a stale private temp file rather than hiding the original publication error.
      }
    }
  }
};
