import "./index.css";
import "./app";
import log from "electron-log/renderer";
import {
  setMods,
  setModData,
  setFromConfig,
  setSaves,
  setIsOnboardingToRun,
  setIsDev,
  addMod,
  removeMod,
  enableModsByName,
  setPackHeaderData,
  setPacksData,
  setSkillsData,
  setPackCollisions,
  createdMergedPack,
  setPacksDataRead,
  setAppFolderPaths,
  requestGameFolderPaths,
  setWarhammer3Folder,
  setContentFolder,
  setOverwrittenDataPackedFiles,
  setDataModLastChangedLocal,
  selectDBTable,
  setStartArgs,
  setIsAdmin,
  setIsWH3Running,
  setOutdatedPackFiles,
  addToast,
  setAvailableLanguages,
  setCurrentLanguage,
  setCustomizableMods,
  setCurrentGame,
  importSteamCollection,
  setHasConfigBeenRead,
  setPackCollisionsCheckProgress,
  setCurrentlyReadingMod,
  setLastModThatWasRead,
  setCurrentGameNaive,
} from "./appSlice";
import store from "./store";
import { PackCollisions } from "./packFileTypes";
import { GameFolderPaths } from "./appData";
import debounce from "just-debounce-it";
import { api } from "./preload";
import { SupportedGames } from "./supportedGames";

console.log("IN RENDERER");

let isSubscribedToStoreChanges = false;

interface WindowWithApi extends Window {
  api: api;
}

declare const window: WindowWithApi;

const isViewer = window.location.pathname.includes("/viewer");
const isSkills = window.location.pathname.includes("/skills");
const isMain = window.location.pathname.includes("/main_window");

if (isViewer) window.api?.viewerIsReady();
if (isSkills) window.api?.skillsAreReady();

const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
  log.log(...args);
  originalConsoleLog(`isMain: ${isMain}, isViewer: ${isViewer}, isSkills: ${isSkills}`);
  originalConsoleLog(...args);
};

console.log(`isMain: ${isMain}, isViewer: ${isViewer}, isSkills: ${isSkills}`);

window.addEventListener("error", (e) => {
  console.log(e);
});

window.api?.handleLog((event, msg) => {
  console.log(msg);
});

window.api?.subscribedToMods((event, ids: string[]) => {
  console.log("subbed to mods: ", ids);
});

window.api?.createdMergedPack((event, filePath: string) => {
  store.dispatch(createdMergedPack(filePath));
});

window.api?.importSteamCollectionResponse((event, importSteamCollectionData: ImportSteamCollection) => {
  store.dispatch(importSteamCollection(importSteamCollectionData));
});

window.api?.setIsDev((event, isDev) => {
  console.log("Setting is dev: ", isDev);
  store.dispatch(setIsDev(isDev));
});

window.api?.setIsAdmin((event, isAdmin) => {
  console.log("Setting is admin: ", isAdmin);
  store.dispatch(setIsAdmin(isAdmin));
});

window.api?.setIsWH3Running((event, isWH3Running) => {
  console.log("Setting isWH3Running: ", isWH3Running);
  store.dispatch(setIsWH3Running(isWH3Running));
});

window.api?.addToast((event, toast) => {
  console.log("adding new toast", toast);
  store.dispatch(addToast(toast));
});

window.api?.setStartArgs((event, startArgs) => {
  console.log("Start args are:", startArgs);
  store.dispatch(setStartArgs(startArgs));
});

window.api?.packsInSave((event, packNames: string[]) => {
  console.log("packs in save: ", packNames);
  store.dispatch(enableModsByName(packNames));
});

window.api?.openModInViewer((event, modPath: string) => {
  store.dispatch(
    selectDBTable({
      packPath: modPath,
      dbName: "main_units_tables",
      dbSubname: "",
    })
  );
});

const saveConfig = (appState: AppState) => {
  window.api?.saveConfig(appState);
  const enabledMods = appState.currentPreset.mods.filter((mod) => mod.isEnabled);
  // don't do it if all are enabled, i.e. when user is resetting the enabled column
  if (enabledMods.length != appState.currentPreset.mods.length) window.api?.readMods(enabledMods);
};

