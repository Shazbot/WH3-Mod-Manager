/**
 * Checking the new rows against the data they will land in.
 *
 * Two things go wrong when rows are written by hand: a reference points at a key nothing defines, so
 * the game silently drops the row; or a key repeats one the game already ships, so the new row
 * overrides vanilla instead of adding to it. Neither shows up on the board - an overridden row looks
 * like a perfectly ordinary building - which is why they are reported rather than merely prevented.
 *
 * Pure, and keyed off `BuiltBuildingsData` rather than the raw rows, because that is all the main
 * process still holds by the time an edit arrives.
 */
import { BUILDINGS_TABLE_KEY_COLUMNS } from "./data";
import { LOC_TABLE, newRowsByTable, type BuildingsEditState } from "./edits";
import type { BuiltBuildingsData } from "./types";

export type BuildingsRowIssueKind = "missingKey" | "duplicateKey" | "overridesExisting" | "danglingReference";

export interface BuildingsRowIssue {
  /** The `BuildingsNewRow.id` the issue belongs to. */
  rowId: string;
  table: string;
  column: string;
  kind: BuildingsRowIssueKind;
  message: string;
}

/** Which key universe a column's value has to be found in. Only references worth checking are listed. */
type KeyUniverse = "chain" | "level" | "set" | "instance";

const REFERENCE_COLUMNS: Record<string, Record<string, KeyUniverse>> = {
  building_levels_tables: { chain: "chain", building_instance_key: "instance" },
  building_culture_variants_tables: { building: "level" },
  building_set_to_building_junctions_tables: {
    building_chain: "chain",
    building_level: "level",
    building_set: "set",
  },
  building_upgrades_junction_tables: { from: "level", to: "level" },
  building_effects_junction_tables: { building: "level" },
  building_units_allowed_tables: { building: "level" },
  building_level_armed_citizenry_junctions_tables: { building_level: "level" },
  settlement_type_to_building_chains_junctions_tables: { building_chain: "chain" },
  slot_template_permitted_building_chains_tables: { chain: "chain" },
};

/**
 * Tables that name a thing, keyed on a single column, so a key already in the base data means the
 * new row overrides that thing rather than adding one - and an empty key is always a mistake.
 *
 * The junction tables are deliberately absent: their key columns treat `""` as "any", so an empty
 * `building_culture_variants.subculture` or `building_set_to_building_junctions.building_level` is
 * the ordinary case rather than a half-filled row.
 */
const IDENTITY_TABLES: Record<string, KeyUniverse> = {
  building_levels_tables: "level",
  building_chains_tables: "chain",
  building_sets_tables: "set",
  building_instances_tables: "instance",
};

export const validateNewRows = (base: BuiltBuildingsData, state: BuildingsEditState): BuildingsRowIssue[] => {
  const issues: BuildingsRowIssue[] = [];
  const byTable = newRowsByTable(state);

  // Pending rows count as definitions: a building added in this session is a legitimate upgrade
  // target for another one added right after it.
  const pendingKeys = (table: string, column: string) =>
    new Set((byTable[table] ?? []).map((row) => row.values[column] ?? "").filter((value) => value !== ""));

  const universes: Record<KeyUniverse, Set<string>> = {
    chain: new Set([...Object.keys(base.chains), ...pendingKeys("building_chains_tables", "key")]),
    level: new Set([...Object.keys(base.levelsByKey), ...pendingKeys("building_levels_tables", "level_name")]),
    set: new Set([...Object.keys(base.sets), ...pendingKeys("building_sets_tables", "key")]),
    instance: new Set([...Object.keys(base.instances), ...pendingKeys("building_instances_tables", "key")]),
  };

  const baseUniverses: Record<KeyUniverse, Set<string>> = {
    chain: new Set(Object.keys(base.chains)),
    level: new Set(Object.keys(base.levelsByKey)),
    set: new Set(Object.keys(base.sets)),
    instance: new Set(Object.keys(base.instances)),
  };

  for (const [table, rows] of Object.entries(byTable)) {
    const keyColumns = table === LOC_TABLE ? ["key"] : (BUILDINGS_TABLE_KEY_COLUMNS[table] ?? []);
    const references = REFERENCE_COLUMNS[table] ?? {};
    const identityUniverse = IDENTITY_TABLES[table];
    // Loc rows are the other case where the key names one thing and cannot be empty.
    const identityColumn = identityUniverse || table === LOC_TABLE ? keyColumns[0] : undefined;
    const seenKeys = new Map<string, string>();

    for (const row of rows) {
      if (identityColumn && (row.values[identityColumn] ?? "") === "") {
        issues.push({
          rowId: row.id,
          table,
          column: identityColumn,
          kind: "missingKey",
          message: `${identityColumn} is empty; it is what names this row.`,
        });
      }

      if (keyColumns.length > 0) {
        const key = keyColumns.map((column) => row.values[column] ?? "").join("|");
        const firstRowId = seenKeys.get(key);
        if (firstRowId != undefined) {
          issues.push({
            rowId: row.id,
            table,
            column: keyColumns[0],
            kind: "duplicateKey",
            message: `Same key as another new row; only the last one survives.`,
          });
        } else {
          seenKeys.set(key, row.id);
        }
      }

      if (identityUniverse && identityColumn) {
        const column = identityColumn;
        const value = row.values[column] ?? "";
        if (row.origin !== "shiftBuildingLevel" && value !== "" && baseUniverses[identityUniverse].has(value)) {
          issues.push({
            rowId: row.id,
            table,
            column,
            kind: "overridesExisting",
            message: `${value} already exists; this row replaces it rather than adding one.`,
          });
        }
      }

      for (const [column, universe] of Object.entries(references)) {
        const value = row.values[column] ?? "";
        if (value === "") continue;
        if (!universes[universe].has(value)) {
          issues.push({
            rowId: row.id,
            table,
            column,
            kind: "danglingReference",
            message: `No ${universe} named ${value}.`,
          });
        }
      }
    }
  }

  return issues;
};

/** The issues grouped by row, which is how the grid reads them. */
export const groupIssuesByRow = (issues: BuildingsRowIssue[]): Record<string, BuildingsRowIssue[]> => {
  const byRow: Record<string, BuildingsRowIssue[]> = {};
  for (const issue of issues) (byRow[issue.rowId] ||= []).push(issue);
  return byRow;
};
