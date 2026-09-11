import { describe, expect, it } from "vitest";

import { buildNeighbourAwareColours, MIN_MAP_NEIGHBOUR_COLOUR_DISTANCE } from "../src/esfMap/data";

const colourDistance = (first: readonly number[], second: readonly number[]) =>
  Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);

describe("ESF map region colours", () => {
  it("keeps every shared map edge above the neighbour distance threshold", () => {
    const width = 4;
    const height = 3;
    const componentIds = Uint32Array.from([0, 0, 1, 1, 0, 2, 2, 1, 3, 3, 2, 1]);
    const colours = buildNeighbourAwareColours(componentIds, width, height, 4);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (x + 1 < width && componentIds[index] !== componentIds[index + 1]) {
          expect(colourDistance(colours[componentIds[index]], colours[componentIds[index + 1]])).toBeGreaterThanOrEqual(
            MIN_MAP_NEIGHBOUR_COLOUR_DISTANCE,
          );
        }
        if (y + 1 < height && componentIds[index] !== componentIds[index + width]) {
          expect(
            colourDistance(colours[componentIds[index]], colours[componentIds[index + width]]),
          ).toBeGreaterThanOrEqual(MIN_MAP_NEIGHBOUR_COLOUR_DISTANCE);
        }
      }
    }
  });

  it("assigns the same colours again for the same map geometry", () => {
    const componentIds = Uint32Array.from([0, 1, 2, 0, 1, 2]);

    expect(buildNeighbourAwareColours(componentIds, 3, 2, 3)).toEqual(
      buildNeighbourAwareColours(componentIds, 3, 2, 3),
    );
  });
});
