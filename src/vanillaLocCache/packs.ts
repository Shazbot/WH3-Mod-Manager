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
/**
 * The app's language codes are not always the game's, so they are mapped rather than interpolated.
 *
 * Only the codes that differ are listed; anything absent uses its own code, which is right for en,
 * fr, ru, pl, tr and zh. Japanese has no pack in WH3 and falls back to English, but is still probed
 * under both spellings so a release that adds one is picked up without a code change.
 */
export const GAME_PACK_CODES_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  de: ["ge"],
  es: ["sp"],
  ko: ["kr"],
  pt: ["br"],
  ja: ["ja", "jp"],
};

export const getVanillaLocalisationPackNames = (
  allVanillaPackNames: Iterable<string>,
  currentLanguage: string | undefined,
  /** Read the game's English strings whatever the app is set to. Off by default. */
  useEnglishLocalizations = false,
): string[] => {
  const packNames = [...allVanillaPackNames];
  const packsForCode = (code: string) => packNames.filter((packName) => packName.startsWith(`local_${code}`)).sort();

  const language = useEnglishLocalizations ? "en" : currentLanguage || "en";
  const englishPacks = packsForCode("en");
  if (language === "en") return englishPacks;

  // Empty when the language ships no pack, which leaves English as the whole answer.
  const languagePacks = (GAME_PACK_CODES_BY_LANGUAGE[language] ?? [language]).flatMap(packsForCode);
  return [...englishPacks, ...languagePacks];
};

export const getVanillaLocalisationPackPaths = (
  allVanillaPackNames: Iterable<string>,
  currentLanguage: string | undefined,
  dataFolder: string,
  useEnglishLocalizations = false,
): string[] =>
  getVanillaLocalisationPackNames(allVanillaPackNames, currentLanguage, useEnglishLocalizations).map((packName) =>
    nodePath.join(dataFolder, packName),
  );
