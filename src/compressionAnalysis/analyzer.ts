import * as fs from "node:fs";
import * as nodePath from "node:path";
import {
  chooseCompressionCodec,
  compressionRatio,
  compressionRatioPercent,
  getCompressionEligibilityThreshold,
  LARGE_FILE_SAMPLE_BYTES,
  LARGE_FILE_SAMPLE_THRESHOLD_BYTES,
  TOP_COMPRESSION_WINS,
  ZSTD_COMPRESSION_LEVEL,
} from "./policy";
import { createEmptyMethodStats, parseVanillaCompressionCsv, vanillaRecordIsAllNone } from "./vanillaGuardrail";
import type {
  CompressionAnalysisOverall,
  CompressionAnalysisProgress,
  CompressionAnalysisResult,
  CompressionCodec,
  CompressionCodecResult,
  CompressionFileAnalysis,
  CompressionMethod,
  CompressionPackAnalysis,
  CompressionWin,
} from "./types";
import type { VanillaCompressionExtensionRecord } from "./vanillaGuardrail";

export const PFH5_HEADER_BYTES = 28;
export const PFH5_FILENAME_HASH_MASK = 0x40;
export const LZ4_FRAME_MAGIC = Buffer.from([0x04, 0x22, 0x4d, 0x18]);
export const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const COMPRESSION_DETECTION_SAMPLE_BYTES = 64;
const VANILLA_GUARDRAIL_RELATIVE_PATH = "scripts/out/vanilla-pack-compression-by-extension.csv";
const ALWAYS_SKIP_EXTENSIONS = new Set([".wem", ".bnk", ".ca_vp8", ".rpfm_reserved"]);

export interface PFH5HeaderInfo {
  format: "PFH5";
  byteMask: number;
  dependencyIndexSize: number;
  fileCount: number;
  packedFileIndexSize: number;
  dataStart: number;
  hasFileNameHash: boolean;
  packSize?: number;
}

export interface PFH5IndexEntry {
  index: number;
  name: string;
  fileSize: number;
  isCompressed: boolean;
  payloadOffset: number;
}

export interface ParsedPFH5Pack {
  header: PFH5HeaderInfo;
  entries: PFH5IndexEntry[];
}

export class CompressionAnalysisCanceled extends Error {
  constructor() {
    super("Compression analysis canceled");
    this.name = "CompressionAnalysisCanceled";
  }
}

export type CompressionTransform = (data: Buffer) => Promise<Buffer> | Buffer;

export interface CompressionCodecs {
  lz4Compress: CompressionTransform;
  lz4Decompress: CompressionTransform;
  zstdCompress: CompressionTransform;
  zstdDecompress: CompressionTransform;
}

export interface CompressionAnalysisOptions {
  /** Codec implementations can be injected by tests or by embedders. */
  codecs?: Partial<CompressionCodecs>;
  /** Checked-in vanilla CSV contents. When omitted, the packaged/repository CSV is located. */
  vanillaCsv?: string;
  /** Already parsed guardrail records, useful when a caller caches the CSV. */
  vanillaRecords?: Map<string, VanillaCompressionExtensionRecord>;
  isCanceled?: () => boolean;
  onProgress?: (progress: CompressionAnalysisProgress) => void;
  /** Override payload reads while retaining the normal PFH5 parser. */
  readRange?: (packPath: string, offset: number, length: number) => Promise<Buffer>;
  /** Override stat while using readRange (the default uses fs.stat). */
  getPackSize?: (packPath: string) => Promise<number>;
}

const asErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const normalizePathForDedupe = (packPath: string): string => {
  const resolved = nodePath.resolve(packPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export const dedupePackPaths = (packPaths: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const packPath of packPaths) {
    if (typeof packPath !== "string" || packPath.trim() === "") continue;
    const normalized = normalizePathForDedupe(packPath);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(packPath);
  }
  return result;
};

const readUInt32LE = (buffer: Buffer, offset: number, label: string): number => {
  if (offset < 0 || offset + 4 > buffer.length) throw new Error(`${label} is truncated`);
  return buffer.readUInt32LE(offset);
};

export const parsePFH5Header = (header: Buffer, packSize?: number): PFH5HeaderInfo => {
  if (header.length < PFH5_HEADER_BYTES) throw new Error("PFH5 header is truncated");
  const format = header.toString("ascii", 0, 4);
  if (format !== "PFH5") throw new Error(`unsupported pack header ${format || "<missing>"}`);
  const byteMask = readUInt32LE(header, 4, "PFH5 byte mask");
  const dependencyIndexSize = readUInt32LE(header, 12, "PFH5 dependency index size");
  const fileCount = readUInt32LE(header, 16, "PFH5 file count");
  const packedFileIndexSize = readUInt32LE(header, 20, "PFH5 packed-file index size");
  const dataStart = PFH5_HEADER_BYTES + dependencyIndexSize + packedFileIndexSize;
  if (packSize !== undefined && dataStart > packSize) {
    throw new Error(`PFH5 dependency/index region extends past the end of the pack (${dataStart} > ${packSize})`);
  }
  return {
    format: "PFH5",
    byteMask,
    dependencyIndexSize,
    fileCount,
    packedFileIndexSize,
    dataStart,
    hasFileNameHash: (byteMask & PFH5_FILENAME_HASH_MASK) !== 0,
    packSize,
  };
};

/**
 * Parses the packed-file index and validates every entry's payload bounds. PFH5's hashed-name
 * variant inserts four bytes before the compression flag; the readable name remains in the index.
 */
export const parsePFH5Index = (
  index: Buffer,
  header: Pick<PFH5HeaderInfo, "fileCount" | "hasFileNameHash" | "dataStart" | "packSize">,
): PFH5IndexEntry[] => {
  const entries: PFH5IndexEntry[] = [];
  let position = 0;
  let payloadOffset = header.dataStart;
  for (let indexNumber = 0; indexNumber < header.fileCount; indexNumber++) {
    const fileSize = readUInt32LE(index, position, `PFH5 file ${indexNumber} size`);
    position += 4;
    if (header.hasFileNameHash) {
      if (position + 4 > index.length) throw new Error(`PFH5 file ${indexNumber} name hash is truncated`);
      position += 4;
    }
    if (position + 1 > index.length) throw new Error(`PFH5 file ${indexNumber} compression flag is truncated`);
    const isCompressed = index[position] === 1;
    position += 1;
    const nameEnd = index.indexOf(0, position);
    if (nameEnd < 0) throw new Error(`PFH5 file ${indexNumber} name is unterminated`);
    const name = index.toString("utf8", position, nameEnd);
    position = nameEnd + 1;
    const payloadEnd = payloadOffset + fileSize;
    if (!Number.isSafeInteger(payloadEnd) || (header.packSize !== undefined && payloadEnd > header.packSize)) {
      throw new Error(`PFH5 file ${indexNumber} payload extends past the end of the pack`);
    }
    entries.push({ index: indexNumber, name, fileSize, isCompressed, payloadOffset });
    payloadOffset = payloadEnd;
  }
  if (position !== index.length) {
    throw new Error(`PFH5 packed-file index has ${index.length - position} unparsed byte(s)`);
  }
  return entries;
};

export const parsePFH5PackIndex = parsePFH5Index;

export const parsePFH5PackBuffer = (packBuffer: Buffer, packPath = "<buffer>"): ParsedPFH5Pack => {
  const header = parsePFH5Header(packBuffer.subarray(0, PFH5_HEADER_BYTES), packBuffer.length);
  const indexStart = PFH5_HEADER_BYTES + header.dependencyIndexSize;
  const indexEnd = indexStart + header.packedFileIndexSize;
  if (indexEnd > packBuffer.length) throw new Error(`PFH5 packed-file index is truncated (${packPath})`);
  return { header, entries: parsePFH5Index(packBuffer.subarray(indexStart, indexEnd), header) };
};

const hasMagicAt = (buffer: Buffer, magic: Buffer, offset: number): boolean =>
  offset + magic.length <= buffer.length && buffer.subarray(offset, offset + magic.length).equals(magic);

export const detectCompressionMethod = (payload: Buffer): CompressionMethod => {
  if (payload.length === 0) return "UNKNOWN";
  const sample = payload.subarray(0, Math.min(COMPRESSION_DETECTION_SAMPLE_BYTES, payload.length));
  for (let offset = 0; offset <= sample.length - 4; offset++) {
    if (hasMagicAt(sample, LZ4_FRAME_MAGIC, offset)) return "LZ4";
    if (hasMagicAt(sample, ZSTD_FRAME_MAGIC, offset)) return "ZSTD";
  }
  return "UNKNOWN";
};

const extensionFor = (packedFileName: string): string => {
  const normalizedName = packedFileName.replaceAll("/", "\\");
  const baseName = normalizedName.slice(normalizedName.lastIndexOf("\\") + 1);
  const lastDot = baseName.lastIndexOf(".");
  return lastDot > 0 ? baseName.slice(lastDot).toLowerCase() : "<none>";
};

const defaultVanillaCsv = (): string | undefined => {
  const candidates = [
    nodePath.resolve(process.cwd(), VANILLA_GUARDRAIL_RELATIVE_PATH),
    nodePath.resolve(__dirname, "../../", VANILLA_GUARDRAIL_RELATIVE_PATH),
    typeof process.resourcesPath === "string"
      ? nodePath.join(process.resourcesPath, VANILLA_GUARDRAIL_RELATIVE_PATH)
      : undefined,
  ].filter((candidate): candidate is string => !!candidate);
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, "utf8");
    } catch {
      // Try the next development/packaged location.
    }
  }
  return undefined;
};

