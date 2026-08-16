import { EsfStringEntry } from "../EsfTypes";

const RECORD_FLAG_IS_RECORD = 0x80;
const RECORD_FLAG_HAS_NESTED_BLOCKS = 0x40;
const RECORD_FLAG_HAS_NON_OPTIMIZED_INFO = 0x20;

const MARKER_I8 = 0x02;
const MARKER_I16 = 0x03;
const MARKER_I32 = 0x04;
const MARKER_I64 = 0x05;
const MARKER_U8 = 0x06;
const MARKER_U16 = 0x07;
const MARKER_U32 = 0x08;
const MARKER_U64 = 0x09;
const MARKER_F32 = 0x0a;
const MARKER_F64 = 0x0b;
const MARKER_COORD_2D = 0x0c;
const MARKER_COORD_3D = 0x0d;
const MARKER_UTF16 = 0x0e;
const MARKER_ASCII = 0x0f;
const MARKER_ANGLE = 0x10;
const MARKER_BOOL_TRUE = 0x12;
const MARKER_BOOL_FALSE = 0x13;
const MARKER_U32_ZERO = 0x14;
const MARKER_U32_ONE = 0x15;
const MARKER_U32_BYTE = 0x16;
const MARKER_U32_16BIT = 0x17;
const MARKER_U32_24BIT = 0x18;
const MARKER_I32_ZERO = 0x19;
const MARKER_I32_BYTE = 0x1a;
const MARKER_I32_16BIT = 0x1b;
const MARKER_I32_24BIT = 0x1c;
const MARKER_F32_ZERO = 0x1d;
const MARKER_UNKNOWN_21 = 0x21;
const MARKER_UNKNOWN_23 = 0x23;
const MARKER_UNKNOWN_24 = 0x24;
const MARKER_UNKNOWN_25 = 0x25;
const MARKER_UNKNOWN_26 = 0x26;

function readSizedUtf8(buffer: Buffer, offset: number): { value: string; offset: number; length: number } {
  if (offset + 2 > buffer.length) {
    throw new Error(`Invalid sized UTF-8 string at offset ${offset}.`);
  }
  const length = buffer.readUInt16LE(offset);
  const start = offset + 2;
  const end = start + length;
  if (end > buffer.length) {
    throw new Error(`Out-of-bounds UTF-8 string read at offset ${offset} (length ${length}).`);
  }
  return {
    value: buffer.toString("utf8", start, end),
    offset: end,
    length,
  };
}

function readSizedUtf8U32(buffer: Buffer, offset: number): { value: string; offset: number; length: number } {
  if (offset + 4 > buffer.length) {
    throw new Error(`Invalid u32-sized UTF-8 string at offset ${offset}.`);
  }
  const length = buffer.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > buffer.length) {
    throw new Error(`Out-of-bounds u32-sized UTF-8 string read at offset ${offset} (length ${length}).`);
  }
  return {
    value: buffer.toString("utf8", start, end),
    offset: end,
    length,
  };
}

function readSizedUtf16(buffer: Buffer, offset: number): { value: string; offset: number; length: number } {
  if (offset + 2 > buffer.length) {
    throw new Error(`Invalid sized UTF-16 string at offset ${offset}.`);
  }
  const chars = buffer.readUInt16LE(offset);
  const byteLength = chars * 2;
  const start = offset + 2;
  const end = start + byteLength;
  if (end > buffer.length) {
    throw new Error(`Out-of-bounds UTF-16 string read at offset ${offset} (chars ${chars}).`);
  }
  return {
    value: buffer.toString("utf16le", start, end),
    offset: end,
    length: byteLength,
  };
}

function readSizedUtf16U32(buffer: Buffer, offset: number): { value: string; offset: number; length: number } {
  if (offset + 4 > buffer.length) {
    throw new Error(`Invalid u32-sized UTF-16 string at offset ${offset}.`);
  }
  const chars = buffer.readUInt32LE(offset);
  const byteLength = chars * 2;
  const start = offset + 4;
  const end = start + byteLength;
  if (end > buffer.length) {
    throw new Error(`Out-of-bounds u32-sized UTF-16 string read at offset ${offset} (chars ${chars}).`);
  }
  return {
    value: buffer.toString("utf16le", start, end),
    offset: end,
    length: byteLength,
  };
}

export interface CaabHeaderFields {
  codecId: number;
  unknown1: number;
  creationDate: number;
  recordNamesOffset: number;
}

