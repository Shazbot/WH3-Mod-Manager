import { describe, expect, it, vi } from "vitest";

import { applyNodeDataPatch, withNodeEditorActions } from "../../src/nodeGraph/editorState";

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

describe("applyNodeDataPatch", () => {
  it("applies a direct node patch without touching unrelated nodes", () => {
    const state = {
      nodes: [
        {
          id: "node_1",
          type: "packedfiles",
          position: { x: 0, y: 0 },
          data: { label: "Pack Files", type: "packedfiles", textValue: "old.pack" },
        },
        {
          id: "node_2",
          type: "tableselection",
          position: { x: 100, y: 0 },
          data: { label: "Table Selection", type: "tableselection", selectedTable: "units" },
        },
      ] as any[],
      edges: [],
    };

    const result = applyNodeDataPatch(state, "node_1", { textValue: "new.pack" }, {});

    expect(result.nodes[0].data.textValue).toBe("new.pack");
    expect(result.nodes[1].data.selectedTable).toBe("units");
    expect(result.edges).toEqual([]);
  });

  it("propagates selectedReferenceTable changes to connected nodes", () => {
    const DBNameToDBVersions = {
      units: [{ version: 1, fields: [createField("key"), createField("value")] }],
    } as any;
    const state = {
      nodes: [
        {
          id: "source",
          type: "referencelookup",
          position: { x: 0, y: 0 },
          data: { label: "Reference Lookup", type: "referencelookup", connectedTableName: "base" },
        },
        {
          id: "target",
          type: "filter",
          position: { x: 100, y: 0 },
          data: { label: "Filter", type: "filter", columnNames: [], inputColumnNames: [] },
        },
      ] as any[],
      edges: [{ id: "edge", source: "source", target: "target" }] as any[],
    };

    const result = applyNodeDataPatch(
      state,
      "source",
      { selectedReferenceTable: "units" },
      { DBNameToDBVersions },
    );

    expect(result.nodes[1].data.connectedTableName).toBe("units");
    expect(result.nodes[1].data.columnNames).toEqual(["key", "value"]);
    expect(result.nodes[1].data.inputColumnNames).toEqual(["key", "value"]);
  });

  it("propagates selectedReverseTable changes to connected nodes", () => {
    const DBNameToDBVersions = {
      agents: [{ version: 1, fields: [createField("agent"), createField("subtype")] }],
    } as any;
    const state = {
      nodes: [
        {
          id: "source",
          type: "reversereferencelookup",
          position: { x: 0, y: 0 },
          data: { label: "Reverse Reference Lookup", type: "reversereferencelookup" },
        },
        {
          id: "target",
          type: "deduplicate",
          position: { x: 100, y: 0 },
          data: { label: "Deduplicate", type: "deduplicate", columnNames: [], inputColumnNames: [] },
        },
      ] as any[],
      edges: [{ id: "edge", source: "source", target: "target" }] as any[],
    };

    const result = applyNodeDataPatch(
      state,
      "source",
      { selectedReverseTable: "agents" },
      { DBNameToDBVersions },
    );

    expect(result.nodes[1].data.connectedTableName).toBe("agents");
    expect(result.nodes[1].data.columnNames).toEqual(["agent", "subtype"]);
    expect(result.nodes[1].data.inputColumnNames).toEqual(["agent", "subtype"]);
  });

  it("propagates generaterows output table changes by handle", () => {
    const DBNameToDBVersions = {
      units: [{ version: 1, fields: [createField("unit_key"), createField("health")] }],
    } as any;
    const state = {
      nodes: [
        {
          id: "source",
          type: "generaterows",
          position: { x: 0, y: 0 },
          data: {
            label: "Generate Rows",
            type: "generaterows",
            customSchemaColumns: [],
            outputTables: [],
          },
        },
        {
          id: "target",
          type: "filter",
          position: { x: 100, y: 0 },
          data: { label: "Filter", type: "filter", columnNames: [], inputColumnNames: [] },
        },
      ] as any[],
      edges: [{ id: "edge", source: "source", target: "target", sourceHandle: "output-table1" }] as any[],
    };

    const result = applyNodeDataPatch(
      state,
      "source",
      {
        outputTables: [
          {
            handleId: "output-table1",
            name: "Table 1",
            existingTableName: "units",
            columnMapping: [],
          },
        ],
      },
      { DBNameToDBVersions },
    );

    expect(result.nodes[1].data.connectedTableName).toBe("units");
    expect(result.nodes[1].data.columnNames).toEqual(["unit_key", "health"]);
    expect(result.nodes[1].data.inputColumnNames).toEqual(["unit_key", "health"]);
  });

  it("propagates custom schema changes to connected generate rows nodes", () => {
    const schemaColumns = [
      { id: "col_1", name: "new_col", type: "String" },
      { id: "col_2", name: "value_col", type: "I32" },
    ] as any[];
    const state = {
      nodes: [
        {
          id: "source",
          type: "customschema",
          position: { x: 0, y: 0 },
          data: { label: "Custom Schema", type: "customschema", schemaColumns: [] },
        },
        {
          id: "target",
          type: "generaterowsschema",
          position: { x: 100, y: 0 },
          data: { label: "Generate Rows Schema", type: "generaterowsschema" },
        },
      ] as any[],
      edges: [{ id: "edge", source: "source", target: "target" }] as any[],
    };

    const result = applyNodeDataPatch(state, "source", { schemaColumns }, {});

    expect(result.nodes[1].data.customSchemaColumns).toEqual(["new_col", "value_col"]);
    expect(result.nodes[1].data.customSchemaData).toEqual(schemaColumns);
  });
});

describe("withNodeEditorActions", () => {
  it("injects node-specific update callbacks", () => {
    const updateNodeData = vi.fn();
    const [node] = withNodeEditorActions(
      [
        {
          id: "node_1",
          type: "packedfiles",
          position: { x: 0, y: 0 },
          data: { label: "Pack Files", type: "packedfiles" },
        } as any,
      ],
      { updateNodeData },
    );

    (node.data as any).onUpdateNodeData({ textValue: "updated.pack" });

    expect(updateNodeData).toHaveBeenCalledWith("node_1", { textValue: "updated.pack" });
  });
});
