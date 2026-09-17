import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import { app } from "electron";
import * as fs from "fs";
import * as nodePath from "path";

import type { PackHeader, PackedFile } from "./packFileTypes";
import { getVanillaPackPathsInLoadOrder } from "./utility/vanillaPackPaths";

/** Bumped when the on-disk representation changes. Older cache files are disposable and ignored. */
const CACHE_VERSION = 2;
const CACHE_FILE_NAME = "vanilla-pack-files-cache.bin";
const CACHE_COMPRESSION_LEVEL = 1;

export interface VanillaCachedPackedFile {
  name: string;
  file_size: number;
  start_pos: number;
  is_compressed: boolean;
}

interface VanillaCachedPackHeader {
  header: string;
  byteMask: number;
  refFileCount: number;
  pack_file_index_size: number;
  pack_file_count: number;
  header_buffer: string;
}

export interface VanillaPackFilesCacheEntry {
  size: number;
  lastChangedLocal: number;
  /** Expanded index data for current-game vanilla packs. */
  packedFiles?: VanillaCachedPackedFile[];
  packHeader?: VanillaCachedPackHeader;
  dependencyPacks?: string[];
  /** Kept for non-vanilla callers of the manager's old names-only helper. */
  packedFileNames?: string[];
}

export interface VanillaPackFilesCache {
  version: typeof CACHE_VERSION;
  entries: Record<string, VanillaPackFilesCacheEntry>;
}

export interface CachedVanillaPackIndex {
  packedFiles: PackedFile[];
  packHeader: PackHeader;
  dependencyPacks: string[];
}

let vanillaPackFilesCache: VanillaPackFilesCache | null = null;
let cacheLoadPromise: Promise<VanillaPackFilesCache> | undefined;
let cacheWriteTimer: ReturnType<typeof setTimeout> | undefined;
let cacheWritePromise: Promise<void> = Promise.resolve();

const emptyCache = (): VanillaPackFilesCache => ({ version: CACHE_VERSION, entries: {} });

const getCacheFilePath = (): string | undefined => {
  try {
    return nodePath.join(app.getPath("userData"), CACHE_FILE_NAME);
  } catch {
    return undefined;
  }
};

const normalizeCachePath = (packPath: string): string => {
  try {
    return nodePath.resolve(packPath).toLowerCase();
  } catch {
    return packPath.replaceAll("/", "\\").toLowerCase();
  }
};

const findEntry = (
  cache: VanillaPackFilesCache,
  packPath: string,
): [string, VanillaPackFilesCacheEntry] | undefined => {
  const direct = cache.entries[packPath];
  if (direct) return [packPath, direct];

  const normalizedPath = normalizeCachePath(packPath);
  const matchingEntry = Object.entries(cache.entries).find(
    ([cachedPath]) => normalizeCachePath(cachedPath) === normalizedPath,
  );
  return matchingEntry;
};

const isCacheEntry = (value: unknown): value is VanillaPackFilesCacheEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<VanillaPackFilesCacheEntry>;
  const hasExpandedIndex =
    Array.isArray(entry.packedFiles) &&
    !!entry.packHeader &&
    typeof entry.packHeader === "object" &&
    Array.isArray(entry.dependencyPacks);
  const hasNamesOnlyIndex =
    Array.isArray(entry.packedFileNames) && entry.packedFileNames.every((name) => typeof name === "string");
  return (
    typeof entry.size === "number" &&
    typeof entry.lastChangedLocal === "number" &&
    (hasExpandedIndex || hasNamesOnlyIndex)
  );
};

/** Loads the versioned cache. A pre-versioned cache is deliberately treated as empty. */
export const loadVanillaPackFilesCache = async (): Promise<VanillaPackFilesCache> => {
  if (vanillaPackFilesCache) return vanillaPackFilesCache;
  if (cacheLoadPromise) return cacheLoadPromise;

  cacheLoadPromise = (async () => {
    const cacheFilePath = getCacheFilePath();
    if (!cacheFilePath) {
      vanillaPackFilesCache = emptyCache();
      return vanillaPackFilesCache;
    }

    try {
      const compressed = await fs.promises.readFile(cacheFilePath);
      const parsed = JSON.parse((await zstdDecompress(compressed)).toString("utf8")) as Partial<VanillaPackFilesCache>;
      if (parsed.version !== CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object") {
        vanillaPackFilesCache = emptyCache();
        return vanillaPackFilesCache;
      }

      const entries = Object.fromEntries(
        Object.entries(parsed.entries).filter(([, entry]) => isCacheEntry(entry)),
      ) as Record<string, VanillaPackFilesCacheEntry>;
      vanillaPackFilesCache = { version: CACHE_VERSION, entries };
    } catch {
      vanillaPackFilesCache = emptyCache();
    }
    return vanillaPackFilesCache;
  })();

  try {
    return await cacheLoadPromise;
  } finally {
    cacheLoadPromise = undefined;
  }
};

