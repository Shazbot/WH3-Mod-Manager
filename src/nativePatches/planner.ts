import * as crypto from "crypto";
import * as fs from "fs";
import * as nodePath from "path";
import * as semver from "semver";
import { decompress as decompressZstd } from "@mongodb-js/zstd";
import * as zlib from "zlib";
import type { Pack, PackedFile } from "../packFileTypes";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import {
  MAX_BLOCK_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_TOTAL_MANIFEST_BYTES,
  MAX_NATIVE_PATCH_PACKAGES,
  MAX_TOTAL_PAYLOAD_BYTES,
  NativePatchManifest,
  NativePatchSkippedPackage,
  parseAndValidateNativePatchManifest,
} from "./manifest";
import type { NativePatchIdentity } from "./manifest";
import { parseJsonWithoutDuplicateKeys } from "./json";
import { NativePatchPackageError, nativePatchIdentity, skipFailedNativePatches } from "./failurePolicy";
import {
  MAX_NATIVE_PATCH_FLOW_CONTRIBUTION_BYTES,
  MAX_NATIVE_PATCH_FLOW_INPUT_BYTES,
  MAX_NATIVE_PATCH_FLOW_INPUT_ROWS,
  NativePatchFlowContribution,
  nativePatchFlowCanonicalValue,
  parseNativePatchFlowContribution,
} from "./flowTemplate";

export type NativePatchPack = {
  path: string;
  pack: Pick<Pack, "path" | "packedFiles">;
  priority: number;
  displayName?: string;
};

export type NativePatchPreparedPackage = {
  manifestPath: string;
  sourcePackPath: string;
  sourceModName?: string;
  sourcePackPaths?: string[];
  contentHash: string;
  manifest: NativePatchManifest;
  blocks: Array<{
    id: string;
    size: number;
    alignment: number;
    protection: "rx" | "r" | "rw";
    bytesBase64: string;
  }>;
};

export type NativePatchLaunchPlan = {
  protocol: 1;
  runId: string;
  targetPath: string;
  targetSha256?: string;
  packages: NativePatchPreparedPackage[];
};

type Candidate = {
  pack: NativePatchPack;
  manifestPath: string;
  manifestEntry: PackedFile;
  manifest: NativePatchManifest;
  rawManifest: Buffer;
  validationError?: string;
  flowTemplateFingerprint?: string;
  flowTemplateVersion?: string;
  flowProviderNames?: string[];
  flowSourcePackPaths?: string[];
  flowResolvedParameterValues?: Record<string, unknown>;
  flowPayloadsByPath?: Map<string, Buffer>;
};

const sha256 = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const ordinalCompare = (first: string, second: string) => (first < second ? -1 : first > second ? 1 : 0);
const canonicalPackName = (name: string) => name.replace(/\\/g, "/").replace(/^\/+/, "");
const normalizedVirtualPath = (name: string) => nodePath.posix.normalize(canonicalPackName(name)).toLowerCase();
const exactEntries = (pack: NativePatchPack, virtualPath: string): PackedFile[] => {
  const pathKey = normalizePackFilePathKey(virtualPath);
  return pack.pack.packedFiles.filter((file) => normalizePackFilePathKey(file.name) === pathKey);
};

const collectFrameOffsets = (bytes: Buffer, magic: Buffer) => {
  const result = new Set<number>();
  if (bytes.subarray(0, 4).equals(magic)) result.add(0);
  if (bytes.length >= 8 && bytes.subarray(4, 8).equals(magic)) result.add(4);
  for (let index = 0; index <= Math.min(32, bytes.length - 4); index++) {
    if (bytes.subarray(index, index + 4).equals(magic)) result.add(index);
  }
  return [...result];
};

const zstdDeclaredFrameSize = (bytes: Buffer, offset: number): number => {
  if (offset + 5 > bytes.length) throw new Error("truncated Zstandard frame header");
  const descriptor = bytes[offset + 4];
  const contentSizeFlag = descriptor >> 6;
  const singleSegment = (descriptor & 0x20) !== 0;
  const dictionarySize = [0, 1, 2, 4][descriptor & 3];
  const cursor = offset + 5 + (singleSegment ? 0 : 1) + dictionarySize;
  const contentSizeLength =
    contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : contentSizeFlag === 1 ? 2 : contentSizeFlag === 2 ? 4 : 8;
  if (contentSizeLength === 0) throw new Error("Zstandard frame omits its content size; refusing an unbounded decode");
  if (cursor + contentSizeLength > bytes.length) throw new Error("truncated Zstandard frame content-size field");
  let size = 0n;
  for (let i = contentSizeLength - 1; i >= 0; i--) size = (size << 8n) | BigInt(bytes[cursor + i]);
  if (contentSizeLength === 2) size += 256n;
  if (size > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Zstandard frame content size exceeds the safe integer range");
  return Number(size);
};

const xxhash32 = (bytes: Buffer, start: number, end: number): number => {
  const p1 = 0x9e3779b1;
  const p2 = 0x85ebca77;
  const p3 = 0xc2b2ae3d;
  const p4 = 0x27d4eb2f;
  const p5 = 0x165667b1;
  const rotl = (value: number, count: number) => (value << count) | (value >>> (32 - count));
  const round = (accumulator: number, input: number) =>
    Math.imul(rotl((accumulator + Math.imul(input, p2)) >>> 0, 13), p1) >>> 0;
  let cursor = start;
  let hash: number;
  if (end - start >= 16) {
    let v1 = (p1 + p2) >>> 0;
    let v2 = p2;
    let v3 = 0;
    let v4 = -p1 >>> 0;
    const limit = end - 16;
    do {
      v1 = round(v1, bytes.readUInt32LE(cursor));
      v2 = round(v2, bytes.readUInt32LE(cursor + 4));
      v3 = round(v3, bytes.readUInt32LE(cursor + 8));
      v4 = round(v4, bytes.readUInt32LE(cursor + 12));
      cursor += 16;
    } while (cursor <= limit);
    hash = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else hash = p5;
  hash = (hash + (end - start)) >>> 0;
  while (cursor + 4 <= end) {
    hash = Math.imul(rotl((hash + Math.imul(bytes.readUInt32LE(cursor), p3)) >>> 0, 17), p4) >>> 0;
    cursor += 4;
  }
  while (cursor < end) {
    hash = Math.imul(rotl((hash + Math.imul(bytes[cursor++], p5)) >>> 0, 11), p1) >>> 0;
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, p2) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, p3) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
};

const decompressLz4Block = (
  compressed: Buffer,
  output: Buffer,
  initialLength: number,
  maxLength: number,
  dictionaryStart: number,
): number => {
  let input = 0;
  let written = initialLength;
  while (input < compressed.length) {
    const token = compressed[input++];
    let literalLength = token >>> 4;
    if (literalLength === 15) {
      let extension = 255;
      while (extension === 255) {
        if (input >= compressed.length) throw new Error("truncated LZ4 literal length");
        extension = compressed[input++];
        literalLength += extension;
      }
    }
    if (input + literalLength > compressed.length || written + literalLength > maxLength) {
      throw new Error("LZ4 literals exceed the encoded input or output limit");
    }
    compressed.copy(output, written, input, input + literalLength);
    input += literalLength;
    written += literalLength;
    if (input === compressed.length) break;
    if (input + 2 > compressed.length) throw new Error("truncated LZ4 match offset");
    const distance = compressed.readUInt16LE(input);
    input += 2;
    if (distance === 0 || distance > written - dictionaryStart) throw new Error("invalid LZ4 match offset");
    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      let extension = 255;
      while (extension === 255) {
        if (input >= compressed.length) throw new Error("truncated LZ4 match length");
        extension = compressed[input++];
        matchLength += extension;
      }
    }
    matchLength += 4;
    if (written + matchLength > maxLength) throw new Error("LZ4 match exceeds the decoded output limit");
    let source = written - distance;
    for (let index = 0; index < matchLength; index++) output[written++] = output[source++];
  }
  if (input !== compressed.length) throw new Error("LZ4 block has trailing bytes");
  return written;
};

