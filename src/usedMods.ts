import { compareModNames } from "./modSortingHelpers";

export type UsedModImport = {
  name: string;
  loadOrder?: number;
};

export const parseUsedMods = (text: string): string[] => {
  const names: string[] = [];
  const seenNames = new Set<string>();
  const modLinePattern = /^\s*mod\s+"([^"]+)"\s*;/gim;

  for (const match of text.matchAll(modLinePattern)) {
    const name = match[1];
    if (!seenNames.has(name)) {
      seenNames.add(name);
      names.push(name);
    }
  }

  return names;
};

const getLongestIncreasingSubsequenceIndices = (values: number[]): Set<number> => {
  const predecessorIndices = new Array<number>(values.length).fill(-1);
  const tailIndices: number[] = [];

  for (let index = 0; index < values.length; index++) {
    let low = 0;
    let high = tailIndices.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (values[tailIndices[middle]] < values[index]) low = middle + 1;
      else high = middle;
    }

    if (low > 0) predecessorIndices[index] = tailIndices[low - 1];
    tailIndices[low] = index;
  }

  const indices = new Set<number>();
  let index = tailIndices.at(-1) ?? -1;
  while (index !== -1) {
    indices.add(index);
    index = predecessorIndices[index];
  }
  return indices;
};

export const getUsedModImport = (
  usedModNames: string[],
  availableModNames: Iterable<string>,
): UsedModImport[] => {
  const availableNames = new Set(availableModNames);
  const seenNames = new Set<string>();
  const importedNames = usedModNames.filter((name) => {
    if (!availableNames.has(name) || seenNames.has(name)) return false;
    seenNames.add(name);
    return true;
  });

  const automaticNames = [...importedNames].sort(compareModNames);
  const automaticIndices = new Map(automaticNames.map((name, index) => [name, index]));
  const desiredAutomaticIndices = importedNames.map((name) => automaticIndices.get(name) as number);
  // Unpinned mods stay in automatic order. Keeping its longest subsequence therefore minimizes pins.
  const automaticSubsequenceIndices = getLongestIncreasingSubsequenceIndices(desiredAutomaticIndices);

  return importedNames.map((name, index) => ({
    name,
    loadOrder: automaticSubsequenceIndices.has(index) ? undefined : index,
  }));
};
