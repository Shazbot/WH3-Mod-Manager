import type { AbilitiesTableRows, AbilityTableRow } from "./types";

/** Localisation entries share the pending-row editor with DB rows. */
export const ABILITIES_LOC_TABLE = "__loc__";

export const ABILITY_EDITOR_TABLES = [
  "unit_abilities_tables",
  "unit_special_abilities_tables",
  "special_ability_to_special_ability_phase_junctions_tables",
  "special_ability_phases_tables",
  "special_ability_phase_stat_effects_tables",
  "projectile_bombardments_tables",
  "projectiles_tables",
  "projectiles_explosions_tables",
  "battle_vortexs_tables",
  "unit_abilities_to_additional_ui_effects_juncs_tables",
  "unit_abilities_additional_ui_effects_tables",
  "special_ability_groups_tables",
  "special_ability_groups_to_unit_abilities_junctions_tables",
  "special_ability_to_auto_deactivate_flags_tables",
  "special_ability_to_invalid_target_flags_tables",
  "special_ability_to_invalid_usage_flags_tables",
  "special_ability_intensity_settings_tables",
  "unit_ability_superseded_abilities_sets_tables",
  "unit_ability_superseded_abilities_set_elements_tables",
  "land_units_to_unit_abilites_junctions_tables",
  "army_special_abilities_tables",
  "effect_bonus_value_unit_ability_junctions_tables",
  "unit_ability_types_tables",
  "unit_ability_source_types_tables",
  "ui_unit_stats_tables",
  "_kv_unit_ability_scaling_rules_tables",
] as const;

export const ABILITY_TABLE_KEY_COLUMNS: Record<string, string[]> = {
  unit_abilities_tables: ["key"],
  unit_special_abilities_tables: ["key"],
  special_ability_to_special_ability_phase_junctions_tables: [
    "special_ability",
    "order",
    "target_self",
    "target_friends",
    "target_enemies",
  ],
  special_ability_phases_tables: ["id"],
  special_ability_phase_stat_effects_tables: ["phase", "stat"],
  projectile_bombardments_tables: ["bombardment_key"],
  projectiles_tables: ["key"],
  projectiles_explosions_tables: ["key"],
  battle_vortexs_tables: ["vortex_key"],
  unit_abilities_to_additional_ui_effects_juncs_tables: ["ability", "effect"],
  unit_abilities_additional_ui_effects_tables: ["key"],
  special_ability_groups_tables: ["ability_group"],
  special_ability_groups_to_unit_abilities_junctions_tables: ["special_ability_groups", "unit_special_abilities"],
  special_ability_to_auto_deactivate_flags_tables: ["deactivate_flag", "special_ability"],
  special_ability_to_invalid_target_flags_tables: ["invalid_target", "special_ability"],
  special_ability_to_invalid_usage_flags_tables: ["invalid_usage_flag", "special_ability"],
  special_ability_intensity_settings_tables: ["ability"],
  unit_ability_superseded_abilities_sets_tables: ["key"],
  unit_ability_superseded_abilities_set_elements_tables: ["set_key", "superseded_ability_key"],
  land_units_to_unit_abilites_junctions_tables: ["ability", "land_unit"],
  army_special_abilities_tables: ["army_special_ability"],
  effect_bonus_value_unit_ability_junctions_tables: ["effect", "bonus_value_id", "unit_ability"],
  unit_ability_types_tables: ["key"],
  unit_ability_source_types_tables: ["key"],
  ui_unit_stats_tables: ["key"],
  _kv_unit_ability_scaling_rules_tables: ["key"],
  [ABILITIES_LOC_TABLE]: ["key"],
};

export type AbilityEditOrigin = "override" | "clone" | "copyPayload" | "manual" | "localization";

export interface AbilityNewRow {
  id: string;
  table: string;
  values: Record<string, string>;
  groupId: string;
  origin: AbilityEditOrigin;
}

export interface AbilityEditState {
  rowsById: Record<string, AbilityNewRow>;
  order: string[];
  nextRowSeq: number;
}

export const emptyAbilityEditState = (): AbilityEditState => ({ rowsById: {}, order: [], nextRowSeq: 1 });

export type AbilityEditAction =
  | { type: "reset" }
  | { type: "addRows"; rows: Array<Omit<AbilityNewRow, "id" | "groupId">>; groupId?: string }
  | { type: "upsertRows"; rows: Array<Omit<AbilityNewRow, "id" | "groupId">>; groupId?: string }
  | { type: "setCell"; id: string; column: string; value: string }
  | { type: "removeRow"; id: string }
  | { type: "removeGroup"; groupId: string };

