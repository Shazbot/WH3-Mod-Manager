export function withoutDataAndContentDuplicates(mods: Mod[]) {
  const inDataNames = new Set(mods.filter((m) => m.isInData).map((m) => m.name));
  return mods.filter((mod) => mod.isInData || !inDataNames.has(mod.name));
}

export function findAlwaysEnabledMods(mods: Mod[], alwaysEnabledMods: Mod[]) {
  const names = new Set(alwaysEnabledMods.map((m) => m.name));
  return mods.filter((m) => names.has(m.name));
}

export function findMod(mods: Mod[], mod: Mod) {
  return mods.find((iterMod) => iterMod.name === mod.name);
}

export function isModAlwaysEnabled(mod: Mod, alwaysEnabledMods: Mod[]) {
  return alwaysEnabledMods.find((iterMod) => iterMod.name === mod.name);
}

export function adjustDuplicates(mods: Mod[], modToKeepOrder: Mod) {
  mods
    .filter((mod) => mod.loadOrder != null)
    .sort((modF, modS) => (modF.loadOrder as number) - (modS.loadOrder as number))
    .forEach((mod) => {
      const duplicateMod = mods
        .filter((iterMod) => iterMod.name != mod.name)
        .find((iterMod) => mod.loadOrder === iterMod.loadOrder);
      if (duplicateMod && duplicateMod.loadOrder != null && duplicateMod != modToKeepOrder) {
        duplicateMod.loadOrder += 1;
        return adjustDuplicates(mods, duplicateMod);
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
