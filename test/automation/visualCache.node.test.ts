import { createHash } from "node:crypto";
import { linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutomationCacheService, createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { makeRowFields } from "../../src/automation/tables";
import { LocVersion, type DBField, type DBVersion } from "../../src/packFileTypes";
import { readPackIndex, serializeDbTable, writeRawPack } from "../../src/packCore";
import { VISUALS_DATA_CACHE_VERSION } from "../../src/visuals/cache";
import { canonicalizeExistingPath } from "../../src/vanillaCacheIdentity";
import { prepareReferenceEnvironment, resolveReferenceAsset } from "../../src/automation/references";
import { createIncomingVisualReferenceIndex } from "../../src/automation/graphUsers";
import { withAutomationPayloadRangeReader } from "../../src/automation/packAccess";

const workspaces: string[] = [];
afterEach(() => { for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true }); });
const metadata = { game: "wh3" as const, byteMask: 3, refFileCount: 0, headerBuffer: Buffer.from([255, 255, 255, 127]), dependencies: [] as string[] };
const vmd = "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition";
const model = "models\\unit.rigid_model_v2";
const texture = "textures\\a.dds";
const keys: Record<string, string[]> = { main_units: ["unit"], land_units: ["key"], unit_variants: ["unit", "faction"],
  variants: ["variant_name"], factions: ["key"], cultures_subcultures: ["subculture"], units_custom_battle_permissions: ["unit", "faction"] };
const rows: Record<string, Record<string, string>[]> = {
  main_units: [{ unit: "unit", land_unit: "land", caste: "infantry", num_men: "100", ui_unit_group_land: "" }],
  land_units: [{ key: "land", category: "inf_melee", class: "melee", mount: ".", engine: ".", num_mounts: "0", num_engines: "0" }],
  unit_variants: [{ unit: "land", faction: "faction", variant: "variant", name: "", unit_card: "" }],
  variants: [{ variant_name: "variant", variant_filename: "unit" }],
  factions: [{ key: "faction", subculture: "subculture" }], cultures_subcultures: [{ subculture: "subculture", culture: "culture" }],
  units_custom_battle_permissions: [{ unit: "unit", faction: "faction", general_uniform: "" }],
};
const schemas: Record<string, DBVersion[]> = Object.fromEntries(Object.entries(rows).map(([table, values]) => [`${table}_tables`, [{
  version: 0, fields: Object.keys(values[0]).map((name): DBField => ({ name, field_type: "StringU8", is_key: keys[table].includes(name),
    default_value: "", is_filename: false, is_reference: [], description: "", ca_order: 0, is_bitwise: 0, enum_values: {} })),
  localised_fields: [], localised_key_order: [],
}]]));

