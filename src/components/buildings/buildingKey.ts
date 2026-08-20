/**
 * Suggest a level key for a building added to an existing chain.
 *
 * Vanilla chain keys carry a game prefix, while chains created in the panel already carry the
 * modder prefix. A numeric suffix on the chain can also be the previous level number, in which
 * case the new level should increment it instead of producing a double suffix.
 */
export const suggestBuildingLevelKey = (keyPrefix: string, chainKey: string, newLevel: number): string => {
  const normalizedPrefix = keyPrefix.trim().replace(/_+$/, "");
  const chainStem = chainKey.replace(/^wh[0-9_a-z]*?_/, "");
  const prefixLower = normalizedPrefix.toLowerCase();
  const chainStemLower = chainStem.toLowerCase();
  const hasPrefix =
    normalizedPrefix !== "" && (chainStemLower === prefixLower || chainStemLower.startsWith(`${prefixLower}_`));
  const prefixedChain = hasPrefix || normalizedPrefix === "" ? chainStem : `${normalizedPrefix}_${chainStem}`;
  const previousLevelSuffix = `_${newLevel}`;
  const chainWithoutPreviousLevel = prefixedChain.endsWith(previousLevelSuffix)
    ? prefixedChain.slice(0, -previousLevelSuffix.length)
    : prefixedChain;

  return `${chainWithoutPreviousLevel}_${newLevel + 1}`.toLowerCase();
};
