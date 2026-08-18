/**
 * Types for the Ancillaries panel.
 *
 * Split from `data.ts` the same way `buildingsData/types.ts` is, so the renderer can import the
 * payload shapes without dragging in anything that touches electron or pack reading.
 */

/** Rows as they come out of `getTableRowData` + `schemaRowToRecord`: one record per row. */
export type AncillariesTableRows = Record<string, Array<Record<string, string>>>;

/** The part of a loc trie a lookup needs. Structurally identical to the buildings one. */
export interface AncillariesLocTrie {
  get(key: string): string | undefined;
}

/**
 * Where a row came from.
 *
 * `undefined` means vanilla. Mod rows carry the pack path so the "filter by mod" dropdown can
 * select them, the same way `UnitViewerCatalogUnit.originPackPath` does.
 */
export type AncillariesOrigin = string | undefined;

// ---------------------------------------------------------------------------
// Rows, parsed
// ---------------------------------------------------------------------------

export interface AncillaryCategoryRow {
  key: string;
  /** `ancillaries_categories_tables.icon_name`, a bare name under `ui\skins\default\`. */
  iconName?: string;
  sortOrder: number;
  /** `ancillaries_categories_onscreen_name_<category>`, falling back to the key. */
  localizedName: string;
  /** Set by the main process to a `whmm://icon/...` URL, when the icon was found. */
  iconUrl?: string;
}

export interface AncillarySubcategoryRow {
  key: string;
  /** `ancillaries_subcategories_onscreen_name_<subcategory>`, falling back to the key. */
  localizedName: string;
}

export interface AncillaryEffectRow {
  ancillary: string;
  effectKey: string;
  scope: string;
  value: number;
  /** Localised through `effects_description_<key>` with the value substituted. */
  localizedKey: string;
  /** The `effects_tables.icon` file name, before the folder prefix. */
  icon?: string;
  /** Set by the main process to a `whmm://icon/...` URL, when the icon was found. */
  iconUrl?: string;
  /** False when `effects_tables.is_positive_value_good` is off, so the panel can colour it. */
  isPositiveValueGood: boolean;
  /**
   * True when this row is a pending edit rather than one of the source rows.
   *
   * Only these can be removed: `ancillary_to_effects_tables` is keyed on `(ancillary, effect)`, and
   * a pack can add or override that pair but never delete one the game already ships.
   */
  isPending?: boolean;
  /** The pending row's id, so the panel can dispatch `setCell` / `removeRow` against it. */
  pendingRowId?: string;
}

/** One entry in the left-hand browser. The detail panel fetches the rest on selection. */
export interface AncillarySummary {
  key: string;
  /** `ancillaries_onscreen_name_<key>`, falling back to the key. */
  localizedName: string;
  category: string;
  /** Empty for most rows; the browser files those under a "(no subcategory)" bucket. */
  subcategory: string;
  /** `ancillaries_tables.type`, the join onto `ancillary_types_tables.ui_icon`. */
  type: string;
  /** Resolved `ancillary_types_tables.ui_icon`, pack-relative. */
  iconPath?: string;
  /** Set by the main process to a `whmm://icon/...` URL, when the icon was found. */
  iconUrl?: string;
  originPackPath?: string;
}

/** Everything the detail card shows for one ancillary. */
export interface AncillaryDetail extends AncillarySummary {
  /** `ancillaries_explanation_text_<key>`. */
  explanation?: string;
  /** `ancillaries_colour_text_<key>`: the flavour paragraph. */
  colourText?: string;
  categoryName: string;
  subcategoryName?: string;
  effects: AncillaryEffectRow[];
  /** The whole `ancillaries_tables` row, so the inline editor can seed an override from it. */
  rowValues: Record<string, string>;
  /** True when an `ancillary_info_tables` row exists; `ancillaries.key` references it. */
  hasInfoRow: boolean;
}

// ---------------------------------------------------------------------------
// The built, indexed dataset
// ---------------------------------------------------------------------------

export interface BuiltAncillariesData {
  categories: AncillaryCategoryRow[];
  subcategories: AncillarySubcategoryRow[];
  /** Every ancillary, sorted by category sort order then localized name. */
  ancillaries: AncillarySummary[];
  /** The full source row per ancillary, for the inline editor and the detail card. */
  rowValuesByKey: Record<string, Record<string, string>>;
  /** `ancillary_info_tables.ancillary` values, so a missing info row can be reported. */
  infoKeys: string[];
  effectsByAncillary: Record<string, AncillaryEffectRow[]>;
  /** `ancillary_types_tables.type` -> `ui_icon`. Absent for a type row with no icon. */
  typeIcons: Record<string, string>;
  /** Every `ancillary_types_tables.type`, including any without an icon. */
  typeKeys: string[];
  /** Every effect, flagged with whether an ancillary uses it. Named only where one does. */
  effects: AncillariesEffectOption[];
  /** The `effect_scope` values `ancillary_to_effects_tables` actually uses. */
  effectScopes: string[];
  /**
   * Per effect an ancillary uses: its icon, and its description with the text replacements already
   * resolved but the value not yet substituted.
   *
   * Kept for the same reason `BuiltBuildingsData.effectMeta` is: a *pending* effect row has to be
   * localised after the loc tries have been released.
   */
  effectMeta: Record<string, { icon?: string; description?: string; isPositiveValueGood: boolean }>;
  /** max observed + 1, per table in `gameToTablesWithNumericIds` a clone may pull in. */
  nextNumericIds: Record<string, number>;
}

export interface AncillariesOption {
  key: string;
  localizedName: string;
}

export interface AncillariesEffectOption extends AncillariesOption {
  /**
   * Whether some ancillary already has this effect.
   *
   * Only these carry a localised name and a registered icon; the other ~13k are left as bare keys
   * rather than inflating the disk cache. The "+ Add effect" picker defaults to these.
   */
  usedByAncillaries: boolean;
  /** Most frequent non-empty scope in `ancillary_to_effects_tables`; alphabetical on a tie. */
  preferredScope?: string;
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

export interface AncillariesCatalog {
  categories: AncillaryCategoryRow[];
  subcategories: AncillarySubcategoryRow[];
  ancillaries: AncillarySummary[];
  effects: AncillariesEffectOption[];
  effectScopes: string[];
  /** Every `ancillary_types_tables.type`, sorted. The type picker's options. */
  types: AncillariesOption[];
  /** Where the vanilla DB tables live, so the renderer never joins paths itself. */
  dbPackPath: string;
  /** Per ancillaries table, the schema its new rows have to be written with. */
  tableSchemas: Record<string, import("../packFileTypes").DBVersion>;
  moddersPrefix: string;
  nextNumericIds: Record<string, number>;
}

export interface AncillariesCatalogResponse {
  success: boolean;
  error?: string;
  catalog?: AncillariesCatalog;
}

export interface AncillariesDetailResponse {
  success: boolean;
  error?: string;
  detail?: AncillaryDetail;
  /** Catalog options rebuilt from the same effective rows as the detail. */
  catalog?: AncillariesCatalog;
  /**
   * Problems with the pending rows, checked against the data they will land in. Rides this response
   * because it is already the call that carries the pending rows to main on every edit.
   */
  rowIssues?: import("./validate").AncillariesRowIssue[];
}
