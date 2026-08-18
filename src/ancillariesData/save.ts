/**
 * Turning the new rows into packed files a pack can be written from.
 *
 * Every table gets its own file, named after the modder's prefix and nothing the game ships, so
 * `writePack`'s fast append leaves the rest of the target pack byte-identical. That is what makes
 * "only save the new rows" structural rather than a filter someone has to remember to apply.
 */
import { LocVersion, type DBVersion, type PackedFile } from "../packFileTypes";
import { buildRowFromValues } from "../utility/dbRowCells";
import { LOC_TABLE, newRowsByTable, type AncillariesEditState } from "./edits";

export interface AncillariesSaveFilesInput {
  state: AncillariesEditState;
  /** Schema per table, from the catalog. A table with no schema cannot be written and is reported. */
  tableSchemas: Record<string, DBVersion>;
  /** Base file name, without the `db\<table>\` prefix or the `.loc` suffix. */
  fileName: string;
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

export const buildPackedFilesFromNewRows = ({
  state,
  tableSchemas,
  fileName,
}: AncillariesSaveFilesInput): AncillariesSaveFiles => {
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
