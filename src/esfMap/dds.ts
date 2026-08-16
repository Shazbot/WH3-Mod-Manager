import { deflateSync } from "node:zlib";

interface DdsRgbaImage {
  width: number;
  height: number;
  pixels: Buffer;
}

const DDS_HEADER_BYTES = 128;

const readU32LE = (buffer: Buffer, offset: number): number => {
  if (offset + 4 > buffer.length) throw new Error(`Unexpected EOF while reading DDS header at ${offset}.`);
  return buffer.readUInt32LE(offset);
};

const readU16LE = (buffer: Buffer, offset: number): number => {
  if (offset + 2 > buffer.length) throw new Error(`Unexpected EOF while reading DDS data at ${offset}.`);
  return buffer.readUInt16LE(offset);
};

const colour565 = (value: number): [number, number, number] =>
  [(((value >> 11) & 0x1f) * 255) / 31, (((value >> 5) & 0x3f) * 255) / 63, ((value & 0x1f) * 255) / 31].map(
    (channel) => Math.round(channel),
  ) as [number, number, number];

const interpolateColour = (first: number[], second: number[], firstWeight: number, secondWeight: number) =>
  first.map((channel, index) =>
    Math.round((channel * firstWeight + second[index] * secondWeight) / (firstWeight + secondWeight)),
  );

const BC7_COLOR_BITS = [4, 6, 5, 7, 5, 7, 7, 5] as const;
const BC7_ALPHA_BITS = [0, 0, 0, 0, 6, 8, 7, 5] as const;
const BC7_WEIGHTS_2 = [0, 21, 43, 64] as const;
const BC7_WEIGHTS_3 = [0, 9, 18, 27, 37, 46, 55, 64] as const;
const BC7_WEIGHTS_4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64] as const;

// Each hexadecimal digit stores a partition id in its low two bits and the fix-up flag in bit 2.
// These are the BPTC partition tables from the BC7 format specification.
const BC7_TWO_SUBSET_PARTITION_ROWS = [
  "4011001100110015",
  "4001000100010005",
  "4111011101110115",
  "4001001100110115",
  "4000000100010015",
  "4011011101111115",
  "4001001101111115",
  "4000000100110115",
  "4000000000010015",
  "4011011111111115",
  "4000000101111115",
  "4000000000010115",
  "4001011111111115",
  "4000000011111115",
  "4000111111111115",
  "4000000000001115",
  "4000100011101115",
  "4151000100000000",
  "4000000050001110",
  "4151001100010000",
  "4051000100000000",
  "4000100050001110",
  "4000000050001100",
  "4111001100110005",
  "4051000100010000",
  "4000100050001100",
  "4150011001100110",
  "4051011001101100",
  "4001011151101000",
  "4000111151110000",
  "4151000110001110",
  "4051100110011100",
  "4101010101010105",
  "4000111100001115",
  "4101105001011010",
  "4011001151001100",
  "4051110000111100",
  "4101010150101010",
  "4110100101101005",
  "4101101010100105",
  "4151001111001110",
  "4001001151001000",
  "4051001001001100",
  "4051101111011100",
  "4150100110010110",
  "4011110011000015",
  "4110011010011005",
  "4000015001100000",
  "4100115001000000",
  "4050011100100000",
  "4000005001110010",
  "4000010051100100",
  "4110110010010015",
  "4011011011001005",
  "4150001110011100",
  "4051100111000110",
  "4110110011001005",
  "4110001100111005",
  "4111111010000005",
  "4001100011100115",
  "4000111100110015",
  "4051001111110000",
  "4050001011101110",
  "4100010001110115",
] as const;

const BC7_THREE_SUBSET_PARTITION_ROWS = [
  "4015001102212226",
  "4005001162112221",
  "4000200162112215",
  "4226002200110115",
  "4000000051221126",
  "4015001100220026",
  "4026002211111115",
  "4011001162112215",
  "4000000051112226",
  "4000111151112226",
  "4000115122222226",
  "4012005200120016",
  "4112015201120116",
  "4122052201220126",
  "4015011211221226",
  "4015200162002220",
] as const;

const decodePartitionRows = (rows: readonly string[]): Uint8Array =>
  Uint8Array.from(rows.join(""), (character) => Number.parseInt(character, 16));

const BC7_TWO_SUBSET_PARTITIONS = decodePartitionRows(BC7_TWO_SUBSET_PARTITION_ROWS);
const BC7_THREE_SUBSET_PARTITIONS = decodePartitionRows(BC7_THREE_SUBSET_PARTITION_ROWS);

