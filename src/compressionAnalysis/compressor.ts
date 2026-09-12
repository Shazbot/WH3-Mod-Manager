import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomBytes } from "node:crypto";
import {
  createDefaultCompressionCodecs,
  parsePFH5Header,
  parsePFH5Index,
  PFH5_HEADER_BYTES,
  type CompressionCodecs,
} from "./analyzer";
import type { CompressionPackAnalysis, CompressPackResponse } from "./types";
import { passesCompressionThreshold, passesRigidModelV2CompressionThreshold } from "./policy";

const COPY_CHUNK_BYTES = 8 * 1024 * 1024;

export interface CompressPackOptions {
  codecs?: Partial<CompressionCodecs>;
  now?: () => Date;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const writeAll = async (file: fs.promises.FileHandle, data: Buffer, position: number): Promise<void> => {
  let written = 0;
  while (written < data.length) {
    const result = await file.write(data, written, data.length - written, position + written);
    if (result.bytesWritten === 0) throw new Error(`short write at ${position + written}`);
    written += result.bytesWritten;
  }
};

const readAll = async (file: fs.promises.FileHandle, length: number, position: number): Promise<Buffer> => {
  const data = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await file.read(data, read, length - read, position + read);
    if (result.bytesRead === 0) throw new Error(`short read at ${position + read}`);
    read += result.bytesRead;
  }
  return data;
};

const copyRange = async (
  source: fs.promises.FileHandle,
  destination: fs.promises.FileHandle,
  sourcePosition: number,
  destinationPosition: number,
  length: number,
): Promise<void> => {
  const chunk = Buffer.allocUnsafe(Math.min(COPY_CHUNK_BYTES, Math.max(1, length)));
  let copied = 0;
  while (copied < length) {
    const bytes = Math.min(chunk.length, length - copied);
    const read = await source.read(chunk, 0, bytes, sourcePosition + copied);
    if (read.bytesRead !== bytes) throw new Error(`short payload read at ${sourcePosition + copied}`);
    await writeAll(destination, chunk.subarray(0, bytes), destinationPosition + copied);
    copied += bytes;
  }
};

const timestampForFileName = (date: Date): string => date.toISOString().replace(/[:.]/g, "-");

