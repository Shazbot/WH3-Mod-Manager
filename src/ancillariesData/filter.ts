/**
 * The browser's filter box.
 *
 * Regex enabled, unlike the Unit Viewer's substring-only box. The catch with a live regex box is
 * that every prefix of a real pattern is typed at some point, and `[` or `(` on its own throws -
 * so an uncompilable pattern falls back to a case-insensitive substring match rather than emptying
 * the list under the user's cursor. `isValidRegex` lets the input say which mode it is in.
 */
import type { AncillarySummary } from "./types";

export interface AncillaryFilter {
  matches: (ancillary: AncillarySummary) => boolean;
  /** False while the pattern does not compile; the box marks itself and matches as a substring. */
  isValidRegex: boolean;
  /** True when the box is empty, so callers can skip filtering entirely. */
  isEmpty: boolean;
}

/** Everything a pattern is tested against, joined once per ancillary. */
const haystack = (ancillary: AncillarySummary) =>
  `${ancillary.localizedName} ${ancillary.key} ${ancillary.category} ${ancillary.subcategory}`;

export const createAncillaryFilter = (pattern: string): AncillaryFilter => {
  const trimmed = pattern.trim();
  if (trimmed === "") return { matches: () => true, isValidRegex: true, isEmpty: true };

  try {
    const regex = new RegExp(trimmed, "i");
    return { matches: (ancillary) => regex.test(haystack(ancillary)), isValidRegex: true, isEmpty: false };
  } catch {
    const lowered = trimmed.toLowerCase();
    return {
      matches: (ancillary) => haystack(ancillary).toLowerCase().includes(lowered),
      isValidRegex: false,
      isEmpty: false,
    };
  }
};

export const ALL_ANCILLARY_MODS = "all";
export const VANILLA_ANCILLARY_MODS = "vanilla";

/** Applies the "filter by mod" dropdown, matching the Unit Viewer's three-way selection. */
export const matchesModFilter = (ancillary: AncillarySummary, modFilter: string) => {
  if (modFilter === ALL_ANCILLARY_MODS) return true;
  if (modFilter === VANILLA_ANCILLARY_MODS) return !ancillary.originPackPath;
  return ancillary.originPackPath === modFilter;
};