const writeCacheNow = async (): Promise<void> => {
  if (!vanillaPackFilesCache) return;
  const cacheFilePath = getCacheFilePath();
  if (!cacheFilePath) return;

  const temporaryPath = `${cacheFilePath}.building`;
  try {
    await fs.promises.mkdir(nodePath.dirname(cacheFilePath), { recursive: true });
    const json = Buffer.from(JSON.stringify(vanillaPackFilesCache), "utf8");
    const compressed = await zstdCompress(json, CACHE_COMPRESSION_LEVEL);
    await fs.promises.writeFile(temporaryPath, compressed);
    await fs.promises.rename(temporaryPath, cacheFilePath);
  } catch (error) {
    console.error("Failed to save vanilla pack files cache:", error);
    try {
      await fs.promises.rm(temporaryPath, { force: true });
    } catch {
      // The cache is disposable; leave the next write to try again.
    }
  }
};

const queueCacheWrite = (): void => {
  if (cacheWriteTimer) return;
  cacheWriteTimer = setTimeout(() => {
    cacheWriteTimer = undefined;
    cacheWritePromise = cacheWritePromise.then(writeCacheNow);
  }, 100);
};

/** Flushes pending cache updates. Most pack reads use the debounced write path. */
export const saveVanillaPackFilesCache = async (): Promise<void> => {
  if (cacheWriteTimer) {
    clearTimeout(cacheWriteTimer);
    cacheWriteTimer = undefined;
  }
  cacheWritePromise = cacheWritePromise.then(writeCacheNow);
  await cacheWritePromise;
};

/** The host/manager cache is restricted to packs named by the current game manifest. */
export const isCurrentGameVanillaPackPath = (packPath: string): boolean => {
  const normalizedTarget = normalizeCachePath(packPath);
  return getVanillaPackPathsInLoadOrder().some(
    (vanillaPackPath) => normalizeCachePath(vanillaPackPath) === normalizedTarget,
  );
};

const encodeHeader = (packHeader: PackHeader): VanillaCachedPackHeader => ({
  header: packHeader.header.toString("base64"),
  byteMask: packHeader.byteMask,
  refFileCount: packHeader.refFileCount,
  pack_file_index_size: packHeader.pack_file_index_size,
  pack_file_count: packHeader.pack_file_count,
  header_buffer: packHeader.header_buffer.toString("base64"),
});

const decodeHeader = (packHeader: VanillaCachedPackHeader): PackHeader | undefined => {
  if (
    typeof packHeader.header !== "string" ||
    typeof packHeader.header_buffer !== "string" ||
    typeof packHeader.byteMask !== "number" ||
    typeof packHeader.refFileCount !== "number" ||
    typeof packHeader.pack_file_index_size !== "number" ||
    typeof packHeader.pack_file_count !== "number"
  ) {
    return undefined;
  }

  return {
    header: Buffer.from(packHeader.header, "base64"),
    byteMask: packHeader.byteMask,
    refFileCount: packHeader.refFileCount,
    pack_file_index_size: packHeader.pack_file_index_size,
    pack_file_count: packHeader.pack_file_count,
    header_buffer: Buffer.from(packHeader.header_buffer, "base64"),
  };
};

const decodePackedFiles = (packedFiles: VanillaCachedPackedFile[]): PackedFile[] | undefined => {
  if (
    packedFiles.some(
      (packedFile) =>
        !packedFile ||
        typeof packedFile.name !== "string" ||
        typeof packedFile.file_size !== "number" ||
        typeof packedFile.start_pos !== "number" ||
        typeof packedFile.is_compressed !== "boolean",
    )
  ) {
    return undefined;
  }

  return packedFiles.map((packedFile) => ({ ...packedFile }));
};

export const getCachedVanillaPackIndexFromEntry = (
  entry: VanillaPackFilesCacheEntry | undefined,
): CachedVanillaPackIndex | undefined => {
  if (!entry || !isCacheEntry(entry)) return undefined;
  if (!entry.packedFiles || !entry.packHeader || !entry.dependencyPacks) return undefined;
  const packedFiles = decodePackedFiles(entry.packedFiles);
  const packHeader = decodeHeader(entry.packHeader);
  if (!packedFiles || !packHeader) return undefined;
  return {
    packedFiles,
    packHeader,
    dependencyPacks: [...entry.dependencyPacks],
  };
};

