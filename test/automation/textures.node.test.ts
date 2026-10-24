import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { inspectDdsLayout } from "../../src/utility/ddsLayout";
import { encodeDdsMipAsPng } from "../../src/esfMap/dds";
import { writeRawPack } from "../../src/packCore";

const root = mkdtempSync(path.join(os.tmpdir(), "whmm-textures-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const metadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([255, 255, 255, 127]),
  dependencies: [] as string[],
};
const dds = (width = 8, height = 4, mipCount = 4, dxgi?: number, surfaces = 1) => {
  const header = Buffer.alloc(dxgi === undefined ? 128 : 148);
  header.write("DDS ");
  header.writeUInt32LE(124, 4);
  header.writeUInt32LE(0x21007, 8);
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);
  header.writeUInt32LE(mipCount, 28);
  header.writeUInt32LE(32, 76);
  header.writeUInt32LE(4, 80);
  header.write(dxgi === undefined ? "DXT1" : "DX10", 84);
  if (dxgi !== undefined) {
    header.writeUInt32LE(dxgi, 128);
    header.writeUInt32LE(3, 132);
    header.writeUInt32LE(surfaces, 140);
  }
  const chunks = [header];
  for (let surface = 0; surface < surfaces; surface++) {
    for (let level = 0; level < mipCount; level++) {
      const bytes =
        Math.max(1, Math.ceil(Math.max(1, Math.floor(width / 2 ** level)) / 4)) *
        Math.max(1, Math.ceil(Math.max(1, Math.floor(height / 2 ** level)) / 4)) *
        8;
      const chunk = Buffer.alloc(bytes);
      for (let index = 0; index < bytes; index += 8)
        chunk.writeUInt16LE([0xf800, 0x07e0, 0x001f, 0xffff][(level + surface) % 4], index);
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
};
const pixels = (png: Buffer) => {
  const idat = 33;
  return inflateSync(png.subarray(idat + 8, idat + 8 + png.readUInt32BE(idat)));
};
const pack = async (name: string, buffer: Buffer) => {
  const packPath = path.join(root, name);
  await writeRawPack(packPath, [{ name: "textures\\nested\\test.dds", buffer }], metadata);
  return packPath;
};
const request = (packPath: string, extras = {}) => ({
  operation: "pack_texture_inspect",
  packPath,
  filePath: "textures/nested/test.dds",
  ...extras,
});
const data = async (packPath: string, extras = {}) => {
  const result = await executeAutomationRequest(request(packPath, extras));
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data as {
    texture: ReturnType<typeof inspectDdsLayout>;
    selectedMip: { offset: number; present: boolean };
    outputPath?: string;
  };
};

describe("DDS texture inspection", () => {
  it("reports nested glob semantics and accurate byte ranges through the small block mip tail", async () => {
    const packPath = await pack("mips.pack", dds());
    const shallow = await executeAutomationRequest({ operation: "pack_list_files", packPath, glob: "*.dds" });
    const recursive = await executeAutomationRequest({ operation: "pack_list_files", packPath, glob: "**/*.dds" });
    expect(shallow).toMatchObject({ ok: true, data: { total: 0 } });
    expect(recursive).toMatchObject({ ok: true, data: { total: 1 } });
    const result = await data(packPath);
    expect(result.texture).toMatchObject({
      format: "BC1_UNORM",
      width: 8,
      height: 4,
      mipCount: 4,
      complete: true,
      trailingBytes: 0,
    });
    expect(result.texture.mips.map((mip) => [mip.width, mip.height, mip.offset, mip.byteLength])).toEqual([
      [8, 4, 128, 16],
      [4, 2, 144, 8],
      [2, 1, 152, 8],
      [1, 1, 160, 8],
    ]);
  });

  it("exports the selected stored mip rather than resizing mip zero and protects the source", async () => {
    const packPath = await pack("preview.pack", dds());
    const original = readFileSync(packPath);
    const outputPath = path.join(root, "mip2.png");
    await data(packPath, { mipLevel: 2, outputPath });
    const png = readFileSync(outputPath);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2, 1]);
    expect(pixels(png).subarray(1, 5)).toEqual(Buffer.from([0, 0, 255, 255]));
    expect(readFileSync(packPath)).toEqual(original);
    expect(await executeAutomationRequest(request(packPath, { outputPath }))).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await executeAutomationRequest(request(packPath, { outputPath: packPath, overwrite: true }))).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
  });

  it("handles odd dimensions, DX10 offsets, array surfaces, and cubemap surface counts", () => {
    const buffer = dds(9, 5, 4, 72, 2);
    const layout = inspectDdsLayout(buffer);
    expect(layout).toMatchObject({
      format: "BC1_UNORM_SRGB",
      dataOffset: 148,
      arraySize: 2,
      surfaceCount: 2,
      chainBytes: 72,
      complete: true,
    });
    const png = encodeDdsMipAsPng(buffer, 1, 1).png;
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([4, 2]);
    expect(pixels(png).subarray(1, 5)).toEqual(Buffer.from([0, 0, 255, 255]));
    const cube = dds(4, 4, 1, 71, 6);
    cube.writeUInt32LE(4, 136);
    cube.writeUInt32LE(1, 140);
    expect(inspectDdsLayout(cube)).toMatchObject({ isCubemap: true, arraySize: 1, surfaceCount: 6, complete: true });
  });

  it("reports truncated mip chains and refuses to export missing payloads", async () => {
    const packPath = await pack("truncated.pack", dds().subarray(0, 164));
    const result = await data(packPath);
    expect(result.texture).toMatchObject({ complete: false, expectedBytes: 168 });
    expect(result.texture.mips[3].present).toBe(false);
    const outputPath = path.join(root, "missing.png");
    expect(await executeAutomationRequest(request(packPath, { mipLevel: 3, outputPath }))).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(existsSync(outputPath)).toBe(false);
  });

  it("keeps metadata for unsupported decoders/layouts and rejects malformed headers/selectors", async () => {
    const bc4 = dds(4, 4, 1);
    bc4.write("ATI1", 84);
    const bc4Pack = await pack("bc4.pack", bc4);
    expect((await data(bc4Pack)).texture).toMatchObject({
      format: "BC4_UNORM",
      layoutSupported: true,
      previewSupported: false,
      complete: true,
    });
    expect(
      await executeAutomationRequest(request(bc4Pack, { outputPath: path.join(root, "unsupported.png") })),
    ).toMatchObject({ ok: false, error: { code: "UNSUPPORTED" } });
    const unknown = dds(4, 4, 1, 12345);
    expect(inspectDdsLayout(unknown)).toMatchObject({
      format: "DXGI_12345",
      layoutSupported: false,
      complete: null,
      mips: [],
    });
    const bad = dds();
    bad.writeUInt32LE(0, 16);
    expect(inspectDdsLayout.bind(null, bad)).toThrow(/dimensions/);
    const excessiveMips = dds();
    excessiveMips.writeUInt32LE(32, 28);
    expect(() => inspectDdsLayout(excessiveMips)).toThrow(/mip count/);
    const packPath = await pack("selectors.pack", dds());
    expect(await executeAutomationRequest(request(packPath, { mipLevel: 4 }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(await executeAutomationRequest(request(packPath, { surface: 1 }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
  });

  it("enforces filesystem roots and writes explicit metadata reports", async () => {
    const packPath = await pack("policy.pack", dds());
    const result = await executeAutomationRequest(
      request(packPath, { outputPath: path.join(root, "denied.png") }),
      createAutomationContext({ readRoots: [root], writeRoots: [] }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "IO_ACCESS" } });
    const reportPath = path.join(root, "texture.json");
    await data(packPath, { reportPath });
    expect(JSON.parse(readFileSync(reportPath, "utf8"))).toMatchObject({
      texture: { mipCount: 4, format: "BC1_UNORM" },
    });
  });
});
