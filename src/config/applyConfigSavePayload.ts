import appData from "../appData";
import { getEnabledMods } from "../modsHelpers";

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
  appData.isChangingGameProcessPriority = config.isChangingGameProcessPriority;
  appData.skillTreesDisplayMode = config.skillTreesDisplayMode;
  appData.technologyTreesDisplayMode = config.technologyTreesDisplayMode;
}
