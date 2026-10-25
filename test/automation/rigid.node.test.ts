import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { main } from "../../src/cli/main";
import { parseRmv2, Rmv2CodecError, writeRawPack } from "../../src/packCore";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "whmm-rigid-"));
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));
const packMetadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([255, 255, 255, 127]),
  dependencies: [] as string[],
};

type FixtureOptions = {
  version?: 6 | 7 | 8;
  format?: number;
  materialType?: number;
  textures?: Array<[number, string]>;
  alpha?: number[];
  invalidIndex?: boolean;
  nonFiniteUv?: boolean;
  nonFiniteNormal?: boolean;
  unsupportedMaterial?: number;
};

const halfBits = (value: number): number => {
  if (value === 0) return 0;
  if (value === 1) return 0x3c00;
  if (value === 2) return 0x4000;
  if (value === 3) return 0x4200;
  return 0x3800;
};

const makeWeightedFixture = (options: FixtureOptions = {}): Buffer => {
  const version = options.version ?? 6;
  const format = options.format ?? 3;
  const materialType = options.materialType ?? 65;
  const textures = options.textures ?? [
    [0, "diffuse.dds"],
    [11, "spec.dds"],
    [12, "gloss.dds"],
    [777, "unknown.dds"],
  ];
  const alpha = options.alpha ?? [0, 1];
  const strings: Array<[number, string]> = [
    [800, "first"],
    [800, "second"],
  ];
  const floats: Array<[number, number]> = [
    [0, 1.5],
    [901, -2.25],
  ];
  const ints: Array<[number, number]> = [...alpha.map((value) => [0, value] as [number, number]), [901, 9]];
  const vec4s: Array<[number, [number, number, number, number]]> = [[77, [1, 2, 3, 4]]];
  const stringBytes = strings.reduce((size, [, value]) => size + 6 + Buffer.byteLength(value), 0);
  const materialSize =
    860 + textures.length * 260 + stringBytes + floats.length * 8 + ints.length * 8 + vec4s.length * 20;
  const stride =
    format === 0
      ? 32
      : format === 1
        ? 24
        : format === 3
          ? version === 8
            ? 32
            : 28
          : format === 4
            ? version === 8
              ? 36
              : 32
            : format === 5
              ? 16
              : format === 6
                ? 36
                : format === 13
                  ? 48
                  : 32;
  const vertexOffset = 80 + materialSize;
  const indexOffset = vertexOffset + stride;
  const paddingSize = 3;
  const sectionSize = indexOffset + 6 + paddingSize;
  const lodHeaderSize = version === 6 ? 20 : 28;
  const meshOffset = 140 + lodHeaderSize;
  const bytes = Buffer.alloc(meshOffset + sectionSize);

  bytes.write("RMV2", 0, "ascii");
  bytes.writeUInt32LE(version, 4);
  bytes.writeUInt32LE(1, 8);
  bytes.write("test_skeleton", 12, "utf8");
  bytes.writeUInt32LE(1, 140);
  bytes.writeUInt32LE(stride, 144);
  bytes.writeUInt32LE(6, 148);
  bytes.writeUInt32LE(meshOffset, 152);
  bytes.writeFloatLE(25, 156);
  if (version !== 6) {
    bytes.writeUInt32LE(2, 160);
    bytes.writeUInt8(3, 164);
    bytes[165] = 0xaa;
    bytes[166] = 0xbb;
    bytes[167] = 0xcc;
  }

  const common = meshOffset;
  const material = common + 80;
  bytes.writeUInt16LE(materialType, common);
  bytes.writeUInt16LE(5, common + 2);
  bytes.writeUInt32LE(sectionSize, common + 4);
  bytes.writeUInt32LE(vertexOffset, common + 8);
  bytes.writeUInt32LE(1, common + 12);
  bytes.writeUInt32LE(indexOffset, common + 16);
  bytes.writeUInt32LE(3, common + 20);
  for (let i = 0; i < 6; i++) bytes.writeFloatLE(i < 3 ? -1 : 1, common + 24 + i * 4);

  bytes.writeUInt16LE(format, material);
  bytes.write("fixture_part", material + 2, "ascii");
  if (options.unsupportedMaterial !== undefined) bytes.writeUInt32LE(options.unsupportedMaterial, material + 712);
  else {
    bytes.writeUInt32LE(0, material + 712);
    bytes.writeUInt32LE(textures.length, material + 716);
    bytes.writeUInt32LE(strings.length, material + 720);
    bytes.writeUInt32LE(floats.length, material + 724);
    bytes.writeUInt32LE(ints.length, material + 728);
    bytes.writeUInt32LE(vec4s.length, material + 732);
  }
  let cursor = material + 860;
  for (const [type, texturePath] of textures) {
    bytes.writeInt32LE(type, cursor);
    bytes.write(texturePath, cursor + 4, "utf8");
    cursor += 260;
  }
  for (const [id, value] of strings) {
    const encoded = Buffer.from(value, "utf8");
    bytes.writeInt32LE(id, cursor);
    bytes.writeInt16LE(encoded.length, cursor + 4);
    encoded.copy(bytes, cursor + 6);
    cursor += 6 + encoded.length;
  }
  for (const [id, value] of floats) {
    bytes.writeInt32LE(id, cursor);
    bytes.writeFloatLE(value, cursor + 4);
    cursor += 8;
  }
  for (const [id, value] of ints) {
    bytes.writeInt32LE(id, cursor);
    bytes.writeInt32LE(value, cursor + 4);
    cursor += 8;
  }
  for (const [id, value] of vec4s) {
    bytes.writeInt32LE(id, cursor);
    value.forEach((component, index) => bytes.writeFloatLE(component, cursor + 4 + index * 4));
    cursor += 20;
  }

  const vertex = common + vertexOffset;
  if (format === 0 || format === 3 || format === 4) {
    for (let i = 0; i < 4; i++) bytes.writeUInt16LE(halfBits(i === 1 ? 1 : 0), vertex + i * 2);
    if (format === 0) {
      for (let i = 0; i < 4; i++) bytes.writeUInt16LE(halfBits(i === 0 ? 2 : 0), vertex + 8 + i * 2);
      for (let i = 0; i < 2; i++) bytes.writeUInt16LE(halfBits(i === 1 ? 3 : 0), vertex + 12 + i * 2);
    } else {
      const uvOffset = format === 4 ? 20 : 16;
      bytes.writeUInt16LE(halfBits(2), vertex + uvOffset);
      bytes.writeUInt16LE(options.nonFiniteUv ? 0x7c00 : halfBits(3), vertex + uvOffset + 2);
    }
  } else if (format === 1) {
    for (let i = 0; i < 6; i++)
      bytes.writeFloatLE(options.nonFiniteNormal && i === 3 ? Number.NaN : i < 3 ? i : 0, vertex + i * 4);
  } else if (format === 5) {
    for (let i = 0; i < 4; i++) bytes.writeFloatLE(i, vertex + i * 4);
  } else if (format === 6 || format === 13) {
    for (let i = 0; i < 8; i++)
      bytes.writeFloatLE(options.nonFiniteNormal && i === 4 ? Number.NaN : i < 4 ? i : 0, vertex + i * 4);
    bytes.writeUInt16LE(halfBits(2), vertex + 32);
    bytes.writeUInt16LE(halfBits(3), vertex + 34);
  }
  const indices = common + indexOffset;
  bytes.writeUInt16LE(0, indices);
  bytes.writeUInt16LE(0, indices + 2);
  bytes.writeUInt16LE(options.invalidIndex ? 1 : 0, indices + 4);
  bytes.fill(0xe7, indices + 6);
  return bytes;
};

