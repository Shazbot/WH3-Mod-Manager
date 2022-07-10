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
  } as AppState,
  reducers: {
    toggleMod: (state, action: PayloadAction<Mod>) => {
      const inputMod = action.payload;
      const mod = state.currentPreset.mods.find((mod) => mod.workshopId == inputMod.workshopId);
      mod.isEnabled = !mod.isEnabled;
    },
    enableAll: (state) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = true));
    },
    disableAll: (state) => {
      state.currentPreset.mods.forEach((mod) => (mod.isEnabled = false));
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
      const appState = action.payload;
      appState.currentPreset.mods
        .filter((mod) => mod !== undefined)
        .map((mod) => {
          const existingMod = state.currentPreset.mods.find((statelyMod) => statelyMod.name == mod.name);
          if (existingMod) {
            existingMod.isEnabled = mod.isEnabled;
            if (mod.humanName !== "") existingMod.humanName = mod.humanName;
            if (mod.loadOrder !== undefined) existingMod.loadOrder = mod.loadOrder;
          }
        });
      appState.presets.forEach((preset) => {
        if (!state.presets.find((existingPreset) => existingPreset.name === preset.name)) {
          state.presets.push(preset);
        }
      });
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
} = appSlice.actions;

export default appSlice.reducer;
