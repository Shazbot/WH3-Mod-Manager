export const MAX_RECENT_PACKS = 20;

const recentPackPathKey = (packPath: string) => packPath.replaceAll("/", "\\").toLowerCase();

const packFileName = (packPath: string) => packPath.replaceAll("\\", "/").split("/").pop() ?? packPath;

export const isVanillaPackPath = (packPath: string, vanillaPackNames: readonly string[]) => {
  const name = packFileName(packPath).toLowerCase();
  return vanillaPackNames.some((vanillaPackName) => vanillaPackName.toLowerCase() === name);
};

/** Cleans persisted or IPC-provided history without changing the order of the entries. */
export const sanitizeRecentPackPaths = (
  packPaths: readonly unknown[] | undefined,
  vanillaPackNames: readonly string[] = [],
): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of packPaths ?? []) {
    if (typeof value !== "string") continue;
    const packPath = value.trim();
    if (!packPath || packPath.toLowerCase().startsWith("memory://") || isVanillaPackPath(packPath, vanillaPackNames))
      continue;

    const key = recentPackPathKey(packPath);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(packPath);
    if (result.length === MAX_RECENT_PACKS) break;
  }

  return result;
};

/** Adds a pack at the front, treating path spelling and slash direction as case-insensitive. */
export const addRecentPackPath = (
  packPaths: readonly unknown[] | undefined,
  packPath: string,
  vanillaPackNames: readonly string[] = [],
): string[] => {
  return sanitizeRecentPackPaths([packPath, ...(packPaths ?? [])], vanillaPackNames);
};

export const recentPackPathsEqual = (first: readonly string[], second: readonly string[]) =>
  first.length === second.length && first.every((packPath, index) => packPath === second[index]);

/** Number of rows that can be shown without letting the recent-pack menu run below the viewport. */
export const getVisibleRecentPackCount = (availableHeight: number, rowHeight: number, max = MAX_RECENT_PACKS) => {
  if (!Number.isFinite(availableHeight) || !Number.isFinite(rowHeight) || rowHeight <= 0) return 0;
  return Math.max(0, Math.min(max, Math.floor(availableHeight / rowHeight)));
};
