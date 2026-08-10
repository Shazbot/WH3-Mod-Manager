import { describe, expect, it } from "vitest";

import { buildVanillaDbCache } from "../../src/vanillaDbCache/build";
import { createMemorySource, openVanillaDbCache } from "../../src/vanillaDbCache/read";
import { searchVanillaDbCache } from "../../src/vanillaDbCache/search";
import type { DBField, DBVersion, Field, PackedFile, SchemaField } from "../../src/packFileTypes";

const identity = {
  game: "wh3",
  dbPackPath: "db.pack",
  dbPackSize: 1,
  dbPackMtimeMs: 1,
  schemaHash: "h",
};

const field = (name: string, fieldType: DBField["field_type"], isKey = false): DBField =>
  ({ name, field_type: fieldType, is_key: isKey }) as DBField;

const stringCell = (value: string): SchemaField => ({
  type: "StringU8",
  fields: [
    { type: "Int16", val: value.length },
    { type: "String", val: value },
  ] as Field[],
});

const numberCell = (value: number): SchemaField => ({
  type: "I32",
  fields: [{ type: "I32", val: value }] as Field[],
});

const schema: DBVersion = {
  version: 1,
  fields: [field("key", "StringU8", true), field("faction", "StringU8"), field("cost", "I32")],
};

const packedFile = (name: string, rows: Array<[string, string, number]>): PackedFile =>
  ({
    name,
    schemaFields: rows.flatMap(([key, faction, cost]) => [
      stringCell(key),
      stringCell(faction),
      numberCell(cost),
    ]),
    version: 1,
    file_size: 0,
    start_pos: 0,
  }) as unknown as PackedFile;

const openWith = (files: PackedFile[]) => {
  const { bytes } = buildVanillaDbCache(files, () => schema, identity);
  const reader = openVanillaDbCache(createMemorySource(bytes));
  if (!reader) throw new Error("expected the cache to open");
  return reader;
};

const sampleReader = () =>
  openWith([
    packedFile("db\\main_units_tables\\data__", [
      ["wh_main_grn_spear", "wh_main_grn_greenskins", 400],
      ["wh_main_emp_sword", "wh_main_emp_empire", 350],
      ["wh2_dlc09_tmb_bow", "wh2_dlc09_tmb_tomb_kings", 500],
    ]),
    packedFile("db\\land_units_tables\\data__", [
      ["wh_main_grn_spear_land", "wh_main_grn_greenskins", 1],
      ["unrelated_thing", "wh_main_brt_bretonnia", 2],
    ]),
  ]);

describe("vanilla db cache search", () => {
  it("finds a value across tables and columns", () => {
    const { matches } = searchVanillaDbCache(sampleReader(), { query: "wh_main_grn_greenskins" });

    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.packedFilePath)).toEqual([
      "db\\main_units_tables\\data__",
      "db\\land_units_tables\\data__",
    ]);
    expect(matches.every((match) => match.columnName === "faction")).toBe(true);
  });

  it("reports where each match is, precisely enough to open it", () => {
    const { matches } = searchVanillaDbCache(sampleReader(), { query: "wh2_dlc09_tmb_bow" });

    expect(matches).toEqual([
      {
        packedFilePath: "db\\main_units_tables\\data__",
        dbName: "main_units_tables",
        columnName: "key",
        rowIndex: 2,
        value: "wh2_dlc09_tmb_bow",
      },
    ]);
  });

  it("matches substrings by default", () => {
    const { matches } = searchVanillaDbCache(sampleReader(), { query: "grn_spear" });

    expect(matches.map((match) => match.value).toSorted()).toEqual([
      "wh_main_grn_spear",
      "wh_main_grn_spear_land",
    ]);
  });

  it("matches prefixes when asked, which needs no string comparison at all", () => {
    const { matches } = searchVanillaDbCache(sampleReader(), {
      query: "wh_main_grn_",
      mode: "prefix",
      caseSensitive: true,
    });

    // Every value starting with the prefix, and nothing that merely contains it.
    expect(matches.map((match) => match.value).toSorted()).toEqual([
      "wh_main_grn_greenskins",
      "wh_main_grn_greenskins",
      "wh_main_grn_spear",
      "wh_main_grn_spear_land",
    ]);
  });

  it("ignores case unless told otherwise", () => {
    const reader = sampleReader();

    expect(searchVanillaDbCache(reader, { query: "WH_MAIN_EMP_SWORD" }).matches).toHaveLength(1);
    expect(
      searchVanillaDbCache(reader, { query: "WH_MAIN_EMP_SWORD", caseSensitive: true }).matches,
    ).toHaveLength(0);
  });

  it("finds nothing for a value no table holds", () => {
    const result = searchVanillaDbCache(sampleReader(), { query: "no_such_value_anywhere" });

    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("never looks at numeric columns", () => {
    // Searching for a number as text must not match the I32 column, which holds no strings.
    expect(searchVanillaDbCache(sampleReader(), { query: "400" }).matches).toEqual([]);
  });

  it("stops at maxResults and says so", () => {
    const result = searchVanillaDbCache(sampleReader(), { query: "wh", maxResults: 2 });

    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("can be limited to some tables", () => {
    const { matches } = searchVanillaDbCache(sampleReader(), {
      query: "wh_main_grn_greenskins",
      tableFilter: "land_units",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].packedFilePath).toBe("db\\land_units_tables\\data__");
  });

  it("skips columns whose dictionary cannot contain the query", () => {
    // The property the whole approach rests on: most columns are ruled out without their rows being
    // read at all.
    const result = searchVanillaDbCache(sampleReader(), { query: "unrelated_thing" });

    expect(result.matches).toHaveLength(1);
    expect(result.columnsConsidered).toBe(4);
    expect(result.columnsScanned).toBe(1);
  });

  it("treats an empty query as no search rather than as matching everything", () => {
    const result = searchVanillaDbCache(sampleReader(), { query: "" });

    expect(result.matches).toEqual([]);
    expect(result.columnsConsidered).toBe(0);
  });
});
