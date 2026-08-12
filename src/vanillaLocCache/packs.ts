import * as nodePath from "path";

/**
 * The vanilla packs that carry loc tables, in ascending priority order.
 *
 * Only the local_* packs do. Every other vanilla pack has zero loc entries, so pointing the loc
 * cache at the broad pack sets the skills and technology builds read would make its identity depend
 * on packs that cannot affect it, and would give each consumer a separate cache of identical
 * content.
 *
 * Two orderings matter here, because callers fold these last-wins:
 *
 * - English comes first as the fallback, and the player's language overrides it wherever it has a
 *   string. Listing them the other way round leaves English shadowing the chosen language.
 * - A language can be more than one pack. WH3 currently ships a single local_en.pack, but has
 *   shipped suffixed ones before, so they are sorted rather than left in set order: the suffixed
 *   pack carries the later content and has to win, and set order is not something to rely on.
 *
 * The names come from the game manifest, so a pack a player has dropped in the data folder is never
 * a candidate here however it is named.
 */
export const getVanillaLocalisationPackNames = (
  allVanillaPackNames: Iterable<string>,
  currentLanguage: string | undefined,
): string[] => {
  const packNames = [...allVanillaPackNames];
  const packsForLanguage = (language: string) =>
    packNames.filter((packName) => packName.startsWith(`local_${language}`)).sort();
  const language = currentLanguage || "en";
  return [
    ...packsForLanguage("en"),
    ...(language === "en" ? [] : packsForLanguage(language)),
  ];
};

export const getVanillaLocalisationPackPaths = (
  allVanillaPackNames: Iterable<string>,
  currentLanguage: string | undefined,
  dataFolder: string,
): string[] =>
  getVanillaLocalisationPackNames(allVanillaPackNames, currentLanguage).map((packName) =>
    nodePath.join(dataFolder, packName),
  );
