import { describe, expect, it } from "vitest";
import {
  ARMY_BENCHMARK_TEMPLATE,
  getGenericBenchmarkInstanceCounts,
  generateArmyBenchmarkRoster,
  getArmyBenchmarkCategory,
  getSingleUnitBenchmarkAssets,
  getSingleUnitBenchmarkEntityCount,
  loadArmyBenchmarkAssets,
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
  it("expands a single unit into scaled men, mount, and engine render assets", () => {
    expect(getSingleUnitBenchmarkAssets({
      variantMeshPath: "men.variantmeshdefinition",
      numMen: 60,
      mountVariantMeshPath: "mount.variantmeshdefinition",
      numMounts: 2,
      engineVariantMeshPath: "engine.variantmeshdefinition",
      numEngines: 4,
    })).toEqual([
      {
        assetPath: "men.variantmeshdefinition",
        entities: 45,
        role: "men",
        state: "live",
        lod: 0,
        probability: 1,
      },
      {
        assetPath: "mount.variantmeshdefinition",
        entities: 6,
        role: "mounts",
        state: "live",
        lod: 0,
        probability: 1,
      },
      {
        assetPath: "engine.variantmeshdefinition",
        entities: 3,
        role: "engines",
        state: "live",
        lod: 0,
        probability: 1,
      },
    ]);
  });

  it("uses the main VMD as crew for crewed engines", () => {
    expect(getSingleUnitBenchmarkAssets({
      variantMeshPath: "crew.variantmeshdefinition",
      numMen: 44,
      engineVariantMeshPath: "engine.variantmeshdefinition",
      numEngines: 4,
      engineType: "Generic_3_Crew",
    })).toEqual([
      {
        assetPath: "crew.variantmeshdefinition",
        entities: 22,
        role: "crew",
        state: "live",
        lod: 0,
        probability: 1,
      },
      {
        assetPath: "engine.variantmeshdefinition",
        entities: 3,
        role: "engines",
        state: "live",
        lod: 0,
        probability: 1,
      },
    ]);
  });

  it("does not add mount or engine assets without a matching visual path", () => {
    expect(getSingleUnitBenchmarkAssets({
      variantMeshPath: "men.variantmeshdefinition",
      numMen: 20,
      numMounts: 20,
      numEngines: 2,
    })).toEqual([
      {
        assetPath: "men.variantmeshdefinition",
        entities: 15,
        role: "men",
        state: "live",
        lod: 0,
        probability: 1,
      },
    ]);
  });

  it("scales generic benchmark instance counts to the complete unit size", () => {
    expect(getSingleUnitBenchmarkEntityCount({
      variantMeshPath: "men.variantmeshdefinition",
      numMen: 100,
      mountVariantMeshPath: "mount.variantmeshdefinition",
      numMounts: 2,
      engineVariantMeshPath: "engine.variantmeshdefinition",
      numEngines: 4,
    })).toBe(84);
    expect(getGenericBenchmarkInstanceCounts(1)).toEqual([1, 10, 25, 50, 100, 250]);
    expect(getGenericBenchmarkInstanceCounts(20)).toEqual([1, 10, 12]);
    expect(getGenericBenchmarkInstanceCounts(160)).toEqual([1]);
    expect(getGenericBenchmarkInstanceCounts()).toEqual([1, 10, 25, 50, 100, 250]);
  });

  it("keeps loading valid assets when one asset loader rejects", async () => {
    const result = await loadArmyBenchmarkAssets(
      [
        { assetPath: "valid.variantmeshdefinition", entities: 10, names: ["Valid"] },
        { assetPath: "broken.variantmeshdefinition", entities: 10, names: ["Broken"] },
      ],
      async (entry) => {
        if (entry.assetPath.startsWith("broken")) throw new Error("malformed XML: unexpected </slot>");
        return entry.assetPath.toUpperCase();
      },
    );

    expect(result.loaded.map(({ value }) => value)).toEqual(["VALID.VARIANTMESHDEFINITION"]);
    expect(result.failures).toEqual([
      {
        entry: { assetPath: "broken.variantmeshdefinition", entities: 10, names: ["Broken"] },
        error: "malformed XML: unexpected </slot>",
      },
    ]);
  });

  it("maps the UI roster groups onto the performance-template categories", () => {
    expect(getArmyBenchmarkCategory({ caste: "lord", uiGroupKey: "heroes_agents" })).toBe("Lord");
    expect(getArmyBenchmarkCategory({ caste: "hero", uiGroupKey: "infantry" })).toBe("Hero");
    expect(getArmyBenchmarkCategory({ uiGroupKey: "missile_infantry" })).toBe("InfantryMissile");
    expect(getArmyBenchmarkCategory({ uiGroupKey: "missile_cavalry_chariots" })).toBe("CavalryChariot");
    expect(getArmyBenchmarkCategory({ uiGroupKey: "constructs" })).toBe("MonsterBeast");
    expect(getArmyBenchmarkCategory({ uiGroupKey: "flying_war_machine" })).toBe("ArtilleryWarMachine");
  });

  it("generates the established 1/2/9/4/3/2 army template with explicit visual components", () => {
    const roster = generateArmyBenchmarkRoster(candidates, "C:\\mods\\test.pack", () => 0);
    const expectedTotal = Object.values(ARMY_BENCHMARK_TEMPLATE).reduce((sum, count) => sum + count, 0);
    expect(roster.units).toHaveLength(expectedTotal);
    for (const [category, count] of Object.entries(ARMY_BENCHMARK_TEMPLATE)) {
      expect(roster.units.filter((unit) => unit.category === category)).toHaveLength(count);
    }
    expect(roster.units.find((unit) => unit.category === "InfantryMissile")?.entities).toBeGreaterThanOrEqual(68);
    expect(roster.units.find((unit) => unit.category === "CavalryChariot")?.entities).toBe(45);
    expect(roster.units.every((unit) => unit.assets.length > 0)).toBe(true);
    expect(roster.scenario.unitSizeScale).toBe(0.75);
    expect(roster.scenario.crewScale).toBe(0.5);
    expect(roster.scenario.destructionProbability).toBe(0);
    expect(roster.scenario.destructTransitionProbability).toBe(0);
    expect(roster.cultureKey).toBe("test_subculture");
  });


  it("applies explicit faction and culture roster scopes", () => {
    const factionRoster = generateArmyBenchmarkRoster(
      candidates,
      "C:\\mods\\test.pack",
      () => 0,
      { rosterScope: { kind: "faction", key: "test_faction" } },
    );
    expect(factionRoster.units.every((unit) => unit.faction === "test_faction")).toBe(true);
    expect(factionRoster.scenario.rosterScope).toEqual({
      kind: "faction",
      key: "test_faction",
    });

    const cultureRoster = generateArmyBenchmarkRoster(
      candidates,
      "C:\\mods\\test.pack",
      () => 0,
      { rosterScope: { kind: "culture", key: "test_subculture" } },
    );
    expect(cultureRoster.units.every((unit) => unit.cultureKey === "test_subculture")).toBe(true);
    expect(cultureRoster.scenario.rosterScope).toEqual({
      kind: "culture",
      key: "test_subculture",
    });
  });

  it("round-trips the exact generated unit list for repeatable reruns", () => {
    const generated = generateArmyBenchmarkRoster(candidates, "C:\\mods\\test.pack", () => 0.25);
    const parsed = parseArmyBenchmarkRoster(serializeArmyBenchmarkRoster(generated));
    expect(parsed.units).toEqual(generated.units);
    expect(parsed.template).toEqual(generated.template);
    expect(parsed.sourcePackPath).toBe(generated.sourcePackPath);
    expect(parsed.scenario).toEqual(generated.scenario);
  });

  it("rejects imported entries that are not VMD assets", () => {
    const generated = generateArmyBenchmarkRoster(candidates, "C:\\mods\\test.pack", () => 0);
    generated.units[0].assets[0].assetPath = "bad.wsmodel";
    expect(() => parseArmyBenchmarkRoster(JSON.stringify(generated))).toThrow(/variantmeshdefinition/);
  });
  it("migrates version-1 rosters into the component model", () => {
    const legacy = {
      kind: "whmm-atlas-army-benchmark",
      version: 1,
      generatedAt: "2026-09-29T00:00:00.000Z",
      template: { ...ARMY_BENCHMARK_TEMPLATE },
      units: [{
        slot: 0,
        category: "Lord",
        unitKey: "legacy_lord",
        faction: "test_faction",
        name: "Legacy Lord",
        assetPath: "legacy.variantmeshdefinition",
        entities: 1,
      }],
    };
    const parsed = parseArmyBenchmarkRoster(JSON.stringify(legacy));
    expect(parsed.version).toBe(2);
    expect(parsed.units[0].assets).toEqual([{
      assetPath: "legacy.variantmeshdefinition",
      entities: 1,
      role: "men",
      state: "live",
      lod: 0,
      probability: 1,
    }]);
  });

});