const saveConfigDebounced = debounce((appState: AppState) => {
  saveConfig(appState);
}, 200);

const subscribeToStoreChanges = () => {
  if (!isMain) return;

  if (!isSubscribedToStoreChanges) {
    setTimeout(() => {
      if (!isSubscribedToStoreChanges) {
        isSubscribedToStoreChanges = true;

        saveConfig(store.getState().app);

        store.subscribe(() => {
          saveConfigDebounced(store.getState().app);
        });
      }
    }, 50);
  }
};

window.api?.fromAppConfig((event, appState: AppStateToRead) => {
  console.log("INVOKED: FROM API CONFIG");
  store.dispatch(setFromConfig(appState));

  subscribeToStoreChanges();
});

window.api?.setAppFolderPaths((event, appFolderPaths: GameFolderPaths) => {
  console.log("INVOKED: SET APP FOLDER PATHS");
  store.dispatch(setAppFolderPaths(appFolderPaths));
});

window.api?.requestGameFolderPaths((event, game: SupportedGames) => {
  console.log("INVOKED: SET APP FOLDER PATHS");
  store.dispatch(requestGameFolderPaths(game));
});

window.api?.failedReadingConfig(() => {
  console.log("INVOKED: failedReadingConfig");
  if (!isSubscribedToStoreChanges) {
    store.dispatch(setIsOnboardingToRun(true));
  }
  store.dispatch(setHasConfigBeenRead(true));

  subscribeToStoreChanges();
});

window.api?.modsPopulated((event, mods: Mod[]) => {
  console.log("INVOKED: MODS POPULATED");
  mods = mods.filter((mod) => mod !== undefined); // try to get rid of this check
  store.dispatch(setMods(mods));
  window.api?.getAllModData(mods.filter((mod) => !mod.isInData).map((mod) => mod.workshopId));
});

window.api?.addMod((event, mod: Mod) => {
  console.log("INVOKED: MOD ADDED");
  store.dispatch(addMod(mod));
  if (mod.workshopId && mod.workshopId !== "") {
    window.api?.getAllModData([mod.workshopId]);
  }
});

window.api?.removeMod((event, modPath: string) => {
  console.log("INVOKED: MOD REMOVED");
  store.dispatch(removeMod(modPath));
});

window.api?.setContentFolder((event, path: string) => {
  console.log("INVOKED: setContentFolder");
  store.dispatch(setContentFolder(path));
});
window.api?.setWarhammer3Folder((event, path: string) => {
  console.log("INVOKED: setWarhammer3Folder");
  store.dispatch(setWarhammer3Folder(path));
});

window.api?.setOverwrittenDataPackedFiles((event, overwrittenDataPackedFiles: Record<string, string[]>) => {
  console.log("INVOKED: setOverwrittenDataPackedFiles");
  store.dispatch(setOverwrittenDataPackedFiles(overwrittenDataPackedFiles));
});

window.api?.setOutdatedPackFiles((event, outdatedPackFiles: Record<string, string[]>) => {
  console.log("INVOKED: setOutdatedPackFiles");
  store.dispatch(setOutdatedPackFiles(outdatedPackFiles));
});

window.api?.savesPopulated((event, saves: GameSave[]) => {
  console.log("INVOKED: SAVES POPULATED");
  store.dispatch(setSaves(saves));
});

window.api?.setModData((event, modDatas: ModData[]) => {
  // console.log("INVOKED: MOD DATA RECIEVED");
  store.dispatch(setModData(modDatas));
});

const packHeaders: PackHeaderData[] = [];
const setPackHeaderDataLimited = debounce(() => {
  store.dispatch(setPackHeaderData(packHeaders));
  packHeaders.splice(0, packHeaders.length);
}, 250);
window.api?.setPackHeaderData((event, packHeaderData: PackHeaderData) => {
  // console.log("INVOKED: MOD PACK DATA RECIEVED");
  packHeaders.push(packHeaderData);
  setPackHeaderDataLimited();
});

