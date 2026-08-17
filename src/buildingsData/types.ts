/**
 * Types for the Buildings panel.
 *
 * Split from `data.ts` / `derive.ts` so `src/index.d.ts` can alias the payload shapes into the
 * global namespace without dragging the builders in, and so the renderer can import the derivation
 * types without importing anything that touches electron.
 */

/** Rows as they come out of `getTableRowData` + `schemaRowToRecord`: one record per row. */
export type BuildingsTableRows = Record<string, Array<Record<string, string>>>;

/** The part of a loc trie a lookup needs. Structurally identical to the unit viewer's. */
export interface BuildingsLocTrie {
  get(key: string): string | undefined;
}

// ---------------------------------------------------------------------------
// Rows, parsed
// ---------------------------------------------------------------------------

export interface BuildingChainRow {
  key: string;
  superChain: string;
  chainCategory?: string;
  sortOrder: number;
  tierIcon?: string;
  canBeDismantled: boolean;
  isForeignSlotChain: boolean;
  /** `building_chains_encyclopedia_name_<key>`, falling back to the key. */
  localizedName: string;
  /** `building_chains_chain_tooltip_<key>`. */
  tooltip?: string;
}

export interface BuildingLevelRow {
  levelKey: string;
  chain: string;
  level: number;
  createTime: number;
  createCost: number;
  upkeepCost: number;
  foodCost: number;
  developmentPointCost: number;
  onlyInCapital: boolean;
  factionUnique: boolean;
  visibleInUi: boolean;
  /**
   * `primary_slot_building_building_level_requirement`: the primary settlement level this building
   * needs. It is also the row the game draws it on - see `BuildingsTile.tierRow`.
   */
  primarySlotLevelRequirement: number;
  instanceKey?: string;
  commodity?: string;
  resourceRequirement?: string;
  religionRequirement?: string;
}

export interface BuildingVariantRow {
  building: string;
  culture: string;
  subculture: string;
  faction: string;
  description?: string;
  shortDescription?: string;
  icon?: string;
  disables: boolean;
  displayTooltip: boolean;
  frameOverride?: string;
  /** How specific this variant is: 4*faction + 2*subculture + 1*culture. */
  specificity: number;
}

export interface BuildingSetRow {
  key: string;
  icon?: string;
  sortOrder: number;
  colourR: number;
  colourG: number;
  colourB: number;
  showInUi: boolean;
  localizedName: string;
}

/** A `building_set_to_building_junctions` row: binds a chain *or* a level to a set. */
export interface BuildingSetBinding {
  chain?: string;
  level?: string;
  set: string;
  exclude: boolean;
}

export interface ChainSetItem {
  set: string;
  chain?: string;
  superChain?: string;
  remove: boolean;
}

/** A `slot_template_permitted_building_chains` row. */
export interface PermittedChainRow {
  slotTemplate: string;
  chain?: string;
  chainSet?: string;
  superChain?: string;
  remove: boolean;
}

export interface RegionSlot {
  campaign: string;
  region: string;
  slotTemplate: string;
  slotType: string;
  /** Internal row identity; the extracted startpos table itself has no index column. */
  id: string;
  /** True when this slot came from the selected faction's foreign/allied slot set. */
  isForeignSlot?: boolean;
}

export interface StartPosSettlement {
  campaign: string;
  region: string;
  settlementId: string;
  settlementType?: string;
  /** primary_building, building1..5 and port_building, empties dropped. */
  buildings: string[];
}

export interface AvailabilityRow {
  id: string;
  setId: string;
  culture: string;
  subCulture: string;
  faction: string;
  campaign: string;
}

export interface SettlementTypeBinding {
  chain: string;
  settlementType: string;
  exclude: boolean;
}

export interface BuildingEffectRow {
  building: string;
  effectKey: string;
  scope: string;
  value: number;
  /** Localised through `effects_description_<key>` with the value substituted. */
  localizedKey: string;
  /** The `effects_tables.icon` file name, before the folder prefix. */
  icon?: string;
  /** Set by the main process to a `whmm://icon/...` URL, when the icon was found. */
  iconUrl?: string;
}

export interface BuildingUnitRow {
  unitKey: string;
  localizedName: string;
  /** Pack-relative unit card path; the main process turns it into `cardUrl`. */
  cardPath?: string;
  /** Set by the main process to a `whmm://icon/...` URL, when the card was found. */
  cardUrl?: string;
  /** Only set for recruitment rows that restrict themselves to one faction. */
  faction?: string;
  xp?: number;
  /** Only set for garrison rows. */
  unitGroup?: string;
  priority?: number;
}

// ---------------------------------------------------------------------------
// The built, indexed dataset
// ---------------------------------------------------------------------------

