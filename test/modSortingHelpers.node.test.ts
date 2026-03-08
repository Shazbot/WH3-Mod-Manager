import { describe, expect, it } from "vitest";

import { getFilteredMods } from "../src/modSortingHelpers";

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
});
