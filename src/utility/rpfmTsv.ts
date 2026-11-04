import { buildRowFromValues } from "./dbRowCells";
import { isLocPackedFilePath, parseDBTablePath } from "./packFileHelpers";
import type { DBVersion, NewPackedFile, SCHEMA_FIELD_TYPE, SchemaField } from "../packFileTypes";
import { LocVersion } from "../packFileTypes";

export interface RpfmTsvMetadata {
  tableName: string;
  version: number;
  packedFileName: string;
}

/** The path stored in an RPFM metadata line is a packed-file path, not a disk path. */
export const normalizePackedFileName = (fileName: string) =>
  fileName
    .replaceAll("/", "\\")
    .replace(/^\.\\/, "")
    .replace(/\.tsv$/i, "");

export const getRpfmTsvMetadata = (line: string, fallbackPackedFileName: string): RpfmTsvMetadata | undefined => {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("#")) return;

  const [tableNamePart, versionPart, packedFileNamePart] = trimmedLine.slice(1).split(";");
  if (tableNamePart == null || versionPart == null || packedFileNamePart == null) return;

  const tableName = tableNamePart.trim();
  const version = Number(versionPart.trim());
  const packedFileName = normalizePackedFileName(packedFileNamePart.trim() || fallbackPackedFileName);
  if (!tableName || !Number.isInteger(version) || version < 0 || !packedFileName) {
    throw new Error(`Invalid RPFM TSV metadata: ${line}`);
  }

  return { tableName, version, packedFileName };
};

const isIntegerField = (fieldType: SCHEMA_FIELD_TYPE) =>
  fieldType === "I16" || fieldType === "I32" || fieldType === "I64" || fieldType === "ColourRGB";

/**
 * The cell's value read straight off its parsed fields.
 *
 * Deliberately not `resolveKeyValue`: that helper collapses a present-but-empty OptionalStringU8
 * and one holding the literal string "0" onto the same "0", because it falls through the empty
 * string to the length field. Exporting through it therefore cannot tell an empty optional string
 * from a real "0" - 759 cells across 7 vanilla tables hold that value - so the round trip has to
 * read the presence byte itself.
 */
type TsvCell = Pick<SchemaField, "fields">;
export type RpfmTsvFormatting = "legacy" | "rpfm";

const resolveRawCellValue = (
  fieldType: SCHEMA_FIELD_TYPE,
  cell: TsvCell | undefined,
  formatting: RpfmTsvFormatting,
): string => {
  const fields = cell?.fields || [];
  if (formatting === "rpfm" && fieldType === "I64") return String(fields[0]?.val ?? 0);
  if (formatting === "rpfm" && fieldType === "ColourRGB")
    return (Number(fields[0]?.val ?? 0) >>> 0).toString(16).toUpperCase().padStart(6, "0");
  if (isIntegerField(fieldType)) return Number(fields[0]?.val ?? 0).toFixed(0);
  if (fieldType === "F32" || fieldType === "F64")
    return Number(fields[0]?.val ?? 0).toFixed(formatting === "rpfm" ? 4 : 3);

  if (fieldType === "OptionalStringU8" || fieldType === "StringU8") {
    // fields[0] is the presence byte (optional) or the length (plain), so a falsy one means absent
    // or empty. Otherwise the value is the last field present.
    if (fields[0]?.val) return String(fields[2]?.val ?? fields[1]?.val ?? fields[0]?.val ?? "");
    return "";
  }

  return String(fields[1]?.val ?? fields[0]?.val ?? "");
};

/** Converts one parsed cell to the text shape RPFM expects. */
export const formatRpfmTsvCell = (
  fieldType: SCHEMA_FIELD_TYPE,
  cell: TsvCell | undefined,
  formatting: RpfmTsvFormatting = "legacy",
  isLoc = false,
): string => {
  const rawValue = resolveRawCellValue(fieldType, cell, formatting);
  // Any non-zero byte is true, matching RPFM; a cell that is missing entirely is false rather than
  // the "true" that comparing an empty string against "0" would give.
  const value = fieldType === "Boolean" ? String(rawValue !== "" && rawValue !== "0") : rawValue;

  if (formatting === "rpfm") {
    // RPFM's LOC export escapes control characters twice; ordinary backslashes stay literal.
    const prefix = isLoc ? "\\\\" : "\\";
    return value.replace(/\n/g, `${prefix}n`).replace(/\r/g, `${prefix}r`).replace(/\t/g, `${prefix}t`);
  }
  return value.replace(/\t/g, " ").replace(/\r?\n/g, " ");
};

export interface BuildRpfmTsvContentOptions {
  packedFilePath: string;
  tableName: string;
  version: number;
  schema: DBVersion;
  /** Rows of parsed cells, as `chunkSchemaIntoRows` produces them. */
  rows: readonly (readonly TsvCell[])[];
  keysFirst?: boolean;
  /** Opt into RPFM's disk export layout; existing GUI callers retain their formatting. */
  formatting?: RpfmTsvFormatting;
}

