import { describe, expect, it } from "vitest";

import {
  applyOwnershipEdits,
  formatRegionOwnershipJson,
  ownershipEditsFromImport,
  parseRegionOwnership,
  regionOwnership,
} from "../src/esfMap/ownership";
import type { EsfMapFaction, EsfMapPayload } from "../src/esfMap/types";

const factions: EsfMapFaction[] = [
  { key: "Faction_A", label: "Faction A", subculture: "sc_a", regionCount: 1 },
  { key: "faction_b", label: "Faction B", subculture: "sc_b", regionCount: 1 },
  { key: "faction_landless", label: "Faction Landless", subculture: "sc_c", regionCount: 0 },
];
const factionsByKey = new Map(factions.map((faction) => [faction.key.toLowerCase(), faction]));

const buildMap = () =>
  ({
    markers: [
      { id: 1, key: "region_a", ownerFaction: "Faction_A", subculture: "sc_a" },
      { id: 2, key: "region_b", ownerFaction: "faction_b", subculture: "sc_b" },
      { id: 3, key: "region_empty", ownerFaction: null, subculture: null },
    ],
    // region_a is traced as two disjoint areas, so both have to follow its owner.
    areas: [
      { componentId: 1, regionKey: "region_a", ownerFaction: "Faction_A", loops: [[0, 0, 1, 0, 1, 1]] },
      { componentId: 2, regionKey: "region_a", ownerFaction: "Faction_A", loops: [[5, 5, 6, 5, 6, 6]] },
      { componentId: 3, regionKey: "region_b", ownerFaction: "faction_b", loops: [[2, 2, 3, 2, 3, 3]] },
      { componentId: 4, regionKey: "region_empty", ownerFaction: null, loops: [[8, 8, 9, 8, 9, 9]] },
    ],
    factions,
    regionCount: 3,
    ownedRegionCount: 2,
  }) as unknown as EsfMapPayload;

describe("ESF map region ownership", () => {
  it("reads the ownership of every region in startpos order", () => {
    expect(regionOwnership(buildMap())).toEqual({
      region_a: "Faction_A",
      region_b: "faction_b",
      region_empty: null,
    });
  });

  it("writes the map.json shape, nulls included", () => {
    expect(formatRegionOwnershipJson(buildMap())).toBe(
      '{\n  "region_a": "Faction_A",\n  "region_b": "faction_b",\n  "region_empty": null\n}\n',
    );
  });

  it("round trips an exported file", () => {
    const map = buildMap();
    const parsed = parseRegionOwnership(formatRegionOwnershipJson(map));
    expect(parsed).toEqual({ ownership: regionOwnership(map) });
  });

  it("rejects anything that is not a flat object of faction keys", () => {
    expect(parseRegionOwnership("[]")).toHaveProperty("error");
    expect(parseRegionOwnership('"region_a"')).toHaveProperty("error");
    expect(parseRegionOwnership("{ not json")).toHaveProperty("error");
    expect(parseRegionOwnership('{ "region_a": 5 }')).toHaveProperty("error");
  });

  it("treats a blank owner as an empty region", () => {
    expect(parseRegionOwnership('{ "region_a": "  " }')).toEqual({ ownership: { region_a: null } });
  });

  it("keeps only the imported entries that differ from the startpos", () => {
    const map = buildMap();
    const imported = { region_a: "Faction_A", region_b: null, region_empty: "faction_landless" };

    expect(ownershipEditsFromImport(map, imported, factions)).toEqual({
      edits: { region_b: null, region_empty: "faction_landless" },
      unknownRegions: [],
      unknownFactions: [],
    });
  });

  it("reports regions the campaign does not have and factions the roster does not know", () => {
    const map = buildMap();
    const imported = { region_elsewhere: "faction_b", region_a: "faction_from_a_mod" };

    expect(ownershipEditsFromImport(map, imported, factions)).toEqual({
      edits: { region_a: "faction_from_a_mod" },
      unknownRegions: ["region_elsewhere"],
      unknownFactions: ["faction_from_a_mod"],
    });
  });

  it("normalises an imported faction key to the roster's casing", () => {
    const map = buildMap();

    expect(ownershipEditsFromImport(map, { region_b: "FACTION_A" }, factions).edits).toEqual({
      region_b: "Faction_A",
    });
  });

  it("matches region keys case insensitively", () => {
    const map = buildMap();

    expect(ownershipEditsFromImport(map, { REGION_B: "faction_landless" }, factions).edits).toEqual({
      region_b: "faction_landless",
    });
  });

  it("rewrites every area of an edited region and recounts the owners", () => {
    const map = buildMap();
    const edited = applyOwnershipEdits(map, { region_a: "faction_landless", region_empty: "faction_b" }, factionsByKey);

    expect(edited.areas.map((area) => area.ownerFaction)).toEqual([
      "faction_landless",
      "faction_landless",
      "faction_b",
      "faction_b",
    ]);
    expect(edited.markers.map((marker) => marker.ownerFaction)).toEqual(["faction_landless", "faction_b", "faction_b"]);
    expect(edited.ownedRegionCount).toBe(3);
    expect(edited.factions.map((faction) => [faction.key, faction.regionCount])).toEqual([
      ["Faction_A", 0],
      ["faction_b", 2],
      ["faction_landless", 1],
    ]);
  });

  it("takes the new owner's subculture and clears it when a region is emptied", () => {
    const map = buildMap();
    const edited = applyOwnershipEdits(map, { region_a: "faction_landless", region_b: null }, factionsByKey);

    expect(edited.markers[0].subculture).toBe("sc_c");
    expect(edited.markers[1].subculture).toBeNull();
  });

  it("returns the map itself when nothing is edited", () => {
    const map = buildMap();
    expect(applyOwnershipEdits(map, {}, factionsByKey)).toBe(map);
  });

  it("keeps untouched areas and markers by reference so their traced loops are never copied", () => {
    const map = buildMap();
    const edited = applyOwnershipEdits(map, { region_b: "Faction_A" }, factionsByKey);

    expect(edited.areas[0]).toBe(map.areas[0]);
    expect(edited.areas[1]).toBe(map.areas[1]);
    expect(edited.areas[3]).toBe(map.areas[3]);
    expect(edited.areas[2]).not.toBe(map.areas[2]);
    expect(edited.markers[0]).toBe(map.markers[0]);
    expect(edited.markers[1]).not.toBe(map.markers[1]);
  });
});