const unavailableCodec =
  (name: string): CompressionTransform =>
  () => {
    throw new Error(`${name} codec is unavailable`);
  };

/** Loads the native frame codecs only when an analysis actually benchmarks a file. */
export const createDefaultCompressionCodecs = (): CompressionCodecs => {
  let lz4:
    | {
        compressFrame: CompressionTransform;
        decompressFrame: CompressionTransform;
      }
    | undefined;
  try {
    lz4 = require("lz4-napi") as typeof lz4;
  } catch {
    lz4 = undefined;
  }

  let zstd:
    | {
        compress: (data: Buffer, level?: number) => Promise<Buffer>;
        decompress: (data: Buffer) => Promise<Buffer>;
      }
    | undefined;
  try {
    zstd = require("@mongodb-js/zstd") as typeof zstd;
  } catch {
    zstd = undefined;
  }
  return {
    lz4Compress: lz4?.compressFrame ?? unavailableCodec("LZ4"),
    lz4Decompress: lz4?.decompressFrame ?? unavailableCodec("LZ4"),
    zstdCompress: zstd ? (data) => zstd.compress(data, ZSTD_COMPRESSION_LEVEL) : unavailableCodec("ZSTD"),
    zstdDecompress: zstd?.decompress ?? unavailableCodec("ZSTD"),
  };
};

const mergeCodecs = (codecs?: Partial<CompressionCodecs>): CompressionCodecs => {
  const hasAllCodecs =
    !!codecs?.lz4Compress && !!codecs?.lz4Decompress && !!codecs?.zstdCompress && !!codecs?.zstdDecompress;
  const defaults = hasAllCodecs ? ({} as Partial<CompressionCodecs>) : createDefaultCompressionCodecs();
  return {
    lz4Compress: codecs?.lz4Compress ?? defaults.lz4Compress!,
    lz4Decompress: codecs?.lz4Decompress ?? defaults.lz4Decompress!,
    zstdCompress: codecs?.zstdCompress ?? defaults.zstdCompress!,
    zstdDecompress: codecs?.zstdDecompress ?? defaults.zstdDecompress!,
  };
};

interface PackReader {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
  close(): Promise<void>;
}

const openPackReader = async (packPath: string, options: CompressionAnalysisOptions): Promise<PackReader> => {
  const size = options.getPackSize ? await options.getPackSize(packPath) : (await fs.promises.stat(packPath)).size;
  if (options.readRange) {
    return {
      size,
      read: async (offset, length) => {
        const data = await options.readRange!(packPath, offset, length);
        if (data.length !== length) throw new Error(`short read at ${offset}: expected ${length}, got ${data.length}`);
        return data;
      },
      close: async () => undefined,
    };
  }
  const file = await fs.promises.open(packPath, "r");
  return {
    size,
    read: async (offset, length) => {
      const buffer = Buffer.alloc(length);
      let totalRead = 0;
      while (totalRead < length) {
        const readResult = await file.read(buffer, totalRead, length - totalRead, offset + totalRead);
        if (readResult.bytesRead === 0) break;
        totalRead += readResult.bytesRead;
      }
      if (totalRead !== length) throw new Error(`short read at ${offset}: expected ${length}, got ${totalRead}`);
      return buffer;
    },
    close: async () => {
      await file.close();
    },
  };
};

