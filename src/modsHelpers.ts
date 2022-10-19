export function withoutDataAndContentDuplicates(mods: Mod[]) {
  return mods.filter(
    (mod) =>
      mod.isInData ||
      (!mod.isInData && !mods.find((modOther) => modOther.name == mod.name && modOther.isInData))
  );
}

export function findAlwaysEnabledMods(mods: Mod[], alwaysEnabledMods: Mod[]) {
  return mods.filter((iterMod) => alwaysEnabledMods.find((mod) => mod.name === iterMod.name));
}

export function findMod(mods: Mod[], mod: Mod) {
  return mods.find((iterMod) => iterMod.name === mod.name);
}

export function isModAlwaysEnabled(mod: Mod, alwaysEnabledMods: Mod[]) {
  return alwaysEnabledMods.find((iterMod) => iterMod.name === mod.name);
}

export function adjustDuplicates(mods: Mod[]) {
  mods
    .filter((mod) => mod.loadOrder != null)
    .sort((modF, modS) => (modF.loadOrder as number) - (modS.loadOrder as number))
    .forEach((mod) => {
      const duplicateMod = mods
        .filter((iterMod) => iterMod.name != mod.name)
        .find((iterMod) => mod.loadOrder === iterMod.loadOrder);
      if (duplicateMod && duplicateMod.loadOrder) {
        duplicateMod.loadOrder += 1;
        return adjustDuplicates(mods);
      }
    });
}

export function printLoadOrders(mods: Mod[]) {
  mods.forEach((mod) => {
    if (mod.loadOrder) {
      console.log(`${mod.name} has load order ${mod.loadOrder}`);
    }
  });
}
