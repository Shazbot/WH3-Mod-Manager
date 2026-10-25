import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { dbPreambleMarkers, serializeDbTable, writeRawPack } from "../../src/packCore";
import type { DBField, DBVersion, Field } from "../../src/packFileTypes";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "whmm-materials-"));
const metadata = () => ({
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
  dependencies: [] as string[],
});

const rmv2 = (texturePath: string): Buffer => {
  const material = Buffer.alloc(860 + 260);
  material.writeUInt16LE(0, 0); // Static vertex format
  material.write("part0", 2, "utf8");
  material.writeUInt32LE(1, 716); // one embedded texture
  material.writeInt32LE(0, 860); // Diffuse slot
  material.write(texturePath, 864, "utf8");

  const vertexOffset = 80 + material.length;
  const vertexBytes = Buffer.alloc(3 * 32);
  for (let index = 0; index < 3; index++) {
    const base = index * 32;
    vertexBytes.writeUInt16LE(0x3c00, base); // finite half position
    vertexBytes.writeUInt16LE(0x3c00, base + 8); // UV0
    vertexBytes.writeUInt16LE(0x3c00, base + 12);
  }
  const indexBytes = Buffer.alloc(6);
  indexBytes.writeUInt16LE(0, 0);
  indexBytes.writeUInt16LE(1, 2);
  indexBytes.writeUInt16LE(2, 4);
  const section = Buffer.alloc(vertexOffset + vertexBytes.length + indexBytes.length);
  section.writeUInt16LE(70, 0); // weighted_skin
  section.writeUInt32LE(section.length, 4);
  section.writeUInt32LE(vertexOffset, 8);
  section.writeUInt32LE(3, 12);
  section.writeUInt32LE(vertexOffset + vertexBytes.length, 16);
  section.writeUInt32LE(3, 20);
  section.writeFloatLE(-1, 24);
  section.writeFloatLE(-1, 28);
  section.writeFloatLE(-1, 32);
  section.writeFloatLE(1, 36);
  section.writeFloatLE(1, 40);
  section.writeFloatLE(1, 44);
  material.copy(section, 80);
  vertexBytes.copy(section, vertexOffset);
  indexBytes.copy(section, vertexOffset + vertexBytes.length);

  const file = Buffer.alloc(140 + 28 + section.length);
  file.write("RMV2", 0, "ascii");
  file.writeUInt32LE(8, 4);
  file.writeUInt32LE(1, 8);
  file.write("skeleton", 12, "utf8");
  file.writeUInt32LE(1, 140);
  file.writeUInt32LE(vertexBytes.length, 144);
  file.writeUInt32LE(indexBytes.length, 148);
  file.writeUInt32LE(168, 152);
  file.writeFloatLE(0, 156);
  file.writeUInt32LE(0, 160);
  file.writeUInt8(0, 164);
  section.copy(file, 168);
  return file;
};

const expectData = <T>(response: Awaited<ReturnType<typeof executeAutomationRequest>>): T => {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.data as T;
};

const dbField = (name: string, isKey = false): DBField => ({
  name,
  field_type: "StringU8",
  is_key: isKey,
  default_value: "",
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});
const stringCell = (value: string): Field[] => [
  { type: "Int16", val: Buffer.byteLength(value, "utf8") },
  { type: "String", val: value },
];
const dbTable = (schema: DBVersion, rows: Array<Record<string, string>>) => {
  const version = Buffer.alloc(4);
  version.writeInt32LE(schema.version);
  const preamble = Buffer.concat([dbPreambleMarkers.version, version, Buffer.from([1])]);
  const encoded = rows.map((row) => schema.fields.map((field) => stringCell(row[field.name] ?? "")));
  return serializeDbTable(schema, encoded, { preamble });
};

