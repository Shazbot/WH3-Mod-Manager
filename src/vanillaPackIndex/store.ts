/**
 * Owns the vanilla pack index file: finding it, deciding whether it still applies, building it when
 * it does not, and handing it out.
 *
 * Everything Electron-shaped lives here so `./format` stays pure and testable, matching how the
 * vanilla DB cache is split. Built lazily on the first request and reused from then on.
 *
 * Building costs roughly two seconds and a few hundred megabytes of peak memory, because it has to
 * materialize every vanilla file name once to sort them. Loading the built file costs neither - it
 * never creates a string - which is why this is written to disk rather than rebuilt per session.
 */

import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import { app } from "electron";
import * as fs from "fs";
import * as nodePath from "path";

import appData from "../appData";
import { createCacheRebuildPolicy } from "../vanillaDbCache/rebuildPolicy";
import { getVanillaPackPathsInLoadOrder } from "../utility/vanillaPackPaths";
import {
  VanillaPackIndex,
  VanillaPackIndexIdentity,
  buildVanillaPackIndex,
  decodeVanillaPackIndex,
  encodeVanillaPackIndex,
  isVanillaPackIndexCurrent,
} from "./format";

/** Matches the level the other caches under userData are written at. */
const CACHE_COMPRESSION_LEVEL = 1;

const cacheFileName = (game: string) => `vanilla-pack-index-${game}.bin`;

const indexByGame = new Map<string, VanillaPackIndex>();
/** In flight builds, so several callers arriving at once do not each parse 260 pack indices. */
const buildsInFlight = new Map<string, Promise<VanillaPackIndex | undefined>>();
/** Stops an index that keeps coming back broken from being rebuilt on every request. */
const rebuildPolicy = createCacheRebuildPolicy();

const getIdentity = (): VanillaPackIndexIdentity | undefined => {
  const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
  if (!dataFolder) return undefined;

  const packPaths = getVanillaPackPathsInLoadOrder();
  if (packPaths.length === 0) return undefined;

  try {
    // One stat stands in for all 260 packs: a game update rewrites the manifest that names them.
    const manifestStat = fs.statSync(nodePath.join(dataFolder, "manifest.txt"));
    return {
      game: appData.currentGame,
      dataFolder,
      manifestSize: manifestStat.size,
      manifestMtimeMs: manifestStat.mtimeMs,
      packCount: packPaths.length,
    };
  } catch {
    return undefined;
  }
};

const identityKey = (identity: VanillaPackIndexIdentity): string => JSON.stringify(identity);

const loadFromDisk = async (
  cacheFilePath: string,
  identity: VanillaPackIndexIdentity,
): Promise<VanillaPackIndex | undefined> => {
  try {
    const compressed = await fs.promises.readFile(cacheFilePath);
    const decoded = decodeVanillaPackIndex(Buffer.from(await zstdDecompress(compressed)));
    if (!decoded) return undefined;
    return isVanillaPackIndexCurrent(decoded, identity) ? decoded : undefined;
  } catch {
    // Missing or unreadable is the normal first-run case, not something to report.
    return undefined;
  }
};

const writeToDisk = async (cacheFilePath: string, index: VanillaPackIndex): Promise<void> => {
  const temporaryPath = `${cacheFilePath}.building`;
  try {
    const compressed = await zstdCompress(encodeVanillaPackIndex(index), CACHE_COMPRESSION_LEVEL);
    // Written aside and renamed, so a crash mid-write cannot leave a half file where a whole one was.
    await fs.promises.writeFile(temporaryPath, compressed);
    await fs.promises.rename(temporaryPath, cacheFilePath);
  } catch (error) {
    console.error(`vanilla pack index: could not write ${cacheFilePath}:`, error);
    try {
      await fs.promises.rm(temporaryPath, { force: true });
    } catch {
      // Nothing further to do; the next build overwrites it anyway.
    }
  }
};

const buildFromPacks = async (identity: VanillaPackIndexIdentity): Promise<VanillaPackIndex> => {
  // Imported here rather than at module load: packFileSerializer pulls in a large dependency graph,
  // and nothing needs it until an index actually has to be built.
  const { readPack } = await import("../packFileSerializer");

  const startTime = performance.now();
  const packs: Array<{ packName: string; fileNames: string[] }> = [];
  for (const packPath of getVanillaPackPathsInLoadOrder()) {
    try {
      // Sorting is the single most expensive part of reading an index and the names get sorted
      // together below anyway.
      const indexedPack = await readPack(packPath, { skipParsingTables: true, skipSorting: true });
      packs.push({
        packName: nodePath.basename(packPath),
        fileNames: indexedPack.packedFiles.map((packedFile) => packedFile.name),
      });
    } catch (error) {
      // A pack that will not parse is left out rather than failing the whole index: every consumer
      // falls back to reading packs directly, so a gap costs speed, not correctness.
      console.warn(`vanilla pack index: could not index ${packPath}:`, error);
    }
  }

  const index = buildVanillaPackIndex(identity, packs);
  console.log(
    `vanilla pack index: built from ${packs.length} pack(s), ${index.block.count} file(s), in ${(
      performance.now() - startTime
    ).toFixed(0)}ms`,
  );
  return index;
};

/**
 * The vanilla pack index for the current game, building it if there is no usable file.
 *
 * Undefined means "no index available" - no data folder, no manifest, or a build that failed. Every
 * caller must have a path that works without it.
 */
export const getVanillaPackIndex = async (): Promise<VanillaPackIndex | undefined> => {
  const identity = getIdentity();
  if (!identity) return undefined;

  const key = identityKey(identity);
  const cached = indexByGame.get(key);
  if (cached) return cached;

  const inFlight = buildsInFlight.get(key);
  if (inFlight) return inFlight;

  if (!rebuildPolicy.mayBuild(key)) return undefined;

  const work = (async (): Promise<VanillaPackIndex | undefined> => {
    const cacheFilePath = nodePath.join(app.getPath("userData"), cacheFileName(identity.game));
    try {
      const fromDisk = await loadFromDisk(cacheFilePath, identity);
      if (fromDisk) {
        console.log(`vanilla pack index: loaded ${fromDisk.block.count} file(s) from ${cacheFilePath}`);
        indexByGame.set(key, fromDisk);
        return fromDisk;
      }

      const built = await buildFromPacks(identity);
      indexByGame.set(key, built);
      await writeToDisk(cacheFilePath, built);
      return built;
    } catch (error) {
      const { abandoned } = rebuildPolicy.recordRecoverableFailure(key);
      console.error(
        `vanilla pack index: build failed${abandoned ? " and will not be retried this session" : ""}:`,
        error,
      );
      return undefined;
    } finally {
      buildsInFlight.delete(key);
    }
  })();

  buildsInFlight.set(key, work);
  return work;
};

/** Drops what is held in memory. The file on disk stands or falls on its own identity. */
export const clearVanillaPackIndexCache = (): void => {
  indexByGame.clear();
  buildsInFlight.clear();
};
