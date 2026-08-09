import { flattenTree } from "react-accessible-treeview";
import { describe, expect, it } from "vitest";

import {
  MAX_AUTO_EXPANDED_DB_TABLES,
  getAutoExpandedDBGroupIds,
} from "../src/utility/dbTreeExpansion";

const treeWith = (groupCount: number) =>
  flattenTree({
    name: "",
    children: Array.from({ length: groupCount }, (_unused, index) => ({
      name: `table_${index}_tables`,
      children: [{ name: "data__", children: [] }],
    })),
  });

const groupNameById = (data: ReturnType<typeof flattenTree>) =>
  new Map(data.map((node) => [node.id, node.name]));

describe("getAutoExpandedDBGroupIds", () => {
  it("expands every group when the tree is short enough to scan", () => {
    const data = treeWith(MAX_AUTO_EXPANDED_DB_TABLES);
    const expanded = getAutoExpandedDBGroupIds(data);

    expect(expanded).toHaveLength(MAX_AUTO_EXPANDED_DB_TABLES);
    // Only the groups, never the root or the leaves.
    const names = groupNameById(data);
    expect(expanded.every((id) => names.get(id)?.endsWith("_tables"))).toBe(true);
  });

  it("expands nothing once there is one group too many", () => {
    expect(getAutoExpandedDBGroupIds(treeWith(MAX_AUTO_EXPANDED_DB_TABLES + 1))).toEqual([]);
  });

  it("handles a pack with no tables at all", () => {
    expect(getAutoExpandedDBGroupIds(treeWith(0))).toEqual([]);
    expect(getAutoExpandedDBGroupIds([])).toEqual([]);
  });

  it("ignores a leaf sitting at the top level rather than treating it as a group", () => {
    // Unsaved files can land at the root carrying a whole path as their name.
    const data = flattenTree({
      name: "",
      children: [
        { name: "main_units_tables", children: [{ name: "data__", children: [] }] },
        { name: "db\\land_units_tables\\loose", children: [] },
      ],
    });

    const expanded = getAutoExpandedDBGroupIds(data);

    expect(expanded).toHaveLength(1);
    expect(groupNameById(data).get(expanded[0])).toBe("main_units_tables");
  });
});
