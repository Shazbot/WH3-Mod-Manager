/**
 * Turns the raw buildings DB rows into the indexed structures the derivation walks.
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
  AvailabilityRow,
  BuildingChainRow,
  BuildingEffectRow,
  BuildingLevelRow,
  BuildingSetBinding,
  BuildingSetRow,
  BuildingUnitRow,
  BuildingVariantRow,
  BuildingsLocTrie,
  BuildingsEffectOption,
  BuildingsFactionOption,
  BuildingsOption,
  BuildingsRegionOption,
  BuildingsTableRows,
  BuiltBuildingsData,
  ChainSetItem,
  PermittedChainRow,
  RegionSlot,
  SettlementTypeBinding,
  StartPosSettlement,
} from "./types";

export type BuildingsGetLoc = (key: string) => string | undefined;

/** Explicit corrections for legacy vanilla rows whose generic DB relationships are too broad. */
export const HIDDEN_BUILDING_CHAIN_PREFIX = "wh_main_horde_";
export const VAMPIRE_BUILDING_CHAIN_PREFIX = "wh2_main_VAMPIRES_";
export const VAMPIRE_BUILDING_AVAILABILITY_SET = "wh_main_bas_vmp";
export const ROGUE_PORT_BUILDING_CHAIN = "wh2_main_rogue_port";
export const ROGUE_BUILDING_AVAILABILITY_SET = "wh2_main_bas_rogue";

export const BUILDINGS_TABLES = [
  "building_superchains_tables",
  "building_chains_tables",
  "building_levels_tables",
  "building_culture_variants_tables",
  "building_instances_tables",
  "building_sets_tables",
  "building_set_to_building_junctions_tables",
  "building_chain_sets_tables",
  "building_chain_set_items_tables",
  "slot_templates_tables",
  "slot_types_tables",
  "slot_sets_tables",
  "slot_set_items_tables",
  "slot_template_permitted_building_chains_tables",
  "slot_template_to_building_superchain_junctions_tables",
  "start_pos_region_slot_templates_tables",
  "start_pos_regions_tables",
  "start_pos_settlements_tables",
  "start_pos_region_foreign_slots_tables",
  "building_chain_availability_set_ids_tables",
  "building_chain_availability_sets_tables",
  "building_chain_availabilities_tables",
  "building_upgrades_junction_tables",
  "building_downgrade_junctions_tables",
  "building_effects_junction_tables",
  "effects_tables",
  "settlement_types_tables",
  "settlement_type_to_building_chains_junctions_tables",
  "building_level_armed_citizenry_junctions_tables",
  "armed_citizenry_unit_groups_tables",
  "armed_citizenry_units_to_unit_groups_junctions_tables",
  "building_units_allowed_tables",
  "main_units_tables",
  "land_units_tables",
  "unit_variants_tables",
  "cai_construction_system_building_values_tables",
  "cai_construction_system_synergies_tables",
  "regions_tables",
  "cultures_tables",
  "cultures_subcultures_tables",
  "factions_tables",
  "campaigns_tables",
] as const;

/**
 * The columns that make up each table's identity, in schema order.
 *
 * Rows arrive vanilla-first then mods in load order, so a later row with the same identity has to
 * *replace* an earlier one. Keying on the first column alone would collapse whole tables:
 * `building_culture_variants` has four key columns, and every variant of one building shares the
 * first. The start-position slot-template table is the one exception: its rows are reconstructed
 * from ESF without the schema's per-instance index column. `test/buildingsData.node.test.ts` asserts
 * this against the shipped schema.
 */
