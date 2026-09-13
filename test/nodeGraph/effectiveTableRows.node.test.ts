import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFlowExecutionContext } from "../../src/flowExecutionSupport";
import { executeNodeAction, resolveEffectiveTableRows } from "../../src/nodeExecutor";
import type { AmendedSchemaField, Pack, PackedFile } from "../../src/packFileTypes";

const packFileSerializerMocks = vi.hoisted(() => ({
  getPacksTableData: vi.fn(),
  readPack: vi.fn(),
}));
const vanillaCacheMocks = vi.hoisted(() => ({
  readVanillaPackFromCache: vi.fn(),
}));

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));
vi.mock("../../src/packFileSerializer", async () => {
  const actual = await vi.importActual<typeof import("../../src/packFileSerializer")>("../../src/packFileSerializer");
  return {
    ...actual,
    getPacksTableData: packFileSerializerMocks.getPacksTableData,
    readPack: packFileSerializerMocks.readPack,
  };
});
vi.mock("../../src/vanillaDbCache/store", async () => {
  const actual = await vi.importActual<typeof import("../../src/vanillaDbCache/store")>(
    "../../src/vanillaDbCache/store",
  );
  return {
    ...actual,
    readVanillaPackFromCache: vanillaCacheMocks.readVanillaPackFromCache,
  };
});

type TestRow = Record<string, string | number | undefined>;