export interface BuiltBuildingsData {
  /** Vanilla construction-panel frame, cached as base64 so it survives the buildings disk cache. */
  buildingFrame?: string;
  superChains: Record<string, string[]>;
  chains: Record<string, BuildingChainRow>;
  levelsByKey: Record<string, BuildingLevelRow>;
  /** Level keys per chain, ascending by `level`. */
  levelKeysByChain: Record<string, string[]>;
  variantsByLevel: Record<string, BuildingVariantRow[]>;
  instances: Record<string, number>;
  sets: Record<string, BuildingSetRow>;
  setBindings: BuildingSetBinding[];
  chainSetParents: Record<string, string | undefined>;
  chainSetItems: Record<string, ChainSetItem[]>;
  permittedByTemplate: Record<string, PermittedChainRow[]>;
  superChainsByTemplate: Record<string, string[]>;
  /** Keyed `campaign|region`. */
  regionSlotTemplates: Record<string, RegionSlot[]>;
  /** Keyed `campaign|region|faction`, after joining foreign slots through their slot sets. */
  foreignRegionSlotTemplates: Record<string, RegionSlot[]>;
  /** Keyed `campaign|region`. */
  startPosSettlements: Record<string, StartPosSettlement[]>;
  availabilitySetsByChain: Record<string, string[]>;
  availabilitiesBySetId: Record<string, AvailabilityRow[]>;
  settlementTypeBindings: Record<string, SettlementTypeBinding[]>;
  upgrades: Array<{ from: string; to: string }>;
  effectsByLevel: Record<string, BuildingEffectRow[]>;
  /** Expanded unit rows per armed-citizenry group, retained so pending junctions can update the board. */
  garrisonUnitsByGroup: Record<string, BuildingUnitRow[]>;
  garrisonByLevel: Record<string, BuildingUnitRow[]>;
  recruitableByLevel: Record<string, BuildingUnitRow[]>;
  /** Loc for each level's culture variant, keyed `<levelKey>|<culture>|<subculture>|<faction>`. */
  variantLoc: Record<string, { name?: string; short?: string; long?: string }>;
  /** Dropdown option lists. */
  campaigns: BuildingsOption[];
  regions: BuildingsRegionOption[];
  cultures: BuildingsOption[];
  subcultures: Array<BuildingsOption & { culture: string }>;
  factions: BuildingsFactionOption[];
  settlementTypes: BuildingsOption[];
  /** Every `main_units` key, named through its land unit. The recruitment picker's options. */
  units: BuildingsOption[];
  /** Every `armed_citizenry_unit_groups` key. The garrison picker's options. */
  unitGroups: BuildingsOption[];
  /** Every effect, flagged with whether a building uses it. Named only where a building does. */
  effects: BuildingsEffectOption[];
  /** The `effect_scope` values the junction table actually uses. */
  effectScopes: string[];
  /**
   * Per effect a building uses: its icon, and its description with the text replacements already
   * resolved but the value not yet substituted.
   *
   * Kept so a *pending* effect row can be localised and iconned like any other. `applyEdits` runs in
   * the main process after the raw rows and the loc tries have been released, so it has no other way
   * to turn an effect key into display text.
   */
  effectMeta: Record<string, { icon?: string; description?: string }>;
  /** Whole `cai_construction_system_building_values` rows, keyed by `building_chain`. */
  caiValuesByChain: Record<string, Array<Record<string, string>>>;
  /** Whole `cai_construction_system_synergies` rows, filed under both chains they name. */
  caiSynergiesByChain: Record<string, Array<Record<string, string>>>;
  /** max observed + 1, per table in `gameToTablesWithNumericIds` this feature writes to. */
  nextNumericIds: Record<string, number>;
}

export interface BuildingsOption {
  key: string;
  localizedName: string;
}

export interface BuildingsRegionOption extends BuildingsOption {
  campaigns: string[];
}

export interface BuildingsFactionOption extends BuildingsOption {
  subculture: string;
  culture: string;
  militaryGroup: string;
  isQuestFaction: boolean;
  isRebel: boolean;
}

export interface BuildingsEffectOption extends BuildingsOption {
  /**
   * Whether some building already has this effect.
   *
   * Only these carry a localised name and a registered icon: their descriptions are held because a
   * pending effect row has to be localised after the loc tries are released, and the other ~13k are
   * left as bare keys rather than inflating the disk cache. The picker defaults to these.
   */
  usedByBuildings: boolean;
  /** Most frequent non-empty scope in `building_effects_junction_tables`; alphabetical on a tie. */
  preferredScope?: string;
}

// ---------------------------------------------------------------------------
// Query and view
// ---------------------------------------------------------------------------

export interface BuildingsRegionQuery {
  campaign: string;
  region: string;
  settlementType?: string;
  culture?: string;
  subculture?: string;
  faction?: string;
  includeHiddenInUi?: boolean;
  includeHiddenSets?: boolean;
  includeLevelsWithoutVariant?: boolean;
  /** Show the level-0 ruin state of settlement and port chains, which the game's browser hides. */
  includeRuinLevels?: boolean;
  /** Show levels bound to no building set, which the game has no band to draw them in. */
  includeUnbandedLevels?: boolean;
  /** Show chains whose levels name only cultures other than the selected one. */
  includeOtherCultureChains?: boolean;
}

