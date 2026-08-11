import { describe, expect, it } from "vitest";

import { isRegisteredNodeType, nodeTypeSectionDefinitions } from "../../src/nodeGraph/nodeRegistry";
import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";

const listedTypes = nodeTypeSectionDefinitions.flatMap((section) => section.nodes.map((node) => node.type));

describe("node sidebar sections", () => {
  it("lists every registered node type, or it cannot be dragged into a graph", () => {
    const registeredTypes = Object.keys(reactFlowNodeTypes);
    const missing = registeredTypes.filter((type) => !listedTypes.includes(type as never));

    expect(missing).toEqual([]);
  });

  it("lists each type once, so the same node does not appear in two sections", () => {
    const duplicates = listedTypes.filter((type, index) => listedTypes.indexOf(type) !== index);

    expect(duplicates).toEqual([]);
  });

  it("only lists types that actually exist", () => {
    expect(listedTypes.filter((type) => !isRegisteredNodeType(type))).toEqual([]);
  });

  it("separates packs from the files inside them", () => {
    const sectionOf = (type: string) =>
      nodeTypeSectionDefinitions.find((section) => section.nodes.some((node) => node.type === type))
        ?.titleFallback;

    // Sources of packs - a pack is a mod.
    expect(sectionOf("packedfiles")).toBe("Pack Sources");
    expect(sectionOf("packfilesdropdown")).toBe("Pack Sources");
    expect(sectionOf("allenabledmods")).toBe("Pack Sources");
    expect(sectionOf("removepacksource")).toBe("Pack Sources");

    // Nodes that work on the files held inside a pack.
    expect(sectionOf("packfileoperations")).toBe("Packed Files");
    expect(sectionOf("edittextfile")).toBe("Packed Files");

    // Localisation is only about loc text now.
    expect(sectionOf("editloctext")).toBe("Localisation");
  });

  it("keeps the node that gates execution apart from the ones that drop rows", () => {
    const sectionOf = (type: string) =>
      nodeTypeSectionDefinitions.find((section) => section.nodes.some((node) => node.type === type))
        ?.titleFallback;

    // Conditional branch decides which downstream nodes run at all; it never touches a row.
    expect(sectionOf("conditionalbranch")).toBe("Control Flow");

    expect(sectionOf("filter")).toBe("Table Rows Filtering");
    expect(sectionOf("multifilter")).toBe("Table Rows Filtering");
    expect(sectionOf("deduplicate")).toBe("Table Rows Filtering");
  });
});