describe("loader-aware RMV2 material tracing", () => {
  afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

  it("keeps direct embedded and WS declared materials separate for one same-named geometry, and preserves conditional loader branches", async () => {
    const packPath = path.join(tempRoot, "materials-mixed.pack");
    const modelPath = "models\\pair.rigid_model_v2";
    const wsPath = "variantmeshes\\via.wsmodel";
    const directPath = "variantmeshes\\direct.variantmeshdefinition";
    const materialPath = "materials\\via.xml.material";
    const stale = "textures\\old_embedded.dds";
    const wsTexture = "textures\\declared.dds";
    await writeRawPack(
      packPath,
      [
        { name: modelPath, buffer: rmv2(stale) },
        {
          name: directPath,
          buffer: Buffer.from(
            `<root><SLOT><VARIANT_MESH_REFERENCE>${modelPath}</VARIANT_MESH_REFERENCE><VARIANT_MESH_REFERENCE>${modelPath}</VARIANT_MESH_REFERENCE></SLOT></root>`,
          ),
        },
        {
          name: wsPath,
          buffer: Buffer.from(
            `<model><geometry>${modelPath}</geometry><materials><material lod_index="0" part_index="0">${materialPath}</material></materials></model>`,
          ),
        },
        {
          name: materialPath,
          buffer: Buffer.from(
            `<material><name>skin_alpha_on</name><shader>shaders\\skin.xml</shader><textures><texture><slot>t_xml_base_colour</slot><source>${wsTexture}</source></texture><texture><slot>t_xml_dither</slot><source>${wsTexture}</source></texture></textures><params><param><name>roughness</name><type>float</type><value>0.5</value></param></params></material>`,
          ),
        },
        { name: wsTexture, buffer: Buffer.from("dds") },
      ],
      metadata(),
    );

    const response = await executeAutomationRequest(
      {
        operation: "asset_materials",
        packPaths: [packPath],
        assetPaths: [directPath, wsPath],
      },
      createAutomationContext(),
    );
    const result = expectData<{ complete: boolean; items: Array<Record<string, unknown>> }>(response);
    expect(result.items).toHaveLength(3);
    const direct = result.items.filter((item) => item.loadMode === "direct");
    const wsmodel = result.items.find((item) => item.loadMode === "wsmodel");
    expect(direct).toHaveLength(2);
    expect(direct.every((item) => item.partComplete === false)).toBe(true);
    expect(direct.map((item) => item.conditional)).toEqual([
      [expect.objectContaining({ choiceIndex: 0 })],
      [expect.objectContaining({ choiceIndex: 1 })],
    ]);
    expect(wsmodel?.partComplete).toBe(true);
    expect(wsmodel?.embeddedTextures).toEqual([
      expect.objectContaining({ path: stale, resolution: expect.objectContaining({ status: "missing" }) }),
    ]);
    expect(wsmodel?.effectiveTextures).toEqual([
      expect.objectContaining({
        slotName: "t_xml_base_colour",
        path: wsTexture,
        resolution: expect.objectContaining({ status: "found" }),
      }),
      expect.objectContaining({
        slotName: "t_xml_dither",
        typeId: null,
        recognized: false,
        path: wsTexture,
        resolution: expect.objectContaining({ status: "found" }),
      }),
    ]);
    expect(wsmodel?.materialSource).toEqual(
      expect.objectContaining({ kind: "wsmodel", name: "skin_alpha_on", shaderPath: "shaders\\skin.xml" }),
    );
    expect(result.complete).toBe(false); // Direct loading uses the unresolved embedded slot.

    const graph = expectData<{
      edgePage: { items: Array<Record<string, unknown>> };
      nodePage: { items: Array<Record<string, unknown>> };
    }>(
      await executeAutomationRequest({
        operation: "asset_resolve_references",
        packPaths: [packPath],
        roots: [directPath, wsPath],
      }),
    );
    const targetNode = graph.nodePage.items.find((node) => node.path === modelPath);
    expect(targetNode?.loadModes).toEqual(["direct", "wsmodel"]);
    const bindings = graph.edgePage.items.filter((edge) => edge.target === targetNode?.id && edge.loadMode);
    expect(bindings.map((edge) => edge.loadMode)).toEqual(["direct", "direct", "wsmodel"]);
    expect(graph.edgePage.items).toContainEqual(
      expect.objectContaining({
        relationship: "embedded-texture",
        lodIndex: 0,
        partIndex: 0,
        textureSlotIndex: 0,
        textureTypeId: 0,
        legacy: true,
      }),
    );

    const reverse = expectData<{
      coverage: { loaderCounts: { direct: number; wsmodel: number } };
      references: { items: Array<{ loadMode?: string }> };
    }>(
      await executeAutomationRequest({
        operation: "asset_find_references",
        packPaths: [packPath],
        targetPath: modelPath,
      }),
    );
    expect(reverse.coverage.loaderCounts).toEqual({ direct: 2, wsmodel: 1 });
    expect(reverse.references.items.map((edge) => edge.loadMode)).toEqual(["direct", "direct", "wsmodel"]);

    const bounded = expectData<{ complete: boolean; total: number; diagnostics: Array<{ code: string }> }>(
      await executeAutomationRequest({
        operation: "asset_materials",
        packPaths: [packPath],
        assetPaths: [directPath],
        maxBindings: 1,
      }),
    );
    expect(bounded.total).toBe(1);
    expect(bounded.complete).toBe(false);
    expect(bounded.diagnostics).toContainEqual(expect.objectContaining({ code: "ASSET_MATERIALS_BINDING_LIMIT" }));
  });

  it("does not traverse unused embedded textures when building the asset material loader graph", async () => {
    const packPath = path.join(tempRoot, "materials-ws-only.pack");
    const modelPath = "models\\ws-only.rigid_model_v2";
    const wsPath = "variantmeshes\\ws-only.wsmodel";
    const materialPath = "materials\\valid.xml.material";
    const texturePath = "textures\\valid.dds";
    await writeRawPack(
      packPath,
      [
        { name: modelPath, buffer: rmv2("textures\\missing-obsolete.dds") },
        {
          name: wsPath,
          buffer: Buffer.from(
            `<model><geometry>${modelPath}</geometry><materials><material lod_index="0" part_index="0">${materialPath}</material></materials></model>`,
          ),
        },
        {
          name: materialPath,
          buffer: Buffer.from(
            `<material><name>regular</name><textures><texture><slot>diffuse</slot><source>${texturePath}</source></texture></textures></material>`,
          ),
        },
        { name: texturePath, buffer: Buffer.from("dds") },
      ],
      metadata(),
    );
    const result = expectData<{ complete: boolean; items: Array<Record<string, unknown>> }>(
      await executeAutomationRequest({
        operation: "asset_materials",
        packPaths: [packPath],
        assetPaths: [wsPath],
      }),
    );
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ loadMode: "wsmodel", partComplete: true });
  });

  it("marks reached WS documents with missing or duplicate geometry incomplete even without resolved model nodes", async () => {
    const wsPath = "variantmeshes\\invalid.wsmodel";
    const missingPath = path.join(tempRoot, "materials-missing-ws-geometry.pack");
    await writeRawPack(missingPath, [{ name: wsPath, buffer: Buffer.from("<model><materials/></model>") }], metadata());
    const missing = expectData<{ complete: boolean; total: number; diagnostics: Array<{ code: string }> }>(
      await executeAutomationRequest({
        operation: "asset_materials",
        packPaths: [missingPath],
        assetPaths: [wsPath],
      }),
    );
    expect(missing.total).toBe(0);
    expect(missing.complete).toBe(false);
    expect(missing.diagnostics.filter((item) => item.code === "INVALID_WSMODEL_GEOMETRY")).toHaveLength(1);

    const duplicatePath = path.join(tempRoot, "materials-duplicate-ws-geometry.pack");
    await writeRawPack(
      duplicatePath,
      [
        {
          name: wsPath,
          buffer: Buffer.from(
            "<model><geometry>models\\first.rigid_model_v2</geometry><geometry>models\\second.rigid_model_v2</geometry><materials/></model>",
          ),
        },
      ],
      metadata(),
    );
    const duplicate = expectData<{ complete: boolean; diagnostics: Array<{ code: string }> }>(
      await executeAutomationRequest({
        operation: "asset_materials",
        packPaths: [duplicatePath],
        assetPaths: [wsPath],
      }),
    );
    expect(duplicate.complete).toBe(false);
    expect(duplicate.diagnostics.filter((item) => item.code === "INVALID_WSMODEL_GEOMETRY")).toHaveLength(1);
  });

  it("uses unit resolution for visual roots and keeps one loader context per selected asset", async () => {
    const packPath = path.join(tempRoot, "materials-unit.pack");
    const mainSchema: DBVersion = { version: 0, fields: [dbField("unit", true), dbField("land_unit")] };
    const landSchema: DBVersion = {
      version: 0,
      fields: [dbField("key", true), dbField("category"), dbField("mount"), dbField("engine"), dbField("class")],
    };
    const unitVariantSchema: DBVersion = {
      version: 0,
      fields: [dbField("unit"), dbField("faction"), dbField("variant"), dbField("name"), dbField("unit_card")],
    };
    const variantSchema: DBVersion = {
      version: 0,
      fields: [dbField("variant_name", true), dbField("variant_filename")],
    };
    const schemas = {
      main_units_tables: [mainSchema],
      land_units_tables: [landSchema],
      unit_variants_tables: [unitVariantSchema],
      variants_tables: [variantSchema],
    };
    const vmdPath = "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition";
    await writeRawPack(
      packPath,
      [
        {
          name: "db\\main_units_tables\\data",
          buffer: dbTable(mainSchema, [{ unit: "unit_test", land_unit: "land_test" }]),
        },
        {
          name: "db\\land_units_tables\\data",
          buffer: dbTable(landSchema, [
            { key: "land_test", category: "inf_melee", mount: ".", engine: ".", class: "infantry" },
          ]),
        },
        {
          name: "db\\unit_variants_tables\\data",
          buffer: dbTable(unitVariantSchema, [
            { unit: "land_test", faction: "", variant: "variant_test", name: "", unit_card: "" },
          ]),
        },
        {
          name: "db\\variants_tables\\data",
          buffer: dbTable(variantSchema, [{ variant_name: "variant_test", variant_filename: "unit" }]),
        },
        { name: vmdPath, buffer: Buffer.from(`<root><model>models\\unit.rigid_model_v2</model></root>`) },
        { name: "models\\unit.rigid_model_v2", buffer: rmv2("textures\\unit.dds") },
        { name: "textures\\unit.dds", buffer: Buffer.from("dds") },
      ],
      metadata(),
    );
    const result = expectData<{ complete: boolean; total: number; items: Array<Record<string, unknown>> }>(
      await executeAutomationRequest(
        {
          operation: "asset_materials",
          packPaths: [packPath],
          unitKey: "unit_test",
        },
        createAutomationContext({ schemaProvider: async () => schemas }),
      ),
    );
    expect(result.total).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.items[0]).toMatchObject({ root: vmdPath, loadMode: "direct" });
    const rootContext = result.items[0].rootContext as { kind: string; unitKey: string; links: unknown[] };
    expect(rootContext).toMatchObject({ kind: "unit", unitKey: "unit_test" });
    expect(rootContext.links).toContainEqual(
      expect.objectContaining({ source: "unit_variants", sourceField: "variant" }),
    );

    const missingLandPack = path.join(tempRoot, "materials-unit-missing-land.pack");
    await writeRawPack(
      missingLandPack,
      [
        {
          name: "db\\main_units_tables\\data",
          buffer: dbTable(mainSchema, [{ unit: "unit_test", land_unit: "land_test" }]),
        },
        { name: "db\\unit_variants_tables\\data", buffer: dbTable(unitVariantSchema, []) },
      ],
      metadata(),
    );
    const missingLand = expectData<{ complete: boolean; diagnostics: Array<{ code: string }> }>(
      await executeAutomationRequest(
        { operation: "asset_materials", packPaths: [missingLandPack], unitKey: "unit_test" },
        createAutomationContext({ schemaProvider: async () => schemas }),
      ),
    );
    expect(missingLand.complete).toBe(false);
    expect(missingLand.diagnostics).toContainEqual(expect.objectContaining({ code: "MISSING_LAND_UNIT" }));

    const noVisualPack = path.join(tempRoot, "materials-unit-no-visual.pack");
    await writeRawPack(
      noVisualPack,
      [
        {
          name: "db\\main_units_tables\\data",
          buffer: dbTable(mainSchema, [{ unit: "unit_test", land_unit: "land_test" }]),
        },
        {
          name: "db\\land_units_tables\\data",
          buffer: dbTable(landSchema, [
            { key: "land_test", category: "inf_melee", mount: ".", engine: ".", class: "infantry" },
          ]),
        },
        { name: "db\\unit_variants_tables\\data", buffer: dbTable(unitVariantSchema, []) },
      ],
      metadata(),
    );
    const noVisuals = expectData<{ complete: boolean; diagnostics: Array<{ code: string }> }>(
      await executeAutomationRequest(
        { operation: "asset_materials", packPaths: [noVisualPack], unitKey: "unit_test" },
        createAutomationContext({ schemaProvider: async () => schemas }),
      ),
    );
    expect(noVisuals.complete).toBe(false);
    expect(noVisuals.diagnostics).toContainEqual(expect.objectContaining({ code: "UNIT_VISUAL_ROOTS_MISSING" }));
  });

  it("rejects texture files as material loader roots", async () => {
    const packPath = path.join(tempRoot, "materials-invalid-root.pack");
    await writeRawPack(packPath, [{ name: "textures\\surface.dds", buffer: Buffer.from("dds") }], metadata());
    const result = await executeAutomationRequest({
      operation: "asset_materials",
      packPaths: [packPath],
      assetPaths: ["textures\\surface.dds"],
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it("treats a battlefield engine model filename as a direct asset even when the schema marks it as a DB reference", async () => {
    const packPath = path.join(tempRoot, "materials-engine-direct.pack");
    const modelPath = "models\\engine.rigid_model_v2";
    const engineSchema: DBVersion = {
      version: 0,
      fields: [dbField("key", true), { ...dbField("model"), is_reference: ["warscape_animated_tables", "key"] }],
    };
    await writeRawPack(
      packPath,
      [
        {
          name: "db\\battlefield_engines_tables\\data",
          buffer: dbTable(engineSchema, [{ key: "engine_test", model: modelPath }]),
        },
        { name: modelPath, buffer: rmv2("textures\\engine.dds") },
        { name: "textures\\engine.dds", buffer: Buffer.from("dds") },
      ],
      metadata(),
    );
    const graph = expectData<{
      complete: boolean;
      edgePage: { items: Array<Record<string, unknown>> };
      diagnostics: Array<{ code: string }>;
    }>(
      await executeAutomationRequest(
        {
          operation: "asset_resolve_references",
          packPaths: [packPath],
          roots: [
            {
              filePath: "db\\battlefield_engines_tables\\data",
              where: [{ field: "key", op: "eq", value: "engine_test" }],
            },
          ],
        },
        createAutomationContext({ schemaProvider: async () => ({ battlefield_engines_tables: [engineSchema] }) }),
      ),
    );
    expect(graph.complete).toBe(true);
    expect(graph.edgePage.items).toContainEqual(
      expect.objectContaining({ relationship: "db-filename", sourceField: "model", loadMode: "direct" }),
    );
    expect(graph.diagnostics).not.toContainEqual(expect.objectContaining({ code: "MISSING_DB_REFERENCE" }));
  });
});