const reserveBackupPath = async (backupFolder: string, packName: string, now: Date): Promise<string> => {
  const extension = nodePath.extname(packName);
  const stem = extension ? packName.slice(0, -extension.length) : packName;
  const timestamp = timestampForFileName(now);
  for (let suffix = 0; suffix < 1000; suffix++) {
    const collisionSuffix = suffix === 0 ? "" : `-${suffix}`;
    const candidate = nodePath.join(backupFolder, `${stem}.${timestamp}${collisionSuffix}${extension}`);
    try {
      await fs.promises.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique backup file name");
};

/**
 * Rewrites one analyzed PFH5 pack. The original index bytes are retained and only the file sizes
 * and compression flags are patched, preserving hashes and any other pack metadata byte-for-byte.
 */
export const compressAnalyzedPack = async (
  packPath: string,
  analysis: CompressionPackAnalysis,
  gameFolder: string,
  includeRigidModelV2: boolean,
  options: CompressPackOptions = {},
): Promise<CompressPackResponse> => {
  if (!analysis.success) return { success: false, error: "The pack did not pass compression analysis." };
  if (nodePath.resolve(packPath) !== nodePath.resolve(analysis.packPath)) {
    return { success: false, error: "The analysis does not belong to the requested pack." };
  }

  const defaults = createDefaultCompressionCodecs();
  const codecs: CompressionCodecs = {
    lz4Compress: options.codecs?.lz4Compress ?? defaults.lz4Compress,
    lz4Decompress: options.codecs?.lz4Decompress ?? defaults.lz4Decompress,
    zstdCompress: options.codecs?.zstdCompress ?? defaults.zstdCompress,
    zstdDecompress: options.codecs?.zstdDecompress ?? defaults.zstdDecompress,
  };
  const sourceStat = await fs.promises.stat(packPath);
  if (!sourceStat.isFile() || sourceStat.size !== analysis.currentSize) {
    return { success: false, error: "The pack changed after it was analyzed. Run the analysis again." };
  }

  const tempPath = nodePath.join(
    nodePath.dirname(packPath),
    `.${nodePath.basename(packPath)}.whmm-compress-${process.pid}-${randomBytes(6).toString("hex")}.tmp`,
  );
  let source: fs.promises.FileHandle | undefined;
  let destination: fs.promises.FileHandle | undefined;
  let backupPath: string | undefined;
  try {
    source = await fs.promises.open(packPath, "r");
    destination = await fs.promises.open(tempPath, "wx+");
    const headerBuffer = await readAll(source, PFH5_HEADER_BYTES, 0);
    const header = parsePFH5Header(headerBuffer, sourceStat.size);
    const indexStart = PFH5_HEADER_BYTES + header.dependencyIndexSize;
    const index = await readAll(source, header.packedFileIndexSize, indexStart);
    const entries = parsePFH5Index(index, header);
    if (
      entries.length !== analysis.fileResults.length ||
      entries.some((entry, entryIndex) => entry.name !== analysis.fileResults[entryIndex]?.fileName)
    ) {
      throw new Error("The pack index changed after it was analyzed. Run the analysis again.");
    }

    let outputPosition = header.dataStart;
    let compressedFileCount = 0;
    for (const [entryIndex, entry] of entries.entries()) {
      const result = analysis.fileResults[entryIndex];
      const shouldCompress =
        !entry.isCompressed &&
        result.status === "accepted" &&
        (!result.isRigidModelV2 || includeRigidModelV2) &&
        !!result.selectedCodec;
      if (!shouldCompress) {
        await copyRange(source, destination, entry.payloadOffset, outputPosition, entry.fileSize);
        outputPosition += entry.fileSize;
        continue;
      }

      const original = await readAll(source, entry.fileSize, entry.payloadOffset);
      const compressed = Buffer.from(
        result.selectedCodec === "LZ4" ? await codecs.lz4Compress(original) : await codecs.zstdCompress(original),
      );
      const decompressed = Buffer.from(
        result.selectedCodec === "LZ4"
          ? await codecs.lz4Decompress(compressed)
          : await codecs.zstdDecompress(compressed),
      );
      if (!decompressed.equals(original))
        throw new Error(`${entry.name}: compression round trip was not byte-identical`);
      const stillEligible = result.isRigidModelV2
        ? result.selectedCodec === "LZ4" && passesRigidModelV2CompressionThreshold(original.length, compressed.length)
        : passesCompressionThreshold(original.length, compressed.length);
      if (!stillEligible) throw new Error(`${entry.name}: compression no longer meets the safety threshold`);
      index.writeUInt32LE(compressed.length, entry.fileSizeIndexOffset);
      index.writeUInt8(1, entry.compressionFlagIndexOffset);
      await writeAll(destination, compressed, outputPosition);
      outputPosition += compressed.length;
      compressedFileCount++;
    }

    if (compressedFileCount === 0) {
      return { success: false, error: "This pack has no eligible files to compress with the selected options." };
    }
    const prefix = await readAll(source, header.dataStart, 0);
    index.copy(prefix, indexStart);
    await writeAll(destination, prefix, 0);
    await destination.truncate(outputPosition);
    await destination.sync();
    await destination.close();
    destination = undefined;
    await source.close();
    source = undefined;

    const backupFolder = nodePath.join(gameFolder, "whmm_backups");
    await fs.promises.mkdir(backupFolder, { recursive: true });
    backupPath = await reserveBackupPath(backupFolder, nodePath.basename(packPath), options.now?.() ?? new Date());
    await fs.promises.copyFile(packPath, backupPath, fs.constants.COPYFILE_EXCL);
    try {
      await fs.promises.copyFile(tempPath, packPath);
    } catch (error) {
      await fs.promises.copyFile(backupPath, packPath);
      throw error;
    }
    const compressedSize = (await fs.promises.stat(packPath)).size;
    return {
      success: true,
      packPath,
      backupPath,
      originalSize: sourceStat.size,
      compressedSize,
      compressedFileCount,
    };
  } catch (error) {
    return { success: false, backupPath, error: errorMessage(error) };
  } finally {
    await destination?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
    await fs.promises.unlink(tempPath).catch(() => undefined);
  }
};
