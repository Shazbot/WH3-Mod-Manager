import { readPack } from "./packFileSerializer";
import {
  hasCurrentVanillaPackIndex,
  saveVanillaPackFilesCache,
} from "./vanillaPackFilesCache";
import { getVanillaPackPathsInLoadOrder } from "./utility/vanillaPackPaths";

export interface Wh3AssetHostVanillaCacheWarmResult {
  totalPacks: number;
  cacheHits: number;
  rebuiltPacks: number;
}

/**
 * WH3AssetHost needs the expanded index for every vanilla pack, not merely the
 * handful the manager happened to inspect during normal startup. The manager's
 * vanilla pack cache is otherwise intentionally lazy.
 *
 * Build only missing/stale indexes, using the existing authoritative pack
 * parser, and flush once at the end so the out-of-process host never observes
 * a partially warmed cache file.
 */
export const ensureWh3AssetHostVanillaCache = async (): Promise<Wh3AssetHostVanillaCacheWarmResult> => {
  const vanillaPackPaths = getVanillaPackPathsInLoadOrder();
  let cacheHits = 0;
  let rebuiltPacks = 0;

  for (const packPath of vanillaPackPaths) {
    if (await hasCurrentVanillaPackIndex(packPath)) {
      cacheHits++;
      continue;
    }

    await readPack(packPath, {
      skipParsingTables: true,
      skipSorting: true,
    });
    rebuiltPacks++;
  }

  await saveVanillaPackFilesCache();

  return {
    totalPacks: vanillaPackPaths.length,
    cacheHits,
    rebuiltPacks,
  };
};
