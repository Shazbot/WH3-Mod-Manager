import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { makeRowFields } from "../../src/automation/tables";
import { classifyUnitForOptimization } from "../../src/automation/units";
import { serializeDbTable, writeRawPack } from "../../src/packCore";
import { LocVersion, type DBField, type DBVersion } from "../../src/packFileTypes";

const root = mkdtempSync(path.join(os.tmpdir(), "whmm-lookups-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const field = (name: string, key = false, type: DBField["field_type"] = "StringU8"): DBField => ({
  name,
  field_type: type,
  is_key: key,
  default_value: "",
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});
const schema = (fields: DBField[], locFields: string[] = [], order: number[] = []): DBVersion => ({
  version: 0,
  fields,
  localised_fields: locFields.map((name) => field(name)),
  localised_key_order: order,
});
const definitions: Record<string, DBVersion[]> = {
  land_units_tables: [
    schema(
      [
        field("key", true),
        field("category"),
        field("class"),
        field("mount"),
        field("engine"),
        field("num_mounts", false, "I32"),
        field("num_engines", false, "I32"),
      ],
      ["onscreen_name"],
      [0],
    ),
  ],
  main_units_tables: [
    schema([
      field("unit", true),
      field("land_unit"),
      field("caste"),
      field("num_men", false, "I32"),
      field("ui_unit_group_land"),
    ]),
  ],
  units_custom_battle_permissions_tables: [
    schema([field("unit", true), field("faction", true), field("general_uniform")]),
  ],
  unit_variants_tables: [
    schema([field("unit", true), field("faction", true), field("variant"), field("name"), field("unit_card")]),
  ],
  variants_tables: [schema([field("variant_name", true), field("variant_filename")])],
  factions_tables: [schema([field("key", true), field("subculture")])],
  cultures_subcultures_tables: [schema([field("subculture", true), field("culture")])],
  building_units_allowed_tables: [
    schema([
      field("key", true),
      field("unit"),
      field("building"),
      field("faction"),
      field("conditions"),
      field("enabled", false, "Boolean"),
    ]),
  ],
  units_to_exclusive_faction_permissions_tables: [
    schema([field("key", true), field("faction", true), field("allowed", false, "Boolean")]),
  ],
  ui_unit_groupings_tables: [schema([field("key", true), field("parent_group")])],
  ui_unit_group_parents_tables: [schema([field("key", true)])],
  compound_tables: [schema([field("first", true), field("second", true)], ["label"], [1, 0])],
  mounts_tables: [schema([field("key", true), field("variant")])],
  battlefield_engines_tables: [schema([field("key", true), field("variant"), field("model")])],
  land_units_to_extra_engines_tables: [schema([field("land_unit", true), field("battle_engine", true)])],
  agent_subtypes_tables: [schema([field("key", true), field("associated_unit_override")])],
  campaign_character_art_sets_tables: [schema([field("art_set_id", true), field("agent_subtype"), field("faction")])],
  campaign_character_arts_tables: [
    schema([field("id", true), field("art_set_id"), field("uniform"), field("sea_uniform"), field("navy_uniform")]),
  ],
  agent_uniforms_tables: [schema([field("uniform_name", true), field("battle_filename"), field("filename")])],
};
const metadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([255, 255, 255, 127]),
  dependencies: [] as string[],
};
const db = (table: string, rows: Record<string, string | number | boolean>[], file = "data") => {
  const version = definitions[`${table}_tables`][0];
  return {
    name: `db\\${table}_tables\\${file}`,
    buffer: serializeDbTable(
      version,
      rows.map((row) => makeRowFields(version, row)),
      { version: 0 },
    ),
  };
};
const loc = (entries: Record<string, string>) => ({
  name: "text\\names.loc",
  buffer: serializeDbTable(
    LocVersion,
    Object.entries(entries).map(([key, text]) => makeRowFields(LocVersion, { key, text, tooltip: false })),
    { preamble: Buffer.from([255, 254, 76, 79, 67, 0, 1, 0, 0, 0]) },
  ),
});
const context = () => createAutomationContext({ schemaProvider: async () => definitions });
const run = async (request: unknown, customContext = context()) => {
  const result = await executeAutomationRequest(request, customContext);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data as {
    items: Array<Record<string, any>>;
    total: number;
    complete: boolean;
    hasMore: boolean;
    reportPath?: string;
  };
};
const land = (key: string) => ({
  key,
  category: "inf_melee",
  class: "inf",
  mount: "",
  engine: "",
  num_mounts: 0,
  num_engines: 0,
});
const main = (key: string, landKey: string) => ({
  unit: key,
  land_unit: landKey,
  caste: "melee_infantry",
  num_men: 60,
  ui_unit_group_land: "group",
});

