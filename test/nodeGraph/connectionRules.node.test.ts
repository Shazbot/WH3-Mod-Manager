import { describe, expect, it } from "vitest";

import { rehydrateGraph } from "../../src/nodeGraph/connectionRules";

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
