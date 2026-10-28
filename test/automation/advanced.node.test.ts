import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createAutomationCacheService,
  createAutomationContext,
  executeAutomationRequest,
} from "../../src/automation/registry";
import { getSupportedVisualReferenceDetails } from "../../src/visuals/dependencies";
import {
  dbPreambleMarkers,
  parseDbTable,
  parseTypeBufferExact,
  readPackIndex,
  readRawPayload,
  serializeDbTable,
  serializeSchemaFieldToBuffer,
  writeRawPack,
} from "../../src/packCore";
import type { DBField, DBVersion, Field } from "../../src/packFileTypes";
import { readPackedFileIndexEntry } from "../../src/utility/packFileIndex";
import { readPfH5IndexByDependencyCount } from "../packCore/pfh5CountReader";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "whmm-advanced-"));
const metadata = (trailingBytes = Buffer.alloc(0)) => ({
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
  dependencies: [] as string[],
  trailingBytes,
});

const writePack = (fileName: string, entries: Parameters<typeof writeRawPack>[1], trailingBytes?: Buffer) =>
  writeRawPack(path.join(tempRoot, fileName), entries, metadata(trailingBytes));

const field = (
  name: string,
  field_type: DBField["field_type"],
  is_key = false,
  is_reference: string[] | null = [],
): DBField => ({
  name,
  field_type,
  is_key,
  default_value: "",
  is_filename: false,
  is_reference,
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

const keyField = (value: string): Field[] => [
  { type: "Int16", val: Buffer.byteLength(value, "utf8") },
  { type: "String", val: value },
];

const dbPreamble = (version: number) => {
  const versionBytes = Buffer.alloc(4);
  versionBytes.writeInt32LE(version);
  return Buffer.concat([dbPreambleMarkers.version, versionBytes, Buffer.from([1])]);
};

const expectData = <T>(response: Awaited<ReturnType<typeof executeAutomationRequest>>): T => {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.data as T;
};

const readPackBytes = (packPath: string, entryName: string) => {
  const pack = readPackIndex(packPath, { game: "wh3" });
  const entry = pack.entries.find((candidate) => candidate.name.toLowerCase() === entryName.toLowerCase());
  if (!entry) throw new Error(`Missing ${entryName}`);
  return readRawPayload(pack, entry);
};

describe("advanced headless pack operations", () => {
  afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

  it("keeps default file diff semantics bounded, compares detailed reference tuples, and detects same-size trailer changes", async () => {
    const beforePath = path.join(tempRoot, "diff-before.pack");
    const afterPath = path.join(tempRoot, "diff-after.pack");
    await writeRawPack(
      beforePath,
      [
        {
          name: "variantmeshes\\root.variantmeshdefinition",
          buffer: Buffer.from("<root><model>models/old.wsmodel</model></root>"),
        },
      ],
      metadata(),
    );
    await writeRawPack(
      afterPath,
      [
        {
          name: "variantmeshes\\root.variantmeshdefinition",
          buffer: Buffer.from("<root><model>models/new.wsmodel</model></root>"),
        },
      ],
      metadata(),
    );

    const summary = expectData<{ hasChanges: boolean; files: Array<{ semantic: Record<string, unknown> }> }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath,
        afterPath,
      }),
    );
    expect(summary.hasChanges).toBe(true);
    expect(summary.files[0].semantic).toMatchObject({ type: "xml-references", addedCount: 1, removedCount: 1 });
    expect(summary.files[0].semantic).not.toHaveProperty("added");

    const reportPath = path.join(tempRoot, "diff-report.json");
    const detail = expectData<{
      files: Array<{ semantic: { totalRecords: number; recordPreview: unknown[]; semanticHasMore: boolean } }>;
    }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath,
        afterPath,
        details: true,
        semanticLimit: 1,
        reportPath,
      }),
    );
    expect(detail.files[0].semantic).toMatchObject({ totalRecords: 2, semanticHasMore: true });
    expect(detail.files[0].semantic.recordPreview).toHaveLength(1);
    const fullReport = JSON.parse(readFileSync(reportPath, "utf8")) as {
      files: Array<{ semantic: { added: unknown[]; removed: unknown[] } }>;
    };
    expect(fullReport.files[0].semantic.added).toHaveLength(1);
    expect(fullReport.files[0].semantic.removed).toHaveLength(1);

    const trailerBefore = path.join(tempRoot, "trailer-before.pack");
    const trailerAfter = path.join(tempRoot, "trailer-after.pack");
    const entry = [{ name: "same.bin", buffer: Buffer.from([1, 2, 3]) }];
    await writeRawPack(trailerBefore, entry, metadata(Buffer.from([0xaa, 0xbb])));
    await writeRawPack(trailerAfter, entry, metadata(Buffer.from([0xaa, 0xcc])));
    const trailerDiff = expectData<{
      hasChanges: boolean;
      summary: { packMetadataChanged: boolean; metadata: Record<string, unknown> };
    }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath: trailerBefore,
        afterPath: trailerAfter,
      }),
    );
    expect(trailerDiff.summary.packMetadataChanged).toBe(true);
    expect(trailerDiff.summary.metadata).toHaveProperty("trailingBytes");
    expect(trailerDiff.hasChanges).toBe(true);
  });

  it("resolves mod priority, keeps cycles finite, and reports unsupported bare references", async () => {
    const lowPath = path.join(tempRoot, "low.pack");
    const highPath = path.join(tempRoot, "high.pack");
    const rootName = "variantmeshes\\root.variantmeshdefinition";
    const oldTexture = Buffer.from("low texture");
    const newTexture = Buffer.from("high texture");
    await writeRawPack(
      lowPath,
      [
        { name: rootName, buffer: Buffer.from(`<root><source>textures/shared.dds</source></root>`) },
        { name: "textures\\shared.dds", buffer: oldTexture },
      ],
      metadata(),
    );
    await writeRawPack(highPath, [{ name: "textures\\shared.dds", buffer: newTexture }], metadata());
    const context = createAutomationContext();
    const graph = expectData<{
      complete: boolean;
      nodePage: { items: Array<Record<string, unknown>> };
      edgePage: { items: unknown[] };
    }>(
      await executeAutomationRequest(
        {
          operation: "asset_resolve_references",
          packPaths: [lowPath, highPath],
          roots: [rootName],
        },
        context,
      ),
    );
    expect(graph.complete).toBe(true);
    expect(graph.edgePage.items).toHaveLength(1);
    expect(graph.nodePage.items).toContainEqual(
      expect.objectContaining({ path: "textures\\shared.dds", provider: highPath }),
    );

    const cyclePack = path.join(tempRoot, "cycle.pack");
    await writeRawPack(
      cyclePack,
      [
        {
          name: rootName,
          buffer: Buffer.from(`<root><definition>${rootName}</definition></root>`),
        },
      ],
      metadata(),
    );
    const cycle = expectData<{
      complete: boolean;
      roots: string[];
      nodePage: { total: number };
      edgePage: { total: number };
    }>(
      await executeAutomationRequest(
        {
          operation: "asset_resolve_references",
          packPaths: [cyclePack],
          roots: [rootName],
        },
        context,
      ),
    );
    expect(cycle.complete).toBe(true);
    expect(cycle.roots).toHaveLength(1);
    expect(cycle.nodePage.total).toBe(1);
    expect(cycle.edgePage.total).toBe(1);

    const unsupported = getSupportedVisualReferenceDetails(`<model><geometry>mesh.unknown</geometry></model>`);
    expect(unsupported.unsupportedReferences).toEqual([
      expect.objectContaining({ path: "mesh.unknown", sourceField: "geometry" }),
    ]);
  });

  it("finds reverse references and preserves early results when its node cap is reached", async () => {
    const packPath = path.join(tempRoot, "reverse.pack");
    const target = "textures\\painted.dds";
    await writeRawPack(
      packPath,
      [
        { name: "materials\\a.xml.material", buffer: Buffer.from(`<material><source>${target}</source></material>`) },
        { name: "materials\\b.xml.material", buffer: Buffer.from(`<material><source>${target}</source></material>`) },
        { name: target, buffer: Buffer.from("dds") },
      ],
      metadata(),
    );
    const context = createAutomationContext();
    const reverseRequest = { operation: "asset_find_references", packPaths: [packPath], targetPath: target };
    const reverseResponse = await executeAutomationRequest(reverseRequest, context);
    const full = expectData<{ references: { total: number; items: unknown[] }; complete: boolean }>(reverseResponse);
    expect(full.references.total).toBe(2);

    const cache = createAutomationCacheService();
    try {
      expect(
        await executeAutomationRequest(reverseRequest, createAutomationContext({ readRoots: [tempRoot], cache })),
      ).toEqual(reverseResponse);
    } finally {
      await cache.close();
    }

    const bounded = expectData<{ references: { items: unknown[] }; complete: boolean; coverage: { nodes: number } }>(
      await executeAutomationRequest(
        {
          operation: "asset_find_references",
          packPaths: [packPath],
          targetPath: target,
          maxNodes: 1,
        },
        context,
      ),
    );
    expect(bounded.complete).toBe(false);
    expect(bounded.coverage.nodes).toBe(1);
    expect(bounded.references.items).toEqual([]);

    const unsupportedPack = path.join(tempRoot, "reverse-unsupported.pack");
    await writeRawPack(
      unsupportedPack,
      [
        { name: "models\\unit.rigid_model_v2", buffer: Buffer.from([1]) },
        { name: "data\\opaque.unknown", buffer: Buffer.from([2]) },
      ],
      metadata(),
    );
    const unsupported = expectData<{
      complete: boolean;
      coverage: { scanScope: string; rigidFilesUnsupported: number; unsupportedFileTypes: Record<string, number> };
    }>(
      await executeAutomationRequest(
        {
          operation: "asset_find_references",
          packPaths: [unsupportedPack],
          targetPath: target,
        },
        context,
      ),
    );
    expect(unsupported.complete).toBe(false);
    expect(unsupported.coverage.scanScope).toContain("XML-backed visual assets and DB rows");
    expect(unsupported.coverage.rigidFilesUnsupported).toBe(1);
    expect(unsupported.coverage.unsupportedFileTypes).toMatchObject({ rigid_model_v2: 1, unknown: 1 });
  });

  it("uses exact DB file rows for explicit roots and strict core codecs preserve BOMs and reject invalid flags", async () => {
    const sourceSchema: DBVersion = {
      version: 9,
      fields: [field("key", "StringU8", true), field("target", "StringU8", false, ["target_tables", "key"])],
    };
    const targetSchema: DBVersion = { version: 9, fields: [field("key", "StringU8", true)] };
    const serializeRows = (schema: DBVersion, rows: Field[][][]) =>
      serializeDbTable(schema, rows, { preamble: dbPreamble(schema.version) });
    const sourceRows = (target: string): Field[][] => [keyField("shared"), keyField(target)];
    const dbPack = path.join(tempRoot, "db-root-priority.pack");
    await writeRawPack(
      dbPack,
      [
        { name: "db\\sample_tables\\abc", buffer: serializeRows(sourceSchema, [sourceRows("abc-target")]) },
        { name: "db\\sample_tables\\zzz", buffer: serializeRows(sourceSchema, [sourceRows("zzz-target")]) },
        {
          name: "db\\target_tables\\data",
          buffer: serializeRows(targetSchema, [[keyField("abc-target")], [keyField("zzz-target")]]),
        },
      ],
      metadata(),
    );
    const schemaProvider = async () => ({ sample_tables: [sourceSchema], target_tables: [targetSchema] });
    const context = createAutomationContext({ schemaProvider });
    const request = {
      operation: "asset_resolve_references",
      packPaths: [dbPack],
      roots: [{ filePath: "db\\sample_tables\\zzz", where: [{ field: "key", op: "eq", value: "shared" }] }],
    };
    const graphResponse = await executeAutomationRequest(request, context);
    const graph = expectData<{
      nodePage: { items: Array<{ id: string; path: string; key?: Record<string, unknown> }> };
      edgePage: { items: Array<{ source: string; target: string }> };
    }>(graphResponse);
    const zzzRoot = graph.nodePage.items.find((node) => node.path === "db\\sample_tables\\zzz");
    const zzzTarget = graph.nodePage.items.find((node) => node.key?.key === "zzz-target");
    expect(zzzRoot).toBeDefined();
    expect(zzzTarget).toBeDefined();
    expect(graph.edgePage.items).toContainEqual(
      expect.objectContaining({ source: zzzRoot?.id, target: zzzTarget?.id }),
    );

    const cache = createAutomationCacheService({ schemaFingerprint: "reference-fixture-v1" });
    const cachedContext = createAutomationContext({ schemaProvider, readRoots: [tempRoot], cache });
    try {
      expect(await executeAutomationRequest(request, cachedContext)).toEqual(graphResponse);
      expect(cache.stats().hits.typedTables).toBeGreaterThan(0);
    } finally {
      await cache.close();
    }

    const encodedBOM = Buffer.from([4, 0, 0xef, 0xbb, 0xbf, 0x41]);
    expect(parseTypeBufferExact(encodedBOM, 0, "StringU8").fields[1].val).toBe("\uFEFFA");

    const longLocText = "x".repeat(32768);
    const encodedLongU16 = Buffer.alloc(2 + longLocText.length * 2);
    encodedLongU16.writeUInt16LE(longLocText.length, 0);
    encodedLongU16.write(longLocText, 2, "utf16le");
    const decodedLongU16 = parseTypeBufferExact(encodedLongU16, 0, "StringU16", [], {
      strict: false,
      legacyGuiEncoding: true,
    });
    expect(decodedLongU16.fields[0].val).toBe(longLocText);
    expect(decodedLongU16.nextPosition).toBe(encodedLongU16.length);
    expect(serializeSchemaFieldToBuffer({ type: "StringU16", fields: decodedLongU16.fields })).toEqual(encodedLongU16);

    const malformedIndex = Buffer.concat([Buffer.alloc(4), Buffer.from([2]), Buffer.from("x\0")]);
    expect(() => readPackedFileIndexEntry(malformedIndex, 0, true, false, true)).toThrow(/compression flag 2/);
    expect(readPackedFileIndexEntry(malformedIndex, 0, true, false)?.is_compressed).toBe(false);
  });

  it("copies exact files for none, direct, and transitive XML asset closure", async () => {
    const sourcePath = path.join(tempRoot, "closure-chain.pack");
    const rootPath = "models\\root.wsmodel";
    const materialPath = "materials\\chain.xml.material";
    const texturePath = "textures\\chain.dds";
    await writeRawPack(
      sourcePath,
      [
        { name: rootPath, buffer: Buffer.from(`<model><material>${materialPath}</material></model>`) },
        { name: materialPath, buffer: Buffer.from(`<material><source>${texturePath}</source></material>`) },
        { name: texturePath, buffer: Buffer.from("chain texture") },
      ],
      metadata(),
    );

    for (const [closure, expected] of [
      ["none", [rootPath]],
      ["direct", [rootPath, materialPath]],
      ["transitive", [rootPath, materialPath, texturePath]],
    ] as const) {
      const outputPath = path.join(tempRoot, `closure-${closure}.pack`);
      const result = expectData<{ manifest: { includedFiles: { items: Array<{ path: string }> } } }>(
        await executeAutomationRequest({
          operation: "pack_subset",
          sourcePackPaths: [sourcePath],
          paths: [rootPath],
          closure,
          outputPath,
        }),
      );
      expect(result.manifest.includedFiles.items.map((item) => item.path).sort()).toEqual([...expected].sort());
      expect(
        readPackIndex(outputPath, { game: "wh3" })
          .entries.map((entry) => entry.name)
          .sort(),
      ).toEqual([...expected].sort());
    }
  });

  it("keeps vanilla dependencies external unless opted in and rejects roots shadowed outside selection sources", async () => {
    const sourcePath = path.join(tempRoot, "vanilla-source.pack");
    const vanillaPath = path.join(tempRoot, "vanilla-assets.pack");
    const rootName = "variantmeshes\\vanilla-root.variantmeshdefinition";
    const textureName = "textures\\vanilla.dds";
    await writeRawPack(
      sourcePath,
      [{ name: rootName, buffer: Buffer.from(`<root><source>${textureName}</source></root>`) }],
      metadata(),
    );
    await writeRawPack(vanillaPath, [{ name: textureName, buffer: Buffer.from("vanilla texture") }], metadata());

    for (const [mode, includeVanilla, expectedPaths, expectedContained] of [
      ["external", false, [rootName], false],
      ["selfContained", false, [rootName], false],
      ["selfContained", true, [rootName, textureName], true],
    ] as const) {
      const outputPath = path.join(tempRoot, `vanilla-${mode}-${includeVanilla}.pack`);
      const result = expectData<{
        selfContained: boolean;
        manifest: { externalDependencies: { items: Array<{ path: string }> } };
      }>(
        await executeAutomationRequest({
          operation: "pack_subset",
          sourcePackPaths: [sourcePath],
          vanillaPackPaths: [vanillaPath],
          paths: [rootName],
          closure: "transitive",
          mode,
          includeVanilla,
          ...(includeVanilla ? { strict: true } : {}),
          outputPath,
        }),
      );
      expect(
        readPackIndex(outputPath, { game: "wh3" })
          .entries.map((entry) => entry.name)
          .sort(),
      ).toEqual([...expectedPaths].sort());
      expect(result.selfContained).toBe(expectedContained);
      if (!includeVanilla)
        expect(result.manifest.externalDependencies.items).toContainEqual(
          expect.objectContaining({ path: textureName }),
        );
    }

    const shadowedSource = path.join(tempRoot, "shadow-source.pack");
    const higherPriority = path.join(tempRoot, "shadow-external-mod.pack");
    const shadowName = "models\\shadow.wsmodel";
    await writeRawPack(shadowedSource, [{ name: shadowName, buffer: Buffer.from("<model />") }], metadata());
    await writeRawPack(
      higherPriority,
      [{ name: shadowName, buffer: Buffer.from("<model><source>missing.dds</source></model>") }],
      metadata(),
    );
    const shadowOutput = path.join(tempRoot, "shadow-output.pack");
    const shadowed = await executeAutomationRequest({
      operation: "pack_subset",
      sourcePackPaths: [shadowedSource],
      packPaths: [shadowedSource, higherPriority],
      paths: [shadowName],
      outputPath: shadowOutput,
    });
    expect(shadowed).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(existsSync(shadowOutput)).toBe(false);
  });

  it("uses duplicate-aware whole-row multiset diffs when a DB table has no declared keys", async () => {
    const keylessSchema: DBVersion = { version: 10, fields: [field("value", "StringU8")] };
    const packedPath = "db\\sample_tables\\data";
    const serializeValues = (values: string[]) =>
      serializeDbTable(
        keylessSchema,
        values.map((value) => [keyField(value)]),
        { preamble: dbPreamble(keylessSchema.version) },
      );
    const beforePath = path.join(tempRoot, "keyless-before.pack");
    const afterPath = path.join(tempRoot, "keyless-after.pack");
    await writeRawPack(beforePath, [{ name: packedPath, buffer: serializeValues(["A", "A"]) }], metadata());
    await writeRawPack(afterPath, [{ name: packedPath, buffer: serializeValues(["A", "B"]) }], metadata());
    const context = createAutomationContext({ schemaProvider: async () => ({ sample_tables: [keylessSchema] }) });
    const result = expectData<{
      files: Array<{
        semantic: {
          mode: string;
          addedCount: number;
          deletedCount: number;
          modifiedCount: number;
          duplicateKeys?: boolean;
          totalRecords: number;
          recordPreview: Array<{ kind: string; record: { value: string } }>;
        };
      }>;
    }>(
      await executeAutomationRequest(
        {
          operation: "pack_diff",
          beforePath,
          afterPath,
          details: true,
        },
        context,
      ),
    );
    expect(result.files[0].semantic).toMatchObject({
      mode: "whole-row-multiset",
      addedCount: 1,
      deletedCount: 1,
      modifiedCount: 0,
      totalRecords: 2,
      recordPreview: [
        { kind: "added", record: { value: "B" } },
        { kind: "deleted", record: { value: "A" } },
      ],
    });
  });

  it("creates external and self-contained subsets, selects across multiple source packs, and subsets DB rows losslessly", async () => {
    const sourcePath = path.join(tempRoot, "subset-source.pack");
    const externalPath = path.join(tempRoot, "subset-external.pack");
    const rootName = "variantmeshes\\root.variantmeshdefinition";
    await writeRawPack(
      sourcePath,
      [
        {
          name: rootName,
          buffer: Buffer.from(`<root><source>textures/external.dds</source></root>`),
        },
      ],
      metadata(Buffer.from([0xde, 0xad])),
    );
    await writeRawPack(
      externalPath,
      [{ name: "textures\\external.dds", buffer: Buffer.from("texture bytes") }],
      metadata(),
    );

    const externalOut = path.join(tempRoot, "subset-external-out.pack");
    const externalData = expectData<{
      manifest: { includedFiles: { total: number }; externalDependencies: { items: Array<{ path: string }> } };
    }>(
      await executeAutomationRequest({
        operation: "pack_subset",
        sourcePackPaths: [sourcePath],
        packPaths: [sourcePath, externalPath],
        paths: [rootName],
        closure: "transitive",
        mode: "external",
        outputPath: externalOut,
      }),
    );
    expect(externalData.manifest.includedFiles.total).toBe(1);
    expect(externalData.manifest.externalDependencies.items).toContainEqual(
      expect.objectContaining({ path: "textures\\external.dds" }),
    );
    expect(readPackIndex(externalOut, { game: "wh3" }).entries.map((entry) => entry.name)).toEqual([rootName]);
    expect(readPfH5IndexByDependencyCount(externalOut)).toEqual({
      dependencyCount: 1,
      dependencies: [path.basename(externalPath)],
      fileNames: [rootName],
    });

    const selfContainedOut = path.join(tempRoot, "subset-self-contained.pack");
    const selfContained = expectData<{ selfContained: boolean; manifest: { includedFiles: { total: number } } }>(
      await executeAutomationRequest({
        operation: "pack_subset",
        sourcePackPaths: [sourcePath],
        packPaths: [sourcePath, externalPath],
        paths: [rootName],
        closure: "transitive",
        mode: "selfContained",
        strict: true,
        outputPath: selfContainedOut,
      }),
    );
    expect(selfContained.selfContained).toBe(true);
    expect(selfContained.manifest.includedFiles.total).toBe(2);
    expect(
      readPackIndex(selfContainedOut, { game: "wh3" })
        .entries.map((entry) => entry.name)
        .sort(),
    ).toEqual([rootName, "textures\\external.dds"].sort());
    expect(readPackIndex(selfContainedOut, { game: "wh3" }).header.byteMask & 0x40).toBe(0);

    const secondSource = path.join(tempRoot, "subset-second-source.pack");
    await writeRawPack(secondSource, [{ name: "other\\only.bin", buffer: Buffer.from([4, 5]) }], metadata());
    const multiSourceOut = path.join(tempRoot, "subset-multi-source.pack");
    const multiSource = expectData<{ fileCount: number }>(
      await executeAutomationRequest({
        operation: "pack_subset",
        sourcePackPaths: [sourcePath, secondSource],
        packPaths: [sourcePath, secondSource],
        paths: [rootName, "other\\only.bin"],
        outputPath: multiSourceOut,
      }),
    );
    expect(multiSource.fileCount).toBe(2);

    const schema: DBVersion = { version: 8, fields: [field("key", "StringU8", true), field("value", "StringU8")] };
    const tablePath = "db\\sample_tables\\data";
    const preamble = dbPreamble(schema.version);
    const sourceTable = serializeDbTable(
      schema,
      [
        [keyField("alpha"), keyField("untouched-a")],
        [keyField("beta"), keyField("untouched-b")],
      ],
      { preamble },
    );
    const tablePack = path.join(tempRoot, "subset-rows.pack");
    await writeRawPack(
      tablePack,
      [{ name: tablePath, buffer: Buffer.concat([sourceTable, Buffer.from([0xcc])]) }],
      metadata(),
    );
    const rowOut = path.join(tempRoot, "subset-row-out.pack");
    const subsetCache = createAutomationCacheService({ schemaFingerprint: "subset-fixture-v1" });
    const tableContext = createAutomationContext({
      schemaProvider: async () => ({ sample_tables: [schema] }),
      cache: subsetCache,
    });
    try {
      const warmRequest = { operation: "pack_read_table", packPath: tablePack, tablePath };
      await executeAutomationRequest(warmRequest, tableContext);
      await executeAutomationRequest(warmRequest, tableContext);
      const warmTypedHits = subsetCache.stats().hits.typedTables;
      expect(warmTypedHits).toBeGreaterThan(0);
      expectData(
        await executeAutomationRequest(
          {
            operation: "pack_subset",
            sourcePackPaths: [tablePack],
            rows: [{ filePath: tablePath, where: [{ field: "key", op: "eq", value: "alpha" }] }],
            outputPath: rowOut,
          },
          tableContext,
        ),
      );
      expect(subsetCache.stats().hits.typedTables).toBe(warmTypedHits);
      const outputBytes = readPackBytes(rowOut, tablePath);
      const parsed = parseDbTable(outputBytes, schema);
      const originalParsed = parseDbTable(Buffer.concat([sourceTable, Buffer.from([0xcc])]), schema);
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.preamble.bytes).toEqual(originalParsed.preamble.bytes);
      expect(parsed.rows[0].cells[0].bytes).toEqual(originalParsed.rows[0].cells[0].bytes);
      expect(parsed.rows[0].cells[1].bytes).toEqual(originalParsed.rows[0].cells[1].bytes);
      expect(parsed.trailingBytes).toEqual(Buffer.from([0xcc]));
    } finally {
      await subsetCache.close();
    }
  });

  it("validates row selectors against the schema of an empty DB file", async () => {
    const schema: DBVersion = { version: 4, fields: [field("key", "StringU8", true)] };
    const tablePath = "db\\empty_tables\\data";
    const packPath = path.join(tempRoot, "empty-subset-table.pack");
    await writeRawPack(
      packPath,
      [
        {
          name: tablePath,
          buffer: serializeDbTable(schema, [], { preamble: dbPreamble(schema.version) }),
        },
      ],
      metadata(),
    );
    const context = createAutomationContext({ schemaProvider: async () => ({ empty_tables: [schema] }) });
    const baseRequest = {
      operation: "pack_subset",
      sourcePackPaths: [packPath],
      outputPath: path.join(tempRoot, "empty-subset-out.pack"),
    };
    expect(
      await executeAutomationRequest(
        {
          ...baseRequest,
          rows: [{ filePath: tablePath, where: [{ field: "key", op: "eq", value: "missing" }] }],
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION", message: expect.stringContaining("No rows match") } });
    expect(
      await executeAutomationRequest(
        {
          ...baseRequest,
          rows: [{ filePath: tablePath, where: [{ field: "unknown", op: "eq", value: "missing" }] }],
        },
        context,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: expect.stringContaining("Unknown table field: unknown") },
    });
  });

  it("does not publish a strict self-contained pack with unsupported rigid internals", async () => {
    const sourcePath = path.join(tempRoot, "subset-rigid-source.pack");
    const outputPath = path.join(tempRoot, "subset-rigid-output.pack");
    const rootName = "variantmeshes\\root.variantmeshdefinition";
    await writeRawPack(
      sourcePath,
      [
        { name: rootName, buffer: Buffer.from(`<root><geometry>models/unit.rigid_model_v2</geometry></root>`) },
        { name: "models\\unit.rigid_model_v2", buffer: Buffer.from([1, 2]) },
      ],
      metadata(),
    );
    const response = await executeAutomationRequest({
      operation: "pack_subset",
      sourcePackPaths: [sourcePath],
      paths: [rootName],
      closure: "transitive",
      mode: "selfContained",
      strict: true,
      outputPath,
    });
    expect(response).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(existsSync(outputPath)).toBe(false);
  });
});