export const BUILDINGS_TABLE_KEY_COLUMNS: Record<string, string[]> = {
  building_superchains_tables: ["key"],
  building_chains_tables: ["key"],
  building_levels_tables: ["level_name"],
  building_culture_variants_tables: ["building", "culture", "subculture", "faction"],
  building_instances_tables: ["key"],
  building_sets_tables: ["key"],
  building_set_to_building_junctions_tables: ["building_chain", "building_level", "building_set"],
  building_chain_sets_tables: ["key"],
  building_chain_set_items_tables: ["chain", "set", "super_chain"],
  slot_templates_tables: ["key"],
  slot_types_tables: ["key"],
  slot_sets_tables: ["key"],
  slot_set_items_tables: ["id"],
  slot_template_permitted_building_chains_tables: ["chain", "chain_set", "slot_template", "super_chain"],
  slot_template_to_building_superchain_junctions_tables: ["id"],
  // This table is reconstructed from REGION_SLOT records in startpos.esf. The ESF's first value is
  // the per-instance index/key and is deliberately not part of the DB-shaped row.
  start_pos_region_slot_templates_tables: ["campaign", "region", "slot_template", "slot_type"],
  start_pos_regions_tables: ["region", "campaign"],
  start_pos_settlements_tables: ["settlement_id", "region"],
  start_pos_region_foreign_slots_tables: ["campaign", "faction", "region", "slot_set"],
  building_chain_availability_set_ids_tables: ["id"],
  building_chain_availability_sets_tables: ["building_chain", "id"],
  building_chain_availabilities_tables: ["id"],
  building_upgrades_junction_tables: ["from", "to"],
  building_downgrade_junctions_tables: ["from"],
  building_effects_junction_tables: ["building", "effect"],
  effects_tables: ["effect"],
  settlement_types_tables: ["key"],
  settlement_type_to_building_chains_junctions_tables: ["building_chain", "settlement_type"],
  building_level_armed_citizenry_junctions_tables: ["id"],
  armed_citizenry_unit_groups_tables: ["unit_group"],
  armed_citizenry_units_to_unit_groups_junctions_tables: ["id"],
  building_units_allowed_tables: ["key"],
  main_units_tables: ["unit"],
  land_units_tables: ["key"],
  unit_variants_tables: ["faction", "unit"],
  cai_construction_system_building_values_tables: [
    "building_chain",
    "building_instance",
    "building_or_building_range_start_inclusive",
    "building_range_end_inclusive",
    "building_super_chain",
    "cai_construction_system_category",
    "cai_construction_system_category_group",
    "campaign",
    "culture",
    "faction",
    "sub_culture",
  ],
  cai_construction_system_synergies_tables: [
    "existing_building_chain_key",
    "existing_building_level_inclusive_end",
    "existing_building_level_inclusive_start",
    "potential_buiding_chain_key",
    "potential_building_level_inclusive_end",
    "potential_building_level_inclusive_start",
    "synergy_policy_key",
    "existing_building_instance",
    "existing_building_super_chain",
    "potential_building_instance",
    "potential_building_super_chain",
    "synergy_scope_key",
  ],
  regions_tables: ["key"],
  cultures_tables: ["key"],
  cultures_subcultures_tables: ["subculture"],
  factions_tables: ["key"],
  campaigns_tables: ["campaign_name"],
};

/** The numeric-id tables this feature writes new rows into. See `gameToTablesWithNumericIds`. */
export const BUILDINGS_NUMERIC_ID_COLUMNS: Record<string, string> = {
  building_units_allowed_tables: "key",
  building_level_armed_citizenry_junctions_tables: "id",
  armed_citizenry_units_to_unit_groups_junctions_tables: "id",
  building_chain_availabilities_tables: "id",
  slot_set_items_tables: "id",
};

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

/**
 * Collapses rows by their composite key, keeping the last one.
 *
 * `getTableRowData` visits vanilla first and then mods in load order, so "last wins" is exactly the
 * game's own override behaviour.
 */
export const dedupeRowsByKey = (
  tableName: string,
  rows: Array<Record<string, string>> | undefined,
): Array<Record<string, string>> => {
  if (!rows || rows.length === 0) return [];
  const keyColumns = BUILDINGS_TABLE_KEY_COLUMNS[tableName];
  if (!keyColumns || keyColumns.length === 0) return rows;
  const byKey = new Map<string, Record<string, string>>();
  for (const row of rows) {
    byKey.set(keyColumns.map((column) => row[column] ?? "").join("|"), row);
  }
  return [...byKey.values()];
};

const optional = (value: string) => (value === "" ? undefined : value);

/**
 * A building set's band colour.
 *
 * The live game ships `colour_hex` where the bundled schema still describes `colour_r/g/b`, so read
 * whichever the row actually carries rather than trusting the schema. Falls back to a neutral grey
 * so a set with neither still gets a band that is visible.
 */
const readSetColour = (row: Record<string, string>) => {
  const hex = str(row, "colour_hex").replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      colourR: parseInt(hex.slice(0, 2), 16),
      colourG: parseInt(hex.slice(2, 4), 16),
      colourB: parseInt(hex.slice(4, 6), 16),
    };
  }
  if (row.colour_r != undefined || row.colour_g != undefined || row.colour_b != undefined) {
    return { colourR: num(row, "colour_r"), colourG: num(row, "colour_g"), colourB: num(row, "colour_b") };
  }
  return { colourR: 90, colourG: 90, colourB: 90 };
};

/** Specificity of a culture variant: the more of the three columns it pins, the more it wins. */
export const variantSpecificity = (culture: string, subculture: string, faction: string) =>
  (faction !== "" ? 4 : 0) + (subculture !== "" ? 2 : 0) + (culture !== "" ? 1 : 0);