export const buildRpfmTsvContent = ({
  packedFilePath,
  tableName,
  version,
  schema,
  rows,
  keysFirst = false,
  formatting = "legacy",
}: BuildRpfmTsvContentOptions): string => {
  const isLoc = isLocPackedFilePath(normalizePackedFileName(packedFilePath));
  const metadataTableName = isLoc ? "Loc" : tableName;
  const metadataVersion = isLoc ? LocVersion.version : version;
  const normalizedPackedFilePath = (
    formatting === "rpfm" ? packedFilePath : normalizePackedFileName(packedFilePath)
  ).replaceAll("\\", "/");
  const columns: { name: string; isKey: boolean; format: (row: readonly TsvCell[]) => string }[] = [];
  const colours = new Map<number, { name: string; index: number; order: number }[]>();
  schema.fields.forEach((field, index) => {
    if (formatting === "rpfm" && typeof field.is_part_of_colour === "number") {
      const group = colours.get(field.is_part_of_colour) ?? [];
      group.push({ name: field.name, index, order: field.ca_order });
      colours.set(field.is_part_of_colour, group);
    } else
      columns.push({
        name: field.name,
        isKey: field.is_key,
        format: (row) => formatRpfmTsvCell(field.field_type, row[index], formatting, isLoc),
      });
  });
  // RPFM moves processed RGB groups after ordinary fields, in colour-group order.
  for (const [groupId, channels] of [...colours].sort(([a], [b]) => a - b)) {
    if (channels.length !== 3) throw new Error(`Invalid RGB colour group ${groupId} in ${tableName}`);
    const prefixes = channels.map((channel) => channel.name.replace(/(?:red|green|blue|r|g|b)$/i, ""));
    const prefix = prefixes[0] && prefixes.every((value) => value === prefixes[0]) ? prefixes[0] : "";
    const ordered = [...channels].sort((a, b) => a.order - b.order);
    columns.push({
      name: prefix ? `${prefix}hex` : `unnamed colour group_${groupId}`,
      isKey: false,
      format: (row) =>
        ordered
          .map(({ index }) =>
            (Number(row[index]?.fields[0]?.val ?? 0) & 255).toString(16).toUpperCase().padStart(2, "0"),
          )
          .join(""),
    });
  }
  if (keysFirst) columns.sort((a, b) => Number(b.isKey) - Number(a.isKey));
  const metadata = `#${metadataTableName};${metadataVersion};${normalizedPackedFilePath}`;
  const lines = [
    columns.map(({ name }) => name).join("\t"),
    metadata + (formatting === "rpfm" ? "\t".repeat(Math.max(0, columns.length - 1)) : ""),
  ];

  for (const row of rows) {
    lines.push(columns.map(({ format }) => format(row)).join("\t"));
  }

  return lines.join("\n") + (formatting === "rpfm" ? "\n" : "");
};

export const getRpfmTsvExportPath = (packedFilePath: string) =>
  `${normalizePackedFileName(packedFilePath).replaceAll("\\", "/")}.tsv`;

export const convertRpfmTsvToPackedFile = (
  contents: string,
  fallbackPackedFileName: string,
  tableSchemas: Record<string, DBVersion[]>,
  sourcePath: string,
): NewPackedFile | undefined => {
  const lines = contents.split(/\r?\n/);
  if (lines.length < 2) return;

  const metadata = getRpfmTsvMetadata(lines[1], fallbackPackedFileName);
  if (!metadata) return;

  const isLoc = metadata.tableName.toLowerCase() === "loc";
  const parsedPath = parseDBTablePath(metadata.packedFileName);
  if (!isLoc && !parsedPath) {
    throw new Error(`RPFM TSV metadata does not name a DB table: ${sourcePath}`);
  }
  if (!isLoc && parsedPath && parsedPath.dbName !== metadata.tableName) {
    throw new Error(
      `RPFM TSV table name does not match its path in ${sourcePath}: ${metadata.tableName} vs ${parsedPath.dbName}`,
    );
  }

  // readPack's loc pass and serializePackFileDataToBuffer both match ".loc" case-sensitively, so a
  // metadata path naming `foo.LOC` would be written with a DB table header and never read back as a
  // loc. Pack paths are case-insensitive to the game, so normalize the extension rather than
  // producing a file nothing can parse.
  if (isLoc && !isLocPackedFilePath(metadata.packedFileName)) {
    throw new Error(`RPFM Loc TSV does not name a .loc file in ${sourcePath}: ${metadata.packedFileName}`);
  }
  const packedFileName = isLoc ? `${metadata.packedFileName.slice(0, -".loc".length)}.loc` : metadata.packedFileName;

  const schema = isLoc
    ? LocVersion
    : tableSchemas[metadata.tableName]?.find((candidate) => candidate.version === metadata.version);
  if (!schema) {
    throw new Error(`No schema for RPFM TSV ${metadata.tableName} version ${metadata.version} in ${sourcePath}`);
  }

  const headers = lines[0]
    .replace(/^\uFEFF/, "")
    .split("\t")
    .map((header) => header.trim());
  const headerSet = new Set(headers);
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  const unknownHeaders = headers.filter((header) => !schema.fields.some((field) => field.name === header));
  const missingHeaders = schema.fields.map((field) => field.name).filter((fieldName) => !headerSet.has(fieldName));
  if (headers.some((header) => !header) || duplicateHeaders.length > 0 || unknownHeaders.length > 0) {
    throw new Error(`RPFM TSV columns do not match the schema for ${metadata.tableName}: ${sourcePath}`);
  }
  if (missingHeaders.length > 0) {
    throw new Error(
      `RPFM TSV is missing columns for ${metadata.tableName}: ${missingHeaders.join(", ")} (${sourcePath})`,
    );
  }

  const schemaFields = lines.slice(2).reduce<NonNullable<NewPackedFile["schemaFields"]>>((fields, line) => {
    if (line === "") return fields;
    const values = line.split("\t");
    if (values.length > headers.length) {
      throw new Error(`RPFM TSV row has too many columns in ${sourcePath}`);
    }
    const rowValues: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowValues[header] = values[index] ?? "";
    });
    fields.push(...buildRowFromValues(schema, rowValues));
    return fields;
  }, []);

  return {
    name: packedFileName,
    version: metadata.version,
    tableSchema: schema,
    schemaFields,
  };
};
