import { describe, expect, it } from "vitest";

import { buildVanillaDbCache } from "../../src/vanillaDbCache/build";
import {
  VANILLA_DB_CACHE_HEADER_BYTES,
  VANILLA_DB_CACHE_VERSION,
  decodeVanillaDbCacheHeader,
  decodeVanillaDbCacheMeta,
  decodeVanillaDbCacheMetaBlock,
  encodeVanillaDbCacheHeader,
  encodeVanillaDbCacheMeta,
  encodeVanillaDbCacheMetaBlock,
  isVanillaDbCacheCurrent,
} from "../../src/vanillaDbCache/format";
import type { VanillaDbCacheMeta } from "../../src/vanillaDbCache/format";
import { decodeDictionaryColumn, decodeNumericColumn } from "../../src/vanillaDbCache/columnCodec";
import { readAllFrontCodedEntries } from "../../src/vanillaDbCache/frontCodedBlock";
import type { DBField, DBVersion, Field, PackedFile, SchemaField } from "../../src/packFileTypes";

const identity = {
  game: "wh3",
  dbPackPath: "K:\\game\\data\\db.pack",
  dbPackSize: 123,
  dbPackMtimeMs: 456,
  schemaHash: "abc123",
};

const field = (name: string, fieldType: DBField["field_type"]): DBField =>
  ({ name, field_type: fieldType, is_key: false }) as DBField;

const cell = (type: SchemaField["type"], fields: Field[]): SchemaField => ({ type, fields });

/** A table shaped as readPack leaves it: a flat array of cells, all rows concatenated. */
const packedFile = (name: string, cells: SchemaField[], version?: number): PackedFile =>
  ({ name, schemaFields: cells, version, file_size: 0, start_pos: 0 }) as unknown as PackedFile;

const dbVersion = (version: number, fields: DBField[]): DBVersion => ({ version, fields });

/** Reads the metadata back out of a built file, as the reader does. */
const readMeta = (bytes: Uint8Array): { meta: VanillaDbCacheMeta; payloadStart: number } => {
  const header = decodeVanillaDbCacheHeader(bytes)!;
  const block = bytes.subarray(
    VANILLA_DB_CACHE_HEADER_BYTES,
    VANILLA_DB_CACHE_HEADER_BYTES + header.metaJsonLength,
  );
  const meta = decodeVanillaDbCacheMetaBlock(block);
  if (!meta) throw new Error("expected the metadata to decode");
  return { meta, payloadStart: VANILLA_DB_CACHE_HEADER_BYTES + header.metaJsonLength };
};

describe("cache header", () => {
  it("round trips", () => {
    const decoded = decodeVanillaDbCacheHeader(encodeVanillaDbCacheHeader(4321));

    expect(decoded).toEqual({ formatVersion: VANILLA_DB_CACHE_VERSION, metaJsonLength: 4321 });
  });

  it("rejects bytes that are not a cache, rather than throwing", () => {
    expect(decodeVanillaDbCacheHeader(new Uint8Array(0))).toBeUndefined();
    expect(decodeVanillaDbCacheHeader(new Uint8Array(4))).toBeUndefined();
    expect(decodeVanillaDbCacheHeader(new Uint8Array(32))).toBeUndefined();
    expect(decodeVanillaDbCacheHeader(new TextEncoder().encode("NOPE and then some"))).toBeUndefined();
  });

  it("rejects a cache written by a different format version", () => {
    const bytes = encodeVanillaDbCacheHeader(10);
    new DataView(bytes.buffer).setUint32(4, VANILLA_DB_CACHE_VERSION + 1, true);

    expect(decodeVanillaDbCacheHeader(bytes)).toBeUndefined();
  });
});