export const variantLocKey = (building: string, culture: string, subculture: string, faction: string) =>
  `${building}|${culture}|${subculture}|${faction}`;

/**
 * The loc key for a culture variant's name.
 *
 * `building_culture_variants_tables` declares `localised_key_order` `[building, culture, subculture,
 * faction]` and `buildLocKey` concatenates those values with no separator, so an Empire-only variant
 * of `wh_main_emp_barracks` is `building_culture_variants_name_wh_main_emp_barrackswh_main_emp_empire`.
 */
export const buildVariantNameLocKey = (building: string, culture: string, subculture: string, faction: string) =>
  `building_culture_variants_name_${building}${culture}${subculture}${faction}`;

const localize = (getLoc: BuildingsGetLoc, key: string) => {
  const localized = getLoc(key);
  if (!localized) return undefined;
  return stripLocImgTags(resolveTextReplacements(localized, getLoc) || localized) || undefined;
};

export const buildBuildingsData = (tables: BuildingsTableRows, getLoc: BuildingsGetLoc): BuiltBuildingsData => {
  const rowsOf = (tableName: string) => {
    return dedupeRowsByKey(tableName, tables[tableName]);
  };

  // --- chains and superchains ------------------------------------------------
  const chains: Record<string, BuildingChainRow> = {};
  const superChains: Record<string, string[]> = {};
  for (const row of rowsOf("building_chains_tables")) {
    const key = str(row, "key");
    if (!key) continue;
    const superChain = str(row, "building_superchain");
    chains[key] = {
      key,
      superChain,
      chainCategory: optional(str(row, "chain_category")),
      sortOrder: num(row, "optional_sort_order"),
      tierIcon: optional(str(row, "optional_tier_icon")),
      canBeDismantled: bool(row, "can_be_dismantled", true),
      isForeignSlotChain: bool(row, "is_foreign_slot_chain"),
      localizedName: localize(getLoc, `building_chains_encyclopedia_name_${key}`) || key,
      tooltip: localize(getLoc, `building_chains_chain_tooltip_${key}`),
    };
    if (superChain) (superChains[superChain] ||= []).push(key);
  }

  // --- levels ----------------------------------------------------------------
  const levelsByKey: Record<string, BuildingLevelRow> = {};
  const levelKeysByChain: Record<string, string[]> = {};
  for (const row of rowsOf("building_levels_tables")) {
    const levelKey = str(row, "level_name");
    if (!levelKey) continue;
    const chain = str(row, "chain");
    levelsByKey[levelKey] = {
      levelKey,
      chain,
      level: num(row, "level"),
      createTime: num(row, "create_time"),
      createCost: num(row, "create_cost"),
      upkeepCost: num(row, "upkeep_cost"),
      foodCost: num(row, "food_cost"),
      developmentPointCost: num(row, "development_point_cost"),
      onlyInCapital: bool(row, "only_in_capital"),
      factionUnique: bool(row, "faction_unique"),
      visibleInUi: bool(row, "visible_in_ui", true),
      primarySlotLevelRequirement: num(row, "primary_slot_building_building_level_requirement"),
      instanceKey: optional(str(row, "building_instance_key")),
      commodity: optional(str(row, "commodity")),
      resourceRequirement: optional(str(row, "resource_requirement")),
      religionRequirement: optional(str(row, "religion_requirement")),
    };
    if (chain) (levelKeysByChain[chain] ||= []).push(levelKey);
  }
  for (const levelKeys of Object.values(levelKeysByChain)) {
    levelKeys.sort((first, second) => levelsByKey[first].level - levelsByKey[second].level);
  }

  // --- culture variants ------------------------------------------------------
  const variantsByLevel: Record<string, BuildingVariantRow[]> = {};
  const variantLoc: BuiltBuildingsData["variantLoc"] = {};
  for (const row of rowsOf("building_culture_variants_tables")) {
    const building = str(row, "building");
    if (!building) continue;
    const culture = str(row, "culture");
    const subculture = str(row, "subculture");
    const faction = str(row, "faction");
    const description = optional(str(row, "description"));
    const shortDescription = optional(str(row, "short_description"));
    (variantsByLevel[building] ||= []).push({
      building,
      culture,
      subculture,
      faction,
      description,
      shortDescription,
      icon: optional(str(row, "icon")),
      disables: bool(row, "disables"),
      displayTooltip: bool(row, "display_tooltip", true),
      frameOverride: optional(str(row, "building_frame_override")),
      specificity: variantSpecificity(culture, subculture, faction),
    });
    variantLoc[variantLocKey(building, culture, subculture, faction)] = {
      name: localize(getLoc, buildVariantNameLocKey(building, culture, subculture, faction)),
      // These two tables carry no schema at all: their text exists only in loc files, keyed off the
      // value in the variant's description / short_description column.
      short: shortDescription
        ? localize(getLoc, `building_short_description_texts_short_description_${shortDescription}`)
        : undefined,
      long: description ? localize(getLoc, `building_description_texts_description_${description}`) : undefined,
    };
  }

  // --- instances -------------------------------------------------------------
  const instances: Record<string, number> = {};
  for (const row of rowsOf("building_instances_tables")) {
    const key = str(row, "key");
    if (key) instances[key] = num(row, "num_instances");
  }

  // --- sets ------------------------------------------------------------------
  const sets: Record<string, BuildingSetRow> = {};
  for (const row of rowsOf("building_sets_tables")) {
    const key = str(row, "key");
    if (!key) continue;
    sets[key] = {
      key,
      icon: optional(str(row, "icon")),
      sortOrder: num(row, "sort_order"),
      ...readSetColour(row),
      showInUi: bool(row, "show_in_ui", true),
      localizedName: localize(getLoc, `building_sets_onscreen_name_${key}`) || key,
    };
  }

  const setBindings: BuildingSetBinding[] = rowsOf("building_set_to_building_junctions_tables").map((row) => ({
    chain: optional(str(row, "building_chain")),
    level: optional(str(row, "building_level")),
    set: str(row, "building_set"),
    exclude: bool(row, "exclude"),
  }));

  // --- chain sets ------------------------------------------------------------
  const chainSetParents: Record<string, string | undefined> = {};
  for (const row of rowsOf("building_chain_sets_tables")) {
    const key = str(row, "key");
    if (key) chainSetParents[key] = optional(str(row, "parent_set"));
  }
  const chainSetItems: Record<string, ChainSetItem[]> = {};
  for (const row of rowsOf("building_chain_set_items_tables")) {
    const set = str(row, "set");
    if (!set) continue;
    (chainSetItems[set] ||= []).push({
      set,
      chain: optional(str(row, "chain")),
      superChain: optional(str(row, "super_chain")),
      remove: bool(row, "remove"),
    });
  }

  // --- slot templates --------------------------------------------------------
  const permittedByTemplate: Record<string, PermittedChainRow[]> = {};
  for (const row of rowsOf("slot_template_permitted_building_chains_tables")) {
    const slotTemplate = str(row, "slot_template");
    if (!slotTemplate) continue;
    (permittedByTemplate[slotTemplate] ||= []).push({
      slotTemplate,
      chain: optional(str(row, "chain")),
      chainSet: optional(str(row, "chain_set")),
      superChain: optional(str(row, "super_chain")),
      remove: bool(row, "remove"),
    });
  }
  const superChainsByTemplate: Record<string, string[]> = {};
  for (const row of rowsOf("slot_template_to_building_superchain_junctions_tables")) {
    const slotTemplate = str(row, "slot_template");
    const superChain = str(row, "building_superchain");
    if (slotTemplate && superChain) (superChainsByTemplate[slotTemplate] ||= []).push(superChain);
  }

  const regionSlotTemplates: Record<string, RegionSlot[]> = {};
  for (const [index, row] of rowsOf("start_pos_region_slot_templates_tables").entries()) {
    const campaign = str(row, "campaign");
    const region = str(row, "region");
    if (!campaign || !region) continue;
    (regionSlotTemplates[`${campaign}|${region}`] ||= []).push({
      campaign,
      region,
      slotTemplate: str(row, "slot_template"),
      slotType: str(row, "slot_type"),
      id: str(row, "id") || `${index}`,
    });
  }

  // Foreign/allied slots are stored indirectly: the region row names a slot set, whose items name
  // the templates. Keep them faction-scoped so merely choosing a culture does not expose every
  // faction's outpost slots.
  const slotItemsBySet: Record<string, Array<{ id: string; slotTemplate: string; slotType: string }>> = {};
  for (const row of rowsOf("slot_set_items_tables")) {
    const slotSet = str(row, "slot_set");
    const slotTemplate = str(row, "slot_template");
    if (!slotSet || !slotTemplate) continue;
    (slotItemsBySet[slotSet] ||= []).push({
      id: str(row, "id"),
      slotTemplate,
      slotType: str(row, "slot_type"),
    });
  }
  const foreignRegionSlotTemplates: Record<string, RegionSlot[]> = {};
  for (const row of rowsOf("start_pos_region_foreign_slots_tables")) {
    const campaign = str(row, "campaign");
    const region = str(row, "region");
    const faction = str(row, "faction");
    const slotSet = str(row, "slot_set");
    if (!campaign || !region || !faction || !slotSet) continue;
    const key = `${campaign}|${region}|${faction}`;
    for (const item of slotItemsBySet[slotSet] ?? []) {
      (foreignRegionSlotTemplates[key] ||= []).push({
        campaign,
        region,
        slotTemplate: item.slotTemplate,
        slotType: item.slotType,
        id: item.id,
        isForeignSlot: true,
      });
    }
  }

  // --- start pos settlements -------------------------------------------------
  // start_pos_settlements.region is a numeric id into start_pos_regions, whose `region` column is
  // the regions_tables key. Build the id -> (campaign, region) map first.
  const startPosRegionById: Record<string, { campaign: string; region: string }> = {};
  for (const row of rowsOf("start_pos_regions_tables")) {
    const id = str(row, "id");
    if (!id) continue;
    startPosRegionById[id] = { campaign: str(row, "campaign"), region: str(row, "region") };
  }
  const startPosSettlements: Record<string, StartPosSettlement[]> = {};
  const settlementBuildingColumns = [
    "primary_building",
    "building1",
    "building2",
    "building3",
    "building4",
    "building5",
    "port_building",
  ];
  for (const row of rowsOf("start_pos_settlements_tables")) {
    const owner = startPosRegionById[str(row, "region")];
    if (!owner || !owner.campaign || !owner.region) continue;
    (startPosSettlements[`${owner.campaign}|${owner.region}`] ||= []).push({
      campaign: owner.campaign,
      region: owner.region,
      settlementId: str(row, "settlement_id"),
      settlementType: optional(str(row, "settlement_type")),
      buildings: settlementBuildingColumns.map((column) => str(row, column)).filter((value) => value !== ""),
    });
  }

  // --- availability ----------------------------------------------------------
  const availabilitySetsByChain: Record<string, string[]> = {};
  for (const row of rowsOf("building_chain_availability_sets_tables")) {
    const chain = str(row, "building_chain");
    const setId = str(row, "id");
    if (chain && setId) (availabilitySetsByChain[chain] ||= []).push(setId);
  }
  for (const chain of Object.keys(chains)) {
    if (!chain.startsWith(VAMPIRE_BUILDING_CHAIN_PREFIX)) continue;
    const setIds = (availabilitySetsByChain[chain] ||= []);
    if (!setIds.includes(VAMPIRE_BUILDING_AVAILABILITY_SET)) setIds.push(VAMPIRE_BUILDING_AVAILABILITY_SET);
  }
  if (chains[ROGUE_PORT_BUILDING_CHAIN]) {
    const roguePortSetIds = (availabilitySetsByChain[ROGUE_PORT_BUILDING_CHAIN] ||= []);
    if (!roguePortSetIds.includes(ROGUE_BUILDING_AVAILABILITY_SET)) {
      roguePortSetIds.push(ROGUE_BUILDING_AVAILABILITY_SET);
    }
  }
  const availabilitiesBySetId: Record<string, AvailabilityRow[]> = {};
  for (const row of rowsOf("building_chain_availabilities_tables")) {
    const setId = str(row, "set_id");
    if (!setId) continue;
    (availabilitiesBySetId[setId] ||= []).push({
      id: str(row, "id"),
      setId,
      culture: str(row, "culture"),
      subCulture: str(row, "sub_culture"),
      faction: str(row, "faction"),
      campaign: str(row, "campaign"),
    });
  }

  // --- settlement types ------------------------------------------------------
  const settlementTypeBindings: Record<string, SettlementTypeBinding[]> = {};
  for (const row of rowsOf("settlement_type_to_building_chains_junctions_tables")) {
    const chain = str(row, "building_chain");
    const settlementType = str(row, "settlement_type");
    if (!chain || !settlementType) continue;
    (settlementTypeBindings[chain] ||= []).push({ chain, settlementType, exclude: bool(row, "exclude") });
  }

  // --- upgrades --------------------------------------------------------------
  // `building_upgrades_junction_tables`, not `building_downgrade_junctions_tables`. The latter is
  // entirely self-referential in vanilla - every one of its ~1500 rows maps a level to itself - so
  // reading arrows out of it produces nothing but self-edges. The upgrades table holds the real
  // paths, `from` upgrading into `to`, consistently lower level to higher.
  const upgrades = rowsOf("building_upgrades_junction_tables")
    .map((row) => ({ from: str(row, "from"), to: str(row, "to") }))
    .filter((edge) => edge.from !== "" && edge.to !== "" && edge.from !== edge.to);

  // --- effects ---------------------------------------------------------------
  const effectIcons: Record<string, string | undefined> = {};
  for (const row of rowsOf("effects_tables")) {
    const effect = str(row, "effect");
    if (effect) effectIcons[effect] = optional(str(row, "icon"));
  }
  // Only effects some building actually uses - 1824 of the game's 15064. Their descriptions are
  // needed anyway, to localise a *pending* effect row after the loc tries are released, and holding
  // the other 13k would inflate the disk cache for text the picker can fall back to the key for.
  const effectMeta: BuiltBuildingsData["effectMeta"] = {};
  const effectScopeCounts: Record<string, Map<string, number>> = {};

  const effectsByLevel: Record<string, BuildingEffectRow[]> = {};
  for (const row of rowsOf("building_effects_junction_tables")) {
    const building = str(row, "building");
    const effectKey = str(row, "effect");
    if (!building || !effectKey) continue;
    if (!effectMeta[effectKey]) {
      const description = getRawEffectLocalization(effectKey, getLoc);
      effectMeta[effectKey] = {
        icon: effectIcons[effectKey],
        description: description === effectKey ? undefined : description,
      };
    }
    const value = num(row, "value");
    const scope = str(row, "effect_scope");
    if (scope) {
      const counts = (effectScopeCounts[effectKey] ||= new Map());
      counts.set(scope, (counts.get(scope) ?? 0) + 1);
    }
    (effectsByLevel[building] ||= []).push({
      building,
      effectKey,
      scope,
      value,
      localizedKey: formatEffectLocalization(effectKey, value, getLoc),
      icon: effectIcons[effectKey],
    });
  }

  // --- units -----------------------------------------------------------------
  // main_units carries no localised fields at all; the display name lives on the land_units row it
  // points at, so a unit key has to be routed through main_units.land_unit first.
  const landUnitByMainUnit: Record<string, string> = {};
  for (const row of rowsOf("main_units_tables")) {
    const unit = str(row, "unit");
    const landUnit = str(row, "land_unit");
    if (unit && landUnit) landUnitByMainUnit[unit] = landUnit;
  }
  const unitName = (unitKey: string) => {
    const landUnit = landUnitByMainUnit[unitKey];
    return (
      (landUnit && localize(getLoc, `land_units_onscreen_name_${landUnit}`)) ||
      localize(getLoc, `land_units_onscreen_name_${unitKey}`) ||
      unitKey
    );
  };

  // The card image is named by unit_variants.unit_card and lives at ui\units\icons\<card>.png - the
  // same derivation the unit viewer uses (src/unitViewer/data.ts:559-570). unit_variants is keyed on
  // the *land* unit, so a main unit has to be routed through main_units.land_unit first, and the
  // faction-agnostic row is preferred over a faction-specific one.
  const cardNameByLandUnit: Record<string, string> = {};
  for (const row of rowsOf("unit_variants_tables")) {
    const landUnit = str(row, "unit");
    const card = str(row, "unit_card");
    if (!landUnit || !card) continue;
    if (str(row, "faction") === "" || !cardNameByLandUnit[landUnit]) cardNameByLandUnit[landUnit] = card;
  }
  const unitCardPath = (unitKey: string) => {
    const landUnit = landUnitByMainUnit[unitKey];
    const card = (landUnit && cardNameByLandUnit[landUnit]) || cardNameByLandUnit[unitKey] || unitKey;
    return `ui\\units\\icons\\${card}.png`.toLowerCase();
  };

  const unitsByGroup: Record<string, Array<{ unit: string; priority: number }>> = {};
  for (const row of rowsOf("armed_citizenry_units_to_unit_groups_junctions_tables")) {
    const unitGroup = str(row, "unit_group");
    const unit = str(row, "unit");
    if (!unitGroup || !unit) continue;
    (unitsByGroup[unitGroup] ||= []).push({ unit, priority: num(row, "priority") });
  }
  for (const units of Object.values(unitsByGroup)) units.sort((a, b) => a.priority - b.priority);

  const garrisonUnitsByGroup: Record<string, BuildingUnitRow[]> = {};
  for (const [unitGroup, units] of Object.entries(unitsByGroup)) {
    garrisonUnitsByGroup[unitGroup] = units.map(({ unit, priority }) => ({
      unitKey: unit,
      localizedName: unitName(unit),
      cardPath: unitCardPath(unit),
      unitGroup,
      priority,
    }));
  }

  const garrisonByLevel: Record<string, BuildingUnitRow[]> = {};
  for (const row of rowsOf("building_level_armed_citizenry_junctions_tables")) {
    const building = str(row, "building_level");
    const unitGroup = str(row, "unit_group");
    if (!building || !unitGroup) continue;
    const bucket = (garrisonByLevel[building] ||= []);
    for (const unit of garrisonUnitsByGroup[unitGroup] ?? []) {
      if (bucket.some((existing) => existing.unitKey === unit.unitKey && existing.unitGroup === unitGroup)) continue;
      bucket.push(unit);
    }
  }

  const recruitableByLevel: Record<string, BuildingUnitRow[]> = {};
  for (const row of rowsOf("building_units_allowed_tables")) {
    const building = str(row, "building");
    const unit = str(row, "unit");
    if (!building || !unit) continue;
    // `enabled` is not read: every one of the 6396 vanilla rows has it `false`, including the ones
    // that plainly do unlock recruitment in game (`wh_main_emp_barracks_3` ->
    // `wh_main_emp_inf_swordsmen`). Like `building_downgrade_junctions`, it is a dead column, and
    // gating on it dropped the entire table.
    (recruitableByLevel[building] ||= []).push({
      unitKey: unit,
      localizedName: unitName(unit),
      cardPath: unitCardPath(unit),
      faction: optional(str(row, "faction")),
      xp: num(row, "XP"),
    });
  }

  // --- dropdown options ------------------------------------------------------
  const campaignKeys = new Set<string>();
  for (const row of rowsOf("campaigns_tables")) {
    const key = str(row, "campaign_name");
    if (key) campaignKeys.add(key);
  }
  // A campaign nothing references is no use here, and the reverse: a campaign only the start pos
  // mentions still has to be pickable.
  for (const slots of Object.values(regionSlotTemplates)) {
    for (const slot of slots) if (slot.campaign) campaignKeys.add(slot.campaign);
  }
  const campaigns: BuildingsOption[] = [...campaignKeys]
    .map((key) => ({ key, localizedName: localize(getLoc, `campaigns_onscreen_name_${key}`) || key }))
    .sort((first, second) => first.key.localeCompare(second.key));

  const campaignsByRegion: Record<string, Set<string>> = {};
  for (const slots of Object.values(regionSlotTemplates)) {
    for (const slot of slots) (campaignsByRegion[slot.region] ||= new Set()).add(slot.campaign);
  }
  const regions: BuildingsRegionOption[] = rowsOf("regions_tables")
    .map((row) => str(row, "key"))
    .filter((key) => key !== "")
    .map((key) => ({
      key,
      localizedName: localize(getLoc, `regions_onscreen_${key}`) || key,
      campaigns: [...(campaignsByRegion[key] ?? [])],
    }))
    .sort((first, second) => first.localizedName.localeCompare(second.localizedName));

  const cultures: BuildingsOption[] = rowsOf("cultures_tables")
    .map((row) => str(row, "key"))
    .filter((key) => key !== "")
    .map((key) => ({ key, localizedName: localize(getLoc, `cultures_name_${key}`) || key }))
    .sort((first, second) => first.key.localeCompare(second.key));

  const subcultures = rowsOf("cultures_subcultures_tables")
    .map((row) => ({ key: str(row, "subculture"), culture: str(row, "culture") }))
    .filter((entry) => entry.key !== "")
    .map((entry) => ({
      ...entry,
      localizedName: localize(getLoc, `cultures_subcultures_name_${entry.key}`) || entry.key,
    }))
    .sort((first, second) => first.key.localeCompare(second.key));
  const cultureBySubculture = new Map(subcultures.map((entry) => [entry.key, entry.culture]));

  const factions: BuildingsFactionOption[] = rowsOf("factions_tables")
    .map((row) => ({
      key: str(row, "key"),
      subculture: str(row, "subculture"),
      militaryGroup: str(row, "military_group"),
      isQuestFaction: bool(row, "is_quest_faction"),
      isRebel: bool(row, "is_rebel"),
    }))
    .filter((entry) => entry.key !== "")
    .map((entry) => ({
      ...entry,
      culture: cultureBySubculture.get(entry.subculture) ?? "",
      localizedName: localize(getLoc, `factions_screen_name_${entry.key}`) || entry.key,
    }))
    .sort((first, second) => first.localizedName.localeCompare(second.localizedName));

  const settlementTypes: BuildingsOption[] = rowsOf("settlement_types_tables")
    .map((row) => str(row, "key"))
    .filter((key) => key !== "")
    .map((key) => ({ key, localizedName: localize(getLoc, `settlement_types_name_${key}`) || key }))
    .sort((first, second) => first.key.localeCompare(second.key));

  // Pickers for the garrison and recruitment editors. Units are named through their land unit, the
  // same hop `unitName` makes, because `main_units` carries no localised fields of its own.
  const units: BuildingsOption[] = rowsOf("main_units_tables")
    .map((row) => str(row, "unit"))
    .filter((key) => key !== "")
    .map((key) => ({ key, localizedName: unitName(key) }))
    .sort((first, second) => first.localizedName.localeCompare(second.localizedName));

  const unitGroups: BuildingsOption[] = rowsOf("armed_citizenry_unit_groups_tables")
    .map((row) => str(row, "unit_group"))
    .filter((key) => key !== "")
    .map((key) => ({ key, localizedName: key }))
    .sort((first, second) => first.key.localeCompare(second.key));

  // Every effect in the game, flagged with whether a building uses it, so the picker can offer the
  // 1824 that do - which are the ones with a name and an icon - or fall open to all 15064. Scopes
  // come from the junction rows actually in use rather than a table of their own.
  const effects: BuildingsEffectOption[] = rowsOf("effects_tables")
    .map((row) => str(row, "effect"))
    .filter((key) => key !== "")
    .map((key) => ({
      key,
      localizedName: effectMeta[key]?.description || key,
      usedByBuildings: effectMeta[key] != undefined,
      preferredScope: [...(effectScopeCounts[key] ?? [])].sort(
        ([firstScope, firstCount], [secondScope, secondCount]) =>
          secondCount - firstCount || firstScope.localeCompare(secondScope),
      )[0]?.[0],
    }))
    .sort((first, second) => first.localizedName.localeCompare(second.localizedName));

  const effectScopeSet = new Set<string>();
  for (const row of rowsOf("building_effects_junction_tables")) {
    const scope = str(row, "effect_scope");
    if (scope) effectScopeSet.add(scope);
  }
  const effectScopes = [...effectScopeSet].sort();

  // --- CAI ------------------------------------------------------------------
  // Kept as whole rows rather than parsed: cloning copies every column and rewrites only the few
  // that name the chain, so anything this file does not understand still survives the copy.
  const caiValuesByChain: Record<string, Array<Record<string, string>>> = {};
  for (const row of rowsOf("cai_construction_system_building_values_tables")) {
    const chain = str(row, "building_chain");
    if (chain) (caiValuesByChain[chain] ||= []).push({ ...row });
  }

  const caiSynergiesByChain: Record<string, Array<Record<string, string>>> = {};
  for (const row of rowsOf("cai_construction_system_synergies_tables")) {
    // A synergy names two chains and matters to both, so it is filed under each. The clone rewrites
    // whichever side names the template.
    for (const column of ["existing_building_chain_key", "potential_buiding_chain_key"]) {
      const chain = str(row, column);
      if (!chain) continue;
      const bucket = (caiSynergiesByChain[chain] ||= []);
      if (!bucket.includes(row)) bucket.push({ ...row });
    }
  }

  // --- numeric id cursors ----------------------------------------------------
  const nextNumericIds: Record<string, number> = {};
  for (const [tableName, column] of Object.entries(BUILDINGS_NUMERIC_ID_COLUMNS)) {
    let highest = -1;
    for (const row of tables[tableName] ?? []) {
      const parsed = Number(row[column]);
      if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
    }
    nextNumericIds[tableName] = highest + 1;
  }

  return {
    superChains,
    chains,
    levelsByKey,
    levelKeysByChain,
    variantsByLevel,
    instances,
    sets,
    setBindings,
    chainSetParents,
    chainSetItems,
    permittedByTemplate,
    superChainsByTemplate,
    regionSlotTemplates,
    foreignRegionSlotTemplates,
    startPosSettlements,
    availabilitySetsByChain,
    availabilitiesBySetId,
    settlementTypeBindings,
    upgrades,
    effectsByLevel,
    garrisonUnitsByGroup,
    garrisonByLevel,
    recruitableByLevel,
    variantLoc,
    campaigns,
    regions,
    cultures,
    subcultures,
    factions,
    settlementTypes,
    units,
    unitGroups,
    effects,
    effectScopes,
    effectMeta,
    caiValuesByChain,
    caiSynergiesByChain,
    nextNumericIds,
  };
};

/** Consults tries in reverse pack order, so a later pack shadows an earlier one. */
export const createBuildingsLocLookup = (triesInPackOrder: Array<BuildingsLocTrie | undefined>): BuildingsGetLoc => {
  const tries = triesInPackOrder.filter((trie): trie is BuildingsLocTrie => !!trie).toReversed();
  return (key: string) => {
    for (const trie of tries) {
      const value = trie.get(key);
      if (value != undefined) return value;
    }
    return undefined;
  };
};
