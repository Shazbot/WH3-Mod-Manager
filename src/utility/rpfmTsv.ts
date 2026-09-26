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
const resolveRawCellValue = (fieldType: SCHEMA_FIELD_TYPE, cell: SchemaField | undefined): string => {
  const fields = cell?.fields || [];
  if (isIntegerField(fieldType)) return Number(fields[0]?.val ?? 0).toFixed(0);
  if (fieldType === "F32" || fieldType === "F64") return Number(fields[0]?.val ?? 0).toFixed(3);

  if (fieldType === "OptionalStringU8" || fieldType === "StringU8") {
    // fields[0] is the presence byte (optional) or the length (plain), so a falsy one means absent
    // or empty. Otherwise the value is the last field present.
    if (fields[0]?.val) return String(fields[2]?.val ?? fields[1]?.val ?? fields[0]?.val ?? "");
    return "";
  }

  return String(fields[1]?.val ?? fields[0]?.val ?? "");
};

/** Converts one parsed cell to the text shape RPFM expects. */
export const formatRpfmTsvCell = (fieldType: SCHEMA_FIELD_TYPE, cell: SchemaField | undefined): string => {
  const rawValue = resolveRawCellValue(fieldType, cell);
  // Any non-zero byte is true, matching RPFM; a cell that is missing entirely is false rather than
  // the "true" that comparing an empty string against "0" would give.
  const value = fieldType === "Boolean" ? String(rawValue !== "" && rawValue !== "0") : rawValue;

  return value.replace(/\t/g, " ").replace(/\r?\n/g, " ");
};

export interface BuildRpfmTsvContentOptions {
  packedFilePath: string;
  tableName: string;
  version: number;
  schema: DBVersion;
  /** Rows of parsed cells, as `chunkSchemaIntoRows` produces them. */
  rows: SchemaField[][];
}

export const buildRpfmTsvContent = ({
  packedFilePath,
  tableName,
  version,
  schema,
  rows,
}: BuildRpfmTsvContentOptions): string => {
  const isLoc = isLocPackedFilePath(normalizePackedFileName(packedFilePath));
  const metadataTableName = isLoc ? "Loc" : tableName;
  const metadataVersion = isLoc ? LocVersion.version : version;
  const normalizedPackedFilePath = normalizePackedFileName(packedFilePath).replaceAll("\\", "/");
  const lines = [
    schema.fields.map((field) => field.name).join("\t"),
    `#${metadataTableName};${metadataVersion};${normalizedPackedFilePath}`,
  ];

  for (const row of rows) {
    lines.push(schema.fields.map((field, index) => formatRpfmTsvCell(field.field_type, row[index])).join("\t"));
  }

  return lines.join("\n");
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
