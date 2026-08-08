import { describe, expect, it, vi } from "vitest";

import { executeNodeAction } from "../../src/nodeExecutor";
import type { AmendedSchemaField, DBField, DBVersion, Pack, PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const createField = (name: string, fieldType = "StringU16"): DBField =>
  ({
    name,
    field_type: fieldType,
    is_key: false,
    default_value: "",
    is_filename: false,
    is_reference: [],
    description: "",
    ca_order: 0,
    is_bitwise: 0,
    enum_values: {},
  }) as DBField;

/** The loc shape: exactly key, text, tooltip. */
const locSchema: DBVersion = {
  version: 1,
  fields: [createField("key"), createField("text"), createField("tooltip", "Boolean")],
};

const createRow = (values: string[]): AmendedSchemaField[] =>
  locSchema.fields.map((field, index) => ({
    name: field.name,
    type: field.field_type,
    fields: [{ type: "String" as const, val: values[index] ?? "" }],
    resolvedKeyValue: values[index] ?? "",
  }));

const createInput = () => ({
  type: "TableSelection" as const,
  tables: [
    {
      name: "deepclone_loc",
      fileName: "text\\db\\deepclone_loc",
      sourceFile: {} as Pack,
      table: {
        name: "deepclone_loc",
        file_size: 0,
        start_pos: 0,
        tableSchema: locSchema,
        schemaFields: [
          ...createRow(["land_units_onscreen_name_pj_x", "Greatswords", "0"]),
          ...createRow(["main_units_onscreen_name_pj_x", "Greatswords", "0"]),
          ...createRow(["land_units_onscreen_name_pj_y", "Halberdiers", "0"]),
        ],
      } as PackedFile,
    },
  ],
  sourceFiles: [],
  tableCount: 1,
});

const run = (transformations: Record<string, unknown>[]) =>
  executeNodeAction({
    nodeId: "addcol_1",
    nodeType: "addnewcolumn",
    textValue: "",
    config: { transformations },
    inputData: createInput(),
  });

const rowsOf = (result: Awaited<ReturnType<typeof run>>) => {
  const table = (result.data as any).tables[0].table as PackedFile;
  const width = table.tableSchema!.fields.length;
  const fields = table.schemaFields as AmendedSchemaField[];
  const rows: AmendedSchemaField[][] = [];
  for (let i = 0; i < fields.length; i += width) rows.push(fields.slice(i, i + width));
  return rows;
};
const cell = (row: AmendedSchemaField[], name: string) =>
  row.find((c) => c.name === name)?.resolvedKeyValue;

describe("addnewcolumn overwrite mode", () => {
  const suffixRule = {
    id: "t1",
    sourceColumn: "text",
    transformationType: "suffix",
    suffix: " (Big)",
    outputColumnName: "text",
    overwriteSource: true,
    conditionColumn: "key",
    conditionOperator: "startsWith",
    conditionValue: "land_units_onscreen_name_",
  };

  it("appends to the matching rows and leaves the others alone", async () => {
    const result = await run([suffixRule]);
    const rows = rowsOf(result);

    expect(rows.map((row) => cell(row, "text"))).toEqual([
      "Greatswords (Big)",
      "Greatswords",
      "Halberdiers (Big)",
    ]);
  });

  it("keeps the table's shape, which a loc depends on", async () => {
    const result = await run([suffixRule]);
    const table = (result.data as any).tables[0].table as PackedFile;

    // A fourth column would stop this being a valid loc.
    expect(table.tableSchema!.fields.map((field) => field.name)).toEqual(["key", "text", "tooltip"]);
    expect(rowsOf(result)).toHaveLength(3);
  });

  it("keeps rows that the condition excludes, unlike a filter transformation", async () => {
    const withCondition = await run([suffixRule]);
    expect(rowsOf(withCondition)).toHaveLength(3);

    const withFilter = await run([
      {
        id: "f1",
        sourceColumn: "key",
        transformationType: "filterequal",
        filterValue: "main_units_onscreen_name_pj_x",
        outputColumnName: "unused",
      },
    ]);
    // The filter still removes rows; its meaning is unchanged.
    expect(rowsOf(withFilter).length).toBeLessThan(3);
  });

  it("holds several rules with different conditions in one node", async () => {
    const result = await run([
      suffixRule,
      {
        id: "t2",
        sourceColumn: "text",
        transformationType: "suffix",
        suffix: " (Elite)",
        outputColumnName: "text",
        overwriteSource: true,
        conditionColumn: "key",
        conditionOperator: "startsWith",
        conditionValue: "main_units_onscreen_name_",
      },
    ]);

    expect(rowsOf(result).map((row) => cell(row, "text"))).toEqual([
      "Greatswords (Big)",
      "Greatswords (Elite)",
      "Halberdiers (Big)",
    ]);
  });

  it("still appends a column when overwrite is off", async () => {
    const result = await run([
      {
        id: "t1",
        sourceColumn: "text",
        transformationType: "suffix",
        suffix: " (Big)",
        outputColumnName: "text_big",
      },
    ]);
    const table = (result.data as any).tables[0].table as PackedFile;

    expect(table.tableSchema!.fields.map((field) => field.name)).toEqual([
      "key",
      "text",
      "tooltip",
      "text_big",
    ]);
  });

  it("applies to every row when no condition is set", async () => {
    const result = await run([{ ...suffixRule, conditionColumn: "", conditionOperator: undefined }]);

    expect(rowsOf(result).map((row) => cell(row, "text"))).toEqual([
      "Greatswords (Big)",
      "Greatswords (Big)",
      "Halberdiers (Big)",
    ]);
  });

  it("supports the other condition operators", async () => {
    const equals = await run([
      { ...suffixRule, conditionOperator: "equals", conditionValue: "land_units_onscreen_name_pj_y" },
    ]);
    expect(rowsOf(equals).map((row) => cell(row, "text"))).toEqual([
      "Greatswords",
      "Greatswords",
      "Halberdiers (Big)",
    ]);

    const contains = await run([
      { ...suffixRule, conditionOperator: "contains", conditionValue: "main_units" },
    ]);
    expect(rowsOf(contains).map((row) => cell(row, "text"))).toEqual([
      "Greatswords",
      "Greatswords (Big)",
      "Halberdiers",
    ]);
  });
});

describe("addnewcolumn with several input tables", () => {
  const dbSchema: DBVersion = {
    version: 1,
    fields: [createField("unit"), createField("caste")],
  };

  const createMultiTableInput = () => ({
    type: "TableSelection" as const,
    tables: [
      {
        name: "main_units_tables",
        fileName: "db\\main_units_tables\\x",
        sourceFile: {} as Pack,
        table: {
          name: "main_units_tables",
          file_size: 0,
          start_pos: 0,
          tableSchema: dbSchema,
          schemaFields: dbSchema.fields.map((field, index) => ({
            name: field.name,
            type: field.field_type,
            fields: [{ type: "String" as const, val: ["pj_x", "melee"][index] }],
            resolvedKeyValue: ["pj_x", "melee"][index],
          })),
        } as PackedFile,
      },
      {
        name: "deepclone_loc",
        fileName: "text\\db\\deepclone_loc",
        sourceFile: {} as Pack,
        table: {
          name: "deepclone_loc",
          file_size: 0,
          start_pos: 0,
          tableSchema: locSchema,
          schemaFields: createRow(["land_units_onscreen_name_pj_x", "Greatswords", "0"]),
        } as PackedFile,
      },
    ],
    sourceFiles: [],
    tableCount: 2,
  });

  const runMulti = (transformations: Record<string, unknown>[]) =>
    executeNodeAction({
      nodeId: "addcol_multi",
      nodeType: "addnewcolumn",
      textValue: "",
      config: { transformations },
      inputData: createMultiTableInput(),
    });

  it("emits one entry per input entry instead of collapsing them into one", async () => {
    const result = await runMulti([
      {
        id: "t1",
        sourceColumn: "text",
        transformationType: "suffix",
        suffix: " (Big)",
        outputColumnName: "text",
        overwriteSource: true,
      },
    ]);
    const tables = (result.data as any).tables;

    expect(tables.map((table: { name: string }) => table.name)).toEqual([
      "main_units_tables",
      "deepclone_loc",
    ]);
    expect((result.data as any).tableCount).toBe(2);
  });

  it("applies a transformation only to the tables that have its source column", async () => {
    const result = await runMulti([
      {
        id: "t1",
        sourceColumn: "text",
        transformationType: "suffix",
        suffix: " (Big)",
        outputColumnName: "text",
        overwriteSource: true,
      },
    ]);
    const tables = (result.data as any).tables;

    // The loc has a text column and is transformed.
    const locFields = tables[1].table.schemaFields as AmendedSchemaField[];
    expect(locFields.find((c) => c.name === "text")?.resolvedKeyValue).toBe("Greatswords (Big)");

    // main_units_tables has no text column, so it is passed through untouched - not given an
    // empty column, and certainly not interpreted against the loc's schema.
    expect(tables[0].table.tableSchema.fields.map((f: DBField) => f.name)).toEqual(["unit", "caste"]);
    const dbFields = tables[0].table.schemaFields as AmendedSchemaField[];
    expect(dbFields.map((c) => c.resolvedKeyValue)).toEqual(["pj_x", "melee"]);
  });

  it("keeps each table on its own schema when adding a column", async () => {
    const result = await runMulti([
      {
        id: "t1",
        sourceColumn: "unit",
        transformationType: "suffix",
        suffix: "_tagged",
        outputColumnName: "tagged",
      },
    ]);
    const tables = (result.data as any).tables;

    expect(tables[0].table.tableSchema.fields.map((f: DBField) => f.name)).toEqual([
      "unit",
      "caste",
      "tagged",
    ]);
    // The loc has no unit column, so it keeps its three columns.
    expect(tables[1].table.tableSchema.fields.map((f: DBField) => f.name)).toEqual([
      "key",
      "text",
      "tooltip",
    ]);
  });
});

describe("the node's identity after the rename", () => {
  it("keeps the saved node type, so existing flows still load", async () => {
    const { getNodeDefinition, isRegisteredNodeType } = await import("../../src/nodeGraph/nodeRegistry");

    // Renaming is label-only: the type is written into saved flows and must not move.
    expect(isRegisteredNodeType("addnewcolumn")).toBe(true);
    const definition = getNodeDefinition("addnewcolumn");
    expect(definition.type).toBe("addnewcolumn");
    expect(definition.labelFallback).toBe("Add Or Transform Columns");
  });

  it("still executes under the old type name", async () => {
    const result = await run([
      {
        id: "t1",
        sourceColumn: "text",
        transformationType: "suffix",
        suffix: "!",
        outputColumnName: "text",
        overwriteSource: true,
      },
    ]);

    expect(result.success).toBe(true);
  });
});
