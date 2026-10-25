import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  createAutomationCacheService,
  createAutomationContext,
  executeAutomationRequest,
} from "../../src/automation/registry";
import { findRigidLoaderEdges, prepareReferenceEnvironment } from "../../src/automation/references";
import { parseRmv2, readPackIndex, readRawPayload, writeRawPack } from "../../src/packCore";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "whmm-rigid-ops-"));
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));
const metadata = () => ({
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
  dependencies: [] as string[],
});

type PartOptions = {
  name?: string;
  materialType?: number;
  textures?: Array<[number, string]>;
  alpha?: number | null;
  alphaDuplicates?: number[];
  positionShift?: number;
  uvShift?: number;
  indexValues?: [number, number, number];
};
type ModelOptions = { lods: PartOptions[][]; physicalOrder?: number[]; trailing?: Buffer };

const half = (value: number): number =>
  value === 0 ? 0 : value === 1 ? 0x3c00 : value === 2 ? 0x4000 : value === 3 ? 0x4200 : 0x3800;

const buildModel = ({ lods, physicalOrder, trailing = Buffer.from([0xe1, 0xe2, 0xe3]) }: ModelOptions): Buffer => {
  const lodHeaderSize = 28;
  const headerEnd = 140 + lodHeaderSize * lods.length;
  const headers = Buffer.alloc(headerEnd);
  headers.write("RMV2", 0, "ascii");
  headers.writeUInt32LE(8, 4);
  headers.writeUInt32LE(lods.length, 8);
  headers.write("rigid_ops_skeleton", 12, "utf8");
  const sectionsByLod = lods.map((parts) =>
    parts.map((options) => {
      const textures = options.textures ?? [
        [0, "textures\\diffuse.dds"],
        [11, "textures\\spec.dds"],
        [12, "textures\\gloss.dds"],
      ];
      const attachments = Buffer.alloc(84, 0x2a);
      const stringBytes = Buffer.alloc(11);
      stringBytes.writeInt32LE(800, 0);
      stringBytes.writeInt16LE(5, 4);
      stringBytes.write("keep!", 6, "utf8");
      const floatBytes = Buffer.alloc(8);
      floatBytes.writeInt32LE(88, 0);
      floatBytes.writeFloatLE(1.5, 4);
      const alphaValues = options.alphaDuplicates ?? (options.alpha === null ? [] : [options.alpha ?? 0]);
      const intBytes = Buffer.alloc(alphaValues.length * 8);
      alphaValues.forEach((value, index) => {
        intBytes.writeInt32LE(0, index * 8);
        intBytes.writeInt32LE(value, index * 8 + 4);
      });
      const vecBytes = Buffer.alloc(20);
      vecBytes.writeInt32LE(99, 0);
      [1, 2, 3, 4].forEach((value, index) => vecBytes.writeFloatLE(value, 4 + index * 4));
      const materialSize =
        860 +
        attachments.length +
        textures.length * 260 +
        stringBytes.length +
        floatBytes.length +
        intBytes.length +
        vecBytes.length;
      const vertexBytes = Buffer.alloc(3 * 32, 0x11);
      for (let vertex = 0; vertex < 3; vertex++) {
        const base = vertex * 32;
        vertexBytes.writeUInt16LE(half(vertex), base);
        vertexBytes.writeUInt16LE(half(options.positionShift ?? 0), base + 2);
        vertexBytes.writeUInt16LE(half(0), base + 4);
        vertexBytes.writeUInt16LE(half(1), base + 6);
        vertexBytes.writeUInt16LE(half(vertex + (options.uvShift ?? 0)), base + 8);
        vertexBytes.writeUInt16LE(half(1), base + 10);
        vertexBytes.writeUInt16LE(half(2), base + 12);
        vertexBytes.writeUInt16LE(half(3), base + 14);
      }
      const indexValues = options.indexValues ?? [0, 1, 2];
      const indexBytes = Buffer.alloc(6);
      indexValues.forEach((value, index) => indexBytes.writeUInt16LE(value, index * 2));
      const padding = Buffer.alloc(5, 0xbc);
      const vertexOffset = 80 + materialSize;
      const indexOffset = vertexOffset + vertexBytes.length;
      const sectionSize = indexOffset + indexBytes.length + padding.length;
      const section = Buffer.alloc(sectionSize);
      section.writeUInt16LE(options.materialType ?? 65, 0);
      section.writeUInt16LE(7, 2);
      section.writeUInt32LE(sectionSize, 4);
      section.writeUInt32LE(vertexOffset, 8);
      section.writeUInt32LE(3, 12);
      section.writeUInt32LE(indexOffset, 16);
      section.writeUInt32LE(3, 20);
      for (let component = 0; component < 6; component++)
        section.writeFloatLE(component < 3 ? -1 : 1, 24 + component * 4);
      const material = Buffer.alloc(materialSize);
      material.writeUInt16LE(0, 0);
      material.write(options.name ?? "body", 2, "utf8");
      material.writeUInt32LE(1, 712);
      material.writeUInt32LE(textures.length, 716);
      material.writeUInt32LE(1, 720);
      material.writeUInt32LE(1, 724);
      material.writeUInt32LE(alphaValues.length, 728);
      material.writeUInt32LE(1, 732);
      let cursor = 860;
      attachments.copy(material, cursor);
      cursor += attachments.length;
      for (const [type, texturePath] of textures) {
        material.writeInt32LE(type, cursor);
        material.write(texturePath, cursor + 4, "utf8");
        cursor += 260;
      }
      stringBytes.copy(material, cursor);
      cursor += stringBytes.length;
      floatBytes.copy(material, cursor);
      cursor += floatBytes.length;
      intBytes.copy(material, cursor);
      cursor += intBytes.length;
      vecBytes.copy(material, cursor);
      material.copy(section, 80);
      vertexBytes.copy(section, vertexOffset);
      indexBytes.copy(section, indexOffset);
      padding.copy(section, indexOffset + indexBytes.length);
      return { section, vertexBytes, indexBytes };
    }),
  );
  const order = physicalOrder ?? lods.map((_, index) => index);
  const body: Buffer[] = [Buffer.alloc(2, 0x91)];
  let position = headerEnd + 2;
  for (let lodIndex = 0; lodIndex < lods.length; lodIndex++) {
    const lodOffset = 140 + lodIndex * lodHeaderSize;
    const parts = sectionsByLod[lodIndex];
    headers.writeUInt32LE(parts.length, lodOffset);
    headers.writeUInt32LE(
      parts.reduce((sum, part) => sum + part.vertexBytes.length, 0),
      lodOffset + 4,
    );
    headers.writeUInt32LE(
      parts.reduce((sum, part) => sum + part.indexBytes.length, 0),
      lodOffset + 8,
    );
    headers.writeFloatLE(10 * (lodIndex + 1), lodOffset + 16);
    headers.writeUInt32LE(lodIndex, lodOffset + 20);
    headers.writeUInt8(lodIndex, lodOffset + 24);
  }
  order
    .filter((lodIndex) => sectionsByLod[lodIndex].length > 0)
    .forEach((lodIndex, orderIndex, nonemptyOrder) => {
      const lodOffset = 140 + lodIndex * lodHeaderSize;
      headers.writeUInt32LE(position, lodOffset + 12);
      for (const part of sectionsByLod[lodIndex]) {
        body.push(part.section);
        position += part.section.length;
      }
      if (orderIndex + 1 < nonemptyOrder.length) {
        body.push(Buffer.alloc(3, 0xa7));
        position += 3;
      }
    });
  body.push(trailing);
  return Buffer.concat([headers, ...body]);
};

