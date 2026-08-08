import { describe, expect, it } from "vitest";

import { copySelectedNodes, isTextEntryTarget, pasteNodes } from "../../src/nodeGraph/clipboard";

const createNode = (id: string, selected = false, data: Record<string, unknown> = {}) =>
  ({
    id,
    type: "filter",
    position: { x: 10, y: 20 },
    selected,
    data: { label: id, type: "filter", ...data },
  }) as never;

const createEdge = (source: string, target: string) =>
  ({ id: `edge-${source}-${target}`, source, target, sourceHandle: null, targetHandle: null }) as never;

const createIdFactory = () => {
  let next = 100;
  return () => `node_${next++}`;
};

describe("isTextEntryTarget", () => {
  it("recognises the elements the user types into", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isTextEntryTarget({ tagName } as never)).toBe(true);
    }
    expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: true } as never)).toBe(true);
  });

  it("treats the canvas and missing targets as fair game", () => {
    expect(isTextEntryTarget({ tagName: "DIV" } as never)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe("copySelectedNodes", () => {
  it("copies nothing when no node is selected", () => {
    expect(copySelectedNodes([createNode("a"), createNode("b")], [])).toBeUndefined();
  });

  it("copies every selected node, not just the first", () => {
    const copied = copySelectedNodes(
      [createNode("a", true), createNode("b"), createNode("c", true)],
      [],
    );

    expect(copied?.nodes.map((node) => node.id)).toEqual(["a", "c"]);
  });

  it("keeps edges that run between the copied nodes", () => {
    const copied = copySelectedNodes(
      [createNode("a", true), createNode("b", true)],
      [createEdge("a", "b")],
    );

    expect(copied?.edges.map((edge) => edge.id)).toEqual(["edge-a-b"]);
  });

  it("drops an edge with only one end copied", () => {
    // Keeping it would wire the copy back into the original.
    const copied = copySelectedNodes(
      [createNode("a", true), createNode("b")],
      [createEdge("a", "b"), createEdge("b", "a")],
    );

    expect(copied?.edges).toEqual([]);
  });

  it("takes a snapshot rather than a reference to the live node data", () => {
    const node = createNode("a", true, { filters: [{ column: "unit", value: "x" }] });
    const copied = copySelectedNodes([node], [])!;

    (node as { data: { filters: { value: string }[] } }).data.filters[0].value = "changed";

    expect((copied.nodes[0].data as { filters: { value: string }[] }).filters[0].value).toBe("x");
  });

  it("leaves out the editor callbacks so the copy can be cloned", () => {
    const copied = copySelectedNodes(
      [createNode("a", true, { onUpdateNodeData: () => undefined })],
      [],
    )!;

    expect((copied.nodes[0].data as Record<string, unknown>).onUpdateNodeData).toBeUndefined();
  });
});

describe("pasteNodes", () => {
  const clipboard = {
    nodes: [createNode("a"), createNode("b")],
    edges: [createEdge("a", "b")],
  };

  it("adds the copies alongside the originals with fresh ids", () => {
    const result = pasteNodes(
      { nodes: [createNode("a"), createNode("b")], edges: [createEdge("a", "b")] },
      clipboard,
      createIdFactory(),
    );

    expect(result.nodes.map((node) => node.id)).toEqual(["a", "b", "node_100", "node_101"]);
  });

  it("rewires the copied edges between the new nodes", () => {
    const result = pasteNodes({ nodes: [], edges: [] }, clipboard, createIdFactory());

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("node_100");
    expect(result.edges[0].target).toBe("node_101");
  });

  it("offsets the copies so they do not land exactly on the originals", () => {
    const result = pasteNodes({ nodes: [], edges: [] }, clipboard, createIdFactory());

    expect(result.nodes[0].position).toEqual({ x: 50, y: 60 });
  });

  it("selects the copies and deselects everything else", () => {
    const result = pasteNodes(
      { nodes: [createNode("a", true)], edges: [] },
      clipboard,
      createIdFactory(),
    );

    // So a second paste copies the copy, and repeated pastes walk across the canvas.
    expect(result.nodes.map((node) => node.selected)).toEqual([false, true, true]);
  });

  it("gives each paste its own data rather than sharing the clipboard's", () => {
    const createId = createIdFactory();
    const once = pasteNodes({ nodes: [], edges: [] }, clipboard, createId);
    const twice = pasteNodes(once, clipboard, createId);

    (once.nodes[0].data as { label: string }).label = "edited";

    expect((twice.nodes[2].data as { label: string }).label).toBe("a");
  });

  it("does nothing with an empty clipboard", () => {
    const state = { nodes: [createNode("a")], edges: [] };

    expect(pasteNodes(state, { nodes: [], edges: [] }, createIdFactory())).toBe(state);
  });
});