export interface CaabStringTables {
  recordNames: string[];
  utf16ById: Map<number, string>;
  utf8ById: Map<number, string>;
  entries: EsfStringEntry[];
}

type StringTableFormat = "caab" | "cbab";

export function readCaabHeader(buffer: Buffer): CaabHeaderFields {
  if (buffer.length < 16) {
    throw new Error("Invalid ESF file: expected at least 16 bytes.");
  }

  return {
    codecId: buffer.readUInt32LE(0),
    unknown1: buffer.readUInt32LE(4),
    creationDate: buffer.readUInt32LE(8),
    recordNamesOffset: buffer.readUInt32LE(12),
  };
}

export function parseCaabStringTables(buffer: Buffer, recordNamesOffset: number): CaabStringTables {
  return parseStringTables(buffer, recordNamesOffset, "caab");
}

export function parseCbabStringTables(buffer: Buffer, recordNamesOffset: number): CaabStringTables {
  return parseStringTables(buffer, recordNamesOffset, "cbab");
}

function parseStringTables(buffer: Buffer, recordNamesOffset: number, format: StringTableFormat): CaabStringTables {
  if (recordNamesOffset < 16 || recordNamesOffset > buffer.length) {
    throw new Error(`Invalid CAAB string table offset ${recordNamesOffset}.`);
  }

  let offset = recordNamesOffset;
  if (offset + 2 > buffer.length) {
    throw new Error("Invalid CAAB record-names header.");
  }

  const recordNamesCount = buffer.readUInt16LE(offset);
  offset += 2;

  const recordNames: string[] = [];
  const entries: EsfStringEntry[] = [];

  for (let index = 0; index < recordNamesCount; index += 1) {
    const stringOffset = offset + 2;
    const stringData = readSizedUtf8(buffer, offset);
    recordNames.push(stringData.value);
    entries.push({
      id: index,
      text: stringData.value,
      offset: stringOffset,
      length: stringData.length,
      table: "record_name",
    });
    offset = stringData.offset;
  }

  if (offset + 4 > buffer.length) {
    throw new Error("Invalid CAAB UTF-16 string-table header.");
  }

  const utf16Count = buffer.readUInt32LE(offset);
  offset += 4;
  const utf16ById = new Map<number, string>();

  for (let index = 0; index < utf16Count; index += 1) {
    const stringOffset = format === "caab" ? offset + 2 : offset + 4;
    const stringData =
      format === "caab" ? readSizedUtf16(buffer, offset) : readSizedUtf16U32(buffer, offset);
    offset = stringData.offset;
    if (offset + 4 > buffer.length) {
      throw new Error(`Invalid CAAB UTF-16 string-table index at entry ${index}.`);
    }
    const id = buffer.readUInt32LE(offset);
    offset += 4;
    utf16ById.set(id, stringData.value);
    entries.push({
      id,
      text: stringData.value,
      offset: stringOffset,
      length: stringData.length,
      table: "utf16",
    });
  }

  if (offset + 4 > buffer.length) {
    throw new Error("Invalid CAAB UTF-8 string-table header.");
  }

  const utf8Count = buffer.readUInt32LE(offset);
  offset += 4;
  const utf8ById = new Map<number, string>();

  for (let index = 0; index < utf8Count; index += 1) {
    const stringOffset = format === "caab" ? offset + 2 : offset + 4;
    const stringData = format === "caab" ? readSizedUtf8(buffer, offset) : readSizedUtf8U32(buffer, offset);
    offset = stringData.offset;
    if (offset + 4 > buffer.length) {
      throw new Error(`Invalid CAAB UTF-8 string-table index at entry ${index}.`);
    }
    const id = buffer.readUInt32LE(offset);
    offset += 4;
    utf8ById.set(id, stringData.value);
    entries.push({
      id,
      text: stringData.value,
      offset: stringOffset,
      length: stringData.length,
      table: "utf8",
    });
  }

  if (offset !== buffer.length) {
    throw new Error(`Invalid CAAB file tail: expected EOF at ${buffer.length}, got ${offset}.`);
  }

  return {
    recordNames,
    utf16ById,
    utf8ById,
    entries,
  };
}

export interface CaabArrayValue {
  marker: number;
  payloadByteLength: number;
  payloadOffset: number;
  payload: Buffer;
}

export type CaabValue =
  | { kind: "value"; marker: number; type: string; value: boolean | number | string | { x: number; y: number } | { x: number; y: number; z: number } | { id: number; text: string | null } }
  | { kind: "array"; marker: number; value: CaabArrayValue };

