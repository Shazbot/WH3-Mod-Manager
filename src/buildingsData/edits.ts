/**
 * The rows the user has added, and how they fold back into the derivation.
 *
 * One store, two views: the board and the tables sub-tab both read and write `rowsById`, so the
 * "two-way sync" the spec asks for is not a sync at all - there is only ever one copy. Pure, so the
 * renderer can re-derive the whole board after an edit without a round trip.
 */
import { BUILDINGS_TABLE_KEY_COLUMNS, dedupeRowsByKey } from "./data";
import type { BuildingsTableRows, BuiltBuildingsData } from "./types";

/** Loc entries ride the same store as db rows; this is their pseudo-table. */
export const LOC_TABLE = "__loc__";

export type BuildingsRowOrigin =
  | "addBuilding"
  | "shiftBuildingLevel"
  | "moveBuilding"
  | "addChain"
  | "disableBuilding"
  | "excludeFromSet"
  | "clone"
  | "manual";

export interface BuildingsNewRow {
  /** Stable across both sub-tabs, so a grid edit and a board edit address the same row. */
  id: string;
  /** A DB table name, or {@link LOC_TABLE}. */
  table: string;
  /** Column -> value, every value a string. Booleans are "true"/"false". */
  values: Record<string, string>;
  /** Every row one user action produced, so the action can be undone as a unit. */
  groupId: string;
  origin: BuildingsRowOrigin;
}

export interface BuildingsEditState {
  rowsById: Record<string, BuildingsNewRow>;
  /** Insertion order, so the tables tab lists rows the way they were made. */
  order: string[];
  /** Next free id per numeric-id table, seeded from the catalog's `nextNumericIds`. */
  numericIdCursors: Record<string, number>;
  /** Bumped per row so ids are unique within a session. */
  nextRowSeq: number;
}

export const emptyBuildingsEditState = (numericIdCursors: Record<string, number> = {}): BuildingsEditState => ({
  rowsById: {},
  order: [],
  numericIdCursors: { ...numericIdCursors },
  nextRowSeq: 1,
});

export type BuildingsEditAction =
  | { type: "reset"; numericIdCursors?: Record<string, number> }
  | { type: "seedNumericIdCursors"; numericIdCursors: Record<string, number> }
  | {
      type: "addRows";
      rows: Array<Omit<BuildingsNewRow, "id" | "groupId">>;
      groupId?: string;
      /**
       * The cursors the action advanced. `takeNumericId` mutates a copy, so without storing it back
       * the next action starts from the same id and the two rows collide.
       */
      numericIdCursors?: Record<string, number>;
    }
  | { type: "setCell"; id: string; column: string; value: string }
  | { type: "removeRow"; id: string }
  | { type: "removeGroup"; groupId: string };

/** Allocates the next id for a numeric-id table, mutating the cursor map it is given. */
export const takeNumericId = (cursors: Record<string, number>, table: string): string => {
  const next = cursors[table] ?? 0;
  cursors[table] = next + 1;
  return `${next}`;
};

export const buildingsEditReducer = (state: BuildingsEditState, action: BuildingsEditAction): BuildingsEditState => {
  switch (action.type) {
    case "reset":
      return emptyBuildingsEditState(action.numericIdCursors ?? state.numericIdCursors);

    case "seedNumericIdCursors":
      // A refreshed catalog must not renumber IDs already assigned to pending rows.
      if (state.order.length > 0) return state;
      return { ...state, numericIdCursors: { ...action.numericIdCursors } };

    case "addRows": {
      if (action.rows.length === 0) return state;
      const groupId = action.groupId ?? `group_${state.nextRowSeq}`;
      const rowsById = { ...state.rowsById };
      const order = [...state.order];
      let nextRowSeq = state.nextRowSeq;
      for (const row of action.rows) {
        const id = `row_${nextRowSeq++}`;
        rowsById[id] = { ...row, id, groupId, values: { ...row.values } };
        order.push(id);
      }
      return {
        ...state,
        rowsById,
        order,
        nextRowSeq,
        numericIdCursors: action.numericIdCursors ?? state.numericIdCursors,
      };
    }

    case "setCell": {
      const existing = state.rowsById[action.id];
      if (!existing) return state;
      return {
        ...state,
        rowsById: {
          ...state.rowsById,
          [action.id]: { ...existing, values: { ...existing.values, [action.column]: action.value } },
        },
      };
    }

    case "removeRow": {
      if (!state.rowsById[action.id]) return state;
      const rowsById = { ...state.rowsById };
      delete rowsById[action.id];
      return { ...state, rowsById, order: state.order.filter((id) => id !== action.id) };
    }

    case "removeGroup": {
      const doomed = new Set(state.order.filter((id) => state.rowsById[id]?.groupId === action.groupId));
      if (doomed.size === 0) return state;
      const rowsById = { ...state.rowsById };
      for (const id of doomed) delete rowsById[id];
      return { ...state, rowsById, order: state.order.filter((id) => !doomed.has(id)) };
    }

    default:
      return state;
  }
};

/** The new rows grouped by table, in insertion order. */
export const newRowsByTable = (state: BuildingsEditState): Record<string, BuildingsNewRow[]> => {
  const byTable: Record<string, BuildingsNewRow[]> = {};
  for (const id of state.order) {
    const row = state.rowsById[id];
    if (row) (byTable[row.table] ||= []).push(row);
  }
  return byTable;
};

/**
 * Re-runs the extraction with the new rows appended, so the board shows them like any other data.
 *
 * Appending rather than merging is what makes the override rule work for free: `dedupeRowsByKey`
 * keeps the last row for a key, and these are last.
 *
 * The main process retains these string-only source rows in the Buildings cache so this complete
 * rebuild remains the one update path. That prevents a table used by `buildBuildingsData` from
 * being omitted by a separate incremental implementation. `start_pos_*` stays immutable.
 */
export const applyNewRowsToBuildingsData = (
  baseTables: BuildingsTableRows,
  state: BuildingsEditState,
  rebuild: (tables: BuildingsTableRows) => BuiltBuildingsData,
): BuiltBuildingsData => {
  const byTable = newRowsByTable(state);
  const tables: BuildingsTableRows = { ...baseTables };
  for (const [table, rows] of Object.entries(byTable)) {
    if (table === LOC_TABLE || table.startsWith("start_pos_")) continue;
    tables[table] = [...(baseTables[table] ?? []), ...rows.map((row) => row.values)];
  }
  return rebuild(tables);
};

/** Flags a row whose key collides with one already in the base data, which would silently override. */
export const findKeyCollisions = (
  baseTables: BuildingsTableRows,
  state: BuildingsEditState,
): Array<{ id: string; table: string; key: string }> => {
  const collisions: Array<{ id: string; table: string; key: string }> = [];
  for (const [table, rows] of Object.entries(newRowsByTable(state))) {
    if (table === LOC_TABLE) continue;
    const keyColumns = BUILDINGS_TABLE_KEY_COLUMNS[table];
    if (!keyColumns) continue;
    const existing = new Set(
      dedupeRowsByKey(table, baseTables[table]).map((row) => keyColumns.map((column) => row[column] ?? "").join("|")),
    );
    for (const row of rows) {
      const key = keyColumns.map((column) => row.values[column] ?? "").join("|");
      if (existing.has(key)) collisions.push({ id: row.id, table, key });
    }
  }
  return collisions;
};