describe("localization and unit lookups", () => {
  it("maps translated Unicode names to actual DB rows and DB keys back to effective translated replacements", async () => {
    const base = path.join(root, "base.pack"),
      mod = path.join(root, "mod.pack");
    await writeRawPack(
      base,
      [db("land_units", [land("unit_key")]), loc({ land_units_onscreen_name_unit_key: "Old name" })],
      metadata,
    );
    await writeRawPack(
      mod,
      [
        loc({
          land_units_onscreen_name_unit_key: "{{tr:title}}",
          ui_text_replacements_localised_text_title: "Épées 皇",
        }),
      ],
      metadata,
    );
    const result = await run({ operation: "localization_lookup", packPaths: [base, mod], query: "Épées 皇" });
    const item = result.items.find((item) => item.locKey === "land_units_onscreen_name_unit_key");
    expect(item?.dbReferences[0]).toMatchObject({
      table: "db\\land_units_tables",
      keys: { key: "unit_key" },
      field: "onscreen_name",
      packPath: base,
    });
    const reverse = await run({
      operation: "localization_lookup",
      packPaths: [base, mod],
      searchBy: "dbKey",
      query: "unit_key",
      tables: ["land_units_tables"],
    });
    expect(reverse.items[0]).toMatchObject({
      text: "Épées 皇",
      rawText: "{{tr:title}}",
      translationFound: true,
      packPath: mod,
    });
  });

  it("uses composite localized key ordering, returns all ambiguous matches, and pages full reports", async () => {
    const pack = path.join(root, "compound.pack");
    await writeRawPack(
      pack,
      [
        db("compound", [
          { first: "a", second: "b" },
          { first: "ab", second: "" },
          { first: "ba", second: "" },
        ]),
        loc({ compound_label_ba: "Shared", compound_label_ab: "Shared", unmatched_label_x: "Shared" }),
      ],
      metadata,
    );
    const reportPath = path.join(root, "lookup.json");
    const result = await run({
      operation: "localization_lookup",
      packPaths: [pack],
      query: "Shared",
      limit: 1,
      reportPath,
    });
    expect(result).toMatchObject({ total: 3, hasMore: true });
    const full = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(full.items.find((item: any) => item.locKey === "compound_label_ba").dbReferences[0].keys).toEqual({
      first: "a",
      second: "b",
    });
    expect(full.items.find((item: any) => item.locKey === "unmatched_label_x").dbReferences).toEqual([]);
    const clipped = await run({
      operation: "localization_lookup",
      packPaths: [pack],
      searchBy: "locKey",
      query: "compound_label_ba",
      referenceLimit: 1,
    });
    expect(clipped.items[0]).toMatchObject({ dbReferenceCount: 2, dbReferencesTruncated: true });
    expect(clipped.items[0].dbReferences).toHaveLength(1);
    expect(full.items.find((item: any) => item.locKey === "compound_label_ba").dbReferences).toHaveLength(2);
  });

  it("retains explicit roster scope and campaign rule conditions without widening from generic visuals", async () => {
    const pack = path.join(root, "units.pack");
    await writeRawPack(
      pack,
      [
        db("land_units", [land("land_key")]),
        db("main_units", [main("main_key", "land_key")]),
        db("units_custom_battle_permissions", [{ unit: "main_key", faction: "faction_a", general_uniform: "" }]),
        db("unit_variants", [{ unit: "land_key", faction: "", variant: "visual", name: "", unit_card: "card" }]),
        db("variants", [{ variant_name: "visual", variant_filename: "test" }]),
        db("factions", [{ key: "faction_a", subculture: "sub_a" }]),
        db("cultures_subcultures", [{ subculture: "sub_a", culture: "culture_a" }]),
        db("building_units_allowed", [
          {
            key: "rule",
            unit: "main_key",
            building: "barracks",
            faction: "faction_a",
            conditions: "unlock",
            enabled: false,
          },
        ]),
        db("units_to_exclusive_faction_permissions", [{ key: "main_key", faction: "faction_a", allowed: false }]),
        db("ui_unit_groupings", [{ key: "group", parent_group: "commander" }]),
        db("ui_unit_group_parents", [{ key: "commander" }]),
        loc({ land_units_onscreen_name_land_key: "Swordsmen" }),
        { name: "variantmeshes\\variantmeshdefinitions\\test.variantmeshdefinition", buffer: Buffer.from("<root/>") },
      ],
      metadata,
    );
    const result = await run({ operation: "unit_resolve", packPaths: [pack], query: "Swordsmen", searchBy: "text" });
    expect(result.total).toBe(1);
    const item = result.items[0];
    expect(item).toMatchObject({
      mainUnitKey: "main_key",
      landUnitKey: "land_key",
      optimization: { category: "Lord", rawCounts: { men: 60 } },
    });
    expect(item.roster).toMatchObject({
      scopeSource: "customBattlePermissions",
      unscoped: false,
      cultures: ["culture_a"],
      subcultures: ["sub_a"],
      factions: { total: 1 },
    });
    expect(item.campaignRecruitment).toMatchObject({
      status: "rulesOnly",
      buildings: { items: [{ row: { conditions: "unlock", enabled: false } }] },
      exclusiveFactionPermissions: { items: [{ row: { allowed: false } }] },
    });
    expect(item.visuals.variants.items[0]).toMatchObject({ status: "found", packPath: pack });
    expect(result.complete).toBe(false); // Partial fixture lacks some optional coverage tables.
  });

  it("resolves mount/engine and character evidence, bounding previews while keeping complete reports", async () => {
    const pack = path.join(root, "components.pack");
    await writeRawPack(
      pack,
      [
        db("land_units", [{ ...land("land"), mount: "mount", engine: "engine", num_mounts: 60, num_engines: 2 }]),
        db("main_units", [main("main", "land")]),
        db("units_custom_battle_permissions", [
          { unit: "main", faction: "one", general_uniform: "uniform" },
          { unit: "main", faction: "two", general_uniform: "" },
        ]),
        db("mounts", [{ key: "mount", variant: "mount_visual" }]),
        db("battlefield_engines", [
          { key: "engine", variant: "engine_visual", model: "rigid_model_v2/engine.rigid_model_v2" },
        ]),
        db("land_units_to_extra_engines", [{ land_unit: "land", battle_engine: "engine" }]),
        db("agent_subtypes", [{ key: "subtype", associated_unit_override: "main" }]),
        db("campaign_character_art_sets", [{ art_set_id: "set", agent_subtype: "subtype", faction: "one" }]),
        db("campaign_character_arts", [
          { id: "art", art_set_id: "set", uniform: "uniform", sea_uniform: "", navy_uniform: "" },
        ]),
        db("agent_uniforms", [{ uniform_name: "uniform", battle_filename: ".", filename: "character_visual" }]),
        db("variants", [{ variant_name: "character_visual", variant_filename: "character" }]),
      ],
      metadata,
    );
    const reportPath = path.join(root, "components-report.json");
    const result = await run({
      operation: "unit_resolve",
      packPaths: [pack],
      query: "main",
      detailLimit: 1,
      reportPath,
    });
    expect(result.items[0].roster.factions).toMatchObject({ total: 2, truncated: true });
    expect(result.items[0].roster.factions.items).toHaveLength(1);
    expect(result.items[0].visuals).toMatchObject({
      mount: { row: { key: "mount" } },
      engine: { row: { key: "engine" } },
      extraEngines: { total: 1 },
    });
    expect(result.items[0].characters).toMatchObject({
      artSets: { items: [{ row: { faction: "one" } }] },
      uniforms: { items: [{ battleVariant: { variantName: "character_visual" } }] },
    });
    const full = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(full.items[0].roster.factions.items).toHaveLength(2);
    expect(full.items[0].roster.permissions.items).toHaveLength(2);
  });

  it("uses effective DB subfile precedence and preserves no-main-unit diagnostics", async () => {
    const pack = path.join(root, "precedence.pack");
    await writeRawPack(
      pack,
      [
        db("land_units", [land("orphan")]),
        db("main_units", [main("main", "wrong")], "z"),
        db("main_units", [main("main", "orphan")], "a"),
      ],
      metadata,
    );
    const result = await run({ operation: "unit_resolve", packPaths: [pack], query: "orphan" });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ mainUnitKey: "main", mainUnit: { filePath: "db\\main_units_tables\\a" } });
    const orphanPack = path.join(root, "orphan.pack");
    await writeRawPack(orphanPack, [db("land_units", [land("orphan")])], metadata);
    const orphan = await run({ operation: "unit_resolve", packPaths: [orphanPack], query: "orphan" });
    expect(orphan.items[0]).toMatchObject({ mainUnitKey: null, optimization: { issues: [{ code: "NO_MAIN_UNIT" }] } });
  });

  it("rejects out-of-root reads, unknown table filters, and canceled requests", async () => {
    const pack = path.join(root, "restricted.pack");
    await writeRawPack(pack, [loc({ x: "X" })], metadata);
    const denied = await executeAutomationRequest(
      { operation: "localization_lookup", packPaths: [pack], query: "X" },
      createAutomationContext({ readRoots: [] }),
    );
    expect(denied).toMatchObject({ ok: false, error: { code: "IO_ACCESS" } });
    const invalid = await executeAutomationRequest(
      { operation: "localization_lookup", packPaths: [pack], query: "X", tables: ["no_such_table"] },
      context(),
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const controller = new AbortController();
    controller.abort();
    const canceled = await executeAutomationRequest(
      { operation: "unit_resolve", packPaths: [pack], query: "X" },
      createAutomationContext({ signal: controller.signal }),
    );
    expect(canceled).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });

  it("matches the optimizer category fallbacks", () => {
    expect(classifyUnitForOptimization("hero", "", "infantry")).toBe("InfantryMissile");
    expect(classifyUnitForOptimization("hero", "", "")).toBe("Hero");
    expect(classifyUnitForOptimization("", "artillery", "")).toBe("ArtilleryWarMachine");
    expect(classifyUnitForOptimization("", "", "")).toBe("Unknown");
  });
});
