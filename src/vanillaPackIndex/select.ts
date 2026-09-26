/**
 * Turning an index lookup into the list of packs a caller should actually read.
 *
 * Kept apart from `./format`, which answers in pack names, and from the callers, which hold absolute
 * paths and an order they care about. Pure on purpose: the reading itself is Electron-shaped and
 * lives in `ipcMainListeners`, the same split `./format` and `./store` already follow.
 */

import { VanillaPackIndex, findVanillaPackContaining, findVanillaPacksUnderPrefix } from "./format";

/**
 * Both separators, rather than `path.basename`: the index stores names the game's own paths use, and
 * a build made on Windows is read back on whatever platform is running.
 */
const packNameOf = (packPath: string): string =>
  packPath.slice(Math.max(packPath.lastIndexOf("\\"), packPath.lastIndexOf("/")) + 1).toLowerCase();

const selectPathsForPackNames = (packNames: Set<string>, packPathsInLoadOrder: readonly string[]): string[] =>
  packPathsInLoadOrder.filter((packPath) => packNames.has(packNameOf(packPath)));

/**
 * The packs holding `filePaths`, in load order.
 *
 * For assets addressed by exact path - icons, mostly. Only the pack that wins for a path is named,
 * which is the one the game would load it from, so a file several packs carry resolves to the bytes
 * the game shows. A path no pack carries contributes nothing rather than failing the lot.
 */
export const selectVanillaPacksHoldingFiles = (
  index: VanillaPackIndex,
  filePaths: readonly string[],
  packPathsInLoadOrder: readonly string[],
): string[] => {
  const packNames = new Set<string>();
  for (const filePath of filePaths) {
    const packName = findVanillaPackContaining(index, filePath);
    if (packName) packNames.add(packName.toLowerCase());
  }
  return selectPathsForPackNames(packNames, packPathsInLoadOrder);
};

/**
 * The packs still worth searching for `filePaths`, keeping the order they were given in.
 *
 * For a caller that walks a priority-ordered list of packs opening each one until a file turns up,
 * where most of that list is vanilla. Packs whose name is not in `vanillaPackNames` - mods - are
 * always kept: the index knows nothing of them and they outrank vanilla anyway. A vanilla pack is
 * kept only where the index says it wins one of the paths, so a search for a file no vanilla pack
 * holds - the case that used to pay for the entire list - opens none of them.
 *
 * `packPathsByPriority` need not hold every vanilla pack; a caller that filters some out gets the
 * whole list back untouched the moment a winning pack is one of those. Whether a lower-priority pack
 * it did keep carries the file too is the one thing the index cannot answer, and narrowing on that
 * would silently lose the file.
 *
 * `vanillaPackNames` is matched lowercased, as pack names are everywhere else here.
 */
export const selectPackPathsToSearch = (
  index: VanillaPackIndex,
  filePaths: readonly string[],
  packPathsByPriority: readonly string[],
  vanillaPackNames: ReadonlySet<string>,
): string[] => {
  const vanillaPackNameOf = (packPath: string): string | undefined => {
    const packName = packNameOf(packPath);
    return vanillaPackNames.has(packName) ? packName : undefined;
  };
  const searchableVanillaPackNames = new Set(
    packPathsByPriority.map(vanillaPackNameOf).filter((packName): packName is string => !!packName),
  );

  const wantedVanillaPackNames = new Set<string>();
  for (const filePath of filePaths) {
    const packName = findVanillaPackContaining(index, filePath)?.toLowerCase();
    if (!packName) continue;
    if (!searchableVanillaPackNames.has(packName)) return [...packPathsByPriority];
    wantedVanillaPackNames.add(packName);
  }

  return packPathsByPriority.filter((packPath) => {
    const packName = vanillaPackNameOf(packPath);
    return !packName || wantedVanillaPackNames.has(packName);
  });
};

/**
 * The packs holding any table under `tablePathPrefixes`, in load order.
 *
 * Every pack that wins at least one file under a prefix is named, not just the one that wins the
 * most: a table family can be split across packs, and a caller reading only some of them would build
 * on a partial set of rows and never know. Load order is what makes the result usable directly -
 * later packs override earlier ones, the same rule the rows are merged under.
 *
 * An empty result means the index knows of no pack carrying these, which callers should read as "ask
 * again the slow way" rather than "the game has none": an index built before a table family existed
 * answers exactly the same way.
 */
export const selectVanillaPacksHoldingTables = (
  index: VanillaPackIndex,
  tablePathPrefixes: readonly string[],
  packPathsInLoadOrder: readonly string[],
): string[] => {
  const packNames = new Set<string>();
  for (const prefix of tablePathPrefixes) {
    for (const packName of findVanillaPacksUnderPrefix(index, prefix)) packNames.add(packName.toLowerCase());
  }
  return selectPathsForPackNames(packNames, packPathsInLoadOrder);
};