const withUnsupportedSecondPart = (fixture: Buffer): Buffer => {
  const meshOffset = fixture.readUInt32LE(152);
  const meshSize = fixture.readUInt32LE(meshOffset + 4);
  const secondPart = Buffer.from(fixture.subarray(meshOffset, meshOffset + meshSize));
  secondPart.writeUInt16LE(22, 0);
  const mixed = Buffer.concat([fixture, secondPart]);
  mixed.writeUInt32LE(2, 140);
  mixed.writeUInt32LE(fixture.readUInt32LE(144) * 2, 144);
  mixed.writeUInt32LE(fixture.readUInt32LE(148) * 2, 148);
  return mixed;
};

describe("RMV2 codec", () => {
  it.each([6, 7, 8] as const)("reads version %i headers, weighted parameters, UVs, and raw spans", (version) => {
    const fixture = makeWeightedFixture({ version });
    const parsed = parseRmv2(fixture);
    const part = parsed.lods[0].parts[0];
    expect(parsed).toMatchObject({ version, skeletonName: "test_skeleton", lods: [{ distance: 25 }] });
    expect(part).toMatchObject({
      name: "fixture_part",
      materialTypeId: 65,
      materialTypeName: "weighted",
      vertexFormatId: 3,
      vertexFormatName: "Weighted",
      intParams: [
        { id: 0, name: "Alpha", value: 0 },
        { id: 0, name: "Alpha", value: 1 },
        { id: 901, value: 9 },
      ],
      stringParams: [
        { id: 800, value: "first" },
        { id: 800, value: "second" },
      ],
      floatParams: [
        { id: 0, name: "UvScaleX", value: 1.5 },
        { id: 901, value: -2.25 },
      ],
      vec4Params: [{ id: 77, value: [1, 2, 3, 4] }],
      alphaMode: { supported: false, reason: "duplicate", rawValue: null },
      uvRanges: [{ channel: 0, min: [2, 3], max: [2, 3] }],
    });
    expect(part.textures).toEqual([
      { typeId: 0, typeName: "Diffuse", path: "diffuse.dds", legacy: true, source: "weightedTexture" },
      { typeId: 11, typeName: "Specular", path: "spec.dds", legacy: true, source: "weightedTexture" },
      { typeId: 12, typeName: "Gloss", path: "gloss.dds", legacy: true, source: "weightedTexture" },
      { typeId: 777, typeName: null, path: "unknown.dds", legacy: false, source: "weightedTexture" },
    ]);
    expect(part.raw.material.bytes.length).toBeGreaterThan(860);
    expect(part.raw.sectionPadding.bytes).toEqual(Buffer.alloc(3, 0xe7));
    expect(parsed.trailing.bytes).toHaveLength(0);
  });

  it("supports all seven registered vertex layouts and omits absent UV channels", () => {
    const formats = [0, 1, 3, 4, 5, 6, 13];
    for (const format of formats) {
      const materialType = format === 5 ? 101 : format === 6 ? 49 : 65;
      const fixture = makeWeightedFixture({ format, materialType, alpha: [] });
      const parsed = parseRmv2(fixture);
      expect(parsed.lods[0].parts[0].vertexFormatId).toBe(format);
      expect(parsed.lods[0].parts[0].uvRanges?.map((range) => range.channel) ?? []).toEqual(
        format === 0 ? [0, 1] : [3, 4, 6, 13].includes(format) ? [0] : [],
      );
    }
  });

  it("keeps texture-slot provenance while skipping parameter and geometry decoding", () => {
    const fixture = makeWeightedFixture({ version: 8 });
    const regular = parseRmv2(fixture).lods[0].parts[0];
    const slotsOnly = parseRmv2(fixture, { textureSlotsOnly: true }).lods[0].parts[0];
    expect(slotsOnly.textures).toEqual(regular.textures);
    expect(slotsOnly).not.toHaveProperty("uvRanges");
    expect(slotsOnly).not.toHaveProperty("intParams");
    expect(slotsOnly.raw.vertices.bytes).toEqual(regular.raw.vertices.bytes);
  });

  it("retains supported parts and common-header evidence when another part has an unsupported material", () => {
    const parsed = parseRmv2(withUnsupportedSecondPart(makeWeightedFixture()));
    expect(parsed.validationComplete).toBe(false);
    expect(parsed.lods[0].parts).toHaveLength(2);
    expect(parsed.lods[0].parts[0]).toMatchObject({ complete: true, materialTypeId: 65, textures: expect.any(Array) });
    expect(parsed.lods[0].parts[1]).toMatchObject({
      lodIndex: 0,
      partIndex: 1,
      complete: false,
      materialTypeId: 22,
      materialTypeName: "bow_wave",
      vertexCount: 1,
      indexCount: 3,
      triangleCount: 1,
      raw: {
        commonHeader: expect.any(Object),
        material: expect.any(Object),
        vertices: expect.any(Object),
        indices: expect.any(Object),
      },
    });
    expect(parsed.lods[0].parts[1]).not.toHaveProperty("textures");
  });

  it("keeps a single unsupported alpha value raw and marks its interpretation unsupported", () => {
    const part = parseRmv2(makeWeightedFixture({ alpha: [12] })).lods[0].parts[0];
    expect(part.intParams?.[0]).toMatchObject({ id: 0, value: 12 });
    expect(part.alphaMode).toMatchObject({ rawValue: 12, supported: false, reason: "unsupportedValue" });
  });

  it("rejects partial triangle lists", () => {
    const fixture = makeWeightedFixture();
    fixture.writeUInt32LE(2, fixture.readUInt32LE(152) + 20);
    expect(() => parseRmv2(fixture)).toThrow(/complete triangle list/);
  });

  it("rejects nonzero geometry totals in an empty LOD", () => {
    const bytes = Buffer.alloc(168);
    bytes.write("RMV2", 0, "ascii");
    bytes.writeUInt32LE(8, 4);
    bytes.writeUInt32LE(1, 8);
    bytes.writeUInt32LE(0, 140);
    bytes.writeUInt32LE(4, 144);
    expect(() => parseRmv2(bytes)).toThrow(/Empty LOD has nonzero geometry byte totals/);
    bytes.writeUInt32LE(0, 144);
    expect(parseRmv2(bytes)).toMatchObject({ lods: [{ meshCount: 0, totalVertexBytes: 0, totalIndexBytes: 0 }] });
  });

  it("rejects truncation, bad indices, non-finite values, and unsupported versions/layouts distinctly", () => {
    const assertCode = (fixture: Buffer, code: string) => {
      try {
        parseRmv2(fixture);
        throw new Error("expected RMV2 parser to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(Rmv2CodecError);
        expect((error as Rmv2CodecError).code).toBe(code);
      }
    };
    assertCode(Buffer.from("RMV2"), "MALFORMED");
    assertCode(makeWeightedFixture({ invalidIndex: true }), "MALFORMED");
    assertCode(makeWeightedFixture({ nonFiniteUv: true }), "MALFORMED");
    assertCode(makeWeightedFixture({ format: 1, nonFiniteNormal: true }), "MALFORMED");
    const unsupportedFormat = parseRmv2(makeWeightedFixture({ format: 99 })).lods[0].parts[0];
    expect(unsupportedFormat).toMatchObject({ complete: false, vertexFormatId: 99, vertexFormatName: null });
    const badVersion = makeWeightedFixture();
    badVersion.writeUInt32LE(5, 4);
    assertCode(badVersion, "UNSUPPORTED");
  });

  it("registers the inspect automation operation and CLI command with bounded reports", async () => {
    const packPath = path.join(tempRoot, "inspect.pack");
    const reportPath = path.join(tempRoot, "report.json");
    await writeRawPack(
      packPath,
      [{ name: "models\\test.rigid_model_v2", buffer: withUnsupportedSecondPart(makeWeightedFixture()) }],
      packMetadata,
    );
    const response = await executeAutomationRequest(
      {
        operation: "rigid_inspect",
        packPath,
        filePath: "models/test.rigid_model_v2",
        offset: 1,
        limit: 1,
        reportPath,
      },
      createAutomationContext({ readRoots: [tempRoot], writeRoots: [tempRoot] }),
    );
    expect(response).toMatchObject({
      ok: true,
      data: {
        validationComplete: false,
        total: 2,
        offset: 1,
        limit: 1,
        items: [{ lodIndex: 0, partIndex: 1, complete: false }],
        hasMore: false,
      },
      diagnostics: [{ code: "UNSUPPORTED_RMV2_PART", severity: "warning" }],
    });
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { items: unknown[]; diagnostics: unknown[] };
    expect(report.items).toHaveLength(2);
    expect(report.diagnostics).toHaveLength(1);

    let stdout = "";
    let stderr = "";
    const exitCode = await main(
      [
        "rigid",
        "inspect",
        packPath,
        "models/test.rigid_model_v2",
        "--texture-slots-only",
        "--format",
        "json",
        "--no-cache",
      ],
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: (value) => {
          stderr += value;
        },
      },
    );
    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      data: {
        textureSlotsOnly: true,
        validationComplete: false,
        total: 2,
        items: [{ complete: true }, { complete: false }],
      },
    });
  });
});
