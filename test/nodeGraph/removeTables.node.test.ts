import { describe, expect, it, vi } from "vitest";

import { executeNodeAction } from "../../src/nodeExecutor";
import { deserializeNodeGraph, serializeNodeGraphState } from "../../src/nodeGraph/graphSerialization";
import type { Pack, PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const createEntry = (name: string) => ({
  name,
  fileName: `${name}\\data__`,
  sourceFile: {} as Pack,
  table: { name, file_size: 0, start_pos: 0 } as PackedFile,
});

/** Shaped like a deep clone's output: db tables, a generated loc, and a copied art file. */
const createInput = () => ({
  type: "TableSelection" as const,
  tables: [
    createEntry("main_units_tables"),
    createEntry("land_units_tables"),
    createEntry("variants_tables"),
    createEntry("deepclone_loc"),
    createEntry("ui\\units\\minspec_portholes\\new_unit.png"),
  ],
  sourceFiles: [],
  tableCount: 5,
});

const runRemove = (tablesToRemove: string[], inputData: unknown = createInput()) =>
  executeNodeAction({
    nodeId: "remove_1",
    nodeType: "removetables",
    textValue: "",
    config: { tablesToRemove },
    inputData,
  });

const namesOf = (result: Awaited<ReturnType<typeof runRemove>>) =>
  ((result.data as any)?.tables ?? []).map((table: { name: string }) => table.name);

describe("remove tables node", () => {
  it("drops one named table and keeps the rest", async () => {
    const result = await runRemove(["variants_tables"]);

    expect(namesOf(result)).toEqual([
      "main_units_tables",
      "land_units_tables",
      "deepclone_loc",
      "ui\\units\\minspec_portholes\\new_unit.png",
    ]);
  });

  it("drops several tables at once", async () => {
    const result = await runRemove(["variants_tables", "land_units_tables"]);

    expect(namesOf(result)).toEqual([
      "main_units_tables",
      "deepclone_loc",
      "ui\\units\\minspec_portholes\\new_unit.png",
    ]);
  });

  it("keeps tableCount in step with the tables it emits", async () => {
    const result = await runRemove(["variants_tables"]);

    expect((result.data as any).tableCount).toBe(4);
  });

  it("matches whether or not the name carries the db\\ prefix", async () => {
    const prefixed = await runRemove(["db\\variants_tables"]);
    expect(namesOf(prefixed)).not.toContain("variants_tables");

    const input = createInput();
    input.tables[2] = createEntry("db\\variants_tables");
    const bare = await runRemove(["variants_tables"], input);
    expect(namesOf(bare)).not.toContain("db\\variants_tables");
  });

  it("matches case-insensitively", async () => {
    const result = await runRemove(["Variants_Tables"]);

    expect(namesOf(result)).not.toContain("variants_tables");
  });

  it("removes a generated loc entry, which is not a schema table", async () => {
    const result = await runRemove(["deepclone_loc"]);

    expect(namesOf(result)).not.toContain("deepclone_loc");
    expect(namesOf(result)).toContain("main_units_tables");
  });

  it("passes everything through when nothing is configured", async () => {
    const result = await runRemove([]);

    expect(namesOf(result)).toHaveLength(5);
  });

  it("ignores blank entries rather than dropping unnamed tables", async () => {
    const result = await runRemove(["", "   "]);

    expect(namesOf(result)).toHaveLength(5);
  });

  it("is unbothered by a name that matches nothing", async () => {
    const result = await runRemove(["not_a_table_tables"]);

    expect(namesOf(result)).toHaveLength(5);
  });

  it("rejects input that is not a table selection", async () => {
    const result = await runRemove(["variants_tables"], { type: "Text", text: "nope" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Expected TableSelection");
  });

  it("keeps its list through save and load", () => {
    const nodes = [
      {
        id: "node_0",
        type: "removetables",
        position: { x: 0, y: 0 },
        data: {
          label: "Remove Tables",
          type: "removetables",
          inputType: "TableSelection",
          outputType: "TableSelection",
          tablesToRemove: ["variants_tables", "deepclone_loc"],
        },
      },
    ] as any[];

    const serialized = serializeNodeGraphState({
      nodes,
      edges: [],
      flowOptions: [],
      isGraphEnabled: true,
      graphStartsEnabled: true,
    });
    const deserialized = deserializeNodeGraph(JSON.stringify(serialized));

    expect(deserialized.nodes[0].data.tablesToRemove).toEqual(["variants_tables", "deepclone_loc"]);
  });
});
