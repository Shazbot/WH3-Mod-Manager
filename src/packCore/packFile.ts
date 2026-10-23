import * as fs from "node:fs";
import * as path from "node:path";
import { hasPackedFileNameHash, readPackedFileIndexEntry } from "../utility/packFileIndex";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import {
  DEFAULT_MAX_INDEX_BYTES,
  DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES,
  type CorePack,
  type CorePackEntry,
  type PackCoreContext,
  type RawPackWriteEntry,
  type RawPackWriteMetadata,
} from "./types";
import { decompressPackedPayload } from "./compression";
import { packGameSupportsCompression, packGameToHeader } from "./gameContext";

const PFH_HEADER_SIZE = 28;
const PFH_HEADER_BUFFER_SIZE = 4;
const PFH_FILENAME_HASH_MASK = 0x40;

const fail = (packPath: string, message: string): never => {
  throw new Error(`Invalid pack ${packPath}: ${message}`);
};

const readExactly = (fd: number, length: number, position: number, packPath: string): Buffer => {
  const result = Buffer.alloc(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const count = fs.readSync(fd, result, bytesRead, length - bytesRead, position + bytesRead);
    if (count === 0) fail(packPath, `short read at offset ${position + bytesRead}`);
    bytesRead += count;
  }
  return result;
};

const parseDependencies = (bytes: Buffer, packPath: string): string[] => {
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0) fail(packPath, "dependency index is not null terminated");

  const dependencies: string[] = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] !== 0) continue;
    if (index > start) dependencies.push(bytes.toString("utf8", start, index));
    start = index + 1;
  }
  return dependencies;
};

/** Strictly reads a PFH header and index. No GUI caches or application state are consulted. */
export const readPackIndex = (packPath: string, context: PackCoreContext): CorePack => {
  const maxIndexBytes = context.maxIndexBytes ?? DEFAULT_MAX_INDEX_BYTES;
  if (!Number.isSafeInteger(maxIndexBytes) || maxIndexBytes < 0) {
    throw new Error(`maxIndexBytes must be a non-negative safe integer, got ${maxIndexBytes}`);
  }

  const fd = fs.openSync(packPath, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail(packPath, "path is not a regular file");
    if (stat.size < PFH_HEADER_SIZE) fail(packPath, `header is truncated (${stat.size} bytes)`);

    const rawHeader = readExactly(fd, PFH_HEADER_SIZE, 0, packPath);
    const signature = Buffer.from(rawHeader.subarray(0, 4));
    const actualSignature = signature.toString("ascii");
    const expectedSignature = packGameToHeader[context.game];
    if (actualSignature !== expectedSignature) {
      fail(packPath, `header ${actualSignature} does not match game ${context.game} (${expectedSignature})`);
    }

    const byteMask = rawHeader.readInt32LE(4);
    const refFileCount = rawHeader.readInt32LE(8);
    const dependencyIndexSize = rawHeader.readInt32LE(12);
    const fileCount = rawHeader.readInt32LE(16);
    const fileIndexSize = rawHeader.readInt32LE(20);
    const headerBuffer = Buffer.from(rawHeader.subarray(24, 28));

    for (const [label, value] of [
      ["reference count", refFileCount],
      ["dependency index size", dependencyIndexSize],
      ["file count", fileCount],
      ["file index size", fileIndexSize],
    ] as const) {
      if (value < 0) fail(packPath, `${label} is negative (${value})`);
    }
    if (dependencyIndexSize > maxIndexBytes || fileIndexSize > maxIndexBytes) {
      fail(packPath, `index section exceeds configured ${maxIndexBytes} byte limit`);
    }
    if (dependencyIndexSize + fileIndexSize > maxIndexBytes) {
      fail(packPath, `combined indexes exceed configured ${maxIndexBytes} byte limit`);
    }

    const indexStart = PFH_HEADER_SIZE + dependencyIndexSize;
    const dataStart = indexStart + fileIndexSize;
    if (dataStart > stat.size) fail(packPath, `index ends at ${dataStart}, beyond file size ${stat.size}`);

    const hasCompressionFlag = packGameSupportsCompression[context.game];
    const hasFileNameHash = hasPackedFileNameHash(byteMask);
    const minEntrySize = 4 + (hasFileNameHash ? 4 : 0) + (hasCompressionFlag ? 1 : 0) + 1;
    if (fileCount > Math.floor(fileIndexSize / minEntrySize)) {
      fail(packPath, `file count ${fileCount} cannot fit in ${fileIndexSize} byte index`);
    }

    const dependencyBytes = readExactly(fd, dependencyIndexSize, PFH_HEADER_SIZE, packPath);
    const dependencies = parseDependencies(dependencyBytes, packPath);
    const packedFileIndex = readExactly(fd, fileIndexSize, indexStart, packPath);
    const entries: CorePackEntry[] = [];
    let indexPosition = 0;
    let payloadPosition = dataStart;

    for (let index = 0; index < fileCount; index++) {
      const entry = readPackedFileIndexEntry(packedFileIndex, indexPosition, hasCompressionFlag, hasFileNameHash);
      if (!entry) return fail(packPath, `could not parse packed-file index entry ${index}`);
      if (entry.file_size < 0) fail(packPath, `entry ${index} has a negative payload size`);
      if (entry.name.length === 0) fail(packPath, `entry ${index} has an empty filename`);

      const coreEntry: CorePackEntry = {
        name: entry.name,
        file_size: entry.file_size,
        start_pos: payloadPosition,
        is_compressed: entry.is_compressed,
      };
      if (entry.file_name_hash !== undefined) coreEntry.file_name_hash = entry.file_name_hash;
      payloadPosition += entry.file_size;
      if (!Number.isSafeInteger(payloadPosition) || payloadPosition > stat.size) {
        fail(packPath, `payload for entry ${index} ends at ${payloadPosition}, beyond file size ${stat.size}`);
      }
      entries.push(coreEntry);
      indexPosition = entry.nextPosition;
    }
    if (indexPosition !== packedFileIndex.length) {
      fail(packPath, `file index has ${packedFileIndex.length - indexPosition} unclaimed trailing bytes`);
    }
    const trailingSize = stat.size - payloadPosition;
    if (trailingSize > maxIndexBytes) fail(packPath, `trailing data exceeds configured ${maxIndexBytes} byte limit`);
    const trailingBytes = readExactly(fd, trailingSize, payloadPosition, packPath);

    return {
      path: path.resolve(packPath),
      game: context.game,
      fileSize: stat.size,
      dataStart,
      header: {
        signature,
        byteMask,
        refFileCount,
        dependencyIndexSize,
        fileCount,
        fileIndexSize,
        headerBuffer,
        rawHeader,
      },
      dependencyBytes,
      dependencies,
      entries,
      trailingBytes,
    };
  } finally {
    fs.closeSync(fd);
  }
};

