import { describe, expect, it } from "vitest";

import { buildRowFromValues } from "../src/utility/dbRowCells";
import {
  buildRpfmTsvContent,
  convertRpfmTsvToPackedFile,
  formatRpfmTsvCell,
  getRpfmTsvExportPath,
} from "../src/utility/rpfmTsv";
import { LocVersion, type DBVersion, type SchemaField } from "../src/packFileTypes";

describe("RPFM disk export formatting", () => {
  it("keeps composite keys stable, escapes control characters, and preserves exact integers", () => {
    const diskSchema: DBVersion = {
      version: 0,
      fields: [
        { ...LocVersion.fields[0], name: "number", field_type: "I64", is_key: false },
        { ...LocVersion.fields[0], name: "second", is_key: true },
        { ...LocVersion.fields[0], name: "amount", field_type: "F64", is_key: false },
        { ...LocVersion.fields[0], name: "first", is_key: true },
        { ...LocVersion.fields[0], name: "optional", field_type: "OptionalStringU8", is_key: false },
      ],
    };
    const row = buildRowFromValues(diskSchema, {
      number: "9223372036854775807",
      second: "b",
      first: 'a\\path\t"quoted"\nnext',
      amount: 1.25,
      optional: "0",
    });
    row[0].fields = [{ type: "I64", val: "9223372036854775807" }];
    expect(
      buildRpfmTsvContent({
        packedFilePath: "db/example_tables/data__",
        tableName: "example_tables",
        version: 0,
        schema: diskSchema,
        rows: [row],
        formatting: "rpfm",
        keysFirst: true,
      }),
    ).toBe(
      'second\tfirst\tnumber\tamount\toptional\n#example_tables;0;db/example_tables/data__\t\t\t\t\nb\ta\\path\\t"quoted"\\nnext\t9223372036854775807\t1.2500\t0\n',
    );
  });

  it("matches LOC's double control-character escaping without changing ordinary backslashes", () => {
    const row = buildRowFromValues(LocVersion, { key: "k", text: 'one\nAppdata\\Roaming\t"quote"', tooltip: false });
    expect(
      buildRpfmTsvContent({
        packedFilePath: "text/db/example.loc",
        tableName: "Loc",
        version: 1,
        schema: LocVersion,
        rows: [row],
        formatting: "rpfm",
      }),
    ).toBe('key\ttext\ttooltip\n#Loc;1;text/db/example.loc\t\t\nk\tone\\\\nAppdata\\Roaming\\\\t"quote"\tfalse\n');
  });

  it("processes colour groups at the end and formats packed colours as uppercase hex", () => {
    const colourSchema: DBVersion = {
      version: 0,
      fields: [
        { ...LocVersion.fields[0], name: "col_b", field_type: "I32", is_key: false, is_part_of_colour: 1, ca_order: 3 },
        { ...LocVersion.fields[0], name: "key", is_key: true },
        { ...LocVersion.fields[0], name: "col_r", field_type: "I32", is_key: false, is_part_of_colour: 1, ca_order: 1 },
        { ...LocVersion.fields[0], name: "col_g", field_type: "I32", is_key: false, is_part_of_colour: 1, ca_order: 2 },
        { ...LocVersion.fields[0], name: "packed", field_type: "ColourRGB", is_key: false },
      ],
    };
    const row = buildRowFromValues(colourSchema, { col_b: 255, col_r: 0, col_g: 170, key: "a", packed: 43520 });
    expect(
      buildRpfmTsvContent({
        packedFilePath: "db/example_tables/data__",
        tableName: "example_tables",
        version: 0,
        schema: colourSchema,
        rows: [row],
        formatting: "rpfm",
      }),
    ).toBe("key\tpacked\tcol_hex\n#example_tables;0;db/example_tables/data__\t\t\na\t00AA00\t00AAFF\n");
    const unnamed: DBVersion = {
      ...colourSchema,
      fields: colourSchema.fields.map((field) => ({
        ...field,
        name: ({ col_r: "red", col_g: "green", col_b: "blue" } as Record<string, string>)[field.name] ?? field.name,
      })),
    };
    expect(
      buildRpfmTsvContent({
        packedFilePath: "db/example_tables/data__",
        tableName: "example_tables",
        version: 0,
        schema: unnamed,
        rows: [row],
        formatting: "rpfm",
      }).split("\n")[0],
    ).toBe("key\tpacked\tunnamed colour group_1");
  });
});

const schema: DBVersion = {
  version: 3,
  fields: [
    {
      name: "key",
      field_type: "StringU8",
      default_value: "",
      is_key: true,
      is_filename: false,
      is_reference: [],
      description: "",
      ca_order: 0,
      is_bitwise: 0,
      enum_values: {},
    },
    {
      name: "amount",
      field_type: "I32",
      default_value: "0",
      is_key: false,
      is_filename: false,
      is_reference: [],
      description: "",
      ca_order: 0,
      is_bitwise: 0,
      enum_values: {},
    },
    {
      name: "enabled",
      field_type: "Boolean",
      default_value: "false",
      is_key: false,
      is_filename: false,
      is_reference: [],
      description: "",
      ca_order: 0,
      is_bitwise: 0,
      enum_values: {},
    },
  ],
};

