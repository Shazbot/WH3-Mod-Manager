import * as zlib from "zlib";

import { describe, expect, it, vi } from "vitest";

import { amendSchemaField, chunkSchemaIntoRows } from "../src/packFileSerializer";
import type { DBField, DBVersion, SchemaField } from "../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (buffer: Buffer, level: number) =>
    zlib.zstdCompressSync(buffer, { params: { 0: level } }),
  decompress: async (buffer: Buffer) => zlib.zstdDecompressSync(buffer),
}));
vi.mock("electron-is-dev", () => ({ default: false }));

const field = (name: string, fieldType: DBField["field_type"]): DBField =>
  ({ name, field_type: fieldType, is_key: false }) as DBField;

const schema: DBVersion = { version: 1, fields: [field("key", "StringU8"), field("value", "I32")] };

const keyCell = (value: string): SchemaField => ({
  type: "StringU8",
  fields: [
    { type: "Int16", val: value.length },
    { type: "String", val: value },
  ],
});

const valueCell = (value: number): SchemaField => ({ type: "I32", fields: [{ type: "I32", val: value }] });

describe("chunkSchemaIntoRows", () => {
  it("splits cells into rows of the schema's width", () => {
    const rows = chunkSchemaIntoRows(
      [keyCell("alpha"), valueCell(11), keyCell("beta"), valueCell(22)],
      schema,
    );

    expect(rows.map((row) => row.map((cell) => cell.fields[cell.fields.length - 1].val))).toEqual([
      ["alpha", 11],
      ["beta", 22],
    ]);
  });

  /**
   * The state a table is left in when the game ships a column the bundled schema does not have:
   * `readDBPackedFiles` reads until it runs off the end and keeps the cells it already collected, so
   * the last row is short. Handing it back made every caller that pairs cell `i` with field `i`
   * either read an undefined cell or build a partial record from it.
   */
  it("drops a trailing row the parse never finished", () => {
    const rows = chunkSchemaIntoRows(
      [keyCell("alpha"), valueCell(11), keyCell("beta"), valueCell(22), keyCell("orphan")],
      schema,
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.length === schema.fields.length)).toBe(true);
  });

  it("has no rows for a table whose parse produced nothing", () => {
    expect(chunkSchemaIntoRows([], schema)).toEqual([]);
    expect(chunkSchemaIntoRows([keyCell("orphan")], schema)).toEqual([]);
  });

  it("has no rows for a schema with no fields, rather than one row of everything", () => {
    expect(chunkSchemaIntoRows([keyCell("alpha")], { version: 1, fields: [] })).toEqual([]);
  });
});

describe("amendSchemaField", () => {
  it("amends every cell of a table that parsed fully", () => {
    const amended = amendSchemaField(
      [keyCell("alpha"), valueCell(11), keyCell("beta"), valueCell(22)],
      schema,
    );

    expect(amended.map((cell) => [cell.name, cell.resolvedKeyValue])).toEqual([
      ["key", "alpha"],
      ["value", "11"],
      ["key", "beta"],
      ["value", "22"],
    ]);
  });

  /**
   * The state a table is left in when the game ships a column the bundled schema does not have:
   * `readDBPackedFiles` reads until it runs off the end and keeps the cells it already collected, so
   * the last row is short. Amending it used to read `.fields` off the cell that was never parsed.
   */
  it("drops a trailing row the parse never finished instead of throwing on it", () => {
    const amended = amendSchemaField(
      [keyCell("alpha"), valueCell(11), keyCell("beta"), valueCell(22), keyCell("orphan")],
      schema,
    );

    expect(amended.map((cell) => cell.resolvedKeyValue)).toEqual(["alpha", "11", "beta", "22"]);
  });

  it("returns whole rows, so re-chunking by the schema's field count lines up", () => {
    const amended = amendSchemaField([keyCell("alpha"), valueCell(11), keyCell("orphan")], schema);

    expect(amended).toHaveLength(schema.fields.length);
  });

  it("has nothing to amend for an empty table", () => {
    expect(amendSchemaField([], schema)).toEqual([]);
  });
});
