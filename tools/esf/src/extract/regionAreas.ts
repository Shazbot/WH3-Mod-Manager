import {
  parseCaabStringTables,
  parseCbabStringTables,
  readCaabHeader,
  walkCaabNodes,
} from "../esf/codecs/caabBinary";

const CODEC_CBAB = 0x0000abcb;

export interface RegionAreasGrid {
  startOffset: number;
  tokenCount: number;
  width: number;
  height: number;
  areaIds: Uint16Array;
  uniqueAreas: number;
  areaClassKeys: Uint32Array;
  areaClassCounts: Uint32Array;
  areaClassHex: string[];
}

interface HexMapPayload {
  width: number;
  height: number;
  payloadOffset: number;
  payload: Buffer;
}

const HEX_DIGITS = "0123456789abcdef";

function bytesToHex6(buffer: Buffer, offset: number): string {
  const bytes = buffer.subarray(offset, offset + 6);
  let text = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    text += HEX_DIGITS[(value >> 4) & 0x0f];
    text += HEX_DIGITS[value & 0x0f];
  }
  return text;
}

function hashToken6(buffer: Buffer, offset: number): number {
  const first = buffer.readUInt32BE(offset);
  const tail = buffer.readUInt16BE(offset + 4);
  let hash = first ^ tail;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function findHexMapPayload(buffer: Buffer): HexMapPayload {
  const header = readCaabHeader(buffer);
  const tables =
    header.codecId === CODEC_CBAB
      ? parseCbabStringTables(buffer, header.recordNamesOffset)
      : parseCaabStringTables(buffer, header.recordNamesOffset);

  let width: number | null = null;
  let height: number | null = null;
  let payload: Buffer | null = null;
  let payloadOffset: number | null = null;

  walkCaabNodes(
    buffer,
    { recordNamesOffset: header.recordNamesOffset },
    {
      recordNames: tables.recordNames,
      utf8ById: tables.utf8ById,
      utf16ById: tables.utf16ById,
    },
    {
      onValue(value, stack) {
        if (stack.length === 0 || stack[stack.length - 1] !== "HEX_MAP_DATA") {
          return;
        }

        if (value.kind === "value" && (value.type === "u16" || value.type === "u32")) {
          if (width === null) {
            width = Number(value.value);
            return;
          }
          if (height === null) {
            height = Number(value.value);
            return;
          }
        }

        if (value.kind === "array" && value.marker === 0x46 && payload === null) {
          payload = value.value.payload;
          payloadOffset = value.value.payloadOffset;
        }
      },
    }
  );

  if (width === null || height === null || !payload || payloadOffset === null) {
    throw new Error("Unable to locate HEX_MAP_DATA payload in CAAB ESF.");
  }

  return {
    width,
    height,
    payloadOffset,
    payload,
  };
}

export function extractRegionAreasGrid(buffer: Buffer): RegionAreasGrid {
  const hexMap = findHexMapPayload(buffer);
  const expectedBytes = hexMap.width * hexMap.height * 6;
  if (hexMap.payload.length !== expectedBytes) {
    throw new Error(
      `Unexpected HEX_MAP_DATA payload size ${hexMap.payload.length}; expected ${expectedBytes} for ${hexMap.width}x${hexMap.height}x6.`
    );
  }

  const classToAreaId = new Map<string, number>();
  const classHex: string[] = [];
  const classHash: number[] = [];
  const classCounts: number[] = [];
  const areaIds = new Uint16Array(hexMap.width * hexMap.height);

  for (let index = 0; index < areaIds.length; index += 1) {
    const tokenOffset = index * 6;
    const tokenHex = bytesToHex6(hexMap.payload, tokenOffset);
    let areaId = classToAreaId.get(tokenHex);
    if (areaId === undefined) {
      areaId = classToAreaId.size;
      if (areaId > 65535) {
        throw new Error("HEX_MAP_DATA contains too many unique token classes for Uint16 area IDs.");
      }
      classToAreaId.set(tokenHex, areaId);
      classHex.push(tokenHex);
      classHash.push(hashToken6(hexMap.payload, tokenOffset));
      classCounts.push(0);
    }

    areaIds[index] = areaId;
    classCounts[areaId] += 1;
  }

  return {
    startOffset: hexMap.payloadOffset,
    tokenCount: areaIds.length,
    width: hexMap.width,
    height: hexMap.height,
    areaIds,
    uniqueAreas: classToAreaId.size,
    areaClassKeys: Uint32Array.from(classHash),
    areaClassCounts: Uint32Array.from(classCounts),
    areaClassHex: classHex,
  };
}
