import type { PackHeader, PackedFile } from "./packFileTypes";

export const VANILLA_PACK_FILES_CACHE_VERSION = 4;
const MAGIC = Buffer.from("WVFC", "ascii");
const ENTRY_EXPANDED = 1;
const ENTRY_NAMES_ONLY = 2;
const MAX_ENTRY_COUNT = 100_000;
const MAX_TOTAL_FILE_COUNT = 5_000_000;
const MAX_STRING_BYTES = 16 * 1024 * 1024;

export interface VanillaCachedPackedFile {
  name: string;
  file_size: number;
  start_pos: number;
  is_compressed: boolean;
}

export interface VanillaCachedPackHeader {
  header: Buffer;
  byteMask: number;
  refFileCount: number;
  pack_file_index_size: number;
  pack_file_count: number;
  header_buffer: Buffer;
}

export interface VanillaPackFilesCacheEntry {
  size: number;
  lastChangedLocal: number;
  packedFiles?: VanillaCachedPackedFile[];
  packHeader?: VanillaCachedPackHeader;
  dependencyPacks?: string[];
  packedFileNames?: string[];
}

export interface VanillaPackFilesCache {
  version: typeof VANILLA_PACK_FILES_CACHE_VERSION;
  entries: Record<string, VanillaPackFilesCacheEntry>;
}

export interface CachedVanillaPackIndex {
  packedFiles: PackedFile[];
  packHeader: PackHeader;
  dependencyPacks: string[];
}

class BinaryWriter {
  private buffer = Buffer.allocUnsafe(1024 * 1024);
  private offset = 0;

  get position(): number {
    return this.offset;
  }

  private ensure(additionalBytes: number): void {
    const required = this.offset + additionalBytes;
    if (required <= this.buffer.length) return;

    let capacity = this.buffer.length;
    while (capacity < required) capacity *= 2;
    const replacement = Buffer.allocUnsafe(capacity);
    this.buffer.copy(replacement, 0, 0, this.offset);
    this.buffer = replacement;
  }

  writeUInt8(value: number): void {
    this.ensure(1);
    this.buffer.writeUInt8(value, this.offset);
    this.offset += 1;
  }

  writeUInt32(value: number): void {
    assertUInt32(value);
    this.ensure(4);
    this.buffer.writeUInt32LE(value, this.offset);
    this.offset += 4;
  }

  patchUInt32(offset: number, value: number): void {
    assertUInt32(value);
    if (!Number.isInteger(offset) || offset < 0 || offset + 4 > this.offset) throw new Error("invalid patch offset");
    this.buffer.writeUInt32LE(value, offset);
  }

  writeInt32(value: number): void {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new Error("int32 out of range");
    this.ensure(4);
    this.buffer.writeInt32LE(value, this.offset);
    this.offset += 4;
  }

  writeUInt64(value: number): void {
    assertSafeUnsignedInteger(value);
    this.ensure(8);
    this.buffer.writeBigUInt64LE(BigInt(value), this.offset);
    this.offset += 8;
  }

  writeDouble(value: number): void {
    if (!Number.isFinite(value)) throw new Error("non-finite double");
    this.ensure(8);
    this.buffer.writeDoubleLE(value, this.offset);
    this.offset += 8;
  }

  writeBytes(value: Uint8Array): void {
    this.ensure(value.byteLength);
    Buffer.from(value.buffer, value.byteOffset, value.byteLength).copy(this.buffer, this.offset);
    this.offset += value.byteLength;
  }

  writeString(value: string): void {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > MAX_STRING_BYTES) throw new Error("cache string too large");
    this.writeUInt32(bytes.length);
    this.writeBytes(bytes);
  }

  finish(): Buffer {
    return Buffer.from(this.buffer.subarray(0, this.offset));
  }
}

class BinaryReader {
  private offset = 0;

