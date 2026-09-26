import { describe, expect, it } from "vitest";

import appReducer, { addCategory, removeCategory, renameCategory, setAreModsEnabled, toggleMod } from "../src/appSlice";
import initialState from "../src/initialAppState";

const createMod = (name: string, isEnabled: boolean, categories: string[] = []): Mod =>
  ({
    name,
    humanName: name,
    path: `/mods/${name}`,
    imgPath: "",
    workshopId: name,
    isEnabled,
    modDirectory: "/mods",
    isInData: false,
    loadOrder: undefined,
    author: "",
    isDeleted: false,
    isMovie: false,
    size: 1,
    isSymbolicLink: false,
    categories,
    tags: [],
    reqModIdToName: [],
  }) as Mod;

describe("category state", () => {
  it("keeps always-enabled mods enabled through direct and bulk toggles", () => {
    const alwaysEnabled = createMod("always.pack", false, ["Alpha"]);
    const regular = createMod("regular.pack", true, ["Alpha"]);
    const base = {
      ...initialState,
      alwaysEnabledModNames: [alwaysEnabled.name],
      currentPreset: { name: "", mods: [alwaysEnabled, regular] },
    } as AppState;

    let state = appReducer(
      base,
      setAreModsEnabled([
        { mod: alwaysEnabled, isEnabled: false },
        { mod: regular, isEnabled: false },
      ]),
    );
    expect(state.currentPreset.mods.map((mod) => mod.isEnabled)).toEqual([true, false]);

    state = appReducer(state, toggleMod(alwaysEnabled));
    expect(state.currentPreset.mods[0].isEnabled).toBe(true);
  });

  it("preserves a category color and cached categories when renaming", () => {
    const liveMod = createMod("live.pack", false, ["Old"]);
    const state = appReducer(
      {
        ...initialState,
        categories: ["Old"],
        categoryColors: { Old: "rose" },
        currentPreset: { name: "", mods: [liveMod] },
        dataFromConfig: {
          modUserData: {
            "missing.pack": { categories: ["Old"], humanName: "Missing" },
          },
        },
      } as AppState,
      renameCategory({ oldCategory: "Old", newCategory: "New" }),
    );

    expect(state.currentPreset.mods[0].categories).toEqual(["New"]);
    expect(state.categories).toEqual(["New"]);
    expect(state.categoryColors).toEqual({ New: "rose" });
    expect(state.dataFromConfig?.modUserData["missing.pack"].categories).toEqual(["New"]);
  });

  it("removes a deleted category from cached unavailable mods", () => {
    const liveMod = createMod("live.pack", false, ["Old"]);
    const state = appReducer(
      {
        ...initialState,
        categories: ["Old"],
        currentPreset: { name: "", mods: [liveMod] },
        dataFromConfig: {
          modUserData: {
            "missing.pack": { categories: ["Old", "Other"] },
          },
        },
      } as AppState,
      removeCategory({ category: "Old", mods: [liveMod] }),
    );

    expect(state.dataFromConfig?.modUserData["missing.pack"].categories).toEqual(["Other"]);
  });

  it("does not allow the synthetic Uncategorized bucket to become a stored category", () => {
    const mod = createMod("mod.pack", false);
    const state = appReducer(
      { ...initialState, currentPreset: { name: "", mods: [mod] } } as AppState,
      addCategory({ category: "Uncategorized", mods: [mod] }),
    );

    expect(state.categories).not.toContain("Uncategorized");
    expect(state.currentPreset.mods[0].categories).toEqual([]);
  });
});