class Bc7BitReader {
  private readonly words = new Uint32Array(4);
  private bitOffset = 0;

  reset(buffer: Buffer, offset: number): void {
    for (let index = 0; index < this.words.length; index += 1) {
      this.words[index] = buffer.readUInt32LE(offset + index * 4);
    }
    this.bitOffset = 0;
  }

  readBits(count: number): number {
    if (count === 0) return 0;
    const wordIndex = this.bitOffset >>> 5;
    const bitIndex = this.bitOffset & 31;
    let value = (this.words[wordIndex] ?? 0) >>> bitIndex;
    if (bitIndex + count > 32) value |= (this.words[wordIndex + 1] ?? 0) << (32 - bitIndex);
    this.bitOffset += count;
    return value & ((1 << count) - 1);
  }
}

const bc7Interpolate = (first: number, second: number, weights: readonly number[], index: number): number =>
  (first * (64 - weights[index]) + second * weights[index] + 32) >> 6;

const decodeBc7 = (buffer: Buffer, width: number, height: number, dataOffset: number): DdsRgbaImage => {
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const dataBytes = blocksWide * blocksHigh * 16;
  if (dataOffset + dataBytes > buffer.length) {
    throw new Error(`Truncated BC7 data: need ${dataBytes} bytes, file has ${buffer.length - dataOffset}.`);
  }

  const pixels = Buffer.alloc(width * height * 4);
  const reader = new Bc7BitReader();
  const endpoints = new Int32Array(6 * 4);
  const indices = new Uint8Array(16);
  const hasPBits = 0b11001011;

  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      reader.reset(buffer, dataOffset + (blockY * blocksWide + blockX) * 16);
      let mode = 0;
      while (mode < 8 && reader.readBits(1) === 0) mode += 1;
      if (mode >= 8) continue;

      const numPartitions = mode === 0 || mode === 2 ? 3 : mode === 1 || mode === 3 || mode === 7 ? 2 : 1;
      const partition = numPartitions === 1 ? 0 : reader.readBits(mode === 0 || mode === 2 ? 4 : 6);
      const partitionValues = numPartitions === 3 ? BC7_THREE_SUBSET_PARTITIONS : BC7_TWO_SUBSET_PARTITIONS;
      let rotation = 0;
      let indexSelectionBit = 0;
      if (mode === 4 || mode === 5) {
        rotation = reader.readBits(2);
        if (mode === 4) indexSelectionBit = reader.readBits(1);
      }

      endpoints.fill(0);
      const colorBits = BC7_COLOR_BITS[mode];
      const alphaBits = BC7_ALPHA_BITS[mode];
      const endpointCount = numPartitions * 2;
      for (let component = 0; component < 3; component += 1) {
        for (let endpoint = 0; endpoint < endpointCount; endpoint += 1) {
          endpoints[endpoint * 4 + component] = reader.readBits(colorBits);
        }
      }
      if (alphaBits > 0) {
        for (let endpoint = 0; endpoint < endpointCount; endpoint += 1) {
          endpoints[endpoint * 4 + 3] = reader.readBits(alphaBits);
        }
      }

      const modeHasPBits = (hasPBits & (1 << mode)) !== 0;
      if (modeHasPBits) {
        for (let endpoint = 0; endpoint < endpointCount; endpoint += 1) {
          for (let component = 0; component < 4; component += 1) {
            endpoints[endpoint * 4 + component] <<= 1;
          }
        }
        if (mode === 1) {
          const firstPBit = reader.readBits(1);
          const secondPBit = reader.readBits(1);
          for (let component = 0; component < 3; component += 1) {
            endpoints[component] |= firstPBit;
            endpoints[4 + component] |= secondPBit;
            endpoints[8 + component] |= firstPBit;
            endpoints[12 + component] |= secondPBit;
          }
        } else {
          for (let endpoint = 0; endpoint < endpointCount; endpoint += 1) {
            const pBit = reader.readBits(1);
            for (let component = 0; component < 4; component += 1) {
              endpoints[endpoint * 4 + component] |= pBit;
            }
          }
        }
      }

      for (let endpoint = 0; endpoint < endpointCount; endpoint += 1) {
        const endpointColorBits = colorBits + (modeHasPBits ? 1 : 0);
        for (let component = 0; component < 3; component += 1) {
          const endpointIndex = endpoint * 4 + component;
          endpoints[endpointIndex] =
            (endpoints[endpointIndex] << (8 - endpointColorBits)) | (endpoints[endpointIndex] >> endpointColorBits);
        }
        const endpointAlphaBits = alphaBits + (modeHasPBits ? 1 : 0);
        if (endpointAlphaBits > 0) {
          const endpointIndex = endpoint * 4 + 3;
          endpoints[endpointIndex] =
            (endpoints[endpointIndex] << (8 - endpointAlphaBits)) | (endpoints[endpointIndex] >> endpointAlphaBits);
        }
      }
      if (alphaBits === 0) {
        for (let endpoint = 0; endpoint < endpointCount; endpoint += 1) endpoints[endpoint * 4 + 3] = 255;
      }

      const colorIndexBits = mode === 0 || mode === 1 ? 3 : mode === 6 ? 4 : 2;
      const secondaryIndexBits = mode === 4 ? 3 : mode === 5 ? 2 : 0;
      const colorWeights = colorIndexBits === 2 ? BC7_WEIGHTS_2 : colorIndexBits === 3 ? BC7_WEIGHTS_3 : BC7_WEIGHTS_4;
      const secondaryWeights = secondaryIndexBits === 2 ? BC7_WEIGHTS_2 : BC7_WEIGHTS_3;

      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          const partitionValue =
            numPartitions === 1 ? (x === 0 && y === 0 ? 0x80 : 0) : partitionValues[partition * 16 + y * 4 + x];
          const indexBitCount = colorIndexBits - (partitionValue & 0x80 ? 1 : 0);
          indices[y * 4 + x] = reader.readBits(indexBitCount);
        }
      }

      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          const partitionValue =
            numPartitions === 1 ? (x === 0 && y === 0 ? 0x80 : 0) : partitionValues[partition * 16 + y * 4 + x];
          const subset = partitionValue & 0x03;
          const endpointIndex = subset * 2 * 4;
          const colorIndex = indices[y * 4 + x];
          let red: number;
          let green: number;
          let blue: number;
          let alpha: number;
          if (secondaryIndexBits === 0) {
            red = bc7Interpolate(endpoints[endpointIndex], endpoints[endpointIndex + 4], colorWeights, colorIndex);
            green = bc7Interpolate(
              endpoints[endpointIndex + 1],
              endpoints[endpointIndex + 5],
              colorWeights,
              colorIndex,
            );
            blue = bc7Interpolate(endpoints[endpointIndex + 2], endpoints[endpointIndex + 6], colorWeights, colorIndex);
            alpha = bc7Interpolate(
              endpoints[endpointIndex + 3],
              endpoints[endpointIndex + 7],
              colorWeights,
              colorIndex,
            );
          } else {
            const secondaryIndex = reader.readBits(x === 0 && y === 0 ? secondaryIndexBits - 1 : secondaryIndexBits);
            const primaryIndex = indexSelectionBit ? secondaryIndex : colorIndex;
            const primaryWeights = indexSelectionBit ? secondaryWeights : colorWeights;
            const alphaIndex = indexSelectionBit ? colorIndex : secondaryIndex;
            const alphaWeights = indexSelectionBit ? colorWeights : secondaryWeights;
            red = bc7Interpolate(endpoints[endpointIndex], endpoints[endpointIndex + 4], primaryWeights, primaryIndex);
            green = bc7Interpolate(
              endpoints[endpointIndex + 1],
              endpoints[endpointIndex + 5],
              primaryWeights,
              primaryIndex,
            );
            blue = bc7Interpolate(
              endpoints[endpointIndex + 2],
              endpoints[endpointIndex + 6],
              primaryWeights,
              primaryIndex,
            );
            alpha = bc7Interpolate(
              endpoints[endpointIndex + 3],
              endpoints[endpointIndex + 7],
              alphaWeights,
              alphaIndex,
            );
          }

          if (rotation === 1) [red, alpha] = [alpha, red];
          else if (rotation === 2) [green, alpha] = [alpha, green];
          else if (rotation === 3) [blue, alpha] = [alpha, blue];

          const outputX = blockX * 4 + x;
          const outputY = blockY * 4 + y;
          if (outputX >= width || outputY >= height) continue;
          const outputOffset = (outputY * width + outputX) * 4;
          pixels[outputOffset] = red;
          pixels[outputOffset + 1] = green;
          pixels[outputOffset + 2] = blue;
          pixels[outputOffset + 3] = alpha;
        }
      }
    }
  }

  return { width, height, pixels };
};

