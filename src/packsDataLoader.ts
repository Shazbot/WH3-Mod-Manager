/**
 * Reading packs into `appData.packsData` from the main process, plus the loc and table-version
 * lookups built on those reads. Kept out of ipcMainListeners so the node executor and DB clone can
 * use them without importing the IPC layer.
 */
import { app } from "electron";
import * as fs from "fs";
import * as nodePath from "path";
import appData from "./appData";
import { windows } from "./mainWindows";
import { appendPackFileCollisions } from "./modCompat/packFileCollisions";
import { appendPackTableCollisions } from "./modCompat/packTableCollisions";
import { getPackViewData, readPack } from "./packFileSerializer";
import { Pack, PackCollisions } from "./packFileTypes";
import { getLocsFromPacks } from "./skillsData/cache";
import { gameToPackWithDBTablesName, SupportedGames } from "./supportedGames";
import getPackTableData from "./utility/frontend/packDataHandling";
import { readJsonDiskCache, writeJsonDiskCache } from "./utility/jsonDiskCache";
import { parseLiveDBTablePath } from "./utility/packFileHelpers";
import { createPackReadRegistry } from "./utility/packReadRegistry";
import Trie, { type KeyedLookup } from "./utility/trie";
import {
  EXACT_VANILLA_LOC_DECODER_REVISION,
  EXACT_VANILLA_LOC_SOURCE_FORMAT,
  indexExactVanillaLocPackSet,
  readExactVanillaLocEntries,
} from "./vanillaLocCache/exactSource";
import { openOrBuildVanillaLocCache } from "./vanillaLocCache/store";

export const appendCollisions = async (newPack: Pack) => {
  while (!appData.compatData) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (appData.compatData) {
    appData.compatData.packTableCollisions = appendPackTableCollisions(
      appData.packsData,
      appData.compatData.packTableCollisions,
      newPack,
    );
    appData.compatData.packFileCollisions = appendPackFileCollisions(
      appData.packsData,
      appData.compatData.packFileCollisions,
      newPack,
    );
  }
};
const isLiveDBPackedFileName = (packedFileName: string) => parseLiveDBTablePath(packedFileName) != undefined;
export const appendPacksData = (newPack: Pack, mod?: Mod, emitToMainWindow = true) => {
  const existingPack = appData.packsData.find((pack) => pack.path == newPack.path);
  console.log("appendPacksData: appending", newPack.name);
  if (!existingPack) {
    appData.packsData.push(newPack);
    if (emitToMainWindow) {
      windows.mainWindow?.webContents.send("setPacksDataRead", [newPack.path]);
    }
    const candidateFileNames = newPack.packedFiles
      .map((packedFile) => packedFile.name)
      .filter((packedFileName) => isLiveDBPackedFileName(packedFileName) || packedFileName.endsWith(".lua"));
    // Gathered once rather than scanned per candidate: a mod adding scripts of its own finds no
    // match for any of them, and that is the case that walked every vanilla pack in full each time.
    const vanillaFileNames = new Set<string>();
    if (candidateFileNames.length > 0) {
      for (const vanillaPack of appData.vanillaPacks) {
        for (const packedFileInData of vanillaPack.packedFiles) vanillaFileNames.add(packedFileInData.name);
      }
    }
    const overwrittenFileNames = candidateFileNames.filter((packedFileName) => vanillaFileNames.has(packedFileName));
    if (overwrittenFileNames.length > 0) {
      appData.overwrittenDataPackedFiles[newPack.name] = overwrittenFileNames;
      if (emitToMainWindow) {
        windows.mainWindow?.webContents.send("setOverwrittenDataPackedFiles", appData.overwrittenDataPackedFiles);
      }
    }
    const outdatedPackFiles = new Set<string>();
    if (appData.currentGame == "wh3" && mod && (mod.lastChangedLocal || mod.lastChanged)) {
      const lastChanged = mod.lastChanged || mod.lastChangedLocal;
      if (lastChanged) {
        appData.gameUpdates
          .filter((gameUpdate) => parseInt(gameUpdate.timestamp) * 1000 - lastChanged > 0)
          .reduce((acc, current) => {
            if (current.files) {
              current.files
                .filter((fileUpdateRule) => {
                  const ret = newPack.packedFiles.some((pF) => pF.name.search(fileUpdateRule.regex) > -1);
                  // if (ret)
                  //   console.log(
                  //     "file match",
                  //     newPack.packedFiles.find((pF) => pF.name.search(fileUpdateRule.regex) > -1)?.name,
                  //     "regex",
                  //     fileUpdateRule.regex,
                  //     "ret",
                  //     ret
                  //   );
                  return ret;
                })
                .map((updateRule) => `${current.version}: ${updateRule.reason}`)
                .forEach((updateStr) => acc.add(updateStr));
            }
            return acc;
          }, outdatedPackFiles);
      }
    }
    if (outdatedPackFiles.size > 0) {
      appData.outdatedPackFiles[newPack.name] = Array.from(outdatedPackFiles);
      if (emitToMainWindow) {
        windows.mainWindow?.webContents.send("setOutdatedPackFiles", appData.outdatedPackFiles);
      }
    }
  } else {
    console.log("existing pack for", newPack.name, "found");
    // append list of tables that are parsed in that pack
    if (newPack.readTables == "all") {
      existingPack.readTables = "all";
    } else {
      newPack.readTables.forEach((newlyRead) => {
        if (existingPack.readTables != "all" && !existingPack.readTables.includes(newlyRead)) {
          existingPack.readTables.push(newlyRead);
        }
      });
    }
    newPack.packedFiles
      .filter((packedFile) => packedFile.schemaFields)
      .forEach((newPackedFile) => {
        const index = existingPack.packedFiles.findIndex(
          (existingPackedFile) => existingPackedFile.name == newPackedFile.name,
        );
        if (index != -1) {
          existingPack.packedFiles.splice(index, 1);
        }
        existingPack.packedFiles.push(newPackedFile);
      });
  }
};

