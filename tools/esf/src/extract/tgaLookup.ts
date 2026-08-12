export interface TgaLookupGrid {
  width: number;
  height: number;
  areaIds: Uint16Array;
  uniqueAreas: number;
  areaClassKeys: Uint32Array;
  areaClassCounts: Uint32Array;
  areaClassHex: string[];
}

const TGA_TYPE_COLOR_MAPPED = 1;

function readU16LE(buffer: Buffer, offset: number): number {
  if (offset + 2 > buffer.length) {
    throw new Error(`Unexpected EOF while reading u16 at ${offset}.`);
  }
  return buffer.readUInt16LE(offset);
}

export function extractLookupGridFromTga(buffer: Buffer): TgaLookupGrid {
  if (buffer.length < 18) {
    throw new Error("Invalid TGA file: missing header.");
  }

  const idLength = buffer[0];
  const colorMapType = buffer[1];
  const imageType = buffer[2];
  const colorMapLength = readU16LE(buffer, 5);
  const colorMapEntrySize = buffer[7];
  const width = readU16LE(buffer, 12);
  const height = readU16LE(buffer, 14);
  const pixelDepth = buffer[16];
  const imageDescriptor = buffer[17];
  const originIsTop = ((imageDescriptor >> 5) & 0x01) === 1;
  // Bit 4 (right-to-left ordering) is deliberately NOT honoured. Shipped WH3
  // lookup TGAs set it, but reading rows right-to-left mirrors the campaign map,
  // so these files evidently store pixels left-to-right regardless.

  if (colorMapType !== 1) {
    throw new Error(`Unsupported TGA color map type ${colorMapType}; expected 1.`);
  }
  if (imageType !== TGA_TYPE_COLOR_MAPPED) {
    throw new Error(`Unsupported TGA image type ${imageType}; expected ${TGA_TYPE_COLOR_MAPPED}.`);
  }
  if (width === 0 || height === 0) {
    throw new Error(`Invalid TGA dimensions ${width}x${height}.`);
  }
  if (pixelDepth !== 8 && pixelDepth !== 16) {
    throw new Error(`Unsupported TGA indexed pixel depth ${pixelDepth}; expected 8 or 16.`);
  }

  const colorMapEntryBytes = Math.ceil(colorMapEntrySize / 8);
  const pixelBytes = pixelDepth / 8;
  const colorMapBytes = colorMapLength * colorMapEntryBytes;
  const dataOffset = 18 + idLength + colorMapBytes;
  const totalPixels = width * height;
  const expectedBytes = totalPixels * pixelBytes;

  if (dataOffset + expectedBytes > buffer.length) {
    throw new Error(
      `Truncated TGA indexed data: need ${expectedBytes} bytes at ${dataOffset}, file has ${buffer.length - dataOffset}.`
    );
  }

  const areaIds = new Uint16Array(totalPixels);
  let maxAreaId = 0;

  for (let row = 0; row < height; row += 1) {
    const sourceRowOffset = dataOffset + row * width * pixelBytes;
    const targetRow = originIsTop ? height - 1 - row : row;
    const targetRowOffset = targetRow * width;

    for (let col = 0; col < width; col += 1) {
      const sourceOffset = sourceRowOffset + col * pixelBytes;
      const paletteIndex =
        pixelDepth === 8 ? buffer[sourceOffset] : readU16LE(buffer, sourceOffset);
      // The area id is the palette slot itself rather than a colour lookup, so
      // the raw index is used as-is; colorMapFirstIndex (18 in shipped files) is
      // intentionally not subtracted.
      const areaId = paletteIndex;

      areaIds[targetRowOffset + col] = areaId;
      if (areaId > maxAreaId) {
        maxAreaId = areaId;
      }
    }
  }

  const areaClassCounts = new Uint32Array(maxAreaId + 1);
  let uniqueAreas = 0;
  for (let index = 0; index < areaIds.length; index += 1) {
    const areaId = areaIds[index];
    if (areaClassCounts[areaId] === 0) {
      uniqueAreas += 1;
    }
    areaClassCounts[areaId] += 1;
  }

  const areaClassKeys = new Uint32Array(maxAreaId + 1);
  const areaClassHex = new Array<string>(maxAreaId + 1);
  for (let areaId = 0; areaId <= maxAreaId; areaId += 1) {
    areaClassKeys[areaId] = areaId;
    areaClassHex[areaId] = areaId.toString(16).padStart(4, "0");
  }

  return {
    width,
    height,
    areaIds,
    uniqueAreas,
    areaClassKeys,
    areaClassCounts,
    areaClassHex,
  };
}
