import { describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

import { executeNodeAction } from "../../src/nodeExecutor";

describe("custom rows input node", () => {
  it("uses the configured table name for the synthetic output table", async () => {
    const result = await executeNodeAction({
      nodeId: "node_11",
      nodeType: "customrowsinput",
      textValue: "",
      config: {
        tableName: "contet_effects",
        customRows: [
          {
            effect_key: "wh_main_effect_economy_gdp_mod_all",
            effect_scope: "province_to_region_own",
            value: "10",
          },
        ],
      },
      inputData: {
        type: "CustomSchema",
        schemaColumns: [
          { id: "c1", name: "effect_key", type: "StringU8" },
          { id: "c2", name: "effect_scope", type: "StringU8" },
          { id: "c3", name: "value", type: "I32" },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.tables?.[0]?.name).toBe("db\\contet_effects");
    expect(result.data?.tables?.[0]?.fileName).toBe("db\\contet_effects");
    expect(result.data?.tables?.[0]?.table?.name).toBe("db\\contet_effects");
  });
});
