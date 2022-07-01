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
      if (state.currentPreset.mods.length > 0) return;
      state.currentPreset.mods = mods;
    },
    setModData: (state, action: PayloadAction<ModData>) => {
      const data = action.payload;
      state.currentPreset.mods.find((mod) => mod.workshopId == data.workshopId).humanName = data.humanName;
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
} = appSlice.actions;

export default appSlice.reducer;