/** Reads the bytes stored in an entry, preserving compression exactly as it appears in the pack. */
export const readRawPayload = (pack: Pick<CorePack, "path">, entry: CorePackEntry): Buffer => {
  if (!Number.isSafeInteger(entry.start_pos) || entry.start_pos < 0) {
    throw new Error(`Invalid payload offset for ${entry.name}: ${entry.start_pos}`);
  }
  if (!Number.isSafeInteger(entry.file_size) || entry.file_size < 0) {
    throw new Error(`Invalid payload size for ${entry.name}: ${entry.file_size}`);
  }
  const fd = fs.openSync(pack.path, "r");
  try {
    return readExactly(fd, entry.file_size, entry.start_pos, pack.path);
  } finally {
    fs.closeSync(fd);
  }
};

/** Reads a logical payload, decompressing when the index marks it compressed. */
export const readPayload = async (
  pack: Pick<CorePack, "path" | "game">,
  entry: CorePackEntry,
  context: PackCoreContext = { game: pack.game },
): Promise<Buffer> => {
  const maxLogicalPayloadBytes = context.maxLogicalPayloadBytes ?? DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES;
  if (!Number.isSafeInteger(maxLogicalPayloadBytes) || maxLogicalPayloadBytes < 0) {
    throw new Error(`maxLogicalPayloadBytes must be a non-negative safe integer, got ${maxLogicalPayloadBytes}`);
  }
  if (entry.file_size > maxLogicalPayloadBytes) {
    throw new Error(`Stored payload ${entry.name} exceeds configured ${maxLogicalPayloadBytes} byte limit`);
  }
  const raw = readRawPayload(pack, entry);
  const logical = entry.is_compressed
    ? await decompressPackedPayload(raw, entry.name, maxLogicalPayloadBytes)
    : raw;
  if (logical.length > maxLogicalPayloadBytes) {
    throw new Error(`Logical payload ${entry.name} exceeds configured ${maxLogicalPayloadBytes} byte limit`);
  }
  return logical;
};

