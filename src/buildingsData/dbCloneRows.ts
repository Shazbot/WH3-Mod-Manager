import type { AmendedSchemaField, DBVersion, PackedFile } from "../packFileTypes";
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
