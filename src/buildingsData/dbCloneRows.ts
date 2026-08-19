import type { AmendedSchemaField, DBVersion, PackedFile } from "../packFileTypes";
import { buildRowFromValues } from "../utility/dbRowCells";
import { LOC_TABLE, type BuildingsNewRow } from "./edits";

/**
 * `origin` is narrowed to the literal this builder always sets, rather than the wide
 * `BuildingsRowOrigin` union, so the drafts are equally assignable to the Ancillaries tab's edit
 * model - which has its own origins but shares `"clone"`.
 */
export type BuildingsCloneRowDraft = Omit<BuildingsNewRow, "id" | "groupId" | "origin"> & { origin: "clone" };

export interface BuildingsCloneRows {
  rows: BuildingsCloneRowDraft[];
  tableSchemas: Record<string, DBVersion>;
}

/**
 * The values that will decide whether two pending rows serialize identically.
 *
 * A DB row is projected through its schema because the edit model can carry extra values that the
 * table cannot write. Localization rows use the same projection as the Buildings save path.
 * Unknown tables still get a stable, value-based signature so a dependency without a catalog
 * schema can be filtered too.
 */
const rowSignature = (
  table: string,
  values: Record<string, string>,
  tableSchemas: Record<string, DBVersion>,
): string => {
  if (table === LOC_TABLE) return JSON.stringify([table, values.key ?? "", values.text ?? ""]);

  const schema = tableSchemas[table];
  if (schema) {
    return JSON.stringify([table, ...buildRowFromValues(schema, values).map((cell) => cell.resolvedKeyValue)]);
  }

  return JSON.stringify([
    table,
    ...Object.keys(values)
      .sort()
      .map((column) => [column, values[column]]),
  ]);
};

/**
 * Removes clone rows that are already pending, including repeats within this clone result.
 *
 * Rows with the same key but different values are deliberately retained: those are overrides and
 * are meaningful to the modder. Only rows that would serialize as the same complete row are
 * duplicates.
 */
export const filterDuplicateBuildingsCloneRows = (
  rows: BuildingsCloneRowDraft[],
  existingRows: BuildingsNewRow[],
  tableSchemas: Record<string, DBVersion>,
): BuildingsCloneRowDraft[] => {
  const seen = new Set(existingRows.map((row) => rowSignature(row.table, row.values, tableSchemas)));
  return rows.filter((row) => {
    const signature = rowSignature(row.table, row.values, tableSchemas);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

const dbTableNameFromPath = (path: string) => /^db\\([^\\]+)\\/.exec(path)?.[1];

/**
 * Turns DB Clone's generated files into the Buildings tab's pending edit model. The generated
 * schemas travel with the rows because a dependency table may not be part of the normal Buildings
 * catalog, but it still needs to be displayed, edited and saved from the New rows tab.
 */
export const dbClonePackedFilesToBuildingsRows = (packedFiles: PackedFile[]): BuildingsCloneRows => {
  const rows: BuildingsCloneRowDraft[] = [];
  const tableSchemas: Record<string, DBVersion> = {};

  for (const packedFile of packedFiles) {
    if (!packedFile.schemaFields || !packedFile.tableSchema) continue;

    const table =
      dbTableNameFromPath(packedFile.name) ?? (packedFile.name.toLowerCase().endsWith(".loc") ? LOC_TABLE : undefined);
    if (!table) continue;
    if (table !== LOC_TABLE) tableSchemas[table] = packedFile.tableSchema;

    const schemaFields = packedFile.schemaFields as AmendedSchemaField[];
    const columnCount = packedFile.tableSchema.fields.length;
    if (columnCount === 0) continue;
    for (let start = 0; start + columnCount <= schemaFields.length; start += columnCount) {
      const schemaRow = schemaFields.slice(start, start + columnCount);
      const values: Record<string, string> = {};
      for (let column = 0; column < schemaRow.length; column++) {
        values[packedFile.tableSchema.fields[column].name] = String(schemaRow[column].resolvedKeyValue ?? "");
      }
      rows.push({ table, values, origin: "clone" });
    }
  }

  return { rows, tableSchemas };
};
