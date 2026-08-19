import { describe, expect, it } from "vitest";

import {
  getModCategories,
  groupModRowsByCategory,
  ModListModRow,
  uncategorizedCategoryName,
} from "../src/utility/frontend/modListLayout";

/** Only the fields the grouping reads; the rest of a row is presentation the pane fills in. */
const createMod = (name: string, categories?: string[], isEnabled = false) =>
  ({ name: `${name}.pack`, categories, isEnabled }) as Mod;

const createRow = (name: string, categories?: string[]): ModListModRow =>
  ({ kind: "mod", mod: createMod(name, categories) }) as ModListModRow;

/** A heading reads as "category notEnabled/total"; a mod row reads as its pack name. */
const getLabels = (rows: ReturnType<typeof groupModRowsByCategory>) =>
  rows.map((row) =>
    row.kind === "categoryHeader" ? `# ${row.category} ${row.notEnabledCount}/${row.modCount}` : row.mod.name,
  );

/** Grouping takes the rows to list and the wider set of mods the headings count. */
const group = (rows: ModListModRow[], categoryMods: Mod[], collapsedCategories = new Set<string>()) =>
  groupModRowsByCategory(rows, {
    categoryMods,
    alwaysEnabledModNames: new Set<string>(),
    collapsedCategories,
  });

describe("mod categories", () => {
  it("files a mod with no categories of its own under the uncategorized bucket", () => {
    expect(getModCategories({ name: "a.pack" } as Mod)).toEqual([uncategorizedCategoryName]);
    // An empty array is what a mod that had every category removed is left with.
    expect(getModCategories({ name: "a.pack", categories: [] } as unknown as Mod)).toEqual([uncategorizedCategoryName]);
    expect(getModCategories({ name: "a.pack", categories: ["Units"] } as unknown as Mod)).toEqual(["Units"]);
  });
});

describe("grouping mod rows by category", () => {
  it("opens every category with a heading, uncategorized first and the rest by name", () => {
    const mods = [createMod("alpha", ["Units"]), createMod("beta"), createMod("gamma", ["Graphics"])];
    const rows = group([createRow("alpha", ["Units"]), createRow("beta"), createRow("gamma", ["Graphics"])], mods);

    expect(getLabels(rows)).toEqual([
      `# ${uncategorizedCategoryName} 1/1`,
      "beta.pack",
      "# Graphics 1/1",
      "gamma.pack",
      "# Units 1/1",
      "alpha.pack",
    ]);
  });

  it("lists a mod under each of its categories, the way the categories tab does", () => {
    const rows = group([createRow("alpha", ["Units", "Graphics"])], [createMod("alpha", ["Units", "Graphics"])]);

    expect(getLabels(rows)).toEqual(["# Graphics 1/1", "alpha.pack", "# Units 1/1", "alpha.pack"]);
  });

  it("keeps the order the rows came in with inside a category, which is the list's current sort", () => {
    const names = ["zeta", "alpha", "mu"];
    const rows = group(
      names.map((name) => createRow(name, ["Units"])),
      names.map((name) => createMod(name, ["Units"])),
    );

    expect(getLabels(rows)).toEqual(["# Units 3/3", "zeta.pack", "alpha.pack", "mu.pack"]);
  });

  it("counts the enabled mods of a category too, and keeps the heading once they all are", () => {
    // Only the mods that are still off are listed; the rest are in the enabled pane.
    const mods = [
      createMod("alpha", ["Units"], true),
      createMod("beta", ["Units"]),
      createMod("gamma", ["Graphics"], true),
    ];
    const rows = group([createRow("beta", ["Units"])], mods);

    expect(getLabels(rows)).toEqual(["# Graphics 0/1", "# Units 1/2", "beta.pack"]);
  });

  it("counts an always enabled mod as enabled, whatever its own flag says", () => {
    const mods = [createMod("alpha", ["Units"]), createMod("beta", ["Units"])];
    const rows = groupModRowsByCategory([createRow("beta", ["Units"])], {
      categoryMods: mods,
      alwaysEnabledModNames: new Set(["alpha.pack"]),
      collapsedCategories: new Set(),
    });

    expect(getLabels(rows)).toEqual(["# Units 1/2", "beta.pack"]);
  });

  it("drops the rows of a collapsed category but still counts them on its heading", () => {
    const mods = [createMod("alpha", ["Units"]), createMod("beta", ["Units"]), createMod("gamma", ["Graphics"])];
    const rows = group(
      [createRow("alpha", ["Units"]), createRow("beta", ["Units"]), createRow("gamma", ["Graphics"])],
      mods,
      new Set(["Units"]),
    );

    expect(getLabels(rows)).toEqual(["# Graphics 1/1", "gamma.pack", "# Units 2/2"]);
    expect(rows.filter((row) => row.kind === "categoryHeader").map((row) => row.isCollapsed)).toEqual([false, true]);
  });

  it("has nothing to group when every mod was filtered out", () => {
    expect(group([], [])).toEqual([]);
    expect(group([], [], new Set(["Units"]))).toEqual([]);
  });

  it("keeps a row whose mod fell out of the wider set rather than dropping its category", () => {
    // The two lists are derived separately, so the rows are not guaranteed to be a subset.
    const rows = group([createRow("alpha", ["Units"])], []);

    expect(getLabels(rows)).toEqual(["# Units 1/1", "alpha.pack"]);
  });
});