const decodeDxt1 = (buffer: Buffer): DdsRgbaImage => {
  if (buffer.length < DDS_HEADER_BYTES || buffer.subarray(0, 4).toString("ascii") !== "DDS ") {
    throw new Error("Invalid DDS file: missing header.");
  }

  const headerSize = readU32LE(buffer, 4);
  if (headerSize !== 124) throw new Error(`Unsupported DDS header size ${headerSize}.`);

  const height = readU32LE(buffer, 12);
  const width = readU32LE(buffer, 16);
  const fourCc = buffer.subarray(84, 88).toString("ascii");
  if (fourCc !== "DXT1") throw new Error(`Unsupported DDS format ${fourCc || "unknown"}; expected DXT1.`);
  if (width === 0 || height === 0) throw new Error(`Invalid DDS dimensions ${width}x${height}.`);

  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const dataBytes = blocksWide * blocksHigh * 8;
  if (DDS_HEADER_BYTES + dataBytes > buffer.length) {
    throw new Error(`Truncated DDS data: need ${dataBytes} bytes, file has ${buffer.length - DDS_HEADER_BYTES}.`);
  }

  const pixels = Buffer.alloc(width * height * 4);
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const blockOffset = DDS_HEADER_BYTES + (blockY * blocksWide + blockX) * 8;
      const colour0 = readU16LE(buffer, blockOffset);
      const colour1 = readU16LE(buffer, blockOffset + 2);
      const colour0Rgb = colour565(colour0);
      const colour1Rgb = colour565(colour1);
      const colourPalette = [
        [...colour0Rgb, 255],
        [...colour1Rgb, 255],
        [
          ...(colour0 > colour1
            ? interpolateColour(colour0Rgb, colour1Rgb, 2, 1)
            : interpolateColour(colour0Rgb, colour1Rgb, 1, 1)),
          255,
        ],
        ...(colour0 > colour1 ? [[...interpolateColour(colour0Rgb, colour1Rgb, 1, 2), 255]] : [[0, 0, 0, 0]]),
      ];
      const colourBits = buffer.readUInt32LE(blockOffset + 4);

      for (let localY = 0; localY < 4; localY += 1) {
        for (let localX = 0; localX < 4; localX += 1) {
          const x = blockX * 4 + localX;
          const y = blockY * 4 + localY;
          if (x >= width || y >= height) continue;

          const colourIndex = (colourBits >>> ((localY * 4 + localX) * 2)) & 0x03;
          const colour = colourPalette[colourIndex];
          const outputOffset = (y * width + x) * 4;
          pixels[outputOffset] = colour[0];
          pixels[outputOffset + 1] = colour[1];
          pixels[outputOffset + 2] = colour[2];
          pixels[outputOffset + 3] = colour[3];
        }
      }
    }
  }

  return { width, height, pixels };
};

