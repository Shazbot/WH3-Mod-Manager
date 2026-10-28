import { describe, expect, it } from "vitest";
import {
  KHR_SUPERCOMPRESSION_NONE,
  KHR_SUPERCOMPRESSION_ZSTD,
  KTX2_IDENTIFIER,
  VK_FORMAT_R8G8B8A8_SRGB,
  VK_FORMAT_R8G8B8A8_UNORM,
  parseWh3RawKtx2Header,
} from "../src/visuals/wh3RawKtx2";

const makeRawKtx2 = ({
  width = 1024,
  height = 1024,
  vkFormat = VK_FORMAT_R8G8B8A8_UNORM,
  supercompression = KHR_SUPERCOMPRESSION_ZSTD,
  levelLength: requestedLevelLength,
}: {
  width?: number;
  height?: number;
  vkFormat?: number;
  supercompression?: number;
  levelLength?: number;
} = {}) => {
  const levelOffset = 104;
  const levelLength = requestedLevelLength ?? 16;
  const buffer = new ArrayBuffer(levelOffset + levelLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(KTX2_IDENTIFIER);

  const view = new DataView(buffer);
  view.setUint32(12, vkFormat, true);
  view.setUint32(16, 1, true);
  view.setUint32(20, width, true);
  view.setUint32(24, height, true);
  view.setUint32(28, 0, true);
  view.setUint32(32, 0, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, 1, true);
  view.setUint32(44, supercompression, true);
  view.setBigUint64(80, BigInt(levelOffset), true);
  view.setBigUint64(88, BigInt(levelLength), true);
  view.setBigUint64(96, BigInt(width * height * 4), true);
  return buffer;
};

describe("WH3 raw KTX2 header detection", () => {
  it("accepts large raw RGBA8 Zstd textures", () => {
    const header = parseWh3RawKtx2Header(makeRawKtx2({ width: 2048, height: 2048 }));

    expect(header).toEqual({
      width: 2048,
      height: 2048,
      srgb: false,
      levelOffset: 104,
      levelLength: 16,
      uncompressedLength: 2048 * 2048 * 4,
      supercompressionScheme: KHR_SUPERCOMPRESSION_ZSTD,
    });
  });

  it("accepts uncompressed (scheme 0) textures whose level is the RGBA pixels", () => {
    const header = parseWh3RawKtx2Header(
      makeRawKtx2({ width: 4, height: 2, supercompression: KHR_SUPERCOMPRESSION_NONE, levelLength: 4 * 2 * 4 }),
    );

    expect(header).toEqual({
      width: 4,
      height: 2,
      srgb: false,
      levelOffset: 104,
      levelLength: 32,
      uncompressedLength: 32,
      supercompressionScheme: KHR_SUPERCOMPRESSION_NONE,
    });
  });

  it("rejects uncompressed textures whose stored length differs from the pixel size", () => {
    expect(() =>
      parseWh3RawKtx2Header(makeRawKtx2({ width: 4, height: 2, supercompression: KHR_SUPERCOMPRESSION_NONE })),
    ).toThrow(/stored length 16 differs/);
  });

  it("preserves the sRGB distinction", () => {
    expect(parseWh3RawKtx2Header(makeRawKtx2({ vkFormat: VK_FORMAT_R8G8B8A8_SRGB }))?.srgb).toBe(true);
  });

  it("delegates non-raw KTX2 formats to Three's normal loader", () => {
    expect(parseWh3RawKtx2Header(makeRawKtx2({ vkFormat: 0 }))).toBeUndefined();
  });

  it("rejects malformed raw RGBA8 layouts instead of silently delegating them", () => {
    expect(() => parseWh3RawKtx2Header(makeRawKtx2({ supercompression: 1 }))).toThrow(
      /Unsupported WH3 raw KTX2 layout/,
    );
  });
});
