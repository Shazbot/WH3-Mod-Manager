/**
 * Turning a user action into the rows it actually means.
 *
 * Kept apart from the reducer so the mapping - "adding a building writes these five rows in these
 * four tables" - can be read and tested on its own. Pure.
 */
import { LOC_TABLE, takeNumericId, type BuildingsNewRow } from "./edits";
import { buildVariantNameLocKey } from "./data";
import type { BuildingsRegionView, BuildingsTile } from "./types";

export type NewRowDraft = Omit<BuildingsNewRow, "id" | "groupId">;

export interface BuildingLevelShift {
  levelKey: string;
  level: number;
  values: Record<string, string>;
}

export interface AddBuildingLevelInput {
  levelKey: string;
  chainKey: string;
  level: number;
  setKey?: string;
  culture: string;
  subculture: string;
  faction: string;
  title: string;
  shortDescription?: string;
  longDescription?: string;
  icon?: string;
  createTime: number;
  createCost: number;
  upkeepCost: number;
  /**
   * The primary settlement level this needs, which is also the board row it lands on. Left at 0 the
   * new building would drop to the bottom row rather than sitting above the one it upgrades from.
   */
  primarySlotLevelRequirement?: number;
  /**
   * Effects to give the new building, normally copied off the one it upgrades from. Part of this
   * action rather than a separate one so undoing the addition takes them with it.
   */
  effects?: Array<{ effectKey: string; scope: string; value: number }>;
  /** Recruitment rows to copy from the building this level upgrades. */
  recruitableUnits?: Array<{ unitKey: string; faction?: string; xp?: number }>;
  /** Garrison groups to copy from the building this level upgrades. */
  garrisonUnitGroups?: string[];
  /** When set, the new building is the upgrade of this one. */
  upgradeFromLevelKey?: string;
  /** When set, the existing building is the upgrade of this new, lower level. */
  upgradeToLevelKey?: string;
  /** Existing rows at and above a newly inserted lower level, copied with their level incremented. */
  shiftedLevelRows?: BuildingLevelShift[];
  /**
   * Whether the chain is already bound to `setKey`. Passed in rather than looked up so this stays
   * usable from the renderer, which never holds the built dataset.
   */
  isChainAlreadyInSet?: boolean;
}

const bool = (value: boolean) => (value ? "true" : "false");

/**
 * The rows a new building level needs to exist and be visible.
 *
 * The building set junction is only written when the chain is not already bound to that set - a
 * duplicate row would be dropped by the key dedupe anyway, and writing it would put a redundant row
 * in the user's pack.
 */
