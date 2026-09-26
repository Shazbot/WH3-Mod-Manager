import { describe, expect, it } from "vitest";

import { buildBuildingsData } from "../src/buildingsData/data";
import { addClimateDataToEsfMap, climateColour } from "../src/esfMap/climates";
import type { BuiltBuildingsData } from "../src/buildingsData/types";
import type { EsfMapPayload } from "../src/esfMap/types";

const buildings = {
  campaignMapSettlementClimates: {
    settlement_a: "temperate",
    settlement_b: "desert",
  },
  climates: [
    { key: "temperate", localizedName: "Temperate" },
    { key: "desert", localizedName: "Desert" },
  ],
  startPosSettlements: {
    "camp|region_a": [
      {
        campaign: "camp",
        region: "region_a",
        settlementId: "settlement_a",
        buildings: [],
      },
    ],
  },
} as unknown as BuiltBuildingsData;

const map = {
  campaignKey: "camp",
  markers: [
    { key: "region_a", settlementKey: "wh3_settlement_major_1" },
    { key: "region_b", settlementKey: "settlement_b" },
    { key: "region_c", settlementKey: null },
  ],
} as unknown as EsfMapPayload;

describe("ESF map climates", () => {
  it("reads the effective settlement-to-climate database rows", () => {
    const data = buildBuildingsData(
      {
        campaign_map_settlements_tables: [
          { settlement_id: "settlement_a", climate_type: "old" },
          { settlement_id: "settlement_a", climate_type: "temperate" },
          { settlement_id: "settlement_b", climate_type: "desert" },
        ],
        settlement_climate_types_tables: [{ type: "temperate" }, { type: "desert" }],
      },
      () => undefined,
    );

    expect(data.campaignMapSettlementClimates).toEqual({
      settlement_a: "temperate",
      settlement_b: "desert",
    });
    expect(data.climates).toEqual([
      { key: "desert", localizedName: "desert" },
      { key: "temperate", localizedName: "temperate" },
    ]);
  });

  it("joins settlement climates to regions and publishes stable colour/count options", () => {
    const enriched = addClimateDataToEsfMap(map, buildings);

    expect(enriched.climatesByRegion).toEqual({
      region_a: "temperate",
      region_b: "desert",
      region_c: null,
    });
    expect(enriched.climates).toEqual([
      {
        key: "desert",
        label: "Desert",
        colour: climateColour("desert", ["desert", "temperate"]),
        regionCount: 1,
      },
      {
        key: "temperate",
        label: "Temperate",
        colour: climateColour("temperate", ["desert", "temperate"]),
        regionCount: 1,
      },
    ]);
  });

  it("keeps an eleven-climate palette visibly separated", () => {
    const climateKeys = Array.from({ length: 11 }, (_, index) => `climate_${index}`);
    const colours = climateKeys.map((key) => climateColour(key, climateKeys));

    expect(new Set(colours.map((colour) => colour.join(","))).size).toBe(11);
    for (let first = 0; first < colours.length; first += 1) {
      for (let second = first + 1; second < colours.length; second += 1) {
        const distance = Math.hypot(
          colours[first][0] - colours[second][0],
          colours[first][1] - colours[second][1],
          colours[first][2] - colours[second][2],
        );
        expect(distance).toBeGreaterThan(60);
      }
    }
  });
});
