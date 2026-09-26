/**
 * The rows the user has added, and how they fold back into the derivation.
 *
 * One store, two views: the detail panel and the New rows sub-tab both read and write `rowsById`,
 * so there is only ever one copy. Pure, so the renderer can re-derive after an edit without a
 * round trip.
 *
 * Structurally the same model as `buildingsData/edits.ts`; kept separate rather than shared because
 * the two features seed different tables and grow different origins.
 */
import {
  ANCILLARY_TABLE_KEY_COLUMNS,
  ancillaryColourTextLocKey,
  ancillaryExplanationLocKey,
  ancillaryNameLocKey,
  dedupeRowsByKey,
} from "./data";
import type { AncillariesTableRows, BuiltAncillariesData } from "./types";

/** Loc entries ride the same store as db rows; this is their pseudo-table. */
export const LOC_TABLE = "__loc__";

export type AncillariesRowOrigin =
  "newAncillary" | "editAncillary" | "addEffect" | "editEffect" | "newType" | "clone" | "manual";

export interface AncillariesNewRow {
  /** Stable across both views, so a grid edit and a panel edit address the same row. */
  id: string;
  /** A DB table name, or {@link LOC_TABLE}. */
  table: string;
  /** Column -> value, every value a string. Booleans are "true"/"false". */
  values: Record<string, string>;
  /** Every row one user action produced, so the action can be undone as a unit. */
  groupId: string;
  origin: AncillariesRowOrigin;
}

export interface AncillariesEditState {
  rowsById: Record<string, AncillariesNewRow>;
  /** Insertion order, so the New rows tab lists rows the way they were made. */
  order: string[];
  /** Next free id per numeric-id table, seeded from the catalog's `nextNumericIds`. */
  numericIdCursors: Record<string, number>;
  /** Bumped per row so ids are unique within a session. */
  nextRowSeq: number;
}

export const emptyAncillariesEditState = (numericIdCursors: Record<string, number> = {}): AncillariesEditState => ({
  rowsById: {},
  order: [],
  numericIdCursors: { ...numericIdCursors },
  nextRowSeq: 1,
});

export type AncillariesEditAction =
  | { type: "reset"; numericIdCursors?: Record<string, number> }
  | { type: "seedNumericIdCursors"; numericIdCursors: Record<string, number> }
  | {
      type: "addRows";
      rows: Array<Omit<AncillariesNewRow, "id" | "groupId">>;
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

export const ancillariesEditReducer = (
  state: AncillariesEditState,
  action: AncillariesEditAction,
): AncillariesEditState => {
  switch (action.type) {
    case "reset":
      return emptyAncillariesEditState(action.numericIdCursors ?? state.numericIdCursors);

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
export const newRowsByTable = (state: AncillariesEditState): Record<string, AncillariesNewRow[]> => {
  const byTable: Record<string, AncillariesNewRow[]> = {};
  for (const id of state.order) {
    const row = state.rowsById[id];
    if (row) (byTable[row.table] ||= []).push(row);
  }
  return byTable;
};

/**
 * The pending row that already overrides this key, if the user has edited it before.
 *
 * The inline editor keeps *one* override row per `(table, key)` rather than appending a row per
 * keystroke: repeated edits to the same field then stay idempotent, and the New rows tab shows the
 * one row that will actually be written.
 */
export const findPendingRow = (
  state: AncillariesEditState,
  table: string,
  keyValues: Record<string, string>,
): AncillariesNewRow | undefined => {
  // Loc rides the same store as db rows, and its pseudo-table is keyed on the loc key.
  const keyColumns = table === LOC_TABLE ? ["key"] : ANCILLARY_TABLE_KEY_COLUMNS[table];
  if (!keyColumns) return undefined;
  for (const id of state.order) {
    const row = state.rowsById[id];
    if (!row || row.table !== table) continue;
    if (keyColumns.every((column) => (row.values[column] ?? "") === (keyValues[column] ?? ""))) return row;
  }
  return undefined;
};

/**
 * Re-runs the extraction with the new rows appended, so the panel shows them like any other data.
 *
 * Appending rather than merging is what makes the override rule work for free: `dedupeRowsByKey`
 * keeps the last row for a key, and these are last.
 */
export const applyNewRowsToAncillariesData = (
  baseTables: AncillariesTableRows,
  state: AncillariesEditState,
  rebuild: (tables: AncillariesTableRows) => BuiltAncillariesData,
): BuiltAncillariesData => {
  const byTable = newRowsByTable(state);
  const tables: AncillariesTableRows = { ...baseTables };
  for (const [table, rows] of Object.entries(byTable)) {
    if (table === LOC_TABLE) continue;
    tables[table] = [...(baseTables[table] ?? []), ...rows.map((row) => row.values)];
  }
  return rebuild(tables);
};

/**
 * Every cell edit that renames a pending ancillary, so the key can still be changed after creation.
 *
 * A key is not one cell: the `ancillaries_tables` row holds it, `ancillary_info_tables` and
 * `ancillary_to_effects_tables` reference it, and each loc row embeds it in its own key. Renaming
 * one and not the rest would leave a new ancillary with no info row and no name.
 */
export const ancillaryRenameActions = (
  state: AncillariesEditState,
  oldKey: string,
  newKey: string,
): AncillariesEditAction[] => {
  if (!newKey || newKey === oldKey) return [];
  const locKeyBuilders = [ancillaryNameLocKey, ancillaryExplanationLocKey, ancillaryColourTextLocKey];
  const actions: AncillariesEditAction[] = [];
  for (const id of state.order) {
    const row = state.rowsById[id];
    if (!row) continue;
    if (row.table === LOC_TABLE) {
      const builder = locKeyBuilders.find((build) => build(oldKey) === row.values.key);
      if (builder) actions.push({ type: "setCell", id, column: "key", value: builder(newKey) });
      continue;
    }
    const column = row.table === "ancillaries_tables" ? "key" : "ancillary";
    if (row.values[column] === oldKey) actions.push({ type: "setCell", id, column, value: newKey });
  }
  return actions;
};

/** Flags a row whose key collides with one already in the base data, which would silently override. */
export const findKeyCollisions = (
  baseTables: AncillariesTableRows,
  state: AncillariesEditState,
): Array<{ id: string; table: string; key: string }> => {
  const collisions: Array<{ id: string; table: string; key: string }> = [];
  for (const [table, rows] of Object.entries(newRowsByTable(state))) {
    if (table === LOC_TABLE) continue;
    const keyColumns = ANCILLARY_TABLE_KEY_COLUMNS[table];
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
