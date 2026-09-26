import { describe, expect, it } from "vitest";

import { computeRegionGeometricCenters } from "../src/esfMap/geometry";

describe("ESF map region geometric centers", () => {
  it("finds a region center from its polygon instead of its settlement marker", () => {
    expect(
      computeRegionGeometricCenters([
        {
          regionKey: "region_a",
          loops: [[10, 20, 30, 20, 30, 40, 10, 40]],
        },
      ]),
    ).toEqual(new Map([["region_a", { x: 20, y: 30 }]]));
  });

  it("combines disconnected polygon areas by their area", () => {
    expect(
      computeRegionGeometricCenters([
        { regionKey: "REGION_A", loops: [[0, 0, 2, 0, 2, 2, 0, 2]] },
        { regionKey: "region_a", loops: [[10, 0, 14, 0, 14, 2, 10, 2]] },
      ]),
    ).toEqual(new Map([["region_a", { x: 8.333333333333334, y: 1 }]]));
  });

  it("subtracts polygon holes from the geometric center", () => {
    expect(
      computeRegionGeometricCenters([
        {
          regionKey: "region_a",
          loops: [
            [0, 0, 10, 0, 10, 10, 0, 10],
            [3, 3, 3, 7, 7, 7, 7, 3],
          ],
        },
      ]),
    ).toEqual(new Map([["region_a", { x: 5, y: 5 }]]));
  });
});
