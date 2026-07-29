import { describe, expect, it, vi } from "vitest";

import { createFlowExecutionContext } from "../../src/flowExecutionSupport";
import { executeNodeAction } from "../../src/nodeExecutor";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const createSchemaField = (name: string, value: string | number) => ({
  name,
  type: typeof value === "number" ? "I32" : "StringU8",
  fields: [{ type: typeof value === "number" ? "I32" : "String", val: value }],
  resolvedKeyValue: String(value),
  isKey: false,
});

const createDbField = (name: string, value: string | number) => ({
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
            fields: columns.map((columnName, index) => createDbField(columnName, rows[0]?.[index] ?? "")),
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

  it("pads unmatched left-join rows with empty indexed cells", async () => {
    const source = createTableSelection(
      "source_tables",
      ["key", "source_value"],
      [
        ["missing", "unmatched source"],
        ["match", "matched source"],
      ],
    );
    const indexed = createTableSelection(
      "indexed_tables",
      ["source_key", "indexed_value"],
      [["match", "matched indexed"]],
    );

    const result = await executeNodeAction({
      nodeId: "lookup_left",
      nodeType: "lookup",
      textValue: "",
      config: {
        joinType: "left",
        lookupColumn: "key",
        indexColumns: ["source_key"],
        indexJoinColumn: "source_key",
      },
      inputData: [source, indexed],
      executionContext: createFlowExecutionContext(),
    });

    expect(result.success).toBe(true);
    const outputTable = result.data?.tables[0].table;
    const outputColumns = outputTable.tableSchema.fields.map((field: { name: string }) => field.name);
    const outputRows = Array.from({ length: outputTable.schemaFields.length / outputColumns.length }, (_, index) =>
      outputTable.schemaFields
        .slice(index * outputColumns.length, (index + 1) * outputColumns.length)
        .map((field: { resolvedKeyValue: string }) => field.resolvedKeyValue),
    );

    expect(outputColumns).toEqual([
      "source_tables_key",
      "source_tables_source_value",
      "indexed_tables_source_key",
      "indexed_tables_indexed_value",
    ]);
    expect(outputRows).toEqual([
      ["missing", "unmatched source", "", ""],
      ["match", "matched source", "match", "matched indexed"],
    ]);
  });

  it("skips unmatched rows for an inner join", async () => {
    const source = createTableSelection(
      "source_tables",
      ["key", "source_value"],
      [
        ["missing", "unmatched source"],
        ["match", "matched source"],
      ],
    );
    const indexed = createTableSelection(
      "indexed_tables",
      ["source_key", "indexed_value"],
      [["match", "matched indexed"]],
    );

    const result = await executeNodeAction({
      nodeId: "lookup_inner",
      nodeType: "lookup",
      textValue: "",
      config: {
        joinType: "inner",
        lookupColumn: "key",
        indexColumns: ["source_key"],
        indexJoinColumn: "source_key",
      },
      inputData: [source, indexed],
      executionContext: createFlowExecutionContext(),
    });

    expect(result.success).toBe(true);
    const outputTable = result.data?.tables[0].table;
    expect(outputTable.tableSchema.fields).toHaveLength(4);
    expect(outputTable.schemaFields.map((field: { resolvedKeyValue: string }) => field.resolvedKeyValue)).toEqual([
      "match",
      "matched source",
      "match",
      "matched indexed",
    ]);
  });

  it("returns only unprefixed source rows without matches for an anti join", async () => {
    const source = createTableSelection(
      "agent_subtypes_tables",
      ["key", "source_value"],
      [
        ["missing", "unmatched source"],
        ["match", "matched source"],
      ],
    );
    const indexed = createTableSelection(
      "unique_agents_tables",
      ["agent_subtype", "indexed_value"],
      [["match", "matched indexed"]],
    );

    const result = await executeNodeAction({
      nodeId: "lookup_anti",
      nodeType: "lookup",
      textValue: "",
      config: {
        joinType: "anti",
        lookupColumn: "key",
        indexColumns: ["agent_subtype"],
        indexJoinColumn: "agent_subtype",
      },
      inputData: [source, indexed],
      executionContext: createFlowExecutionContext(),
    });

    expect(result.success).toBe(true);
    const outputTable = result.data?.tables[0].table;
    expect(outputTable.tableSchema.fields.map((field: { name: string }) => field.name)).toEqual([
      "key",
      "source_value",
    ]);
    expect(outputTable.schemaFields.map((field: { resolvedKeyValue: string }) => field.resolvedKeyValue)).toEqual([
      "missing",
      "unmatched source",
    ]);
  });
});
