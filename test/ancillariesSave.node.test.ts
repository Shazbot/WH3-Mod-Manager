import * as zlib from "zlib";
import { describe, expect, it, vi } from "vitest";

/** The app's zstd is a native Electron prebuild; node's own reads the same frames. */
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (buffer: Buffer, level: number) => zlib.zstdCompressSync(buffer, { params: { 0: level } }),
  decompress: async (buffer: Buffer) => zlib.zstdDecompressSync(buffer),
}));
vi.mock("electron-is-dev", () => ({ default: false }));

import { buildAncillariesFileName, buildPackedFilesFromNewRows } from "../src/ancillariesData/save";
import { ancillariesEditReducer, emptyAncillariesEditState, LOC_TABLE } from "../src/ancillariesData/edits";
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

/** The real `ancillaries_tables` column types, trimmed to one of each. */
const ancillariesSchema: DBVersion = {
  version: 0,
  fields: [
    field("key", "StringU8", "", true),
    field("type", "StringU8"),
    field("category", "StringU8"),
    field("subcategory", "OptionalStringU8"),
    field("uniqueness_score", "I32", "0"),
    field("transferrable", "Boolean", "true"),
    field("legendary_item", "Boolean", "false"),
  ],
};

/** `ancillary_to_effects_tables`: a two-column key plus an F32 value. */
const effectsSchema: DBVersion = {
  version: 0,
  fields: [
    field("ancillary", "StringU8", "", true),
    field("effect", "StringU8", "", true),
    field("effect_scope", "StringU8"),
    field("value", "F32", "0"),
  ],
};

const infoSchema: DBVersion = { version: 0, fields: [field("ancillary", "StringU8", "", true)] };

const stateWith = (rows: Array<{ table: string; values: Record<string, string> }>) =>
  ancillariesEditReducer(emptyAncillariesEditState(), {
    type: "addRows",
    rows: rows.map((row) => ({ ...row, origin: "manual" as const })),
  });

/** Serialize as the app does, then parse back with the app's own reader. */
const roundTrip = (packedFile: ReturnType<typeof buildPackedFilesFromNewRows>["files"][number], version: DBVersion) => {
  const buffer = serializePackFileDataToBuffer(packedFile);
  expect(buffer.length).toBeGreaterThan(0);
  return chunkSchemaIntoRows(packedFile.schemaFields ?? [], version);
};

const schemas = {
  ancillaries_tables: ancillariesSchema,
  ancillary_to_effects_tables: effectsSchema,
  ancillary_info_tables: infoSchema,
};

