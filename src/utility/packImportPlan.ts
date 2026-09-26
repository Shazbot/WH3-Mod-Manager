import { promises as fs } from "node:fs";
import * as nodePath from "node:path";

import { getRpfmTsvMetadata } from "./rpfmTsv";
import { hasParentSegment, normalizePackFilePath, normalizePackFilePathKey } from "./packFilePathUtils";

export type PackImportSourceKind = "file" | "folder";

export interface PackImportSource {
  path: string;
  kind: PackImportSourceKind;
}

export interface PackImportDirectoryEntry {
  name: string;
  kind: PackImportSourceKind;
}

export type PackImportReadDir = (directoryPath: string) => Promise<PackImportDirectoryEntry[]>;
export type PackImportReadFileHead = (filePath: string) => Promise<string>;

export interface PackImportItem {
  diskPath: string;
  packFilePath: string;
  isRpfmTsv: boolean;
  conflictsWith?: "pack" | "unsaved";
}

export interface PackImportPlanError {
  diskPath: string;
  message: string;
}

export interface PackImportPlan {
  items: PackImportItem[];
  errors: PackImportPlanError[];
}

/** The two places a destination can already be taken, kept apart so the modal can say which. */
export interface ExistingPackFilePaths {
  pack: string[];
  unsaved: string[];
}

export interface PlanPackImportOptions {
  sources: PackImportSource[];
  targetFolder: string;
  existingPackFilePaths: ExistingPackFilePaths;
  readDir: PackImportReadDir;
  readFileHead?: PackImportReadFileHead;
}

const joinPackFilePath = (first: string, second: string) => {
  if (!first) return second;
  if (!second) return first;
  return `${first.replace(/[\\/]+$/, "")}\\${second.replace(/^[\\/]+/, "")}`;
};

const getDiskBasename = (value: string) => nodePath.basename(value.replace(/[\\/]/g, nodePath.sep));

const defaultReadFileHead: PackImportReadFileHead = async (filePath) => {
  const handle = await fs.open(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let contents = "";
    const buffer = Buffer.allocUnsafe(4096);
    // Two newline-terminated lines are enough to inspect the marker. A single newline only means
    // the first line ended; the second line may still be split across the next read.
    while (contents.split(/\r?\n/).length < 3) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      const chunk = buffer.subarray(0, result.bytesRead);
      chunks.push(Buffer.from(chunk));
      contents = Buffer.concat(chunks).toString("utf8");
    }
    return contents;
  } finally {
    await handle.close();
  }
};

const collectExistingPaths = (existing: ExistingPackFilePaths) => ({
  packPaths: new Set(existing.pack.map(normalizePackFilePathKey)),
  unsavedPaths: new Set(existing.unsaved.map(normalizePackFilePathKey)),
});

const getRelativeDiskPath = (relativePath: string, entryName: string) =>
  relativePath ? nodePath.join(relativePath, entryName) : entryName;

const isRpfmTsvPath = (filePath: string) => filePath.toLowerCase().endsWith(".tsv");

const resolveTsvDestination = async (
  item: Omit<PackImportItem, "isRpfmTsv" | "packFilePath"> & { packFilePath: string },
  readFileHead: PackImportReadFileHead,
) => {
  if (!isRpfmTsvPath(item.diskPath)) return { isRpfmTsv: false, packFilePath: item.packFilePath };

  let contents: string;
  try {
    contents = await readFileHead(item.diskPath);
  } catch {
    // The apply phase will report the readable-file error. A TSV that cannot be inspected here is
    // kept as a normal disk file so it still gets the same per-file retry/error behavior.
    return { isRpfmTsv: false, packFilePath: item.packFilePath };
  }

  const secondLine = contents.split(/\r?\n/, 3)[1];
  if (!secondLine?.trim().startsWith("#")) return { isRpfmTsv: false, packFilePath: item.packFilePath };

  let metadataPath = item.packFilePath;
  try {
    const metadata = getRpfmTsvMetadata(secondLine, item.packFilePath);
    if (metadata) metadataPath = metadata.packedFileName;
  } catch {
    // Keep the RPFM marker. convertRpfmTsvToPackedFile will return the useful validation error.
  }

  return { isRpfmTsv: true, packFilePath: metadataPath };
};

export const planPackImport = async ({
  sources,
  targetFolder,
  existingPackFilePaths,
  readDir,
  readFileHead = defaultReadFileHead,
}: PlanPackImportOptions): Promise<PackImportPlan> => {
  const errors: PackImportPlanError[] = [];
  const discoveredFiles: Array<{ diskPath: string; relativePath: string }> = [];

  const walkFolder = async (folderPath: string, relativePath: string): Promise<void> => {
    let entries: PackImportDirectoryEntry[];
    try {
      entries = await readDir(folderPath);
    } catch (error) {
      errors.push({
        diskPath: folderPath,
        message: error instanceof Error ? error.message : "Could not read folder",
      });
      return;
    }

    entries.sort((first, second) => first.name.localeCompare(second.name));
    for (const entry of entries) {
      const diskPath = nodePath.join(folderPath, entry.name);
      const nextRelativePath = getRelativeDiskPath(relativePath, entry.name);
      if (entry.kind === "folder") {
        await walkFolder(diskPath, nextRelativePath);
      } else {
        discoveredFiles.push({ diskPath, relativePath: nextRelativePath });
      }
    }
  };

  for (const source of sources) {
    if (source.kind === "folder") {
      await walkFolder(source.path, "");
    } else {
      discoveredFiles.push({ diskPath: source.path, relativePath: getDiskBasename(source.path) });
    }
  }

  const candidates: PackImportItem[] = [];
  for (const discoveredFile of discoveredFiles) {
    const initialPackFilePath = normalizePackFilePath(
      joinPackFilePath(normalizePackFilePath(targetFolder), discoveredFile.relativePath),
    );
    if (!initialPackFilePath || hasParentSegment(initialPackFilePath)) {
      errors.push({
        diskPath: discoveredFile.diskPath,
        message: `Rejected path outside the pack: ${initialPackFilePath || discoveredFile.relativePath}`,
      });
      continue;
    }

    const resolvedTsv = await resolveTsvDestination(
      { diskPath: discoveredFile.diskPath, packFilePath: initialPackFilePath },
      readFileHead,
    );
    if (hasParentSegment(resolvedTsv.packFilePath)) {
      errors.push({
        diskPath: discoveredFile.diskPath,
        message: `Rejected path outside the pack: ${resolvedTsv.packFilePath}`,
      });
      continue;
    }
    candidates.push({
      diskPath: discoveredFile.diskPath,
      packFilePath: resolvedTsv.packFilePath,
      isRpfmTsv: resolvedTsv.isRpfmTsv,
    });
  }

  const { packPaths, unsavedPaths } = collectExistingPaths(existingPackFilePaths);
  const seenDestinations = new Set<string>();
  const items: PackImportItem[] = [];
  for (const item of candidates) {
    const destinationKey = normalizePackFilePathKey(item.packFilePath);
    if (seenDestinations.has(destinationKey)) {
      errors.push({
        diskPath: item.diskPath,
        message: `Multiple disk files map to ${item.packFilePath}`,
      });
      continue;
    }
    seenDestinations.add(destinationKey);

    const conflictsWith = unsavedPaths.has(destinationKey)
      ? "unsaved"
      : packPaths.has(destinationKey)
        ? "pack"
        : undefined;
    items.push({ ...item, ...(conflictsWith ? { conflictsWith } : {}) });
  }

  return { items, errors };
};
