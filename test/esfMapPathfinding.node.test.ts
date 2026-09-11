import { describe, expect, it } from "vitest";

import { parsePathfindingCharacterGrid } from "../tools/esf/src";
import { isCharacterPointUsable, snapCharacterPointToUsable } from "../src/esfMap/pathfinding";

const MAGIC = Buffer.from([0x89, 0x50, 0x50, 0x44, 0x0d, 0x0a, 0x1a, 0x0a]);

const u16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const u32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const pathfindingFixture = (
  width: number,
  height: number,
  cells: Array<{ type: number; navigable?: boolean }>,
): Buffer => {
  const chunks = [MAGIC, u32(2), u32(1), u32(8), Buffer.from("region_a"), u16(width), u16(height)];
  for (const cell of cells) {
    chunks.push(Buffer.from([cell.navigable ? 0x80 : 0, 0, 0, 0, 0, 0]));
    chunks.push(u16(cell.type << 12));
  }
  return Buffer.concat(chunks);
};

const bitsetFor = (width: number, height: number, usable: number[]) => {
  const bitset = new Uint8Array(Math.ceil((width * height) / 8));
  for (const index of usable) bitset[index >> 3] |= 1 << (index & 7);
  return Buffer.from(bitset).toString("base64");
};

describe("campaign pathfinding character placement", () => {
  it("decodes only navigable army terrain from the PPD cell grid", () => {
    const parsed = parsePathfindingCharacterGrid(
      pathfindingFixture(3, 2, [
        { type: 0, navigable: true },
        { type: 2, navigable: true },
        { type: 1, navigable: true },
        { type: 6 },
        { type: 6, navigable: true },
        { type: 3, navigable: true },
      ]),
    );

    expect(parsed).toMatchObject({ version: 2, regionKeys: ["region_a"], width: 3, height: 2 });
    const usable = Array.from({ length: 6 }, (_, index) => (parsed.usableCells[index >> 3] >> (index & 7)) & 1);
    expect(usable).toEqual([1, 0, 0, 0, 1, 1]);
  });

  it("snaps an in-map character point to the nearest usable cell", () => {
    const map = {
      width: 5,
      height: 5,
      characterCoordinateGrid: { width: 5, height: 5, displayFlipY: true },
      characterPathfinding: {
        width: 5,
        height: 5,
        usableCells: bitsetFor(5, 5, [24]),
      },
    };

    expect(isCharacterPointUsable(map, { x: 4, y: 4 })).toBe(true);
    expect(isCharacterPointUsable(map, { x: 0, y: 0 })).toBe(false);
    expect(snapCharacterPointToUsable(map, { x: 0, y: 0 })).toEqual({ x: 4, y: 4 });
  });

  it("leaves off-map and unsupported-map points unchanged", () => {
    const map = {
      width: 5,
      height: 5,
      characterCoordinateGrid: { width: 5, height: 5, displayFlipY: true },
      characterPathfinding: null,
    };

    expect(snapCharacterPointToUsable(map, { x: 65535, y: 65535 })).toEqual({ x: 65535, y: 65535 });
    expect(snapCharacterPointToUsable(map, { x: 2, y: 3 })).toEqual({ x: 2, y: 3 });
  });
});
