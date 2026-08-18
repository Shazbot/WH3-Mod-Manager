import { describe, expect, it } from "vitest";

import { addFactionDataToEsfMap, factionFlagPath } from "../src/esfMap/factions";
import type { BuiltBuildingsData } from "../src/buildingsData/types";
import type { EsfMapPayload } from "../src/esfMap/types";

const buildings = {
  factions: [
    {
      key: "faction_a",
      localizedName: "Faction A",
      flagPath: "ui/flags/faction_a",
    },
    {
      key: "faction_b",
      localizedName: "Faction B",
    },
  ],
} as unknown as BuiltBuildingsData;

const map = {
  markers: [
    { key: "region_a", ownerFaction: "faction_a" },
    { key: "region_a_2", ownerFaction: "faction_a" },
    { key: "region_b", ownerFaction: "faction_b" },
    { key: "region_unowned", ownerFaction: null },
  ],
  factions: [],
} as unknown as EsfMapPayload;

describe("ESF map factions", () => {
  it("turns a faction flag folder into the mon_64 asset path", () => {
    expect(factionFlagPath("ui/flags/faction_a/")).toBe("ui\\flags\\faction_a\\mon_64.png");
  });

  it("groups regions by their ESF owner and attaches faction-table flags", () => {
    const enriched = addFactionDataToEsfMap(map, buildings, (path) => `asset:${path}`);

    expect(enriched.factions).toEqual([
      {
        key: "faction_a",
        label: "Faction A",
        flagPath: "ui\\flags\\faction_a\\mon_64.png",
        flagUrl: "asset:ui\\flags\\faction_a\\mon_64.png",
        regionCount: 2,
      },
      { key: "faction_b", label: "Faction B", regionCount: 1 },
    ]);
  });
});
