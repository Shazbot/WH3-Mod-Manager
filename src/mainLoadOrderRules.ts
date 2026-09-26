import appData from "./appData";
import { resolveLoadOrderRules } from "./loadOrderRules";
import { setActiveLoadOrderEdges } from "./modSortingHelpers";

/**
 * Republishes the ordering rules for main's own sorting - most importantly the used_mods.txt the
 * game actually reads, so what the user sees in the list is what gets loaded.
 *
 * Main has no redux, so the module level registry in modSortingHelpers is the only channel here.
 * Call this whenever either half of the input changes: the user's rules arrive with every config
 * save, the mods' own rules with every scan.
 */
export function refreshMainLoadOrderRules() {
  const { edges } = resolveLoadOrderRules({
    userRules: appData.loadOrderRules,
    modRules: appData.modLoadOrderRules,
    disabledRuleKeys: appData.disabledModLoadOrderRules,
    disabledPackNames: appData.loadOrderRuleDisabledPacks,
    presentPackNames: appData.allMods.map((mod) => mod.name),
  });

  setActiveLoadOrderEdges(edges);
}
