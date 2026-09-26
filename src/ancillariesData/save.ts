/**
 * Turning the new rows into packed files a pack can be written from.
 *
 * Every table gets its own file, named after the modder's prefix and nothing the game ships, so
 * `writePack`'s fast append leaves the rest of the target pack byte-identical. That is what makes
 * "only save the new rows" structural rather than a filter someone has to remember to apply.
 */
import { LocVersion, type DBVersion, type PackedFile } from "../packFileTypes";
import { buildRowFromValues, getSerializedRowValues } from "../utility/dbRowCells";
import { filterRowsAlreadyInPack, type PackRowsByTable } from "../utility/packRowsForSave";
import { LOC_TABLE, newRowsByTable, type AncillariesEditState } from "./edits";

export interface AncillariesSaveFilesInput {
  state: AncillariesEditState;
  /** Schema per table, from the catalog. A table with no schema cannot be written and is reported. */
  tableSchemas: Record<string, DBVersion>;
  /** Base file name, without the `db\<table>\` prefix or the `.loc` suffix. */
  fileName: string;
  /** Existing rows in the destination pack, when duplicate rows should be skipped. */
  existingRowsByTable?: PackRowsByTable;
}

export interface AncillariesSaveFiles {
  files: PackedFile[];
  /** Tables that had rows but no schema to write them with. */
  skippedTables: string[];
}

const emptyPackedFile = (
  name: string,
  version: number,
  tableSchema: DBVersion,
  schemaFields: PackedFile["schemaFields"],
) => ({ name, file_size: 0, start_pos: -1, version, tableSchema, schemaFields }) as PackedFile;

/**
 * Rows that would be written identically, collapsed to one.
 *
 * Two edits can converge on the same row - the same source cloned twice, or an override that ends
 * up matching a row already added - and the game reads a table with a repeated row as a table with
 * a repeated key. Only *completely* identical rows go; two rows that share a key but differ in any
 * written column are still both written, since which one wins is the modder's business.
 */
const dedupeIdenticalRows = <TRow>(rows: TRow[], project: (row: TRow) => unknown[]): TRow[] => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const signature = JSON.stringify(project(row));
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

export const buildPackedFilesFromNewRows = ({
  state,
  tableSchemas,
  fileName,
  existingRowsByTable,
}: AncillariesSaveFilesInput): AncillariesSaveFiles => {
  const files: PackedFile[] = [];
  const skippedTables: string[] = [];

  for (const [table, rows] of Object.entries(newRowsByTable(state))) {
    if (rows.length === 0) continue;

    if (table === LOC_TABLE) {
      const rowsToWrite = existingRowsByTable
        ? filterRowsAlreadyInPack(
            rows,
            existingRowsByTable[table],
            (row) => [row.values.key ?? "", row.values.text ?? ""],
            (row) => [row.key ?? "", row.text ?? ""],
          )
        : rows;
      if (rowsToWrite.length === 0) continue;
      files.push(
        emptyPackedFile(
          `text\\db\\${fileName}.loc`,
          LocVersion.version,
          LocVersion,
          dedupeIdenticalRows(rowsToWrite, (row) => [row.values.key ?? "", row.values.text ?? ""]).flatMap((row) =>
            buildRowFromValues(LocVersion, {
              key: row.values.key ?? "",
              text: row.values.text ?? "",
              tooltip: "false",
            }),
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
          (row) => getSerializedRowValues(schema, row.values),
          (row) => schema.fields.map((field) => row[field.name] ?? null),
        )
      : rows;
    if (rowsToWrite.length === 0) continue;
    files.push(
      emptyPackedFile(
        `db\\${table}\\${fileName}`,
        schema.version,
        schema,
        // Projected through the schema: only the columns the file carries decide whether two
        // pending rows are the same row.
        dedupeIdenticalRows(rowsToWrite, (row) => schema.fields.map((field) => row.values[field.name] ?? null)).flatMap(
          (row) => buildRowFromValues(schema, row.values),
        ),
      ),
    );
  }

  return { files, skippedTables };
};

/** Six base36 characters, enough that two saves picking the same tag is not worth handling. */
const randomFileNameTag = () => Math.random().toString(36).slice(2, 8);

/**
 * A file name nothing else in the target pack uses.
 *
 * A collision would make `saveDBTableEdits` replace someone else's file rather than add ours, so
 * the name ends in a random tag: the packs this writes are meant to sit next to each other, and a
 * pack saved yesterday, or one saved later into the same load order, must not claim the same
 * `db\<table>\<file>` path. Existing names are still checked, since a tag can repeat.
 */
export const buildAncillariesFileName = (moddersPrefix: string, existingFileNames: Iterable<string>): string => {
  const prefix = moddersPrefix.trim().replace(/_+$/, "") || "whmm";
  const base = `!!!${prefix}_ancillaries`;
  const taken = new Set<string>();
  for (const name of existingFileNames) taken.add(name.toLowerCase());

  const isFree = (candidate: string) => {
    for (const name of taken) {
      if (name.endsWith(`\\${candidate.toLowerCase()}`) || name.endsWith(`\\${candidate.toLowerCase()}.loc`)) {
        return false;
      }
    }
    return true;
  };

  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = `${base}_${randomFileNameTag()}`;
    if (isFree(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
};
