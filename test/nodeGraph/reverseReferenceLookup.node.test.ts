import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFlowExecutionContext } from "../../src/flowExecutionSupport";
import { executeNodeAction } from "../../src/nodeExecutor";
import { serializeNodeConfigForExecution } from "../../src/nodeGraphExecutor";
import { prepareNodeConfig } from "../../src/packFileSerializer";

const packFileSerializerMocks = vi.hoisted(() => ({
  getPacksTableData: vi.fn(),
  readPack: vi.fn(),
  readDBPackedFilesFromIndex: vi.fn(),
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
    readDBPackedFilesFromIndex: packFileSerializerMocks.readDBPackedFilesFromIndex,
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

const dbField = (name: string, isKey = false, isReference: string[] | null = null) => ({
  name,
  field_type: "StringU8",
  is_key: isKey,
  default_value: "",
  is_filename: false,
  is_reference: isReference,
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

const cell = (name: string, value: string) => ({
  name,
  type: "StringU8",
  fields: [{ type: "String" as const, val: value }],
  resolvedKeyValue: value,
  isKey: false,
});

const inputTable = {
  name: "agent_subtypes_tables_unmatched_unique_agents_tables",
  fileName: "agent_subtypes_tables_unmatched_unique_agents_tables",
  sourceFile: { name: "source.pack", path: "source.pack", loaded: true },
  table: {
    name: "db\\agent_subtypes_tables_unmatched_unique_agents_tables",
    version: 1,
    tableSchema: {
      version: 1,
      fields: [dbField("key", true), dbField("source_value")],
    },
    schemaFields: [cell("key", "agent_type_1"), cell("source_value", "unmatched")],
  },
};

const reversePackedFile = {
  name: "db\\ancillaries_included_agent_subtypes_tables\\data__",
  version: 1,
  tableSchema: {
    version: 1,
    fields: [
      dbField("agent_subtype", true, ["agent_subtypes_tables", "key"]),
      dbField("ancillary", true, ["ancillaries_tables", "key"]),
    ],
  },
  schemaFields: [cell("agent_subtype", "agent_type_1"), cell("ancillary", "ancillary_1")],
};

describe("reverse reference lookup node", () => {
  beforeEach(() => {
    vanillaCacheMocks.readVanillaPackFromCache.mockResolvedValue(undefined);
    packFileSerializerMocks.getPacksTableData.mockImplementation(() => undefined);
    packFileSerializerMocks.readDBPackedFilesFromIndex.mockResolvedValue([reversePackedFile]);
    packFileSerializerMocks.readPack.mockResolvedValue({
      name: "source.pack",
      path: "source.pack",
      packedFiles: [reversePackedFile],
    });
  });

  it("uses the connected source table when the input is a generated lookup table", async () => {
    const result = await executeNodeAction({
      nodeId: "reverse_1",
      nodeType: "reversereferencelookup",
      textValue: "",
      config: {
        selectedReverseTable: "ancillaries_included_agent_subtypes_tables",
        includeBaseGame: false,
        connectedTableName: "agent_subtypes_tables",
      },
      inputData: {
        type: "TableSelection",
        tables: [inputTable],
        sourceFiles: [{ name: "source.pack", path: "source.pack", loaded: true }],
        tableCount: 1,
      },
      executionContext: createFlowExecutionContext(),
    });

    expect(result.success).toBe(true);
    expect(result.data?.tables).toHaveLength(1);
    expect(
      result.data?.tables[0].table.schemaFields.map((field: { resolvedKeyValue: string }) => field.resolvedKeyValue),
    ).toEqual(["agent_type_1", "ancillary_1"]);
  });

  it("keeps the logical input table in both execution configs", () => {
    const node = {
      id: "reverse_1",
      type: "reversereferencelookup" as const,
      data: {
        selectedReverseTable: "ancillaries_included_agent_subtypes_tables",
        connectedTableName: "agent_subtypes_tables",
        includeBaseGame: true,
      },
    };

    const manualConfig = JSON.parse(serializeNodeConfigForExecution(node as never));
    const automaticConfig = prepareNodeConfig(node as never) as Record<string, unknown>;

    expect(manualConfig.connectedTableName).toBe("agent_subtypes_tables");
    expect(automaticConfig.connectedTableName).toBe("agent_subtypes_tables");
  });
});