const report = (options: CompressionAnalysisOptions, progress: CompressionAnalysisProgress) => {
  try {
    options.onProgress?.(progress);
  } catch {
    // A progress consumer must never abort the read/benchmark job.
  }
};

const checkCanceled = (options: CompressionAnalysisOptions): void => {
  if (options.isCanceled?.()) throw new CompressionAnalysisCanceled();
};

const makeCodecResult = (codec: CompressionCodec, error: unknown): CompressionCodecResult => ({
  codec,
  error: asErrorMessage(error),
});

const benchmarkCodec = async (
  codec: CompressionCodec,
  data: Buffer,
  codecs: CompressionCodecs,
  options: CompressionAnalysisOptions,
): Promise<CompressionCodecResult> => {
  checkCanceled(options);
  try {
    const compressed = codec === "LZ4" ? await codecs.lz4Compress(data) : await codecs.zstdCompress(data);
    checkCanceled(options);
    const decompressed =
      codec === "LZ4" ? await codecs.lz4Decompress(compressed) : await codecs.zstdDecompress(compressed);
    checkCanceled(options);
    if (!Buffer.from(decompressed).equals(data)) {
      throw new Error("round-trip decompression was not byte-identical");
    }
    const compressedBytes = Buffer.from(compressed).length;
    return {
      codec,
      compressedBytes,
      ratioPercent: compressionRatioPercent(compressedBytes, data.length),
      ratio: compressionRatio(compressedBytes, data.length),
    };
  } catch (error) {
    if (error instanceof CompressionAnalysisCanceled) throw error;
    return makeCodecResult(codec, error);
  }
};

const addCodecWarning = (file: CompressionFileAnalysis, results: CompressionCodecResult[]) => {
  const failures = results.filter((result) => result.error).map((result) => `${result.codec}: ${result.error}`);
  if (failures.length > 0) file.warning = `Codec benchmark failure (${failures.join("; ")})`;
};

const methodCounts = (stats: ReturnType<typeof createEmptyMethodStats>): Record<CompressionMethod, number> => ({
  NONE: stats.NONE.count,
  LZ4: stats.LZ4.count,
  ZSTD: stats.ZSTD.count,
  UNKNOWN: stats.UNKNOWN.count,
});

const methodStoredBytes = (stats: ReturnType<typeof createEmptyMethodStats>): Record<CompressionMethod, number> => ({
  NONE: stats.NONE.storedBytes,
  LZ4: stats.LZ4.storedBytes,
  ZSTD: stats.ZSTD.storedBytes,
  UNKNOWN: stats.UNKNOWN.storedBytes,
});

const percentSaved = (bytesSaved: number, currentSize: number): number =>
  currentSize > 0 ? (bytesSaved / currentSize) * 100 : 0;

const buildEmptyOverall = (): CompressionAnalysisOverall => ({
  currentSize: 0,
  projectedSize: 0,
  bytesSaved: 0,
  wholePackPercentSaved: 0,
  projectedSizeIncludingRigidModelV2: 0,
  wholePackPercentSavedIncludingRigidModelV2: 0,
  packCount: 0,
  analyzedPackCount: 0,
  testedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  acceptedCount: 0,
  sampledRejectedCount: 0,
  existing: createEmptyMethodStats(),
  existingCounts: { NONE: 0, LZ4: 0, ZSTD: 0, UNKNOWN: 0 },
  existingStoredBytes: { NONE: 0, LZ4: 0, ZSTD: 0, UNKNOWN: 0 },
});

