import { describe, expect, it } from "vitest";

import {
  getEnabledEntryNames,
  isPresetModEnabled,
  resolveEntriesToMods,
  toPresetEntries,
  toSnapshotEntries,
  withoutDuplicateEntries,
} from "../../src/config/presetEntries";

const createMod = (name: string, isEnabled: boolean, loadOrder?: number): Mod =>
  ({
    name,
    humanName: `human ${name}`,
    path: `/mods/${name}`,
    imgPath: `/mods/${name}.png`,
    workshopId: `id-${name}`,
    isEnabled,
    modDirectory: "/mods",
    isInData: false,
    loadOrder,
    author: "author",
    isDeleted: false,
    isMovie: false,
    size: 123,
    isSymbolicLink: false,
    tags: [],
  }) as Mod;

describe("preset entries", () => {
  it("treats a missing isEnabled as enabled", () => {
    expect(isPresetModEnabled({ name: "a.pack" })).toBe(true);
    expect(isPresetModEnabled({ name: "a.pack", isEnabled: true })).toBe(true);
    expect(isPresetModEnabled({ name: "a.pack", isEnabled: false })).toBe(false);
  });

  it("stores only membership and order for a saved preset", () => {
    const entries = toPresetEntries([
      createMod("alpha.pack", true, 3),
      createMod("beta.pack", true),
      createMod("gamma.pack", false, 7),
    ]);

    // disabled mods are dropped, isEnabled is implied, and no mod metadata comes along
    expect(entries).toEqual([{ name: "alpha.pack", loadOrder: 3 }, { name: "beta.pack" }]);
  });

  it("keeps disabled mods and their order in a snapshot", () => {
    const entries = toSnapshotEntries([createMod("alpha.pack", false), createMod("beta.pack", true, 1)]);

    expect(entries).toEqual([
      { name: "alpha.pack", isEnabled: false },
      { name: "beta.pack", loadOrder: 1 },
    ]);
  });

  it("collects enabled names from a mix of explicit and implicit entries", () => {
    const names = getEnabledEntryNames([
      { name: "alpha.pack" },
      { name: "beta.pack", isEnabled: false },
      { name: "gamma.pack", isEnabled: true },
    ]);

    expect([...names]).toEqual(["alpha.pack", "gamma.pack"]);
  });

  it("resolves entries to installed mods in entry order and skips missing ones", () => {
    const mods = [createMod("alpha.pack", false), createMod("beta.pack", false)];

    const resolved = resolveEntriesToMods(
      [{ name: "beta.pack" }, { name: "uninstalled.pack" }, { name: "alpha.pack" }],
      mods,
    );

    expect(resolved.map((mod) => mod.name)).toEqual(["beta.pack", "alpha.pack"]);
  });

  it("keeps the first of repeated entry names", () => {
    const entries = withoutDuplicateEntries([
      { name: "alpha.pack", loadOrder: 1 },
      { name: "alpha.pack", loadOrder: 5 },
      { name: "beta.pack" },
    ]);

    expect(entries).toEqual([{ name: "alpha.pack", loadOrder: 1 }, { name: "beta.pack" }]);
  });
});