export const addBuildingLevelRows = (input: AddBuildingLevelInput, cursors: Record<string, number>): NewRowDraft[] => {
  const rows: NewRowDraft[] = [
    {
      table: "building_levels_tables",
      origin: "addBuilding",
      values: {
        level_name: input.levelKey,
        chain: input.chainKey,
        level: `${input.level}`,
        create_time: `${input.createTime}`,
        create_cost: `${input.createCost}`,
        upkeep_cost: `${input.upkeepCost}`,
        primary_slot_building_building_level_requirement: `${input.primarySlotLevelRequirement ?? 0}`,
        visible_in_ui: bool(true),
      },
    },
    {
      table: "building_culture_variants_tables",
      origin: "addBuilding",
      values: {
        building: input.levelKey,
        culture: input.culture,
        subculture: input.subculture,
        faction: input.faction,
        icon: input.icon ?? "",
        description: input.longDescription ? `${input.levelKey}_desc` : "",
        short_description: input.shortDescription ? `${input.levelKey}_short` : "",
        disables: bool(false),
        display_tooltip: bool(true),
      },
    },
  ];

  // A lower building is inserted at the selected building's current level. The selected building
  // and every level above it therefore need full-row overrides with their DB level incremented.
  for (const shifted of input.shiftedLevelRows ?? []) {
    if (!shifted.levelKey || shifted.levelKey === input.levelKey) continue;
    rows.push({
      table: "building_levels_tables",
      origin: "shiftBuildingLevel",
      values: {
        ...shifted.values,
        level_name: shifted.levelKey,
        level: `${shifted.level + 1}`,
      },
    });
  }

  if (input.setKey && !input.isChainAlreadyInSet) {
    rows.push({
      table: "building_set_to_building_junctions_tables",
      origin: "addBuilding",
      values: {
        building_chain: input.chainKey,
        building_level: "",
        building_set: input.setKey,
        exclude: bool(false),
      },
    });
  }

  for (const unit of input.recruitableUnits ?? []) {
    rows.push({
      table: "building_units_allowed_tables",
      origin: "addBuilding",
      values: {
        key: takeNumericId(cursors, "building_units_allowed_tables"),
        building: input.levelKey,
        unit: unit.unitKey,
        XP: `${unit.xp ?? 0}`,
        faction: unit.faction ?? "",
        enabled: bool(true),
      },
    });
  }

  // A group expands to several units on the board, but the database has one junction row per
  // group. The tile therefore repeats a group once per expanded unit; keep one copied junction.
  for (const unitGroup of [...new Set(input.garrisonUnitGroups ?? [])]) {
    if (!unitGroup) continue;
    rows.push({
      table: "building_level_armed_citizenry_junctions_tables",
      origin: "addBuilding",
      values: {
        id: takeNumericId(cursors, "building_level_armed_citizenry_junctions_tables"),
        building_level: input.levelKey,
        unit_group: unitGroup,
      },
    });
  }

  for (const effect of input.effects ?? []) {
    rows.push({
      table: "building_effects_junction_tables",
      origin: "addBuilding",
      values: {
        building: input.levelKey,
        effect: effect.effectKey,
        effect_scope: effect.scope,
        value: `${effect.value}`,
      },
    });
  }

  const upgrade = input.upgradeFromLevelKey
    ? { from: input.upgradeFromLevelKey, to: input.levelKey }
    : input.upgradeToLevelKey
      ? { from: input.levelKey, to: input.upgradeToLevelKey }
      : undefined;
  if (upgrade) {
    rows.push({
      table: "building_upgrades_junction_tables",
      origin: "addBuilding",
      values: upgrade,
    });
  }

  rows.push({
    table: LOC_TABLE,
    origin: "addBuilding",
    values: {
      key: buildVariantNameLocKey(input.levelKey, input.culture, input.subculture, input.faction),
      text: input.title,
    },
  });
  if (input.shortDescription) {
    rows.push({
      table: LOC_TABLE,
      origin: "addBuilding",
      values: {
        key: `building_short_description_texts_short_description_${input.levelKey}_short`,
        text: input.shortDescription,
      },
    });
  }
  if (input.longDescription) {
    rows.push({
      table: LOC_TABLE,
      origin: "addBuilding",
      values: { key: `building_description_texts_description_${input.levelKey}_desc`, text: input.longDescription },
    });
  }

  return rows;
};

/** Whether the chain has an empty board row above this tile for a new building. */
export const canAddBuildingAbove = (
  tile: Pick<BuildingsTile, "chainKey" | "tierRow">,
  view: Pick<BuildingsRegionView, "bands"> | undefined,
): boolean => {
  if (!view) return false;
  return !view.bands.some((band) =>
    band.columns.some(
      (column) =>
        column.chainKey === tile.chainKey &&
        column.tiles.some((candidate) => candidate.chainKey === tile.chainKey && candidate.tierRow > tile.tierRow),
    ),
  );
};

/** Whether the chain has an empty board row below this tile for a new building. */
export const canAddBuildingBelow = (
  tile: Pick<BuildingsTile, "chainKey" | "tierRow">,
  view: Pick<BuildingsRegionView, "bands"> | undefined,
): boolean => {
  if (tile.tierRow <= 0 || !view) return false;
  return !view.bands.some((band) =>
    band.columns.some(
      (column) =>
        column.chainKey === tile.chainKey &&
        column.tiles.some((candidate) => candidate.chainKey === tile.chainKey && candidate.tierRow < tile.tierRow),
    ),
  );
};