export interface BuildingsTile {
  levelKey: string;
  chainKey: string;
  setKey: string;
  level: number;
  /**
   * Which row of the board the tile sits on, 0 at the bottom.
   *
   * Not the same as `level`. The game lays the y-axis out by *primary settlement tier*: a secondary
   * building sits on the row of the primary level it requires, so a barracks needing settlement
   * level 2 lines up with settlement level 2 whatever its own level is. Only the settlement and port
   * chains themselves are placed by their own level, their first tier landing on row 0.
   */
  tierRow: number;
  /** Display tier as a roman numeral; primary/port DB levels are already one-based. */
  romanNumeral: string;
  createTime: number;
  createCost: number;
  upkeepCost: number;
  foodCost: number;
  developmentPointCost: number;
  onlyInCapital: boolean;
  factionUnique: boolean;
  visibleInUi: boolean;
  instanceKey?: string;
  instanceLimit?: number;
  title: string;
  shortDescription?: string;
  longDescription?: string;
  /** Set by the main process to a `whmm://icon/...` URL. */
  iconUrl?: string;
  iconPath?: string;
  variant?: BuildingVariantRow;
  variantCount: number;
  effects: BuildingEffectRow[];
  garrison: BuildingUnitRow[];
  recruitable: BuildingUnitRow[];
  /** Every effective recruitment row on this level, including unlocks repeated by higher tiers. */
  recruitableRows?: BuildingUnitRow[];
  /** Placed in this region by the campaign's start pos. */
  isExistingInRegion: boolean;
  /** Shown only because `includeLevelsWithoutVariant` is on. */
  hasNoVariant: boolean;
  /** The level-0 state of a settlement or port chain: what the slot holds once razed. */
  isRuin: boolean;
  /** Primary and port chains use their DB level directly for both row and displayed tier. */
  isSettlementOrPort: boolean;
  isDuplicatedAcrossSets: boolean;
  isForeignSlot: boolean;
}

export interface BuildingsChainColumn {
  chainKey: string;
  localizedName: string;
  sortOrder: number;
  /** Ascending by level; the board renders them bottom-up. */
  tiles: BuildingsTile[];
  /** Why this chain is in the view, for debugging a mismatch against the game. */
  sources: string[];
}

export interface BuildingsSetBand {
  setKey: string;
  localizedName: string;
  colourR: number;
  colourG: number;
  colourB: number;
  sortOrder: number;
  showInUi: boolean;
  columns: BuildingsChainColumn[];
}

export interface BuildingsUpgradeEdge {
  fromLevelKey: string;
  toLevelKey: string;
  /** The raw junction row, so the direction can be re-read if the level numbers mislead. */
  raw?: { from: string; to: string };
  isImplicit: boolean;
}

export interface BuildingsRegionView {
  query: BuildingsRegionQuery;
  /** Asset protocol URL for the shared vanilla frame drawn beneath each building icon. */
  buildingFrameUrl?: string;
  bands: BuildingsSetBand[];
  edges: BuildingsUpgradeEdge[];
  /** Distinct settlement types the available chains bind to; empty means: hide the dropdown. */
  settlementTypeOptions: BuildingsOption[];
  /** True when the selected culture has no chain assigned to any settlement type. */
  settlementTypeDisabled: boolean;
  /** Levels a `disables` culture variant removed, with the variant that did it. */
  disabledLevels: Array<{ levelKey: string; variant: BuildingVariantRow }>;
  /** Levels placed in this region by the campaign's start pos. */
  existingBuildings: string[];
  slotTemplates: RegionSlot[];
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

export interface BuildingsCatalog {
  campaigns: BuildingsOption[];
  regions: BuildingsRegionOption[];
  cultures: BuildingsOption[];
  subcultures: Array<BuildingsOption & { culture: string }>;
  factions: BuildingsFactionOption[];
  settlementTypes: BuildingsOption[];
  /** Options for the recruitment and garrison editors. */
  units: BuildingsOption[];
  unitGroups: BuildingsOption[];
  effects: BuildingsEffectOption[];
  effectScopes: string[];
  /** Every building chain key, sorted. The CAI clone picker's options. */
  chainKeys: string[];
  /** Where the vanilla DB tables live, so the renderer never joins paths itself. */
  dbPackPath: string;
  /** Per buildings table, the schema its new rows have to be written with. */
  tableSchemas: Record<string, import("../packFileTypes").DBVersion>;
  moddersPrefix: string;
  nextNumericIds: Record<string, number>;
}

export interface BuildingsCatalogResponse {
  success: boolean;
  error?: string;
  catalog?: BuildingsCatalog;
}

export interface BuildingsRegionViewResponse {
  success: boolean;
  error?: string;
  view?: BuildingsRegionView;
  /** Catalog options rebuilt from the same effective rows as the Board. */
  catalog?: BuildingsCatalog;
  /**
   * Problems with the pending rows, checked against the data they will land in. Rides this response
   * because it is already the call that carries the pending rows to main on every edit.
   */
  rowIssues?: import("./validate").BuildingsRowIssue[];
}

/** A chain's CAI rows, fetched only when the user asks to clone them. */
export interface BuildingsCaiRowsResponse {
  success: boolean;
  error?: string;
  /** Table name -> whole rows. Empty when the chain has no CAI data of its own. */
  rowsByTable?: Record<string, Array<Record<string, string>>>;
  superChain?: string;
}
