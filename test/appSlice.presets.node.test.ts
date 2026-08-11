import { describe, expect, it } from "vitest";

import appReducer, {
  addPreset,
  createOnGameStartPreset,
  deletePreset,
  replacePreset,
  selectPreset,
  setIsModEnabled,
} from "../src/appSlice";
import initialState from "../src/initialAppState";
import { toPresetEntries } from "../src/config/presetEntries";
import { sortByNameAndLoadOrder } from "../src/modSortingHelpers";

const createMod = (name: string, isEnabled: boolean, loadOrder?: number): Mod =>
  ({
    name,
    humanName: `Human ${name}`,
    path: `/mods/${name}`,
    imgPath: "",
    workshopId: `id-${name}`,
    isEnabled,
    modDirectory: "/mods",
    isInData: false,
    loadOrder,
    author: "Author",
    isDeleted: false,
    isMovie: false,
    size: 1,
    isSymbolicLink: false,
    tags: [],
    reqModIdToName: [],
  }) as Mod;

const enabledNames = (mods: Mod[]) => mods.filter((mod) => mod.isEnabled).map((mod) => mod.name);

describe("presets", () => {
  it("stores only membership and order, never copies of mod records", () => {
    const mods = [createMod("alpha.pack", true, 0), createMod("beta.pack", false)];

    const state = appReducer(
      { ...initialState, currentPreset: { name: "", mods, version: 2 } },
      addPreset({ name: "Saved", mods: toPresetEntries(mods) }),
    );

    const preset = state.presets.find((iterPreset) => iterPreset.name === "Saved");
    expect(preset?.mods).toEqual([{ name: "alpha.pack", loadOrder: 0 }]);
    expect(JSON.stringify(preset)).not.toContain("/mods/alpha.pack");
  });

  it("round-trips the enabled set and order through save and re-select", () => {
    const mods = [
      createMod("alpha.pack", true, 1),
      createMod("beta.pack", true, 0),
      createMod("gamma.pack", false),
    ];

    // PresetsTab sorts the draft before saving, so the preset's array order is the load order
    let state = appReducer(
      { ...initialState, currentPreset: { name: "", mods, version: 2 } },
      addPreset({ name: "Saved", mods: sortByNameAndLoadOrder(toPresetEntries(mods)) }),
    );

    // wander away from the saved state
    state = appReducer(state, setIsModEnabled({ mod: createMod("gamma.pack", false), isEnabled: true }));
    state = appReducer(state, setIsModEnabled({ mod: createMod("alpha.pack", true), isEnabled: false }));
    expect(enabledNames(state.currentPreset.mods).sort()).toEqual(["beta.pack", "gamma.pack"]);

    state = appReducer(state, selectPreset(["Saved", "unary"]));

    expect(enabledNames(state.currentPreset.mods)).toEqual(["beta.pack", "alpha.pack"]);
    expect(state.currentPreset.mods.find((mod) => mod.name === "beta.pack")?.loadOrder).toBe(0);
    expect(state.currentPreset.mods.find((mod) => mod.name === "alpha.pack")?.loadOrder).toBe(1);
  });

  it("adds and subtracts a preset's mods without touching the rest", () => {
    const mods = [
      createMod("alpha.pack", false),
      createMod("beta.pack", false),
      createMod("gamma.pack", true),
    ];
    const base = {
      ...initialState,
      currentPreset: { name: "", mods, version: 2 },
      presets: [{ name: "Pair", version: 2, mods: [{ name: "alpha.pack" }, { name: "beta.pack" }] }],
    };

    const added = appReducer(base, selectPreset(["Pair", "addition"]));
    expect(enabledNames(added.currentPreset.mods).sort()).toEqual([
      "alpha.pack",
      "beta.pack",
      "gamma.pack",
    ]);

    const subtracted = appReducer(added, selectPreset(["Pair", "subtraction"]));
    expect(enabledNames(subtracted.currentPreset.mods)).toEqual(["gamma.pack"]);
  });

  it("keeps disabled mods in the snapshot presets so their position survives", () => {
    const mods = [createMod("alpha.pack", false), createMod("beta.pack", true)];

    const state = appReducer(
      { ...initialState, currentPreset: { name: "", mods, version: 2 } },
      createOnGameStartPreset(),
    );

    const preset = state.presets.find((iterPreset) => iterPreset.name === "On Last Game Launch");
    expect(preset?.mods).toEqual([{ name: "alpha.pack", isEnabled: false }, { name: "beta.pack" }]);
  });

  it("replaces and deletes presets by name", () => {
    const mods = [createMod("alpha.pack", true)];
    let state = appReducer(
      {
        ...initialState,
        currentPreset: { name: "", mods, version: 2 },
        presets: [{ name: "Saved", version: 2, mods: [{ name: "old.pack" }] }],
      },
      replacePreset("Saved"),
    );
    expect(state.presets[0].mods).toEqual([{ name: "alpha.pack" }]);

    state = appReducer(state, deletePreset("Saved"));
    expect(state.presets).toEqual([]);
    expect(state.lastSelectedPreset).toBeNull();
  });
});
