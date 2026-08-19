import { describe, expect, it } from "vitest";

import {
  getFilteredMods,
  getLoadOrderInsertionIndex,
  getModsSortedByEnabled,
  getModsSortedByAuthor,
  getModsSortedByHumanName,
  getModSortName,
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

describe("sorting by the human name", () => {
  const createTitledMod = (name: string, humanName: string) => createMod({ name, humanName });

  const sortedNames = (mods: Mod[]) => getModsSortedByHumanName(mods).map((mod) => mod.name);

  it("sorts by the title as it is displayed, not by the entities it is encoded with", () => {
    // "&#90;ulu" reads as Zulu once decoded; raw it sorts under "&", ahead of every letter.
    const mods = [
      createTitledMod("encoded.pack", "&#90;ulu"),
      createTitledMod("beta.pack", "Beta"),
      createTitledMod("alpha.pack", "Alpha"),
    ];

    expect(sortedNames(mods)).toEqual(["alpha.pack", "beta.pack", "encoded.pack"]);
  });

  it("decodes a doubly encoded title, which is how Steam hands them over", () => {
    const mods = [createTitledMod("second.pack", "Zulu"), createTitledMod("first.pack", "A &amp;amp; B")];

    expect(sortedNames(mods)).toEqual(["first.pack", "second.pack"]);
  });

  it("falls back to the pack name for a mod with no title, which is what its row shows", () => {
    // An untitled data mod used to sort to the very top of the list on its empty string.
    const mods = [
      createTitledMod("b_titled.pack", "Alpha"),
      createTitledMod("a_untitled.pack", ""),
      createTitledMod("c.pack", "Zulu"),
    ];

    expect(sortedNames(mods)).toEqual(["a_untitled.pack", "b_titled.pack", "c.pack"]);
    expect(sortedNames([createTitledMod("z_untitled.pack", "   "), createTitledMod("a.pack", "Alpha")])).toEqual([
      "a.pack",
      "z_untitled.pack",
    ]);
  });

  it("leaves what it cannot decode alone rather than mangling it", () => {
    expect(getModSortName(createTitledMod("a.pack", "50% &notanentity; off"))).toBe("50% &notanentity; off");
    expect(getModSortName(createTitledMod("a.pack", "Mod &#39;s name"))).toBe("Mod 's name");
  });
});

describe("sorting by the author", () => {
  const createAuthoredMod = (name: string, author: string) => createMod({ name, author });

  const sortedNames = (mods: Mod[], isReversed = false) =>
    getModsSortedByAuthor(mods, isReversed).map((mod) => mod.name);

  it("puts the mods that name no author at the end", () => {
    const mods = [
      createAuthoredMod("none.pack", ""),
      createAuthoredMod("zulu.pack", "Zulu"),
      createAuthoredMod("alpha.pack", "Alpha"),
    ];

    expect(sortedNames(mods)).toEqual(["alpha.pack", "zulu.pack", "none.pack"]);
  });

  it("keeps them there when the sort is reversed, rather than dragging them to the top", () => {
    const mods = [
      createAuthoredMod("none.pack", ""),
      createAuthoredMod("zulu.pack", "Zulu"),
      createAuthoredMod("alpha.pack", "Alpha"),
    ];

    expect(sortedNames(mods, true)).toEqual(["zulu.pack", "alpha.pack", "none.pack"]);
  });

  it("treats an author of nothing but spaces as no author at all", () => {
    const mods = [createAuthoredMod("blank.pack", "   "), createAuthoredMod("zulu.pack", "Zulu")];

    expect(sortedNames(mods)).toEqual(["zulu.pack", "blank.pack"]);
  });

  it("sorts the authorless mods among themselves by pack name, either way round", () => {
    const mods = [createAuthoredMod("b.pack", ""), createAuthoredMod("a.pack", "")];

    expect(sortedNames(mods)).toEqual(["a.pack", "b.pack"]);
    expect(sortedNames(mods, true)).toEqual(["a.pack", "b.pack"]);
  });

  it("sorts by the author as it is displayed, entities decoded", () => {
    // Raw, "&#90;ed" sorts under "&" and would lead the list instead of closing it.
    const mods = [createAuthoredMod("encoded.pack", "&#90;ed"), createAuthoredMod("alpha.pack", "Alpha")];

    expect(sortedNames(mods)).toEqual(["alpha.pack", "encoded.pack"]);
  });

  it("falls back to the pack name for two mods by the same author", () => {
    const mods = [createAuthoredMod("b.pack", "Zed"), createAuthoredMod("a.pack", "Zed")];

    expect(sortedNames(mods)).toEqual(["a.pack", "b.pack"]);
  });
});
