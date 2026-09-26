import { describe, expect, it } from "vitest";

import {
  applyLoadOrderEdges,
  buildLoadOrderEdges,
  findRulesOverriddenByPins,
  loadOrderPackNameKey,
  loadOrderRuleKey,
  normalizeLoadOrderPackName,
  replaceModLoadOrderRules,
  resolveLoadOrderRules,
  type LoadOrderRule,
} from "../src/loadOrderRules";

/**
 * These cases are about merging, precedence and cycles rather than placement, so they say nothing
 * about which mod a rule positions. A user rule defaults to being about its `before` pack and a
 * mod-supplied one to the pack that ships it, which is what the tab and the file parser produce.
 */
type RuleInput = { before: string; after: string; sourcePackName?: string; subjectPackName?: string };

const withDefaultSubject = (rule: RuleInput, fallbackSubject?: string): LoadOrderRule => ({
  ...rule,
  subjectPackName: rule.subjectPackName ?? fallbackSubject ?? rule.before,
});

const resolve = (input: {
  userRules?: RuleInput[];
  modRules?: Record<string, RuleInput[]>;
  disabledRuleKeys?: string[];
  disabledPackNames?: string[];
  presentPackNames?: string[];
}) =>
  resolveLoadOrderRules({
    userRules: (input.userRules ?? []).map((rule) => withDefaultSubject(rule)),
    modRules: Object.fromEntries(
      Object.entries(input.modRules ?? {}).map(([packName, rules]) => [
        packName,
        rules.map((rule) => withDefaultSubject(rule, packName)),
      ]),
    ),
    disabledRuleKeys: input.disabledRuleKeys,
    disabledPackNames: input.disabledPackNames,
    presentPackNames: input.presentPackNames ?? ["a.pack", "b.pack", "c.pack"],
  });

const named = (names: string[]) => names.map((name) => ({ name }));
const namesOf = (items: { name: string }[]) => items.map((item) => item.name);

describe("normalizeLoadOrderPackName", () => {
  it("adds the extension, strips folders and keeps the given casing", () => {
    expect(normalizeLoadOrderPackName("MyMod")).toBe("MyMod.pack");
    expect(normalizeLoadOrderPackName("MyMod.pack")).toBe("MyMod.pack");
    expect(normalizeLoadOrderPackName("  spaced.pack  ")).toBe("spaced.pack");
    expect(normalizeLoadOrderPackName("C:\\games\\data\\deep.pack")).toBe("deep.pack");
    expect(normalizeLoadOrderPackName("some/unix/path.pack")).toBe("path.pack");
    expect(normalizeLoadOrderPackName("   ")).toBe("");
  });

  it("compares case-insensitively without lowercasing what is stored", () => {
    expect(loadOrderPackNameKey("MyMod")).toBe("mymod.pack");
    expect(loadOrderPackNameKey("MYMOD.pack")).toBe(loadOrderPackNameKey("mymod"));
  });
});

describe("loadOrderRuleKey", () => {
  it("is stable regardless of how the pack wrote the name", () => {
    const first = loadOrderRuleKey({ before: "A", after: "B.pack", sourcePackName: "Src" });
    const second = loadOrderRuleKey({ before: "a.PACK", after: "b", sourcePackName: "src.pack" });
    expect(first).toBe(second);
  });

  it("separates a user rule from a mod rule about the same pair", () => {
    expect(loadOrderRuleKey({ before: "a.pack", after: "b.pack" })).not.toBe(
      loadOrderRuleKey({ before: "a.pack", after: "b.pack", sourcePackName: "c.pack" }),
    );
  });
});

