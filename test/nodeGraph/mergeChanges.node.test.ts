import { describe, expect, it, vi } from "vitest";

import { executeNodeAction } from "../../src/nodeExecutor";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const tableSchema = {
  version: 1,
  fields: [
    { name: "id", field_type: "I32", is_key: true },
    { name: "first_value", field_type: "I32", is_key: false },
    { name: "second_value", field_type: "I32", is_key: false },
  ],
} as DBVersion;

const createCell = (name: string, value: number, isKey = false): AmendedSchemaField => ({
  name,
  type: "I32",
  fields: [{ type: "I32", val: value }],
  resolvedKeyValue: String(value),
  isKey,
});

const createRow = (id: number, firstValue: number, secondValue: number): AmendedSchemaField[] => [
  createCell("id", id, true),
  createCell("first_value", firstValue),
  createCell("second_value", secondValue),
];

const createChangedInput = (
  selectedColumn: string,
  rows: AmendedSchemaField[][],
): DBNumericAdjustmentNodeData => {
  const sourceTable = {
    name: "db\\example_tables\\data__",
    schemaFields: rows.flat(),
    tableSchema,
  } as PackedFile;
  const column = {
    tableName: "example_tables",
    fileName: sourceTable.name,
    sourcePack: {} as Pack,
    sourceTable,
    selectedColumns: [selectedColumn],
    data: [],
  };
  const adjustedInputData = {
    type: "ColumnSelection" as const,
    columns: [column],
    sourceTables: [],
    selectedColumnCount: 1,
  };

  return {
    type: "ChangedColumnSelection",
    adjustedInputData,
    originalData: structuredClone(adjustedInputData),
    appliedFormula: "test",
  };
};

describe("Merge Changes node", () => {
  it("retains rows missing from a filtered branch and merges changes by row key", async () => {
    const filteredInput = createChangedInput("first_value", [createRow(2, 200, 20)]);
    const completeInput = createChangedInput("second_value", [
      createRow(1, 100, 110),
      createRow(2, 20, 220),
    ]);

    const result = await executeNodeAction({
      nodeId: "merge_changes_1",
      nodeType: "mergechanges",
      textValue: "",
      inputData: [filteredInput, completeInput],
    });

    expect(result.success).toBe(true);
    const mergedResult = result.data as DBNumericAdjustmentNodeData;
    const mergedFields = mergedResult.adjustedInputData.columns[0].sourceTable.schemaFields ?? [];
    const mergedRows = [mergedFields.slice(0, 3), mergedFields.slice(3, 6)] as AmendedSchemaField[][];
    const rowsById = new Map(
      mergedRows.map((row) => [row.find((cell) => cell.name === "id")?.resolvedKeyValue, row]),
    );

    expect(rowsById.size).toBe(2);
    expect(rowsById.get("1")?.find((cell) => cell.name === "second_value")?.resolvedKeyValue).toBe("110");
    expect(rowsById.get("2")?.find((cell) => cell.name === "first_value")?.resolvedKeyValue).toBe("200");
    expect(rowsById.get("2")?.find((cell) => cell.name === "second_value")?.resolvedKeyValue).toBe("220");
  });
});
