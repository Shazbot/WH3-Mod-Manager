import { describe, expect, it } from "vitest";

import { applyConnection } from "../../src/nodeGraph/connectionRules";
import { buildQuickConnectionCandidates, hasDirectedConnection } from "../../src/nodeGraph/quickConnect";

describe("quick-connect handle selection", () => {
  it("always uses the first source handle and the first free target handle", () => {
    const candidates = buildQuickConnectionCandidates({
      sourceNodeId: "source",
      targetNodeId: "target",
      sourceHandles: [{ id: "output-1" }, { id: "output-2" }],
      targetHandles: [{ id: "input-0" }, { id: "input-1" }, { id: "input-2" }],
      edges: [
        {
          target: "target",
          targetHandle: "input-0",
        },
      ],
    });

    expect(candidates[0]).toEqual({
      source: "source",
      sourceHandle: "output-1",
      target: "target",
      targetHandle: "input-1",
    });
    expect(candidates.map((candidate) => candidate.targetHandle)).toEqual(["input-1", "input-2", "input-0"]);
  });

  it("falls back to the first input when every target handle is occupied", () => {
    const candidates = buildQuickConnectionCandidates({
      sourceNodeId: "source",
      targetNodeId: "target",
      sourceHandles: [{ id: null }],
      targetHandles: [{ id: "input-0" }, { id: "input-1" }],
      edges: [
        { target: "target", targetHandle: "input-0" },
        { target: "target", targetHandle: "input-1" },
      ],
    });

    expect(candidates[0]).toEqual({
      source: "source",
      sourceHandle: null,
      target: "target",
      targetHandle: "input-0",
    });
  });

  it("does not create candidates when either side has no usable handle", () => {
    expect(
      buildQuickConnectionCandidates({
        sourceNodeId: "source",
        targetNodeId: "target",
        sourceHandles: [],
        targetHandles: [{ id: null }],
        edges: [],
      }),
    ).toEqual([]);
  });

  it("recognizes when the same two nodes already have a directed connection", () => {
    expect(
      hasDirectedConnection(
        [{ source: "source", target: "target" }],
        "source",
        "target",
      ),
    ).toBe(true);
    expect(
      hasDirectedConnection(
        [{ source: "target", target: "source" }],
        "source",
        "target",
      ),
    ).toBe(false);
  });

  it("rejects an exact duplicate edge in the shared connection path", () => {
    const existingEdge = {
      id: "edge-source-target",
      source: "source",
      sourceHandle: null,
      target: "target",
      targetHandle: null,
    };
    const state = {
      nodes: [
        {
          id: "source",
          type: "packedfiles",
          position: { x: 0, y: 0 },
          data: { type: "packedfiles", outputType: "PackFiles" },
        },
        {
          id: "target",
          type: "tableselectiondropdown",
          position: { x: 100, y: 0 },
          data: { type: "tableselectiondropdown", inputType: "PackFiles" },
        },
      ],
      edges: [existingEdge],
    };

    const result = applyConnection(
      state,
      { source: "source", sourceHandle: null, target: "target", targetHandle: null },
      {},
    );

    expect(result.accepted).toBe(false);
    expect(result.edges).toEqual([existingEdge]);
  });
});
