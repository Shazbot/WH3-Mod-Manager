/**
 * Which pack wins when several of them contain the same file.
 *
 * The game loads packs in the order they appear in used_mods.txt and a later one overrides an
 * earlier one, so "highest priority" means "last in the load order". A flow reading a file that two
 * enabled mods both provide has to read the copy the game would actually have used, otherwise it
 * edits content the player never sees.
 */

/** Rank given to a pack that is not in the load order at all, i.e. a vanilla pack. */
const VANILLA_RANK = -1;

/**
 * Ranks packs by load priority - a higher number wins.
 *
 * `orderedModPaths` runs lowest priority first, matching the order mods are written to the mod list.
 * Anything not in it is vanilla and ranks below every mod, which is what the game does too.
 */
export const buildPackPriority = (orderedModPaths: string[]): Map<string, number> => {
  const priority = new Map<string, number>();
  orderedModPaths.forEach((modPath, index) => priority.set(modPath, index));
  return priority;
};

export const getPackPriority = (packPath: string, priority: Map<string, number>): number =>
  priority.get(packPath) ?? VANILLA_RANK;

/**
 * Orders packs lowest priority first, so a caller that simply overwrites as it goes ends up keeping
 * the highest-priority copy of anything two packs both contain.
 *
 * Ties keep their original order, so a stable input gives a stable output.
 */
export const sortPacksByAscendingPriority = <T>(
  packs: T[],
  pathOf: (pack: T) => string,
  priority: Map<string, number>,
): T[] =>
  packs
    .map((pack, index) => ({ pack, index }))
    .sort((first, second) => {
      const byPriority =
        getPackPriority(pathOf(first.pack), priority) - getPackPriority(pathOf(second.pack), priority);
      return byPriority !== 0 ? byPriority : first.index - second.index;
    })
    .map((entry) => entry.pack);

/**
 * For each file name, the pack that should be read for it: the highest-priority one that has it.
 *
 * Ties go to the pack listed first, so the caller's own ordering breaks a tie predictably.
 */
export const resolveFileSourcePacks = (
  packs: Array<{ packPath: string; fileNames: string[] }>,
  priority: Map<string, number>,
): Map<string, string> => {
  const sourceByFileName = new Map<string, string>();
  const rankByFileName = new Map<string, number>();

  for (const pack of packs) {
    const rank = getPackPriority(pack.packPath, priority);
    for (const fileName of pack.fileNames) {
      const currentRank = rankByFileName.get(fileName);
      if (currentRank !== undefined && currentRank >= rank) continue;
      rankByFileName.set(fileName, rank);
      sourceByFileName.set(fileName, pack.packPath);
    }
  }

  return sourceByFileName;
};