describe("replaceModLoadOrderRules", () => {
  it("replaces only the saved pack's rules and removes it when the file is empty", () => {
    const previous = {
      "one.pack": [{ before: "one.pack", after: "two.pack", subjectPackName: "one.pack" }],
      "three.pack": [{ before: "three.pack", after: "four.pack", subjectPackName: "three.pack" }],
    };
    const next = replaceModLoadOrderRules(previous, "ONE.PACK", [
      { before: "one.pack", after: "four.pack", subjectPackName: "one.pack" },
    ]);

    expect(next).toEqual({
      "ONE.PACK": [{ before: "one.pack", after: "four.pack", subjectPackName: "one.pack" }],
      "three.pack": previous["three.pack"],
    });
    expect(replaceModLoadOrderRules(next, "one.pack", [])).toEqual({ "three.pack": previous["three.pack"] });
  });
});

describe("resolveLoadOrderRules", () => {
  it("keeps a plain user rule", () => {
    const { rules, edges, conflicts } = resolve({ userRules: [{ before: "a.pack", after: "b.pack" }] });
    expect(rules).toHaveLength(1);
    expect(edges.edgeCount).toBe(1);
    expect(conflicts).toHaveLength(0);
  });

  it("reports a rule naming a pack that is not in the list, and drops it", () => {
    const { rules, conflicts } = resolve({ userRules: [{ before: "a.pack", after: "missing.pack" }] });
    expect(rules).toHaveLength(0);
    expect(conflicts).toEqual([expect.objectContaining({ kind: "missingPack", packName: "missing.pack" })]);
  });

  it("ignores a rule pointing a pack at itself", () => {
    const { rules, conflicts } = resolve({ userRules: [{ before: "a.pack", after: "A.PACK" }] });
    expect(rules).toHaveLength(0);
    expect(conflicts).toHaveLength(0);
  });

  it("applies a mod's own rules automatically", () => {
    const { rules } = resolve({ modRules: { "a.pack": [{ before: "a.pack", after: "b.pack" }] } });
    expect(rules).toEqual([expect.objectContaining({ before: "a.pack", after: "b.pack", sourcePackName: "a.pack" })]);
  });

  it("lets a user rule override a mod rule about the same pair, in either direction", () => {
    const { rules, supersededRules } = resolve({
      userRules: [{ before: "b.pack", after: "a.pack" }],
      modRules: { "a.pack": [{ before: "a.pack", after: "b.pack" }] },
    });

    expect(rules).toEqual([expect.objectContaining({ before: "b.pack", after: "a.pack" })]);
    expect(rules[0].sourcePackName).toBeUndefined();
    expect(supersededRules).toEqual([expect.objectContaining({ sourcePackName: "a.pack" })]);
  });

  it("drops both mod rules when two mods demand opposite orders for one pair", () => {
    const { rules, conflicts } = resolve({
      modRules: {
        "a.pack": [{ before: "a.pack", after: "b.pack" }],
        "b.pack": [{ before: "b.pack", after: "a.pack" }],
      },
    });

    expect(rules).toHaveLength(0);
    expect(conflicts.filter((conflict) => conflict.kind === "contradiction")).toHaveLength(2);
  });

  it("keeps one edge when two mods happen to agree", () => {
    const { rules, conflicts } = resolve({
      modRules: {
        "a.pack": [{ before: "a.pack", after: "b.pack" }],
        "b.pack": [{ before: "a.pack", after: "b.pack" }],
      },
    });

    expect(rules).toHaveLength(1);
    expect(conflicts).toHaveLength(0);
  });

  it("breaks a cycle by dropping one rule and reporting it", () => {
    const { rules, conflicts, edges } = resolve({
      userRules: [
        { before: "a.pack", after: "b.pack" },
        { before: "b.pack", after: "c.pack" },
        { before: "c.pack", after: "a.pack" },
      ],
    });

    expect(rules).toHaveLength(2);
    expect(edges.edgeCount).toBe(2);
    expect(conflicts).toEqual([expect.objectContaining({ kind: "cycle" })]);
  });

  it("drops the same rule from a cycle whatever order the rules arrive in", () => {
    const cyclicRules: RuleInput[] = [
      { before: "a.pack", after: "b.pack" },
      { before: "b.pack", after: "c.pack" },
      { before: "c.pack", after: "a.pack" },
    ];

    const forwards = resolve({ userRules: cyclicRules });
    const backwards = resolve({ userRules: [...cyclicRules].reverse() });

    expect(backwards.conflicts.map((conflict) => loadOrderRuleKey(conflict.rule))).toEqual(
      forwards.conflicts.map((conflict) => loadOrderRuleKey(conflict.rule)),
    );
  });

  it("prefers the user's rule over a mod's when a cycle forces a choice", () => {
    const { rules, conflicts } = resolve({
      userRules: [{ before: "b.pack", after: "a.pack" }],
      modRules: {
        "c.pack": [
          { before: "a.pack", after: "c.pack" },
          { before: "c.pack", after: "b.pack" },
        ],
      },
    });

    expect(rules.some((rule) => rule.sourcePackName == undefined)).toBe(true);
    expect(conflicts).toEqual([expect.objectContaining({ kind: "cycle" })]);
  });

  describe("disabling", () => {
    const modRules = { "a.pack": [{ before: "a.pack", after: "b.pack" }] };

    it("produces no edge but still reports the rule so it can be restored", () => {
      const disabledRuleKeys = [loadOrderRuleKey({ before: "a.pack", after: "b.pack", sourcePackName: "a.pack" })];
      const { rules, edges, disabledRules } = resolve({ modRules, disabledRuleKeys });

      expect(rules).toHaveLength(0);
      expect(edges.edgeCount).toBe(0);
      expect(disabledRules).toEqual([expect.objectContaining({ before: "a.pack", after: "b.pack" })]);
    });

    it("mutes every rule from a pack, including one that pack adds later", () => {
      const { rules, disabledRules } = resolve({
        modRules: {
          "a.pack": [
            { before: "a.pack", after: "b.pack" },
            { before: "a.pack", after: "c.pack" },
          ],
        },
        disabledPackNames: ["A.PACK"],
      });

      expect(rules).toHaveLength(0);
      expect(disabledRules).toHaveLength(2);
    });

    it("never disables the user's own rules", () => {
      const { rules } = resolve({
        userRules: [{ before: "a.pack", after: "b.pack" }],
        disabledRuleKeys: [loadOrderRuleKey({ before: "a.pack", after: "b.pack" })],
        disabledPackNames: ["a.pack", "b.pack"],
      });

      expect(rules).toHaveLength(1);
    });

    it("rescues the rules that were being dropped alongside the disabled one", () => {
      const modRulesWithCycle = {
        "a.pack": [{ before: "a.pack", after: "b.pack" }],
        "b.pack": [{ before: "b.pack", after: "c.pack" }],
        "c.pack": [{ before: "c.pack", after: "a.pack" }],
      };

      const withCycle = resolve({ modRules: modRulesWithCycle });
      expect(withCycle.conflicts.filter((conflict) => conflict.kind === "cycle")).toHaveLength(1);

      const withoutOffender = resolve({ modRules: modRulesWithCycle, disabledPackNames: ["c.pack"] });
      expect(withoutOffender.conflicts).toHaveLength(0);
      expect(withoutOffender.rules).toHaveLength(2);
    });

    it("stops a disabled rule from causing a contradiction", () => {
      const { rules, conflicts } = resolve({
        modRules: {
          "a.pack": [{ before: "a.pack", after: "b.pack" }],
          "b.pack": [{ before: "b.pack", after: "a.pack" }],
        },
        disabledPackNames: ["b.pack"],
      });

      expect(conflicts).toHaveLength(0);
      expect(rules).toEqual([expect.objectContaining({ before: "a.pack", after: "b.pack" })]);
    });
  });
});

