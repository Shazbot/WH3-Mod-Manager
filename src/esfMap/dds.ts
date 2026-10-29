import { deflateSync } from "node:zlib";
import { DDS_MAX_PIXELS } from "../utility/ddsLayout";
import { decodeDds, type DdsRgbaImage } from "./ddsDecode";

export { decodeBlockCompressedRgba, decodeDds, type DdsBlockFamily, type DdsRgbaImage } from "./ddsDecode";

const resizeRgba = (image: DdsRgbaImage, targetWidth: number, targetHeight: number): Buffer => {
  if (image.width === targetWidth && image.height === targetHeight)
    return Buffer.from(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength);

  const resized = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / targetWidth));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = (y * targetWidth + x) * 4;
      resized.set(image.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return resized;
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const typeBuffer = Buffer.from(type, "ascii");
  const checksumInput = Buffer.concat([typeBuffer, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(checksumInput), data.length + 8);
  return chunk;
};

const encodePng = (pixels: Uint8Array, width: number, height: number): Buffer => {
  const scanlineBytes = width * 4 + 1;
  const scanlines = Buffer.alloc(scanlineBytes * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * scanlineBytes;
    scanlines[scanlineOffset] = 0;
    scanlines.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), scanlineOffset + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

export interface EncodedDdsPng {
  width: number;
  height: number;
  png: Buffer;
}

export const encodeDdsAsPngImage = (buffer: Buffer, width?: number, height?: number): EncodedDdsPng => {
  const image = decodeDds(buffer);
  const targetWidth = width ?? image.width;
  const targetHeight = height ?? image.height;
  if (targetWidth <= 0 || targetHeight <= 0) {
    throw new Error(`Invalid target image dimensions ${targetWidth}x${targetHeight}.`);
  }
  return {
    width: targetWidth,
    height: targetHeight,
    png: encodePng(resizeRgba(image, targetWidth, targetHeight), targetWidth, targetHeight),
  };
};

export const encodeDdsAsPng = (buffer: Buffer, width?: number, height?: number): Buffer =>
  encodeDdsAsPngImage(buffer, width, height).png;

/** Exports the actual stored mip, without resizing or generating mipmaps. */
export const encodeDdsMipAsPng = (buffer: Buffer, mipLevel = 0, surface = 0): EncodedDdsPng => {
  const image = decodeDds(buffer, mipLevel, surface, DDS_MAX_PIXELS);
  return { width: image.width, height: image.height, png: encodePng(image.pixels, image.width, image.height) };
};
