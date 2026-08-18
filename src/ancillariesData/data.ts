/**
 * Turns the raw ancillary DB rows into the indexed structures the panel renders.
 *
 * Pure: no electron, no fs, no pack reading. `ipcMainListeners` supplies the rows and the loc
 * lookup; the renderer imports the same output shape so it can re-derive after an edit.
 */
import {
  formatEffectLocalization,
  getRawEffectLocalization,
  resolveTextReplacements,
  stripLocImgTags,
} from "../skills";
import type {
  AncillariesEffectOption,
  AncillariesLocTrie,
  AncillariesTableRows,
  AncillaryCategoryRow,
  AncillaryEffectRow,
  AncillarySubcategoryRow,
  AncillarySummary,
  BuiltAncillariesData,
} from "./types";

export type AncillariesGetLoc = (key: string) => string | undefined;

/**
 * The tables the Ancillaries tab reads.
 *
 * `ancillary_info_tables` is here because `ancillaries_tables.key` *references* it - a new
 * ancillary without an info row is a dangling key, which `validate.ts` reports.
 */
export const ANCILLARY_TABLES = [
  "ancillaries_tables",
  "ancillary_info_tables",
  "ancillary_types_tables",
  "ancillaries_categories_tables",
  "ancillaries_subcategories_tables",
  "ancillary_to_effects_tables",
  "effects_tables",
] as const;

/**
 * The key columns per table, used for override collapsing and collision detection.
 *
 * `ancillary_to_effects_tables` is keyed on `(ancillary, effect)` and *not* `effect_scope`: a row
 * with the same pair replaces both the scope and the value, and no pack can ever remove one.
 */
export const ANCILLARY_TABLE_KEY_COLUMNS: Record<string, string[]> = {
  ancillaries_tables: ["key"],
  ancillary_info_tables: ["ancillary"],
  ancillary_types_tables: ["type"],
  ancillaries_categories_tables: ["category"],
  ancillaries_subcategories_tables: ["subcategory"],
  ancillary_to_effects_tables: ["ancillary", "effect"],
  effects_tables: ["effect"],
};

/** Where the browser files an ancillary whose `subcategory` cell is empty. */
export const NO_SUBCATEGORY = "";

