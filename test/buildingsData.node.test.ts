import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUILDINGS_TABLES,
  BUILDINGS_TABLE_KEY_COLUMNS,
  buildBuildingsData,
  createBuildingsLocLookup,
  dedupeRowsByKey,
} from "../src/buildingsData/data";
import type { BuildingsTableRows } from "../src/buildingsData/types";

const noLoc = () => undefined;

describe("BUILDINGS_TABLE_KEY_COLUMNS", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schema", "schema_wh3.json"), "utf8")) as {
    definitions: Record<string, Array<{ version: number; fields: Array<{ name: string; is_key: boolean }> }>>;
  };

  const latestVersion = (tableName: string) => {
    const versions = schema.definitions[tableName];
    if (!versions) return undefined;
    return versions.reduce((highest, version) => (version.version > highest.version ? version : highest));
  };

  it("covers every table the builder reads", () => {
    const missing = BUILDINGS_TABLES.filter((tableName) => !BUILDINGS_TABLE_KEY_COLUMNS[tableName]);
    expect(missing).toEqual([]);
  });

  it("names every table the builder reads in the shipped schema", () => {
    const missing = BUILDINGS_TABLES.filter((tableName) => !latestVersion(tableName));
    expect(missing).toEqual([]);
  });

  // Keying a row on fewer columns than the schema does collapses whole tables into one entry when
  // mod rows are folded over vanilla ones - building_culture_variants has four key columns and every
  // variant of a building shares the first. Fail here rather than silently lose data.
  it("matches the is_key columns in the shipped schema", () => {
    const mismatches: Array<{ table: string; expected: string[]; actual: string[] }> = [];
    for (const tableName of BUILDINGS_TABLES) {
      const version = latestVersion(tableName);
      if (!version) continue;
      const expected = version.fields.filter((field) => field.is_key).map((field) => field.name);
      if (expected.length === 0) continue;
      const actual = BUILDINGS_TABLE_KEY_COLUMNS[tableName];
      // This table is reconstructed from REGION_SLOT records rather than written back to the DB.
      // Its ESF instance/index value is intentionally omitted, so its identity is the remaining
      // four fields instead of the schema's synthetic id column.
      if (tableName === "start_pos_region_slot_templates_tables") {
        expect(actual).toEqual(["campaign", "region", "slot_template", "slot_type"]);
        continue;
      }
      if ([...expected].sort().join("|") !== [...actual].sort().join("|")) {
        mismatches.push({ table: tableName, expected, actual });
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("dedupeRowsByKey", () => {
  it("keeps the last row for a composite key and both rows for different ones", () => {
    const rows = [
      { building: "b", culture: "emp", subculture: "", faction: "", icon: "vanilla" },
      { building: "b", culture: "emp", subculture: "", faction: "", icon: "modded" },
      { building: "b", culture: "dwf", subculture: "", faction: "", icon: "vanilla" },
    ];
    const deduped = dedupeRowsByKey("building_culture_variants_tables", rows);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((row) => row.culture === "emp")?.icon).toBe("modded");
    expect(deduped.find((row) => row.culture === "dwf")?.icon).toBe("vanilla");
  });

  it("leaves rows alone for a table it has no key columns for", () => {
    const rows = [{ a: "1" }, { a: "1" }];
    expect(dedupeRowsByKey("not_a_real_table", rows)).toHaveLength(2);
  });
});

describe("buildBuildingsData", () => {
  const tables: BuildingsTableRows = {
    building_chains_tables: [
      { key: "chain_a", building_superchain: "super_a", optional_sort_order: "2" },
      { key: "chain_b", building_superchain: "super_a", optional_sort_order: "1" },
      { key: "wh2_main_VAMPIRES_legacy", building_superchain: "super_vmp", optional_sort_order: "1" },
    ],
    building_levels_tables: [
      { level_name: "a_3", chain: "chain_a", level: "2", create_cost: "300", visible_in_ui: "true" },
      { level_name: "a_1", chain: "chain_a", level: "0", create_cost: "100", visible_in_ui: "true" },
      { level_name: "a_2", chain: "chain_a", level: "1", create_cost: "200", building_instance_key: "inst" },
    ],
    building_instances_tables: [{ key: "inst", num_instances: "1" }],
    building_units_allowed_tables: [
      { key: "5", building: "a_2", unit: "spearmen", enabled: "true" },
      { key: "9", building: "a_2", unit: "disabled_unit", enabled: "false" },
    ],
    main_units_tables: [{ unit: "spearmen", land_unit: "emp_spearmen_land" }],
    armed_citizenry_unit_groups_tables: [{ unit_group: "group_a" }],
    armed_citizenry_units_to_unit_groups_junctions_tables: [
      { id: "2", unit_group: "group_a", unit: "militia_b", priority: "2" },
      { id: "1", unit_group: "group_a", unit: "militia_a", priority: "1" },
    ],
    building_level_armed_citizenry_junctions_tables: [{ id: "7", building_level: "a_2", unit_group: "group_a" }],
    effects_tables: [
      { effect: "eff_used", icon: "used.png" },
      { effect: "eff_unused", icon: "unused.png" },
    ],
    building_effects_junction_tables: [
      { building: "a_2", effect: "eff_used", effect_scope: "building_to_building_own", value: "3" },
    ],
    start_pos_regions_tables: [{ id: "42", region: "region_x", campaign: "camp" }],
    start_pos_settlements_tables: [
      { settlement_id: "s1", region: "42", settlement_type: "town", primary_building: "a_1", building1: "" },
    ],
    cultures_subcultures_tables: [{ subculture: "subculture_a", culture: "culture_a" }],
    factions_tables: [
      {
        key: "faction_a",
        subculture: "subculture_a",
        military_group: "military_group_a",
        is_rebel: "true",
        is_quest_faction: "false",
      },
    ],
  };

  const data = buildBuildingsData(tables, noLoc);

  it("orders a chain's levels by level, ascending", () => {
    expect(data.levelKeysByChain.chain_a).toEqual(["a_1", "a_2", "a_3"]);
  });

  it("groups chains under their superchain", () => {
    expect(data.superChains.super_a.sort()).toEqual(["chain_a", "chain_b"]);
  });

  it("reads instance limits through the level's instance key", () => {
    expect(data.levelsByKey.a_2.instanceKey).toBe("inst");
    expect(data.instances.inst).toBe(1);
  });

  it("keeps a recruitment row `enabled = false` names, because that column is dead", () => {
    // Every one of the 6396 vanilla `building_units_allowed` rows has `enabled = false`, including
    // the ones that plainly do unlock recruitment in game, so honouring it emptied the table.
    expect(data.recruitableByLevel.a_2.map((unit) => unit.unitKey)).toEqual(["spearmen", "disabled_unit"]);
  });

  it("flags which effects a building uses, and names only those", () => {
    const option = (key: string) => data.effects.find((effect) => effect.key === key);
    // `noLoc` returns nothing, so the name falls back to the key either way; the flag is the point.
    expect(option("eff_used")?.usedByBuildings).toBe(true);
    expect(option("eff_unused")?.usedByBuildings).toBe(false);
  });

  it("selects each effect's most frequent scope", () => {
    const withScopes = buildBuildingsData(
      {
        ...tables,
        building_effects_junction_tables: [
          { building: "a_1", effect: "eff_used", effect_scope: "region_to_region_own", value: "1" },
          { building: "a_2", effect: "eff_used", effect_scope: "building_to_building_own", value: "1" },
          { building: "a_3", effect: "eff_used", effect_scope: "region_to_region_own", value: "1" },
        ],
      },
      noLoc,
    );

    expect(withScopes.effects.find((effect) => effect.key === "eff_used")?.preferredScope).toBe("region_to_region_own");
    expect(withScopes.effects.find((effect) => effect.key === "eff_unused")?.preferredScope).toBeUndefined();
  });

  it("holds meta only for effects a building uses, keeping the disk cache off the other ~13k", () => {
    expect(Object.keys(data.effectMeta)).toEqual(["eff_used"]);
  });

  it("expands a garrison unit group into its units, by priority", () => {
    expect(data.garrisonUnitsByGroup.group_a.map((unit) => unit.unitKey)).toEqual(["militia_a", "militia_b"]);
    expect(data.garrisonByLevel.a_2.map((unit) => unit.unitKey)).toEqual(["militia_a", "militia_b"]);
  });

  // unit_variants is keyed on the land unit, so a main unit routes through main_units.land_unit; the
  // faction-agnostic row wins over a faction-specific one.
  it("derives the unit card path through the land unit's variant row", () => {
    const withCards = buildBuildingsData(
      {
        ...tables,
        unit_variants_tables: [
          { faction: "some_faction", unit: "emp_spearmen_land", unit_card: "faction_card" },
          { faction: "", unit: "emp_spearmen_land", unit_card: "emp_spearmen_card" },
        ],
      },
      noLoc,
    );
    expect(withCards.recruitableByLevel.a_2[0].cardPath).toBe("ui\\units\\icons\\emp_spearmen_card.png");
  });

  it("falls back to the unit key when it has no variant row", () => {
    expect(data.recruitableByLevel.a_2[0].cardPath).toBe("ui\\units\\icons\\spearmen.png");
  });

  it("resolves a start pos settlement's region through start_pos_regions", () => {
    expect(data.startPosSettlements["camp|region_x"][0].buildings).toEqual(["a_1"]);
    expect(data.startPosSettlements["camp|region_x"][0].settlementType).toBe("town");
  });

  it("retains faction grouping and display metadata", () => {
    expect(data.factions).toEqual([
      expect.objectContaining({
        key: "faction_a",
        culture: "culture_a",
        subculture: "subculture_a",
        militaryGroup: "military_group_a",
        isRebel: true,
        isQuestFaction: false,
      }),
    ]);
  });

  it("binds legacy Vampire chains to the Vampire availability set", () => {
    expect(data.availabilitySetsByChain.wh2_main_VAMPIRES_legacy).toContain("wh_main_bas_vmp");
  });

  it("starts numeric id cursors above the highest observed id", () => {
    expect(data.nextNumericIds.building_units_allowed_tables).toBe(10);
    expect(data.nextNumericIds.building_level_armed_citizenry_junctions_tables).toBe(8);
    expect(data.nextNumericIds.armed_citizenry_units_to_unit_groups_junctions_tables).toBe(3);
    // A table with no rows still has to hand out a usable first id.
    expect(data.nextNumericIds.building_chain_availabilities_tables).toBe(0);
  });

  it("lets a mod row override a vanilla one with the same composite key", () => {
    const withMod = buildBuildingsData(
      {
        ...tables,
        building_culture_variants_tables: [
          { building: "a_1", culture: "emp", subculture: "", faction: "", icon: "vanilla_icon" },
          { building: "a_1", culture: "emp", subculture: "", faction: "", icon: "mod_icon" },
          { building: "a_1", culture: "dwf", subculture: "", faction: "", icon: "dwf_icon" },
        ],
      },
      noLoc,
    );
    const variants = withMod.variantsByLevel.a_1;
    expect(variants).toHaveLength(2);
    expect(variants.find((variant) => variant.culture === "emp")?.icon).toBe("mod_icon");
  });
});

describe("ESF-derived startpos slot templates", () => {
  it("accepts rows without the ESF instance/index column", () => {
    const data = buildBuildingsData(
      {
        start_pos_region_slot_templates_tables: [
          { campaign: "c", region: "r", slot_template: "from_esf", slot_type: "primary" },
        ],
      },
      noLoc,
    );
    expect(data.regionSlotTemplates["c|r"]?.[0]).toMatchObject({
      slotTemplate: "from_esf",
      slotType: "primary",
      id: "0",
    });
  });

  it("does not invent rows when no startpos data was supplied", () => {
    expect(buildBuildingsData({}, noLoc).regionSlotTemplates).toEqual({});
  });
});

describe("building set colours", () => {
  // The bundled schema still describes colour_r/g/b; the live game ships colour_hex.
  it("reads colour_hex", () => {
    const data = buildBuildingsData(
      { building_sets_tables: [{ key: "s", colour_hex: "64143C", show_in_ui: "true" }] },
      noLoc,
    );
    expect([data.sets.s.colourR, data.sets.s.colourG, data.sets.s.colourB]).toEqual([0x64, 0x14, 0x3c]);
  });

  it("still reads colour_r/g/b when that is what the row carries", () => {
    const data = buildBuildingsData(
      { building_sets_tables: [{ key: "s", colour_r: "10", colour_g: "20", colour_b: "30", show_in_ui: "true" }] },
      noLoc,
    );
    expect([data.sets.s.colourR, data.sets.s.colourG, data.sets.s.colourB]).toEqual([10, 20, 30]);
  });

  it("falls back to a visible grey when the row carries neither", () => {
    const data = buildBuildingsData({ building_sets_tables: [{ key: "s", show_in_ui: "true" }] }, noLoc);
    expect([data.sets.s.colourR, data.sets.s.colourG, data.sets.s.colourB]).toEqual([90, 90, 90]);
  });
});

describe("createBuildingsLocLookup", () => {
  it("lets a later trie shadow an earlier one", () => {
    const lookup = createBuildingsLocLookup([
      { get: (key: string) => (key === "shared" ? "vanilla" : undefined) },
      { get: (key: string) => (key === "shared" ? "mod" : undefined) },
      undefined,
    ]);
    expect(lookup("shared")).toBe("mod");
    expect(lookup("absent")).toBeUndefined();
  });
});