describe("compact metadata", () => {
  const meta: VanillaDbCacheMeta = {
    game: "wh3",
    payloadBytes: 0,
    dbPackPath: "p",
    dbPackSize: 1,
    dbPackMtimeMs: 2,
    schemaHash: "h",
    pool: {
      offset: 0,
      length: 100,
      count: 7,
      checkpointsOffset: 100,
      checkpointsLength: 8,
      checksum: 11,
      checkpointsChecksum: 12,
      chunkChecksums: [13],
    },
    tables: [
      {
        packedFilePath: "db\\a_tables\\data__",
        dbName: "a_tables",
        rowCount: 3,
        schemaVersion: 2,
        packedFileVersion: 2,
        guid: "g-1",
        columns: [
          {
            name: "key",
            fieldType: "StringU8",
            isKey: true,
            offset: 108,
            length: 20,
            checksum: 21,
            probeChecksum: 21,
          },
          {
            name: "note",
            fieldType: "OptionalStringU8",
            offset: 128,
            length: 30,
            checksum: 22,
            probeChecksum: 22,
            presentOffset: 158,
            presentLength: 5,
            presentChecksum: 23,
          },
        ],
      },
      {
        packedFilePath: "db\\b_tables\\data__",
        dbName: "b_tables",
        rowCount: 1,
        schemaVersion: 1,
        columns: [{ name: "cost", fieldType: "I32", offset: 163, length: 12, checksum: 24 }],
      },
    ],
  };
  // Everything the payload holds, which is what the decoder rebuilds offsets against.
  meta.payloadBytes = 100 + 8 + 20 + 30 + 5 + 12;

  it("round trips, deriving every offset from the order things were written in", () => {
    expect(decodeVanillaDbCacheMeta(encodeVanillaDbCacheMeta(meta))).toEqual(meta);
  });

  it("is much smaller than the obvious encoding", () => {
    // The reason for the exercise: 1.2 MB of repeated key names over the real table set.
    expect(encodeVanillaDbCacheMeta(meta).length).toBeLessThan(JSON.stringify(meta).length / 2);
  });

  it("refuses metadata whose lengths do not add up to the payload", () => {
    // A mismatch means the reader and the builder disagree about the layout. Every read after it
    // would return some other column's bytes, so this has to be a hard miss.
    const drifted = encodeVanillaDbCacheMeta({ ...meta, payloadBytes: meta.payloadBytes + 1 });

    expect(decodeVanillaDbCacheMeta(drifted)).toBeUndefined();
  });

  it("refuses malformed metadata rather than throwing", () => {
    expect(decodeVanillaDbCacheMeta("not json")).toBeUndefined();
    expect(decodeVanillaDbCacheMeta("{}")).toBeUndefined();
    expect(decodeVanillaDbCacheMeta('{"tables":[]}')).toBeUndefined();
  });

  it("keeps isKey off the columns that are not keys", () => {
    const decoded = decodeVanillaDbCacheMeta(encodeVanillaDbCacheMeta(meta))!;

    expect(decoded.tables[0].columns[0].isKey).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(decoded.tables[0].columns[1], "isKey")).toBe(false);
  });

  it("round trips through the compressed block it is actually stored in", () => {
    expect(decodeVanillaDbCacheMetaBlock(encodeVanillaDbCacheMetaBlock(meta))).toEqual(meta);
  });

  it("stores the block smaller than the JSON it holds", () => {
    expect(encodeVanillaDbCacheMetaBlock(meta).length).toBeLessThan(encodeVanillaDbCacheMeta(meta).length);
  });

  it("reads a damaged block as a miss rather than throwing", () => {
    // Corrupt after the gzip header, so it gets past the magic and fails on the inflate.
    const block = encodeVanillaDbCacheMetaBlock(meta);
    block[block.length - 5] ^= 0xff;

    expect(decodeVanillaDbCacheMetaBlock(block)).toBeUndefined();
    expect(decodeVanillaDbCacheMetaBlock(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
    expect(decodeVanillaDbCacheMetaBlock(new Uint8Array(0))).toBeUndefined();
  });

  it("leaves an absent packed file version and guid absent", () => {
    const decoded = decodeVanillaDbCacheMeta(encodeVanillaDbCacheMeta(meta))!;

    expect(Object.prototype.hasOwnProperty.call(decoded.tables[1], "packedFileVersion")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(decoded.tables[1], "guid")).toBe(false);
  });
});

describe("cache identity", () => {
  const meta = { ...identity } as VanillaDbCacheMeta;

  it("accepts a cache built from the same inputs", () => {
    expect(isVanillaDbCacheCurrent(meta, identity)).toBe(true);
  });

  it("rejects a patched game, a different game and a changed schema", () => {
    expect(isVanillaDbCacheCurrent(meta, { ...identity, dbPackSize: 999 })).toBe(false);
    expect(isVanillaDbCacheCurrent(meta, { ...identity, dbPackMtimeMs: 999 })).toBe(false);
    expect(isVanillaDbCacheCurrent(meta, { ...identity, game: "wh2" })).toBe(false);
    expect(isVanillaDbCacheCurrent(meta, { ...identity, schemaHash: "different" })).toBe(false);
  });
});

describe("cache builder", () => {
  const unitsSchema = dbVersion(3, [
    field("key", "StringU8"),
    field("cost", "I32"),
    field("is_naval", "Boolean"),
    field("description", "OptionalStringU8"),
  ]);

  const unitsRows: SchemaField[] = [
    // row 1
    cell("StringU8", [
      { type: "Int16", val: 5 },
      { type: "String", val: "spear" },
    ]),
    cell("I32", [{ type: "I32", val: 450 }]),
    cell("Boolean", [{ type: "UInt8", val: 0 }]),
    cell("OptionalStringU8", [
      { type: "Int8", val: 1 },
      { type: "Int16", val: 4 },
      { type: "String", val: "pike" },
    ]),
    // row 2
    cell("StringU8", [
      { type: "Int16", val: 3 },
      { type: "String", val: "axe" },
    ]),
    cell("I32", [{ type: "I32", val: 300 }]),
    cell("Boolean", [{ type: "UInt8", val: 1 }]),
    cell("OptionalStringU8", [{ type: "Int8", val: 0 }]),
  ];

  const build = () =>
    buildVanillaDbCache(
      [packedFile("db\\main_units_tables\\data__", unitsRows, 3)],
      () => unitsSchema,
      identity,
    );

  it("produces a file whose header and metadata read back", () => {
    const { bytes } = build();
    const { meta } = readMeta(bytes);

    expect(meta.game).toBe("wh3");
    expect(meta.schemaHash).toBe("abc123");
    expect(meta.tables).toHaveLength(1);
    expect(meta.tables[0].packedFilePath).toBe("db\\main_units_tables\\data__");
    expect(meta.tables[0].dbName).toBe("main_units_tables");
    expect(meta.tables[0].rowCount).toBe(2);
    expect(meta.tables[0].schemaVersion).toBe(3);
    expect(meta.tables[0].packedFileVersion).toBe(3);
  });

  it("records a column per schema field, in schema order", () => {
    const { meta } = readMeta(build().bytes);

    expect(meta.tables[0].columns.map((column) => column.name)).toEqual([
      "key",
      "cost",
      "is_naval",
      "description",
    ]);
    expect(meta.tables[0].columns.map((column) => column.fieldType)).toEqual([
      "StringU8",
      "I32",
      "Boolean",
      "OptionalStringU8",
    ]);
  });

  it("gives the optional string column a separate presence column, and only that one", () => {
    const { meta } = readMeta(build().bytes);
    const [key, cost, isNaval, description] = meta.tables[0].columns;

    expect(description.presentOffset).toBeGreaterThan(0);
    expect(key.presentOffset).toBeUndefined();
    expect(cost.presentOffset).toBeUndefined();
    expect(isNaval.presentOffset).toBeUndefined();
  });

  it("lays every column inside the file, with offsets relative to the payload", () => {
    // An offset that ran past the end, or one accidentally written absolute, would read another
    // column's bytes as this one's rather than failing.
    const { bytes } = build();
    const { meta, payloadStart } = readMeta(bytes);

    for (const column of meta.tables[0].columns) {
      expect(payloadStart + column.offset + column.length).toBeLessThanOrEqual(bytes.length);
      expect(column.offset).toBeGreaterThanOrEqual(0);
    }
    expect(payloadStart + meta.pool.offset + meta.pool.length).toBeLessThanOrEqual(bytes.length);
  });

  it("stores every string once, in a sorted pool, with the empty string present", () => {
    const { bytes } = build();
    const { meta, payloadStart } = readMeta(bytes);
    const poolStart = payloadStart + meta.pool.offset;

    const pool = readAllFrontCodedEntries({
      bytes: bytes.subarray(poolStart, poolStart + meta.pool.length),
      checkpoints: new Uint32Array(0),
      count: meta.pool.count,
    });

    expect(pool).toEqual(["", "axe", "pike", "spear"]);
  });

  it("stores values that decode back to the originals", () => {
    const { bytes } = build();
    const { meta, payloadStart } = readMeta(bytes);
    const [key, cost, isNaval, description] = meta.tables[0].columns;
    const slice = (offset: number, length: number) =>
      bytes.subarray(payloadStart + offset, payloadStart + offset + length);

    expect(Array.from(decodeNumericColumn(slice(cost.offset, cost.length)))).toEqual([450, 300]);
    expect(Array.from(decodeNumericColumn(slice(isNaval.offset, isNaval.length)))).toEqual([0, 1]);
    // Pool ranks: "" 0, "axe" 1, "pike" 2, "spear" 3.
    expect(Array.from(decodeDictionaryColumn(slice(key.offset, key.length)))).toEqual([3, 1]);
    expect(Array.from(decodeDictionaryColumn(slice(description.offset, description.length)))).toEqual([
      2, 0,
    ]);
    expect(
      Array.from(decodeNumericColumn(slice(description.presentOffset!, description.presentLength!))),
    ).toEqual([1, 0]);
  });

  it("skips a table with no schema rather than storing it wrong", () => {
    const result = buildVanillaDbCache(
      [packedFile("db\\unknown_tables\\data__", unitsRows)],
      () => undefined,
      identity,
    );

    expect(result.meta.tables).toEqual([]);
    expect(result.skipped).toEqual([
      { packedFilePath: "db\\unknown_tables\\data__", reason: "no schema" },
    ]);
  });

  it("skips a packed file that was never parsed", () => {
    const unparsed = { name: "db\\x_tables\\data__", file_size: 0, start_pos: 0 } as unknown as PackedFile;
    const result = buildVanillaDbCache([unparsed], () => unitsSchema, identity);

    expect(result.skipped[0].reason).toBe("not parsed");
  });

  it("handles a table with no rows", () => {
    const { meta } = readMeta(
      buildVanillaDbCache([packedFile("db\\empty_tables\\data__", [])], () => unitsSchema, identity).bytes,
    );

    expect(meta.tables[0].rowCount).toBe(0);
    expect(meta.tables[0].columns).toHaveLength(4);
  });

  it("handles several tables sharing the pool", () => {
    const otherSchema = dbVersion(1, [field("key", "StringU16")]);
    const otherRows = [cell("StringU16", [{ type: "String", val: "spear" }])];

    const { bytes } = buildVanillaDbCache(
      [
        packedFile("db\\main_units_tables\\data__", unitsRows, 3),
        packedFile("db\\other_tables\\data__", otherRows, 1),
      ],
      (file) => (file.name.includes("other") ? otherSchema : unitsSchema),
      identity,
    );
    const { meta, payloadStart } = readMeta(bytes);
    const poolStart = payloadStart + meta.pool.offset;
    const pool = readAllFrontCodedEntries({
      bytes: bytes.subarray(poolStart, poolStart + meta.pool.length),
      checkpoints: new Uint32Array(0),
      count: meta.pool.count,
    });

    // "spear" appears in both tables and is stored once.
    expect(pool).toEqual(["", "axe", "pike", "spear"]);
    expect(meta.tables).toHaveLength(2);

    const otherKey = meta.tables[1].columns[0];
    expect(
      Array.from(
        decodeDictionaryColumn(
          bytes.subarray(payloadStart + otherKey.offset, payloadStart + otherKey.offset + otherKey.length),
        ),
      ),
    ).toEqual([3]);
  });
});
