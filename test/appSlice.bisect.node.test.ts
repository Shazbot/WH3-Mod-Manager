import { describe, expect, it, vi } from "vitest";

import appReducer, { createBisectedModListPresets } from "../src/appSlice";
import initialState from "../src/initialAppState";

const createMod = (overrides: Partial<Mod> & Pick<Mod, "name" | "path">): Mod => ({
  humanName: overrides.name,
  name: overrides.name,
  path: overrides.path,
  imgPath: "",
  workshopId: overrides.workshopId ?? overrides.name,
  isEnabled: overrides.isEnabled ?? true,
  modDirectory: "",
  isInData: false,
  lastChanged: undefined,
  lastChangedLocal: undefined,
  loadOrder: overrides.loadOrder,
  author: "",
  isDeleted: false,
  isMovie: false,
  dependencyPacks: overrides.dependencyPacks,
  reqModIdToName: overrides.reqModIdToName,
  size: 0,
  mergedModsData: undefined,
  subbedTime: undefined,
  isSymbolicLink: false,
  categories: [],
  tags: [],
  isInModding: false,
  ...overrides,
});

const createState = (mods: Mod[]): AppState => ({
  ...initialState,
  currentPreset: {
    ...initialState.currentPreset,
    mods,
  },
  allMods: mods,
  presets: [],
});

const runBisect = (mods: Mod[], payload: { isRandom: boolean; ignoreDependencies: boolean }) =>
  appReducer(createState(mods), createBisectedModListPresets(payload));

const getCreatedPresetNames = (state: AppState) =>
  state.presets.slice(-2).map((preset) => preset.mods.map((mod) => mod.name));

describe("createBisectedModListPresets", () => {
  it("keeps workshop dependencies in the same preset by default", () => {
    const mods = [
      createMod({
        name: "a.pack",
        path: "/mods/a.pack",
        reqModIdToName: [["d-id", "D"]],
        workshopId: "a-id",
      }),
      createMod({ name: "b.pack", path: "/mods/b.pack", workshopId: "b-id" }),
      createMod({ name: "c.pack", path: "/mods/c.pack", workshopId: "c-id" }),
      createMod({ name: "d.pack", path: "/mods/d.pack", workshopId: "d-id" }),
    ];

    const state = runBisect(mods, { isRandom: false, ignoreDependencies: false });

    expect(getCreatedPresetNames(state)).toEqual([["a.pack", "d.pack"], ["b.pack", "c.pack"]]);
  });

  it("keeps pack-header dependencies in the same preset", () => {
    const mods = [
      createMod({ name: "a.pack", path: "/mods/a.pack", dependencyPacks: ["d.pack"] }),
      createMod({ name: "b.pack", path: "/mods/b.pack" }),
      createMod({ name: "c.pack", path: "/mods/c.pack" }),
      createMod({ name: "d.pack", path: "/mods/d.pack" }),
    ];

    const state = runBisect(mods, { isRandom: false, ignoreDependencies: false });

    expect(getCreatedPresetNames(state)).toEqual([["a.pack", "d.pack"], ["b.pack", "c.pack"]]);
  });

  it("keeps transitive dependency chains together even when the split becomes uneven", () => {
    const mods = [
      createMod({
        name: "a.pack",
        path: "/mods/a.pack",
        reqModIdToName: [["c-id", "C"]],
        workshopId: "a-id",
      }),
      createMod({ name: "b.pack", path: "/mods/b.pack", workshopId: "b-id" }),
      createMod({
        name: "c.pack",
        path: "/mods/c.pack",
        dependencyPacks: ["d.pack"],
        workshopId: "c-id",
      }),
      createMod({ name: "d.pack", path: "/mods/d.pack", workshopId: "d-id" }),
    ];

    const state = runBisect(mods, { isRandom: false, ignoreDependencies: false });

    expect(getCreatedPresetNames(state)).toEqual([["a.pack", "c.pack", "d.pack"], ["b.pack"]]);
  });

  it("randomizes dependency groups instead of splitting them", () => {
    const mods = [
      createMod({
        name: "a.pack",
        path: "/mods/a.pack",
        reqModIdToName: [["d-id", "D"]],
        workshopId: "a-id",
      }),
      createMod({
        name: "b.pack",
        path: "/mods/b.pack",
        reqModIdToName: [["c-id", "C"]],
        workshopId: "b-id",
      }),
      createMod({ name: "c.pack", path: "/mods/c.pack", workshopId: "c-id" }),
      createMod({ name: "d.pack", path: "/mods/d.pack", workshopId: "d-id" }),
    ];

    vi.spyOn(Math, "random").mockReturnValue(0);

    const state = runBisect(mods, { isRandom: true, ignoreDependencies: false });

    expect(getCreatedPresetNames(state)).toEqual([["b.pack", "c.pack"], ["a.pack", "d.pack"]]);
  });

  it("preserves the old split when dependency checks are bypassed", () => {
    const mods = [
      createMod({
        name: "a.pack",
        path: "/mods/a.pack",
        reqModIdToName: [["d-id", "D"]],
        workshopId: "a-id",
      }),
      createMod({ name: "b.pack", path: "/mods/b.pack", workshopId: "b-id" }),
      createMod({ name: "c.pack", path: "/mods/c.pack", workshopId: "c-id" }),
      createMod({ name: "d.pack", path: "/mods/d.pack", workshopId: "d-id" }),
    ];

    const state = runBisect(mods, { isRandom: false, ignoreDependencies: true });

    expect(getCreatedPresetNames(state)).toEqual([["a.pack", "b.pack"], ["c.pack", "d.pack"]]);
  });

  it("does not auto-add disabled dependencies from outside the enabled set", () => {
    const mods = [
      createMod({
        name: "a.pack",
        path: "/mods/a.pack",
        reqModIdToName: [["e-id", "E"]],
        workshopId: "a-id",
      }),
      createMod({ name: "b.pack", path: "/mods/b.pack", workshopId: "b-id" }),
      createMod({ name: "c.pack", path: "/mods/c.pack", workshopId: "c-id" }),
      createMod({ name: "d.pack", path: "/mods/d.pack", workshopId: "d-id" }),
      createMod({
        name: "e.pack",
        path: "/mods/e.pack",
        workshopId: "e-id",
        isEnabled: false,
      }),
    ];

    const state = runBisect(mods, { isRandom: false, ignoreDependencies: false });

    expect(getCreatedPresetNames(state)).toEqual([["a.pack", "b.pack"], ["c.pack", "d.pack"]]);
  });

  it("reassigns load order within each generated preset", () => {
    const mods = [
      createMod({
        name: "a.pack",
        path: "/mods/a.pack",
        reqModIdToName: [["d-id", "D"]],
        workshopId: "a-id",
        loadOrder: 0,
      }),
      createMod({ name: "b.pack", path: "/mods/b.pack", workshopId: "b-id", loadOrder: 1 }),
      createMod({ name: "c.pack", path: "/mods/c.pack", workshopId: "c-id", loadOrder: 2 }),
      createMod({ name: "d.pack", path: "/mods/d.pack", workshopId: "d-id", loadOrder: 3 }),
    ];

    const state = runBisect(mods, { isRandom: false, ignoreDependencies: false });
    const [firstPreset, secondPreset] = state.presets.slice(-2);

    expect(firstPreset.mods.map((mod) => [mod.name, mod.loadOrder])).toEqual([
      ["a.pack", 0],
      ["d.pack", 1],
    ]);
    expect(secondPreset.mods.map((mod) => [mod.name, mod.loadOrder])).toEqual([
      ["b.pack", 0],
      ["c.pack", 1],
    ]);
  });
});
