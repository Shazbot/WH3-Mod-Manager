import * as fs from "fs";
import * as nodePath from "path";
import appData from "../appData";

/**
 * Every vanilla pack of the current game that is present on disk, in load order.
 *
 * `allVanillaPackNames` is built from manifest.txt in the order the file lists them, and the game
 * loads them in that order with a later pack overriding an earlier one - the same rule that orders
 * mods. Preserving that order lets callers hand this list to `buildPackPriority` ahead of the mod
 * paths, which ranks every vanilla pack below every mod while still resolving vanilla against
 * vanilla the way the game would.
 *
 * A Warhammer III install has ~260 of these, so the existence check is memoized per game and data
 * folder rather than repeated for every node that asks.
 */
let cachedKey = "";
let cachedPaths: string[] = [];

export const getVanillaPackPathsInLoadOrder = (): string[] => {
  const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
  if (!dataFolder) return [];

  const key = `${appData.currentGame}|${dataFolder}|${appData.allVanillaPackNames.size}`;
  if (key === cachedKey) return cachedPaths;

  cachedPaths = [...appData.allVanillaPackNames]
    .map((packName) => nodePath.join(dataFolder, packName))
    .filter((packPath) => fs.existsSync(packPath));
  cachedKey = key;
  return cachedPaths;
};
