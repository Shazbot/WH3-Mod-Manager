import { describe, expect, it } from "vitest";

import { applyConnection, rehydrateGraph } from "../../src/nodeGraph/connectionRules";

const createField = (name: string) => ({
  name,
  field_type: "String",
  is_key: false,
  default_value: "",
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

describe("Edit Text File chaining", () => {
  it("accepts a previous Edit Text File output and records the TableSelection input type", () => {
    const state = {
      nodes: [
        {
          id: "first",
          type: "edittextfile",
          position: { x: 0, y: 0 },
          data: {
            label: "First Edit",
            type: "edittextfile",
            inputType: "PackFiles",
            outputType: "TableSelection",
            textFileRules: [],
          },
        },
        {
          id: "second",
          type: "edittextfile",
          position: { x: 200, y: 0 },
          data: {
            label: "Second Edit",
            type: "edittextfile",
            inputType: "PackFiles",
            outputType: "TableSelection",
            textFileRules: [],
          },
        },
      ] as any[],
      edges: [] as any[],
    };

    const result = applyConnection(state, { source: "first", target: "second" }, {} as any);

    expect(result.accepted).toBe(true);
    expect(result.nodes.find((node) => node.id === "second")?.data.inputType).toBe("TableSelection");
  });
});

describe("rehydrateGraph", () => {
  it("hydrates lookup indexed metadata from the connected index input", () => {
    const state = {
      nodes: [
        {
          id: "source",
          type: "tableselectiondropdown",
          position: { x: 0, y: 0 },
          data: {
            label: "Table Dropdown",
            type: "tableselectiondropdown",
            selectedTable: "units",
            inputType: "PackFiles",
            outputType: "TableSelection",
            tableNames: [],
          },
        },
        {
          id: "lookup",
          type: "lookup",
          position: { x: 100, y: 0 },
          data: {
            label: "Lookup",
            type: "lookup",
            lookupColumn: "",
            joinType: "inner",
            inputType: "TableSelection",
            indexedInputType: "IndexedTable",
            outputType: "TableSelection",
            columnNames: [],
            connectedTableName: "",
            indexedTableColumns: [],
            DBNameToDBVersions: {},
            inputCount: 2,
          },
        },
      ] as any[],
      edges: [
        {
          id: "edge-source-lookup-input-index",
          source: "source",
          target: "lookup",
          targetHandle: "input-index",
        },
      ] as any[],
    };

    const result = rehydrateGraph(state, {
      DBNameToDBVersions: {
        units: [{ version: 1, fields: [createField("unit_key"), createField("health")] }],
      } as any,
    });

    expect(result.nodes[1].data.indexedTableName).toBe("units");
    expect(result.nodes[1].data.indexedInputType).toBe("TableSelection");
    expect(result.nodes[1].data.indexedTableColumnNames).toEqual(["unit_key", "health"]);
  });

  it("merges generate rows columns from all incoming sources during rehydration", () => {
    const state = {
      nodes: [
        {
          id: "dropdown",
          type: "tableselectiondropdown",
          position: { x: 0, y: 0 },
          data: {
            label: "Table Dropdown",
            type: "tableselectiondropdown",
            selectedTable: "units",
            inputType: "PackFiles",
            outputType: "TableSelection",
            tableNames: [],
          },
        },
        {
          id: "custom",
          type: "customrowsinput",
          position: { x: 0, y: 100 },
          data: {
            label: "Custom Rows",
            type: "customrowsinput",
            customRows: [],
            schemaColumns: [{ name: "custom_col", type: "StringU8" }],
            tableName: "custom_table",
            inputType: "CustomSchema",
            outputType: "TableSelection",
          },
        },
        {
          id: "generate",
          type: "generaterows",
          position: { x: 150, y: 50 },
          data: {
            label: "Generate Rows",
            type: "generaterows",
            sourceColumns: [],
            transformations: [],
            outputTables: [],
            inputType: "TableSelection",
            outputType: "TableSelection",
            outputCount: 1,
            columnNames: [],
            connectedTableName: "",
            DBNameToDBVersions: {},
          },
        },
      ] as any[],
      edges: [
        { id: "edge-dropdown", source: "dropdown", target: "generate" },
        { id: "edge-custom", source: "custom", target: "generate" },
      ] as any[],
    };

    const result = rehydrateGraph(state, {
      DBNameToDBVersions: {
        units: [{ version: 1, fields: [createField("unit_key"), createField("health")] }],
      } as any,
    });

    expect(new Set((result.nodes[2].data.columnNames || []) as string[])).toEqual(
      new Set(["unit_key", "health", "custom_col"]),
    );
    expect(new Set((result.nodes[2].data.inputColumnNames || []) as string[])).toEqual(
      new Set(["unit_key", "health", "custom_col"]),
    );
  });
});

describe("applyConnection", () => {
  it("keeps lookup source columns when the index table is connected second", () => {
    const context = {
      DBNameToDBVersions: {
        agent_subtypes_tables: [{ version: 1, fields: [createField("key"), createField("small_entity")] }],
        unique_agents_tables: [{ version: 1, fields: [createField("agent_subtype"), createField("forename")] }],
      },
    } as any;
    const state = {
      nodes: [
        {
          id: "source",
          type: "tableselectiondropdown",
          position: { x: 0, y: 0 },
          data: {
            label: "Source Table",
            type: "tableselectiondropdown",
            selectedTable: "agent_subtypes_tables",
            inputType: "PackFiles",
            outputType: "TableSelection",
            tableNames: [],
          },
        },
        {
          id: "index",
          type: "tableselectiondropdown",
          position: { x: 0, y: 100 },
          data: {
            label: "Index Table",
            type: "tableselectiondropdown",
            selectedTable: "unique_agents_tables",
            inputType: "PackFiles",
            outputType: "TableSelection",
            tableNames: [],
          },
        },
        {
          id: "lookup",
          type: "lookup",
          position: { x: 150, y: 50 },
          data: {
            label: "Lookup",
            type: "lookup",
            lookupColumn: "",
            joinType: "inner",
            inputType: "TableSelection",
            indexedInputType: "TableSelection",
            outputType: "TableSelection",
            columnNames: [],
            sourceInputColumns: [],
            connectedTableName: "",
            indexedTableColumnNames: [],
            DBNameToDBVersions: {},
            inputCount: 2,
          },
        },
      ] as any[],
      edges: [] as any[],
    };

    const withSource = applyConnection(
      state,
      { source: "source", target: "lookup", targetHandle: "input-source" },
      context,
    );
    expect(withSource.accepted).toBe(true);

    const withIndex = applyConnection(
      { nodes: withSource.nodes, edges: withSource.edges },
      { source: "index", target: "lookup", targetHandle: "input-index" },
      context,
    );
    expect(withIndex.accepted).toBe(true);

    const lookupData = withIndex.nodes.find((node) => node.id === "lookup")!.data;
    expect(lookupData.connectedTableName).toBe("agent_subtypes_tables");
    expect(lookupData.sourceInputColumns).toEqual(["key", "small_entity"]);
    expect(lookupData.indexedTableName).toBe("unique_agents_tables");
    expect(lookupData.indexedTableColumnNames).toEqual(["agent_subtype", "forename"]);
  });

  /** Mirrors the reported graph: a filter already feeding a dump, plus a branch handle. */
  const createFanInState = (targetType: string) => ({
    nodes: [
      {
        id: "filter",
        type: "filter",
        position: { x: 0, y: 0 },
        data: {
          label: "Filter",
          type: "filter",
          inputType: "TableSelection",
          outputType: "TableSelection",
          filters: [],
          columnNames: [],
          DBNameToDBVersions: {},
        },
      },
      {
        id: "branch",
        type: "conditionalbranch",
        position: { x: 0, y: 100 },
        data: {
          label: "Conditional Branch",
          type: "conditionalbranch",
          inputType: "TableSelection",
          outputType: "TableSelection",
          selectedFlowOptionId: "useTsv",
          columnNames: [],
        },
      },
      {
        id: "target",
        type: targetType,
        position: { x: 200, y: 50 },
        data: {
          label: targetType,
          type: targetType,
          inputType: "TableSelection",
          filename: "out.tsv",
        },
      },
    ] as any[],
    edges: [] as any[],
  });

  it("keeps both sources when a second table selection is connected to dump to tsv", () => {
    const state = createFanInState("dumptotsv");

    const withFilter = applyConnection(state, { source: "filter", target: "target", sourceHandle: "match" }, {} as any);
    expect(withFilter.accepted).toBe(true);

    const withBranch = applyConnection(
      { nodes: withFilter.nodes, edges: withFilter.edges },
      { source: "branch", target: "target", sourceHandle: "output-false" },
      {} as any,
    );

    // The executor merges multiple table selections for dumptotsv, so neither edge may be dropped.
    expect(withBranch.accepted).toBe(true);
    expect(withBranch.edges).toHaveLength(2);
    expect(withBranch.edges.map((edge) => edge.source).toSorted()).toEqual(["branch", "filter"]);
  });

  it("still replaces the previous edge for a node that takes a single input", () => {
    const state = createFanInState("columnselectiondropdown");

    const withFilter = applyConnection(state, { source: "filter", target: "target", sourceHandle: "match" }, {} as any);
    const withBranch = applyConnection(
      { nodes: withFilter.nodes, edges: withFilter.edges },
      { source: "branch", target: "target", sourceHandle: "output-false" },
      {} as any,
    );

    expect(withBranch.edges).toHaveLength(1);
    expect(withBranch.edges[0].source).toBe("branch");
  });

  it("accepts both conditional branch handles into separate targets", () => {
    const state = createFanInState("dumptotsv");

    const withTrue = applyConnection(
      state,
      { source: "branch", target: "target", sourceHandle: "output-true" },
      {} as any,
    );
    const withFalse = applyConnection(
      { nodes: withTrue.nodes, edges: withTrue.edges },
      { source: "branch", target: "target", sourceHandle: "output-false" },
      {} as any,
    );

    expect(withFalse.edges).toHaveLength(2);
    expect(withFalse.edges.map((edge) => edge.sourceHandle).toSorted()).toEqual(["output-false", "output-true"]);
  });
});
