import { LocVersion, type DBVersion, type Field, type SCHEMA_FIELD_TYPE, type SchemaField } from "../packFileTypes";
import type {
  DbCellPatch,
  DbTablePreamble,
  DbSerializedCell,
  ExactFieldResult,
  ParsedDbCell,
  ParsedDbTable,
  PackCoreContext,
} from "./types";

const GUID_MARKER = Buffer.from([0xfd, 0xfe, 0xfc, 0xff]);
const VERSION_MARKER = Buffer.from([0xfc, 0xfd, 0xfe, 0xff]);
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

const requireBytes = (buffer: Buffer, position: number, size: number, type: string): void => {
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Invalid ${type} range at ${position} with length ${size}`);
  }
  if (position + size > buffer.length) {
    throw new Error(`Truncated ${type} at ${position}: need ${size} bytes, have ${buffer.length - position}`);
  }
};

/** Decodes one DB schema field without narrowing signed I64 values through JavaScript numbers. */
export const parseTypeBufferExact = (
  buffer: Buffer,
  position: number,
  type: SCHEMA_FIELD_TYPE,
  existingFields: Field[] = [],
  options: { strict?: boolean; legacyGuiEncoding?: boolean } = {},
): ExactFieldResult => {
  const fields = existingFields;
  const strict = options.strict ?? true;
  const legacyGuiEncoding = options.legacyGuiEncoding ?? false;
  const readStringU8 = (at: number): ExactFieldResult => {
    requireBytes(buffer, at, 2, "StringU8 length");
    const length = buffer.readUInt16LE(at);
    requireBytes(buffer, at + 2, length, "StringU8 data");
    fields.push({ type: "Int16", val: length });
    const bytes = buffer.subarray(at + 2, at + 2 + length);
    fields.push({ type: "String", val: legacyGuiEncoding ? bytes.toString("ascii") : fatalUtf8Decoder.decode(bytes) });
    return { fields, nextPosition: at + 2 + length };
  };

  switch (type) {
    case "Boolean":
      requireBytes(buffer, position, 1, type);
      {
        const value = buffer.readUInt8(position);
        if (strict && value > 1) throw new Error(`Invalid Boolean value ${value} at ${position}`);
        fields.push({ type: "UInt8", val: value });
      }
      return { fields, nextPosition: position + 1 };
    case "ColourRGB":
    case "I32":
      requireBytes(buffer, position, 4, type);
      fields.push({ type: "I32", val: buffer.readInt32LE(position) });
      return { fields, nextPosition: position + 4 };
    case "StringU16": {
      requireBytes(buffer, position, 2, "StringU16 length");
      const length = legacyGuiEncoding ? buffer.readInt16LE(position) : buffer.readUInt16LE(position);
      if (length < 0) throw new Error(`Invalid negative StringU16 length ${length} at ${position}`);
      const byteLength = length * 2;
      requireBytes(buffer, position + 2, byteLength, "StringU16 data");
      fields.push({ type: "String", val: buffer.toString("utf16le", position + 2, position + 2 + byteLength) });
      return { fields, nextPosition: position + 2 + byteLength };
    }
    case "StringU8":
      return readStringU8(position);
    case "OptionalStringU8": {
      requireBytes(buffer, position, 1, type);
      const exists = buffer.readUInt8(position);
      if (strict && exists > 1) throw new Error(`Invalid OptionalStringU8 flag ${exists} at ${position}`);
      fields.push({ type: "Int8", val: exists });
      return exists === 1 ? readStringU8(position + 1) : { fields, nextPosition: position + 1 };
    }
    case "F32":
      requireBytes(buffer, position, 4, type);
      fields.push({ type: "F32", val: buffer.readFloatLE(position) });
      return { fields, nextPosition: position + 4 };
    case "I16":
      requireBytes(buffer, position, 2, type);
      fields.push({ type: "I16", val: buffer.readInt16LE(position) });
      return { fields, nextPosition: position + 2 };
    case "F64":
      requireBytes(buffer, position, 8, type);
      fields.push({ type: "F64", val: buffer.readDoubleLE(position) });
      return { fields, nextPosition: position + 8 };
    case "I64":
      requireBytes(buffer, position, 8, type);
      fields.push({ type: "I64", val: buffer.readBigInt64LE(position).toString(10) });
      return { fields, nextPosition: position + 8 };
    default: {
      const exhaustive: never = type;
      throw new Error(`Unsupported DB field type ${String(exhaustive)}`);
    }
  }
};

/** Serializes the parsed Field shape used by the existing GUI, accepting decimal-string I64 values. */
export const serializeSchemaFieldToBuffer = (schemaField: SchemaField): Buffer => {
  if (schemaField.type === "StringU16" && schemaField.fields.length === 1) {
    const value = String(schemaField.fields[0]?.val ?? "");
    if (value.length > 0xffff) throw new Error(`StringU16 value is too long: ${value.length}`);
    const length = Buffer.allocUnsafe(2);
    length.writeUInt16LE(value.length, 0);
    return Buffer.concat([length, Buffer.from(value, "utf16le")]);
  }

  const parts: Buffer[] = [];
  for (const field of schemaField.fields) {
    const value = field.val;
    switch (field.type) {
      case "UInt8":
      case "Int8": {
        const data = Buffer.allocUnsafe(1);
        data.writeUInt8(Number(value), 0);
        parts.push(data);
        break;
      }
      case "Int16": {
        const data = Buffer.allocUnsafe(2);
        data.writeUInt16LE(Number(value), 0);
        parts.push(data);
        break;
      }
      case "I16": {
        const data = Buffer.allocUnsafe(2);
        data.writeInt16LE(Number(value), 0);
        parts.push(data);
        break;
      }
      case "I32": {
        const data = Buffer.allocUnsafe(4);
        data.writeInt32LE(Number(value), 0);
        parts.push(data);
        break;
      }
      case "I64": {
        const data = Buffer.allocUnsafe(8);
        data.writeBigInt64LE(BigInt(value as string | number), 0);
        parts.push(data);
        break;
      }
      case "F32": {
        const data = Buffer.allocUnsafe(4);
        data.writeFloatLE(Number(value), 0);
        parts.push(data);
        break;
      }
      case "F64": {
        const data = Buffer.allocUnsafe(8);
        data.writeDoubleLE(Number(value), 0);
        parts.push(data);
        break;
      }
      case "String":
        parts.push(Buffer.from(String(value ?? ""), "utf8"));
        break;
      case "Buffer":
        parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value as number[]));
        break;
      default:
        throw new Error(`Unsupported serialized field type ${field.type}`);
    }
  }
  return Buffer.concat(parts);
};

const serializeSchemaFieldWithType = (type: SCHEMA_FIELD_TYPE, fields: Field[]): Buffer =>
  serializeSchemaFieldToBuffer({ type, fields });

/** Serializes one DB table's row-count and field values, preserving a supplied original preamble. */
export const serializeDbTable = (
  schema: DBVersion,
  rows: readonly (readonly (readonly Field[])[])[],
  options: { preamble?: Buffer; version?: number; tableFlag?: number } = {},
): Buffer => {
  if (schema.fields.length === 0 && rows.length > 0) throw new Error("Cannot serialize rows with an empty schema");
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length !== schema.fields.length) {
      throw new Error(`Row ${rowIndex} has ${row.length} fields; schema requires ${schema.fields.length}`);
    }
  }
  const parts: Buffer[] = [];
  if (options.preamble) {
    parts.push(options.preamble);
  } else {
    if (options.version !== undefined) {
      const version = Buffer.allocUnsafe(4);
      version.writeInt32LE(options.version, 0);
      parts.push(VERSION_MARKER, version);
    }
    parts.push(Buffer.from([options.tableFlag ?? 1]));
  }
  const rowCount = Buffer.allocUnsafe(4);
  rowCount.writeInt32LE(rows.length, 0);
  parts.push(rowCount);
  for (const row of rows) {
      row.forEach((fields, index) =>
        parts.push(serializeSchemaFieldWithType(schema.fields[index].field_type, [...fields])),
      );
  }
  return Buffer.concat(parts);
};

/** Compatibility-shaped serializer for a single existing packed-file table. */
export const serializePackFileDataToBuffer = (packFile: {
  name: string;
  buffer?: Buffer;
  schemaFields?: SchemaField[];
  tableSchema?: DBVersion;
  version?: number;
  dbPreamble?: Buffer;
}): Buffer => {
  if (packFile.buffer) return packFile.buffer;
  if (!packFile.schemaFields || !packFile.tableSchema) {
    throw new Error(`Cannot serialize pack file "${packFile.name}" without buffer or schema data`);
  }
  const parts: Buffer[] = [];
  const isLoc = packFile.name.endsWith(".loc");
  if (isLoc) {
    parts.push(Buffer.from([0xff, 0xfe, 0x4c, 0x4f, 0x43, 0x00]));
    const locVersion = Buffer.allocUnsafe(4);
    locVersion.writeInt32LE(1, 0);
    parts.push(locVersion);
  } else if (packFile.dbPreamble) {
    parts.push(packFile.dbPreamble);
  } else {
    if (packFile.version != null) {
      const version = Buffer.allocUnsafe(4);
      version.writeInt32LE(packFile.version, 0);
      parts.push(VERSION_MARKER, version);
    }
    parts.push(Buffer.from([1]));
  }
  const rowCount = Buffer.allocUnsafe(4);
  rowCount.writeInt32LE(packFile.schemaFields.length / packFile.tableSchema.fields.length, 0);
  parts.push(rowCount);
  for (const schemaField of packFile.schemaFields) parts.push(serializeSchemaFieldToBuffer(schemaField));
  return Buffer.concat(parts);
};

/** Reads the DB markers and row count without choosing or inferring a schema version. */
export const readDbTablePreamble = (buffer: Buffer): DbTablePreamble => {
  let position = 0;
  let guid: string | undefined;
  let version: number | undefined;
  for (;;) {
    requireBytes(buffer, position, 4, "DB preamble marker or table flag");
    const marker = buffer.subarray(position, position + 4);
    if (marker.equals(GUID_MARKER)) {
      if (guid !== undefined) throw new Error("DB preamble contains duplicate GUID markers");
      position += 4;
      requireBytes(buffer, position, 2, "DB GUID length");
      const length = buffer.readInt16LE(position);
      position += 2;
      if (length < 0) throw new Error(`Invalid negative DB GUID length ${length}`);
      const byteLength = length * 2;
      requireBytes(buffer, position, byteLength, "DB GUID data");
      guid = buffer.subarray(position, position + byteLength).toString("utf8");
      position += byteLength;
      continue;
    }
    if (marker.equals(VERSION_MARKER)) {
      if (version !== undefined) throw new Error("DB preamble contains duplicate version markers");
      position += 4;
      requireBytes(buffer, position, 4, "DB version");
      version = buffer.readInt32LE(position);
      position += 4;
      continue;
    }
    break;
  }

  // The one-byte table flag follows optional GUID/version markers; the legacy format uses it to
  // distinguish the preamble from the row count. Preserve its exact value rather than normalizing.
  position += 1;
  requireBytes(buffer, position, 4, "DB row count");
  const rowCount = buffer.readInt32LE(position);
  if (rowCount < 0) throw new Error(`Invalid negative DB row count ${rowCount}`);
  const rowCountBytes = Buffer.from(buffer.subarray(position, position + 4));
  return {
    ...(guid === undefined ? {} : { guid }),
    ...(version === undefined ? {} : { version }),
    bytes: Buffer.from(buffer.subarray(0, position)),
    rowCount,
    rowCountBytes,
    dataPosition: position + 4,
  };
};

/** Parses DB rows under an explicitly selected schema and retains every original cell byte range. */
export const parseDbTable = (
  buffer: Buffer,
  schema: DBVersion,
  context?: Pick<PackCoreContext, "game">,
): ParsedDbTable => {
  const preamble = readDbTablePreamble(buffer);
  if (preamble.version !== undefined && preamble.version !== schema.version) {
    throw new Error(
      `DB table declares version ${preamble.version}, but explicit schema version ${schema.version} was provided${
        context ? ` for ${context.game}` : ""
      }`,
    );
  }

  if (schema.fields.length === 0 && preamble.rowCount > 0) {
    throw new Error("Cannot parse DB rows with an empty schema");
  }
  const minimumRowBytes = schema.fields.reduce((size, field) => {
    switch (field.field_type) {
      case "Boolean":
      case "OptionalStringU8":
        return size + 1;
      case "StringU8":
      case "StringU16":
      case "I16":
        return size + 2;
      case "I32":
      case "F32":
      case "ColourRGB":
        return size + 4;
      case "I64":
      case "F64":
        return size + 8;
    }
  }, 0);
  if (minimumRowBytes > 0 && preamble.rowCount > (buffer.length - preamble.dataPosition) / minimumRowBytes) {
    throw new Error(`DB row count ${preamble.rowCount} cannot fit in the remaining payload`);
  }

  let position = preamble.dataPosition;
  const rows = [] as ParsedDbTable["rows"];
  for (let rowIndex = 0; rowIndex < preamble.rowCount; rowIndex++) {
    const cells: ParsedDbCell[] = [];
    for (let fieldIndex = 0; fieldIndex < schema.fields.length; fieldIndex++) {
      const start = position;
      const result = parseTypeBufferExact(buffer, position, schema.fields[fieldIndex].field_type);
      position = result.nextPosition;
      cells.push({ fieldIndex, fields: result.fields, bytes: Buffer.from(buffer.subarray(start, position)) });
    }
    rows.push({ cells });
  }
  return {
    preamble,
    schema,
    rows,
    trailingBytes: Buffer.from(buffer.subarray(position)),
  };
};

/** Parses a LOC header and rows through the same core field codec used for DB tables. */
export const parseLocTable = (buffer: Buffer): ParsedDbTable => {
  requireBytes(buffer, 0, 14, "LOC header");
  if (!buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) throw new Error("LOC header has no FF FE marker");
  if (buffer.toString("ascii", 2, 5) !== "LOC") throw new Error("LOC header marker is invalid");
  const version = buffer.readInt32LE(6);
  if (version !== LocVersion.version) throw new Error(`Unsupported LOC version ${version}`);
  const synthetic = Buffer.concat([buffer.subarray(5, 6), buffer.subarray(10)]);
  const parsed = parseDbTable(synthetic, LocVersion);
  parsed.preamble = {
    version,
    bytes: Buffer.from(buffer.subarray(0, 10)),
    rowCount: parsed.preamble.rowCount,
    rowCountBytes: Buffer.from(buffer.subarray(10, 14)),
    dataPosition: 14,
  };
  return parsed;
};

/** Rewrites selected cells and copies all preamble, unmodified cells, and trailing bytes verbatim. */
export const patchDbTableCells = (table: ParsedDbTable, patches: readonly DbCellPatch[]): Buffer => {
  const patchByCell = new Map<string, DbCellPatch>();
  for (const patch of patches) {
    if (!Number.isInteger(patch.rowIndex) || patch.rowIndex < 0 || patch.rowIndex >= table.rows.length) {
      throw new Error(`DB row index ${patch.rowIndex} is outside the parsed table`);
    }
    if (!Number.isInteger(patch.fieldIndex) || patch.fieldIndex < 0 || patch.fieldIndex >= table.schema.fields.length) {
      throw new Error(`DB field index ${patch.fieldIndex} is outside the parsed schema`);
    }
    const key = `${patch.rowIndex}:${patch.fieldIndex}`;
    if (patchByCell.has(key)) throw new Error(`Duplicate DB cell patch for ${key}`);
    patchByCell.set(key, patch);
  }

  const rows = table.rows.map((row, rowIndex) =>
    row.cells.map((cell) => {
      const patch = patchByCell.get(`${rowIndex}:${cell.fieldIndex}`);
      return patch ? { fields: patch.fields } : { bytes: cell.bytes };
    }),
  );
  return rewriteDbTableRows(table, rows);
};

/** Rebuilds row topology while retaining original bytes for every unchanged cell. */
export const rewriteDbTableRows = (
  table: ParsedDbTable,
  rows: readonly (readonly DbSerializedCell[])[],
): Buffer => {
  if (rows.length > 0x7fffffff) throw new Error("DB table row count exceeds the format limit");
  const parts: Buffer[] = [table.preamble.bytes];
  if (rows.length === table.preamble.rowCount) {
    parts.push(table.preamble.rowCountBytes);
  } else {
    const rowCount = Buffer.allocUnsafe(4);
    rowCount.writeInt32LE(rows.length, 0);
    parts.push(rowCount);
  }
  rows.forEach((row, rowIndex) => {
    if (row.length !== table.schema.fields.length) {
      throw new Error(`Row ${rowIndex} has ${row.length} cells; schema requires ${table.schema.fields.length}`);
    }
    row.forEach((cell, fieldIndex) => {
      if ("bytes" in cell) parts.push(cell.bytes);
      else parts.push(serializeSchemaFieldWithType(table.schema.fields[fieldIndex].field_type, cell.fields));
    });
  });
  parts.push(table.trailingBytes);
  return Buffer.concat(parts);
};

export const dbPreambleMarkers = { guid: Buffer.from(GUID_MARKER), version: Buffer.from(VERSION_MARKER) };