describe("RPFM TSV serialization", () => {
  const boolCell = (value: number): SchemaField => ({ type: "Boolean", fields: [{ type: "UInt8", val: value }] });
  const optionalString = (value: string | undefined): SchemaField => ({
    type: "OptionalStringU8",
    fields:
      value == undefined
        ? [{ type: "Int8", val: 0 }]
        : [
            { type: "Int8", val: 1 },
            { type: "Int16", val: value.length },
            { type: "String", val: value },
          ],
  });

  it("formats Boolean and string cells", () => {
    expect(formatRpfmTsvCell("Boolean", boolCell(0))).toBe("false");
    expect(formatRpfmTsvCell("Boolean", boolCell(1))).toBe("true");
    expect(formatRpfmTsvCell("Boolean", undefined)).toBe("false");
    expect(
      formatRpfmTsvCell("StringU8", {
        type: "StringU8",
        fields: [
          { type: "Int16", val: 5 },
          { type: "String", val: "a\tb\nc" },
        ],
      }),
    ).toBe("a b c");
  });

  it("tells an absent optional string from one holding the literal '0'", () => {
    // resolveKeyValue collapses both of these onto "0", so exporting through it silently turned
    // every real "0" into an empty cell - 759 such cells exist across 7 vanilla tables.
    expect(formatRpfmTsvCell("OptionalStringU8", optionalString(undefined))).toBe("");
    expect(formatRpfmTsvCell("OptionalStringU8", optionalString(""))).toBe("");
    expect(formatRpfmTsvCell("OptionalStringU8", optionalString("0"))).toBe("0");
  });

  it("round-trips an optional string holding the literal '0'", () => {
    const optionalSchema: DBVersion = {
      version: 1,
      fields: [
        { ...schema.fields[0] },
        { ...schema.fields[0], name: "opt", field_type: "OptionalStringU8", is_key: false },
      ],
    };
    const content = buildRpfmTsvContent({
      packedFilePath: "db\\opt_tables\\data__",
      tableName: "opt_tables",
      version: 1,
      schema: optionalSchema,
      rows: [buildRowFromValues(optionalSchema, { key: "a", opt: "0" })],
    });
    expect(content.split("\n")[2]).toBe("a\t0");

    const packedFile = convertRpfmTsvToPackedFile(content, "x.tsv", { opt_tables: [optionalSchema] }, "x.tsv");
    // Present (flag 1), one character long, and that character is "0" - not an absent optional.
    expect(packedFile?.schemaFields?.[1].fields.map((field) => field.val)).toEqual([1, 1, "0"]);
  });

  it("round-trips an ordinary table with its real path", () => {
    const rows = [buildRowFromValues(schema, { key: "unit_a", amount: "17", enabled: "true" })];
    const content = buildRpfmTsvContent({
      packedFilePath: "db\\example_tables\\data__",
      tableName: "example_tables",
      version: schema.version,
      schema,
      rows,
    });

    expect(content.split("\n")[1]).toBe("#example_tables;3;db/example_tables/data__");
    const packedFile = convertRpfmTsvToPackedFile(content, "fallback.tsv", { example_tables: [schema] }, "test.tsv");
    expect(packedFile?.name).toBe("db\\example_tables\\data__");
    expect(packedFile?.schemaFields?.map((cell) => cell.fields[0]?.val)).toEqual(["unit_a".length, 17, 1]);
  });

  it("keeps unused-table paths and uses the fixed Loc schema", () => {
    const spareContent = buildRpfmTsvContent({
      packedFilePath: "unusedtables\\example_tables\\data__",
      tableName: "example_tables",
      version: 3,
      schema,
      rows: [],
    });
    expect(spareContent.split("\n")[1]).toBe("#example_tables;3;unusedtables/example_tables/data__");

    const locContent = buildRpfmTsvContent({
      packedFilePath: "text\\db\\abilities__.loc",
      tableName: "db",
      version: 99,
      schema: LocVersion,
      rows: [buildRowFromValues(LocVersion, { key: "k", text: "Text", tooltip: "false" })],
    });
    expect(locContent.split("\n")[1]).toBe("#Loc;1;text/db/abilities__.loc");
    expect(getRpfmTsvExportPath("text\\db\\abilities__.loc")).toBe("text/db/abilities__.loc.tsv");
    const packedLoc = convertRpfmTsvToPackedFile(locContent, "abilities__.loc.tsv", {}, "abilities__.loc.tsv");
    expect(packedLoc?.name).toBe("text\\db\\abilities__.loc");
    expect(packedLoc?.tableSchema).toBe(LocVersion);
  });
});