/** The complete existing rows that must move up when a new lower level is inserted. */
export const levelsToShiftForBuildingBelow = (
  tile: Pick<BuildingsTile, "chainKey" | "level">,
  view: Pick<BuildingsRegionView, "bands"> | undefined,
): BuildingLevelShift[] => {
  if (!view) return [];
  const byLevelKey = new Map<string, BuildingLevelShift>();
  for (const band of view.bands) {
    for (const column of band.columns) {
      if (column.chainKey !== tile.chainKey) continue;
      for (const candidate of column.tiles) {
        if (candidate.level < tile.level || !candidate.levelRowValues) continue;
        byLevelKey.set(candidate.levelKey, {
          levelKey: candidate.levelKey,
          level: candidate.level,
          values: { ...candidate.levelRowValues },
        });
      }
    }
  }
  return [...byLevelKey.values()].sort((first, second) => second.level - first.level);
};

export type BuildingMoveDirection = "lower" | "higher";

const PRIMARY_SLOT_LEVEL_REQUIREMENT = "primary_slot_building_building_level_requirement";
const MIN_PRIMARY_SLOT_LEVEL_REQUIREMENT = 0;
const MAX_PRIMARY_SLOT_LEVEL_REQUIREMENT = 5;

const moveDelta = (direction: BuildingMoveDirection) => (direction === "higher" ? 1 : -1);

/** The board row a building would occupy after moving one row in either direction. */
const movedTierRow = (tierRow: number, direction: BuildingMoveDirection) => tierRow + moveDelta(direction);

/**
 * The DB requirement is one-based for secondary buildings while the board row is zero-based. A
 * requirement of zero is the default for a building that has no explicit primary-tier requirement;
 * once it is deliberately moved, use the normal one-based value for its target row.
 */
const requirementForTierRow = (tierRow: number) => tierRow + 1;

const isValidMovedTierRow = (tierRow: number) => {
  const requirement = requirementForTierRow(tierRow);
  return (
    tierRow >= 0 &&
    MIN_PRIMARY_SLOT_LEVEL_REQUIREMENT <= requirement &&
    requirement <= MAX_PRIMARY_SLOT_LEVEL_REQUIREMENT
  );
};

/** Distinct levels in one chain, because a chain may be bound to more than one building set. */
const chainTilesInView = (chainKey: string, view: Pick<BuildingsRegionView, "bands"> | undefined): BuildingsTile[] => {
  if (!view) return [];
  const byLevelKey = new Map<string, BuildingsTile>();
  for (const band of view.bands) {
    for (const column of band.columns) {
      if (column.chainKey !== chainKey) continue;
      for (const tile of column.tiles) {
        if (tile.chainKey === chainKey && !byLevelKey.has(tile.levelKey)) byLevelKey.set(tile.levelKey, tile);
      }
    }
  }
  return [...byLevelKey.values()].sort(
    (first, second) => first.level - second.level || first.levelKey.localeCompare(second.levelKey),
  );
};

const movedLevelRowValues = (tile: BuildingsTile, targetTierRow: number): Record<string, string> | undefined => {
  if (!tile.levelRowValues) return undefined;
  return {
    ...tile.levelRowValues,
    level_name: tile.levelKey,
    chain: tile.chainKey,
    [PRIMARY_SLOT_LEVEL_REQUIREMENT]: `${requirementForTierRow(targetTierRow)}`,
  };
};

/** Whether a single secondary building can move into the adjacent board row. */
export const canMoveBuilding = (
  tile: Pick<BuildingsTile, "levelKey" | "chainKey" | "tierRow" | "isSettlementOrPort">,
  view: Pick<BuildingsRegionView, "bands"> | undefined,
  direction: BuildingMoveDirection,
): boolean => {
  if (tile.isSettlementOrPort || !view) return false;
  const targetTierRow = movedTierRow(tile.tierRow, direction);
  if (!isValidMovedTierRow(targetTierRow)) return false;
  return !chainTilesInView(tile.chainKey, view).some(
    (candidate) => candidate.levelKey !== tile.levelKey && candidate.tierRow === targetTierRow,
  );
};

