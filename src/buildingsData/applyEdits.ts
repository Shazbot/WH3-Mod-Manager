/**
 * Folding pending rows into an already-built dataset.
 *
 * The main process releases the raw table rows as soon as `buildBuildingsData` has run - they are
 * the expensive half and retaining ~40 tables of records would cost far more than the built indexes
 * do. So a pending edit cannot be applied by re-running the extraction; it is applied to the built
 * structures instead.
 *
 * Only the tables the edit actions in `editActions.ts` actually produce are folded in. A row typed
 * by hand into some other table in the tables sub-tab is still saved, it just does not move the
 * board - which is honest, since the board only draws what these structures describe.
 */
import { formatEffectLocalization } from "../skills";
import { readSetColour, variantLocKey, variantSpecificity } from "./data";
import { LOC_TABLE, newRowsByTable, type BuildingsEditState } from "./edits";
import type { BuildingUnitRow, BuildingVariantRow, BuiltBuildingsData } from "./types";

/** Tables that change what the board draws. Anything else is saved but not drawn. */
export const BOARD_AFFECTING_TABLES = [
  "building_chains_tables",
  "building_levels_tables",
  "building_culture_variants_tables",
  "building_sets_tables",
  "building_set_to_building_junctions_tables",
  "building_chain_sets_tables",
  "building_chain_set_items_tables",
  "building_upgrades_junction_tables",
  "building_effects_junction_tables",
  "building_units_allowed_tables",
  "building_level_armed_citizenry_junctions_tables",
  "building_instances_tables",
  "slot_template_permitted_building_chains_tables",
  "building_chain_availability_sets_tables",
  "building_chain_availabilities_tables",
  "settlement_type_to_building_chains_junctions_tables",
];

