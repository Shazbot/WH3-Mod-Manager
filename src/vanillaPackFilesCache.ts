import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import { app } from "electron";
import * as fs from "fs";
import * as nodePath from "path";

import type { PackHeader, PackedFile } from "./packFileTypes";
import {
  decodeVanillaPackFilesCache,
  encodeVanillaPackFilesCache,
  inspectVanillaPackFilesCache,
  VANILLA_PACK_FILES_CACHE_VERSION,
  type CachedVanillaPackIndex,
  type VanillaCachedPackHeader,
  type VanillaCachedPackedFile,
  type VanillaPackFilesCache,
  type VanillaPackFilesCacheEntry,
  type VanillaPackFilesCacheMetadataEntry,
} from "./vanillaPackFilesCacheFormat";
import { getVanillaPackPathsInLoadOrder } from "./utility/vanillaPackPaths";

export type {
  CachedVanillaPackIndex,
  VanillaCachedPackedFile,
  VanillaPackFilesCache,
  VanillaPackFilesCacheEntry,
} from "./vanillaPackFilesCacheFormat";

/** Bumped when the on-disk representation changes. Older cache files are disposable and ignored. */
const CACHE_VERSION = VANILLA_PACK_FILES_CACHE_VERSION;
const CACHE_FILE_NAME = "vanilla-pack-files-cache.bin";
const CACHE_COMPRESSION_LEVEL = 1;

let vanillaPackFilesCache: VanillaPackFilesCache | null = null;
let vanillaPackFilesCacheMetadata: Map<string, VanillaPackFilesCacheMetadataEntry> | null = null;
let cacheLoadPromise: Promise<VanillaPackFilesCache> | undefined;
let cacheMetadataLoadPromise: Promise<Map<string, VanillaPackFilesCacheMetadataEntry>> | undefined;
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

/** The path is passed to the out-of-process asset host so it can share this cache. */
export const getVanillaPackFilesCachePath = (): string | undefined => getCacheFilePath();

const normalizeCachePath = (packPath: string): string => {
  try {
    return nodePath.resolve(packPath).toLowerCase();
  } catch {
    return packPath.replaceAll("/", "\\").toLowerCase();
  }
};

const metadataFromCache = (cache: VanillaPackFilesCache): Map<string, VanillaPackFilesCacheMetadataEntry> =>
  new Map(
    Object.entries(cache.entries).map(([packPath, entry]) => [
      normalizeCachePath(packPath),
      {
        size: entry.size,
        lastChangedLocal: entry.lastChangedLocal,
        hasExpandedIndex:
          Array.isArray(entry.packedFiles) && !!entry.packHeader && Array.isArray(entry.dependencyPacks),
      },
    ]),
  );

const loadVanillaPackFilesCacheMetadata = async (): Promise<Map<string, VanillaPackFilesCacheMetadataEntry>> => {
  if (vanillaPackFilesCache) {
    vanillaPackFilesCacheMetadata ??= metadataFromCache(vanillaPackFilesCache);
    return vanillaPackFilesCacheMetadata;
  }
  if (vanillaPackFilesCacheMetadata) return vanillaPackFilesCacheMetadata;
  if (cacheMetadataLoadPromise) return cacheMetadataLoadPromise;

  cacheMetadataLoadPromise = (async () => {
    const cacheFilePath = getCacheFilePath();
    if (!cacheFilePath) return new Map<string, VanillaPackFilesCacheMetadataEntry>();

    try {
      const compressed = await fs.promises.readFile(cacheFilePath);
      const decompressed = Buffer.from(await zstdDecompress(compressed));
      const inspected = inspectVanillaPackFilesCache(decompressed);
      if (!inspected) return new Map<string, VanillaPackFilesCacheMetadataEntry>();

      return new Map([...inspected.entries()].map(([packPath, metadata]) => [normalizeCachePath(packPath), metadata]));
    } catch {
      return new Map<string, VanillaPackFilesCacheMetadataEntry>();
    }
  })();

  try {
    vanillaPackFilesCacheMetadata = await cacheMetadataLoadPromise;
    return vanillaPackFilesCacheMetadata;
  } finally {
    cacheMetadataLoadPromise = undefined;
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
      const decompressed = Buffer.from(await zstdDecompress(compressed));
      const parsed = decodeVanillaPackFilesCache(decompressed);
      if (!parsed) {
        vanillaPackFilesCache = emptyCache();
        return vanillaPackFilesCache;
      }

      const entries = Object.fromEntries(
        Object.entries(parsed.entries).filter(([, entry]) => isCacheEntry(entry)),
      ) as Record<string, VanillaPackFilesCacheEntry>;
      vanillaPackFilesCache = { version: CACHE_VERSION, entries };
      vanillaPackFilesCacheMetadata = metadataFromCache(vanillaPackFilesCache);
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
    const binary = encodeVanillaPackFilesCache(vanillaPackFilesCache);
    const compressed = await zstdCompress(binary, CACHE_COMPRESSION_LEVEL);
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
  header: Buffer.from(packHeader.header),
  byteMask: packHeader.byteMask,
  refFileCount: packHeader.refFileCount,
  pack_file_index_size: packHeader.pack_file_index_size,
  pack_file_count: packHeader.pack_file_count,
  header_buffer: Buffer.from(packHeader.header_buffer),
});

