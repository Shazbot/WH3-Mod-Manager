import { Pack, PackCollisions } from "./packFileTypes";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  adjustDuplicates,
  findAlwaysEnabledMods,
  findMod,
  withoutDataAndContentDuplicates,
} from "./modsHelpers";

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
    isAuthorEnabled: false,
    isMakeUnitsGeneralsEnabled: false,
    isScriptLoggingEnabled: false,
    isSkipIntroMoviesEnabled: false,
    allMods: [],
    packsData: {},
    packCollisions: {},
  } as AppState,
  reducers: {
    toggleMod: (state: AppState, action: PayloadAction<Mod>) => {
      const inputMod = action.payload;
      const mod = state.currentPreset.mods.find((mod) => mod.workshopId == inputMod.workshopId);
      mod.isEnabled = !mod.isEnabled;
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
      const mods = action.payload;
      state.currentPreset.mods = mods;
      state.allMods = mods;

      state.currentPreset.mods = state.currentPreset.mods.filter(
        (mod) =>
          mod.isInData ||
          (!mod.isInData && !mods.find((modOther) => modOther.name == mod.name && modOther.isInData))
      );
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
    },
    removeMod: (state: AppState, action: PayloadAction<string>) => {
      const modPath = action.payload;

      if (!state.currentPreset.mods.find((iterMod) => iterMod.path == modPath)) return;

      state.currentPreset.mods = state.currentPreset.mods.filter((iterMod) => iterMod.path !== modPath);
      state.allMods = state.allMods.filter((iterMod) => iterMod.path !== modPath);
    },
    setModData: (state: AppState, action: PayloadAction<ModData>) => {
      const data = action.payload;

      // if the same mod is also in data cover it as well
      const contentMod = state.allMods.find((mod) => mod.workshopId == data.workshopId);
      if (contentMod) {
        const dataMod = state.currentPreset.mods.find(
          (iterMod) => iterMod.isInData && iterMod.name == contentMod.name
        );
        if (dataMod) {
          dataMod.humanName = data.humanName ?? "";
          dataMod.author = data.author;
        }
      }

      const mod = state.currentPreset.mods.find((mod) => mod.workshopId == data.workshopId);
      if (!mod) return;
      if (data.isDeleted) {
        mod.isDeleted = data.isDeleted;
      } else {
        mod.humanName = data.humanName ?? "";
        mod.author = data.author;
      }

      if (mod.isDeleted) console.log(mod.name + " is deleted!");
      if (data.lastChanged) mod.lastChanged = data.lastChanged;
    },
    setPackHeaderData: (state: AppState, action: PayloadAction<PackHeaderData>) => {
      const data = action.payload;
      const mod = state.currentPreset.mods.find((mod) => mod.path == data.path);
      mod.isMovie = data.isMovie;

      if (data.isMovie) console.log(`${data.path} is movie!`);
    },
    setPacksData: (state: AppState, action: PayloadAction<Pack[]>) => {
      const packsData = action.payload;

      for (const packData of packsData) {
        state.packsData[packData.name] = packData;
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
    setFromConfig: (state: AppState, action: PayloadAction<AppStateToWrite>) => {
      const fromConfigAppState = action.payload;
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
      state.isAuthorEnabled = fromConfigAppState.isAuthorEnabled;
      state.hiddenMods = fromConfigAppState.hiddenMods;
      state.alwaysEnabledMods = fromConfigAppState.alwaysEnabledMods;
      state.isMakeUnitsGeneralsEnabled = fromConfigAppState.isMakeUnitsGeneralsEnabled;
      state.isSkipIntroMoviesEnabled = fromConfigAppState.isSkipIntroMoviesEnabled;
      state.isScriptLoggingEnabled = fromConfigAppState.isScriptLoggingEnabled;
      const toEnable = state.currentPreset.mods.filter((iterMod) =>
        fromConfigAppState.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));

      state.wasOnboardingEverRun = fromConfigAppState.wasOnboardingEverRun;
      if (!fromConfigAppState.wasOnboardingEverRun) state.isOnboardingToRun = true;
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
      if (state.lastSelectedPreset.name == name) state.lastSelectedPreset = null;
    },
    replacePreset: (state: AppState, action: PayloadAction<string>) => {
      const name = action.payload;
      const preset = state.presets.find((preset) => preset.name === name);
      preset.mods = state.currentPreset.mods;
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

      // console.log(`orig order is ${originalLoadOrder}`);
      // console.log(`new order is ${newLoadOrder}`);

      if (ourMod) {
        state.currentPreset.mods.forEach((mod) => {
          if (mod.name === payload.modName) {
            // console.log(`setting loadOredr to ${newLoadOrder}`);
            ourMod.loadOrder = newLoadOrder;
          } else if (mod.loadOrder) {
            // if (mod.loadOrder > newLoadOrder && mod.loadOrder < originalLoadOrder) {
            if (mod.loadOrder > newLoadOrder) {
              // mod.loadOrder += 1;
              // console.log(`${mod.name} load order is +1, ${mod.loadOrder}`);
              // } else if (mod.loadOrder < newLoadOrder && mod.loadOrder > originalLoadOrder) {
            } else if (mod.loadOrder < newLoadOrder) {
              // mod.loadOrder -= 1;
              // console.log(`${mod.name} load order is -1, ${mod.loadOrder}`);
            } else if (mod.loadOrder == newLoadOrder) {
              mod.loadOrder += 1;
            }
          }

          adjustDuplicates(state.currentPreset.mods);
        });
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
    setIsDev: (state: AppState, action: PayloadAction<boolean>) => {
      state.isDev = action.payload;
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
  setIsDev,
  setPackHeaderData,
  toggleMakeUnitsGenerals,
  toggleIsScriptLoggingEnabled,
  toggleIsSkipIntroMoviesEnabled,
  setSharedMod,
  addMod,
  removeMod,
  enableModsByName,
  setPacksData,
  setPackCollisions,
} = appSlice.actions;

export default appSlice.reducer;
