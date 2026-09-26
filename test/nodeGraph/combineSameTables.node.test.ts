import { describe, expect, it, vi } from "vitest";

import { executeNodeAction } from "../../src/nodeExecutor";
import type { Pack, PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const createSchema = (version: number): DBVersion =>
  ({
    version,
    fields: [
      { name: "id", field_type: "I32", is_key: true },
      { name: "value", field_type: "I32", is_key: false },
    ],
  }) as DBVersion;

const createCell = (name: string, value: number, isKey = false): AmendedSchemaField => ({
  name,
  type: "I32",
  fields: [{ type: "I32", val: value }],
  resolvedKeyValue: String(value),
  isKey,
});

const createRow = (id: number, value = id): AmendedSchemaField[] => [
  createCell("id", id, true),
  createCell("value", value),
];

const createEntry = (
  name: string,
  rows: AmendedSchemaField[][],
  version = 1,
  extras: Partial<DBTablesNodeTable> = {},
): DBTablesNodeTable => ({
  name,
  fileName: `db\\${name}\\data__`,
  sourceFile: {} as Pack,
  table: {
    name: `db\\${name}\\data__`,
    file_size: 0,
    start_pos: 0,
    version,
    tableSchema: createSchema(version),
    schemaFields: rows.flat(),
  } as PackedFile,
  ...extras,
});

const combine = (
  tables: DBTablesNodeTable[],
  inputData: unknown = {
    type: "TableSelection",
    tables,
    sourceFiles: [],
    tableCount: tables.length,
  },
) =>
  executeNodeAction({
    nodeId: "combine_1",
    nodeType: "combinesametables",
    textValue: "",
    inputData,
  });

const outputTables = (result: Awaited<ReturnType<typeof combine>>) => (result.data as DBTablesNodeData).tables;

const idsIn = (entry: DBTablesNodeTable) =>
  (entry.table.schemaFields || []).filter((field) => field.name === "id").map((field) => field.resolvedKeyValue);

describe("Combine Same Tables node", () => {
  it("combines rows from duplicate entries in input order", async () => {
    const result = await combine([
      createEntry("main_units_tables", [createRow(1), createRow(2)]),
      createEntry("main_units_tables", [createRow(3), createRow(4), createRow(5)]),
    ]);

    expect(result.success).toBe(true);
    expect(outputTables(result)).toHaveLength(1);
    expect(idsIn(outputTables(result)[0])).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("keeps different table names as separate entries", async () => {
    const result = await combine([
      createEntry("main_units_tables", [createRow(1)]),
      createEntry("main_units_tables", [createRow(2)]),
      createEntry("land_units_tables", [createRow(3)]),
    ]);

    const tables = outputTables(result);
    expect(tables.map((table) => table.name)).toEqual(["main_units_tables", "land_units_tables"]);
    expect((result.data as DBTablesNodeData).tableCount).toBe(tables.length);
  });

  it("keeps schema versions separate and reports a warning", async () => {
    const result = await combine([
      createEntry("main_units_tables", [createRow(1)], 1),
      createEntry("main_units_tables", [createRow(2)], 3),
    ]);

    expect(outputTables(result)).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toContain("main_units_tables");
    expect(result.warnings?.[0]).toContain("versions 1 and 3");
  });

  it("passes raw-buffer entries through without merging them", async () => {
    const rawEntry = {
      name: "main_units_tables",
      fileName: "main_units_tables.bin",
      sourceFile: {} as Pack,
      table: {
        name: "main_units_tables.bin",
        file_size: 3,
        start_pos: 0,
        buffer: Buffer.from("raw"),
      } as PackedFile,
      outputFileName: "main_units_tables.bin",
    };

    const result = await combine([rawEntry, createEntry("main_units_tables", [createRow(1)])]);
    const tables = outputTables(result);

    expect(tables).toHaveLength(2);
    expect(tables[0]).toBe(rawEntry);
    expect(tables[1].name).toBe("main_units_tables");
  });

  it("does not merge a generated loc payload with a db table of the same name", async () => {
    const result = await combine([
      createEntry("main_units_tables", [createRow(1)]),
      createEntry("main_units_tables", [createRow(2)], 1, { outputPathPrefix: "text\\db\\" }),
    ]);

    expect(outputTables(result)).toHaveLength(2);
  });

  it("does not mutate input table entries", async () => {
    const first = createEntry("main_units_tables", [createRow(1)]);
    const second = createEntry("main_units_tables", [createRow(2)]);
    const originalFields = first.table.schemaFields;

    await combine([first, second]);

    expect(first.table.schemaFields).toBe(originalFields);
    expect(first.table.schemaFields).toHaveLength(2);
  });

  it("rejects input that is not a table selection", async () => {
    const result = await combine([], { type: "Text", text: "nope" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Expected TableSelection");
  });
});
