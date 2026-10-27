import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createAutomationCacheService,
  createAutomationContext,
  executeAutomationRequest,
} from "../../src/automation/registry";
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
  building_culture_variants_tables: [schema([field("key", true), field("building"), field("culture"), field("variant")])],
  mercenary_unit_groups_tables: [schema([field("key", true), field("unit_record"), field("group")])],
  unit_set_to_unit_junctions_tables: [schema([field("unit_set", true), field("unit_record"), field("unit_caste"), field("unit_category"), field("unit_class")])],
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
  agent_subtype_subculture_overrides_tables: [schema([field("key", true), field("associated_unit_override"), field("subtype")])],
  faction_agent_permitted_subtypes_tables: [schema([field("faction", true), field("subtype", true)])],
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

  it("keeps keyed localization results identical while using warm vanilla and mod caches", async () => {
    const base = path.join(root, "cached-localization-base.pack");
    const mod = path.join(root, "cached-localization-mod.pack");
    await writeRawPack(
      base,
      [
        db("land_units", [land("cache_unit"), land("empty_unit"), land("missing_unit")]),
        loc({
          land_units_onscreen_name_cache_unit: "Vanilla",
          land_units_onscreen_name_empty_unit: "",
          empty_name: "",
          "\uFEFFbom_key": "\uFEFFBOM text",
        }),
      ],
      metadata,
    );
    await writeRawPack(
      mod,
      [
        loc({
          land_units_onscreen_name_cache_unit: "{{tr:cache_title}}",
          ui_text_replacements_localised_text_cache_title: "皇帝 🐈",
        }),
      ],
      metadata,
    );
    const request = {
      operation: "localization_lookup",
      packPaths: [mod],
      vanillaPackPaths: [base],
      query: "cache_unit",
      searchBy: "dbKey",
      tables: ["land_units_tables"],
    };
    const uncached = await executeAutomationRequest(request, context());
    const textRequest = { ...request, query: "皇帝", searchBy: "text", match: "contains" };
    const uncachedText = await executeAutomationRequest(textRequest, context());
    const bomRequest = { ...request, query: "\uFEFFBOM", searchBy: "text", match: "contains" };
    const uncachedBom = await executeAutomationRequest(bomRequest, context());
    const emptyRequest = { ...request, query: "empty_unit" };
    const uncachedEmpty = await executeAutomationRequest(emptyRequest, context());
    const missingRequest = { ...request, query: "missing_unit" };
    const uncachedMissing = await executeAutomationRequest(missingRequest, context());
    expect(uncachedEmpty).toMatchObject({
      ok: true,
      data: { items: [expect.objectContaining({ text: "", translationFound: true })] },
    });
    expect(uncachedMissing).toMatchObject({
      ok: true,
      data: { items: [expect.objectContaining({ text: "", translationFound: false })] },
    });
    const cache = createAutomationCacheService({ schemaFingerprint: "lookup-fixture-v1" });
    const cachedContext = createAutomationContext({
      schemaProvider: async () => definitions,
      readRoots: [root],
      cache,
    });
    try {
      expect(await executeAutomationRequest(request, cachedContext)).toEqual(uncached);
      expect(await executeAutomationRequest(request, cachedContext)).toEqual(uncached);
      expect(await executeAutomationRequest(textRequest, cachedContext)).toEqual(uncachedText);
      expect(await executeAutomationRequest(bomRequest, cachedContext)).toEqual(uncachedBom);
      expect(await executeAutomationRequest(emptyRequest, cachedContext)).toEqual(uncachedEmpty);
      expect(await executeAutomationRequest(missingRequest, cachedContext)).toEqual(uncachedMissing);
      expect(cache.stats().hits.typedTables).toBeGreaterThan(0);
      expect(cache.stats().hits.locReaders).toBeGreaterThan(0);

      let keyedEnumerations = 0;
      const scope = cache.beginRequest({ policy: cachedContext.policy, schemaProvider: cachedContext.schemaProvider });
      const getVanillaRawLoc = scope.getVanillaRawLoc.bind(scope);
      scope.getVanillaRawLoc = async (packPaths, order) => {
        const lease = await getVanillaRawLoc(packPaths, order);
        if (lease) {
          const forEachEntry = lease.lookup.forEachEntry.bind(lease.lookup);
          lease.lookup.forEachEntry = async (visit) => {
            keyedEnumerations++;
            await forEachEntry(visit);
          };
        }
        return lease;
      };
      try {
        expect(
          await executeAutomationRequest(request, { ...cachedContext, cache: undefined, cacheRequest: scope }),
        ).toEqual(uncached);
      } finally {
        scope.close();
      }
      expect(keyedEnumerations).toBe(0);
    } finally {
      await cache.close();
    }
  });

  it("preserves malformed LOC and DB diagnostics through the cached readonly path", async () => {
    const pack = path.join(root, "malformed-lookup.pack");
    await writeRawPack(
      pack,
      [
        { name: "text\\bad.loc", buffer: Buffer.from([0, 1, 2]) },
        { name: "db\\land_units_tables\\data", buffer: Buffer.from([0, 1, 2]) },
      ],
      metadata,
    );
    const request = {
      operation: "localization_lookup",
      packPaths: [pack],
      query: "x",
      searchBy: "dbKey",
      tables: ["land_units_tables"],
    };
    const uncached = await executeAutomationRequest(request, context());
    const cache = createAutomationCacheService({ schemaFingerprint: "lookup-fixture-v1" });
    try {
      expect(
        await executeAutomationRequest(
          request,
          createAutomationContext({
            schemaProvider: async () => definitions,
            readRoots: [root],
            cache,
          }),
        ),
      ).toEqual(uncached);
    } finally {
      await cache.close();
    }
    expect(uncached).toMatchObject({
      ok: true,
      data: { complete: false },
      diagnostics: [
        expect.objectContaining({ code: "INVALID_LOC_FILE", path: "text\\bad.loc" }),
        expect.objectContaining({ code: "INVALID_DB_TABLE", path: "db\\land_units_tables\\data" }),
      ],
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
        { name: "variantmeshes\\variantmeshdefinitions\\test.variantmeshdefinition", buffer: Buffer.from("<root><source>variantmeshes/variantmeshdefinitions/test_model.wsmodel</source></root>") },
        { name: "variantmeshes\\variantmeshdefinitions\\test_model.wsmodel", buffer: Buffer.from("<root/>") },
      ],
      metadata,
    );
    const unitRequest = { operation: "unit_resolve", packPaths: [pack], query: "Swordsmen", searchBy: "text" };
    const uncachedResponse = await executeAutomationRequest(unitRequest, context());
    const cache = createAutomationCacheService({ schemaFingerprint: "unit-fixture-v1" });
    try {
      expect(
        await executeAutomationRequest(
          unitRequest,
          createAutomationContext({
            schemaProvider: async () => definitions,
            readRoots: [root],
            cache,
          }),
        ),
      ).toEqual(uncachedResponse);
    } finally {
      await cache.close();
    }
    const result = (uncachedResponse.ok ? uncachedResponse.data : undefined) as {
      total: number;
      items: Array<Record<string, any>>;
      complete: boolean;
    };
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
    expect(await run({ operation: "unit_resolve", packPaths: [pack], query: "visual", searchBy: "variant" })).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ mainUnitKey: "main_key" })],
    });
    expect(await run({ operation: "unit_resolve", packPaths: [pack], query: "variantmeshes/variantmeshdefinitions/test.variantmeshdefinition", searchBy: "mesh" })).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ mainUnitKey: "main_key" })],
    });
    expect(await run({ operation: "unit_resolve", packPaths: [pack], query: "test.variantmeshdefinition", searchBy: "mesh", match: "contains" })).toMatchObject({
      total: 1,
    });
    const wsmodel = await run({ operation: "unit_resolve", packPaths: [pack], query: "test_model", searchBy: "mesh", match: "contains" });
    expect(wsmodel).toMatchObject({ total: 1, items: [expect.objectContaining({ mainUnitKey: "main_key" })] });
    const batch = await run({ operation: "unit_resolve", packPaths: [pack], queries: ["test_model", "test.variantmeshdefinition"], searchBy: "mesh", match: "contains" });
    expect(batch).toMatchObject({ results: [
      { query: "test_model", total: 1, items: [expect.objectContaining({ mainUnitKey: "main_key" })] },
      { query: "test.variantmeshdefinition", total: 1, items: [expect.objectContaining({ mainUnitKey: "main_key" })] },
    ] });
  });

  it("searches typed DB field values and keeps row identity and bounded-result diagnostics", async () => {
    const pack = path.join(root, "typed-search.pack");
    await writeRawPack(
      pack,
      [
        db("main_units", [{ ...main("needle_unit", "needle_land"), num_men: 65 }]),
        db("building_units_allowed", [{ key: "rule", unit: "needle_unit", building: "barracks", faction: "f", conditions: "", enabled: true }]),
        { name: "db\\unsupported_table_tables\\data", buffer: Buffer.from([1, 2, 3]) },
      ],
      metadata,
    );
    const numeric = await executeAutomationRequest({ operation: "pack_search", packPath: pack, query: "65" }, context());
    expect(numeric).toMatchObject({
      ok: true,
      data: { results: [expect.objectContaining({ kind: "db", table: "main_units_tables", filePath: "db\\main_units_tables\\data", field: "num_men", typedValue: 65, rowIdentity: { unit: "needle_unit" } })] },
    });
    const boolean = await executeAutomationRequest({ operation: "pack_search", packPath: pack, query: "true" }, context());
    expect(boolean).toMatchObject({
      ok: true,
      data: { results: [expect.objectContaining({ kind: "db", field: "enabled", typedValue: true, rowIdentity: { key: "rule" } })] },
    });
    expect(boolean.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SKIPPED_UNSUPPORTED_DB" })]));
    const noContent = await executeAutomationRequest({ operation: "pack_search", packPath: pack, query: "true", content: false }, context());
    expect(noContent).toMatchObject({ ok: true, data: { results: [], truncated: false } });
    const bounded = await executeAutomationRequest({ operation: "pack_search", packPath: pack, query: "needle", maxResults: 1 }, context());
    expect(bounded).toMatchObject({ ok: true, data: { truncated: true, results: [expect.any(Object)] } });
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

  it("indexes target, support, shadowed, and unit visual ownership through dependency chains", async () => {
    const support = path.join(root, "asset-users-support.pack");
    const target = path.join(root, "asset-users-target.pack");
    const visualPath = "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition";
    await writeRawPack(
      support,
      [
        db("land_units", [land("land_a")]),
        db("main_units", [main("unit_a", "land_a")]),
        db("unit_variants", [{ unit: "land_a", faction: "faction_a", variant: "visual_a", name: "Unit A", unit_card: "card" }]),
        db("variants", [{ variant_name: "visual_a", variant_filename: "unit" }]),
        db("units_custom_battle_permissions", [{ unit: "unit_a", faction: "faction_a", general_uniform: "" }]),
        db("factions", [{ key: "faction_a", subculture: "sub_a" }]),
        db("cultures_subcultures", [{ subculture: "sub_a", culture: "culture_a" }]),
        db("building_units_allowed", [{ key: "rule", unit: "unit_a", building: "barracks", faction: "faction_a", conditions: "unlock", enabled: true }]),
        loc({ land_units_onscreen_name_land_a: "Unit A", factions_screen_name_faction_a: "Faction A" }),
        { name: visualPath, buffer: Buffer.from("<root><source>variantmeshes/variantmeshdefinitions/child.wsmodel</source></root>") },
        {
          name: "variantmeshes\\variantmeshdefinitions\\child.wsmodel",
          buffer: Buffer.from("<root><source>textures/shared.dds</source><definition>variantmeshes/variantmeshdefinitions/unit.variantmeshdefinition</definition></root>"),
        },
        { name: "textures\\shared.dds", buffer: Buffer.from("support texture") },
      ],
      metadata,
    );
    await writeRawPack(target, [{ name: "textures\\shared.dds", buffer: Buffer.from("target texture") }], metadata);
    const response = await executeAutomationRequest(
      {
        operation: "asset_users",
        packPath: target,
        packPaths: [support],
        targetPath: "textures/shared.dds",
        reportPath: path.join(root, "asset-users-report.json"),
      },
      createAutomationContext({ schemaProvider: async () => definitions, readRoots: [root] }),
    );
    expect(response).toMatchObject({
      ok: true,
      data: {
        resolution: "found",
        fileProviders: [
          { packPath: support, role: "support", providerKind: "mod", status: "shadowed" },
          { packPath: target, role: "target", providerKind: "mod", status: "effective" },
        ],
        users: expect.arrayContaining([
          expect.objectContaining({
            mainUnitKey: "unit_a",
            roster: expect.objectContaining({
              scopeSource: "customBattlePermissions",
              factions: expect.arrayContaining([expect.objectContaining({ key: "faction_a" })]),
              customBattlePermissions: expect.arrayContaining([expect.objectContaining({ row: { unit: "unit_a", faction: "faction_a", general_uniform: "" } })]),
            }),
            roots: expect.arrayContaining([expect.objectContaining({ path: visualPath, rootKind: "variant", chain: expect.arrayContaining([expect.objectContaining({ to: "textures\\shared.dds" })]) })]),
          }),
        ]),
      },
    });
    const report = JSON.parse(readFileSync(path.join(root, "asset-users-report.json"), "utf8")) as any;
    expect(report.users).toHaveLength(1);
    expect(report.users[0].roots[0].chain).toEqual(expect.arrayContaining([expect.objectContaining({ to: "textures\\shared.dds" })]));
    await writeRawPack(target, [
      { name: "textures\\shared.dds", buffer: Buffer.from("target texture") },
      { name: "textures\\other.dds", buffer: Buffer.from("other texture") },
    ], metadata);
    const indexingCompletions: number[] = [];
    const batchContext = createAutomationContext({ schemaProvider: async () => definitions, readRoots: [root],
      progress: (update) => { if (update.stage === "indexing" && update.completed === update.total) indexingCompletions.push(update.completed ?? 0); } });
    const batchUsers = await executeAutomationRequest({ operation: "asset_users", packPath: target, packPaths: [support],
      targetPaths: ["textures/shared.dds", "textures/other.dds"] }, batchContext);
    expect(batchUsers).toMatchObject({ ok: true, data: { totalTargets: 2, targets: [
      { targetPath: "textures\\shared.dds", total: 1, users: [expect.objectContaining({ mainUnitKey: "unit_a" })] },
      { targetPath: "textures\\other.dds", total: 0, changedPathCoverage: { status: "noMatch", complete: true } },
    ] } });
    const singleShared = await executeAutomationRequest({ operation: "asset_users", packPath: target, packPaths: [support], targetPath: "textures/shared.dds" }, batchContext);
    const singleOther = await executeAutomationRequest({ operation: "asset_users", packPath: target, packPaths: [support], targetPath: "textures/other.dds" }, batchContext);
    expect(batchUsers.ok && singleShared.ok && singleOther.ok).toBe(true);
    if (batchUsers.ok && singleShared.ok && singleOther.ok) {
      expect((batchUsers.data as any).targets[0].users).toEqual(singleShared.data.users);
      expect((batchUsers.data as any).targets[1].users).toEqual(singleOther.data.users);
    }
    expect(indexingCompletions).toHaveLength(3); // One shared index for the batch, one per single request.
    const limited = await executeAutomationRequest(
      { operation: "asset_users", packPath: target, packPaths: [support], targetPath: "textures/shared.dds", maxNodes: 1 },
      createAutomationContext({ schemaProvider: async () => definitions, readRoots: [root] }),
    );
    expect(limited).toMatchObject({ ok: true, data: { complete: false } });
  });

  it("filters asset-user roots by exact main or land keys and normalized full-path globs", async () => {
    const support = path.join(root, "asset-user-filters.pack");
    const target = path.join(root, "asset-user-filter-target.pack");
    const visualEntries = (unitKey: string, landKey: string, filename: string) => {
      const visualPath = `variantmeshes\\variantmeshdefinitions\\${filename}.variantmeshdefinition`;
      return [
        { name: visualPath, buffer: Buffer.from(`<root><source>variantmeshes/variantmeshdefinitions/${filename}.wsmodel</source></root>`) },
        { name: `variantmeshes\\variantmeshdefinitions\\${filename}.wsmodel`, buffer: Buffer.from("<root><source>textures/shared.dds</source></root>") },
      ];
    };
    await writeRawPack(support, [
      db("main_units", [main("unit_a", "land_a"), main("unit_b", "land_b")]),
      db("land_units", [land("land_a"), land("land_b")]),
      db("unit_variants", [
        { unit: "land_a", faction: "faction_unit_a", variant: "variant_unit_a", name: "unit_a", unit_card: "" },
        { unit: "land_b", faction: "faction_unit_b", variant: "variant_unit_b", name: "unit_b", unit_card: "" },
      ]),
      db("variants", [
        { variant_name: "variant_unit_a", variant_filename: "alpha" },
        { variant_name: "variant_unit_b", variant_filename: "beta" },
      ]),
      ...visualEntries("unit_a", "land_a", "alpha"), ...visualEntries("unit_b", "land_b", "beta"),
    ], metadata);
    await writeRawPack(target, [{ name: "textures\\shared.dds", buffer: Buffer.from("target") }], metadata);
    const context = createAutomationContext({ schemaProvider: async () => definitions, readRoots: [root] });
    const runUsers = async (extra: Record<string, unknown> = {}) => {
      const response = await executeAutomationRequest({ operation: "asset_users", packPath: target, packPaths: [support],
        targetPath: "textures/shared.dds", ...extra }, context);
      if (!response.ok) throw new Error(JSON.stringify(response.error));
      return response.data as any;
    };

    const byLandKey = await runUsers({ unitKeys: ["LAND_B"] });
    expect(byLandKey.users.map((user: any) => user.mainUnitKey)).toEqual(["unit_b"]);
    expect(byLandKey.coverage).toMatchObject({
      scope: { unitKeys: ["land_b"], rootGlob: null, packScope: { targetPack: target, modPackPaths: [support, target], vanillaPackPaths: [] } },
      units: { total: 2, selected: 1, scanned: 2 },
      roots: { discovered: 1, filtered: 1, unique: 1, selected: 1, scanned: 1 },
    });

    const byGlob = await runUsers({ rootGlob: "**/ALPHA.VARIANTMESHDEFINITION" });
    expect(byGlob.users.map((user: any) => user.mainUnitKey)).toEqual(["unit_a"]);
    expect(byGlob.coverage.roots).toMatchObject({ discovered: 2, filtered: 1, unique: 1, selected: 1 });
    expect(byGlob.coverage.scope.rootGlob).toBe("**/alpha.variantmeshdefinition");

    const combined = await runUsers({ unitKeys: ["LAND_B"], rootGlob: "**/alpha.*" });
    expect(combined.users).toEqual([]);
    expect(combined.coverage.roots).toMatchObject({ discovered: 1, filtered: 0, unique: 0, selected: 0, scanned: 0 });
  });

  it("ranks mod roots before vanilla under maxRoots and keeps vanilla users in full scans", async () => {
    const vanilla = path.join(root, "asset-users-vanilla.pack");
    const support = path.join(root, "asset-users-mod.pack");
    const target = path.join(root, "asset-users-rank-target.pack");
    const unitEntries = (unitKey: string, landKey: string, filename: string) => {
      const visualPath = `variantmeshes\\variantmeshdefinitions\\${filename}.variantmeshdefinition`;
      return [
        db("main_units", [main(unitKey, landKey)], `${filename}_main`), db("land_units", [land(landKey)], `${filename}_land`),
        db("unit_variants", [{ unit: landKey, faction: `faction_${unitKey}`, variant: `variant_${unitKey}`, name: unitKey, unit_card: "" }], `${filename}_unit_variants`),
        db("variants", [{ variant_name: `variant_${unitKey}`, variant_filename: filename }], `${filename}_variants`),
        { name: visualPath, buffer: Buffer.from(`<root><source>variantmeshes/variantmeshdefinitions/${filename}.wsmodel</source></root>`) },
        { name: `variantmeshes\\variantmeshdefinitions\\${filename}.wsmodel`, buffer: Buffer.from("<root><source>textures/shared.dds</source></root>") },
      ];
    };
    await writeRawPack(vanilla, unitEntries("unit_vanilla", "land_vanilla", "vanilla_root"), metadata);
    await writeRawPack(support, unitEntries("unit_mod", "land_mod", "mod_root"), metadata);
    await writeRawPack(target, [{ name: "textures\\shared.dds", buffer: Buffer.from("target") }], metadata);
    const context = createAutomationContext({ schemaProvider: async () => definitions, readRoots: [root] });
    const request = { operation: "asset_users", packPath: target, packPaths: [support], vanillaPackPaths: [vanilla], targetPath: "textures/shared.dds" };
    const full = await executeAutomationRequest(request, context);
    expect(full).toMatchObject({ ok: true, data: { users: expect.arrayContaining([
      expect.objectContaining({ mainUnitKey: "unit_mod" }), expect.objectContaining({ mainUnitKey: "unit_vanilla" }),
    ]) } });
    const limited = await executeAutomationRequest({ ...request, maxRoots: 1 }, context);
    expect(limited).toMatchObject({ ok: true, data: {
      usageComplete: false,
      coverage: { roots: { unique: 2, selected: 1 } },
      users: [expect.objectContaining({ mainUnitKey: "unit_mod" })],
    } });
  });

  it("separates optional metadata gaps from unresolved selected-unit visual references", async () => {
    const support = path.join(root, "asset-users-optional-tables.pack");
    const target = path.join(root, "asset-users-optional-target.pack");
    const makeEntries = (mount: string, variant: string) => [
      db("main_units", [main("unit_a", "land_a")]), db("land_units", [{ ...land("land_a"), mount }]),
      db("unit_variants", [{ unit: "land_a", faction: "faction_a", variant, name: "A", unit_card: "" }]),
      db("variants", [{ variant_name: "variant_a", variant_filename: "unit_a" }]),
      { name: "variantmeshes\\variantmeshdefinitions\\unit_a.variantmeshdefinition", buffer: Buffer.from("<root><source>variantmeshes/variantmeshdefinitions/unit_a.wsmodel</source></root>") },
      { name: "variantmeshes\\variantmeshdefinitions\\unit_a.wsmodel", buffer: Buffer.from("<root><source>textures/shared.dds</source></root>") },
    ];
    await writeRawPack(support, makeEntries("", "variant_a"), metadata);
    await writeRawPack(target, [{ name: "textures\\shared.dds", buffer: Buffer.from("target") }], metadata);
    const context = createAutomationContext({ schemaProvider: async () => definitions, readRoots: [root] });
    const request = { operation: "asset_users", packPath: target, packPaths: [support], targetPath: "textures/shared.dds" };
    const optionalMissing = await executeAutomationRequest(request, context);
    expect(optionalMissing).toMatchObject({ ok: true, data: {
      usageComplete: true,
      metadataComplete: false,
      complete: false,
      metadataCoverage: { missingTables: expect.arrayContaining(["units_custom_battle_permissions"]) },
    } });
    expect((optionalMissing as any).data.usageDiagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNIT_VISUAL_JOIN_TABLE_MISSING", path: "db\\units_custom_battle_permissions_tables" }),
    ]));

    await writeRawPack(support, makeEntries("missing_mount", "variant_a"), metadata);
    const unresolvedMount = await executeAutomationRequest(request, context);
    expect(unresolvedMount).toMatchObject({ ok: true, data: {
      usageComplete: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "UNRESOLVED_UNIT_VISUAL", message: expect.stringContaining("Mount missing_mount") })]),
    } });

    await writeRawPack(support, makeEntries("", "missing_variant"), metadata);
    const unresolvedVariant = await executeAutomationRequest(request, context);
    expect(unresolvedVariant).toMatchObject({ ok: true, data: {
      usageComplete: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "UNRESOLVED_UNIT_VISUAL", message: expect.stringContaining("Variant missing_variant") })]),
    } });
  });

  it("maps both diff states through moved visuals and full DB/LOC deltas before pagination", async () => {
    const beforePath = path.join(root, "affected-before.pack");
    const afterPath = path.join(root, "affected-after.pack");
    const baseVisualEntries = (state: "before" | "after") => {
      const before = state === "before";
      const mainRows = before
        ? [main("unit_a", "land_a"), main("unit_c", "land_c")]
        : [{ ...main("unit_a", "land_a"), num_men: 65 }, main("unit_b", "land_b")];
      const landRows = before
        ? [land("land_a"), land("land_c")]
        : [land("land_a"), land("land_b"), land("orphan_land")];
      const unitVariants = before
        ? [
            { unit: "land_a", faction: "faction_a", variant: "visual_a", name: "A", unit_card: "a" },
            { unit: "land_c", faction: "", variant: "visual_c", name: "C", unit_card: "c" },
          ]
        : [
            { unit: "land_a", faction: "faction_a", variant: "visual_a", name: "A", unit_card: "a" },
            { unit: "land_b", faction: "faction_b", variant: "visual_b", name: "B", unit_card: "b" },
          ];
      const variants = before
        ? [
            { variant_name: "visual_a", variant_filename: "units/a" },
            { variant_name: "visual_c", variant_filename: "units/c" },
          ]
        : [
            { variant_name: "visual_a", variant_filename: "units/a" },
            { variant_name: "visual_b", variant_filename: "units/b" },
          ];
      const customPermissions = before
        ? [
            { unit: "unit_a", faction: "faction_a", general_uniform: "" },
            { unit: "unit_c", faction: "", general_uniform: "" },
          ]
        : [{ unit: "unit_a", faction: "faction_a", general_uniform: "" }];
      const emptyTables = [
        "units_to_exclusive_faction_permissions",
        "building_culture_variants",
        "mercenary_unit_groups",
        "unit_set_to_unit_junctions",
        "mounts",
        "battlefield_engines",
        "land_units_to_extra_engines",
        "ui_unit_groupings",
        "ui_unit_group_parents",
        "agent_subtypes",
        "agent_subtype_subculture_overrides",
        "faction_agent_permitted_subtypes",
        "campaign_character_art_sets",
        "campaign_character_arts",
        "agent_uniforms",
      ].map((table) => db(table, []));
      const locRows = before
        ? {
            land_units_onscreen_name_land_a: "Old A",
            land_units_onscreen_name_land_c: "C name",
            factions_screen_name_faction_a: "Faction A",
            factions_screen_name_faction_b: "Faction B",
          }
        : {
            land_units_onscreen_name_land_a: "New A",
            land_units_onscreen_name_land_b: "B name",
            land_units_onscreen_name_orphan_land: "Orphan",
            factions_screen_name_faction_a: "Faction A",
            factions_screen_name_faction_b: "Faction B",
          };
      const sharedTexture = before
        ? { name: "textures\\old.dds", buffer: Buffer.from("same texture") }
        : { name: "textures\\new.dds", buffer: Buffer.from("same texture") };
      const visualFiles = before
        ? [
            { name: "variantmeshes\\variantmeshdefinitions\\units\\a.variantmeshdefinition", buffer: Buffer.from("<root><source>textures/old.dds</source></root>") },
            { name: "variantmeshes\\variantmeshdefinitions\\units\\c.variantmeshdefinition", buffer: Buffer.from("<root><source>textures/old.dds</source></root>") },
          ]
        : [
            { name: "variantmeshes\\variantmeshdefinitions\\units\\a.variantmeshdefinition", buffer: Buffer.from("<root><source>textures/new.dds</source></root>") },
            { name: "variantmeshes\\variantmeshdefinitions\\units\\b.variantmeshdefinition", buffer: Buffer.from("<root><source>textures/new.dds</source></root>") },
          ];
      return [
        db("main_units", mainRows),
        db("land_units", landRows),
        db("unit_variants", unitVariants),
        db("variants", variants),
        db("factions", [
          { key: "faction_a", subculture: "sub_a" },
          { key: "faction_b", subculture: "sub_b" },
        ]),
        db("cultures_subcultures", [
          { subculture: "sub_a", culture: "culture_a" },
          { subculture: "sub_b", culture: "culture_b" },
        ]),
        db("units_custom_battle_permissions", customPermissions),
        db("building_units_allowed", [
          { key: "rule_a", unit: "unit_a", building: "barracks", faction: "faction_a", conditions: before ? "old" : "new", enabled: true },
        ]),
        ...emptyTables,
        loc(locRows),
        sharedTexture,
        ...visualFiles,
      ];
    };
    await writeRawPack(beforePath, baseVisualEntries("before"), metadata);
    await writeRawPack(afterPath, baseVisualEntries("after"), metadata);
    const reportPath = path.join(root, "affected-report.json");
    const response = await executeAutomationRequest(
      {
        operation: "pack_diff",
        beforePath,
        afterPath,
        affectedUnits: true,
        semanticOffset: 1,
        semanticLimit: 1,
        reportPath,
      },
      context(),
    );
    if (!response.ok) throw new Error(JSON.stringify(response.error));
    const data = response.data as any;
    expect(data.affectedUnits).toMatchObject({ total: 4, offset: 1, limit: 1, hasMore: true });
    expect(data.affectedUnits.items).toHaveLength(1);
    const full = JSON.parse(readFileSync(reportPath, "utf8")) as any;
    expect(full.affectedUnits.items).toHaveLength(4);
    const affected = full.affectedUnits.items as Array<any>;
    const unitA = affected.find((unit) => unit.unitKey === "unit_a");
    expect(unitA.states).toHaveLength(2);
    expect(unitA.states.flatMap((state: any) => state.paths)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "databaseRow", table: "db\\main_units_tables" }),
        expect.objectContaining({ kind: "databaseRow", table: "db\\building_units_allowed_tables" }),
        expect.objectContaining({ kind: "localizationRow", table: "loc:text\\names.loc" }),
      ]),
    );
    expect(unitA.states.flatMap((state: any) => state.paths)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "textures\\old.dds" }),
        expect.objectContaining({ path: "textures\\new.dds" }),
      ]),
    );
    expect(full.affectedUnits.checklist.factions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "faction_a", evidence: "customBattlePermission" }),
        expect.objectContaining({ key: "faction_b", evidence: "visualFallback" }),
      ]),
    );
    expect(full.affectedUnits.checklist.unscoped).toEqual([
      expect.objectContaining({ unitKey: "unit_c", classification: "customBattlePermission" }),
    ]);
    expect(full.affectedUnits.checklist.unknown).toEqual([
      expect.objectContaining({ landUnitKey: "orphan_land" }),
    ]);
    expect(data.affectedUnits.analysis.before.roots).toBeGreaterThan(0);
    expect(data.affectedUnits.analysis.after.roots).toBeGreaterThan(0);
  });

  it("deduplicates an unscoped checklist unit affected in both states", async () => {
    const beforePath = path.join(root, "unscoped-before.pack");
    const afterPath = path.join(root, "unscoped-after.pack");
    const entries = [
      db("main_units", [{ unit: "unscoped_unit", land_unit: "unscoped_land", caste: "infantry", num_men: 100, ui_unit_group_land: "" }]),
      db("land_units", [{ key: "unscoped_land", category: "inf_melee", class: "melee", mount: ".", engine: ".", num_mounts: 0, num_engines: 0 }]),
      db("unit_variants", [{ unit: "unscoped_land", variant: "unscoped_variant", faction: "", name: "", unit_card: "" }]),
      db("variants", [{ variant_name: "unscoped_variant", variant_filename: "unscoped" }]),
      db("units_custom_battle_permissions", [{ unit: "unscoped_unit", faction: "", general_uniform: "" }]),
    ];
    const filePath = "variantmeshes\\variantmeshdefinitions\\unscoped.variantmeshdefinition";
    await writeRawPack(beforePath, [...entries, { name: filePath, buffer: Buffer.from("<VARIANT_MESH />") }], metadata);
    await writeRawPack(afterPath, [...entries, { name: filePath, buffer: Buffer.from("<VARIANT_MESH><!-- changed --></VARIANT_MESH>") }], metadata);
    const response = await executeAutomationRequest({ operation: "pack_diff", beforePath, afterPath, affectedUnits: true }, context());
    expect(response).toMatchObject({ ok: true, data: { affectedUnits: {
      total: 1,
      items: [{ unitKey: "unscoped_unit", states: [expect.objectContaining({ state: "before" }), expect.objectContaining({ state: "after" })] }],
      checklist: { unscoped: [{ unitKey: "unscoped_unit", landUnitKey: "unscoped_land", classification: "customBattlePermission" }] },
    } } });
  });

  it("keeps matched paths unresolved under indexing limits and deduplicates campaign review bytes", async () => {
    const beforePath = path.join(root, "limited-checklist-before.pack");
    const afterPath = path.join(root, "limited-checklist-after.pack");
    const modelPath = "variantmeshes\\variantmeshdefinitions\\units\\test.wsmodel";
    const campaignPath = "art\\campaign\\ships\\transportship06\\ship.rigid_model_v2";
    const rootPath = "variantmeshes\\variantmeshdefinitions\\units\\test.variantmeshdefinition";
    const beforeCampaign = Buffer.from("campaign ship");
    const afterCampaign = Buffer.from("campaign ship updated");
    const unitRows = [
      db("main_units", [{ ...main("limited_unit", "limited_land"), caste: "lord" }]),
      db("land_units", [{ ...land("limited_land"), engine: "ship_engine" }]),
      db("unit_variants", [{ unit: "limited_land", faction: "faction_a", variant: "test_variant", name: "Test", unit_card: "" }]),
      db("variants", [{ variant_name: "test_variant", variant_filename: "units/test" }]),
      db("battlefield_engines", [{ key: "ship_engine", variant: ".", model: campaignPath }]),
      db("units_custom_battle_permissions", [{ unit: "limited_unit", faction: "faction_a", general_uniform: "" }]),
      db("factions", [{ key: "faction_a", subculture: "sub_a" }]),
      db("cultures_subcultures", [{ subculture: "sub_a", culture: "culture_a" }]),
      loc({ land_units_onscreen_name_limited_land: "Limited Lord", factions_screen_name_faction_a: "Faction A" }),
    ];
    const makeEntries = (model: Buffer, campaignShip: Buffer) => [
      ...unitRows,
      { name: rootPath, buffer: Buffer.from("<root><source>variantmeshes/variantmeshdefinitions/units/test.wsmodel</source></root>") },
      { name: modelPath, buffer: model },
      { name: campaignPath, buffer: campaignShip },
    ];
    const beforeModel = Buffer.from("<root />");
    const afterModel = Buffer.from("<root><changed /></root>");
    await writeRawPack(beforePath, makeEntries(beforeModel, beforeCampaign), metadata);
    await writeRawPack(afterPath, makeEntries(afterModel, afterCampaign), metadata);
    const response = await executeAutomationRequest({
      operation: "pack_diff", beforePath, afterPath, affectedUnits: true, affectedMaxScanSources: 1,
    }, context());
    if (!response.ok) throw new Error(JSON.stringify(response.error));
    const affected = (response.data as any).affectedUnits;
    expect(affected.items).toEqual(expect.arrayContaining([expect.objectContaining({ unitKey: "limited_unit" })]));
    expect(affected.changedPathCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: modelPath, status: "matched", complete: false }),
      expect.objectContaining({ path: campaignPath, status: "matched", complete: false }),
    ]));
    expect(affected.unresolvedPaths).toEqual(expect.arrayContaining([modelPath, campaignPath]));
    const checklist = affected.checklist;
    const unit = checklist.units.find((item: any) => item.unitKey === "limited_unit");
    expect(unit).toMatchObject({ key: "limited_unit", name: "Limited Lord", role: "lord", customBattleFactions: [{ key: "faction_a" }] });
    expect(unit.changedFiles.filter((file: any) => file.path === modelPath)).toHaveLength(1);
    expect(unit.changedFiles.filter((file: any) => file.path === campaignPath)).toHaveLength(1);
    expect(unit.changedBytes).toBe(afterModel.length + afterCampaign.length);
    expect(checklist.campaignReviewAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: campaignPath, status: "matched", complete: false, campaignOnly: false,
        mappedUnits: [expect.objectContaining({ unitKey: "limited_unit" })] }),
    ]));
  });

  it("returns a complete empty affected-unit result without resolving unit databases for unchanged packs", async () => {
    const beforePath = path.join(root, "unchanged-before.pack");
    const afterPath = path.join(root, "unchanged-after.pack");
    const entries = [{ name: "readme.txt", buffer: Buffer.from("same") }];
    await writeRawPack(beforePath, entries, metadata);
    await writeRawPack(afterPath, entries, metadata);
    const response = await executeAutomationRequest(
      { operation: "pack_diff", beforePath, afterPath, affectedUnits: true },
      createAutomationContext({ schemaProvider: async () => { throw new Error("unit schema must not be loaded"); } }),
    );
    expect(response).toMatchObject({
      ok: true,
      data: {
        affectedUnits: {
          complete: true,
          total: 0,
          items: [],
          analysis: { before: { roots: 0 }, after: { roots: 0 }, changedPaths: 0 },
        },
      },
    });
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
    const canceledUsers = await executeAutomationRequest(
      { operation: "asset_users", packPath: pack, targetPath: "textures/missing.dds" },
      createAutomationContext({ signal: controller.signal }),
    );
    expect(canceledUsers).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });

  it("matches the optimizer category fallbacks", () => {
    expect(classifyUnitForOptimization("hero", "", "infantry")).toBe("InfantryMissile");
    expect(classifyUnitForOptimization("hero", "", "")).toBe("Hero");
    expect(classifyUnitForOptimization("", "artillery", "")).toBe("ArtilleryWarMachine");
    expect(classifyUnitForOptimization("", "", "")).toBe("Unknown");
  });
});
