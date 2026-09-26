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
      subculture: "sc_a",
    },
    {
      key: "faction_b",
      localizedName: "Faction B",
    },
    {
      key: "faction_landless",
      localizedName: "Faction Landless",
      subculture: "sc_c",
    },
    {
      key: "faction_quest",
      localizedName: "Faction Quest",
      isQuestFaction: true,
    },
    {
      key: "faction_rebels",
      localizedName: "Faction Rebels",
      isRebel: true,
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

    expect(enriched.factions.slice(0, 2)).toEqual([
      {
        key: "faction_a",
        label: "Faction A",
        flagPath: "ui\\flags\\faction_a\\mon_64.png",
        flagUrl: "asset:ui\\flags\\faction_a\\mon_64.png",
        subculture: "sc_a",
        regionCount: 2,
      },
      { key: "faction_b", label: "Faction B", regionCount: 1 },
    ]);
  });

  it("lists landless factions after the owners so they can be given land", () => {
    const enriched = addFactionDataToEsfMap(map, buildings);

    expect(enriched.factions.map((faction) => faction.key)).toEqual(["faction_a", "faction_b", "faction_landless"]);
    expect(enriched.factions[2]).toEqual({
      key: "faction_landless",
      label: "Faction Landless",
      subculture: "sc_c",
      regionCount: 0,
    });
  });

  it("leaves quest and rebel factions out of the roster", () => {
    const enriched = addFactionDataToEsfMap(map, buildings);

    expect(enriched.factions.some((faction) => faction.key === "faction_quest")).toBe(false);
    expect(enriched.factions.some((faction) => faction.key === "faction_rebels")).toBe(false);
  });
});