describe("applyLoadOrderEdges", () => {
  it("returns the input untouched when there are no rules", () => {
    const items = named(["a.pack", "b.pack", "c.pack"]);
    expect(applyLoadOrderEdges(items, buildLoadOrderEdges([]))).toBe(items);
  });

  it("moves only what the rules constrain and leaves the rest in place", () => {
    const edges = buildLoadOrderEdges([{ before: "c.pack", after: "a.pack", subjectPackName: "c.pack" }]);
    const sorted = applyLoadOrderEdges(named(["a.pack", "b.pack", "c.pack", "d.pack"]), edges);

    // c steps in front of a; b and d are named by no rule and must not be dragged along with them.
    expect(namesOf(sorted)).toEqual(["c.pack", "a.pack", "b.pack", "d.pack"]);
  });

  /**
   * The case that exposed this: a textbook topological sort emits whatever is unblocked first, so a
   * rule between two packs sent an unrelated third pack to the top of the list.
   */
  it("does not send an unrelated pack to the front when a rule blocks the first one", () => {
    const edges = buildLoadOrderEdges([
      { before: "ovn_araby.pack", after: "!b_mixer.pack", subjectPackName: "ovn_araby.pack" },
    ]);
    const sorted = applyLoadOrderEdges(named(["!b_mixer.pack", "groovy_mct.pack", "ovn_araby.pack"]), edges);

    expect(namesOf(sorted)).toEqual(["ovn_araby.pack", "!b_mixer.pack", "groovy_mct.pack"]);
  });

  it("keeps an unrelated pack in place no matter where it sits in the list", () => {
    const edges = buildLoadOrderEdges([{ before: "z.pack", after: "a.pack", subjectPackName: "z.pack" }]);

    expect(namesOf(applyLoadOrderEdges(named(["a.pack", "m.pack", "z.pack"]), edges))).toEqual([
      "z.pack",
      "a.pack",
      "m.pack",
    ]);
    expect(namesOf(applyLoadOrderEdges(named(["a.pack", "z.pack", "m.pack"]), edges))).toEqual([
      "z.pack",
      "a.pack",
      "m.pack",
    ]);
  });

  it("honours a rule that is only implied by two others", () => {
    // p before u and u before s means p must also precede s, even though no rule says so directly.
    const edges = buildLoadOrderEdges([
      { before: "p.pack", after: "u.pack", subjectPackName: "p.pack" },
      { before: "u.pack", after: "s.pack", subjectPackName: "u.pack" },
    ]);
    const sorted = applyLoadOrderEdges(named(["s.pack", "p.pack", "u.pack"]), edges);

    expect(namesOf(sorted)).toEqual(["p.pack", "u.pack", "s.pack"]);
  });

  it("keeps unconstrained packs in their original order", () => {
    const edges = buildLoadOrderEdges([{ before: "z.pack", after: "y.pack", subjectPackName: "z.pack" }]);
    const sorted = applyLoadOrderEdges(named(["a.pack", "b.pack", "y.pack", "z.pack"]), edges);

    expect(namesOf(sorted)).toEqual(["a.pack", "b.pack", "z.pack", "y.pack"]);
  });

  it("satisfies a chain of rules", () => {
    const edges = buildLoadOrderEdges([
      { before: "c.pack", after: "b.pack", subjectPackName: "c.pack" },
      { before: "b.pack", after: "a.pack", subjectPackName: "b.pack" },
    ]);
    const sorted = applyLoadOrderEdges(named(["a.pack", "b.pack", "c.pack"]), edges);

    expect(namesOf(sorted)).toEqual(["c.pack", "b.pack", "a.pack"]);
  });

  it("ignores rules about packs that are not in this list", () => {
    const edges = buildLoadOrderEdges([
      { before: "elsewhere.pack", after: "a.pack", subjectPackName: "elsewhere.pack" },
    ]);
    const items = named(["a.pack", "b.pack"]);

    expect(namesOf(applyLoadOrderEdges(items, edges))).toEqual(["a.pack", "b.pack"]);
  });

  it("matches pack names case-insensitively", () => {
    const edges = buildLoadOrderEdges([{ before: "B.PACK", after: "A.pack", subjectPackName: "B.PACK" }]);
    expect(namesOf(applyLoadOrderEdges(named(["a.pack", "b.pack"]), edges))).toEqual(["b.pack", "a.pack"]);
  });

  /**
   * The case that prompted this: a mod with two AFTER rules should walk down past the two mods it
   * names, rather than have them dragged up around it and a bystander shunted along with them.
   */
  it("moves the mod the rules belong to, not the mods it names", () => {
    const edges = buildLoadOrderEdges([
      { before: "alpha.pack", after: "!patch.pack", subjectPackName: "!patch.pack" },
      { before: "gamma.pack", after: "!patch.pack", subjectPackName: "!patch.pack" },
    ]);
    // These names are in the order compareModNames really produces, and beta genuinely sits between
    // the two mods the rules name - so it is what a sort that reorders freely would disturb.
    const sorted = applyLoadOrderEdges(
      named(["!patch.pack", "alpha.pack", "beta.pack", "gamma.pack", "zeta.pack"]),
      edges,
    );

    expect(namesOf(sorted)).toEqual(["alpha.pack", "beta.pack", "gamma.pack", "!patch.pack", "zeta.pack"]);
  });

  it("moves whichever end of the pair the rule was written on", () => {
    const items = named(["alpha.pack", "beta.pack", "zeta.pack"]);
    const constraint = { before: "zeta.pack", after: "alpha.pack" };

    const movingZeta = applyLoadOrderEdges(
      items,
      buildLoadOrderEdges([{ ...constraint, subjectPackName: "zeta.pack" }]),
    );
    const movingAlpha = applyLoadOrderEdges(
      items,
      buildLoadOrderEdges([{ ...constraint, subjectPackName: "alpha.pack" }]),
    );

    // The same constraint either way round; only the mod it belongs to gives way.
    expect(namesOf(movingZeta)).toEqual(["zeta.pack", "alpha.pack", "beta.pack"]);
    expect(namesOf(movingAlpha)).toEqual(["beta.pack", "zeta.pack", "alpha.pack"]);
  });

  /**
   * One mod's rules can imply an order between two *other* mods, and moving only the subject then
   * cannot satisfy them all. Those two are promoted to movers so the list is never left in a state
   * one of the user's own rules says is wrong.
   */
  it("moves other mods when the subject alone cannot satisfy every rule", () => {
    const rules = [
      { before: "m2.pack", after: "A.pack", subjectPackName: "A.pack" },
      { before: "A.pack", after: "x1.pack", subjectPackName: "A.pack" },
    ];
    const edges = buildLoadOrderEdges(rules);
    const sorted = namesOf(applyLoadOrderEdges(named(["x1.pack", "m2.pack", "A.pack"]), edges));

    for (const rule of rules) {
      expect(sorted.indexOf(rule.before)).toBeLessThan(sorted.indexOf(rule.after));
    }
  });

  it("keeps every item when handed edges that loop", () => {
    const edges = buildLoadOrderEdges([
      { before: "a.pack", after: "b.pack", subjectPackName: "a.pack" },
      { before: "b.pack", after: "a.pack", subjectPackName: "b.pack" },
    ]);
    const sorted = applyLoadOrderEdges(named(["a.pack", "b.pack", "c.pack"]), edges);

    expect(namesOf(sorted).toSorted()).toEqual(["a.pack", "b.pack", "c.pack"]);
  });
});

describe("findRulesOverriddenByPins", () => {
  it("reports a rule the final order does not satisfy", () => {
    const rules: LoadOrderRule[] = [{ before: "a.pack", after: "b.pack", subjectPackName: "a.pack" }];
    expect(findRulesOverriddenByPins(["b.pack", "a.pack"], rules)).toEqual([
      expect.objectContaining({ kind: "overriddenByPin" }),
    ]);
  });

  it("says nothing when the order already satisfies the rule", () => {
    expect(
      findRulesOverriddenByPins(
        ["a.pack", "b.pack"],
        [{ before: "a.pack", after: "b.pack", subjectPackName: "a.pack" }],
      ),
    ).toEqual([]);
  });
});
