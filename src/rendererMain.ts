import "./index.css";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-material.css";

import debounce from "just-debounce-it";
import hash from "object-hash";

import store from "./store";
import { renderMainWindow } from "./appMain";
import { setupRendererLogging } from "./rendererCommon";
import {
  addMod,
  addToast,
  createdMergedPack,
  enableModsByName,
  importSteamCollection,
  removeMod,
  requestGameFolderPaths,
  setAppFolderPaths,
  setAvailableLanguages,
  setContentFolder,
  setCurrentGame,
  setCurrentLanguage,
  setCurrentlyReadingMod,
  setCustomizableMods,
  setDataModLastChangedLocal,
  setFromConfig,
  setHasConfigBeenRead,
  setIsAdmin,
  setIsDev,
  setIsFeaturesForModdersEnabled,
  setModdersPrefix,
  setIsOnboardingToRun,
  setIsWH3Running,
  setLastModThatWasRead,
  setModData,
  setMods,
  setOutdatedPackFiles,
  setOverwrittenDataPackedFiles,
  setPackCollisions,
  setPackCollisionsCheckProgress,
  setPackHeaderData,
  setPackSearchResults,
  setPacksData,
  setPacksDataRead,
  setSaves,
  setSkillsData,
  setSkillsViewOptions,
  setStartArgs,
  setUnsavedPacksData,
  setWarhammer3Folder,
} from "./appSlice";
import { SupportedGames } from "./supportedGames";

setupRendererLogging();

console.log("IN RENDERER (main_window)");

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
  store.dispatch(setIsDev(isDev));
});

window.api?.setIsAdmin((event, isAdmin) => {
  store.dispatch(setIsAdmin(isAdmin));
});

window.api?.setIsWH3Running((event, isWH3Running) => {
  store.dispatch(setIsWH3Running(isWH3Running));
});

window.api?.setIsFeaturesForModdersEnabled((event, isFeaturesForModdersEnabled) => {
  store.dispatch(setIsFeaturesForModdersEnabled(isFeaturesForModdersEnabled));
});

window.api?.setModdersPrefix((event, moddersPrefix) => {
  store.dispatch(setModdersPrefix(moddersPrefix));
});

window.api?.addToast((event, toast) => {
  store.dispatch(addToast(toast));
});

window.api?.setStartArgs((event, startArgs) => {
  store.dispatch(setStartArgs(startArgs));
});

window.api?.packsInSave((event, packNames: string[]) => {
  store.dispatch(enableModsByName(packNames));
});

window.api?.enableModsByName((event, packNames: string[]) => {
  store.dispatch(enableModsByName(packNames));
});

window.api?.setSkillsData((event, skillsData: SkillsData) => {
  if (store.getState().app.skillTreesDisplayMode !== "tab") {
    return;
  }
  store.dispatch(setSkillsData(skillsData));
});

const saveConfig = (appState: AppState) => {
  window.api?.saveConfig(appState);
  const enabledMods = appState.currentPreset.mods.filter((mod) => mod.isEnabled);
  // don't do it if all are enabled, i.e. when user is resetting the enabled column
  const customizableModsHash = hash(appState.customizableMods);
  const readModsSignature = hash({
    currentGame: appState.currentGame,
    enabledModPaths: enabledMods.map((mod) => mod.path),
    customizableModsHash,
  });

  if (enabledMods.length != appState.currentPreset.mods.length && lastReadModsSignature !== readModsSignature) {
    lastReadModsSignature = readModsSignature;
    window.api?.readMods(enabledMods, true, true, customizableModsHash);
  }
};

const saveConfigDebounced = debounce((appState: AppState) => {
  saveConfig(appState);
}, 200);
let lastReadModsSignature: string | undefined;

let lastSentTreeDisplayModes:
  | {
      skillTreesDisplayMode: TreeDisplayMode;
      technologyTreesDisplayMode: TreeDisplayMode;
    }
  | undefined;
let hasReceivedSkillsViewOptions = false;
let lastSentSkillsViewOptions: SkillsViewOptions | undefined;

