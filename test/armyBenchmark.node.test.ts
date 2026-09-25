import { describe, expect, it } from "vitest";
import {
  ARMY_BENCHMARK_TEMPLATE,
  generateArmyBenchmarkRoster,
  getArmyBenchmarkCategory,
  parseArmyBenchmarkRoster,
  serializeArmyBenchmarkRoster,
  type ArmyBenchmarkCandidate,
} from "../src/visuals/armyBenchmark";

const candidate = (
  unitKey: string,
  caste: string,
  uiGroupKey: string,
  numMen: number,
  originPackPath = "C:\\mods\\test.pack",
): ArmyBenchmarkCandidate => ({
  unitKey,
  faction: "test_faction",
  localizedName: unitKey,
  variantMeshPath: `variantmeshes\\variantmeshdefinitions\\${unitKey}.variantmeshdefinition`,
  originPackPath,
  cultureKey: "test_subculture",
  cultures: [{ key: "test_subculture", name: "Test" }],
  caste,
  uiGroupKey,
  numMen,
});

const candidates: ArmyBenchmarkCandidate[] = [
  candidate("lord", "lord", "commander", 1),
  candidate("hero", "hero", "heroes_agents", 1),
  candidate("infantry", "melee_infantry", "infantry", 100),
  candidate("missiles", "missile_infantry", "missile_infantry", 90),
  candidate("cavalry", "melee_cavalry", "cavalry_chariots", 60),
  candidate("monster", "monster", "monster_beasts", 1),
  candidate("artillery", "warmachine", "artillery_war_machines", 4),
];

describe("army benchmark roster", () => {
  it("maps the UI roster groups onto the performance-template categories", () => {
    expect(getArmyBenchmarkCategory({ caste: "lord", uiGroupKey: "heroes_agents" })).toBe("Lord");
    expect(getArmyBenchmarkCategory({ caste: "hero", uiGroupKey: "infantry" })).toBe("Hero");
    expect(getArmyBenchmarkCategory({ uiGroupKey: "missile_infantry" })).toBe("InfantryMissile");
    expect(getArmyBenchmarkCategory({ uiGroupKey: "missile_cavalry_chariots" })).toBe("CavalryChariot");
    expect(getArmyBenchmarkCategory({ uiGroupKey: "constructs" })).toBe("MonsterBeast");
    expect(getArmyBenchmarkCategory({ uiGroupKey: "flying_war_machine" })).toBe("ArtilleryWarMachine");
  });

  it("generates the established 1/2/9/4/3/2 army template and preserves num_men", () => {
    const roster = generateArmyBenchmarkRoster(candidates, "C:\\mods\\test.pack", () => 0);
    const expectedTotal = Object.values(ARMY_BENCHMARK_TEMPLATE).reduce((sum, count) => sum + count, 0);
    expect(roster.units).toHaveLength(expectedTotal);
    for (const [category, count] of Object.entries(ARMY_BENCHMARK_TEMPLATE)) {
      expect(roster.units.filter((unit) => unit.category === category)).toHaveLength(count);
    }
    expect(roster.units.find((unit) => unit.category === "InfantryMissile")?.entities).toBeGreaterThanOrEqual(90);
    expect(roster.units.find((unit) => unit.category === "CavalryChariot")?.entities).toBe(60);
    expect(roster.cultureKey).toBe("test_subculture");
  });

  it("round-trips the exact generated unit list for repeatable reruns", () => {
    const generated = generateArmyBenchmarkRoster(candidates, "C:\\mods\\test.pack", () => 0.25);
    const parsed = parseArmyBenchmarkRoster(serializeArmyBenchmarkRoster(generated));
    expect(parsed.units).toEqual(generated.units);
    expect(parsed.template).toEqual(generated.template);
    expect(parsed.sourcePackPath).toBe(generated.sourcePackPath);
  });

  it("rejects imported entries that are not VMD assets", () => {
    const generated = generateArmyBenchmarkRoster(candidates, "C:\\mods\\test.pack", () => 0);
    generated.units[0].assetPath = "bad.wsmodel";
    expect(() => parseArmyBenchmarkRoster(JSON.stringify(generated))).toThrow(/variantmeshdefinition/);
  });
});
