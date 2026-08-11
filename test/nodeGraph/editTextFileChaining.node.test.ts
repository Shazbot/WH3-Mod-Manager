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

const edit = (inputData: DBTablesNodeData, textFileRules: Array<Record<string, unknown>>) =>
  executeNodeAction({
    nodeId: "edit_text",
    nodeType: "edittextfile",
    textValue: "",
    config: { textFileRules },
    inputData,
  });

describe("chained Edit Text File nodes", () => {
  it("edits the previous node output and carries every file forward", async () => {
    const input: DBTablesNodeData = {
      type: "TableSelection",
      tables: [textTable("script\\one.lua", "one"), textTable("script\\untouched.lua", "keep")],
      sourceFiles: [],
      tableCount: 2,
    };

    const first = await edit(input, [
      {
        id: "first",
        targetMatch: "input",
        target: "",
        mode: "text",
        selector: "one",
        operation: "replace",
        value: "two",
      },
    ]);
    expect(first.success).toBe(true);

    const second = await edit(first.data as DBTablesNodeData, [
      {
        id: "second",
        targetMatch: "name",
        target: "one.lua",
        mode: "text",
        selector: "two",
        operation: "replace",
        value: "three",
      },
    ]);

    expect(second.success).toBe(true);
    const tables = (second.data as DBTablesNodeData).tables;
    expect(tables).toHaveLength(2);
    expect(tables.find((table) => table.name.endsWith("one.lua"))?.table.buffer?.toString("utf8")).toBe(
      "three",
    );
    expect(tables.find((table) => table.name.endsWith("untouched.lua"))?.table.buffer?.toString("utf8")).toBe(
      "keep",
    );
  });

  it("passes guarded and rule-free previous output through unchanged", async () => {
    const input: DBTablesNodeData = {
      type: "TableSelection",
      tables: [textTable("script\\one.lua", "already edited")],
      sourceFiles: [],
      tableCount: 1,
    };

    const guarded = await edit(input, [
      {
        id: "guarded",
        targetMatch: "input",
        target: "",
        mode: "text",
        selector: "edited",
        operation: "replace",
        value: "changed",
        skipConditions: [{ id: "present", value: "already" }],
      },
    ]);
    const noRules = await edit(guarded.data as DBTablesNodeData, []);

    expect(noRules.success).toBe(true);
    expect((noRules.data as DBTablesNodeData).tables).toHaveLength(1);
    expect((noRules.data as DBTablesNodeData).tables[0].table.buffer?.toString("utf8")).toBe(
      "already edited",
    );
  });

  it("formats chained XML after applying its rules", async () => {
    const input: DBTablesNodeData = {
      type: "TableSelection",
      tables: [textTable("unit.variantmeshdefinition", "<ROOT>\n  <MESH old=\"1\"/>\n</ROOT>")],
      sourceFiles: [],
      tableCount: 1,
    };

    const result = await executeNodeAction({
      nodeId: "edit_and_format",
      nodeType: "edittextfile",
      textValue: "",
      config: {
        textFileFormatter: "compactXml",
        textFileRules: [
          {
            id: "attribute",
            targetMatch: "input",
            target: "",
            mode: "xml",
            selector: "MESH",
            operation: "setAttribute",
            attributeName: "old",
            value: "2",
          },
        ],
      },
      inputData: input,
    });

    expect(result.success).toBe(true);
    expect((result.data as DBTablesNodeData).tables[0].table.buffer?.toString("utf8")).toBe(
      '<ROOT><MESH old="2"/></ROOT>',
    );
  });
});
