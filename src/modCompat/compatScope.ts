import * as nodePath from "path";

/**
 * The packs a compatibility check should actually look at.
 *
 * The loaded set is not the answer. `appData.packsData` accumulates every pack read at any point in
 * the session - a mod browsed in the viewer, a mod enabled and later disabled, a pack opened for some
 * unrelated reason - and none of that should turn up in a report about the mods the user asked about.
 *
 * Scanning everything loaded had three consequences: conflicts reported between packs the user had not
 * selected, a result that depended on session history rather than only on the mods, and a compat cache
 * whose key covered the requested mods while its answer depended on whatever else happened to be in
 * memory.
 *
 * Vanilla packs belong in the requested list: reference resolution needs their keys to decide whether
 * a mod's reference is missing.
 */
export const selectPacksToCheck = <TPack extends { path: string }>(
  loadedPacks: readonly TPack[],
  requestedPackPaths: readonly string[],
): TPack[] => {
  const wanted = new Set(requestedPackPaths.map((packPath) => nodePath.resolve(packPath)));
  return loadedPacks.filter((pack) => wanted.has(nodePath.resolve(pack.path)));
};
