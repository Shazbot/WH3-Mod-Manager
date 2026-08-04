import { describe, expect, it } from "vitest";

import appReducer, { importModsFromUsedMods } from "../src/appSlice";
import initialState from "../src/initialAppState";
import { sortByNameAndLoadOrder } from "../src/modSortingHelpers";

const createMod = (name: string): Mod =>
  ({
    name,
    path: `/mods/${name}`,
    isEnabled: true,
    loadOrder: 99,
  }) as Mod;

describe("importModsFromUsedMods", () => {
  it("enables available file entries, disables the rest, and applies minimal ordering", () => {
    const mods = [
      createMod("alpha.pack"),
      createMod("beta.pack"),
      createMod("gamma.pack"),
      createMod("unused.pack"),
    ];
    const state = appReducer(
      { ...initialState, currentPreset: { name: "", mods } },
      importModsFromUsedMods(["beta.pack", "alpha.pack", "gamma.pack", "missing.pack"]),
    );

    const enabledMods = state.currentPreset.mods.filter((mod) => mod.isEnabled);
    expect(sortByNameAndLoadOrder(enabledMods).map((mod) => mod.name)).toEqual([
      "beta.pack",
      "alpha.pack",
      "gamma.pack",
    ]);
    expect(enabledMods.filter((mod) => mod.loadOrder !== undefined)).toHaveLength(1);
    expect(state.currentPreset.mods.find((mod) => mod.name === "unused.pack")).toMatchObject({
      isEnabled: false,
      loadOrder: undefined,
    });
  });
});
