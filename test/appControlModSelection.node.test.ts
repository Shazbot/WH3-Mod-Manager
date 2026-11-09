import { describe, expect, it } from "vitest";

import { ControlError, planSelection, resolveMods } from "../src/appControl/modSelection";
import initialState from "../src/initialAppState";

const createMod = (name: string, overrides: Partial<Mod> = {}): Mod => ({
  humanName: `${name} display`,
  name,
  path: `C:/mods/${name}`,
  imgPath: "",
  workshopId: `id_${name}`,
  isEnabled: false,
  modDirectory: "",
  isInData: false,
  loadOrder: undefined,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 0,
  isSymbolicLink: false,
  categories: [],
  tags: [],
  ...overrides,
});

const createState = (mods: Mod[], overrides: Partial<AppState> = {}): AppState => ({
  ...initialState,
  currentPreset: { ...initialState.currentPreset, mods },
  allMods: mods,
  presets: [],
  alwaysEnabledModNames: [],
  ...overrides,
});

describe("app control mod selection", () => {
  const mods = [
    createMod("alpha.pack", { isEnabled: true }),
    createMod("beta.pack"),
    createMod("gamma.pack", { workshopId: "12345" }),
  ];

  it("matches pack names with or without .pack, Workshop IDs, and display names", () => {
    expect(resolveMods(mods, ["ALPHA", "beta.pack", "12345", "beta.pack display"]).map((mod) => mod.name)).toEqual([
      "alpha.pack",
      "beta.pack",
      "gamma.pack",
      "beta.pack",
    ]);
  });

  it("reports every unmatched or ambiguous identifier", () => {
    const duplicated = [
      ...mods,
      createMod("delta.pack", { humanName: "Shared" }),
      createMod("epsilon.pack", { humanName: "Shared" }),
    ];
    expect(() => resolveMods(duplicated, ["missing", "shared"])).toThrow(ControlError);
    try {
      resolveMods(duplicated, ["missing", "shared"]);
    } catch (error) {
      expect((error as ControlError).details).toEqual({
        missing: ["missing"],
        ambiguous: [{ identifier: "shared", matches: ["delta.pack", "epsilon.pack"] }],
      });
    }
  });

  it("enables exactly the requested mods without touching the original state", () => {
    const state = createState(mods);
    const plan = planSelection(state, { only: ["beta", "gamma"] });
    expect(plan.enabledMods.sort()).toEqual(["beta.pack", "gamma.pack"]);
    expect(plan.changed).toEqual({ enabled: ["beta.pack", "gamma.pack"], disabled: ["alpha.pack"], loadOrder: false });
    expect(state.currentPreset.mods.find((mod) => mod.name === "alpha.pack")?.isEnabled).toBe(true);
  });

  it("keeps always-enabled mods on and warns when asked to disable them", () => {
    const state = createState(mods, { alwaysEnabledModNames: ["alpha.pack"] });
    const plan = planSelection(state, { disable: ["alpha"] });
    expect(plan.enabledMods).toEqual(["alpha.pack"]);
    expect(plan.warnings).toEqual(["alpha.pack is always enabled, so it stays enabled."]);
  });

  it("applies a preset before enable and disable changes", () => {
    const state = createState(mods, {
      presets: [{ name: "Campaign", mods: [{ name: "beta.pack" }] as SavedPreset["mods"] }],
    });
    const plan = planSelection(state, { preset: "Campaign", enable: ["gamma"] });
    expect(plan.enabledMods.sort()).toEqual(["beta.pack", "gamma.pack"]);
  });

  it("enables ordered mods, loads them first, and clears other manual positions", () => {
    const state = createState([
      createMod("alpha.pack", { isEnabled: true }),
      createMod("beta.pack"),
      createMod("delta.pack", { isEnabled: true, loadOrder: 0 }),
      createMod("gamma.pack"),
      createMod("zeta.pack", { isEnabled: true }),
    ]);
    const plan = planSelection(state, { order: ["gamma", "zeta.pack", "alpha"] });
    expect(plan.enabledMods).toEqual(["gamma.pack", "zeta.pack", "alpha.pack", "delta.pack"]);
    expect(plan.changed).toEqual({ enabled: ["gamma.pack"], disabled: [], loadOrder: true });
    const loadOrders = Object.fromEntries(plan.nextState.currentPreset.mods.map((mod) => [mod.name, mod.loadOrder]));
    expect(loadOrders).toEqual({
      "alpha.pack": 2,
      "beta.pack": undefined,
      "delta.pack": undefined,
      "gamma.pack": 0,
      "zeta.pack": 1,
    });
  });

  it("reports an unchanged load order when the order already matches", () => {
    const state = createState([
      createMod("alpha.pack", { isEnabled: true }),
      createMod("beta.pack", { isEnabled: true }),
    ]);
    expect(planSelection(state, { order: ["alpha", "beta"] }).changed.loadOrder).toBe(false);
    expect(planSelection(state, { order: ["beta"] }).enabledMods).toEqual(["beta.pack", "alpha.pack"]);
  });

  it("applies the order after only, so the ordered mods stay enabled", () => {
    const state = createState(mods);
    const plan = planSelection(state, { only: ["beta"], order: ["gamma", "beta"] });
    expect(plan.enabledMods).toEqual(["gamma.pack", "beta.pack"]);
  });

  it("rejects repeated ordered mods and ordered mods that are also disabled", () => {
    const state = createState(mods);
    expect(() => planSelection(state, { order: ["beta", "beta.pack"] })).toThrow("listed more than once");
    expect(() => planSelection(state, { order: ["beta"], disable: ["beta"] })).toThrow("both enabled and disabled");
  });

  it("rejects unknown presets and mods named in both enable and disable", () => {
    const state = createState(mods);
    expect(() => planSelection(state, { preset: "Nope" })).toThrow("Unknown preset: Nope");
    expect(() => planSelection(state, { enable: ["beta"], disable: ["beta.pack"] })).toThrow(
      "both enabled and disabled",
    );
  });
});