/**
 * The game's own locs, as an entry for the `locs` record consumers look keys up in.
 *
 * Returns the cache reader under one synthetic key rather than a trie per pack, which is the whole
 * saving: the tries these replace cost ~97 MB of heap and are retained for as long as the skills or
 * technology data is. Technology data places live mod tries before this cached lookup so a mod
 * localization can override a vanilla value.
 *
 * Falls back to reading the packs and building tries, so a cache that cannot be built or opened
 * degrades to the old behaviour instead of losing every localised string.
 */
export const getVanillaLocLookup = async (vanillaPackPaths: string[]): Promise<Record<string, KeyedLookup<string>>> => {
  const readVanillaLocPacks = async () => {
    if (vanillaPackPaths.length > 0) {
      await readModsByPath(vanillaPackPaths, { skipParsingTables: true, readLocs: true }, true, false);
    }
    const loadedByPath = new Map(appData.packsData.map((pack) => [pack.path, pack]));
    return vanillaPackPaths.map((packPath) => loadedByPath.get(packPath)).filter((pack): pack is Pack => !!pack);
  };

  let reader: Awaited<ReturnType<typeof openOrBuildVanillaLocCache>>;
  try {
    const exactPackSet = indexExactVanillaLocPackSet(vanillaPackPaths, appData.currentGame, "gui");
    reader = await openOrBuildVanillaLocCache({
      userDataPath: app.getPath("userData"),
      game: appData.currentGame,
      packPaths: vanillaPackPaths,
      sourceFormat: EXACT_VANILLA_LOC_SOURCE_FORMAT,
      decoderRevision: EXACT_VANILLA_LOC_DECODER_REVISION,
      orderFingerprint: exactPackSet.orderFingerprint,
      readEntries: () => readExactVanillaLocEntries(exactPackSet),
    });
  } catch (error) {
    console.log("vanilla loc cache: exact source unavailable", error);
  }
  if (reader) return { "vanilla-loc-cache": reader };
  return getLocsFromPacks(await readVanillaLocPacks(), getLocsTrie);
};

export const getLocsTrie = (pack: Pack) => {
  const trie = new Trie<string>("_");
  const locPFs = Object.values(pack.packedFiles).filter((pF) => pF.name.endsWith(".loc"));
  const packViewData = getPackViewData(pack, undefined, true);
  if (!packViewData) {
    console.log("getLocsTrie: packViewData INVALID");
    return;
  }
  for (const packedFile of locPFs) {
    const data = getPackTableData(packedFile.name, packViewData);
    if (!data) continue;
    // console.log("loc data for:", pack.name, data);
    for (const rows of Object.values(data)) {
      for (const row of rows) {
        const [locKey, locValue] = [row[0] as string, row[1] as string];
        // console.log("loc:", locKey, locValue);
        if (locKey && locKey != "") trie.add(locKey, locValue);
      }
    }
  }
  return trie;
};
const gameToDefaultTableVersions = {} as Record<SupportedGames, Record<string, number>>;
interface DefaultTableVersionsCacheEntry {
  dbPackSize: number;
  dbPackMtimeMs: number;
  tableNameToVersion: Record<string, number>;
}
const DEFAULT_TABLE_VERSIONS_CACHE_FILE = "default-table-versions-cache.bin";
/**
 * One integer per table, and getting it costs a full parse of every table in the game's db pack -
 * the version only exists in the parsed output. Worth keeping across restarts, keyed like the other
 * vanilla caches on the pack's size and mtime.
 */
