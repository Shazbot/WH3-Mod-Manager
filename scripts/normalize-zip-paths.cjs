const fs = require("node:fs/promises");

const yauzl = require("yauzl");

const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const FIXED_CENTRAL_HEADER_SIZE = 46;
const FIXED_LOCAL_HEADER_SIZE = 30;

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      {
        autoClose: true,
        decodeStrings: false,
        lazyEntries: true,
        validateEntrySizes: false,
      },
      (error, zipFile) => {
        if (error) reject(error);
        else resolve(zipFile);
      },
    );
  });
}

async function readExactly(file, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;

  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) {
      throw new Error(`Unexpected end of ZIP at byte ${position + offset}`);
    }
    offset += bytesRead;
  }

  return buffer;
}

async function writeExactly(file, buffer, position) {
  let offset = 0;

  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesWritten === 0) {
      throw new Error(`Could not write ZIP at byte ${position + offset}`);
    }
    offset += bytesWritten;
  }
}

function withPortableSeparators(fileName) {
  const normalized = Buffer.from(fileName);
  let changed = false;

  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === 0x5c) {
      normalized[index] = 0x2f;
      changed = true;
    }
  }

  return changed ? normalized : null;
}

async function collectPatches(zipPath) {
  const source = await fs.open(zipPath, "r");

  try {
    const zipFile = await openZip(zipPath);
    const patches = [];
    let changedEntries = 0;

    await new Promise((resolve, reject) => {
      let settled = false;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        zipFile.close();
        reject(error);
      };

      zipFile.on("error", fail);
      zipFile.on("end", () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      zipFile.on("entry", (entry) => {
        void (async () => {
          const variableCentralSize =
            entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength;
          const centralHeaderOffset =
            zipFile.readEntryCursor - FIXED_CENTRAL_HEADER_SIZE - variableCentralSize;
          const centralHeader = await readExactly(
            source,
            FIXED_CENTRAL_HEADER_SIZE,
            centralHeaderOffset,
          );

          if (centralHeader.readUInt32LE(0) !== CENTRAL_FILE_HEADER_SIGNATURE) {
            throw new Error(`Invalid central ZIP header at byte ${centralHeaderOffset}`);
          }

          const normalizedCentralName = withPortableSeparators(entry.fileName);
          let entryChanged = false;
          if (normalizedCentralName) {
            entryChanged = true;
            patches.push({
              buffer: normalizedCentralName,
              position: centralHeaderOffset + FIXED_CENTRAL_HEADER_SIZE,
            });
          }

          const localHeaderOffset = entry.relativeOffsetOfLocalHeader;
          const localHeader = await readExactly(source, FIXED_LOCAL_HEADER_SIZE, localHeaderOffset);

          if (localHeader.readUInt32LE(0) !== LOCAL_FILE_HEADER_SIGNATURE) {
            throw new Error(`Invalid local ZIP header at byte ${localHeaderOffset}`);
          }

          const localNameLength = localHeader.readUInt16LE(26);
          const localNameOffset = localHeaderOffset + FIXED_LOCAL_HEADER_SIZE;
          const localName = await readExactly(source, localNameLength, localNameOffset);
          const normalizedLocalName = withPortableSeparators(localName);

          if (normalizedLocalName) {
            entryChanged = true;
            patches.push({ buffer: normalizedLocalName, position: localNameOffset });
          }

          if (entryChanged) changedEntries += 1;
        })()
          .then(() => zipFile.readEntry())
          .catch(fail);
      });

      zipFile.readEntry();
    });

    return { changedEntries, patches };
  } finally {
    await source.close();
  }
}

async function normalizeZipEntryPaths(zipPath) {
  const { changedEntries, patches } = await collectPatches(zipPath);
  if (changedEntries === 0) return 0;

  const output = await fs.open(zipPath, "r+");

  try {
    for (const patch of patches) {
      await writeExactly(output, patch.buffer, patch.position);
    }
  } finally {
    await output.close();
  }

  return changedEntries;
}

async function normalizeMadeZipPaths(_forgeConfig, makeResults) {
  // cross-zip uses the system `zip` command on Unix, which already emits `/`.
  if (process.platform !== "win32") return makeResults;

  const zipPaths = new Set(
    makeResults.flatMap(({ artifacts }) =>
      artifacts.filter((artifactPath) => artifactPath.toLowerCase().endsWith(".zip")),
    ),
  );

  for (const zipPath of zipPaths) {
    const changedEntries = await normalizeZipEntryPaths(zipPath);
    if (changedEntries > 0) {
      console.log(
        `Normalized path separators in ${changedEntries} ZIP entries: ${zipPath}`,
      );
    }
  }

  return makeResults;
}

module.exports = normalizeMadeZipPaths;
module.exports.normalizeZipEntryPaths = normalizeZipEntryPaths;
