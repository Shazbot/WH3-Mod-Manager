import assert from "assert";
import bs from "binary-search";
import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as cheerio from "cheerio";
import { exec, fork } from "child_process";
import chokidar from "chokidar";
import { format } from "date-fns";
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import windowStateKeeper from "electron-window-state";
import * as fs from "fs";
import * as fsExtra from "fs-extra";
import { createHash, randomInt } from "node:crypto";
import * as net from "node:net";
import debounce from "just-debounce-it";
import fetch from "node-fetch";
import * as nodePath from "path";
import { version } from "react";
import { readAppConfig, setStartingAppState, writeAppConfig } from "./appConfigFunctions";
import appData, { GameFolderPaths } from "./appData";
import type { SerializedNode, SerializedConnection } from "./nodeGraph/types";
import { packDataStore } from "./components/viewer/packDataStore";
import i18n from "./configs/i18next.config";
import { buildDBIndirectReferences, buildDBReferenceTree, type DBIndirectReferenceCacheContext } from "./DBClone";
import { buildAbilityTooltipDataForEffects } from "./abilityTooltips";
import { getSaveFiles, setupSavesWatcher } from "./gameSaves";
import { appendPackFileCollisions, removeFromPackFileCollisions } from "./modCompat/packFileCollisions";
import { emptyAllCompatDataCollections, getCompatData } from "./modCompat/packFileCompatManager";
import { appendPackTableCollisions, removeFromPackTableCollisions } from "./modCompat/packTableCollisions";
import {
  fetchModData,
  getContentModInFolder,
  getDataMod,
  getFolderPaths,
  getLastUpdated,
  getMods,
} from "./modFunctions";
import { sortByNameAndLoadOrder } from "./modSortingHelpers";
import { readPackHeader } from "./packFileHandler";
import {
  addFakeUpdate,
  amendSchemaField,
  chunkSchemaIntoRows,
  createOverwritePack,
  executeFlowsForPack,
  getDBVersion,
  getPacksInSave,
  getPacksTableData,
  getPackViewData,
  mergeMods,
  readFromExistingPack,
  readPack,
  typeToBuffer,
  writeStartGamePack,
  writePack,
} from "./packFileSerializer";
import {
  AmendedSchemaField,
  DBField,
  LocFields,
  NewPackedFile,
  Pack,
  PackCollisions,
  PackedFile,
  PackHeader,
} from "./packFileTypes";
import { resolveTable } from "./resolveTable";
import {
  DBNameToDBVersions,
  gameToDBFieldsThatReference,
  gameToReferences,
  initializeAllSchemaForGame,
} from "./schema";
import {
  appendLocalizationsToSkills,
  formatEffectLocalization,
  getNodeRequirements,
  getNodesToParents,
  getRawEffectLocalization,
  getSkills,
  NodeLinks,
  NodeSkill,
  resolveTextReplacements,
  SkillAndIcons,
} from "./skills";
import {
  cloneSkillsDataCore,
  createEmptySkillsDataCore,
  getDefaultSkillsSubtype,
  getLocsFromPacks,
  getSkillAndEffectIconPaths,
  getVanillaSkillsDataCoreFromCache,
  loadIconsFromPacks,
  saveVanillaSkillsDataCoreCache,
} from "./skillsData/cache";
import { applyModOverlayToSkillsDataCore } from "./skillsData/overlay";
import {
  gameToGameName,
  gameToPackWithDBTablesName,
  gameToProcessName,
  gameToSteamId,
  gameToSupportedGameOptions,
  gameToVanillaPacksData,
  supportedGameOptions,
  supportedGameOptionToStartGameOption,
  SupportedGames,
  supportedGames,
  SupportedLanguage,
} from "./supportedGames";
import { tryOpenFile } from "./utility/fileHelpers";
import getPackTableData from "./utility/frontend/packDataHandling";
import { collator } from "./utility/packFileSorting";
import steamCollectionScript from "./utility/steamCollectionScript";
import Trie from "./utility/trie";
import hash from "object-hash";
import { Md10K } from "react-icons/md";
import { join } from "path";

declare const VIEWER_WEBPACK_ENTRY: string;
declare const VIEWER_PRELOAD_WEBPACK_ENTRY: string;
declare const SKILLS_WEBPACK_ENTRY: string;
declare const SKILLS_PRELOAD_WEBPACK_ENTRY: string;
const normalizeGeneratedPrefix = (prefix: string) => prefix.trim().replace(/_+$/, "");
const appendScopedTechNodeHash = (nodeKey: string, campaignKey?: string, factionKey?: string) => {
  const scopeSource = `${campaignKey || ""}${factionKey || ""}`.trim();
  if (!scopeSource) return nodeKey;
  const scopeHash = createHash("sha256").update(scopeSource).digest().subarray(0, 8).toString("base64url");
  return nodeKey.endsWith("_") ? `${nodeKey}${scopeHash}` : `${nodeKey}_${scopeHash}`;
};
const appendScopedSkillNodeHash = (
  nodeKey: string,
  campaignKey?: string,
  factionKey?: string,
  subculture?: string,
) => {
  const scopeSource = `${campaignKey || ""}${factionKey || ""}${subculture || ""}`.trim();
  if (!scopeSource) return nodeKey;
  const scopeHash = createHash("sha256").update(scopeSource).digest().subarray(0, 8).toString("base64url");
  return nodeKey.endsWith("_") ? `${nodeKey}${scopeHash}` : `${nodeKey}_${scopeHash}`;
};
const buildDefaultSkillSetSuffix = (subtype: string) => `skill_set_${subtype}`;
const resolveSkillGenerationTemplate = (
  template: string,
  variables: { prefix: string; setSuffix: string; timestamp: string; row: string; column: string },
) =>
  template
    .replaceAll("${prefix}", variables.prefix)
    .replaceAll("${xxx}", variables.prefix)
    .replaceAll("${setSuffix}", variables.setSuffix)
    .replaceAll("${yyy}", variables.setSuffix)
    .replaceAll("${timestamp}", variables.timestamp)
    .replaceAll("${row}", variables.row)
    .replaceAll("${r}", variables.row)
    .replaceAll("${column}", variables.column)
    .replaceAll("${c}", variables.column);
