import { describe, expect, it } from "vitest";

import { buildVanillaDbCache } from "../../src/vanillaDbCache/build";
import {
  VanillaDbCacheIntegrityError,
  createMemorySource,
  openVanillaDbCache,
} from "../../src/vanillaDbCache/read";
import {
  VANILLA_DB_CACHE_HEADER_BYTES,
  decodeVanillaDbCacheHeader,
} from "../../src/vanillaDbCache/format";
import type { DBField, DBVersion, Field, PackedFile, SchemaField } from "../../src/packFileTypes";

const identity = {
  game: "wh3",
  dbPackPath: "K:\\game\\data\\db.pack",
  dbPackSize: 123,
  dbPackMtimeMs: 456,
  schemaHash: "abc123",
};

const field = (name: string, fieldType: DBField["field_type"], isKey = false): DBField =>
  ({ name, field_type: fieldType, is_key: isKey }) as DBField;

const cell = (type: SchemaField["type"], fields: Field[], isKey?: boolean): SchemaField =>
  isKey ? { type, fields, isKey: true } : { type, fields };

const packedFile = (name: string, cells: SchemaField[], version?: number): PackedFile =>
  ({ name, schemaFields: cells, version, file_size: 0, start_pos: 0 }) as unknown as PackedFile;

const openBuilt = (
  files: PackedFile[],
  schemaFor: (file: PackedFile) => DBVersion | undefined,
  maxDecodedBytes?: number,
) => {
  const { bytes } = buildVanillaDbCache(files, schemaFor, identity);
  const source = createMemorySource(bytes);
  const reader = openVanillaDbCache(source, identity, maxDecodedBytes);
  if (!reader) throw new Error("expected the cache to open");
  return { reader, bytes };
};

/** Every field type at once, so the round trip covers each cell shape in one table. */
const everyTypeSchema: DBVersion = {
  version: 4,
  fields: [
    field("key", "StringU8", true),
    field("wide", "StringU16"),
    field("optional", "OptionalStringU8"),
    field("flag", "Boolean"),
    field("colour", "ColourRGB"),
    field("small", "I16"),
    field("count", "I32"),
    field("big", "I64"),
    field("ratio", "F32"),
    field("precise", "F64"),
  ],
};

const everyTypeRow = (index: number, presentByte: number): SchemaField[] => [
  cell(
    "StringU8",
    [
      { type: "Int16", val: `unit_${index}`.length },
      { type: "String", val: `unit_${index}` },
    ],
    true,
  ),
  cell("StringU16", [{ type: "String", val: `Épée ${index}` }]),
  cell(
    "OptionalStringU8",
    presentByte === 1
      ? [
          { type: "Int8", val: 1 },
          { type: "Int16", val: 4 },
          { type: "String", val: "pike" },
        ]
      : [{ type: "Int8", val: presentByte }],
  ),
  cell("Boolean", [{ type: "UInt8", val: index % 2 }]),
  cell("ColourRGB", [{ type: "I32", val: 0x112233 + index }]),
  cell("I16", [{ type: "I16", val: -index }]),
  cell("I32", [{ type: "I32", val: index * 1000 }]),
  cell("I64", [{ type: "I64", val: 8_000_000_000 + index }]),
  cell("F32", [{ type: "F32", val: Math.fround(index / 8) }]),
  cell("F64", [{ type: "F64", val: index / 3 }]),
];

