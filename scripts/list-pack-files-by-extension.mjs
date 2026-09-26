#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACK_HEADER_BYTES = 28;
const FILE_NAME_HASH_MASK = 0x40;
const COMPRESSION_SAMPLE_BYTES = 64;
const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const LZ4_FRAME_MAGIC = Buffer.from([0x04, 0x22, 0x4d, 0x18]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, "..");

const usage = () => {
  console.error(
    "Usage: node scripts/list-pack-files-by-extension.mjs <game-data-folder> <extension> [output.csv]",
  );
  console.error("");
  console.error("Examples:");
  console.error(
    "  node scripts/list-pack-files-by-extension.mjs \"C:\\\\Program Files (x86)\\\\Steam\\\\steamapps\\\\common\\\\Total War WARHAMMER III\\\\data\" .rigid_model_v2",
  );
  console.error(
    "  node scripts/list-pack-files-by-extension.mjs \"K:\\\\Steam\\\\steamapps\\\\common\\\\Total War WARHAMMER III\\\\data\" wsmodel output.csv",
  );
  console.error("");
  console.error("The data folder must contain manifest.txt. Only .pack files listed in that manifest are scanned.");
  console.error("The extension is case-insensitive and may be supplied with or without the leading dot.");
  console.error("stored_bytes is the payload size inside the pack; for compressed files this is the compressed size.");
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

const normalizeExtension = (extension) => {
  const trimmed = extension.trim().toLowerCase();
  if (!trimmed) throw new Error("extension cannot be empty");
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
};

const normalizePackedPath = (packedFileName) => packedFileName.replaceAll("/", "\\");

const extensionFor = (packedFileName) => {
  const normalizedName = normalizePackedPath(packedFileName);
  const baseName = normalizedName.slice(normalizedName.lastIndexOf("\\") + 1);
  const lastDot = baseName.lastIndexOf(".");
  return lastDot > 0 ? baseName.slice(lastDot).toLowerCase() : "";
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
    // PFH5 stores a one-byte per-file compression flag, including hashed-name packs.
    hasCompressionFlag: format === "PFH5",
    hasFileNameHash: (byteMask & FILE_NAME_HASH_MASK) !== 0,
  };
};

const analyzePack = (packPath, wantedExtension, records) => {
  const fileDescriptor = fs.openSync(packPath, "r");

  try {
    const header = readPackHeader(fileDescriptor, packPath);
    const index = Buffer.allocUnsafe(header.packedFileIndexSize);
    const indexStart = PACK_HEADER_BYTES + header.dependencyIndexSize;
    const bytesRead = fs.readSync(fileDescriptor, index, 0, index.length, indexStart);
    if (bytesRead !== index.length) throw new Error("packed-file index is truncated");

    let indexPosition = 0;
    let dataPosition = header.dataStart;
    let matchedFileCount = 0;

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

      if (extensionFor(packedFileName) === wantedExtension) {
        let compressionMethod = "NONE";
        let compressionFrameOffset = "";

        if (isCompressed) {
          if (fileSize === 0) {
            compressionMethod = "UNKNOWN";
          } else {
            const sampleSize = Math.min(COMPRESSION_SAMPLE_BYTES, fileSize);
            const sample = readFileRange(fileDescriptor, dataPosition, sampleSize);
            const frame = findCompressionFrame(sample);
            compressionMethod = frame.method;
            compressionFrameOffset = frame.offset ?? "";
          }
        }

        records.push({
          packName: path.basename(packPath),
          fileNumber,
          filePath: normalizePackedPath(packedFileName),
          storedBytes: fileSize,
          isCompressed,
          compressionMethod,
          compressionFrameOffset,
          payloadOffset: dataPosition,
        });
        matchedFileCount++;
      }

      dataPosition += fileSize;
    }

    if (indexPosition !== index.length) {
      throw new Error(`packed-file index has ${index.length - indexPosition} unparsed byte(s)`);
    }

    return { fileCount: header.fileCount, matchedFileCount };
  } finally {
    fs.closeSync(fileDescriptor);
  }
};

const writeReport = (outputPath, records) => {
  const columns = [
    "pack_name",
    "file_number",
    "file_path",
    "stored_bytes",
    "is_compressed",
    "compression_method",
    "compression_frame_offset",
    "payload_offset",
  ];
  const lines = [columns.join(",")];

  for (const record of [...records].sort(
    (first, second) => first.filePath.localeCompare(second.filePath) || first.packName.localeCompare(second.packName),
  )) {
    lines.push(
      [
        record.packName,
        record.fileNumber,
        record.filePath,
        record.storedBytes,
        record.isCompressed ? 1 : 0,
        record.compressionMethod,
        record.compressionFrameOffset,
        record.payloadOffset,
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
  let showHelp = false;

  for (const argument of argumentsList) {
    if (argument === "-h" || argument === "--help") {
      showHelp = true;
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`unknown option ${argument}`);
    positional.push(argument);
  }

  if (positional.length > 3) throw new Error("too many positional arguments");

  return {
    dataFolderArgument: positional[0],
    extensionArgument: positional[1],
    outputArgument: positional[2],
    showHelp,
  };
};

export const main = (argumentsList = process.argv.slice(2)) => {
  const { dataFolderArgument, extensionArgument, outputArgument, showHelp } = parseArguments(argumentsList);

  if (showHelp || !dataFolderArgument || !extensionArgument) {
    usage();
    process.exitCode = showHelp ? 0 : 1;
    return;
  }

  const dataFolder = path.resolve(dataFolderArgument);
  const wantedExtension = normalizeExtension(extensionArgument);
  const safeExtensionName = wantedExtension.slice(1).replaceAll(/[^a-z0-9._-]+/g, "-") || "files";
  const defaultOutputPath = path.join(
    repositoryDirectory,
    "scripts",
    "out",
    `vanilla-${safeExtensionName}-files.csv`,
  );
  const outputPath = path.resolve(outputArgument ?? defaultOutputPath);

  const { manifestPath, packNames } = readManifestPackNames(dataFolder);
  const records = [];
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
      const result = analyzePack(packPath, wantedExtension, records);
      analyzedPackCount++;
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

  writeReport(outputPath, records);

  const compressionCounts = { NONE: 0, LZ4: 0, ZSTD: 0, UNKNOWN: 0 };
  let storedBytes = 0;
  for (const record of records) {
    compressionCounts[record.compressionMethod]++;
    storedBytes += record.storedBytes;
  }

  console.log(`Manifest: ${manifestPath}`);
  console.log(`Extension: ${wantedExtension}`);
  console.log(
    `Analyzed ${analyzedPackCount}/${packNames.length} vanilla packs and ${analyzedFileCount.toLocaleString()} total files.`,
  );
  console.log(`Matched ${records.length.toLocaleString()} ${wantedExtension} files (${storedBytes.toLocaleString()} stored bytes).`);
  console.log(
    `Compression: NONE ${compressionCounts.NONE.toLocaleString()}, LZ4 ${compressionCounts.LZ4.toLocaleString()}, ` +
      `ZSTD ${compressionCounts.ZSTD.toLocaleString()}, UNKNOWN ${compressionCounts.UNKNOWN.toLocaleString()}.`,
  );
  if (missingPacks.length > 0) {
    console.warn(`Missing manifest packs (${missingPacks.length}): ${missingPacks.join(", ")}`);
  }
  console.log(`Report: ${outputPath}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
