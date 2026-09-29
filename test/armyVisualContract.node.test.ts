import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARMY_VISUAL_CONTRACT_VERSION,
  ARMY_VISUAL_ROLES,
  ARMY_VISUAL_STATES,
  parseArmyVisualContract,
  serializeArmyVisualContract,
} from "../src/visuals/armyVisualContract";

const readContractFile = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), "src", "visuals", "contracts", relativePath), "utf8");

describe("army visual interchange contract", () => {
  it("parses and round-trips the shared version-1 fixture", () => {
    const fixtureText = readContractFile("fixtures/army-visual-contract-v1.json");
    const parsed = parseArmyVisualContract(fixtureText);

    expect(parsed.contractVersion).toBe(ARMY_VISUAL_CONTRACT_VERSION);
    expect(parsed.scenario.engineRoundingPolicy).toBe("ceil");
    expect(parsed.scenario.lodDistribution).toEqual({ "0": 0.75, "1": 0.25 });
    expect(parsed.scenario.rosterScope).toEqual({ kind: "faction", key: "test_faction" });
    expect(parsed.units[0].counts).toEqual({
      men: 0,
      mounts: 0,
      engines: 3,
      crew: 22,
    });
    expect(parsed.units[0].components.map((component) => ({
      role: component.role,
      assetType: component.assetType,
      state: component.state,
      entities: component.entities,
    }))).toEqual([
      {
        role: "crew",
        assetType: "variantmeshdefinition",
        state: "live",
        entities: 22,
      },
      {
        role: "engines",
        assetType: "wsmodel",
        state: "live",
        entities: 3,
      },
      {
        role: "engines",
        assetType: "wsmodel",
        state: "destroyed",
        entities: 3,
      },
    ]);

    expect(JSON.parse(serializeArmyVisualContract(parsed))).toEqual(JSON.parse(fixtureText));
  });

  it("pins the same schema version and role/state vocabulary used by benchmark types", () => {
    const schema = JSON.parse(readContractFile("ArmyVisualContract.schema.json")) as {
      properties: { contractVersion: { const: number } };
      $defs: {
        role: { enum: string[] };
        state: { enum: string[] };
        scenario: { properties: Record<string, unknown> };
      };
    };

    expect(schema.properties.contractVersion.const).toBe(ARMY_VISUAL_CONTRACT_VERSION);
    expect(schema.$defs.role.enum).toEqual([...ARMY_VISUAL_ROLES]);
    expect(schema.$defs.state.enum).toEqual([...ARMY_VISUAL_STATES]);
    expect(Object.keys(schema.$defs.scenario.properties)).toEqual(expect.arrayContaining([
      "lodDistribution",
      "destructionProbability",
      "destructTransitionProbability",
      "armySlotTemplate",
      "rosterScope",
    ]));
  });

  it("rejects contract drift instead of silently defaulting unknown role/state values", () => {
    const fixture = JSON.parse(readContractFile("fixtures/army-visual-contract-v1.json")) as any;
    fixture.units[0].components[0].role = "riders";
    expect(() => parseArmyVisualContract(JSON.stringify(fixture))).toThrow(/role/i);

    fixture.units[0].components[0].role = "crew";
    fixture.units[0].components[0].state = "wrecked";
    expect(() => parseArmyVisualContract(JSON.stringify(fixture))).toThrow(/state/i);
  });
});
