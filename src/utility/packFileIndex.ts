/**
 * PFH5 packs with the 0x40 index bit store a four-byte filename hash before the compression flag.
 * The hash is metadata only; the game still stores the readable, null-terminated filename after it.
 */
export const PACK_FILE_INDEX_FILENAME_HASH_MASK = 0x40;

export const hasPackedFileNameHash = (byteMask: number): boolean =>
  (byteMask & PACK_FILE_INDEX_FILENAME_HASH_MASK) !== 0;

export interface PackedFileIndexEntry {
  name: string;
  file_size: number;
  is_compressed: boolean;
  nextPosition: number;
}

/**
 * Reads one packed-file index entry. PFH5 entries are:
 *
 *   file size, optional filename hash, optional compression flag, null-terminated filename
 *
 * Returning undefined keeps the lightweight header scan's existing malformed-index behavior.
 */
export const readPackedFileIndexEntry = (
  packedFileIndex: Buffer,
  position: number,
  hasCompressionFlag: boolean,
  hasFileNameHash: boolean,
): PackedFileIndexEntry | undefined => {
  let nextPosition = position;
  if (nextPosition + 4 > packedFileIndex.length) return undefined;

  const file_size = packedFileIndex.readInt32LE(nextPosition);
  nextPosition += 4;

  if (hasFileNameHash) {
    if (nextPosition + 4 > packedFileIndex.length) return undefined;
    nextPosition += 4;
  }

  let is_compressed = false;
  if (hasCompressionFlag) {
    if (nextPosition + 1 > packedFileIndex.length) return undefined;
    is_compressed = packedFileIndex[nextPosition] === 1;
    nextPosition += 1;
  }

  const nameEnd = packedFileIndex.indexOf(0, nextPosition);
  if (nameEnd === -1) return undefined;

  const name = packedFileIndex.toString("utf8", nextPosition, nameEnd);
  return { name, file_size, is_compressed, nextPosition: nameEnd + 1 };
};
