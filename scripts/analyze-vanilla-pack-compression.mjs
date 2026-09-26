#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as zlib from "node:zlib";

const PACK_HEADER_BYTES = 28;
const FILE_NAME_HASH_MASK = 0x40;
const COMPRESSION_SAMPLE_BYTES = 64;
const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const LZ4_FRAME_MAGIC = Buffer.from([0x04, 0x22, 0x4d, 0x18]);
const METHODS = ["NONE", "LZ4", "ZSTD", "UNKNOWN"];
const RIGID_MODEL_V2_EXTENSION = ".rigid_model_v2";
const RIGID_MODEL_CONTENT_SAMPLE_BYTES = 32;
const MAX_RIGID_MODEL_DECOMPRESSION_BYTES = 512 * 1024 * 1024;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, "..");
const defaultOutputPath = path.join(repositoryDirectory, "scripts", "out", "vanilla-pack-compression-by-extension.csv");
const defaultRigidModelOutputPath = path.join(
  repositoryDirectory,
  "scripts",
  "out",
  "vanilla-rigid-model-v2-files.csv",
);
const defaultRigidModelSummaryPath = path.join(
  repositoryDirectory,
  "scripts",
  "out",
  "vanilla-rigid-model-v2-summary.csv",
);

const require = createRequire(import.meta.url);

const usage = () => {
  console.error(
    "Usage: node scripts/analyze-vanilla-pack-compression.mjs <game-data-folder> [output.csv] " +
      "[--rigid-report files.csv] [--rigid-summary summary.csv]",
  );
  console.error("");
  console.error("The data folder must contain manifest.txt. Only .pack files listed in that manifest are analyzed.");
  console.error("The rigid-model reports are written to scripts/out by default.");
};

const fail = (message) => {
  console.error(`Error: ${message}`);
  usage();
  process.exitCode = 1;
};

const csvCell = (value) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const percent = (count, total) => (total === 0 ? "0.00" : ((count / total) * 100).toFixed(2));

const extensionFor = (packedFileName) => {
  const normalizedName = packedFileName.replaceAll("/", "\\");
  const baseName = normalizedName.slice(normalizedName.lastIndexOf("\\") + 1);
  const lastDot = baseName.lastIndexOf(".");
  return lastDot > 0 ? baseName.slice(lastDot).toLowerCase() : "<none>";
};

const packedFilePathParts = (packedFileName) => {
  const normalizedName = packedFileName.replaceAll("/", "\\");
  const lastSeparator = normalizedName.lastIndexOf("\\");
  const baseName = normalizedName.slice(lastSeparator + 1);
  const directory = lastSeparator >= 0 ? normalizedName.slice(0, lastSeparator) : "<root>";
  const directoryParts = directory === "<root>" ? [] : directory.split("\\").filter(Boolean);
  return {
    normalizedName,
    directory,
    baseName,
    directoryDepth1: directoryParts.slice(0, 1).join("\\") || "<root>",
    directoryDepth2: directoryParts.slice(0, 2).join("\\") || "<root>",
    directoryDepth3: directoryParts.slice(0, 3).join("\\") || "<root>",
  };
};

const hasMagicAt = (buffer, magic, offset) =>
  offset + magic.length <= buffer.length && buffer.subarray(offset, offset + magic.length).equals(magic);

const findCompressionFrame = (buffer) => {
  for (let offset = 0; offset <= buffer.length - 4; offset++) {
    if (hasMagicAt(buffer, LZ4_FRAME_MAGIC, offset)) return { method: "LZ4", offset };
    if (hasMagicAt(buffer, ZSTD_FRAME_MAGIC, offset)) return { method: "ZSTD", offset };
  }
  return { method: "UNKNOWN", offset: undefined };
};

const readFileRange = (fileDescriptor, startPosition, length) => {
  const buffer = Buffer.alloc(length);
  let totalRead = 0;
  while (totalRead < length) {
    const bytesRead = fs.readSync(fileDescriptor, buffer, totalRead, length - totalRead, startPosition + totalRead);
    if (bytesRead === 0) break;
    totalRead += bytesRead;
  }
  if (totalRead !== length) {
    throw new Error(`short read at ${startPosition}: expected ${length}, got ${totalRead}`);
  }
  return buffer;
};

