export interface PathfindingRegionList {
  version: number;
  regionKeys: string[];
}

const MAGIC = Buffer.from([0x89, 0x50, 0x50, 0x44, 0x0d, 0x0a, 0x1a, 0x0a]);

function readU32LE(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) {
    throw new Error(`Unexpected EOF while reading u32 at ${offset}.`);
  }
  return buffer.readUInt32LE(offset);
}

export function parsePathfindingRegionKeys(buffer: Buffer): PathfindingRegionList {
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
      throw new Error(
        `Invalid pathfinding.ppd file: region key ${index} length ${length} exceeds file bounds.`
      );
    }
    regionKeys.push(buffer.toString("utf8", offset, end));
    offset = end;
  }

  return {
    version,
    regionKeys,
  };
}