  constructor(private readonly bytes: Buffer) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private require(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) throw new Error("truncated cache");
  }

  readUInt8(): number {
    this.require(1);
    const value = this.bytes.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUInt32(): number {
    this.require(4);
    const value = this.bytes.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readInt32(): number {
    this.require(4);
    const value = this.bytes.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readUInt64(): number {
    this.require(8);
    const value = this.bytes.readBigUInt64LE(this.offset);
    this.offset += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("uint64 exceeds JS safe integer range");
    return Number(value);
  }

  readDouble(): number {
    this.require(8);
    const value = this.bytes.readDoubleLE(this.offset);
    this.offset += 8;
    if (!Number.isFinite(value)) throw new Error("non-finite double");
    return value;
  }

  readBytes(length: number): Buffer {
    this.require(length);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readString(): string {
    const length = this.readUInt32();
    if (length > MAX_STRING_BYTES) throw new Error("cache string too large");
    return this.readBytes(length).toString("utf8");
  }

  skipString(): void {
    const length = this.readUInt32();
    if (length > MAX_STRING_BYTES) throw new Error("cache string too large");
    this.readBytes(length);
  }

  skipTo(position: number): void {
    if (!Number.isSafeInteger(position) || position < this.offset || position > this.bytes.length) {
      throw new Error("invalid cache record boundary");
    }
    this.offset = position;
  }
}

const assertUInt32 = (value: number): void => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("uint32 out of range");
};

const assertSafeUnsignedInteger = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("unsafe unsigned integer");
};

const commonPrefixLength = (previous: string, current: string): number => {
  const limit = Math.min(previous.length, current.length);
  let prefix = 0;
  while (prefix < limit && previous.charCodeAt(prefix) === current.charCodeAt(prefix)) prefix++;

  // Do not split a UTF-16 surrogate pair between the prefix and UTF-8 suffix.
  if (prefix > 0) {
    const last = previous.charCodeAt(prefix - 1);
    if (last >= 0xd800 && last <= 0xdbff) prefix--;
  }
  return prefix;
};

const writeFrontCodedString = (writer: BinaryWriter, previous: string, current: string): void => {
  const prefixLength = commonPrefixLength(previous, current);
  writer.writeUInt32(prefixLength);
  writer.writeString(current.slice(prefixLength));
};

const readFrontCodedString = (reader: BinaryReader, previous: string): string => {
  const prefixLength = reader.readUInt32();
  if (prefixLength > previous.length) throw new Error("invalid front-coded prefix");
  return previous.slice(0, prefixLength) + reader.readString();
};

const inspectRecordFileCount = (kind: number, recordBytes: Buffer): number => {
  const reader = new BinaryReader(recordBytes);
  reader.skipString();
  reader.readUInt64();
  reader.readDouble();

  if (kind === ENTRY_NAMES_ONLY) return reader.readUInt32();
  if (kind !== ENTRY_EXPANDED) throw new Error("invalid cache entry kind");

  const headerLength = reader.readUInt32();
  if (headerLength > 1024) throw new Error("invalid pack header length");
  reader.readBytes(headerLength);
  reader.readInt32();
  reader.readUInt32();
  reader.readUInt32();
  const packFileCount = reader.readUInt32();
  const headerBufferLength = reader.readUInt32();
  if (headerBufferLength > 1024 * 1024) throw new Error("invalid pack header buffer length");
  reader.readBytes(headerBufferLength);

  const dependencyCount = reader.readUInt32();
  if (dependencyCount > 100_000) throw new Error("invalid dependency count");
  for (let index = 0; index < dependencyCount; index++) reader.skipString();

  const fileCount = reader.readUInt32();
  const nonWemFileCount = reader.readUInt32();
  if (fileCount > MAX_TOTAL_FILE_COUNT || nonWemFileCount > fileCount || packFileCount !== fileCount) {
    throw new Error("invalid packed-file count");
  }
  return fileCount;
};

const isExpandedEntry = (entry: VanillaPackFilesCacheEntry): boolean =>
  Array.isArray(entry.packedFiles) && !!entry.packHeader && Array.isArray(entry.dependencyPacks);

const isWemPath = (path: string): boolean => path.toLowerCase().endsWith(".wem");

const encodeExpandedEntry = (writer: BinaryWriter, entry: VanillaPackFilesCacheEntry): void => {
  const packedFiles = entry.packedFiles!;
  const header = entry.packHeader!;

  writer.writeUInt32(header.header.length);
  writer.writeBytes(header.header);
  writer.writeInt32(header.byteMask);
  writer.writeUInt32(header.refFileCount);
  writer.writeUInt32(header.pack_file_index_size);
  writer.writeUInt32(header.pack_file_count);
  writer.writeUInt32(header.header_buffer.length);
  writer.writeBytes(header.header_buffer);

  writer.writeUInt32(entry.dependencyPacks!.length);
  for (const dependency of entry.dependencyPacks!) writer.writeString(dependency);

  writer.writeUInt32(packedFiles.length);
  writer.writeUInt32(packedFiles.reduce((count, packedFile) => count + (isWemPath(packedFile.name) ? 0 : 1), 0));
  const firstStartPos = packedFiles.length === 0 ? 0 : packedFiles[0].start_pos;
  writer.writeUInt64(firstStartPos);

  let expectedStartPos = firstStartPos;
  let previousName = "";
  for (const packedFile of packedFiles) {
    assertUInt32(packedFile.file_size);
    assertSafeUnsignedInteger(packedFile.start_pos);
    if (packedFile.start_pos !== expectedStartPos) {
      throw new Error(`non-contiguous packed-file offsets for ${packedFile.name}`);
    }

    writeFrontCodedString(writer, previousName, packedFile.name);
    writer.writeUInt32(packedFile.file_size);
    writer.writeUInt8(packedFile.is_compressed ? 1 : 0);

    previousName = packedFile.name;
    expectedStartPos += packedFile.file_size;
    assertSafeUnsignedInteger(expectedStartPos);
  }
};

const decodeExpandedEntry = (
  reader: BinaryReader,
  size: number,
  lastChangedLocal: number,
  totalFileCount: { value: number },
): VanillaPackFilesCacheEntry => {
  const headerLength = reader.readUInt32();
  if (headerLength > 1024) throw new Error("invalid pack header length");
  const header = Buffer.from(reader.readBytes(headerLength));
  const byteMask = reader.readInt32();
  const refFileCount = reader.readUInt32();
  const packFileIndexSize = reader.readUInt32();
  const packFileCount = reader.readUInt32();
  const headerBufferLength = reader.readUInt32();
  if (headerBufferLength > 1024 * 1024) throw new Error("invalid pack header buffer length");
  const headerBuffer = Buffer.from(reader.readBytes(headerBufferLength));

  const dependencyCount = reader.readUInt32();
  if (dependencyCount > 100_000) throw new Error("invalid dependency count");
  const dependencyPacks = Array.from({ length: dependencyCount }, () => reader.readString());

  const fileCount = reader.readUInt32();
  const nonWemFileCount = reader.readUInt32();
  if (fileCount > MAX_TOTAL_FILE_COUNT || nonWemFileCount > fileCount) {
    throw new Error("invalid packed-file count");
  }
  totalFileCount.value += fileCount;
  if (totalFileCount.value > MAX_TOTAL_FILE_COUNT) throw new Error("cache contains too many files");

  let startPos = reader.readUInt64();
  let previousName = "";
  let decodedNonWemFileCount = 0;
  const packedFiles = new Array<VanillaCachedPackedFile>(fileCount);
  for (let index = 0; index < fileCount; index++) {
    const name = readFrontCodedString(reader, previousName);
    const fileSize = reader.readUInt32();
    const compressed = reader.readUInt8();
    if (compressed > 1) throw new Error("invalid compression flag");

    packedFiles[index] = {
      name,
      file_size: fileSize,
      start_pos: startPos,
      is_compressed: compressed === 1,
    };
    if (!isWemPath(name)) decodedNonWemFileCount++;
    startPos += fileSize;
    assertSafeUnsignedInteger(startPos);
    previousName = name;
  }

  if (packFileCount !== fileCount) throw new Error("pack file count mismatch");
  if (decodedNonWemFileCount !== nonWemFileCount) throw new Error("non-WEM file count mismatch");

  return {
    size,
    lastChangedLocal,
    packedFiles,
    packHeader: {
      header,
      byteMask,
      refFileCount,
      pack_file_index_size: packFileIndexSize,
      pack_file_count: packFileCount,
      header_buffer: headerBuffer,
    },
    dependencyPacks,
  };
};

export const encodeVanillaPackFilesCache = (cache: VanillaPackFilesCache): Buffer => {
  const entries = Object.entries(cache.entries);
  if (entries.length > MAX_ENTRY_COUNT) throw new Error("cache contains too many entries");

  const writer = new BinaryWriter();
  writer.writeBytes(MAGIC);
  writer.writeUInt32(VANILLA_PACK_FILES_CACHE_VERSION);
  writer.writeUInt32(entries.length);

  for (const [packPath, entry] of entries) {
    const expanded = isExpandedEntry(entry);
    const namesOnly = Array.isArray(entry.packedFileNames);
    if (!expanded && !namesOnly) throw new Error(`invalid cache entry for ${packPath}`);

    writer.writeUInt8(expanded ? ENTRY_EXPANDED : ENTRY_NAMES_ONLY);
    const recordLengthOffset = writer.position;
    writer.writeUInt32(0);
    const recordStart = writer.position;

    writer.writeString(packPath);
    writer.writeUInt64(entry.size);
    writer.writeDouble(entry.lastChangedLocal);

    if (expanded) {
      encodeExpandedEntry(writer, entry);
    } else {
      const names = entry.packedFileNames!;
      writer.writeUInt32(names.length);
      let previousName = "";
      for (const name of names) {
        writeFrontCodedString(writer, previousName, name);
        previousName = name;
      }
    }

    writer.patchUInt32(recordLengthOffset, writer.position - recordStart);
  }

  return writer.finish();
};

export interface VanillaPackFilesCacheMetadataEntry {
  size: number;
  lastChangedLocal: number;
  hasExpandedIndex: boolean;
}

export interface VanillaPackFilesCacheRecord {
  packPath: string;
  size: number;
  lastChangedLocal: number;
  hasExpandedIndex: boolean;
  kind: number;
  dataOffset: number;
  dataLength: number;
}

/**
 * Reads the per-pack record directory. Record lengths let this skip every packed-file
 * block without decoding file names or allocating per-file objects.
 */
export const indexVanillaPackFilesCache = (bytes: Buffer): Map<string, VanillaPackFilesCacheRecord> | undefined => {
  try {
    const reader = new BinaryReader(bytes);
    if (!reader.readBytes(MAGIC.length).equals(MAGIC)) return undefined;
    if (reader.readUInt32() !== VANILLA_PACK_FILES_CACHE_VERSION) return undefined;

    const entryCount = reader.readUInt32();
    if (entryCount > MAX_ENTRY_COUNT) return undefined;

    const metadata = new Map<string, VanillaPackFilesCacheRecord>();
    let totalFileCount = 0;
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
      const kind = reader.readUInt8();
      if (kind !== ENTRY_EXPANDED && kind !== ENTRY_NAMES_ONLY) return undefined;

      const recordLength = reader.readUInt32();
      if (recordLength > reader.remaining) return undefined;
      const dataOffset = reader.position;
      const recordEnd = reader.position + recordLength;
      const recordBytes = reader.readBytes(recordLength);
      const recordReader = new BinaryReader(recordBytes);
      const packPath = recordReader.readString();
      const size = recordReader.readUInt64();
      const lastChangedLocal = recordReader.readDouble();
      const fileCount = inspectRecordFileCount(kind, recordBytes);
      totalFileCount += fileCount;
      if (totalFileCount > MAX_TOTAL_FILE_COUNT) return undefined;
      metadata.set(packPath, {
        packPath,
        size,
        lastChangedLocal,
        hasExpandedIndex: kind === ENTRY_EXPANDED,
        kind,
        dataOffset,
        dataLength: recordLength,
      });
      reader.skipTo(recordEnd);
    }

    return reader.remaining === 0 ? metadata : undefined;
  } catch {
    return undefined;
  }
};

