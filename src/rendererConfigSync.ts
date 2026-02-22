import {
  buildStringArraySignature,
  buildStringRecordSignature,
  stableStringify,
} from "./utility/signatureHelpers";

const getPersistedModSignature = (mod: Mod, index: number) =>
  [
    index.toString(),
    mod.path,
    mod.name,
    mod.workshopId,
    mod.isEnabled ? "1" : "0",
    mod.loadOrder?.toString() ?? "",
    buildStringArraySignature(mod.categories ?? []),
  ].join("#");

const getPersistedPresetSignature = (preset: Preset) =>
  [preset.name, (preset.version ?? 0).toString(), preset.mods.map(getPersistedModSignature).join("||")].join("::");

export const buildConfigSaveSignature = (appState: AppState) => {
  return [
    appState.alwaysEnabledMods.map(getPersistedModSignature).join("||"),
    appState.hiddenMods.map(getPersistedModSignature).join("||"),
    appState.wasOnboardingEverRun ? "1" : "0",
    appState.isAuthorEnabled ? "1" : "0",
    appState.areThumbnailsEnabled ? "1" : "0",
    appState.isMakeUnitsGeneralsEnabled ? "1" : "0",
    appState.isSkipIntroMoviesEnabled ? "1" : "0",
    appState.isAutoStartCustomBattleEnabled ? "1" : "0",
    appState.isChangingGameProcessPriority ? "1" : "0",
    appState.isFeaturesForModdersEnabled ? "1" : "0",
    appState.isScriptLoggingEnabled ? "1" : "0",
    appState.isClosedOnPlay ? "1" : "0",
    appState.isCompatCheckingVanillaPacks ? "1" : "0",
    buildStringArraySignature(appState.categories),
    buildStringRecordSignature(appState.categoryColors),
    appState.modRowsSortingType,
    appState.currentLanguage ?? "",
    appState.currentGame,
    stableStringify(appState.appFolderPaths),
    stableStringify(appState.packDataOverwrites),
    stableStringify(appState.userFlowOptions),
    getPersistedPresetSignature(appState.currentPreset),
    appState.presets.map(getPersistedPresetSignature).join("||"),
  ].join("~");
};

export const getReadModsSelection = (appState: AppState) => {
  return appState.currentPreset.mods.filter((mod) => mod.isEnabled);
};

export const buildReadModsSignature = (appState: AppState, customizableModsSignature: string) => {
  const enabledMods = getReadModsSelection(appState);

  // If all mods are enabled, there is no need to force another read through this path.
  if (enabledMods.length === appState.currentPreset.mods.length) {
    return "";
  }

  const enabledModsSignature = enabledMods
    .map((mod, index) => {
      const orderMarker = mod.loadOrder == null ? `idx:${index}` : `load:${mod.loadOrder}`;
      return `${mod.path}:${orderMarker}`;
    })
    .join("|");

  return `${appState.currentGame}|${customizableModsSignature}|${enabledModsSignature}`;
};