export interface CaabRecordInfo {
  name: string;
  version: number;
  flags: number;
  groupCount: number;
  startOffset: number;
  blockStartOffset: number;
  blockEndOffset: number;
}

export interface CaabWalkVisitor {
  onRecordStart?: (record: CaabRecordInfo, stack: string[]) => void;
  onRecordEnd?: (record: CaabRecordInfo, stack: string[]) => void;
  onValue?: (value: CaabValue, stack: string[]) => void;
}

// Big-endian LEB128. Values are file offsets/sizes, so they must stay within u32;
// arithmetic uses multiplication rather than `<< 7` because a 5-byte encoding
// overflows the 32-bit signed range that JS bitwise operators work in.
function readCauleb128(buffer: Buffer, offset: number): { value: number; nextOffset: number } {
  const maxBytes = 5;
  let value = 0;
  let cursor = offset;

  for (let byteIndex = 0; byteIndex < maxBytes && cursor < buffer.length; byteIndex += 1) {
    const byte = buffer[cursor];
    cursor += 1;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      if (value > 0xffffffff) {
        throw new Error(`CAULEB128 integer at offset ${offset} exceeds u32 range (${value}).`);
      }
      return { value, nextOffset: cursor };
    }
  }

  throw new Error(`Invalid CAULEB128 integer at offset ${offset}.`);
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  if (offset + 3 > buffer.length) {
    throw new Error(`Out-of-bounds 24-bit read at offset ${offset}.`);
  }
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function readInt24LE(buffer: Buffer, offset: number): number {
  let value = readUInt24LE(buffer, offset);
  if ((value & 0x800000) !== 0) {
    value |= 0xff000000;
  }
  return value | 0;
}

