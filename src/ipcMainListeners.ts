import assert from "assert";
import bs from "binary-search";
import * as cheerio from "cheerio";
import { exec, fork } from "child_process";
import chokidar from "chokidar";
import { format } from "date-fns";
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import windowStateKeeper from "electron-window-state";
import * as fs from "fs";
import * as fsExtra from "fs-extra";
import debounce from "just-debounce-it";
import fetch from "node-fetch";
import * as nodePath from "path";
import { version } from "react";
import { readAppConfig, setStartingAppState, writeAppConfig } from "./appConfigFunctions";
import appData, { GameFolderPaths } from "./appData";
import { packDataStore } from "./components/viewer/packDataStore";
import i18n from "./configs/i18next.config";
import { buildDBReferenceTree } from "./DBClone";
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
  writeStartGamePack,
  writePack,
} from "./packFileSerializer";
import { AmendedSchemaField, Pack, PackCollisions, PackedFile } from "./packFileTypes";
import { resolveTable } from "./resolveTable";
import {
  DBNameToDBVersions,
  gameToDBFieldsThatReference,
  gameToReferences,
  initializeAllSchemaForGame,
} from "./schema";
import {
  appendLocalizationsToSkills,
  getNodeRequirements,
  getNodesToParents,
  getSkills,
  NodeLinks,
  NodeSkill,
  SkillAndIcons,
} from "./skills";
import {
  gameToGameName,
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

declare const VIEWER_WEBPACK_ENTRY: string;
declare const VIEWER_PRELOAD_WEBPACK_ENTRY: string;

declare const SKILLS_WEBPACK_ENTRY: string;
declare const SKILLS_PRELOAD_WEBPACK_ENTRY: string;

let contentWatcher: chokidar.FSWatcher | undefined;
let dataWatcher: chokidar.FSWatcher | undefined;
let downloadsWatcher: chokidar.FSWatcher | undefined;
let mergedWatcher: chokidar.FSWatcher | undefined;

export const windows = {
  mainWindow: undefined as BrowserWindow | undefined,
  viewerWindow: undefined as BrowserWindow | undefined,
  skillsWindow: undefined as BrowserWindow | undefined,
};

const appendCollisions = async (newPack: Pack) => {
  while (!appData.compatData) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (appData.compatData) {
    appData.compatData.packTableCollisions = appendPackTableCollisions(
      appData.packsData,
      appData.compatData.packTableCollisions,
      newPack
    );
    appData.compatData.packFileCollisions = appendPackFileCollisions(
      appData.packsData,
      appData.compatData.packFileCollisions,
      newPack
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
        (packedFileName) => packedFileName.match(matchVanillaDBFiles) || packedFileName.endsWith(".lua")
      )
      .filter((packedFileName) => {
        let foundMatchingFile = false;
        for (const vanillaPack of appData.vanillaPacks) {
          foundMatchingFile ||= vanillaPack.packedFiles.some(
            (packedFileInData) => packedFileInData.name == packedFileName
          );
        }
        return foundMatchingFile;
      });
    if (overwrittenFileNames.length > 0) {
      appData.overwrittenDataPackedFiles[newPack.name] = overwrittenFileNames;
      windows.mainWindow?.webContents.send(
        "setOverwrittenDataPackedFiles",
        appData.overwrittenDataPackedFiles
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
          (existingPackedFile) => existingPackedFile.name == newPackedFile.name
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

export const readModsByPath = async (
  modPaths: string[],
  packReadingOptions: PackReadingOptions,
  skipCollisionCheck = true
) => {
  const { skipParsingTables, tablesToRead, readLocs, readScripts, filesToRead } = packReadingOptions;

  console.log("readModsByPath:", modPaths);
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
    const newPack = await readPack(modPath, {
      skipParsingTables,
      readScripts,
      tablesToRead,
      filesToRead,
      readLocs,
    });
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
  isDev: boolean
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
      mods.map((mod) => mod.name)
    );
    const tablesToRead = resolveTable("character_skill_node_set_items_tables").map(
      (table) => `db\\${table}\\`
    );

    const effectTablesToRead = resolveTable("character_skill_level_to_effects_junctions_tables").map(
      (table) => `db\\${table}\\`
    );
    for (const effectTable of effectTablesToRead) {
      if (!tablesToRead.includes(effectTable)) tablesToRead.push(effectTable);
    }

    const nodeLinksTablesToRead = resolveTable("character_skill_node_links_tables").map(
      (table) => `db\\${table}\\`
    );
    for (const nodeLinksTable of nodeLinksTablesToRead) {
      if (!tablesToRead.includes(nodeLinksTable)) tablesToRead.push(nodeLinksTable);
    }

    const skillLocksTablesToRead = resolveTable("character_skill_nodes_skill_locks_tables").map(
      (table) => `db\\${table}\\`
    );
    for (const skillLocksTable of skillLocksTablesToRead) {
      if (!tablesToRead.includes(skillLocksTable)) tablesToRead.push(skillLocksTable);
    }

    const effectBonusValueIdsUnitSetsTablesToRead = resolveTable(
      "effect_bonus_value_ids_unit_sets_tables"
    ).map((table) => `db\\${table}\\`);
    for (const effectBonusValueIdsUnitSetsTable of effectBonusValueIdsUnitSetsTablesToRead) {
      if (!tablesToRead.includes(effectBonusValueIdsUnitSetsTable))
        tablesToRead.push(effectBonusValueIdsUnitSetsTable);
    }

    // const effectsTablesToRead = resolveTable("effects_tables").map((table) => `db\\${table}\\`);
    // for (const effectsTable of effectsTablesToRead) {
    //   if (!tablesToRead.includes(effectsTable)) tablesToRead.push(effectsTable);
    // }

    console.log("RESOLVED tablesToRead:", tablesToRead);
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataFolder) return;

    await readMods(mods, false, true, false, true, tablesToRead);

    const vanillaPacksToRead = appData.allVanillaPackNames
      .filter(
        (packName) =>
          packName.startsWith("local_en") ||
          (!packName.startsWith("audio_") &&
            !packName.startsWith("local_") &&
            !packName.startsWith("tile") &&
            !packName.startsWith("warmachines") &&
            !packName.startsWith("terrain"))
      )
      .map((packName) => nodePath.join(dataFolder, packName));
    await readModsByPath(
      vanillaPacksToRead,
      { skipParsingTables: false, readLocs: true, tablesToRead },
      true
    );

    const unsortedPacksTableData = getPacksTableData(
      appData.packsData.filter(
        (pack) => pack.name == "db.pack" || mods.some((mod) => mod.path === pack.path)
      ),
      tablesToRead,
      true
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

    const subtypeAndSets: { key: string; agentSubtype: string }[] = [];
    getTableRowData(packsTableData, "character_skill_node_sets_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const agentSubtype = schemaFieldRow.find((sF) => sF.name == "agent_subtype_key")?.resolvedKeyValue;
      if (key && agentSubtype) {
        const newSubtypeAndSets = {
          key,
          agentSubtype,
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
        (sF) => sF.name == "parent_link_position"
      )?.resolvedKeyValue;
      const child_link_position = schemaFieldRow.find(
        (sF) => sF.name == "child_link_position"
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
        (sF) => sF.name == "required_num_parents"
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
            (iterSkillLevel) => iterSkillLevel[0] == skill && iterSkillLevel[1] == levelAsNumber
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

    const skillIconPathsSet = new Set(
      skills
        .map((skill) => `ui\\campaign ui\\skills\\${skill.iconPath}`)
        // wh_main_character_abilities_heroic_killing_blow was removed from campaign ui for example
        .concat(skills.map((skill) => `ui\\battle ui\\ability_icons\\${skill.iconPath}`))
    );

    const effectIcons = new Set<string>();
    for (const skill of skills) {
      const effectsInSkill = skillsToEffects[skill.key] || [];
      for (const effect of effectsInSkill) {
        if (effect.icon) {
          effectIcons.add(`ui\\campaign ui\\effect_bundles\\${effect.icon}`);
        }
      }
    }

    const skillIconPaths = Array.from(new Set([...skillIconPathsSet, ...effectIcons]));

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
      mods.map((mod) => mod.name).includes(packsData.name)
    );
    // for (const pack of enabledModPacks)
    //   await readFromExistingPack(pack, { filesToRead: skillIconPaths, skipParsingTables: true });

    console.log("vanillaPacksToRead", vanillaPacksToRead);
    console.log(
      "vanillaPacksToRead ARE:",
      appData.packsData
        .filter((packsData) => vanillaPacksToRead.includes(packsData.path))
        .map((pack) => pack.path)
    );
    const vanillaPacks = appData.packsData.filter((packsData) => vanillaPacksToRead.includes(packsData.path));
    for (const pack of vanillaPacks.concat(enabledModPacks))
      await readFromExistingPack(pack, { filesToRead: skillIconPaths, skipParsingTables: true });

    const icons: Record<string, string> = {};
    for (const pack of vanillaPacks.concat(enabledModPacks)) {
      for (const fileToRead of skillIconPaths) {
        const indexOfFileToRead = bs(pack.packedFiles, fileToRead, (a: PackedFile, b: string) =>
          collator.compare(a.name, b)
        );
        if (indexOfFileToRead >= 0) {
          const packedFileToRead = pack.packedFiles[indexOfFileToRead];
          if (packedFileToRead.buffer) {
            // fs.writeFileSync(`dumps/img/${nodePath.basename(fileToRead)}`, packedFileToRead.buffer);
            icons[fileToRead] = packedFileToRead.buffer.toString("base64");
          }
        }
      }
    }

    const locs: Record<string, Trie<string>> = {};
    for (const pack of appData.packsData.filter(
      (packsData) => mods.map((mod) => mod.name).includes(packsData.name) || vanillaPacks.includes(packsData)
    )) {
      const locsTrie = getLocsTrie(pack);
      if (locsTrie) locs[pack.name] = locsTrie;
    }

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
    appData.skillsData = {
      subtypesToSet,
      setToNodes,
      nodeLinks,
      nodeToSkill,
      skillsToEffects,
      nodeToSkillLocks,
      skills,
      locs,
      icons,
      effectsToEffectData,
    };
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

    const subtypes = Object.keys(subtypesToSet);
    const subtypeToNumSets = subtypes.reduce((acc, curr) => {
      acc[curr] = subtypesToSet[curr].length;
      return acc;
    }, {} as Record<string, number>);

    const nodeRequirements = getNodeRequirements(nodeLinks, nodeToSkill);

    appData.queuedSkillsData = {
      // subtypeToSkills: { wh_main_emp_karl_franz: kfSkills },
      currentSubtype: "wh_main_emp_karl_franz",
      currentSubtypeIndex: 0,
      subtypeToNumSets,
      currentSkills: kfSkills,
      nodeLinks,
      nodeRequirements,
      icons,
      subtypes,
      nodeToSkillLocks,
      subtypesToLocalizedNames: subtypes.reduce((acc, curr) => {
        const localized = getLoc(`agent_subtypes_onscreen_name_override_${curr}`);
        if (localized) acc[curr] = localized;
        return acc;
      }, {} as Record<string, string>),
    };

    if (appData.queuedSkillsData) {
      sendQueuedDataToSkills();
    }
  };

  const getSkillsForSubtype = (subtype: string, subtypeIndex: number) => {
    console.log("getSkillsForSubtype:", subtype);
    const cachedSkillsData = appData.skillsData;
    if (!cachedSkillsData) {
      getSkillsData(appData.enabledMods);
      return;
    }

    const setKF = cachedSkillsData.subtypesToSet[subtype];
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

    const subtypes = Object.keys(subtypesToSet);
    const subtypeToNumSets = subtypes.reduce((acc, curr) => {
      acc[curr] = subtypesToSet[curr].length;
      return acc;
    }, {} as Record<string, number>);

    const nodeRequirements = getNodeRequirements(nodeLinks, nodeToSkill);

    appData.queuedSkillsData = {
      // subtypeToSkills: { [subtype]: kfSkills },
      currentSubtype: subtype,
      currentSubtypeIndex: subtypeIndex,
      currentSkills: kfSkills,
      subtypeToNumSets,
      nodeLinks,
      nodeRequirements,
      nodeToSkillLocks,
      icons,
      subtypes,
      subtypesToLocalizedNames: subtypes.reduce((acc, curr) => {
        const localized = getLoc(`agent_subtypes_onscreen_name_override_${curr}`);
        if (localized) acc[curr] = localized;
        return acc;
      }, {} as Record<string, string>),
    };

    if (appData.queuedSkillsData) {
      sendQueuedDataToSkills();
    }
  };

  const getTableRowData = (
    packsTableData: PackViewData[],
    tableName: string,
    rowDataExtractor: (schemaFieldRow: AmendedSchemaField[]) => void
  ) => {
    packsTableData.forEach((pTD) => {
      const skillNodeSetsFiles = Object.keys(pTD.packedFiles).filter((pFName) =>
        pFName.startsWith(`db\\${tableName}\\`)
      );
      for (const skillNodeSetFile of skillNodeSetsFiles) {
        const packedFile = pTD.packedFiles[skillNodeSetFile];
        const dbVersion = getDBVersion(packedFile);
        if (!dbVersion) continue;
        const schemaFields = packedFile.schemaFields as AmendedSchemaField[];
        const chunkedShemaFields = chunkSchemaIntoRows(schemaFields, dbVersion) as AmendedSchemaField[][];
        for (const schemaFieldRow of chunkedShemaFields) {
          rowDataExtractor(schemaFieldRow);
        }
      }
    });
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
        `https://raw.githubusercontent.com/Shazbot/WH3-Mod-Manager/tw_updates/tw_updates/wh3.json`
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
        nodePath.basename(packPath)
      );
      appData.compatData.packFileCollisions = removeFromPackFileCollisions(
        appData.compatData.packFileCollisions,
        nodePath.basename(packPath)
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
          (iterMod) => iterMod.name != mod.name
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
        {}
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
      console.log("before subcription filter:", mods.length);
      // for (const mod of mods) {
      //   if (!mod.isInData && !appData.subscribedModIds.includes(mod.workshopId)) console.log(mod.workshopId);
      // }
      if (appData.subscribedModIds.length != 0) {
        mods = mods.filter((mod) => mod.isInData || appData.subscribedModIds.includes(mod.workshopId));
      }
      console.log("after subcription filter:", mods.length);
      mainWindow?.webContents.send("modsPopulated", mods);

      mods.forEach(async (mod) => {
        try {
          if (mod == null || mod.path == null) {
            console.error("MOD OR MOD PATH IS NULL");
          }
          const packHeaderData = await readPackHeader(mod.path);
          if (packHeaderData.isMovie || packHeaderData.dependencyPacks.length > 0)
            mainWindow?.webContents.send("setPackHeaderData", packHeaderData);
        } catch (e) {
          if (e instanceof Error) {
            log(e.message);
          }
        }
      });

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
            console.log("READING DATA PACK");
            appData.currentlyReadingModPaths.push(dataPackPath);
            const dataPackData = await readPack(dataMod.path, {
              // tablesToRead: ["db\\units_custom_battle_permissions_tables\\"],
              skipParsingTables: true,
            });
            appData.currentlyReadingModPaths = appData.currentlyReadingModPaths.filter(
              (path) => path != dataPackPath
            );
            if (dataPackData) {
              appData.vanillaPacks.push(dataPackData);

              const vanillaDBFileNames = dataPackData.packedFiles
                .map((vanillaDBFileName) => vanillaDBFileName.name.match(matchTableNamePart))
                .filter((matchResult) => matchResult)
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                .map((matchResult) => matchResult![1]);

              if (vanillaDBFileNames.length > 0) {
                appData.vanillaPacksDBFileNames = Array.from(
                  new Set([...appData.vanillaPacksDBFileNames, ...vanillaDBFileNames]).values()
                );
              }
            }
            if (appData.packsData.every((iterPack) => iterPack.path != dataPackData.path)) {
              appendPacksData(dataPackData);
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
                (mod) => !mod.isInData && !isNaN(Number(mod.workshopId)) && !isNaN(parseFloat(mod.workshopId))
              )
              .map((mod) => mod.workshopId)
              .join(";"),
          ],
          {}
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
              "/data/"
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

      return appState;
    } finally {
      appData.hasReadConfig = true;
    }
  };

  ipcMain.on("getAllModData", (event, ids: string[]) => {
    if (isDev) return;

    fetchModData(
      ids.filter((id) => id !== ""),
      (modData) => {
        tempModDatas.push(modData);
        sendModData();
      },
      (msg) => {
        mainWindow?.webContents.send("handleLog", msg);
        console.log(msg);
      }
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
            currentPack.packedFiles.some((packedFile) => packedFile.name.startsWith(tableForMatching))
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
    }
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
      pathFilter?: string
    ) => {
      try {
        const { renamePackedFilesWithOptions } = await import("./packFileSerializer");
        await renamePackedFilesWithOptions(packPath, searchRegex, replaceText, useRegex, isDev, pathFilter);
      } catch (error) {
        console.error("Failed to rename packed files:", error);
        throw error;
      }
    }
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
      }
    ): Promise<{ success: boolean; data?: any; error?: string }> => {
      try {
        console.log(
          `Executing node ${nodeExecutionRequest.nodeId} (${nodeExecutionRequest.nodeType}) in backend`
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
    }
  );

  ipcMain.handle(
    "executeNodeGraph",
    async (
      event,
      graphExecutionRequest: {
        nodes: Array<{
          id: string;
          type: FlowNodeType;
          data: {
            label: string;
            type: string;
            textValue?: string;
            outputType?: string;
            inputType?: string;
          };
        }>;
        connections: Array<{
          id: string;
          sourceId: string;
          targetId: string;
          sourceType?: string;
          targetType?: string;
        }>;
      }
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
          `Executing node graph with ${graphExecutionRequest.nodes.length} nodes and ${graphExecutionRequest.connections.length} connections`
        );

        console.log("graphExecutionRequest:", graphExecutionRequest);

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
    }
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

      // Generate new pack path
      const packDir = nodePath.dirname(packPath);
      const packName = nodePath.basename(packPath, ".pack");
      const savePath = nodePath.join(packDir, `${packName}_modified.pack`);

      // Write the pack with unsaved files appended/overwritten (as done in DBClone.ts)
      await writePack(sortedFilesToSave, savePath, pack, true);

      console.log(`Pack saved to: ${savePath}`);

      // Clear unsaved files for this pack
      delete appData.unsavedPacksData[packPath];
      windows.viewerWindow?.webContents.send("setUnsavedPacksData", packPath, []);

      return { success: true, savedPath: savePath };
    } catch (error) {
      console.error("Error saving pack with unsaved files:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save pack",
      };
    }
  });

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

      getAllMods();
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
      appData.gameToCurrentPreset[appData.currentGame]?.mods.length
    );

    // for testing, automatically opens db.pack
    if (appData.startArgs.includes("-testDBClone")) {
      if (appData.gamesToGameFolderPaths[appData.currentGame].dataFolder)
        ipcMain.emit(
          "requestOpenModInViewer",
          null,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          nodePath.join(appData.gamesToGameFolderPaths[appData.currentGame].dataFolder!, "db.pack")
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
          gameToSteamId[game]
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
    }
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
    }
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

    await readMods(mods, false, true, true);
    await readModsByPath(
      appData.allVanillaPackNames
        .filter(
          (packName) =>
            packName.startsWith("local_en") ||
            (!packName.startsWith("audio_") && !packName.startsWith("local_"))
        )
        .map((packName) => nodePath.join(dataFolder, packName)),
      { readScripts: appData.isCompatCheckingVanillaPacks },
      true
    );

    mainWindow?.webContents.send(
      "setPackCollisions",
      getCompatData(appData.packsData, (currentIndex, maxIndex, firstPackName, secondPackName, type) => {
        mainWindow?.webContents.send("setPackCollisionsCheckProgress", {
          currentIndex,
          maxIndex,
          firstPackName,
          secondPackName,
          type,
        } as PackCollisionsCheckProgressData);
      })
    );
    emptyAllCompatDataCollections();
  });

  ipcMain.on("copyToData", async (event, modPathsToCopy?: string[]) => {
    if (!appData.gamesToGameFolderPaths[appData.currentGame].gamePath) return;
    console.log("copyToData: modPathsToCopy:", modPathsToCopy);
    const mods = await getMods(log);
    let withoutDataMods = mods.filter((mod) => !mod.isInData);
    if (modPathsToCopy) {
      withoutDataMods = withoutDataMods.filter((mod) =>
        modPathsToCopy.some((modPathToCopy) => modPathToCopy == mod.path)
      );
    }
    const copyPromises = withoutDataMods.map((mod) => {
      mainWindow?.webContents.send(
        "handleLog",
        `COPYING ${mod.path} to ${appData.gamesToGameFolderPaths[appData.currentGame].gamePath}\\data\\${
          mod.name
        }`
      );

      if (!appData.gamesToGameFolderPaths[appData.currentGame].gamePath) throw new Error("game path not set");
      return fs.copyFileSync(
        mod.path,
        nodePath.join(
          appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
          "/data/",
          mod.name
        )
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
        modPathsToCopy.some((modPathToCopy) => modPathToCopy == mod.path)
      );
    }

    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
    if (!gamePath) return;
    const pathsOfNewSymLinks = withoutDataMods.map((mod) =>
      nodePath.join(gamePath ?? "", "/data/", mod.name)
    );
    const copyPromises = withoutDataMods.map((mod) => {
      mainWindow?.webContents.send(
        "handleLog",
        `CREATING SYMLINK of ${mod.path} to ${gamePath}\\data\\${mod.name}`
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
        mods.find((modSecond) => !modSecond.isInData && !modSecond.isInData && modSecond.name === mod.name)
    );

    const deletePromises = modsInBothPlaces.map((mod) => {
      mainWindow?.webContents.send("handleLog", `DELETING ${mod.path}`);

      return fs.unlinkSync(mod.path);
    });

    await Promise.allSettled(deletePromises);
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
      (iterMod) => iterMod.isEnabled || data.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
    );
    appData.enabledMods = enabledMods;
    appData.allMods = data.allMods;
    appData.isCompatCheckingVanillaPacks = data.isCompatCheckingVanillaPacks;
    appData.isChangingGameProcessPriority = data.isChangingGameProcessPriority;
    const hiddenAndEnabledMods = data.hiddenMods.filter((iterMod) =>
      enabledMods.find((mod) => mod.name === iterMod.name)
    );
    mainWindow?.setTitle(
      `WH3 Mod Manager v${version}: ${enabledMods.length} mods enabled` +
        (hiddenAndEnabledMods.length > 0 ? ` (${hiddenAndEnabledMods.length} of those hidden)` : "") +
        ` for ${gameToGameName[appData.currentGame]}`
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

  ipcMain.on("getPackData", async (event, packPath: string, table?: DBTable) => {
    getPackData(packPath, table);
  });

  ipcMain.on("getPackDataWithLocs", async (event, packPath: string, table?: DBTable) => {
    getPackData(packPath, table, true);
  });

  const createViewerWindow = () => {
    if (windows.viewerWindow) return;

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

    viewerWindowState.manage(windows.viewerWindow);

    windows.viewerWindow.loadURL(VIEWER_WEBPACK_ENTRY);

    windows.viewerWindow.on("page-title-updated", (evt) => {
      evt.preventDefault();
    });

    windows.viewerWindow.on("closed", () => {
      windows.viewerWindow = undefined;
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
          baseVanillaPackName
        );
      }
    }
    console.log("ON requestOpenModInViewer", modPath);
    windows.viewerWindow?.webContents.send("openModInViewer", modPath);
    windows.viewerWindow?.setTitle(`WH3 Mod Manager v${version}: viewing ${nodePath.basename(modPath)}`);
    getPackData(modPath);
    if (windows.viewerWindow) {
      windows.viewerWindow.focus();
    } else {
      createViewerWindow();
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

  ipcMain.on("terminateGame", () => {
    console.log(`Requesting terminate game`);

    try {
      exec(`taskkill /f /t /im ${gameToProcessName[appData.currentGame]}`, (error) => {
        if (error) console.log("taskkill error:", error);
      });
    } catch (e) {
      console.log("taskkill error:", e);
    }
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
      appData.currentlyReadingModPaths.every((path) => path != packPath)
    );
    console.log("getPackData:", !packData);
    console.log("getPackData:", table);
    if (packData && table)
      console.log(
        "getPackData:",
        packData.packedFiles
          .filter((packedFile) => packedFile.schemaFields)
          .every((packedFile) => packedFile.name != dbTableToString(table))
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
        table && { tablesToRead: [dbTableToString(table)], readLocs: getLocs }
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
    filesToRead?: string[]
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
          (path) => path != mod.path
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
      customizableModsHash?: string
    ) => {
      let modsToRead = mods;
      if (canUseCustomizableCache) {
        const customizableModsCache = await loadCustomizableModsCache();
        const customizableModsCachePaths = Object.keys(customizableModsCache);
        const modsNotInCustomizableCache = mods.filter(
          (mod) => !customizableModsCachePaths.includes(mod.path)
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
          mods.map((mod) => mod.name)
        );
        lastReadModsReceived = [...mods];
      }
      readMods(modsToRead, skipCollisionCheck, skipCollisionCheck);
    }
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
        `WH3 Mod Manager v${version}: viewing ${nodePath.basename(appData.queuedViewerData[0]?.packPath)}`
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
      gameToReferences[appData.currentGame]
    );

    windows.viewerWindow?.webContents.send("setStartArgs", appData.startArgs);
    windows.viewerWindow?.webContents.send("setCurrentLanguage", appData.currentLanguage);

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
      {}
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
    openInSteamAfterUpdate = false
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
                      (<number>response.progress / <number>response.total + Number.EPSILON) * 100
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
      }
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
          nodePath.parse(mod.name).ext
      );
      const uploadFilePath = nodePath.join(
        backupFolderPath,
        nodePath.parse(mod.name).name +
          "-NEW-" +
          format(new Date(), "dd-MM-yyyy-HH-mm") +
          nodePath.parse(mod.name).ext
      );

      await fs.mkdirSync(backupFolderPath, { recursive: true });
      await fs.copyFileSync(mod.path, backupFilePath);
      await addFakeUpdate(mod.path, uploadFilePath);

      const command = `cd /d "${nodePath.dirname(mod.path)}" && del "${nodePath.basename(
        mod.path
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
          nodePath.parse(mod.name).ext
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
      isPresetLoadOrdered: boolean
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
    }
  );
  ipcMain.on("forceModDownload", async (event, mod: Mod) => {
    try {
      fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "download", mod.workshopId],
        {}
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
        {}
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
        {}
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
        {}
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
      mods.map((mod) => mod.name)
    );
    forceResubscribeMods(mods);
  });
  ipcMain.on("unsubscribeToMod", async (event, mod: Mod) => {
    try {
      const child = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "unsubscribe", mod.workshopId],
        {}
      );
      child.on("message", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log("unsubscribe finished, deleting file:", mod.path);

        // why do we need to unsubscribe twice? who knows, but otherwise Steam unsubs AND happily downloads the mod into content after we unsub the first time
        fork(
          nodePath.join(__dirname, "sub.js"),
          [gameToSteamId[appData.currentGame], "unsubscribe", mod.workshopId],
          {}
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
      "var workshopIds = [" + workshopIDs.map((wID) => `"${wID}"`).join(",") + "]"
    );
    clipboard.writeText(scriptWithIDs);
  });

  const appendToSearchInsidePacks = (
    mods: Mod[],
    modsIndex: number,
    packNamesAll: string[],
    searchTerm: string
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
          }
        );
      }
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
            (existingPack.readTables as string[]).some((iterTableName) => iterTableName == tableToRead)
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
      DBCloneSaveOptions: DBCloneSaveOptions
    ) => {
      const { executeDBDuplication } = await import("./DBClone");
      await executeDBDuplication(
        packPath,
        nodesNamesToDuplicate,
        nodeNameToRef,
        nodeNameToRenameValue,
        defaultNodeNameToRenameValue,
        treeData,
        DBCloneSaveOptions
      );
    }
  );

  ipcMain.on(
    "getTableReferences",
    async (event, packPath: string, tableReferenceRequests: TableReferenceRequest[], withPack: boolean) => {
      console.log("ON getTableReferences, with pack:", withPack);
      console.log("to read:", tableReferenceRequests);

      const newPack = await readPack(packPath, {
        tablesToRead: tableReferenceRequests.map(
          (req) => (req.tableName.startsWith("db") && req.tableName) || `db\\${req.tableName}`
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
              (existingPackedFile) => existingPackedFile.name == newPackedFile.name
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
          tableReferenceRequests
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
          tableReferenceRequests
        );
      }
    }
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
      existingTree?: IViewerTreeNodeWithData
    ) => {
      return buildDBReferenceTree(
        packPath,
        currentDBTableSelection,
        deepCloneTarget,
        existingRefs,
        selectedNodesByName,
        existingTree
      );
    }
  );

  ipcMain.handle("getDBNameToDBVersions", async (event) => {
    return DBNameToDBVersions[appData.currentGame];
  });

  ipcMain.on(
    "startGame",
    async (
      event,
      mods: Mod[],
      areModsPresorted: boolean,
      startGameOptions: StartGameOptions,
      saveName?: string
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
                startGameOptions
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
          (mod) => !modPathsInsideMergedMods.some((path) => path == mod.path)
        );

        const enabledModsWithOverwrites = enabledModsWithoutMergedInMods.filter(
          (iterMod) => startGameOptions.packDataOverwrites[iterMod.path]
        );
        enabledModsWithoutMergedInMods = enabledModsWithoutMergedInMods.filter(
          (iterMod) => !startGameOptions.packDataOverwrites[iterMod.path]
        );
        console.log("enabledModsWithOverwrites:", enabledModsWithOverwrites);

        if (enabledModsWithOverwrites.length > 0) {
          const mergedDirPath = nodePath.join(
            appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
            "/whmm_overwrites/"
          );

          if (!fsExtra.existsSync(mergedDirPath)) {
            exec(`mkdir "${mergedDirPath}"`);
            await new Promise((resolve) => {
              setTimeout(resolve, 100);
            });
          }

          extraEnabledMods += `\nadd_working_directory "${linuxBit + mergedDirPath}";`;

          for (const pack of enabledModsWithOverwrites) {
            await createOverwritePack(
              pack.path,
              nodePath.join(mergedDirPath, pack.name),
              startGameOptions.packDataOverwrites[pack.path]
            );

            extraEnabledMods += `\nmod "${pack.name}";`;
          }
        }

        console.log("userFlowOptions:", startGameOptions.userFlowOptions);

        // Execute flows for enabled mods
        const enabledModsWithFlows = sortedMods.filter((iterMod) => {
          const pack = appData.packsData.find((packData) => packData.path == iterMod.path);
          return pack && pack.packedFiles.some((file) => file.name.startsWith("whmmflows\\"));
        });

        const createdFlowPacks: string[] = [];
        if (enabledModsWithFlows.length > 0) {
          console.log(`Found ${enabledModsWithFlows.length} mods with flows to execute`);

          // Create whmm_flows directory if needed
          const whmmFlowsPath = nodePath.join(dataFolder as string, "whmm_flows");
          if (!fsExtra.existsSync(whmmFlowsPath)) {
            fsExtra.mkdirSync(whmmFlowsPath, { recursive: true });
          }

          // Get the overwrite directory path if it exists
          const mergedDirPath = nodePath.join(
            appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
            "/whmm_overwrites/"
          );

          for (const pack of enabledModsWithFlows) {
            // Check if this pack has overwrites - if so, use the overwritten pack
            const hasOverwrites = enabledModsWithOverwrites.some(
              (overwritePack) => overwritePack.path === pack.path
            );
            const packPathToUse = hasOverwrites ? nodePath.join(mergedDirPath, pack.name) : pack.path;

            console.log(
              `Executing flows for pack: ${pack.name} (using ${
                hasOverwrites ? "overwritten" : "original"
              } pack)`
            );
            const packPaths = await executeFlowsForPack(
              packPathToUse,
              "", // No target path needed
              startGameOptions.userFlowOptions,
              pack.name
            );
            createdFlowPacks.push(...packPaths);
          }

          console.log(`Created ${createdFlowPacks.length} pack(s) from flows:`, createdFlowPacks);

          // Add flow packs to the mod list
          if (createdFlowPacks.length > 0) {
            extraEnabledMods += `\nadd_working_directory "${linuxBit + whmmFlowsPath}";`;
            for (const flowPackPath of createdFlowPacks) {
              const packFileName = nodePath.basename(flowPackPath);
              extraEnabledMods += `\nmod "${packFileName}";`;
              console.log(`Added flow pack to mod list: ${packFileName}`);
            }
          }
        }

        const text =
          enabledModsWithoutMergedInMods
            .filter((mod) => !mod.isInModding)
            .filter(
              (mod) =>
                nodePath.relative(
                  appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string,
                  mod.modDirectory
                ) != ""
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
                    `Mod ${mod.path} is older than the one in data, user needs to resolve this!`
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
            "steam_appid.txt"
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
    }
  );
};
