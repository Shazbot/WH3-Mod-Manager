import { describe, expect, it } from "vitest";

import appReducer, {
  applyPresetDraftMods,
  orderImportedMods,
  selectPreset,
  setImportedMods,
  setModLoadOrderRelativeTo,
  toggleMod,
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

  it("sanitizes custom positions when a disabled custom mod is re-enabled", () => {
    const alpha = createMod("alpha.pack", true, 0);
    const automatic = createMod("automatic.pack", true);
    const zeta = createMod("zeta.pack", false, 0);

    const state = appReducer(
      { ...initialState, currentPreset: { name: "", mods: [alpha, automatic, zeta] } },
      toggleMod(zeta),
    );

    expect(state.currentPreset.mods.find((mod) => mod.name === "alpha.pack")?.loadOrder).toBe(0);
    expect(state.currentPreset.mods.find((mod) => mod.name === "zeta.pack")?.loadOrder).toBe(1);
    expect(state.currentPreset.mods.find((mod) => mod.name === "automatic.pack")?.loadOrder).toBeUndefined();
  });

  it("does not partially apply an interrupted shared-mod import", () => {
    const alpha = createMod("alpha.pack", true, 0);
    const beta = createMod("beta.pack", false);
    const pendingState = appReducer(
      { ...initialState, currentPreset: { name: "", mods: [alpha, beta] } },
      setImportedMods([
        { workshopId: alpha.workshopId, loadOrder: undefined },
        { workshopId: "missing-workshop-id", loadOrder: 0 },
      ]),
    );

    const state = appReducer(pendingState, orderImportedMods());

    expect(state.currentPreset.mods).toEqual(pendingState.currentPreset.mods);
    expect(state.importedMods).toEqual(pendingState.importedMods);
  });

  it("applies a completed shared-mod import atomically with sparse ordering", () => {
    const alpha = createMod("alpha.pack", true, 4);
    const beta = createMod("beta.pack", false);
    const old = createMod("old.pack", true, 0);
    const pendingState = appReducer(
      { ...initialState, currentPreset: { name: "", mods: [alpha, beta, old] } },
      setImportedMods([
        { workshopId: beta.workshopId, loadOrder: 0 },
        { workshopId: alpha.workshopId, loadOrder: undefined },
      ]),
    );

    const state = appReducer(pendingState, orderImportedMods());

    expect(state.currentPreset.mods.find((mod) => mod.name === "beta.pack")).toMatchObject({
      isEnabled: true,
      loadOrder: 0,
    });
    expect(state.currentPreset.mods.find((mod) => mod.name === "alpha.pack")).toMatchObject({
      isEnabled: true,
      loadOrder: undefined,
    });
    expect(state.currentPreset.mods.find((mod) => mod.name === "old.pack")).toMatchObject({
      isEnabled: false,
      loadOrder: undefined,
    });
    expect(state.importedMods).toEqual([]);
  });

  it("matches imported data-folder mods by pack name", () => {
    const local = createMod("local.pack", false);
    local.workshopId = "";
    const workshop = createMod("workshop.pack", false);
    const pendingState = appReducer(
      { ...initialState, currentPreset: { name: "", mods: [local, workshop] } },
      setImportedMods([
        { workshopId: "", modName: local.name, loadOrder: 0 },
        { workshopId: workshop.workshopId, loadOrder: 1 },
      ]),
    );

    const state = appReducer(pendingState, orderImportedMods());

    expect(state.currentPreset.mods.find((mod) => mod.name === local.name)).toMatchObject({
      isEnabled: true,
      loadOrder: 0,
    });
    expect(state.currentPreset.mods.find((mod) => mod.name === workshop.name)).toMatchObject({
      isEnabled: true,
      loadOrder: 1,
    });
    expect(state.importedMods).toEqual([]);
  });

  it("falls back to the Workshop ID when the local pack is not installed", () => {
    const workshop = createMod("workshop-copy.pack", false);
    workshop.workshopId = "987654";
    const pendingState = appReducer(
      { ...initialState, currentPreset: { name: "", mods: [workshop] } },
      setImportedMods([
        { workshopId: workshop.workshopId, modName: "sender-local-copy.pack", loadOrder: 0 },
      ]),
    );

    const state = appReducer(pendingState, orderImportedMods());

    expect(state.currentPreset.mods[0]).toMatchObject({ isEnabled: true, loadOrder: 0 });
    expect(state.importedMods).toEqual([]);
  });
});
