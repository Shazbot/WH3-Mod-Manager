import { describe, expect, it } from "vitest";

import { addSettlementTypeDataToEsfMap } from "../src/esfMap/settlementTypes";
import type { BuiltBuildingsData } from "../src/buildingsData/types";
import type { EsfMapPayload } from "../src/esfMap/types";

const buildings = {
  subcultures: [{ key: "emp_sub", localizedName: "Empire", culture: "emp" }],
  factions: [],
  settlementTypes: [
    { key: "capital", localizedName: "Capital" },
    { key: "minor", localizedName: "Minor" },
  ],
  settlementTypeBindings: {
    chain_a: [{ chain: "chain_a", settlementType: "capital", exclude: false }],
    chain_b: [{ chain: "chain_b", settlementType: "minor", exclude: false }],
  },
  regionSlotTemplates: {
    "camp|region_capital": [
      { campaign: "camp", region: "region_capital", slotTemplate: "template", slotType: "secondary", id: "1" },
    ],
  },
  foreignRegionSlotTemplates: {},
  permittedByTemplate: {
    template: [{ slotTemplate: "template", chain: "chain_a", remove: false }],
  },
  superChains: {},
  superChainsByTemplate: {},
  chainSetParents: {},
  chainSetItems: {},
  chains: { chain_a: {} },
  levelKeysByChain: {},
  availabilitySetsByChain: {},
  availabilitiesBySetId: {},
  startPosSettlements: {},
} as unknown as BuiltBuildingsData;

const map = {
  campaignKey: "camp",
  markers: [
    {
      id: 0,
      regionIndex: 0,
      key: "region_capital",
      gx: 1,
      gy: 1,
      areaId: 0,
      componentId: 0,
      ownerFaction: null,
      subculture: "emp_sub",
      settlementKey: null,
    },
    {
      id: 1,
      regionIndex: 1,
      key: "region_empty",
      gx: 2,
      gy: 2,
      areaId: 1,
      componentId: 1,
      ownerFaction: null,
      subculture: null,
      settlementKey: null,
    },
  ],
} as unknown as EsfMapPayload;

describe("ESF map settlement types", () => {
  it("publishes every settlement type and the types each region can use", () => {
    const enriched = addSettlementTypeDataToEsfMap(map, buildings);

    expect(enriched.settlementTypes).toEqual([
      { key: "capital", label: "Capital — capital" },
      { key: "minor", label: "Minor — minor" },
    ]);
    expect(enriched.settlementTypesByRegion).toEqual({
      region_capital: ["capital"],
      region_empty: [],
    });
  });
});
