import { describe, expect, it } from "vitest";

import {
  getFilteredMods,
  getLoadOrderInsertionIndex,
  getModsSortedByEnabled,
  getSparseLoadOrderByModName,
  sortModsAsInEntries,
  sortByNameAndLoadOrder,
} from "../src/modSortingHelpers";

const createMod = (overrides: Partial<Mod>): Mod =>
  ({
    name: "example.pack",
    humanName: "",
    author: "",
    ...overrides,
  }) as Mod;

describe("getFilteredMods", () => {
  it("filters with valid regex patterns", () => {
    const mods = [
      createMod({ name: "alpha.pack", humanName: "Alpha", author: "One" }),
      createMod({ name: "beta.pack", humanName: "Beta", author: "Two" }),
    ];

    expect(getFilteredMods(mods, "/alp.*/", false).map((mod) => mod.name)).toEqual(["alpha.pack"]);
  });

  it("falls back to substring matching for invalid regex patterns", () => {
    const mods = [
      createMod({ name: "alpha.pack", humanName: "Alpha(", author: "One" }),
      createMod({ name: "beta.pack", humanName: "Beta", author: "Two" }),
    ];

    expect(() => getFilteredMods(mods, "/alpha(/", false)).not.toThrow();
    expect(getFilteredMods(mods, "/alpha(/", false).map((mod) => mod.name)).toEqual(["alpha.pack"]);
  });

  it("keeps ordered mods without appending undefined entries", () => {
    const mods = [
      createMod({ name: "alpha.pack", loadOrder: 0 }),
      createMod({ name: "beta.pack", loadOrder: 1 }),
      createMod({ name: "gamma.pack", loadOrder: 2 }),
    ];

    expect(sortByNameAndLoadOrder(mods).map((mod) => mod.name)).toEqual(["alpha.pack", "beta.pack", "gamma.pack"]);
  });

  it("keeps preset mods first while sorting absent mods deterministically", () => {
    const alpha = createMod({ name: "alpha.pack" });
    const beta = createMod({ name: "beta.pack" });
    const gamma = createMod({ name: "gamma.pack" });
    const delta = createMod({ name: "delta.pack" });

    expect(sortModsAsInEntries([alpha, beta, gamma, delta], [gamma, alpha]).map((mod) => mod.name)).toEqual([
      "gamma.pack",
      "alpha.pack",
      "beta.pack",
      "delta.pack",
    ]);
  });

  it("accounts for the removed source row when placing a mod downward", () => {
    expect(getLoadOrderInsertionIndex(1, 0, 3)).toBe(0);
    expect(getLoadOrderInsertionIndex(1, 1, 3)).toBe(1);
    expect(getLoadOrderInsertionIndex(1, 2, 3)).toBe(1);
    expect(getLoadOrderInsertionIndex(1, 4, 3)).toBe(3);
    expect(getLoadOrderInsertionIndex(-1, 2, 3)).toBe(2);
  });

  it("keeps automatic mods automatic when reindexing a sparse custom order", () => {
    const orderedMods = [
      createMod({ name: "alpha.pack", loadOrder: 0 }),
      createMod({ name: "delta.pack", loadOrder: undefined }),
      createMod({ name: "gamma.pack", loadOrder: 3 }),
      createMod({ name: "beta.pack", loadOrder: undefined }),
    ];

    expect([...getSparseLoadOrderByModName(orderedMods, "beta.pack")]).toEqual([
      ["alpha.pack", 0],
      ["gamma.pack", 2],
      ["beta.pack", 3],
    ]);
  });

  it("uses load order as the secondary enabled-state sort in both directions", () => {
    const enabledFirst = createMod({ name: "enabled-first.pack", isEnabled: true });
    const disabledFirst = createMod({ name: "disabled-first.pack", isEnabled: false });
    const enabledSecond = createMod({ name: "enabled-second.pack", isEnabled: true });
    const disabledSecond = createMod({ name: "disabled-second.pack", isEnabled: false });
    const mods = [disabledSecond, enabledSecond, disabledFirst, enabledFirst];
    const loadOrder = [enabledFirst, disabledFirst, enabledSecond, disabledSecond];

    expect(getModsSortedByEnabled(mods, loadOrder, true).map((mod) => mod.name)).toEqual([
      "enabled-first.pack",
      "enabled-second.pack",
      "disabled-first.pack",
      "disabled-second.pack",
    ]);
    expect(getModsSortedByEnabled(mods, loadOrder, false).map((mod) => mod.name)).toEqual([
      "disabled-first.pack",
      "disabled-second.pack",
      "enabled-first.pack",
      "enabled-second.pack",
    ]);
  });
});