const str = (row: Record<string, string>, column: string) => (row[column] ?? "").trim();
const num = (row: Record<string, string>, column: string, fallback = 0) => {
  const parsed = Number(row[column]);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (row: Record<string, string>, column: string, fallback = false) => {
  const value = (row[column] ?? "").trim().toLowerCase();
  if (value === "") return fallback;
  return value === "true" || value === "1";
};
const optional = (value: string) => (value === "" ? undefined : value);

/**
 * Collapses rows by their composite key, keeping the last one.
 *
 * Rows arrive vanilla first and then mods in load order, so "last wins" is exactly the game's own
 * override behaviour.
 */
export const dedupeRowsByKey = (
  tableName: string,
  rows: Array<Record<string, string>> | undefined,
): Array<Record<string, string>> => {
  if (!rows || rows.length === 0) return [];
  const keyColumns = ANCILLARY_TABLE_KEY_COLUMNS[tableName];
  if (!keyColumns || keyColumns.length === 0) return rows;
  const byKey = new Map<string, Record<string, string>>();
  for (const row of rows) {
    byKey.set(keyColumns.map((column) => row[column] ?? "").join("|"), row);
  }
  return [...byKey.values()];
};

const localize = (getLoc: AncillariesGetLoc, key: string) => {
  const localized = getLoc(key);
  if (!localized) return undefined;
  return stripLocImgTags(resolveTextReplacements(localized, getLoc) || localized) || undefined;
};

export const ancillaryNameLocKey = (key: string) => `ancillaries_onscreen_name_${key}`;
export const ancillaryExplanationLocKey = (key: string) => `ancillaries_explanation_text_${key}`;
export const ancillaryColourTextLocKey = (key: string) => `ancillaries_colour_text_${key}`;

/** Pack-relative path of a category's icon; `icon_name` is a bare name, not a path. */
export const categoryIconPath = (iconName: string) => `ui\\skins\\default\\${iconName}.png`;

/** `ancillary_types_tables.ui_icon` ships with forward slashes and mixed case. */
export const normalizeIconPath = (uiIcon: string) => uiIcon.replace(/\//g, "\\");

export const buildAncillariesData = (
  tables: AncillariesTableRows,
  getLoc: AncillariesGetLoc,
  /** Ancillary key -> the pack that last defined it. Vanilla keys are absent. */
  originPackPathByAncillary: Record<string, string> = {},
): BuiltAncillariesData => {
  const rowsOf = (tableName: string) => dedupeRowsByKey(tableName, tables[tableName]);

  // --- categories and subcategories ------------------------------------------
  const categories: AncillaryCategoryRow[] = [];
  for (const row of rowsOf("ancillaries_categories_tables")) {
    const key = str(row, "category");
    if (!key) continue;
    categories.push({
      key,
      iconName: optional(str(row, "icon_name")),
      sortOrder: num(row, "sort_order"),
      localizedName: localize(getLoc, `ancillaries_categories_onscreen_name_${key}`) || key,
    });
  }
  categories.sort((a, b) => a.sortOrder - b.sortOrder || a.localizedName.localeCompare(b.localizedName));
  const categoryOrder = new Map(categories.map((category, index) => [category.key, index]));

  const subcategories: AncillarySubcategoryRow[] = [];
  for (const row of rowsOf("ancillaries_subcategories_tables")) {
    const key = str(row, "subcategory");
    if (!key) continue;
    subcategories.push({
      key,
      localizedName: localize(getLoc, `ancillaries_subcategories_onscreen_name_${key}`) || key,
    });
  }
  subcategories.sort((a, b) => a.localizedName.localeCompare(b.localizedName));

  // --- types ------------------------------------------------------------------
  const typeIcons: Record<string, string> = {};
  const typeKeys: string[] = [];
  for (const row of rowsOf("ancillary_types_tables")) {
    const type = str(row, "type");
    if (!type) continue;
    typeKeys.push(type);
    const uiIcon = str(row, "ui_icon");
    if (uiIcon) typeIcons[type] = normalizeIconPath(uiIcon);
  }
  typeKeys.sort();

  // --- effects ----------------------------------------------------------------
  const effectIcons: Record<string, string | undefined> = {};
  const effectPositive: Record<string, boolean> = {};
  for (const row of rowsOf("effects_tables")) {
    const effect = str(row, "effect");
    if (!effect) continue;
    effectIcons[effect] = optional(str(row, "icon"));
    effectPositive[effect] = bool(row, "is_positive_value_good", true);
  }

  // Only effects some ancillary actually uses carry a description. Held because a *pending* effect
  // row still has to be localised after the loc tries are released, and keeping all ~15k would
  // inflate the disk cache for nothing.
  const effectMeta: BuiltAncillariesData["effectMeta"] = {};
  const effectScopeCounts: Record<string, Map<string, number>> = {};
  const effectsByAncillary: Record<string, AncillaryEffectRow[]> = {};
  for (const row of rowsOf("ancillary_to_effects_tables")) {
    const ancillary = str(row, "ancillary");
    const effectKey = str(row, "effect");
    if (!ancillary || !effectKey) continue;
    if (!effectMeta[effectKey]) {
      const description = getRawEffectLocalization(effectKey, getLoc);
      effectMeta[effectKey] = {
        icon: effectIcons[effectKey],
        description: description === effectKey ? undefined : description,
        isPositiveValueGood: effectPositive[effectKey] ?? true,
      };
    }
    const scope = str(row, "effect_scope");
    if (scope) {
      const counts = (effectScopeCounts[effectKey] ||= new Map());
      counts.set(scope, (counts.get(scope) ?? 0) + 1);
    }
    const value = num(row, "value");
    (effectsByAncillary[ancillary] ||= []).push({
      ancillary,
      effectKey,
      scope,
      value,
      localizedKey: formatEffectLocalization(effectKey, value, getLoc),
      icon: effectIcons[effectKey],
      isPositiveValueGood: effectPositive[effectKey] ?? true,
    });
  }
  for (const rows of Object.values(effectsByAncillary)) {
    rows.sort((a, b) => a.localizedKey.localeCompare(b.localizedKey));
  }

  // Every effect in the game, flagged with whether an ancillary uses it, so the picker can offer
  // the used ones first but still reach the rest.
  const effects: AncillariesEffectOption[] = rowsOf("effects_tables")
    .map((row) => str(row, "effect"))
    .filter((key) => key !== "")
    .map((key) => ({
      key,
      localizedName: effectMeta[key]?.description || key,
      usedByAncillaries: effectMeta[key] != undefined,
      preferredScope: [...(effectScopeCounts[key] ?? [])].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]?.[0],
    }))
    .sort((a, b) => a.localizedName.localeCompare(b.localizedName));

  const effectScopeSet = new Set<string>();
  for (const row of rowsOf("ancillary_to_effects_tables")) {
    const scope = str(row, "effect_scope");
    if (scope) effectScopeSet.add(scope);
  }
  const effectScopes = [...effectScopeSet].sort();

  // --- ancillaries ------------------------------------------------------------
  const ancillaries: AncillarySummary[] = [];
  const rowValuesByKey: Record<string, Record<string, string>> = {};
  for (const row of rowsOf("ancillaries_tables")) {
    const key = str(row, "key");
    if (!key) continue;
    rowValuesByKey[key] = row;
    const type = str(row, "type");
    ancillaries.push({
      key,
      localizedName: localize(getLoc, ancillaryNameLocKey(key)) || key,
      category: str(row, "category"),
      subcategory: str(row, "subcategory"),
      type,
      iconPath: typeIcons[type],
      originPackPath: originPackPathByAncillary[key],
    });
  }
  ancillaries.sort(
    (a, b) =>
      (categoryOrder.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
        (categoryOrder.get(b.category) ?? Number.MAX_SAFE_INTEGER) ||
      a.subcategory.localeCompare(b.subcategory) ||
      a.localizedName.localeCompare(b.localizedName),
  );

  const infoKeys = rowsOf("ancillary_info_tables")
    .map((row) => str(row, "ancillary"))
    .filter((key) => key !== "");

  return {
    categories,
    subcategories,
    ancillaries,
    rowValuesByKey,
    infoKeys,
    effectsByAncillary,
    typeIcons,
    typeKeys,
    effects,
    effectScopes,
    effectMeta,
    // None of ANCILLARY_TABLES uses a synthetic numeric id; a deep clone that pulls one in seeds
    // its own cursor from the catalog, so this starts empty rather than absent.
    nextNumericIds: {},
  };
};

/** Consults tries in reverse pack order, so a later pack shadows an earlier one. */
export const createAncillariesLocLookup = (
  triesInPackOrder: Array<AncillariesLocTrie | undefined>,
): AncillariesGetLoc => {
  const tries = triesInPackOrder.filter((trie): trie is AncillariesLocTrie => !!trie).toReversed();
  return (key: string) => {
    for (const trie of tries) {
      const value = trie.get(key);
      if (value != undefined) return value;
    }
    return undefined;
  };
};