const decodeDxt5 = (buffer: Buffer): DdsRgbaImage => {
  if (buffer.length < DDS_HEADER_BYTES || buffer.subarray(0, 4).toString("ascii") !== "DDS ") {
    throw new Error("Invalid DDS file: missing header.");
  }

  const headerSize = readU32LE(buffer, 4);
  if (headerSize !== 124) throw new Error(`Unsupported DDS header size ${headerSize}.`);

  const height = readU32LE(buffer, 12);
  const width = readU32LE(buffer, 16);
  const fourCc = buffer.subarray(84, 88).toString("ascii");
  if (fourCc !== "DXT5") throw new Error(`Unsupported DDS format ${fourCc || "unknown"}; expected DXT5.`);
  if (width === 0 || height === 0) throw new Error(`Invalid DDS dimensions ${width}x${height}.`);

  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const dataBytes = blocksWide * blocksHigh * 16;
  if (DDS_HEADER_BYTES + dataBytes > buffer.length) {
    throw new Error(`Truncated DDS data: need ${dataBytes} bytes, file has ${buffer.length - DDS_HEADER_BYTES}.`);
  }

  const pixels = Buffer.alloc(width * height * 4);
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const blockOffset = DDS_HEADER_BYTES + (blockY * blocksWide + blockX) * 16;
      const alpha0 = buffer[blockOffset];
      const alpha1 = buffer[blockOffset + 1];
      const alphaPalette = [alpha0, alpha1];
      if (alpha0 > alpha1) {
        for (let index = 1; index <= 6; index += 1) {
          alphaPalette.push(Math.floor(((7 - index) * alpha0 + index * alpha1) / 7));
        }
      } else {
        for (let index = 1; index <= 4; index += 1) {
          alphaPalette.push(Math.floor(((5 - index) * alpha0 + index * alpha1) / 5));
        }
        alphaPalette.push(0, 255);
      }

      const alphaBitsFirst = buffer[blockOffset + 2] | (buffer[blockOffset + 3] << 8) | (buffer[blockOffset + 4] << 16);
      const alphaBitsSecond =
        buffer[blockOffset + 5] | (buffer[blockOffset + 6] << 8) | (buffer[blockOffset + 7] << 16);
      const colour0 = readU16LE(buffer, blockOffset + 8);
      const colour1 = readU16LE(buffer, blockOffset + 10);
      const colour0Rgb = colour565(colour0);
      const colour1Rgb = colour565(colour1);
      const colourPalette = [
        colour0Rgb,
        colour1Rgb,
        interpolateColour(colour0Rgb, colour1Rgb, 2, 1),
        interpolateColour(colour0Rgb, colour1Rgb, 1, 2),
      ];
      const colourBits = buffer.readUInt32LE(blockOffset + 12);

      for (let localY = 0; localY < 4; localY += 1) {
        for (let localX = 0; localX < 4; localX += 1) {
          const x = blockX * 4 + localX;
          const y = blockY * 4 + localY;
          if (x >= width || y >= height) continue;

          const pixelIndex = localY * 4 + localX;
          const alphaBits = pixelIndex < 8 ? alphaBitsFirst : alphaBitsSecond;
          const alphaIndex = (alphaBits >>> ((pixelIndex % 8) * 3)) & 0x07;
          const colourIndex = (colourBits >>> (pixelIndex * 2)) & 0x03;
          const outputOffset = (y * width + x) * 4;
          const colour = colourPalette[colourIndex];
          pixels[outputOffset] = colour[0];
          pixels[outputOffset + 1] = colour[1];
          pixels[outputOffset + 2] = colour[2];
          pixels[outputOffset + 3] = alphaPalette[alphaIndex];
        }
      }
    }
  }

  return { width, height, pixels };
};

