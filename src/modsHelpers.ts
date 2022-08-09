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