const decompressLz4FrameBounded = (bytes: Buffer, offset: number, maxOutputBytes: number): Buffer => {
  let cursor = offset;
  if (cursor + 7 > bytes.length || bytes.readUInt32LE(cursor) !== 0x184d2204)
    throw new Error("truncated LZ4 frame header");
  cursor += 4;
  const descriptorStart = cursor;
  const flags = bytes[cursor++];
  const blockDescriptor = bytes[cursor++];
  if (flags >>> 6 !== 1 || (flags & 0x02) !== 0 || (blockDescriptor & 0x8f) !== 0)
    throw new Error("unsupported or invalid LZ4 frame descriptor");
  const blockMaxCode = (blockDescriptor >>> 4) & 7;
  const blockMaxSize = [0, 0, 0, 0, 64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024][blockMaxCode];
  if (blockMaxSize === 0) throw new Error("invalid LZ4 maximum block size");
  const independentBlocks = (flags & 0x20) !== 0;
  const blockChecksum = (flags & 0x10) !== 0;
  const hasContentSize = (flags & 0x08) !== 0;
  const contentChecksum = (flags & 0x04) !== 0;
  let declaredSize: number | undefined;
  if (hasContentSize) {
    if (cursor + 8 > bytes.length) throw new Error("truncated LZ4 content size");
    const size = bytes.readBigUInt64LE(cursor);
    if (size > BigInt(Number.MAX_SAFE_INTEGER) || size > BigInt(maxOutputBytes))
      throw new Error("LZ4 content size exceeds the decoded output limit");
    declaredSize = Number(size);
    cursor += 8;
  }
  if ((flags & 0x01) !== 0) {
    if (cursor + 4 > bytes.length) throw new Error("truncated LZ4 dictionary ID");
    throw new Error("LZ4 dictionary frames are not supported");
  }
  if (cursor >= bytes.length) throw new Error("truncated LZ4 header checksum");
  const expectedHeaderChecksum = (xxhash32(bytes, descriptorStart, cursor) >>> 8) & 0xff;
  if (bytes[cursor++] !== expectedHeaderChecksum) throw new Error("LZ4 header checksum mismatch");

  let output = Buffer.alloc(Math.min(Math.max(declaredSize ?? 64 * 1024, 1), Math.max(maxOutputBytes, 1)));
  let outputLength = 0;
  const ensureOutput = (required: number) => {
    if (required > maxOutputBytes) throw new Error(`LZ4 frame exceeds the ${maxOutputBytes}-byte output limit`);
    if (required <= output.length) return;
    let nextSize = Math.max(output.length, 1);
    while (nextSize < required) nextSize = Math.min(maxOutputBytes, Math.max(required, nextSize * 2));
    const next = Buffer.alloc(nextSize);
    output.copy(next, 0, 0, outputLength);
    output = next;
  };
  for (;;) {
    if (cursor + 4 > bytes.length) throw new Error("truncated LZ4 block header");
    const blockHeader = bytes.readUInt32LE(cursor);
    cursor += 4;
    if (blockHeader === 0) break;
    const uncompressed = (blockHeader & 0x80000000) !== 0;
    const blockSize = blockHeader & 0x7fffffff;
    if (blockSize === 0 || blockSize > blockMaxSize || cursor + blockSize > bytes.length)
      throw new Error("invalid or truncated LZ4 block");
    const blockStart = cursor;
    const blockEnd = blockStart + blockSize;
    const priorDictionaryStart = independentBlocks ? outputLength : Math.max(0, outputLength - 64 * 1024);
    if (uncompressed) {
      ensureOutput(outputLength + blockSize);
      bytes.copy(output, outputLength, blockStart, blockEnd);
      outputLength += blockSize;
    } else {
      // Reserve the declared frame bound, or the largest representable frame, before block decode.
      const blockCeiling = Math.min(maxOutputBytes, outputLength + blockMaxSize);
      ensureOutput(blockCeiling);
      outputLength = decompressLz4Block(
        bytes.subarray(blockStart, blockEnd),
        output,
        outputLength,
        blockCeiling,
        priorDictionaryStart,
      );
    }
    cursor = blockEnd;
    if (blockChecksum) {
      if (cursor + 4 > bytes.length) throw new Error("truncated LZ4 block checksum");
      if (bytes.readUInt32LE(cursor) !== xxhash32(bytes, blockStart, blockEnd))
        throw new Error("LZ4 block checksum mismatch");
      cursor += 4;
    }
  }
  if (contentChecksum) {
    if (cursor + 4 > bytes.length) throw new Error("truncated LZ4 content checksum");
    if (bytes.readUInt32LE(cursor) !== xxhash32(output, 0, outputLength))
      throw new Error("LZ4 content checksum mismatch");
    cursor += 4;
  }
  if (declaredSize !== undefined && outputLength !== declaredSize)
    throw new Error(`LZ4 decoded ${outputLength} bytes, expected ${declaredSize}`);
  return output.subarray(0, outputLength);
};

