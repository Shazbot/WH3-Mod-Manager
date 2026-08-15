/**
 * Turning the new rows into packed files a pack can be written from.
 *
 * Every table gets its own file, named after the modder's prefix and nothing the game ships, so
 * `writePack`'s fast append leaves the rest of the target pack byte-identical. That is what makes
 * "only save the new rows" structural rather than a filter someone has to remember to apply.
 */
import { LocVersion, type DBVersion, type PackedFile } from "../packFileTypes";
import { buildRowFromValues } from "../utility/dbRowCells";
import { LOC_TABLE, newRowsByTable, type BuildingsEditState } from "./edits";

export interface BuildingsSaveFilesInput {
  state: BuildingsEditState;
  /** Schema per table, from the catalog. A table with no schema cannot be written and is reported. */
  tableSchemas: Record<string, DBVersion>;
  /** Base file name, without the `db\<table>\` prefix or the `.loc` suffix. */
  fileName: string;
}

export interface BuildingsSaveFiles {
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

export const buildPackedFilesFromNewRows = ({
  state,
  tableSchemas,
  fileName,
}: BuildingsSaveFilesInput): BuildingsSaveFiles => {
  const files: PackedFile[] = [];
  const skippedTables: string[] = [];

  for (const [table, rows] of Object.entries(newRowsByTable(state))) {
    if (rows.length === 0) continue;

    if (table === LOC_TABLE) {
      files.push(
        emptyPackedFile(
          `text\\db\\${fileName}.loc`,
          LocVersion.version,
          LocVersion,
          rows.flatMap((row) =>
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
    files.push(
      emptyPackedFile(
        `db\\${table}\\${fileName}`,
        schema.version,
        schema,
        rows.flatMap((row) => buildRowFromValues(schema, row.values)),
      ),
    );
  }

  return { files, skippedTables };
};

/**
 * A file name nothing else in the target pack uses.
 *
 * A collision would make `saveDBTableEdits` replace someone else's file rather than add ours.
 */
export const buildBuildingsFileName = (moddersPrefix: string, existingFileNames: Iterable<string>): string => {
  const prefix = moddersPrefix.trim().replace(/_+$/, "") || "whmm";
  const base = `!!!${prefix}_buildings`;
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

  if (isFree(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}_${suffix}`;
    if (isFree(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
};
