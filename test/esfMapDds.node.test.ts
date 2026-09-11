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

const readPngPixels = (png: Buffer): Buffer => {
  const idatOffset = 8 + 4 + 4 + 13 + 4;
  const idatLength = png.readUInt32BE(idatOffset);
  return inflateSync(png.subarray(idatOffset + 8, idatOffset + 8 + idatLength));
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

  it("keeps the DDS dimensions when no resize target is provided", () => {
    const encoded = encodeDdsAsPngImage(createDxt1Dds(0xf800, 0x001f, 0, 8, 4));

    expect([encoded.width, encoded.height]).toEqual([8, 4]);
    expect(readPngDimensions(encoded.png)).toEqual([8, 4]);
  });
});
