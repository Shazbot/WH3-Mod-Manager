import { flattenTree } from "react-accessible-treeview";
import { describe, expect, it } from "vitest";

import {
  MAX_AUTO_EXPANDED_DB_TABLES,
  getAutoExpandedDBGroupIds,
  getLoneTableToOpen,
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

describe("getLoneTableToOpen", () => {
  const treeFrom = (groups: Array<{ name: string; children: Array<{ name: string; children?: [] }> }>) => {
    const data = flattenTree({ name: "", children: groups.map((group) => ({ ...group })) });
    const nodeById = new Map(data.map((node) => [node.id, node]));
    const groupNamed = (name: string) => data.find((node) => node.name === name)!;
    return { nodeById, groupNamed };
  };

  it("returns the single table in a group, so expanding opens it", () => {
    const { nodeById, groupNamed } = treeFrom([
      { name: "kv_morale_tables", children: [{ name: "data__" }] },
    ]);

    expect(getLoneTableToOpen(groupNamed("kv_morale_tables"), nodeById)?.name).toBe("data__");
  });

  it("returns nothing when the group holds more than one table", () => {
    const { nodeById, groupNamed } = treeFrom([
      { name: "main_units_tables", children: [{ name: "data__" }, { name: "mod_units" }] },
    ]);

    expect(getLoneTableToOpen(groupNamed("main_units_tables"), nodeById)).toBeUndefined();
  });

  it("returns nothing for an empty group", () => {
    const { nodeById, groupNamed } = treeFrom([{ name: "empty_tables", children: [] }]);

    expect(getLoneTableToOpen(groupNamed("empty_tables"), nodeById)).toBeUndefined();
  });

  it("returns nothing when the only child is another group, which has nothing to open", () => {
    const { nodeById, groupNamed } = treeFrom([
      { name: "unusedtables", children: [{ name: "main_units_tables", children: [] }] },
    ]);
    // Give the child a child of its own so it reads as a group rather than a table.
    const child = nodeById.get(groupNamed("unusedtables").children[0])!;
    child.children = ["some-descendant"];

    expect(getLoneTableToOpen(groupNamed("unusedtables"), nodeById)).toBeUndefined();
  });
});
