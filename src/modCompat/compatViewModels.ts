import { compareModNames } from "../modSortingHelpers";
import type { PackFileCollision, PackTableCollision } from "../packFileTypes";

/**
 * The compatibility scanner emits a record in both directions for a pair of packs. The UI should
 * show that as one finding, otherwise every conflict looks twice as serious as it is.
 */
const collisionPairKey = (first: string, second: string) =>
  JSON.stringify([first, second].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));

export const collapsePackFileCollisions = (collisions: readonly PackFileCollision[]): PackFileCollision[] => {
  const unique = new Map<string, PackFileCollision>();

  for (const collision of collisions) {
    const key = JSON.stringify([
      collisionPairKey(collision.firstPackName, collision.secondPackName),
      collision.fileName,
    ]);
    if (!unique.has(key)) unique.set(key, collision);
  }

  return [...unique.values()];
};

export const collapsePackTableCollisions = (collisions: readonly PackTableCollision[]): PackTableCollision[] => {
  const unique = new Map<string, PackTableCollision>();

  for (const collision of collisions) {
    const firstSide = [collision.firstPackName, collision.fileName];
    const secondSide = [collision.secondPackName, collision.secondFileName];
    const sides = [firstSide, secondSide].sort((left, right) => {
      const leftKey = JSON.stringify(left);
      const rightKey = JSON.stringify(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    const key = JSON.stringify([sides, collision.key, collision.value]);
    if (!unique.has(key)) unique.set(key, collision);
  }

  return [...unique.values()];
};

/** Lower index is the higher-priority mod in the visible load-order list. */
export const higherPriorityPack = (
  firstPackName: string,
  secondPackName: string,
  orderedPackNames: readonly string[],
): "first" | "second" => {
  const firstIndex = orderedPackNames.indexOf(firstPackName);
  const secondIndex = orderedPackNames.indexOf(secondPackName);

  if (firstIndex >= 0 && secondIndex >= 0 && firstIndex !== secondIndex) {
    return firstIndex < secondIndex ? "first" : "second";
  }

  // This is only a defensive fallback for stale results or packs outside the current preset. It
  // keeps the display deterministic without changing the normal load-order result.
  return compareModNames(firstPackName, secondPackName) <= 0 ? "first" : "second";
};

const fileBaseName = (fileName: string) => fileName.split(/[\\/]/).pop() || fileName;

/** Database row priority comes from the internal database filename, not the external pack order. */
export const higherPriorityDatabaseFile = (collision: Pick<PackTableCollision, "fileName" | "secondFileName">) =>
  compareModNames(fileBaseName(collision.fileName), fileBaseName(collision.secondFileName)) <= 0 ? "first" : "second";
