const normalizePackName = (packName: string) => {
  const pathParts = packName.replaceAll("/", "\\").split("\\");
  return pathParts[pathParts.length - 1].toLowerCase();
};

const modDependsOn = (sourceMod: Mod, targetMod: Mod, enabledModsByName: Map<string, Mod>) => {
  const targetName = normalizePackName(targetMod.name);
  const pendingDependencies = [...(sourceMod.dependencyPacks || [])];
  const visitedDependencies = new Set<string>();

  while (pendingDependencies.length > 0) {
    const dependencyName = normalizePackName(pendingDependencies.pop() as string);
    if (dependencyName === targetName) return true;
    if (visitedDependencies.has(dependencyName)) continue;
    visitedDependencies.add(dependencyName);

    const dependencyMod = enabledModsByName.get(dependencyName);
    if (dependencyMod?.dependencyPacks) {
      pendingDependencies.push(...dependencyMod.dependencyPacks);
    }
  }

  return false;
};

/**
 * Returns only startpos mods involved in an unordered conflict. Packs connected by a direct or
 * transitive dependency are intentionally ordered and therefore do not conflict with each other.
 */
export const getConflictingStartposMods = (enabledMods: readonly Mod[]) => {
  const startposMods = enabledMods.filter((mod) => mod.hasStartpos);
  if (startposMods.length < 2) return [];

  const enabledModsByName = new Map(enabledMods.map((mod) => [normalizePackName(mod.name), mod] as const));
  const conflictingMods = new Set<Mod>();

  for (let firstIndex = 0; firstIndex < startposMods.length; firstIndex++) {
    const firstMod = startposMods[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < startposMods.length; secondIndex++) {
      const secondMod = startposMods[secondIndex];
      const dependencyOrdersPair =
        modDependsOn(firstMod, secondMod, enabledModsByName) || modDependsOn(secondMod, firstMod, enabledModsByName);
      if (!dependencyOrdersPair) {
        conflictingMods.add(firstMod);
        conflictingMods.add(secondMod);
      }
    }
  }

  return startposMods.filter((mod) => conflictingMods.has(mod));
};