const isValidCachedHeader = (packHeader: VanillaCachedPackHeader): boolean =>
  Buffer.isBuffer(packHeader.header) &&
  Buffer.isBuffer(packHeader.header_buffer) &&
  typeof packHeader.byteMask === "number" &&
  typeof packHeader.refFileCount === "number" &&
  typeof packHeader.pack_file_index_size === "number" &&
  typeof packHeader.pack_file_count === "number";

const decodeHeader = (packHeader: VanillaCachedPackHeader): PackHeader | undefined => {
  if (!isValidCachedHeader(packHeader)) return undefined;

  return {
    header: Buffer.from(packHeader.header),
    byteMask: packHeader.byteMask,
    refFileCount: packHeader.refFileCount,
    pack_file_index_size: packHeader.pack_file_index_size,
    pack_file_count: packHeader.pack_file_count,
    header_buffer: Buffer.from(packHeader.header_buffer),
  };
};

const areValidCachedPackedFiles = (packedFiles: VanillaCachedPackedFile[]): boolean =>
  !packedFiles.some(
    (packedFile) =>
      !packedFile ||
      typeof packedFile.name !== "string" ||
      typeof packedFile.file_size !== "number" ||
      typeof packedFile.start_pos !== "number" ||
      typeof packedFile.is_compressed !== "boolean",
  );

const decodePackedFiles = (packedFiles: VanillaCachedPackedFile[]): PackedFile[] | undefined => {
  if (!areValidCachedPackedFiles(packedFiles)) return undefined;
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

const hasValidExpandedIndex = (entry: VanillaPackFilesCacheEntry | undefined): boolean =>
  !!entry &&
  isCacheEntry(entry) &&
  !!entry.packedFiles &&
  !!entry.packHeader &&
  !!entry.dependencyPacks &&
  areValidCachedPackedFiles(entry.packedFiles) &&
  isValidCachedHeader(entry.packHeader);

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
  return hasValidExpandedIndex(entry) ? entry : undefined;
};

/**
 * Lightweight freshness check used before starting WH3AssetHost. Unlike
 * getCurrentVanillaPackIndex(), this does not clone every packed-file entry
 * merely to determine whether a current expanded index is already cached.
 */
export const hasCurrentVanillaPackIndex = async (packPath: string): Promise<boolean> => {
  if (!isCurrentGameVanillaPackPath(packPath)) return false;

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(packPath);
  } catch {
    return false;
  }

  const metadata = await loadVanillaPackFilesCacheMetadata();
  const entry = metadata.get(normalizeCachePath(packPath));
  return !!entry && entry.size === stat.size && entry.lastChangedLocal === stat.mtimeMs && entry.hasExpandedIndex;
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
    vanillaPackFilesCacheMetadata?.set(normalizeCachePath(cacheKey), {
      size,
      lastChangedLocal,
      hasExpandedIndex: true,
    });
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
    vanillaPackFilesCacheMetadata?.set(normalizeCachePath(cacheKey), {
      size,
      lastChangedLocal,
      hasExpandedIndex: false,
    });
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