// Minimal registered RMV2 fixture; geometry stays outside cached reference metadata.
const rigid = (texturePath: string | readonly string[]) => {
  const texturePaths = typeof texturePath === "string" ? [texturePath] : texturePath;
  const material = Buffer.alloc(860 + texturePaths.length * 260); material.write("part", 2); material.writeUInt32LE(texturePaths.length, 716);
  texturePaths.forEach((value, index) => { material.writeInt32LE(0, 860 + index * 260); material.write(value, 864 + index * 260); });
  const vertexOffset = 80 + material.length;
  const vertices = Buffer.alloc(96);
  for (let index = 0; index < 3; index++) vertices.writeUInt16LE(0x3c00, index * 32);
  const indices = Buffer.from([0, 0, 1, 0, 2, 0]);
  const section = Buffer.alloc(vertexOffset + vertices.length + indices.length);
  section.writeUInt16LE(70); section.writeUInt32LE(section.length, 4); section.writeUInt32LE(vertexOffset, 8);
  section.writeUInt32LE(3, 12); section.writeUInt32LE(vertexOffset + vertices.length, 16); section.writeUInt32LE(3, 20);
  material.copy(section, 80); vertices.copy(section, vertexOffset); indices.copy(section, vertexOffset + vertices.length);
  const file = Buffer.alloc(168 + section.length); file.write("RMV2"); file.writeUInt32LE(8, 4); file.writeUInt32LE(1, 8);
  file.writeUInt32LE(1, 140); file.writeUInt32LE(vertices.length, 144); file.writeUInt32LE(indices.length, 148);
  file.writeUInt32LE(168, 152); section.copy(file, 168); return file;
};
const fixture = async (options: { compressedTables?: boolean; nullableFaction?: boolean; duplicateGeneric?: boolean } = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "whmm-visual-cache-")); workspaces.push(root);
  const definitions = structuredClone(schemas);
  const sourceRows = structuredClone(rows);
  if (options.nullableFaction || options.duplicateGeneric) {
    definitions.unit_variants_tables[0].fields.find((field) => field.name === "faction")!.field_type = "OptionalStringU8";
    (sourceRows.unit_variants[0] as Record<string, unknown>).faction = null;
    if (options.duplicateGeneric) sourceRows.unit_variants.push({ ...sourceRows.unit_variants[0], variant: "missing_variant" });
  }
  const units = path.join(root, "units.pack"); const assets = path.join(root, "assets.pack");
  await writeRawPack(units, Object.entries(sourceRows).map(([table, values]) => {
    const buffer = serializeDbTable(definitions[`${table}_tables`][0], values.map((row) => makeRowFields(definitions[`${table}_tables`][0], row)), { version: 0 });
    return { name: `db\\${table}_tables\\data`, buffer: options.compressedTables ? zstdCompressSync(buffer) : buffer,
      is_compressed: options.compressedTables };
  }), metadata);
  const alternateTexture = "textures\\b.dds";
  const assetEntries = (targetTexture = texture) => [
    { name: vmd, buffer: Buffer.from(`<VARIANT_MESH><SLOT><VARIANT_MESH model="${model}" /></SLOT></VARIANT_MESH>`) },
    { name: model, buffer: rigid([targetTexture, alternateTexture]) },
    { name: targetTexture, buffer: Buffer.from("texture") }, { name: alternateTexture, buffer: Buffer.from("alternate texture") },
  ];
  await writeRawPack(assets, assetEntries(), metadata);
  const request = { operation: "asset_users", packPath: units, packPaths: [assets], targetPath: texture };
  const cacheDir = path.join(root, "managed"); const whmmCacheDir = path.join(root, "whmm");
  mkdirSync(path.join(whmmCacheDir, "visuals"), { recursive: true });
  const identity = { packPath: units, size: statSync(units).size, mtimeMs: statSync(units).mtimeMs };
  const entry = { identity, tables: { schemaHash: "fixture-schema", contribution: {
    mainUnitLinks: [["unit", "land"]], mainUnits: [["land", "infantry"]], landUnits: ["land"],
    variants: [["variant", "unit"]], unitVariants: sourceRows.unit_variants.map((row) => [row.unit, row.faction ?? "", row.variant, row.name, row.unit_card]),
  } } };
  const guiPath = path.join(whmmCacheDir, "visuals", "vanilla.bin");
  writeFileSync(guiPath, zstdCompressSync(Buffer.from(JSON.stringify({ version: VISUALS_DATA_CACHE_VERSION, entries: { [units]: entry } }))));
  const service = (extras = {}) => createAutomationCacheService({ cacheDir, whmmCacheDir, schemaFingerprint: "fixture-schema", ...extras });
  const context = (cache?: ReturnType<typeof service>, writeRoots: string[] = [root]) => createAutomationContext({ cache,
    schemaProvider: async () => definitions, readRoots: [root], writeRoots });
  return { root, units, assets, assetEntries, request, alternateTexture, cacheDir, whmmCacheDir, guiPath, entry, service, context };
};