/** Returns the public metadata view without exposing internal record offsets. */
export const inspectVanillaPackFilesCache = (
  bytes: Buffer,
): Map<string, VanillaPackFilesCacheMetadataEntry> | undefined => {
  const records = indexVanillaPackFilesCache(bytes);
  if (!records) return undefined;
  return new Map(
    [...records].map(([packPath, record]) => [
      packPath,
      {
        size: record.size,
        lastChangedLocal: record.lastChangedLocal,
        hasExpandedIndex: record.hasExpandedIndex,
      },
    ]),
  );
};

const decodeCacheRecord = (
  kind: number,
  recordBytes: Buffer,
  totalFileCount: { value: number },
): [string, VanillaPackFilesCacheEntry] | undefined => {
  const reader = new BinaryReader(recordBytes);
  const packPath = reader.readString();
  const size = reader.readUInt64();
  const lastChangedLocal = reader.readDouble();

  let entry: VanillaPackFilesCacheEntry;
  if (kind === ENTRY_EXPANDED) {
    entry = decodeExpandedEntry(reader, size, lastChangedLocal, totalFileCount);
  } else if (kind === ENTRY_NAMES_ONLY) {
    const nameCount = reader.readUInt32();
    totalFileCount.value += nameCount;
    if (totalFileCount.value > MAX_TOTAL_FILE_COUNT) throw new Error("cache contains too many files");

    const packedFileNames = new Array<string>(nameCount);
    let previousName = "";
    for (let nameIndex = 0; nameIndex < nameCount; nameIndex++) {
      const name = readFrontCodedString(reader, previousName);
      packedFileNames[nameIndex] = name;
      previousName = name;
    }
    entry = { size, lastChangedLocal, packedFileNames };
  } else {
    return undefined;
  }

  if (reader.remaining !== 0) return undefined;
  return [packPath, entry];
};

