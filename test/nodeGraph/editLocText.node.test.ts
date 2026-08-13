import { describe, expect, it, vi } from "vitest";

import { executeNodeAction } from "../../src/nodeExecutor";
import { buildLocKeyPrefixes } from "../../src/nodeGraph/nodeRegistry";
import { substituteLocRuleValues } from "../../src/nodeGraph/nestedOptionValues";
import { LocFields, LocVersion } from "../../src/packFileTypes";
import type { AmendedSchemaField, DBField, DBVersion, Pack, PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const locRow = (key: string, text: string): AmendedSchemaField[] =>
  LocFields.map((field, index) => ({
    name: field.name,
    type: field.field_type,
    fields: [{ type: "String" as const, val: [key, text, "0"][index] }],
    resolvedKeyValue: [key, text, "0"][index],
  }));

const dbSchema: DBVersion = {
  version: 1,
  fields: [{ name: "unit", field_type: "StringU8", is_key: true } as DBField],
};

/** Deep-clone-shaped output: db tables alongside the generated loc. */
const createInput = () => ({
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
        schemaFields: [
          {
            name: "unit",
            type: "StringU8",
            fields: [{ type: "String" as const, val: "pj_x" }],
            resolvedKeyValue: "pj_x",
          },
        ],
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
        tableSchema: LocVersion,
        schemaFields: [
          ...locRow("land_units_onscreen_name_pj_x", "Greatswords"),
          ...locRow("main_units_onscreen_name_pj_x", "Greatswords"),
          ...locRow("land_units_onscreen_name_pj_y", "Halberdiers"),
        ],
      } as PackedFile,
    },
  ],
  sourceFiles: [],
  tableCount: 2,
});

const run = (locRules: Record<string, unknown>[], inputData: unknown = createInput()) =>
  executeNodeAction({
    nodeId: "loc_1",
    nodeType: "editloctext",
    textValue: "",
    config: { locRules },
    inputData,
  });

const locTextsOf = (result: Awaited<ReturnType<typeof run>>) => {
  const table = (result.data as any).tables.find((t: any) => t.name === "deepclone_loc");
  const fields = table.table.schemaFields as AmendedSchemaField[];
  const texts: string[] = [];
  for (let i = 0; i < fields.length; i += LocFields.length) texts.push(fields[i + 1].resolvedKeyValue);
  return texts;
};

describe("edit loc text node", () => {
  it("appends to the rows whose key matches and leaves the others", async () => {
    const result = await run([{ id: "r1", keyPrefix: "land_units_onscreen_name_", append: " (Big)" }]);

    expect(locTextsOf(result)).toEqual(["Greatswords (Big)", "Greatswords", "Halberdiers (Big)"]);
  });

  it("passes non-loc tables straight through", async () => {
    const result = await run([{ id: "r1", keyPrefix: "land_units_onscreen_name_", append: " (Big)" }]);
    const tables = (result.data as any).tables;

    expect(tables).toHaveLength(2);
    expect(tables[0].name).toBe("main_units_tables");
    expect((tables[0].table.schemaFields as AmendedSchemaField[])[0].resolvedKeyValue).toBe("pj_x");
  });

  it("keeps the loc's three columns intact", async () => {
    const result = await run([{ id: "r1", keyPrefix: "land_units_onscreen_name_", append: " (Big)" }]);
    const table = (result.data as any).tables.find((t: any) => t.name === "deepclone_loc");

    expect(table.table.tableSchema.fields.map((f: DBField) => f.name)).toEqual(["key", "text", "tooltip"]);
    expect(table.table.schemaFields).toHaveLength(9);
  });

  it("prepends, and applies every matching rule in order", async () => {
    const result = await run([
      { id: "r1", keyPrefix: "land_units_", prepend: "The " },
      { id: "r2", keyPrefix: "land_units_onscreen_name_", append: " (Big)" },
    ]);

    expect(locTextsOf(result)).toEqual(["The Greatswords (Big)", "Greatswords", "The Halberdiers (Big)"]);
  });

  it("finds and replaces inside the text", async () => {
    const result = await run([
      { id: "r1", keyPrefix: "land_units_onscreen_name_", find: "sword", replaceWith: "blade" },
    ]);

    expect(locTextsOf(result)).toEqual(["Greatblades", "Greatswords", "Halberdiers"]);
  });

  it("matches the prefix case-insensitively", async () => {
    const result = await run([{ id: "r1", keyPrefix: "LAND_UNITS_ONSCREEN_NAME_", append: " (Big)" }]);

    expect(locTextsOf(result)).toEqual(["Greatswords (Big)", "Greatswords", "Halberdiers (Big)"]);
  });

  it("leaves everything alone when a prefix matches nothing", async () => {
    // Normal, not an error: whether a table contributes locs depends on the run.
    const result = await run([{ id: "r1", keyPrefix: "agent_subtypes_onscreen_name_", append: "!" }]);

    expect(locTextsOf(result)).toEqual(["Greatswords", "Greatswords", "Halberdiers"]);
  });

  it("passes through with no rules configured", async () => {
    const result = await run([]);

    expect(locTextsOf(result)).toEqual(["Greatswords", "Greatswords", "Halberdiers"]);
  });

  it("ignores a rule with no prefix rather than matching every row", async () => {
    const result = await run([{ id: "r1", keyPrefix: "", append: " (Big)" }]);

    expect(locTextsOf(result)).toEqual(["Greatswords", "Greatswords", "Halberdiers"]);
  });

  it("rejects input that is not a table selection", async () => {
    const result = await run([{ id: "r1", keyPrefix: "x", append: "y" }], { type: "Text", text: "no" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Expected TableSelection");
  });
});

describe("loc key prefix autocomplete", () => {
  it("derives one prefix per localised field, without the _tables suffix", () => {
    const prefixes = buildLocKeyPrefixes({
      land_units_tables: [
        {
          version: 1,
          fields: [],
          localised_fields: [{ name: "onscreen_name" } as DBField, { name: "description" } as DBField],
        },
      ],
      main_units_tables: [{ version: 1, fields: [], localised_fields: [{ name: "onscreen_name" } as DBField] }],
      // No localised fields, so it contributes no prefix.
      units_to_groupings_tables: [{ version: 1, fields: [] }],
    });

    expect(prefixes).toEqual(["land_units_description_", "land_units_onscreen_name_", "main_units_onscreen_name_"]);
  });

  it("returns nothing without a schema", () => {
    expect(buildLocKeyPrefixes(undefined)).toEqual([]);
  });
});

describe("flow options in loc rules", () => {
  it("substitutes placeholders in every rule field", () => {
    const nodeData = {
      locRules: [{ id: "r1", keyPrefix: "land_units_onscreen_name_", append: "{{mySuffix}}" }],
    } as Record<string, unknown>;

    const modified = substituteLocRuleValues(nodeData, (value) => value.replace("{{mySuffix}}", " (Big)"));

    expect(modified).toBe(true);
    expect((nodeData.locRules as any[])[0].append).toBe(" (Big)");
    expect((nodeData.locRules as any[])[0].keyPrefix).toBe("land_units_onscreen_name_");
  });

  it("reports no change when nothing matched", () => {
    const nodeData = { locRules: [{ id: "r1", keyPrefix: "x", append: "y" }] } as Record<string, unknown>;

    expect(substituteLocRuleValues(nodeData, (value) => value)).toBe(false);
  });
});
