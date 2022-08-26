export function sortByNameAndLoadOrder(mods: Mod[]) {
  const newMods = [...mods];
  newMods.sort((firstMod, secondMod) => firstMod.name.localeCompare(secondMod.name));
  [...newMods]
    .filter((mod) => mod.loadOrder != null)
    .sort((modF, modS) => modF.loadOrder - modS.loadOrder)
    .map((mod) => {
      // console.log(`mod ${mod.name} has order ${mod.loadOrder}`);
      newMods.splice(newMods.indexOf(mod), 1);
      // newMods.splice(mod.loadOrder, 0, mod);
      return mod;
    })
    .forEach((mod) => {
      newMods.splice(mod.loadOrder, 0, mod);
    });
  return newMods;
}

export function getModsSortedByOrder(mods: Mod[], orderedMods: Mod[]) {
  return [...mods].sort(
    (firstMod, secondMod) => orderedMods.indexOf(firstMod) - orderedMods.indexOf(secondMod)
  );
}

export function getModsSortedByName(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => firstMod.name.localeCompare(secondMod.name));
}

export function getModsSortedByHumanName(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => firstMod.humanName.localeCompare(secondMod.humanName));
}

export function getModsSortedByEnabled(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    if (firstMod.isEnabled == secondMod.isEnabled) {
      return firstMod.name.localeCompare(secondMod.name);
    }
    return firstMod.isEnabled ? -1 : 1;
  });
}

export function getModsSortedByAuthor(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    if (firstMod.author == secondMod.author) {
      return firstMod.name.localeCompare(secondMod.name);
    }
    return firstMod.author.localeCompare(secondMod.author);
  });
}

export function getModsSortedByLastUpdated(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    if (firstMod.lastChanged === undefined && secondMod.lastChanged === undefined) return 0;
    if (firstMod.lastChanged === undefined) return 1;
    if (secondMod.lastChanged === undefined) return -1;
    return secondMod.lastChanged - firstMod.lastChanged;
  });
}

export function getFilteredMods(mods: Mod[], filter: string, doAuthorFiltering: boolean) {
  return mods.filter(
    (mod) =>
      mod.name.toLowerCase().includes(filter) ||
      mod.humanName.toLowerCase().includes(filter) ||
      (doAuthorFiltering && mod.author.toLowerCase().includes(filter))
  );
}
