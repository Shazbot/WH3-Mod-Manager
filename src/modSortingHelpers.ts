const collator = new Intl.Collator("en");

export function sortByNameAndLoadOrder(mods: Mod[]) {
  const sortedMods = getModsSortedByName(mods);
  const orderedMods = sortedMods
    .filter((mod) => mod.loadOrder != null)
    .sort((modF, modS) => (modF.loadOrder as number) - (modS.loadOrder as number));

  if (orderedMods.length === 0) return sortedMods;

  const orderedModSet = new Set(orderedMods);
  const unorderedMods = sortedMods.filter((mod) => !orderedModSet.has(mod));
  const newMods: Mod[] = [];
  let unorderedIndex = 0;
  let orderedIndex = 0;

  while (newMods.length < sortedMods.length) {
    while (orderedIndex < orderedMods.length && (orderedMods[orderedIndex].loadOrder as number) <= newMods.length) {
      newMods.push(orderedMods[orderedIndex]);
      orderedIndex++;
    }

    if (unorderedIndex < unorderedMods.length) {
      newMods.push(unorderedMods[unorderedIndex]);
      unorderedIndex++;
      continue;
    }

    newMods.push(orderedMods[orderedIndex]);
    orderedIndex++;
  }

  return newMods;
}

export function sortAsInPreset(mods: Mod[], modsInPreset: Mod[]) {
  const indexMap = new Map(modsInPreset.map((mod, i) => [mod.name, i]));
  const newMods = [...mods].sort((modF, modS) => {
    const modInPresetIndexF = indexMap.get(modF.name) ?? -1;
    const modInPresetIndexS = indexMap.get(modS.name) ?? -1;

    if (modInPresetIndexF != -1 && modInPresetIndexS != -1) return modInPresetIndexF - modInPresetIndexS;

    return compareModNames(modF.name, modS.name);
  });
  return newMods;
}

export function getModsSortedByOrder(mods: Mod[], orderedMods: Mod[]) {
  const orderedModIndices = new Map(orderedMods.map((mod, index) => [mod, index]));
  return [...mods].sort(
    (firstMod, secondMod) =>
      (orderedModIndices.get(firstMod) ?? Number.MAX_SAFE_INTEGER) -
      (orderedModIndices.get(secondMod) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function compareModNames(firstName: string, secondName: string): number {
  firstName = firstName.toLowerCase();
  secondName = secondName.toLowerCase();
  const len = Math.max(firstName.length, secondName.length);
  for (let i = 0; i < len; i++) {
    if (i === firstName.length) return 1;
    if (i === secondName.length) return -1;

    const diff = firstName.charCodeAt(i) - secondName.charCodeAt(i);
    if (diff === 0) continue;
    return diff < 0 ? -1 : 1;
  }

  return 0;
}

export function getModsSortedByName(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    return compareModNames(firstMod.name, secondMod.name);
  });
}

export function getModsSortedByIsDataPack(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    if (firstMod.isInData && secondMod.isInData) return compareModNames(firstMod.name, secondMod.name);
    if (firstMod.isInData) return -1;
    if (secondMod.isInData) return 1;
    return compareModNames(firstMod.name, secondMod.name);
  });
}

export function getModsSortedBySize(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    return firstMod.size - secondMod.size;
  });
}

export function getModsSortedByHumanName(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => collator.compare(firstMod.humanName, secondMod.humanName));
}

export function getModsSortedByHumanNameAndName(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    const firstModValue = (firstMod.humanName != "" && firstMod.humanName) || firstMod.name;
    const secondModValue = (secondMod.humanName != "" && secondMod.humanName) || secondMod.name;
    return collator.compare(firstModValue, secondModValue);
  });
}

export function getModsSortedByEnabled(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    if (firstMod.isEnabled == secondMod.isEnabled) {
      return compareModNames(firstMod.name, secondMod.name);
    }
    return firstMod.isEnabled ? -1 : 1;
  });
}

export function getModsSortedByAuthor(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    if (firstMod.author == secondMod.author) {
      return compareModNames(firstMod.name, secondMod.name);
    }
    return collator.compare(firstMod.author, secondMod.author);
  });
}

export function getModsSortedByCustomizable(mods: Mod[], customizableMods: Record<string, string[]>) {
  return [...mods].sort((firstMod, secondMod) => {
    if (customizableMods[firstMod.path] && !customizableMods[secondMod.path]) return -1;
    if (!customizableMods[firstMod.path] && customizableMods[secondMod.path]) return 1;
    return collator.compare(firstMod.author, secondMod.author);
  });
}

export function getModsSortedByLastUpdated(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    const firstModLastChanged = firstMod.lastChanged || firstMod.lastChangedLocal;
    const secondModLastChanged = secondMod.lastChanged || secondMod.lastChangedLocal;
    if (firstModLastChanged === undefined && secondModLastChanged === undefined) return 0;
    if (firstModLastChanged === undefined) return 1;
    if (secondModLastChanged === undefined) return -1;
    return secondModLastChanged - firstModLastChanged;
  });
}

export function getModsSortedBySubbedTime(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    const firstModLastChanged = firstMod.subbedTime || firstMod.lastChanged || firstMod.lastChangedLocal;
    const secondModLastChanged = secondMod.subbedTime || secondMod.lastChanged || secondMod.lastChangedLocal;
    if (firstModLastChanged === undefined && secondModLastChanged === undefined) return 0;
    if (firstModLastChanged === undefined) return 1;
    if (secondModLastChanged === undefined) return -1;
    return secondModLastChanged - firstModLastChanged;
  });
}

export function getFilteredMods(mods: Mod[], filter: string, doAuthorFiltering: boolean) {
  if (filter.startsWith("/") && filter.endsWith("/")) {
    const regexFilter = new RegExp(filter.slice(1, filter.length - 1), "i");
    return mods.filter(
      (mod) =>
        regexFilter.test(mod.name.replace(".pack", "")) ||
        (mod.humanName && regexFilter.test(mod.humanName)) ||
        (doAuthorFiltering && regexFilter.test(mod.author))
    );
  }

  return mods.filter(
    (mod) =>
      mod.name.replace(".pack", "").toLowerCase().includes(filter) ||
      (mod.humanName && mod.humanName.toLowerCase().includes(filter)) ||
      (doAuthorFiltering && mod.author.toLowerCase().includes(filter))
  );
}