const rowIdentity = (table: string, values: Record<string, string>) => {
  const columns = ABILITY_TABLE_KEY_COLUMNS[table];
  if (!columns?.length) return undefined;
  return `${table}|${columns.map((column) => values[column] ?? "").join("|")}`;
};

export const abilityEditReducer = (state: AbilityEditState, action: AbilityEditAction): AbilityEditState => {
  if (action.type === "reset") return emptyAbilityEditState();
  if (action.type === "setCell") {
    const row = state.rowsById[action.id];
    if (!row) return state;
    return {
      ...state,
      rowsById: { ...state.rowsById, [action.id]: { ...row, values: { ...row.values, [action.column]: action.value } } },
    };
  }
  if (action.type === "removeRow") {
    if (!state.rowsById[action.id]) return state;
    const rowsById = { ...state.rowsById };
    delete rowsById[action.id];
    return { ...state, rowsById, order: state.order.filter((id) => id !== action.id) };
  }
  if (action.type === "removeGroup") {
    const doomed = new Set(state.order.filter((id) => state.rowsById[id]?.groupId === action.groupId));
    if (!doomed.size) return state;
    const rowsById = { ...state.rowsById };
    doomed.forEach((id) => delete rowsById[id]);
    return { ...state, rowsById, order: state.order.filter((id) => !doomed.has(id)) };
  }
  if (action.type === "addRows" || action.type === "upsertRows") {
    if (!action.rows.length) return state;
    const rowsById = { ...state.rowsById };
    const order = [...state.order];
    const idsByIdentity = new Map<string, string>();
    if (action.type === "upsertRows") {
      for (const id of order) {
        const row = rowsById[id];
        const identity = row && rowIdentity(row.table, row.values);
        if (identity) idsByIdentity.set(identity, id);
      }
    }
    const groupId = action.groupId ?? `group_${state.nextRowSeq}`;
    let nextRowSeq = state.nextRowSeq;
    for (const incoming of action.rows) {
      const identity = action.type === "upsertRows" ? rowIdentity(incoming.table, incoming.values) : undefined;
      const existingId = identity ? idsByIdentity.get(identity) : undefined;
      if (existingId && rowsById[existingId]) {
        rowsById[existingId] = { ...rowsById[existingId], values: { ...incoming.values }, origin: incoming.origin };
        continue;
      }
      const id = `ability_row_${nextRowSeq++}`;
      rowsById[id] = { ...incoming, id, groupId, values: { ...incoming.values } };
      order.push(id);
      if (identity) idsByIdentity.set(identity, id);
    }
    return { ...state, rowsById, order, nextRowSeq };
  }
  return state;
};

export const abilityNewRowsByTable = (state: AbilityEditState) => {
  const result: Record<string, AbilityNewRow[]> = {};
  for (const id of state.order) {
    const row = state.rowsById[id];
    if (row) (result[row.table] ||= []).push(row);
  }
  return result;
};

export const applyAbilityPendingRows = (base: AbilitiesTableRows, state?: AbilityEditState): AbilitiesTableRows => {
  if (!state || state.order.length === 0) return base;
  const result: AbilitiesTableRows = { ...base };
  for (const [table, rows] of Object.entries(abilityNewRowsByTable(state))) {
    if (table === ABILITIES_LOC_TABLE) continue;
    const baseRows = base[table] ?? [];
    const baseByIdentity = new Map<string, AbilityTableRow>();
    for (const baseRow of baseRows) {
      const identity = rowIdentity(table, baseRow);
      if (identity) baseByIdentity.set(identity, baseRow);
    }
    const pending: AbilityTableRow[] = rows.map((row) => {
      const identity = rowIdentity(table, row.values);
      const baseRow = identity ? baseByIdentity.get(identity) : undefined;
      return {
        ...row.values,
        __sourcePackPath: "__pending__",
        __sourcePackName: "Pending edits",
        __sourceKind: "pending",
        __baseSourcePackPath: baseRow?.__sourcePackPath,
        __baseSourcePackName: baseRow?.__sourcePackName,
        __baseSourceKind: baseRow?.__sourceKind === "vanilla" || baseRow?.__sourceKind === "mod" ? baseRow.__sourceKind : undefined,
      };
    });
    result[table] = [...baseRows, ...pending];
  }
  return result;
};
