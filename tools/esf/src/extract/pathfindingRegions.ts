export interface PathfindingRegionList {
  version: number;
  regionKeys: string[];
}

export interface PathfindingCharacterGrid extends PathfindingRegionList {
  width: number;
  height: number;
  /** One bit per cell; set when a character can stand on the cell. */
  usableCells: Uint8Array;
  /** One bit per cell; set for sea and settlement-sea cells. */
  seaCells: Uint8Array;
  /** One bit per cell; set for river and settlement-river cells. */
  riverCells: Uint8Array;
  /** One bit per cell; set for beach and settlement-beach cells. */
  beachCells: Uint8Array;
}

const MAGIC = Buffer.from([0x89, 0x50, 0x50, 0x44, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHARACTER_TERRAIN_TYPES = new Set([0, 1, 3, 4, 5, 6, 7, 8, 9]);
const SEA_TERRAIN_TYPES = new Set([1, 8]);
const RIVER_TERRAIN_TYPES = new Set([6, 9]);
const BEACH_TERRAIN_TYPES = new Set([3, 7]);

function readU32LE(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) {
    throw new Error(`Unexpected EOF while reading u32 at ${offset}.`);
  }
  return buffer.readUInt32LE(offset);
}

function readU16LE(buffer: Buffer, offset: number): number {
  if (offset + 2 > buffer.length) {
    throw new Error(`Unexpected EOF while reading u16 at ${offset}.`);
  }
  return buffer.readUInt16LE(offset);
}

function readPathfindingHeader(buffer: Buffer): { version: number; regionKeys: string[]; offset: number } {
  if (buffer.length < 16) {
    throw new Error("Invalid pathfinding.ppd file: too small.");
  }
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Invalid pathfinding.ppd file: unexpected magic header.");
  }

  let offset = MAGIC.length;
  const version = readU32LE(buffer, offset);
  offset += 4;
  const regionCount = readU32LE(buffer, offset);
  offset += 4;

  const regionKeys: string[] = [];
  for (let index = 0; index < regionCount; index += 1) {
    const length = readU32LE(buffer, offset);
    offset += 4;
    const end = offset + length;
    if (end > buffer.length) {
      throw new Error(`Invalid pathfinding.ppd file: region key ${index} length ${length} exceeds file bounds.`);
    }
    regionKeys.push(buffer.toString("utf8", offset, end));
    offset = end;
  }
  return { version, regionKeys, offset };
}

export function parsePathfindingRegionKeys(buffer: Buffer): PathfindingRegionList {
  const { version, regionKeys } = readPathfindingHeader(buffer);
  return { version, regionKeys };
}

/**
 * Reads the cell-level character passability from the pathfinding grid.
 *
 * The first six bytes of each cell are directional edge records. Bit 7 is the
 * navigability flag. The upper nibble of the final u16 is the hex type. Land,
 * sea, river, and beach cells are character-placeable when at least one edge
 * is navigable; impassable cells remain excluded. The terrain masks retain
 * the water and beach distinctions for display.
 */
export function parsePathfindingCharacterGrid(buffer: Buffer): PathfindingCharacterGrid {
  const header = readPathfindingHeader(buffer);
  let offset = header.offset;
  const width = readU16LE(buffer, offset);
  offset += 2;
  const height = readU16LE(buffer, offset);
  offset += 2;
  if (width === 0 || height === 0) throw new Error("Invalid pathfinding.ppd file: empty cell grid.");

  const cellCount = width * height;
  const cellDataEnd = offset + cellCount * 8;
  if (cellDataEnd > buffer.length) {
    throw new Error("Invalid pathfinding.ppd file: cell grid exceeds file bounds.");
  }

  const usableCells = new Uint8Array(Math.ceil(cellCount / 8));
  const seaCells = new Uint8Array(Math.ceil(cellCount / 8));
  const riverCells = new Uint8Array(Math.ceil(cellCount / 8));
  const beachCells = new Uint8Array(Math.ceil(cellCount / 8));
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    let hasNavigableEdge = false;
    for (let direction = 0; direction < 6; direction += 1) {
      if ((buffer[offset + direction] & 0x80) !== 0) hasNavigableEdge = true;
    }
    const hexType = buffer.readUInt16LE(offset + 6) >>> 12;
    const cellByte = cellIndex >> 3;
    const cellBit = 1 << (cellIndex & 7);
    if (SEA_TERRAIN_TYPES.has(hexType)) seaCells[cellByte] |= cellBit;
    if (RIVER_TERRAIN_TYPES.has(hexType)) riverCells[cellByte] |= cellBit;
    if (BEACH_TERRAIN_TYPES.has(hexType)) beachCells[cellByte] |= cellBit;
    // Land, sea, beach, settlement land/sea/beach, bridge cliff, river, and settlement river.
    const isCharacterTerrain = CHARACTER_TERRAIN_TYPES.has(hexType);
    if (isCharacterTerrain && hasNavigableEdge) {
      usableCells[cellByte] |= cellBit;
    }
    offset += 8;
  }

  return { ...header, width, height, usableCells, seaCells, riverCells, beachCells };
}