const createDependencyBytes = (dependencies: readonly string[]): Buffer => {
  if (dependencies.some((dependency) => dependency.includes("\0"))) {
    throw new Error("Dependency pack names cannot contain null bytes");
  }
  return Buffer.concat(dependencies.map((dependency) => Buffer.concat([Buffer.from(dependency, "utf8"), Buffer.from([0])])));
};

const validateWriteEntry = (entry: RawPackWriteEntry, useFilenameHash: boolean): number => {
  if (!entry.name || entry.name.includes("\0")) throw new Error(`Invalid packed filename: ${JSON.stringify(entry.name)}`);
  if ((entry.buffer === undefined) === (entry.source === undefined)) {
    throw new Error(`Packed file ${entry.name} must have exactly one of buffer or source`);
  }
  const size = entry.buffer?.length ?? entry.source!.file_size;
  if (!Number.isSafeInteger(size) || size < 0 || size > 0x7fffffff) {
    throw new Error(`Packed file ${entry.name} has unsupported size ${size}`);
  }
  if (useFilenameHash && (!Number.isInteger(entry.file_name_hash) || entry.file_name_hash! < 0 || entry.file_name_hash! > 0xffffffff)) {
    throw new Error(`Packed file ${entry.name} is missing its filename hash`);
  }
  if (entry.source) {
    if (!Number.isSafeInteger(entry.source.start_pos) || entry.source.start_pos < 0) {
      throw new Error(`Packed file ${entry.name} has invalid source offset`);
    }
    if (entry.source.file_size !== size) throw new Error(`Packed file ${entry.name} source size changed`);
  }
  return size;
};

const writeAll = async (handle: fs.promises.FileHandle, bytes: Buffer, position: number): Promise<number> => {
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, position + written);
    if (result.bytesWritten === 0) throw new Error(`Short write at offset ${position + written}`);
    written += result.bytesWritten;
  }
  return position + written;
};

const copyPayload = async (
  entry: RawPackWriteEntry,
  output: fs.promises.FileHandle,
  writePosition: number,
): Promise<number> => {
  if (entry.buffer) return writeAll(output, entry.buffer, writePosition);
  const source = entry.source!;
  const input = await fs.promises.open(source.path, "r");
  try {
    const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, source.file_size));
    let copied = 0;
    while (copied < source.file_size) {
      const wanted = Math.min(chunk.length, source.file_size - copied);
      const result = await input.read(chunk, 0, wanted, source.start_pos + copied);
      if (result.bytesRead !== wanted) {
        throw new Error(`Short read copying ${entry.name} from ${source.path} at ${source.start_pos + copied}`);
      }
      writePosition = await writeAll(output, chunk.subarray(0, wanted), writePosition);
      copied += wanted;
    }
    return writePosition;
  } finally {
    await input.close();
  }
};

