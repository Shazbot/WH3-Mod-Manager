export type SkillSetCultureSources = {
  subcultureToCulture: Record<string, string>;
  factionToSubculture: Record<string, string>;
  subtypeToFactions: Record<string, string[]>;
};

export const createEmptySkillSetCultureSources = (): SkillSetCultureSources => ({
  subcultureToCulture: {},
  factionToSubculture: {},
  subtypeToFactions: {},
});

type SkillSetForCulture = { key: string; agentSubtype: string; factionKey: string; subculture: string };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** `wh_main_vmp_vampire_counts` -> `vmp`, `wh2_main_rogue` -> `rogue`. */
const getCultureCode = (cultureKey: string) => cultureKey.split("_")[2] ?? "";

/**
 * Works out a culture for each skill set, using the first step that gives one:
 * the set's subculture, the set's faction, the cultures of factions permitting its subtype
 * (preferring one whose code appears in the set or subtype key, then the most factions),
 * and finally any known culture whose code appears in the set or subtype key.
 * Sets with no result are left out.
 */
export const resolveSkillSetCultures = (
  subtypeAndSets: SkillSetForCulture[],
  sources: SkillSetCultureSources,
): Record<string, string> => {
  const { subcultureToCulture, factionToSubculture, subtypeToFactions } = sources;
  const allCultures = Array.from(new Set(Object.values(subcultureToCulture))).sort(collator.compare);
  const result: Record<string, string> = {};

  for (const set of subtypeAndSets) {
    const direct =
      (set.subculture && subcultureToCulture[set.subculture]) ||
      (set.factionKey && subcultureToCulture[factionToSubculture[set.factionKey]]);
    if (direct) {
      result[set.key] = direct;
      continue;
    }

    const tokenGroups = [set.key.split("_"), set.agentSubtype.split("_")];
    const counts = new Map<string, number>();
    for (const faction of subtypeToFactions[set.agentSubtype] ?? []) {
      const culture = subcultureToCulture[factionToSubculture[faction]];
      if (culture) counts.set(culture, (counts.get(culture) ?? 0) + 1);
    }

    const findByCode = (cultures: string[]) => {
      for (const tokens of tokenGroups) {
        for (const culture of cultures) {
          if (tokens.includes(getCultureCode(culture))) return culture;
        }
      }
      return undefined;
    };

    if (counts.size) {
      const candidates = Array.from(counts.keys()).sort((a, b) => counts.get(b)! - counts.get(a)! || collator.compare(a, b));
      result[set.key] = findByCode(candidates) ?? candidates[0];
      continue;
    }
    const matched = findByCode(allCultures);
    if (matched) result[set.key] = matched;
  }
  return result;
};

/** The renderer-facing culture data sent with SkillsData. */
export const getSkillSetCultureData = (
  subtypeAndSets: SkillSetForCulture[],
  sources: SkillSetCultureSources,
  getLoc: (locId: string) => string | undefined,
) => {
  const setToCulture = resolveSkillSetCultures(subtypeAndSets, sources);
  const culturesToLocalizedNames: Record<string, string> = {};
  for (const culture of new Set(Object.values(setToCulture))) {
    const name = getLoc(`cultures_name_${culture}`);
    if (name) culturesToLocalizedNames[culture] = name;
  }
  return { setToCulture, culturesToLocalizedNames };
};