window.api?.setCustomizableMods((event, customizableMods: Record<string, string[]>) => {
  // console.log("INVOKED: MOD PACK DATA RECIEVED");
  store.dispatch(setCustomizableMods(customizableMods));
});

window.api?.setPacksData((event, packsData: PackViewData[]) => {
  if (!packsData || packsData.length == 0) {
    console.log("setPacksData: packsData is invalid:", packsData);
    return;
  }
  console.log(
    `INVOKED: MOD PACK DATA RECIEVED FOR ${packsData.map((packData) => packData.packName).join(",")}`
  );

  // if (packsData[0].currentTable) console.log(packsData[0].currentTable!.schemaFields[0]);
  store.dispatch(setPacksData(packsData));
  // currentPackData.data = packsData[0];

  // getCompatData(packsData).then((data: Awaited<ReturnType<typeof getCompatData>>) => {
  //   console.log("GOT COMPAT DATA");
  //   store.dispatch(setPackCollisions(data));
  // });
});

window.api?.setSkillsData((event, skillsData: SkillsData) => {
  if (!skillsData) {
    console.log("setSkillsData: skillsData is invalid");
    return;
  }

  store.dispatch(setSkillsData(skillsData));
});

window.api?.setPacksDataRead((event, packPaths: string[]) => {
  store.dispatch(setPacksDataRead(packPaths));

  const appState = store.getState().app;
  const presetMods = appState.currentPreset.mods;
  const alwaysEnabledMods = appState.alwaysEnabledMods;
  const enabledMods = presetMods.filter(
    (iterMod) => iterMod.isEnabled || alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
  );
  const customizableTables = [
    "units_to_groupings_military_permissions_tables",
    // "units_to_exclusive_faction_permissions_tables",
    "building_culture_variants_tables",
    "faction_agent_permitted_subtypes_tables",
    "campaign_group_unique_agents_tables",
  ];
  window.api?.getCustomizableMods(
    enabledMods.map((mod) => mod.path),
    customizableTables
  );
});

window.api?.setDataModLastChangedLocal((event, dataModLastChangedLocal: number) => {
  store.dispatch(setDataModLastChangedLocal(dataModLastChangedLocal));
});

window.api?.setAvailableLanguages((event, languages: string[]) => {
  console.log("SETTING LANGUAGES", languages);
  store.dispatch(setAvailableLanguages(languages));
});

window.api?.setCurrentLanguage((event, language: string) => {
  console.log("SETTING LANGUAGE", language);
  store.dispatch(setCurrentLanguage(language));
});

window.api?.setCurrentGame((event, game: SupportedGames, currentPreset: Preset, presets: Preset[]) => {
  console.log("SETTING GAME", game);
  store.dispatch(setCurrentGame({ game, currentPreset, presets } as SetCurrentGamePayload));
});

window.api?.setCurrentGameNaive((event, game: SupportedGames) => {
  console.log("SETTING GAME NAIVE", game);
  store.dispatch(setCurrentGameNaive(game));
});

window.api?.setCurrentlyReadingMod((event, modName: string) => {
  console.log("INVOKED: setCurrentlyReadingMod", modName);
  store.dispatch(setCurrentlyReadingMod(modName));
});
window.api?.setLastModThatWasRead((event, modName: string) => {
  console.log("INVOKED: setLastModThatWasRead", modName);
  store.dispatch(setLastModThatWasRead(modName));
});

window.api?.setPackCollisions((event, packCollisions: PackCollisions) => {
  // console.log("INVOKED: MOD PACK DATA RECIEVED");
  store.dispatch(setPackCollisions(packCollisions));

  // getCompatData(packsData).then((data: Awaited<ReturnType<typeof getCompatData>>) => {
  //   console.log("GOT COMPAT DATA");
  //   store.dispatch(setPackCollisions(data));
  // });
});

window.api?.setPackCollisionsCheckProgress((event, progressData: PackCollisionsCheckProgressData) => {
  // console.log("INVOKED: setPackCollisionsCheckProgress");
  store.dispatch(setPackCollisionsCheckProgress(progressData));
});

if (isMain) {
  window.api?.sendApiExists();
  window.api?.readAppConfig();
}
