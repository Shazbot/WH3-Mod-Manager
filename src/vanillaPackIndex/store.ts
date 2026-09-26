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
import {
  VanillaDbCacheBuildPhase,
  VanillaDbCacheBuildStatus,
  reportVanillaDbCacheBuildProgress,
} from "../vanillaDbCache/progress";
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

let nextBuildId = 0;

/**
 * Reports on the same channel and card the database cache uses; `kind` is what tells them apart.
 *
 * Both builds are lazy, both hold the main process for a couple of seconds, and both want to say
 * "this is happening, it finishes once" - so they share the surface rather than each growing one.
 */
const reportProgress = (
  identity: VanillaPackIndexIdentity,
  buildId: string,
  phase: VanillaDbCacheBuildPhase,
  percent: number,
  status: VanillaDbCacheBuildStatus = "running",
  detail?: string,
): void => {
  reportVanillaDbCacheBuildProgress({
    buildId,
    game: identity.game,
    kind: "packIndex",
    phase,
    percent,
    status,
    detail,
  });
};

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

/**
 * Hands the event loop a turn.
 *
 * `readPack` does its work in synchronous `fs.readSync` calls, so awaiting it only drains microtasks
 * - over a 260 pack read the loop never reaches the macrotask phase at all, and every progress
 * message queues up to be delivered after the build has already finished. Measured over a full
 * Warhammer III install, yielding between packs costs nothing and is if anything slightly faster.
 */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const buildFromPacks = async (identity: VanillaPackIndexIdentity, buildId: string): Promise<VanillaPackIndex> => {
  // Imported here rather than at module load: packFileSerializer pulls in a large dependency graph,
  // and nothing needs it until an index actually has to be built.
  const { readPack } = await import("../packFileSerializer");

  const startTime = performance.now();
  const packPaths = getVanillaPackPathsInLoadOrder();
  const packs: Array<{ packName: string; fileNames: string[] }> = [];

  // Announced and yielded before the first pack, so the card is on screen for the whole build
  // rather than appearing once the expensive part is already over.
  reportProgress(identity, buildId, "reading-packs", 5);
  await yieldToEventLoop();

  for (const packPath of packPaths) {
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
    // Reading the packs is most of the build and splits evenly across them, so it carries the bar
    // from 5% to 70%.
    reportProgress(
      identity,
      buildId,
      "reading-packs",
      5 + (packs.length / packPaths.length) * 65,
      "running",
      nodePath.basename(packPath),
    );
    await yieldToEventLoop();
  }

  // Sorting and encoding ~680,000 names is one indivisible step with nothing to report inside it,
  // so the bar is moved before it rather than during.
  reportProgress(identity, buildId, "encoding", 70);
  await yieldToEventLoop();

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
    const buildId = `${identity.game}-packIndex-${++nextBuildId}`;
    try {
      // Loading is a single 38ms read, so nothing is reported for it: a card that flickered up and
      // straight back down would be noise.
      const fromDisk = await loadFromDisk(cacheFilePath, identity);
      if (fromDisk) {
        console.log(`vanilla pack index: loaded ${fromDisk.block.count} file(s) from ${cacheFilePath}`);
        indexByGame.set(key, fromDisk);
        return fromDisk;
      }

      const built = await buildFromPacks(identity, buildId);
      indexByGame.set(key, built);

      reportProgress(identity, buildId, "writing", 90);
      await writeToDisk(cacheFilePath, built);

      reportProgress(identity, buildId, "complete", 100, "complete");
      return built;
    } catch (error) {
      const { abandoned } = rebuildPolicy.recordRecoverableFailure(key);
      console.error(
        `vanilla pack index: build failed${abandoned ? " and will not be retried this session" : ""}:`,
        error,
      );
      reportProgress(
        identity,
        buildId,
        "complete",
        0,
        "failed",
        error instanceof Error ? error.message : "File index build failed",
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