const formatBinaryBytes = (bytes) => {
  if (bytes >= 1024 * 1024 * 1024) return `${bytes / (1024 * 1024 * 1024)} GiB`;
  if (bytes >= 1024 * 1024) return `${bytes / (1024 * 1024)} MiB`;
  if (bytes >= 1024) return `${bytes / 1024} KiB`;
  return `${bytes} B`;
};

const rigidModelSizeBucket = (bytes) => {
  if (!Number.isFinite(bytes)) return "<unknown>";
  if (bytes < 4 * 1024) return "<4 KiB";
  let lowerBound = 4 * 1024;
  while (bytes >= lowerBound * 2) lowerBound *= 2;
  return `${formatBinaryBytes(lowerBound)}-<${formatBinaryBytes(lowerBound * 2)}`;
};

const tryLoadRigidModelDecompressors = () => {
  let lz4;
  try {
    const module = require("lz4-napi");
    if (typeof module.decompressFrameSync === "function") lz4 = module.decompressFrameSync;
  } catch {
    // The detailed report remains useful without the optional native LZ4 module.
  }

  const zstd = typeof zlib.zstdDecompressSync === "function" ? zlib.zstdDecompressSync : undefined;
  return { lz4, zstd };
};

let rigidModelDecompressors;

const decompressRigidModel = (method, payload, frameOffset) => {
  if (payload.length > MAX_RIGID_MODEL_DECOMPRESSION_BYTES) {
    throw new Error(
      `payload is larger than the ${formatBinaryBytes(MAX_RIGID_MODEL_DECOMPRESSION_BYTES)} safety limit`,
    );
  }

  rigidModelDecompressors ??= tryLoadRigidModelDecompressors();
  const frame = payload.subarray(frameOffset ?? 0);
  if (method === "LZ4") {
    if (!rigidModelDecompressors.lz4) throw new Error("lz4-napi is unavailable");
    return Buffer.from(rigidModelDecompressors.lz4(frame));
  }
  if (method === "ZSTD") {
    if (!rigidModelDecompressors.zstd) throw new Error("node:zlib zstdDecompressSync is unavailable");
    return Buffer.from(rigidModelDecompressors.zstd(frame));
  }
  throw new Error(`no decompressor for ${method}`);
};

const inspectRigidModel = (fileDescriptor, entry, method, frameOffset) => {
  const result = {
    frameOffset,
    originalBytes: entry.isCompressed ? undefined : entry.fileSize,
    originalSizeSource: entry.isCompressed ? "unknown" : "uncompressed-payload",
    compressionRatioPercent: entry.isCompressed ? undefined : 100,
    contentPrefixHex: undefined,
    decompressionStatus: entry.isCompressed ? "not-attempted" : "not-needed",
    decompressionError: undefined,
  };

  try {
    if (!entry.isCompressed) {
      const content = readFileRange(
        fileDescriptor,
        entry.payloadOffset,
        Math.min(entry.fileSize, RIGID_MODEL_CONTENT_SAMPLE_BYTES),
      );
      result.contentPrefixHex = content.toString("hex");
      return result;
    }

    if (method !== "LZ4" && method !== "ZSTD") {
      result.decompressionStatus = "unsupported-method";
      return result;
    }

    const payload = readFileRange(fileDescriptor, entry.payloadOffset, entry.fileSize);
    const decompressed = decompressRigidModel(method, payload, frameOffset);
    result.originalBytes = decompressed.length;
    result.originalSizeSource = "decompressed-payload";
    result.compressionRatioPercent = decompressed.length > 0 ? (entry.fileSize / decompressed.length) * 100 : undefined;
    result.contentPrefixHex = decompressed.subarray(0, RIGID_MODEL_CONTENT_SAMPLE_BYTES).toString("hex");
    result.decompressionStatus = "ok";
  } catch (error) {
    result.decompressionStatus = "error";
    result.decompressionError = error instanceof Error ? error.message : String(error);
  }

  return result;
};

const readManifestPackNames = (dataFolder) => {
  const manifestPath = path.join(dataFolder, "manifest.txt");
  const manifest = fs.readFileSync(manifestPath, "utf8");
  const packNames = [];

  for (const line of manifest.split(/\r?\n/)) {
    const firstField = line.trim().split(/\s+/, 1)[0];
    if (firstField && firstField.toLowerCase().endsWith(".pack") && !packNames.includes(firstField)) {
      packNames.push(firstField);
    }
  }

  return { manifestPath, packNames };
};