export const getVanillaPackFilesCacheEntry = (
  cache: VanillaPackFilesCache,
  packPath: string,
): VanillaPackFilesCacheEntry | undefined => findEntry(cache, packPath)?.[1];

/** Returns a current, expanded entry or undefined for a stale/missing/non-vanilla pack. */
export const getCurrentVanillaPackFilesCacheEntry = async (
  packPath: string,
): Promise<VanillaPackFilesCacheEntry | undefined> => {
  if (!isCurrentGameVanillaPackPath(packPath)) return undefined;

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(packPath);
  } catch {
    return undefined;
  }

  const cache = await loadVanillaPackFilesCache();
  const entry = getVanillaPackFilesCacheEntry(cache, packPath);
  if (!entry || entry.size !== stat.size || entry.lastChangedLocal !== stat.mtimeMs) return undefined;
  return getCachedVanillaPackIndexFromEntry(entry) ? entry : undefined;
};

/** Returns a current names-only entry for callers that also inspect non-vanilla packs. */
export const getCurrentPackFilesCacheEntry = async (
  packPath: string,
): Promise<VanillaPackFilesCacheEntry | undefined> => {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(packPath);
  } catch {
    return undefined;
  }

  const cache = await loadVanillaPackFilesCache();
  const entry = getVanillaPackFilesCacheEntry(cache, packPath);
  if (!entry || entry.size !== stat.size || entry.lastChangedLocal !== stat.mtimeMs || !isCacheEntry(entry))
    return undefined;
  return entry;
};

export const getCurrentVanillaPackIndex = async (packPath: string): Promise<CachedVanillaPackIndex | undefined> => {
  const entry = await getCurrentVanillaPackFilesCacheEntry(packPath);
  return getCachedVanillaPackIndexFromEntry(entry);
};

const createCacheEntry = (
  size: number,
  lastChangedLocal: number,
  packedFiles: readonly PackedFile[],
  packHeader: PackHeader,
  dependencyPacks: readonly string[],
): VanillaPackFilesCacheEntry => ({
  size,
  lastChangedLocal,
  packedFiles: packedFiles.map(({ name, file_size, start_pos, is_compressed }) => ({
    name,
    file_size,
    start_pos,
    is_compressed: is_compressed === true,
  })),
  packHeader: encodeHeader(packHeader),
  dependencyPacks: [...dependencyPacks],
});

/** Records only pack-index data; payload buffers and parsed table fields never enter the cache. */
export const rememberVanillaPackIndex = (
  packPath: string,
  size: number,
  lastChangedLocal: number,
  packedFiles: readonly PackedFile[],
  packHeader: PackHeader,
  dependencyPacks: readonly string[],
): void => {
  if (!isCurrentGameVanillaPackPath(packPath)) return;
  const cacheEntry = createCacheEntry(size, lastChangedLocal, packedFiles, packHeader, dependencyPacks);
  const cacheKey = nodePath.resolve(packPath);

  const apply = (cache: VanillaPackFilesCache): void => {
    cache.entries[cacheKey] = cacheEntry;
    queueCacheWrite();
  };

  if (vanillaPackFilesCache) {
    apply(vanillaPackFilesCache);
    return;
  }

  void loadVanillaPackFilesCache()
    .then(apply)
    .catch((error) => {
      console.error("Failed to update vanilla pack files cache:", error);
    });
};

/** Preserves the manager's old names-only cache behavior for non-vanilla callers. */
export const rememberPackFileNames = (
  packPath: string,
  size: number,
  lastChangedLocal: number,
  packedFileNames: readonly string[],
): void => {
  if (isCurrentGameVanillaPackPath(packPath)) return;
  const cacheEntry: VanillaPackFilesCacheEntry = {
    size,
    lastChangedLocal,
    packedFileNames: [...packedFileNames],
  };
  const cacheKey = nodePath.resolve(packPath);

  const apply = (cache: VanillaPackFilesCache): void => {
    cache.entries[cacheKey] = cacheEntry;
    queueCacheWrite();
  };

  if (vanillaPackFilesCache) {
    apply(vanillaPackFilesCache);
    return;
  }

  void loadVanillaPackFilesCache()
    .then(apply)
    .catch((error) => {
      console.error("Failed to update pack files cache:", error);
    });
};

/** Returns names from the expanded cache for callers that only need a list. */
export const getPackedFileNamesFromCacheEntry = (entry: VanillaPackFilesCacheEntry | undefined): string[] =>
  entry?.packedFiles?.map((packedFile) => packedFile.name) ?? entry?.packedFileNames ?? [];
