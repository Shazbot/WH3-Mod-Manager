import { describe, expect, it } from "vitest";

import { buildBuildingsData } from "../src/buildingsData/data";
import { buildNeighbourAwareColours, MIN_MAP_NEIGHBOUR_COLOUR_DISTANCE } from "../src/esfMap/data";
import { addProvinceDataToEsfMap } from "../src/esfMap/provinces";
import type { BuiltBuildingsData } from "../src/buildingsData/types";
import type { EsfMapPayload } from "../src/esfMap/types";

const buildings = {
  regionProvinces: {
    Region_A: { province: "prov_b", isCapital: false },
    region_b: { province: "prov_b", isCapital: true },
    region_c: { province: "prov_a", isCapital: true },
    region_off_map: { province: "prov_off", isCapital: true },
  },
  provinces: [
    { key: "prov_a", localizedName: "Zeta" },
    { key: "prov_b", localizedName: "Alpha" },
    { key: "prov_off", localizedName: "Off" },
  ],
} as unknown as BuiltBuildingsData;

// Three distinct palette colours: a 1x3 strip of components that all touch in a row.
const [paletteA, paletteB] = buildNeighbourAwareColours(Uint32Array.of(0, 1, 2), 3, 1, 3);

const square = (x: number) => [[x, 0, x + 1, 0, x + 1, 1, x, 1]];

const mapWith = (regionCLeft: number, capitalColourC: number[]) =>
  ({
    campaignKey: "camp",
    markers: [
      { key: "region_a", areaId: 1 },
      { key: "region_b", areaId: 2 },
      { key: "region_c", areaId: 3 },
      { key: "region_d", areaId: 4 },
    ],
    areas: [
      { areaId: 1, regionKey: "region_a", colour: paletteB, loops: square(0) },
      { areaId: 2, regionKey: "region_b", colour: paletteA, loops: square(1) },
      { areaId: 3, regionKey: "region_c", colour: capitalColourC, loops: square(regionCLeft) },
    ],
  }) as unknown as EsfMapPayload;

const colourDistance = (first: number[], second: number[]) =>
  Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);

describe("ESF map provinces", () => {
  it("reads the effective region-to-province rows", () => {
    const data = buildBuildingsData(
      {
        region_to_province_junctions_tables: [
          { province: "old", region: "r1", is_capital: "true" },
          { province: "p1", region: "r1", is_capital: "false" },
          { province: "p1", region: "r2", is_capital: "true" },
        ],
        provinces_tables: [{ key: "p1" }],
      },
      () => undefined,
    );
    expect(data.regionProvinces).toEqual({
      r1: { province: "p1", isCapital: false },
      r2: { province: "p1", isCapital: true },
    });
    expect(data.provinces).toEqual([{ key: "p1", localizedName: "p1" }]);
  });

  it("joins regions case-insensitively, keeps only on-map provinces, uses capital colour and sorts by label", () => {
    // region_c sits apart from the other province, so both keep their capital colours.
    const enriched = addProvinceDataToEsfMap(mapWith(5, paletteB), buildings);
    expect(enriched.provincesByRegion).toEqual({
      region_a: "prov_b",
      region_b: "prov_b",
      region_c: "prov_a",
      region_d: null,
    });
    expect(enriched.provinces).toEqual([
      {
        key: "prov_b",
        label: "Alpha",
        colour: paletteA,
        regionKeys: ["region_a", "region_b"],
        capitalRegion: "region_b",
      },
      { key: "prov_a", label: "Zeta", colour: paletteB, regionKeys: ["region_c"], capitalRegion: "region_c" },
    ]);
  });

  it("recolours bordering provinces whose capitals share a colour", () => {
    // region_c touches region_b (prov_b's capital) and both capitals start with the same colour.
    const enriched = addProvinceDataToEsfMap(mapWith(2, paletteA), buildings);
    const [alpha, zeta] = enriched.provinces;
    expect(colourDistance(alpha.colour, zeta.colour)).toBeGreaterThanOrEqual(MIN_MAP_NEIGHBOUR_COLOUR_DISTANCE);
    expect([alpha.colour, zeta.colour]).toContainEqual(paletteA);
  });
});
