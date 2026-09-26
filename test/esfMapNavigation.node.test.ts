import { describe, expect, it } from "vitest";

import { nextFactionRegionMarker } from "../src/esfMap/navigation";
import type { EsfMapMarker } from "../src/esfMap/types";

const marker = (id: number, ownerFaction: string | null): EsfMapMarker => ({ id, ownerFaction }) as EsfMapMarker;

describe("ESF map faction region navigation", () => {
  const markers = [marker(1, "faction_a"), marker(2, "faction_b"), marker(3, "Faction_A")];

  it("starts at the first owned region and matches faction keys case insensitively", () => {
    expect(nextFactionRegionMarker(markers, "FACTION_A")?.id).toBe(1);
  });

  it("advances through only that faction's regions and wraps", () => {
    expect(nextFactionRegionMarker(markers, "faction_a", 1)?.id).toBe(3);
    expect(nextFactionRegionMarker(markers, "faction_a", 3)?.id).toBe(1);
  });

  it("restarts when ownership changed or the previous region is otherwise stale", () => {
    expect(nextFactionRegionMarker(markers, "faction_a", 2)?.id).toBe(1);
  });

  it("returns no region for a landless faction", () => {
    expect(nextFactionRegionMarker(markers, "faction_c")).toBeUndefined();
  });
});
