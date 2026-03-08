import { describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));
vi.mock("../../src/schema", () => ({
  getSchemaForGame: vi.fn(async () => ({
    target_table: [
      {
        version: 1,
        fields: [
          {
            name: "output_col",
            field_type: "StringU8",
            is_key: false,
            default_value: "",
            is_filename: false,
            is_reference: [],
            description: "",
            ca_order: 0,
            is_bitwise: 0,
            enum_values: {},
          },
        ],
      },
    ],
  })),
}));

import { executeNodeAction } from "../../src/nodeExecutor";
import { createFlowExecutionContext } from "../../src/flowExecutionSupport";

const createSchemaField = (name: string, value: string) => ({
  name,
  type: "StringU8",
  fields: [{ type: "String", val: value }],
  resolvedKeyValue: value,
  isKey: false,
});

describe("generate rows node", () => {
  it("falls back to current game schema when DBNameToDBVersions is missing", async () => {
    const inputData = {
      type: "TableSelection",
      tables: [
        {
          name: "db\\source_table",
          fileName: "source_table",
          sourceFile: { name: "source.pack", path: "source.pack", loaded: true },
          table: {
            name: "db\\source_table",
            version: 1,
            schemaFields: [createSchemaField("source_col", "value_1")],
            tableSchema: {
              version: 1,
              fields: [
                {
                  name: "source_col",
                  field_type: "StringU8",
                  is_key: false,
                  default_value: "",
                  is_filename: false,
                  is_reference: [],
                  description: "",
                  ca_order: 0,
                  is_bitwise: 0,
                  enum_values: {},
                },
              ],
            },
          },
        },
      ],
      sourceFiles: [],
      tableCount: 1,
    };

    const result = await executeNodeAction({
      nodeId: "generate_1",
      nodeType: "generaterows",
      textValue: "",
      config: {
        transformations: [
          {
            id: "trans_1",
            sourceColumn: "source_col",
            transformationType: "none",
            outputColumnName: "output_col",
            targetTableHandleId: "output-table1",
          },
        ],
        outputTables: [
          {
            handleId: "output-table1",
            name: "Table 1",
            existingTableName: "target_table",
            tableVersion: 1,
            columnMapping: [],
          },
        ],
      },
      inputData,
      executionContext: createFlowExecutionContext(),
    });

    expect(result.success).toBe(true);
    expect(result.data?.["output-table1"]?.type).toBe("TableSelection");
    expect(result.data?.["output-table1"]?.tables).toHaveLength(1);
    expect(result.data?.["output-table1"]?.tables[0].name).toBe("target_table");
    expect(result.data?.["output-table1"]?.tables[0].table.tableSchema.fields[0].name).toBe("output_col");
  });
});