export const getDefaultTableVersions = async () => {
  const cachedGameToDefaultTableVersions = gameToDefaultTableVersions[appData.currentGame];
  if (cachedGameToDefaultTableVersions) return cachedGameToDefaultTableVersions;
  const dbPackName = gameToPackWithDBTablesName[appData.currentGame];
  const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
  if (!dataFolder) return;
  const dbPackPath = nodePath.join(dataFolder, dbPackName);

  const cacheFilePath = nodePath.join(app.getPath("userData"), DEFAULT_TABLE_VERSIONS_CACHE_FILE);
  let dbPackStats: fs.Stats | undefined;
  try {
    dbPackStats = await fs.promises.stat(dbPackPath);
  } catch {
    // No pack to key the cache on, so fall through and let the read below fail as it did before.
  }

  type DefaultTableVersionsCache = Partial<Record<SupportedGames, DefaultTableVersionsCacheEntry>>;
  const diskCache = (await readJsonDiskCache<DefaultTableVersionsCache>(cacheFilePath)) ?? {};
  const cacheEntry = diskCache[appData.currentGame];
  if (
    dbPackStats &&
    cacheEntry &&
    cacheEntry.dbPackSize === dbPackStats.size &&
    cacheEntry.dbPackMtimeMs === dbPackStats.mtimeMs
  ) {
    gameToDefaultTableVersions[appData.currentGame] = cacheEntry.tableNameToVersion;
    return cacheEntry.tableNameToVersion;
  }

  let pack = appData.packsData.find((packData) => packData.path == dbPackPath);
  if (!pack || (pack && pack.packedFiles.length == 0)) {
    pack = await readPack(dbPackPath, { skipParsingTables: true });
  }
  if (!pack) return;
  const dataPackData = await readPack(dbPackPath, {
    tablesToRead: pack.packedFiles.filter((pf) => pf.name.startsWith("db\\")).map((pf) => pf.name),
  });
  const tableNameToVersion = {} as Record<string, number>;
  // Default versions come from the game's own tables, so the live db folder alone.
  for (const packedFile of dataPackData.packedFiles) {
    const dbName = parseLiveDBTablePath(packedFile.name)?.dbName;
    if (dbName == undefined) continue;
    tableNameToVersion[dbName] = packedFile.version ?? 0;
  }
  gameToDefaultTableVersions[appData.currentGame] = tableNameToVersion;

  if (dbPackStats) {
    diskCache[appData.currentGame] = {
      dbPackSize: dbPackStats.size,
      dbPackMtimeMs: dbPackStats.mtimeMs,
      tableNameToVersion,
    };
    await writeJsonDiskCache(cacheFilePath, diskCache);
  }
  return tableNameToVersion;
};
/**
 * The packs being read right now. Every read of a whole pack registers here, so a caller that needs
 * one can wait for the read in flight instead of reading beside it or giving up on it.
 */
export const packReads = createPackReadRegistry();

/**
 * A pack read that is registered for its whole duration, released even when the read throws.
 *
 * Registering only. It deliberately does not wait for a read already in flight: callers that need
 * that - the mod list and the global search - wait themselves, and making it implicit here once
 * queued `readPackForCompat` and the data-pack read behind unrelated work for up to the registry's
 * five-minute backstop.
 */
export const readPackRegistered = async (packPath: string, packReadingOptions: PackReadingOptions) => {
  const releaseRead = packReads.begin(packPath);
  try {
    return await readPack(packPath, packReadingOptions);
  } finally {
    releaseRead();
  }
};

export const readModsByPath = async (
  modPaths: string[],
  packReadingOptions: PackReadingOptions,
  skipCollisionCheck = true,
  emitToMainWindow = true,
) => {
  console.log("readModsByPath:", modPaths, "packReadingOptions:", packReadingOptions);
  // console.log("readModsByPath skipParsingTables:", skipParsingTables);
  // console.log("readModsByPath skipCollisionCheck:", skipCollisionCheck);
  // if (!skipParsingTables) {
  //   appData.packsData = appData.packsData.filter((pack) => !modPaths.some((modPath) => modPath == pack.path));
  // }
  const newPacks = [] as Pack[];
  for (const modPath of modPaths) {
    // Wait for whoever is reading this pack rather than skip it. The read in flight is not this
    // caller's read - it may be parsing an entirely different set of tables - so giving up on it
    // returned a pack holding none of the tables asked for, with only a log line to say so. A full
    // parse of the game's database pack runs well past any fixed wait, so the wait is exact and the
    // backstop below only guards against a registration that leaked.
    if (!(await packReads.waitUntilFree(modPath))) {
      console.log("readModsByPath: waited too long for a read of", modPath, "to end, reading it anyway");
    }
    // console.log("READING ", modPath, readLocs);
    if (emitToMainWindow) {
      windows.mainWindow?.webContents.send("setCurrentlyReadingMod", modPath);
    }
    const newPack = await readPackRegistered(modPath, packReadingOptions);
    if (emitToMainWindow) {
      windows.mainWindow?.webContents.send("setLastModThatWasRead", modPath);
    }
    // if (appData.packsData.every((pack) => pack.path != modPath)) {
    appendPacksData(newPack, undefined, emitToMainWindow);
    // }
    if (!skipCollisionCheck) {
      appendCollisions(newPack);
    }
    newPacks.push(newPack);
  }
  if (!skipCollisionCheck) {
    windows.mainWindow?.webContents.send("setPackCollisions", {
      packFileCollisions: appData.compatData.packFileCollisions,
      packTableCollisions: appData.compatData.packTableCollisions,
    } as PackCollisions);
  }
  return newPacks;
};
