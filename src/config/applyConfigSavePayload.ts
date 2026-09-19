import appData from "../appData";
import { getEnabledMods } from "../modsHelpers";
import { refreshMainLoadOrderRules } from "../mainLoadOrderRules";
import { sanitizeRecentPackPaths } from "../utility/recentPackPaths";
import { vanillaPackNames } from "../supportedGames";

/**
 * Applies the parts of a save payload that main keeps in memory.
 *
 * Every path that receives a payload has to call this. selectConfigSavePayload only attaches the mod
 * lists when they changed since the last payload it built, so a payload that carries them and never
 * gets applied loses that update until something else happens to change them again.
 */
export function applyConfigSavePayloadToAppData(payload: ConfigSavePayload) {
  const { config } = payload;

  if (payload.mods) {
    appData.allMods = payload.mods.allMods;
    appData.enabledMods = getEnabledMods(payload.mods.currentPresetMods, config.alwaysEnabledModNames);
  }
  appData.isCompatCheckingVanillaPacks = config.isCompatCheckingVanillaPacks;
  appData.isUsingEnglishLocalizations = !!config.isUsingEnglishLocalizations;
  appData.isChangingGameProcessPriority = config.isChangingGameProcessPriority;
  appData.isRigidModelV2CompressionEnabled =
    config.isRigidModelV2CompressionEnabled ?? appData.isRigidModelV2CompressionEnabled;
  appData.compressModsOnUpload = config.compressModsOnUpload ?? appData.compressModsOnUpload;
  appData.isShowingSkillNodeSetNames = config.isShowingSkillNodeSetNames ?? appData.isShowingSkillNodeSetNames;
  appData.hideRepeatedKeyPrefixes = config.hideRepeatedKeyPrefixes ?? appData.hideRepeatedKeyPrefixes;
  appData.recentPackPaths = sanitizeRecentPackPaths(
    [...(appData.recentPackPaths ?? []), ...(config.recentPackPaths ?? [])],
    [...vanillaPackNames, ...(appData.allVanillaPackNames ?? [])],
  );
  appData.skillTreesDisplayMode = config.skillTreesDisplayMode;
  appData.technologyTreesDisplayMode = config.technologyTreesDisplayMode;

  // The rules are per game and arrive flattened for whichever game the renderer is on, so they are
  // simply mirrored and re-resolved. A game switch reaches main as a payload like any other.
  appData.loadOrderRules = config.loadOrderRules ?? [];
  appData.disabledModLoadOrderRules = config.disabledModLoadOrderRules ?? [];
  appData.loadOrderRuleDisabledPacks = config.loadOrderRuleDisabledPacks ?? [];
  refreshMainLoadOrderRules();
}