const buildOverall = (packs: CompressionPackAnalysis[], packCount: number): CompressionAnalysisOverall => {
  const overall = buildEmptyOverall();
  overall.packCount = packCount;
  for (const pack of packs) {
    overall.testedCount += pack.testedCount;
    overall.skippedCount += pack.skippedCount;
    overall.errorCount += pack.errorCount;
    overall.acceptedCount += pack.acceptedCount;
    overall.sampledRejectedCount += pack.sampledRejectedCount;
    for (const method of ["NONE", "LZ4", "ZSTD", "UNKNOWN"] as const) {
      overall.existing[method].count += pack.existing[method].count;
      overall.existing[method].storedBytes += pack.existing[method].storedBytes;
      overall.existingCounts[method] += pack.existing[method].count;
      overall.existingStoredBytes[method] += pack.existing[method].storedBytes;
    }
    if (!pack.success) continue;
    overall.analyzedPackCount++;
    overall.currentSize += pack.currentSize;
    overall.projectedSize += pack.projectedSize;
    overall.projectedSizeIncludingRigidModelV2 += pack.projectedSizeIncludingRigidModelV2;
  }
  overall.bytesSaved = overall.currentSize - overall.projectedSize;
  overall.wholePackPercentSaved = percentSaved(overall.bytesSaved, overall.currentSize);
  overall.wholePackPercentSavedIncludingRigidModelV2 = percentSaved(
    overall.currentSize - overall.projectedSizeIncludingRigidModelV2,
    overall.currentSize,
  );
  return overall;
};

const createFailedPack = (packPath: string, size: number, error: unknown): CompressionPackAnalysis => {
  const existing = createEmptyMethodStats();
  const message = asErrorMessage(error);
  return {
    packPath,
    packName: nodePath.basename(packPath),
    currentSize: size,
    projectedSize: size,
    bytesSaved: 0,
    wholePackPercentSaved: 0,
    projectedSizeIncludingRigidModelV2: size,
    wholePackPercentSavedIncludingRigidModelV2: 0,
    fileCount: 0,
    testedCount: 0,
    skippedCount: 0,
    errorCount: 1,
    acceptedCount: 0,
    sampledRejectedCount: 0,
    existing,
    existingCounts: methodCounts(existing),
    existingStoredBytes: methodStoredBytes(existing),
    topWins: [],
    rigidModelV2Wins: [],
    fileResults: [],
    warnings: [],
    errors: [message],
    success: false,
  };
};

const appendUnique = (items: string[], value: string) => {
  if (!items.includes(value)) items.push(value);
};

interface AnalyzePackContext {
  packIndex: number;
  packCount: number;
  records: Map<string, VanillaCompressionExtensionRecord>;
  codecs: CompressionCodecs;
}