/** Writes raw entries without decoding or recompressing existing payloads. */
export const writeRawPack = async (
  outputPath: string,
  entries: readonly RawPackWriteEntry[],
  metadata: RawPackWriteMetadata,
): Promise<void> => {
  const headerSignature = Buffer.from(packGameToHeader[metadata.game], "ascii");
  const byteMask = metadata.packType ? (metadata.packType === "movie" ? 4 : 3) : metadata.byteMask;
  const hasCompressionFlag = packGameSupportsCompression[metadata.game];
  const hasFileNameHash = (byteMask & PFH_FILENAME_HASH_MASK) !== 0;
  if ((byteMask & ~0x47) !== 0) {
    throw new Error(`Unsupported PFH byteMask metadata 0x${byteMask.toString(16)}`);
  }
  const headerBuffer = metadata.headerBuffer;
  if (headerBuffer.length !== PFH_HEADER_BUFFER_SIZE) {
    throw new Error(`PFH header buffer must be ${PFH_HEADER_BUFFER_SIZE} bytes`);
  }
  if (!Number.isInteger(metadata.refFileCount) || metadata.refFileCount < 0) {
    throw new Error(`Invalid reference count ${metadata.refFileCount}`);
  }
  if (metadata.refFileCount > 0x7fffffff) throw new Error(`Invalid reference count ${metadata.refFileCount}`);
  if (entries.length > 0x7fffffff) throw new Error("Too many packed files");

  const sizes = entries.map((entry) => validateWriteEntry(entry, hasFileNameHash));
  if (!hasCompressionFlag && entries.some((entry) => entry.is_compressed)) {
    throw new Error(`Game ${metadata.game} does not support compressed index entries`);
  }
  const indexParts: Buffer[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const item = Buffer.allocUnsafe(4 + (hasFileNameHash ? 4 : 0) + (hasCompressionFlag ? 1 : 0));
    let position = 0;
    item.writeInt32LE(sizes[i], position);
    position += 4;
    if (hasFileNameHash) {
      item.writeUInt32LE(entry.file_name_hash!, position);
      position += 4;
    }
    if (hasCompressionFlag) item.writeUInt8(entry.is_compressed ? 1 : 0, position);
    indexParts.push(item, Buffer.from(entry.name, "utf8"), Buffer.from([0]));
  }
  const fileIndexSize = indexParts.reduce((total, part) => total + part.length, 0);
  if (fileIndexSize > 0x7fffffff) throw new Error("Packed-file index is too large");

  const dependencyBytes = metadata.dependencyBytes ?? createDependencyBytes(metadata.dependencies);
  if (dependencyBytes.length > 0x7fffffff) throw new Error("Dependency index is too large");
  const header = Buffer.alloc(PFH_HEADER_SIZE);
  headerSignature.copy(header, 0);
  header.writeInt32LE(byteMask, 4);
  header.writeInt32LE(metadata.refFileCount, 8);
  header.writeInt32LE(dependencyBytes.length, 12);
  header.writeInt32LE(entries.length, 16);
  header.writeInt32LE(fileIndexSize, 20);
  headerBuffer.copy(header, 24);

  const file = await fs.promises.open(outputPath, "w");
  try {
    let position = await writeAll(file, header, 0);
    position = await writeAll(file, dependencyBytes, position);
    for (const part of indexParts) position = await writeAll(file, part, position);
    for (const entry of entries) position = await copyPayload(entry, file, position);
    if (metadata.trailingBytes) position = await writeAll(file, metadata.trailingBytes, position);
    await file.truncate(position);
    await file.sync();
  } finally {
    await file.close();
  }
};

export const packEntryAsSource = (pack: CorePack, entry: CorePackEntry): RawPackWriteEntry => ({
  name: entry.name,
  is_compressed: entry.is_compressed,
  file_name_hash: entry.file_name_hash,
  source: { path: pack.path, start_pos: entry.start_pos, file_size: entry.file_size },
});

export const packWriteMetadata = (pack: CorePack): RawPackWriteMetadata => ({
  game: pack.game,
  byteMask: pack.header.byteMask,
  refFileCount: pack.header.refFileCount,
  headerBuffer: pack.header.headerBuffer,
  dependencies: pack.dependencies,
  dependencyBytes: pack.dependencyBytes,
  trailingBytes: pack.trailingBytes,
});

export const rewritePackFromIndex = async (
  outputPath: string,
  pack: CorePack,
  additions: readonly RawPackWriteEntry[],
  options: {
    replaceDuplicates?: boolean;
    removedFileNames?: readonly string[];
    dependencyPacks?: readonly string[];
    packType?: "mod" | "movie";
  } = {},
): Promise<void> => {
  const newKeys = new Set(additions.map((entry) => normalizePackFilePathKey(entry.name)));
  const removedKeys = new Set((options.removedFileNames ?? []).map(normalizePackFilePathKey));
  const shouldRemove = options.replaceDuplicates === true || removedKeys.size > 0;
  const retained = pack.entries.filter((entry) => {
    if (!shouldRemove) return true;
    const key = normalizePackFilePathKey(entry.name);
    return !newKeys.has(key) && !removedKeys.has(key);
  });
  const dependencyPacks =
    options.dependencyPacks && options.dependencyPacks.length > 0 ? options.dependencyPacks : pack.dependencies;
  const preserveDependencyBytes = dependencyPacks === pack.dependencies;
  const metadata: RawPackWriteMetadata = {
    ...packWriteMetadata(pack),
    dependencies: dependencyPacks,
    ...(options.packType === undefined ? {} : { packType: options.packType }),
  };
  if (!preserveDependencyBytes) delete metadata.dependencyBytes;

  const entries = [...retained.map((entry) => packEntryAsSource(pack, entry)), ...additions];
  await writeRawPack(outputPath, entries, metadata);
};
