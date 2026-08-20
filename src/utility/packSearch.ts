import * as fs from "fs";

/** Bytes pulled from disk per read. Bounds peak memory regardless of how large a pack is. */
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
/**
 * Bytes carried over between windows so a match straddling a chunk boundary is still found. A
 * search whose match runs longer than this could be missed at a boundary, which 64 KiB puts well
 * beyond any realistic pack search.
 */
const DEFAULT_OVERLAP_BYTES = 64 * 1024;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const makeSearchPattern = (searchTerm: string): RegExp => {
  try {
    return new RegExp(searchTerm, "i");
  } catch {
    // Match the literal text when the user entered an invalid regular expression.
    return new RegExp(escapeRegExp(searchTerm), "i");
  }
};

// Pack text appears as either UTF-8 or UTF-16LE, and a pack places its text at whatever offset the
// binary layout happens to produce. Decoding UTF-16LE from one alignment would miss every string
// starting on the other, so both are checked. keepFromWindow holds the window on an even offset so
// that the two views stay continuous from one window to the next.
const windowContains = (window: Buffer, pattern: RegExp) =>
  pattern.test(window.toString("utf8")) ||
  pattern.test(window.toString("utf16le")) ||
  pattern.test(window.subarray(1).toString("utf16le"));

/**
 * Number of trailing bytes to carry into the next window. Chosen so the next window also starts on
 * an even offset, and so a partial multi-byte character at the end of this window is re-decoded
 * there rather than being dropped.
 */
const keepFromWindow = (windowLength: number, overlapBytes: number) => {
  const kept = Math.min(overlapBytes, windowLength);
  return (windowLength - kept) % 2 === 0 ? kept : kept - 1;
};

export type PackSearchOptions = {
  /** Exposed for tests, which use tiny windows to exercise the boundary handling cheaply. */
  chunkBytes?: number;
  overlapBytes?: number;
};

/**
 * Searches the encodings used by pack text without relying on PowerShell, streaming the file so
 * that packs larger than Node's buffer and string limits are searched rather than skipped.
 */
export const packFileContains = async (
  filePath: string,
  searchTerm: string,
  { chunkBytes = DEFAULT_CHUNK_BYTES, overlapBytes = DEFAULT_OVERLAP_BYTES }: PackSearchOptions = {},
): Promise<boolean> => {
  const pattern = makeSearchPattern(searchTerm);
  const stream = fs.createReadStream(filePath, { highWaterMark: chunkBytes });
  let tail: Buffer = Buffer.alloc(0);

  try {
    for await (const chunk of stream) {
      const window = tail.length === 0 ? (chunk as Buffer) : Buffer.concat([tail, chunk as Buffer]);
      if (windowContains(window, pattern)) return true;
      tail = window.subarray(window.length - keepFromWindow(window.length, overlapBytes));
    }
  } finally {
    stream.destroy();
  }

  // An empty file yields no chunks, so match the whole-file behaviour for a pattern matching "".
  return tail.length === 0 && pattern.test("");
};