const syncTreeDisplayModes = (appState: AppState) => {
  const nextTreeDisplayModes = {
    skillTreesDisplayMode: appState.skillTreesDisplayMode,
    technologyTreesDisplayMode: appState.technologyTreesDisplayMode,
  };

  if (
    lastSentTreeDisplayModes?.skillTreesDisplayMode === nextTreeDisplayModes.skillTreesDisplayMode &&
    lastSentTreeDisplayModes?.technologyTreesDisplayMode === nextTreeDisplayModes.technologyTreesDisplayMode
  ) {
    return;
  }

  lastSentTreeDisplayModes = nextTreeDisplayModes;
  window.api?.syncTreeDisplayModes(nextTreeDisplayModes);
};

const syncSkillsViewOptions = (appState: AppState) => {
  if (!hasReceivedSkillsViewOptions) return;

  const nextSkillsViewOptions: SkillsViewOptions = {
    isShowingSkillNodeSetNames: appState.isShowingSkillNodeSetNames,
    isShowingHiddenSkills: appState.isShowingHiddenSkills,
    isShowingHiddenModifiersInsideSkills: appState.isShowingHiddenModifiersInsideSkills,
    isCheckingSkillRequirements: appState.isCheckingSkillRequirements,
  };

  if (
    lastSentSkillsViewOptions?.isShowingSkillNodeSetNames === nextSkillsViewOptions.isShowingSkillNodeSetNames &&
    lastSentSkillsViewOptions?.isShowingHiddenSkills === nextSkillsViewOptions.isShowingHiddenSkills &&
    lastSentSkillsViewOptions?.isShowingHiddenModifiersInsideSkills ===
      nextSkillsViewOptions.isShowingHiddenModifiersInsideSkills &&
    lastSentSkillsViewOptions?.isCheckingSkillRequirements === nextSkillsViewOptions.isCheckingSkillRequirements
  ) {
    return;
  }

  lastSentSkillsViewOptions = nextSkillsViewOptions;
  window.api?.setSkillsViewOptions(nextSkillsViewOptions);
};

let isSubscribedToStoreChanges = false;
const subscribeToStoreChanges = () => {
  if (isSubscribedToStoreChanges) return;
  isSubscribedToStoreChanges = true;
  store.subscribe(() => {
    const appState = store.getState().app;
    saveConfigDebounced(appState);
    syncTreeDisplayModes(appState);
    syncSkillsViewOptions(appState);
  });
};

window.api?.fromAppConfig((event, appState: AppStateToRead) => {
  store.dispatch(setFromConfig(appState));
  syncTreeDisplayModes(store.getState().app);
  subscribeToStoreChanges();
});

window.api?.setAppFolderPaths((event, appFolderPaths) => {
  store.dispatch(setAppFolderPaths(appFolderPaths));
});

window.api?.requestGameFolderPaths((event, game: SupportedGames) => {
  store.dispatch(requestGameFolderPaths(game));
});

window.api?.failedReadingConfig(() => {
  if (!isSubscribedToStoreChanges) {
    store.dispatch(setIsOnboardingToRun(true));
  }
  store.dispatch(setHasConfigBeenRead(true));
  syncTreeDisplayModes(store.getState().app);
  subscribeToStoreChanges();
});

window.api?.modsPopulated((event, mods: Mod[]) => {
  mods = mods.filter((mod) => mod !== undefined);
  store.dispatch(setMods(mods));
  window.api?.getAllModData(mods.filter((mod) => !mod.isInData).map((mod) => mod.workshopId));
});

window.api?.addMod((event, mod: Mod) => {
  store.dispatch(addMod(mod));
  if (mod.workshopId && mod.workshopId !== "") {
    window.api?.getAllModData([mod.workshopId]);
  }
});

window.api?.removeMod((event, modPath: string) => {
  store.dispatch(removeMod(modPath));
});

window.api?.setContentFolder((event, path: string) => {
  store.dispatch(setContentFolder(path));
});