/** Decodes packed bytes with enforced output limits, including unknown-size LZ4 frames. */
const decompressNativePatchPayload = async (
  bytes: Buffer,
  maxOutputBytes: number,
  context: string,
): Promise<Buffer> => {
  const errors: string[] = [];
  for (const offset of collectFrameOffsets(bytes, Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    try {
      const declaredSize = zstdDeclaredFrameSize(bytes, offset);
      if (declaredSize > maxOutputBytes) throw new Error(`declared size ${declaredSize} exceeds ${maxOutputBytes}`);
      const output = Buffer.from(await decompressZstd(bytes.subarray(offset)));
      if (output.length > maxOutputBytes || output.length !== declaredSize) {
        throw new Error(`decoded size ${output.length} disagrees with declared size ${declaredSize}`);
      }
      return output;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const offset of collectFrameOffsets(bytes, Buffer.from([0x04, 0x22, 0x4d, 0x18]))) {
    try {
      return decompressLz4FrameBounded(bytes, offset, maxOutputBytes);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const offset of [4, 0, 8, 12, 16]) {
    if (offset >= bytes.length) continue;
    for (const inflate of [zlib.inflateRawSync, zlib.inflateSync]) {
      try {
        const output = inflate(bytes.subarray(offset), { maxOutputLength: maxOutputBytes });
        if (output.length > maxOutputBytes) throw new Error(`decoded size exceeds ${maxOutputBytes}`);
        return Buffer.from(output);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  const representativeErrors = [...errors.slice(0, 3), ...errors.slice(-3)];
  throw new Error(
    `failed to decode packed payload ${context} within ${maxOutputBytes} bytes: ${representativeErrors.join("; ")}`,
  );
};

/** Reads one indexed entry and treats short reads/decompression errors as fatal. */
export const readNativePatchPackEntry = async (
  pack: NativePatchPack,
  entry: PackedFile,
  maxDecodedBytes = MAX_TOTAL_PAYLOAD_BYTES,
  expectedDecodedBytes?: number,
): Promise<Buffer> => {
  const fd = fs.openSync(pack.path, "r");
  try {
    if (
      !Number.isSafeInteger(entry.file_size) ||
      entry.file_size < 0 ||
      !Number.isSafeInteger(entry.start_pos) ||
      entry.start_pos < 0
    ) {
      throw new Error(`invalid index range for ${entry.name} in ${pack.path}`);
    }
    const maxStoredBytes = Math.min(MAX_TOTAL_PAYLOAD_BYTES + 1024 * 1024, maxDecodedBytes + 1024 * 1024);
    if (entry.file_size > maxStoredBytes) {
      throw new Error(`stored payload ${entry.name} exceeds the bounded read limit (${entry.file_size} bytes)`);
    }
    const stats = fs.fstatSync(fd);
    if (entry.start_pos + entry.file_size > stats.size)
      throw new Error(`index range for ${entry.name} extends beyond ${pack.path}`);
    if (!entry.is_compressed && entry.file_size > maxDecodedBytes) {
      throw new Error(`uncompressed payload ${entry.name} exceeds the ${maxDecodedBytes}-byte limit`);
    }
    const bytes = Buffer.alloc(entry.file_size);
    const read = fs.readSync(fd, bytes, 0, bytes.length, entry.start_pos);
    if (read !== bytes.length) throw new Error(`short read for ${entry.name} in ${pack.path}: ${read}/${bytes.length}`);
    const decoded = entry.is_compressed
      ? await decompressNativePatchPayload(bytes, maxDecodedBytes, `${pack.path}:${entry.name}`)
      : bytes;
    if (expectedDecodedBytes !== undefined && decoded.length !== expectedDecodedBytes) {
      throw new Error(`payload ${entry.name} has ${decoded.length} decoded bytes, expected ${expectedDecodedBytes}`);
    }
    return decoded;
  } finally {
    fs.closeSync(fd);
  }
};

const resolvePayloadPath = (manifestPath: string, relativePath: string) => {
  const parent = nodePath.posix.dirname(manifestPath);
  const result = nodePath.posix.normalize(nodePath.posix.join(parent, relativePath));
  if (result === ".." || result.startsWith("../") || result.startsWith("/")) {
    throw new Error(`payload path escapes its manifest directory: ${relativePath}`);
  }
  return result;
};

const decodeBase64Strict = (value: string, where: string): Buffer => {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${where}: invalid RFC 4648 Base64 encoding`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(`${where}: Base64 is not canonically padded`);
  return decoded;
};

const resolveBlockBytes = async (
  candidate: Candidate,
  block: Record<string, any>,
  pack: NativePatchPack,
): Promise<Buffer> => {
  const source = block.source as Record<string, unknown>;
  let result: Buffer;
  if ("file" in source) {
    const virtualPath = resolvePayloadPath(candidate.manifestPath, String(source.file));
    const embedded = candidate.flowPayloadsByPath?.get(String(source.file).replace(/\\/g, "/").toLowerCase());
    if (embedded) {
      if (embedded.length !== block.size || sha256(embedded) !== String(source.sha256).toLowerCase()) {
        throw new Error(`${candidate.manifest.package.id}: embedded contribution payload mismatch for ${virtualPath}`);
      }
      return Buffer.from(embedded);
    }
    const entries = exactEntries(pack, virtualPath);
    if (entries.length !== 1) {
      throw new Error(
        `${candidate.manifest.package.id}: payload ${virtualPath} in ${pack.path} must resolve to exactly one pack entry (found ${entries.length})`,
      );
    }
    result = await readNativePatchPackEntry(pack, entries[0], block.size, block.size);
    if (sha256(result) !== String(source.sha256).toLowerCase()) {
      throw new Error(`${candidate.manifest.package.id}: payload hash mismatch for ${virtualPath}`);
    }
  } else if ("base64" in source) {
    result = decodeBase64Strict(String(source.base64), `${candidate.manifest.package.id}.${block.id}`);
    if (sha256(result) !== String(source.sha256).toLowerCase()) {
      throw new Error(`${candidate.manifest.package.id}: Base64 payload hash mismatch for block ${block.id}`);
    }
  } else if ("hex" in source) {
    result = Buffer.from(String(source.hex), "hex");
    if (source.sha256 && sha256(result) !== String(source.sha256).toLowerCase()) {
      throw new Error(`${candidate.manifest.package.id}: hex payload hash mismatch for block ${block.id}`);
    }
  } else {
    result = Buffer.alloc(block.size);
  }
  if (result.length !== block.size) {
    throw new Error(
      `${candidate.manifest.package.id}: block ${block.id} has ${result.length} bytes, expected ${block.size}`,
    );
  }
  return result;
};

const validateReferenceSymbols = (manifest: NativePatchManifest) => {
  const blocks = new Map<string, Record<string, any>>(manifest.blocks.map((block) => [block.id, block]));
  const signatures = new Set((manifest.signatures ?? []).map((signature) => signature.id));
  const symbols = manifest.symbols;
  const active = new Set<string>();
  const complete = new Set<string>();
  const checkRef = (reference: Record<string, any>, where: string, depth: number) => {
    if (depth > 64) throw new Error(`${where}: address reference nesting is too deep`);
    if ("block" in reference) {
      const block = blocks.get(reference.block);
      if (!block) throw new Error(`${where}: unknown block '${reference.block}'`);
      if (reference.offset > block.size) throw new Error(`${where}: block offset exceeds '${reference.block}' size`);
    } else if ("symbol" in reference) visitSymbol(reference.symbol);
    else if ("signature" in reference) {
      if (!signatures.has(reference.signature)) throw new Error(`${where}: unknown signature '${reference.signature}'`);
    } else if ("relative" in reference) checkRef(reference.relative.from, `${where}.relative.from`, depth + 1);
  };
  const visitSymbol = (name: string) => {
    if (!(name in symbols)) throw new Error(`symbols: unknown symbol '${name}'`);
    if (active.has(name)) throw new Error(`symbols: cycle detected at '${name}'`);
    if (complete.has(name)) return;
    active.add(name);
    checkRef(symbols[name], `symbols.${name}`, 0);
    active.delete(name);
    complete.add(name);
  };
  for (const name of Object.keys(symbols)) visitSymbol(name);
  const allReferences: Array<[string, Record<string, any>]> = [];
  for (const [kind, items] of [
    ["guards", manifest.guards],
    ["writes", manifest.writes],
  ] as const) {
    for (let index = 0; index < items.length; index++) allReferences.push([`${kind}[${index}]`, items[index].at]);
  }
  for (let index = 0; index < manifest.runtime_functions.length; index++) {
    const item = manifest.runtime_functions[index];
    for (const reference of [item.begin, item.end, item.unwind])
      allReferences.push([`runtime_functions[${index}]`, reference]);
  }
  for (let index = 0; index < manifest.fixups.length; index++) {
    const fixup = manifest.fixups[index];
    allReferences.push([`fixups[${index}].target`, fixup.target]);
    if (fixup.relative_to && !("write" in fixup.relative_to))
      allReferences.push([`fixups[${index}].relative_to`, fixup.relative_to]);
    if (fixup.base) allReferences.push([`fixups[${index}].base`, fixup.base]);
  }
  for (const [where, reference] of allReferences) checkRef(reference, where, 0);
  for (let index = 0; index < manifest.parameters.length; index++) {
    const parameter = manifest.parameters[index];
    const checkDestination = (field: Record<string, any>, length: number, fieldName: string) => {
      const block = blocks.get(field.block);
      if (!block) throw new Error(`parameters[${index}].${fieldName}: unknown block '${field.block}'`);
      if (field.offset + length > block.size)
        throw new Error(`parameters[${index}].${fieldName}: destination exceeds block size`);
    };
    if (parameter.type === "ascii_key_list") {
      checkDestination(parameter.count_at, 4, "count_at");
      checkDestination(parameter.entries_at, parameter.capacity * (parameter.max_key_bytes + 1), "entries_at");
    } else if (parameter.type === "table") {
      const rowBytes = parameter.columns.reduce(
        (total: number, column: Record<string, any>) => total + (column.type === "ascii" ? column.max_bytes + 1 : 4),
        0,
      );
      checkDestination(parameter.count_at, 4, "count_at");
      checkDestination(parameter.entries_at, parameter.capacity * rowBytes, "entries_at");
    } else {
      const length = parameter.type === "bool" ? 1 : 4;
      checkDestination(parameter.at, length, "at");
    }
  }
};

const validateFixupAndParameterFields = (manifest: NativePatchManifest) => {
  const blockById = new Map(manifest.blocks.map((block) => [block.id, block]));
  const writeById = new Map(manifest.writes.map((write: any) => [write.id, write]));
  const widthForKind = (kind: string) => (kind === "rel8" ? 1 : kind === "abs64" ? 8 : 4);
  const occupied = new Map<string, Array<{ start: number; end: number; owner: string }>>();
  const reserve = (key: string, start: number, length: number, owner: string) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length <= 0)
      throw new Error(`${owner}: invalid field range`);
    const ranges = occupied.get(key) ?? [];
    const end = start + length;
    if (!Number.isSafeInteger(end)) throw new Error(`${owner}: field arithmetic overflow`);
    if (ranges.some((range) => start < range.end && range.start < end))
      throw new Error(`${owner}: overlaps ${ranges.find((range) => start < range.end && range.start < end)?.owner}`);
    ranges.push({ start, end, owner });
    occupied.set(key, ranges);
  };
  for (let index = 0; index < manifest.fixups.length; index++) {
    const fixup = manifest.fixups[index];
    const at = fixup.at;
    const size = widthForKind(fixup.kind);
    if ("block" in at) {
      const block = blockById.get(at.block);
      if (!block || at.offset + size > block.size) throw new Error(`fixups[${index}].at exceeds its block`);
      reserve(`block:${at.block}`, at.offset, size, `fixups[${index}]`);
    } else {
      const write = writeById.get(at.write) as any;
      if (!write) throw new Error(`fixups[${index}].at references unknown write '${at.write}'`);
      const bytes = Buffer.from(write.bytes, "hex");
      if (at.offset + size > bytes.length) throw new Error(`fixups[${index}].at exceeds write '${at.write}'`);
      reserve(`write:${at.write}`, at.offset, size, `fixups[${index}]`);
    }
    if (fixup.relative_to && "write" in fixup.relative_to) {
      const anchorWrite = writeById.get(fixup.relative_to.write) as any;
      if (!anchorWrite)
        throw new Error(`fixups[${index}].relative_to references unknown write '${fixup.relative_to.write}'`);
      const anchorLength = Buffer.from(anchorWrite.bytes, "hex").length;
      if (fixup.relative_to.offset > anchorLength)
        throw new Error(`fixups[${index}].relative_to exceeds write '${fixup.relative_to.write}'`);
    }
  }
  for (let index = 0; index < manifest.parameters.length; index++) {
    const parameter = manifest.parameters[index];
    const fields: Array<[Record<string, any>, number, string]> = [];
    if (parameter.type === "ascii_key_list") {
      fields.push([parameter.count_at, 4, "count_at"]);
      fields.push([parameter.entries_at, parameter.capacity * (parameter.max_key_bytes + 1), "entries_at"]);
    } else if (parameter.type === "table") {
      const rowBytes = parameter.columns.reduce(
        (total: number, column: Record<string, any>) => total + (column.type === "ascii" ? column.max_bytes + 1 : 4),
        0,
      );
      fields.push([parameter.count_at, 4, "count_at"]);
      fields.push([parameter.entries_at, parameter.capacity * rowBytes, "entries_at"]);
    } else fields.push([parameter.at, parameter.type === "bool" ? 1 : 4, "at"]);
    for (const [field, size, fieldName] of fields) {
      const block = blockById.get(field.block);
      if (!block || field.offset + size > block.size)
        throw new Error(`parameters[${index}].${fieldName} exceeds its block`);
      reserve(`block:${field.block}`, field.offset, size, `parameters[${index}].${fieldName}`);
    }
  }
};

const materializeParameters = (
  manifest: NativePatchManifest,
  blockBytes: Map<string, Buffer>,
  overrides: Record<string, unknown> = {},
) => {
  for (const parameter of manifest.parameters) {
    const value = Object.prototype.hasOwnProperty.call(overrides, parameter.id)
      ? overrides[parameter.id]
      : parameter.default;
    if (parameter.type === "bool") {
      blockBytes.get(parameter.at.block)!.writeUInt8(value ? 1 : 0, parameter.at.offset);
    } else if (parameter.type === "u32") {
      blockBytes.get(parameter.at.block)!.writeUInt32LE(value as number, parameter.at.offset);
    } else if (parameter.type === "i32") {
      blockBytes.get(parameter.at.block)!.writeInt32LE(value as number, parameter.at.offset);
    } else if (parameter.type === "f32") {
      blockBytes.get(parameter.at.block)!.writeFloatLE(value as number, parameter.at.offset);
    } else if (parameter.type === "ascii_key_list") {
      const countBlock = blockBytes.get(parameter.count_at.block)!;
      const entriesBlock = blockBytes.get(parameter.entries_at.block)!;
      const keys = [...new Set(value as string[])];
      countBlock.writeUInt32LE(keys.length, parameter.count_at.offset);
      const slotSize = parameter.max_key_bytes + 1;
      entriesBlock.fill(0, parameter.entries_at.offset, parameter.entries_at.offset + parameter.capacity * slotSize);
      keys.forEach((key, index) => {
        Buffer.from(key, "ascii").copy(entriesBlock, parameter.entries_at.offset + index * slotSize);
      });
    } else if (parameter.type === "table") {
      const rows = (value ?? []) as Array<Record<string, unknown>>;
      if (rows.length > parameter.capacity) throw new Error(`parameter '${parameter.id}' exceeds table capacity`);
      const countBlock = blockBytes.get(parameter.count_at.block)!;
      const entriesBlock = blockBytes.get(parameter.entries_at.block)!;
      const rowBytes = parameter.columns.reduce(
        (total: number, column: Record<string, any>) => total + (column.type === "ascii" ? column.max_bytes + 1 : 4),
        0,
      );
      const entriesBytes = parameter.capacity * rowBytes;
      entriesBlock.fill(0, parameter.entries_at.offset, parameter.entries_at.offset + entriesBytes);
      countBlock.writeUInt32LE(rows.length, parameter.count_at.offset);
      rows.forEach((row, rowIndex) => {
        let offset = parameter.entries_at.offset + rowIndex * rowBytes;
        for (const column of parameter.columns) {
          const cell = row[column.name];
          if (column.type === "ascii") {
            Buffer.from(cell as string, "ascii").copy(entriesBlock, offset);
            offset += column.max_bytes + 1;
          } else if (column.type === "bool") {
            // Table cells use a 4-byte stride; the three bytes after bool are zero padding.
            entriesBlock.writeUInt8(cell ? 1 : 0, offset);
            offset += 4;
          } else if (column.type === "u32") {
            entriesBlock.writeUInt32LE(cell as number, offset);
            offset += 4;
          } else if (column.type === "i32") {
            entriesBlock.writeInt32LE(cell as number, offset);
            offset += 4;
          } else {
            entriesBlock.writeFloatLE(cell as number, offset);
            offset += 4;
          }
        }
      });
    }
  }
};

const loadCandidatePayloads = async (candidate: Candidate): Promise<NativePatchPreparedPackage> => {
  validateReferenceSymbols(candidate.manifest);
  validateFixupAndParameterFields(candidate.manifest);
  let totalBytes = 0;
  const blocks = [];
  const decodedBlockBytes = new Map<string, Buffer>();
  for (const block of candidate.manifest.blocks) {
    totalBytes += block.size;
    if (totalBytes > MAX_TOTAL_PAYLOAD_BYTES)
      throw new Error("selected native patch payloads exceed the 512 MiB total limit");
    const bytes = await resolveBlockBytes(candidate, block, candidate.pack);
    decodedBlockBytes.set(block.id, bytes);
  }
  materializeParameters(candidate.manifest, decodedBlockBytes, candidate.flowResolvedParameterValues);
  for (const block of candidate.manifest.blocks) {
    const bytes = decodedBlockBytes.get(block.id)!;
    blocks.push({
      id: block.id,
      size: block.size,
      alignment: block.alignment,
      protection: block.protection,
      bytesBase64: bytes.toString("base64"),
    });
  }
  return {
    manifestPath: candidate.manifestPath,
    sourcePackPath: candidate.pack.path,
    sourcePackPaths: candidate.flowSourcePackPaths,
    sourceModName: candidate.pack.displayName,
    contentHash: sha256(candidate.rawManifest),
    manifest: candidate.manifest,
    blocks,
  };
};

const resolvePackageCandidates = async (
  packs: NativePatchPack[],
  onSkippedPackage?: (notice: NativePatchSkippedPackage) => void,
): Promise<Candidate[]> => {
  const candidates: Candidate[] = [];
  let totalManifestBytes = 0;
  for (const pack of packs) {
    const patchEntries = pack.pack.packedFiles.filter((entry) => {
      const name = canonicalPackName(entry.name);
      return /^whmm_patches\//i.test(name) && name.toLowerCase().endsWith(".wh3patch.json");
    });
    const normalizedNames = new Set<string>();
    for (const entry of patchEntries) {
      const nameKey = normalizedVirtualPath(entry.name);
      if (normalizedNames.has(nameKey))
        throw new Error(`duplicate normalized native patch filename '${entry.name}' in ${pack.path}`);
      normalizedNames.add(nameKey);
    }
    for (const entry of patchEntries) {
      const rawName = entry.name.replace(/\\/g, "/");
      const components = rawName.split("/");
      if (
        /^[A-Za-z]:/.test(rawName) ||
        rawName.startsWith("/") ||
        rawName.startsWith("\\") ||
        components.some((part) => part === ".." || part === "")
      ) {
        throw new Error(`invalid native patch virtual path '${entry.name}' in ${pack.path}`);
      }
      const manifestPath = nodePath.posix.normalize(rawName);
      const remainingManifestBudget = MAX_TOTAL_MANIFEST_BYTES - totalManifestBytes;
      if (remainingManifestBudget <= 0)
        throw new Error(`native patch manifests exceed the ${MAX_TOTAL_MANIFEST_BYTES}-byte aggregate limit`);
      const rawManifest = await readNativePatchPackEntry(
        pack,
        entry,
        Math.min(MAX_MANIFEST_BYTES, remainingManifestBudget),
      );
      totalManifestBytes += rawManifest.length;
      if (totalManifestBytes > MAX_TOTAL_MANIFEST_BYTES) {
        throw new Error(`native patch manifests exceed the ${MAX_TOTAL_MANIFEST_BYTES}-byte aggregate limit`);
      }
      let manifest: NativePatchManifest;
      let validationError: string | undefined;
      try {
        manifest = parseAndValidateNativePatchManifest(rawManifest);
      } catch (error) {
        // Invalid JSON/duplicate keys or an invalid policy cannot opt out of abort.
        const message = error instanceof Error ? error.message : String(error);
        let raw: Partial<NativePatchManifest> | null = null;
        try {
          raw = parseJsonWithoutDuplicateKeys(rawManifest.toString("utf8")) as Partial<NativePatchManifest> | null;
        } catch {
          // The original validation error remains the diagnostic for malformed JSON.
        }
        const identity = {
          packageId: typeof raw?.package?.id === "string" ? raw.package.id : `${pack.path}:${manifestPath}`,
          packageName: typeof raw?.package?.name === "string" ? raw.package.name : undefined,
          sourcePackPath: pack.path,
          sourceModName: pack.displayName,
        };
        if (!raw || (raw.on_failure !== "warn" && raw.on_failure !== "silent")) {
          throw new NativePatchPackageError(message, [identity.packageId], [identity]);
        }
        if (
          typeof raw.package?.id === "string" &&
          typeof raw.package.version === "string" &&
          semver.valid(raw.package.version)
        ) {
          // Keep version selection authoritative: a broken higher version is
          // skipped as a package, rather than falling back to a lower version.
          manifest = raw as NativePatchManifest;
          validationError = message;
        } else {
          onSkippedPackage?.({ ...identity, policy: raw.on_failure, message });
          continue;
        }
      }
      candidates.push({
        pack,
        manifestPath,
        manifestEntry: entry,
        manifest,
        rawManifest,
        validationError,
      });
      if (candidates.length > 4096) throw new Error("too many native patch manifest candidates (maximum 4096)");
    }
  }
  return candidates;
};

type FlowContributionCandidate = {
  candidate: Candidate;
  contribution: NativePatchFlowContribution;
};
const contributionProviderName = (contribution: NativePatchFlowContribution, containingPack: string) =>
  `${containingPack} [${contribution.provenance.sourcePack} :: ${contribution.provenance.flowFile} :: node ${contribution.provenance.nodeId}]`;
const flowContributionIdentity = ({ candidate, contribution }: FlowContributionCandidate): NativePatchIdentity => ({
  packageId: contribution.template.id,
  packageName: candidate.manifest.package.name,
  sourcePackPath: candidate.pack.path,
  sourceModName: contribution.provenance.sourcePack,
});
const nativePatchFlowError = (
  message: string,
  providers: FlowContributionCandidate[] = [],
  fallbackPacks: NativePatchPack[] = [],
  fallbackSourceModName?: string,
) => {
  const identities = providers.map(flowContributionIdentity);
  for (const pack of fallbackPacks) {
    const sourceModName = fallbackSourceModName ?? pack.displayName;
    if (
      identities.some((identity) => identity.sourcePackPath === pack.path && identity.sourceModName === sourceModName)
    ) {
      continue;
    }
    identities.push({
      packageId: "native-patch-flow-contribution",
      packageName: "Native Patch flow contribution",
      sourcePackPath: pack.path,
      sourceModName,
    });
  }
  const packageIds = [...new Set(identities.map((identity) => identity.packageId))];
  return new NativePatchPackageError(message, packageIds, identities);
};

/** Contributions are validated and merged before package failure policies or version selection run. */
const resolveFlowContributionCandidates = async (
  packs: NativePatchPack[],
  standaloneCandidates: Candidate[],
): Promise<Candidate[]> => {
  const grouped = new Map<string, FlowContributionCandidate[]>();
  const identityById = new Map<
    string,
    {
      version: string;
      fingerprint: string;
      provider: FlowContributionCandidate;
    }
  >();
  const parsedProviders: FlowContributionCandidate[] = [];
  let aggregateBytes = 0;
  let aggregateInputRows = 0;
  let aggregateInputBytes = 0;
  let contributionCount = 0;
  for (const pack of packs) {
    const entries = pack.pack.packedFiles.filter((entry) => {
      const name = canonicalPackName(entry.name);
      return /^whmm_patch_contributions\/v1\//i.test(name) && name.toLowerCase().endsWith(".wh3patchcontrib.json");
    });
    const normalizedNames = new Set<string>();
    for (const entry of entries) {
      const key = normalizedVirtualPath(entry.name);
      if (normalizedNames.has(key)) {
        throw nativePatchFlowError(
          `duplicate normalized native patch contribution filename '${entry.name}' in ${pack.path}`,
          parsedProviders,
          [pack],
        );
      }
      normalizedNames.add(key);
      if (entry.file_size > MAX_NATIVE_PATCH_FLOW_CONTRIBUTION_BYTES + 1024 * 1024) {
        throw nativePatchFlowError(
          `native patch contribution ${entry.name} in ${pack.path} exceeds the stored-size limit`,
          parsedProviders,
          [pack],
        );
      }
      if (aggregateBytes + entry.file_size > MAX_TOTAL_PAYLOAD_BYTES) {
        throw nativePatchFlowError(
          "native patch flow contributions exceed the aggregate 512 MiB input limit",
          parsedProviders,
          [pack],
        );
      }
      let parsed: ReturnType<typeof parseNativePatchFlowContribution>;
      let rawContribution: Buffer | undefined;
      try {
        rawContribution = await readNativePatchPackEntry(pack, entry, MAX_NATIVE_PATCH_FLOW_CONTRIBUTION_BYTES);
        aggregateBytes += rawContribution.length;
        if (aggregateBytes > MAX_TOTAL_PAYLOAD_BYTES) {
          throw new Error("native patch flow contributions exceed the aggregate 512 MiB input limit");
        }
        parsed = parseNativePatchFlowContribution(rawContribution);
      } catch (error) {
        let sourceModName: string | undefined;
        try {
          const rawRoot = rawContribution
            ? (parseJsonWithoutDuplicateKeys(rawContribution.toString("utf8")) as Record<string, any>)
            : undefined;
          sourceModName =
            typeof rawRoot?.provenance?.sourcePack === "string" ? rawRoot.provenance.sourcePack : undefined;
        } catch {
          // The pack display name remains the fallback when contribution JSON is malformed.
        }
        throw nativePatchFlowError(
          `native patch flow contribution ${entry.name} in ${pack.path} is invalid: ${error instanceof Error ? error.message : String(error)}`,
          parsedProviders,
          [pack],
          sourceModName,
        );
      }
      const provider = contributionProviderName(parsed.contribution, pack.path);
      const providerCandidate: FlowContributionCandidate = {
        contribution: parsed.contribution,
        candidate: {
          pack,
          manifestPath: `whmm_patch_templates/${parsed.template.template.id}.embedded.json`,
          manifestEntry: entry,
          manifest: parsed.template.native_patch,
          rawManifest: parsed.template.rawBytes,
          flowTemplateFingerprint: parsed.template.fingerprint,
          flowTemplateVersion: parsed.template.template.version,
          flowProviderNames: [provider],
          flowSourcePackPaths: [pack.path],
          flowResolvedParameterValues: {},
          flowPayloadsByPath: parsed.payloadByPath,
        },
      };
      const previousIdentity = identityById.get(parsed.template.template.id);
      if (
        previousIdentity &&
        (previousIdentity.version !== parsed.template.template.version ||
          previousIdentity.fingerprint !== parsed.template.fingerprint)
      ) {
        throw nativePatchFlowError(
          `incompatible native patch templates for ${parsed.template.template.id}: ${contributionProviderName(previousIdentity.provider.contribution, previousIdentity.provider.candidate.pack.path)} (${previousIdentity.version}) and ${provider} (${parsed.template.template.version})`,
          [previousIdentity.provider, providerCandidate],
        );
      }
      contributionCount++;
      if (contributionCount > 4096) {
        throw nativePatchFlowError("too many native patch flow contributions (maximum 4096)", [
          ...parsedProviders,
          providerCandidate,
        ]);
      }
      identityById.set(parsed.template.template.id, {
        version: parsed.template.template.version,
        fingerprint: parsed.template.fingerprint,
        provider: providerCandidate,
      });
      parsedProviders.push(providerCandidate);
      const providerRows = Object.values(parsed.contribution.inputs.tables).reduce((sum, rows) => sum + rows.length, 0);
      aggregateInputRows += providerRows;
      aggregateInputBytes += Buffer.byteLength(JSON.stringify(parsed.contribution.inputs), "utf8");
      if (aggregateInputRows > MAX_NATIVE_PATCH_FLOW_INPUT_ROWS) {
        throw nativePatchFlowError("aggregate native patch flow inputs exceed the 100000-row limit", parsedProviders);
      }
      if (aggregateInputBytes > MAX_NATIVE_PATCH_FLOW_INPUT_BYTES) {
        throw nativePatchFlowError("aggregate native patch flow inputs exceed the 64 MiB limit", parsedProviders);
      }
      const groupKey = `${parsed.template.template.id}\0${parsed.template.template.version}\0${parsed.template.fingerprint}`;
      const values = grouped.get(groupKey) ?? [];
      values.push(providerCandidate);
      grouped.set(groupKey, values);
    }
  }

  const standaloneById = new Map(standaloneCandidates.map((candidate) => [candidate.manifest.package.id, candidate]));
  const result: Candidate[] = [];
  for (const providers of grouped.values()) {
    const first = providers[0];
    const providerNames = providers.map(({ contribution, candidate }) =>
      contributionProviderName(contribution, candidate.pack.path),
    );
    const manifest = first.candidate.manifest;
    const id = manifest.package.id;
    const collision = standaloneById.get(id);
    if (collision) {
      const identities = [...providers.map(flowContributionIdentity), nativePatchIdentity(collision)];
      throw new NativePatchPackageError(
        `native patch contribution package '${id}' collides with standalone package ${collision.manifestPath} in ${collision.pack.path}`,
        [...new Set(identities.map((identity) => identity.packageId))],
        identities,
      );
    }
    const parameterValues: Record<string, unknown> = {};
    const templateParameters = new Map(
      (manifest.parameters as Array<Record<string, any>>).map((parameter) => [parameter.id, parameter]),
    );
    const templateRoot = parseJsonWithoutDuplicateKeys(first.candidate.rawManifest.toString("utf8")) as Record<
      string,
      any
    >;
    const templateInputs = templateRoot.inputs as {
      scalars: Array<{ id: string; parameter: string }>;
      tables: Array<any>;
    };
    for (const input of templateInputs.scalars) {
      let firstValue: unknown;
      let firstProvider: FlowContributionCandidate | undefined;
      for (const provider of providers) {
        const value = provider.contribution.inputs.scalars[input.id];
        if (!firstProvider) {
          firstValue = value;
          firstProvider = provider;
        } else if (nativePatchFlowCanonicalValue(value) !== nativePatchFlowCanonicalValue(firstValue)) {
          throw nativePatchFlowError(
            `conflicting scalar input '${input.id}' for package '${id}': ${contributionProviderName(firstProvider.contribution, firstProvider.candidate.pack.path)} and ${contributionProviderName(provider.contribution, provider.candidate.pack.path)}`,
            [firstProvider, provider],
          );
        }
      }
      if (!templateParameters.has(input.parameter)) {
        throw nativePatchFlowError(
          `template scalar parameter '${input.parameter}' disappeared during validation`,
          providers,
        );
      }
      parameterValues[input.parameter] = firstValue;
    }

    let totalMergedRows = 0;
    for (const input of templateInputs.tables) {
      const rowsByGroup = new Map<
        string,
        {
          values: string[];
          rowByValue: Map<string, Record<string, unknown>>;
          provider: FlowContributionCandidate;
        }
      >();
      for (const provider of providers) {
        const rows = provider.contribution.inputs.tables[input.id] ?? [];
        const groups = new Map<string, Map<string, Record<string, unknown>>>();
        for (const row of rows) {
          const groupKey = String(row[input.group_by]);
          const value = String(row[input.value_column]);
          const values = groups.get(groupKey) ?? new Map<string, Record<string, unknown>>();
          values.set(value, row);
          groups.set(groupKey, values);
        }
        for (const [groupKey, rowByValue] of groups) {
          const values = [...rowByValue.keys()].sort(ordinalCompare);
          const existing = rowsByGroup.get(groupKey);
          if (existing) {
            if (nativePatchFlowCanonicalValue(existing.values) !== nativePatchFlowCanonicalValue(values)) {
              throw nativePatchFlowError(
                `conflicting table group '${groupKey}' for package '${id}' input '${input.id}': ${contributionProviderName(existing.provider.contribution, existing.provider.candidate.pack.path)} and ${contributionProviderName(provider.contribution, provider.candidate.pack.path)}`,
                [existing.provider, provider],
              );
            }
          } else rowsByGroup.set(groupKey, { values, rowByValue, provider });
        }
      }
      const mergedRows = [...rowsByGroup.entries()]
        .sort(([firstKey], [secondKey]) => ordinalCompare(firstKey, secondKey))
        .flatMap(([, group]) => [...group.values].map((value) => group.rowByValue.get(value)!));
      totalMergedRows += mergedRows.length;
      if (totalMergedRows > MAX_NATIVE_PATCH_FLOW_INPUT_ROWS) {
        throw nativePatchFlowError(`merged table inputs for package '${id}' exceed the aggregate row limit`, providers);
      }
      if (mergedRows.length > input.max_rows) {
        throw nativePatchFlowError(
          `merged table input '${input.id}' for package '${id}' exceeds max_rows ${input.max_rows}`,
          providers,
        );
      }
      parameterValues[input.parameter] = mergedRows;
    }
    if (templateInputs.tables.length > 0 && totalMergedRows === 0) continue;

    const candidate = { ...first.candidate };
    candidate.flowProviderNames = providerNames;
    candidate.flowSourcePackPaths = [...new Set(providers.map(({ candidate: provider }) => provider.pack.path))];
    candidate.flowResolvedParameterValues = parameterValues;
    const sourceModNames = [...new Set(providers.map(({ contribution }) => contribution.provenance.sourcePack))];
    candidate.pack = {
      ...first.candidate.pack,
      priority: Math.max(...providers.map(({ candidate: provider }) => provider.pack.priority)),
      displayName: sourceModNames.join(", "),
    };
    // Contributions are author-authored generated inputs. Validate their destinations before
    // package failure policies are considered so warn/silent can never discard malformed data.
    try {
      validateReferenceSymbols(candidate.manifest);
      validateFixupAndParameterFields(candidate.manifest);
    } catch (error) {
      throw nativePatchFlowError(error instanceof Error ? error.message : String(error), providers);
    }
    result.push(candidate);
  }
  return result;
};

const chooseHighestPriorityVersion = (candidates: Candidate[]): Candidate[] => {
  const winnerById = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const id = candidate.manifest.package.id;
    const current = winnerById.get(id);
    if (!current) {
      winnerById.set(id, candidate);
      continue;
    }
    const byVersion = semver.compare(candidate.manifest.package.version, current.manifest.package.version);
    const shouldReplace =
      byVersion > 0 ||
      (byVersion === 0 && candidate.pack.priority > current.pack.priority) ||
      (byVersion === 0 &&
        candidate.pack.priority === current.pack.priority &&
        (process.platform === "win32"
          ? nodePath.resolve(candidate.pack.path).toLowerCase() === nodePath.resolve(current.pack.path).toLowerCase()
          : nodePath.resolve(candidate.pack.path) === nodePath.resolve(current.pack.path)) &&
        ordinalCompare(normalizedVirtualPath(candidate.manifestPath), normalizedVirtualPath(current.manifestPath)) < 0);
    if (shouldReplace) winnerById.set(id, candidate);
  }
  return [...winnerById.values()].sort((first, second) =>
    ordinalCompare(first.manifest.package.id, second.manifest.package.id),
  );
};

const validateSelectedComposition = (packages: Candidate[]) => {
  for (const candidate of packages) {
    if (candidate.validationError)
      throw new NativePatchPackageError(candidate.validationError, [candidate.manifest.package.id]);
  }
  if (packages.length > MAX_NATIVE_PATCH_PACKAGES)
    throw new NativePatchPackageError(`more than ${MAX_NATIVE_PATCH_PACKAGES} native patch packages are selected`, []);
  const selectedById = new Map(packages.map((candidate) => [candidate.manifest.package.id, candidate]));
  const targetHashes = new Set(packages.map((candidate) => candidate.manifest.target.sha256).filter(Boolean));
  if (targetHashes.size > 1)
    throw new NativePatchPackageError(
      "selected native patches target different Warhammer3.exe builds",
      packages.filter((item) => item.manifest.target.sha256).map((item) => item.manifest.package.id),
    );
  const claims = new Map<string, string>();
  const writeRanges: Array<{ start: bigint; end: bigint; owner: string; packageId: string }> = [];
  for (const candidate of packages) {
    const manifest = candidate.manifest;
    for (const dependency of manifest.requires) {
      const installed = selectedById.get(dependency.id);
      if (!installed || installed.manifest.package.version !== dependency.version) {
        throw new NativePatchPackageError(`${manifest.package.id} requires ${dependency.id}@${dependency.version}`, [
          manifest.package.id,
        ]);
      }
    }
    for (const conflict of manifest.conflicts) {
      if (selectedById.has(conflict))
        throw new NativePatchPackageError(`${manifest.package.id} conflicts with selected package ${conflict}`, [
          manifest.package.id,
          conflict,
        ]);
    }
    for (const claim of manifest.claims) {
      const key = `${claim.domain}\0${claim.key}`;
      const owner = claims.get(key);
      if (owner)
        throw new NativePatchPackageError(
          `native patch claim ${claim.domain}:${claim.key} is shared by ${owner} and ${manifest.package.id}`,
          [owner, manifest.package.id],
        );
      claims.set(key, manifest.package.id);
    }
    for (const write of manifest.writes) {
      const address = write.at as Record<string, any>;
      if (!address.module) continue;
      const start = BigInt(address.rva);
      const end = start + BigInt(Buffer.from(write.expected, "hex").length);
      const owner = `${manifest.package.id}:${write.id}`;
      if (writeRanges.some((range) => start < range.end && range.start < end)) {
        const collision = writeRanges.find((range) => start < range.end && range.start < end);
        throw new NativePatchPackageError(`native module writes overlap: ${collision?.owner} and ${owner}`, [
          collision!.packageId,
          manifest.package.id,
        ]);
      }
      writeRanges.push({ start, end, owner, packageId: manifest.package.id });
    }
  }
};

const effectiveAssetBytes = async (asset: Record<string, any>, packs: NativePatchPack[]): Promise<Buffer> => {
  const key = normalizePackFilePathKey(asset.virtual_path);
  let winner: { pack: NativePatchPack; entry: PackedFile } | undefined;
  for (const pack of [...packs].sort((first, second) => first.priority - second.priority)) {
    const matches = pack.pack.packedFiles.filter((entry) => normalizePackFilePathKey(entry.name) === key);
    if (matches.length > 1) throw new Error(`duplicate normalized asset '${asset.virtual_path}' in ${pack.path}`);
    if (matches.length === 1) winner = { pack, entry: matches[0] };
  }
  if (!winner) throw new Error(`required native patch asset is missing: ${asset.virtual_path}`);
  const bytes = await readNativePatchPackEntry(winner.pack, winner.entry, MAX_TOTAL_PAYLOAD_BYTES);
  if (sha256(bytes) !== asset.sha256.toLowerCase())
    throw new Error(`required native patch asset hash mismatch: ${asset.virtual_path}`);
  return bytes;
};

export const buildNativePatchLaunchPlan = async (input: {
  runId: string;
  targetPath: string;
  enabledPacks: NativePatchPack[];
  effectiveContentPacks: NativePatchPack[] | (() => Promise<NativePatchPack[]>);
  onSkippedPackage?: (notice: NativePatchSkippedPackage) => void;
}): Promise<NativePatchLaunchPlan | undefined> => {
  const standaloneCandidates = await resolvePackageCandidates(input.enabledPacks, input.onSkippedPackage);
  const flowCandidates = await resolveFlowContributionCandidates(input.enabledPacks, standaloneCandidates);
  const candidates = [...standaloneCandidates, ...flowCandidates];
  let selected = chooseHighestPriorityVersion(candidates);
  const preparedByCandidate = new Map<Candidate, NativePatchPreparedPackage>();
  let effectivePacks: NativePatchPack[] | undefined;
  let actualTargetHash: string | undefined;
  while (selected.length) {
    let activePackageIds: string[] = [];
    try {
      validateSelectedComposition(selected);
      const payloadSize = selected.reduce(
        (sum, candidate) => sum + candidate.manifest.blocks.reduce((total, block) => total + block.size, 0),
        0,
      );
      if (payloadSize > MAX_TOTAL_PAYLOAD_BYTES) {
        throw new NativePatchPackageError(
          `selected native patch payloads exceed the ${MAX_TOTAL_PAYLOAD_BYTES}-byte total limit`,
          [],
        );
      }
      const selectedPackages: NativePatchPreparedPackage[] = [];
      for (const candidate of selected) {
        activePackageIds = [candidate.manifest.package.id];
        let prepared = preparedByCandidate.get(candidate);
        if (!prepared) {
          prepared = await loadCandidatePayloads(candidate);
          preparedByCandidate.set(candidate, prepared);
        }
        for (const asset of prepared.manifest.assets) {
          effectivePacks ??=
            typeof input.effectiveContentPacks === "function"
              ? await input.effectiveContentPacks()
              : input.effectiveContentPacks;
          await effectiveAssetBytes(asset, effectivePacks);
        }
        if (prepared.manifest.target.sha256) {
          actualTargetHash ??= sha256(fs.readFileSync(input.targetPath));
          if (actualTargetHash !== prepared.manifest.target.sha256) {
            throw new Error(
              `Warhammer3.exe SHA-256 mismatch: expected ${prepared.manifest.target.sha256}, found ${actualTargetHash}`,
            );
          }
        }
        selectedPackages.push(prepared);
      }
      return {
        protocol: 1,
        runId: input.runId,
        targetPath: input.targetPath,
        targetSha256: selectedPackages.find((item) => item.manifest.target.sha256)?.manifest.target.sha256,
        packages: selectedPackages,
      };
    } catch (error) {
      selected = skipFailedNativePatches(
        selected,
        error instanceof NativePatchPackageError ? error.packageIds : activePackageIds,
        error instanceof Error ? error.message : String(error),
        input.onSkippedPackage,
      );
    }
  }
  return undefined;
};
