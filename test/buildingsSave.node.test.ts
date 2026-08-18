import * as zlib from "zlib";
import { describe, expect, it, vi } from "vitest";

/** The app's zstd is a native Electron prebuild; node's own reads the same frames. */
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (buffer: Buffer, level: number) => zlib.zstdCompressSync(buffer, { params: { 0: level } }),
  decompress: async (buffer: Buffer) => zlib.zstdDecompressSync(buffer),
}));
vi.mock("electron-is-dev", () => ({ default: false }));

import { buildBuildingsFileName, buildPackedFilesFromNewRows } from "../src/buildingsData/save";
import { buildingsEditReducer, emptyBuildingsEditState, LOC_TABLE } from "../src/buildingsData/edits";
import { LocVersion, type DBField, type DBVersion } from "../src/packFileTypes";
import { chunkSchemaIntoRows, serializePackFileDataToBuffer } from "../src/packFileSerializer";

const field = (name: string, field_type: DBField["field_type"], defaultValue = "", isKey = false): DBField => ({
  name,
  field_type,
  default_value: defaultValue,
  is_key: isKey,
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

/** One column of every type the buildings tables actually use. */
const schema: DBVersion = {
  version: 3,
  fields: [
    field("level_name", "StringU8", "", true),
    field("optional_set", "OptionalStringU8"),
    field("optional_empty", "OptionalStringU8"),
    field("level", "I32", "0"),
    field("cost", "I64", "0"),
    field("weight", "F32", "0"),
    field("visible_in_ui", "Boolean", "true"),
    field("disabled", "Boolean", "false"),
  ],
};

const stateWith = (table: string, values: Record<string, string>) =>
  buildingsEditReducer(emptyBuildingsEditState(), {
    type: "addRows",
    rows: [{ table, origin: "manual", values }],
  });

/** Serialize as the app does, then parse back with the app's own reader. */
const roundTrip = (packedFile: ReturnType<typeof buildPackedFilesFromNewRows>["files"][number], version: DBVersion) => {
  const buffer = serializePackFileDataToBuffer(packedFile);
  expect(buffer.length).toBeGreaterThan(0);
  return chunkSchemaIntoRows(packedFile.schemaFields ?? [], version);
};

describe("buildPackedFilesFromNewRows", () => {
  it("gives each table its own uniquely named file", () => {
    let state = stateWith("building_levels_tables", { level_name: "a" });
    state = buildingsEditReducer(state, {
      type: "addRows",
      rows: [{ table: "building_culture_variants_tables", origin: "manual", values: { building: "a" } }],
    });

    const { files } = buildPackedFilesFromNewRows({
      state,
      tableSchemas: { building_levels_tables: schema, building_culture_variants_tables: schema },
      fileName: "!!!me_buildings",
    });
    expect(files.map((file) => file.name).sort()).toEqual([
      "db\\building_culture_variants_tables\\!!!me_buildings",
      "db\\building_levels_tables\\!!!me_buildings",
    ]);
  });

  it("reports a table it has no schema for rather than dropping it silently", () => {
    const state = stateWith("building_levels_tables", { level_name: "a" });
    const { files, skippedTables } = buildPackedFilesFromNewRows({ state, tableSchemas: {}, fileName: "f" });
    expect(files).toEqual([]);
    expect(skippedTables).toEqual(["building_levels_tables"]);
  });

  it("round-trips every field type through the app's serializer", () => {
    const state = stateWith("building_levels_tables", {
      level_name: "my_building_1",
      optional_set: "something",
      optional_empty: "",
      level: "3",
      cost: "1500",
      weight: "2.5",
      visible_in_ui: "true",
      disabled: "false",
    });
    const { files } = buildPackedFilesFromNewRows({
      state,
      tableSchemas: { building_levels_tables: schema },
      fileName: "f",
    });

    const rows = roundTrip(files[0], schema);
    expect(rows).toHaveLength(1);
    const byName = Object.fromEntries(rows[0].map((cell) => [cell.name, cell.resolvedKeyValue]));
    expect(byName).toEqual({
      level_name: "my_building_1",
      optional_set: "something",
      // An empty OptionalStringU8 resolves to "0", which is the absent flag rather than the text "0".
      optional_empty: "0",
      level: "3",
      cost: "1500",
      weight: "2.5",
      visible_in_ui: "1",
      disabled: "0",
    });
  });

  it("falls back to the field default when a value is missing or unparseable", () => {
    const state = stateWith("building_levels_tables", { level_name: "x", level: "not a number" });
    const { files } = buildPackedFilesFromNewRows({
      state,
      tableSchemas: { building_levels_tables: schema },
      fileName: "f",
    });
    const rows = roundTrip(files[0], schema);
    const byName = Object.fromEntries(rows[0].map((cell) => [cell.name, cell.resolvedKeyValue]));
    expect(byName.level).toBe("0");
    expect(byName.visible_in_ui).toBe("1");
  });

  it("writes loc rows as a .loc file the loc serializer understands", () => {
    const state = stateWith(LOC_TABLE, { key: "building_culture_variants_name_x", text: "My Building" });
    const { files } = buildPackedFilesFromNewRows({ state, tableSchemas: {}, fileName: "!!!me_buildings" });
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("text\\db\\!!!me_buildings.loc");

    const rows = roundTrip(files[0], LocVersion);
    const byName = Object.fromEntries(rows[0].map((cell) => [cell.name, cell.resolvedKeyValue]));
    expect(byName).toEqual({ key: "building_culture_variants_name_x", text: "My Building", tooltip: "0" });
  });

  it("writes one row per new row, in order", () => {
    let state = stateWith("building_levels_tables", { level_name: "first" });
    state = buildingsEditReducer(state, {
      type: "addRows",
      rows: [{ table: "building_levels_tables", origin: "manual", values: { level_name: "second" } }],
    });
    const { files } = buildPackedFilesFromNewRows({
      state,
      tableSchemas: { building_levels_tables: schema },
      fileName: "f",
    });
    const rows = roundTrip(files[0], schema);
    expect(rows.map((row) => row[0].resolvedKeyValue)).toEqual(["first", "second"]);
  });
});

describe("buildPackedFilesFromNewRows duplicates", () => {
  const rowsWith = (values: Array<Record<string, string>>) =>
    buildingsEditReducer(emptyBuildingsEditState(), {
      type: "addRows",
      rows: values.map((row) => ({ table: "building_levels_tables", origin: "manual" as const, values: row })),
    });

  it("writes an identical row once, however many times it was added", () => {
    const state = rowsWith([
      { level_name: "a", level: "1" },
      { level_name: "a", level: "1" },
      { level_name: "b", level: "1" },
    ]);
    const { files } = buildPackedFilesFromNewRows({
      state,
      tableSchemas: { building_levels_tables: schema },
      fileName: "f",
    });

    expect(roundTrip(files[0], schema).map((row) => row[0].resolvedKeyValue)).toEqual(["a", "b"]);
  });

  it("keeps two rows that share a key but differ in a written column", () => {
    const state = rowsWith([
      { level_name: "a", level: "1" },
      { level_name: "a", level: "2" },
    ]);
    const { files } = buildPackedFilesFromNewRows({
      state,
      tableSchemas: { building_levels_tables: schema },
      fileName: "f",
    });

    expect(roundTrip(files[0], schema)).toHaveLength(2);
  });
});

describe("buildBuildingsFileName", () => {
  it("uses the modder's prefix", () => {
    expect(buildBuildingsFileName("tilic", [])).toMatch(/^!!!tilic_buildings_[a-z0-9]{6}$/);
  });

  it("trims trailing underscores and falls back when there is no prefix", () => {
    expect(buildBuildingsFileName("tilic__", [])).toMatch(/^!!!tilic_buildings_/);
    expect(buildBuildingsFileName("   ", [])).toMatch(/^!!!whmm_buildings_/);
  });

  // Two packs saved from the same prefix must not both claim db\<table>\!!!tilic_buildings.
  it("ends in a different tag every time, so separate output packs never collide", () => {
    const names = new Set(Array.from({ length: 50 }, () => buildBuildingsFileName("tilic", [])));
    expect(names.size).toBe(50);
  });

  // A collision would make saveDBTableEdits replace someone else's file rather than add ours.
  it("steps around a name the target pack already uses", () => {
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const existing = [`db\\building_levels_tables\\!!!tilic_buildings_${(0.5).toString(36).slice(2, 8)}`];

    expect(buildBuildingsFileName("tilic", existing)).toBe(`!!!tilic_buildings_${(0.25).toString(36).slice(2, 8)}`);
    random.mockRestore();
  });

  it("also steps around a colliding loc file", () => {
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const existing = [`text\\db\\!!!tilic_buildings_${(0.5).toString(36).slice(2, 8)}.loc`];

    expect(buildBuildingsFileName("tilic", existing)).toBe(`!!!tilic_buildings_${(0.25).toString(36).slice(2, 8)}`);
    random.mockRestore();
  });
});
