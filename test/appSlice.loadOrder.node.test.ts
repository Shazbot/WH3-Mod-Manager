import { describe, expect, it } from "vitest";

import appReducer, {
  applyPresetDraftMods,
  selectPreset,
  setModLoadOrderRelativeTo,
} from "../src/appSlice";
import initialState from "../src/initialAppState";
import { sortByNameAndLoadOrder } from "../src/modSortingHelpers";

const createMod = (name: string, isEnabled: boolean, loadOrder?: number): Mod =>
  ({
    name,
    humanName: name,
    path: `/mods/${name}`,
    imgPath: "",
    workshopId: name,
    isEnabled,
    modDirectory: "/mods",
    isInData: true,
    loadOrder,
    author: "",
    isDeleted: false,
    isMovie: false,
    size: 1,
    isSymbolicLink: false,
    tags: [],
    reqModIdToName: [],
  }) as Mod;

const orderedEnabledNames = (mods: Mod[]) =>
  sortByNameAndLoadOrder(mods.filter((mod) => mod.isEnabled)).map((mod) => mod.name);

describe("load-order reducer behavior", () => {
  it("fully replaces stale orders without making always-enabled mods custom", () => {
    const always = createMod("always.pack", true, 0);
    const alpha = createMod("alpha.pack", true, 1);
    const beta = createMod("beta.pack", true, 2);
    const absent = createMod("absent.pack", true, 3);

    const state = appReducer(
      {
        ...initialState,
        alwaysEnabledMods: [{ ...always }],
        currentPreset: { name: "", mods: [always, alpha, beta, absent] },
      },
      applyPresetDraftMods({
        mods: [createMod("beta.pack", true, 0), createMod("alpha.pack", true, 1)],
      }),
    );

    expect(orderedEnabledNames(state.currentPreset.mods)).toEqual([
      "beta.pack",
      "alpha.pack",
      "always.pack",
    ]);
    expect(state.currentPreset.mods.find((mod) => mod.name === "beta.pack")?.loadOrder).toBe(0);
    expect(state.currentPreset.mods.find((mod) => mod.name === "alpha.pack")?.loadOrder).toBe(1);
    expect(state.currentPreset.mods.find((mod) => mod.name === "always.pack")?.loadOrder).toBeUndefined();
    expect(state.currentPreset.mods.find((mod) => mod.name === "absent.pack")).toMatchObject({
      isEnabled: false,
      loadOrder: undefined,
    });
  });

  it("only makes the moved mod custom while using the complete visual list", () => {
    const alpha = createMod("alpha.pack", true);
    const beta = createMod("beta.pack", true);
    const hidden = createMod("hidden.pack", true);
    const disabled = createMod("disabled.pack", false, 3);

    const state = appReducer(
      {
        ...initialState,
        currentPreset: { name: "", mods: [alpha, beta, hidden, disabled] },
      },
      setModLoadOrderRelativeTo({
        modNameToChange: beta.name,
        modNameRelativeTo: alpha.name,
        visualModList: [alpha, beta, hidden],
        setAfterMod: false,
      }),
    );

    expect(orderedEnabledNames(state.currentPreset.mods)).toEqual([
      "beta.pack",
      "alpha.pack",
      "hidden.pack",
    ]);
    expect(state.currentPreset.mods.find((mod) => mod.name === "beta.pack")?.loadOrder).toBe(0);
    expect(state.currentPreset.mods.find((mod) => mod.name === "alpha.pack")?.loadOrder).toBeUndefined();
    expect(state.currentPreset.mods.find((mod) => mod.name === "hidden.pack")?.loadOrder).toBeUndefined();
    expect(state.currentPreset.mods.find((mod) => mod.name === "disabled.pack")?.loadOrder).toBe(3);
  });

  it("loads a saved custom preset in its exact order", () => {
    const mods = [
      createMod("alpha.pack", true),
      createMod("beta.pack", true),
      createMod("gamma.pack", true),
    ];
    const preset: Preset = {
      name: "Custom",
      version: 2,
      mods: [
        createMod("gamma.pack", true, 0),
        createMod("alpha.pack", true, 1),
        createMod("beta.pack", true, 2),
      ],
    };

    const state = appReducer(
      { ...initialState, currentPreset: { name: "", mods }, presets: [preset] },
      selectPreset([preset.name, "unary"]),
    );

    expect(orderedEnabledNames(state.currentPreset.mods)).toEqual([
      "gamma.pack",
      "alpha.pack",
      "beta.pack",
    ]);
    expect(state.currentPreset.mods.map((mod) => mod.loadOrder).sort()).toEqual([0, 1, 2]);
  });
});
