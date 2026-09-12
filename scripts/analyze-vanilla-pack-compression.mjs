#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACK_HEADER_BYTES = 28;
const FILE_NAME_HASH_MASK = 0x40;
const COMPRESSION_SAMPLE_BYTES = 64;
const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const LZ4_FRAME_MAGIC = Buffer.from([0x04, 0x22, 0x4d, 0x18]);
const METHODS = ["NONE", "LZ4", "ZSTD", "UNKNOWN"];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, "..");
const defaultOutputPath = path.join(repositoryDirectory, "scripts", "out", "vanilla-pack-compression-by-extension.csv");

const usage = () => {
  console.error("Usage: node scripts/analyze-vanilla-pack-compression.mjs <game-data-folder> [output.csv]");
  console.error("");
  console.error("The data folder must contain manifest.txt. Only .pack files listed in that manifest are analyzed.");
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

const hasMagicAt = (buffer, magic, offset) =>
  offset + magic.length <= buffer.length && buffer.subarray(offset, offset + magic.length).equals(magic);

const detectCompressionMethod = (fileDescriptor, startPosition, fileSize) => {
  if (fileSize === 0) return "UNKNOWN";

  const sampleSize = Math.min(COMPRESSION_SAMPLE_BYTES, fileSize);
  const sample = Buffer.allocUnsafe(sampleSize);
  const bytesRead = fs.readSync(fileDescriptor, sample, 0, sampleSize, startPosition);
  const bytes = sample.subarray(0, bytesRead);

  for (let offset = 0; offset <= bytes.length - 4; offset++) {
    if (hasMagicAt(bytes, LZ4_FRAME_MAGIC, offset)) return "LZ4";
    if (hasMagicAt(bytes, ZSTD_FRAME_MAGIC, offset)) return "ZSTD";
  }

  return "UNKNOWN";
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

const analyzePack = (packPath, statsByExtension) => {
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
      const method = isCompressed ? detectCompressionMethod(fileDescriptor, dataPosition, fileSize) : "NONE";
      addFileToStats(statsByExtension, extensionFor(packedFileName), method);
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

const main = () => {
  const [dataFolderArgument, outputArgument] = process.argv.slice(2);
  if (!dataFolderArgument || dataFolderArgument === "-h" || dataFolderArgument === "--help") {
    usage();
    process.exitCode = dataFolderArgument ? 0 : 1;
    return;
  }

  const dataFolder = path.resolve(dataFolderArgument);
  const outputPath = path.resolve(outputArgument ?? defaultOutputPath);
  const { manifestPath, packNames } = readManifestPackNames(dataFolder);
  const statsByExtension = new Map();
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
      const result = analyzePack(packPath, statsByExtension);
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
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