describe("buildPackedFilesFromNewRows", () => {
  it("gives each table its own uniquely named file", () => {
    const state = stateWith([
      { table: "ancillaries_tables", values: { key: "anc_a" } },
      { table: "ancillary_info_tables", values: { ancillary: "anc_a" } },
    ]);

    const { files } = buildPackedFilesFromNewRows({
      state,
      tableSchemas: schemas,
      fileName: "!!!me_ancillaries",
    });
    expect(files.map((file) => file.name).sort()).toEqual([
      "db\\ancillaries_tables\\!!!me_ancillaries",
      "db\\ancillary_info_tables\\!!!me_ancillaries",
    ]);
  });

  it("writes rows at the schema version it was given, not the newest one", () => {
    const state = stateWith([{ table: "ancillaries_tables", values: { key: "anc_a" } }]);
    const { files } = buildPackedFilesFromNewRows({
      state,
      tableSchemas: { ancillaries_tables: { ...ancillariesSchema, version: 4 } },
      fileName: "f",
    });
    // Writing against a version the game's own table does not use makes the pack unreadable.
    expect(files[0].version).toBe(4);
    expect(files[0].tableSchema?.version).toBe(4);
  });

  it("reports a table it has no schema for rather than dropping it silently", () => {
    const state = stateWith([{ table: "ancillaries_tables", values: { key: "anc_a" } }]);
    const { files, skippedTables } = buildPackedFilesFromNewRows({ state, tableSchemas: {}, fileName: "f" });
    expect(files).toEqual([]);
    expect(skippedTables).toEqual(["ancillaries_tables"]);
  });

  it("round-trips every field type through the app's serializer", () => {
    const state = stateWith([
      {
        table: "ancillaries_tables",
        values: {
          key: "my_anc_1",
          type: "wh_main_anc_weapon",
          category: "weapon",
          subcategory: "",
          uniqueness_score: "80",
          transferrable: "true",
          legendary_item: "false",
        },
      },
    ]);
    const { files } = buildPackedFilesFromNewRows({ state, tableSchemas: schemas, fileName: "f" });

    const rows = roundTrip(files[0], ancillariesSchema);
    expect(rows).toHaveLength(1);
    const byName = Object.fromEntries(rows[0].map((cell) => [cell.name, cell.resolvedKeyValue]));
    expect(byName).toEqual({
      key: "my_anc_1",
      type: "wh_main_anc_weapon",
      category: "weapon",
      // An empty OptionalStringU8 resolves to "0", the absent flag rather than the text "0".
      subcategory: "0",
      uniqueness_score: "80",
      transferrable: "1",
      legendary_item: "0",
    });
  });

  it("writes a two-column-key effect row, floats and all", () => {
    const state = stateWith([
      {
        table: "ancillary_to_effects_tables",
        values: {
          ancillary: "my_anc_1",
          effect: "wh_main_effect_character_stat_weapon_strength",
          effect_scope: "character_to_character_own",
          value: "12.5",
        },
      },
    ]);
    const { files } = buildPackedFilesFromNewRows({ state, tableSchemas: schemas, fileName: "f" });

    const rows = roundTrip(files[0], effectsSchema);
    const byName = Object.fromEntries(rows[0].map((cell) => [cell.name, cell.resolvedKeyValue]));
    expect(byName).toEqual({
      ancillary: "my_anc_1",
      effect: "wh_main_effect_character_stat_weapon_strength",
      effect_scope: "character_to_character_own",
      value: "12.5",
    });
  });

  it("falls back to the field default when a value is missing or unparseable", () => {
    const state = stateWith([{ table: "ancillaries_tables", values: { key: "x", uniqueness_score: "not a number" } }]);
    const { files } = buildPackedFilesFromNewRows({ state, tableSchemas: schemas, fileName: "f" });

    const byName = Object.fromEntries(
      roundTrip(files[0], ancillariesSchema)[0].map((c) => [c.name, c.resolvedKeyValue]),
    );
    expect(byName.uniqueness_score).toBe("0");
    expect(byName.transferrable).toBe("1");
  });

  it("writes loc rows as a .loc file the loc serializer understands", () => {
    const state = stateWith([
      { table: LOC_TABLE, values: { key: "ancillaries_onscreen_name_my_anc_1", text: "My Ancillary" } },
    ]);
    const { files } = buildPackedFilesFromNewRows({ state, tableSchemas: {}, fileName: "!!!me_ancillaries" });
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("text\\db\\!!!me_ancillaries.loc");

    const byName = Object.fromEntries(roundTrip(files[0], LocVersion)[0].map((c) => [c.name, c.resolvedKeyValue]));
    expect(byName).toEqual({ key: "ancillaries_onscreen_name_my_anc_1", text: "My Ancillary", tooltip: "0" });
  });

  it("writes an identical row once, however many times it was added", () => {
    const state = stateWith([
      { table: "ancillaries_tables", values: { key: "anc_a", uniqueness_score: "5" } },
      { table: "ancillaries_tables", values: { key: "anc_a", uniqueness_score: "5" } },
      { table: "ancillaries_tables", values: { key: "anc_b" } },
    ]);
    const { files } = buildPackedFilesFromNewRows({ state, tableSchemas: schemas, fileName: "f" });

    expect(roundTrip(files[0], ancillariesSchema).map((row) => row[0].resolvedKeyValue)).toEqual(["anc_a", "anc_b"]);
  });

  it("keeps two rows that share a key but differ in a written column", () => {
    const state = stateWith([
      { table: "ancillaries_tables", values: { key: "anc_a", uniqueness_score: "5" } },
      { table: "ancillaries_tables", values: { key: "anc_a", uniqueness_score: "6" } },
    ]);
    const { files } = buildPackedFilesFromNewRows({ state, tableSchemas: schemas, fileName: "f" });

    expect(roundTrip(files[0], ancillariesSchema)).toHaveLength(2);
  });

  it("drops a loc row that repeats both key and text", () => {
    const state = stateWith([
      { table: LOC_TABLE, values: { key: "ancillaries_onscreen_name_a", text: "A" } },
      { table: LOC_TABLE, values: { key: "ancillaries_onscreen_name_a", text: "A" } },
      { table: LOC_TABLE, values: { key: "ancillaries_onscreen_name_a", text: "Renamed" } },
    ]);
    const { files } = buildPackedFilesFromNewRows({ state, tableSchemas: {}, fileName: "f" });

    expect(roundTrip(files[0], LocVersion).map((row) => row[1].resolvedKeyValue)).toEqual(["A", "Renamed"]);
  });

  it("writes one row per new row, in order", () => {
    const state = stateWith([
      { table: "ancillaries_tables", values: { key: "anc_a" } },
      { table: "ancillaries_tables", values: { key: "anc_b" } },
    ]);
    const { files } = buildPackedFilesFromNewRows({ state, tableSchemas: schemas, fileName: "f" });
    const rows = roundTrip(files[0], ancillariesSchema);
    expect(rows.map((row) => row[0].resolvedKeyValue)).toEqual(["anc_a", "anc_b"]);
  });
});

