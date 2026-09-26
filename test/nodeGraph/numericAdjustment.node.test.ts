import { describe, expect, it, vi } from "vitest";
import { executeNodeAction } from "../../src/nodeExecutor";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const createSchemaField = (name: string, value: number) => ({
  name,
  type: "I32",
  fields: [{ type: "I32", val: value }],
  resolvedKeyValue: String(value),
  isKey: false,
});

const createDbField = (name: string) => ({
  name,
  field_type: "I32",
  is_key: false,
  default_value: "0",
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

describe("numeric adjustment node", () => {
  it("uses a numeric input without x as the new value", async () => {
    const sourceTable = {
      name: "db\\unit_stats_tables\\test",
      schemaFields: [createSchemaField("value", 5), createSchemaField("value", 12)],
      tableSchema: {
        version: 1,
        fields: [createDbField("value")],
      },
    };

    const result = await executeNodeAction({
      nodeId: "numeric_adjustment_1",
      nodeType: "numericadjustment",
      textValue: "42",
      inputData: {
        type: "ColumnSelection",
        columns: [
          {
            tableName: "unit_stats_tables",
            fileName: "db\\unit_stats_tables\\test",
            sourcePack: {},
            sourceTable,
            selectedColumns: ["value"],
            data: [],
          },
        ],
        sourceTables: [],
        selectedColumnCount: 1,
      },
    });

    expect(result.success).toBe(true);
    if (!result.data || !("adjustedInputData" in result.data)) {
      throw new Error("Expected numeric adjustment output");
    }
    expect(
      result.data.adjustedInputData.columns[0].sourceTable.schemaFields?.map((field) => field.fields[0].val),
    ).toEqual([42, 42]);
  });
});
