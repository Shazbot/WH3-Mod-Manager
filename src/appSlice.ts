import { createSlice, PayloadAction } from "@reduxjs/toolkit";

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
  } as AppState,
  reducers: {
    toggleMod: (state, action: PayloadAction<Mod>) => {
      const inputMod = action.payload;
      const mod = state.currentPreset.mods.find((mod) => mod.workshopId == inputMod.workshopId);
      mod.isEnabled = !mod.isEnabled;
    },
    enableAll: (state) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = true));

      const toEnable = state.currentPreset.mods.filter((iterMod) =>
        state.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));
    },
    disableAll: (state) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = false));

      const toEnable = state.currentPreset.mods.filter((iterMod) =>
        state.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));
    },
    setMods: (state, action: PayloadAction<Mod[]>) => {
      const mods = action.payload;
      state.currentPreset.mods = mods;

      state.currentPreset.mods = state.currentPreset.mods.filter(
        (mod) =>
          mod.isInData ||
          (!mod.isInData && !mods.find((modOther) => modOther.name == mod.name && modOther.isInData))
      );
    },
    setModData: (state, action: PayloadAction<ModData>) => {
      const data = action.payload;
      const mod = state.currentPreset.mods.find((mod) => mod.workshopId == data.workshopId);
      if (!mod) return;
      mod.humanName = data.humanName;
      if (data.lastChanged) mod.lastChanged = data.lastChanged;
    },
    setFromConfig: (state, action: PayloadAction<AppState>) => {
      const fromConfigAppState = action.payload;
      fromConfigAppState.currentPreset.mods
        .filter((mod) => mod !== undefined)
        .map((mod) => {
          const existingMod = state.currentPreset.mods.find((statelyMod) => statelyMod.name == mod.name);
          if (existingMod) {
            existingMod.isEnabled = mod.isEnabled;
            if (mod.humanName !== "") existingMod.humanName = mod.humanName;
            if (mod.loadOrder !== undefined) existingMod.loadOrder = mod.loadOrder;
          }
        });
      fromConfigAppState.presets.forEach((preset) => {
        if (!state.presets.find((existingPreset) => existingPreset.name === preset.name)) {
          state.presets.push(preset);
        }
      });

      state.hiddenMods = fromConfigAppState.hiddenMods;
      state.alwaysEnabledMods = fromConfigAppState.alwaysEnabledMods;
      const toEnable = state.currentPreset.mods.filter((iterMod) =>
        fromConfigAppState.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));
    },
    addPreset: (state, action: PayloadAction<Preset>) => {
      const newPreset = action.payload;
      if (state.presets.find((preset) => preset.name === newPreset.name)) return;
      state.presets.push(newPreset);
      state.lastSelectedPreset = newPreset;
    },
    selectPreset: (state, action: PayloadAction<string>) => {
      const name = action.payload;
      const newPreset = state.presets.find((preset) => preset.name === name);
      if (!newPreset) return;
      state.currentPreset = newPreset;
      state.lastSelectedPreset = newPreset;

      state.currentPreset.mods = state.currentPreset.mods.filter(
        (mod) =>
          mod.isInData ||
          (!mod.isInData &&
            !state.currentPreset.mods.find((modOther) => modOther.name == mod.name && modOther.isInData))
      );

      const toEnable = state.currentPreset.mods.filter((iterMod) =>
        state.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
      );
      toEnable.forEach((mod) => (mod.isEnabled = true));
    },
    deletePreset: (state, action: PayloadAction<string>) => {
      const name = action.payload;
      state.presets = state.presets.filter((preset) => preset.name !== name);
      if (state.lastSelectedPreset.name == name) state.lastSelectedPreset = null;
    },
    replacePreset: (state, action: PayloadAction<string>) => {
      const name = action.payload;
      const preset = state.presets.find((preset) => preset.name === name);
      preset.mods = state.currentPreset.mods;
    },
    setFilter: (state, action: PayloadAction<string>) => {
      const filter = action.payload;
      state.filter = filter;
    },
    setModLoadOrder: (state, action: PayloadAction<ModLoadOrderPayload>) => {
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
            if (mod.loadOrder >= newLoadOrder && mod.loadOrder < originalLoadOrder) mod.loadOrder += 1;
            else if (mod.loadOrder <= newLoadOrder && mod.loadOrder > originalLoadOrder) mod.loadOrder -= 1;
          }
        });
      }
    },
    resetModLoadOrder: (state, action: PayloadAction<Mod[]>) => {
      const mods = action.payload;
      mods.forEach((mod) => {
        const stateMod = state.currentPreset.mods.find((stateMod) => stateMod.name === mod.name);
        if (stateMod) stateMod.loadOrder = undefined;
      });
    },
    toggleAlwaysEnabledMods: (state, action: PayloadAction<Mod[]>) => {
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
    toggleAlwaysHiddenMods: (state, action: PayloadAction<Mod[]>) => {
      const mods = action.payload;
      const modsAlreadyHidden = state.hiddenMods.filter((iterMod) =>
        mods.find((mod) => iterMod.name === mod.name)
      );

      const modsToAdd = mods.filter((iterMod) => !modsAlreadyHidden.find((mod) => mod.name === iterMod.name));

      state.hiddenMods = state.hiddenMods.filter(
        (iterMod) => !modsAlreadyHidden.find((mod) => mod.name === iterMod.name)
      );
      state.hiddenMods = state.hiddenMods.concat(modsToAdd);
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
} = appSlice.actions;

export default appSlice.reducer;
