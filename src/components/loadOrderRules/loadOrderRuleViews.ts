import { loadOrderPackNameKey, loadOrderRuleKey, type LoadOrderRule } from "../../loadOrderRules";
import { getModSortName } from "../../modSortingHelpers";

/**
 * Why a rule is or is not currently ordering anything. Everything the tab shows is one of these, so
 * a rule never simply disappears without the user being told which of these happened to it.
 */
export type LoadOrderRuleStatus =
  "active" | "disabled" | "mutedPack" | "superseded" | "cycle" | "contradiction" | "missingPack";

export interface LoadOrderRuleView {
  rule: LoadOrderRule;
  status: LoadOrderRuleStatus;
  /** The pack at the other end of the rule from the mod being looked at. */
  otherPackName: string;
  /** True when this mod loads earlier than the other one. */
  isBefore: boolean;
  /** A rule from a pack's own file cannot be deleted here; the file belongs to the mod. */
  isFromPack: boolean;
}

export interface ModRuleSummary {
  mod: Mod;
  sortName: string;
  ruleCount: number;
  /** Whether this mod ships rules of its own, and so can have them ignored wholesale. */
  shipsRules: boolean;
  isMuted: boolean;
}

const keysOf = (rules: LoadOrderRule[]) => new Set(rules.map(loadOrderRuleKey));

/** Every rule the app knows about, from both sources, before anything was resolved. */
export const collectAllLoadOrderRules = (
  userRules: LoadOrderRule[],
  modRules: Record<string, LoadOrderRule[]>,
): LoadOrderRule[] => [
  ...userRules.map((rule) => ({
    before: rule.before,
    after: rule.after,
    subjectPackName: rule.subjectPackName,
  })),
  ...Object.entries(modRules).flatMap(([sourcePackName, rules]) => rules.map((rule) => ({ ...rule, sourcePackName }))),
];

export const buildRuleStatusLookup = (resolution: LoadOrderRulesResolution, mutedPackNames: string[]) => {
  const activeKeys = keysOf(resolution.rules);
  const disabledKeys = keysOf(resolution.disabledRules);
  const supersededKeys = keysOf(resolution.supersededRules);
  const mutedKeys = new Set(mutedPackNames.map(loadOrderPackNameKey));

  const conflictKindByKey = new Map<string, LoadOrderRuleStatus>();
  for (const conflict of resolution.conflicts) {
    if (conflict.kind === "overriddenByPin") continue;
    conflictKindByKey.set(loadOrderRuleKey(conflict.rule), conflict.kind);
  }

  return (rule: LoadOrderRule): LoadOrderRuleStatus => {
    const key = loadOrderRuleKey(rule);
    if (activeKeys.has(key)) return "active";
    if (disabledKeys.has(key)) {
      // A pack-wide mute is shown differently, because switching this one rule back on would not help.
      return rule.sourcePackName && mutedKeys.has(loadOrderPackNameKey(rule.sourcePackName)) ? "mutedPack" : "disabled";
    }
    if (supersededKeys.has(key)) return "superseded";
    return conflictKindByKey.get(key) ?? "missingPack";
  };
};

/** The rules touching one mod, split by which side of it the other pack sits on. */
export function getRuleViewsForMod(
  packName: string,
  allRules: LoadOrderRule[],
  getStatus: (rule: LoadOrderRule) => LoadOrderRuleStatus,
): { before: LoadOrderRuleView[]; after: LoadOrderRuleView[] } {
  const modKey = loadOrderPackNameKey(packName);
  const before: LoadOrderRuleView[] = [];
  const after: LoadOrderRuleView[] = [];

  for (const rule of allRules) {
    const beforeKey = loadOrderPackNameKey(rule.before);
    const afterKey = loadOrderPackNameKey(rule.after);
    const isBefore = beforeKey === modKey;
    if (!isBefore && afterKey !== modKey) continue;

    const view: LoadOrderRuleView = {
      rule,
      status: getStatus(rule),
      otherPackName: isBefore ? rule.after : rule.before,
      isBefore,
      isFromPack: rule.sourcePackName != undefined,
    };
    (isBefore ? before : after).push(view);
  }

  const byOtherPack = (first: LoadOrderRuleView, second: LoadOrderRuleView) =>
    first.otherPackName.localeCompare(second.otherPackName);

  return { before: before.sort(byOtherPack), after: after.sort(byOtherPack) };
}

/** The left list: every mod, with enough detail to group and label it. */
export function buildModRuleSummaries(
  mods: Mod[],
  allRules: LoadOrderRule[],
  modRules: Record<string, LoadOrderRule[]>,
  mutedPackNames: string[],
): ModRuleSummary[] {
  const ruleCountByModKey = new Map<string, number>();
  for (const rule of allRules) {
    for (const key of [loadOrderPackNameKey(rule.before), loadOrderPackNameKey(rule.after)]) {
      ruleCountByModKey.set(key, (ruleCountByModKey.get(key) ?? 0) + 1);
    }
  }

  const shippingKeys = new Set(
    Object.entries(modRules)
      .filter(([, rules]) => rules.length > 0)
      .map(([packName]) => loadOrderPackNameKey(packName)),
  );
  const mutedKeys = new Set(mutedPackNames.map(loadOrderPackNameKey));

  return mods.map((mod) => {
    const key = loadOrderPackNameKey(mod.name);
    return {
      mod,
      sortName: getModSortName(mod),
      ruleCount: ruleCountByModKey.get(key) ?? 0,
      shipsRules: shippingKeys.has(key),
      isMuted: mutedKeys.has(key),
    };
  });
}