/** A pending override for moving one building one board row. */
export const moveBuildingRows = (tile: BuildingsTile, direction: BuildingMoveDirection): NewRowDraft[] => {
  if (tile.isSettlementOrPort) return [];
  const targetTierRow = movedTierRow(tile.tierRow, direction);
  if (!isValidMovedTierRow(targetTierRow)) return [];
  const values = movedLevelRowValues(tile, targetTierRow);
  if (!values) return [];
  return [
    {
      table: "building_levels_tables",
      origin: "moveBuilding",
      values,
    },
  ];
};

/** Whether every visible level in a chain can move one board row in the requested direction. */
export const canMoveBuildingChain = (
  tile: Pick<BuildingsTile, "chainKey" | "isSettlementOrPort">,
  view: Pick<BuildingsRegionView, "bands"> | undefined,
  direction: BuildingMoveDirection,
): boolean => {
  if (tile.isSettlementOrPort) return false;
  const chainTiles = chainTilesInView(tile.chainKey, view);
  return (
    chainTiles.length > 0 &&
    chainTiles.every(
      (candidate) => !candidate.isSettlementOrPort && isValidMovedTierRow(movedTierRow(candidate.tierRow, direction)),
    )
  );
};

/** Pending overrides for moving every visible level in a chain one board row. */
export const moveBuildingChainRows = (
  tile: Pick<BuildingsTile, "chainKey" | "isSettlementOrPort">,
  view: Pick<BuildingsRegionView, "bands"> | undefined,
  direction: BuildingMoveDirection,
): NewRowDraft[] => {
  const chainTiles = chainTilesInView(tile.chainKey, view);
  if (!canMoveBuildingChain(tile, view, direction) || chainTiles.some((candidate) => !candidate.levelRowValues))
    return [];
  return chainTiles.flatMap((candidate) => {
    const values = movedLevelRowValues(candidate, movedTierRow(candidate.tierRow, direction));
    return values ? [{ table: "building_levels_tables", origin: "moveBuilding" as const, values }] : [];
  });
};

export interface AddBuildingChainInput {
  chainKey: string;
  superChain: string;
  chainCategory?: string;
  sortOrder?: number;
  /** Who the chain is available to. An empty column means "anyone". */
  culture: string;
  subculture: string;
  faction: string;
  campaign: string;
  /** The current region's slot templates, so the chain is actually offered somewhere. */
  slotTemplates: string[];
  /** Settlement types to bind it to. Empty means "every settlement type". */
  settlementTypes?: string[];
}

/**
 * A whole new building chain, rather than another level in one that exists.
 *
 * Four things have to line up or the chain is invisible, and getting one of them wrong is the usual
 * reason a hand-written building never appears: the chain row itself; an availability set naming who
 * may build it; a `slot_template_permitted_building_chains` row per slot the region has, since a
 * chain nothing offers is unreachable; and optionally the settlement types it is allowed in.
 *
 * The availability trio is written even for an unrestricted chain. A chain with no availability rows
 * is available to everyone, so the rows are strictly speaking optional then - but a modder who later
 * narrows it has the structure already there rather than having to discover three more tables.
 */