const dbField = (name: string, isKey = false, isReference: string[] | null = null) => ({
  name,
  field_type: "StringU8" as const,
  is_key: isKey,
  default_value: "",
  is_filename: false,
  is_reference: isReference,
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

const schemaCell = (name: string, value: string | number | undefined) => ({
  name,
  type: typeof value === "number" ? ("I32" as const) : ("StringU8" as const),
  fields: [{ type: typeof value === "number" ? ("I32" as const) : ("String" as const), val: value }],
  resolvedKeyValue: value === undefined ? undefined : String(value),
  isKey: false,
});

const makePackedFile = (fileName: string, fields: ReturnType<typeof dbField>[], rows: TestRow[], version = 1) => ({
  name: fileName,
  version,
  file_size: 1,
  start_pos: 0,
  tableSchema: { version, fields },
  schemaFields: rows.flatMap((row) => fields.map((field) => schemaCell(field.name, row[field.name]))),
});

const makeTableEntry = (
  packName: string,
  fileName: string,
  fields: ReturnType<typeof dbField>[],
  rows: TestRow[],
  metadata: Partial<DBTablesNodeTable> = {},
) => {
  const packedFile = makePackedFile(fileName, fields, rows);
  const sourceFile = { name: packName, path: `/packs/${packName}`, loaded: true };
  return {
    name: "db\\main_units_tables",
    fileName,
    sourceFile,
    table: packedFile,
    ...metadata,
  } as DBTablesNodeTable;
};

const rowValues = (table: DBTablesNodeTable): string[] =>
  (table.table.schemaFields || []).map((field) => String((field as AmendedSchemaField).resolvedKeyValue));

describe("effective DB table row resolution", () => {
  it("uses normalized filename priority, not pack order, and keeps unique rows", () => {
    const fields = [dbField("key", true), dbField("value")];
    const lowFile = makeTableEntry("high-priority-pack.pack", "db\\main_units_tables\\zzz_", fields, [
      { key: "same", value: "wrong" },
      { key: "low-only", value: "kept" },
    ]);
    const highFile = makeTableEntry("low-priority-pack.pack", "db\\main_units_tables\\abc_", fields, [
      { key: "same", value: "right" },
    ]);

    const resolved = resolveEffectiveTableRows([lowFile, highFile], createFlowExecutionContext());

    expect(resolved).toHaveLength(2);
    expect(rowValues(resolved[0])).toEqual(["low-only", "kept"]);
    expect(rowValues(resolved[1])).toEqual(["same", "right"]);
  });

  it("orders punctuation lexically and keeps the first row for equal normalized filenames", () => {
    const fields = [dbField("key", true), dbField("value")];
    const punctuationWinner = makeTableEntry("first.pack", "db\\main_units_tables\\!a", fields, [
      { key: "punctuation", value: "loses" },
    ]);
    const doublePunctuation = makeTableEntry("second.pack", "db/main_units_tables/!!a", fields, [
      { key: "punctuation", value: "wins" },
    ]);
    const equalFirst = makeTableEntry("first-equal.pack", "DB/main_units_tables/DATA__", fields, [
      { key: "equal", value: "first" },
    ]);
    const equalSecond = makeTableEntry("second-equal.pack", "db\\main_units_tables\\data__", fields, [
      { key: "equal", value: "second" },
    ]);

    const resolved = resolveEffectiveTableRows(
      [punctuationWinner, doublePunctuation, equalFirst, equalSecond],
      createFlowExecutionContext(),
    );

    expect(rowValues(resolved[0])).toEqual(["punctuation", "wins"]);
    expect(rowValues(resolved[1])).toEqual(["equal", "first"]);
    expect(resolved.map((table) => table.fileName)).toEqual([
      "db/main_units_tables/!!a",
      "DB/main_units_tables/DATA__",
    ]);
  });

  it("deduplicates by the complete composite key tuple only", () => {
    const fields = [dbField("key_a", true), dbField("key_b", true), dbField("value")];
    const first = makeTableEntry("first.pack", "db\\main_units_tables\\zzz_", fields, [
      { key_a: "a", key_b: "b", value: "loses" },
      { key_a: "a", key_b: "different", value: "kept" },
    ]);
    const second = makeTableEntry("second.pack", "db\\main_units_tables\\abc_", fields, [
      { key_a: "a", key_b: "b", value: "wins" },
      { key_a: "a", key_b: "other", value: "kept too" },
    ]);

    const resolved = resolveEffectiveTableRows([first, second], createFlowExecutionContext());

    expect(rowValues(resolved[0])).toEqual(["a", "different", "kept"]);
    expect(rowValues(resolved[1])).toEqual(["a", "b", "wins", "a", "other", "kept too"]);
  });

  it("preserves no-key and incomplete-key rows and does not mutate cached files or metadata", () => {
    const fields = [dbField("key", true), dbField("value")];
    const noKeyFields = [dbField("value")];
    const incomplete = makeTableEntry(
      "incomplete.pack",
      "db\\main_units_tables\\data__",
      fields,
      [{ key: undefined, value: "incomplete" }],
      {
        outputPathPrefix: "text\\db\\",
        outputPathSuffix: ".loc",
        outputFileName: "text\\db\\custom.loc",
        replacesSourcePackPath: "/packs/incomplete.pack",
      },
    );
    const noKey = makeTableEntry("no-key.pack", "db\\main_units_tables\\no_keys", noKeyFields, [{ value: "no-key" }]);
    const originalSchemaFields = incomplete.table.schemaFields;

    const resolved = resolveEffectiveTableRows([incomplete, noKey], createFlowExecutionContext());

    expect(resolved).toHaveLength(2);
    expect(rowValues(resolved[0])).toEqual(["undefined", "incomplete"]);
    expect(rowValues(resolved[1])).toEqual(["no-key"]);
    expect(resolved[0]).not.toBe(incomplete);
    expect(resolved[0].table).not.toBe(incomplete.table);
    expect(resolved[0].table.schemaFields).not.toBe(originalSchemaFields);
    expect(incomplete.table.schemaFields).toEqual(originalSchemaFields);
    expect(resolved[0].outputPathPrefix).toBe("text\\db\\");
    expect(resolved[0].outputPathSuffix).toBe(".loc");
    expect(resolved[0].outputFileName).toBe("text\\db\\custom.loc");
    expect(resolved[0].replacesSourcePackPath).toBe("/packs/incomplete.pack");
  });

  it("omits a keyed table entry after every complete row loses", () => {
    const fields = [dbField("key", true), dbField("value")];
    const losing = makeTableEntry("losing.pack", "db\\main_units_tables\\zzz_", fields, [
      { key: "same", value: "loses" },
    ]);
    const winning = makeTableEntry("winning.pack", "db\\main_units_tables\\abc_", fields, [
      { key: "same", value: "wins" },
    ]);

    const resolved = resolveEffectiveTableRows([losing, winning], createFlowExecutionContext());

    expect(resolved).toHaveLength(1);
    expect(resolved[0].sourceFile.name).toBe("winning.pack");
  });
});

describe("effective rows in selection and lookup nodes", () => {
  const fields = [dbField("key", true), dbField("value")];
  const packs = new Map<string, Pack>();

  beforeEach(() => {
    packs.clear();
    vanillaCacheMocks.readVanillaPackFromCache.mockResolvedValue(undefined);
    packFileSerializerMocks.getPacksTableData.mockImplementation(() => undefined);
    packFileSerializerMocks.readPack.mockImplementation(async (packPath: string) => packs.get(packPath));
  });

  const addPack = (packName: string, packedFiles: PackedFile[]) => {
    const packPath = `/packs/${packName}`;
    packs.set(packPath, { name: packName, path: packPath, packedFiles } as Pack);
    return { name: packName, path: packPath, loaded: true };
  };

  it("resolves both table selection nodes before exposing rows", async () => {
    const low = addPack("low.pack", [
      makePackedFile("db\\main_units_tables\\zzz_", fields, [{ key: "same", value: "loses" }]),
    ]);
    const high = addPack("high.pack", [
      makePackedFile("db\\main_units_tables\\abc_", fields, [{ key: "same", value: "wins" }]),
    ]);
    const inputData = { type: "PackFiles", files: [low, high], count: 2, loadedCount: 2 } as PackFilesNodeData;

    for (const [nodeType, config] of [
      ["tableselection", undefined],
      ["tableselectiondropdown", { selectedTable: "main_units_tables" }],
    ] as const) {
      const result = await executeNodeAction({
        nodeId: nodeType,
        nodeType,
        textValue: nodeType === "tableselection" ? "main_units_tables" : "",
        config,
        inputData,
        executionContext: createFlowExecutionContext(),
      });

      expect(result.success).toBe(true);
      const output = result.data as DBTablesNodeData;
      expect(output.tables).toHaveLength(1);
      expect(rowValues(output.tables[0])).toEqual(["same", "wins"]);
    }
  });

  it("resolves target rows before Reference Lookup filtering", async () => {
    const inputFields = [dbField("source", false, ["target_tables", "key"]), dbField("value")];
    const inputPack = addPack("input.pack", []);
    const low = addPack("low.pack", [
      makePackedFile("db\\target_tables\\zzz_", fields, [{ key: "target", value: "loses" }]),
    ]);
    const high = addPack("high.pack", [
      makePackedFile("db\\target_tables\\abc_", fields, [{ key: "target", value: "wins" }]),
    ]);
    const inputTable = makeTableEntry("input.pack", "db\\source_tables\\data__", inputFields, [
      { source: "target", value: "input" },
    ]);

    const result = await executeNodeAction({
      nodeId: "reference",
      nodeType: "referencelookup",
      textValue: "",
      config: { selectedReferenceTable: "target_tables", includeBaseGame: false },
      inputData: {
        type: "TableSelection",
        tables: [inputTable],
        sourceFiles: [inputPack, low, high],
        tableCount: 1,
      },
      executionContext: createFlowExecutionContext(),
    });

    expect(result.success).toBe(true);
    const output = result.data as DBTablesNodeData;
    expect(output.tables).toHaveLength(1);
    expect(rowValues(output.tables[0])).toEqual(["target", "wins"]);
  });

  it("resolves reverse rows before Reverse Reference Lookup filtering", async () => {
    const inputFields = [dbField("key", true), dbField("value")];
    const reverseFields = [dbField("target", true, ["target_tables", "key"]), dbField("value")];
    const inputPack = addPack("input.pack", []);
    const low = addPack("low.pack", [
      makePackedFile("db\\reverse_tables\\zzz_", reverseFields, [{ target: "target", value: "loses" }]),
    ]);
    const high = addPack("high.pack", [
      makePackedFile("db\\reverse_tables\\abc_", reverseFields, [{ target: "target", value: "wins" }]),
    ]);
    const inputTable = makeTableEntry("input.pack", "db\\target_tables\\data__", inputFields, [
      { key: "target", value: "input" },
    ]);

    const result = await executeNodeAction({
      nodeId: "reverse",
      nodeType: "reversereferencelookup",
      textValue: "",
      config: {
        selectedReverseTable: "reverse_tables",
        includeBaseGame: false,
        connectedTableName: "target_tables",
      },
      inputData: {
        type: "TableSelection",
        tables: [inputTable],
        sourceFiles: [inputPack, low, high],
        tableCount: 1,
      },
      executionContext: createFlowExecutionContext(),
    });

    expect(result.success).toBe(true);
    const output = result.data as DBTablesNodeData;
    expect(output.tables).toHaveLength(1);
    expect(rowValues(output.tables[0])).toEqual(["target", "wins"]);
  });
});
