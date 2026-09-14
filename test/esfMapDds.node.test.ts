import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeDdsAsPng, encodeDdsAsPngImage } from "../src/esfMap/dds";

const createDxt1Dds = (colour0: number, colour1: number, colourBits = 0, width = 4, height = 4): Buffer => {
  const blockCount = Math.ceil(width / 4) * Math.ceil(height / 4);
  const dds = Buffer.alloc(128 + blockCount * 8);
  dds.write("DDS ", 0, "ascii");
  dds.writeUInt32LE(124, 4);
  dds.writeUInt32LE(height, 12);
  dds.writeUInt32LE(width, 16);
  dds.writeUInt32LE(32, 76);
  dds.writeUInt32LE(4, 80);
  dds.write("DXT1", 84, "ascii");
  for (let block = 0; block < blockCount; block += 1) {
    const offset = 128 + block * 8;
    dds.writeUInt16LE(colour0, offset);
    dds.writeUInt16LE(colour1, offset + 2);
    dds.writeUInt32LE(colourBits, offset + 4);
  }
  return dds;
};

const createDxt3Dds = (
  alphaBitsFirst: number,
  alphaBitsSecond: number,
  colour0: number,
  colour1: number,
  colourBits = 0,
  width = 4,
  height = 4,
): Buffer => {
  const dds = Buffer.alloc(128 + 16);
  dds.write("DDS ", 0, "ascii");
  dds.writeUInt32LE(124, 4);
  dds.writeUInt32LE(height, 12);
  dds.writeUInt32LE(width, 16);
  dds.writeUInt32LE(32, 76);
  dds.writeUInt32LE(4, 80);
  dds.write("DXT3", 84, "ascii");
  dds.writeUInt32LE(alphaBitsFirst, 128);
  dds.writeUInt32LE(alphaBitsSecond, 132);
  dds.writeUInt16LE(colour0, 136);
  dds.writeUInt16LE(colour1, 138);
  dds.writeUInt32LE(colourBits, 140);
  return dds;
};

const createDx10Dds = (dxgiFormat: number, block: Buffer, width = 4, height = 4): Buffer => {
  const dds = Buffer.alloc(148 + block.length);
  dds.write("DDS ", 0, "ascii");
  dds.writeUInt32LE(124, 4);
  dds.writeUInt32LE(height, 12);
  dds.writeUInt32LE(width, 16);
  dds.writeUInt32LE(32, 76);
  dds.writeUInt32LE(4, 80);
  dds.write("DX10", 84, "ascii");
  dds.writeUInt32LE(dxgiFormat, 128);
  dds.writeUInt32LE(3, 132);
  dds.writeUInt32LE(1, 140);
  block.copy(dds, 148);
  return dds;
};

const readPngPixels = (png: Buffer): Buffer => {
  const idatOffset = 8 + 4 + 4 + 13 + 4;
  const idatLength = png.readUInt32BE(idatOffset);
  return inflateSync(png.subarray(idatOffset + 8, idatOffset + 8 + idatLength));
};

const readPngPixel = (png: Buffer, x: number, y: number, width = 4): Buffer => {
  const pixels = readPngPixels(png);
  const offset = y * (width * 4 + 1) + 1 + x * 4;
  return pixels.subarray(offset, offset + 4);
};

const readPngDimensions = (png: Buffer): [number, number] => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe("campaign map DDS decoding", () => {
  it("decodes DXT1 map backgrounds", () => {
    const png = encodeDdsAsPng(createDxt1Dds(0xf800, 0x001f), 4, 4);

    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(readPngPixels(png).subarray(0, 5)).toEqual(Buffer.from([0, 255, 0, 0, 255]));
  });

  it("preserves DXT1's transparent fourth palette entry", () => {
    const png = encodeDdsAsPng(createDxt1Dds(0x001f, 0x001f, 3), 4, 4);

    expect(readPngPixels(png).subarray(0, 5)).toEqual(Buffer.from([0, 0, 0, 0, 0]));
  });

  it("decodes DXT3's explicit four-bit alpha", () => {
    const png = encodeDdsAsPng(createDxt3Dds(0xf0, 0, 0xf800, 0x001f, 4));

    expect(readPngPixels(png).subarray(1, 9)).toEqual(Buffer.from([255, 0, 0, 0, 0, 0, 255, 255]));
  });

  it("decodes DX10 BC1 textures after the extended header", () => {
    const png = encodeDdsAsPng(createDx10Dds(71, Buffer.from([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0])));

    expect(readPngPixels(png).subarray(0, 5)).toEqual(Buffer.from([0, 255, 0, 0, 255]));
  });

  it("decodes DX10 BC7 textures after the extended header", () => {
    const block = Buffer.from("c0ff1f000000fe7f0000000000000000", "hex");
    const png = encodeDdsAsPng(createDx10Dds(98, block));

    expect(readPngPixels(png).subarray(0, 5)).toEqual(Buffer.from([0, 254, 0, 0, 254]));
  });

  it("honours BC7 partition fix-up indices", () => {
    // BC7 mode 1, partition 0: the first and last texels use one-bit-short color indices.
    const block = Buffer.from("02ff0f0000000000f0ff000000000000", "hex");
    const png = encodeDdsAsPng(createDx10Dds(98, block));

    expect(readPngPixel(png, 0, 0)).toEqual(Buffer.from([252, 0, 0, 255]));
    expect(readPngPixel(png, 3, 3)).toEqual(Buffer.from([0, 0, 252, 255]));
  });

  it("keeps the DDS dimensions when no resize target is provided", () => {
    const encoded = encodeDdsAsPngImage(createDxt1Dds(0xf800, 0x001f, 0, 8, 4));

    expect([encoded.width, encoded.height]).toEqual([8, 4]);
    expect(readPngDimensions(encoded.png)).toEqual([8, 4]);
  });
});