describe("vanilla db cache reader", () => {
  it("gives back exactly the cells that went in, for every field type", () => {
    // The whole point of the cache: a decoded cell has to be indistinguishable from a parsed one.
    const rows = [everyTypeRow(0, 1), everyTypeRow(1, 0), everyTypeRow(2, 255)];
    const { reader } = openBuilt([packedFile("db\\x_tables\\data__", rows.flat(), 4)], () => everyTypeSchema);

    expect(reader.getTableRows("db\\x_tables\\data__")).toEqual(rows);
  });

  it("rejects corruption in a column when that lazy block is read", () => {
    const rows = [everyTypeRow(0, 1), everyTypeRow(1, 0)];
    const tablePath = "db\\x_tables\\data__";
    const { reader, bytes } = openBuilt([packedFile(tablePath, rows.flat(), 4)], () => everyTypeSchema);
    const header = decodeVanillaDbCacheHeader(bytes)!;
    const payloadStart = VANILLA_DB_CACHE_HEADER_BYTES + header.metaJsonLength;
    const numericColumn = reader.getTableMeta(tablePath)!.columns.find((column) => column.name === "count")!;

    bytes[payloadStart + numericColumn.offset + numericColumn.length - 1] ^= 1;

    expect(() => reader.getTableRows(tablePath)).toThrow(VanillaDbCacheIntegrityError);
  });

  it("rejects corruption in a lazily-read string-pool chunk", () => {
    const tablePath = "db\\x_tables\\data__";
    const { reader, bytes } = openBuilt(
      [packedFile(tablePath, everyTypeRow(0, 1), 4)],
      () => everyTypeSchema,
    );
    const header = decodeVanillaDbCacheHeader(bytes)!;
    const payloadStart = VANILLA_DB_CACHE_HEADER_BYTES + header.metaJsonLength;

    bytes[payloadStart + reader.meta.pool.offset] ^= 1;

    expect(() => reader.resolvePoolValue(0)).toThrow(VanillaDbCacheIntegrityError);
  });

  it("marks key cells and only key cells", () => {
    const rows = [everyTypeRow(0, 1)];
    const { reader } = openBuilt([packedFile("db\\x_tables\\data__", rows.flat(), 4)], () => everyTypeSchema);
    const [firstRow] = reader.getTableRows("db\\x_tables\\data__")!;

    expect(firstRow[0].isKey).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(firstRow[1], "isKey")).toBe(false);
  });

  it("serves single columns without decoding the rest", () => {
    const rows = [everyTypeRow(0, 1), everyTypeRow(1, 1)];
    const { reader } = openBuilt([packedFile("db\\x_tables\\data__", rows.flat(), 4)], () => everyTypeSchema);

    expect(Array.from(reader.getColumnNumbers("db\\x_tables\\data__", "count")!)).toEqual([0, 1000]);
    expect(reader.getColumnStrings("db\\x_tables\\data__", "key")).toEqual(["unit_0", "unit_1"]);
  });

  it("refuses a column asked for as the wrong kind", () => {
    const rows = [everyTypeRow(0, 1)];
    const { reader } = openBuilt([packedFile("db\\x_tables\\data__", rows.flat(), 4)], () => everyTypeSchema);

    expect(reader.getColumnStrings("db\\x_tables\\data__", "count")).toBeUndefined();
    expect(reader.getColumnNumbers("db\\x_tables\\data__", "key")).toBeUndefined();
    expect(reader.getColumnNumbers("db\\x_tables\\data__", "no_such_column")).toBeUndefined();
    expect(reader.getTableRows("db\\no_such_table\\data__")).toBeUndefined();
  });

  it("resolves pool values across chunk boundaries", () => {
    // More than one 64-entry chunk, so paging is actually exercised rather than assumed.
    const schema: DBVersion = { version: 1, fields: [field("key", "StringU8", true)] };
    const rows = Array.from({ length: 500 }, (_unused, index) =>
      cell(
        "StringU8",
        [
          { type: "Int16", val: `key_${String(index).padStart(4, "0")}`.length },
          { type: "String", val: `key_${String(index).padStart(4, "0")}` },
        ],
        true,
      ),
    );
    const { reader } = openBuilt([packedFile("db\\k_tables\\data__", rows, 1)], () => schema);

    const values = reader.getColumnStrings("db\\k_tables\\data__", "key")!;
    expect(values).toHaveLength(500);
    expect(values[0]).toBe("key_0000");
    expect(values[63]).toBe("key_0063");
    expect(values[64]).toBe("key_0064");
    expect(values[499]).toBe("key_0499");
  });

  describe("laziness", () => {
    const manyTables = () => {
      const schema: DBVersion = { version: 1, fields: [field("key", "StringU8", true)] };
      const files = Array.from({ length: 40 }, (_unused, table) =>
        packedFile(
          `db\\t${table}_tables\\data__`,
          Array.from({ length: 200 }, (_row, index) =>
            cell(
              "StringU8",
              [
                { type: "Int16", val: `t${table}_key_${index}`.length },
                { type: "String", val: `t${table}_key_${index}` },
              ],
              true,
            ),
          ),
          1,
        ),
      );
      return { files, schemaFor: () => schema };
    };

    it("reads a fraction of the file to serve one table", () => {
      const { files, schemaFor } = manyTables();
      const { reader, bytes } = openBuilt(files, schemaFor);
      const afterOpen = reader.stats().bytesRead;

      reader.getTableRows("db\\t0_tables\\data__");

      // Opening costs the header, the metadata and the pool checkpoints; one table costs its own
      // column plus the pool chunks it touches. Neither should approach the whole file.
      expect(afterOpen).toBeLessThan(bytes.length / 2);
      expect(reader.stats().bytesRead).toBeLessThan(bytes.length / 2);
    });

    it("does not materialise the whole string pool for one table", () => {
      const { files, schemaFor } = manyTables();
      const { reader } = openBuilt(files, schemaFor);

      reader.getColumnStrings("db\\t0_tables\\data__", "key");

      // 8000 distinct strings exist; this table touches 200, so a handful of chunks at most.
      expect(reader.stats().decodedBytes).toBeLessThan(200_000);
    });

    it("keeps decoded data under the cap when more tables are read than fit", () => {
      const { files, schemaFor } = manyTables();
      const capBytes = 50_000;
      const { reader } = openBuilt(files, schemaFor, capBytes);

      for (const file of files) reader.getTableRows(file.name);

      expect(reader.stats().decodedBytes).toBeLessThanOrEqual(capBytes);
    });

    it("still answers correctly after eviction has thrown work away", () => {
      const { files, schemaFor } = manyTables();
      const { reader } = openBuilt(files, schemaFor, 20_000);

      for (const file of files) reader.getTableRows(file.name);
      // The first table was evicted long ago and has to be decoded again from the source.
      const values = reader.getColumnStrings("db\\t0_tables\\data__", "key")!;

      expect(values[0]).toBe("t0_key_0");
      expect(values[199]).toBe("t0_key_199");
    });
  });

  describe("refusing to open", () => {
    const built = () =>
      buildVanillaDbCache(
        [packedFile("db\\x_tables\\data__", everyTypeRow(0, 1), 4)],
        () => everyTypeSchema,
        identity,
      ).bytes;

    it("returns undefined for bytes that are not a cache", () => {
      expect(openVanillaDbCache(createMemorySource(new Uint8Array(0)))).toBeUndefined();
      expect(openVanillaDbCache(createMemorySource(new Uint8Array(64)))).toBeUndefined();
      expect(
        openVanillaDbCache(createMemorySource(new TextEncoder().encode("not a cache at all"))),
      ).toBeUndefined();
    });

    it("returns undefined when the metadata will not parse", () => {
      const bytes = built();
      // Past the magic, so this fails on the JSON rather than the header. A single scribbled byte is
      // not enough - TextDecoder substitutes invalid UTF-8 rather than failing, which leaves the JSON
      // structurally intact with one mangled key.
      bytes.set(new TextEncoder().encode("[[[[[[[["), VANILLA_DB_CACHE_HEADER_BYTES + 4);

      expect(openVanillaDbCache(createMemorySource(bytes))).toBeUndefined();
    });

    it("returns undefined for a file cut short mid-write", () => {
      // The realistic corruption: the header and metadata are intact and describe payload that is not
      // there. Reads would return short buffers and decode into plausible nonsense.
      const bytes = built();

      expect(openVanillaDbCache(createMemorySource(bytes.subarray(0, bytes.length - 1)))).toBeUndefined();
      expect(openVanillaDbCache(createMemorySource(bytes))).toBeDefined();
    });

    it("returns undefined when the game has been patched or the schema changed", () => {
      const bytes = built();

      expect(openVanillaDbCache(createMemorySource(bytes), identity)).toBeDefined();
      expect(
        openVanillaDbCache(createMemorySource(bytes), { ...identity, dbPackMtimeMs: 999 }),
      ).toBeUndefined();
      expect(
        openVanillaDbCache(createMemorySource(bytes), { ...identity, schemaHash: "changed" }),
      ).toBeUndefined();
    });

    it("opens without an identity when the caller does not care to check", () => {
      expect(openVanillaDbCache(createMemorySource(built()))).toBeDefined();
    });
  });

  it("lists the tables it holds", () => {
    const { reader } = openBuilt(
      [
        packedFile("db\\a_tables\\data__", everyTypeRow(0, 1), 4),
        packedFile("db\\b_tables\\data__", everyTypeRow(1, 1), 4),
      ],
      () => everyTypeSchema,
    );

    expect(reader.listTablePaths()).toEqual(["db\\a_tables\\data__", "db\\b_tables\\data__"]);
    expect(reader.getTableMeta("db\\a_tables\\data__")?.dbName).toBe("a_tables");
  });
});