const readPackHeader = (fileDescriptor, packPath) => {
  const header = Buffer.alloc(PACK_HEADER_BYTES);
  const bytesRead = fs.readSync(fileDescriptor, header, 0, header.length, 0);
  if (bytesRead !== header.length) throw new Error("header is truncated");
  const format = header.toString("ascii", 0, 4);
  if (!["PFH3", "PFH4", "PFH5"].includes(format)) throw new Error(`unsupported header ${format}`);

  const byteMask = header.readUInt32LE(4);
  const dependencyIndexSize = header.readUInt32LE(12);
  const fileCount = header.readUInt32LE(16);
  const packedFileIndexSize = header.readUInt32LE(20);
  const packSize = fs.fstatSync(fileDescriptor).size;
  const dataStart = PACK_HEADER_BYTES + dependencyIndexSize + packedFileIndexSize;

  if (dataStart > packSize) {
    throw new Error(`index extends past the end of the pack (${packPath})`);
  }

  return {
    format,
    byteMask,
    fileCount,
    packedFileIndexSize,
    dependencyIndexSize,
    packSize,
    dataStart,
    // PFH5 stores the one-byte per-file compression flag even in the 0x40 hashed-name variant.
    // PFH3/PFH4 games supported by WHMM do not use per-file compression flags.
    hasCompressionFlag: format === "PFH5",
    hasFileNameHash: (byteMask & FILE_NAME_HASH_MASK) !== 0,
  };
};

const addFileToStats = (statsByExtension, extension, method) => {
  let stats = statsByExtension.get(extension);
  if (!stats) {
    stats = Object.fromEntries(METHODS.map((name) => [name, 0]));
    statsByExtension.set(extension, stats);
  }
  stats[method] += 1;
};

const addRigidModelRecord = (rigidModelRecords, packPath, entry, method, frameOffset, inspection) => {
  const pathParts = packedFilePathParts(entry.name);
  rigidModelRecords.push({
    packName: path.basename(packPath),
    fileNumber: entry.fileNumber,
    fileName: pathParts.normalizedName,
    directory: pathParts.directory,
    directoryDepth1: pathParts.directoryDepth1,
    directoryDepth2: pathParts.directoryDepth2,
    directoryDepth3: pathParts.directoryDepth3,
    baseName: pathParts.baseName,
    payloadOffset: entry.payloadOffset,
    storedBytes: entry.fileSize,
    compressionFlag: entry.isCompressed ? 1 : 0,
    compressionMethod: method,
    frameOffset,
    originalBytes: inspection.originalBytes,
    originalSizeSource: inspection.originalSizeSource,
    compressionRatioPercent: inspection.compressionRatioPercent,
    contentPrefixHex: inspection.contentPrefixHex,
    decompressionStatus: inspection.decompressionStatus,
    decompressionError: inspection.decompressionError,
  });
};

const createRigidGroupStats = () => ({
  totalFiles: 0,
  counts: Object.fromEntries(METHODS.map((method) => [method, 0])),
  storedBytes: 0,
  knownOriginalFiles: 0,
  knownOriginalBytes: 0,
  minOriginalBytes: Number.POSITIVE_INFINITY,
  maxOriginalBytes: 0,
  compressedStoredBytes: 0,
  compressedOriginalBytes: 0,
});

const addRigidModelGroup = (groups, groupType, group, record) => {
  const key = `${groupType}\0${group}`;
  let stats = groups.get(key);
  if (!stats) {
    stats = { groupType, group, ...createRigidGroupStats() };
    groups.set(key, stats);
  }

  stats.totalFiles++;
  stats.counts[record.compressionMethod]++;
  stats.storedBytes += record.storedBytes;
  if (record.compressionMethod !== "NONE") stats.compressedStoredBytes += record.storedBytes;
  if (Number.isFinite(record.originalBytes)) {
    stats.knownOriginalFiles++;
    stats.knownOriginalBytes += record.originalBytes;
    stats.minOriginalBytes = Math.min(stats.minOriginalBytes, record.originalBytes);
    stats.maxOriginalBytes = Math.max(stats.maxOriginalBytes, record.originalBytes);
    if (record.compressionMethod !== "NONE") stats.compressedOriginalBytes += record.originalBytes;
  }
};

