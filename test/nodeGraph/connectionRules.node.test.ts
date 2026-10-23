import { describe, expect, it } from "vitest";

import { applyConnection, rehydrateGraph } from "../../src/nodeGraph/connectionRules";
import { applyNodeDataPatch } from "../../src/nodeGraph/editorState";
import { nativePatchColumnsToSchema } from "../../src/nodeGraph/nativePatchSchema";
import { serializeNodeGraphState } from "../../src/nodeGraph/graphSerialization";

describe("Native Patch schema output", () => {
  const schema = [
    { name: "flag", type: "StringU8" },
    { name: "unit_set", type: "StringU8" },
  ];
  const state = () => ({
    nodes: [
      {
        id: "patch",
        type: "nativepatch",
        position: { x: 0, y: 0 },
        data: {
          type: "nativepatch",
          outputType: "TableSelection",
          tableBindings: ["mappings", "other"],
          tableSchemas: {
            mappings: schema,
            other: [{ name: "another_column", type: "I32" }],
          },
        },
      },
      {
        id: "rows",
        type: "customrowsinput",
        position: { x: 400, y: 0 },
        data: {
          type: "customrowsinput",
          inputType: "CustomSchema",
          outputType: "TableSelection",
          schemaColumns: [],
          customRows: [{ flag: "user_flag", unit_set: "user_set" }],
        },
      },
      {
        id: "save",
        type: "savechanges",
        position: { x: 400, y: 300 },
        data: { type: "savechanges", inputType: "TableSelection" },
      },
    ] as any[],
    edges: [] as any[],
  });

  it("connects the selected table schema and fills the row editor columns", () => {
    const graph = applyConnection(
      state(),
      { source: "patch", sourceHandle: "output-schema:mappings", target: "rows", targetHandle: "input-schema" },
      {},
    );
    expect(graph.accepted).toBe(true);
    expect(graph.nodes.find((node) => node.id === "rows")?.data.schemaColumns).toEqual(schema);
    const other = applyConnection(
      state(),
      { source: "patch", sourceHandle: "output-schema:other", target: "rows", targetHandle: "input-schema" },
      {},
    );
    expect(other.nodes.find((node) => node.id === "rows")?.data.schemaColumns).toEqual([
      { name: "another_column", type: "I32" },
    ]);
  });

  it("keeps schema handles distinct from contribution output and rejects unknown schemas", () => {
    expect(
      applyConnection(
        state(),
        { source: "patch", sourceHandle: "output-schema:removed", target: "rows", targetHandle: "input-schema" },
        {},
      ).accepted,
    ).toBe(false);
    expect(
      applyConnection(
        state(),
        { source: "patch", sourceHandle: "output", target: "rows", targetHandle: "input-schema" },
        {},
      ).accepted,
    ).toBe(false);
    expect(
      applyConnection(
        state(),
        { source: "patch", sourceHandle: "output-schema:mappings", target: "save", targetHandle: "input" },
        {},
      ).accepted,
    ).toBe(false);
    expect(
      applyConnection(state(), { source: "patch", sourceHandle: "output", target: "save", targetHandle: "input" }, {})
        .accepted,
    ).toBe(true);
  });

  it("refreshes connected columns on a template change and when loading saved graphs", () => {
    const graph = applyConnection(
      state(),
      { source: "patch", sourceHandle: "output-schema:mappings", target: "rows", targetHandle: "input-schema" },
      {},
    );
    const columns = [{ name: "updated_flag", type: "StringU8" as const }];
    const updated = applyNodeDataPatch(graph, "patch", { tableSchemas: { mappings: columns } }, {});
    const rows = updated.nodes.find((node) => node.id === "rows")!;
    expect(rows.data.schemaColumns).toEqual(columns);
    expect(rows.data.customRows).toEqual([{ flag: "user_flag", unit_set: "user_set" }]);
    rows.data.schemaColumns = [];
    expect(rehydrateGraph(updated, {}).nodes.find((node) => node.id === "rows")?.data.schemaColumns).toEqual(columns);
  });

  it("preserves table schemas and schema handle types in saved flows", () => {
    const graph = applyConnection(
      state(),
      { source: "patch", sourceHandle: "output-schema:mappings", target: "rows", targetHandle: "input-schema" },
      {},
    );
    const saved = serializeNodeGraphState({
      ...graph,
      flowOptions: [],
      isGraphEnabled: true,
      graphStartsEnabled: true,
    });
    expect(saved.nodes.find((node) => node.id === "patch")?.data.tableSchemas?.mappings).toEqual(schema);
    expect(saved.connections[0]).toMatchObject({ sourceHandle: "output-schema:mappings", sourceType: "CustomSchema" });
  });

  it("maps native input types without truncating unsigned u32 values", () => {
    expect(
      nativePatchColumnsToSchema(["ascii", "bool", "i32", "u32", "f32"].map((type) => ({ name: type, type }))),
    ).toEqual([
      { name: "ascii", type: "StringU8" },
      { name: "bool", type: "Boolean" },
      { name: "i32", type: "I32" },
      { name: "u32", type: "I64" },
      { name: "f32", type: "F32" },
    ]);
  });
});

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

  it("keeps both sources when a second table selection is connected to combine same tables", () => {
    const state = createFanInState("combinesametables");

    const withFilter = applyConnection(state, { source: "filter", target: "target" }, {} as any);
    const withBranch = applyConnection(
      { nodes: withFilter.nodes, edges: withFilter.edges },
      { source: "branch", target: "target" },
      {} as any,
    );

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