describe("shared visuals catalog and dependency metadata", () => {
  it("reuses the GUI catalog and per-pack references across service restarts without changing evidence", async () => {
    const f = await fixture(); const originalGui = readFileSync(f.guiPath);
    const plain = await executeAutomationRequest(f.request, f.context());
    const cold = f.service();
    expect(await executeAutomationRequest(f.request, f.context(cold))).toEqual(plain);
    expect(cold.stats().visuals).toMatchObject({ sourceParses: 2, catalogHits: 3, persistentWrites: 1 });
    expect(cold.stats().retainedBytes).toBeLessThanOrEqual(cold.stats().memoryLimitBytes);
    await cold.close();
    const warm = f.service();
    expect(await executeAutomationRequest(f.request, f.context(warm))).toEqual(plain);
    expect(warm.stats().visuals).toMatchObject({ sourceParses: 0, referenceHits: 2, catalogHits: 3 });
    await warm.close();
    expect(readFileSync(f.guiPath)).toEqual(originalGui);
    const directory = path.join(f.cacheDir, "headless", "visuals", "references");
    const payload = JSON.parse(zstdDecompressSync(readFileSync(path.join(directory, readdirSync(directory)[0]))).toString());
    expect(JSON.stringify(payload)).not.toContain('"vertices"');
    expect(JSON.stringify(payload)).not.toContain('"raw"');
  });

  it("keeps raw extraction reusable when a later request asks for a different texture", async () => {
    const f = await fixture(); const cache = f.service();
    const first = await executeAutomationRequest(f.request, f.context(cache));
    const parsesAfterFirst = cache.stats().visuals.sourceParses;
    const secondRequest = { ...f.request, targetPath: f.alternateTexture };
    expect(await executeAutomationRequest(secondRequest, f.context(cache))).toEqual(
      await executeAutomationRequest(secondRequest, f.context()),
    );
    expect(first.ok).toBe(true);
    expect(cache.stats().visuals.sourceParses).toBe(parsesAfterFirst);
    expect(cache.stats().visuals.referenceHits).toBeGreaterThan(0);
    await cache.close();
  });

  it("uses the bounded full-payload parser for compressed RMV2 entries", async () => {
    const f = await fixture(); const compressedAssets = path.join(f.root, "compressed-assets.pack");
    const entries = f.assetEntries().map((entry) => entry.name === model
      ? { ...entry, buffer: zstdCompressSync(entry.buffer), is_compressed: true }
      : entry);
    await writeRawPack(compressedAssets, entries, metadata);
    const expected = await executeAutomationRequest(f.request, f.context());
    const actual = await executeAutomationRequest({ ...f.request, packPaths: [compressedAssets] }, f.context());
    expect(JSON.parse(JSON.stringify(actual).replaceAll(compressedAssets, f.assets))).toEqual(expected);
  });

  it("does not charge unrelated DDS edges against a small incoming-index edge budget", async () => {
    const f = await fixture(); const packPath = path.join(f.root, "many-textures.pack");
    const unrelatedCount = 2_000;
    const xml = `<root>${Array.from({ length: unrelatedCount }, (_, index) =>
      `<source>textures/unrelated_${index}.dds</source>`).join("")}<source>textures/target.dds</source></root>`;
    await writeRawPack(packPath, [
      { name: "variantmeshes\\many.wsmodel", buffer: Buffer.from(xml) },
      ...Array.from({ length: unrelatedCount }, (_, index) => ({
        name: `textures\\unrelated_${index}.dds`, buffer: Buffer.from("u"),
      })),
      { name: "textures\\target.dds", buffer: Buffer.from("target") },
    ], metadata);
    const environment = await prepareReferenceEnvironment(f.context(), [packPath], [], undefined, false, true);
    const index = await createIncomingVisualReferenceIndex(environment, ["textures/target.dds"], {
      maxSources: 10,
      maxIndexEdges: 1,
    });
    expect(index).toMatchObject({ complete: true, edges: 1, scannedSources: 1 });
    expect(index.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INCOMING_REFERENCE_EDGE_LIMIT" }),
    ]));
  });

  it("skips source parsing when a DDS seed has no effective provider", async () => {
    const f = await fixture();
    const environment = await prepareReferenceEnvironment(f.context(), [f.units, f.assets], [], undefined, false, true);
    const index = await createIncomingVisualReferenceIndex(environment, ["textures/missing.dds"], {
      maxSources: 10,
      maxIndexEdges: 1,
    });
    expect(index).toMatchObject({ complete: true, edges: 0, scannedSources: 0, diagnostics: [] });
  });

  it("applies filesystem policy and snapshot checks to uncompressed range reads", async () => {
    const f = await fixture(); const indexed = readPackIndex(f.assets, { game: "wh3" });
    const modelEntry = indexed.entries.find((item) => item.name === model)!;
    const deniedRoot = path.join(f.root, "denied-read-root"); mkdirSync(deniedRoot);
    const denied = createAutomationContext({ readRoots: [deniedRoot], writeRoots: [f.root] });
    let readCount = 0;
    await expect(withAutomationPayloadRangeReader(indexed, modelEntry, denied, async (reader) => {
      readCount++;
      return reader.readRange(0, 1);
    })).rejects.toMatchObject({ code: "IO_ACCESS" });
    expect(readCount).toBe(0);

    const cache = f.service(); const context = f.context(cache);
    const scope = cache.beginRequest({ policy: context.policy, schemaProvider: context.schemaProvider, useVisualsCache: true });
    try {
      const scopedPack = await scope.readPackIndex(f.assets);
      const scopedEntry = scopedPack.entries.find((item) => item.name === model)!;
      await expect(withAutomationPayloadRangeReader(scopedPack, scopedEntry, { ...context, cacheRequest: scope }, async (reader) => {
        await reader.readRange(0, 1);
        const current = statSync(f.assets);
        utimesSync(f.assets, current.atime, new Date(current.mtimeMs + 1000));
      })).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      scope.close();
      await cache.close();
    }
  });

  it("uses catalog rows for discovery and falls back for schema, source, or catalog-version changes", async () => {
    const f = await fixture();
    const run = async () => {
      const cache = f.service(); const readTables: string[] = [];
      const begin = cache.beginRequest.bind(cache);
      vi.spyOn(cache, "beginRequest").mockImplementation((options) => {
        const scope = begin(options); const original = scope.getReadonlyTable.bind(scope);
        scope.getReadonlyTable = (pack, file) => { readTables.push(file); return original(pack, file); };
        return scope;
      });
      await executeAutomationRequest({ ...f.request, targetPath: "textures/not-used.dds" }, f.context(cache));
      const stats = cache.stats(); await cache.close(); return { readTables, stats };
    };
    const cached = await run();
    expect(cached.readTables.some((file) => file.includes("main_units_tables"))).toBe(false);
    expect(cached.stats.visuals.catalogHits).toBe(3);
    const writeGui = (entry: unknown, version = VISUALS_DATA_CACHE_VERSION) => writeFileSync(f.guiPath,
      zstdCompressSync(Buffer.from(JSON.stringify({ version, entries: { [f.units]: entry } }))));
    writeGui({ ...f.entry, tables: { ...f.entry.tables, schemaHash: "different" } });
    expect((await run()).readTables.some((file) => file.includes("main_units_tables"))).toBe(true);
    writeGui(f.entry, VISUALS_DATA_CACHE_VERSION - 1);
    expect((await run()).stats.visuals.catalogHits).toBe(0);
    writeGui({ ...f.entry, identity: { ...f.entry.identity, mtimeMs: 0 } });
    expect((await run()).stats.visuals.catalogHits).toBe(0);
    writeGui({ ...f.entry, tables: { ...f.entry.tables, contribution: { ...f.entry.tables.contribution, mainUnitLinks: [] } } });
    expect((await run()).readTables.some((file) => file.includes("main_units_tables"))).toBe(true);
    writeGui(f.entry);
    const old = statSync(f.units); utimesSync(f.units, old.atime, old.mtime);
    expect((await run()).stats.visuals.catalogHits).toBe(0);
  });

  it("invalidates only changed pack metadata and resolves current load order", async () => {
    const f = await fixture(); const first = f.service();
    await executeAutomationRequest(f.request, f.context(first)); await first.close();
    const override = path.join(f.root, "override.pack");
    await writeRawPack(override, [{ name: model, buffer: rigid("textures/b.dds") }, { name: "textures/b.dds", buffer: Buffer.from("b") }], metadata);
    const next = f.service();
    const overridden = { ...f.request, packPaths: [f.assets, override] };
    expect(await executeAutomationRequest(overridden, f.context(next))).toEqual(await executeAutomationRequest(overridden, f.context()));
    expect(next.stats().visuals.referenceHits).toBeGreaterThan(0);
    expect(next.stats().visuals.sourceParses).toBe(1);
    const before = next.stats().visuals.sourceParses;
    expect(await executeAutomationRequest({ ...f.request, packPaths: [override, f.assets] }, f.context(next)))
      .toEqual(await executeAutomationRequest({ ...f.request, packPaths: [override, f.assets] }, f.context()));
    expect(next.stats().visuals.sourceParses).toBe(before);
    await next.close();
    // Replacing one mod invalidates its whole segment even with preserved size and mtime.
    const old = statSync(override);
    await writeRawPack(override, [{ name: model, buffer: rigid("textures/c.dds") }, { name: "textures/c.dds", buffer: Buffer.from("c") }], metadata);
    utimesSync(override, old.atime, old.mtime);
    const changed = f.service(); await executeAutomationRequest(overridden, f.context(changed));
    expect(changed.stats().visuals).toMatchObject({ sourceParses: 1 });
    expect(changed.stats().visuals.referenceHits).toBeGreaterThan(0); await changed.close();
  });

  it("falls back from corrupt cache data and denied persistence without changing results", async () => {
    const f = await fixture(); const plain = await executeAutomationRequest(f.request, f.context());
    const cold = f.service(); await executeAutomationRequest(f.request, f.context(cold)); await cold.close();
    const directory = path.join(f.cacheDir, "headless", "visuals", "references");
    for (const name of readdirSync(directory)) writeFileSync(path.join(directory, name), "corrupt");
    const corrupt = f.service();
    expect(await executeAutomationRequest(f.request, f.context(corrupt))).toEqual(plain);
    expect(corrupt.stats().visuals.sourceParses).toBe(2); await corrupt.close();
    const denied = f.service({ cacheDir: path.join(f.root, "denied") });
    expect(await executeAutomationRequest(f.request, f.context(denied, []))).toEqual(plain);
    expect(denied.stats().visuals.persistentWrites).toBe(0); await denied.close();
  });

  it("reuses raw references in affected diffs while comparing fresh before/after sources", async () => {
    const f = await fixture(); const before = path.join(f.root, "before.pack"); const after = path.join(f.root, "after.pack");
    await writeRawPack(before, [{ name: texture, buffer: Buffer.from("before") }], metadata);
    await writeRawPack(after, [{ name: texture, buffer: Buffer.from("after") }], metadata);
    const request = { operation: "pack_diff", beforePath: before, afterPath: after, packPaths: [f.units, f.assets], affectedUnits: true };
    const cache = f.service(); const result = await executeAutomationRequest(request, f.context(cache));
    expect(result).toEqual(await executeAutomationRequest(request, f.context()));
    expect(result).toMatchObject({ ok: true, data: { affectedUnits: { total: 1 } } });
    expect(cache.stats().visuals.sourceParses).toBe(2);
    expect(cache.stats().visuals.referenceHits).toBeGreaterThan(0); await cache.close();
  });

  it("distinguishes unsupported source coverage from exhausted traversal budgets", async () => {
    const f = await fixture();
    const bad = path.join(f.root, "malformed.pack"), before = path.join(f.root, "before.pack"), after = path.join(f.root, "after.pack");
    await writeRawPack(bad, [{ name: "broken.wsmodel", buffer: Buffer.from("<broken>") }], metadata);
    await writeRawPack(before, [{ name: texture, buffer: Buffer.from("before") }], metadata);
    await writeRawPack(after, [{ name: texture, buffer: Buffer.from("after") }], metadata);
    const result = await executeAutomationRequest({ operation: "pack_diff", beforePath: before, afterPath: after,
      packPaths: [f.units, f.assets, bad], affectedUnits: true }, f.context());
    expect(result).toMatchObject({ ok: true, data: { affectedUnits: { total: 1, complete: false,
      analysis: { before: { graph: { hitLimit: false } }, after: { graph: { hitLimit: false } } },
    } } });
  });

  it("honors lower payload limits and the retained-memory budget on warm caches", async () => {
    const f = await fixture(); const cold = f.service();
    await executeAutomationRequest(f.request, f.context(cold)); await cold.close();
    const limited = f.service({ memoryMiB: 1 });
    const context = createAutomationContext({ cache: limited, schemaProvider: async () => schemas,
      readRoots: [f.root], writeRoots: [f.root], maxLogicalPayloadBytes: 512 });
    const plain = createAutomationContext({ schemaProvider: async () => schemas, maxLogicalPayloadBytes: 512 });
    expect(await executeAutomationRequest(f.request, context)).toEqual(await executeAutomationRequest(f.request, plain));
    expect(limited.stats().visuals.sourceParses).toBeGreaterThan(0);
    expect(limited.stats().retainedBytes).toBeLessThanOrEqual(1024 * 1024); await limited.close();
  });

  it("rejects a source change after a cached hit before returning the request result", async () => {
    const f = await fixture(); const cold = f.service();
    await executeAutomationRequest(f.request, f.context(cold)); await cold.close();
    const warm = f.service(); const begin = warm.beginRequest.bind(warm); let changed = false;
    vi.spyOn(warm, "beginRequest").mockImplementation((options) => {
      const scope = begin(options); const original = scope.getVisualReference.bind(scope);
      scope.getVisualReference = async (...args) => {
        const result = await original(...args);
        if (!changed) { changed = true; const info = statSync(f.assets); utimesSync(f.assets, info.atime, new Date(info.mtimeMs + 1000)); }
        return result;
      };
      return scope;
    });
    expect(await executeAutomationRequest(f.request, f.context(warm))).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await warm.close();
  });

  it("does not overwrite an input pack when a cache destination aliases it", async () => {
    const f = await fixture(); const original = readFileSync(f.assets);
    const directory = path.join(f.cacheDir, "headless", "visuals", "references"); mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `${createHash("sha256").update(canonicalizeExistingPath(f.assets)).digest("hex")}.bin`);
    linkSync(f.assets, target);
    const plain = await executeAutomationRequest(f.request, f.context()); const cache = f.service();
    expect(await executeAutomationRequest(f.request, f.context(cache))).toEqual(plain);
    expect(readFileSync(f.assets)).toEqual(original); expect(cache.stats().visuals.persistentWrites).toBe(0);
    await cache.close();
  });

  it("keeps sparse visual maps while resolving explicit unrelated paths accurately", async () => {
    const f = await fixture();
    await writeRawPack(f.assets, [...f.assetEntries(), ...Array.from({ length: 100 }, (_, index) => ({
      name: `scripts\\unused_${index}.lua`, buffer: Buffer.from("script"),
    }))], metadata);
    const environment = await prepareReferenceEnvironment(f.context(), [f.units, f.assets], [], undefined, false, true);
    expect(environment.assetCandidates.has("scripts\\unused_50.lua")).toBe(false);
    expect(environment.assetCandidates.size).toBeLessThan(20);
    const result = resolveReferenceAsset(environment, "scripts/unused_50.lua");
    expect(result.status).toBe("found"); expect(result.winner?.provider.pack.path).toBe(f.assets);
    expect(environment.assetCandidates.has("scripts\\unused_50.lua")).toBe(true);
  });

  it("reuses compressed GUI table catalogs and preserves nullable-key ambiguity", async () => {
    for (const duplicateGeneric of [false, true]) {
      const f = await fixture({ compressedTables: true, nullableFaction: true, duplicateGeneric });
      const cache = f.service(); const tables: string[] = []; const begin = cache.beginRequest.bind(cache);
      vi.spyOn(cache, "beginRequest").mockImplementation((options) => {
        const scope = begin(options); const read = scope.getReadonlyTable.bind(scope);
        scope.getReadonlyTable = (pack, file) => { tables.push(file); return read(pack, file); }; return scope;
      });
      const request = { ...f.request, targetPath: "textures/not-used.dds" };
      expect(await executeAutomationRequest(request, f.context(cache))).toEqual(await executeAutomationRequest(request, f.context()));
      expect(cache.stats().visuals.catalogHits).toBe(3);
      expect(tables.some((file) => file.includes("main_units_tables"))).toBe(false);
      expect(tables.some((file) => file.includes("unit_variants_tables"))).toBe(duplicateGeneric);
      await cache.close();
    }
  });

  it("opens only LOC-contributing vanilla packs when hydrating matched units", async () => {
    const f = await fixture(); const locPack = path.join(f.root, "loc.pack");
    await writeRawPack(locPack, [{ name: "text\\units.loc", buffer: serializeDbTable(LocVersion,
      [makeRowFields(LocVersion, { key: "land_units_onscreen_name_land", text: "Unit", tooltip: false })],
      { preamble: Buffer.from([255, 254, 76, 79, 67, 0, 1, 0, 0, 0]) }) }], metadata);
    const cache = f.service(); const begin = cache.beginRequest.bind(cache); const seen: string[][] = [];
    vi.spyOn(cache, "beginRequest").mockImplementation((options) => {
      const scope = begin(options); const read = scope.getVanillaRawLoc.bind(scope);
      scope.getVanillaRawLoc = (paths, order) => { seen.push([...paths]); return read(paths, order); }; return scope;
    });
    const request = { ...f.request, packPaths: [], vanillaPackPaths: [f.assets, locPack] };
    expect(await executeAutomationRequest(request, f.context(cache)))
      .toMatchObject({ ok: true, data: { users: [{ unitKey: "unit", localizedName: "Unit" }] } });
    expect(seen).toEqual([[locPack]]); await cache.close();
  });

  it("shares fresh indexes within a diff scope without retaining them across requests", async () => {
    const f = await fixture(); const cache = f.service();
    const scope = cache.beginRequest({ policy: f.context().policy, useIndexCache: false, useTypedCache: false });
    const first = await scope.readPackIndex(f.assets);
    expect(await scope.readPackIndex(f.assets)).toBe(first);
    expect(cache.stats().entries.packIndexes).toBe(0);
    scope.close();
    const next = cache.beginRequest({ policy: f.context().policy, useIndexCache: false, useTypedCache: false });
    expect(await next.readPackIndex(f.assets)).not.toBe(first);
    const old = statSync(f.assets); utimesSync(f.assets, old.atime, new Date(old.mtimeMs + 1000));
    await expect(next.readPackIndex(f.assets)).rejects.toMatchObject({ code: "CONFLICT" });
    next.close(); await cache.close();
  });
});