const decodeDds = (buffer: Buffer): DdsRgbaImage => {
  if (buffer.length < DDS_HEADER_BYTES || buffer.subarray(0, 4).toString("ascii") !== "DDS ") {
    throw new Error("Invalid DDS file: missing header.");
  }

  const headerSize = readU32LE(buffer, 4);
  if (headerSize !== 124) throw new Error(`Unsupported DDS header size ${headerSize}.`);
  const height = readU32LE(buffer, 12);
  const width = readU32LE(buffer, 16);
  if (width === 0 || height === 0) throw new Error(`Invalid DDS dimensions ${width}x${height}.`);

  const fourCc = buffer.subarray(84, 88).toString("ascii");
  if (fourCc === "DXT1") return decodeDxt1(buffer);
  if (fourCc === "DXT5") return decodeDxt5(buffer);
  if (fourCc === "DX10") {
    const dx10HeaderOffset = DDS_HEADER_BYTES;
    const dxgiFormat = readU32LE(buffer, dx10HeaderOffset);
    if (dxgiFormat === 98 || dxgiFormat === 99) return decodeBc7(buffer, width, height, dx10HeaderOffset + 20);
  }
  throw new Error(`Unsupported DDS format ${fourCc || "unknown"}.`);
};

const resizeRgba = (image: DdsRgbaImage, targetWidth: number, targetHeight: number): Buffer => {
  if (image.width === targetWidth && image.height === targetHeight) return image.pixels;

  const resized = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / targetWidth));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = (y * targetWidth + x) * 4;
      image.pixels.copy(resized, targetOffset, sourceOffset, sourceOffset + 4);
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

const encodePng = (pixels: Buffer, width: number, height: number): Buffer => {
  const scanlineBytes = width * 4 + 1;
  const scanlines = Buffer.alloc(scanlineBytes * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * scanlineBytes;
    scanlines[scanlineOffset] = 0;
    pixels.copy(scanlines, scanlineOffset + 1, y * width * 4, (y + 1) * width * 4);
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

export const encodeDdsAsPng = (buffer: Buffer, width: number, height: number): Buffer => {
  if (width <= 0 || height <= 0) throw new Error(`Invalid target image dimensions ${width}x${height}.`);
  const image = decodeDds(buffer);
  return encodePng(resizeRgba(image, width, height), width, height);
};
