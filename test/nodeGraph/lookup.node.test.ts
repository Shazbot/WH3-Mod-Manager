import { describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

import { executeNodeAction } from "../../src/nodeExecutor";
import { createFlowExecutionContext } from "../../src/flowExecutionSupport";

const createSchemaField = (name: string, value: string | number) => ({
  name,
  type: typeof value === "number" ? "I32" : "StringU8",
  fields: [{ type: typeof value === "number" ? "I32" : "String", val: value }],
  resolvedKeyValue: String(value),
  isKey: false,
});

const createDbField = (name: string) => ({
  name,
  field_type: typeof value === "number" ? "I32" : "StringU8",
  is_key: false,
  default_value: "",
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

const createTableSelection = (tableName: string, columns: string[], rows: Array<Array<string | number>>) => {
  const schemaFields = rows.flatMap((row) => row.map((value, index) => createSchemaField(columns[index], value)));

  return {
    type: "TableSelection",
    tables: [
      {
        name: `db\\${tableName}`,
        fileName: tableName,
        sourceFile: { name: `${tableName}.pack`, path: `${tableName}.pack`, loaded: true },
        table: {
          name: `db\\${tableName}`,
          version: 1,
          schemaFields,
          tableSchema: {
            version: 1,
            fields: columns.map((columnName) => createDbField(columnName)),
          },
        },
      },
    ],
    sourceFiles: [],
    tableCount: 1,
  };
};

describe("lookup node", () => {
  it("cross joins table selections without requiring index columns", async () => {
    const source = createTableSelection("contet_effects", ["effect_key", "value"], [["bonus_income", 10]]);
    const indexed = createTableSelection(
      "campaign_public_order_populace_effects_tables",
      ["culture", "populace_happiness"],
      [
        ["wh_main_emp_empire", "FACTION_PROVINCE_POPULACE_HAPPINESS_INDIFFERENT"],
        ["wh_main_dwf_dwarfs", "FACTION_PROVINCE_POPULACE_HAPPINESS_INDIFFERENT"],
      ],
    );

    const result = await executeNodeAction({
      nodeId: "lookup_1",
      nodeType: "lookup",
      textValue: "",
      config: {
        joinType: "cross",
        lookupColumn: "",
        indexColumns: [],
        indexJoinColumn: "",
      },
      inputData: [source, indexed],
      executionContext: createFlowExecutionContext(),
    });

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("TableSelection");
    expect(result.data?.tables).toHaveLength(1);
    expect(result.data?.tables[0].table.tableSchema.fields.map((field: { name: string }) => field.name)).toEqual([
      "contet_effects_effect_key",
      "contet_effects_value",
      "campaign_public_order_populace_effects_tables_culture",
      "campaign_public_order_populace_effects_tables_populace_happiness",
    ]);
    expect(result.data?.tables[0].table.schemaFields).toHaveLength(8);
  });
});