export const addBuildingChainRows = (input: AddBuildingChainInput, cursors: Record<string, number>): NewRowDraft[] => {
  const setId = `${input.chainKey}_availability`;
  const rows: NewRowDraft[] = [
    {
      table: "building_chains_tables",
      origin: "addChain",
      values: {
        key: input.chainKey,
        building_superchain: input.superChain,
        chain_category: input.chainCategory ?? "",
        in_encyclopedia: bool(true),
        optional_sort_order: `${input.sortOrder ?? 0}`,
        can_be_dismantled: bool(true),
        is_foreign_slot_chain: bool(false),
      },
    },
    { table: "building_chain_availability_set_ids_tables", origin: "addChain", values: { id: setId } },
    {
      table: "building_chain_availability_sets_tables",
      origin: "addChain",
      values: { building_chain: input.chainKey, id: setId },
    },
    {
      table: "building_chain_availabilities_tables",
      origin: "addChain",
      values: {
        id: takeNumericId(cursors, "building_chain_availabilities_tables"),
        set_id: setId,
        culture: input.culture,
        sub_culture: input.subculture,
        faction: input.faction,
        campaign: input.campaign,
      },
    },
  ];

  // Deduped: a region often lists the same template under more than one slot, and a repeated
  // permission row would just override itself.
  for (const slotTemplate of [...new Set(input.slotTemplates)]) {
    rows.push({
      table: "slot_template_permitted_building_chains_tables",
      origin: "addChain",
      values: {
        slot_template: slotTemplate,
        chain: input.chainKey,
        chain_set: "",
        super_chain: "",
        remove: bool(false),
      },
    });
  }

  for (const settlementType of input.settlementTypes ?? []) {
    rows.push({
      table: "settlement_type_to_building_chains_junctions_tables",
      origin: "addChain",
      values: { building_chain: input.chainKey, settlement_type: settlementType, exclude: bool(false) },
    });
  }

  return rows;
};

/**
 * Takes a building away from a culture, subculture or faction.
 *
 * A pack can only add rows, so removal is expressed the way the game expresses it: a culture variant
 * flagged `disables`. It only bites for the exact culture/subculture/faction written here, which is
 * why the caller passes all three.
 */
export const disableBuildingRows = (input: {
  levelKey: string;
  culture: string;
  subculture: string;
  faction: string;
}): NewRowDraft[] => [
  {
    table: "building_culture_variants_tables",
    origin: "disableBuilding",
    values: {
      building: input.levelKey,
      culture: input.culture,
      subculture: input.subculture,
      faction: input.faction,
      disables: bool(true),
      display_tooltip: bool(false),
    },
  },
];

/** Adds one culture-variant row for a building. Empty culture fields mean "all" in the game. */
export const addBuildingCultureVariantRows = (input: {
  levelKey: string;
  culture: string;
  subculture: string;
  faction: string;
  icon?: string;
  disables?: boolean;
}): NewRowDraft[] => [
  {
    table: "building_culture_variants_tables",
    origin: "manual",
    values: {
      building: input.levelKey,
      culture: input.culture,
      subculture: input.subculture,
      faction: input.faction,
      icon: input.icon ?? "",
      disables: bool(input.disables ?? false),
      display_tooltip: bool(!(input.disables ?? false)),
    },
  },
];

/** Removes a chain from one building set's band, leaving the chain itself alone. */
export const excludeFromSetRows = (input: { chainKey: string; setKey: string }): NewRowDraft[] => [
  {
    table: "building_set_to_building_junctions_tables",
    origin: "excludeFromSet",
    values: {
      building_chain: input.chainKey,
      building_level: "",
      building_set: input.setKey,
      exclude: bool(true),
    },
  },
];

/** A recruitable unit. `building_units_allowed` has a numeric key, so one is allocated here. */
export const addRecruitableUnitRows = (
  input: { levelKey: string; unitKey: string; faction?: string; xp?: number },
  cursors: Record<string, number>,
): NewRowDraft[] => [
  {
    table: "building_units_allowed_tables",
    origin: "manual",
    values: {
      key: takeNumericId(cursors, "building_units_allowed_tables"),
      building: input.levelKey,
      unit: input.unitKey,
      XP: `${input.xp ?? 0}`,
      faction: input.faction ?? "",
      enabled: bool(true),
    },
  },
];

