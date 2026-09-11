import { describe, expect, it } from "vitest";

import { mapPointToCharacterCoordinate, projectCharacterCoordinateToMap } from "../src/esfMap/coordinates";

describe("extended map character coordinate projection", () => {
  const lookupFrame = {
    width: 2880,
    height: 1941,
    displayFlipY: false,
    characterCoordinateGrid: { width: 1440, height: 970, displayFlipY: true },
  };

  it("projects Karl's Altdorf coordinate into the lookup map and reverses it", () => {
    const mapPoint = projectCharacterCoordinateToMap(lookupFrame, 527, 648);
    expect(mapPoint).toEqual({ x: 1054, y: 643 });
    expect(mapPointToCharacterCoordinate(lookupFrame, mapPoint!)).toEqual({ x: 527, y: 648 });
  });

  it("uses the known Karaz-a-Karak coordinate in the same source grid", () => {
    expect(projectCharacterCoordinateToMap(lookupFrame, 736, 549)).toEqual({ x: 1473, y: 841 });
  });

  it("keeps the no-lookup region-grid Y orientation reversible", () => {
    const frame = { width: 1440, height: 970, displayFlipY: true };
    expect(projectCharacterCoordinateToMap(frame, 12, 20)).toEqual({ x: 12, y: 949 });
    expect(mapPointToCharacterCoordinate(frame, { x: 12, y: 949 })).toEqual({ x: 12, y: 20 });
    expect(projectCharacterCoordinateToMap(frame, 1440, 20)).toBeUndefined();
  });
});
