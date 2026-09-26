import { describe, expect, it } from "vitest";

import appReducer, { importModsFromUsedMods, resolveUsedModsImport } from "../src/appSlice";
import initialState from "../src/initialAppState";
import { sortByNameAndLoadOrder } from "../src/modSortingHelpers";
import { SortingType } from "../src/utility/modRowSorting";

const createMod = (name: string): Mod =>
  ({
    name,
    path: `/mods/${name}`,
    isEnabled: true,
    loadOrder: 99,
  }) as Mod;

describe("importModsFromUsedMods", () => {
  it("waits for a choice when the previous mods use a custom order", () => {
    const mods = [createMod("alpha.pack"), createMod("beta.pack"), createMod("gamma.pack"), createMod("unused.pack")];
    const pendingState = appReducer(
      { ...initialState, currentPreset: { name: "", mods } },
      importModsFromUsedMods(["beta.pack", "alpha.pack", "gamma.pack", "missing.pack"]),
    );

    expect(pendingState.pendingUsedModsImport).toEqual(["beta.pack", "alpha.pack", "gamma.pack", "missing.pack"]);
    expect(pendingState.currentPreset.mods.every((mod) => mod.loadOrder === 99)).toBe(true);

    const state = appReducer(pendingState, resolveUsedModsImport("previous"));

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
    expect(state.pendingUsedModsImport).toBeUndefined();
    expect(state.modRowsSortingType).toBe(SortingType.Ordered);
  });

  it("uses automatic order when recommended", () => {
    const mods = [createMod("alpha.pack"), createMod("beta.pack"), createMod("gamma.pack")];
    const pendingState = appReducer(
      { ...initialState, currentPreset: { name: "", mods } },
      importModsFromUsedMods(["beta.pack", "alpha.pack", "gamma.pack"]),
    );

    const state = appReducer(pendingState, resolveUsedModsImport("automatic"));

    expect(state.currentPreset.mods.every((mod) => mod.isEnabled)).toBe(true);
    expect(state.currentPreset.mods.every((mod) => mod.loadOrder === undefined)).toBe(true);
    expect(state.pendingUsedModsImport).toBeUndefined();
  });

  it("imports immediately when the previous order already matches automatic order", () => {
    const mods = [createMod("alpha.pack"), createMod("beta.pack"), createMod("unused.pack")];
    const state = appReducer(
      { ...initialState, currentPreset: { name: "", mods } },
      importModsFromUsedMods(["alpha.pack", "beta.pack"]),
    );

    expect(state.pendingUsedModsImport).toBeUndefined();
    expect(state.currentPreset.mods.find((mod) => mod.name === "alpha.pack")?.isEnabled).toBe(true);
    expect(state.currentPreset.mods.find((mod) => mod.name === "beta.pack")?.isEnabled).toBe(true);
    expect(state.currentPreset.mods.find((mod) => mod.name === "unused.pack")?.isEnabled).toBe(false);
    expect(state.currentPreset.mods.every((mod) => mod.loadOrder === undefined)).toBe(true);
  });
});
