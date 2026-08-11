import hash from "object-hash";
import { toSnapshotEntries } from "./presetEntries";
import { CONFIG_VERSION } from "./migrateAppConfig";

/**
 * Per-mod data the config keeps for the current game. Built from the live mod list so it stays in
 * step with what Steam has told us, instead of being frozen into every preset the way it used to be.
 */
const buildModUserData = (mods: Mod[]) => {
  const modUserData: Record<string, StoredModUserData> = {};

  for (const mod of mods) {
    const userData: StoredModUserData = {};
    if (mod.categories && mod.categories.length > 0) userData.categories = mod.categories;
    if (mod.humanName) userData.humanName = mod.humanName;
    if (mod.author) userData.author = mod.author;
    if (mod.reqModIdToName && mod.reqModIdToName.length > 0) userData.reqModIdToName = mod.reqModIdToName;

    if (Object.keys(userData).length > 0) modUserData[mod.name] = userData;
  }

  return modUserData;
};

let lastSentModsHash: string | undefined;

/** Only for tests and for resetting between renderer sessions. */
export const resetConfigSavePayloadCache = () => {
  lastSentModsHash = undefined;
};

/**
 * Builds what the renderer sends to main on every debounced store change.
 *
 * The renderer used to ship the whole Redux state — including parsed pack tables, skills data and
 * toasts — several times a second just so main could pick ~30 keys out of it. This sends the config
 * fields plus, only when they actually changed, the mod lists main needs for appData and the window
 * title.
 */
export function selectConfigSavePayload(appState: AppState): ConfigSavePayload {
  const currentPresetMods = appState.currentPreset.mods;

  const payload: ConfigSavePayload = {
    currentGame: appState.currentGame,
    config: {
      configVersion: CONFIG_VERSION,
      currentPreset: {
        name: appState.currentPreset.name,
        mods: toSnapshotEntries(currentPresetMods),
        version: appState.currentPreset.version,
      },
      presets: appState.presets,
      modUserData: buildModUserData(currentPresetMods),
      alwaysEnabledModNames: appState.alwaysEnabledModNames,
      hiddenModNames: appState.hiddenModNames,
      wasOnboardingEverRun: appState.wasOnboardingEverRun,
      isAuthorEnabled: appState.isAuthorEnabled,
      areThumbnailsEnabled: appState.areThumbnailsEnabled,
      isMakeUnitsGeneralsEnabled: appState.isMakeUnitsGeneralsEnabled,
      isScriptLoggingEnabled: appState.isScriptLoggingEnabled,
      isSkipIntroMoviesEnabled: appState.isSkipIntroMoviesEnabled,
      isAutoStartCustomBattleEnabled: appState.isAutoStartCustomBattleEnabled,
      isChangingGameProcessPriority: appState.isChangingGameProcessPriority,
      isFeaturesForModdersEnabled: appState.isFeaturesForModdersEnabled,
      moddersPrefix: appState.moddersPrefix,
      isClosedOnPlay: appState.isClosedOnPlay,
      isCompatCheckingVanillaPacks: appState.isCompatCheckingVanillaPacks,
      categories: appState.categories,
      categoryColors: appState.categoryColors,
      modRowsSortingType: appState.modRowsSortingType,
      currentLanguage: appState.currentLanguage,
      currentGame: appState.currentGame,
      packDataOverwrites: appState.packDataOverwrites,
      userFlowOptions: appState.userFlowOptions,
      nodeEditorFavorites: appState.nodeEditorFavorites,
      isShowingSkillNodeSetNames: appState.isShowingSkillNodeSetNames,
      isShowingHiddenSkills: appState.isShowingHiddenSkills,
      isShowingHiddenModifiersInsideSkills: appState.isShowingHiddenModifiersInsideSkills,
      isCheckingSkillRequirements: appState.isCheckingSkillRequirements,
      skillTreesDisplayMode: appState.skillTreesDisplayMode,
      technologyTreesDisplayMode: appState.technologyTreesDisplayMode,
    },
  };

  const modsHash = hash({
    allMods: appState.allMods.map((mod) => [mod.name, mod.path, mod.isEnabled]),
    currentPresetMods: currentPresetMods.map((mod) => [mod.name, mod.path, mod.isEnabled]),
  });
  if (modsHash !== lastSentModsHash) {
    lastSentModsHash = modsHash;
    payload.mods = { allMods: appState.allMods, currentPresetMods };
  }

  return payload;
}
