import { describe, expect, it } from "vitest";

import { addSettlementTypeDataToEsfMap } from "../src/esfMap/settlementTypes";
import type { BuiltBuildingsData } from "../src/buildingsData/types";
import type { EsfMapPayload } from "../src/esfMap/types";

const binding = (chain: string, settlementType: string, exclude = false) => ({ chain, settlementType, exclude });

const buildings = {
  settlementTypes: [
    { key: "dark_fortress", localizedName: "Dark Fortress" },
    { key: "minor", localizedName: "Minor" },
  ],
  settlementTypeBindings: {
    fortress_settlement: [binding("fortress_settlement", "dark_fortress")],
    // A special building kept through conversion names many types and marks no site.
    kept_special: ["dark_fortress", "minor", "a", "b"].map((type) => binding("kept_special", type)),
    secondary_only: [binding("secondary_only", "minor")],
  },
  regionSlotTemplates: {
    "camp|region_fortress": [
      { campaign: "camp", region: "region_fortress", slotTemplate: "fortress_primary", slotType: "primary", id: "1" },
    ],
    "camp|region_plain": [
      { campaign: "camp", region: "region_plain", slotTemplate: "plain_primary", slotType: "primary", id: "2" },
      { campaign: "camp", region: "region_plain", slotTemplate: "plain_secondary", slotType: "secondary", id: "3" },
    ],
  },
  permittedByTemplate: {
    fortress_primary: [{ slotTemplate: "fortress_primary", chain: "fortress_settlement", remove: false }],
    plain_primary: [{ slotTemplate: "plain_primary", chain: "kept_special", remove: false }],
    plain_secondary: [{ slotTemplate: "plain_secondary", chain: "secondary_only", remove: false }],
  },
  superChains: {},
  superChainsByTemplate: {},
  chainSetParents: {},
  chainSetItems: {},
  chains: { fortress_settlement: {}, kept_special: {}, secondary_only: {} },
} as unknown as BuiltBuildingsData;

const map = {
  campaignKey: "camp",
  markers: [
    { key: "region_fortress", settlementType: null },
    { key: "region_plain", settlementType: "mod_type" },
  ],
} as unknown as EsfMapPayload;

describe("ESF map settlement types", () => {
  it("publishes every settlement type the DB or the start pos names", () => {
    expect(addSettlementTypeDataToEsfMap(map, buildings).settlementTypes.map((option) => option.key)).toEqual([
      "a",
      "b",
      "dark_fortress",
      "minor",
      "mod_type",
    ]);
  });

  it("reads site types from primary slot settlement chains only", () => {
    expect(addSettlementTypeDataToEsfMap(map, buildings).settlementSiteTypesByRegion).toEqual({
      region_fortress: ["dark_fortress"],
      region_plain: [],
    });
  });
});
