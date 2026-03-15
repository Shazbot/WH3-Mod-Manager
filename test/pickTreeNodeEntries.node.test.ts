import { describe, expect, it, vi } from "vitest";

import { getSubtypesToLocalizedNames, NodeLinks, pickTreeNodeData, pickTreeNodeEntries } from "../src/skills";

describe("pickTreeNodeEntries", () => {
  it("keeps only the entries of the given nodes", () => {
    const record = { node_a: 1, node_b: 2, node_c: 3 };

    expect(pickTreeNodeEntries(record, new Set(["node_a", "node_c", "node_missing"]))).toEqual({
      node_a: 1,
      node_c: 3,
    });
  });

  it("keeps entries whose value is falsy", () => {
    expect(pickTreeNodeEntries({ node_a: 0, node_b: [] as string[] }, ["node_a", "node_b"])).toEqual({
      node_a: 0,
      node_b: [],
    });
  });
});

describe("pickTreeNodeData", () => {
  it("keeps the tree's nodes, including parents that are only known from its skills", () => {
    const nodeLinks: NodeLinks = {
      node_parent: [{ child: "node_child", linkType: "REQUIRED" }],
      node_other: [{ child: "node_other_child", linkType: "REQUIRED" }],
    };
    const nodeToSkillLocks = { node_child: ["lock"], node_other_child: ["other_lock"] };

    expect(pickTreeNodeData(["node_child"], [{ nodeId: "node_parent" }], nodeLinks, {}, nodeToSkillLocks)).toEqual({
      nodeLinks: { node_parent: nodeLinks.node_parent },
      nodeRequirements: { node_child: { single: ["node_parent"] } },
      nodeToSkillLocks: { node_child: ["lock"] },
    });
  });
});

describe("getSubtypesToLocalizedNames", () => {
  it("looks each subtype up once per loc packs, including subtypes added later", () => {
    const locs = {};
    const getLoc = vi.fn((locId: string) =>
      locId === "agent_subtypes_onscreen_name_override_kf" ? "Karl Franz" : undefined,
    );

    expect(getSubtypesToLocalizedNames(["kf", "unnamed"], locs, getLoc)).toEqual({ kf: "Karl Franz" });
    expect(getSubtypesToLocalizedNames(["kf", "unnamed", "added"], locs, getLoc)).toEqual({ kf: "Karl Franz" });
    expect(getLoc).toHaveBeenCalledTimes(3);

    // New loc packs come with a new data build, so the names are looked up again.
    getSubtypesToLocalizedNames(["kf"], {}, getLoc);
    expect(getLoc).toHaveBeenCalledTimes(4);
  });
});
