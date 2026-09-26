import { afterEach, beforeEach, describe, expect, it } from "vitest";

import appReducer, {
  addLoadOrderRule,
  removeLoadOrderRule,
  setLoadOrderRulePackDisabled,
  setModLoadOrderRuleDisabled,
  setModLoadOrderRules,
} from "../src/appSlice";
import initialState from "../src/initialAppState";
import { loadOrderRuleKey } from "../src/loadOrderRules";
import { getActiveLoadOrderEdges, resetActiveLoadOrderEdges, sortByNameAndLoadOrder } from "../src/modSortingHelpers";

const createMod = (name: string): Mod =>
  ({
    name,
    humanName: name,
    path: `/mods/${name}`,
    isEnabled: true,
    isInData: true,
    author: "",
    tags: [],
  }) as unknown as Mod;

const stateWithMods = (names: string[]): AppState => ({
  ...initialState,
  currentPreset: { ...initialState.currentPreset, mods: names.map(createMod) },
});

const reduceAll = (state: AppState, actions: { type: string; payload?: unknown }[]) =>
  actions.reduce((current, action) => appReducer(current, action as never), state);

describe("load order rule reducers", () => {
  beforeEach(() => resetActiveLoadOrderEdges());
  afterEach(() => resetActiveLoadOrderEdges());

  const base = () => stateWithMods(["a.pack", "b.pack", "c.pack"]);

  it("stores a user rule and puts it into effect", () => {
    const next = appReducer(base(), addLoadOrderRule({ before: "c.pack", after: "a.pack", subjectPackName: "c.pack" }));

    expect(next.loadOrderRules).toEqual([{ before: "c.pack", after: "a.pack", subjectPackName: "c.pack" }]);
    expect(next.loadOrderRulesResolution.rules).toHaveLength(1);
    expect(sortByNameAndLoadOrder(next.currentPreset.mods).map((mod) => mod.name)).toEqual([
      "c.pack",
      "a.pack",
      "b.pack",
    ]);
  });

  it("normalizes the pack names it is given", () => {
    const next = appReducer(base(), addLoadOrderRule({ before: "C", after: "a", subjectPackName: "C" }));
    expect(next.loadOrderRules).toEqual([{ before: "C.pack", after: "a.pack", subjectPackName: "C.pack" }]);
  });

  it("replaces an existing rule about the same pair instead of contradicting it", () => {
    const next = reduceAll(base(), [
      addLoadOrderRule({ before: "a.pack", after: "b.pack", subjectPackName: "a.pack" }),
      addLoadOrderRule({ before: "b.pack", after: "a.pack", subjectPackName: "b.pack" }),
    ]);

    expect(next.loadOrderRules).toEqual([{ before: "b.pack", after: "a.pack", subjectPackName: "b.pack" }]);
    expect(next.loadOrderRulesResolution.conflicts).toHaveLength(0);
  });

  it("ignores a rule pointing a pack at itself", () => {
    const next = appReducer(base(), addLoadOrderRule({ before: "a.pack", after: "A.PACK", subjectPackName: "a.pack" }));
    expect(next.loadOrderRules).toEqual([]);
  });

  it("removes a rule regardless of how the name is spelled", () => {
    const next = reduceAll(base(), [
      addLoadOrderRule({ before: "a.pack", after: "b.pack", subjectPackName: "a.pack" }),
      removeLoadOrderRule({ before: "A", after: "B.PACK" }),
    ]);

    expect(next.loadOrderRules).toEqual([]);
    expect(next.loadOrderRulesResolution.rules).toHaveLength(0);
  });

  it("publishes the edges to the ambient registry for callers outside react", () => {
    expect(getActiveLoadOrderEdges().edgeCount).toBe(0);
    appReducer(base(), addLoadOrderRule({ before: "c.pack", after: "a.pack", subjectPackName: "c.pack" }));
    expect(getActiveLoadOrderEdges().edgeCount).toBe(1);
  });

  describe("mod-supplied rules", () => {
    const withModRules = () =>
      appReducer(
        base(),
        setModLoadOrderRules({
          "c.pack": [{ before: "c.pack", after: "a.pack", sourcePackName: "c.pack", subjectPackName: "c.pack" }],
        }),
      );

    it("applies them without the user doing anything", () => {
      const next = withModRules();
      expect(next.loadOrderRulesResolution.rules).toHaveLength(1);
      expect(sortByNameAndLoadOrder(next.currentPreset.mods).map((mod) => mod.name)).toEqual([
        "c.pack",
        "a.pack",
        "b.pack",
      ]);
    });

    it("switches one off and keeps it listed so it can come back", () => {
      const rule = { before: "c.pack", after: "a.pack", sourcePackName: "c.pack", subjectPackName: "c.pack" };
      const next = appReducer(withModRules(), setModLoadOrderRuleDisabled({ rule, isDisabled: true }));

      expect(next.disabledModLoadOrderRules).toEqual([loadOrderRuleKey(rule)]);
      expect(next.loadOrderRulesResolution.rules).toHaveLength(0);
      expect(next.loadOrderRulesResolution.disabledRules).toHaveLength(1);
      expect(sortByNameAndLoadOrder(next.currentPreset.mods).map((mod) => mod.name)).toEqual([
        "a.pack",
        "b.pack",
        "c.pack",
      ]);
    });

    it("switches one back on", () => {
      const rule = { before: "c.pack", after: "a.pack", sourcePackName: "c.pack", subjectPackName: "c.pack" };
      const next = reduceAll(withModRules(), [
        setModLoadOrderRuleDisabled({ rule, isDisabled: true }),
        setModLoadOrderRuleDisabled({ rule, isDisabled: false }),
      ]);

      expect(next.disabledModLoadOrderRules).toEqual([]);
      expect(next.loadOrderRulesResolution.rules).toHaveLength(1);
    });

    it("refuses to disable a rule the user made, which is deleted instead", () => {
      const next = reduceAll(base(), [
        addLoadOrderRule({ before: "c.pack", after: "a.pack", subjectPackName: "c.pack" }),
        setModLoadOrderRuleDisabled({ rule: { before: "c.pack", after: "a.pack" }, isDisabled: true }),
      ]);

      expect(next.disabledModLoadOrderRules).toEqual([]);
      expect(next.loadOrderRulesResolution.rules).toHaveLength(1);
    });

    it("mutes a whole pack, covering rules it adds afterwards", () => {
      const muted = appReducer(withModRules(), setLoadOrderRulePackDisabled({ packName: "c.pack", isDisabled: true }));
      expect(muted.loadOrderRulesResolution.rules).toHaveLength(0);

      const withNewerRule = appReducer(
        muted,
        setModLoadOrderRules({
          "c.pack": [
            { before: "c.pack", after: "a.pack", sourcePackName: "c.pack", subjectPackName: "c.pack" },
            { before: "c.pack", after: "b.pack", sourcePackName: "c.pack", subjectPackName: "c.pack" },
          ],
        }),
      );

      expect(withNewerRule.loadOrderRulesResolution.rules).toHaveLength(0);
      expect(withNewerRule.loadOrderRulesResolution.disabledRules).toHaveLength(2);
    });

    it("lets a user rule supersede a mod rule about the same pair", () => {
      const next = appReducer(
        withModRules(),
        addLoadOrderRule({ before: "a.pack", after: "c.pack", subjectPackName: "a.pack" }),
      );

      expect(next.loadOrderRulesResolution.rules).toEqual([
        expect.objectContaining({ before: "a.pack", after: "c.pack" }),
      ]);
      expect(next.loadOrderRulesResolution.supersededRules).toHaveLength(1);
    });
  });

  /**
   * The reported case, driven through the reducer rather than the sorter, so it covers the whole
   * path the app actually takes: add rules in the tab, resolve, then sort.
   */
  it("moves the mod the rules were added on, leaving every other mod alone", () => {
    // Name order is !patch, alpha, beta, gamma, zeta, so beta really does sit between the two mods
    // the rules name and would be displaced by a sort that reorders whatever it likes.
    const mods = stateWithMods(["!patch.pack", "alpha.pack", "beta.pack", "gamma.pack", "zeta.pack"]);
    const next = reduceAll(mods, [
      addLoadOrderRule({ before: "alpha.pack", after: "!patch.pack", subjectPackName: "!patch.pack" }),
      addLoadOrderRule({ before: "gamma.pack", after: "!patch.pack", subjectPackName: "!patch.pack" }),
    ]);

    expect(sortByNameAndLoadOrder(next.currentPreset.mods).map((mod) => mod.name)).toEqual([
      "alpha.pack",
      "beta.pack",
      "gamma.pack",
      "!patch.pack",
      "zeta.pack",
    ]);
  });

  it("rejects a rule whose subject is neither of the two mods", () => {
    const next = appReducer(base(), addLoadOrderRule({ before: "a.pack", after: "b.pack", subjectPackName: "c.pack" }));

    expect(next.loadOrderRules).toEqual([]);
  });

  it("reports a rule naming a pack that is not installed", () => {
    const next = appReducer(
      base(),
      addLoadOrderRule({ before: "a.pack", after: "nowhere.pack", subjectPackName: "a.pack" }),
    );

    expect(next.loadOrderRulesResolution.rules).toHaveLength(0);
    expect(next.loadOrderRulesResolution.conflicts).toEqual([
      expect.objectContaining({ kind: "missingPack", packName: "nowhere.pack" }),
    ]);
  });
});
