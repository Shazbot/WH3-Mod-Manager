/** An enabled mod paired with the `[workshopId, humanName]` entries of its required mods that are not enabled. */
export type MissingModDependency = [Mod, [string, string][]];

/**
 * Splits mods with missing requirements into ones we still warn about and ones the user chose to ignore.
 * @param missingModDependencies Enabled mods paired with their missing required mods.
 * @param ignoredModNames Pack names of parent mods the user ignored.
 * @returns The `active` groups to warn about and the `ignored` groups, both in their original order.
 */
export function splitIgnoredMissingModDependencies(
  missingModDependencies: MissingModDependency[],
  ignoredModNames: string[],
): { active: MissingModDependency[]; ignored: MissingModDependency[] } {
  const ignoredNames = new Set(ignoredModNames);
  return {
    active: missingModDependencies.filter(([mod]) => !ignoredNames.has(mod.name)),
    ignored: missingModDependencies.filter(([mod]) => ignoredNames.has(mod.name)),
  };
}
