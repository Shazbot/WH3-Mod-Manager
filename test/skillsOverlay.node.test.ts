import { describe, expect, it, vi } from "vitest";

/** The native zstd binding is an Electron prebuild and does not load in the node test runner. */
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

import { createEmptySkillsDataCore } from "../src/skillsData/cache";
import { applyModOverlayToSkillsDataCore } from "../src/skillsData/overlay";
import type { AmendedSchemaField } from "../src/packFileTypes";

const row = (values: Record<string, string>): AmendedSchemaField[] =>
  Object.entries(values).map(([name, resolvedKeyValue]) => ({ name, resolvedKeyValue }) as AmendedSchemaField);

const applyRows = (rows: Record<string, AmendedSchemaField[][]>) => {
  const core = createEmptySkillsDataCore();
  const getTableRowData = (
    _packs: PackViewData[],
    tableName: string,
    callback: (fields: AmendedSchemaField[]) => void,
  ) => {
    for (const fields of rows[tableName] || []) callback(fields);
  };
  applyModOverlayToSkillsDataCore(core, [], getTableRowData);
  return core;
};

describe("skill data mod overlays", () => {
  it("replaces a link's composite-key row, including type and geometry", () => {
    const core = createEmptySkillsDataCore();
    core.nodeLinks = {
      parent: [
        {
          child: "child",
          linkType: "REQUIRED",
          parentLinkPosition: "1",
          childLinkPosition: "1",
        },
      ],
    };

    const getTableRowData = (
      _packs: PackViewData[],
      tableName: string,
      callback: (fields: AmendedSchemaField[]) => void,
    ) => {
      if (tableName === "character_skill_node_links_tables") {
        callback(
          row({
            parent_key: "parent",
            child_key: "child",
            link_type: "SUBSET_REQUIRED",
            parent_link_position: "2",
            child_link_position: "3",
            parent_link_position_offset: "0.25",
            child_link_position_offset: "-0.5",
          }),
        );
      }
    };

    applyModOverlayToSkillsDataCore(core, [], getTableRowData);

    expect(core.nodeLinks.parent).toEqual([
      {
        child: "child",
        linkType: "SUBSET_REQUIRED",
        parentLinkPosition: "2",
        childLinkPosition: "3",
        parentLinkPositionOffset: "0.25",
        childLinkPositionOffset: "-0.5",
      },
    ]);
  });

  it("replaces effect scope and value at the effect composite key", () => {
    const core = createEmptySkillsDataCore();
    core.effectsToEffectData.effect_key = {
      key: "effect_key",
      icon: "effect.png",
      isPositive: "true",
      priority: "1",
    };
    core.skillsToEffects.skill_key = [
      {
        key: "skill_key",
        effectKey: "effect_key",
        effectScope: "character_to_character_own",
        level: 1,
        value: "1",
        iconData: "",
        priority: "1",
      } as Effect,
    ];
    const getTableRowData = (
      _packs: PackViewData[],
      tableName: string,
      callback: (fields: AmendedSchemaField[]) => void,
    ) => {
      if (tableName === "character_skill_level_to_effects_junctions_tables") {
        callback(
          row({
            character_skill_key: "skill_key",
            effect_key: "effect_key",
            effect_scope: "character_to_faction_own",
            level: "1",
            value: "9",
          }),
        );
      }
    };

    applyModOverlayToSkillsDataCore(core, [], getTableRowData);

    expect(core.skillsToEffects.skill_key).toHaveLength(1);
    expect(core.skillsToEffects.skill_key[0]).toMatchObject({
      effectScope: "character_to_faction_own",
      value: "9",
    });
  });

  it("honors the last set-item override, including re-enabling a node", () => {
    const core = createEmptySkillsDataCore();
    core.setToNodes = { set_key: ["node_key"] };
    const getTableRowData = (
      _packs: PackViewData[],
      tableName: string,
      callback: (fields: AmendedSchemaField[]) => void,
    ) => {
      if (tableName === "character_skill_node_set_items_tables") {
        callback(row({ set: "set_key", item: "node_key", mod_disabled: "true" }));
        callback(row({ set: "set_key", item: "node_key", mod_disabled: "false" }));
      }
    };

    applyModOverlayToSkillsDataCore(core, [], getTableRowData);

    expect(core.setToNodes.set_key).toEqual(["node_key"]);
  });

  it("normalizes a full skill icon path before storing it", () => {
    const core = applyRows({
      character_skills_tables: [
        row({
          key: "skill_key",
          image_path: "ui\\campaign ui\\skills\\icon.png",
          unlocked_at_rank: "0",
        }),
      ],
    });

    expect(core.skills).toEqual([expect.objectContaining({ key: "skill_key", iconPath: "icon.png" })]);
  });

  it("keeps a hidden effect that has no icon, so its priority is known", () => {
    const core = applyRows({
      effects_tables: [row({ effect: "effect_hidden", is_positive_value_good: "true", priority: "0" })],
    });

    expect(core.effectsToEffectData.effect_hidden).toEqual({
      key: "effect_hidden",
      icon: "",
      isPositive: "true",
      priority: "0",
    });
  });

  it("keeps the lowest rank a skill is automatically granted at", () => {
    const core = applyRows({
      character_skills_to_level_reached_criterias_tables: [
        row({ character_skill: "skill_mount", character_level: "7", upgrade_to_skill_level: "2" }),
        row({ character_skill: "skill_mount", character_level: "4", upgrade_to_skill_level: "1" }),
      ],
    });

    expect(core.skillsToAutoUnlockRank).toEqual({ skill_mount: 4 });
  });

  it("keeps ability links that change a spell, not only ones that grant it", () => {
    const core = applyRows({
      effect_bonus_value_unit_ability_junctions_tables: [
        row({ effect: "effect_cooldown", bonus_value_id: "recharge_mod", unit_ability: "spell" }),
      ],
    });

    expect(core.effectToUnitAbilityEnables.effect_cooldown).toEqual([
      { unitAbilityKey: "spell", bonusValueId: "recharge_mod" },
    ]);
  });

  it("stores tagged images under the path their icons are kept at", () => {
    const core = applyRows({
      ui_tagged_images_tables: [row({ key: "icon_magic", image_path: "UI/Campaign UI/Effect_bundles/magic.png" })],
    });

    expect(core.uiTaggedImages).toEqual({ icon_magic: "ui\\campaign ui\\effect_bundles\\magic.png" });
  });
});