let contentWatcher: chokidar.FSWatcher | undefined;
let dataWatcher: chokidar.FSWatcher | undefined;
let downloadsWatcher: chokidar.FSWatcher | undefined;
let mergedWatcher: chokidar.FSWatcher | undefined;
export const windows = {
  mainWindow: undefined as BrowserWindow | undefined,
  viewerWindow: undefined as BrowserWindow | undefined,
  skillsWindow: undefined as BrowserWindow | undefined,
};
type VisualsSession = {
  sessionId: string;
  enabledModPaths: string[];
  dbPriorityPackPaths: string[];
  fileSearchPackPaths: string[];
  createdAt: number;
};
const visualsSessions = new Map<string, VisualsSession>();
const dbDuplicationCancelStateByWebContentsId = new Map<number, { canceled: boolean }>();
const dbIndirectReferenceCacheByWebContentsId = new Map<number, DBIndirectReferenceCacheContext>();
const createDBIndirectReferenceCacheContext = (): DBIndirectReferenceCacheContext => ({
  packByPath: new Map<string, Pack>(),
  tableFilesByPackAndTable: new Map<string, PackedFile[]>(),
  rowsByPackedFile: new WeakMap<PackedFile, AmendedSchemaField[][]>(),
  columnIndexesByPackedFile: new WeakMap<PackedFile, Map<string, number>>(),
  reverseRefIndexByKey: new Map(),
  reverseRefTtlMs: 5 * 60 * 1000,
  maxReverseRefEntries: 32,
});
const normalizePackFilePath = (value: string) =>
  value.replace(/\//g, "\\").replace(/\\+/g, "\\").replace(/^\\+/, "").trim();
const normalizePackFilePathKey = (value: string) => normalizePackFilePath(value).toLowerCase();
const toVariantMeshDefinitionPath = (value: string) => {
  let path = normalizePackFilePath(value);
  if (!path) return path;
  if (!path.toLowerCase().endsWith(".variantmeshdefinition")) {
    path = `${path}.variantmeshdefinition`;
  }
  const lower = path.toLowerCase();
  if (!lower.startsWith("variantmeshes\\")) {
    path = `variantmeshes\\variantmeshdefinitions\\${path}`;
  } else if (!lower.startsWith("variantmeshes\\variantmeshdefinitions\\")) {
    const baseName = nodePath.basename(path);
    path = `variantmeshes\\variantmeshdefinitions\\${baseName}`;
  }
  return normalizePackFilePath(path);
};
const decodePackedFileText = (packedFile: PackedFile) => {
  if (packedFile.text != null) return packedFile.text;
  if (!packedFile.buffer) return undefined;
  const buffer = packedFile.buffer;
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("hex") === "fffe") {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("hex") === "efbbbf") {
    return buffer.subarray(3).toString("utf8");
  }
  return buffer.toString("utf8");
};
const findPackedFileCaseInsensitive = (pack: Pack, fileName: string) => {
  const normalizedTarget = normalizePackFilePathKey(fileName);
  const exactIndex = bs(pack.packedFiles, fileName, (a: PackedFile, b: string) =>
    collator.compare(a.name, b),
  );
  if (exactIndex >= 0) return pack.packedFiles[exactIndex];
  return pack.packedFiles.find(
    (packedFile) => normalizePackFilePathKey(packedFile.name) === normalizedTarget,
  );
};
const getOrLoadPackFromAppData = async (packPath: string) => {
  const pack = appData.packsData.find((existingPack) => existingPack.path === packPath);
  if (pack) return pack;
  const newPack = await readPack(packPath, { skipParsingTables: true });
  appendPacksData(newPack);
  return appData.packsData.find((existingPack) => existingPack.path === packPath);
};
const resolveVisualsFileInSession = async (
  session: VisualsSession,
  fileName: string,
  options?: { variantMeshDefinitionFallback?: boolean; preferredPackPath?: string },
) => {
  let requestedPath = normalizePackFilePath(fileName);
  if (!requestedPath) return undefined;
  if (options?.variantMeshDefinitionFallback) {
    const lowerRequested = requestedPath.toLowerCase();
    const looksExplicitPath = lowerRequested.includes("\\") || lowerRequested.startsWith("variantmeshes");
    if (
      lowerRequested.endsWith(".variantmeshdefinition") ||
      !looksExplicitPath ||
      !(/\.[a-z0-9_]+$/i.test(lowerRequested) && !lowerRequested.endsWith(".variantmeshdefinition"))
    ) {
      requestedPath = toVariantMeshDefinitionPath(requestedPath);
    }
  }
  if (!requestedPath) return undefined;
  const preferredPackPath = options?.preferredPackPath;
  const searchPackPaths = [...session.fileSearchPackPaths].toReversed();
  const prioritizedPackPaths =
    preferredPackPath && searchPackPaths.includes(preferredPackPath)
      ? [preferredPackPath, ...searchPackPaths.filter((packPath) => packPath !== preferredPackPath)]
      : searchPackPaths;
  for (const packPath of prioritizedPackPaths) {
    const pack = await getOrLoadPackFromAppData(packPath);
    if (!pack) continue;
    const matchedFile = findPackedFileCaseInsensitive(pack, requestedPath);
    if (!matchedFile) continue;
    return {
      requestedPath,
      pack,
      packPath,
      fileName: matchedFile.name,
    };
  }
  return {
    requestedPath,
  };
};
const sendAssetEditorOpenRequest = async (args: {
  packPathOnDisk: string;
  path: string;
  openInExistingKitbashTab: boolean;
}) => {
  const pipePath = "\\\\.\\pipe\\TheAssetEditor.Ipc";
  return new Promise<{ ok?: boolean; error?: string; normalizedPath?: string }>((resolve, reject) => {
    const socket = net.connect(pipePath);
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        fn();
      } finally {
        socket.removeAllListeners();
        socket.end();
        socket.destroy();
      }
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`Timed out connecting to AssetEditor IPC pipe ${pipePath}`)));
    }, 3500);
    const clear = () => clearTimeout(timeout);
    socket.on("connect", () => {
      const request = {
        action: "open",
        path: args.path,
        bringToFront: true,
        openInExistingKitbashTab: args.openInExistingKitbashTab,
        packPathOnDisk: args.packPathOnDisk,
      };
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex).trim();
      finish(() => {
        clear();
        if (!line) {
          reject(new Error("AssetEditor IPC returned an empty response"));
          return;
        }
        try {
          resolve(JSON.parse(line) as { ok?: boolean; error?: string; normalizedPath?: string });
        } catch (error) {
          reject(
            new Error(
              `Failed to parse AssetEditor IPC response: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      });
    });
    socket.on("error", (error) => {
      finish(() => {
        clear();
        reject(new Error(`Failed to connect to ${pipePath}: ${error.message}`));
      });
    });
    socket.on("close", () => {
      if (settled) return;
      finish(() => {
        clear();
        reject(new Error("AssetEditor IPC connection closed before a response was received"));
      });
    });
  });
};
const appendCollisions = async (newPack: Pack) => {
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
const matchVanillaDBFiles = /^db\\.*\\data__/;
const appendPacksData = (newPack: Pack, mod?: Mod) => {
  const existingPack = appData.packsData.find((pack) => pack.path == newPack.path);
  console.log("appendPacksData: appending", newPack.name);
  console.log("appendPacksData: is existingPack:", !!existingPack);
  if (!existingPack) {
    appData.packsData.push(newPack);
    windows.mainWindow?.webContents.send("setPacksDataRead", [newPack.path]);
    const overwrittenFileNames = newPack.packedFiles
      .map((packedFile) => packedFile.name)
      .filter(
        (packedFileName) => packedFileName.match(matchVanillaDBFiles) || packedFileName.endsWith(".lua"),
      )
      .filter((packedFileName) => {
        let foundMatchingFile = false;
        for (const vanillaPack of appData.vanillaPacks) {
          foundMatchingFile ||= vanillaPack.packedFiles.some(
            (packedFileInData) => packedFileInData.name == packedFileName,
          );
        }
        return foundMatchingFile;
      });
    if (overwrittenFileNames.length > 0) {
      appData.overwrittenDataPackedFiles[newPack.name] = overwrittenFileNames;
      windows.mainWindow?.webContents.send(
        "setOverwrittenDataPackedFiles",
        appData.overwrittenDataPackedFiles,
      );
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
    console.log("outdatedPackFiles", outdatedPackFiles);
    if (outdatedPackFiles.size > 0) {
      appData.outdatedPackFiles[newPack.name] = Array.from(outdatedPackFiles);
      windows.mainWindow?.webContents.send("setOutdatedPackFiles", appData.outdatedPackFiles);
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
export const getLocsTrie = (pack: Pack) => {
  console.log("getLocsTrie:", pack.name);
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
const matchDBFileRegex = /^db\\(.*?)\\/;
const gameToDefaultTableVersions = {} as Record<SupportedGames, Record<string, number>>;
export const getDefaultTableVersions = async () => {
  const cachedGameToDefaultTableVersions = gameToDefaultTableVersions[appData.currentGame];
  if (cachedGameToDefaultTableVersions) return cachedGameToDefaultTableVersions;
  const dbPackName = gameToPackWithDBTablesName[appData.currentGame];
  const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
  if (!dataFolder) return;
  const dbPackPath = nodePath.join(dataFolder, dbPackName);
  let pack = appData.packsData.find((packData) => packData.path == dbPackPath);
  if (!pack || (pack && pack.packedFiles.length == 0)) {
    pack = await readPack(dbPackPath, { skipParsingTables: true });
  }
  if (!pack) return;
  const dataPackData = await readPack(dbPackPath, {
    tablesToRead: pack.packedFiles.filter((pf) => pf.name.startsWith("db\\")).map((pf) => pf.name),
  });
  const tableNameToVersion = {} as Record<string, number>;
  for (const packedFile of dataPackData.packedFiles.filter((pf) => pf.name.startsWith("db\\"))) {
    const dbNameMatch = packedFile.name.match(matchDBFileRegex);
    if (dbNameMatch != null && dbNameMatch.length > 0) {
      if (packedFile.version != undefined) {
        tableNameToVersion[dbNameMatch[1]] = packedFile.version;
      } else {
        tableNameToVersion[dbNameMatch[1]] = 0;
      }
    }
  }
  gameToDefaultTableVersions[appData.currentGame] = tableNameToVersion;
  return tableNameToVersion;
};
export const readModsByPath = async (
  modPaths: string[],
  packReadingOptions: PackReadingOptions,
  skipCollisionCheck = true,
) => {
  console.log("readModsByPath:", modPaths, "packReadingOptions:", packReadingOptions);
  // console.log("readModsByPath skipParsingTables:", skipParsingTables);
  // console.log("readModsByPath skipCollisionCheck:", skipCollisionCheck);
  // if (!skipParsingTables) {
  //   appData.packsData = appData.packsData.filter((pack) => !modPaths.some((modPath) => modPath == pack.path));
  // }
  const newPacks = [] as Pack[];
  for (const modPath of modPaths) {
    for (let i = 0; i < 20; i++) {
      if (!appData.currentlyReadingModPaths.some((path) => path == modPath)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
    if (appData.currentlyReadingModPaths.some((path) => path == modPath)) {
      console.log("already reading", modPath, "SKIPPING IT");
      continue;
    }
    // console.log("READING ", modPath, readLocs);
    appData.currentlyReadingModPaths.push(modPath);
    windows.mainWindow?.webContents.send("setCurrentlyReadingMod", modPath);
    const newPack = await readPack(modPath, packReadingOptions);
    windows.mainWindow?.webContents.send("setLastModThatWasRead", modPath);
    appData.currentlyReadingModPaths = appData.currentlyReadingModPaths.filter((path) => path != modPath);
    // if (appData.packsData.every((pack) => pack.path != modPath)) {
    appendPacksData(newPack);
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
export const registerIpcMainListeners = (
  mainWindow: Electron.CrossProcessExports.BrowserWindow,
  isDev: boolean,
) => {
  const log = (msg: string) => {
    mainWindow?.webContents.send("handleLog", msg);
    console.log(msg);
  };
  const tempModDatas: ModData[] = [];
  const sendModData = debounce(() => {
    mainWindow?.webContents.send("setModData", [...tempModDatas]);
    tempModDatas.splice(0, tempModDatas.length);
  }, 200);
  const getSkillsData = async (mods: Mod[]) => {
    console.log(
      "getSkillsData:",
      mods.map((mod) => mod.name),
    );
    const tablesToRead = resolveTable("character_skill_node_set_items_tables").map(
      (table) => `db\\${table}\\`,
    );
    const effectTablesToRead = resolveTable("character_skill_level_to_effects_junctions_tables").map(
      (table) => `db\\${table}\\`,
    );
    for (const effectTable of effectTablesToRead) {
      if (!tablesToRead.includes(effectTable)) tablesToRead.push(effectTable);
    }
    const nodeLinksTablesToRead = resolveTable("character_skill_node_links_tables").map(
      (table) => `db\\${table}\\`,
    );
    for (const nodeLinksTable of nodeLinksTablesToRead) {
      if (!tablesToRead.includes(nodeLinksTable)) tablesToRead.push(nodeLinksTable);
    }
    const skillLocksTablesToRead = resolveTable("character_skill_nodes_skill_locks_tables").map(
      (table) => `db\\${table}\\`,
    );
    for (const skillLocksTable of skillLocksTablesToRead) {
      if (!tablesToRead.includes(skillLocksTable)) tablesToRead.push(skillLocksTable);
    }
    const effectBonusValueIdsUnitSetsTablesToRead = resolveTable(
      "effect_bonus_value_ids_unit_sets_tables",
    ).map((table) => `db\\${table}\\`);
    for (const effectBonusValueIdsUnitSetsTable of effectBonusValueIdsUnitSetsTablesToRead) {
      if (!tablesToRead.includes(effectBonusValueIdsUnitSetsTable))
        tablesToRead.push(effectBonusValueIdsUnitSetsTable);
    }
    const abilityTooltipTablesToRead = [
      "effect_bonus_value_unit_ability_junctions_tables",
      "unit_abilities_tables",
      "unit_special_abilities_tables",
      "projectile_bombardments_tables",
      "projectiles_tables",
      "projectiles_explosions_tables",
      "battle_vortexs_tables",
      "_kv_unit_ability_scaling_rules_tables",
      "special_ability_to_special_ability_phase_junctions_tables",
      "special_ability_phases_tables",
      "special_ability_phase_stat_effects_tables",
      "ui_unit_stats_tables",
      "unit_abilities_to_additional_ui_effects_juncs_tables",
      "unit_abilities_additional_ui_effects_tables",
      "special_ability_groups_to_unit_abilities_junctions_tables",
      "special_ability_groups_tables",
      "special_ability_to_auto_deactivate_flags_tables",
    ];
    for (const table of abilityTooltipTablesToRead) {
      for (const resolvedTable of resolveTable(table).map((resolvedTable) => `db\\${resolvedTable}\\`)) {
        if (!tablesToRead.includes(resolvedTable)) tablesToRead.push(resolvedTable);
      }
    }
    // const effectsTablesToRead = resolveTable("effects_tables").map((table) => `db\\${table}\\`);
    // for (const effectsTable of effectsTablesToRead) {
    //   if (!tablesToRead.includes(effectsTable)) tablesToRead.push(effectsTable);
    // }
    console.log("RESOLVED tablesToRead:", tablesToRead);
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataFolder) return;
    const vanillaPacksToRead = [...appData.allVanillaPackNames]
      .filter(
        (packName) =>
          packName.startsWith("local_en") ||
          (!packName.startsWith("audio_") &&
            !packName.startsWith("local_") &&
            !packName.startsWith("models") &&
            !packName.startsWith("movies") &&
            !packName.startsWith("tile") &&
            !packName.startsWith("variants") &&
            !packName.startsWith("warmachines") &&
            !packName.startsWith("terrain")),
      )
      .map((packName) => nodePath.join(dataFolder, packName));
    const cachedVanillaSkillsCore = await getVanillaSkillsDataCoreFromCache({
      dataFolder,
      currentGame: appData.currentGame,
      userDataPath: app.getPath("userData"),
    });
    if (cachedVanillaSkillsCore) {
      console.log("getSkillsData: using cached vanilla skills core data");
      if (mods.length > 0) {
        await readMods(mods, false, true, false, true, tablesToRead);
      }
      await readModsByPath(vanillaPacksToRead, { skipParsingTables: true, readLocs: true }, true);
      const vanillaPacks = appData.packsData.filter((packsData) =>
        vanillaPacksToRead.includes(packsData.path),
      );
      const enabledModPacks = appData.packsData.filter((packData) =>
        mods.some((mod) => mod.path == packData.path),
      );
      const mergedSkillsCore = cloneSkillsDataCore(cachedVanillaSkillsCore);
      if (mods.length > 0) {
        const sortedMods = sortByNameAndLoadOrder(mods);
        const unsortedModPacksTableData = getPacksTableData(enabledModPacks, tablesToRead, true) || [];
        const orderedModPacksTableData = [] as PackViewData[];
        for (const mod of sortedMods.toReversed()) {
          const packTableData = unsortedModPacksTableData.find((ptd) => ptd.packPath == mod.path);
          if (packTableData) orderedModPacksTableData.push(packTableData);
        }
        applyModOverlayToSkillsDataCore(mergedSkillsCore, orderedModPacksTableData, getTableRowData);
      }
      const locs = getLocsFromPacks(vanillaPacks.concat(enabledModPacks), getLocsTrie);
      const skillIconPaths = getSkillAndEffectIconPaths(
        mergedSkillsCore.skills,
        mergedSkillsCore.skillsToEffects,
        mergedSkillsCore.effectsToEffectData,
      );
      const icons = await loadIconsFromPacks(vanillaPacks.concat(enabledModPacks), skillIconPaths);
      appData.skillsData = {
        ...mergedSkillsCore,
        locs,
        icons,
        skillsDataPackPaths: vanillaPacks.concat(enabledModPacks).map((pack) => pack.path),
      };
      const defaultSubtype = getDefaultSkillsSubtype(mergedSkillsCore.subtypesToSet);
      if (defaultSubtype) {
        await getSkillsForSubtype(defaultSubtype, 0);
      }
      return;
    }
    await readMods(mods, false, true, false, true, tablesToRead);
    await readModsByPath(
      vanillaPacksToRead,
      { skipParsingTables: false, readLocs: true, tablesToRead },
      true,
    );
    const unsortedPacksTableData = getPacksTableData(
      appData.packsData.filter(
        (pack) => pack.name == "db.pack" || mods.some((mod) => mod.path === pack.path),
      ),
      tablesToRead,
      true,
    );
    if (!unsortedPacksTableData) return;
    const packsTableData = [] as PackViewData[];
    // sort the mods by load priority
    const sortedMods = sortByNameAndLoadOrder(mods);
    const dbPackData = unsortedPacksTableData.find((ptd) => ptd.packName == "db.pack");
    if (dbPackData) packsTableData.push(dbPackData);
    for (const mod of sortedMods.toReversed()) {
      const packTableData = unsortedPacksTableData.find((ptd) => ptd.packPath == mod.path);
      if (packTableData) packsTableData.push(packTableData);
    }
    assert(unsortedPacksTableData.length == packsTableData.length);
    const effects: EffectData[] = [];
    getTableRowData(packsTableData, "effects_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
      const icon = schemaFieldRow.find((sF) => sF.name == "icon")?.resolvedKeyValue;
      const isPositive = schemaFieldRow.find((sF) => sF.name == "is_positive_value_good")?.resolvedKeyValue;
      const priority = schemaFieldRow.find((sF) => sF.name == "priority")?.resolvedKeyValue;
      if (key != undefined && icon != undefined && isPositive != undefined && priority != undefined) {
        const newEffect = {
          key,
          icon,
          isPositive,
          priority,
        };
        const existingIndex = effects.findIndex((effect) => effect.key == key);
        if (existingIndex > -1) {
          effects.splice(existingIndex, 1, newEffect);
        } else effects.push(newEffect);
      }
    });
    const effectsToEffectData: Record<string, EffectData> = {};
    for (const effectData of effects) {
      effectsToEffectData[effectData.key] = effectData;
    }
    const effectBonusValueIdsUnitSets: { bonusValueId: string; effect: string; unitSet: string }[] = [];
    getTableRowData(packsTableData, "effect_bonus_value_ids_unit_sets_tables", (schemaFieldRow) => {
      const bonusValueId = schemaFieldRow.find((sF) => sF.name == "bonus_value_id")?.resolvedKeyValue;
      const effect = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
      const unitSet = schemaFieldRow.find((sF) => sF.name == "unit_set")?.resolvedKeyValue;
      if (bonusValueId != undefined && effect != undefined && unitSet != undefined)
        effectBonusValueIdsUnitSets.push({
          bonusValueId,
          effect,
          unitSet,
        });
    });
    const effectToEffectBonusValueIdsUnitSetsData: Record<string, (typeof effectBonusValueIdsUnitSets)[0]> =
      {};
    for (const effectBonusValueIdsUnitSet of effectBonusValueIdsUnitSets) {
      effectToEffectBonusValueIdsUnitSetsData[effectBonusValueIdsUnitSet.effect] = effectBonusValueIdsUnitSet;
    }
    const subtypeAndSets: {
      key: string;
      agentSubtype: string;
      agentKey: string;
      campaignKey: string;
      factionKey: string;
      subculture: string;
      forArmy: string;
      forNavy: string;
    }[] = [];
    getTableRowData(packsTableData, "character_skill_node_sets_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const agentSubtype = schemaFieldRow.find((sF) => sF.name == "agent_subtype_key")?.resolvedKeyValue;
      const agentKey = schemaFieldRow.find((sF) => sF.name == "agent_key")?.resolvedKeyValue || "";
      const campaignKey = schemaFieldRow.find((sF) => sF.name == "campaign_key")?.resolvedKeyValue || "";
      const factionKey = schemaFieldRow.find((sF) => sF.name == "faction_key")?.resolvedKeyValue || "";
      const subculture = schemaFieldRow.find((sF) => sF.name == "subculture")?.resolvedKeyValue || "";
      const forArmy = schemaFieldRow.find((sF) => sF.name == "for_army")?.resolvedKeyValue || "false";
      const forNavy = schemaFieldRow.find((sF) => sF.name == "for_navy")?.resolvedKeyValue || "false";
      if (key && agentSubtype) {
        const newSubtypeAndSets = {
          key,
          agentSubtype,
          agentKey,
          campaignKey,
          factionKey,
          subculture,
          forArmy,
          forNavy,
        };
        const existingIndex = subtypeAndSets.findIndex((sas) => sas.key == key);
        if (existingIndex > -1) {
          subtypeAndSets.splice(existingIndex, 1, newSubtypeAndSets);
        } else subtypeAndSets.push(newSubtypeAndSets);
      }
    });
    const subtypesToSet: Record<string, string[]> = {};
    for (const { key, agentSubtype } of subtypeAndSets) {
      subtypesToSet[agentSubtype] = subtypesToSet[agentSubtype] || [];
      if (!subtypesToSet[agentSubtype].includes(key)) subtypesToSet[agentSubtype].push(key);
    }
    const setAndNodes: { set: string; node: string; modDisabled: string }[] = [];
    getTableRowData(packsTableData, "character_skill_node_set_items_tables", (schemaFieldRow) => {
      const set = schemaFieldRow.find((sF) => sF.name == "set")?.resolvedKeyValue;
      const node = schemaFieldRow.find((sF) => sF.name == "item")?.resolvedKeyValue;
      const modDisabled = schemaFieldRow.find((sF) => sF.name == "mod_disabled")?.resolvedKeyValue;
      if (set && node && modDisabled != undefined)
        setAndNodes.push({
          set,
          node,
          modDisabled,
        });
    });
    const setToNodes: Record<string, string[]> = {};
    for (const setAndNode of setAndNodes) {
      const set = setAndNode.set;
      if (!setToNodes[set]) setToNodes[set] = [];
      if (!setToNodes[set].includes(setAndNode.node)) setToNodes[set].push(setAndNode.node);
    }
    // set to node table can also be used to disable nodes for a set
    const setToNodesDisables: Record<string, string[]> = {};
    for (const setAndNode of setAndNodes) {
      const set = setAndNode.set;
      if (setAndNode.modDisabled == "0") continue;
      if (!setToNodesDisables[set]) setToNodesDisables[set] = [];
      if (!setToNodesDisables[set].includes(setAndNode.node)) setToNodesDisables[set].push(setAndNode.node);
    }
    // console.log("setToNodesDisables:", setToNodesDisables);
    // console.log("setToNodes KF:", setToNodes["wh_main_skill_node_set_emp_karl_franz"]);
    const nodeLinks: NodeLinks = {};
    getTableRowData(packsTableData, "character_skill_node_links_tables", (schemaFieldRow) => {
      const child_key = schemaFieldRow.find((sF) => sF.name == "child_key")?.resolvedKeyValue;
      const parent_key = schemaFieldRow.find((sF) => sF.name == "parent_key")?.resolvedKeyValue;
      const link_type = schemaFieldRow.find((sF) => sF.name == "link_type")?.resolvedKeyValue;
      const parent_link_position = schemaFieldRow.find(
        (sF) => sF.name == "parent_link_position",
      )?.resolvedKeyValue;
      const child_link_position = schemaFieldRow.find(
        (sF) => sF.name == "child_link_position",
      )?.resolvedKeyValue;
      if (
        child_key != undefined &&
        parent_key != undefined &&
        parent_link_position != undefined &&
        link_type != undefined &&
        (link_type == "REQUIRED" || link_type == "SUBSET_REQUIRED") &&
        child_link_position != undefined
      ) {
        nodeLinks[parent_key] = nodeLinks[parent_key] || [];
        nodeLinks[parent_key].push({
          child: child_key,
          childLinkPosition: child_link_position,
          parentLinkPosition: parent_link_position,
          linkType: link_type,
        });
      }
    });
    const nodeAndSkills: NodeSkill[] = [];
    getTableRowData(packsTableData, "character_skill_nodes_tables", (schemaFieldRow) => {
      const node = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const skill = schemaFieldRow.find((sF) => sF.name == "character_skill_key")?.resolvedKeyValue;
      const tier = schemaFieldRow.find((sF) => sF.name == "tier")?.resolvedKeyValue;
      const indent = schemaFieldRow.find((sF) => sF.name == "indent")?.resolvedKeyValue;
      const factionKey = schemaFieldRow.find((sF) => sF.name == "faction_key")?.resolvedKeyValue;
      const subculture = schemaFieldRow.find((sF) => sF.name == "subculture")?.resolvedKeyValue;
      const requiredNumParents = schemaFieldRow.find(
        (sF) => sF.name == "required_num_parents",
      )?.resolvedKeyValue;
      const visibleInUI = schemaFieldRow.find((sF) => sF.name == "visible_in_ui")?.resolvedKeyValue as
        | "0"
        | "1";
      if (
        node &&
        skill &&
        tier != undefined &&
        indent != undefined &&
        visibleInUI != undefined &&
        factionKey != undefined &&
        subculture != undefined &&
        requiredNumParents != undefined &&
        (visibleInUI == "0" || visibleInUI == "1")
      ) {
        const newNodeAndSkill = {
          node,
          skill,
          tier,
          indent,
          visibleInUI,
          factionKey,
          subculture,
          requiredNumParents: Number.parseInt(requiredNumParents),
        };
        const existingIndex = nodeAndSkills.findIndex((nas) => nas.node == node);
        if (existingIndex > -1) {
          nodeAndSkills.splice(existingIndex, 1, newNodeAndSkill);
        } else nodeAndSkills.push(newNodeAndSkill);
      }
    });
    const nodeToSkill: Record<string, (typeof nodeAndSkills)[0]> = {};
    for (const nodeAndSkill of nodeAndSkills) {
      nodeToSkill[nodeAndSkill.node] = nodeAndSkill;
    }
    const skills: SkillAndIcons = [];
    getTableRowData(packsTableData, "character_skills_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const iconPath = schemaFieldRow.find((sF) => sF.name == "image_path")?.resolvedKeyValue;
      const unlockRank = schemaFieldRow.find((sF) => sF.name == "unlocked_at_rank")?.resolvedKeyValue;
      if (key != undefined && iconPath != undefined && unlockRank != undefined) {
        const newSkill = {
          key,
          iconPath,
          maxLevel: 1,
          unlockRank: Number(unlockRank),
        };
        const existingIndex = skills.findIndex((skill) => skill.key == key);
        if (existingIndex > -1) {
          skills.splice(existingIndex, 1, newSkill);
        } else skills.push(newSkill);
      }
    });
    const nodeToSkillLocks = {} as NodeToSkillLocks;
    getTableRowData(packsTableData, "character_skill_nodes_skill_locks_tables", (schemaFieldRow) => {
      const skill = schemaFieldRow.find((sF) => sF.name == "character_skill")?.resolvedKeyValue;
      const skillNode = schemaFieldRow.find((sF) => sF.name == "character_skill_node")?.resolvedKeyValue;
      const level = schemaFieldRow.find((sF) => sF.name == "level")?.resolvedKeyValue;
      if (skill != undefined && skillNode != undefined && level != undefined) {
        nodeToSkillLocks[skillNode] = nodeToSkillLocks[skillNode] || [];
        const levelAsNumber = Number(level);
        if (
          !nodeToSkillLocks[skillNode].find(
            (iterSkillLevel) => iterSkillLevel[0] == skill && iterSkillLevel[1] == levelAsNumber,
          )
        ) {
          nodeToSkillLocks[skillNode].push([skill, levelAsNumber]);
        }
      }
    });
    const skillsAndEffects: Effect[] = [];
    getTableRowData(packsTableData, "character_skill_level_to_effects_junctions_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "character_skill_key")?.resolvedKeyValue;
      const effectScope = schemaFieldRow.find((sF) => sF.name == "effect_scope")?.resolvedKeyValue;
      const level = schemaFieldRow.find((sF) => sF.name == "level")?.resolvedKeyValue;
      const value = schemaFieldRow.find((sF) => sF.name == "value")?.resolvedKeyValue;
      const effectKey = schemaFieldRow.find((sF) => sF.name == "effect_key")?.resolvedKeyValue;
      if (
        key != undefined &&
        effectScope != undefined &&
        level != undefined &&
        value != undefined &&
        effectKey != undefined
      ) {
        if (!effectsToEffectData[effectKey]) {
          console.error("MISSING ICON FOR EFFECT", effectKey);
        }
        skillsAndEffects.push({
          key,
          effectScope,
          level: Number(level),
          value,
          effectKey,
          iconData: "",
          icon: effectsToEffectData[effectKey]?.icon,
          priority: effectsToEffectData[effectKey]?.priority,
        });
      }
    });
    const skillsToEffects: Record<string, (typeof skillsAndEffects)[0][]> = {};
    for (const skillAndEffect of skillsAndEffects) {
      const key = skillAndEffect.key;
      if (!skillsToEffects[key]) skillsToEffects[key] = [];
      skillsToEffects[key].push(skillAndEffect);
    }
    for (const skill of Object.keys(skillsToEffects)) {
      let maxLevel = 1;
      const effects = skillsToEffects[skill];
      for (let i = 0; i < effects.length; i++) {
        if (effects[i].level > maxLevel) maxLevel = effects[i].level;
      }
      const skillInSkills = skills.find((skillIter) => skillIter.key == skill);
      if (skillInSkills) skillInSkills.maxLevel = maxLevel;
    }
    const parseNumber = (value: string | undefined) => {
      if (value == undefined || value === "") return 0;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const parseBool = (value: string | undefined) => value == "true" || value == "1";
    const effectToUnitAbilityEnables = {} as Record<string, AbilityEnableMapping[]>;
    getTableRowData(packsTableData, "effect_bonus_value_unit_ability_junctions_tables", (schemaFieldRow) => {
      const effect = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
      const bonusValueId = schemaFieldRow.find((sF) => sF.name == "bonus_value_id")?.resolvedKeyValue;
      const unitAbilityKey = schemaFieldRow.find((sF) => sF.name == "unit_ability")?.resolvedKeyValue;
      if (!effect || !bonusValueId || !unitAbilityKey) return;
      if (!bonusValueId.startsWith("enable")) return;
      effectToUnitAbilityEnables[effect] = effectToUnitAbilityEnables[effect] || [];
      if (
        !effectToUnitAbilityEnables[effect].some(
          (iterEntry) => iterEntry.unitAbilityKey == unitAbilityKey && iterEntry.bonusValueId == bonusValueId,
        )
      ) {
        effectToUnitAbilityEnables[effect].push({
          unitAbilityKey,
          bonusValueId,
        });
      }
    });
    const unitAbilitiesByKey = {} as Record<
      string,
      { key: string; iconName: string; type: string; sourceType: string; overpowerOption?: string }
    >;
    getTableRowData(packsTableData, "unit_abilities_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const iconName = schemaFieldRow.find((sF) => sF.name == "icon_name")?.resolvedKeyValue;
      const type = schemaFieldRow.find((sF) => sF.name == "type")?.resolvedKeyValue;
      const sourceType = schemaFieldRow.find((sF) => sF.name == "source_type")?.resolvedKeyValue;
      const overpowerOption = schemaFieldRow.find((sF) => sF.name == "overpower_option")?.resolvedKeyValue;
      if (!key || !iconName || !type || !sourceType) return;
      unitAbilitiesByKey[key] = {
        key,
        iconName,
        type,
        sourceType,
        overpowerOption: overpowerOption || undefined,
      };
    });
    const unitSpecialAbilitiesByKey = {} as Record<
      string,
      {
        key: string;
        targetInterceptRange: number;
        rechargeTime: number;
        activeTime: number;
        effectRange: number;
        affectSelf: boolean;
        numEffectedFriendlyUnits: number;
        numEffectedEnemyUnits: number;
        targetFriends: boolean;
        targetEnemies: boolean;
        targetSelf: boolean;
        manaCost: number;
        miscastChance: number;
        minRange: number;
        activatedProjectile?: string;
        bombardment?: string;
        vortex?: string;
      }
    >;
    getTableRowData(packsTableData, "unit_special_abilities_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      if (!key) return;
      unitSpecialAbilitiesByKey[key] = {
        key,
        targetInterceptRange: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "target_intercept_range")?.resolvedKeyValue,
        ),
        rechargeTime: parseNumber(schemaFieldRow.find((sF) => sF.name == "recharge_time")?.resolvedKeyValue),
        activeTime: parseNumber(schemaFieldRow.find((sF) => sF.name == "active_time")?.resolvedKeyValue),
        effectRange: parseNumber(schemaFieldRow.find((sF) => sF.name == "effect_range")?.resolvedKeyValue),
        affectSelf: parseBool(schemaFieldRow.find((sF) => sF.name == "affect_self")?.resolvedKeyValue),
        numEffectedFriendlyUnits: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "num_effected_friendly_units")?.resolvedKeyValue,
        ),
        numEffectedEnemyUnits: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "num_effected_enemy_units")?.resolvedKeyValue,
        ),
        targetFriends: parseBool(schemaFieldRow.find((sF) => sF.name == "target_friends")?.resolvedKeyValue),
        targetEnemies: parseBool(schemaFieldRow.find((sF) => sF.name == "target_enemies")?.resolvedKeyValue),
        targetSelf: parseBool(schemaFieldRow.find((sF) => sF.name == "target_self")?.resolvedKeyValue),
        manaCost: parseNumber(schemaFieldRow.find((sF) => sF.name == "mana_cost")?.resolvedKeyValue),
        miscastChance: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "miscast_chance")?.resolvedKeyValue,
        ),
        minRange: parseNumber(schemaFieldRow.find((sF) => sF.name == "min_range")?.resolvedKeyValue),
        activatedProjectile:
          schemaFieldRow.find((sF) => sF.name == "activated_projectile")?.resolvedKeyValue || undefined,
        bombardment: schemaFieldRow.find((sF) => sF.name == "bombardment")?.resolvedKeyValue || undefined,
        vortex: schemaFieldRow.find((sF) => sF.name == "vortex")?.resolvedKeyValue || undefined,
      };
    });
    const bombardmentsByKey = {} as Record<
      string,
      { key: string; numProjectiles: number; projectileType: string }
    >;
    getTableRowData(packsTableData, "projectile_bombardments_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "bombardment_key")?.resolvedKeyValue;
      const projectileType = schemaFieldRow.find((sF) => sF.name == "projectile_type")?.resolvedKeyValue;
      const numProjectiles = parseNumber(
        schemaFieldRow.find((sF) => sF.name == "num_projectiles")?.resolvedKeyValue,
      );
      if (!key || !projectileType) return;
      bombardmentsByKey[key] = {
        key,
        projectileType,
        numProjectiles,
      };
    });
    const projectilesByKey = {} as Record<
      string,
      {
        key: string;
        damage: number;
        apDamage: number;
        projectileNumber: number;
        explosionType?: string;
        spawnedVortex?: string;
      }
    >;
    getTableRowData(packsTableData, "projectiles_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      if (!key) return;
      projectilesByKey[key] = {
        key,
        damage: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage")?.resolvedKeyValue),
        apDamage: parseNumber(schemaFieldRow.find((sF) => sF.name == "ap_damage")?.resolvedKeyValue),
        projectileNumber: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "projectile_number")?.resolvedKeyValue,
        ),
        explosionType:
          schemaFieldRow.find((sF) => sF.name == "explosion_type")?.resolvedKeyValue || undefined,
        spawnedVortex:
          schemaFieldRow.find((sF) => sF.name == "spawned_vortex")?.resolvedKeyValue || undefined,
      };
    });
    const explosionsByKey = {} as Record<
      string,
      {
        key: string;
        detonationDamage: number;
        detonationDamageAp: number;
        detonationRadius: number;
        detonationDuration: number;
      }
    >;
    getTableRowData(packsTableData, "projectiles_explosions_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      if (!key) return;
      explosionsByKey[key] = {
        key,
        detonationDamage: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "detonation_damage")?.resolvedKeyValue,
        ),
        detonationDamageAp: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "detonation_damage_ap")?.resolvedKeyValue,
        ),
        detonationRadius: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "detonation_radius")?.resolvedKeyValue,
        ),
        detonationDuration: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "detonation_duration")?.resolvedKeyValue,
        ),
      };
    });
    const vortexesByKey = {} as Record<
      string,
      {
        key: string;
        damage: number;
        damageAp: number;
        duration: number;
        goalRadius: number;
        startRadius: number;
        movementSpeed: number;
        numVortexes: number;
      }
    >;
    getTableRowData(packsTableData, "battle_vortexs_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "vortex_key")?.resolvedKeyValue;
      if (!key) return;
      vortexesByKey[key] = {
        key,
        damage: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage")?.resolvedKeyValue),
        damageAp: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage_ap")?.resolvedKeyValue),
        duration: parseNumber(schemaFieldRow.find((sF) => sF.name == "duration")?.resolvedKeyValue),
        goalRadius: parseNumber(schemaFieldRow.find((sF) => sF.name == "goal_radius")?.resolvedKeyValue),
        startRadius: parseNumber(schemaFieldRow.find((sF) => sF.name == "start_radius")?.resolvedKeyValue),
        movementSpeed: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "movement_speed")?.resolvedKeyValue,
        ),
        numVortexes: parseNumber(schemaFieldRow.find((sF) => sF.name == "num_vortexes")?.resolvedKeyValue),
      };
    });
    const abilityToPhaseIds = {} as Record<string, string[]>;
    getTableRowData(
      packsTableData,
      "special_ability_to_special_ability_phase_junctions_tables",
      (schemaFieldRow) => {
        const abilityKey = schemaFieldRow.find((sF) => sF.name == "special_ability")?.resolvedKeyValue;
        const phaseId = schemaFieldRow.find((sF) => sF.name == "phase")?.resolvedKeyValue;
        if (!abilityKey || !phaseId) return;
        abilityToPhaseIds[abilityKey] = abilityToPhaseIds[abilityKey] || [];
        if (!abilityToPhaseIds[abilityKey].includes(phaseId)) abilityToPhaseIds[abilityKey].push(phaseId);
      },
    );
    const phasesById = {} as Record<
      string,
      {
        id: string;
        damageAmount: number;
        maxDamagedEntities: number;
        hpChangeFrequency: number;
        duration: number;
        fatigueChangeRatio: number;
        affectsAllies: boolean;
        affectsEnemies: boolean;
      }
    >;
    getTableRowData(packsTableData, "special_ability_phases_tables", (schemaFieldRow) => {
      const id = schemaFieldRow.find((sF) => sF.name == "id")?.resolvedKeyValue;
      if (!id) return;
      phasesById[id] = {
        id,
        damageAmount: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage_amount")?.resolvedKeyValue),
        maxDamagedEntities: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "max_damaged_entities")?.resolvedKeyValue,
        ),
        hpChangeFrequency: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "hp_change_frequency")?.resolvedKeyValue,
        ),
        duration: parseNumber(schemaFieldRow.find((sF) => sF.name == "duration")?.resolvedKeyValue),
        fatigueChangeRatio: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "fatigue_change_ratio")?.resolvedKeyValue,
        ),
        affectsAllies: parseBool(schemaFieldRow.find((sF) => sF.name == "affects_allies")?.resolvedKeyValue),
        affectsEnemies: parseBool(
          schemaFieldRow.find((sF) => sF.name == "affects_enemies")?.resolvedKeyValue,
        ),
      };
    });
    const phaseStatEffectsByPhaseId = {} as Record<string, { stat: string; value: number; how: string }[]>;
    getTableRowData(packsTableData, "special_ability_phase_stat_effects_tables", (schemaFieldRow) => {
      const phase = schemaFieldRow.find((sF) => sF.name == "phase")?.resolvedKeyValue;
      const stat = schemaFieldRow.find((sF) => sF.name == "stat")?.resolvedKeyValue;
      const value = parseNumber(schemaFieldRow.find((sF) => sF.name == "value")?.resolvedKeyValue);
      const how = schemaFieldRow.find((sF) => sF.name == "how")?.resolvedKeyValue;
      if (!phase || !stat || !how) return;
      phaseStatEffectsByPhaseId[phase] = phaseStatEffectsByPhaseId[phase] || [];
      const existing = phaseStatEffectsByPhaseId[phase].find(
        (iterEffect) => iterEffect.stat == stat && iterEffect.how == how,
      );
      if (existing) {
        existing.value = value;
      } else {
        phaseStatEffectsByPhaseId[phase].push({ stat, value, how });
      }
    });
    const uiUnitStatIconsByStat = {} as Record<string, string>;
    getTableRowData(packsTableData, "ui_unit_stats_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const icon = schemaFieldRow.find((sF) => sF.name == "icon")?.resolvedKeyValue;
      if (!key || !icon) return;
      uiUnitStatIconsByStat[key] = icon;
    });
    let kvDirectDamageMinUnary = 0.5;
    let kvDirectDamageLarge = 0.75;
    getTableRowData(packsTableData, "_kv_unit_ability_scaling_rules_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const value = parseNumber(schemaFieldRow.find((sF) => sF.name == "value")?.resolvedKeyValue);
      if (key == "direct_damage_damage_scale_min_unary") kvDirectDamageMinUnary = value;
      if (key == "direct_damage_large") kvDirectDamageLarge = value;
    });
    const abilityToAdditionalUiEffectKeys = {} as Record<string, string[]>;
    getTableRowData(
      packsTableData,
      "unit_abilities_to_additional_ui_effects_juncs_tables",
      (schemaFieldRow) => {
        const ability = schemaFieldRow.find((sF) => sF.name == "ability")?.resolvedKeyValue;
        const effect = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
        if (!ability || !effect) return;
        abilityToAdditionalUiEffectKeys[ability] = abilityToAdditionalUiEffectKeys[ability] || [];
        if (!abilityToAdditionalUiEffectKeys[ability].includes(effect)) {
          abilityToAdditionalUiEffectKeys[ability].push(effect);
        }
      },
    );
    const additionalUiEffectsByKey = {} as Record<
      string,
      { key: string; sortOrder: number; effectState: string }
    >;
    getTableRowData(packsTableData, "unit_abilities_additional_ui_effects_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const sortOrder = parseNumber(schemaFieldRow.find((sF) => sF.name == "sort_order")?.resolvedKeyValue);
      const effectState =
        schemaFieldRow.find((sF) => sF.name == "effect_state")?.resolvedKeyValue?.toString() || "";
      if (!key) return;
      additionalUiEffectsByKey[key] = { key, sortOrder, effectState };
    });
    const abilityToAutoDeactivateFlags = {} as Record<string, string[]>;
    getTableRowData(packsTableData, "special_ability_to_auto_deactivate_flags_tables", (schemaFieldRow) => {
      const ability = schemaFieldRow.find((sF) => sF.name == "special_ability")?.resolvedKeyValue;
      const deactivateFlag = schemaFieldRow.find((sF) => sF.name == "deactivate_flag")?.resolvedKeyValue;
      if (!ability || !deactivateFlag) return;
      abilityToAutoDeactivateFlags[ability] = abilityToAutoDeactivateFlags[ability] || [];
      if (!abilityToAutoDeactivateFlags[ability].includes(deactivateFlag)) {
        abilityToAutoDeactivateFlags[ability].push(deactivateFlag);
      }
    });
    const abilityToGroupKeys = {} as Record<string, string[]>;
    getTableRowData(
      packsTableData,
      "special_ability_groups_to_unit_abilities_junctions_tables",
      (schemaFieldRow) => {
        const group = schemaFieldRow.find((sF) => sF.name == "special_ability_groups")?.resolvedKeyValue;
        const ability = schemaFieldRow.find((sF) => sF.name == "unit_special_abilities")?.resolvedKeyValue;
        if (!ability || !group) return;
        abilityToGroupKeys[ability] = abilityToGroupKeys[ability] || [];
        if (!abilityToGroupKeys[ability].includes(group)) abilityToGroupKeys[ability].push(group);
      },
    );
    const specialAbilityGroupsByKey = {} as Record<string, { key: string; iconPath: string }>;
    getTableRowData(packsTableData, "special_ability_groups_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "ability_group")?.resolvedKeyValue;
      const iconPath = schemaFieldRow.find((sF) => sF.name == "icon_path")?.resolvedKeyValue;
      if (!key || !iconPath) return;
      specialAbilityGroupsByKey[key] = {
        key,
        iconPath,
      };
    });
    // const set = subtypeToSet["wh_main_emp_karl_franz"];
    // const nodes = setToNodes[set];
    // for (const node of nodes) {
    //   const nodeAndSkill = nodeToSkill[node];
    //   const skill = nodeAndSkill.skill;
    //   console.log("skill", skill);
    //   const effects = skillsToEffects[skill];
    //   for (const effect of effects) {
    //     console.log("effect", effect);
    //   }
    // }
    const skillIconPaths = getSkillAndEffectIconPaths(skills, skillsToEffects, effectsToEffectData);
    // const readList1 = appData.packsData.filter((packsData) =>
    //   mods.map((mod) => mod.name).includes(packsData.name)
    // );
    // const readList2 = appData.packsData.filter((packsData) => vanillaPacksToRead.includes(packsData.path));
    // console.log(
    //   "readList1:",
    //   readList1.map((mod) => mod.name)
    // );
    // console.log(
    //   "readList2:",
    //   readList2.map((mod) => mod.name)
    // );
    const enabledModPacks = appData.packsData.filter((packsData) =>
      mods.map((mod) => mod.name).includes(packsData.name),
    );
    // for (const pack of enabledModPacks)
    //   await readFromExistingPack(pack, { filesToRead: skillIconPaths, skipParsingTables: true });
    console.log("vanillaPacksToRead", vanillaPacksToRead);
    console.log(
      "vanillaPacksToRead ARE:",
      appData.packsData
        .filter((packsData) => vanillaPacksToRead.includes(packsData.path))
        .map((pack) => pack.path),
    );
    const vanillaPacks = appData.packsData.filter((packsData) => vanillaPacksToRead.includes(packsData.path));
    const icons = await loadIconsFromPacks(vanillaPacks.concat(enabledModPacks), skillIconPaths);
    const locs = getLocsFromPacks(
      appData.packsData.filter(
        (packsData) =>
          mods.map((mod) => mod.name).includes(packsData.name) || vanillaPacks.includes(packsData),
      ),
      getLocsTrie,
    );
    const packNameToLocEntries: Record<string, Record<string, string>> = {};
    for (const packName of Object.keys(locs)) {
      packNameToLocEntries[packName] = locs[packName].getEntries();
    }
    // fs.writeFileSync("dumps/iconPaths.json", JSON.stringify(skillIconPaths));
    // fs.writeFileSync("dumps/locs.json", JSON.stringify(packNameToLocEntries));
    // fs.writeFileSync("dumps/packsTableData.json", JSON.stringify(packsTableData));
    // fs.writeFileSync("dumps/subtypeAndSets.json", JSON.stringify(subtypeAndSets));
    // fs.writeFileSync("dumps/setAndNodes.json", JSON.stringify(setAndNodes));
    // fs.writeFileSync("dumps/nodeAndSkills.json", JSON.stringify(nodeAndSkills));
    // fs.writeFileSync("dumps/skills.json", JSON.stringify(skills));
    // fs.writeFileSync("dumps/skillsAndEffects.json", JSON.stringify(skillsAndEffects));
    // fs.writeFileSync("dumps/subtypeAndSets.json", JSON.stringify(subtypeAndSets));
    // fs.writeFileSync("dumps/subtypeToSet.json", JSON.stringify(subtypesToSet));
    // fs.writeFileSync("dumps/setToNodes.json", JSON.stringify(setToNodes));
    // fs.writeFileSync("dumps/nodeToSkill.json", JSON.stringify(nodeToSkill));
    // fs.writeFileSync("dumps/skillsToEffects.json", JSON.stringify(skillsToEffects));
    // fs.writeFileSync("dumps/nodeLinks.json", JSON.stringify(nodeLinks));
    // fs.writeFileSync("dumps/effectsToEffectData.json", JSON.stringify(effectsToEffectData));
    // fs.writeFileSync(
    //   "dumps/effectToEffectBonusValueIdsUnitSetsData.json",
    //   JSON.stringify(effectToEffectBonusValueIdsUnitSetsData)
    // );
    for (const [set, setToNodesToDisable] of Object.entries(setToNodesDisables)) {
      const nodes = setToNodes[set];
      const lenBefore = nodes.length;
      setToNodes[set] = setToNodes[set].filter((node) => !setToNodesToDisable.includes(node));
      const lenAfter = setToNodes[set].length;
      if (lenBefore != lenAfter) {
        console.log("from set", set, "removed", lenBefore - lenAfter, "elements");
      }
    }
    const setKF = subtypesToSet["wh_main_emp_karl_franz"][0];
    const skillsDataPackPaths = vanillaPacks.concat(enabledModPacks).map((pack) => pack.path);
    appData.skillsData = {
      subtypesToSet,
      subtypeAndSets,
      setToNodes,
      nodeLinks,
      nodeToSkill,
      skillsToEffects,
      nodeToSkillLocks,
      skills,
      locs,
      icons,
      effectsToEffectData,
      skillsDataPackPaths,
      effectToUnitAbilityEnables,
      unitAbilitiesByKey,
      unitSpecialAbilitiesByKey,
      bombardmentsByKey,
      projectilesByKey,
      explosionsByKey,
      vortexesByKey,
      abilityToPhaseIds,
      phasesById,
      phaseStatEffectsByPhaseId,
      uiUnitStatIconsByStat,
      kvDirectDamageMinUnary,
      kvDirectDamageLarge,
      abilityToAdditionalUiEffectKeys,
      additionalUiEffectsByKey,
      abilityToAutoDeactivateFlags,
      abilityToGroupKeys,
      specialAbilityGroupsByKey,
    };
    if (!cachedVanillaSkillsCore) {
      if (mods.length === 0) {
        void saveVanillaSkillsDataCoreCache({
          dataFolder,
          currentGame: appData.currentGame,
          userDataPath: app.getPath("userData"),
          skillsData: appData.skillsData,
        });
      } else if (dbPackData) {
        // Seed vanilla cache from db.pack only, even on a modded cold start.
        const vanillaCoreForCache = createEmptySkillsDataCore();
        applyModOverlayToSkillsDataCore(vanillaCoreForCache, [dbPackData], getTableRowData);
        void saveVanillaSkillsDataCoreCache({
          dataFolder,
          currentGame: appData.currentGame,
          userDataPath: app.getPath("userData"),
          skillsData: {
            ...vanillaCoreForCache,
            locs: {},
            icons: {},
            skillsDataPackPaths: [],
          },
        });
      }
    }
    const nodesKF = setToNodes[setKF];
    // fs.writeFileSync("dumps/nodeToSkill.json", JSON.stringify(nodeToSkill));
    // fs.writeFileSync("dumps/setToNodes.json", JSON.stringify(setToNodes));
    // fs.writeFileSync("dumps/nodeLinks.json", JSON.stringify(nodeLinks));
    // fs.writeFileSync("dumps/nodesKF.json", JSON.stringify(nodesKF));
    const nodesToParents = getNodesToParents(nodesKF, nodeLinks, nodeToSkill, skillsToEffects);
    // fs.writeFileSync("dumps/nodesToParents.json", JSON.stringify(nodesToParents));
    const kfSkills = getSkills(nodesKF, nodeLinks, nodeToSkill, nodesToParents, skillsToEffects, skills);
    // const nodeToSkillsKF = nodesKF.reduce((acc, current) => {
    //   acc[current] = nodeToSkill[current];
    //   return acc;
    // }, {} as Record<string, (typeof nodeAndSkills)[0]>);
    // fs.writeFileSync("dumps/kfSkills.json", JSON.stringify(kfSkills));
    // fs.writeFileSync("dumps/nodeToSkillsKF.json", JSON.stringify(nodeToSkillsKF));
    const getLoc = (locId: string) => {
      for (const locsInPack of Object.values(locs)) {
        const localized = locsInPack.get(locId);
        if (localized) return localized;
      }
    };
    appendLocalizationsToSkills(kfSkills, getLoc);
    const effectKeysForCurrentSkills = Array.from(
      new Set(kfSkills.flatMap((skill) => skill.effects.map((effect) => effect.effectKey))),
    );
    const {
      abilityTooltipsByKey: kfAbilityTooltipsByKey,
      reducedEffectToUnitAbilityEnables: kfEffectToUnitAbilityEnables,
      iconPathsToLoad: kfAbilityIconPaths,
    } = buildAbilityTooltipDataForEffects({
      effectKeys: effectKeysForCurrentSkills,
      effectToUnitAbilityEnables,
      unitAbilitiesByKey,
      unitSpecialAbilitiesByKey,
      bombardmentsByKey,
      projectilesByKey,
      explosionsByKey,
      vortexesByKey,
      abilityToPhaseIds,
      phasesById,
      phaseStatEffectsByPhaseId,
      uiUnitStatIconsByStat,
      kvDirectDamageMinUnary,
      kvDirectDamageLarge,
      abilityToAdditionalUiEffectKeys,
      additionalUiEffectsByKey,
      abilityToAutoDeactivateFlags,
      abilityToGroupKeys,
      specialAbilityGroupsByKey,
      getLoc,
    });
    const missingAbilityIconPaths = kfAbilityIconPaths.filter((iconPath) => !icons[iconPath]);
    if (missingAbilityIconPaths.length > 0) {
      for (const pack of vanillaPacks.concat(enabledModPacks)) {
        await readFromExistingPack(pack, { filesToRead: missingAbilityIconPaths, skipParsingTables: true });
      }
      for (const pack of vanillaPacks.concat(enabledModPacks)) {
        for (const iconPath of missingAbilityIconPaths) {
          const iconIndex = bs(pack.packedFiles, iconPath, (a: PackedFile, b: string) =>
            collator.compare(a.name, b),
          );
          if (iconIndex < 0) continue;
          const iconPackedFile = pack.packedFiles[iconIndex];
          if (!iconPackedFile.buffer) continue;
          icons[iconPath] = iconPackedFile.buffer.toString("base64");
        }
      }
    }
    const subtypes = Object.keys(subtypesToSet);
    const subtypeToNumSets = subtypes.reduce(
      (acc, curr) => {
        acc[curr] = subtypesToSet[curr].length;
        return acc;
      },
      {} as Record<string, number>,
    );
    const nodeRequirements = getNodeRequirements(nodeLinks, nodeToSkill);
    const characterEffectKeys = new Set<string>();
    for (const effect of skillsAndEffects) {
      if (effect.effectScope.startsWith("character_")) {
        characterEffectKeys.add(effect.effectKey);
      }
    }
    const allEffects = Object.values(effectsToEffectData)
      .filter((ed) => characterEffectKeys.has(ed.key))
      .map((ed) => ({
        effectKey: ed.key,
        localizedKey: getRawEffectLocalization(ed.key, getLoc),
        icon: ed.icon,
        priority: ed.priority,
      }));
    const allSkillIcons = Object.keys(icons)
      .filter((iconPath) => iconPath.startsWith("ui\\campaign ui\\skills\\"))
      .sort()
      .map((iconPath) => ({
        path: iconPath,
        name: iconPath.replace("ui\\campaign ui\\skills\\", "").replace(/\.(png|jpg|jpeg)$/i, ""),
      }));
    const allSkills = skills.map((skill) => {
      const effects = (skillsToEffects[skill.key] || []).map((e) => ({
        effectKey: e.effectKey,
        effectScope: e.effectScope,
        level: e.level,
        value: e.value,
        icon: e.icon,
        priority: e.priority,
      }));
      return {
        key: skill.key,
        localizedName: getLoc(`character_skills_localised_name_${skill.key}`) || skill.key,
        localizedDescription: getLoc(`character_skills_localised_description_${skill.key}`) || "",
        iconPath: skill.iconPath,
        maxLevel: skill.maxLevel,
        unlockRank: skill.unlockRank,
        effects,
      };
    });
    appData.queuedSkillsData = {
      // subtypeToSkills: { wh_main_emp_karl_franz: kfSkills },
      currentSubtype: "wh_main_emp_karl_franz",
      currentSubtypeIndex: 0,
      subtypeToNumSets,
      subtypesToSet,
      subtypeAndSets,
      currentSkills: kfSkills,
      nodeLinks,
      nodeRequirements,
      icons,
      subtypes,
      nodeToSkillLocks,
      abilityTooltipsByKey: kfAbilityTooltipsByKey,
      effectToUnitAbilityEnables: kfEffectToUnitAbilityEnables,
      allEffects,
      allSkills,
      allSkillIcons,
      subtypesToLocalizedNames: subtypes.reduce(
        (acc, curr) => {
          const localized = getLoc(`agent_subtypes_onscreen_name_override_${curr}`);
          if (localized) acc[curr] = localized;
          return acc;
        },
        {} as Record<string, string>,
      ),
    };
    if (appData.queuedSkillsData) {
      sendQueuedDataToSkills();
    }
  };
  const getSkillsForSubtype = async (subtype: string, subtypeIndex: number) => {
    console.log("getSkillsForSubtype:", subtype);
    const cachedSkillsData = appData.skillsData;
    if (!cachedSkillsData) {
      getSkillsData(appData.enabledMods);
      return;
    }
    const setKF = cachedSkillsData.subtypesToSet[subtype];
    console.log("sets for subtype:", setKF);
    const nodesKF = cachedSkillsData.setToNodes[setKF[subtypeIndex]];
    const { nodeLinks, nodeToSkill, skillsToEffects, skills, locs, icons, subtypesToSet, nodeToSkillLocks } =
      cachedSkillsData;
    const nodesToParents = getNodesToParents(nodesKF, nodeLinks, nodeToSkill, skillsToEffects);
    const kfSkills = getSkills(nodesKF, nodeLinks, nodeToSkill, nodesToParents, skillsToEffects, skills);
    const getLoc = (locId: string) => {
      for (const locsInPack of Object.values(locs)) {
        const localized = locsInPack.get(locId);
        if (localized) return localized;
      }
    };
    appendLocalizationsToSkills(kfSkills, getLoc);
    const effectKeysForCurrentSkills = Array.from(
      new Set(kfSkills.flatMap((skill) => skill.effects.map((effect) => effect.effectKey))),
    );
    const {
      abilityTooltipsByKey,
      reducedEffectToUnitAbilityEnables,
      iconPathsToLoad: tooltipIconPaths,
    } = buildAbilityTooltipDataForEffects({
      effectKeys: effectKeysForCurrentSkills,
      effectToUnitAbilityEnables: cachedSkillsData.effectToUnitAbilityEnables,
      unitAbilitiesByKey: cachedSkillsData.unitAbilitiesByKey,
      unitSpecialAbilitiesByKey: cachedSkillsData.unitSpecialAbilitiesByKey,
      bombardmentsByKey: cachedSkillsData.bombardmentsByKey,
      projectilesByKey: cachedSkillsData.projectilesByKey,
      explosionsByKey: cachedSkillsData.explosionsByKey,
      vortexesByKey: cachedSkillsData.vortexesByKey,
      abilityToPhaseIds: cachedSkillsData.abilityToPhaseIds,
      phasesById: cachedSkillsData.phasesById,
      phaseStatEffectsByPhaseId: cachedSkillsData.phaseStatEffectsByPhaseId,
      uiUnitStatIconsByStat: cachedSkillsData.uiUnitStatIconsByStat,
      kvDirectDamageMinUnary: cachedSkillsData.kvDirectDamageMinUnary,
      kvDirectDamageLarge: cachedSkillsData.kvDirectDamageLarge,
      abilityToAdditionalUiEffectKeys: cachedSkillsData.abilityToAdditionalUiEffectKeys,
      additionalUiEffectsByKey: cachedSkillsData.additionalUiEffectsByKey,
      abilityToAutoDeactivateFlags: cachedSkillsData.abilityToAutoDeactivateFlags,
      abilityToGroupKeys: cachedSkillsData.abilityToGroupKeys,
      specialAbilityGroupsByKey: cachedSkillsData.specialAbilityGroupsByKey,
      getLoc,
    });
    const missingTooltipIcons = tooltipIconPaths.filter((iconPath) => !cachedSkillsData.icons[iconPath]);
    if (missingTooltipIcons.length > 0) {
      const packsToRead = appData.packsData.filter((pack) =>
        cachedSkillsData.skillsDataPackPaths.includes(pack.path),
      );
      for (const pack of packsToRead) {
        await readFromExistingPack(pack, { filesToRead: missingTooltipIcons, skipParsingTables: true });
      }
      for (const pack of packsToRead) {
        for (const iconPath of missingTooltipIcons) {
          const iconIndex = bs(pack.packedFiles, iconPath, (a: PackedFile, b: string) =>
            collator.compare(a.name, b),
          );
          if (iconIndex < 0) continue;
          const iconPackedFile = pack.packedFiles[iconIndex];
          if (!iconPackedFile.buffer) continue;
          cachedSkillsData.icons[iconPath] = iconPackedFile.buffer.toString("base64");
        }
      }
    }
    const subtypes = Object.keys(subtypesToSet);
    const subtypeToNumSets = subtypes.reduce(
      (acc, curr) => {
        acc[curr] = subtypesToSet[curr].length;
        return acc;
      },
      {} as Record<string, number>,
    );
    const nodeRequirements = getNodeRequirements(nodeLinks, nodeToSkill);
    const characterEffectKeys = new Set<string>();
    for (const effects of Object.values(cachedSkillsData.skillsToEffects)) {
      for (const effect of effects) {
        if (effect.effectScope.startsWith("character_")) {
          characterEffectKeys.add(effect.effectKey);
        }
      }
    }
    const allEffects = Object.values(cachedSkillsData.effectsToEffectData)
      .filter((ed) => characterEffectKeys.has(ed.key))
      .map((ed) => ({
        effectKey: ed.key,
        localizedKey: getRawEffectLocalization(ed.key, getLoc),
        icon: ed.icon,
        priority: ed.priority,
      }));
    const allSkills = cachedSkillsData.skills.map((skill) => {
      const effects = (cachedSkillsData.skillsToEffects[skill.key] || []).map((e) => ({
        effectKey: e.effectKey,
        effectScope: e.effectScope,
        level: e.level,
        value: e.value,
        icon: e.icon,
        priority: e.priority,
      }));
      return {
        key: skill.key,
        localizedName: getLoc(`character_skills_localised_name_${skill.key}`) || skill.key,
        localizedDescription: getLoc(`character_skills_localised_description_${skill.key}`) || "",
        iconPath: skill.iconPath,
        maxLevel: skill.maxLevel,
        unlockRank: skill.unlockRank,
        effects,
      };
    });
    const allSkillIcons = Object.keys(cachedSkillsData.icons)
      .filter((iconPath) => iconPath.startsWith("ui\\campaign ui\\skills\\"))
      .sort()
      .map((iconPath) => ({
        path: iconPath,
        name: iconPath.replace("ui\\campaign ui\\skills\\", "").replace(/\.(png|jpg|jpeg)$/i, ""),
      }));
    appData.queuedSkillsData = {
      // subtypeToSkills: { [subtype]: kfSkills },
      currentSubtype: subtype,
      currentSubtypeIndex: subtypeIndex,
      currentSkills: kfSkills,
      subtypeToNumSets,
      subtypesToSet,
      subtypeAndSets: cachedSkillsData.subtypeAndSets,
      nodeLinks,
      nodeRequirements,
      nodeToSkillLocks,
      icons,
      abilityTooltipsByKey,
      effectToUnitAbilityEnables: reducedEffectToUnitAbilityEnables,
      subtypes,
      allEffects,
      allSkills,
      allSkillIcons,
      subtypesToLocalizedNames: subtypes.reduce(
        (acc, curr) => {
          const localized = getLoc(`agent_subtypes_onscreen_name_override_${curr}`);
          if (localized) acc[curr] = localized;
          return acc;
        },
        {} as Record<string, string>,
      ),
    };
    if (appData.queuedSkillsData) {
      sendQueuedDataToSkills();
    }
  };
  const getTableRowData = (
    packsTableData: PackViewData[],
    tableName: string,
    rowDataExtractor: (schemaFieldRow: AmendedSchemaField[]) => void,
  ) => {
    packsTableData.forEach((pTD) => {
      const skillNodeSetsFiles = Object.keys(pTD.packedFiles).filter((pFName) =>
        pFName.startsWith(`db\\${tableName}\\`),
      );
      for (const skillNodeSetFile of skillNodeSetsFiles) {
        const packedFile = pTD.packedFiles[skillNodeSetFile];
        const dbVersion = getDBVersion(packedFile);
        if (dbVersion === undefined) continue;
        const schemaFields = packedFile.schemaFields as AmendedSchemaField[];
        const chunkedShemaFields = chunkSchemaIntoRows(schemaFields, dbVersion) as AmendedSchemaField[][];
        for (const schemaFieldRow of chunkedShemaFields) {
          rowDataExtractor(schemaFieldRow);
        }
      }
    });
  };
  type CachedTechnologyData = {
    setsByKey: Record<string, TechnologyNodeSetSummary>;
    setRowsByKey: Record<string, Record<string, string>>;
    nodesByKey: Record<
      string,
      {
        nodeKey: string;
        technologyKey: string;
        setKey: string;
        tier: number;
        indent: number;
        requiredParents: number;
        campaignKey?: string;
        factionKey?: string;
        pixelOffsetX: number;
        pixelOffsetY: number;
        researchPointsRequired: number;
        optionalUiGroup?: string;
      }
    >;
    linksByKey: Record<string, TechnologyLinkData>;
    uiTabsByKey: Record<string, TechnologyUiTabData>;
    uiTabToNodes: Record<string, string[]>;
    uiGroupsByKey: Record<string, TechnologyUiGroupData>;
    uiGroupBounds: TechnologyUiGroupBoundsData[];
    technologiesByKey: Record<
      string,
      {
        key: string;
        iconName?: string;
        isHidden: boolean;
        buildingLevel?: string;
      }
    >;
    nodeRowsByKey: Record<string, Record<string, string>>;
    linkRowsByKey: Record<string, Record<string, string>>;
    technologyRowsByKey: Record<string, Record<string, string>>;
    technologyEffectRowsByKey: Record<string, Record<string, Record<string, string>>>;
    technologyEffectScopesByKey: Record<string, string>;
    locs: Record<string, Trie<string>>;
    icons: Record<string, string>;
    technologyToEffects: Record<string, { effectKey: string; value?: string }[]>;
    effectsForTech: Record<string, { icon?: string }>;
  };
  let cachedTechnologyData: CachedTechnologyData | undefined;
  let cachedTechnologyDataKey: string | undefined;
  const getSchemaFieldValue = (schemaFieldRow: AmendedSchemaField[], fieldName: string) =>
    schemaFieldRow.find((sF) => sF.name == fieldName)?.resolvedKeyValue;
  const parseOptionalString = (value: unknown) => {
    if (value == null) return undefined;
    const asString = `${value}`.trim();
    return asString === "" ? undefined : asString;
  };
  const parseOptionalNumber = (value: unknown, fallback = 0) => {
    if (value == null || `${value}`.trim() === "") return fallback;
    const parsed = Number.parseInt(`${value}`, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const parseOptionalFloat = (value: unknown, fallback = 0) => {
    if (value == null || `${value}`.trim() === "") return fallback;
    const parsed = Number.parseFloat(`${value}`);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const parseOptionalBool = (value: unknown, fallback = false) => {
    if (value == null) return fallback;
    const asString = `${value}`.trim().toLowerCase();
    if (asString === "true" || asString === "1") return true;
    if (asString === "false" || asString === "0") return false;
    return fallback;
  };
  const schemaRowToRecord = (schemaFieldRow: AmendedSchemaField[]) => {
    const rowRecord: Record<string, string> = {};
    for (const schemaField of schemaFieldRow) {
      const value = schemaField.resolvedKeyValue;
      if (value === undefined || value === null) {
        rowRecord[schemaField.name] = "";
        continue;
      }
      if (typeof value === "boolean") {
        rowRecord[schemaField.name] = value ? "true" : "false";
        continue;
      }
      rowRecord[schemaField.name] = `${value}`;
    }
    return rowRecord;
  };
  const getTechnologyIconPath = (iconName: string | undefined) => {
    if (!iconName || iconName.trim() === "") return undefined;
    const withoutExtension = iconName.replace(/\.(png|jpg|jpeg)$/i, "");
    return `ui\\campaign ui\\technologies\\${withoutExtension}.png`;
  };
  const getTechnologyIconNameFromPath = (iconPath: string | undefined) => {
    if (!iconPath || iconPath.trim() === "") return "";
    return iconPath
      .trim()
      .replace(/^.*[\\/]/, "")
      .replace(/\.(png|jpg|jpeg)$/i, "");
  };
  const getTechnologyBuildingLevelForWrite = (
    buildingLevel: string | undefined,
    originalTechnologyRow?: Record<string, string>,
  ) => {
    const explicitBuildingLevel = (buildingLevel || "").trim();
    if (explicitBuildingLevel !== "") return explicitBuildingLevel;
    if (originalTechnologyRow && "building_level" in originalTechnologyRow) {
      return originalTechnologyRow.building_level || "";
    }
    return "wh_main_chs_port_ruin";
  };
  const buildUsedTechnologyUniqueIndexes = (technologyRowsByKey: Record<string, Record<string, string>>) => {
    const usedIndexes = new Set<string>();
    for (const technologyRow of Object.values(technologyRowsByKey)) {
      const uniqueIndex = (technologyRow.unique_index || "").trim();
      if (uniqueIndex !== "") usedIndexes.add(uniqueIndex);
    }
    return usedIndexes;
  };
  const allocateTechnologyUniqueIndex = (usedIndexes: Set<string>) => {
    let nextUniqueIndex = "";
    do {
      nextUniqueIndex = randomInt(1, 0x7fffffff).toString();
    } while (usedIndexes.has(nextUniqueIndex));
    usedIndexes.add(nextUniqueIndex);
    return nextUniqueIndex;
  };
  const normalizeTechnologyBuildingLevel = (buildingLevel: string | undefined) => {
    if (
      buildingLevel === "wh_main_human_port_ruin" ||
      buildingLevel === "wh_main_chs_port_ruin"
    ) {
      return undefined;
    }
    return buildingLevel;
  };
  const getLocById = (locs: Record<string, Trie<string>>, locId: string) => {
    for (const locsInPack of Object.values(locs)) {
      const localized = locsInPack.get(locId);
      if (localized) return localized;
    }
  };
  const getTechnologyDataCacheKey = () =>
    hash({
      game: appData.currentGame,
      dataFolder: appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder || "",
      enabledMods: sortByNameAndLoadOrder(appData.enabledMods).map((mod) => ({
        path: mod.path,
        loadOrder: mod.loadOrder,
        lastChanged: mod.lastChanged,
        lastChangedLocal: mod.lastChangedLocal,
      })),
    });
  const buildTechnologyData = async (): Promise<CachedTechnologyData | undefined> => {
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataFolder) return undefined;
    const technologyTablesToRead = [
      "technology_node_sets_tables",
      "technology_nodes_tables",
      "technology_node_links_tables",
      "technology_ui_tabs_tables",
      "technology_ui_tabs_to_technology_nodes_junctions_tables",
      "technology_ui_groups_tables",
      "technology_ui_groups_to_technology_nodes_junctions_tables",
      "technologies_tables",
      "effects_tables",
      "technology_effects_junction_tables",
    ];
    const tablesToRead: string[] = [];
    for (const tableName of technologyTablesToRead) {
      for (const resolvedTable of resolveTable(tableName)) {
        const resolvedPath = `db\\${resolvedTable}\\`;
        if (!tablesToRead.includes(resolvedPath)) tablesToRead.push(resolvedPath);
      }
    }
    const enabledMods = [...appData.enabledMods];
    if (enabledMods.length > 0) {
      await readMods(enabledMods, false, true, false, true, tablesToRead);
    }
    const vanillaPacksToRead = [...appData.allVanillaPackNames]
      .filter(
        (packName) =>
          packName.startsWith("local_en") ||
          (!packName.startsWith("audio_") &&
            !packName.startsWith("local_") &&
            !packName.startsWith("tile") &&
            !packName.startsWith("warmachines") &&
            !packName.startsWith("terrain")),
      )
      .map((packName) => nodePath.join(dataFolder, packName));
    await readModsByPath(
      vanillaPacksToRead,
      { skipParsingTables: false, readLocs: true, tablesToRead },
      true,
    );
    const vanillaPackPathSet = new Set(vanillaPacksToRead);
    const vanillaPacks = appData.packsData.filter((packData) => vanillaPackPathSet.has(packData.path));
    const packsByPath = new Map(appData.packsData.map((packData) => [packData.path, packData]));
    const orderedEnabledMods = sortByNameAndLoadOrder(enabledMods).toReversed();
    const orderedModPacks = orderedEnabledMods
      .map((mod) => packsByPath.get(mod.path))
      .filter((pack): pack is Pack => !!pack);
    const orderedPacks = vanillaPacks.concat(orderedModPacks);
    const packsTableData = getPacksTableData(orderedPacks, tablesToRead, true) || [];
    const setsByKey: CachedTechnologyData["setsByKey"] = {};
    const setRowsByKey: CachedTechnologyData["setRowsByKey"] = {};
    const nodesByKey: CachedTechnologyData["nodesByKey"] = {};
    const linksByKey: CachedTechnologyData["linksByKey"] = {};
    const uiTabsByKey: CachedTechnologyData["uiTabsByKey"] = {};
    const uiTabToNodes: CachedTechnologyData["uiTabToNodes"] = {};
    const uiGroupsByKey: CachedTechnologyData["uiGroupsByKey"] = {};
    const uiGroupBoundsByKey: Record<string, TechnologyUiGroupBoundsData> = {};
    const technologiesByKey: CachedTechnologyData["technologiesByKey"] = {};
    const nodeRowsByKey: CachedTechnologyData["nodeRowsByKey"] = {};
    const linkRowsByKey: CachedTechnologyData["linkRowsByKey"] = {};
    const technologyRowsByKey: CachedTechnologyData["technologyRowsByKey"] = {};
    const technologyEffectRowsByKey: CachedTechnologyData["technologyEffectRowsByKey"] = {};
    getTableRowData(packsTableData, "technology_node_sets_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      if (!key) return;
      setsByKey[key] = {
        key,
        campaignKey: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "campaign_key")),
        factionKey: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "faction_key")),
        culture: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "culture")),
        subculture: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "subculture")),
        technologyCategory: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "technology_category")),
        localizedName: parseOptionalString(
          getSchemaFieldValue(schemaFieldRow, "localised_name") ??
            getSchemaFieldValue(schemaFieldRow, "localized_name"),
        ),
        tooltipString: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "tooltip_string")),
      };
      setRowsByKey[key] = schemaRowToRecord(schemaFieldRow);
    });
    getTableRowData(packsTableData, "technology_nodes_tables", (schemaFieldRow) => {
      const nodeKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      const technologyKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "technology_key"));
      const setKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "technology_node_set"));
      if (!nodeKey || !technologyKey || !setKey) return;
      nodesByKey[nodeKey] = {
        nodeKey,
        technologyKey,
        setKey,
        tier: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "tier")),
        indent: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "indent")),
        requiredParents: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "required_parents"), 0),
        campaignKey: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "campaign_key")),
        factionKey: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "faction_key")),
        pixelOffsetX: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "pixel_offset_x"), 0),
        pixelOffsetY: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "pixel_offset_y"), 0),
        researchPointsRequired: parseOptionalNumber(
          getSchemaFieldValue(schemaFieldRow, "research_points_required"),
        ),
        optionalUiGroup: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "optional_ui_group")),
      };
      nodeRowsByKey[nodeKey] = schemaRowToRecord(schemaFieldRow);
    });
    getTableRowData(packsTableData, "technology_node_links_tables", (schemaFieldRow) => {
      const parentKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "parent_key"));
      const childKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "child_key"));
      if (!parentKey || !childKey) return;
      const linkKey = `${parentKey}|${childKey}`;
      linksByKey[linkKey] = {
        parentKey,
        childKey,
        parentLinkPosition: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "parent_link_position"), 2),
        childLinkPosition: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "child_link_position"), 4),
        parentLinkPositionOffset: parseOptionalFloat(
          getSchemaFieldValue(schemaFieldRow, "parent_link_position_offset"),
          0,
        ),
        childLinkPositionOffset: parseOptionalFloat(
          getSchemaFieldValue(schemaFieldRow, "child_link_position_offset"),
          0,
        ),
        initialDescentTiers: parseOptionalNumber(
          getSchemaFieldValue(schemaFieldRow, "initial_descent_tiers"),
          0,
        ),
        visibleInUi: parseOptionalBool(getSchemaFieldValue(schemaFieldRow, "visible_in_ui"), true),
      };
      linkRowsByKey[linkKey] = schemaRowToRecord(schemaFieldRow);
    });
    getTableRowData(packsTableData, "technology_ui_tabs_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      if (!key) return;
      uiTabsByKey[key] = {
        key,
        sortOrder: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "sort_order")),
        tierOffset: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "tier_offset")),
        localizedName: parseOptionalString(
          getSchemaFieldValue(schemaFieldRow, "localised_name") ??
            getSchemaFieldValue(schemaFieldRow, "localized_name"),
        ),
        tooltipString: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "tooltip_string")),
      };
    });
    getTableRowData(packsTableData, "technology_ui_tabs_to_technology_nodes_junctions_tables", (schemaFieldRow) => {
      const tab = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "tab"));
      const node = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "node"));
      if (!tab || !node) return;
      if (!uiTabToNodes[tab]) uiTabToNodes[tab] = [];
      if (!uiTabToNodes[tab].includes(node)) uiTabToNodes[tab].push(node);
    });
    getTableRowData(packsTableData, "technology_ui_groups_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      if (!key) return;
      const explicitHex = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "colour_hex"));
      const red = parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "colour_red"), 0);
      const green = parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "colour_green"), 0);
      const blue = parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "colour_blue"), 0);
      const colourHex =
        explicitHex ??
        [red, green, blue]
          .map((component) => Math.max(0, Math.min(255, component)).toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase();
      uiGroupsByKey[key] = {
        key,
        colourRed: red,
        colourGreen: green,
        colourBlue: blue,
        colourHex,
        optionalBackgroundImage: parseOptionalString(
          getSchemaFieldValue(schemaFieldRow, "optional_background_image"),
        ),
        optionalDisplayName: parseOptionalString(
          getSchemaFieldValue(schemaFieldRow, "optional_display_name"),
        ),
        optionalDisplayDescription: parseOptionalString(
          getSchemaFieldValue(schemaFieldRow, "optional_display_desctiption") ??
            getSchemaFieldValue(schemaFieldRow, "optional_display_description"),
        ),
      };
    });
    getTableRowData(
      packsTableData,
      "technology_ui_groups_to_technology_nodes_junctions_tables",
      (schemaFieldRow) => {
        const groupKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "tech_ui_group"));
        const topLeftNode = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "top_left_node"));
        const bottomRightNode = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "bottom_right_node"));
        if (!groupKey || !topLeftNode || !bottomRightNode) return;
        uiGroupBoundsByKey[groupKey] = {
          groupKey,
          topLeftNode,
          bottomRightNode,
          optionalTopRightNode: parseOptionalString(
            getSchemaFieldValue(schemaFieldRow, "optional_top_right_node"),
          ),
          optionalBottomLeftNode: parseOptionalString(
            getSchemaFieldValue(schemaFieldRow, "optional_bottom_left_node"),
          ),
        };
      },
    );
    getTableRowData(packsTableData, "technologies_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      if (!key) return;
      const iconName = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "icon_name"));
      technologiesByKey[key] = {
        key,
        iconName,
        isHidden: parseOptionalBool(getSchemaFieldValue(schemaFieldRow, "is_hidden"), false),
        buildingLevel: normalizeTechnologyBuildingLevel(
          parseOptionalString(getSchemaFieldValue(schemaFieldRow, "building_level")),
        ),
      };
      technologyRowsByKey[key] = schemaRowToRecord(schemaFieldRow);
    });
    const effectsForTech: Record<string, { icon?: string }> = {};
    getTableRowData(packsTableData, "effects_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "effect"));
      const icon = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "icon"));
      if (key) effectsForTech[key] = { icon };
    });
    const technologyToEffectsByKey: Record<string, Record<string, { effectKey: string; value?: string }>> = {};
    const technologyEffectScopesByKey: Record<string, string> = {};
    getTableRowData(
      packsTableData,
      "technology_effects_junction_tables",
      (schemaFieldRow) => {
        const techKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "technology"));
        const effectKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "effect"));
        if (!techKey || !effectKey) return;
        const effectScope = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "effect_scope"));
        if (!technologyToEffectsByKey[techKey]) technologyToEffectsByKey[techKey] = {};
        technologyToEffectsByKey[techKey][effectKey] = {
          effectKey,
          value: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "value")),
        };
        if (effectScope && !technologyEffectScopesByKey[effectKey]) {
          technologyEffectScopesByKey[effectKey] = effectScope;
        }
        if (!technologyEffectRowsByKey[techKey]) technologyEffectRowsByKey[techKey] = {};
        technologyEffectRowsByKey[techKey][effectKey] = schemaRowToRecord(schemaFieldRow);
      },
    );
    const technologyToEffects: Record<string, { effectKey: string; value?: string }[]> = Object.fromEntries(
      Object.entries(technologyToEffectsByKey).map(([techKey, effectsByKey]) => [techKey, Object.values(effectsByKey)]),
    );
    const techIconPaths = Array.from(
      new Set(
        Object.values(technologiesByKey)
          .map((tech) => getTechnologyIconPath(tech.iconName))
          .filter((iconPath): iconPath is string => !!iconPath),
      ).values(),
    );
    const allTechnologyIconPaths = Array.from(
      new Set(
        orderedPacks
          .flatMap((pack) => pack.packedFiles.map((packedFile) => packedFile.name))
          .filter(
            (iconPath) =>
              iconPath.toLowerCase().startsWith("ui\\campaign ui\\technologies\\") &&
              /\.(png|jpg|jpeg)$/i.test(iconPath),
          ),
      ).values(),
    );
    const effectIconPaths = Array.from(
      new Set(
        Object.values(technologyToEffects)
          .flat()
          .map((effect) => effectsForTech[effect.effectKey]?.icon)
          .filter((icon): icon is string => !!icon)
          .map((icon) => `ui\\campaign ui\\effect_bundles\\${icon}`),
      ).values(),
    );
    const iconPaths = Array.from(new Set([...techIconPaths, ...allTechnologyIconPaths, ...effectIconPaths]).values());
    const locs = getLocsFromPacks(orderedPacks, getLocsTrie);
    const icons = iconPaths.length > 0 ? await loadIconsFromPacks(orderedPacks, iconPaths) : {};
    return {
      setsByKey,
      setRowsByKey,
      nodesByKey,
      linksByKey,
      uiTabsByKey,
      uiTabToNodes,
      uiGroupsByKey,
      uiGroupBounds: Object.values(uiGroupBoundsByKey),
      technologiesByKey,
      nodeRowsByKey,
      linkRowsByKey,
      technologyRowsByKey,
      technologyEffectRowsByKey,
      technologyEffectScopesByKey,
      locs,
      icons,
      technologyToEffects,
      effectsForTech,
    };
  };
  const ensureTechnologyData = async () => {
    const cacheKey = getTechnologyDataCacheKey();
    if (cachedTechnologyData && cachedTechnologyDataKey == cacheKey) return cachedTechnologyData;
    cachedTechnologyData = await buildTechnologyData();
    cachedTechnologyDataKey = cacheKey;
    return cachedTechnologyData;
  };
  const setCurrentGame = async (newGame: SupportedGames) => {
    try {
      if (!appData.gamesToGameFolderPaths[newGame]) {
        await getFolderPaths(log, newGame);
      }
      const dataFolder = appData.gamesToGameFolderPaths[newGame].dataFolder;
      const contentFolder = appData.gamesToGameFolderPaths[newGame].contentFolder;
      const gamePath = appData.gamesToGameFolderPaths[newGame].gamePath;
      if (!gamePath || !contentFolder || !dataFolder) {
        await getFolderPaths(log, newGame);
        if (appData.gamesToGameFolderPaths[newGame].contentFolder) {
          appData.packsData = [];
          appData.saveSetupDone = false;
          console.log("Setting current game 1");
          appData.currentGame = newGame;
          initializeAllSchemaForGame(newGame);
          await getAllMods();
        }
      }
    } finally {
      let contentFolder = "",
        gamePath = "";
      if (appData.gamesToGameFolderPaths[newGame].contentFolder) {
        contentFolder = appData.gamesToGameFolderPaths[newGame].contentFolder ?? "";
        gamePath = appData.gamesToGameFolderPaths[newGame].gamePath ?? "";
        console.log("Setting current game 2");
        appData.currentGame = newGame;
        initializeAllSchemaForGame(newGame);
        await getAllMods();
        console.log("SENDING setAppFolderPaths", gamePath, contentFolder);
        // mainWindow?.webContents.send("setCurrentGameNaive", newGame);
        mainWindow?.webContents.send("setAppFolderPaths", {
          gamePath: gamePath || "",
          contentFolder: contentFolder || "",
        } as GameFolderPaths);
      } else {
        mainWindow?.webContents.send("requestGameFolderPaths", newGame);
      }
    }
  };
  const refreshModsIfFoldersValid = async (requestedGame: SupportedGames | undefined) => {
    const game = requestedGame || appData.currentGame;
    // const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    // const contentFolder = appData.gamesToGameFolderPaths[appData.currentGame].contentFolder;
    // const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
    // if (contentFolder && gamePath && dataFolder) {
    //   console.log(contentFolder, gamePath, dataFolder);
    //   getAllMods();
    // }
    await setCurrentGame(game);
    if (appData.gamesToGameFolderPaths[game].contentFolder) {
      const currentPreset = appData.gameToCurrentPreset[game];
      // console.log("SETTING GAME IN INDEX", game, currentPreset?.mods[0].name);
      const presets = appData.gameToPresets[game];
      mainWindow?.webContents.send("setCurrentGame", game, currentPreset, presets);
    }
  };
  const setLastGameUpdateTimeUsingAppManifest = async () => {
    try {
      const timeOfLastGameUpdate = await getLastUpdated();
      if (timeOfLastGameUpdate) {
        mainWindow?.webContents.send("setDataModLastChangedLocal", parseInt(timeOfLastGameUpdate) * 1000);
      }
    } catch (e) {
      console.log(e);
    }
  };
  const fetchGameUpdates = async () => {
    try {
      if (appData.currentGame != "wh3") return await setLastGameUpdateTimeUsingAppManifest();
      const res = await fetch(
        `https://raw.githubusercontent.com/Shazbot/WH3-Mod-Manager/tw_updates/tw_updates/wh3.json`,
      );
      // eslint-disable-next-line prefer-const
      let gameUpdates = (await res.json()) as GameUpdateData[];
      // if (isDev) {
      //   gameUpdates = JSON.parse(fsdumb.readFileSync("./test/wh3.json", "utf-8")) as GameUpdateData[];
      // }
      appData.gameUpdates = gameUpdates;
      console.log("gameUpdates", gameUpdates);
      gameUpdates.sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp));
      if (gameUpdates[0]) {
        mainWindow?.webContents.send("setDataModLastChangedLocal", parseInt(gameUpdates[0].timestamp) * 1000);
      }
    } catch (e) {
      console.log(e);
    }
  };
  const removeMod = async (mainWindow: BrowserWindow, modPath: string) => {
    mainWindow?.webContents.send("removeMod", modPath);
  };
  const getMod = async (mainWindow: BrowserWindow, modPath: string) => {
    let mod: Mod | undefined;
    try {
      if (modPath.includes(`\\content\\${gameToSteamId[appData.currentGame]}\\`)) {
        const modSubfolderName = nodePath.dirname(modPath).replace(/.*\\/, "");
        console.log("looking for ", modSubfolderName);
        mod = await getContentModInFolder(modSubfolderName, log);
      } else {
        console.log("looking for DATA MOD: ", modPath);
        mod = await getDataMod(modPath, log);
      }
    } catch (e) {
      console.log(e);
    }
    return mod;
  };
  const removePackFromCollisions = (packPath: string) => {
    if (appData.compatData) {
      appData.compatData.packTableCollisions = removeFromPackTableCollisions(
        appData.compatData.packTableCollisions,
        nodePath.basename(packPath),
      );
      appData.compatData.packFileCollisions = removeFromPackFileCollisions(
        appData.compatData.packFileCollisions,
        nodePath.basename(packPath),
      );
    }
  };
  const onNewPackFound = async (path: string, fromWatcher = false) => {
    if (!mainWindow) return;
    mainWindow.webContents.send("handleLog", "MOD ADDED: " + path);
    console.log("MOD ADDED: " + path);
    const mod = await getMod(mainWindow, path);
    if (mod) {
      mainWindow?.webContents.send("addMod", mod);
      // we get onNewPackFound called by the data watcher if it's a symlink on app launch, ignore that case
      if (!fromWatcher || !mod.isSymbolicLink) {
        mainWindow?.webContents.send("addToast", {
          type: "success",
          messages: ["loc:addedMod", mod.name],
          startTime: Date.now(),
        } as Toast);
      }
      if (appData.modsToResubscribeTo.some((iterMod) => iterMod.name == mod.name)) {
        appData.modsToResubscribeTo = appData.modsToResubscribeTo.filter(
          (iterMod) => iterMod.name != mod.name,
        );
        if (appData.modsToResubscribeTo.length > 0) {
          forceResubscribeMods(appData.modsToResubscribeTo);
        }
      }
    }
  };
  const onPackDeleted = async (path: string, isDeletedFromContent = false) => {
    if (!mainWindow) return;
    mainWindow.webContents.send("handleLog", "MOD REMOVED: " + path);
    console.log("MOD REMOVED: " + path);
    await removeMod(mainWindow, path);
    if (appData.packsData && appData.packsData.some((pack) => pack.path == path)) {
      appData.packsData = appData.packsData.filter((pack) => pack.path != path);
    }
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (isDeletedFromContent && dataFolder) {
      try {
        const potentialSymlinkDataPath = nodePath.join(dataFolder, nodePath.basename(path));
        await fs.readlinkSync(potentialSymlinkDataPath);
        await fs.unlinkSync(potentialSymlinkDataPath);
        await removeMod(mainWindow, path);
      } catch (e) {
        console.log("deleted content pack doesn't have a symbolic link in data");
        console.log(e);
      }
    }
    removePackFromCollisions(path);
  };
  const matchTableNamePart = /^db\\(.*?)\\data__/;
  const getAllMods = async () => {
    const timeStartedFetchingSubbedIds = Date.now();
    try {
      appData.subscribedModIds = [];
      const child = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "getSubscribedIds"],
        {},
      );
      child.on("message", (workshopIds: string[]) => {
        appData.subscribedModIds = workshopIds;
        console.log("getSubscribedIds returned:", workshopIds);
      });
    } catch (e) {
      console.log(e);
    }
    try {
      let mods = await getMods(log);
      while (Date.now() - timeStartedFetchingSubbedIds < 5000 && appData.subscribedModIds.length == 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      console.log("before subscription filter:", mods.length);
      // for (const mod of mods) {
      //   if (!mod.isInData && !appData.subscribedModIds.includes(mod.workshopId)) console.log(mod.workshopId);
      // }
      if (appData.subscribedModIds.length != 0) {
        mods = mods.filter((mod) => mod.isInData || appData.subscribedModIds.includes(mod.workshopId));
      }
      console.log("after subscription filter:", mods.length);
      mainWindow?.webContents.send("modsPopulated", mods);
      const packHeadersToSend: PackHeaderData[] = [];
      await Promise.all(
        mods.map(async (mod) => {
          try {
            if (mod == null || mod.path == null) {
              console.error("MOD OR MOD PATH IS NULL");
              return;
            }
            const packHeaderData = await readPackHeaderCached(mod.path);
            if (packHeaderData.isMovie || packHeaderData.dependencyPacks.length > 0)
              packHeadersToSend.push(packHeaderData);
          } catch (e) {
            if (e instanceof Error) {
              log(e.message);
            }
          }
        }),
      );
      mainWindow?.webContents.send("setPackHeaderData", packHeadersToSend);
      await savePackHeaderCache();
      if (!appData.saveSetupDone) {
        appData.saveSetupDone = true;
        getSaveFiles()
          .then(async (saves) => {
            await setupSavesWatcher((saves) => mainWindow?.webContents.send("savesPopulated", saves));
            mainWindow?.webContents.send("savesPopulated", saves);
          })
          .catch();
      }
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
      if (dataFolder) {
        for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
          const baseVanillaPackName = vanillaPackData.name;
          const dataPackPath = nodePath.join(dataFolder, baseVanillaPackName);
          const dataMod: Mod = {
            humanName: "",
            name: baseVanillaPackName,
            path: dataPackPath,
            imgPath: "",
            workshopId: "",
            isEnabled: true,
            modDirectory: `${dataFolder}`,
            isInData: true,
            lastChanged: undefined,
            loadOrder: undefined,
            author: "",
            isDeleted: false,
            isMovie: false,
            size: 0,
            isSymbolicLink: false,
            tags: ["mod"],
          };
          if (appData.packsData.every((iterPack) => iterPack.path != dataPackPath)) {
            const vanillaCache = await loadVanillaPackFilesCache();
            let vanillaStat: { size: number; mtimeMs: number } | null = null;
            try {
              vanillaStat = await fs.promises.stat(dataPackPath);
            } catch {
              // pack doesn't exist, skip
            }
            const cacheEntry = vanillaStat && vanillaCache[dataPackPath];
            const cacheHit =
              cacheEntry &&
              cacheEntry.size === vanillaStat!.size &&
              cacheEntry.lastChangedLocal === vanillaStat!.mtimeMs;
            let packedFileNames: string[];
            if (cacheHit) {
              console.log("VANILLA PACK CACHE HIT:", dataPackPath);
              packedFileNames = cacheEntry.packedFileNames;
            } else {
              console.log("READING DATA PACK");
              appData.currentlyReadingModPaths.push(dataPackPath);
              const dataPackData = await readPack(dataMod.path, {
                skipParsingTables: true,
              });
              appData.currentlyReadingModPaths = appData.currentlyReadingModPaths.filter(
                (path) => path != dataPackPath,
              );
              if (dataPackData) {
                appData.vanillaPacks.push(dataPackData);
                if (appData.packsData.every((iterPack) => iterPack.path != dataPackData.path)) {
                  appendPacksData(dataPackData);
                }
                packedFileNames = dataPackData.packedFiles.map((pf) => pf.name);
                if (vanillaStat) {
                  vanillaCache[dataPackPath] = {
                    size: vanillaStat.size,
                    lastChangedLocal: vanillaStat.mtimeMs,
                    packedFileNames,
                  };
                  await saveVanillaPackFilesCache();
                }
              } else {
                packedFileNames = [];
              }
            }
            if (cacheHit) {
              // Reconstruct a minimal Pack for vanillaPacks and appendPacksData from cached file names
              const reconstructedPack: Pack = {
                name: baseVanillaPackName,
                path: dataPackPath,
                packedFiles: packedFileNames.map((name) => ({ name, file_size: 0, start_pos: 0 })),
                packHeader: {} as PackHeader,
                lastChangedLocal: vanillaStat!.mtimeMs,
                size: vanillaStat!.size,
                readTables: [],
              };
              appData.vanillaPacks.push(reconstructedPack);
              if (appData.packsData.every((iterPack) => iterPack.path != dataPackPath)) {
                appendPacksData(reconstructedPack);
              }
            }
            const vanillaDBFileNames = packedFileNames
              .map((name) => name.match(matchTableNamePart))
              .filter((matchResult) => matchResult)
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              .map((matchResult) => matchResult![1]);
            if (vanillaDBFileNames.length > 0) {
              appData.vanillaPacksDBFileNames = Array.from(
                new Set([...appData.vanillaPacksDBFileNames, ...vanillaDBFileNames]).values(),
              );
            }
          }
        }
        appData.vanillaPacksDBFileNames.sort((a, b) => collator.compare(a, b));
        await fetchGameUpdates();
      }
      try {
        fork(
          nodePath.join(__dirname, "sub.js"),
          [
            gameToSteamId[appData.currentGame],
            "checkState",
            mods
              .filter(
                (mod) =>
                  !mod.isInData && !isNaN(Number(mod.workshopId)) && !isNaN(parseFloat(mod.workshopId)),
              )
              .map((mod) => mod.workshopId)
              .join(";"),
          ],
          {},
        );
      } catch (e) {
        console.log(e);
      }
    } catch (err) {
      console.log(err);
    }
    await contentWatcher?.close();
    contentWatcher = undefined;
    await dataWatcher?.close();
    dataWatcher = undefined;
    await downloadsWatcher?.close();
    downloadsWatcher = undefined;
    await mergedWatcher?.close();
    mergedWatcher = undefined;
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    const contentFolder = appData.gamesToGameFolderPaths[appData.currentGame].contentFolder;
    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
    if (!contentFolder || !dataFolder || !gamePath) return;
    if (!contentWatcher) {
      const sanitizedContentFolder = contentFolder.replaceAll("\\", "/").replaceAll("//", "/");
      console.log("content folder:", contentFolder);
      contentWatcher = chokidar
        .watch(`${sanitizedContentFolder}/**/*.pack`, {
          ignoreInitial: true,
          ignored: /whmm_backups/,
          awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100,
          },
        })
        .on("add", async (path) => {
          console.log("NEW CONTENT ADD", path);
          onNewPackFound(path);
        })
        .on("unlink", async (path) => {
          console.log("NEW CONTENT UNLINK", path);
          onPackDeleted(path, true);
        })
        .on("change", async (path) => {
          console.log("NEW CONTENT CHANGE", path);
          onPackDeleted(path);
          onNewPackFound(path);
        });
    }
    if (!downloadsWatcher) {
      const downloadsFolder = contentFolder
        .replaceAll("\\", "/")
        .replaceAll("//", "/")
        .replace("/content/", "/downloads/");
      console.log("downloads folder:", downloadsFolder);
      downloadsWatcher = chokidar
        .watch(`${downloadsFolder}/**/*.pack`, {
          ignoreInitial: true,
          awaitWriteFinish: true,
          ignored: /whmm_backups/,
        })
        .on("add", async (path) => {
          console.log("NEW DOWNLOADS ADD", path);
          fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "justRun"], {});
        })
        .on("unlink", async (path) => {
          console.log("NEW DOWNLOADS UNLINK", path);
        });
    }
    if (!dataWatcher) {
      const sanitizedDataFolder = dataFolder.replaceAll("\\", "/").replaceAll("//", "/");
      dataWatcher = chokidar
        .watch([`${sanitizedDataFolder}/*.pack`, `${sanitizedDataFolder}/modding/*.pack`], {
          ignoreInitial: true,
          awaitWriteFinish: true,
          followSymlinks: false,
          ignored: /whmm_backups/,
        })
        .on("add", async (path) => {
          console.log("dataWatcher add:", path);
          onNewPackFound(path, true);
        })
        .on("unlink", async (path) => {
          onPackDeleted(path);
        })
        .on("change", async (path) => {
          console.log("data pack changed:", path);
          onPackDeleted(path);
          console.log("dataWatcher change:", path);
          onNewPackFound(path);
        });
    }
    if (!mergedWatcher) {
      const mergedDirPath = nodePath.join(gamePath, "/merged/");
      exec(`mkdir "${mergedDirPath}"`);
      while (!fsExtra.existsSync(mergedDirPath)) {
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
      // await fsExtra.ensureDir(nodePath.join(gamePath, "/merged/"));
      const sanitizedGamePath = gamePath.replaceAll("\\", "/").replaceAll("//", "/");
      mergedWatcher = chokidar
        .watch([`${sanitizedGamePath}/merged/*.pack`], {
          ignoreInitial: false,
          awaitWriteFinish: {
            stabilityThreshold: 3000,
            pollInterval: 100,
          },
          ignored: /whmm_backups/,
          usePolling: true,
        })
        .on("add", async (path) => {
          onNewPackFound(path);
        })
        .on("unlink", async (path) => {
          onPackDeleted(path);
        })
        .on("change", async (path) => {
          console.log("pack changed:", path);
          onPackDeleted(path);
          onNewPackFound(path);
        });
    }
  };
  const readConfig = async (): Promise<AppStateToRead> => {
    try {
      const appState = await readAppConfig();
      if (!appData.hasReadConfig) {
        fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "justRun"], {}); // forces steam workshop to download mods
        setStartingAppState(appState);
      }
      // appFolderPaths is deprecated in the config since we moved from only supporting wh3, this is migration code
      if (appState.appFolderPaths) {
        if (appState.appFolderPaths.contentFolder && !fs.existsSync(appState.appFolderPaths.contentFolder)) {
          appState.appFolderPaths.contentFolder = "";
        } else {
          appData.gamesToGameFolderPaths["wh3"].contentFolder = appState.appFolderPaths.contentFolder;
        }
        if (appState.appFolderPaths.gamePath && !fs.existsSync(appState.appFolderPaths.gamePath)) {
          appState.appFolderPaths.gamePath = "";
        } else {
          appData.gamesToGameFolderPaths["wh3"].gamePath = appState.appFolderPaths.gamePath;
          if (appState.appFolderPaths.gamePath)
            appData.gamesToGameFolderPaths["wh3"].dataFolder = nodePath.join(
              appState.appFolderPaths.gamePath,
              "/data/",
            );
        }
      }
      if (appState.gameFolderPaths) {
        appData.gamesToGameFolderPaths = appState.gameFolderPaths;
        if (appState.currentGame) {
          const gameFolderPaths = appData.gamesToGameFolderPaths[appState.currentGame];
          if (gameFolderPaths.contentFolder && !fs.existsSync(gameFolderPaths.contentFolder)) {
            gameFolderPaths.contentFolder = "";
          }
          if (gameFolderPaths.gamePath && !fs.existsSync(gameFolderPaths.gamePath)) {
            gameFolderPaths.gamePath = "";
          }
        }
      }
      if (appState.currentGame) {
        appData.currentGame = appState.currentGame;
        initializeAllSchemaForGame(appData.currentGame);
      } else {
        appState.currentGame = appData.currentGame;
      }
      if (appState.gameToCurrentPreset) {
        appData.gameToCurrentPreset = appState.gameToCurrentPreset;
      } else {
        appState.gameToCurrentPreset = appData.gameToCurrentPreset;
      }
      if (appState.gameToPresets) {
        appData.gameToPresets = appState.gameToPresets;
      } else {
        appState.gameToPresets = appData.gameToPresets;
      }
      // presets and currentPreset is also deprecated and now in gameToPresets and gameToCurrentPreset, migration code
      if (appState.currentPreset) {
        appData.gameToCurrentPreset["wh3"] = appState.currentPreset;
      } else if (appData.gameToCurrentPreset[appState.currentGame]) {
        appState.currentPreset = appData.gameToCurrentPreset[appState.currentGame] as Preset;
      }
      if (appState.presets) {
        appData.gameToPresets["wh3"] = appState.presets;
      } else {
        appState.presets = appData.gameToPresets[appState.currentGame];
      }
      appData.isChangingGameProcessPriority = appState.isChangingGameProcessPriority;
      appData.isFeaturesForModdersEnabled = appState.isFeaturesForModdersEnabled || false;
      appData.moddersPrefix = appState.moddersPrefix || "";
      appData.isShowingSkillNodeSetNames =
        appState.isShowingSkillNodeSetNames ?? appData.isShowingSkillNodeSetNames;
      appData.isShowingHiddenSkills = appState.isShowingHiddenSkills ?? appData.isShowingHiddenSkills;
      appData.isShowingHiddenModifiersInsideSkills =
        appState.isShowingHiddenModifiersInsideSkills ?? appData.isShowingHiddenModifiersInsideSkills;
      appData.isCheckingSkillRequirements =
        appState.isCheckingSkillRequirements ?? appData.isCheckingSkillRequirements;
      return appState;
    } finally {
      appData.hasReadConfig = true;
    }
  };
  ipcMain.on("getAllModData", (event, ids: string[]) => {
    // if (isDev) return;
    fetchModData(
      ids.filter((id) => id !== ""),
      (modData) => {
        tempModDatas.push(modData);
        sendModData();
      },
      (msg) => {
        mainWindow?.webContents.send("handleLog", msg);
        console.log(msg);
      },
    );
  });
  // Cache management for getCustomizableMods
  // This cache stores which tables each pack contains to avoid expensive file scanning
  // Cache entries are invalidated when pack size or lastChangedLocal changes
  interface CustomizableModsCacheEntry {
    size: number;
    lastChangedLocal: number;
    customizableTables: string[]; // Tables found in this pack (e.g., ["db\\abilities\\", "whmmflows\\"])
  }
  type CustomizableModsCache = Record<string, CustomizableModsCacheEntry>; // packPath -> cache entry
  const CACHE_FILE_NAME = "customizable-mods-cache.json";
  // In-memory cache - loaded once and kept in memory
  let customizableModsCache: CustomizableModsCache | null = null;
  /**
   * Loads the customizable mods cache from disk into memory (only called once)
   * @returns Cache object, or empty object if cache doesn't exist or is invalid
   */
  const loadCustomizableModsCache = async (): Promise<CustomizableModsCache> => {
    if (customizableModsCache !== null) {
      return customizableModsCache;
    }
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), CACHE_FILE_NAME);
      const data = await fs.promises.readFile(cacheFilePath, "utf8");
      customizableModsCache = JSON.parse(data);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return customizableModsCache!;
    } catch (err) {
      // Cache file doesn't exist or is invalid, return empty cache
      customizableModsCache = {};
      return customizableModsCache;
    }
  };
  /**
   * Saves the customizable mods cache to disk
   * @param cache Cache object to save
   */
  const saveCustomizableModsCache = async (cache: CustomizableModsCache): Promise<void> => {
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), CACHE_FILE_NAME);
      await fs.promises.writeFile(cacheFilePath, JSON.stringify(cache, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to save customizable mods cache:", err);
    }
  };
  // Cache for pack header data (isMovie, dependencyPacks) keyed by pack path
  // Entries are invalidated when the file's size or mtime changes
  interface PackHeaderCacheEntry {
    size: number;
    lastChangedLocal: number;
    isMovie: boolean;
    dependencyPacks: string[];
  }
  type PackHeaderCache = Record<string, PackHeaderCacheEntry>;
  const PACK_HEADER_CACHE_FILE = "pack-headers-cache.bin";
  let packHeaderCache: PackHeaderCache | null = null;
  const loadPackHeaderCache = async (): Promise<PackHeaderCache> => {
    if (packHeaderCache !== null) return packHeaderCache;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), PACK_HEADER_CACHE_FILE);
      const compressed = await fs.promises.readFile(cacheFilePath);
      const json = await zstdDecompress(compressed);
      packHeaderCache = JSON.parse(json.toString("utf8")) as PackHeaderCache;
      return packHeaderCache!;
    } catch {
      packHeaderCache = {};
      return packHeaderCache;
    }
  };
  const savePackHeaderCache = async (): Promise<void> => {
    if (!packHeaderCache) return;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), PACK_HEADER_CACHE_FILE);
      const json = Buffer.from(JSON.stringify(packHeaderCache), "utf8");
      const compressed = await zstdCompress(json, 1);
      await fs.promises.writeFile(cacheFilePath, compressed);
    } catch (err) {
      console.error("Failed to save pack header cache:", err);
    }
  };
  const readPackHeaderCached = async (path: string): Promise<PackHeaderData> => {
    const cache = await loadPackHeaderCache();
    let stat: { size: number; mtimeMs: number } | null = null;
    try {
      stat = await fs.promises.stat(path);
    } catch {
      // file may not exist — readPackHeader will throw properly
    }
    if (stat) {
      const entry = cache[path];
      if (entry && entry.size === stat.size && entry.lastChangedLocal === stat.mtimeMs) {
        return { path, isMovie: entry.isMovie, dependencyPacks: entry.dependencyPacks };
      }
    }
    const data = await readPackHeader(path);
    if (stat) {
      cache[path] = {
        size: stat.size,
        lastChangedLocal: stat.mtimeMs,
        isMovie: data.isMovie,
        dependencyPacks: data.dependencyPacks,
      };
    }
    return data;
  };
  // Cache for vanilla pack file name lists, keyed by pack path.
  // Allows skipping readPack() on startup when the pack hasn't changed.
  interface VanillaPackFilesCacheEntry {
    size: number;
    lastChangedLocal: number;
    packedFileNames: string[];
  }
  type VanillaPackFilesCache = Record<string, VanillaPackFilesCacheEntry>;
  const VANILLA_PACK_FILES_CACHE_FILE = "vanilla-pack-files-cache.bin";
  let vanillaPackFilesCache: VanillaPackFilesCache | null = null;
  const loadVanillaPackFilesCache = async (): Promise<VanillaPackFilesCache> => {
    if (vanillaPackFilesCache !== null) return vanillaPackFilesCache;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), VANILLA_PACK_FILES_CACHE_FILE);
      const compressed = await fs.promises.readFile(cacheFilePath);
      const json = await zstdDecompress(compressed);
      vanillaPackFilesCache = JSON.parse(json.toString("utf8")) as VanillaPackFilesCache;
      return vanillaPackFilesCache!;
    } catch {
      vanillaPackFilesCache = {};
      return vanillaPackFilesCache;
    }
  };
  const saveVanillaPackFilesCache = async (): Promise<void> => {
    if (!vanillaPackFilesCache) return;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), VANILLA_PACK_FILES_CACHE_FILE);
      const json = Buffer.from(JSON.stringify(vanillaPackFilesCache), "utf8");
      const compressed = await zstdCompress(json, 1);
      await fs.promises.writeFile(cacheFilePath, compressed);
    } catch (err) {
      console.error("Failed to save vanilla pack files cache:", err);
    }
  };
  interface FlowExecutionCacheEntry {
    signatureHash: string;
    createdAt: number;
    modsWithFlows: Array<{ path: string; name: string }>;
    createdFlowPackFileNames: string[];
  }
  interface FlowExecutionCache {
    version: number;
    byGame: Partial<Record<SupportedGames, FlowExecutionCacheEntry>>;
  }
  const FLOW_EXECUTION_CACHE_FILE = "flow-execution-cache.bin";
  const FLOW_EXECUTION_CACHE_VERSION = 1;
  let flowExecutionCache: FlowExecutionCache | null = null;
  const loadFlowExecutionCache = async (): Promise<FlowExecutionCache> => {
    if (flowExecutionCache !== null) return flowExecutionCache;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), FLOW_EXECUTION_CACHE_FILE);
      const compressed = await fs.promises.readFile(cacheFilePath);
      const json = await zstdDecompress(compressed);
      const parsed = JSON.parse(json.toString("utf8")) as FlowExecutionCache;
      if (
        parsed &&
        parsed.version === FLOW_EXECUTION_CACHE_VERSION &&
        parsed.byGame &&
        typeof parsed.byGame === "object"
      ) {
        flowExecutionCache = parsed;
      } else {
        flowExecutionCache = { version: FLOW_EXECUTION_CACHE_VERSION, byGame: {} };
      }
      return flowExecutionCache;
    } catch {
      flowExecutionCache = { version: FLOW_EXECUTION_CACHE_VERSION, byGame: {} };
      return flowExecutionCache;
    }
  };
  const saveFlowExecutionCache = async (): Promise<void> => {
    if (!flowExecutionCache) return;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), FLOW_EXECUTION_CACHE_FILE);
      const json = Buffer.from(JSON.stringify(flowExecutionCache), "utf8");
      const compressed = await zstdCompress(json, 1);
      await fs.promises.writeFile(cacheFilePath, compressed);
    } catch (err) {
      console.error("Failed to save flow execution cache:", err);
    }
  };
  const sortKeysDeep = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((entry) => sortKeysDeep(entry));
    if (value && typeof value === "object") {
      const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([first], [second]) =>
        first.localeCompare(second),
      );
      const sortedObject: Record<string, unknown> = {};
      for (const [key, entryValue] of sortedEntries) {
        sortedObject[key] = sortKeysDeep(entryValue);
      }
      return sortedObject;
    }
    return value;
  };
  const getModStatForFlowSignature = async (
    mod: Mod,
    cache: PackHeaderCache,
  ): Promise<{ size: number; mtimeMs: number } | null> => {
    if (typeof mod.size === "number" && typeof mod.lastChangedLocal === "number") {
      return { size: mod.size, mtimeMs: mod.lastChangedLocal };
    }
    const cachedEntry = cache[mod.path];
    if (cachedEntry) {
      return { size: cachedEntry.size, mtimeMs: cachedEntry.lastChangedLocal };
    }
    try {
      const stat = await fs.promises.stat(mod.path);
      return { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      console.error(`Failed to stat enabled mod for flow signature: ${mod.path}`, error);
      return null;
    }
  };
  const getPackSignatureCached = async (
    packPath: string,
    cache?: PackHeaderCache,
  ): Promise<{ size: number; mtimeMs: number } | null> => {
    const headerCache = cache || (await loadPackHeaderCache());
    const cachedEntry = headerCache[packPath];
    if (cachedEntry) {
      return { size: cachedEntry.size, mtimeMs: cachedEntry.lastChangedLocal };
    }
    try {
      const stat = await fs.promises.stat(packPath);
      return { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      console.error(`Failed to stat pack for signature: ${packPath}`, error);
      return null;
    }
  };
  const getCompatVanillaPackPaths = (dataFolder: string): string[] => {
    return [...appData.allVanillaPackNames]
      .filter(
        (packName) =>
          packName.startsWith("local_en") ||
          (!packName.startsWith("audio_") && !packName.startsWith("local_")),
      )
      .map((packName) => nodePath.join(dataFolder, packName))
      .toSorted((first, second) => first.localeCompare(second));
  };
  const getCompatVanillaTableToPackPaths = (
    vanillaPackPaths: string[],
  ): Record<string, string[]> => {
    const vanillaPackPathsSet = new Set(vanillaPackPaths);
    const tableToPackPaths: Record<string, string[]> = {};
    for (const pack of appData.vanillaPacks) {
      if (!vanillaPackPathsSet.has(pack.path)) continue;
      for (const packedFile of pack.packedFiles) {
        const tableNameMatch = packedFile.name.match(matchTableNamePart);
        if (!tableNameMatch) continue;
        const tableName = tableNameMatch[1];
        tableToPackPaths[tableName] = tableToPackPaths[tableName] || [];
        if (!tableToPackPaths[tableName].includes(pack.path)) {
          tableToPackPaths[tableName].push(pack.path);
        }
      }
    }
    return tableToPackPaths;
  };
  const collectReferencedVanillaTablesForCompat = (mods: Mod[]): string[] => {
    const tablesAndDBFieldsThatReference = gameToDBFieldsThatReference[appData.currentGame];
    const modPaths = new Set(mods.map((mod) => mod.path));
    const referencedVanillaTables = new Set<string>();
    for (const pack of appData.packsData) {
      if (!modPaths.has(pack.path)) continue;
      for (const packedFile of pack.packedFiles) {
        if (!packedFile.schemaFields) continue;
        const tableNameMatch = packedFile.name.match(matchTableNamePart);
        if (!tableNameMatch) continue;
        const tableName = tableNameMatch[1];
        const dbVersion = getDBVersion(packedFile);
        if (!dbVersion) continue;
        const tableFieldRefs = tablesAndDBFieldsThatReference[tableName];
        if (!tableFieldRefs) continue;
        for (const dbField of dbVersion.fields) {
          const tableRef = tableFieldRefs[dbField.name];
          if (!tableRef) continue;
          const targetDBFileName = tableRef[0];
          if (appData.vanillaPacksDBFileNames.includes(targetDBFileName)) {
            referencedVanillaTables.add(targetDBFileName);
          }
        }
      }
    }
    return [...referencedVanillaTables].toSorted((first, second) => collator.compare(first, second));
  };
  const getLazyCompatVanillaReadPlan = (mods: Mod[], vanillaPackPaths: string[]) => {
    const tableToPackPaths = getCompatVanillaTableToPackPaths(vanillaPackPaths);
    const referencedVanillaTables = collectReferencedVanillaTablesForCompat(mods);
    const packPathsToRead = new Set<string>();
    const tablesToRead: string[] = [];
    for (const tableName of referencedVanillaTables) {
      const packPaths = tableToPackPaths[tableName];
      if (!packPaths || packPaths.length == 0) continue;
      tablesToRead.push(`db\\${tableName}\\`);
      for (const packPath of packPaths) {
        packPathsToRead.add(packPath);
      }
    }
    return {
      packPaths: [...packPathsToRead].toSorted((first, second) => first.localeCompare(second)),
      tablesToRead,
    };
  };
  const COMPAT_CHECK_CACHE_VERSION = 1;
  interface CompatCheckCacheEntry {
    signatureHash: string;
    createdAt: number;
    packCollisions: PackCollisions;
  }
  let compatCheckCache: CompatCheckCacheEntry | null = null;
  const buildCompatCheckSignature = async (
    mods: Mod[],
    vanillaPackPaths: string[],
  ): Promise<string | null> => {
    const headerCache = await loadPackHeaderCache();
    const modSignatureData: Array<{
      path: string;
      name: string;
      loadOrder: number | null;
      size: number;
      mtimeMs: number;
    }> = [];
    const modsByPath = [...mods].toSorted((first, second) => first.path.localeCompare(second.path));
    for (const mod of modsByPath) {
      const packSig = await getPackSignatureCached(mod.path, headerCache);
      if (!packSig) return null;
      modSignatureData.push({
        path: mod.path,
        name: mod.name,
        loadOrder: mod.loadOrder ?? null,
        size: packSig.size,
        mtimeMs: packSig.mtimeMs,
      });
    }
    const vanillaSignatureData: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const vanillaPackPath of vanillaPackPaths) {
      const packSig = await getPackSignatureCached(vanillaPackPath, headerCache);
      if (!packSig) continue;
      vanillaSignatureData.push({
        path: vanillaPackPath,
        size: packSig.size,
        mtimeMs: packSig.mtimeMs,
      });
    }
    return hash({
      cacheVersion: COMPAT_CHECK_CACHE_VERSION,
      game: appData.currentGame,
      isCompatCheckingVanillaPacks: appData.isCompatCheckingVanillaPacks,
      mods: modSignatureData,
      vanillaPacks: vanillaSignatureData,
    });
  };
  const buildFlowExecutionSignature = async (
    sortedEnabledMods: Mod[],
    startGameOptions: StartGameOptions,
    dataFolderPath: string,
  ): Promise<string | null> => {
    const headerCache = await loadPackHeaderCache();
    const enabledModsSignatureData: Array<{
      path: string;
      name: string;
      loadOrder: number | null;
      size: number;
      mtimeMs: number;
    }> = [];
    for (const mod of sortedEnabledMods) {
      const stat = await getModStatForFlowSignature(mod, headerCache);
      if (!stat) return null;
      enabledModsSignatureData.push({
        path: mod.path,
        name: mod.name,
        loadOrder: mod.loadOrder ?? null,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
    enabledModsSignatureData.sort((first, second) => first.path.localeCompare(second.path));
    const vanillaPacksSignatureData: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
      const vanillaPackPath = nodePath.join(dataFolderPath, vanillaPackData.name);
      try {
        const stat = await fs.promises.stat(vanillaPackPath);
        vanillaPacksSignatureData.push({ path: vanillaPackPath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch (error) {
        console.error(`Failed to stat vanilla pack for flow signature: ${vanillaPackPath}`, error);
        return null;
      }
    }
    vanillaPacksSignatureData.sort((first, second) => first.path.localeCompare(second.path));
    const signaturePayload = {
      cacheVersion: FLOW_EXECUTION_CACHE_VERSION,
      game: appData.currentGame,
      gamePath: appData.gamesToGameFolderPaths[appData.currentGame].gamePath || "",
      enabledMods: enabledModsSignatureData,
      vanillaPacks: vanillaPacksSignatureData,
      userFlowOptions: sortKeysDeep(startGameOptions.userFlowOptions ?? {}),
      packDataOverwrites: sortKeysDeep(startGameOptions.packDataOverwrites ?? {}),
    };
    return hash(signaturePayload);
  };
  ipcMain.on(
    "getCustomizableMods",
    async (event, modPaths: string[], tables: string[], customizableModsHash: string) => {
      // Load cache
      const cache = await loadCustomizableModsCache();
      const customizableMods = {} as Record<string, string[]>;
      for (const modPath of modPaths) {
        if (!appData.packMetaData[modPath]) {
          const stats = await fsExtra.stat(modPath);
          appData.packMetaData[modPath] = { size: stats.size, lastChangedLocal: stats.mtimeMs };
        }
      }
      if (modPaths.length == 0) return;
      // console.log("getCustomizableMods:", modPaths);
      modPaths.sort((firstPath, secondPath) => firstPath.localeCompare(secondPath));
      const newPaths = [] as string[];
      if (appData.lastGetCustomizableMods) {
        for (let i = 0, j = 0; i < modPaths.length + appData.lastGetCustomizableMods.length; ) {
          if (i == modPaths.length) {
            break;
          }
          if (j == appData.lastGetCustomizableMods.length) {
            newPaths.push(...modPaths.slice(i));
            break;
          }
          const firstMod = modPaths[i];
          const secondMod = appData.lastGetCustomizableMods[j];
          const comparison = firstMod.localeCompare(secondMod);
          // console.log("comparing", firstMod, secondMod, comparison);
          if (comparison == 0) {
            i++;
            j++;
          } else if (comparison < 1) {
            newPaths.push(firstMod);
            i++;
          } else {
            j++;
          }
        }
        // console.log("old getCustomizableMods paths:", modPaths);
        // console.log("new getCustomizableMods paths:", newPaths);
        if (newPaths.length == 0) {
          appData.lastGetCustomizableMods = modPaths;
          return;
        }
      } else {
        newPaths.push(...modPaths);
      }
      const pathToPack = {} as Record<string, Pack>;
      const modPathsFromCache = [] as string[];
      const modPathsRead = [] as string[];
      for (const modPath of modPaths) {
        const cacheEntry = cache[modPath];
        const packMetaData = appData.packMetaData[modPath];
        // console.log(
        //   "COMPARING:",
        //   cacheEntry,
        //   packMetaData,
        //   cacheEntry.size === packMetaData.size &&
        //     cacheEntry.lastChangedLocal === packMetaData.lastChangedLocal
        // );
        if (
          cacheEntry &&
          packMetaData &&
          cacheEntry.size === packMetaData.size &&
          cacheEntry.lastChangedLocal === packMetaData.lastChangedLocal
        ) {
          customizableMods[modPath] = cacheEntry.customizableTables;
          modPathsFromCache.push(modPath);
          continue;
        }
        const pack = appData.packsData.find((pack) => pack.path == modPath);
        if (pack) {
          pathToPack[modPath] = pack;
        } else {
          modPathsRead.push(modPath);
          const pack = await readModsByPath([modPath], { skipParsingTables: true });
          if (pack[0]) pathToPack[modPath] = pack[0];
        }
      }
      console.log("getCustomizableMods modPathsFromCache:", modPathsFromCache);
      console.log("getCustomizableMods modPathsRead:", modPathsRead);
      const newPacks = Object.entries(pathToPack)
        .filter(([path]) => {
          return newPaths.includes(path);
        })
        .map(([, pack]) => pack);
      // const packs = appData.packsData.filter((pack) => newPaths.includes(pack.path));
      // if (newPacks.length != newPaths.length) {
      //   console.log("Some of the mods not yet read for getCustomizableMods.");
      //   console.log("newPacks:", newPacks);
      //   console.log("newPaths:", newPaths);
      //   return;
      // }
      const pathsWithPackedFiles = [];
      for (const path of modPaths) {
        const pack = pathToPack[path];
        if (pack && pack.packedFiles.length > 0) pathsWithPackedFiles.push(path);
      }
      appData.lastGetCustomizableMods = pathsWithPackedFiles;
      const tablesForMatching = tables.map((table) => `db\\${table}\\`);
      tablesForMatching.push("whmmflows\\");
      let cacheModified = false;
      for (const currentPack of newPacks) {
        const cacheEntry = cache[currentPack.path];
        let foundTables: string[] | undefined;
        // Check if cache is valid for this pack
        if (
          cacheEntry &&
          cacheEntry.size === currentPack.size &&
          cacheEntry.lastChangedLocal === currentPack.lastChangedLocal
        ) {
          // Use cached result
          foundTables = cacheEntry.customizableTables;
        } else {
          // Calculate and update cache
          foundTables = tablesForMatching.filter((tableForMatching) =>
            currentPack.packedFiles.some((packedFile) => packedFile.name.startsWith(tableForMatching)),
          );
          cache[currentPack.path] = {
            size: currentPack.size,
            lastChangedLocal: currentPack.lastChangedLocal,
            customizableTables: foundTables,
          };
          cacheModified = true;
        }
        if (foundTables.length > 0) {
          customizableMods[currentPack.path] = foundTables;
        }
      }
      // Save cache if modified
      if (cacheModified) {
        await saveCustomizableModsCache(cache);
      }
      for (const [packPath, tables] of Object.entries(customizableMods)) {
        appData.customizableMods[packPath] = tables;
      }
      if (hash(appData.customizableMods) == customizableModsHash) {
        console.log("customizableModsHash is the same as customizableMods, don't send it");
      } else {
        mainWindow?.webContents.send("setCustomizableMods", appData.customizableMods);
      }
    },
  );
  ipcMain.on("getPacksInSave", async (event, saveName: string) => {
    mainWindow?.webContents.send("packsInSave", await getPacksInSave(saveName));
  });
  ipcMain.handle("getListOfPacksInSave", async (event, saveName: string) => {
    return getPacksInSave(saveName);
  });
  ipcMain.handle("getPackFilesList", async (event, packPath: string) => {
    try {
      const pack = await readPack(packPath, { skipParsingTables: true });
      return pack.packedFiles.map((pf) => pf.name);
    } catch (error) {
      console.error("Failed to get pack files list:", error);
      throw error;
    }
  });
  ipcMain.handle(
    "renamePackedFiles",
    async (
      event,
      packPath: string,
      searchRegex: string,
      replaceText: string,
      useRegex: boolean,
      isDev?: boolean,
      pathFilter?: string,
    ) => {
      try {
        const { renamePackedFilesWithOptions } = await import("./packFileSerializer");
        await renamePackedFilesWithOptions(packPath, searchRegex, replaceText, useRegex, isDev, pathFilter);
      } catch (error) {
        console.error("Failed to rename packed files:", error);
        throw error;
      }
    },
  );
  ipcMain.handle(
    "executeNode",
    async (
      event,
      nodeExecutionRequest: {
        nodeId: string;
        nodeType: string;
        textValue: string;
        inputData: any;
      },
    ): Promise<{ success: boolean; data?: any; error?: string }> => {
      try {
        console.log(
          `Executing node ${nodeExecutionRequest.nodeId} (${nodeExecutionRequest.nodeType}) in backend`,
        );
        // Import node execution functions
        const { executeNodeAction } = await import("./nodeExecutor");
        const result = await executeNodeAction(nodeExecutionRequest);
        return result;
      } catch (error) {
        console.error("Failed to execute node:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown execution error",
        };
      }
    },
  );
  ipcMain.handle(
    "executeNodeGraph",
    async (
      event,
      graphExecutionRequest: {
        nodes: SerializedNode[];
        connections: SerializedConnection[];
      },
    ): Promise<{
      success: boolean;
      executionResults: Array<[string, { success: boolean; data?: any; error?: string }]>;
      totalExecuted: number;
      successCount: number;
      failureCount: number;
      error?: string;
    }> => {
      try {
        console.log(
          `Executing node graph with ${graphExecutionRequest.nodes.length} nodes and ${graphExecutionRequest.connections.length} connections`,
        );
        // Debug: Check generaterows nodes in the IPC request
        graphExecutionRequest.nodes.forEach((node) => {
          if (node.type === "generaterows") {
            console.log(`[IPC-RECEIVED] GenerateRows node ${node.id}:`);
            console.log(`  transformationsLength: ${((node.data as any).transformations || []).length}`);
            console.log(`  transformations:`, JSON.stringify((node.data as any).transformations));
            console.log(`  outputTablesLength: ${((node.data as any).outputTables || []).length}`);
            console.log(`  outputTables:`, JSON.stringify((node.data as any).outputTables));
            console.log(`  has DBNameToDBVersions: ${!!(node.data as any).DBNameToDBVersions}`);
          }
        });
        console.log("graphExecutionRequest summary:", {
          nodeCount: graphExecutionRequest.nodes.length,
          connectionCount: graphExecutionRequest.connections.length,
          nodeTypes: graphExecutionRequest.nodes.map((n) => ({ id: n.id, type: n.type })),
        });
        // Import graph execution function
        const { executeNodeGraph } = await import("./nodeGraphExecutor");
        const result = await executeNodeGraph(graphExecutionRequest);
        // Convert Map to Array for serialization
        const serializedExecutionResults = Array.from(result.executionResults.entries());
        return {
          ...result,
          executionResults: serializedExecutionResults,
        };
      } catch (error) {
        console.error("Failed to execute node graph:", error);
        return {
          success: false,
          executionResults: [],
          totalExecuted: 0,
          successCount: 0,
          failureCount: 0,
          error: error instanceof Error ? error.message : "Unknown graph execution error",
        };
      }
    },
  );
  ipcMain.handle("saveNodeFlow", async (event, flowName: string, flowData: string, packPath: string) => {
    try {
      console.log("saveNodeFlow:", flowName);
      let unsavedFiles = appData.unsavedPacksData[packPath];
      if (!unsavedFiles) {
        unsavedFiles = [];
        appData.unsavedPacksData[packPath] = unsavedFiles;
      }
      if (!flowName.startsWith("whmmflows\\")) flowName = `whmmflows\\${flowName}`;
      const buffer = Buffer.from(flowData);
      const newFile = {
        name: flowName,
        file_size: buffer.length,
        start_pos: -1,
        text: flowData,
      } as PackedFile;
      const existingFileIndex = unsavedFiles.findIndex((file) => file.name == flowName);
      if (existingFileIndex != -1) {
        unsavedFiles.splice(existingFileIndex, 1, newFile);
      } else {
        unsavedFiles.push(newFile);
      }
      mainWindow?.webContents.send("setUnsavedPacksData", packPath, unsavedFiles);
      windows.viewerWindow?.webContents.send("setUnsavedPacksData", packPath, unsavedFiles);
      return { success: true, filePath: flowName };
    } catch (error) {
      console.error("Error saving node flow:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save flow",
      };
    }
  });
  ipcMain.handle("savePackWithUnsavedFiles", async (event, packPath: string) => {
    try {
      console.log("savePackWithUnsavedFiles:", packPath);
      // Memory packs must use "Save As" since they don't have a disk location
      if (packPath.startsWith("memory://")) {
        return {
          success: false,
          error: "Memory packs must use 'Save As' to specify a save location",
        };
      }
      const unsavedFiles = appData.unsavedPacksData[packPath];
      if (!unsavedFiles || unsavedFiles.length === 0) {
        return {
          success: false,
          error: "No unsaved files found for this pack",
        };
      }
      // Read the original pack
      const pack = await readPack(packPath, { skipParsingTables: true });
      // Convert unsaved files to format for writePack (similar to DBClone.ts)
      const filesToSave = unsavedFiles.map((file) => {
        const buffer = file.buffer || Buffer.from(file.text || "");
        return {
          name: file.name,
          buffer: buffer,
          file_size: buffer.length,
        };
      });
      // Sort files by name (as done in DBClone.ts)
      const sortedFilesToSave = filesToSave.toSorted((firstPf, secondPf) => {
        return firstPf.name.localeCompare(secondPf.name);
      });
      // Try to replace the existing pack
      let savePath = packPath;
      let replacedOriginal = true;
      try {
        // Write the pack with unsaved files appended/overwritten
        await writePack(sortedFilesToSave, savePath, pack, true);
        console.log(`Pack saved to: ${savePath}`);
      } catch (error) {
        // If we can't overwrite (file in use/locked), save as _modified instead
        if (error instanceof Error && error.message.includes("EPERM")) {
          console.log("Cannot overwrite pack (file in use), saving as _modified instead");
          const packDir = nodePath.dirname(packPath);
          const packName = nodePath.basename(packPath, ".pack");
          savePath = nodePath.join(packDir, `${packName}_modified.pack`);
          replacedOriginal = false;
          await writePack(sortedFilesToSave, savePath, pack, true);
          console.log(`Pack saved to: ${savePath}`);
        } else {
          throw error;
        }
      }
      // Clear unsaved files for this pack
      delete appData.unsavedPacksData[packPath];
      windows.viewerWindow?.webContents.send("setUnsavedPacksData", packPath, []);
      return {
        success: true,
        savedPath: savePath,
        warning: !replacedOriginal
          ? "Could not replace original pack (file in use). Saved as _modified.pack instead."
          : undefined,
      };
    } catch (error) {
      console.error("Error saving pack with unsaved files:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save pack",
      };
    }
  });
  ipcMain.handle(
    "savePackAsWithUnsavedFiles",
    async (event, packPath: string, newPackName: string, newPackDirectory: string) => {
      try {
        console.log("savePackAsWithUnsavedFiles:", packPath, newPackName, newPackDirectory);
        const unsavedFiles = appData.unsavedPacksData[packPath];
        if (!unsavedFiles || unsavedFiles.length === 0) {
          return {
            success: false,
            error: "No unsaved files found for this pack",
          };
        }
        // Check if this is a memory pack (created with "New Pack" button)
        const isMemoryPack = packPath.startsWith("memory://");
        let pack;
        let useFastAppendMode = true;
        if (isMemoryPack) {
          // For memory packs, we don't have a source pack to clone, so don't use fast append mode
          useFastAppendMode = false;
          pack = undefined;
        } else {
          // For disk packs, read the original pack
          pack = await readPack(packPath, { skipParsingTables: true });
        }
        // Convert unsaved files to format for writePack (similar to DBClone.ts)
        const filesToSave = unsavedFiles.map((file) => {
          const buffer = file.buffer || Buffer.from(file.text || "");
          return {
            name: file.name,
            buffer: buffer,
            file_size: buffer.length,
          };
        });
        // Sort files by name (as done in DBClone.ts)
        const sortedFilesToSave = filesToSave.toSorted((firstPf, secondPf) => {
          return firstPf.name.localeCompare(secondPf.name);
        });
        // Create new pack path with user-provided name and directory
        const savePath = nodePath.join(newPackDirectory, `${newPackName}.pack`);
        // Check if file already exists
        if (fsExtra.existsSync(savePath)) {
          return {
            success: false,
            error: `Pack file already exists at: ${savePath}`,
          };
        }
        // Write the pack with unsaved files appended/overwritten (as done in DBClone.ts)
        // For memory packs, don't use fast append mode since there's no source pack
        await writePack(sortedFilesToSave, savePath, pack, useFastAppendMode);
        console.log(`Pack saved to: ${savePath}`);
        // Clear unsaved files for this pack
        delete appData.unsavedPacksData[packPath];
        windows.viewerWindow?.webContents.send("setUnsavedPacksData", packPath, []);
        return { success: true, savedPath: savePath };
      } catch (error) {
        console.error("Error saving pack as with unsaved files:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save pack",
        };
      }
    },
  );
  ipcMain.handle("getVisualsUnitsData", async (event, enabledMods: Mod[]) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
      if (!dataFolder) {
        return { success: false, error: "Data folder is not configured for the current game" };
      }
      const enabledModPaths = enabledMods.map((mod) => mod.path);
      const modPathToLabel = new Map<string, string>();
      for (const mod of enabledMods) {
        const trimmedHumanName = mod.humanName?.trim();
        if (trimmedHumanName) modPathToLabel.set(mod.path, trimmedHumanName);
        else {
          const baseName = nodePath.basename(mod.path);
          modPathToLabel.set(
            mod.path,
            baseName.toLowerCase().endsWith(".pack") ? baseName.slice(0, -5) : baseName,
          );
        }
      }
      const tablesToRead = Array.from(
        new Set(
          ["land_units_tables", "unit_variants_tables", "variants_tables"]
            .flatMap((tableName) => resolveTable(tableName))
            .map((tableName) => `db\\${tableName}\\`),
        ),
      );
      const sortedEnabledMods = sortByNameAndLoadOrder(enabledMods);
      const dbPriorityMods = sortedEnabledMods.toReversed();
      const dbPackName = gameToPackWithDBTablesName[appData.currentGame] || "db.pack";
      const dbPackPath = nodePath.join(dataFolder, dbPackName);
      const dataPackPath = nodePath.join(dataFolder, "data.pack");
      await readModsByPath([dbPackPath], { skipParsingTables: false, tablesToRead }, true);
      await readModsByPath(enabledModPaths, { skipParsingTables: false, readLocs: true, tablesToRead }, true);
      const localPackNames = [] as string[];
      const currentLanguage = appData.currentLanguage || "en";
      const preferredLocPack = `local_${currentLanguage}.pack`;
      if (appData.allVanillaPackNames.has(preferredLocPack)) localPackNames.push(preferredLocPack);
      if (!localPackNames.includes("local_en.pack") && appData.allVanillaPackNames.has("local_en.pack")) {
        localPackNames.push("local_en.pack");
      }
      const localPackPaths = localPackNames.map((packName) => nodePath.join(dataFolder, packName));
      if (localPackPaths.length > 0) {
        await readModsByPath(localPackPaths, { skipParsingTables: true, readLocs: true }, true);
      }
      if (fsExtra.existsSync(dataPackPath)) {
        await readModsByPath([dataPackPath], { skipParsingTables: true }, true);
      }
      const packsForTables = appData.packsData.filter(
        (pack) => pack.path === dbPackPath || enabledModPaths.includes(pack.path),
      );
      const unsortedPacksTableData = getPacksTableData(packsForTables, tablesToRead, false);
      if (!unsortedPacksTableData) {
        return { success: false, error: "Failed to build table data for visuals tab" };
      }
      const orderedPacksTableData = [] as PackViewData[];
      const dbPackTableData = unsortedPacksTableData.find((pack) => pack.packPath === dbPackPath);
      if (dbPackTableData) orderedPacksTableData.push(dbPackTableData);
      for (const mod of dbPriorityMods) {
        const ptd = unsortedPacksTableData.find((pack) => pack.packPath === mod.path);
        if (ptd) orderedPacksTableData.push(ptd);
      }
      const getTableRowDataWithPackPath = (
        packsTableData: PackViewData[],
        tableName: string,
        rowDataExtractor: (packPath: string, schemaFieldRow: AmendedSchemaField[]) => void,
      ) => {
        packsTableData.forEach((pTD) => {
          const tableFiles = Object.keys(pTD.packedFiles).filter((pFName) =>
            pFName.startsWith(`db\\${tableName}\\`),
          );
          for (const tableFile of tableFiles) {
            const packedFile = pTD.packedFiles[tableFile];
            const dbVersion = getDBVersion(packedFile);
            if (!dbVersion) continue;
            const schemaFields = packedFile.schemaFields as AmendedSchemaField[];
            const chunkedShemaFields = chunkSchemaIntoRows(schemaFields, dbVersion) as AmendedSchemaField[][];
            for (const schemaFieldRow of chunkedShemaFields) {
              rowDataExtractor(pTD.packPath, schemaFieldRow);
            }
          }
        });
      };
      const variantsByName = new Map<string, string>();
      const unitToVariantRows = new Map<string, { faction: string; variantName: string }[]>();
      const landUnitKeys = new Set<string>();
      const unitKeyToOriginPackPath = new Map<string, string>();
      const packsTableDataForOrigin = [] as PackViewData[];
      for (const mod of dbPriorityMods) {
        const ptd = unsortedPacksTableData.find((pack) => pack.packPath === mod.path);
        if (ptd) packsTableDataForOrigin.push(ptd);
      }
      if (dbPackTableData) packsTableDataForOrigin.push(dbPackTableData);
      getTableRowData(orderedPacksTableData, "variants_tables", (schemaFieldRow) => {
        const variantName = schemaFieldRow.find((field) => field.name == "variant_name")?.resolvedKeyValue;
        const variantFilename = schemaFieldRow.find(
          (field) => field.name == "variant_filename",
        )?.resolvedKeyValue;
        if (variantName) {
          variantsByName.set(variantName, variantFilename || "");
        }
      });
      getTableRowData(orderedPacksTableData, "unit_variants_tables", (schemaFieldRow) => {
        const unitKey = schemaFieldRow.find((field) => field.name == "unit")?.resolvedKeyValue;
        const variantName = schemaFieldRow.find((field) => field.name == "variant")?.resolvedKeyValue;
        const faction = schemaFieldRow.find((field) => field.name == "faction")?.resolvedKeyValue || "";
        if (!unitKey) return;
        const rows = unitToVariantRows.get(unitKey) || [];
        const existingIndex = rows.findIndex((row) => row.faction === faction);
        const nextRow = { faction, variantName: variantName || "" };
        if (existingIndex >= 0) rows.splice(existingIndex, 1, nextRow);
        else rows.push(nextRow);
        unitToVariantRows.set(unitKey, rows);
      });
      getTableRowData(orderedPacksTableData, "land_units_tables", (schemaFieldRow) => {
        const unitKey = schemaFieldRow.find((field) => field.name == "key")?.resolvedKeyValue;
        if (unitKey) landUnitKeys.add(unitKey);
      });
      getTableRowDataWithPackPath(
        packsTableDataForOrigin,
        "land_units_tables",
        (packPath, schemaFieldRow) => {
          const unitKey = schemaFieldRow.find((field) => field.name == "key")?.resolvedKeyValue;
          if (!unitKey) return;
          if (unitKeyToOriginPackPath.has(unitKey)) return;
          unitKeyToOriginPackPath.set(unitKey, packPath);
        },
      );
      const locPacksInPriority = [...localPackPaths, ...dbPriorityMods.map((mod) => mod.path)]
        .map((packPath) => appData.packsData.find((pack) => pack.path === packPath))
        .filter((pack): pack is Pack => !!pack);
      const localizedNames = new Map<string, string>();
      for (const pack of locPacksInPriority) {
        const trie = getLocsTrie(pack);
        if (!trie) continue;
        for (const [key, value] of Object.entries(trie.getEntries())) {
          localizedNames.set(key, value);
        }
      }
      const getLocalizedName = (locId: string) => localizedNames.get(locId);
      const resolveVisualsLoc = (locId: string) => {
        const localized = getLocalizedName(locId);
        return resolveTextReplacements(localized, getLocalizedName) || localized;
      };
      const visualsUnits = [] as {
        unitKey: string;
        faction: string;
        localizedName: string;
        variantName?: string;
        variantMeshPath?: string;
        originPackPath: string;
        originLabel: string;
      }[];
      for (const unitKey of landUnitKeys) {
        const rows = unitToVariantRows.get(unitKey);
        const localizedName = resolveVisualsLoc(`land_units_onscreen_name_${unitKey}`) || unitKey;
        const originPackPath = unitKeyToOriginPackPath.get(unitKey) || dbPackPath;
        const originLabel =
          originPackPath === dbPackPath
            ? "Vanilla"
            : modPathToLabel.get(originPackPath) || nodePath.basename(originPackPath);
        if (!rows || rows.length === 0) {
          visualsUnits.push({ unitKey, faction: "", localizedName, originPackPath, originLabel });
          continue;
        }
        for (const row of rows) {
          const variantFilename = row.variantName ? variantsByName.get(row.variantName) : undefined;
          const variantMeshPath =
            variantFilename && variantFilename.trim() !== ""
              ? toVariantMeshDefinitionPath(variantFilename)
              : undefined;
          visualsUnits.push({
            unitKey,
            faction: row.faction,
            localizedName,
            variantName: row.variantName || undefined,
            variantMeshPath,
            originPackPath,
            originLabel,
          });
        }
      }
      visualsUnits.sort((first, second) => {
        const nameDiff = collator.compare(first.localizedName, second.localizedName);
        if (nameDiff !== 0) return nameDiff;
        const keyDiff = collator.compare(first.unitKey, second.unitKey);
        if (keyDiff !== 0) return keyDiff;
        return collator.compare(first.faction || "", second.faction || "");
      });
      const vanillaVariantsPackPaths = [...appData.allVanillaPackNames]
        .filter((packName) => packName.toLowerCase().startsWith("variants"))
        .map((packName) => nodePath.join(dataFolder, packName))
        .filter((packPath) => fsExtra.existsSync(packPath))
        .toSorted((first, second) => collator.compare(nodePath.basename(first), nodePath.basename(second)));
      // Keep this in low->high priority order so later packs override earlier ones in search aggregation.
      const fileSearchPackPaths = [
        ...vanillaVariantsPackPaths,
        ...(fsExtra.existsSync(dataPackPath) ? [dataPackPath] : []),
        ...sortedEnabledMods.map((mod) => mod.path),
      ];
      const sessionId = `visuals_${hash({
        game: appData.currentGame,
        language: appData.currentLanguage || "en",
        enabledModPaths: [...enabledModPaths].sort(),
      })}`;
      visualsSessions.set(sessionId, {
        sessionId,
        enabledModPaths,
        dbPriorityPackPaths: [dbPackPath, ...dbPriorityMods.map((mod) => mod.path)],
        fileSearchPackPaths,
        createdAt: Date.now(),
      });
      return {
        success: true,
        sessionId,
        units: visualsUnits,
      };
    } catch (error) {
      console.error("Error building visuals units data:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to build visuals units data",
      };
    }
  });
  ipcMain.handle("readVariantMeshDefinition", async (event, sessionId: string, fileName: string) => {
    try {
      const session = visualsSessions.get(sessionId);
      if (!session) return { success: false, error: "Visuals session expired or missing" };
      const resolved = await resolveVisualsFileInSession(session, fileName, {
        variantMeshDefinitionFallback: true,
      });
      if (!resolved?.requestedPath) return { success: false, error: "Missing variantmeshdefinition path" };
      if (!resolved.pack || !resolved.fileName) {
        return {
          success: false,
          error: `File not found in enabled mods or vanilla visuals packs (variants*.pack/data.pack): ${resolved.requestedPath}`,
        };
      }
      await readFromExistingPack(resolved.pack, {
        filesToRead: [resolved.fileName],
        skipParsingTables: true,
      });
      const refreshedFile = findPackedFileCaseInsensitive(resolved.pack, resolved.fileName);
      if (refreshedFile) {
        const text = decodePackedFileText(refreshedFile);
        if (text == null) {
          return { success: false, error: `Unable to decode ${resolved.fileName}` };
        }
        return {
          success: true,
          text,
          resolved: {
            packPath: resolved.packPath,
            fileName: resolved.fileName,
          },
        };
      }
      return { success: false, error: `File was found but could not be reloaded: ${resolved.fileName}` };
    } catch (error) {
      console.error("Error reading variantmeshdefinition:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to read variantmeshdefinition",
      };
    }
  });
  ipcMain.handle(
    "searchVisualsFiles",
    async (event, sessionId: string, query: string, offset = 0, limit = 200) => {
      try {
        const session = visualsSessions.get(sessionId);
        if (!session) return { success: false, error: "Visuals session expired or missing" };
        const normalizedQuery = normalizePackFilePathKey(query || "");
        const uniqueResults = new Map<
          string,
          { path: string; ext: "variantmeshdefinition" | "wsmodel" | "rigid_model_v2" }
        >();
        for (const packPath of session.fileSearchPackPaths) {
          let pack = appData.packsData.find((existingPack) => existingPack.path === packPath);
          if (!pack) {
            const newPack = await readPack(packPath, { skipParsingTables: true });
            appendPacksData(newPack);
            pack = appData.packsData.find((existingPack) => existingPack.path === packPath);
          }
          if (!pack) continue;
          for (const packedFile of pack.packedFiles) {
            const normalizedName = normalizePackFilePathKey(packedFile.name);
            let ext: "variantmeshdefinition" | "wsmodel" | "rigid_model_v2" | undefined;
            if (normalizedName.endsWith(".variantmeshdefinition")) ext = "variantmeshdefinition";
            else if (normalizedName.endsWith(".wsmodel")) ext = "wsmodel";
            else if (normalizedName.endsWith(".rigid_model_v2")) ext = "rigid_model_v2";
            if (!ext) continue;
            if (normalizedQuery && !normalizedName.includes(normalizedQuery)) continue;
            uniqueResults.set(normalizedName, { path: packedFile.name, ext });
          }
        }
        const allResults = Array.from(uniqueResults.values()).sort((first, second) =>
          collator.compare(first.path, second.path),
        );
        const safeOffset = Math.max(0, offset || 0);
        const safeLimit = Math.max(1, Math.min(1000, limit || 200));
        return {
          success: true,
          total: allResults.length,
          results: allResults.slice(safeOffset, safeOffset + safeLimit),
        };
      } catch (error) {
        console.error("Error searching visuals files:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to search visuals files",
        };
      }
    },
  );
  ipcMain.handle(
    "openInAssetEditor",
    async (
      event,
      sessionId: string,
      packInternalPath: string,
      mode: "new" | "existing",
      preferredPackPath?: string,
    ) => {
      try {
        const session = visualsSessions.get(sessionId);
        if (!session) return { success: false, error: "Visuals session expired or missing" };
        if (mode !== "new" && mode !== "existing") {
          return { success: false, error: `Invalid AssetEditor open mode: ${String(mode)}` };
        }
        if (process.platform !== "win32") {
          return { success: false, error: "AssetEditor IPC is supported only on Windows." };
        }
        const resolved = await resolveVisualsFileInSession(session, packInternalPath, {
          variantMeshDefinitionFallback: true,
          preferredPackPath,
        });
        if (!resolved?.requestedPath) return { success: false, error: "Missing file path" };
        if (!resolved.packPath || !resolved.fileName) {
          return {
            success: false,
            error: `File not found in enabled mods or vanilla visuals packs (variants*.pack/data.pack): ${resolved.requestedPath}`,
          };
        }
        const response = await sendAssetEditorOpenRequest({
          path: resolved.fileName,
          packPathOnDisk: resolved.packPath,
          openInExistingKitbashTab: mode === "existing",
        });
        if (!response.ok) {
          return {
            success: false,
            error: response.error || "AssetEditor rejected the open request",
            resolved: {
              packPath: resolved.packPath,
              fileName: resolved.fileName,
            },
            response,
          };
        }
        return {
          success: true,
          resolved: {
            packPath: resolved.packPath,
            fileName: resolved.fileName,
          },
          response,
        };
      } catch (error) {
        console.error("Error sending AssetEditor open request:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to send AssetEditor open request",
        };
      }
    },
  );
  ipcMain.handle("readFileFromPack", async (event, packPath: string, fileName: string) => {
    try {
      console.log("readFileFromPack:", packPath, fileName);
      // Read the pack with the specific file
      const pack = await readPack(packPath, { filesToRead: [fileName] });
      // Find the file
      const file = pack.packedFiles.find((pf) => pf.name === fileName);
      if (!file) {
        return {
          success: false,
          error: `File "${fileName}" not found in pack`,
        };
      }
      // Convert buffer to text
      let text: string;
      if (file.text) {
        text = file.text;
      } else if (file.buffer) {
        text = file.buffer.toString("utf-8");
      } else {
        return {
          success: false,
          error: "File has no readable content",
        };
      }
      return { success: true, text };
    } catch (error) {
      console.error("Error reading file from pack:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to read file from pack",
      };
    }
  });
  ipcMain.handle("getFlowFilesFromPack", async (event, packPath: string) => {
    try {
      console.log("getFlowFilesFromPack:", packPath);
      // Check if there are unsaved flow files for this pack
      const unsavedFiles = appData.unsavedPacksData[packPath] || [];
      const unsavedFlowFiles = unsavedFiles.filter((file) => file.name.startsWith("whmmflows\\"));
      // Read the pack to get flow files
      const pack = await readPack(packPath, { skipParsingTables: true, readFlows: true });
      // Find all flow files in the pack
      const packFlowFiles = pack.packedFiles.filter((pf) => pf.name.startsWith("whmmflows\\"));
      // Combine pack files with unsaved files (unsaved takes priority)
      const flowFiles: { name: string; content: string }[] = [];
      // Add pack flow files
      for (const file of packFlowFiles) {
        // Skip if there's an unsaved version
        if (unsavedFlowFiles.some((uf) => uf.name === file.name)) continue;
        let text: string;
        if (file.text) {
          text = file.text;
        } else if (file.buffer) {
          text = file.buffer.toString("utf-8");
        } else {
          console.log("CANNOT GET TEXT FOR FLOW FILE");
          continue;
        }
        flowFiles.push({ name: file.name, content: text });
      }
      // Add unsaved flow files
      for (const file of unsavedFlowFiles) {
        let text: string;
        if (file.text) {
          text = file.text;
        } else if (file.buffer) {
          text = file.buffer.toString("utf-8");
        } else {
          continue;
        }
        flowFiles.push({ name: file.name, content: text });
      }
      return { success: true, flowFiles };
    } catch (error) {
      console.error("Error getting flow files from pack:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get flow files from pack",
      };
    }
  });
  ipcMain.on("readAppConfig", async () => {
    let doesConfigExist = true;
    try {
      try {
        const appState = await readConfig();
        mainWindow?.webContents.send("fromAppConfig", appState);
        console.log("appState.currentLanguage:", appState.currentLanguage);
        if (appState.currentLanguage) {
          const languageInConfig = appState.currentLanguage || "en";
          if (i18n.language != languageInConfig || appData.currentLanguage != languageInConfig) {
            appData.currentLanguage = languageInConfig;
            i18n.changeLanguage(languageInConfig).then(() => {
              mainWindow?.webContents.send("setCurrentLanguage", languageInConfig);
            });
          }
        }
      } catch (err) {
        mainWindow?.webContents.send("failedReadingConfig");
        if (err instanceof Error) console.log(err.message);
        doesConfigExist = false;
      }
      const gamesToCheck = doesConfigExist ? [appData.currentGame] : supportedGames;
      for (const game of gamesToCheck) {
        console.log(`checking game: ${game}`);
        const dataFolder = appData.gamesToGameFolderPaths[game].dataFolder;
        const contentFolder = appData.gamesToGameFolderPaths[game].contentFolder;
        const gamePath = appData.gamesToGameFolderPaths[game].gamePath;
        if (!gamePath || !contentFolder || !dataFolder) {
          await getFolderPaths(log, game);
        }
        if (appData.gamesToGameFolderPaths[game].contentFolder) {
          appData.currentGame = game;
          initializeAllSchemaForGame(game);
          break;
        }
      }
      getAllMods().then(async () => {
        try {
          if (doesConfigExist) return;
          const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
          if (!gamePath) return;
          const usedModsFilePath = nodePath.join(gamePath, "used_mods.txt");
          const usedModsData = await fs.promises.readFile(usedModsFilePath, "utf8");
          const modsToEnable: string[] = [];
          for (const line of usedModsData.split("\n")) {
            const match = line.match(/mod\s+"([^"]+)";/);
            if (match) {
              modsToEnable.push(match[1]);
            }
          }
          console.log("config doesn't exist, enabling mods from used_mods.txt:", modsToEnable);
          mainWindow?.webContents.send("enableModsByName", modsToEnable);
        } catch {
          // Ignore a missing used_mods fallback file.
        }
      });
    } finally {
      const contentFolder = appData.gamesToGameFolderPaths[appData.currentGame].contentFolder;
      const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
      console.log("SENDING setAppFolderPaths", gamePath, contentFolder);
      mainWindow?.webContents.send("setAppFolderPaths", {
        gamePath: gamePath || "",
        contentFolder: contentFolder || "",
      } as GameFolderPaths);
      if (!doesConfigExist) {
        mainWindow?.webContents.send("setCurrentGame", appData.currentGame);
      }
      mainWindow?.webContents.send("setCurrentLanguage", appData.currentLanguage);
    }
    console.log(
      "NUM MODS IN APPDATA",
      appData.currentGame,
      appData.gameToCurrentPreset[appData.currentGame]?.mods.length,
    );
    // for testing, automatically opens db.pack
    if (appData.startArgs.includes("-testDBClone")) {
      if (appData.gamesToGameFolderPaths[appData.currentGame].dataFolder)
        ipcMain.emit(
          "requestOpenModInViewer",
          null,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          nodePath.join(appData.gamesToGameFolderPaths[appData.currentGame].dataFolder!, "db.pack"),
        );
    }
  });
  ipcMain.on("selectContentFolder", async (event, requestedGame: SupportedGames | undefined) => {
    try {
      if (!mainWindow) return;
      const dialogReturnValue = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "showHiddenFiles"],
      });
      if (!dialogReturnValue.canceled) {
        const contentFolderPath = dialogReturnValue.filePaths[0];
        const game = requestedGame || appData.currentGame;
        appData.gamesToGameFolderPaths[game].contentFolder = contentFolderPath;
        mainWindow?.webContents.send("setContentFolder", contentFolderPath);
        refreshModsIfFoldersValid(requestedGame);
      }
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("selectWarhammer3Folder", async (event, requestedGame: SupportedGames | undefined) => {
    try {
      if (!mainWindow) return;
      const dialogReturnValue = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "showHiddenFiles"],
      });
      if (!dialogReturnValue.canceled) {
        const wh3FolderPath = dialogReturnValue.filePaths[0];
        const game = requestedGame || appData.currentGame;
        appData.gamesToGameFolderPaths[game].gamePath = wh3FolderPath;
        appData.gamesToGameFolderPaths[game].dataFolder = nodePath.join(wh3FolderPath, "/data/");
        mainWindow?.webContents.send("setWarhammer3Folder", wh3FolderPath);
        if (appData.gamesToGameFolderPaths[game].gamePath == undefined) return;
        const calculatedContentPath = nodePath.join(
          appData.gamesToGameFolderPaths[game].gamePath as string,
          "..",
          "..",
          "workshop",
          "content",
          gameToSteamId[game],
        );
        if (fs.existsSync(calculatedContentPath)) {
          appData.gamesToGameFolderPaths[game].contentFolder = calculatedContentPath;
          mainWindow?.webContents.send("setContentFolder", calculatedContentPath);
        }
        // shogun 2 doesn't use the content folder, puts subscribed to mods directly into data
        if (requestedGame == "shogun2") {
          appData.gamesToGameFolderPaths[game].contentFolder = wh3FolderPath;
          mainWindow?.webContents.send("setContentFolder", wh3FolderPath);
        }
        refreshModsIfFoldersValid(requestedGame);
      }
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.handle("getSteamCollectionName", async (event, steamCollectionURL: string) => {
    try {
      console.log("getting steamCollectionURL name:", steamCollectionURL);
      const res = await fetch(steamCollectionURL);
      const cheerioObj = cheerio.load(await res.text());
      const collectionTitle = cheerioObj(".collectionHeaderContent").find(".workshopItemTitle").text();
      console.log("collection title:", collectionTitle);
      return collectionTitle;
    } catch (e) {
      console.log(e);
    }
    return "";
  });
  ipcMain.handle(
    "translate",
    async (event, translationId: string, options?: Record<string, string | number>) => {
      if (i18n.language != appData.currentLanguage) {
        await i18n.changeLanguage(appData.currentLanguage);
      }
      return i18n.t(translationId, options);
    },
  );
  ipcMain.handle(
    "translateAll",
    async (event, translationIdsWithOptions: Record<string, Record<string, string | number>>) => {
      if (i18n.language != appData.currentLanguage) {
        await i18n.changeLanguage(appData.currentLanguage);
      }
      const translated: Record<string, string> = {};
      for (const id of Object.keys(translationIdsWithOptions)) {
        translated[id] = i18n.t(id, translationIdsWithOptions[id]);
      }
      return translated;
    },
  );
  ipcMain.handle("translateAllStatic", async (event, translationIds: Record<string, string | number>) => {
    console.log("translateAllStatic handler, language is", i18n.language);
    if (i18n.language != appData.currentLanguage) {
      await i18n.changeLanguage(appData.currentLanguage);
    }
    const translated: Record<string, string> = {};
    for (const id of Object.keys(translationIds)) {
      translated[id] = i18n.t(id);
    }
    return translated;
  });
  ipcMain.on("getCompatData", async (event, mods: Mod[]) => {
    console.log("SET PACK COLLISIONS");
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataFolder) return;
    const vanillaPackPaths = getCompatVanillaPackPaths(dataFolder);
    const compatSignature = await buildCompatCheckSignature(mods, vanillaPackPaths);
    if (compatSignature && compatCheckCache?.signatureHash === compatSignature) {
      console.log("getCompatData: cache hit, sending cached collisions");
      mainWindow?.webContents.send("setPackCollisions", compatCheckCache.packCollisions);
      return;
    }
    await readMods(mods, false, true, true);
    await readModsByPath(
      vanillaPackPaths,
      { skipParsingTables: true, readScripts: appData.isCompatCheckingVanillaPacks },
      true,
    );
    const lazyVanillaReadPlan = getLazyCompatVanillaReadPlan(mods, vanillaPackPaths);
    if (lazyVanillaReadPlan.packPaths.length > 0 && lazyVanillaReadPlan.tablesToRead.length > 0) {
      await readModsByPath(
        lazyVanillaReadPlan.packPaths,
        { skipParsingTables: false, tablesToRead: lazyVanillaReadPlan.tablesToRead },
        true,
      );
    }
    const packCollisions = getCompatData(
      appData.packsData,
      (currentIndex, maxIndex, firstPackName, secondPackName, type) => {
        mainWindow?.webContents.send("setPackCollisionsCheckProgress", {
          currentIndex,
          maxIndex,
          firstPackName,
          secondPackName,
          type,
        } as PackCollisionsCheckProgressData);
      },
    );
    if (compatSignature) {
      compatCheckCache = {
        signatureHash: compatSignature,
        createdAt: Date.now(),
        packCollisions,
      };
    }
    mainWindow?.webContents.send("setPackCollisions", packCollisions);
    emptyAllCompatDataCollections();
  });
  ipcMain.on("copyToData", async (event, modPathsToCopy?: string[]) => {
    if (!appData.gamesToGameFolderPaths[appData.currentGame].gamePath) return;
    console.log("copyToData: modPathsToCopy:", modPathsToCopy);
    const mods = await getMods(log);
    let withoutDataMods = mods.filter((mod) => !mod.isInData);
    if (modPathsToCopy) {
      withoutDataMods = withoutDataMods.filter((mod) =>
        modPathsToCopy.some((modPathToCopy) => modPathToCopy == mod.path),
      );
    }
    const copyPromises = withoutDataMods.map((mod) => {
      mainWindow?.webContents.send(
        "handleLog",
        `COPYING ${mod.path} to ${appData.gamesToGameFolderPaths[appData.currentGame].gamePath}\\data\\${
          mod.name
        }`,
      );
      if (!appData.gamesToGameFolderPaths[appData.currentGame].gamePath) throw new Error("game path not set");
      return fs.copyFileSync(
        mod.path,
        nodePath.join(
          appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
          "/data/",
          mod.name,
        ),
      );
    });
    await Promise.allSettled(copyPromises);
    // getAllMods();
  });
  ipcMain.on("copyToDataAsSymbolicLink", async (event, modPathsToCopy?: string[]) => {
    console.log("copyToDataAsSymbolicLink modPathsToCopy:", modPathsToCopy);
    const mods = await getMods(log);
    let withoutDataMods = mods.filter((mod) => !mod.isInData);
    if (modPathsToCopy) {
      withoutDataMods = withoutDataMods.filter((mod) =>
        modPathsToCopy.some((modPathToCopy) => modPathToCopy == mod.path),
      );
    }
    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
    if (!gamePath) return;
    const pathsOfNewSymLinks = withoutDataMods.map((mod) =>
      nodePath.join(gamePath ?? "", "/data/", mod.name),
    );
    const copyPromises = withoutDataMods.map((mod) => {
      mainWindow?.webContents.send(
        "handleLog",
        `CREATING SYMLINK of ${mod.path} to ${gamePath}\\data\\${mod.name}`,
      );
      if (!gamePath) throw new Error("game path not set");
      return fsExtra.symlink(mod.path, nodePath.join(gamePath, "/data/", mod.name));
    });
    await Promise.allSettled(copyPromises);
    // should be tracked automatically by the data watcher, but chokidar can choke on symlinks here
    for (const pathsOfNewSymLink of pathsOfNewSymLinks) {
      onNewPackFound(pathsOfNewSymLink);
    }
    // getAllMods();
  });
  ipcMain.on("cleanData", async () => {
    const mods = await getMods(log);
    mods.forEach((mod) => {
      if (mod.isInData) mainWindow?.webContents.send("handleLog", `is in data ${mod.name}`);
    });
    const modsInBothPlaces = mods.filter(
      (mod) =>
        mod.isInData &&
        !mod.isInModding &&
        mods.find((modSecond) => !modSecond.isInData && !modSecond.isInData && modSecond.name === mod.name),
    );
    const deletePromises = modsInBothPlaces.map((mod) => {
      mainWindow?.webContents.send("handleLog", `DELETING ${mod.path}`);
      return fs.unlinkSync(mod.path);
    });
    await Promise.allSettled(deletePromises);
    // Clear whmm_overwrites directory
    try {
      const gamePath = appData.gamesToGameFolderPaths[appData.currentGame]?.gamePath;
      if (gamePath) {
        const overwritesDirPath = nodePath.join(gamePath, "whmm_overwrites");
        if (fsExtra.existsSync(overwritesDirPath)) {
          console.log(`DELETING whmm_overwrites directory: ${overwritesDirPath}`);
          fsExtra.removeSync(overwritesDirPath);
          console.log("Successfully cleared whmm_overwrites");
        }
      }
    } catch (error) {
      console.log(
        `Error clearing whmm_overwrites: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    // getAllMods();
  });
  ipcMain.on("cleanSymbolicLinksInData", async () => {
    const mods = await getMods(log);
    const symLinksToDelete = mods.filter((mod) => mod.isInData && mod.isSymbolicLink);
    console.log("symLinksToDelete", symLinksToDelete);
    const deletePromises = symLinksToDelete.map((mod) => {
      mainWindow?.webContents.send("handleLog", `DELETING SYMLINK ${mod.path}`);
      return fs.unlinkSync(mod.path);
    });
    await Promise.allSettled(deletePromises);
    // should be tracked automatically by the data watcher, but chokidar can choke on symlinks here
    for (const deletedSymLink of symLinksToDelete) {
      onPackDeleted(deletedSymLink.path);
    }
    // getAllMods();
  });
  ipcMain.on("saveConfig", (event, data: AppState) => {
    console.log("saveConfig");
    const enabledMods = data.currentPreset.mods.filter(
      (iterMod) => iterMod.isEnabled || data.alwaysEnabledMods.find((mod) => mod.name === iterMod.name),
    );
    appData.enabledMods = enabledMods;
    appData.allMods = data.allMods;
    appData.isCompatCheckingVanillaPacks = data.isCompatCheckingVanillaPacks;
    appData.isChangingGameProcessPriority = data.isChangingGameProcessPriority;
    const hiddenAndEnabledMods = data.hiddenMods.filter((iterMod) =>
      enabledMods.find((mod) => mod.name === iterMod.name),
    );
    mainWindow?.setTitle(
      `WH3 Mod Manager v${version}: ${enabledMods.length} mods enabled` +
        (hiddenAndEnabledMods.length > 0 ? ` (${hiddenAndEnabledMods.length} of those hidden)` : "") +
        ` for ${gameToGameName[appData.currentGame]}`,
    );
    // console.log(
    //   "BEFORE saveconfig",
    //   appData.gameToCurrentPreset["wh2"]?.mods[0].name,
    //   appData.gameToCurrentPreset["wh3"]?.mods[0].name,
    //   data.currentGame,
    //   data.currentPreset.mods[0].name
    // );
    writeAppConfig(data);
  });
  ipcMain.on("getSkillsForSubtype", async (event, subtype: string, subtypeIndex: number) => {
    getSkillsForSubtype(subtype, subtypeIndex);
  });
  ipcMain.on("createNewSkillTree", async (event, subtype: string) => {
    const cachedSkillsData = appData.skillsData;
    if (!cachedSkillsData) return;
    const newSetKey = `new_skill_set_${subtype}_${Date.now()}`;
    // Copy agent type/subtype data from the existing set
    const originalSet = cachedSkillsData.subtypeAndSets.find((s) => s.agentSubtype === subtype);
    cachedSkillsData.subtypeAndSets.push({
      key: newSetKey,
      agentSubtype: subtype,
      agentKey: originalSet?.agentKey || "",
      campaignKey: originalSet?.campaignKey || "",
      factionKey: originalSet?.factionKey || "",
      subculture: originalSet?.subculture || "",
      forArmy: originalSet?.forArmy || "false",
      forNavy: originalSet?.forNavy || "false",
    });
    if (!cachedSkillsData.subtypesToSet[subtype]) {
      cachedSkillsData.subtypesToSet[subtype] = [];
    }
    cachedSkillsData.subtypesToSet[subtype].push(newSetKey);
    cachedSkillsData.setToNodes[newSetKey] = [];
    const newSubtypeIndex = cachedSkillsData.subtypesToSet[subtype].length - 1;
    getSkillsForSubtype(subtype, newSubtypeIndex);
  });
  ipcMain.handle("saveSkillsPack", async (event, data: SaveSkillsPackPayload) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
      if (!dataFolder) return { success: false, error: "Data folder not found" };
      const ts = data.generationTimestamp || Date.now().toString();
      const {
        subtype,
        subtypeIndex,
        nodes,
        edges,
        packName,
        packDirectory,
        cloneAllSkills,
        tableNameTemplate,
        nodeKeyTemplate,
        skillKeyTemplate,
      } = data;
      const defaultModdersPrefix = normalizeGeneratedPrefix(appData.moddersPrefix);
      const kp = defaultModdersPrefix || "custom";
      const setSuffix = buildDefaultSkillSetSuffix(subtype);
      const currentSetKey = appData.skillsData?.subtypesToSet?.[subtype]?.[subtypeIndex];
      const currentSetCampaignKey =
        appData.skillsData?.subtypeAndSets?.find((set) => set.key === currentSetKey)?.campaignKey || "";
      const tn = resolveSkillGenerationTemplate(
        tableNameTemplate?.trim() || "${prefix}_${setSuffix}_${timestamp}",
        {
          prefix: kp,
          setSuffix,
          timestamp: ts,
          row: "",
          column: "",
        },
      );
      // Build key mappings: old nodeId → new node key, index-based new skill key
      const nodeIdToNewNodeKey: Record<string, string> = {};
      const nodeIdToNewSkillKey: Record<string, string> = {};
      for (let i = 0; i < nodes.length; i++) {
        nodeIdToNewNodeKey[nodes[i].nodeId] = appendScopedSkillNodeHash(
          resolveSkillGenerationTemplate(nodeKeyTemplate?.trim() || "${prefix}_skill_node_${row}_${column}", {
            prefix: kp,
            setSuffix,
            timestamp: ts,
            row: nodes[i].row.toString(),
            column: nodes[i].column.toString(),
          }),
          currentSetCampaignKey,
          nodes[i].faction,
          nodes[i].subculture,
        );
        if (!cloneAllSkills && nodes[i].existingSkillKey) {
          nodeIdToNewSkillKey[nodes[i].nodeId] = nodes[i].existingSkillKey!;
        } else {
          nodeIdToNewSkillKey[nodes[i].nodeId] = appendScopedSkillNodeHash(
            resolveSkillGenerationTemplate(skillKeyTemplate?.trim() || "${prefix}_skill_${row}_${column}", {
              prefix: kp,
              setSuffix,
              timestamp: ts,
              row: nodes[i].row.toString(),
              column: nodes[i].column.toString(),
            }),
            currentSetCampaignKey,
            nodes[i].faction,
            nodes[i].subculture,
          );
        }
      }
      const customNodes = cloneAllSkills ? nodes : nodes.filter((n) => !n.existingSkillKey);
      const newSetKey = `${kp}_${setSuffix}`;
      const buildRowFromSchema = (
        dbFields: DBField[],
        values: Record<string, string | boolean>,
      ): (string | boolean)[] => {
        return dbFields.map((field) => {
          if (values[field.name] !== undefined) return values[field.name];
          return field.default_value ?? "";
        });
      };
      const buildDBFileBuffer = async (
        version: number,
        rows: (string | boolean)[][],
        dbFields: DBField[],
      ): Promise<Buffer> => {
        const parts: Buffer[] = [];
        // Version marker
        parts.push(Buffer.from([0xfc, 0xfd, 0xfe, 0xff]));
        // Version number (int32 LE)
        const vBuf = Buffer.alloc(4);
        vBuf.writeInt32LE(version, 0);
        parts.push(vBuf);
        // Marker byte
        parts.push(Buffer.from([0x01]));
        // Entry count (int32 LE)
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        // Row data
        for (const row of rows) {
          for (let i = 0; i < dbFields.length; i++) {
            parts.push(await typeToBuffer(dbFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const buildLocFileBuffer = async (rows: (string | boolean)[][]): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xff, 0xfe])); // BOM
        parts.push(Buffer.from([0x4c, 0x4f, 0x43])); // "LOC"
        parts.push(Buffer.from([0x00])); // marker
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(1, 0);
        parts.push(cBuf);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        for (const row of rows) {
          for (let i = 0; i < LocFields.length; i++) {
            parts.push(await typeToBuffer(LocFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const defaultTableVersions = await getDefaultTableVersions();
      const getPreferredSchema = (tableName: string) => {
        const versions = DBNameToDBVersions[appData.currentGame][tableName];
        if (!versions || versions.length === 0) throw new Error(`No schema found for ${tableName}`);
        const defaultVersion = defaultTableVersions?.[tableName];
        return versions.find((version) => version.version === defaultVersion) || versions[0];
      };
      const packFiles: NewPackedFile[] = [];
      // 1. character_skill_node_sets_tables — one row
      {
        const tableName = "character_skill_node_sets_tables";
        const schema = getPreferredSchema(tableName);
        const originalSet = appData.skillsData?.subtypeAndSets?.find((s) => s.agentSubtype === subtype);
        const rows = [
          buildRowFromSchema(schema.fields, {
            key: newSetKey,
            agent_subtype_key: subtype,
            agent_key: originalSet?.agentKey || "",
            campaign_key: originalSet?.campaignKey || "",
            faction_key: originalSet?.factionKey || "",
            subculture: originalSet?.subculture || "",
            for_army: originalSet?.forArmy || "false",
            for_navy: originalSet?.forNavy || "false",
          }),
        ];
        const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
        packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
      }
      // 2. character_skills_tables — one row per custom node (existing skills already exist)
      {
        const tableName = "character_skills_tables";
        const schema = getPreferredSchema(tableName);
        const rows = customNodes.map((node, i) =>
          buildRowFromSchema(schema.fields, {
            key: nodeIdToNewSkillKey[node.nodeId],
            image_path: node.imgPath || "",
            unlocked_at_rank: node.unlockRank.toString(),
          }),
        );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 3. character_skill_nodes_tables — one row per node
      {
        const tableName = "character_skill_nodes_tables";
        const schema = getPreferredSchema(tableName);
        const rows = nodes.map((node, i) =>
          buildRowFromSchema(schema.fields, {
            key: nodeIdToNewNodeKey[node.nodeId],
            character_skill_key: nodeIdToNewSkillKey[node.nodeId],
            tier: node.column.toString(),
            indent: node.row.toString(),
            visible_in_ui: "1",
            faction_key: node.faction || "",
            subculture: node.subculture || "",
            required_num_parents: (node.requiredNumParents || 0).toString(),
          }),
        );
        const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
        packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
      }
      // 4. character_skill_node_set_items_tables — one row per node
      {
        const tableName = "character_skill_node_set_items_tables";
        const schema = getPreferredSchema(tableName);
        const rows = nodes.map((node) =>
          buildRowFromSchema(schema.fields, {
            set: newSetKey,
            item: nodeIdToNewNodeKey[node.nodeId],
            mod_disabled: "false",
          }),
        );
        const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
        packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
      }
      // 5. character_skill_node_links_tables — one row per edge
      if (edges.length > 0) {
        const tableName = "character_skill_node_links_tables";
        const schema = getPreferredSchema(tableName);
        const rows = edges
          .filter((e) => nodeIdToNewNodeKey[e.source] && nodeIdToNewNodeKey[e.target])
          .map((edge) =>
            buildRowFromSchema(schema.fields, {
              parent_key: nodeIdToNewNodeKey[edge.source],
              child_key: nodeIdToNewNodeKey[edge.target],
              link_type: edge.linkType || "REQUIRED",
              parent_link_position: "1",
              child_link_position: "1",
            }),
          );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 6. character_skill_level_to_effects_junctions_tables — one row per effect per custom skill (existing skills already have effects)
      {
        const tableName = "character_skill_level_to_effects_junctions_tables";
        const schema = getPreferredSchema(tableName);
        const rows: (string | boolean)[][] = [];
        for (const node of customNodes) {
          const skillKey = nodeIdToNewSkillKey[node.nodeId];
          for (const effect of node.effects) {
            rows.push(
              buildRowFromSchema(schema.fields, {
                character_skill_key: skillKey,
                effect_key: effect.effectKey,
                effect_scope: effect.effectScope || "character_to_character_own",
                level: (effect.level || 1).toString(),
                value: effect.value || "0",
              }),
            );
          }
        }
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 7. character_skill_nodes_skill_locks_tables — one row per skill lock
      if (data.skillLocks && data.skillLocks.length > 0) {
        const tableName = "character_skill_nodes_skill_locks_tables";
        const schema = getPreferredSchema(tableName);
        const rows = data.skillLocks
          .filter((lock) => nodes.some((n) => n.nodeId === lock.lockedNodeId))
          .map((lock) => {
            const lockingNode = nodes.find((n) => n.skillId === lock.lockingSkillKey);
            return buildRowFromSchema(schema.fields, {
              character_skill: lockingNode
                ? (nodeIdToNewSkillKey[lockingNode.nodeId] || lock.lockingSkillKey)
                : lock.lockingSkillKey,
              character_skill_node: nodeIdToNewNodeKey[lock.lockedNodeId] || lock.lockedNodeId,
              level: lock.requiredLevel.toString(),
            });
          });
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 8. Loc file — name and description for each custom skill
      {
        const rows: (string | boolean)[][] = [];
        for (const node of customNodes) {
          const skillKey = nodeIdToNewSkillKey[node.nodeId];
          rows.push([`character_skills_localised_name_${skillKey}`, node.label, false]);
          rows.push([`character_skills_localised_description_${skillKey}`, node.description, false]);
        }
        if (rows.length > 0) {
          const buffer = await buildLocFileBuffer(rows);
          packFiles.push({ name: `text\\db\\${tn}.loc`, file_size: buffer.length, buffer });
        }
      }
      const finalPackName = packName.endsWith(".pack") ? packName : `${packName}.pack`;
      const packPath = nodePath.join(packDirectory || dataFolder, finalPackName);
      console.log(
        `Writing skills pack to ${packPath} with ${packFiles.length} tables (including ${data.skillLocks?.length || 0} skill locks)`,
      );
      for (const pf of packFiles) {
        console.log(`  ${pf.name}: ${pf.file_size} bytes`);
      }
      await writePack(packFiles, packPath);
      console.log("Skills pack written successfully");
      return { success: true, packPath, packName: finalPackName };
    } catch (err: any) {
      console.error("Failed to save skills pack:", err);
      return { success: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle("saveSkillsChanges", async (event, data: SaveSkillsChangesPayload) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
      if (!dataFolder) return { success: false, error: "Data folder not found" };
      const ts = data.generationTimestamp || Date.now().toString();
      const {
        subtype,
        subtypeIndex,
        overrideNodes,
        replacedNodes,
        newNodes,
        deletedNodeKeys,
        edges,
        packName,
        packDirectory,
        tableNameTemplate,
      } = data;
      const defaultModdersPrefix = normalizeGeneratedPrefix(appData.moddersPrefix);
      const kp = defaultModdersPrefix || "custom";
      const setSuffix = buildDefaultSkillSetSuffix(subtype);
      const tn = resolveSkillGenerationTemplate(
        tableNameTemplate?.trim() || "${prefix}_${setSuffix}_${timestamp}",
        {
          prefix: kp,
          setSuffix,
          timestamp: ts,
          row: "",
          column: "",
        },
      );
      // Get original set key
      const subtypeSets = appData.skillsData?.subtypesToSet?.[subtype];
      if (!subtypeSets || !subtypeSets[subtypeIndex]) {
        return { success: false, error: `No skill set found for ${subtype} index ${subtypeIndex}` };
      }
      const originalSetKey = subtypeSets[subtypeIndex];
      const buildRowFromSchema = (
        dbFields: DBField[],
        values: Record<string, string | boolean>,
      ): (string | boolean)[] => {
        return dbFields.map((field) => {
          if (values[field.name] !== undefined) return values[field.name];
          return field.default_value ?? "";
        });
      };
      const buildDBFileBuffer = async (
        version: number,
        rows: (string | boolean)[][],
        dbFields: DBField[],
      ): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xfc, 0xfd, 0xfe, 0xff]));
        const vBuf = Buffer.alloc(4);
        vBuf.writeInt32LE(version, 0);
        parts.push(vBuf);
        parts.push(Buffer.from([0x01]));
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        for (const row of rows) {
          for (let i = 0; i < dbFields.length; i++) {
            parts.push(await typeToBuffer(dbFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const buildLocFileBuffer = async (rows: (string | boolean)[][]): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xff, 0xfe]));
        parts.push(Buffer.from([0x4c, 0x4f, 0x43]));
        parts.push(Buffer.from([0x00]));
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(1, 0);
        parts.push(cBuf);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        for (const row of rows) {
          for (let i = 0; i < LocFields.length; i++) {
            parts.push(await typeToBuffer(LocFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const defaultTableVersions = await getDefaultTableVersions();
      const getPreferredSchema = (tableName: string) => {
        const versions = DBNameToDBVersions[appData.currentGame][tableName];
        if (!versions || versions.length === 0) throw new Error(`No schema found for ${tableName}`);
        const defaultVersion = defaultTableVersions?.[tableName];
        return versions.find((version) => version.version === defaultVersion) || versions[0];
      };
      const packFiles: NewPackedFile[] = [];
      // 1. character_skill_nodes_tables — override nodes (same key) + replacement/new nodes (new keys)
      {
        const tableName = "character_skill_nodes_tables";
        const schema = getPreferredSchema(tableName);
        const rows: (string | boolean)[][] = [];
        for (const node of overrideNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              key: node.originalNodeKey,
              character_skill_key: node.characterSkillKey,
              tier: node.tier.toString(),
              indent: node.indent.toString(),
              visible_in_ui: "1",
              faction_key: node.faction || "",
              subculture: node.subculture || "",
              required_num_parents: (node.requiredNumParents || 0).toString(),
            }),
          );
        }
        for (const node of replacedNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              key: node.newNodeKey,
              character_skill_key: node.characterSkillKey,
              tier: node.tier.toString(),
              indent: node.indent.toString(),
              visible_in_ui: "1",
              faction_key: node.faction || "",
              subculture: node.subculture || "",
              required_num_parents: (node.requiredNumParents || 0).toString(),
            }),
          );
        }
        for (const node of newNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              key: node.newNodeKey,
              character_skill_key: node.newSkillKey,
              tier: node.tier.toString(),
              indent: node.indent.toString(),
              visible_in_ui: "1",
              faction_key: node.faction || "",
              subculture: node.subculture || "",
              required_num_parents: (node.requiredNumParents || 0).toString(),
            }),
          );
        }
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 2. character_skill_node_set_items_tables — disable replaced/deleted originals, add replacement/new nodes
      {
        const tableName = "character_skill_node_set_items_tables";
        const schema = getPreferredSchema(tableName);
        const rows: (string | boolean)[][] = [];
        // Disable original nodes that are being replaced
        for (const node of replacedNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              set: originalSetKey,
              item: node.originalNodeKey,
              mod_disabled: "true",
            }),
          );
        }
        // Disable deleted nodes
        for (const nodeKey of deletedNodeKeys) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              set: originalSetKey,
              item: nodeKey,
              mod_disabled: "true",
            }),
          );
        }
        // Add replacement nodes to set
        for (const node of replacedNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              set: originalSetKey,
              item: node.newNodeKey,
              mod_disabled: "false",
            }),
          );
        }
        // Add new nodes to set
        for (const node of newNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              set: originalSetKey,
              item: node.newNodeKey,
              mod_disabled: "false",
            }),
          );
        }
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 3. character_skill_node_links_tables — edges for replaced/new nodes
      if (edges.length > 0) {
        const tableName = "character_skill_node_links_tables";
        const schema = getPreferredSchema(tableName);
        const rows = edges.map((edge) =>
          buildRowFromSchema(schema.fields, {
            parent_key: edge.parentKey,
            child_key: edge.childKey,
            link_type: edge.linkType || "REQUIRED",
            parent_link_position: "1",
            child_link_position: "1",
          }),
        );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 4. character_skills_tables — only for new nodes with custom skills (not reusing existing skills)
      const customSkillNodes = newNodes.filter((n) => n.shouldCreateCharacterSkill);
      if (customSkillNodes.length > 0) {
        const tableName = "character_skills_tables";
        const schema = getPreferredSchema(tableName);
        const rows = customSkillNodes.map((node) =>
          buildRowFromSchema(schema.fields, {
            key: node.newSkillKey,
            image_path: node.imgPath || "",
            unlocked_at_rank: node.unlockRank.toString(),
          }),
        );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 5. character_skill_level_to_effects_junctions_tables — effects for new custom skills
      {
        const tableName = "character_skill_level_to_effects_junctions_tables";
        const schema = getPreferredSchema(tableName);
        const rows: (string | boolean)[][] = [];
        for (const node of customSkillNodes) {
          for (const effect of node.effects) {
            rows.push(
              buildRowFromSchema(schema.fields, {
                character_skill_key: node.newSkillKey,
                effect_key: effect.effectKey,
                effect_scope: effect.effectScope || "character_to_character_own",
                level: (effect.level || 1).toString(),
                value: effect.value || "0",
              }),
            );
          }
        }
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 6. character_skill_nodes_skill_locks_tables
      if (data.skillLocks && data.skillLocks.length > 0) {
        const tableName = "character_skill_nodes_skill_locks_tables";
        const schema = getPreferredSchema(tableName);
        const rows = data.skillLocks.map((lock) =>
          buildRowFromSchema(schema.fields, {
            character_skill: lock.lockingSkillKey,
            character_skill_node: lock.lockedNodeKey,
            level: lock.requiredLevel.toString(),
          }),
        );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 7. Loc file — name and description for new custom skills
      {
        const rows: (string | boolean)[][] = [];
        for (const node of customSkillNodes) {
          rows.push([`character_skills_localised_name_${node.newSkillKey}`, node.label, false]);
          rows.push([`character_skills_localised_description_${node.newSkillKey}`, node.description, false]);
        }
        if (rows.length > 0) {
          const buffer = await buildLocFileBuffer(rows);
          packFiles.push({ name: `text\\db\\${tn}.loc`, file_size: buffer.length, buffer });
        }
      }
      if (packFiles.length === 0) {
        return { success: false, error: "No changes detected" };
      }
      const finalPackName = packName.endsWith(".pack") ? packName : `${packName}.pack`;
      const packPath = nodePath.join(packDirectory || dataFolder, finalPackName);
      console.log(`Writing changes pack to ${packPath} with ${packFiles.length} tables`);
      for (const pf of packFiles) {
        console.log(`  ${pf.name}: ${pf.file_size} bytes`);
      }
      await writePack(packFiles, packPath);
      console.log("Changes pack written successfully");
      return { success: true, packPath, packName: finalPackName };
    } catch (err: any) {
      console.error("Failed to save changes pack:", err);
      return { success: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle("getTechnologyNodeSets", async () => {
    const technologyData = await ensureTechnologyData();
    if (!technologyData) return [];
    return Object.values(technologyData.setsByKey).sort((firstSet, secondSet) =>
      collator.compare(
        firstSet.localizedName || firstSet.key,
        secondSet.localizedName || secondSet.key,
      ),
    );
  });
  ipcMain.handle("getTechnologyTree", async (event, setKey: string) => {
    const technologyData = await ensureTechnologyData();
    if (!technologyData) return undefined;
    const technologySet = technologyData.setsByKey[setKey];
    if (!technologySet) return undefined;
    const nodesInSet = Object.values(technologyData.nodesByKey).filter((node) => node.setKey == setKey);
    const nodeSet = new Set(nodesInSet.map((node) => node.nodeKey));
    const getLoc = (locId: string) => getLocById(technologyData.locs, locId);
    const resolveTechnologyLoc = (locId: string) => {
      const localized = getLoc(locId);
      return resolveTextReplacements(localized, getLoc) || localized;
    };
    const mapEffectsForTechnology = (technologyKey: string): TechEffect[] => {
      const rawEffects = technologyData.technologyToEffects[technologyKey] || [];
      return rawEffects.map((effect) => {
        const iconFile = technologyData.effectsForTech[effect.effectKey]?.icon;
        const effectIconPath = iconFile ? `ui\\campaign ui\\effect_bundles\\${iconFile}` : undefined;
        return {
          effectKey: effect.effectKey,
          localizedKey: formatEffectLocalization(effect.effectKey, effect.value, getLoc),
          value: effect.value,
          icon: iconFile,
          iconData: effectIconPath ? technologyData.icons[effectIconPath] : undefined,
        };
      });
    };
    const nodes: TechnologyNodeData[] = nodesInSet.map((node) => {
      const technology = technologyData.technologiesByKey[node.technologyKey];
      const iconPath = getTechnologyIconPath(technology?.iconName);
      return {
        nodeKey: node.nodeKey,
        technologyKey: node.technologyKey,
        setKey: node.setKey,
        tier: node.tier,
        indent: node.indent,
        requiredParents: node.requiredParents,
        campaignKey: node.campaignKey,
        factionKey: node.factionKey,
        pixelOffsetX: node.pixelOffsetX,
        pixelOffsetY: node.pixelOffsetY,
        researchPointsRequired: node.researchPointsRequired,
        optionalUiGroup: node.optionalUiGroup,
        localizedName: resolveTechnologyLoc(`technologies_onscreen_name_${node.technologyKey}`) || node.technologyKey,
        shortDescription: resolveTechnologyLoc(`technologies_short_description_${node.technologyKey}`),
        longDescription: resolveTechnologyLoc(`technologies_long_description_${node.technologyKey}`),
        iconPath,
        iconData: iconPath ? technologyData.icons[iconPath] : undefined,
        isHidden: technology?.isHidden || false,
        buildingLevel: technology?.buildingLevel,
        effects: mapEffectsForTechnology(node.technologyKey),
      };
    });
    const allTechnologies: TechnologyCatalogEntry[] = Object.values(technologyData.technologiesByKey)
      .map((technology) => {
        const iconPath = getTechnologyIconPath(technology.iconName);
        const technologyRow = technologyData.technologyRowsByKey[technology.key] || {};
        return {
          key: technology.key,
          localizedName: resolveTechnologyLoc(`technologies_onscreen_name_${technology.key}`) || technology.key,
          researchPointsRequired: parseOptionalNumber(technologyRow.research_points_required, 0),
          buildingLevel: technology.buildingLevel,
          shortDescription: resolveTechnologyLoc(`technologies_short_description_${technology.key}`),
          longDescription: resolveTechnologyLoc(`technologies_long_description_${technology.key}`),
          iconPath,
          iconData: iconPath ? technologyData.icons[iconPath] : undefined,
          isHidden: technology.isHidden,
          effects: mapEffectsForTechnology(technology.key),
        };
      })
      .sort((firstTechnology, secondTechnology) =>
        collator.compare(firstTechnology.localizedName || firstTechnology.key, secondTechnology.localizedName || secondTechnology.key),
      );
    const allTechnologyIcons: TechnologyIconEntry[] = Object.entries(technologyData.icons)
      .filter(([iconPath]) => iconPath.toLowerCase().startsWith("ui\\campaign ui\\technologies\\"))
      .map(([path, iconData]) => ({
        path,
        name: path.replace("ui\\campaign ui\\technologies\\", "").replace(/\.(png|jpg|jpeg)$/i, ""),
        iconData,
      }))
      .sort((firstIcon, secondIcon) => collator.compare(firstIcon.name, secondIcon.name));
    const allEffectKeys = new Set<string>([
      ...Object.keys(technologyData.effectsForTech),
      ...Object.values(technologyData.technologyToEffects)
        .flat()
        .map((effect) => effect.effectKey),
    ]);
    const allEffects: TechEffect[] = [...allEffectKeys]
      .map((effectKey) => {
        const iconFile = technologyData.effectsForTech[effectKey]?.icon;
        const effectIconPath = iconFile ? `ui\\campaign ui\\effect_bundles\\${iconFile}` : undefined;
        return {
          effectKey,
          localizedKey: getRawEffectLocalization(effectKey, getLoc),
          icon: iconFile,
          iconData: effectIconPath ? technologyData.icons[effectIconPath] : undefined,
        };
      })
      .sort((firstEffect, secondEffect) =>
        collator.compare(firstEffect.localizedKey || firstEffect.effectKey, secondEffect.localizedKey || secondEffect.effectKey),
      );
    const links = Object.values(technologyData.linksByKey).filter(
      (link) => nodeSet.has(link.parentKey) && nodeSet.has(link.childKey),
    );
    const uiTabToNodes: Record<string, string[]> = {};
    const uiTabs = Object.values(technologyData.uiTabsByKey)
      .filter((uiTab) => {
        const nodesForTab = technologyData.uiTabToNodes[uiTab.key] || [];
        const filteredNodes = nodesForTab.filter((nodeKey) => nodeSet.has(nodeKey));
        if (filteredNodes.length < 1) return false;
        uiTabToNodes[uiTab.key] = filteredNodes;
        return true;
      })
      .sort((firstTab, secondTab) => firstTab.sortOrder - secondTab.sortOrder)
      .map((uiTab) => ({
        ...uiTab,
        localizedName:
          uiTab.localizedName ||
          getLocById(technologyData.locs, `technology_ui_tabs_localised_name_${uiTab.key}`) ||
          uiTab.key,
        tooltipString:
          uiTab.tooltipString ||
          getLocById(technologyData.locs, `technology_ui_tabs_tooltip_string_${uiTab.key}`),
      }));
    const relevantGroupKeys = new Set(
      nodesInSet
        .map((node) => node.optionalUiGroup)
        .filter((uiGroupKey): uiGroupKey is string => !!uiGroupKey && uiGroupKey.trim() !== ""),
    );
    for (const bounds of technologyData.uiGroupBounds) {
      if (nodeSet.has(bounds.topLeftNode) || nodeSet.has(bounds.bottomRightNode)) {
        relevantGroupKeys.add(bounds.groupKey);
      }
    }
    const uiGroups = Object.values(technologyData.uiGroupsByKey)
      .filter((uiGroup) => relevantGroupKeys.has(uiGroup.key))
      .map((uiGroup) => ({
        ...uiGroup,
        optionalDisplayName:
          uiGroup.optionalDisplayName ||
          getLocById(technologyData.locs, `technology_ui_groups_optional_display_name_${uiGroup.key}`),
        optionalDisplayDescription:
          uiGroup.optionalDisplayDescription ||
          getLocById(
            technologyData.locs,
            `technology_ui_groups_optional_display_desctiption_${uiGroup.key}`,
          ),
      }));
    const uiGroupBounds = technologyData.uiGroupBounds.filter((bounds) => {
      if (!relevantGroupKeys.has(bounds.groupKey)) return false;
      return nodeSet.has(bounds.topLeftNode) && nodeSet.has(bounds.bottomRightNode);
    });
    return {
      set: technologySet,
      nodes,
      links,
      uiTabs,
      uiTabToNodes,
      uiGroups,
      uiGroupBounds,
      allTechnologies,
      allTechnologyIcons,
      allEffects,
    } as TechnologyTreePayload;
  });
  ipcMain.handle("saveTechnologyPack", async (event, data: SaveTechnologyPackPayload) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
      if (!dataFolder) return { success: false, error: "Data folder not found" };
      const technologyData = await ensureTechnologyData();
      if (!technologyData) return { success: false, error: "Technology data could not be loaded" };
      if (!data.packName?.trim()) return { success: false, error: "Pack name is required" };
      const defaultModdersPrefix = normalizeGeneratedPrefix(appData.moddersPrefix);
      const generationPrefix = defaultModdersPrefix || "custom";
      const resolveGenerationTemplate = (
        template: string,
        variables: { prefix: string; nodeSet: string; row: string; column: string; timestamp?: string },
      ) =>
        template
          .replaceAll("${prefix}", variables.prefix)
          .replaceAll("${xxx}", variables.prefix)
          .replaceAll("${nodeSet}", variables.nodeSet)
          .replaceAll("${yyy}", variables.nodeSet)
          .replaceAll("${timestamp}", variables.timestamp ?? "")
          .replaceAll("${row}", variables.row)
          .replaceAll("${r}", variables.row)
          .replaceAll("${column}", variables.column)
          .replaceAll("${c}", variables.column);
      const generationTimestamp = Date.now().toString();
      const targetSetKey = data.technologyNodeSetOverride?.trim()
        ? resolveGenerationTemplate(data.technologyNodeSetOverride.trim(), {
            prefix: generationPrefix,
            nodeSet: data.setKey,
            row: "",
            column: "",
            timestamp: generationTimestamp,
          })
        : data.setKey;
      if (!targetSetKey.trim()) return { success: false, error: "Technology node set is required" };
      const shouldCloneNodeSet = targetSetKey !== data.setKey;
      const sourceSetExists = !!technologyData.setsByKey[data.setKey];
      const shouldWriteNodeSet = shouldCloneNodeSet || !sourceSetExists;
      const shouldCloneTechnologies = !!data.cloneTechnologies;
      const usedTechnologyUniqueIndexes = buildUsedTechnologyUniqueIndexes(technologyData.technologyRowsByKey);
      const finalPackName = data.packName.endsWith(".pack") ? data.packName : `${data.packName}.pack`;
      const packPath = nodePath.join(data.packDirectory || dataFolder, finalPackName);
      const nodeKeyTemplate = data.nodeKeyTemplate?.trim() || "${prefix}_tech_node_${nodeSet}_${row}_${column}";
      const technologyKeyTemplate =
        data.technologyKeyTemplate?.trim() || "${prefix}_tech_${nodeSet}_${row}_${column}";
      const buildRowFromSchema = (
        dbFields: DBField[],
        values: Record<string, string | boolean>,
      ): (string | boolean)[] => {
        return dbFields.map((field) => {
          if (values[field.name] !== undefined) return values[field.name];
          return field.default_value ?? "";
        });
      };
      const buildDBFileBuffer = async (
        version: number,
        rows: (string | boolean)[][],
        dbFields: DBField[],
      ): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xfc, 0xfd, 0xfe, 0xff]));
        const versionBuffer = Buffer.alloc(4);
        versionBuffer.writeInt32LE(version, 0);
        parts.push(versionBuffer);
        parts.push(Buffer.from([0x01]));
        const countBuffer = Buffer.alloc(4);
        countBuffer.writeInt32LE(rows.length, 0);
        parts.push(countBuffer);
        for (const row of rows) {
          for (let i = 0; i < dbFields.length; i++) {
            parts.push(await typeToBuffer(dbFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const buildLocFileBuffer = async (rows: (string | boolean)[][]): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xff, 0xfe]));
        parts.push(Buffer.from([0x4c, 0x4f, 0x43]));
        parts.push(Buffer.from([0x00]));
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(1, 0);
        parts.push(cBuf);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        for (const row of rows) {
          for (let i = 0; i < LocFields.length; i++) {
            parts.push(await typeToBuffer(LocFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const defaultTableVersions = await getDefaultTableVersions();
      const getPreferredSchema = (tableNameToResolve: string) => {
        const versions = DBNameToDBVersions[appData.currentGame][tableNameToResolve];
        if (!versions || versions.length === 0) throw new Error(`No schema found for ${tableNameToResolve}`);
        const defaultVersion = defaultTableVersions?.[tableNameToResolve];
        return versions.find((version) => version.version === defaultVersion) || versions[0];
      };
      const tableName = resolveGenerationTemplate(
        data.tableNameOverride?.trim() || "${prefix}_${nodeSet}_${timestamp}",
        {
          prefix: generationPrefix,
          nodeSet: targetSetKey,
          row: "",
          column: "",
          timestamp: generationTimestamp,
        },
      );
      const packFiles: NewPackedFile[] = [];
      const dedupedNodesByNodeKey = new Map<string, SaveTechnologyPackPayload["nodes"][number]>();
      for (const node of data.nodes) {
        if (node.setKey !== data.setKey) continue;
        dedupedNodesByNodeKey.set(node.nodeKey, node);
      }
      const sourceNodes = [...dedupedNodesByNodeKey.values()];
      if (sourceNodes.length < 1) return { success: false, error: "No technology nodes provided" };

      const nodeKeyRemap = new Map<string, string>();
      const remappedNodes = sourceNodes.map((sourceNode) => {
        const templateVariables = {
          prefix: generationPrefix,
          nodeSet: targetSetKey,
          row: sourceNode.indent.toString(),
          column: sourceNode.tier.toString(),
        };
        const generatedNodeKey = resolveGenerationTemplate(nodeKeyTemplate, templateVariables);
        const generatedTechnologyKey = resolveGenerationTemplate(technologyKeyTemplate, templateVariables);
        const finalNode = {
          ...sourceNode,
          nodeKey: appendScopedTechNodeHash(
            generatedNodeKey,
            sourceNode.campaignKey,
            sourceNode.factionKey,
          ),
          technologyKey: shouldCloneTechnologies
            ? appendScopedTechNodeHash(
                generatedTechnologyKey,
                sourceNode.campaignKey,
                sourceNode.factionKey,
              )
            : sourceNode.technologyKey,
          setKey: targetSetKey,
        };
        nodeKeyRemap.set(sourceNode.nodeKey, finalNode.nodeKey);
        return { sourceNode, finalNode };
      });

      const seenNodeKeys = new Set<string>();
      const seenTechnologyKeys = new Set<string>();
      for (const { finalNode } of remappedNodes) {
        if (seenNodeKeys.has(finalNode.nodeKey)) {
          return {
            success: false,
            error: `Generated duplicate technology node key: ${finalNode.nodeKey}`,
          };
        }
        seenNodeKeys.add(finalNode.nodeKey);
        if (shouldCloneTechnologies) {
          if (seenTechnologyKeys.has(finalNode.technologyKey)) {
            return {
              success: false,
              error: `Generated duplicate technology key: ${finalNode.technologyKey}`,
            };
          }
          seenTechnologyKeys.add(finalNode.technologyKey);
        }
      }

      const finalNodes = remappedNodes.map(({ finalNode }) => finalNode);
      const shouldWriteNodeMappings =
        shouldCloneNodeSet ||
        remappedNodes.some(({ sourceNode, finalNode }) => sourceNode.nodeKey !== finalNode.nodeKey);
      const referencedUiGroupKeys = new Set(
        finalNodes
          .map((node) => node.optionalUiGroup)
          .filter((groupKey): groupKey is string => !!groupKey && groupKey.trim() !== ""),
      );
      if (shouldWriteNodeMappings) {
        for (const bounds of data.uiGroupBounds || []) {
          referencedUiGroupKeys.add(bounds.groupKey);
        }
      }
      const uiGroupKeyRemap = new Map<string, string>();
      [...referencedUiGroupKeys]
        .sort((left, right) => collator.compare(left, right))
        .forEach((groupKey, index) => {
          uiGroupKeyRemap.set(groupKey, `${generationPrefix}_${targetSetKey}_${index + 1}`);
        });

      if (shouldWriteNodeSet) {
        const setSchema = getPreferredSchema("technology_node_sets_tables");
        const originalSetRow = technologyData.setRowsByKey[data.setKey] || {};
        const originalSet = technologyData.setsByKey[data.setKey];
        const setRows = [
          buildRowFromSchema(setSchema.fields, {
            ...originalSetRow,
            key: targetSetKey,
            campaign_key: originalSet?.campaignKey || "",
            faction_key: originalSet?.factionKey || "",
            culture: originalSet?.culture || "",
            subculture: originalSet?.subculture || "",
            technology_category: originalSet?.technologyCategory || "",
            localised_name: originalSet?.localizedName || "",
            localized_name: originalSet?.localizedName || "",
            tooltip_string: originalSet?.tooltipString || "",
          }),
        ];
        const buffer = await buildDBFileBuffer(setSchema.version, setRows, setSchema.fields);
        packFiles.push({ name: `db\\technology_node_sets_tables\\${tableName}`, file_size: buffer.length, buffer });
      }

      const nodeSchema = getPreferredSchema("technology_nodes_tables");
      const nodeRows = remappedNodes.map(({ sourceNode, finalNode }) =>
        buildRowFromSchema(nodeSchema.fields, {
          ...(technologyData.nodeRowsByKey[sourceNode.nodeKey] || {}),
          key: finalNode.nodeKey,
          technology_key: finalNode.technologyKey,
          technology_node_set: targetSetKey,
          tier: finalNode.tier.toString(),
          indent: finalNode.indent.toString(),
          required_parents: finalNode.requiredParents.toString(),
          campaign_key: finalNode.campaignKey || "",
          faction_key: finalNode.factionKey || "",
          pixel_offset_x: finalNode.pixelOffsetX.toString(),
          pixel_offset_y: finalNode.pixelOffsetY.toString(),
          research_points_required: finalNode.researchPointsRequired.toString(),
          optional_ui_group: finalNode.optionalUiGroup ? (uiGroupKeyRemap.get(finalNode.optionalUiGroup) ?? "") : "",
        }),
      );
      if (nodeRows.length > 0) {
        const buffer = await buildDBFileBuffer(nodeSchema.version, nodeRows, nodeSchema.fields);
        packFiles.push({ name: `db\\technology_nodes_tables\\${tableName}`, file_size: buffer.length, buffer });
      }
      if (referencedUiGroupKeys.size > 0) {
        const uiGroupsSchema = getPreferredSchema("technology_ui_groups_tables");
        const uiGroupRows = [...referencedUiGroupKeys]
          .map((groupKey) => {
            const group = technologyData.uiGroupsByKey[groupKey];
            if (!group) return undefined;
            return buildRowFromSchema(uiGroupsSchema.fields, {
              key: uiGroupKeyRemap.get(group.key) || group.key,
              colour_red: group.colourRed.toString(),
              colour_green: group.colourGreen.toString(),
              colour_blue: group.colourBlue.toString(),
              colour_hex: group.colourHex,
              optional_background_image: group.optionalBackgroundImage || "",
              optional_display_name: group.optionalDisplayName || "",
              optional_display_desctiption: group.optionalDisplayDescription || "",
              optional_display_description: group.optionalDisplayDescription || "",
            });
          })
          .filter((row): row is (string | boolean)[] => !!row);
        if (uiGroupRows.length > 0) {
          const buffer = await buildDBFileBuffer(uiGroupsSchema.version, uiGroupRows, uiGroupsSchema.fields);
          packFiles.push({ name: `db\\technology_ui_groups_tables\\${tableName}`, file_size: buffer.length, buffer });
        }
      }

      if (shouldWriteNodeMappings) {
        const uiTabsToNodesSchema = getPreferredSchema("technology_ui_tabs_to_technology_nodes_junctions_tables");
        const uiTabsToNodesRows = Object.entries(data.uiTabToNodes || {}).flatMap(([tab, nodeKeys]) =>
          nodeKeys
            .map((nodeKey) => nodeKeyRemap.get(nodeKey))
            .filter((nodeKey): nodeKey is string => !!nodeKey)
            .map((nodeKey) =>
              buildRowFromSchema(uiTabsToNodesSchema.fields, {
                tab,
                node: nodeKey,
              }),
            ),
        );
        if (uiTabsToNodesRows.length > 0) {
          const buffer = await buildDBFileBuffer(
            uiTabsToNodesSchema.version,
            uiTabsToNodesRows,
            uiTabsToNodesSchema.fields,
          );
          packFiles.push({
            name: `db\\technology_ui_tabs_to_technology_nodes_junctions_tables\\${tableName}`,
            file_size: buffer.length,
            buffer,
          });
        }

        const uiGroupBoundsSchema = getPreferredSchema("technology_ui_groups_to_technology_nodes_junctions_tables");
        const uiGroupBoundsRows = (data.uiGroupBounds || []).flatMap((bounds) => {
          const topLeftNode = nodeKeyRemap.get(bounds.topLeftNode);
          const bottomRightNode = nodeKeyRemap.get(bounds.bottomRightNode);
          if (!topLeftNode || !bottomRightNode) return [];
          return [
            buildRowFromSchema(uiGroupBoundsSchema.fields, {
              tech_ui_group: uiGroupKeyRemap.get(bounds.groupKey) || bounds.groupKey,
              top_left_node: topLeftNode,
              bottom_right_node: bottomRightNode,
              optional_top_right_node: bounds.optionalTopRightNode
                ? (nodeKeyRemap.get(bounds.optionalTopRightNode) ?? "")
                : "",
              optional_bottom_left_node: bounds.optionalBottomLeftNode
                ? (nodeKeyRemap.get(bounds.optionalBottomLeftNode) ?? "")
                : "",
            }),
          ];
        });
        if (uiGroupBoundsRows.length > 0) {
          const buffer = await buildDBFileBuffer(
            uiGroupBoundsSchema.version,
            uiGroupBoundsRows,
            uiGroupBoundsSchema.fields,
          );
          packFiles.push({
            name: `db\\technology_ui_groups_to_technology_nodes_junctions_tables\\${tableName}`,
            file_size: buffer.length,
            buffer,
          });
        }
      }

      const finalNodeKeySet = new Set(finalNodes.map((node) => node.nodeKey));
      const dedupedLinksByKey = new Map<string, { sourceLinkKey: string; link: TechnologyLinkData }>();
      for (const link of data.links) {
        const parentKey = nodeKeyRemap.get(link.parentKey) || link.parentKey;
        const childKey = nodeKeyRemap.get(link.childKey) || link.childKey;
        if (!finalNodeKeySet.has(parentKey) || !finalNodeKeySet.has(childKey)) continue;
        dedupedLinksByKey.set(`${parentKey}|${childKey}`, {
          sourceLinkKey: `${link.parentKey}|${link.childKey}`,
          link: {
            ...link,
            parentKey,
            childKey,
          },
        });
      }
      const linkSchema = getPreferredSchema("technology_node_links_tables");
      const linkRows = [...dedupedLinksByKey.values()].map(({ sourceLinkKey, link }) =>
        buildRowFromSchema(linkSchema.fields, {
          ...(technologyData.linkRowsByKey[sourceLinkKey] || {}),
          parent_key: link.parentKey,
          child_key: link.childKey,
          parent_link_position: link.parentLinkPosition.toString(),
          child_link_position: link.childLinkPosition.toString(),
          parent_link_position_offset: link.parentLinkPositionOffset.toString(),
          child_link_position_offset: link.childLinkPositionOffset.toString(),
          initial_descent_tiers: link.initialDescentTiers.toString(),
          visible_in_ui: link.visibleInUi ? "1" : "0",
        }),
      );
      if (linkRows.length > 0) {
        const buffer = await buildDBFileBuffer(linkSchema.version, linkRows, linkSchema.fields);
        packFiles.push({ name: `db\\technology_node_links_tables\\${tableName}`, file_size: buffer.length, buffer });
      }

      const nodesByTechnologyKey = new Map<
        string,
        { finalNode: SaveTechnologyPackPayload["nodes"][number]; sourceTechnologyKey: string }
      >();
      for (const { sourceNode, finalNode } of remappedNodes) {
        if (!nodesByTechnologyKey.has(finalNode.technologyKey)) {
          nodesByTechnologyKey.set(finalNode.technologyKey, {
            finalNode,
            sourceTechnologyKey: sourceNode.technologyKey,
          });
        }
      }
      const normalizeComparableString = (value: string | undefined) => (value || "").trim();
      const normalizeComparableNumber = (value: string | undefined) => parseOptionalNumber(value, 0).toString();
      const normalizeComparableBool = (value: string | undefined) =>
        parseOptionalBool(value, false) ? "true" : "false";
      const normalizeComparableIconName = (value: string | undefined) =>
        normalizeComparableString(value).replace(/\.(png|jpg|jpeg)$/i, "").toLowerCase();
      const buildEffectsSignature = (effects: { effectKey?: string; value?: string }[] | undefined) =>
        JSON.stringify(
          (effects || [])
            .map((effect) => ({
              effectKey: normalizeComparableString(effect.effectKey),
              value: normalizeComparableString(effect.value),
            }))
            .filter((effect) => effect.effectKey !== "")
            .sort((left, right) =>
              left.effectKey === right.effectKey
                ? left.value.localeCompare(right.value)
                : left.effectKey.localeCompare(right.effectKey),
            ),
        );
      const getLoc = (locId: string) => getLocById(technologyData.locs, locId);
      const resolveTechnologyLoc = (locId: string) => {
        const localized = getLoc(locId);
        return resolveTextReplacements(localized, getLoc) || localized;
      };
      const getOriginalTechnologyDisplayName = (technologyKey: string) =>
        resolveTechnologyLoc(`technologies_onscreen_name_${technologyKey}`) || technologyKey;
      const getOriginalTechnologyShortDescription = (technologyKey: string) =>
        resolveTechnologyLoc(`technologies_short_description_${technologyKey}`) || "";
      const getOriginalTechnologyLongDescription = (technologyKey: string) =>
        resolveTechnologyLoc(`technologies_long_description_${technologyKey}`) || "";
      const techSchema = getPreferredSchema("technologies_tables");
      const technologyFieldNames = new Set(techSchema.fields.map((field) => field.name));
      const technologyEntries = [...nodesByTechnologyKey.entries()].map(
        ([technologyKey, { finalNode, sourceTechnologyKey }]) => {
          const originalTechnologyRow = technologyData.technologyRowsByKey[sourceTechnologyKey];
          const nextTechnologyRow = {
            key: technologyKey,
            research_points_required: finalNode.researchPointsRequired.toString(),
            icon_name: getTechnologyIconNameFromPath(finalNode.iconPath),
            is_hidden: finalNode.isHidden ? "true" : "false",
            building_level: getTechnologyBuildingLevelForWrite(finalNode.buildingLevel, originalTechnologyRow),
          };
          const rowDifferences = {
            missingOriginalRow: !originalTechnologyRow,
            key:
              technologyFieldNames.has("key") &&
              normalizeComparableString(originalTechnologyRow?.key) !==
              normalizeComparableString(nextTechnologyRow.key),
            research_points_required:
              technologyFieldNames.has("research_points_required") &&
              normalizeComparableNumber(originalTechnologyRow?.research_points_required) !==
              normalizeComparableNumber(nextTechnologyRow.research_points_required),
            icon_name:
              technologyFieldNames.has("icon_name") &&
              normalizeComparableIconName(originalTechnologyRow?.icon_name) !==
              normalizeComparableIconName(nextTechnologyRow.icon_name),
            is_hidden:
              technologyFieldNames.has("is_hidden") &&
              normalizeComparableBool(originalTechnologyRow?.is_hidden) !==
              normalizeComparableBool(nextTechnologyRow.is_hidden),
            building_level:
              technologyFieldNames.has("building_level") &&
              normalizeComparableString(originalTechnologyRow?.building_level) !==
              normalizeComparableString(nextTechnologyRow.building_level),
          };
          const basicDataChanged =
            rowDifferences.missingOriginalRow ||
            rowDifferences.key ||
            rowDifferences.research_points_required ||
            rowDifferences.icon_name ||
            rowDifferences.is_hidden ||
            rowDifferences.building_level;
          const locChanged =
            technologyKey !== sourceTechnologyKey ||
            normalizeComparableString(getOriginalTechnologyDisplayName(sourceTechnologyKey)) !==
              normalizeComparableString(finalNode.displayName || technologyKey) ||
            normalizeComparableString(getOriginalTechnologyShortDescription(sourceTechnologyKey)) !==
              normalizeComparableString(finalNode.shortDescription) ||
            normalizeComparableString(getOriginalTechnologyLongDescription(sourceTechnologyKey)) !==
              normalizeComparableString(finalNode.longDescription);
          const effectsChanged =
            technologyKey !== sourceTechnologyKey ||
            buildEffectsSignature(technologyData.technologyToEffects[sourceTechnologyKey]) !==
              buildEffectsSignature(finalNode.effects);
          return {
            technologyKey,
            sourceTechnologyKey,
            finalNode,
            rowDifferences,
            shouldWriteTechnologyRow: shouldCloneTechnologies || basicDataChanged,
            shouldWriteEffects: shouldCloneTechnologies || effectsChanged || basicDataChanged,
            shouldWriteLoc: shouldCloneTechnologies || locChanged,
          };
        },
      );
      const techRows = technologyEntries
        .filter(({ shouldWriteTechnologyRow }) => shouldWriteTechnologyRow)
        .map(({ technologyKey, sourceTechnologyKey, finalNode }) => {
          const originalTechnologyRow = technologyData.technologyRowsByKey[sourceTechnologyKey];
          const isBrandNewTechnology = !originalTechnologyRow;
          const shouldAllocateNewUniqueIndex = shouldCloneTechnologies || isBrandNewTechnology;
          return buildRowFromSchema(techSchema.fields, {
            ...(originalTechnologyRow || {}),
            key: technologyKey,
            research_points_required: finalNode.researchPointsRequired.toString(),
            icon_name: getTechnologyIconNameFromPath(finalNode.iconPath),
            is_hidden: finalNode.isHidden ? "true" : "false",
            building_level: getTechnologyBuildingLevelForWrite(finalNode.buildingLevel, originalTechnologyRow),
            unique_index: shouldAllocateNewUniqueIndex
              ? allocateTechnologyUniqueIndex(usedTechnologyUniqueIndexes)
              : (originalTechnologyRow.unique_index || ""),
            is_military: isBrandNewTechnology ? "true" : originalTechnologyRow.is_military,
          });
        });
      if (techRows.length > 0) {
        const buffer = await buildDBFileBuffer(techSchema.version, techRows, techSchema.fields);
        packFiles.push({ name: `db\\technologies_tables\\${tableName}`, file_size: buffer.length, buffer });
      }
      const techEffectsSchema = getPreferredSchema("technology_effects_junction_tables");
      const techEffectsRows: (string | boolean)[][] = [];
      const seenTechnologyEffects = new Set<string>();
      let defaultTechnologyEffectScopeFallbackCount = 0;
      for (const { technologyKey, sourceTechnologyKey, finalNode, shouldWriteEffects } of technologyEntries) {
        if (!shouldWriteEffects) continue;
        for (const effect of finalNode.effects || []) {
          const effectKey = `${effect.effectKey || ""}`.trim();
          if (!effectKey) continue;
          const rowKey = `${technologyKey}|${effectKey}`;
          if (seenTechnologyEffects.has(rowKey)) continue;
          seenTechnologyEffects.add(rowKey);
          const resolvedEffectScope =
            technologyData.technologyEffectRowsByKey[sourceTechnologyKey]?.[effectKey]?.effect_scope ||
            technologyData.technologyEffectScopesByKey[effectKey] ||
            "default";
          if (resolvedEffectScope === "default") {
            defaultTechnologyEffectScopeFallbackCount += 1;
          }
          techEffectsRows.push(
            buildRowFromSchema(techEffectsSchema.fields, {
              ...(technologyData.technologyEffectRowsByKey[sourceTechnologyKey]?.[effectKey] || {}),
              technology: technologyKey,
              effect: effectKey,
              effect_scope: resolvedEffectScope,
              value: effect.value || "",
            }),
          );
        }
      }
      if (techEffectsRows.length > 0) {
        const buffer = await buildDBFileBuffer(techEffectsSchema.version, techEffectsRows, techEffectsSchema.fields);
        packFiles.push({
          name: `db\\technology_effects_junction_tables\\${tableName}`,
          file_size: buffer.length,
          buffer,
        });
      }
      const locRowsByKey: Record<string, string> = {};
      for (const { technologyKey, finalNode, shouldWriteLoc } of technologyEntries) {
        if (!shouldWriteLoc) continue;
        locRowsByKey[`technologies_onscreen_name_${technologyKey}`] =
          finalNode.displayName || technologyKey;
        if (finalNode.shortDescription !== undefined) {
          locRowsByKey[`technologies_short_description_${technologyKey}`] = finalNode.shortDescription;
        }
        if (finalNode.longDescription !== undefined) {
          locRowsByKey[`technologies_long_description_${technologyKey}`] = finalNode.longDescription;
        }
      }
      for (const remappedGroupKey of uiGroupKeyRemap.values()) {
        locRowsByKey[`technology_ui_groups_optional_display_name_${remappedGroupKey}`] = "";
        locRowsByKey[`technology_ui_groups_optional_display_desctiption_${remappedGroupKey}`] = "";
      }
      const locRows = Object.entries(locRowsByKey).map(
        ([key, text]) => [key, text, false] as (string | boolean)[],
      );
      if (locRows.length > 0) {
        const buffer = await buildLocFileBuffer(locRows);
        packFiles.push({ name: `text\\db\\${tableName}.loc`, file_size: buffer.length, buffer });
      }
      if (packFiles.length < 1) return { success: false, error: "No technology data to save" };
      await writePack(packFiles, packPath);
      cachedTechnologyData = undefined;
      cachedTechnologyDataKey = undefined;
      return {
        success: true,
        packPath,
        packName: finalPackName,
        warning:
          defaultTechnologyEffectScopeFallbackCount > 0
            ? `${defaultTechnologyEffectScopeFallbackCount} technology effect row${defaultTechnologyEffectScopeFallbackCount === 1 ? "" : "s"} used fallback effect_scope 'default'.`
            : undefined,
      };
    } catch (error: any) {
      console.error("Failed to save technology tree:", error);
      return { success: false, error: error?.message || String(error) };
    }
  });
  ipcMain.handle("saveTechnologyChanges", async (event, data: SaveTechnologyChangesPayload) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
      if (!dataFolder) return { success: false, error: "Data folder not found" };
      const technologyData = await ensureTechnologyData();
      if (!technologyData) return { success: false, error: "Technology data could not be loaded" };
      const usedTechnologyUniqueIndexes = buildUsedTechnologyUniqueIndexes(technologyData.technologyRowsByKey);
      const defaultModdersPrefix = normalizeGeneratedPrefix(appData.moddersPrefix);
      const generationTimestamp = Date.now().toString();
      const resolveGenerationTemplate = (
        template: string,
        variables: { prefix: string; nodeSet: string; row: string; column: string; timestamp?: string },
      ) =>
        template
          .replaceAll("${prefix}", variables.prefix)
          .replaceAll("${xxx}", variables.prefix)
          .replaceAll("${nodeSet}", variables.nodeSet)
          .replaceAll("${yyy}", variables.nodeSet)
          .replaceAll("${timestamp}", variables.timestamp ?? "")
          .replaceAll("${row}", variables.row)
          .replaceAll("${r}", variables.row)
          .replaceAll("${column}", variables.column)
          .replaceAll("${c}", variables.column);
      const tableName = resolveGenerationTemplate(
        data.tableNameOverride?.trim() || "${prefix}_${nodeSet}_${timestamp}",
        {
          prefix: defaultModdersPrefix || "custom",
          nodeSet: data.setKey,
          row: "",
          column: "",
          timestamp: generationTimestamp,
        },
      );
      const finalPackName = data.packName.endsWith(".pack") ? data.packName : `${data.packName}.pack`;
      const packPath = nodePath.join(data.packDirectory || dataFolder, finalPackName);
      const buildRowFromSchema = (
        dbFields: DBField[],
        values: Record<string, string | boolean>,
      ): (string | boolean)[] => {
        return dbFields.map((field) => {
          if (values[field.name] !== undefined) return values[field.name];
          return field.default_value ?? "";
        });
      };
      const buildDBFileBuffer = async (
        version: number,
        rows: (string | boolean)[][],
        dbFields: DBField[],
      ): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xfc, 0xfd, 0xfe, 0xff]));
        const versionBuffer = Buffer.alloc(4);
        versionBuffer.writeInt32LE(version, 0);
        parts.push(versionBuffer);
        parts.push(Buffer.from([0x01]));
        const countBuffer = Buffer.alloc(4);
        countBuffer.writeInt32LE(rows.length, 0);
        parts.push(countBuffer);
        for (const row of rows) {
          for (let i = 0; i < dbFields.length; i++) {
            parts.push(await typeToBuffer(dbFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const defaultTableVersions = await getDefaultTableVersions();
      const getPreferredSchema = (tableNameToResolve: string) => {
        const versions = DBNameToDBVersions[appData.currentGame][tableNameToResolve];
        if (!versions || versions.length === 0) throw new Error(`No schema found for ${tableNameToResolve}`);
        const defaultVersion = defaultTableVersions?.[tableNameToResolve];
        return versions.find((version) => version.version === defaultVersion) || versions[0];
      };
      const packFiles: NewPackedFile[] = [];
      const hasNodeDeletions = data.deletedNodeKeys && data.deletedNodeKeys.length > 0;
      const hasNodeEdits = data.editedNodes && data.editedNodes.length > 0;
      if (data.changedNodes.length > 0 || hasNodeDeletions || hasNodeEdits) {
        const schema = getPreferredSchema("technology_nodes_tables");
        const deletedNodeSet = new Set(data.deletedNodeKeys || []);
        const dedupedRowsByNodeKey: Record<string, Record<string, string | boolean>> = {};
        if (hasNodeDeletions) {
          // Write complete replacement: all original nodes minus deleted ones
          for (const [nodeKey, originalRow] of Object.entries(technologyData.nodeRowsByKey)) {
            if (deletedNodeSet.has(nodeKey)) continue;
            dedupedRowsByNodeKey[nodeKey] = { ...originalRow };
          }
        }
        for (const changedNode of data.changedNodes) {
          if (deletedNodeSet.has(changedNode.nodeKey)) continue;
          const originalNodeRow = technologyData.nodeRowsByKey[changedNode.nodeKey];
          if (!originalNodeRow) continue;
          dedupedRowsByNodeKey[changedNode.nodeKey] = {
            ...originalNodeRow,
            key: changedNode.nodeKey,
            tier: changedNode.tier.toString(),
            indent: changedNode.indent.toString(),
          };
        }
        // Apply property edits
        if (data.editedNodes) {
          for (const editedNode of data.editedNodes) {
            if (deletedNodeSet.has(editedNode.nodeKey)) continue;
            const existingRow = dedupedRowsByNodeKey[editedNode.nodeKey] || technologyData.nodeRowsByKey[editedNode.nodeKey];
            if (!existingRow) continue;
            const updatedRow: Record<string, string | boolean> = { ...existingRow };
            if (editedNode.technologyKey !== undefined && editedNode.technologyKey.trim() !== "") {
              updatedRow.technology_key = editedNode.technologyKey.trim();
            }
            if (editedNode.researchPointsRequired !== undefined) {
              updatedRow.research_points_required = editedNode.researchPointsRequired.toString();
            }
            if (editedNode.requiredParents !== undefined) {
              updatedRow.required_parents = editedNode.requiredParents.toString();
            }
            if (editedNode.campaignKey !== undefined) {
              updatedRow.campaign_key = editedNode.campaignKey;
            }
            if (editedNode.factionKey !== undefined) {
              updatedRow.faction_key = editedNode.factionKey;
            }
            if (editedNode.pixelOffsetX !== undefined) {
              updatedRow.pixel_offset_x = editedNode.pixelOffsetX.toString();
            }
            if (editedNode.pixelOffsetY !== undefined) {
              updatedRow.pixel_offset_y = editedNode.pixelOffsetY.toString();
            }
            dedupedRowsByNodeKey[editedNode.nodeKey] = updatedRow;
          }
        }
        const rows = Object.values(dedupedRowsByNodeKey).map((row) => buildRowFromSchema(schema.fields, row));
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\technology_nodes_tables\\${tableName}`, file_size: buffer.length, buffer });
        }
      }
      // Handle edited nodes in technologies_tables (for display name, building level, etc.)
      if (hasNodeEdits && data.editedNodes) {
        const techSchema = getPreferredSchema("technologies_tables");
        const dedupedRows: Record<string, Record<string, string | boolean>> = {};
        for (const editedNode of data.editedNodes) {
          const nodeRow = technologyData.nodeRowsByKey[editedNode.nodeKey];
          const technologyKey = (editedNode.technologyKey || (nodeRow?.technology_key as string) || "").trim();
          if (!technologyKey) continue;
          const originalTechRow = technologyData.technologyRowsByKey[technologyKey];
          const sourceTechnologyKey = (nodeRow?.technology_key as string) || "";
          const sourceTechRowForClone = technologyData.technologyRowsByKey[sourceTechnologyKey];
          const baseTechRow = originalTechRow || sourceTechRowForClone || {};
          const isBrandNewTechnology = !originalTechRow;
          const updatedRow: Record<string, string | boolean> = {
            ...baseTechRow,
            key: technologyKey,
          };
          if (editedNode.researchPointsRequired !== undefined) {
            updatedRow.research_points_required = editedNode.researchPointsRequired.toString();
          }
          if (editedNode.isHidden !== undefined) {
            updatedRow.is_hidden = editedNode.isHidden ? "true" : "false";
          }
          if (editedNode.iconPath !== undefined) {
            updatedRow.icon_name = getTechnologyIconNameFromPath(editedNode.iconPath);
          }
          if (editedNode.buildingLevel !== undefined) {
            updatedRow.building_level = getTechnologyBuildingLevelForWrite(
              editedNode.buildingLevel,
              originalTechRow || sourceTechRowForClone,
            );
          }
          if (isBrandNewTechnology) {
            updatedRow.unique_index = allocateTechnologyUniqueIndex(usedTechnologyUniqueIndexes);
            updatedRow.is_military = updatedRow.is_military ?? "true";
          }
          dedupedRows[technologyKey] = updatedRow;
        }
        const rows = Object.values(dedupedRows).map((row) => buildRowFromSchema(techSchema.fields, row));
        if (rows.length > 0) {
          const existingTechFile = packFiles.find((f) => f.name.startsWith("db\\technologies_tables\\"));
          if (existingTechFile) {
            // Merge: rebuild with combined rows
            const buffer = await buildDBFileBuffer(techSchema.version, rows, techSchema.fields);
            packFiles.push({
              name: `db\\technologies_tables\\${tableName}_edits`,
              file_size: buffer.length,
              buffer,
            });
          } else {
            const buffer = await buildDBFileBuffer(techSchema.version, rows, techSchema.fields);
            packFiles.push({ name: `db\\technologies_tables\\${tableName}`, file_size: buffer.length, buffer });
          }
        }
      }
      const hasLinkDeletions = data.deletedLinkKeys && data.deletedLinkKeys.length > 0;
      if (data.changedLinks.length > 0 || hasLinkDeletions) {
        const schema = getPreferredSchema("technology_node_links_tables");
        const deletedLinkSet = new Set(data.deletedLinkKeys || []);
        const dedupedRowsByLinkKey: Record<string, Record<string, string | boolean>> = {};
        if (hasLinkDeletions) {
          // Write complete replacement: all original links minus deleted ones
          for (const [linkKey, originalRow] of Object.entries(technologyData.linkRowsByKey)) {
            if (deletedLinkSet.has(linkKey)) continue;
            dedupedRowsByLinkKey[linkKey] = { ...originalRow };
          }
        }
        for (const changedLink of data.changedLinks) {
          const linkKey = `${changedLink.parentKey}|${changedLink.childKey}`;
          if (deletedLinkSet.has(linkKey)) continue;
          const originalRow = technologyData.linkRowsByKey[linkKey] || {};
          dedupedRowsByLinkKey[linkKey] = {
            ...originalRow,
            parent_key: changedLink.parentKey,
            child_key: changedLink.childKey,
            parent_link_position: changedLink.parentLinkPosition.toString(),
            child_link_position: changedLink.childLinkPosition.toString(),
            parent_link_position_offset: changedLink.parentLinkPositionOffset.toString(),
            child_link_position_offset: changedLink.childLinkPositionOffset.toString(),
            initial_descent_tiers: changedLink.initialDescentTiers.toString(),
            visible_in_ui: changedLink.visibleInUi ? "1" : "0",
          };
        }
        const rows = Object.values(dedupedRowsByLinkKey).map((row) => buildRowFromSchema(schema.fields, row));
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({
            name: `db\\technology_node_links_tables\\${tableName}`,
            file_size: buffer.length,
            buffer,
          });
        }
      }
      if (data.hiddenTechnologies.length > 0) {
        const schema = getPreferredSchema("technologies_tables");
        const dedupedRowsByTechnologyKey: Record<string, Record<string, string | boolean>> = {};
        for (const hiddenTechnology of data.hiddenTechnologies) {
          const originalRow = technologyData.technologyRowsByKey[hiddenTechnology.technologyKey];
          if (!originalRow) continue;
          dedupedRowsByTechnologyKey[hiddenTechnology.technologyKey] = {
            ...originalRow,
            key: hiddenTechnology.technologyKey,
            is_hidden: hiddenTechnology.isHidden ? "true" : "false",
            building_level: hiddenTechnology.isHidden
              ? "wh_main_chs_port_ruin"
              : originalRow.building_level || "",
          };
        }
        const rows = Object.values(dedupedRowsByTechnologyKey).map((row) =>
          buildRowFromSchema(schema.fields, row),
        );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\technologies_tables\\${tableName}`, file_size: buffer.length, buffer });
        }
      }
      if (data.newNodes && data.newNodes.length > 0) {
        // Write new entries to technology_nodes_tables
        const nodeSchema = getPreferredSchema("technology_nodes_tables");
        const newNodeRows = data.newNodes.map((newNode) =>
          buildRowFromSchema(nodeSchema.fields, {
            key: newNode.nodeKey,
            technology_key: newNode.technologyKey,
            technology_node_set: newNode.setKey,
            tier: newNode.tier.toString(),
            indent: newNode.indent.toString(),
            required_parents: newNode.requiredParents.toString(),
            campaign_key: newNode.campaignKey || "",
            faction_key: newNode.factionKey || "",
            pixel_offset_x: newNode.pixelOffsetX.toString(),
            pixel_offset_y: newNode.pixelOffsetY.toString(),
            research_points_required: newNode.researchPointsRequired.toString(),
          }),
        );
        if (newNodeRows.length > 0) {
          // Merge with any existing changed node rows for the same table
          const existingNodeFile = packFiles.find((f) => f.name.startsWith("db\\technology_nodes_tables\\"));
          if (existingNodeFile) {
            // Re-build with combined rows: need to re-parse existing buffer rows + new rows
            // For simplicity, just add a separate table entry
            const buffer = await buildDBFileBuffer(nodeSchema.version, newNodeRows, nodeSchema.fields);
            packFiles.push({
              name: `db\\technology_nodes_tables\\${tableName}_new`,
              file_size: buffer.length,
              buffer,
            });
          } else {
            const buffer = await buildDBFileBuffer(nodeSchema.version, newNodeRows, nodeSchema.fields);
            packFiles.push({
              name: `db\\technology_nodes_tables\\${tableName}`,
              file_size: buffer.length,
              buffer,
            });
          }
        }
        // Write new entries to technologies_tables
        const techSchema = getPreferredSchema("technologies_tables");
        const newTechRowsByKey = new Map<string, (string | boolean)[]>();
        for (const newNode of data.newNodes) {
          if (technologyData.technologyRowsByKey[newNode.technologyKey]) continue;
          if (newTechRowsByKey.has(newNode.technologyKey)) continue;
          newTechRowsByKey.set(
            newNode.technologyKey,
            buildRowFromSchema(techSchema.fields, {
              key: newNode.technologyKey,
              research_points_required: newNode.researchPointsRequired.toString(),
              icon_name: getTechnologyIconNameFromPath(newNode.iconPath),
              is_hidden: newNode.isHidden ? "true" : "false",
              building_level: getTechnologyBuildingLevelForWrite(newNode.buildingLevel),
              unique_index: allocateTechnologyUniqueIndex(usedTechnologyUniqueIndexes),
              is_military: "true",
            }),
          );
        }
        const newTechRows = [...newTechRowsByKey.values()];
        if (newTechRows.length > 0) {
          const existingTechFile = packFiles.find((f) => f.name.startsWith("db\\technologies_tables\\"));
          if (existingTechFile) {
            const buffer = await buildDBFileBuffer(techSchema.version, newTechRows, techSchema.fields);
            packFiles.push({
              name: `db\\technologies_tables\\${tableName}_new`,
              file_size: buffer.length,
              buffer,
            });
          } else {
            const buffer = await buildDBFileBuffer(techSchema.version, newTechRows, techSchema.fields);
            packFiles.push({
              name: `db\\technologies_tables\\${tableName}`,
              file_size: buffer.length,
              buffer,
            });
          }
        }
      }
      const techEffectsSchema = getPreferredSchema("technology_effects_junction_tables");
      const techEffectsRows: (string | boolean)[][] = [];
      const seenTechnologyEffects = new Set<string>();
      let defaultTechnologyEffectScopeFallbackCount = 0;
      const pushTechnologyEffects = (
        technologyKey: string,
        effects: TechEffect[] | undefined,
        sourceTechnologyKey?: string,
      ) => {
        if (!effects || effects.length < 1) return;
        for (const effect of effects) {
          const effectKey = `${effect.effectKey || ""}`.trim();
          if (!effectKey) continue;
          const rowKey = `${technologyKey}|${effectKey}`;
          if (seenTechnologyEffects.has(rowKey)) continue;
          seenTechnologyEffects.add(rowKey);
          const resolvedEffectScope =
            (sourceTechnologyKey
              ? technologyData.technologyEffectRowsByKey[sourceTechnologyKey]?.[effectKey]?.effect_scope
              : undefined) ||
            technologyData.technologyEffectScopesByKey[effectKey] ||
            "default";
          if (resolvedEffectScope === "default") {
            defaultTechnologyEffectScopeFallbackCount += 1;
          }
          techEffectsRows.push(
            buildRowFromSchema(techEffectsSchema.fields, {
              ...(sourceTechnologyKey
                ? (technologyData.technologyEffectRowsByKey[sourceTechnologyKey]?.[effectKey] || {})
                : {}),
              technology: technologyKey,
              effect: effectKey,
              effect_scope: resolvedEffectScope,
              value: effect.value || "",
            }),
          );
        }
      };
      if (data.newNodes) {
        for (const newNode of data.newNodes) {
          if (technologyData.technologyRowsByKey[newNode.technologyKey]) continue;
          pushTechnologyEffects(newNode.technologyKey, newNode.effects);
        }
      }
      if (data.editedNodes) {
        for (const editedNode of data.editedNodes) {
          const nodeRow = technologyData.nodeRowsByKey[editedNode.nodeKey];
          const technologyKey = (editedNode.technologyKey || (nodeRow?.technology_key as string) || "").trim();
          if (!technologyKey) continue;
          if (technologyData.technologyRowsByKey[technologyKey]) continue;
          pushTechnologyEffects(technologyKey, editedNode.effects, nodeRow?.technology_key as string | undefined);
        }
      }
      if (techEffectsRows.length > 0) {
        const buffer = await buildDBFileBuffer(techEffectsSchema.version, techEffectsRows, techEffectsSchema.fields);
        packFiles.push({
          name: `db\\technology_effects_junction_tables\\${tableName}`,
          file_size: buffer.length,
          buffer,
        });
      }
      // Write loc entries for new and edited node names/descriptions
      const locRows: (string | boolean)[][] = [];
      if (data.newNodes) {
        for (const newNode of data.newNodes) {
          if (technologyData.technologyRowsByKey[newNode.technologyKey]) continue;
          if (newNode.displayName) {
            locRows.push([`technologies_onscreen_name_${newNode.technologyKey}`, newNode.displayName, false]);
          }
          if (newNode.shortDescription) {
            locRows.push([`technologies_short_description_${newNode.technologyKey}`, newNode.shortDescription, false]);
          }
          if (newNode.longDescription) {
            locRows.push([`technologies_long_description_${newNode.technologyKey}`, newNode.longDescription, false]);
          }
        }
      }
      if (data.editedNodes) {
        for (const editedNode of data.editedNodes) {
          const nodeRow = technologyData.nodeRowsByKey[editedNode.nodeKey];
          const technologyKey = (editedNode.technologyKey || (nodeRow?.technology_key as string) || "").trim();
          if (!technologyKey) continue;
          if (editedNode.displayName !== undefined) {
            locRows.push([`technologies_onscreen_name_${technologyKey}`, editedNode.displayName, false]);
          }
          if (editedNode.shortDescription !== undefined) {
            locRows.push([`technologies_short_description_${technologyKey}`, editedNode.shortDescription, false]);
          }
          if (editedNode.longDescription !== undefined) {
            locRows.push([`technologies_long_description_${technologyKey}`, editedNode.longDescription, false]);
          }
        }
      }
      if (locRows.length > 0) {
        const buildLocFileBuffer = async (rows: (string | boolean)[][]): Promise<Buffer> => {
          const parts: Buffer[] = [];
          parts.push(Buffer.from([0xff, 0xfe]));
          parts.push(Buffer.from([0x4c, 0x4f, 0x43]));
          parts.push(Buffer.from([0x00]));
          const cBuf = Buffer.alloc(4);
          cBuf.writeInt32LE(1, 0);
          parts.push(cBuf);
          const countBuf = Buffer.alloc(4);
          countBuf.writeInt32LE(rows.length, 0);
          parts.push(countBuf);
          for (const row of rows) {
            for (let i = 0; i < LocFields.length; i++) {
              parts.push(await typeToBuffer(LocFields[i].field_type, row[i]));
            }
          }
          return Buffer.concat(parts);
        };
        const buffer = await buildLocFileBuffer(locRows);
        packFiles.push({ name: `text\\db\\${tableName}.loc`, file_size: buffer.length, buffer });
      }
      if (packFiles.length < 1) return { success: false, error: "No technology changes detected" };
      await writePack(packFiles, packPath);
      cachedTechnologyData = undefined;
      cachedTechnologyDataKey = undefined;
      return {
        success: true,
        packPath,
        packName: finalPackName,
        warning:
          defaultTechnologyEffectScopeFallbackCount > 0
            ? `${defaultTechnologyEffectScopeFallbackCount} technology effect row${defaultTechnologyEffectScopeFallbackCount === 1 ? "" : "s"} used fallback effect_scope 'default'.`
            : undefined,
      };
    } catch (error: any) {
      console.error("Failed to save technology changes:", error);
      return { success: false, error: error?.message || String(error) };
    }
  });
  ipcMain.on("getPackData", async (event, packPath: string, table?: DBTable) => {
    getPackData(packPath, table);
  });
  ipcMain.on("getPackDataWithLocs", async (event, packPath: string, table?: DBTable) => {
    getPackData(packPath, table, true);
  });
  const getLiveViewerWindow = () => {
    if (!windows.viewerWindow) return undefined;
    if (windows.viewerWindow.isDestroyed()) {
      windows.viewerWindow = undefined;
      appData.isViewerReady = false;
      return undefined;
    }
    return windows.viewerWindow;
  };
  const createViewerWindow = () => {
    if (getLiveViewerWindow()) return;
    const viewerWindowState = windowStateKeeper({
      file: "viewer_window.json",
      defaultWidth: 1280,
      defaultHeight: 900,
    });
    windows.viewerWindow = new BrowserWindow({
      x: viewerWindowState.x,
      y: viewerWindowState.y,
      width: viewerWindowState.width,
      height: viewerWindowState.height,
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#374151",
        symbolColor: "#9ca3af",
        height: 28,
      },
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        preload: VIEWER_PRELOAD_WEBPACK_ENTRY,
        spellcheck: false,
      },
      title: "WH3 Mod Manager Mod Viewer",
      icon: "./assets/modmanager.ico",
    });
    const viewerWindow = windows.viewerWindow;
    const viewerWebContentsId = viewerWindow.webContents.id;
    viewerWindowState.manage(viewerWindow);
    viewerWindow.loadURL(VIEWER_WEBPACK_ENTRY);
    viewerWindow.on("page-title-updated", (evt) => {
      evt.preventDefault();
    });
    viewerWindow.on("closed", () => {
      dbIndirectReferenceCacheByWebContentsId.delete(viewerWebContentsId);
      dbDuplicationCancelStateByWebContentsId.delete(viewerWebContentsId);
      if (windows.viewerWindow === viewerWindow) {
        windows.viewerWindow = undefined;
      }
      appData.isViewerReady = false;
    });
  };
  const createSkillsWindow = () => {
    if (windows.skillsWindow) return;
    const skillsWindowState = windowStateKeeper({
      file: "skills_window.json",
      defaultWidth: 1280,
      defaultHeight: 900,
    });
    windows.skillsWindow = new BrowserWindow({
      x: skillsWindowState.x,
      y: skillsWindowState.y,
      width: skillsWindowState.width,
      height: skillsWindowState.height,
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#374151",
        symbolColor: "#9ca3af",
        height: 28,
      },
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        preload: SKILLS_PRELOAD_WEBPACK_ENTRY,
        spellcheck: false,
      },
      title: "WH3 Mod Manager Mod Viewer",
      icon: "./assets/modmanager.ico",
    });
    skillsWindowState.manage(windows.skillsWindow);
    windows.skillsWindow.loadURL(SKILLS_WEBPACK_ENTRY);
    windows.skillsWindow.on("page-title-updated", (evt) => {
      evt.preventDefault();
    });
    windows.skillsWindow.on("closed", () => {
      windows.skillsWindow = undefined;
      appData.areSkillsReady = false;
    });
  };
  ipcMain.on("requestOpenModInViewer", (event, modPath: string) => {
    for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
      const baseVanillaPackName = vanillaPackData.name;
      if (modPath == baseVanillaPackName) {
        modPath = nodePath.join(
          appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string,
          baseVanillaPackName,
        );
      }
    }
    console.log("ON requestOpenModInViewer", modPath);
    let viewerWindow = getLiveViewerWindow();
    if (!viewerWindow) {
      createViewerWindow();
      viewerWindow = getLiveViewerWindow();
    }
    getPackData(modPath);
    if (viewerWindow?.webContents && !viewerWindow.webContents.isDestroyed() && appData.isViewerReady) {
      viewerWindow.webContents.send("openModInViewer", modPath);
      viewerWindow.setTitle(`WH3 Mod Manager v${version}: viewing ${nodePath.basename(modPath)}`);
      viewerWindow.focus();
    } else if (viewerWindow) {
      viewerWindow.focus();
    }
  });
  ipcMain.on("requestOpenSkillsWindow", (event, mods: Mod[]) => {
    console.log("ON requestOpenSkillsWindow");
    appData.enabledMods = mods.filter((mod) => mod.isEnabled);
    getSkillsData(mods.filter((mod) => mod.isEnabled));
    if (windows.skillsWindow) {
      windows.skillsWindow.focus();
    } else {
      createSkillsWindow();
    }
  });
  ipcMain.on("setSkillsViewOptions", (event, skillsViewOptions: SkillsViewOptions) => {
    appData.isShowingSkillNodeSetNames = skillsViewOptions.isShowingSkillNodeSetNames;
    appData.isShowingHiddenSkills = skillsViewOptions.isShowingHiddenSkills;
    appData.isShowingHiddenModifiersInsideSkills = skillsViewOptions.isShowingHiddenModifiersInsideSkills;
    appData.isCheckingSkillRequirements = skillsViewOptions.isCheckingSkillRequirements;
    windows.mainWindow?.webContents.send("setSkillsViewOptions", skillsViewOptions);
  });
  ipcMain.on("requestLanguageChange", async (event, language: string) => {
    console.log("requestLanguageChange:", language);
    await i18n.changeLanguage(language);
    appData.currentLanguage = language as SupportedLanguage;
    windows.mainWindow?.webContents.send("setCurrentLanguage", language);
    windows.skillsWindow?.webContents.send("setCurrentLanguage", language);
    windows.viewerWindow?.webContents.send("setCurrentLanguage", language);
  });
  ipcMain.on("requestGameChange", async (event, game: SupportedGames, appState: AppState) => {
    // console.log("game before change is", appData.currentGame, "to", game);
    console.log(`Requesting game change to ${game}`);
    console.log(`Current game is ${appState.currentGame}`);
    appData.gameToCurrentPreset[appState.currentGame] = appState.currentPreset;
    appData.gameToPresets[appState.currentGame] = appState.presets;
    await setCurrentGame(game);
    if (appData.gamesToGameFolderPaths[game].contentFolder) {
      const currentPreset = appData.gameToCurrentPreset[game];
      // console.log("SETTING GAME IN INDEX", game, currentPreset?.mods[0].name);
      const presets = appData.gameToPresets[game];
      console.log("SENDING setCurrentGame", game);
      mainWindow?.webContents.send("setCurrentGame", game, currentPreset, presets);
    }
  });
  const terminateCurrentGame = () => {
    const name = gameToProcessName[appData.currentGame];
    try {
      switch (process.platform) {
        case "win32": {
          exec(`taskkill /f /t /im ${name}`, (error) => {
            if (error) console.error("taskkill error:", error);
          });
          break;
        }
        case "linux": {
          exec(`pkill -f ${name}`, (error) => {
            if (error) console.error("pkill error:", error);
          });
          break;
        }
      }
    } catch (e) {
      console.error("killWrapper error:", e);
    }
  };
  ipcMain.on("terminateGame", () => {
    terminateCurrentGame();
  });
  const dbTableToString = (dbTable: DBTable) => {
    return `db\\${dbTable.dbName}\\${dbTable.dbSubname}`;
  };
  const getPackData = async (packPath: string, table?: DBTable, getLocs?: boolean) => {
    console.log(`getPackData ${packPath}`);
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (table) console.log("GETTING TABLE ", table.dbName, table.dbSubname);
    for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
      const baseVanillaPackName = vanillaPackData.name;
      if (packPath == baseVanillaPackName || nodePath.basename(packPath) == baseVanillaPackName) {
        if (!dataFolder) {
          console.log("WAIT FOR DATAFOLDER TO BE SET");
          await new Promise((resolve) => setTimeout(resolve, 1000));
          console.log("DONE WAITING FOR DATAFOLDER");
          getPackData(packPath, table, getLocs);
          return;
        }
        if (packPath == baseVanillaPackName) {
          console.log("data folder is", dataFolder);
          packPath = nodePath.join(dataFolder as string, baseVanillaPackName);
        }
      }
    }
    console.log("CURRENTLY READING:", appData.currentlyReadingModPaths);
    console.log("before join", dataFolder, packPath);
    if (!packPath.includes("\\")) {
      // if we provided pack name instead of pack path as argument
      if (!dataFolder) {
        console.log("WAIT FOR DATAFOLDER TO BE SET");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log("DONE WAITING FOR DATAFOLDER");
        getPackData(packPath, table, getLocs);
        return;
      }
      packPath = nodePath.join(dataFolder as string, packPath);
    }
    const packData = appData.packsData.find((pack) => pack.path === packPath);
    // console.log("packsdata is", appData.packsData);
    // console.log("to read:", packPath);
    // console.log("found packs for reading:", packData);
    console.log(
      "getPackData:",
      appData.currentlyReadingModPaths.every((path) => path != packPath),
    );
    console.log("getPackData:", !packData);
    console.log("getPackData:", table);
    if (packData && table)
      console.log(
        "getPackData:",
        packData.packedFiles
          .filter((packedFile) => packedFile.schemaFields)
          .every((packedFile) => packedFile.name != dbTableToString(table)),
      );
    if (
      appData.currentlyReadingModPaths.every((path) => path != packPath) &&
      (!packData ||
        (table &&
          packData.packedFiles
            .filter((packedFile) => packedFile.schemaFields)
            .every((packedFile) => packedFile.name != dbTableToString(table))))
    ) {
      appData.currentlyReadingModPaths.push(packPath);
      console.log(`READING ${packPath}`);
      const newPack = await readPack(
        packPath,
        table && { tablesToRead: [dbTableToString(table)], readLocs: getLocs },
      );
      appData.currentlyReadingModPaths = appData.currentlyReadingModPaths.filter((path) => path != packPath);
      if (appData.packsData.every((pack) => pack.path != packPath)) {
        console.log("APPENDING packsData", packPath);
        appendPacksData(newPack);
      }
      const toSend = [getPackViewData(newPack, table, getLocs)];
      mainWindow?.webContents.send("setPacksData", toSend);
      windows.viewerWindow?.webContents.send("setPacksData", toSend);
      if (!appData.isViewerReady) {
        console.log("VIEWER NOT READY, QUEUEING");
        appData.queuedViewerData = toSend;
      }
    } else {
      if (appData.currentlyReadingModPaths.some((path) => path == packPath)) {
        console.log("WAIT");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log("DONE WAITING");
        getPackData(packPath, table, getLocs);
        return;
      }
      const packData = appData.packsData.find((pack) => pack.path === packPath);
      if (packData) {
        const toSend = [getPackViewData(packData, table, getLocs)];
        mainWindow?.webContents.send("setPacksData", toSend);
        windows.viewerWindow?.webContents.send("setPacksData", toSend);
        if (!appData.isViewerReady) {
          console.log("VIEWER NOT READY, QUEUEING");
          appData.queuedViewerData = toSend;
        }
      }
    }
  };
  const readMods = async (
    mods: Mod[],
    skipParsingTables = true,
    skipCollisionCheck = true,
    readScripts = false,
    readLocs = false,
    tablesToRead?: string[],
    filesToRead?: string[],
  ) => {
    if (!skipParsingTables) {
      appData.packsData = appData.packsData.filter((pack) => !mods.some((mod) => mod.path == pack.path));
    }
    for (const mod of mods) {
      if (
        appData.currentlyReadingModPaths.every((path) => path != mod.path) &&
        appData.packsData.every((pack) => pack.path != mod.path)
      ) {
        console.log("READING " + mod.name);
        appData.currentlyReadingModPaths.push(mod.path);
        if (!skipParsingTables) mainWindow?.webContents.send("setCurrentlyReadingMod", mod.name);
        const newPack = await readPack(mod.path, {
          skipParsingTables,
          readScripts,
          tablesToRead,
          filesToRead,
          readLocs,
        });
        if (!skipParsingTables) mainWindow?.webContents.send("setLastModThatWasRead", mod.name);
        appData.currentlyReadingModPaths = appData.currentlyReadingModPaths.filter(
          (path) => path != mod.path,
        );
        if (appData.packsData.every((pack) => pack.path != mod.path)) {
          appendPacksData(newPack, mod);
        }
        if (!skipCollisionCheck) {
          appendCollisions(newPack);
        }
      }
    }
    if (!skipCollisionCheck) {
      mainWindow?.webContents.send("setPackCollisions", {
        packFileCollisions: appData.compatData.packFileCollisions,
        packTableCollisions: appData.compatData.packTableCollisions,
      } as PackCollisions);
    }
  };
  let lastReadModsReceived = [];
  ipcMain.on(
    "readMods",
    async (
      event,
      mods: Mod[],
      skipCollisionCheck = true,
      canUseCustomizableCache = true,
      customizableModsHash?: string,
    ) => {
      let modsToRead = mods;
      if (canUseCustomizableCache) {
        const customizableModsCache = await loadCustomizableModsCache();
        const customizableModsCachePaths = Object.keys(customizableModsCache);
        const modsNotInCustomizableCache = mods.filter(
          (mod) => !customizableModsCachePaths.includes(mod.path),
        );
        if (modsNotInCustomizableCache.length == 0) {
          console.log("Skipping readMods, all are already in the customizable mods cache!");
          if (customizableModsHash != hash(appData.customizableMods)) {
            console.log("Skipping setCustomizableMods in readMods, hash is the same!");
            mainWindow?.webContents.send("setCustomizableMods", appData.customizableMods);
          }
          return;
        }
        modsToRead = modsNotInCustomizableCache;
      }
      if (lastReadModsReceived.length != mods.length) {
        console.log(
          "READ MODS RECEIVED",
          mods.map((mod) => mod.name),
        );
        lastReadModsReceived = [...mods];
      }
      readMods(modsToRead, skipCollisionCheck, skipCollisionCheck);
    },
  );
  const sendQueuedDataToViewer = async () => {
    if (!appData.isViewerReady) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      sendQueuedDataToViewer();
      return;
    }
    console.log("SENDING QUEUED DATA TO VIEWER");
    windows.viewerWindow?.webContents.send("setCurrentGameNaive", appData.currentGame);
    windows.viewerWindow?.webContents.send("setPacksData", appData.queuedViewerData);
    windows.viewerWindow?.webContents.send("openModInViewer", appData.queuedViewerData[0]?.packPath);
    if (appData.queuedViewerData[0]?.packPath)
      windows.viewerWindow?.setTitle(
        `WH3 Mod Manager v${version}: viewing ${nodePath.basename(appData.queuedViewerData[0]?.packPath)}`,
      );
    windows.viewerWindow?.focus();
    appData.queuedViewerData = [];
  };
  ipcMain.on("viewerIsReady", async () => {
    console.log("VIEWER IS NOW READY");
    appData.isViewerReady = true;
    await initializeAllSchemaForGame(appData.currentGame);
    console.log("viewerIsReady appData.currentGame", appData.currentGame);
    if (isDev) {
      setTimeout(() => {
        windows.viewerWindow?.webContents.openDevTools({ mode: "right" });
      }, 1000);
    }
    windows.viewerWindow?.webContents.send(
      "setDBNameToDBVersions",
      DBNameToDBVersions[appData.currentGame],
      gameToDBFieldsThatReference[appData.currentGame],
      gameToReferences[appData.currentGame],
    );
    windows.viewerWindow?.webContents.send("setStartArgs", appData.startArgs);
    windows.viewerWindow?.webContents.send("setCurrentLanguage", appData.currentLanguage);
    windows.viewerWindow?.webContents.send(
      "setIsFeaturesForModdersEnabled",
      appData.isFeaturesForModdersEnabled,
    );
    windows.viewerWindow?.webContents.send("setModdersPrefix", appData.moddersPrefix);
    // console.log("QUEUED DATA IS ", queuedViewerData);
    if (appData.queuedViewerData.length > 0) {
      sendQueuedDataToViewer();
    }
  });
  const sendQueuedDataToSkills = async () => {
    if (!appData.queuedSkillsData) {
      console.log("sendQueuedDataToSkills called but queuedSkillsData not ready");
      return;
    }
    if (!appData.areSkillsReady) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      sendQueuedDataToSkills();
      return;
    }
    console.log("SENDING QUEUED DATA TO SKILLS");
    // windows.skillsWindow?.webContents.send("setCurrentGameNaive", appData.currentGame);
    windows.skillsWindow?.webContents.send("setSkillsData", appData.queuedSkillsData);
    windows.skillsWindow?.webContents.send(
      "setIsFeaturesForModdersEnabled",
      appData.isFeaturesForModdersEnabled,
    );
    windows.skillsWindow?.focus();
    appData.queuedSkillsData = undefined;
  };
  ipcMain.on("skillsAreReady", () => {
    console.log("SKILLS ARE NOW READY");
    appData.areSkillsReady = true;
    if (isDev) {
      setTimeout(() => {
        windows.skillsWindow?.webContents.openDevTools({ mode: "right" });
      }, 1000);
    }
    windows.skillsWindow?.webContents.send("setStartArgs", appData.startArgs);
    windows.skillsWindow?.webContents.send("setCurrentLanguage", appData.currentLanguage);
    windows.skillsWindow?.webContents.send(
      "setIsFeaturesForModdersEnabled",
      appData.isFeaturesForModdersEnabled,
    );
    windows.skillsWindow?.webContents.send("setModdersPrefix", appData.moddersPrefix);
    windows.skillsWindow?.webContents.send("setSkillsViewOptions", {
      isShowingSkillNodeSetNames: appData.isShowingSkillNodeSetNames,
      isShowingHiddenSkills: appData.isShowingHiddenSkills,
      isShowingHiddenModifiersInsideSkills: appData.isShowingHiddenModifiersInsideSkills,
      isCheckingSkillRequirements: appData.isCheckingSkillRequirements,
    } as SkillsViewOptions);
    // console.log("QUEUED DATA IS ", queuedViewerData);
    if (appData.queuedSkillsData) {
      sendQueuedDataToSkills();
    }
  });
  ipcMain.on("openFolderInExplorer", (event, path: string) => {
    shell.showItemInFolder(path);
  });
  const openInSteam = (url: string) => {
    exec(`start steam://openurl/${url}`);
  };
  ipcMain.on("openInSteam", (event, url: string) => {
    openInSteam(url);
  });
  ipcMain.on("openPack", (event, path: string) => {
    shell.openPath(path);
  });
  ipcMain.on("putPathInClipboard", (event, path: string) => {
    clipboard.writeText(path);
  });
  ipcMain.on("copyModToData", (event, path: string) => {
    const baseName = nodePath.basename(path);
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataFolder) return;
    const destPath = nodePath.join(dataFolder, baseName);
    fs.copyFileSync(path, destPath);
  });
  const checkIsModThumbnailValid = (modThumbnailPath: string) => {
    if (modThumbnailPath == "" || !fs.existsSync(modThumbnailPath)) {
      mainWindow?.webContents.send("addToast", {
        type: "warning",
        messages: ["loc:missingModThumbnail"],
        startTime: Date.now(),
      } as Toast);
      return false;
    }
    if (fs.statSync(modThumbnailPath).size > 1024 * 1024) {
      mainWindow?.webContents.send("addToast", {
        type: "warning",
        messages: ["loc:thumbnailTooBig"],
        startTime: Date.now(),
      } as Toast);
      return false;
    }
    return true;
  };
  ipcMain.on("uploadMod", async (event, mod: Mod) => {
    if (!checkIsModThumbnailValid(mod.imgPath)) return;
    const child = fork(
      nodePath.join(__dirname, "sub.js"),
      [gameToSteamId[appData.currentGame], "upload"],
      {},
    );
    child.on("message", (response: ModUploadResponseError | ModUploadResponseSuccess) => {
      console.log("upload response:", response);
      if (response && "type" in response) {
        switch (response.type) {
          case "success":
            mainWindow?.webContents.send("addToast", {
              type: "success",
              messages: ["loc:modCreated"],
              startTime: Date.now(),
            } as Toast);
            if ("needsToAcceptAgreement" in response && response.needsToAcceptAgreement) {
              mainWindow?.webContents.send("addToast", {
                type: "info",
                messages: ["loc:needsToAcceptSteamWorkshopAgreement"],
                startTime: Date.now(),
              } as Toast);
            }
            updateMod(mod, response.workshopId, mod.tags, mod.name, true);
            break;
          case "error":
            mainWindow?.webContents.send("addToast", {
              type: "warning",
              messages: ["loc:failedUploadingMod"],
              startTime: Date.now(),
            } as Toast);
            break;
        }
      }
    });
  });
  const updateMod = async (
    mod: Mod,
    workshopId: string,
    tags: string[],
    modTitle?: string,
    openInSteamAfterUpdate = false,
  ) => {
    const uploadFolderName = workshopId;
    const uploadFolderPath = nodePath.join(nodePath.dirname(mod.path), "whmm_uploads_" + uploadFolderName);
    if (!checkIsModThumbnailValid(mod.imgPath)) return;
    await fs.rmSync(uploadFolderPath, { recursive: true, force: true });
    await fs.mkdirSync(uploadFolderPath, { recursive: true });
    await fs.linkSync(mod.path, nodePath.join(uploadFolderPath, mod.name));
    await fs.linkSync(mod.imgPath, nodePath.join(uploadFolderPath, nodePath.basename(mod.imgPath)));
    const args = [
      gameToSteamId[appData.currentGame],
      "update",
      workshopId,
      uploadFolderPath,
      mod.imgPath,
      tags.join(";"),
    ];
    console.log("UPDATING MOD:", modTitle, tags);
    // return;
    if (modTitle) args.push(modTitle);
    const child = fork(nodePath.join(__dirname, "sub.js"), args, {});
    child.on(
      "message",
      (response: ModUpdateResponseError | ModUpdateResponseProgress | ModUpdateResponseSuccess) => {
        console.log("update response:", response);
        if (response && "type" in response) {
          switch (response.type) {
            case "success":
              mainWindow?.webContents.send("addToast", {
                type: "success",
                messages: ["loc:modUpdated"],
                startTime: Date.now(),
              } as Toast);
              if ("needsToAcceptAgreement" in response && response.needsToAcceptAgreement) {
                mainWindow?.webContents.send("addToast", {
                  type: "info",
                  messages: ["loc:needsToAcceptSteamWorkshopAgreement"],
                  startTime: Date.now(),
                } as Toast);
              }
              fs.rmSync(uploadFolderPath, { recursive: true, force: true });
              if (openInSteamAfterUpdate) {
                openInSteam(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`);
              }
              break;
            case "error":
              mainWindow?.webContents.send("addToast", {
                type: "warning",
                messages: ["loc:failedUpdatingMod"],
                startTime: Date.now(),
              } as Toast);
              if ("err" in response) {
                try {
                  console.log(response.err);
                } catch (e) {
                  /* empty */
                }
              }
              fs.rmSync(uploadFolderPath, { recursive: true, force: true });
              break;
            case "progress":
              if ("progress" in response && "total" in response && response.total > 0) {
                mainWindow?.webContents.send("addToast", {
                  type: "info",
                  messages: [
                    "loc:uploadingMod",
                    `${Math.round(
                      (<number>response.progress / <number>response.total + Number.EPSILON) * 100,
                    )}%`,
                  ],
                  startTime: Date.now(),
                  staticToastId: uploadFolderPath,
                } as Toast);
              }
              break;
          }
        }
        //
      },
    );
  };
  ipcMain.on("updateMod", async (event, mod: Mod, contentMod: Mod) => {
    updateMod(mod, contentMod.workshopId, contentMod.tags);
  });
  ipcMain.on("fakeUpdatePack", async (event, mod: Mod) => {
    try {
      const backupFolderPath = nodePath.join(nodePath.dirname(mod.path), "whmm_backups");
      const backupFilePath = nodePath.join(
        backupFolderPath,
        nodePath.parse(mod.name).name +
          "-" +
          format(new Date(), "dd-MM-yyyy-HH-mm") +
          nodePath.parse(mod.name).ext,
      );
      const uploadFilePath = nodePath.join(
        backupFolderPath,
        nodePath.parse(mod.name).name +
          "-NEW-" +
          format(new Date(), "dd-MM-yyyy-HH-mm") +
          nodePath.parse(mod.name).ext,
      );
      await fs.mkdirSync(backupFolderPath, { recursive: true });
      await fs.copyFileSync(mod.path, backupFilePath);
      await addFakeUpdate(mod.path, uploadFilePath);
      const command = `cd /d "${nodePath.dirname(mod.path)}" && del "${nodePath.basename(
        mod.path,
      )}" && move /y "whmm_backups\\${nodePath.basename(uploadFilePath)}" "${nodePath.basename(mod.path)}"`;
      console.log(command);
      exec(command);
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("makePackBackup", async (event, mod: Mod) => {
    try {
      const uploadFolderPath = nodePath.join(nodePath.dirname(mod.path), "whmm_backups");
      const backupFilePath = nodePath.join(
        uploadFolderPath,
        nodePath.parse(mod.name).name +
          "-" +
          format(new Date(), "dd-MM-yyyy-HH-mm") +
          nodePath.parse(mod.name).ext,
      );
      await fs.mkdirSync(uploadFolderPath, { recursive: true });
      await fs.copyFileSync(mod.path, backupFilePath);
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on(
    "importSteamCollection",
    async (
      event,
      steamCollectionURL: string,
      isImmediateImport: boolean,
      doDisableOtherMods: boolean,
      isLoadOrdered: boolean,
      doCreatePreset: boolean,
      presetName: string,
      isPresetLoadOrdered: boolean,
    ) => {
      try {
        console.log("getting steamCollectionURL:", steamCollectionURL);
        const res = await fetch(steamCollectionURL);
        const cheerioObj = cheerio.load(await res.text());
        const collectionTitle = cheerioObj(".collectionHeaderContent").find(".workshopItemTitle").text();
        console.log("collection title:", collectionTitle);
        const modIds = cheerioObj(".collectionItem")
          .map((_, elem) => elem.attribs["id"].replace("sharedfile_", ""))
          .toArray();
        if (!collectionTitle) return;
        mainWindow?.webContents.send("importSteamCollectionResponse", {
          name: collectionTitle,
          modIds,
          isImmediateImport,
          doDisableOtherMods,
          isLoadOrdered,
          doCreatePreset,
          presetName,
          isPresetLoadOrdered,
        } as ImportSteamCollection);
        console.log(modIds);
      } catch (e) {
        console.log(e);
      }
    },
  );
  ipcMain.on("forceModDownload", async (event, mod: Mod) => {
    try {
      fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "download", mod.workshopId],
        {},
      );
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("reMerge", async (event, mod: Mod, modsToMerge: Mod[]) => {
    try {
      mergeMods(modsToMerge, mod.path);
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("deletePack", async (event, mod: Mod) => {
    try {
      await fsExtra.remove(mod.path);
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("forceDownloadMods", async (event, modIds: string[]) => {
    try {
      for (const id of modIds) {
        if (!appData.waitForModIds.includes(id)) {
          appData.waitForModIds.push(id);
        }
      }
      fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "download", modIds.join(";")],
        {},
      );
    } catch (e) {
      console.log(e);
    }
  });
  const resubscribeToMods = async (modIds: string[]) => {
    await subscribeToMods(modIds);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const child = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "getSubscribedIds"],
        {},
      );
      child.on("message", (workshopIds: string[]) => {
        console.log("getSubscribedIds returned:", workshopIds);
        const failedToSubTo = modIds.filter((modId) => !workshopIds.includes(modId));
        console.log("failedToSubTo:", failedToSubTo);
        if (failedToSubTo.length > 0) {
          resubscribeToMods(failedToSubTo);
        }
      });
    } catch (e) {
      console.log(e);
    }
  };
  const forceResubscribeMods = (mods: Mod[]) => {
    try {
      appData.modsToResubscribeTo = mods;
      const mod = mods[0];
      mainWindow?.webContents.send("addToast", {
        type: "info",
        messages: [
          "loc:resubscribing",
          mod.humanName != "" ? mod.humanName : mod.name,
          "loc:queue",
          (mods.length - 1).toString(),
        ],
        startTime: Date.now(),
      } as Toast);
      const child = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "unsubscribe", mod.workshopId],
        {},
      );
      child.on("message", async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        console.log("unsubscribe finished, deleting file:", mod.path);
        try {
          fsExtra.removeSync(nodePath.dirname(mod.path));
        } catch (e) {
          /* empty */
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        resubscribeToMods([mod.workshopId]);
      });
    } catch (e) {
      console.log(e);
    }
  };
  ipcMain.on("forceResubscribeMods", async (event, mods: Mod[]) => {
    console.log(
      "in forceResubscribeMods, mods are:",
      mods.map((mod) => mod.name),
    );
    forceResubscribeMods(mods);
  });
  ipcMain.on("unsubscribeToMod", async (event, mod: Mod) => {
    try {
      const child = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "unsubscribe", mod.workshopId],
        {},
      );
      child.on("message", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log("unsubscribe finished, deleting file:", mod.path);
        // why do we need to unsubscribe twice? who knows, but otherwise Steam unsubs AND happily downloads the mod into content after we unsub the first time
        fork(
          nodePath.join(__dirname, "sub.js"),
          [gameToSteamId[appData.currentGame], "unsubscribe", mod.workshopId],
          {},
        );
        fsExtra.removeSync(nodePath.dirname(mod.path));
      });
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("mergeMods", async (event, mods: Mod[]) => {
    try {
      mergeMods(mods).then((targetPath) => {
        mainWindow?.webContents.send("createdMergedPack", targetPath);
      });
    } catch (e) {
      console.log(e);
    }
  });
  const subscribeToMods = async (ids: string[]) => {
    fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "sub", ids.join(";")], {});
    await new Promise((resolve) => setTimeout(resolve, 1000));
    for (const id of ids) {
      if (!appData.waitForModIds.includes(id)) {
        appData.waitForModIds.push(id);
      }
    }
    for (const modId of ids) {
      fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "download", modId], {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "justRun"], {});
    // await new Promise((resolve) => setTimeout(resolve, 500));
    mainWindow?.webContents.send("subscribedToMods", ids);
  };
  ipcMain.on("subscribeToMods", async (event, ids: string[]) => {
    await subscribeToMods(ids);
  });
  ipcMain.on("exportModsToClipboard", async (event, mods: Mod[]) => {
    const sortedMods = sortByNameAndLoadOrder(mods);
    const enabledMods = sortedMods.filter((mod) => mod.isEnabled);
    const exportedMods = enabledMods
      .filter((mod) => !isNaN(Number(mod.workshopId)) && !isNaN(parseFloat(mod.workshopId)))
      .map((mod) => mod.workshopId + (mod.loadOrder != null ? `;${mod.loadOrder}` : ""))
      .join("|");
    clipboard.writeText(exportedMods);
  });
  ipcMain.on("exportModNamesToClipboard", async (event, mods: Mod[]) => {
    const sortedMods = sortByNameAndLoadOrder(mods);
    const enabledMods = sortedMods.filter((mod) => mod.isEnabled);
    const exportedMods = enabledMods
      .filter((mod) => mod.humanName != "")
      .map((mod) => mod.humanName)
      .join("\n");
    clipboard.writeText(exportedMods);
  });
  ipcMain.on("createSteamCollection", async (event, mods: Mod[]) => {
    const workshopIDs = mods.map((mod) => mod.workshopId);
    const scriptWithIDs = steamCollectionScript.replace(
      "var workshopIds = []",
      "var workshopIds = [" + workshopIDs.map((wID) => `"${wID}"`).join(",") + "]",
    );
    clipboard.writeText(scriptWithIDs);
  });
  const appendToSearchInsidePacks = (
    mods: Mod[],
    modsIndex: number,
    packNamesAll: string[],
    searchTerm: string,
  ) => {
    if (mods.length < modsIndex * 10) {
      console.log("setPackSearchResults", modsIndex);
      mainWindow?.webContents.send("setPackSearchResults", Array.from(new Set([...packNamesAll])));
      return;
    }
    const slicedMods = mods.slice(modsIndex * 10, modsIndex * 10 + 10);
    const modsArray = slicedMods.map((mod) => `'${mod.path.replaceAll("'", "''")}'`).join(",");
    console.log("modsArray is", modsArray, "i is", modsIndex, searchTerm, "num mods is", slicedMods.length);
    exec(
      `powershell.exe -Command "$strarry = @(${modsArray}); Select-String -Path $strarry -Pattern '${searchTerm}' | Select-Object -Unique -ExpandProperty Filename"`,
      (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          mainWindow?.webContents.send("setPackSearchResults", ["error:", error]);
          return;
        }
        console.log("stdout:", stdout);
        console.log("stderr:", stderr);
        const packNames = stdout
          .split("\n")
          .map((line) => line.split(".pack:")[0])
          .filter((packName) => packName != "");
        console.log("packNames:", packNames);
        // Then search again for unicode text.
        exec(
          `powershell.exe -Command "$strarry = @(${modsArray}); Select-String -Encoding unicode -Path $strarry -Pattern '${searchTerm}' | Select-Object -Unique -ExpandProperty Filename"`,
          (error, stdout) => {
            if (error) {
              console.error(`exec error: ${error}`);
              mainWindow?.webContents.send("setPackSearchResults", ["error:", error]);
              return;
            }
            const packNamesUnicodeSearch = stdout
              .split("\n")
              .map((line) => line.split(".pack:")[0])
              .filter((packName) => packName != "");
            console.log("packNames unicode:", packNames, packNamesUnicodeSearch);
            packNamesAll = packNamesAll.concat(packNames);
            packNamesAll = packNamesAll.concat(packNamesUnicodeSearch);
            appendToSearchInsidePacks(mods, modsIndex + 1, packNamesAll, searchTerm);
          },
        );
      },
    );
  };
  ipcMain.on("searchInsidePacks", async (event, searchTerm: string, mods: Mod[]) => {
    const packNamesAll = [] as string[];
    console.log("search inside mods:", searchTerm, "num mods:", mods.length);
    appendToSearchInsidePacks(mods, 0, packNamesAll, searchTerm);
  });
  const readTablesFromMods = async (mods: Mod[], tablesToRead: string[]) => {
    for (const mod of mods) {
      const existingPack = appData.packsData.find((pack) => pack.path == mod.path);
      let needsReRead = false;
      if (existingPack) {
        const lastChangedLocal = (await fsExtra.stat(mod.path)).mtimeMs;
        if (lastChangedLocal != existingPack.lastChangedLocal) {
          needsReRead = true;
          appData.packsData = appData.packsData.filter((pack) => pack.path != mod.path);
        }
      }
      console.log("READING FOR GAME START " + mod.name);
      let newPack: Pack | null = null;
      if (existingPack && !needsReRead) {
        console.log("existingPack.readTables", existingPack.readTables);
        console.log("tablesToRead", tablesToRead);
        if (existingPack.readTables === "all") {
          console.log("don't need to read tables for", existingPack.name, "all tables in pack are parsed");
          continue;
        }
        if (
          tablesToRead.every((tableToRead) =>
            (existingPack.readTables as string[]).some((iterTableName) => iterTableName == tableToRead),
          )
        ) {
          console.log("don't need to read tables for", existingPack.name, tablesToRead, "are parsed");
          continue;
        }
        console.log("reading from existing pack");
        newPack = await readFromExistingPack(existingPack, {
          tablesToRead,
        });
      } else {
        console.log("reading from new pack");
        newPack = await readPack(mod.path, {
          tablesToRead,
        });
      }
      appendPacksData(newPack, mod);
    }
  };
  const getDBsForGameStartOptions = async (mods: Mod[], startGameOptions: StartGameOptions) => {
    const tablesToRead: string[] = [];
    if (startGameOptions.isMakeUnitsGeneralsEnabled) {
      tablesToRead.push("db\\units_custom_battle_permissions_tables\\");
    }
    if (tablesToRead.length == 0) return;
    mainWindow?.webContents.send("addToast", {
      type: "info",
      messages: ["loc:processingMods"],
      startTime: Date.now(),
    } as Toast);
    await readTablesFromMods(mods, tablesToRead);
  };
  ipcMain.handle(
    "executeDBDuplication",
    async (
      event,
      packPath: string,
      nodesNamesToDuplicate: string[],
      nodeNameToRef: Record<string, IViewerTreeNodeWithData>,
      nodeNameToRenameValue: Record<string, string>,
      defaultNodeNameToRenameValue: Record<string, string>,
      treeData: IViewerTreeNodeWithData,
      DBCloneSaveOptions: DBCloneSaveOptions,
    ) => {
      const { executeDBDuplication } = await import("./DBClone");
      const webContentsId = event.sender.id;
      const cancelState = { canceled: false };
      dbDuplicationCancelStateByWebContentsId.set(webContentsId, cancelState);
      try {
        return await executeDBDuplication(
          packPath,
          nodesNamesToDuplicate,
          nodeNameToRef,
          nodeNameToRenameValue,
          defaultNodeNameToRenameValue,
          treeData,
          DBCloneSaveOptions,
          {
            isCanceled: () => cancelState.canceled,
            report: (progress) => event.sender.send("setDBDuplicationProgress", progress),
          },
        );
      } finally {
        dbDuplicationCancelStateByWebContentsId.delete(webContentsId);
      }
    },
  );
  ipcMain.on("cancelDBDuplication", (event) => {
    const cancelState = dbDuplicationCancelStateByWebContentsId.get(event.sender.id);
    if (cancelState) cancelState.canceled = true;
  });
  ipcMain.on(
    "getTableReferences",
    async (event, packPath: string, tableReferenceRequests: TableReferenceRequest[], withPack: boolean) => {
      console.log("ON getTableReferences, with pack:", withPack);
      console.log("to read:", tableReferenceRequests);
      const newPack = await readPack(packPath, {
        tablesToRead: tableReferenceRequests.map(
          (req) => (req.tableName.startsWith("db") && req.tableName) || `db\\${req.tableName}`,
        ),
      });
      // console.log(
      //   "after getting refs1",
      //   newPack.packedFiles.filter((packedFile) => packedFile.schemaFields).map((pf) => pf.name)
      // );
      if (!packDataStore[packPath]) {
        packDataStore[packPath] = newPack;
      } else {
        const existingPack = packDataStore[packPath];
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
        // console.log(
        //   "after getting refs2",
        //   newPack.packedFiles.filter((packedFile) => packedFile.schemaFields).map((pf) => pf.name)
        // );
      }
      packDataStore[packPath].packedFiles
        .filter((pF) => pF.schemaFields)
        .forEach((pF) => {
          const dbVersion = getDBVersion(pF);
          if (!dbVersion) {
            return;
          }
          if (pF.schemaFields) {
            pF.schemaFields = amendSchemaField(pF.schemaFields, dbVersion);
            pF.tableSchema = dbVersion;
          }
        });
      // console.log("packDataStore in INDEX", packDataStore);
      if (withPack)
        windows.viewerWindow?.webContents.send(
          "setPackDataStore",
          packPath,
          packDataStore[packPath],
          tableReferenceRequests,
        );
      else {
        const onlyAskedForPFs = newPack.packedFiles
          .filter((pF) => pF.schemaFields)
          .map((pF) => packDataStore[packPath].packedFiles.find((amendedPF) => amendedPF.name == pF.name))
          .filter((pF) => pF);
        windows.viewerWindow?.webContents.send(
          "appendPackDataStore",
          packPath,
          onlyAskedForPFs,
          tableReferenceRequests,
        );
      }
    },
  );
  ipcMain.handle(
    "buildDBReferenceTree",
    async (
      event,
      packPath: string,
      currentDBTableSelection: DBTableSelection,
      deepCloneTarget: { row: number; col: number },
      existingRefs: DBCell[],
      selectedNodesByName: IViewerTreeNodeWithData[],
      existingTree?: IViewerTreeNodeWithData,
    ) => {
      return buildDBReferenceTree(
        packPath,
        currentDBTableSelection,
        deepCloneTarget,
        existingRefs,
        selectedNodesByName,
        existingTree,
      );
    },
  );
  ipcMain.handle(
    "buildDBIndirectReferences",
    async (event, packPath: string, selectedNode: IViewerTreeNodeWithData, existingRefs: DBCell[]) => {
      const webContentsId = event.sender.id;
      let cacheContext = dbIndirectReferenceCacheByWebContentsId.get(webContentsId);
      if (!cacheContext) {
        cacheContext = createDBIndirectReferenceCacheContext();
        dbIndirectReferenceCacheByWebContentsId.set(webContentsId, cacheContext);
      }
      return buildDBIndirectReferences(packPath, selectedNode, existingRefs, cacheContext);
    },
  );
  ipcMain.handle("getDBNameToDBVersions", async (event) => {
    return DBNameToDBVersions[appData.currentGame];
  });
  ipcMain.handle("getDefaultTableVersions", async (event) => {
    return await getDefaultTableVersions();
  });
  ipcMain.on(
    "startGame",
    async (
      event,
      mods: Mod[],
      areModsPresorted: boolean,
      startGameOptions: StartGameOptions,
      saveName?: string,
    ) => {
      console.log("before start:");
      for (const pack of appData.packsData) {
        console.log(pack.name, pack.readTables);
      }
      try {
        // getSkillsData(mods.filter((mod) => mod.isEnabled));
        // return;
        for (const supportedGameOption of supportedGameOptions) {
          if (!gameToSupportedGameOptions[appData.currentGame].includes(supportedGameOption)) {
            const startGameOption = supportedGameOptionToStartGameOption[supportedGameOption];
            console.log(`setting startGameOption ${startGameOption} to false`);
            startGameOptions[startGameOption] = false;
          }
        }
        const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
        const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
        if (!gamePath) return;
        if (!dataFolder) return;
        const appDataPath = app.getPath("userData");
        const myModsPath = nodePath.join(gamePath, "my_mods.txt");
        const usedModsPath = nodePath.join(gamePath, "used_mods.txt");
        const sortedMods = sortByNameAndLoadOrder(mods.filter((mod) => mod.isEnabled));
        const linuxBit = process.platform === "linux" ? "Z:" : "";
        const vanillaPacks = [];
        for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
          const baseVanillaPackName = vanillaPackData.name;
          const dataMod: Mod = {
            humanName: "",
            name: baseVanillaPackName,
            path: nodePath.join(dataFolder as string, baseVanillaPackName),
            imgPath: "",
            workshopId: "",
            isEnabled: true,
            modDirectory: `${dataFolder}`,
            isInData: true,
            lastChanged: undefined,
            loadOrder: undefined,
            author: "",
            isDeleted: false,
            isMovie: false,
            size: 0,
            isSymbolicLink: false,
            tags: ["mod"],
          };
          vanillaPacks.push(dataMod);
        }
        let extraEnabledMods = "";
        if (
          startGameOptions.isMakeUnitsGeneralsEnabled ||
          startGameOptions.isScriptLoggingEnabled ||
          startGameOptions.isSkipIntroMoviesEnabled ||
          startGameOptions.isAutoStartCustomBattleEnabled
        ) {
          log("making temp dir");
          await fs.mkdirSync(nodePath.join(appDataPath, "tempPacks"), { recursive: true });
          log("getting start game dbs");
          await getDBsForGameStartOptions(sortedMods.concat(vanillaPacks), startGameOptions);
          console.log("before start:");
          for (const pack of appData.packsData) {
            console.log(pack.name, pack.readTables);
          }
          const tempPackName = "!!!!out.pack";
          const tempPackPath = nodePath.join(appDataPath, "tempPacks", tempPackName);
          log("writing start game pack");
          let failedWriting = true;
          for (let i = 0; i < 10; i++) {
            try {
              tryOpenFile(tempPackPath);
              await writeStartGamePack(
                appData.packsData,
                tempPackPath,
                sortedMods.concat(vanillaPacks),
                startGameOptions,
              );
              failedWriting = false;
              break;
            } catch (e) {
              await new Promise((resolve) => setTimeout(resolve, 500));
              if (i == 0) {
                mainWindow?.webContents.send("addToast", {
                  type: "info",
                  messages: ["Game still closing, retrying..."],
                  startTime: Date.now(),
                } as Toast);
              }
              if (i == 9) {
                terminateCurrentGame();
              }
            }
          }
          if (!failedWriting) {
            log("done writing temp pack");
            extraEnabledMods =
              `\nadd_working_directory "${linuxBit + nodePath.join(appDataPath, "tempPacks")}";` +
              `\nmod "${tempPackName}";`;
          } else {
            log("gave up trying to write temp pack");
          }
        }
        const modPathsInsideMergedMods = sortedMods
          .filter((mod) => mod.mergedModsData)
          .map((mod) => (mod.mergedModsData as MergedModsData[]).map((mod) => mod.path))
          .flatMap((paths) => paths);
        let enabledModsWithoutMergedInMods = sortedMods.filter(
          (mod) => !modPathsInsideMergedMods.some((path) => path == mod.path),
        );
        const enabledModsWithOverwrites = enabledModsWithoutMergedInMods.filter(
          (iterMod) => startGameOptions.packDataOverwrites[iterMod.path],
        );
        enabledModsWithoutMergedInMods = enabledModsWithoutMergedInMods.filter(
          (iterMod) => !startGameOptions.packDataOverwrites[iterMod.path],
        );
        console.log("enabledModsWithOverwrites:", enabledModsWithOverwrites);
        if (enabledModsWithOverwrites.length > 0) {
          const overwritesDirPath = nodePath.join(
            appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
            "/whmm_overwrites/",
          );
          if (!fsExtra.existsSync(overwritesDirPath)) {
            exec(`mkdir "${overwritesDirPath}"`);
            await new Promise((resolve) => {
              setTimeout(resolve, 100);
            });
          }
          extraEnabledMods += `\nadd_working_directory "${linuxBit + overwritesDirPath}";`;
          for (const pack of enabledModsWithOverwrites) {
            await createOverwritePack(
              pack.path,
              nodePath.join(overwritesDirPath, pack.name),
              startGameOptions.packDataOverwrites[pack.path],
            );
            extraEnabledMods += `\nmod "${pack.name}";`;
          }
        }
        console.log("userFlowOptions:", startGameOptions.userFlowOptions);
        const whmmFlowsPath = nodePath.join(gamePath as string, "whmm_flows");
        const flowExecutionSignatureHash = await buildFlowExecutionSignature(
          sortedMods,
          startGameOptions,
          dataFolder,
        );
        let shouldExecuteFlows = true;
        let enabledModsWithFlows: Mod[] = [];
        let createdFlowPacks: string[] = [];
        let flowExecutionHadErrors = false;
        if (flowExecutionSignatureHash) {
          const flowCache = await loadFlowExecutionCache();
          const cachedEntry = flowCache.byGame[appData.currentGame];
          if (cachedEntry && cachedEntry.signatureHash === flowExecutionSignatureHash) {
            if (cachedEntry.modsWithFlows.length === 0) {
              shouldExecuteFlows = false;
              console.log("Flow execution cache hit: no flow mods found in previous launch.");
            } else {
              if (!fsExtra.existsSync(whmmFlowsPath)) {
                fsExtra.mkdirSync(whmmFlowsPath, { recursive: true });
              }
              const cachedFlowPackPaths = cachedEntry.createdFlowPackFileNames.map((packFileName) =>
                nodePath.join(whmmFlowsPath, packFileName),
              );
              const missingCachedFlowPacks = cachedFlowPackPaths.filter(
                (flowPackPath) => !fsExtra.existsSync(flowPackPath),
              );
              if (missingCachedFlowPacks.length === 0) {
                shouldExecuteFlows = false;
                createdFlowPacks = cachedFlowPackPaths;
                enabledModsWithFlows = sortedMods.filter((mod) =>
                  cachedEntry.modsWithFlows.some((cachedMod) => cachedMod.path === mod.path),
                );
                mainWindow?.webContents.send("addToast", {
                  type: "info",
                  messages: ["Using cached flow output..."],
                  startTime: Date.now(),
                } as Toast);
                console.log(
                  `Flow execution cache hit: reusing ${createdFlowPacks.length} cached flow pack(s).`,
                  createdFlowPacks,
                );
              } else {
                console.log(
                  `Flow execution cache miss: ${missingCachedFlowPacks.length} cached flow pack(s) missing.`,
                );
              }
            }
          } else {
            console.log("Flow execution cache miss: signature changed or no prior cache entry.");
          }
        } else {
          console.log(
            "Flow execution cache unavailable: failed to build signature, executing flows normally.",
          );
        }
        if (shouldExecuteFlows) {
          for (const packPath of sortedMods.map((mod) => mod.path)) {
            const pack = appData.packsData.find((packData) => packData.path == packPath);
            if (!pack || (pack && pack.packedFiles.length == 0)) {
              await readModsByPath([packPath], { readFlows: true, skipParsingTables: true });
            }
          }
          for (const packPath of Object.keys(startGameOptions.userFlowOptions)) {
            const mod = sortedMods.find((mod) => mod.path === packPath || mod.name == packPath);
            if (mod) {
              console.log("FOUND MOD TO READ FOR FLOWS:", mod.name);
              const pack = appData.packsData.find((packData) => packData.path == mod.path);
              if (!pack || (pack && pack.packedFiles.length == 0)) {
                console.log("need to read pack for flows:", mod.name);
                await readModsByPath([mod.path], { readFlows: true, skipParsingTables: true });
              }
            }
          }
          // Execute flows for enabled mods
          enabledModsWithFlows = sortedMods.filter((iterMod) => {
            const pack = appData.packsData.find((packData) => packData.path == iterMod.path);
            return pack && pack.packedFiles.some((file) => file.name.startsWith("whmmflows\\"));
          });
          if (enabledModsWithFlows.length > 0) {
            console.log(`Found ${enabledModsWithFlows.length} mods with flows to execute`);
            // Clear whmm_flows directory
            try {
              if (fsExtra.existsSync(whmmFlowsPath)) {
                console.log(`Clearing files in whmm_flows directory: ${whmmFlowsPath}`);
                const entries = fsExtra.readdirSync(whmmFlowsPath);
                for (const entry of entries) {
                  fsExtra.removeSync(nodePath.join(whmmFlowsPath, entry));
                }
                console.log("Successfully cleared whmm_flows contents");
              }
            } catch (error) {
              console.log(
                `Error clearing whmm_flows: ${error instanceof Error ? error.message : "Unknown error"}`,
              );
            }
            // Create whmm_flows directory
            if (!fsExtra.existsSync(whmmFlowsPath)) {
              fsExtra.mkdirSync(whmmFlowsPath, { recursive: true });
            }
            // Get the overwrite directory path if it exists
            const mergedDirPath = nodePath.join(
              appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
              "/whmm_overwrites/",
            );
            mainWindow?.webContents.send("addToast", {
              type: "info",
              messages: ["Processing flows..."],
              startTime: Date.now(),
            } as Toast);
            // Reset counter tracking once at the start of game launch
            // This ensures counters are maintained across all flows in all packs
            const { resetCounterTracking } = await import("./nodeExecutor");
            resetCounterTracking();
            console.log(
              "Reset counter tracking for game launch - counters will be maintained across all flows",
            );
            for (const pack of enabledModsWithFlows) {
              // Check if this pack has overwrites - if so, use the overwritten pack
              const hasOverwrites = enabledModsWithOverwrites.some(
                (overwritePack) => overwritePack.path === pack.path,
              );
              const packPathToUse = hasOverwrites ? nodePath.join(mergedDirPath, pack.name) : pack.path;
              const sourcePackForFlowExecution = hasOverwrites
                ? undefined
                : appData.packsData.find((packData) => packData.path === pack.path);
              console.log(
                `Executing flows for pack: ${pack.name} (using ${hasOverwrites ? "overwritten" : "original"} pack)`,
              );
              const { createdPackPaths, hadErrors } = await executeFlowsForPack(
                packPathToUse,
                "", // No target path needed
                startGameOptions.userFlowOptions,
                pack.name,
                sourcePackForFlowExecution,
              );
              createdFlowPacks.push(...createdPackPaths);
              flowExecutionHadErrors = flowExecutionHadErrors || hadErrors;
            }
            console.log(`Created ${createdFlowPacks.length} pack(s) from flows:`, createdFlowPacks);
          }
          if (flowExecutionSignatureHash) {
            const flowCache = await loadFlowExecutionCache();
            if (enabledModsWithFlows.length === 0) {
              flowCache.byGame[appData.currentGame] = {
                signatureHash: flowExecutionSignatureHash,
                createdAt: Date.now(),
                modsWithFlows: [],
                createdFlowPackFileNames: [],
              };
              await saveFlowExecutionCache();
            } else if (!flowExecutionHadErrors) {
              flowCache.byGame[appData.currentGame] = {
                signatureHash: flowExecutionSignatureHash,
                createdAt: Date.now(),
                modsWithFlows: enabledModsWithFlows.map((mod) => ({ path: mod.path, name: mod.name })),
                createdFlowPackFileNames: [
                  ...new Set(createdFlowPacks.map((path) => nodePath.basename(path))),
                ],
              };
              await saveFlowExecutionCache();
            } else {
              console.log("Skipping flow execution cache update because at least one flow failed.");
            }
          }
        }
        // Add flow packs to the mod list
        if (createdFlowPacks.length > 0) {
          extraEnabledMods += `\nadd_working_directory "${linuxBit + whmmFlowsPath}";`;
          for (const flowPackPath of createdFlowPacks) {
            const packFileName = nodePath.basename(flowPackPath);
            extraEnabledMods += `\nmod "${packFileName}";`;
            console.log(`Added flow pack to mod list: ${packFileName}`);
          }
        }
        const text =
          enabledModsWithoutMergedInMods
            .filter((mod) => !mod.isInModding)
            .filter(
              (mod) =>
                nodePath.relative(
                  appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string,
                  mod.modDirectory,
                ) != "",
            )
            .map((mod) => `add_working_directory "${linuxBit + mod.modDirectory}";`)
            .concat(enabledModsWithoutMergedInMods.map((mod) => `mod "${mod.name}";`))
            .join("\n") + extraEnabledMods;
        try {
          enabledModsWithoutMergedInMods
            .filter((mod) => mod.isInModding)
            .forEach((mod) => {
              const newPath = nodePath.join(dataFolder, mod.name);
              const stats = fs.statSync(mod.path);
              if (fs.existsSync(newPath)) {
                const statsCurrent = fs.statSync(newPath);
                // console.log("new times:", stats.atime, stats.mtime);
                // console.log("current times:", statsCurrent.atime, statsCurrent.mtime);
                if (statsCurrent.mtime > stats.mtime) {
                  mainWindow?.webContents.send("addToast", {
                    type: "warning",
                    messages: [`Mod ${mod.name} in modding is older than the one in data!`],
                    startTime: Date.now(),
                  } as Toast);
                  throw new Error(
                    `Mod ${mod.path} is older than the one in data, user needs to resolve this!`,
                  );
                }
              }
              fs.copyFileSync(mod.path, newPath);
              fs.utimesSync(newPath, stats.atime, stats.mtime);
            });
        } catch (e) {
          console.error(e);
          return;
        }
        let fileNameWithModList = "used_mods.txt";
        try {
          const encoding = appData.currentGame == "shogun2" ? "utf16le" : "utf8";
          log("writing used_mods.txt");
          await fs.writeFileSync(usedModsPath, text, { encoding });
        } catch (e) {
          log("failed writing to used_mods.txt, trying to use my_mods.txt");
          fileNameWithModList = "my_mods.txt";
          await fs.writeFileSync(myModsPath, text);
        }
        let batData = `start /d "${appData.gamesToGameFolderPaths[appData.currentGame].gamePath}" ${
          gameToProcessName[appData.currentGame]
        }`;
        if (process.platform === "linux") {
          if (!appData.gamesToGameFolderPaths[appData.currentGame].gamePath) {
            // should throw an error here?
            console.error("Game path is undefined for current game");
            return;
          }
          const gamePath = join(
            appData.gamesToGameFolderPaths[appData.currentGame].gamePath!,
            gameToProcessName[appData.currentGame],
          );
          batData = `protontricks-launch --cwd-app --appid ${gameToSteamId[appData.currentGame]} "${gamePath}"`;
        }
        console.log("batData so far:", batData);
        if (saveName) {
          batData += ` game_startup_mode campaign_load "${saveName}" ;`;
        }
        // file with the list of mods for the game to use, used_mods.txt or my_mods.txt
        batData += ` ${fileNameWithModList};`;
        // Create steam_appid.txt for Attila
        if (
          appData.currentGame === "attila" ||
          appData.currentGame === "rome2" ||
          appData.currentGame == "shogun2"
        ) {
          const steamAppIdPath = nodePath.join(
            appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
            "steam_appid.txt",
          );
          const steamId = gameToSteamId[appData.currentGame];
          try {
            fs.writeFileSync(steamAppIdPath, steamId);
          } catch (e) {
            console.error("Failed to create steam_appid.txt:", e);
          }
        }
        mainWindow?.webContents.send("handleLog", "starting game:");
        mainWindow?.webContents.send("handleLog", batData);
        exec(batData, (error) => {
          console.error(error);
        });
        appData.compatData = {
          packTableCollisions: [],
          packFileCollisions: [],
          missingTableReferences: {},
          uniqueIdsCollisions: {},
          scriptListenerCollisions: {},
          packFileAnalysisErrors: {},
          missingFileRefs: {},
        };
        appData.packsData = [];
        appData.queuedSkillsData = undefined;
        if (startGameOptions.isClosedOnPlay) {
          await new Promise((resolve) => {
            setTimeout(resolve, 5000);
          });
          app.exit();
        }
      } catch (e) {
        console.log(e);
      }
    },
  );
  ipcMain.handle("selectDirectory", async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow || new BrowserWindow(), {
        properties: ["openDirectory"],
      });
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return undefined;
    } catch (error) {
      console.error("Error selecting directory:", error);
      return undefined;
    }
  });
  ipcMain.handle(
    "writeTextFilesToDirectory",
    async (
      event,
      baseDirectory: string,
      files: { relativePath: string; content: string }[],
    ): Promise<{ success: boolean; writtenFiles?: string[]; error?: string }> => {
      try {
        if (!baseDirectory) {
          return { success: false, error: "No output directory selected" };
        }
        if (!Array.isArray(files) || files.length === 0) {
          return { success: false, error: "No files to write" };
        }
        const resolvedBaseDirectory = nodePath.resolve(baseDirectory);
        const writtenFiles: string[] = [];
        for (const file of files) {
          const normalizedRelativePath = file.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
          if (normalizedRelativePath.includes("..")) {
            return { success: false, error: `Invalid relative path: ${file.relativePath}` };
          }
          const outputPath = nodePath.resolve(resolvedBaseDirectory, normalizedRelativePath);
          const baseWithSep = resolvedBaseDirectory.endsWith(nodePath.sep)
            ? resolvedBaseDirectory
            : `${resolvedBaseDirectory}${nodePath.sep}`;
          if (outputPath !== resolvedBaseDirectory && !outputPath.startsWith(baseWithSep)) {
            return { success: false, error: `Invalid output path: ${file.relativePath}` };
          }
          await fsExtra.ensureDir(nodePath.dirname(outputPath));
          await fs.promises.writeFile(outputPath, file.content, "utf8");
          writtenFiles.push(outputPath);
        }
        return { success: true, writtenFiles };
      } catch (error) {
        console.error("Error writing text files to directory:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to write files",
        };
      }
    },
  );
  ipcMain.handle("createNewPack", async (event, packName: string, packDirectory: string) => {
    try {
      console.log("createNewPack:", packName, packDirectory);
      const savePath = nodePath.join(packDirectory, `${packName}.pack`);
      // Check if file already exists
      if (fsExtra.existsSync(savePath)) {
        return {
          success: false,
          error: `Pack file already exists at: ${savePath}`,
        };
      }
      // Create an empty pack file
      const { writePack } = await import("./packFileSerializer");
      await writePack([], savePath);
      console.log(`Pack created at: ${savePath}`);
      return { success: true, packPath: savePath };
    } catch (error) {
      console.error("Error creating pack:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create pack",
      };
    }
  });
  ipcMain.on("syncIsFeaturesForModdersEnabled", (event, isFeaturesForModdersEnabled: boolean) => {
    console.log("syncIsFeaturesForModdersEnabled:", isFeaturesForModdersEnabled);
    appData.isFeaturesForModdersEnabled = isFeaturesForModdersEnabled;
    // Send to viewer window
    windows.viewerWindow?.webContents.send("setIsFeaturesForModdersEnabled", isFeaturesForModdersEnabled);
    windows.skillsWindow?.webContents.send("setIsFeaturesForModdersEnabled", isFeaturesForModdersEnabled);
  });
  ipcMain.on("syncModdersPrefix", (event, moddersPrefix: string) => {
    appData.moddersPrefix = moddersPrefix;
    windows.viewerWindow?.webContents.send("setModdersPrefix", moddersPrefix);
    windows.skillsWindow?.webContents.send("setModdersPrefix", moddersPrefix);
  });
};
