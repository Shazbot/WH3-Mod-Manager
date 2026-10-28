import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as nodePath from "node:path";

import { readJsonDiskCache, writeJsonDiskCache } from "./utility/jsonDiskCache";

export const MOD_PACK_FILE_NAMES_CACHE_VERSION = 1;
export const MOD_PACK_FILE_NAMES_CACHE_DIRECTORY = "mod-pack-file-names";

interface ModPackFileNamesCacheEntry {
  version: typeof MOD_PACK_FILE_NAMES_CACHE_VERSION;
  packPath: string;
  size: number;
  lastChangedLocal: number;
  packedFileNames: string[];
}

interface PendingWrite {
  revision: number;
  cacheFilePath: string;
  entry: ModPackFileNamesCacheEntry;
}

const memoryEntries = new Map<string, ModPackFileNamesCacheEntry>();
const pendingWrites = new Map<string, PendingWrite>();
let nextRevision = 0;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let writeChain: Promise<void> = Promise.resolve();

const normalizePackPath = (packPath: string): string => nodePath.resolve(packPath).toLowerCase();

const getCacheFilePath = (userDataPath: string, normalizedPackPath: string): string => {
  const hash = createHash("sha256").update(normalizedPackPath).digest("hex");
  return nodePath.join(nodePath.resolve(userDataPath), MOD_PACK_FILE_NAMES_CACHE_DIRECTORY, `${hash}.bin`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isValidEntry = (
  value: unknown,
  normalizedPackPath: string,
  size: number,
  lastChangedLocal: number,
): value is ModPackFileNamesCacheEntry => {
  if (!isRecord(value)) return false;
  const names = value.packedFileNames;
  return (
    value.version === MOD_PACK_FILE_NAMES_CACHE_VERSION &&
    value.packPath === normalizedPackPath &&
    value.size === size &&
    value.lastChangedLocal === lastChangedLocal &&
    Array.isArray(names) &&
    names.every((name) => typeof name === "string")
  );
};

/** Reads one names-only entry without opening or hydrating the shared vanilla pack cache. */
export const getModPackFileNamesCacheEntry = async (
  userDataPath: string,
  packPath: string,
  size: number,
  lastChangedLocal: number,
): Promise<string[] | undefined> => {
  const normalizedPackPath = normalizePackPath(packPath);
  const cacheFilePath = getCacheFilePath(userDataPath, normalizedPackPath);
  const memoryEntry = memoryEntries.get(cacheFilePath);
  if (memoryEntry) {
    if (isValidEntry(memoryEntry, normalizedPackPath, size, lastChangedLocal)) {
      return [...memoryEntry.packedFileNames];
    }
  }

  const memoryEntryAtReadStart = memoryEntry;
  const entry = await readJsonDiskCache<unknown>(cacheFilePath);
  const currentMemoryEntry = memoryEntries.get(cacheFilePath);
  if (currentMemoryEntry !== memoryEntryAtReadStart) {
    return currentMemoryEntry && isValidEntry(currentMemoryEntry, normalizedPackPath, size, lastChangedLocal)
      ? [...currentMemoryEntry.packedFileNames]
      : undefined;
  }
  if (!isValidEntry(entry, normalizedPackPath, size, lastChangedLocal)) return undefined;
  memoryEntries.set(cacheFilePath, entry);
  return [...entry.packedFileNames];
};

const writeEntries = async (writes: PendingWrite[]): Promise<void> => {
  await Promise.all(
    writes.map(async ({ cacheFilePath, entry }) => {
      try {
        await fs.promises.mkdir(nodePath.dirname(cacheFilePath), { recursive: true });
        await writeJsonDiskCache(cacheFilePath, entry);
      } catch (error) {
        console.error(`Failed to prepare mod pack names cache ${cacheFilePath}:`, error);
      }
    }),
  );
};

const flushPendingWrites = async (): Promise<void> => {
  while (pendingWrites.size > 0) {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = undefined;

    const writes = [...pendingWrites.values()];
    for (const write of writes) {
      if (pendingWrites.get(write.cacheFilePath)?.revision === write.revision) {
        pendingWrites.delete(write.cacheFilePath);
      }
    }

    writeChain = writeChain.then(() => writeEntries(writes));
    await writeChain;
  }
  await writeChain;
};

const scheduleWrite = (): void => {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    void flushPendingWrites();
  }, 100);
};

/** Remembers names in memory immediately and schedules a write to this pack's sidecar file. */
export const rememberModPackFileNamesCacheEntry = (
  userDataPath: string,
  packPath: string,
  size: number,
  lastChangedLocal: number,
  packedFileNames: readonly string[],
): void => {
  const normalizedPackPath = normalizePackPath(packPath);
  const cacheFilePath = getCacheFilePath(userDataPath, normalizedPackPath);
  const entry: ModPackFileNamesCacheEntry = {
    version: MOD_PACK_FILE_NAMES_CACHE_VERSION,
    packPath: normalizedPackPath,
    size,
    lastChangedLocal,
    packedFileNames: [...packedFileNames],
  };

  memoryEntries.set(cacheFilePath, entry);
  pendingWrites.set(cacheFilePath, {
    revision: ++nextRevision,
    cacheFilePath,
    entry,
  });
  scheduleWrite();
};

/** Flushes only pending mod name sidecars; it does not load the shared vanilla cache. */
export const flushModPackFileNamesCache = async (): Promise<void> => {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = undefined;
  await flushPendingWrites();
};
