import { describe, expect, it } from "vitest";

import { appendLocalizationsToSkills } from "../src/skills";

const skillWithEffects = (effects: Partial<Effect>[]) =>
  ({ id: "skill", effects: effects.map((effect) => ({ level: 1, priority: "1", ...effect })) }) as Skill;

describe("skill tooltip texts", () => {
  it("adds the effect's scope text and marks whether its value helps", () => {
    const locs: Record<string, string> = {
      effects_description_armour: "Armour",
      effects_description_upkeep: "Upkeep",
      campaign_effect_scopes_localised_text_faction_to_force_own: "\\n(all armies)",
    };
    const skill = skillWithEffects([
      { effectKey: "armour", effectScope: "faction_to_force_own", value: "5" },
      { effectKey: "upkeep", effectScope: "character_to_character_own", value: "10" },
    ]);

    appendLocalizationsToSkills([skill], (locId) => locs[locId], {
      armour: { key: "armour", icon: "", isPositive: "true", priority: "1" },
      upkeep: { key: "upkeep", icon: "", isPositive: "false", priority: "1" },
    });

    expect(skill.effects[0].localizedKey).toContain("Armour\\n(all armies)");
    expect(skill.effects[0].isGood).toBe(true);
    expect(skill.effects[1].localizedKey).not.toContain("(");
    expect(skill.effects[1].isGood).toBe(false);
  });
});
