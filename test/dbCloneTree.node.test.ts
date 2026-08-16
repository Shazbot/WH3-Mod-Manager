import { describe, expect, it } from "vitest";

import {
  addUniqueDBCloneNode,
  getDBCloneNodeKey,
  getDBCloneSourceRowKey,
  getUniqueDBCloneNodes,
} from "../src/utility/dbCloneTree";

const node = (
  tableName: string,
  value: string,
  columnName = "key",
  isIndirectRef = false,
): IViewerTreeNodeWithData => ({
  name: `${tableName} ${columnName} : ${value}`,
  children: [],
  tableName,
  columnName,
  value,
  isIndirectRef,
});

describe("DB clone tree identity", () => {
  it("uses the table, key column and key value rather than the path", () => {
    const root = node("A", "a");
    const nodesByKey = new Map([[getDBCloneNodeKey(root), root]]);
    const b = addUniqueDBCloneNode(root, node("B", "b"), nodesByKey).node;
    const c = addUniqueDBCloneNode(b, node("C", "c"), nodesByKey).node;
    const nestedD = addUniqueDBCloneNode(c, node("D", "same-d"), nodesByKey);
    const directD = addUniqueDBCloneNode(root, node("D", "same-d"), nodesByKey);

    expect(nestedD.added).toBe(true);
    expect(directD.added).toBe(false);
    expect(directD.node).toBe(nestedD.node);
    expect(getUniqueDBCloneNodes(root).map(getDBCloneNodeKey)).toEqual([
      getDBCloneNodeKey(root),
      getDBCloneNodeKey(b),
      getDBCloneNodeKey(c),
      getDBCloneNodeKey(nestedD.node),
    ]);
  });

  it("upgrades an indirect dependency if the same row is later reached directly", () => {
    const root = node("A", "a");
    const nodesByKey = new Map([[getDBCloneNodeKey(root), root]]);
    const indirect = addUniqueDBCloneNode(root, node("D", "d", "key", true), nodesByKey);
    const direct = addUniqueDBCloneNode(root, node("D", "d"), nodesByKey);

    expect(direct.added).toBe(false);
    expect(direct.node).toBe(indirect.node);
    expect(direct.node.isIndirectRef).toBe(false);
  });

  it("keeps rows with different key identities distinct", () => {
    const root = node("A", "a");
    const nodesByKey = new Map([[getDBCloneNodeKey(root), root]]);

    expect(addUniqueDBCloneNode(root, node("D", "one"), nodesByKey).added).toBe(true);
    expect(addUniqueDBCloneNode(root, node("D", "two"), nodesByKey).added).toBe(true);
    expect(addUniqueDBCloneNode(root, node("OtherD", "one"), nodesByKey).added).toBe(true);
    expect(getUniqueDBCloneNodes(root)).toHaveLength(4);
  });

  it("deduplicates source rows by their declared key instead of their other values", () => {
    const first = [
      { name: "key", resolvedKeyValue: "same-d" },
      { name: "attribute", resolvedKeyValue: "mod override" },
    ];
    const second = [
      { name: "key", resolvedKeyValue: "same-d" },
      { name: "attribute", resolvedKeyValue: "vanilla value" },
    ];

    expect(getDBCloneSourceRowKey("D", first, ["key"])).toBe(getDBCloneSourceRowKey("D", second, ["key"]));
    expect(getDBCloneSourceRowKey("D", first, ["key"])).not.toBe(
      getDBCloneSourceRowKey("D", [{ name: "key", resolvedKeyValue: "other-d" }], ["key"]),
    );
  });
});