const expectData = <T>(response: Awaited<ReturnType<typeof executeAutomationRequest>>): T => {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.data as T;
};

const writePack = async (fileName: string, files: Array<{ name: string; buffer: Buffer }>) => {
  const packPath = path.join(tempRoot, fileName);
  await writeRawPack(packPath, files, metadata());
  return packPath;
};

const packedModel = (packPath: string, internalPath: string) => {
  const pack = readPackIndex(packPath, { game: "wh3" });
  const entry = pack.entries.find((candidate) => candidate.name.toLowerCase() === internalPath.toLowerCase());
  if (!entry) throw new Error(`Missing ${internalPath}`);
  return parseRmv2(readRawPayload(pack, entry));
};

const textureSet = (part: ReturnType<typeof parseRmv2>["lods"][number]["parts"][number]) =>
  part.textures?.map((texture) => [texture.typeId, texture.path]);

describe("RMV2 diff, validation, and patch operations", () => {
  it("validates embedded textures against manifest packs with mods taking priority", async () => {
    const internalPath = "models\\manifest.rigid_model_v2";
    const vanilla = await writePack("base-textures.pack", [
      { name: "textures\\diffuse.dds", buffer: Buffer.from("base") },
      { name: "textures\\spec.dds", buffer: Buffer.from("base") },
      { name: "textures\\gloss.dds", buffer: Buffer.from("base") },
    ]);
    // A stray pack in data is deliberately omitted from the manifest.
    await writePack("stray-mod.pack", [{ name: "textures\\diffuse.dds", buffer: Buffer.from("stray") }]);
    writeFileSync(path.join(tempRoot, "manifest.txt"), `${path.basename(vanilla)}\t123\n`);
    const mod = await writePack("manifest-mod.pack", [{ name: internalPath, buffer: buildModel({ lods: [[{}]] }) }]);
    const missing = expectData<{ unresolvedRigidTextureCount: number }>(
      await executeAutomationRequest({ operation: "pack_validate", packPath: mod }),
    );
    expect(missing.unresolvedRigidTextureCount).toBe(3);
    const result = expectData<{
      valid: boolean;
      validationComplete: boolean;
      unresolvedRigidTextureCount: number;
      textureResolutionPacks: Array<{ path: string; kind: string }>;
    }>(
      await executeAutomationRequest({
        operation: "pack_validate",
        packPath: mod,
        withVanilla: true,
        gameDataPath: tempRoot,
      }),
    );
    expect(result).toMatchObject({ valid: true, validationComplete: true, unresolvedRigidTextureCount: 0 });
    expect(result.textureResolutionPacks).toEqual([
      { path: vanilla, kind: "vanilla" },
      { path: mod, kind: "mod" },
    ]);
    // Exercise the same discovery path through the actual CLI adapter.
    const { main } = await import("../../src/cli/main");
    const stdout: string[] = [];
    expect(
      await main(["pack", "validate", mod, "--with-vanilla", "--game-data", tempRoot, "--format", "json"], {
        stdout: (value) => stdout.push(value),
        stderr: () => undefined,
      }),
    ).toBe(0);
    expect(JSON.parse(stdout.join("")).data.unresolvedRigidTextureCount).toBe(0);
  });

  it("reports bounded semantic LOD, part, geometry, material, texture, and parameter differences", async () => {
    const internalPath = "models\\semantic.rigid_model_v2";
    const beforeModel = buildModel({ lods: [[{}]], trailing: Buffer.from([1]) });
    const afterModel = buildModel({
      lods: [
        [
          {
            positionShift: 2,
            uvShift: 1,
            indexValues: [1, 0, 2],
            textures: [
              [0, "textures\\diffuse.dds"],
              [11, "textures\\spec.dds"],
              [27, "textures\\base.dds"],
              [29, "textures\\material.dds"],
            ],
            materialType: 70,
            alpha: 1,
          },
          { name: "added_part" },
        ],
        [{}],
      ],
      physicalOrder: [1, 0],
      trailing: Buffer.from([1]),
    });
    const beforePack = await writePack("semantic-before.pack", [{ name: internalPath, buffer: beforeModel }]);
    const afterPack = await writePack("semantic-after.pack", [{ name: internalPath, buffer: afterModel }]);
    const result = expectData<{
      files: Array<{ semantic: Record<string, unknown> }>;
    }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath: beforePack,
        afterPath: afterPack,
        details: true,
        semanticLimit: 5,
      }),
    );
    const semantic = result.files[0].semantic;
    expect(semantic).toMatchObject({
      type: "rmv2",
      available: true,
      complete: true,
      lodAddedCount: 1,
      partAddedCount: 1,
      vertexChangedCount: 3,
      positionChangedCount: 3,
      uvChangedCount: 3,
      indexChangedCount: 2,
      materialChangedCount: 1,
      textureSlotChangedCount: 3,
      textureSlotAddedCount: 2,
      textureSlotRemovedCount: 1,
      addedCount: 4,
      deletedCount: 1,
      totalRecords: expect.any(Number),
      semanticHasMore: true,
    });
    const records = semantic.recordPreview as Array<{ kind: string; record: Record<string, unknown> }>;
    expect(records.slice(0, 4).every(({ kind }) => kind === "added")).toBe(true);
    expect(records[4]).toMatchObject({
      kind: "deleted",
      record: {
        kind: "textureSlot",
        typeId: 12,
        before: { path: "textures\\gloss.dds" },
        after: null,
      },
    });

    const unsupportedAfter = await writePack("semantic-unsupported-after.pack", [
      {
        name: internalPath,
        buffer: buildModel({ lods: [[{ materialType: 444 }]] }),
      },
    ]);
    const unsupportedDiff = expectData<{ files: Array<{ semantic: Record<string, unknown> }> }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath: beforePack,
        afterPath: unsupportedAfter,
        details: true,
      }),
    );
    expect(unsupportedDiff.files[0].semantic.complete).toBe(false);
  });

  it("validates RMV structure by default and resolves textures through declared load order", async () => {
    const internalPath = "models\\valid.rigid_model_v2";
    const texturePath = "textures\\shared.dds";
    const vanilla = await writePack("validate-vanilla.pack", [{ name: texturePath, buffer: Buffer.from("vanilla") }]);
    const low = await writePack("validate-low.pack", [{ name: texturePath, buffer: Buffer.from("low") }]);
    const high = await writePack("validate-high.pack", [{ name: texturePath, buffer: Buffer.from("high") }]);
    const target = await writePack("validate-target.pack", [
      { name: internalPath, buffer: buildModel({ lods: [[{ textures: [[0, texturePath]] }]] }) },
    ]);
    const valid = expectData<{
      valid: boolean;
      validationComplete: boolean;
      rigidModelCount: number;
      diagnostics: Array<{ code: string }>;
    }>(
      await executeAutomationRequest({
        operation: "pack_validate",
        packPath: target,
        vanillaPackPaths: [vanilla],
        packPaths: [low, high],
      }),
    );
    expect(valid.valid).toBe(true);
    expect(valid.validationComplete).toBe(true);
    expect(valid.rigidModelCount).toBe(1);
    expect(valid.diagnostics).not.toContainEqual(expect.objectContaining({ code: "MISSING_RMV2_TEXTURE" }));

    const duplicateOrder = expectData<{ textureResolutionPacks: Array<{ path: string; kind: string }> }>(
      await executeAutomationRequest({
        operation: "pack_validate",
        packPath: target,
        vanillaPackPaths: [vanilla],
        packPaths: [low, high, low],
      }),
    );
    expect(duplicateOrder.textureResolutionPacks.map(({ path: provider }) => provider)).toEqual([
      vanilla,
      high,
      low,
      target,
    ]);
    const highestRole = expectData<{ textureResolutionPacks: Array<{ path: string; kind: string }> }>(
      await executeAutomationRequest({
        operation: "pack_validate",
        packPath: target,
        vanillaPackPaths: [vanilla],
        packPaths: [low, high, vanilla],
      }),
    );
    expect(highestRole.textureResolutionPacks.map(({ path: provider }) => provider)).toEqual([
      low,
      high,
      vanilla,
      target,
    ]);
    expect(highestRole.textureResolutionPacks[2].kind).toBe("mod");

    const missing = await writePack("validate-missing.pack", [
      { name: internalPath, buffer: buildModel({ lods: [[{ textures: [[0, "textures\\missing.dds"]] }]] }) },
    ]);
    const missingResult = expectData<{ valid: boolean; diagnostics: Array<{ code: string; message: string }> }>(
      await executeAutomationRequest({ operation: "pack_validate", packPath: missing }),
    );
    expect(missingResult.valid).toBe(true);
    expect(missingResult.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "MISSING_RMV2_TEXTURE",
        message: expect.stringContaining("LOD 0 part 0 slot 0"),
      }),
    );

    const unsupported = Buffer.from(buildModel({ lods: [[]] }));
    unsupported.writeUInt32LE(9, 4);
    const unsupportedPath = await writePack("validate-unsupported.pack", [{ name: internalPath, buffer: unsupported }]);
    const unsupportedResult = expectData<{
      valid: boolean;
      validationComplete: boolean;
      diagnostics: Array<{ code: string }>;
    }>(await executeAutomationRequest({ operation: "pack_validate", packPath: unsupportedPath, fullPayloads: false }));
    expect(unsupportedResult.valid).toBe(true);
    expect(unsupportedResult.validationComplete).toBe(false);
    expect(unsupportedResult.diagnostics).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_RMV2_MODEL" }));

    const malformedPath = await writePack("validate-malformed.pack", [
      { name: internalPath, buffer: Buffer.from("RMV2bad") },
    ]);
    const malformed = expectData<{ valid: boolean; diagnostics: Array<{ code: string; severity: string }> }>(
      await executeAutomationRequest({ operation: "pack_validate", packPath: malformedPath }),
    );
    expect(malformed.valid).toBe(false);
    expect(malformed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_RMV2_MODEL", severity: "error" }),
    );
  });

  it("warns about WS materials only when direct and exact WS loader evidence both reach the same model", async () => {
    const modelPath = "models\\direct-and-ws.rigid_model_v2";
    const vmdPath = "variantmeshes\\direct.variantmeshdefinition";
    const wsPath = "variantmeshes\\bound.wsmodel";
    const materialPath = "materials\\bound.xml.material";
    const packPath = await writePack("validate-direct-and-ws.pack", [
      { name: modelPath, buffer: buildModel({ lods: [[{}]] }) },
      { name: vmdPath, buffer: Buffer.from(`<root><model>${modelPath}</model></root>`) },
      {
        name: wsPath,
        buffer: Buffer.from(
          `<model><geometry>${modelPath}</geometry><materials><material lod_index="0" part_index="0">${materialPath}</material></materials></model>`,
        ),
      },
      { name: materialPath, buffer: Buffer.from("<material><name>bound</name></material>") },
    ]);
    const withProof = expectData<{ diagnostics: Array<{ code: string; path?: string; message: string }> }>(
      await executeAutomationRequest({
        operation: "pack_validate",
        packPath,
      }),
    );
    expect(withProof.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IGNORED_WSMODEL_BINDING",
        path: modelPath,
        message: expect.stringContaining(`${vmdPath}`),
      }),
    );
    const cappedEnvironment = await prepareReferenceEnvironment(createAutomationContext({ readRoots: [tempRoot] }), [
      packPath,
    ]);
    const cappedScan = await findRigidLoaderEdges(cappedEnvironment, [modelPath], { maxNodes: 1, maxEdges: 1 });
    expect(cappedScan.hitLimit).toBe(true);

    const sameNameOnly = await writePack("validate-same-name-only.pack", [
      { name: modelPath, buffer: buildModel({ lods: [[{}]] }) },
      {
        name: wsPath,
        buffer: Buffer.from(
          `<model><geometry>${modelPath}</geometry><materials><material lod_index="0" part_index="0">${materialPath}</material></materials></model>`,
        ),
      },
      { name: materialPath, buffer: Buffer.from("<material><name>bound</name></material>") },
    ]);
    const noProof = expectData<{ diagnostics: Array<{ code: string }> }>(
      await executeAutomationRequest({ operation: "pack_validate", packPath: sameNameOnly }),
    );
    expect(noProof.diagnostics).not.toContainEqual(expect.objectContaining({ code: "IGNORED_WSMODEL_BINDING" }));
  });

  it("writes one MOD model, resizes texture records, and preserves geometry, attachments, gaps, padding, and trailer bytes", async () => {
    const internalPath = "models\\four-lods.rigid_model_v2";
    const originalBytes = buildModel({
      lods: [[{}], [{}], [{}], [{}]],
      physicalOrder: [2, 0, 3, 1],
      trailing: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
    });
    const packPath = await writePack("patch-source.pack", [
      { name: internalPath, buffer: originalBytes },
      { name: "textures\\keep.dds", buffer: Buffer.from("keep") },
    ]);
    const outputPath = path.join(tempRoot, "patch-output.pack");
    const original = packedModel(packPath, internalPath);
    const response = expectData<{ outputPath: string; fileCount: number; editedParts: string[] }>(
      await executeAutomationRequest({
        operation: "rigid_patch",
        packPath,
        filePath: internalPath,
        outputPath,
        edits: [
          {
            textures: [
              { type: "Gloss", path: null },
              { type: "BaseColour", path: "textures\\base_colour.dds" },
              { type: 29, path: "textures\\material_map.dds" },
            ],
            materialType: "weighted_skin",
            alphaMode: "transparent",
          },
        ],
      }),
    );
    expect(response.fileCount).toBe(1);
    const outputPack = readPackIndex(response.outputPath, { game: "wh3" });
    expect(outputPack.header.byteMask & 0x7).toBe(3);
    expect(outputPack.dependencies).toEqual([]);
    expect(outputPack.entries.map((entry) => entry.name)).toEqual([internalPath]);
    const actual = packedModel(response.outputPath, internalPath);
    const physicalOrder = (model: ReturnType<typeof parseRmv2>) =>
      [...model.lods]
        .filter((lod) => lod.meshCount)
        .sort((left, right) => left.firstMeshOffset - right.firstMeshOffset)
        .map((lod) => lod.lodIndex);
    expect(physicalOrder(actual)).toEqual(physicalOrder(original));
    expect(actual.trailing.bytes).toEqual(original.trailing.bytes);
    expect(actual.interstitial.map((span) => span.bytes)).toEqual(original.interstitial.map((span) => span.bytes));
    for (const lod of original.lods) {
      const updated = actual.lods[lod.lodIndex];
      expect(updated.distance).toBe(lod.distance);
      for (const part of lod.parts) {
        const changed = updated.parts[part.partIndex];
        expect(changed).toMatchObject({ materialTypeId: 70, alphaMode: { value: "transparent", rawValue: 1 } });
        expect(textureSet(changed)).toEqual([
          [0, "textures\\diffuse.dds"],
          [11, "textures\\spec.dds"],
          [27, "textures\\base_colour.dds"],
          [29, "textures\\material_map.dds"],
        ]);
        expect(changed.raw.vertices.bytes).toEqual(part.raw.vertices.bytes);
        expect(changed.raw.indices.bytes).toEqual(part.raw.indices.bytes);
        expect(changed.raw.sectionPadding.bytes).toEqual(part.raw.sectionPadding.bytes);
        const beforeAttachments = part.raw.material.bytes.subarray(860, 944);
        const afterAttachments = changed.raw.material.bytes.subarray(860, 944);
        expect(afterAttachments).toEqual(beforeAttachments);
      }
    }
  });

  it("rebases an empty LOD pointer at the old file end when an earlier material grows", async () => {
    const internalPath = "models\\empty-lod.rigid_model_v2";
    const originalBytes = buildModel({ lods: [[{}], [], [{}]], physicalOrder: [2, 0] });
    originalBytes.writeUInt32LE(originalBytes.length, 140 + 28 + 12);
    const packPath = await writePack("patch-empty-lod.pack", [{ name: internalPath, buffer: originalBytes }]);
    const outputPath = path.join(tempRoot, "patch-empty-lod-output.pack");
    await executeAutomationRequest({
      operation: "rigid_patch",
      packPath,
      filePath: internalPath,
      outputPath,
      edits: [
        {
          lodIndex: 0,
          textures: [
            { type: 12, path: null },
            { type: 27, path: "textures\\base.dds" },
          ],
        },
      ],
    });
    const outputPack = readPackIndex(outputPath, { game: "wh3" });
    const outputEntry = outputPack.entries.find((entry) => entry.name === internalPath)!;
    const outputBytes = readRawPayload(outputPack, outputEntry);
    expect(packedModel(outputPath, internalPath).lods[1].firstMeshOffset).toBe(outputBytes.length);
  });

  it("adds or replaces alpha values and rejects selectors, overlaps, ambiguous slots, unsafe paths, conversions, and duplicate alpha", async () => {
    const internalPath = "models\\one.rigid_model_v2";
    const packPath = await writePack("patch-rejections.pack", [
      { name: internalPath, buffer: buildModel({ lods: [[{ alpha: null }]] }) },
    ]);
    const validOutput = path.join(tempRoot, "patch-alpha-added.pack");
    await executeAutomationRequest({
      operation: "rigid_patch",
      packPath,
      filePath: internalPath,
      outputPath: validOutput,
      edits: [{ alphaMode: "opaque" }],
    });
    expect(packedModel(validOutput, internalPath).lods[0].parts[0].alphaMode).toMatchObject({
      value: "opaque",
      rawValue: 0,
    });

    const legacyAlphaPath = await writePack("patch-legacy-alpha.pack", [
      { name: internalPath, buffer: buildModel({ lods: [[{ alpha: -1 }]] }) },
    ]);
    const legacyAlphaOut = path.join(tempRoot, "patch-legacy-alpha-output.pack");
    await executeAutomationRequest({
      operation: "rigid_patch",
      packPath: legacyAlphaPath,
      filePath: internalPath,
      outputPath: legacyAlphaOut,
      edits: [{ alphaMode: "transparent" }],
    });
    expect(packedModel(legacyAlphaOut, internalPath).lods[0].parts[0].alphaMode).toMatchObject({
      value: "transparent",
      rawValue: 1,
    });

    const reject = async (suffix: string, edits: unknown) => {
      const outputPath = path.join(tempRoot, `rejected-${suffix}.pack`);
      const result = await executeAutomationRequest({
        operation: "rigid_patch",
        packPath,
        filePath: internalPath,
        outputPath,
        edits,
      });
      expect(result.ok).toBe(false);
      expect(existsSync(outputPath)).toBe(false);
    };
    await reject("selector", [{ lodIndex: 5, alphaMode: "opaque" }]);
    await reject("overlap", [{ lodIndex: 0, alphaMode: "opaque" }, { alphaMode: "transparent" }]);
    await reject("nul", [{ textures: [{ type: "Diffuse", path: "textures\\bad\0.dds" }] }]);
    await reject("surrogate", [{ textures: [{ type: "Diffuse", path: "textures\\bad\ud800.dds" }] }]);
    await reject("capacity", [{ textures: [{ type: "Diffuse", path: "x".repeat(256) }] }]);
    await reject("conversion", [{ materialType: "TerrainTiles" }]);
    await reject("duplicate-edit-slot", [
      {
        textures: [
          { type: "Diffuse", path: "a.dds" },
          { type: 0, path: "b.dds" },
        ],
      },
    ]);

    const duplicateSlotPath = await writePack("patch-ambiguous-slot.pack", [
      {
        name: internalPath,
        buffer: buildModel({
          lods: [
            [
              {
                textures: [
                  [0, "a.dds"],
                  [0, "b.dds"],
                ],
              },
            ],
          ],
        }),
      },
    ]);
    const duplicateOut = path.join(tempRoot, "rejected-ambiguous-slot.pack");
    const duplicateResult = await executeAutomationRequest({
      operation: "rigid_patch",
      packPath: duplicateSlotPath,
      filePath: internalPath,
      outputPath: duplicateOut,
      edits: [{ textures: [{ type: 0, path: "c.dds" }] }],
    });
    expect(duplicateResult).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(existsSync(duplicateOut)).toBe(false);

    const badAlphaPath = await writePack("patch-duplicate-alpha.pack", [
      { name: internalPath, buffer: buildModel({ lods: [[{ alphaDuplicates: [0, 1] }]] }) },
    ]);
    const badAlphaOut = path.join(tempRoot, "rejected-alpha.pack");
    const badAlpha = await executeAutomationRequest({
      operation: "rigid_patch",
      packPath: badAlphaPath,
      filePath: internalPath,
      outputPath: badAlphaOut,
      edits: [{ alphaMode: "transparent" }],
    });
    expect(badAlpha).toMatchObject({ ok: false, error: { code: "UNSUPPORTED" } });
    expect(existsSync(badAlphaOut)).toBe(false);
  });

  it("enforces write roots and rejects same-source output paths before publication", async () => {
    const internalPath = "models\\guarded.rigid_model_v2";
    const packPath = await writePack("patch-guarded.pack", [
      { name: internalPath, buffer: buildModel({ lods: [[{}]] }) },
    ]);
    const deniedPath = path.join(tempRoot, "denied-output.pack");
    const denied = await executeAutomationRequest(
      {
        operation: "rigid_patch",
        packPath,
        filePath: internalPath,
        outputPath: deniedPath,
        edits: [{ alphaMode: "transparent" }],
      },
      createAutomationContext({ readRoots: [tempRoot], writeRoots: [] }),
    );
    expect(denied).toMatchObject({ ok: false, error: { code: "IO_ACCESS" } });
    expect(existsSync(deniedPath)).toBe(false);
    const same = await executeAutomationRequest({
      operation: "rigid_patch",
      packPath,
      filePath: internalPath,
      outputPath: packPath,
      overwrite: true,
      edits: [{ alphaMode: "transparent" }],
    });
    expect(same).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("bypasses warm automation caches and invalidates the published patch path", async () => {
    const internalPath = "models\\cache-bypass.rigid_model_v2";
    const packPath = await writePack("patch-cache-bypass.pack", [
      { name: internalPath, buffer: buildModel({ lods: [[{}]] }) },
    ]);
    const cache = createAutomationCacheService();
    const context = createAutomationContext({ readRoots: [tempRoot], writeRoots: [tempRoot], cache });
    expect((await executeAutomationRequest({ operation: "pack_info", packPath }, context)).ok).toBe(true);
    const beginRequest = vi.spyOn(cache, "beginRequest");
    const invalidatePath = vi.spyOn(cache, "invalidatePath");
    const outputPath = path.join(tempRoot, "patch-cache-bypass-output.pack");
    const result = await executeAutomationRequest(
      {
        operation: "rigid_patch",
        packPath,
        filePath: internalPath,
        outputPath,
        edits: [{ alphaMode: "transparent" }],
      },
      context,
    );
    expect(result.ok).toBe(true);
    expect(beginRequest).not.toHaveBeenCalled();
    expect(invalidatePath).toHaveBeenCalledWith(outputPath);
  });

  it("cleans temporary patch output and preserves an existing destination when cancelled after production", async () => {
    const internalPath = "models\\cancelled.rigid_model_v2";
    const packPath = await writePack("patch-cancelled.pack", [
      { name: internalPath, buffer: buildModel({ lods: [[{}]] }) },
    ]);
    const cancelAfterProduce = (outputPath: string, overwrite = false) => {
      const controller = new AbortController();
      const context = createAutomationContext({
        readRoots: [tempRoot],
        writeRoots: [tempRoot],
        signal: controller.signal,
      });
      const policy = context.policy;
      const withAtomicOutput = policy.withAtomicOutput.bind(policy);
      policy.withAtomicOutput = (options) =>
        withAtomicOutput({
          ...options,
          produce: async (temporaryPath) => {
            await options.produce(temporaryPath);
            controller.abort();
          },
        });
      return {
        context,
        request: {
          operation: "rigid_patch",
          packPath,
          filePath: internalPath,
          outputPath,
          overwrite,
          edits: [{ alphaMode: "transparent" }],
        },
      };
    };

    const newOutput = path.join(tempRoot, "patch-cancelled-new.pack");
    const first = cancelAfterProduce(newOutput);
    const firstResult = await executeAutomationRequest(first.request, first.context);
    expect(firstResult).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    expect(existsSync(newOutput)).toBe(false);

    const existingOutput = path.join(tempRoot, "patch-cancelled-existing.pack");
    writeFileSync(existingOutput, "previous destination");
    const before = readFileSync(existingOutput);
    const second = cancelAfterProduce(existingOutput, true);
    const secondResult = await executeAutomationRequest(second.request, second.context);
    expect(secondResult).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    expect(readFileSync(existingOutput)).toEqual(before);
    expect(readdirSync(tempRoot).some((name) => name.startsWith(".patch-cancelled-") && name.endsWith(".tmp"))).toBe(
      false,
    );
  });
});
