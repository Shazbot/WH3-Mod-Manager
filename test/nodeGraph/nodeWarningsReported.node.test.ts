import { describe, expect, it, vi } from "vitest";

import { executeNodeAction } from "../../src/nodeExecutor";
import type { Pack, PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const textTable = (name: string, text: string): DBTablesNodeTable => {
  const buffer = Buffer.from(text, "utf8");
  return {
    name,
    fileName: name,
    sourceFile: { name: "source.pack", path: "source.pack", packedFiles: [], readTables: [] } as Pack,
    table: { name, file_size: buffer.length, start_pos: 0, buffer } as PackedFile,
    outputFileName: name,
  };
};

const input: DBTablesNodeData = {
  type: "TableSelection",
  tables: [textTable("script\\one.lua", "one")],
  sourceFiles: [],
  tableCount: 1,
};

describe("a node that succeeds but changed nothing", () => {
  it("returns the misses as warnings, so an empty output is not read as a clean run", async () => {
    const result = await executeNodeAction({
      nodeId: "edit_text",
      nodeType: "edittextfile",
      textValue: "",
      config: {
        textFileRules: [
          {
            id: "no_such_text",
            targetMatch: "input",
            target: "",
            mode: "text",
            selector: "text that is not there",
            operation: "replace",
            value: "replacement",
          },
        ],
      },
      inputData: input,
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toContain("matched nothing");
  });

  it("leaves warnings off a run where every rule found its target", async () => {
    const result = await executeNodeAction({
      nodeId: "edit_text",
      nodeType: "edittextfile",
      textValue: "",
      config: {
        textFileRules: [
          {
            id: "hit",
            targetMatch: "input",
            target: "",
            mode: "text",
            selector: "one",
            operation: "replace",
            value: "two",
          },
        ],
      },
      inputData: input,
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });
});
