import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";

/**
 * Matches the level the other caches under userData are written at - these are read far more often
 * than they are written, and level 1 is already within a few percent of the size of higher levels on
 * JSON.
 */
const CACHE_COMPRESSION_LEVEL = 1;

/**
 * Reads a zstd-compressed JSON cache, or undefined if it is missing, unreadable or corrupt.
 *
 * A cache that cannot be read is never an error worth surfacing: every caller has a way to recompute
 * what it holds, which is the whole point of it being a cache.
 */
export const readJsonDiskCache = async <T>(cacheFilePath: string): Promise<T | undefined> => {
  try {
    const compressed = await fs.promises.readFile(cacheFilePath);
    const json = await zstdDecompress(compressed);
    return JSON.parse(json.toString("utf8")) as T;
  } catch {
    return undefined;
  }
};

/** Writes a zstd-compressed JSON cache. Failure is logged, never thrown - see above. */
export const writeJsonDiskCache = async (cacheFilePath: string, value: unknown): Promise<void> => {
  try {
    const json = Buffer.from(JSON.stringify(value), "utf8");
    const compressed = await zstdCompress(json, CACHE_COMPRESSION_LEVEL);
    await fs.promises.writeFile(cacheFilePath, compressed);
  } catch (err) {
    console.error(`Failed to write cache ${cacheFilePath}:`, err);
  }
};