function parseNode(
  buffer: Buffer,
  offset: number,
  isRoot: boolean,
  stack: string[],
  tables: Pick<CaabStringTables, "recordNames" | "utf8ById" | "utf16ById">,
  visitor: CaabWalkVisitor,
  nodesEndOffset: number
): number {
  if (offset >= nodesEndOffset) {
    throw new Error(`Invalid CAAB node offset ${offset} (nodes end ${nodesEndOffset}).`);
  }

  const markerOffset = offset;
  const marker = buffer[offset];
  offset += 1;

  if ((marker & RECORD_FLAG_IS_RECORD) !== 0) {
    const hasNestedBlocks = (marker & RECORD_FLAG_HAS_NESTED_BLOCKS) !== 0;
    const hasNonOptimizedInfo = (marker & RECORD_FLAG_HAS_NON_OPTIMIZED_INFO) !== 0 || isRoot;
    let nameIndex = 0;
    let version = 0;

    if (hasNonOptimizedInfo) {
      if (offset + 3 > nodesEndOffset) {
        throw new Error(`Invalid CAAB record header at ${markerOffset}.`);
      }
      nameIndex = buffer.readUInt16LE(offset);
      version = buffer[offset + 2];
      offset += 3;
    } else {
      version = (marker & 0x1e) >> 1;
      if (offset + 1 > nodesEndOffset) {
        throw new Error(`Invalid CAAB optimized record header at ${markerOffset}.`);
      }
      nameIndex = ((marker & 0x01) << 8) | buffer[offset];
      offset += 1;
    }

    const name = tables.recordNames[nameIndex];
    if (name === undefined) {
      throw new Error(`CAAB record name index ${nameIndex} out of range at offset ${markerOffset}.`);
    }

    const blockSizeInfo = readCauleb128(buffer, offset);
    offset = blockSizeInfo.nextOffset;

    let groupCount = 1;
    if (hasNestedBlocks) {
      const groupInfo = readCauleb128(buffer, offset);
      groupCount = groupInfo.value;
      offset = groupInfo.nextOffset;
    }

    const blockStartOffset = offset;
    const blockEndOffset = blockStartOffset + blockSizeInfo.value;
    if (blockEndOffset > nodesEndOffset) {
      throw new Error(`CAAB record ${name} exceeds node range at offset ${markerOffset}.`);
    }

    const recordInfo: CaabRecordInfo = {
      name,
      version,
      flags: marker,
      groupCount,
      startOffset: markerOffset,
      blockStartOffset,
      blockEndOffset,
    };

    visitor.onRecordStart?.(recordInfo, stack);

    const childStack = [...stack, name];

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      let groupEndOffset = blockEndOffset;
      if (hasNestedBlocks) {
        const groupSizeInfo = readCauleb128(buffer, offset);
        offset = groupSizeInfo.nextOffset;
        groupEndOffset = offset + groupSizeInfo.value;
      }

      if (groupEndOffset > blockEndOffset) {
        throw new Error(`CAAB record ${name} group ${groupIndex} exceeds block bounds.`);
      }

      while (offset < groupEndOffset) {
        offset = parseNode(buffer, offset, false, childStack, tables, visitor, nodesEndOffset);
      }

      if (offset !== groupEndOffset) {
        throw new Error(`CAAB record ${name} group ${groupIndex} size mismatch.`);
      }
    }

    if (offset !== blockEndOffset) {
      throw new Error(`CAAB record ${name} block size mismatch.`);
    }

    visitor.onRecordEnd?.(recordInfo, stack);
    return offset;
  }

  let parsed: CaabValue | null = null;

  const makeArrayValue = (arrayMarker: number, cursorOffset: number): { nextOffset: number; value: CaabValue } => {
    const sizeInfo = readCauleb128(buffer, cursorOffset);
    const payloadOffset = sizeInfo.nextOffset;
    const payloadEnd = payloadOffset + sizeInfo.value;
    if (payloadEnd > nodesEndOffset) {
      throw new Error(`CAAB array marker 0x${arrayMarker.toString(16)} at ${markerOffset} exceeds node range.`);
    }
    return {
      nextOffset: payloadEnd,
      value: {
        kind: "array",
        marker: arrayMarker,
        value: {
          marker: arrayMarker,
          payloadByteLength: sizeInfo.value,
          payloadOffset,
          payload: buffer.subarray(payloadOffset, payloadEnd),
        },
      },
    };
  };

  switch (marker) {
    case MARKER_I8:
      parsed = { kind: "value", marker, type: "i8", value: buffer.readInt8(offset) };
      offset += 1;
      break;
    case MARKER_I16:
      parsed = { kind: "value", marker, type: "i16", value: buffer.readInt16LE(offset) };
      offset += 2;
      break;
    case MARKER_I32:
      parsed = { kind: "value", marker, type: "i32", value: buffer.readInt32LE(offset) };
      offset += 4;
      break;
    case MARKER_I64:
      parsed = { kind: "value", marker, type: "i64", value: Number(buffer.readBigInt64LE(offset)) };
      offset += 8;
      break;
    case MARKER_U8:
      parsed = { kind: "value", marker, type: "u8", value: buffer[offset] };
      offset += 1;
      break;
    case MARKER_U16:
      parsed = { kind: "value", marker, type: "u16", value: buffer.readUInt16LE(offset) };
      offset += 2;
      break;
    case MARKER_U32:
      parsed = { kind: "value", marker, type: "u32", value: buffer.readUInt32LE(offset) };
      offset += 4;
      break;
    case MARKER_U64:
      parsed = { kind: "value", marker, type: "u64", value: Number(buffer.readBigUInt64LE(offset)) };
      offset += 8;
      break;
    case MARKER_F32:
      parsed = { kind: "value", marker, type: "f32", value: buffer.readFloatLE(offset) };
      offset += 4;
      break;
    case MARKER_F64:
      parsed = { kind: "value", marker, type: "f64", value: buffer.readDoubleLE(offset) };
      offset += 8;
      break;
    case MARKER_COORD_2D:
      parsed = {
        kind: "value",
        marker,
        type: "coord2d",
        value: {
          x: buffer.readFloatLE(offset),
          y: buffer.readFloatLE(offset + 4),
        },
      };
      offset += 8;
      break;
    case MARKER_COORD_3D:
      parsed = {
        kind: "value",
        marker,
        type: "coord3d",
        value: {
          x: buffer.readFloatLE(offset),
          y: buffer.readFloatLE(offset + 4),
          z: buffer.readFloatLE(offset + 8),
        },
      };
      offset += 12;
      break;
    case MARKER_UTF16: {
      const id = buffer.readUInt32LE(offset);
      parsed = {
        kind: "value",
        marker,
        type: "utf16",
        value: { id, text: tables.utf16ById.get(id) ?? null },
      };
      offset += 4;
      break;
    }
    case MARKER_ASCII: {
      const id = buffer.readUInt32LE(offset);
      parsed = {
        kind: "value",
        marker,
        type: "ascii",
        value: { id, text: tables.utf8ById.get(id) ?? null },
      };
      offset += 4;
      break;
    }
    case MARKER_ANGLE:
      parsed = { kind: "value", marker, type: "angle", value: buffer.readInt16LE(offset) };
      offset += 2;
      break;
    case MARKER_BOOL_TRUE:
      parsed = { kind: "value", marker, type: "bool", value: true };
      break;
    case MARKER_BOOL_FALSE:
      parsed = { kind: "value", marker, type: "bool", value: false };
      break;
    case MARKER_U32_ZERO:
      parsed = { kind: "value", marker, type: "u32", value: 0 };
      break;
    case MARKER_U32_ONE:
      parsed = { kind: "value", marker, type: "u32", value: 1 };
      break;
    case MARKER_U32_BYTE:
      parsed = { kind: "value", marker, type: "u32", value: buffer[offset] };
      offset += 1;
      break;
    case MARKER_U32_16BIT:
      parsed = { kind: "value", marker, type: "u32", value: buffer.readUInt16LE(offset) };
      offset += 2;
      break;
    case MARKER_U32_24BIT:
      parsed = { kind: "value", marker, type: "u32", value: readUInt24LE(buffer, offset) };
      offset += 3;
      break;
    case MARKER_I32_ZERO:
      parsed = { kind: "value", marker, type: "i32", value: 0 };
      break;
    case MARKER_I32_BYTE:
      parsed = { kind: "value", marker, type: "i32", value: buffer.readInt8(offset) };
      offset += 1;
      break;
    case MARKER_I32_16BIT:
      parsed = { kind: "value", marker, type: "i32", value: buffer.readInt16LE(offset) };
      offset += 2;
      break;
    case MARKER_I32_24BIT:
      parsed = { kind: "value", marker, type: "i32", value: readInt24LE(buffer, offset) };
      offset += 3;
      break;
    case MARKER_F32_ZERO:
      parsed = { kind: "value", marker, type: "f32", value: 0 };
      break;
    case MARKER_UNKNOWN_21:
      parsed = { kind: "value", marker, type: "unknown21", value: buffer.readUInt32LE(offset) };
      offset += 4;
      break;
    case MARKER_UNKNOWN_23:
      parsed = { kind: "value", marker, type: "unknown23", value: buffer[offset] };
      offset += 1;
      break;
    case MARKER_UNKNOWN_24:
      parsed = { kind: "value", marker, type: "unknown24", value: buffer.readUInt16LE(offset) };
      offset += 2;
      break;
    case MARKER_UNKNOWN_25:
      parsed = { kind: "value", marker, type: "unknown25", value: buffer.readUInt32LE(offset) };
      offset += 4;
      break;
    case MARKER_UNKNOWN_26: {
      const firstByte = buffer[offset];
      offset += 1;
      if (firstByte % 8 === 0 && firstByte !== 0) {
        offset += firstByte;
      } else {
        offset += 7;
      }
      if (offset < nodesEndOffset && buffer[offset] === 0x9c) {
        offset += 1;
      }
      parsed = { kind: "value", marker, type: "unknown26", value: firstByte };
      break;
    }
    default:
      if ((marker >= 0x41 && marker <= 0x50) || (marker >= 0x52 && marker <= 0x5d)) {
        const arrayResult = makeArrayValue(marker, offset);
        offset = arrayResult.nextOffset;
        parsed = arrayResult.value;
        break;
      }
      throw new Error(`Unsupported CAAB node marker 0x${marker.toString(16)} at offset ${markerOffset}.`);
  }

  if (offset > nodesEndOffset) {
    throw new Error(`CAAB node marker 0x${marker.toString(16)} at ${markerOffset} exceeds node range.`);
  }

  if (parsed) {
    visitor.onValue?.(parsed, stack);
  }

  return offset;
}

export function walkCaabNodes(
  buffer: Buffer,
  header: Pick<CaabHeaderFields, "recordNamesOffset">,
  tables: Pick<CaabStringTables, "recordNames" | "utf8ById" | "utf16ById">,
  visitor: CaabWalkVisitor
): void {
  const nodesStartOffset = 16;
  const nodesEndOffset = header.recordNamesOffset;
  const offset = parseNode(buffer, nodesStartOffset, true, [], tables, visitor, nodesEndOffset);

  if (offset !== nodesEndOffset) {
    throw new Error(`CAAB node parse ended at ${offset}, expected ${nodesEndOffset}.`);
  }
}
