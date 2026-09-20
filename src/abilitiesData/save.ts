import { LocVersion, type DBVersion, type PackedFile } from "../packFileTypes";
import { buildRowFromValues, getSerializedRowValues } from "../utility/dbRowCells";
import { filterRowsAlreadyInPack, type PackRowsByTable } from "../utility/packRowsForSave";
import { ABILITIES_LOC_TABLE, abilityNewRowsByTable, type AbilityEditState } from "./edits";

const emptyPackedFile = (
  name: string,
  version: number,
  tableSchema: DBVersion,
  schemaFields: PackedFile["schemaFields"],
) => ({ name, file_size: 0, start_pos: -1, version, tableSchema, schemaFields }) as PackedFile;

const dedupeIdenticalRows = <TRow>(rows: TRow[], project: (row: TRow) => unknown[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const signature = JSON.stringify(project(row));
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

export const buildAbilityPackedFiles = ({
  state,
  tableSchemas,
  fileName,
  existingRowsByTable,
}: {
  state: AbilityEditState;
  tableSchemas: Record<string, DBVersion>;
  fileName: string;
  existingRowsByTable?: PackRowsByTable;
}) => {
  const files: PackedFile[] = [];
  const skippedTables: string[] = [];
  for (const [table, rows] of Object.entries(abilityNewRowsByTable(state))) {
    if (!rows.length) continue;
    if (table === ABILITIES_LOC_TABLE) {
      const rowsToWrite = existingRowsByTable
        ? filterRowsAlreadyInPack(
            rows,
            existingRowsByTable[table],
            (entry) => [entry.values.key ?? "", entry.values.text ?? ""],
            (entry) => [entry.key ?? "", entry.text ?? ""],
          )
        : rows;
      if (!rowsToWrite.length) continue;
      files.push(
        emptyPackedFile(
          `text\\db\\${fileName}.loc`,
          LocVersion.version,
          LocVersion,
          dedupeIdenticalRows(rowsToWrite, (entry) => [entry.values.key ?? "", entry.values.text ?? ""]).flatMap(
            (entry) => buildRowFromValues(LocVersion, { key: entry.values.key ?? "", text: entry.values.text ?? "", tooltip: "false" }),
          ),
        ),
      );
      continue;
    }
    const schema = tableSchemas[table];
    if (!schema) {
      skippedTables.push(table);
      continue;
    }
    const rowsToWrite = existingRowsByTable
      ? filterRowsAlreadyInPack(
          rows,
          existingRowsByTable[table],
          (entry) => getSerializedRowValues(schema, entry.values),
          (entry) => schema.fields.map((field) => entry[field.name] ?? null),
        )
      : rows;
    if (!rowsToWrite.length) continue;
    files.push(
      emptyPackedFile(
        `db\\${table}\\${fileName}`,
        schema.version,
        schema,
        dedupeIdenticalRows(rowsToWrite, (entry) => schema.fields.map((field) => entry.values[field.name] ?? null)).flatMap(
          (entry) => buildRowFromValues(schema, entry.values),
        ),
      ),
    );
  }
  return { files, skippedTables };
};

const randomTag = () => Math.random().toString(36).slice(2, 8);
export const buildAbilityFileName = (moddersPrefix: string, existingFileNames: Iterable<string>) => {
  const prefix = moddersPrefix.trim().replace(/_+$/, "") || "whmm";
  const base = `!!!${prefix}_abilities`;
  const taken = new Set([...existingFileNames].map((name) => name.toLowerCase()));
  const isFree = (candidate: string) =>
    ![...taken].some(
      (name) => name.endsWith(`\\${candidate.toLowerCase()}`) || name.endsWith(`\\${candidate.toLowerCase()}.loc`),
    );
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = `${base}_${randomTag()}`;
    if (isFree(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
};
