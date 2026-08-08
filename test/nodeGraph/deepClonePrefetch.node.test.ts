import { describe, expect, it, vi } from "vitest";

import { collectPlannedTables } from "../../src/nodeExecutor";
import type { DeepCloneTreeNode } from "../../src/nodeGraph/nodes/types";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const reverseReferences: Record<string, Record<string, string[][]>> = {
  main_units_tables: {
    unit: [
      ["units_to_groupings_tables", "unit"],
      ["ownership_junctions_tables", "unit"],
    ],
  },
  land_units_tables: {
    key: [["land_units_to_abilities_tables", "land_unit"]],
  },
  unit_castes_tables: {
    caste: [["never_reached_tables", "caste"]],
  },
};

const createTree = (): DeepCloneTreeNode => ({
  table: "main_units_tables",
  keyColumn: "unit",
  linkColumn: "",
  direction: "forward",
  selected: true,
  children: [
    {
      table: "land_units_tables",
      keyColumn: "key",
      linkColumn: "land_unit",
      direction: "forward",
      selected: true,
      children: [],
    },
    {
      table: "unit_castes_tables",
      keyColumn: "caste",
      linkColumn: "caste",
      direction: "forward",
      selected: false,
      children: [],
    },
  ],
});

describe("collectPlannedTables", () => {
  it("covers the tree plus every table that references a renamed key", () => {
    const planned = collectPlannedTables(createTree(), reverseReferences, []);

    expect(planned.toSorted()).toEqual([
      "land_units_tables",
      "land_units_to_abilities_tables",
      "main_units_tables",
      "ownership_junctions_tables",
      "units_to_groupings_tables",
    ]);
  });

  it("leaves out unchecked branches and what they would have reached", () => {
    const planned = collectPlannedTables(createTree(), reverseReferences, []);

    expect(planned).not.toContain("unit_castes_tables");
    expect(planned).not.toContain("never_reached_tables");
  });

  it("omits ignored tables so they are never read", () => {
    const planned = collectPlannedTables(createTree(), reverseReferences, [
      "ownership_junctions_tables",
    ]);

    expect(planned).not.toContain("ownership_junctions_tables");
    expect(planned).toContain("units_to_groupings_tables");
  });

  it("plans only the tree when auto-follow is off", () => {
    // The caller passes an empty index in that case.
    const planned = collectPlannedTables(createTree(), {}, []);

    expect(planned.toSorted()).toEqual(["land_units_tables", "main_units_tables"]);
  });

  it("keeps a keyless junction node without pulling in reverse references for it", () => {
    const tree = createTree();
    tree.children.push({
      table: "units_to_groupings_tables",
      keyColumn: "",
      linkColumn: "unit",
      direction: "reverse",
      selected: true,
      children: [],
    });

    const planned = collectPlannedTables(tree, reverseReferences, []);

    expect(planned).toContain("units_to_groupings_tables");
    expect(planned.filter((table) => table === "units_to_groupings_tables")).toHaveLength(1);
  });

  it("strips the db\\ prefix so names match the loader's lookups", () => {
    const tree = createTree();
    tree.table = "db\\main_units_tables";

    expect(collectPlannedTables(tree, {}, [])).toContain("main_units_tables");
  });

  it("returns nothing without a plan", () => {
    expect(collectPlannedTables(undefined, reverseReferences, [])).toEqual([]);
  });
});
