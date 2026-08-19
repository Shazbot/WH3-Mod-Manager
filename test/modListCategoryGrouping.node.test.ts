import { describe, expect, it } from "vitest";

import {
  getModCategories,
  groupModRowsByCategory,
  ModListModRow,
  uncategorizedCategoryName,
} from "../src/utility/frontend/modListLayout";

/** Only the fields the grouping reads; the rest of a row is presentation the pane fills in. */
const createRow = (name: string, categories?: string[]): ModListModRow =>
  ({ kind: "mod", mod: { name: `${name}.pack`, categories } as Mod }) as ModListModRow;

const getLabels = (rows: ReturnType<typeof groupModRowsByCategory>) =>
  rows.map((row) => (row.kind === "categoryHeader" ? `# ${row.category} (${row.modCount})` : row.mod.name));

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
    const rows = groupModRowsByCategory(
      [createRow("alpha", ["Units"]), createRow("beta"), createRow("gamma", ["Graphics"])],
      new Set(),
    );

    expect(getLabels(rows)).toEqual([
      `# ${uncategorizedCategoryName} (1)`,
      "beta.pack",
      "# Graphics (1)",
      "gamma.pack",
      "# Units (1)",
      "alpha.pack",
    ]);
  });

  it("lists a mod under each of its categories, the way the categories tab does", () => {
    const rows = groupModRowsByCategory([createRow("alpha", ["Units", "Graphics"])], new Set());

    expect(getLabels(rows)).toEqual(["# Graphics (1)", "alpha.pack", "# Units (1)", "alpha.pack"]);
  });

  it("keeps the order the rows came in with inside a category, which is the list's current sort", () => {
    const rows = groupModRowsByCategory(
      [createRow("zeta", ["Units"]), createRow("alpha", ["Units"]), createRow("mu", ["Units"])],
      new Set(),
    );

    expect(getLabels(rows)).toEqual(["# Units (3)", "zeta.pack", "alpha.pack", "mu.pack"]);
  });

  it("drops the rows of a collapsed category but still counts them on its heading", () => {
    const rows = groupModRowsByCategory(
      [createRow("alpha", ["Units"]), createRow("beta", ["Units"]), createRow("gamma", ["Graphics"])],
      new Set(["Units"]),
    );

    expect(getLabels(rows)).toEqual(["# Graphics (1)", "gamma.pack", "# Units (2)"]);
    expect(rows.filter((row) => row.kind === "categoryHeader").map((row) => row.isCollapsed)).toEqual([false, true]);
  });

  it("has nothing to group when every row was filtered out", () => {
    expect(groupModRowsByCategory([], new Set())).toEqual([]);
    // A category that no longer has a visible mod leaves no heading behind either.
    expect(groupModRowsByCategory([], new Set(["Units"]))).toEqual([]);
  });
});
