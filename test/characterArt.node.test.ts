import { describe, expect, it } from "vitest";
import { resolveCharacterBattleArt } from "../src/visuals/characterArt";

const baseInput = () => ({
  caste: "lord",
  mainUnitKeys: ["main_lord"],
  availableFactions: ["test_faction"],
  availableSubcultures: ["test_subculture"],
  subcultureToCulture: new Map([["test_subculture", "test_culture"]]),
  agentSubtypeToAssociatedUnit: new Map([["test_subtype", "main_lord"]]),
  agentSubtypeSubcultureOverrides: [],
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
    input.agentSubtypeToAssociatedUnit.clear();
    input.agentSubtypeSubcultureOverrides.push({
      subtype: "test_subtype",
      subculture: "test_subculture",
      associatedUnitOverride: "main_lord",
      agent: "general",
    });
    expect(resolveCharacterBattleArt(input)).toHaveLength(1);
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
        variantName: "battle_variant",
        artSetId: "test_art_set",
        variantMeshPath: "variantmeshes\\variantmeshdefinitions\\battle_lord.variantmeshdefinition",
      },
    ]);
  });

  it("does not apply campaign-character art resolution to ordinary units", () => {
    const input = baseInput();
    input.caste = "melee_infantry";
    expect(resolveCharacterBattleArt(input)).toEqual([]);
  });
});
