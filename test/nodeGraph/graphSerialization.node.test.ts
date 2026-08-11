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
          openInWindows: true,
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
    expect(result.nodes[1].data.openInWindows).toBe(true);
    expect(result.connections).toEqual([]);
  });

  it("preserves the Edit Text File formatter through serialization", () => {
    const serialized = serializeNodeGraphState({
      nodes: [
        {
          id: "node_format",
          type: "edittextfile",
          position: { x: 0, y: 0 },
          data: {
            label: "Edit Text File",
            type: "edittextfile",
            inputType: "PackFiles",
            outputType: "TableSelection",
            textFileRules: [],
            textFileFormatter: "prettyXml",
          },
        },
      ] as any[],
      edges: [],
      flowOptions: [],
      isGraphEnabled: true,
      graphStartsEnabled: true,
    });

    expect(serialized.nodes[0].data.textFileFormatter).toBe("prettyXml");
    expect(deserializeNodeGraph(JSON.stringify(serialized)).nodes[0].data.textFileFormatter).toBe(
      "prettyXml",
    );
  });

  it("preserves the Dump to TSV filename through serialization and loading", () => {
    const nodes = [
      {
        id: "node_0",
        type: "dumptotsv",
        position: { x: 0, y: 0 },
        data: {
          label: "Dump to TSV",
          type: "dumptotsv",
          filename: "agent_subtypes.tsv",
          openInWindows: true,
          inputType: "TableSelection",
        },
      },
    ] as any[];

    const serializedGraph = serializeNodeGraphState({
      nodes,
      edges: [],
      flowOptions: [],
      isGraphEnabled: true,
      graphStartsEnabled: true,
    });
    const deserializedGraph = deserializeNodeGraph(JSON.stringify(serializedGraph));
    const executionGraph = prepareGraphForExecution({
      nodes: deserializedGraph.nodes,
      edges: deserializedGraph.edges,
    });

    expect(serializedGraph.nodes[0].data.filename).toBe("agent_subtypes.tsv");
    expect(deserializedGraph.nodes[0].data.filename).toBe("agent_subtypes.tsv");
    expect(executionGraph.nodes[0].data.filename).toBe("agent_subtypes.tsv");
  });

  it("preserves the deep clone plan through serialization and loading", () => {
    const cloneTree = {
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
      ],
    };
    const variantAxes = [
      {
        id: "shield",
        values: [
          {
            id: "shielded",
            suffix: "_shielded",
            overrides: [{ table: "land_units_tables", column: "shield", value: "1" }],
          },
        ],
      },
    ];

    const nodes = [
      {
        id: "node_0",
        type: "deepclone",
        position: { x: 0, y: 0 },
        data: {
          label: "Deep Clone",
          type: "deepclone",
          inputType: "TableSelection",
          outputType: "TableSelection",
          cloneTree,
          nameTemplate: "my_new_unit{variant}",
          useModdersPrefix: true,
          moddersPrefix: "abc_",
          variantAxes,
          columnOverrides: [{ table: "main_units_tables", column: "cost", value: "900" }],
          generateLoc: true,
          autoFollowReferences: false,
        },
      },
    ] as any[];

    const serializedGraph = serializeNodeGraphState({
      nodes,
      edges: [],
      flowOptions: [],
      isGraphEnabled: true,
      graphStartsEnabled: true,
    });
    const deserializedGraph = deserializeNodeGraph(JSON.stringify(serializedGraph));
    const executionGraph = prepareGraphForExecution({
      nodes: deserializedGraph.nodes,
      edges: deserializedGraph.edges,
    });

    expect(serializedGraph.nodes[0].data.cloneTree).toEqual(cloneTree);
    expect(deserializedGraph.nodes[0].data.variantAxes).toEqual(variantAxes);
    expect(deserializedGraph.nodes[0].data.nameTemplate).toBe("my_new_unit{variant}");
    expect(deserializedGraph.nodes[0].data.useModdersPrefix).toBe(true);
    // The author's prefix must travel with the flow: a game-start run happens on someone else's
    // machine, where the local setting is a different prefix or none at all.
    expect(serializedGraph.nodes[0].data.moddersPrefix).toBe("abc_");
    expect(deserializedGraph.nodes[0].data.moddersPrefix).toBe("abc_");
    expect(executionGraph.nodes[0].data.moddersPrefix).toBe("abc_");
    expect(executionGraph.nodes[0].data.cloneTree).toEqual(cloneTree);
    expect(executionGraph.nodes[0].data.columnOverrides).toEqual([
      { table: "main_units_tables", column: "cost", value: "900" },
    ]);
    // false must survive: a truthiness-based serializer would silently flip it back to the default.
    expect(deserializedGraph.nodes[0].data.autoFollowReferences).toBe(false);
    expect(executionGraph.nodes[0].data.autoFollowReferences).toBe(false);
  });

  it("preserves the anti-join lookup mode for execution", () => {
    const nodes = [
      {
        id: "node_0",
        type: "lookup",
        position: { x: 0, y: 0 },
        data: {
          label: "Lookup",
          type: "lookup",
          lookupColumn: "key",
          indexColumns: ["agent_subtype"],
          joinType: "anti",
          inputType: "TableSelection",
          outputType: "TableSelection",
        },
      },
    ] as any[];

    const executionGraph = prepareGraphForExecution({
      nodes,
      edges: [],
    });

    expect(executionGraph.nodes[0].data.joinType).toBe("anti");
  });

  it("preserves disabled nodes through saving, loading, and execution preparation", () => {
    const nodes = [
      {
        id: "node_0",
        type: "packedfiles",
        position: { x: 0, y: 0 },
        data: {
          label: "Pack Files",
          type: "packedfiles",
          isDisabled: true,
          textValue: "disabled.pack",
        },
      },
    ] as any[];

    const serializedGraph = serializeNodeGraphState({
      nodes,
      edges: [],
      flowOptions: [],
      isGraphEnabled: true,
      graphStartsEnabled: true,
    });
    const deserializedGraph = deserializeNodeGraph(JSON.stringify(serializedGraph));
    const executionGraph = prepareGraphForExecution({
      nodes: deserializedGraph.nodes,
      edges: deserializedGraph.edges,
    });

    expect(serializedGraph.nodes[0].data.isDisabled).toBe(true);
    expect(deserializedGraph.nodes[0].data.isDisabled).toBe(true);
    expect(executionGraph.nodes[0].data.isDisabled).toBe(true);
  });
});