/** A garrison unit group on a building level. Also numeric-keyed. */
export const addGarrisonRows = (
  input: { levelKey: string; unitGroup: string },
  cursors: Record<string, number>,
): NewRowDraft[] => [
  {
    table: "building_level_armed_citizenry_junctions_tables",
    origin: "manual",
    values: {
      id: takeNumericId(cursors, "building_level_armed_citizenry_junctions_tables"),
      building_level: input.levelKey,
      unit_group: input.unitGroup,
    },
  },
];

/**
 * The columns of a CAI row that name a chain, a level, an instance or a superchain.
 *
 * Rewriting is keyed off the column name rather than a per-table mapping because the two CAI tables
 * disagree about almost everything else, and a value that does not match the template is left alone
 * either way.
 */
const CAI_CHAIN_COLUMNS = ["building_chain", "existing_building_chain_key", "potential_buiding_chain_key"];
const CAI_SUPER_CHAIN_COLUMNS = [
  "building_super_chain",
  "existing_building_super_chain",
  "potential_building_super_chain",
];
const CAI_INSTANCE_COLUMNS = ["building_instance", "existing_building_instance", "potential_building_instance"];
const CAI_LEVEL_COLUMNS = [
  "building_or_building_range_start_inclusive",
  "building_range_end_inclusive",
  "existing_building_level_inclusive_start",
  "existing_building_level_inclusive_end",
  "potential_building_level_inclusive_start",
  "potential_building_level_inclusive_end",
];

export interface CloneCaiInput {
  /** The chain whose CAI rows are being copied. */
  fromChainKey: string;
  toChainKey: string;
  /** Whole rows as the built data holds them, per table. */
  rowsByTable: Record<string, Array<Record<string, string>>>;
  fromSuperChain?: string;
  toSuperChain?: string;
  fromInstanceKey?: string;
  toInstanceKey?: string;
  /** Level key rewrites, `from -> to`. Anything unlisted is copied unchanged. */
  levelKeyMap?: Record<string, string>;
}

/**
 * Copies a chain's CAI rows onto a new chain.
 *
 * The spec's "we clone them usually from existing buildings": the AI will not build a new building
 * at all without these, and hand-writing them means understanding thirty scoring columns. Only the
 * columns naming the template are rewritten, so a row that mentions some third chain keeps pointing
 * at it - a synergy between the template and another building becomes the same synergy for the new
 * one.
 */
export const cloneCaiRows = (input: CloneCaiInput): NewRowDraft[] => {
  const rewrite = (column: string, value: string): string => {
    if (value === "") return value;
    if (CAI_CHAIN_COLUMNS.includes(column) && value === input.fromChainKey) return input.toChainKey;
    if (CAI_SUPER_CHAIN_COLUMNS.includes(column) && input.fromSuperChain && value === input.fromSuperChain) {
      return input.toSuperChain ?? value;
    }
    if (CAI_INSTANCE_COLUMNS.includes(column) && input.fromInstanceKey && value === input.fromInstanceKey) {
      return input.toInstanceKey ?? value;
    }
    if (CAI_LEVEL_COLUMNS.includes(column)) return input.levelKeyMap?.[value] ?? value;
    return value;
  };

  const rows: NewRowDraft[] = [];
  for (const [table, tableRows] of Object.entries(input.rowsByTable)) {
    for (const row of tableRows) {
      const values: Record<string, string> = {};
      for (const [column, value] of Object.entries(row)) values[column] = rewrite(column, value);
      // A row that came out identical names the template nowhere, so copying it would just duplicate
      // a vanilla row under a new file and override it.
      if (Object.entries(values).every(([column, value]) => row[column] === value)) continue;
      rows.push({ table, origin: "clone", values });
    }
  }
  return rows;
};

/** An effect on a building level. */
export const addEffectRows = (input: {
  levelKey: string;
  effectKey: string;
  scope: string;
  value: number;
}): NewRowDraft[] => [
  {
    table: "building_effects_junction_tables",
    origin: "manual",
    values: {
      building: input.levelKey,
      effect: input.effectKey,
      effect_scope: input.scope,
      value: `${input.value}`,
    },
  },
];