const buildRigidModelGroups = (rigidModelRecords) => {
  const groups = new Map();
  for (const record of rigidModelRecords) {
    addRigidModelGroup(groups, "pack", record.packName, record);
    addRigidModelGroup(groups, "directory_depth_1", record.directoryDepth1, record);
    addRigidModelGroup(groups, "directory_depth_2", record.directoryDepth2, record);
    addRigidModelGroup(groups, "directory_depth_3", record.directoryDepth3, record);
    addRigidModelGroup(groups, "original_size_bucket", rigidModelSizeBucket(record.originalBytes), record);
    addRigidModelGroup(groups, "content_prefix", record.contentPrefixHex || "<unknown>", record);
  }
  return groups;
};

const rigidGroupSortOrder = {
  pack: 0,
  directory_depth_1: 1,
  directory_depth_2: 2,
  directory_depth_3: 3,
  original_size_bucket: 4,
  content_prefix: 5,
};

const rigidGroupRow = (stats) => {
  const compressedCount = stats.totalFiles - stats.counts.NONE;
  const knownAverage = stats.knownOriginalFiles > 0 ? stats.knownOriginalBytes / stats.knownOriginalFiles : undefined;
  const compressedRatio =
    stats.compressedOriginalBytes > 0 ? (stats.compressedStoredBytes / stats.compressedOriginalBytes) * 100 : undefined;
  return [
    stats.groupType,
    stats.group,
    stats.totalFiles,
    stats.counts.NONE,
    percent(stats.counts.NONE, stats.totalFiles),
    stats.counts.LZ4,
    percent(stats.counts.LZ4, stats.totalFiles),
    stats.counts.ZSTD,
    percent(stats.counts.ZSTD, stats.totalFiles),
    stats.counts.UNKNOWN,
    percent(stats.counts.UNKNOWN, stats.totalFiles),
    compressedCount,
    percent(compressedCount, stats.totalFiles),
    stats.storedBytes,
    stats.knownOriginalFiles,
    stats.knownOriginalBytes,
    stats.minOriginalBytes === Number.POSITIVE_INFINITY ? "" : stats.minOriginalBytes,
    stats.maxOriginalBytes || "",
    knownAverage === undefined ? "" : knownAverage.toFixed(2),
    stats.compressedStoredBytes,
    stats.compressedOriginalBytes || "",
    compressedRatio === undefined ? "" : compressedRatio.toFixed(2),
  ];
};

