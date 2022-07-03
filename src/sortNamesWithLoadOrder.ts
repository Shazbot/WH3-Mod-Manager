export default function (mods: Mod[]) {
  const newMods = [...mods];
  newMods.sort((firstMod, secondMod) => firstMod.name.localeCompare(secondMod.name));
  [...newMods]
    .filter((mod) => !!mod.loadOrder)
    .sort((modF, modS) => modF.loadOrder - modS.loadOrder)
    .forEach((mod) => {
      if (mod.loadOrder) {
        console.log(`mod ${mod.name} has order ${mod.loadOrder}`);
        newMods.splice(newMods.indexOf(mod), 1);
        newMods.splice(mod.loadOrder - 1, 0, mod);
      }
    });
  return newMods;
}
