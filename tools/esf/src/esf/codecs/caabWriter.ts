import { CaabHeaderFields, CaabStringTables } from "./caabBinary";
import { CaabItem, CaabRecordNode, recordUsesNonOptimizedHeader } from "./caabTree";

const HEADER_BYTE_LENGTH = 16;

/**
 * Big-endian LEB128, minimal length. The reader accepts padded encodings (a
 * leading 0x80 contributes nothing), so a byte-identical round-trip is what
 * proves the shipped files use the minimal form everywhere.
 */
export function cauleb128Length(value: number): number {
  if (value < 0 || !Number.isInteger(value)) {
    throw new Error(`CAULEB128 values must be non-negative integers, got ${value}.`);
  }
  let length = 1;
  let remaining = Math.floor(value / 128);
  while (remaining > 0) {
    length += 1;
    remaining = Math.floor(remaining / 128);
  }
  return length;
}

/**
 * Encodes `value` in exactly `width` bytes, which must be at least the minimal
 * length. Padding shows up as leading 0x80 bytes: a zero digit that still
 * carries the continuation bit, which is how the shipped files pad.
 */
export function writeCauleb128(buffer: Buffer, offset: number, value: number, width?: number): number {
  const minimal = cauleb128Length(value);
  const length = Math.max(width ?? minimal, minimal);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    const byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    buffer[offset + index] = index === length - 1 ? byte : byte | 0x80;
  }
  return offset + length;
}

/** The width a field will actually occupy: its original width, or wider if the value outgrew it. */
function fieldWidth(value: number, originalWidth: number): number {
  return Math.max(originalWidth, cauleb128Length(value));
}

function recordHeaderLength(node: CaabRecordNode): number {
  const nameAndVersion = recordUsesNonOptimizedHeader(node) ? 3 : 1;
  const groupCountBytes = node.hasNestedBlocks
    ? fieldWidth(node.groups.length, node.groupCountWidth)
    : 0;
  // The marker byte, name/version, the block size, then the group count.
  return 1 + nameAndVersion + fieldWidth(node.blockSize ?? 0, node.blockSizeWidth) + groupCountBytes;
}

function measureItem(item: CaabItem): number {
  if (item.kind === "raw") {
    return item.end - item.start;
  }
  if (item.kind === "bytes") {
    return item.data.length;
  }
  return measureRecord(item);
}

/**
 * Computes and caches every block and group size bottom-up. Block sizes feed
 * into their own CAULEB128 length, so the parent's size can only be known once
 * all descendants are measured.
 */
export function measureRecord(node: CaabRecordNode): number {
  const groupSizes: number[] = [];
  let blockSize = 0;

  for (let index = 0; index < node.groups.length; index += 1) {
    let groupSize = 0;
    for (const item of node.groups[index]) {
      groupSize += measureItem(item);
    }
    groupSizes.push(groupSize);
    if (node.hasNestedBlocks) {
      // A group added by an edit has no original width; fall back to minimal.
      blockSize += fieldWidth(groupSize, node.groupSizeWidths[index] ?? 0) + groupSize;
    } else {
      blockSize += groupSize;
    }
  }

  node.groupSizes = groupSizes;
  node.blockSize = blockSize;
  node.totalSize = recordHeaderLength(node) + blockSize;
  return node.totalSize;
}

function writeItem(source: Buffer, target: Buffer, offset: number, item: CaabItem): number {
  if (item.kind === "raw") {
    source.copy(target, offset, item.start, item.end);
    return offset + (item.end - item.start);
  }
  if (item.kind === "bytes") {
    item.data.copy(target, offset);
    return offset + item.data.length;
  }
  return writeRecord(source, target, offset, item);
}

function writeRecord(source: Buffer, target: Buffer, offset: number, node: CaabRecordNode): number {
  if (node.blockSize === undefined || node.groupSizes === undefined) {
    throw new Error(`Record ${node.name} was written before being measured.`);
  }

  let cursor = offset;
  target[cursor] = node.flags;
  cursor += 1;

  if (recordUsesNonOptimizedHeader(node)) {
    target.writeUInt16LE(node.nameIndex, cursor);
    target[cursor + 2] = node.version;
    cursor += 3;
  } else {
    // The marker byte already carries the version and the name index's high
    // bit; only the low byte of the name index is stored separately.
    target[cursor] = node.nameIndex & 0xff;
    cursor += 1;
  }

  cursor = writeCauleb128(target, cursor, node.blockSize, node.blockSizeWidth);
  if (node.hasNestedBlocks) {
    cursor = writeCauleb128(target, cursor, node.groups.length, node.groupCountWidth);
  }

  for (let index = 0; index < node.groups.length; index += 1) {
    if (node.hasNestedBlocks) {
      cursor = writeCauleb128(target, cursor, node.groupSizes[index], node.groupSizeWidths[index] ?? 0);
    }
    for (const item of node.groups[index]) {
      cursor = writeItem(source, target, cursor, item);
    }
  }

  return cursor;
}

