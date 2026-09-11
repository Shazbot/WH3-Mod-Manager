import type { ExistingPackFilePaths } from "./packImportPlan";
import { hasParentSegment, normalizePackFilePath, normalizePackFilePathKey } from "./packFilePathUtils";

export type PackFileRenameScope = "name" | "folder" | "full";

export interface PackFileRenameOptions {
  paths: string[];
  find: string;
  replace: string;
  useRegex: boolean;
  scope: PackFileRenameScope;
  /** Replaces the selected file name as a whole instead of matching within it. */
  replaceWholeName?: boolean;
}

export interface PackFileRenameEntry {
  originalPath: string;
  newPath: string;
}

export interface PackFileRenamePlan {
  entries: PackFileRenameEntry[];
  unchangedCount: number;
  errors: { path: string; message: string }[];
  conflicts: { newPath: string; with: "pack" | "unsaved" | "selection" }[];
  invalidRegex?: string;
}

/** Escapes a literal string for use in a regular expression. */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPathParts = (value: string) => {
  const normalized = normalizePackFilePath(value);
  const separatorIndex = normalized.lastIndexOf("\\");
  return {
    normalized,
    folder: separatorIndex < 0 ? "" : normalized.slice(0, separatorIndex),
    name: separatorIndex < 0 ? normalized : normalized.slice(separatorIndex + 1),
  };
};

const applyLiteralReplacement = (segment: string, find: string, replace: string): string => {
  if (!find) return segment;

  if (find === "{x}") return replace.replaceAll("{x}", segment);

  const replacement = replace.replaceAll("{x}", find);
  return segment.split(find).join(replacement);
};

const getReplacement = (segment: string, options: PackFileRenameOptions, regex?: RegExp): string => {
  if (options.useRegex) return regex ? segment.replace(regex, options.replace) : segment;
  return applyLiteralReplacement(segment, options.find, options.replace);
};

const addConflict = (
  conflicts: PackFileRenamePlan["conflicts"],
  seen: Set<string>,
  newPath: string,
  withKind: "pack" | "unsaved" | "selection",
) => {
  const key = `${withKind}|${normalizePackFilePathKey(newPath)}`;
  if (seen.has(key)) return;
  seen.add(key);
  conflicts.push({ newPath, with: withKind });
};

const addPlanConflicts = (result: PackFileRenamePlan, existing: ExistingPackFilePaths) => {
  const sourceKeys = new Set(result.entries.map((entry) => normalizePackFilePathKey(entry.originalPath)));
  const packKeys = new Set(existing.pack.map(normalizePackFilePathKey));
  const unsavedKeys = new Set(existing.unsaved.map(normalizePackFilePathKey));
  const conflicts = new Set<string>();

  for (const entry of result.entries) {
    const destinationKey = normalizePackFilePathKey(entry.newPath);
    if (packKeys.has(destinationKey) && !sourceKeys.has(destinationKey)) {
      addConflict(result.conflicts, conflicts, entry.newPath, "pack");
    }
    if (unsavedKeys.has(destinationKey) && !sourceKeys.has(destinationKey)) {
      addConflict(result.conflicts, conflicts, entry.newPath, "unsaved");
    }
  }

  const destinations = new Map<string, string>();
  for (const entry of result.entries) {
    const destinationKey = normalizePackFilePathKey(entry.newPath);
    const previousSource = destinations.get(destinationKey);
    if (previousSource && normalizePackFilePathKey(previousSource) !== normalizePackFilePathKey(entry.originalPath)) {
      addConflict(result.conflicts, conflicts, entry.newPath, "selection");
    } else {
      destinations.set(destinationKey, entry.originalPath);
    }
  }
};

export const planPackFileRename = (
  options: PackFileRenameOptions,
  existing: ExistingPackFilePaths,
): PackFileRenamePlan => {
  const result: PackFileRenamePlan = {
    entries: [],
    unchangedCount: 0,
    errors: [],
    conflicts: [],
  };

  let regex: RegExp | undefined;
  if (options.useRegex) {
    try {
      regex = new RegExp(options.find, "g");
    } catch (error) {
      result.invalidRegex = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  for (const originalPath of options.paths) {
    const { normalized, folder, name } = getPathParts(originalPath);
    if (!normalized) {
      result.errors.push({ path: originalPath, message: "The source path is empty" });
      continue;
    }

    const sourceSegment = options.scope === "name" ? name : options.scope === "folder" ? folder : normalized;
    const replacedSegment =
      options.replaceWholeName && options.scope === "name"
        ? options.replace
        : getReplacement(sourceSegment, options, regex);
    if (options.scope === "name" && !replacedSegment) {
      result.errors.push({ path: originalPath, message: "The resulting file name is empty" });
      continue;
    }
    if (options.scope === "name" && /[\\/]/.test(replacedSegment)) {
      result.errors.push({
        path: originalPath,
        message: "A renamed file name may not contain a path separator",
      });
      continue;
    }

    const candidate =
      options.scope === "name"
        ? folder
          ? `${folder}\\${replacedSegment}`
          : replacedSegment
        : options.scope === "folder"
          ? replacedSegment
            ? `${replacedSegment}\\${name}`
            : name
          : replacedSegment;
    const newPath = normalizePackFilePath(candidate);

    if (!newPath) {
      result.errors.push({ path: originalPath, message: "The resulting path is empty" });
      continue;
    }
    if (hasParentSegment(newPath)) {
      result.errors.push({ path: originalPath, message: "The resulting path may not contain '..'" });
      continue;
    }

    if (newPath === normalized) {
      result.unchangedCount += 1;
      continue;
    }
    result.entries.push({ originalPath, newPath });
  }

  addPlanConflicts(result, existing);

  return result;
};

/**
 * Plans a move that changes only the selected files' parent folder and keeps each file name intact.
 * The destination is a pack-relative folder; an empty destination means the pack root.
 */
export const planPackFileMove = (
  paths: string[],
  destinationFolder: string,
  existing: ExistingPackFilePaths,
): PackFileRenamePlan => {
  const result: PackFileRenamePlan = {
    entries: [],
    unchangedCount: 0,
    errors: [],
    conflicts: [],
  };
  const normalizedDestination = normalizePackFilePath(destinationFolder);

  if (hasParentSegment(normalizedDestination)) {
    result.errors.push({
      path: destinationFolder,
      message: "The destination folder may not contain '..'",
    });
    return result;
  }

  for (const originalPath of paths) {
    const { normalized, name } = getPathParts(originalPath);
    if (!normalized) {
      result.errors.push({ path: originalPath, message: "The source path is empty" });
      continue;
    }
    if (!name) {
      result.errors.push({ path: originalPath, message: "The source file name is empty" });
      continue;
    }

    const newPath = normalizePackFilePath(normalizedDestination ? `${normalizedDestination}\\${name}` : name);
    if (!newPath) {
      result.errors.push({ path: originalPath, message: "The resulting path is empty" });
      continue;
    }
    if (hasParentSegment(newPath)) {
      result.errors.push({ path: originalPath, message: "The resulting path may not contain '..'" });
      continue;
    }

    if (newPath === normalized) {
      result.unchangedCount += 1;
      continue;
    }
    result.entries.push({ originalPath, newPath });
  }

  addPlanConflicts(result, existing);

  return result;
};