const analyzeOnePack = async (
  packPath: string,
  options: CompressionAnalysisOptions,
  context: AnalyzePackContext,
): Promise<CompressionPackAnalysis> => {
  let reader: PackReader | undefined;
  let packSize = 0;
  try {
    reader = await openPackReader(packPath, options);
    packSize = reader.size;
    const headerBuffer = await reader.read(0, PFH5_HEADER_BYTES);
    const header = parsePFH5Header(headerBuffer, packSize);
    const indexStart = PFH5_HEADER_BYTES + header.dependencyIndexSize;
    const index = await reader.read(indexStart, header.packedFileIndexSize);
    const entries = parsePFH5Index(index, header);
    const existing = createEmptyMethodStats();
    const fileResults: CompressionFileAnalysis[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const pack: CompressionPackAnalysis = {
      packPath,
      packName: nodePath.basename(packPath),
      currentSize: packSize,
      projectedSize: packSize,
      bytesSaved: 0,
      wholePackPercentSaved: 0,
      projectedSizeIncludingRigidModelV2: packSize,
      wholePackPercentSavedIncludingRigidModelV2: 0,
      fileCount: entries.length,
      testedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      acceptedCount: 0,
      sampledRejectedCount: 0,
      existing,
      existingCounts: methodCounts(existing),
      existingStoredBytes: methodStoredBytes(existing),
      topWins: [],
      rigidModelV2Wins: [],
      fileResults,
      warnings,
      errors,
      success: true,
    };

    for (const [fileIndex, entry] of entries.entries()) {
      checkCanceled(options);
      report(options, {
        phase: "file",
        packIndex: context.packIndex,
        packCount: context.packCount,
        fileIndex,
        fileCount: entries.length,
        packPath,
        packName: pack.packName,
        fileName: entry.name,
        testedCount: pack.testedCount,
        skippedCount: pack.skippedCount,
        errorCount: pack.errorCount,
        acceptedCount: pack.acceptedCount,
      });

      let existingMethod: CompressionMethod = "NONE";
      if (entry.isCompressed) {
        try {
          const detectionSample = await reader.read(
            entry.payloadOffset,
            Math.min(entry.fileSize, COMPRESSION_DETECTION_SAMPLE_BYTES),
          );
          existingMethod = detectCompressionMethod(detectionSample);
        } catch (error) {
          existingMethod = "UNKNOWN";
          appendUnique(
            errors,
            `${entry.name}: could not inspect existing compressed payload (${asErrorMessage(error)})`,
          );
        }
      }
      existing[existingMethod].count++;
      existing[existingMethod].storedBytes += entry.fileSize;
      pack.existingCounts[existingMethod]++;
      pack.existingStoredBytes[existingMethod] += entry.fileSize;

      const extension = extensionFor(entry.name);
      const isRigidModelV2 = extension === ".rigid_model_v2";
      const file: CompressionFileAnalysis = {
        fileName: entry.name,
        extension,
        storedBytes: entry.fileSize,
        existingMethod,
        status: "skipped",
        isRigidModelV2,
      };
      fileResults.push(file);

      // Existing compressed payloads are intentionally not decompressed or recompressed.
      if (entry.isCompressed) {
        file.skipReason = "alreadyCompressed";
        pack.skippedCount++;
        continue;
      }
      file.originalBytes = entry.fileSize;
      const vanillaRecord = context.records.get(extension);
      file.noVanillaPrecedent = !vanillaRecord;
      if (ALWAYS_SKIP_EXTENSIONS.has(extension)) {
        file.skipReason = "guardrailNeverCompress";
        pack.skippedCount++;
        continue;
      }
      if (!vanillaRecord) {
        const warning = `No vanilla compression precedent for extension ${extension}`;
        file.warning = warning;
        appendUnique(warnings, warning);
      }
      if (isRigidModelV2) {
        const warning =
          ".rigid_model_v2 uses a cautious LZ4-only check; results are reported separately from primary totals";
        file.warning = file.warning ? `${file.warning}; ${warning}` : warning;
        appendUnique(warnings, warning);
      }
      if (vanillaRecordIsAllNone(vanillaRecord)) {
        file.skipReason = "vanillaExtensionIs100PercentNone";
        pack.skippedCount++;
        continue;
      }
      const threshold = getCompressionEligibilityThreshold(entry.fileSize);
      if (threshold === undefined) {
        file.skipReason = "belowMinimumSize";
        pack.skippedCount++;
        continue;
      }

      pack.testedCount++;
      const codecList: CompressionCodec[] = isRigidModelV2 ? ["LZ4"] : ["LZ4", "ZSTD"];
      const benchmarks: Partial<Record<CompressionCodec, CompressionCodecResult>> = {};
      if (entry.fileSize > LARGE_FILE_SAMPLE_THRESHOLD_BYTES) {
        const sampleOffsets = [
          0,
          Math.floor((entry.fileSize - LARGE_FILE_SAMPLE_BYTES) / 2),
          entry.fileSize - LARGE_FILE_SAMPLE_BYTES,
        ];
        const sampled = {} as Partial<Record<CompressionCodec, CompressionCodecResult>>;
        for (const codec of codecList) {
          let compressedBytes = 0;
          let originalBytes = 0;
          let failure: CompressionCodecResult | undefined;
          for (const sampleOffset of sampleOffsets) {
            checkCanceled(options);
            try {
              const sample = await reader.read(entry.payloadOffset + sampleOffset, LARGE_FILE_SAMPLE_BYTES);
              const benchmark = await benchmarkCodec(codec, sample, context.codecs, options);
              if (benchmark.error || benchmark.compressedBytes === undefined) {
                failure = benchmark;
                break;
              }
              compressedBytes += benchmark.compressedBytes;
              originalBytes += sample.length;
            } catch (error) {
              if (error instanceof CompressionAnalysisCanceled) throw error;
              failure = makeCodecResult(codec, error);
              break;
            }
          }
          sampled[codec] = failure || {
            codec,
            compressedBytes,
            ratioPercent: compressionRatioPercent(compressedBytes, originalBytes),
            ratio: compressionRatio(compressedBytes, originalBytes),
          };
        }
        const sampledResults = codecList.map((codec) => sampled[codec]!);
        const hasSamplePass = sampledResults.some(
          (result) => !result.error && result.ratioPercent !== undefined && result.ratioPercent < threshold,
        );
        if (!hasSamplePass) {
          addCodecWarning(file, sampledResults);
          if (sampledResults.some((result) => !result.error)) {
            file.status = "sampled-rejected";
            file.skipReason = "largeFileSamplesDidNotMeetThreshold";
            file.warning = file.warning
              ? `${file.warning}; samples did not meet the threshold; exact savings were not measured`
              : "Samples did not meet the threshold; exact savings were not measured";
            appendUnique(
              warnings,
              "One or more large files were rejected from samples; exact savings were not measured",
            );
            pack.sampledRejectedCount++;
            pack.skippedCount++;
          } else {
            file.status = "error";
            file.error = "All available codec samples failed";
            pack.errorCount++;
          }
          file.lz4 = sampled.LZ4;
          file.zstd = sampled.ZSTD;
          continue;
        }
        let data: Buffer;
        try {
          data = await reader.read(entry.payloadOffset, entry.fileSize);
        } catch (error) {
          file.status = "error";
          file.error = `Could not read payload: ${asErrorMessage(error)}`;
          pack.errorCount++;
          continue;
        }
        for (const codec of codecList) {
          benchmarks[codec] = await benchmarkCodec(codec, data, context.codecs, options);
        }
      } else {
        let data: Buffer;
        try {
          data = await reader.read(entry.payloadOffset, entry.fileSize);
        } catch (error) {
          file.status = "error";
          file.error = `Could not read payload: ${asErrorMessage(error)}`;
          pack.errorCount++;
          continue;
        }
        for (const codec of codecList) {
          benchmarks[codec] = await benchmarkCodec(codec, data, context.codecs, options);
        }
      }

      file.lz4 = benchmarks.LZ4;
      file.zstd = benchmarks.ZSTD;
      const benchmarkResults = codecList.map((codec) => benchmarks[codec]!).filter(Boolean);
      addCodecWarning(file, benchmarkResults);
      if (file.warning && file.warning.startsWith("Codec benchmark failure")) appendUnique(warnings, file.warning);
      const selectedCodec = chooseCompressionCodec(entry.fileSize, benchmarks);
      if (!selectedCodec) {
        if (benchmarkResults.length > 0 && benchmarkResults.every((result) => result.error)) {
          file.status = "error";
          file.error = "All available codec benchmarks failed";
          pack.errorCount++;
        } else {
          file.status = "skipped";
          file.skipReason = "compressionThresholdNotMet";
          pack.skippedCount++;
        }
        continue;
      }
      const selected = benchmarks[selectedCodec]!;
      file.status = "accepted";
      file.selectedCodec = selectedCodec;
      file.selectedRatioPercent = selected.ratioPercent;
      file.selectedRatio = selected.ratio;
      file.savingsBytes = entry.fileSize - selected.compressedBytes!;
      if (isRigidModelV2) {
        pack.rigidModelV2Wins.push(file as CompressionWin);
      } else {
        pack.acceptedCount++;
        pack.topWins.push(file as CompressionWin);
      }
    }

    pack.topWins.sort(
      (first, second) => second.savingsBytes - first.savingsBytes || first.fileName.localeCompare(second.fileName),
    );
    pack.topWins = pack.topWins.slice(0, TOP_COMPRESSION_WINS);
    pack.rigidModelV2Wins.sort(
      (first, second) => second.savingsBytes - first.savingsBytes || first.fileName.localeCompare(second.fileName),
    );
    // The top-ten list is display-only; every accepted file contributes to projections. Recalculate
    // from fileResults so wins beyond the ten shown remain part of the totals.
    const allPrimarySaved = fileResults.reduce(
      (sum, item) => sum + (item.status === "accepted" && !item.isRigidModelV2 ? item.savingsBytes || 0 : 0),
      0,
    );
    const allRigidSaved = fileResults.reduce(
      (sum, item) => sum + (item.status === "accepted" && item.isRigidModelV2 ? item.savingsBytes || 0 : 0),
      0,
    );
    pack.bytesSaved = allPrimarySaved;
    pack.projectedSize = Math.max(0, pack.currentSize - allPrimarySaved);
    pack.wholePackPercentSaved = percentSaved(allPrimarySaved, pack.currentSize);
    pack.projectedSizeIncludingRigidModelV2 = Math.max(0, pack.currentSize - allPrimarySaved - allRigidSaved);
    pack.wholePackPercentSavedIncludingRigidModelV2 = percentSaved(allPrimarySaved + allRigidSaved, pack.currentSize);
    report(options, {
      phase: "pack",
      packIndex: context.packIndex,
      packCount: context.packCount,
      fileIndex: entries.length,
      fileCount: entries.length,
      packPath,
      packName: pack.packName,
      testedCount: pack.testedCount,
      skippedCount: pack.skippedCount,
      errorCount: pack.errorCount,
      acceptedCount: pack.acceptedCount,
    });
    return pack;
  } finally {
    await reader?.close();
  }
};

const loadVanillaRecords = (options: CompressionAnalysisOptions): Map<string, VanillaCompressionExtensionRecord> => {
  if (options.vanillaRecords) return options.vanillaRecords;
  const csv = options.vanillaCsv ?? defaultVanillaCsv();
  return csv ? parseVanillaCompressionCsv(csv) : new Map();
};

export const analyzeCompressionPacks = async (
  packPaths: string[],
  options: CompressionAnalysisOptions = {},
): Promise<CompressionAnalysisResult> => {
  const uniquePackPaths = dedupePackPaths(packPaths);
  const packs: CompressionPackAnalysis[] = [];
  const records = loadVanillaRecords(options);
  const codecs = mergeCodecs(options.codecs);
  report(options, { phase: "starting", packIndex: 0, packCount: uniquePackPaths.length });
  for (let packIndex = 0; packIndex < uniquePackPaths.length; packIndex++) {
    const packPath = uniquePackPaths[packIndex];
    try {
      checkCanceled(options);
    } catch (error) {
      if (error instanceof CompressionAnalysisCanceled) {
        const overall = buildOverall(packs, uniquePackPaths.length);
        report(options, {
          phase: "canceled",
          packIndex,
          packCount: uniquePackPaths.length,
          packPath,
          packName: nodePath.basename(packPath),
          message: "Compression analysis canceled",
        });
        return { status: "canceled", packs, overall, requestedPackCount: packPaths.length };
      }
      throw error;
    }
    report(options, {
      phase: "pack",
      packIndex,
      packCount: uniquePackPaths.length,
      packPath,
      packName: nodePath.basename(packPath),
      message: `Reading ${nodePath.basename(packPath)}`,
    });
    let knownSize = 0;
    try {
      try {
        knownSize = options.getPackSize ? await options.getPackSize(packPath) : (await fs.promises.stat(packPath)).size;
      } catch {
        knownSize = 0;
      }
      const pack = await analyzeOnePack(packPath, options, {
        packIndex,
        packCount: uniquePackPaths.length,
        records,
        codecs,
      });
      packs.push(pack);
    } catch (error) {
      if (error instanceof CompressionAnalysisCanceled) {
        const overall = buildOverall(packs, uniquePackPaths.length);
        report(options, {
          phase: "canceled",
          packIndex,
          packCount: uniquePackPaths.length,
          packPath,
          packName: nodePath.basename(packPath),
          message: "Compression analysis canceled",
        });
        return { status: "canceled", packs, overall, requestedPackCount: packPaths.length };
      }
      const failedPack = createFailedPack(packPath, knownSize, error);
      packs.push(failedPack);
      report(options, {
        phase: "error",
        packIndex,
        packCount: uniquePackPaths.length,
        packPath,
        packName: failedPack.packName,
        errorCount: failedPack.errorCount,
        message: failedPack.errors[0],
      });
    }
  }
  const overall = buildOverall(packs, uniquePackPaths.length);
  report(options, {
    phase: "complete",
    packIndex: uniquePackPaths.length,
    packCount: uniquePackPaths.length,
    testedCount: overall.testedCount,
    skippedCount: overall.skippedCount,
    errorCount: overall.errorCount,
    acceptedCount: overall.acceptedCount,
  });
  return { status: "completed", packs, overall, requestedPackCount: packPaths.length };
};

/** Concise alias for callers that call the operation a job rather than a pack analysis. */
export const runCompressionAnalysis = analyzeCompressionPacks;