function sizedStringLength(byteLength: number, sizePrefixBytes: number): number {
  return sizePrefixBytes + byteLength;
}

/**
 * Re-emits the record-name table and both indexed string tables. Ids are stored
 * explicitly next to each entry rather than implied by position, so entries are
 * written back in their original order without any renumbering.
 */
function measureTail(tables: CaabStringTables, format: "caab" | "cbab"): number {
  const sizePrefix = format === "caab" ? 2 : 4;
  let total = 2; // record-name count (u16)

  for (const entry of tables.entries) {
    if (entry.table === "record_name") {
      total += sizedStringLength(Buffer.byteLength(entry.text ?? "", "utf8"), 2);
    }
  }

  total += 4; // utf16 count
  for (const entry of tables.entries) {
    if (entry.table === "utf16") {
      total += sizedStringLength(Buffer.byteLength(entry.text ?? "", "utf16le"), sizePrefix) + 4;
    }
  }

  total += 4; // utf8 count
  for (const entry of tables.entries) {
    if (entry.table === "utf8") {
      total += sizedStringLength(Buffer.byteLength(entry.text ?? "", "utf8"), sizePrefix) + 4;
    }
  }

  return total;
}

function writeTail(target: Buffer, offset: number, tables: CaabStringTables, format: "caab" | "cbab"): number {
  let cursor = offset;

  const recordNames = tables.entries.filter((entry) => entry.table === "record_name");
  target.writeUInt16LE(recordNames.length, cursor);
  cursor += 2;
  for (const entry of recordNames) {
    const bytes = Buffer.from(entry.text ?? "", "utf8");
    target.writeUInt16LE(bytes.length, cursor);
    cursor += 2;
    bytes.copy(target, cursor);
    cursor += bytes.length;
  }

  const writeIndexedTable = (table: "utf16" | "utf8") => {
    const entries = tables.entries.filter((entry) => entry.table === table);
    target.writeUInt32LE(entries.length, cursor);
    cursor += 4;
    for (const entry of entries) {
      const bytes = Buffer.from(entry.text ?? "", table === "utf16" ? "utf16le" : "utf8");
      // UTF-16 lengths are counted in characters; UTF-8 lengths in bytes.
      const countValue = table === "utf16" ? bytes.length / 2 : bytes.length;
      if (format === "caab") {
        target.writeUInt16LE(countValue, cursor);
        cursor += 2;
      } else {
        target.writeUInt32LE(countValue, cursor);
        cursor += 4;
      }
      bytes.copy(target, cursor);
      cursor += bytes.length;
      target.writeUInt32LE(entry.id, cursor);
      cursor += 4;
    }
  };

  writeIndexedTable("utf16");
  writeIndexedTable("utf8");
  return cursor;
}

export interface WriteCaabOptions {
  header: CaabHeaderFields;
  tables: CaabStringTables;
  root: CaabRecordNode;
  /** The buffer the tree's raw spans point into. */
  source: Buffer;
}

/**
 * Serialises a tree back to a complete ESF buffer. Record headers are rebuilt
 * from their parsed fields; value runs are copied byte-for-byte from `source`.
 */
export function writeCaabBuffer(options: WriteCaabOptions): Buffer {
  const { header, tables, root, source } = options;
  const format: "caab" | "cbab" = header.codecId === 0x0000abcb ? "cbab" : "caab";

  const nodeBytes = measureRecord(root);
  const tailBytes = measureTail(tables, format);
  const total = HEADER_BYTE_LENGTH + nodeBytes + tailBytes;

  const target = Buffer.allocUnsafe(total);
  const recordNamesOffset = HEADER_BYTE_LENGTH + nodeBytes;

  target.writeUInt32LE(header.codecId, 0);
  target.writeUInt32LE(header.unknown1, 4);
  target.writeUInt32LE(header.creationDate, 8);
  target.writeUInt32LE(recordNamesOffset, 12);

  const afterNodes = writeRecord(source, target, HEADER_BYTE_LENGTH, root);
  if (afterNodes !== recordNamesOffset) {
    throw new Error(`Node section wrote ${afterNodes - HEADER_BYTE_LENGTH} bytes, measured ${nodeBytes}.`);
  }

  const afterTail = writeTail(target, afterNodes, tables, format);
  if (afterTail !== total) {
    throw new Error(`Tail wrote ${afterTail - afterNodes} bytes, measured ${tailBytes}.`);
  }

  return target;
}
