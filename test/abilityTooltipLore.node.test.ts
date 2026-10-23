import { describe, expect, it } from "vitest";

import { buildAbilityTooltipDataForEffects } from "../src/abilityTooltips";

const specialAbility = (key: string) => ({
  key,
  targetInterceptRange: 0,
  rechargeTime: 0,
  activeTime: 0,
  effectRange: 0,
  affectSelf: false,
  numEffectedFriendlyUnits: 0,
  numEffectedEnemyUnits: 0,
  targetFriends: false,
  targetEnemies: false,
  targetSelf: false,
  manaCost: 0,
  miscastChance: 0,
  minRange: 0,
});

describe("ability tooltip lore", () => {
  it("picks the group that is not a spell pool, for an upgraded spell from the spell it upgrades", () => {
    const locs: Record<string, string> = {
      special_ability_groups_name_lore_death: "Lore of Death",
      special_ability_groups_name_lore_necrarch: "Necrarch Lore Pool",
      special_ability_groups_name_all_lore_spells: "Other Spells",
    };
    const { abilityTooltipsByKey } = buildAbilityTooltipDataForEffects({
      effectKeys: ["effect_leech"],
      effectToUnitAbilityEnables: {
        effect_leech: [
          { unitAbilityKey: "leech", bonusValueId: "enable" },
          { unitAbilityKey: "leech", bonusValueId: "enable_overcharge" },
        ],
      },
      unitAbilitiesByKey: {
        leech: { key: "leech", iconName: "leech.png", type: "spell", sourceType: "magic", overpowerOption: "leech_up" },
        leech_up: { key: "leech_up", iconName: "leech.png", type: "spell", sourceType: "magic" },
      },
      unitSpecialAbilitiesByKey: { leech: specialAbility("leech"), leech_up: specialAbility("leech_up") },
      bombardmentsByKey: {},
      projectilesByKey: {},
      explosionsByKey: {},
      vortexesByKey: {},
      abilityToPhaseIds: {},
      phasesById: {},
      phaseStatEffectsByPhaseId: {},
      uiUnitStatIconsByStat: {},
      kvDirectDamageMinUnary: 0,
      kvDirectDamageLarge: 0,
      abilityToAdditionalUiEffectKeys: {},
      additionalUiEffectsByKey: {},
      abilityToGroupKeys: { leech: ["lore_necrarch", "lore_death"], leech_up: ["all_lore_spells"] },
      specialAbilityGroupsByKey: {
        lore_necrarch: { key: "lore_necrarch", iconPath: "necrarch.png", isComposite: true },
        lore_death: { key: "lore_death", iconPath: "death.png", isComposite: false },
        all_lore_spells: { key: "all_lore_spells", iconPath: "all.png", isComposite: true },
      },
      abilityToAutoDeactivateFlags: {},
      getLoc: (locId) => locs[locId],
    });

    expect(abilityTooltipsByKey.leech.loreGroupName).toBe("Lore of Death");
    expect(abilityTooltipsByKey.leech_up.loreGroupName).toBe("Lore of Death");
  });
});
