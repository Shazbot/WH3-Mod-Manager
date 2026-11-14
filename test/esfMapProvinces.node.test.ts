import { describe, expect, it } from "vitest";

import { buildBuildingsData } from "../src/buildingsData/data";
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

const map = {
  campaignKey: "camp",
  markers: [
    { key: "region_a", areaId: 1 },
    { key: "region_b", areaId: 2 },
    { key: "region_c", areaId: 3 },
    { key: "region_d", areaId: 4 },
  ],
  areas: [
    { areaId: 1, regionKey: "region_a", colour: [1, 1, 1] },
    { areaId: 2, regionKey: "region_b", colour: [2, 2, 2] },
    { areaId: 3, regionKey: "region_c", colour: [3, 3, 3] },
  ],
} as unknown as EsfMapPayload;

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
    const enriched = addProvinceDataToEsfMap(map, buildings);
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
        colour: [2, 2, 2],
        regionKeys: ["region_a", "region_b"],
        capitalRegion: "region_b",
      },
      { key: "prov_a", label: "Zeta", colour: [3, 3, 3], regionKeys: ["region_c"], capitalRegion: "region_c" },
    ]);
  });
});
