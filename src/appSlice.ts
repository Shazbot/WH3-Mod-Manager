import { AppFolderPaths } from "./appData";
import { PackCollisions } from "./packFileTypes";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  adjustDuplicates,
  findAlwaysEnabledMods,
  findMod,
  withoutDataAndContentDuplicates,
} from "./modsHelpers";

// if a enabled mod was removed it's possible it was updated, re-enabled it then
let removedEnabledModPaths: string[] = [];

// queue mods in data that should be enabled when they're added
// for use with copy to data so we re-enable mods
export const dataModsToEnableByName: string[] = [];

const appSlice = createSlice({
  name: "app",
  initialState: {
    currentPreset: {
      mods: [],
      name: "",
    },
    lastSelectedPreset: null,
    presets: [],
    filter: "",
    alwaysEnabledMods: [],
    hiddenMods: [],
    saves: [],
    isOnboardingToRun: false,
    wasOnboardingEverRun: false,
    isDev: false,
    areThumbnailsEnabled: false,
    isClosedOnPlay: false,
    isAuthorEnabled: false,
    isMakeUnitsGeneralsEnabled: false,
    isScriptLoggingEnabled: false,
    isSkipIntroMoviesEnabled: false,
    isAutoStartCustomBattleEnabled: false,
    allMods: [],
    packsData: {},
    packCollisions: { packTableCollisions: [], packFileCollisions: [] },
    newMergedPacks: [],
    pathsOfReadPacks: [],
    appFolderPaths: { gamePath: "", contentFolder: "" },
    isSetAppFolderPathsDone: false,
    overwrittenDataPackedFiles: {},
  } as AppState,
  reducers: {
    toggleMod: (state: AppState, action: PayloadAction<Mod>) => {
      const inputMod = action.payload;
      const mod = state.currentPreset.mods.find((mod) => mod.workshopId == inputMod.workshopId);
      if (mod) mod.isEnabled = !mod.isEnabled;
    },
    setSharedMod: (state: AppState, action: PayloadAction<ModIdAndLoadOrder[]>) => {
      const payload = action.payload;
      payload.forEach((idAndLoadOrder) => {
        const mod = state.currentPreset.mods.find((mod) => mod.workshopId == idAndLoadOrder.workshopId);
        if (mod) {
          mod.isEnabled = true;
          mod.loadOrder = idAndLoadOrder.loadOrder;
        }
      });
    },
    enableAll: (state: AppState) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = true));

      const toEnable = state.currentPreset.mods.filter((iterMod) =>
        state.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));
    },
    enableModsByName: (state: AppState, action: PayloadAction<string[]>) => {
      const modNames = action.payload;
      console.log("ENABLING ALL MODS WITH NAMES: ", modNames);
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = false));

      state.currentPreset.mods
        .filter((mod) => modNames.find((modName) => modName === mod.name))
        .forEach((mod) => (mod.isEnabled = true));
    },
    disableAll: (state: AppState) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = false));

      const toEnable = state.currentPreset.mods.filter((iterMod) =>
        state.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));
    },
    setMods: (state: AppState, action: PayloadAction<Mod[]>) => {
      console.log("appSlice/setMods: SETTING CURRENT PRESET");
      const mods = action.payload;
      state.currentPreset.mods = mods;
      state.allMods = mods;

      state.currentPreset.mods = state.currentPreset.mods.filter(
        (mod) =>
          mod.isInData ||
          (!mod.isInData && !mods.find((modOther) => modOther.name == mod.name && modOther.isInData))
      );

      if (state.dataFromConfig) {
        state.currentPreset.mods
          .filter((iterMod) =>
            state.dataFromConfig?.alwaysEnabledMods.some((mod) => mod.name == iterMod.name)
          )
          .forEach((mod) => (mod.isEnabled = true));

        state.dataFromConfig.currentPreset.mods
          .filter((mod) => mod !== undefined)
          .map((mod) => {
            const existingMod = state.currentPreset.mods.find((statelyMod) => statelyMod.name == mod.name);
            if (existingMod) {
              existingMod.isEnabled = mod.isEnabled;
              if (mod.humanName !== "") existingMod.humanName = mod.humanName;
              if (mod.loadOrder != null) existingMod.loadOrder = mod.loadOrder;
            }
          });
      }
    },
    addMod: (state: AppState, action: PayloadAction<Mod>) => {
      const mod = action.payload;

      const alreadyExists = state.currentPreset.mods.find((iterMod) => iterMod.path === mod.path);
      if (alreadyExists) return;

      const alreadyExistsByName = state.currentPreset.mods.find((iterMod) => iterMod.name === mod.name);
      if (!alreadyExistsByName) {
        state.currentPreset.mods.push(mod);
      } else if (mod.isInData) {
        state.currentPreset.mods.splice(state.currentPreset.mods.indexOf(alreadyExistsByName), 1);
        state.currentPreset.mods.push(mod);
      }

      if (!state.allMods.find((iterMod) => iterMod.path == mod.path)) {
        state.allMods.push(mod);
      }

      if (removedEnabledModPaths.find((path) => path === mod.path)) {
        mod.isEnabled = true;
        removedEnabledModPaths = removedEnabledModPaths.filter((pathOfRemoved) => pathOfRemoved != mod.path);
      }

      if (mod.isInData && dataModsToEnableByName.find((nameOfToEnable) => nameOfToEnable === mod.name)) {
        mod.isEnabled = true;
        dataModsToEnableByName.splice(
          dataModsToEnableByName.findIndex((nameOfToEnable) => nameOfToEnable === mod.name),
          1
        );
      }

      if (state.dataFromConfig?.currentPreset.mods.find((iterMod) => iterMod.path == mod.path)?.isEnabled) {
        mod.isEnabled = true;
      }

      if (state.newMergedPacks.some((mergedPack) => mergedPack.path == mod.path)) {
        mod.isEnabled = true;
      }

      if (state.alwaysEnabledMods.some((iterMod) => iterMod.name == mod.name)) {
        mod.isEnabled = true;
      }
    },
    removeMod: (state: AppState, action: PayloadAction<string>) => {
      const modPath = action.payload;

      const removedMod = state.currentPreset.mods.find((iterMod) => iterMod.path == modPath);
      if (!removedMod) return;

      if (removedMod.isEnabled) {
        removedEnabledModPaths.push(removedMod.path);
      }

      state.currentPreset.mods = state.currentPreset.mods.filter((iterMod) => iterMod.path !== modPath);
      state.allMods = state.allMods.filter((iterMod) => iterMod.path !== modPath);
    },
    setModData: (state: AppState, action: PayloadAction<ModData[]>) => {
      const datas = action.payload;

      for (const data of datas) {
        // if the same mod is also in data cover it as well
        const contentMod = state.allMods.find((mod) => mod.workshopId == data.workshopId);
        if (contentMod) {
          const dataMod = state.currentPreset.mods.find(
            (iterMod) => iterMod.isInData && iterMod.name == contentMod.name
          );
          if (dataMod) {
            dataMod.humanName = data.humanName ?? "";
            dataMod.author = data.author;
            dataMod.reqModIdToName = data.reqModIdToName;
          }
        }

        const mod = state.currentPreset.mods.find((mod) => mod.workshopId == data.workshopId);
        if (!mod) continue;
        if (data.isDeleted) {
          mod.isDeleted = data.isDeleted;
        } else {
          mod.humanName = data.humanName ?? "";
          mod.author = data.author;
          mod.reqModIdToName = data.reqModIdToName;
        }

        if (mod.isDeleted) console.log(mod.name + " is deleted!");
        if (data.lastChanged) mod.lastChanged = data.lastChanged;
      }
    },
    setPackHeaderData: (state: AppState, action: PayloadAction<PackHeaderData>) => {
      const data = action.payload;
      const mod = state.currentPreset.mods.find((mod) => mod.path == data.path);
      if (mod) {
        mod.isMovie = data.isMovie;
        mod.dependencyPacks = data.dependencyPacks;
      }

      if (data.isMovie) console.log(`${data.path} is movie!`);
    },
    setPacksData: (state: AppState, action: PayloadAction<PackViewData[]>) => {
      const packsData = action.payload;

      for (const packData of packsData) {
        state.packsData[packData.packPath] = packData;
      }
    },
    setPacksDataRead: (state: AppState, action: PayloadAction<string[]>) => {
      const packPaths = action.payload;

      for (const path of packPaths) {
        if (!state.pathsOfReadPacks.some((iterPath) => iterPath == path)) {
          state.pathsOfReadPacks.push(path);
        }
      }
    },
    // setPackCollisions: (
    //   state: AppState,
    //   action: PayloadAction<[PackFileCollision[], PackTableCollision[]]>
    // ) => {
    //   const [packFileCollisions, packTableCollisions] = action.payload;
    //   state.packCollisions = { packFileCollisions, packTableCollisions };
    // },
    setPackCollisions: (state: AppState, action: PayloadAction<PackCollisions>) => {
      state.packCollisions = action.payload;
    },
    setAppFolderPaths: (state: AppState, action: PayloadAction<AppFolderPaths>) => {
      state.appFolderPaths = action.payload;
      state.isSetAppFolderPathsDone = true;
    },
    setFromConfig: (state: AppState, action: PayloadAction<AppStateToWrite>) => {
      const fromConfigAppState = action.payload;

      state.dataFromConfig = fromConfigAppState;

      fromConfigAppState.currentPreset.mods
        .filter((mod) => mod !== undefined)
        .map((mod) => {
          const existingMod = state.currentPreset.mods.find((statelyMod) => statelyMod.name == mod.name);
          if (existingMod) {
            existingMod.isEnabled = mod.isEnabled;
            if (mod.humanName !== "") existingMod.humanName = mod.humanName;
            if (mod.loadOrder != null) existingMod.loadOrder = mod.loadOrder;
          }
        });
      fromConfigAppState.presets.forEach((preset) => {
        if (!state.presets.find((existingPreset) => existingPreset.name === preset.name)) {
          state.presets.push(preset);
        }
      });

      state.areThumbnailsEnabled = fromConfigAppState.areThumbnailsEnabled;
      state.isClosedOnPlay = fromConfigAppState.isClosedOnPlay;
      state.isAuthorEnabled = fromConfigAppState.isAuthorEnabled;
      state.hiddenMods = fromConfigAppState.hiddenMods;
      state.alwaysEnabledMods = fromConfigAppState.alwaysEnabledMods;
      state.isMakeUnitsGeneralsEnabled = fromConfigAppState.isMakeUnitsGeneralsEnabled;
      state.isSkipIntroMoviesEnabled = fromConfigAppState.isSkipIntroMoviesEnabled;
      state.isScriptLoggingEnabled = fromConfigAppState.isScriptLoggingEnabled;
      state.isAutoStartCustomBattleEnabled = fromConfigAppState.isAutoStartCustomBattleEnabled;

      const toEnable = fromConfigAppState.currentPreset.mods.filter((iterMod) =>
        fromConfigAppState.alwaysEnabledMods.some((mod) => mod.name == iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));

      state.wasOnboardingEverRun = fromConfigAppState.wasOnboardingEverRun;
      if (!fromConfigAppState.wasOnboardingEverRun) state.isOnboardingToRun = true;

      if (fromConfigAppState.appFolderPaths) {
        if (fromConfigAppState.appFolderPaths.gamePath)
          state.appFolderPaths.gamePath = fromConfigAppState.appFolderPaths.gamePath;
        if (fromConfigAppState.appFolderPaths.contentFolder)
          state.appFolderPaths.gamePath = fromConfigAppState.appFolderPaths.contentFolder;
      }
    },
    addPreset: (state: AppState, action: PayloadAction<Preset>) => {
      const newPreset = action.payload;
      if (state.presets.find((preset) => preset.name === newPreset.name)) return;
      state.presets.push(newPreset);
      state.lastSelectedPreset = newPreset;
    },
    selectPreset: (state: AppState, action: PayloadAction<[string, PresetSelection]>) => {
      const [name, presetSelection] = action.payload;

      const newPreset = state.presets.find((preset) => preset.name === name);
      if (!newPreset) return;

      state.lastSelectedPreset = newPreset;

      if (presetSelection === "unary") {
        state.currentPreset.mods.forEach((mod) => {
          mod.isEnabled = false;
        });

        const newPresetMods = withoutDataAndContentDuplicates(newPreset.mods);

        state.currentPreset.mods.forEach((mod) => {
          const modToChange = findMod(newPresetMods, mod);
          if (modToChange) {
            mod.isEnabled = modToChange.isEnabled;
            mod.loadOrder = modToChange.loadOrder;
          }
        });
      } else if (presetSelection === "addition" || presetSelection === "subtraction") {
        newPreset.mods.forEach((mod) => {
          if (mod.isEnabled) {
            const modToChange = findMod(state.currentPreset.mods, mod);
            if (modToChange) modToChange.isEnabled = presetSelection !== "subtraction";
          }
        });
      }

      findAlwaysEnabledMods(state.currentPreset.mods, state.alwaysEnabledMods).forEach(
        (mod) => (mod.isEnabled = true)
      );
    },
    deletePreset: (state: AppState, action: PayloadAction<string>) => {
      const name = action.payload;
      state.presets = state.presets.filter((preset) => preset.name !== name);
      if (state.lastSelectedPreset && state.lastSelectedPreset.name == name) state.lastSelectedPreset = null;
    },
    replacePreset: (state: AppState, action: PayloadAction<string>) => {
      const name = action.payload;
      const preset = state.presets.find((preset) => preset.name === name);
      if (preset) preset.mods = state.currentPreset.mods;
    },
    setFilter: (state: AppState, action: PayloadAction<string>) => {
      const filter = action.payload;
      state.filter = filter;
    },
    setModLoadOrder: (state: AppState, action: PayloadAction<ModLoadOrderPayload>) => {
      const payload = action.payload;
      const ourMod = state.currentPreset.mods.find((mod) => mod.name === payload.modName);
      const newLoadOrder = payload.loadOrder;
      const originalLoadOrder = payload.originalOrder;

      console.log(`orig order is ${originalLoadOrder}`);
      console.log(`new order is ${newLoadOrder}`);

      if (ourMod) {
        state.currentPreset.mods.forEach((mod) => {
          if (mod.name === payload.modName) {
            // console.log(`setting loadOrder to ${newLoadOrder}`);
          } else if (mod.loadOrder) {
            if (
              originalLoadOrder != null &&
              mod.loadOrder > originalLoadOrder &&
              mod.loadOrder <= newLoadOrder
            ) {
              mod.loadOrder -= 1;
            }
          }
        });

        ourMod.loadOrder = newLoadOrder;
        // console.log(
        //   state.currentPreset.mods
        //     .filter((mod) => mod.loadOrder != null)
        //     .map((mod) => [mod.name, mod.loadOrder])
        // );
        adjustDuplicates(state.currentPreset.mods, ourMod);
      }

      // printLoadOrders(state.currentPreset.mods);
    },
    resetModLoadOrder: (state: AppState, action: PayloadAction<Mod[]>) => {
      const mods = action.payload;
      mods.forEach((mod) => {
        const stateMod = state.currentPreset.mods.find((stateMod) => stateMod.name === mod.name);
        if (stateMod) stateMod.loadOrder = undefined;
      });
    },
    toggleAlwaysEnabledMods: (state: AppState, action: PayloadAction<Mod[]>) => {
      const mods = action.payload;
      const modsAlreadyInAlwaysEnabled = state.alwaysEnabledMods.filter((iterMod) =>
        mods.find((mod) => iterMod.name === mod.name)
      );

      const modsToAdd = mods.filter(
        (iterMod) => !modsAlreadyInAlwaysEnabled.find((mod) => mod.name === iterMod.name)
      );

      state.alwaysEnabledMods = state.alwaysEnabledMods.filter(
        (iterMod) => !modsAlreadyInAlwaysEnabled.find((mod) => mod.name === iterMod.name)
      );
      state.alwaysEnabledMods = state.alwaysEnabledMods.concat(modsToAdd);
      const modsToEnable = state.currentPreset.mods.filter((iterMod) =>
        state.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      modsToEnable.forEach((mod) => (mod.isEnabled = true));
    },
    toggleAlwaysHiddenMods: (state: AppState, action: PayloadAction<Mod[]>) => {
      const mods = action.payload;
      const modsAlreadyHidden = state.hiddenMods.filter((iterMod) =>
        mods.find((mod) => iterMod.name === mod.name)
      );

      const modsToAdd = mods.filter((iterMod) => !modsAlreadyHidden.find((mod) => mod.name === iterMod.name));

      state.hiddenMods = state.hiddenMods.filter(
        (iterMod) => !modsAlreadyHidden.find((mod) => mod.name === iterMod.name)
      );
      state.hiddenMods = state.hiddenMods.concat(modsToAdd);

      // disable mods we just hid that aren't set to always enabled
      state.hiddenMods
        .filter((iterMod) => !state.alwaysEnabledMods.find((mod) => iterMod.name === mod.name))
        .forEach((iterMod) => {
          const mod = state.currentPreset.mods.find((mod) => iterMod.name === mod.name);
          if (mod) mod.isEnabled = false;
        });
    },
    setSaves: (state: AppState, action: PayloadAction<GameSave[]>) => {
      const saves = action.payload;
      state.saves = saves;
    },
    setIsOnboardingToRun: (state: AppState, action: PayloadAction<boolean>) => {
      state.isOnboardingToRun = action.payload;
    },
    setWasOnboardingEverRun: (state: AppState, action: PayloadAction<boolean>) => {
      state.wasOnboardingEverRun = action.payload;
    },
    toggleAreThumbnailsEnabled: (state: AppState) => {
      state.areThumbnailsEnabled = !state.areThumbnailsEnabled;
    },
    toggleIsClosedOnPlay: (state: AppState) => {
      state.isClosedOnPlay = !state.isClosedOnPlay;
    },
    toggleIsAuthorEnabled: (state: AppState) => {
      state.isAuthorEnabled = !state.isAuthorEnabled;
    },
    toggleMakeUnitsGenerals: (state: AppState) => {
      state.isMakeUnitsGeneralsEnabled = !state.isMakeUnitsGeneralsEnabled;
    },
    toggleIsScriptLoggingEnabled: (state: AppState) => {
      state.isScriptLoggingEnabled = !state.isScriptLoggingEnabled;
    },
    toggleIsSkipIntroMoviesEnabled: (state: AppState) => {
      state.isSkipIntroMoviesEnabled = !state.isSkipIntroMoviesEnabled;
    },
    toggleIsAutoStartCustomBattleEnabled: (state: AppState) => {
      state.isAutoStartCustomBattleEnabled = !state.isAutoStartCustomBattleEnabled;
    },
    setIsDev: (state: AppState, action: PayloadAction<boolean>) => {
      state.isDev = action.payload;
    },
    createdMergedPack: (state: AppState, action: PayloadAction<string>) => {
      const path = action.payload;
      state.newMergedPacks.push({ path, creationTime: Date.now() });

      const existingMod = state.currentPreset.mods.find((mod) => mod.path == path);
      if (existingMod) {
        existingMod.isEnabled = true;
      }
    },
    setContentFolder: (state: AppState, action: PayloadAction<string>) => {
      state.appFolderPaths.contentFolder = action.payload;
    },
    setWarhammer3Folder: (state: AppState, action: PayloadAction<string>) => {
      state.appFolderPaths.gamePath = action.payload;
    },
    setOverwrittenDataPackedFiles: (state: AppState, action: PayloadAction<Record<string, string[]>>) => {
      state.overwrittenDataPackedFiles = action.payload;
    },
    setDataModLastChangedLocal: (state: AppState, action: PayloadAction<number>) => {
      state.dataModLastChangedLocal = action.payload;
    },
    selectDBTable: (state: AppState, action: PayloadAction<DBTableSelection>) => {
      state.currentDBTableSelection = action.payload;
    },
  },
});

export const {
  toggleMod,
  setMods,
  setModData,
  setFromConfig,
  enableAll,
  disableAll,
  addPreset,
  selectPreset,
  replacePreset,
  deletePreset,
  setFilter,
  setModLoadOrder,
  resetModLoadOrder,
  toggleAlwaysEnabledMods,
  toggleAlwaysHiddenMods,
  setSaves,
  setIsOnboardingToRun,
  setWasOnboardingEverRun,
  toggleIsAuthorEnabled,
  toggleAreThumbnailsEnabled,
  toggleIsClosedOnPlay,
  setIsDev,
  setPackHeaderData,
  toggleMakeUnitsGenerals,
  toggleIsScriptLoggingEnabled,
  toggleIsSkipIntroMoviesEnabled,
  toggleIsAutoStartCustomBattleEnabled,
  setSharedMod,
  addMod,
  removeMod,
  createdMergedPack,
  enableModsByName,
  setPacksData,
  setPacksDataRead,
  setPackCollisions,
  setAppFolderPaths,
  setWarhammer3Folder,
  setContentFolder,
  setOverwrittenDataPackedFiles,
  setDataModLastChangedLocal,
  selectDBTable,
} = appSlice.actions;

export default appSlice.reducer;