const str = (row: Record<string, string>, column: string) => (row[column] ?? "").trim();
const num = (row: Record<string, string>, column: string, fallback = 0) => {
  const parsed = Number(row[column]);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (row: Record<string, string>, column: string, fallback = false) => {
  const value = str(row, column).toLowerCase();
  if (value === "") return fallback;
  return value === "true" || value === "1";
};
const optional = (value: string) => (value === "" ? undefined : value);

/**
 * Display text and icon for a pending effect row.
 *
 * The description in `effectMeta` is already resolved apart from the value placeholders, so it is fed
 * back through the same formatter the build uses rather than substituted by hand - one place stays
 * responsible for what `%n`, `%+n` and the rest mean. An effect no building uses has no entry, and
 * falls back to its key exactly as the build would.
 */
const describeEffect = (base: BuiltBuildingsData, effectKey: string, value: number) => {
  const meta = base.effectMeta?.[effectKey];
  return {
    localizedKey: formatEffectLocalization(effectKey, value, (locId) =>
      locId === `effects_description_${effectKey}` ? meta?.description : undefined,
    ),
    icon: meta?.icon,
  };
};

export const applyNewRowsToBuiltData = (base: BuiltBuildingsData, state: BuildingsEditState): BuiltBuildingsData => {
  const byTable = newRowsByTable(state);
  if (Object.keys(byTable).length === 0) return base;

  // Shallow clone, then copy only the collections actually written to. Everything else stays shared.
  const data: BuiltBuildingsData = { ...base };

  // DB Clone returns localization rows in the same action as their DB rows. Keep one lookup for
  // every board structure below so cloned chains, sets and variants receive their generated names.
  const locText: Record<string, string> = {};
  for (const row of byTable[LOC_TABLE] ?? []) {
    const key = str(row.values, "key");
    if (key) locText[key] = row.values.text ?? "";
  }

  for (const row of byTable.building_chains_tables ?? []) {
    const key = str(row.values, "key");
    if (!key) continue;
    const superChain = str(row.values, "building_superchain");
    data.chains = { ...data.chains };
    data.chains[key] = {
      key,
      superChain,
      chainCategory: optional(str(row.values, "chain_category")),
      sortOrder: num(row.values, "optional_sort_order"),
      tierIcon: optional(str(row.values, "optional_tier_icon")),
      canBeDismantled: bool(row.values, "can_be_dismantled", true),
      isForeignSlotChain: bool(row.values, "is_foreign_slot_chain"),
      localizedName: locText[`building_chains_encyclopedia_name_${key}`] || key,
      tooltip: optional(locText[`building_chains_chain_tooltip_${key}`] ?? ""),
    };
    if (superChain) {
      data.superChains = { ...data.superChains, [superChain]: [...(data.superChains[superChain] ?? []), key] };
    }
  }

  // Without this a brand new chain is invisible: it exists, but no slot template offers it, so the
  // region never reaches it. The chain rows above are only half of "add a chain".
  for (const row of byTable.slot_template_permitted_building_chains_tables ?? []) {
    const slotTemplate = str(row.values, "slot_template");
    if (!slotTemplate) continue;
    data.permittedByTemplate = {
      ...data.permittedByTemplate,
      [slotTemplate]: [
        ...(data.permittedByTemplate[slotTemplate] ?? []),
        {
          slotTemplate,
          chain: optional(str(row.values, "chain")),
          chainSet: optional(str(row.values, "chain_set")),
          superChain: optional(str(row.values, "super_chain")),
          remove: bool(row.values, "remove"),
        },
      ],
    };
  }

  for (const row of byTable.building_chain_availability_sets_tables ?? []) {
    const chain = str(row.values, "building_chain");
    const id = str(row.values, "id");
    if (!chain || !id) continue;
    data.availabilitySetsByChain = {
      ...data.availabilitySetsByChain,
      [chain]: [...(data.availabilitySetsByChain[chain] ?? []), id],
    };
  }

  for (const row of byTable.building_chain_availabilities_tables ?? []) {
    const setId = str(row.values, "set_id");
    if (!setId) continue;
    data.availabilitiesBySetId = {
      ...data.availabilitiesBySetId,
      [setId]: [
        ...(data.availabilitiesBySetId[setId] ?? []),
        {
          id: str(row.values, "id"),
          setId,
          culture: str(row.values, "culture"),
          subCulture: str(row.values, "sub_culture"),
          faction: str(row.values, "faction"),
          campaign: str(row.values, "campaign"),
        },
      ],
    };
  }

  for (const row of byTable.settlement_type_to_building_chains_junctions_tables ?? []) {
    const chain = str(row.values, "building_chain");
    const settlementType = str(row.values, "settlement_type");
    if (!chain || !settlementType) continue;
    data.settlementTypeBindings = {
      ...data.settlementTypeBindings,
      [chain]: [
        ...(data.settlementTypeBindings[chain] ?? []),
        { chain, settlementType, exclude: bool(row.values, "exclude") },
      ],
    };
  }

  for (const row of byTable.building_instances_tables ?? []) {
    const key = str(row.values, "key");
    if (!key) continue;
    data.instances = { ...data.instances, [key]: num(row.values, "num_instances") };
  }

  const touchedChains = new Set<string>();
  for (const row of byTable.building_levels_tables ?? []) {
    const levelKey = str(row.values, "level_name");
    if (!levelKey) continue;
    const chain = str(row.values, "chain");
    data.levelsByKey = { ...data.levelsByKey };
    data.levelsByKey[levelKey] = {
      levelKey,
      chain,
      level: num(row.values, "level"),
      createTime: num(row.values, "create_time"),
      createCost: num(row.values, "create_cost"),
      upkeepCost: num(row.values, "upkeep_cost"),
      foodCost: num(row.values, "food_cost"),
      developmentPointCost: num(row.values, "development_point_cost"),
      onlyInCapital: bool(row.values, "only_in_capital"),
      factionUnique: bool(row.values, "faction_unique"),
      visibleInUi: bool(row.values, "visible_in_ui", true),
      primarySlotLevelRequirement: num(row.values, "primary_slot_building_building_level_requirement"),
      instanceKey: optional(str(row.values, "building_instance_key")),
      rawValues: { ...row.values },
    };
    if (chain) {
      if (!touchedChains.has(chain)) {
        data.levelKeysByChain = { ...data.levelKeysByChain, [chain]: [...(data.levelKeysByChain[chain] ?? [])] };
        touchedChains.add(chain);
      }
      if (!data.levelKeysByChain[chain].includes(levelKey)) data.levelKeysByChain[chain].push(levelKey);
    }
  }
  for (const chain of touchedChains) {
    data.levelKeysByChain[chain].sort(
      (first, second) => (data.levelsByKey[first]?.level ?? 0) - (data.levelsByKey[second]?.level ?? 0),
    );
  }

  for (const row of byTable.building_sets_tables ?? []) {
    const key = str(row.values, "key");
    if (!key) continue;
    data.sets = { ...data.sets };
    data.sets[key] = {
      key,
      icon: optional(str(row.values, "icon")),
      sortOrder: num(row.values, "sort_order"),
      ...readSetColour(row.values),
      showInUi: bool(row.values, "show_in_ui", true),
      localizedName: locText[`building_sets_onscreen_name_${key}`] || key,
    };
  }

  for (const row of byTable.building_chain_sets_tables ?? []) {
    const key = str(row.values, "key");
    if (!key) continue;
    data.chainSetParents = {
      ...data.chainSetParents,
      [key]: optional(str(row.values, "parent_set")),
    };
  }

  const touchedChainSets = new Set<string>();
  for (const row of byTable.building_chain_set_items_tables ?? []) {
    const set = str(row.values, "set");
    if (!set) continue;
    if (!touchedChainSets.has(set)) {
      data.chainSetItems = { ...data.chainSetItems, [set]: [...(data.chainSetItems[set] ?? [])] };
      touchedChainSets.add(set);
    }
    data.chainSetItems[set].push({
      set,
      chain: optional(str(row.values, "chain")),
      superChain: optional(str(row.values, "super_chain")),
      remove: bool(row.values, "remove"),
    });
  }

  for (const row of byTable.building_culture_variants_tables ?? []) {
    const building = str(row.values, "building");
    if (!building) continue;
    const culture = str(row.values, "culture");
    const subculture = str(row.values, "subculture");
    const faction = str(row.values, "faction");
    const variant: BuildingVariantRow = {
      building,
      culture,
      subculture,
      faction,
      description: optional(str(row.values, "description")),
      shortDescription: optional(str(row.values, "short_description")),
      icon: optional(str(row.values, "icon")),
      disables: bool(row.values, "disables"),
      displayTooltip: bool(row.values, "display_tooltip", true),
      frameOverride: optional(str(row.values, "building_frame_override")),
      specificity: variantSpecificity(culture, subculture, faction),
    };
    // Appended, so `pickCultureVariant`'s "later candidate wins a tie" makes this the override.
    data.variantsByLevel = {
      ...data.variantsByLevel,
      [building]: [...(data.variantsByLevel[building] ?? []), variant],
    };
    const locKey = `building_culture_variants_name_${building}${culture}${subculture}${faction}`;
    const name = locText[locKey];
    if (name) {
      data.variantLoc = {
        ...data.variantLoc,
        [variantLocKey(building, culture, subculture, faction)]: {
          ...data.variantLoc[variantLocKey(building, culture, subculture, faction)],
          name,
        },
      };
    }
  }

  const setBindingRows = byTable.building_set_to_building_junctions_tables ?? [];
  if (setBindingRows.length > 0) {
    data.setBindings = [
      ...data.setBindings,
      ...setBindingRows.map((row) => ({
        chain: optional(str(row.values, "building_chain")),
        level: optional(str(row.values, "building_level")),
        set: str(row.values, "building_set"),
        exclude: bool(row.values, "exclude"),
      })),
    ];
  }

  const upgradeRows = byTable.building_upgrades_junction_tables ?? [];
  if (upgradeRows.length > 0) {
    data.upgrades = [
      ...data.upgrades,
      ...upgradeRows
        .map((row) => ({ from: str(row.values, "from"), to: str(row.values, "to") }))
        .filter((edge) => edge.from !== "" && edge.to !== "" && edge.from !== edge.to),
    ];
  }

  for (const row of byTable.building_effects_junction_tables ?? []) {
    const building = str(row.values, "building");
    const effectKey = str(row.values, "effect");
    if (!building || !effectKey) continue;
    const updated = {
      building,
      effectKey,
      scope: str(row.values, "effect_scope"),
      value: num(row.values, "value"),
      ...describeEffect(base, effectKey, num(row.values, "value")),
    };
    // Replaced, not appended: the table keys on (building, effect), so a row naming an effect the
    // building already has overrides it. Appending would draw the same effect twice, once at each
    // value, which is exactly what setting a new value on a vanilla effect does.
    const existing = data.effectsByLevel[building] ?? [];
    const index = existing.findIndex((effect) => effect.effectKey === effectKey);
    const next = [...existing];
    if (index >= 0) next[index] = updated;
    else next.push(updated);
    data.effectsByLevel = { ...data.effectsByLevel, [building]: next };
  }

  for (const row of byTable.building_units_allowed_tables ?? []) {
    const building = str(row.values, "building");
    const unitKey = str(row.values, "unit");
    if (!building || !unitKey) continue;
    // `enabled` is not read here either: every vanilla row has it false. See data.ts.
    const unit: BuildingUnitRow = {
      unitKey,
      localizedName: unitKey,
      faction: optional(str(row.values, "faction")),
      xp: num(row.values, "XP"),
    };
    data.recruitableByLevel = {
      ...data.recruitableByLevel,
      [building]: [...(data.recruitableByLevel[building] ?? []), unit],
    };
  }

  for (const row of byTable.building_level_armed_citizenry_junctions_tables ?? []) {
    const building = str(row.values, "building_level");
    const unitGroup = str(row.values, "unit_group");
    if (!building || !unitGroup) continue;
    const next = [...(data.garrisonByLevel[building] ?? [])];
    for (const unit of data.garrisonUnitsByGroup[unitGroup] ?? []) {
      if (next.some((existing) => existing.unitKey === unit.unitKey && existing.unitGroup === unitGroup)) continue;
      next.push(unit);
    }
    data.garrisonByLevel = { ...data.garrisonByLevel, [building]: next };
  }

  return data;
};