/** Decodes one indexed record, rejecting malformed contents or mismatched directory metadata. */
export const decodeVanillaPackFilesCacheRecord = (
  bytes: Buffer,
  record: VanillaPackFilesCacheRecord,
): VanillaPackFilesCacheEntry | undefined => {
  try {
    if (
      !Number.isSafeInteger(record.dataOffset) ||
      !Number.isSafeInteger(record.dataLength) ||
      record.dataOffset < 0 ||
      record.dataLength < 0 ||
      record.dataOffset + record.dataLength > bytes.length
    ) {
      return undefined;
    }
    const decoded = decodeCacheRecord(
      record.kind,
      bytes.subarray(record.dataOffset, record.dataOffset + record.dataLength),
      { value: 0 },
    );
    if (!decoded) return undefined;
    const [packPath, entry] = decoded;
    if (
      packPath !== record.packPath ||
      entry.size !== record.size ||
      entry.lastChangedLocal !== record.lastChangedLocal
    ) {
      return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
};

export const decodeVanillaPackFilesCache = (bytes: Buffer): VanillaPackFilesCache | undefined => {
  try {
    const reader = new BinaryReader(bytes);
    if (!reader.readBytes(MAGIC.length).equals(MAGIC)) return undefined;
    if (reader.readUInt32() !== VANILLA_PACK_FILES_CACHE_VERSION) return undefined;

    const entryCount = reader.readUInt32();
    if (entryCount > MAX_ENTRY_COUNT) return undefined;

    const entries: Record<string, VanillaPackFilesCacheEntry> = {};
    const totalFileCount = { value: 0 };

    for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
      const kind = reader.readUInt8();
      const recordLength = reader.readUInt32();
      if (recordLength > reader.remaining) return undefined;
      const decoded = decodeCacheRecord(kind, reader.readBytes(recordLength), totalFileCount);
      if (!decoded) return undefined;
      const [packPath, entry] = decoded;
      entries[packPath] = entry;
    }

    if (reader.remaining !== 0) return undefined;
    return { version: VANILLA_PACK_FILES_CACHE_VERSION, entries };
  } catch {
    return undefined;
  }
};
