import { TextFileTargetMatch, matchesTextFileTarget } from "./textFileEdits";

export type PackFileOperationKind = "copy" | "move" | "rename" | "delete";

export interface PackFileOperationRule {
  id: string;
  operation: PackFileOperationKind;
  targetMatch: TextFileTargetMatch;
  /** A pack path, a bare file name, or a regular expression, per targetMatch. */
  target: string;
  /**
   * Where the file goes. A full pack path for copy and move; just the file name for rename, which
   * keeps the folder. Ignored by delete.
   *
   * Supports {name}, {dir} and, when targeting by regex, the capture groups as $1, $2 and so on.
   */
  destination?: string;
  /** Whether the file may land on top of one that is already there. */
  overwrite?: boolean;
  /** Report a rule that matched nothing even on an unattended run. */
  required?: boolean;
}

/** One file the rules decided to write. */
export interface PackFileOperationPlanEntry {
  ruleId: string;
  operation: PackFileOperationKind;
  sourcePath: string;
  targetPath: string;
}

export interface PackFileOperationPlan {
  /** Files to write, in rule order, one per destination. */
  entries: PackFileOperationPlanEntry[];
  /** Paths whose original must not be carried through, because a move or delete took them. */
  removedPaths: Set<string>;
  matchCountByRuleId: Record<string, number>;
  /** Destinations a rule declined to overwrite. */
  skippedOverwrites: string[];
}

const splitPath = (filePath: string) => {
  const normalized = filePath.replace(/\//g, "\\");
  const lastSeparator = normalized.lastIndexOf("\\");
  return {
    dir: lastSeparator === -1 ? "" : normalized.slice(0, lastSeparator),
    name: lastSeparator === -1 ? normalized : normalized.slice(lastSeparator + 1),
  };
};

/**
 * Where a rule sends a file.
 *
 * Rename takes a file name and keeps the folder, which is the difference between it and move; move
 * and copy take a whole path. {name} and {dir} stand for the source's own parts, and a regex target
 * also exposes its capture groups, so one rule can rewrite a whole set of files.
 */
export const resolvePackFileDestination = (
  sourcePath: string,
  rule: PackFileOperationRule,
): string | undefined => {
  const destination = (rule.destination ?? "").trim();
  if (!destination) return undefined;

  const { dir, name } = splitPath(sourcePath);

  let resolved = destination.replace(/\//g, "\\").split("{name}").join(name).split("{dir}").join(dir);

  if (rule.targetMatch === "regex") {
    try {
      const captures = new RegExp(rule.target, "i").exec(sourcePath);
      if (captures) {
        resolved = resolved.replace(/\$(\d)/g, (whole, index) => captures[Number(index)] ?? whole);
      }
    } catch {
      // A target that does not compile matched nothing, so there is nothing to substitute.
    }
  }

  // Rename stays put; only the file name changes.
  if (rule.operation === "rename") {
    const renamedName = splitPath(resolved).name;
    return dir ? `${dir}\\${renamedName}` : renamedName;
  }

  return resolved;
};

/**
 * Works out which files each rule writes and which originals it takes away.
 *
 * Rules are applied in order and a later destination replaces an earlier one, which is what makes a
 * copy land on top of an existing file. A rule with overwrite off steps aside instead, and says so.
 */
export const planPackFileOperations = (
  filePaths: string[],
  rules: PackFileOperationRule[],
): PackFileOperationPlan => {
  const entryByTarget = new Map<string, PackFileOperationPlanEntry>();
  const removedPaths = new Set<string>();
  const matchCountByRuleId: Record<string, number> = {};
  const skippedOverwrites: string[] = [];

  const existingPaths = new Set(filePaths.map((filePath) => filePath.toLowerCase()));

  for (const rule of rules) {
    if (!rule.target) continue;
    matchCountByRuleId[rule.id] = matchCountByRuleId[rule.id] ?? 0;

    // Delete also sees what earlier rules produced, so a rule can undo a copy it no longer wants.
    // Copy and move read their bytes from the pack, so they only consider files that are in it.
    const candidatePaths =
      rule.operation === "delete" ? [...new Set([...filePaths, ...entryByTarget.keys()])] : filePaths;

    for (const sourcePath of candidatePaths) {
      if (!matchesTextFileTarget(sourcePath, rule)) continue;

      if (rule.operation === "delete") {
        matchCountByRuleId[rule.id] += 1;
        removedPaths.add(sourcePath);
        entryByTarget.delete(sourcePath);
        continue;
      }

      const targetPath = resolvePackFileDestination(sourcePath, rule);
      if (!targetPath || targetPath === sourcePath) continue;

      const wouldOverwrite =
        entryByTarget.has(targetPath) || (existingPaths.has(targetPath.toLowerCase()) && !removedPaths.has(targetPath));
      if (wouldOverwrite && rule.overwrite === false) {
        skippedOverwrites.push(targetPath);
        continue;
      }

      matchCountByRuleId[rule.id] += 1;
      entryByTarget.set(targetPath, {
        ruleId: rule.id,
        operation: rule.operation,
        sourcePath,
        targetPath,
      });

      // A move leaves nothing behind; a copy and a rename-to-elsewhere keep the original.
      if (rule.operation === "move" || rule.operation === "rename") {
        removedPaths.add(sourcePath);
      }
    }
  }

  return {
    entries: [...entryByTarget.values()],
    removedPaths,
    matchCountByRuleId,
    skippedOverwrites,
  };
};
