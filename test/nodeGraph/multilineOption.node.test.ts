import { describe, expect, it, vi } from "vitest";

import { executeNodeAction } from "../../src/nodeExecutor";
import { prepareGraphForExecution } from "../../src/nodeGraph/graphSerialization";
import { substituteFilterOptionValues } from "../../src/nodeGraph/nestedOptionValues";
import {
  getFilterRegexError,
  getFilterValueCandidates,
  getLastFilterMatchMode,
  splitMultilineOptionValue,
  type FilterMatchMode,
  type FilterRow,
} from "../../src/nodeGraph/types";
import type { AmendedSchemaField, DBField, DBVersion, Pack, PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const createField = (name: string): DBField =>
  ({
    name,
    field_type: "StringU8",
    is_key: false,
    default_value: "",
    is_filename: false,
    is_reference: [],
    description: "",
    ca_order: 0,
    is_bitwise: 0,
    enum_values: {},
  }) as DBField;

const tableSchema: DBVersion = { version: 1, fields: [createField("unit"), createField("caste")] };

const createRow = (unit: string, caste: string): AmendedSchemaField[] =>
  [unit, caste].map((value, index) => ({
    name: tableSchema.fields[index].name,
    type: "StringU8" as const,
    fields: [{ type: "String" as const, val: value }],
    resolvedKeyValue: value,
  }));

const createInput = () => ({
  type: "TableSelection" as const,
  tables: [
    {
      name: "db\\main_units_tables",
      fileName: "db\\main_units_tables\\data__",
      sourceFile: {} as Pack,
      table: {
        name: "db\\main_units_tables\\data__",
        file_size: 0,
        start_pos: 0,
        tableSchema,
        schemaFields: [
          ...createRow("emp_spearmen", "melee_infantry"),
          ...createRow("emp_greatswords", "melee_infantry"),
          ...createRow("emp_handgunners", "missile_infantry"),
        ],
      } as PackedFile,
    },
  ],
  sourceFiles: [],
  tableCount: 1,
});

const runFilterRows = async (filters: FilterRow[]) =>
  executeNodeAction({
    nodeId: "filter_1",
    nodeType: "filter",
    textValue: "",
    config: { filters },
    inputData: createInput(),
  });

const runFilter = async (value: string, not = false, matchMode?: FilterMatchMode) =>
  runFilterRows([{ column: "unit", value, not, operator: "AND", ...(matchMode ? { matchMode } : {}) }]);

const unitsOf = (result: Awaited<ReturnType<typeof runFilter>>, key: "data" | "elseData" = "data") => {
  const tables = (result[key] as any)?.tables ?? [];
  if (tables.length === 0) return [];
  const fields: AmendedSchemaField[] = tables[0].table.schemaFields;
  return fields.filter((field) => field.name === "unit").map((field) => field.resolvedKeyValue);
};

describe("splitMultilineOptionValue", () => {
  it("takes one value per line, ignoring blanks and stray whitespace", () => {
    expect(splitMultilineOptionValue("  a  \n\nb\r\n  \n c ")).toEqual(["a", "b", "c"]);
    expect(splitMultilineOptionValue("")).toEqual([]);
    expect(splitMultilineOptionValue("   \n  ")).toEqual([]);
  });
});

describe("filter value candidates", () => {
  it("keeps single-line values intact and splits multiline values", () => {
    expect(getFilterValueCandidates("a|b")).toEqual(["a|b"]);
    expect(getFilterValueCandidates(" a \n b ")).toEqual(["a", "b"]);
  });

  it("reports invalid regex candidates", () => {
    expect(getFilterRegexError("valid\n[")).toContain("Invalid");
    expect(getFilterRegexError("valid\nother")).toBeUndefined();
  });
});

describe("filter node with a multiline value", () => {
  it("keeps a single-line value as an exact match", async () => {
    const result = await runFilter("emp_spearmen");

    expect(unitsOf(result)).toEqual(["emp_spearmen"]);
  });

  it("matches any line of a multiline value", async () => {
    const result = await runFilter("emp_spearmen\nemp_handgunners");

    expect(unitsOf(result)).toEqual(["emp_spearmen", "emp_handgunners"]);
  });

  it("ignores blank lines and surrounding whitespace in the list", async () => {
    const result = await runFilter("  emp_spearmen  \n\n\r\n  emp_handgunners\n");

    expect(unitsOf(result)).toEqual(["emp_spearmen", "emp_handgunners"]);
  });

  it("inverts to none-of when the row is negated", async () => {
    const result = await runFilter("emp_spearmen\nemp_handgunners", true);

    expect(unitsOf(result)).toEqual(["emp_greatswords"]);
  });

  it("sends non-matching rows to the else handle", async () => {
    const result = await runFilter("emp_spearmen\nemp_handgunners");

    expect(unitsOf(result, "elseData")).toEqual(["emp_greatswords"]);
  });

  it("treats values with no non-whitespace entries as inert", async () => {
    const result = await runFilter("\n  \n");

    expect(unitsOf(result)).toEqual(["emp_spearmen", "emp_greatswords", "emp_handgunners"]);
  });

  it("treats whitespace-only values as inert", async () => {
    const cases = ["full", "partial", "regex"] as const;

    for (const matchMode of cases) {
      const result = await runFilterRows([
        { column: "unit", value: "emp_spearmen", not: false, operator: "AND", matchMode: "full" },
        { column: "caste", value: "   ", not: false, operator: "AND", matchMode },
      ]);

      expect(unitsOf(result)).toEqual(["emp_spearmen"]);
    }
  });

  it("keeps a flow option that resolves empty as a non-match", async () => {
    const nodes = [
      {
        id: "node_0",
        type: "filter",
        position: { x: 0, y: 0 },
        data: {
          label: "Filter",
          type: "filter",
          filters: [{ column: "unit", value: "{{myUnits}}", not: false, operator: "AND" }],
        },
      },
    ] as any[];

    const prepared = prepareGraphForExecution({
      nodes,
      edges: [],
      flowOptions: [{ id: "myUnits", name: "Units", type: "multiline", value: "" }],
    });

    expect((prepared.nodes[0].data as any).filters[0]).toMatchObject({
      value: "",
      flowOptionResolvedEmpty: true,
    });

    const result = await executeNodeAction({
      nodeId: "node_0",
      nodeType: "filter",
      textValue: "",
      config: { filters: (prepared.nodes[0].data as any).filters },
      inputData: createInput(),
    });

    expect(unitsOf(result)).toEqual([]);
    expect(unitsOf(result, "elseData")).toEqual(["emp_spearmen", "emp_greatswords", "emp_handgunners"]);
  });
});

describe("filter node match modes", () => {
  it("uses case-insensitive substring matching in partial mode", async () => {
    const result = await runFilter("SPEAR", false, "partial");

    expect(unitsOf(result)).toEqual(["emp_spearmen"]);
    expect(unitsOf(result, "elseData")).toEqual(["emp_greatswords", "emp_handgunners"]);
  });

  it("uses each non-empty line as a case-insensitive regular expression", async () => {
    const result = await runFilter("^EMP_spearmen$\n^EMP_handgunners$", false, "regex");

    expect(unitsOf(result)).toEqual(["emp_spearmen", "emp_handgunners"]);
    expect(unitsOf(result, "elseData")).toEqual(["emp_greatswords"]);
  });

  it("does not let an invalid regular expression crash the node", async () => {
    const result = await runFilter("[", false, "regex");

    expect(result.success).toBe(true);
    expect(unitsOf(result)).toEqual([]);
  });

  it("treats empty non-first conditions as inert in every mode", async () => {
    const cases = [
      { matchMode: "full" as const, not: false },
      { matchMode: "partial" as const, not: true },
      { matchMode: "regex" as const, not: true },
    ];

    for (const { matchMode, not } of cases) {
      const result = await runFilterRows([
        { column: "unit", value: "emp_spearmen", not: false, operator: "AND", matchMode: "full" },
        { column: "caste", value: "", not, operator: "AND", matchMode },
      ]);

      expect(unitsOf(result)).toEqual(["emp_spearmen"]);
    }
  });

  it("does not let an empty first condition hide a later active condition", async () => {
    const result = await runFilterRows([
      { column: "", value: "", not: false, operator: "AND", matchMode: "full" },
      { column: "unit", value: "emp_spearmen", not: false, operator: "AND", matchMode: "full" },
    ]);

    expect(unitsOf(result)).toEqual(["emp_spearmen"]);
    expect(unitsOf(result, "elseData")).toEqual(["emp_greatswords", "emp_handgunners"]);
  });

  it("drops inactive rows from an OR join", async () => {
    const result = await runFilterRows([
      { column: "unit", value: "emp_spearmen", not: false, operator: "OR", matchMode: "full" },
      { column: "caste", value: "", not: false, operator: "AND", matchMode: "full" },
    ]);

    expect(unitsOf(result)).toEqual(["emp_spearmen"]);
    expect(unitsOf(result, "elseData")).toEqual(["emp_greatswords", "emp_handgunners"]);
  });

  it("drops a row whose column this table lacks from an OR join", async () => {
    const result = await runFilterRows([
      { column: "unit", value: "emp_spearmen", not: false, operator: "OR", matchMode: "full" },
      { column: "nosuchcolumn", value: "x", not: false, operator: "AND", matchMode: "full" },
    ]);

    expect(unitsOf(result)).toEqual(["emp_spearmen"]);
    expect(unitsOf(result, "elseData")).toEqual(["emp_greatswords", "emp_handgunners"]);
  });

  it("passes every row through when the only column is missing from the table", async () => {
    const result = await runFilterRows([
      { column: "nosuchcolumn", value: "x", not: false, operator: "AND", matchMode: "full" },
    ]);

    expect(unitsOf(result)).toEqual(["emp_spearmen", "emp_greatswords", "emp_handgunners"]);
    expect(unitsOf(result, "elseData")).toEqual([]);
  });

  it("uses the preceding active row's operator across inactive rows", async () => {
    const result = await runFilterRows([
      { column: "", value: "", not: false, operator: "AND", matchMode: "full" },
      { column: "unit", value: "emp_spearmen", not: false, operator: "OR", matchMode: "full" },
      { column: "caste", value: "missile_infantry", not: false, operator: "AND", matchMode: "full" },
    ]);

    expect(unitsOf(result)).toEqual(["emp_spearmen", "emp_handgunners"]);
    expect(unitsOf(result, "elseData")).toEqual(["emp_greatswords"]);
  });
});

describe("new filter row match mode", () => {
  it("inherits the last row's effective mode", () => {
    expect(getLastFilterMatchMode([{ matchMode: "partial" }, { matchMode: "regex" }])).toBe("regex");
    expect(getLastFilterMatchMode([{ matchMode: "full" }, { matchMode: "partial" }])).toBe("partial");
  });

  it("defaults to full for empty, legacy, or invalid last modes", () => {
    expect(getLastFilterMatchMode([])).toBe("full");
    expect(getLastFilterMatchMode([{}, {}])).toBe("full");
    expect(getLastFilterMatchMode([{ matchMode: "partial" }, { matchMode: "unknown" }])).toBe("full");
  });
});

describe("flow option substitution into filter values", () => {
  it("replaces a placeholder nested inside filters", () => {
    const nodeData = {
      filters: [
        { column: "unit", value: "{{myUnits}}", not: false, operator: "AND" },
        { column: "caste", value: "melee_infantry", not: false, operator: "AND" },
      ],
    } as Record<string, unknown>;

    const modified = substituteFilterOptionValues(nodeData, (value) =>
      value.replace("{{myUnits}}", "emp_spearmen\nemp_handgunners"),
    );

    expect(modified).toBe(true);
    expect((nodeData.filters as any[])[0].value).toBe("emp_spearmen\nemp_handgunners");
    expect((nodeData.filters as any[])[1].value).toBe("melee_infantry");
  });

  it("carries a multiline option into the filter through prepareGraphForExecution", () => {
    const nodes = [
      {
        id: "node_0",
        type: "filter",
        position: { x: 0, y: 0 },
        data: {
          label: "Filter",
          type: "filter",
          inputType: "TableSelection",
          outputType: "TableSelection",
          filters: [{ column: "unit", value: "{{myUnits}}", not: false, operator: "AND" }],
        },
      },
    ] as any[];

    const result = prepareGraphForExecution({
      nodes,
      edges: [],
      flowOptions: [
        {
          id: "myUnits",
          name: "Units",
          type: "multiline",
          value: "emp_spearmen\nemp_handgunners",
        },
      ],
    });

    expect((result.nodes[0].data as any).filters[0].value).toBe("emp_spearmen\nemp_handgunners");
  });

  it("filters on the substituted list end to end", async () => {
    const nodes = [
      {
        id: "node_0",
        type: "filter",
        position: { x: 0, y: 0 },
        data: {
          label: "Filter",
          type: "filter",
          filters: [{ column: "unit", value: "{{myUnits}}", not: false, operator: "AND" }],
        },
      },
    ] as any[];

    const prepared = prepareGraphForExecution({
      nodes,
      edges: [],
      flowOptions: [{ id: "myUnits", name: "Units", type: "multiline", value: "emp_greatswords\nemp_handgunners" }],
    });

    const result = await executeNodeAction({
      nodeId: "node_0",
      nodeType: "filter",
      textValue: "",
      config: { filters: (prepared.nodes[0].data as any).filters },
      inputData: createInput(),
    });

    expect(unitsOf(result)).toEqual(["emp_greatswords", "emp_handgunners"]);
  });
});
