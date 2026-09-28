import { describe, expect, it } from "vitest";
import {
  resolveAgentSubtypeKeys,
  resolveCharacterBattleArt,
  type ResolveCharacterBattleArtInput,
} from "../src/visuals/characterArt";

const baseInput = (): ResolveCharacterBattleArtInput => ({
  caste: "lord",
  agentSubtypeKeys: ["test_subtype"],
  availableFactions: ["test_faction"],
  availableSubcultures: ["test_subculture"],
  subcultureToCulture: new Map([["test_subculture", "test_culture"]]),
  campaignCharacterArtSetsBySubtype: new Map([
    [
      "test_subtype",
      [
        {
          artSetId: "test_art_set",
          culture: "",
          subculture: "",
          faction: "",
        },
      ],
    ],
  ]),
  campaignCharacterArtsByArtSet: new Map([
    [
      "test_art_set",
      [
        {
          id: "1",
          level: 0,
          age: 0,
          season: "none",
          uniform: "test_uniform",
        },
      ],
    ],
  ]),
  agentUniformByName: new Map([
    [
      "test_uniform",
      {
        filename: "campaign_variant",
        battleFilename: "battle_variant",
      },
    ],
  ]),
  variantsByName: new Map([
    ["campaign_variant", "campaign_lord"],
    ["battle_variant", "battle_lord"],
  ]),
});

describe("campaign character battle art resolution", () => {
  it("uses agent_uniforms battle_filename before filename", () => {
    const resolved = resolveCharacterBattleArt(baseInput());
    expect(resolved).toEqual([
      {
        faction: "",
        subculture: "",
        culture: "",
        variantName: "battle_variant",
        artSetId: "test_art_set",
        variantMeshPath: "variantmeshes\\variantmeshdefinitions\\battle_lord.variantmeshdefinition",
      },
    ]);
  });

  it("falls back to agent_uniforms filename when battle_filename is empty or dot", () => {
    const input = baseInput();
    input.agentUniformByName.set("test_uniform", {
      filename: "campaign_variant",
      battleFilename: ".",
    });
    const resolved = resolveCharacterBattleArt(input);
    expect(resolved[0]?.variantName).toBe("campaign_variant");
    expect(resolved[0]?.variantMeshPath).toBe(
      "variantmeshes\\variantmeshdefinitions\\campaign_lord.variantmeshdefinition",
    );
  });

  it("can resolve the agent subtype from a subculture-specific associated-unit override", () => {
    const input = baseInput();
    input.agentSubtypeKeys = resolveAgentSubtypeKeys({
      mainUnitKeys: ["main_lord"],
      availableSubcultures: input.availableSubcultures,
      agentSubtypeToAssociatedUnit: new Map(),
      agentSubtypeSubcultureOverrides: [{
        subtype: "test_subtype",
        subculture: "test_subculture",
        associatedUnitOverride: "main_lord",
        agent: "general",
      }],
    });
    expect(resolveCharacterBattleArt(input)).toHaveLength(1);
  });

  it("uses a custom-battle permission uniform before subtype campaign art", () => {
    const input = baseInput();
    input.campaignCharacterArtSetsBySubtype.set("test_subtype", [{
      artSetId: "test_art_set",
      culture: "",
      subculture: "",
      faction: "test_faction",
    }]);
    input.permissionUniforms = [{ faction: "test_faction", uniform: "custom_uniform" }];
    input.factionToSubculture = new Map([["test_faction", "test_subculture"]]);
    input.agentUniformByName.set("custom_uniform", {
      filename: "custom_campaign_variant",
      battleFilename: "custom_battle_variant",
    });
    input.variantsByName.set("custom_battle_variant", "custom_battle_lord");

    expect(resolveCharacterBattleArt(input)).toEqual([
      {
        faction: "test_faction",
        subculture: "test_subculture",
        culture: "test_culture",
        variantName: "custom_battle_variant",
        artSetId: "",
        variantMeshPath: "variantmeshes\\variantmeshdefinitions\\custom_battle_lord.variantmeshdefinition",
      },
    ]);
  });

  it("filters art sets that belong to another faction, subculture, or culture", () => {
    const input = baseInput();
    input.campaignCharacterArtSetsBySubtype.set("test_subtype", [
      {
        artSetId: "wrong_faction",
        culture: "",
        subculture: "",
        faction: "other_faction",
      },
      {
        artSetId: "wrong_subculture",
        culture: "",
        subculture: "other_subculture",
        faction: "",
      },
      {
        artSetId: "wrong_culture",
        culture: "other_culture",
        subculture: "",
        faction: "",
      },
      {
        artSetId: "test_art_set",
        culture: "test_culture",
        subculture: "test_subculture",
        faction: "test_faction",
      },
    ]);
    expect(resolveCharacterBattleArt(input)).toEqual([
      {
        faction: "test_faction",
        subculture: "test_subculture",
        culture: "test_culture",
        variantName: "battle_variant",
        artSetId: "test_art_set",
        variantMeshPath: "variantmeshes\\variantmeshdefinitions\\battle_lord.variantmeshdefinition",
      },
    ]);
  });


  it("still resolves campaign art when custom-battle permission context is unavailable", () => {
    const input = baseInput();
    input.availableFactions = [];
    input.availableSubcultures = [];
    input.campaignCharacterArtSetsBySubtype.set("test_subtype", [
      {
        artSetId: "test_art_set",
        culture: "test_culture",
        subculture: "test_subculture",
        faction: "test_faction",
      },
    ]);
    expect(resolveCharacterBattleArt(input)).toHaveLength(1);
  });
  it("keeps separate scoped art sets even when they resolve to the same battle VMD", () => {
    const input = baseInput();
    input.availableSubcultures = ["subculture_a", "subculture_b"];
    input.subcultureToCulture = new Map([
      ["subculture_a", "culture_a"],
      ["subculture_b", "culture_b"],
    ]);
    input.campaignCharacterArtSetsBySubtype.set("test_subtype", [
      {
        artSetId: "test_art_set",
        culture: "culture_a",
        subculture: "subculture_a",
        faction: "",
      },
      {
        artSetId: "test_art_set_2",
        culture: "culture_b",
        subculture: "subculture_b",
        faction: "",
      },
    ]);
    input.campaignCharacterArtsByArtSet.set("test_art_set_2", [
      {
        id: "2",
        level: 0,
        age: 0,
        season: "none",
        uniform: "test_uniform",
      },
    ]);
    expect(resolveCharacterBattleArt(input)).toHaveLength(2);
  });

  it("does not apply campaign-character art resolution to ordinary units", () => {
    const input = baseInput();
    input.caste = "melee_infantry";
    expect(resolveCharacterBattleArt(input)).toEqual([]);
  });
});
