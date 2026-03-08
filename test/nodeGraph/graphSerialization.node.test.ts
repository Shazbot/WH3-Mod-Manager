import { describe, expect, it } from "vitest";

import {
  deserializeNodeGraph,
  prepareGraphForExecution,
  serializeNodeGraphState,
} from "../../src/nodeGraph/graphSerialization";

describe("graphSerialization", () => {
  it("serializes and deserializes a simple graph", () => {
    const nodes = [
      {
        id: "node_0",
        type: "packedfiles",
        position: { x: 10, y: 20 },
        data: {
          label: "Pack Files",
          type: "packedfiles",
          textValue: "foo.pack",
          outputType: "PackFiles",
        },
      },
      {
        id: "node_1",
        type: "tableselection",
        position: { x: 30, y: 40 },
        data: {
          label: "Table Selection",
          type: "tableselection",
          inputType: "PackFiles",
          outputType: "TableSelection",
        },
      },
    ] as any[];

    const edges = [
      {
        id: "edge-node_0-node_1",
        source: "node_0",
        target: "node_1",
        sourceHandle: "output",
        targetHandle: "input",
      },
    ] as any[];

    const serializedGraph = serializeNodeGraphState({
      nodes,
      edges,
      flowOptions: [],
      isGraphEnabled: true,
      graphStartsEnabled: false,
    });

    const deserializedGraph = deserializeNodeGraph(JSON.stringify(serializedGraph));

    expect(serializedGraph.metadata).toEqual({
      nodeCount: 2,
      connectionCount: 1,
    });
    expect(deserializedGraph.nodes).toHaveLength(2);
    expect(deserializedGraph.edges).toHaveLength(1);
    expect(deserializedGraph.edges[0]).toMatchObject({
      source: "node_0",
      target: "node_1",
      sourceHandle: "output",
      targetHandle: "input",
    });
    expect(deserializedGraph.nextNodeId).toBe(2);
  });

  it("prepares nodes for execution with flow options", () => {
    const nodes = [
      {
        id: "node_0",
        type: "packedfiles",
        position: { x: 0, y: 0 },
        data: {
          label: "Pack Files",
          type: "packedfiles",
          textValue: "{{pack_name}}",
          outputType: "PackFiles",
        },
      },
      {
        id: "node_1",
        type: "savechanges",
        position: { x: 100, y: 0 },
        data: {
          label: "Save Changes",
          type: "savechanges",
          packName: "{{pack_name}}",
          packedFileName: "output.tsv",
          inputType: "TableSelection",
        },
      },
    ] as any[];

    const result = prepareGraphForExecution({
      nodes,
      edges: [],
      currentPackName: "current.pack",
      flowOptions: [
        {
          id: "pack_name",
          name: "Pack Name",
          type: "textbox",
          value: "flow-value.pack",
        },
      ],
    });

    expect(result.nodes[0].data.textValue).toBe("flow-value.pack");
    expect(result.nodes[1].data.packName).toBe("flow-value.pack");
    expect(result.connections).toEqual([]);
  });
});