window.api?.setWarhammer3Folder((event, path: string) => {
  store.dispatch(setWarhammer3Folder(path));
});

window.api?.setOverwrittenDataPackedFiles((event, overwrittenDataPackedFiles) => {
  store.dispatch(setOverwrittenDataPackedFiles(overwrittenDataPackedFiles));
});

window.api?.setOutdatedPackFiles((event, outdatedPackFiles) => {
  store.dispatch(setOutdatedPackFiles(outdatedPackFiles));
});

window.api?.savesPopulated((event, saves: GameSave[]) => {
  store.dispatch(setSaves(saves));
});

window.api?.setModData((event, modDatas: ModData[]) => {
  store.dispatch(setModData(modDatas));
});

window.api?.setPackHeaderData((event, packHeaderData: PackHeaderData[]) => {
  store.dispatch(setPackHeaderData(packHeaderData));
});

window.api?.setCustomizableMods((event, customizableMods: Record<string, string[]>) => {
  store.dispatch(setCustomizableMods(customizableMods));
});

window.api?.setPacksData((event, packsData: PackViewData[]) => {
  if (!packsData || packsData.length == 0) return;
  store.dispatch(setPacksData(packsData));
});

window.api?.setUnsavedPacksData((event, packPath: string, unsavedFileData) => {
  store.dispatch(setUnsavedPacksData({ packPath, unsavedFileData } as SetUnsavedPacksDataPayload));
});

window.api?.setPacksDataRead((event, packPaths: string[]) => {
  store.dispatch(setPacksDataRead(packPaths));

  const appState = store.getState().app;
  const presetMods = appState.currentPreset.mods;
  const alwaysEnabledMods = appState.alwaysEnabledMods;
  const customizableMods = appState.customizableMods;
  const enabledMods = presetMods.filter(
    (iterMod) => iterMod.isEnabled || alwaysEnabledMods.find((mod) => mod.name === iterMod.name),
  );
  const customizableTables = [
    "units_to_groupings_military_permissions_tables",
    "building_culture_variants_tables",
    "faction_agent_permitted_subtypes_tables",
    "campaign_group_unique_agents_tables",
  ];
  window.api?.getCustomizableMods(
    enabledMods.map((mod) => mod.path),
    customizableTables,
    hash(customizableMods),
  );
});

window.api?.setDataModLastChangedLocal((event, dataModLastChangedLocal: number) => {
  store.dispatch(setDataModLastChangedLocal(dataModLastChangedLocal));
});

window.api?.setAvailableLanguages((event, languages: string[]) => {
  store.dispatch(setAvailableLanguages(languages));
});

window.api?.setCurrentLanguage((event, language: string) => {
  store.dispatch(setCurrentLanguage(language));
});

window.api?.onSkillsViewOptions((event, skillsViewOptions: SkillsViewOptions) => {
  hasReceivedSkillsViewOptions = true;
  lastSentSkillsViewOptions = skillsViewOptions;
  store.dispatch(setSkillsViewOptions(skillsViewOptions));
});

window.api?.setCurrentGame((event, game: SupportedGames, currentPreset: Preset, presets: Preset[]) => {
  store.dispatch(setCurrentGame({ game, currentPreset, presets } as SetCurrentGamePayload));
});

window.api?.setCurrentlyReadingMod((event, modName: string) => {
  store.dispatch(setCurrentlyReadingMod(modName));
});

window.api?.setLastModThatWasRead((event, modName: string) => {
  store.dispatch(setLastModThatWasRead(modName));
});

window.api?.setPackCollisions((event, packCollisions) => {
  store.dispatch(setPackCollisions(packCollisions));
});

window.api?.setPackCollisionsCheckProgress((event, progressData) => {
  store.dispatch(setPackCollisionsCheckProgress(progressData));
});

window.api?.setPackSearchResults((event, packNames) => {
  store.dispatch(setPackSearchResults(packNames));
});

window.api?.sendApiExists();
window.api?.readAppConfig();

renderMainWindow();
