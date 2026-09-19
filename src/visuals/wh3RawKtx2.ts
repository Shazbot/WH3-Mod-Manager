export const KTX2_IDENTIFIER = new Uint8Array([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const VK_FORMAT_R8G8B8A8_UNORM = 37;
export const VK_FORMAT_R8G8B8A8_SRGB = 43;
export const KHR_SUPERCOMPRESSION_ZSTD = 2;

const KTX2_HEADER_BYTES = 12 + 68;
const KTX2_LEVEL_INDEX_BYTES = 24;
const MIN_SINGLE_LEVEL_KTX2_BYTES = KTX2_HEADER_BYTES + KTX2_LEVEL_INDEX_BYTES;

export type Wh3RawKtx2Header = {
  width: number;
  height: number;
  srgb: boolean;
  levelOffset: number;
  levelLength: number;
  uncompressedLength: number;
};

const readUint64 = (view: DataView, offset: number) => {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("WH3 raw KTX2 contains an offset or length larger than JavaScript can address safely.");
  }
  return Number(value);
};

/**
 * Detects the private headless-preview KTX2 flavor emitted by WH3AssetHost:
 * one 2D RGBA8 level with Zstd supercompression.
 *
 * Returns undefined for other KTX2 flavors (Basis/UASTC etc.) so Three's
 * normal KTX2Loader can handle them.
 */
export const parseWh3RawKtx2Header = (buffer: ArrayBuffer): Wh3RawKtx2Header | undefined => {
  if (buffer.byteLength < MIN_SINGLE_LEVEL_KTX2_BYTES) return undefined;

  const bytes = new Uint8Array(buffer, 0, KTX2_IDENTIFIER.length);
  for (let index = 0; index < KTX2_IDENTIFIER.length; index += 1) {
    if (bytes[index] !== KTX2_IDENTIFIER[index]) return undefined;
  }

  const view = new DataView(buffer);
  const vkFormat = view.getUint32(12, true);
  if (vkFormat !== VK_FORMAT_R8G8B8A8_UNORM && vkFormat !== VK_FORMAT_R8G8B8A8_SRGB) {
    return undefined;
  }

  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const pixelDepth = view.getUint32(28, true);
  const layerCount = view.getUint32(32, true);
  const faceCount = view.getUint32(36, true);
  const levelCount = view.getUint32(40, true);
  const supercompressionScheme = view.getUint32(44, true);

  if (
    width === 0 ||
    height === 0 ||
    pixelDepth !== 0 ||
    layerCount !== 0 ||
    faceCount !== 1 ||
    levelCount !== 1 ||
    supercompressionScheme !== KHR_SUPERCOMPRESSION_ZSTD
  ) {
    throw new Error(
      `Unsupported WH3 raw KTX2 layout: ${width}x${height}, depth=${pixelDepth}, layers=${layerCount}, faces=${faceCount}, levels=${levelCount}, supercompression=${supercompressionScheme}.`,
    );
  }

  const levelOffset = readUint64(view, 80);
  const levelLength = readUint64(view, 88);
  const uncompressedLength = readUint64(view, 96);
  const expectedLength = width * height * 4;

  if (!Number.isSafeInteger(expectedLength) || uncompressedLength !== expectedLength) {
    throw new Error(
      `Invalid WH3 raw KTX2 RGBA payload size: expected ${expectedLength}, header declares ${uncompressedLength}.`,
    );
  }

  if (
    levelOffset < MIN_SINGLE_LEVEL_KTX2_BYTES ||
    levelLength <= 0 ||
    levelOffset > buffer.byteLength ||
    levelLength > buffer.byteLength - levelOffset
  ) {
    throw new Error(
      `Invalid WH3 raw KTX2 level range: offset=${levelOffset}, length=${levelLength}, file=${buffer.byteLength}.`,
    );
  }

  return {
    width,
    height,
    srgb: vkFormat === VK_FORMAT_R8G8B8A8_SRGB,
    levelOffset,
    levelLength,
    uncompressedLength,
  };
};
