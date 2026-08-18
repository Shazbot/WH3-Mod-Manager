/**
 * Checking the new rows against the data they will land in.
 *
 * Same three failure modes `buildingsData/validate.ts` guards: a reference pointing at a key
 * nothing defines, a key repeating one the game already ships, and a half-filled identity row. Plus
 * one specific to this feature - `ancillaries_tables.key` *references* `ancillary_info_tables`, so a
 * new ancillary without an info row is silently dropped by the game.
 *
 * Pure, and keyed off `BuiltAncillariesData` rather than the raw rows, because that is all the main
 * process still holds by the time an edit arrives.
 */
import { ANCILLARY_TABLE_KEY_COLUMNS } from "./data";
import { LOC_TABLE, newRowsByTable, type AncillariesEditState } from "./edits";
import type { BuiltAncillariesData } from "./types";

export type AncillariesRowIssueKind =
  "missingKey" | "duplicateKey" | "overridesExisting" | "danglingReference" | "missingInfoRow";

export interface AncillariesRowIssue {
  /** The `AncillariesNewRow.id` the issue belongs to. */
  rowId: string;
  table: string;
  column: string;
  kind: AncillariesRowIssueKind;
  message: string;
}

/** Which key universe a column's value has to be found in. */
type KeyUniverse = "ancillary" | "category" | "subcategory" | "type" | "effect";

const REFERENCE_COLUMNS: Record<string, Record<string, KeyUniverse>> = {
  ancillaries_tables: { category: "category", subcategory: "subcategory", type: "type" },
  ancillary_to_effects_tables: { ancillary: "ancillary", effect: "effect" },
};

/**
 * Tables that name a thing, keyed on a single column, so a key already in the base data means the
 * new row overrides that thing rather than adding one - and an empty key is always a mistake.
 *
 * `ancillary_to_effects_tables` is deliberately absent: it is keyed on `(ancillary, effect)` and
 * overriding an existing pair is the *only* way to change an effect's value, so that is intended
 * rather than an issue.
 */
const IDENTITY_TABLES: Record<string, KeyUniverse> = {
  ancillaries_tables: "ancillary",
  ancillaries_categories_tables: "category",
  ancillaries_subcategories_tables: "subcategory",
  ancillary_types_tables: "type",
};

export const validateNewRows = (base: BuiltAncillariesData, state: AncillariesEditState): AncillariesRowIssue[] => {
  const issues: AncillariesRowIssue[] = [];
  const byTable = newRowsByTable(state);

  // Pending rows count as definitions: an ancillary added in this session is a legitimate target
  // for an effect row added right after it.
  const pendingKeys = (table: string, column: string) =>
    new Set((byTable[table] ?? []).map((row) => row.values[column] ?? "").filter((value) => value !== ""));

  const baseAncillaries = new Set(Object.keys(base.rowValuesByKey));
  const universes: Record<KeyUniverse, Set<string>> = {
    ancillary: new Set([...baseAncillaries, ...pendingKeys("ancillaries_tables", "key")]),
    category: new Set([
      ...base.categories.map((row) => row.key),
      ...pendingKeys("ancillaries_categories_tables", "category"),
    ]),
    subcategory: new Set([
      ...base.subcategories.map((row) => row.key),
      ...pendingKeys("ancillaries_subcategories_tables", "subcategory"),
    ]),
    type: new Set([...base.typeKeys, ...pendingKeys("ancillary_types_tables", "type")]),
    effect: new Set([...base.effects.map((option) => option.key), ...pendingKeys("effects_tables", "effect")]),
  };

  const baseUniverses: Record<KeyUniverse, Set<string>> = {
    ancillary: baseAncillaries,
    category: new Set(base.categories.map((row) => row.key)),
    subcategory: new Set(base.subcategories.map((row) => row.key)),
    type: new Set(base.typeKeys),
    effect: new Set(base.effects.map((option) => option.key)),
  };

  // `ancillaries_tables.key` references `ancillary_info_tables.ancillary`, so every *new* ancillary
  // needs an info row. An edit that overrides a vanilla ancillary does not - the game already ships
  // its info row.
  const knownInfoKeys = new Set([...base.infoKeys, ...pendingKeys("ancillary_info_tables", "ancillary")]);

  for (const [table, rows] of Object.entries(byTable)) {
    const keyColumns = table === LOC_TABLE ? ["key"] : (ANCILLARY_TABLE_KEY_COLUMNS[table] ?? []);
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
        if (seenKeys.has(key)) {
          issues.push({
            rowId: row.id,
            table,
            column: keyColumns[0],
            kind: "duplicateKey",
            message: "Same key as another new row; only the last one survives.",
          });
        } else {
          seenKeys.set(key, row.id);
        }
      }

      if (identityUniverse && identityColumn) {
        const value = row.values[identityColumn] ?? "";
        // An edit to an existing ancillary is an override by construction, and saying so on every
        // edited field would drown out the issues that matter.
        if (row.origin !== "editAncillary" && value !== "" && baseUniverses[identityUniverse].has(value)) {
          issues.push({
            rowId: row.id,
            table,
            column: identityColumn,
            kind: "overridesExisting",
            message: `${value} already exists; this row replaces it rather than adding one.`,
          });
        }
      }

      if (table === "ancillaries_tables") {
        const key = row.values.key ?? "";
        if (key !== "" && !knownInfoKeys.has(key)) {
          issues.push({
            rowId: row.id,
            table,
            column: "key",
            kind: "missingInfoRow",
            message: `No ancillary_info_tables row for ${key}; the game drops ancillaries without one.`,
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
export const groupIssuesByRow = (issues: AncillariesRowIssue[]): Record<string, AncillariesRowIssue[]> => {
  const byRow: Record<string, AncillariesRowIssue[]> = {};
  for (const issue of issues) (byRow[issue.rowId] ||= []).push(issue);
  return byRow;
};