const writeRigidModelReports = (rigidModelOutputPath, rigidModelSummaryPath, rigidModelRecords) => {
  const fileColumns = [
    "pack_name",
    "file_number",
    "file_name",
    "directory",
    "directory_depth_1",
    "directory_depth_2",
    "directory_depth_3",
    "base_name",
    "payload_offset",
    "stored_bytes",
    "compression_flag",
    "compression_method",
    "frame_offset",
    "original_bytes",
    "original_size_source",
    "compression_ratio_percent",
    "content_prefix_hex",
    "decompression_status",
    "decompression_error",
  ];
  const fileLines = [fileColumns.join(",")];
  for (const record of [...rigidModelRecords].sort(
    (first, second) => first.packName.localeCompare(second.packName) || first.fileName.localeCompare(second.fileName),
  )) {
    fileLines.push(
      [
        record.packName,
        record.fileNumber,
        record.fileName,
        record.directory,
        record.directoryDepth1,
        record.directoryDepth2,
        record.directoryDepth3,
        record.baseName,
        record.payloadOffset,
        record.storedBytes,
        record.compressionFlag,
        record.compressionMethod,
        record.frameOffset ?? "",
        record.originalBytes ?? "",
        record.originalSizeSource,
        record.compressionRatioPercent === undefined ? "" : record.compressionRatioPercent.toFixed(2),
        record.contentPrefixHex || "",
        record.decompressionStatus,
        record.decompressionError || "",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const summaryColumns = [
    "group_type",
    "group",
    "total_files",
    "NONE_count",
    "NONE_percent",
    "LZ4_count",
    "LZ4_percent",
    "ZSTD_count",
    "ZSTD_percent",
    "UNKNOWN_count",
    "UNKNOWN_percent",
    "compressed_count",
    "compressed_percent",
    "stored_bytes",
    "known_original_size_files",
    "known_original_bytes",
    "minimum_original_bytes",
    "maximum_original_bytes",
    "average_original_bytes",
    "compressed_stored_bytes",
    "compressed_original_bytes",
    "compressed_ratio_percent",
  ];
  const summaryLines = [summaryColumns.join(",")];
  const groups = buildRigidModelGroups(rigidModelRecords);
  const sizeBucketOrder = new Map();
  for (const record of rigidModelRecords) {
    const bucket = rigidModelSizeBucket(record.originalBytes);
    if (!sizeBucketOrder.has(bucket))
      sizeBucketOrder.set(bucket, Number(record.originalBytes) || Number.MAX_SAFE_INTEGER);
  }
  for (const stats of [...groups.values()].sort((first, second) => {
    const typeOrder =
      (rigidGroupSortOrder[first.groupType] ?? Number.MAX_SAFE_INTEGER) -
      (rigidGroupSortOrder[second.groupType] ?? Number.MAX_SAFE_INTEGER);
    if (typeOrder !== 0) return typeOrder;
    if (first.groupType === "original_size_bucket") {
      const sizeOrder =
        (sizeBucketOrder.get(first.group) ?? Number.MAX_SAFE_INTEGER) -
        (sizeBucketOrder.get(second.group) ?? Number.MAX_SAFE_INTEGER);
      if (sizeOrder !== 0) return sizeOrder;
    }
    return first.group.localeCompare(second.group);
  })) {
    summaryLines.push(rigidGroupRow(stats).map(csvCell).join(","));
  }

  fs.mkdirSync(path.dirname(rigidModelOutputPath), { recursive: true });
  fs.mkdirSync(path.dirname(rigidModelSummaryPath), { recursive: true });
  fs.writeFileSync(rigidModelOutputPath, `${fileLines.join("\n")}\n`, "utf8");
  fs.writeFileSync(rigidModelSummaryPath, `${summaryLines.join("\n")}\n`, "utf8");
};

const methodCountsForRigidModels = (rigidModelRecords) => {
  const counts = Object.fromEntries(METHODS.map((method) => [method, 0]));
  for (const record of rigidModelRecords) counts[record.compressionMethod]++;
  return counts;
};

const printRigidModelPatternSummary = (rigidModelRecords) => {
  const total = rigidModelRecords.length;
  if (total === 0) {
    console.log(`No ${RIGID_MODEL_V2_EXTENSION} files were found.`);
    return;
  }

  const counts = methodCountsForRigidModels(rigidModelRecords);
  console.log(
    `${RIGID_MODEL_V2_EXTENSION}: ${total.toLocaleString()} files — ` +
      METHODS.map((method) => `${method} ${counts[method].toLocaleString()} (${percent(counts[method], total)}%)`).join(
        ", ",
      ),
  );

  const groups = buildRigidModelGroups(rigidModelRecords);
  const sizeGroups = [...groups.values()]
    .filter((group) => group.groupType === "original_size_bucket")
    .sort((first, second) => {
      const firstSize =
        first.minOriginalBytes === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : first.minOriginalBytes;
      const secondSize =
        second.minOriginalBytes === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : second.minOriginalBytes;
      return firstSize - secondSize;
    });
  console.log("Original-size buckets (compressed files use the decompressed size when available):");
  for (const group of sizeGroups) {
    const compressedCount = group.totalFiles - group.counts.NONE;
    console.log(
      `  ${group.group}: ${group.totalFiles.toLocaleString()} files, ` +
        `${compressedCount.toLocaleString()} compressed (${percent(compressedCount, group.totalFiles)}%), ` +
        `LZ4 ${group.counts.LZ4.toLocaleString()}, ZSTD ${group.counts.ZSTD.toLocaleString()}, ` +
        `NONE ${group.counts.NONE.toLocaleString()}`,
    );
  }

  const directoryGroups = [...groups.values()]
    .filter((group) => group.groupType === "directory_depth_3" && group.totalFiles >= 20)
    .sort((first, second) => {
      const firstRate = (first.totalFiles - first.counts.NONE) / first.totalFiles;
      const secondRate = (second.totalFiles - second.counts.NONE) / second.totalFiles;
      return secondRate - firstRate || second.totalFiles - first.totalFiles || first.group.localeCompare(second.group);
    });
  if (directoryGroups.length > 0) {
    console.log("Directory groups with at least 20 files, highest compressed share first (top 10):");
    for (const group of directoryGroups.slice(0, 10)) {
      const compressedCount = group.totalFiles - group.counts.NONE;
      console.log(
        `  ${group.group}: ${compressedCount}/${group.totalFiles} compressed ` +
          `(${percent(compressedCount, group.totalFiles)}%), LZ4 ${group.counts.LZ4}, ZSTD ${group.counts.ZSTD}`,
      );
    }
  }
};

const analyzePack = (packPath, statsByExtension, rigidModelRecords) => {
  const fileDescriptor = fs.openSync(packPath, "r");
  try {
    const header = readPackHeader(fileDescriptor, packPath);
    const index = Buffer.allocUnsafe(header.packedFileIndexSize);
    const indexStart = PACK_HEADER_BYTES + header.dependencyIndexSize;
    const bytesRead = fs.readSync(fileDescriptor, index, 0, index.length, indexStart);
    if (bytesRead !== index.length) throw new Error("packed-file index is truncated");

    let indexPosition = 0;
    let dataPosition = header.dataStart;
    let compressedFileCount = 0;
    for (let fileNumber = 0; fileNumber < header.fileCount; fileNumber++) {
      if (indexPosition + 4 > index.length) throw new Error(`file ${fileNumber}: missing file size`);
      const fileSize = index.readUInt32LE(indexPosition);
      indexPosition += 4;

      if (header.hasFileNameHash) {
        if (indexPosition + 4 > index.length) throw new Error(`file ${fileNumber}: missing file-name hash`);
        indexPosition += 4;
      }

      let isCompressed = false;
      if (header.hasCompressionFlag) {
        if (indexPosition + 1 > index.length) throw new Error(`file ${fileNumber}: missing compression flag`);
        isCompressed = index[indexPosition] === 1;
        indexPosition += 1;
      }

      const nameEnd = index.indexOf(0, indexPosition);
      if (nameEnd === -1) throw new Error(`file ${fileNumber}: unterminated file name`);
      const packedFileName = index.toString("utf8", indexPosition, nameEnd);
      indexPosition = nameEnd + 1;

      if (dataPosition + fileSize > header.packSize) {
        throw new Error(`file ${fileNumber}: payload extends past the end of the pack`);
      }
      let method = "NONE";
      let frameOffset;
      if (isCompressed) {
        if (fileSize === 0) {
          method = "UNKNOWN";
        } else {
          const sampleSize = Math.min(COMPRESSION_SAMPLE_BYTES, fileSize);
          const sample = readFileRange(fileDescriptor, dataPosition, sampleSize);
          const frame = findCompressionFrame(sample);
          method = frame.method;
          frameOffset = frame.offset;
        }
      }
      addFileToStats(statsByExtension, extensionFor(packedFileName), method);
      if (extensionFor(packedFileName) === RIGID_MODEL_V2_EXTENSION) {
        const entry = {
          fileNumber,
          name: packedFileName,
          fileSize,
          isCompressed,
          payloadOffset: dataPosition,
        };
        const inspection = inspectRigidModel(fileDescriptor, entry, method, frameOffset);
        addRigidModelRecord(rigidModelRecords, packPath, entry, method, frameOffset, inspection);
      }
      if (isCompressed) compressedFileCount += 1;
      dataPosition += fileSize;
    }

    if (indexPosition !== index.length) {
      throw new Error(`packed-file index has ${index.length - indexPosition} unparsed byte(s)`);
    }

    return { fileCount: header.fileCount, compressedFileCount };
  } finally {
    fs.closeSync(fileDescriptor);
  }
};

const writeReport = (outputPath, statsByExtension) => {
  const columns = [
    "extension",
    "total_files",
    "NONE_count",
    "NONE_percent",
    "LZ4_count",
    "LZ4_percent",
    "ZSTD_count",
    "ZSTD_percent",
    "UNKNOWN_count",
    "UNKNOWN_percent",
  ];
  const lines = [columns.join(",")];

  for (const [extension, stats] of [...statsByExtension.entries()].sort(([first], [second]) =>
    first.localeCompare(second),
  )) {
    const total = METHODS.reduce((sum, method) => sum + stats[method], 0);
    lines.push(
      [
        extension,
        total,
        stats.NONE,
        percent(stats.NONE, total),
        stats.LZ4,
        percent(stats.LZ4, total),
        stats.ZSTD,
        percent(stats.ZSTD, total),
        stats.UNKNOWN,
        percent(stats.UNKNOWN, total),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
};

const parseArguments = (argumentsList) => {
  const positional = [];
  let rigidModelOutputPath = defaultRigidModelOutputPath;
  let rigidModelSummaryPath = defaultRigidModelSummaryPath;
  let showHelp = false;

  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    if (argument === "-h" || argument === "--help") {
      showHelp = true;
      continue;
    }
    if (argument === "--rigid-report" || argument === "--rigid-summary") {
      const value = argumentsList[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path`);
      if (argument === "--rigid-report") rigidModelOutputPath = path.resolve(value);
      else rigidModelSummaryPath = path.resolve(value);
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`unknown option ${argument}`);
    positional.push(argument);
  }

  if (positional.length > 2) throw new Error("too many positional arguments");
  return {
    dataFolderArgument: positional[0],
    outputArgument: positional[1],
    rigidModelOutputPath,
    rigidModelSummaryPath,
    showHelp,
  };
};

export const main = (argumentsList = process.argv.slice(2)) => {
  const { dataFolderArgument, outputArgument, rigidModelOutputPath, rigidModelSummaryPath, showHelp } =
    parseArguments(argumentsList);
  if (!dataFolderArgument || showHelp) {
    usage();
    process.exitCode = showHelp ? 0 : 1;
    return;
  }

  const dataFolder = path.resolve(dataFolderArgument);
  const outputPath = path.resolve(outputArgument ?? defaultOutputPath);
  const { manifestPath, packNames } = readManifestPackNames(dataFolder);
  const statsByExtension = new Map();
  const rigidModelRecords = [];
  const missingPacks = [];
  const packErrors = [];
  let analyzedPackCount = 0;
  let analyzedFileCount = 0;

  for (const packName of packNames) {
    const packPath = path.join(dataFolder, packName);
    if (!fs.existsSync(packPath)) {
      missingPacks.push(packName);
      continue;
    }

    try {
      const result = analyzePack(packPath, statsByExtension, rigidModelRecords);
      analyzedPackCount += 1;
      analyzedFileCount += result.fileCount;
    } catch (error) {
      packErrors.push(`${packName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (packErrors.length > 0) {
    for (const error of packErrors) console.error(`Error: ${error}`);
    process.exitCode = 1;
    return;
  }

  writeReport(outputPath, statsByExtension);
  writeRigidModelReports(rigidModelOutputPath, rigidModelSummaryPath, rigidModelRecords);

  const totals = Object.fromEntries(METHODS.map((method) => [method, 0]));
  for (const stats of statsByExtension.values()) {
    for (const method of METHODS) totals[method] += stats[method];
  }

  console.log(`Manifest: ${manifestPath}`);
  console.log(
    `Analyzed ${analyzedPackCount}/${packNames.length} vanilla packs and ${analyzedFileCount.toLocaleString()} files.`,
  );
  console.log(
    `Compression methods: NONE ${totals.NONE.toLocaleString()}, LZ4 ${totals.LZ4.toLocaleString()}, ` +
      `ZSTD ${totals.ZSTD.toLocaleString()}, UNKNOWN ${totals.UNKNOWN.toLocaleString()}.`,
  );
  if (missingPacks.length > 0) {
    console.warn(`Missing manifest packs (${missingPacks.length}): ${missingPacks.join(", ")}`);
  }
  console.log(`Report: ${outputPath}`);
  printRigidModelPatternSummary(rigidModelRecords);
  console.log(`Rigid-model files: ${rigidModelOutputPath}`);
  console.log(`Rigid-model summary: ${rigidModelSummaryPath}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