describe("buildAncillariesFileName", () => {
  const TAG = /_[a-z0-9]{6}$/;

  it("prefixes with !!! so the file sorts last and nothing vanilla shares the name", () => {
    expect(buildAncillariesFileName("me", [])).toMatch(/^!!!me_ancillaries_[a-z0-9]{6}$/);
  });

  it("trims trailing underscores from the modder prefix", () => {
    expect(buildAncillariesFileName("me__", [])).toMatch(/^!!!me_ancillaries_/);
  });

  it("falls back to whmm when the prefix is blank", () => {
    expect(buildAncillariesFileName("   ", [])).toMatch(/^!!!whmm_ancillaries_/);
  });

  // Two packs saved from the same prefix must not both claim db\<table>\!!!me_ancillaries.
  it("ends in a different tag every time, so separate output packs never collide", () => {
    const names = new Set(Array.from({ length: 50 }, () => buildAncillariesFileName("me", [])));
    expect(names.size).toBe(50);
    for (const name of names) expect(name).toMatch(TAG);
  });

  it("picks a free name rather than replacing someone else's file", () => {
    // The first tag it draws is already in the pack, so it has to draw again.
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const firstTag = (0.5).toString(36).slice(2, 8);
    const taken = [`db\\ancillaries_tables\\!!!me_ancillaries_${firstTag}`];

    expect(buildAncillariesFileName("me", taken)).toBe(`!!!me_ancillaries_${(0.25).toString(36).slice(2, 8)}`);
    random.mockRestore();
  });

  it("steps around a colliding loc file too", () => {
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const taken = [`text\\db\\!!!me_ancillaries_${(0.5).toString(36).slice(2, 8)}.loc`];

    expect(buildAncillariesFileName("me", taken)).toBe(`!!!me_ancillaries_${(0.25).toString(36).slice(2, 8)}`);
    random.mockRestore();
  });

  it("compares case-insensitively, as pack paths are compared everywhere else", () => {
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const taken = [`DB\\ANCILLARIES_TABLES\\!!!ME_ANCILLARIES_${(0.5).toString(36).slice(2, 8).toUpperCase()}`];

    expect(buildAncillariesFileName("me", taken)).toBe(`!!!me_ancillaries_${(0.25).toString(36).slice(2, 8)}`);
    random.mockRestore();
  });
});
