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
import type { CompressionAnalysisProgress, CompressionPackAnalysis, CompressPackResponse } from "./types";
import { passesCompressionThreshold, passesRigidModelV2CompressionThreshold } from "./policy";

const COPY_CHUNK_BYTES = 8 * 1024 * 1024;

export interface CompressPackOptions {
  codecs?: Partial<CompressionCodecs>;
  now?: () => Date;
  /** Abort before or during a rewrite. The original pack remains untouched until replacement. */
  signal?: AbortSignal;
  /** Reports per-file rewrite progress. Consumer errors are ignored. */
  onProgress?: (progress: CompressionAnalysisProgress) => void;
  /**
   * When false, replace the analyzed pack with a temporary rollback path instead of creating a
   * persistent whmm_backups copy. This is used by automatic Workshop staging, where the pack is
   * already a disposable copy and the original Workshop file must never be touched.
   *
   * The default remains true for the manual compression action.
   */
  createBackup?: boolean;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const makeAbortError = () => {
  const error = new Error("Compression canceled");
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  throw signal.reason ?? makeAbortError();
};

const reportProgress = (options: CompressPackOptions, progress: CompressionAnalysisProgress): void => {
  try {
    options.onProgress?.(progress);
  } catch {
    // Progress reporting must not affect the compression transaction.
  }
};

const writeAll = async (
  file: fs.promises.FileHandle,
  data: Buffer,
  position: number,
  signal?: AbortSignal,
): Promise<void> => {
  let written = 0;
  while (written < data.length) {
    throwIfAborted(signal);
    const result = await file.write(data, written, data.length - written, position + written);
    if (result.bytesWritten === 0) throw new Error(`short write at ${position + written}`);
    written += result.bytesWritten;
  }
};

const readAll = async (
  file: fs.promises.FileHandle,
  length: number,
  position: number,
  signal?: AbortSignal,
): Promise<Buffer> => {
  const data = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    throwIfAborted(signal);
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
  signal?: AbortSignal,
): Promise<void> => {
  const chunk = Buffer.allocUnsafe(Math.min(COPY_CHUNK_BYTES, Math.max(1, length)));
  let copied = 0;
  while (copied < length) {
    throwIfAborted(signal);
    const bytes = Math.min(chunk.length, length - copied);
    const read = await source.read(chunk, 0, bytes, sourcePosition + copied);
    if (read.bytesRead !== bytes) throw new Error(`short payload read at ${sourcePosition + copied}`);
    await writeAll(destination, chunk.subarray(0, bytes), destinationPosition + copied, signal);
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
  throwIfAborted(options.signal);

  const defaults = createDefaultCompressionCodecs();
  const codecs: CompressionCodecs = {
    lz4Compress: options.codecs?.lz4Compress ?? defaults.lz4Compress,
    lz4Decompress: options.codecs?.lz4Decompress ?? defaults.lz4Decompress,
    zstdCompress: options.codecs?.zstdCompress ?? defaults.zstdCompress,
    zstdDecompress: options.codecs?.zstdDecompress ?? defaults.zstdDecompress,
  };
  const sourceStat = await fs.promises.stat(packPath);
  throwIfAborted(options.signal);
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
  let rollbackPath: string | undefined;
  // If both replacement and restoration fail, keep this path so the only remaining copy of the
  // original staged pack is not deleted by the cleanup below.
  let preserveRollback = false;
  try {
    throwIfAborted(options.signal);
    source = await fs.promises.open(packPath, "r");
    destination = await fs.promises.open(tempPath, "wx+");
    const headerBuffer = await readAll(source, PFH5_HEADER_BYTES, 0, options.signal);
    const header = parsePFH5Header(headerBuffer, sourceStat.size);
    const indexStart = PFH5_HEADER_BYTES + header.dependencyIndexSize;
    const index = await readAll(source, header.packedFileIndexSize, indexStart, options.signal);
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
      throwIfAborted(options.signal);
      reportProgress(options, {
        phase: "file",
        packIndex: 0,
        packCount: 1,
        fileIndex: entryIndex,
        fileCount: entries.length,
        packPath,
        packName: nodePath.basename(packPath),
        fileName: entry.name,
      });
      const result = analysis.fileResults[entryIndex];
      const shouldCompress =
        !entry.isCompressed &&
        result.status === "accepted" &&
        (!result.isRigidModelV2 || includeRigidModelV2) &&
        !!result.selectedCodec;
      if (!shouldCompress) {
        await copyRange(source, destination, entry.payloadOffset, outputPosition, entry.fileSize, options.signal);
        outputPosition += entry.fileSize;
        continue;
      }

      const original = await readAll(source, entry.fileSize, entry.payloadOffset, options.signal);
      const compressed = Buffer.from(
        result.selectedCodec === "LZ4" ? await codecs.lz4Compress(original) : await codecs.zstdCompress(original),
      );
      throwIfAborted(options.signal);
      const decompressed = Buffer.from(
        result.selectedCodec === "LZ4"
          ? await codecs.lz4Decompress(compressed)
          : await codecs.zstdDecompress(compressed),
      );
      throwIfAborted(options.signal);
      if (!decompressed.equals(original))
        throw new Error(`${entry.name}: compression round trip was not byte-identical`);
      const stillEligible = result.isRigidModelV2
        ? result.selectedCodec === "LZ4" && passesRigidModelV2CompressionThreshold(original.length, compressed.length)
        : passesCompressionThreshold(original.length, compressed.length);
      if (!stillEligible) throw new Error(`${entry.name}: compression no longer meets the safety threshold`);
      index.writeUInt32LE(compressed.length, entry.fileSizeIndexOffset);
      index.writeUInt8(1, entry.compressionFlagIndexOffset);
      await writeAll(destination, compressed, outputPosition, options.signal);
      outputPosition += compressed.length;
      compressedFileCount++;
    }
    reportProgress(options, {
      phase: "file",
      packIndex: 0,
      packCount: 1,
      fileIndex: entries.length,
      fileCount: entries.length,
      packPath,
      packName: nodePath.basename(packPath),
    });

    if (compressedFileCount === 0) {
      throwIfAborted(options.signal);
      return { success: false, error: "This pack has no eligible files to compress with the selected options." };
    }
    const prefix = await readAll(source, header.dataStart, 0, options.signal);
    index.copy(prefix, indexStart);
    await writeAll(destination, prefix, 0, options.signal);
    await destination.truncate(outputPosition);
    await destination.sync();
    await destination.close();
    destination = undefined;
    await source.close();
    source = undefined;

    if (options.createBackup === false) {
      // Keep a same-directory rollback entry until the replacement has committed. Renaming the
      // original away first makes a failed replacement unable to leave a partially copied pack;
      // the catch restores the exact uncompressed bytes before returning the failure.
      rollbackPath = nodePath.join(
        nodePath.dirname(packPath),
        `.${nodePath.basename(packPath)}.whmm-staging-rollback-${process.pid}-${randomBytes(6).toString("hex")}.tmp`,
      );
      const originalRollbackPath = rollbackPath;
      // Do not move the only staged copy away after cancellation. Once this rename starts, the
      // replacement transaction is allowed to finish (or restore through the existing rollback).
      throwIfAborted(options.signal);
      await fs.promises.rename(packPath, originalRollbackPath);
      try {
        throwIfAborted(options.signal);
        await fs.promises.rename(tempPath, packPath);
      } catch (error) {
        let restored = false;
        try {
          await fs.promises.rename(originalRollbackPath, packPath);
          restored = true;
          rollbackPath = undefined;
        } catch (restoreError) {
          // A rename can fail on a filesystem that temporarily refuses replacement. If the
          // destination was recreated or partially written, copy the rollback bytes over it as a
          // second restoration attempt. Keep rollbackPath when this also fails so cleanup cannot
          // discard the only recoverable original.
          try {
            await fs.promises.copyFile(originalRollbackPath, packPath);
            restored = true;
            await fs.promises.unlink(originalRollbackPath).then(
              () => {
                rollbackPath = undefined;
              },
              () => undefined,
            );
          } catch (copyError) {
            preserveRollback = true;
            throw new Error(
              `Failed to replace ${packPath} and restore the original staged pack: ${errorMessage(
                copyError,
              )}; rename restoration error: ${errorMessage(restoreError)}; replacement error: ${errorMessage(error)}`,
            );
          }
        }
        if (!restored) {
          preserveRollback = true;
          throw new Error(
            `Failed to replace ${packPath} and restore the original staged pack; replacement error: ${errorMessage(
              error,
            )}`,
          );
        }
        throw error;
      }
      await fs.promises.unlink(originalRollbackPath).then(
        () => {
          rollbackPath = undefined;
        },
        () => undefined,
      );
    } else {
      throwIfAborted(options.signal);
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
    if (options.signal?.aborted) throw error;
    return { success: false, backupPath, error: errorMessage(error) };
  } finally {
    await destination?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
    await fs.promises.unlink(tempPath).catch(() => undefined);
    if (!preserveRollback && rollbackPath) await fs.promises.unlink(rollbackPath).catch(() => undefined);
  }
};
