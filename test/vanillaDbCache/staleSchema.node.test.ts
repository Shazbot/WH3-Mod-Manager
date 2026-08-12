import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import * as zlib from "zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { chunkSchemaIntoRows, readPack, writePack } from "../../src/packFileSerializer";
import { DBNameToDBVersions } from "../../src/schema";
import { parseDBTablePath, resolveParsedDBVersion } from "../../src/utility/packFileHelpers";
import { buildVanillaDbCache } from "../../src/vanillaDbCache/build";
import { createMemorySource, openVanillaDbCache } from "../../src/vanillaDbCache/read";
import type { DBField, DBVersion, NewPackedFile, PackedFile } from "../../src/packFileTypes";

/** The app's zstd is a native Electron prebuild; node's own reads the same frames. */
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (buffer: Buffer, level: number) =>
    zlib.zstdCompressSync(buffer, { params: { 0: level } }),
  decompress: async (buffer: Buffer) => zlib.zstdDecompressSync(buffer),
}));
vi.mock("electron-is-dev", () => ({ default: false }));

/**
 * What happens when the game updates before the schema does.
 *
 * A patch that adds a column to a vanilla table leaves the bundled schema describing the old layout,
 * which is the normal state of things for a day or two after a Warhammer III patch. The cache is
 * built from whatever `readPack` managed to parse, so the question these tests answer is whether one
 * table the schema no longer fits takes the other 1,500 down with it.
 */

const field = (name: string, fieldType: DBField["field_type"]): DBField =>
  ({ name, field_type: fieldType, is_key: false }) as DBField;

const dbVersion = (version: number, fields: DBField[]): DBVersion => ({ version, fields });

const stringU8 = (value: string): Buffer => {
  const bytes = Buffer.from(value, "ascii");
  const length = Buffer.alloc(2);
  length.writeUInt16LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
};

const i32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value, 0);
  return bytes;
};

/** A DB table's bytes, laid out the way the game writes them and `readDBPackedFiles` reads them. */
const tableBuffer = (version: number, rows: Buffer[][]): Buffer =>
  Buffer.concat([
    Buffer.from([0xfc, 0xfd, 0xfe, 0xff]),
    i32(version),
    Buffer.from([0x01]),
    i32(rows.length),
    ...rows.flat(),
  ]);

const identity = {
  game: "wh3",
  dbPackPath: "K:\\game\\data\\db.pack",
  dbPackSize: 1,
  dbPackMtimeMs: 2,
  schemaHash: "stale-schema-test",
};

/** The schema as it ships: two columns for most of these tables. */
const oldSchema = dbVersion(1, [field("key", "StringU8"), field("value", "I32")]);

/** One table the schema describes a column the game no longer writes, so the parse overruns. */
const threeColumnSchema = dbVersion(1, [
  field("key", "StringU8"),
  field("value", "I32"),
  field("gone", "StringU8"),
]);

const resolveSchema = (packedFile: PackedFile) => {
  const dbName = parseDBTablePath(packedFile.name)?.dbName;
  return dbName ? resolveParsedDBVersion(packedFile.version, DBNameToDBVersions.wh3[dbName]) : undefined;
};

const GOOD_BEFORE = "db\\aaa_good_before_tables\\data__";
const EXTRA_COLUMN = "db\\bbb_extra_column_tables\\data__";
const NEWER_VERSION = "db\\ccc_newer_version_tables\\data__";
const MISSING_COLUMN = "db\\ddd_missing_column_tables\\data__";
const GOOD_AFTER = "db\\eee_good_after_tables\\data__";

const ALL_TABLES = [GOOD_BEFORE, EXTRA_COLUMN, NEWER_VERSION, MISSING_COLUMN, GOOD_AFTER];

const goodRows = (prefix: string): Buffer[][] => [
  [stringU8(`${prefix}_one`), i32(11)],
  [stringU8(`${prefix}_two`), i32(22)],
];

let dataFolder: string | undefined;
const originalCurrentGame = appData.currentGame;

afterEach(async () => {
  appData.currentGame = originalCurrentGame;
  for (const name of ALL_TABLES) {
    delete DBNameToDBVersions.wh3[parseDBTablePath(name)!.dbName];
  }
  if (dataFolder) {
    await rm(dataFolder, { recursive: true, force: true });
    dataFolder = undefined;
  }
});

/**
 * A pack holding five tables, in name order so the reader meets them in this order: one the schema
 * still fits, one the game gave a third column, one whose version moved past anything the schema
 * knows, one missing a column the schema still lists, and one the schema still fits.
 */
const writeStalePack = async (): Promise<string> => {
  dataFolder = await mkdtemp(nodePath.join(tmpdir(), "whmm-stale-schema-"));
  appData.currentGame = "wh3";

  for (const name of ALL_TABLES) {
    DBNameToDBVersions.wh3[parseDBTablePath(name)!.dbName] = [
      name === MISSING_COLUMN ? threeColumnSchema : oldSchema,
    ];
  }

  const tables: Array<{ name: string; buffer: Buffer }> = [
    { name: GOOD_BEFORE, buffer: tableBuffer(1, goodRows("before")) },
    {
      name: EXTRA_COLUMN,
      // Same version the schema knows, but the rows carry a third column the schema has no field
      // for. Reading two fields per row walks into the next row's bytes.
      buffer: tableBuffer(1, [
        [stringU8("extra_one"), i32(11), stringU8("a_third_column_value")],
        [stringU8("extra_two"), i32(22), stringU8("another_third_column_value")],
      ]),
    },
    // The usual shape of a CA schema change: the column arrived with a version bump.
    { name: NEWER_VERSION, buffer: tableBuffer(9, goodRows("newer")) },
    {
      name: MISSING_COLUMN,
      // The other direction: three fields per row are read out of two fields of data, so the parse
      // runs off the end of the table part way through and gives up with rows already collected.
      buffer: tableBuffer(1, [
        [stringU8("miss_one"), i32(11)],
        [stringU8("miss_two"), i32(22)],
        [stringU8("miss_three"), i32(33)],
      ]),
    },
    { name: GOOD_AFTER, buffer: tableBuffer(1, goodRows("after")) },
  ];

  const packPath = nodePath.join(dataFolder, "db.pack");
  await writePack(
    tables.map(
      (table) =>
        ({
          name: table.name,
          file_size: table.buffer.length,
          start_pos: -1,
          buffer: table.buffer,
        }) as unknown as NewPackedFile,
    ),
    packPath,
  );
  return packPath;
};

const buildFromPack = async (packPath: string) => {
  const indexOnly = await readPack(packPath, { skipParsingTables: true });
  const tablePaths = indexOnly.packedFiles
    .filter((packedFile) => parseDBTablePath(packedFile.name) != undefined)
    .map((packedFile) => packedFile.name);
  const parsed = await readPack(packPath, { tablesToRead: tablePaths });
  return { parsed, ...buildVanillaDbCache(parsed.packedFiles, resolveSchema, identity) };
};

describe("building the vanilla db cache against a schema the game has moved past", () => {
  it("still builds, and the tables the schema fits are stored correctly", async () => {
    const { bytes, meta } = await buildFromPack(await writeStalePack());

    const reader = openVanillaDbCache(createMemorySource(bytes));
    expect(reader).toBeDefined();

    for (const [path, prefix] of [
      [GOOD_BEFORE, "before"],
      [GOOD_AFTER, "after"],
    ]) {
      const rows = reader!.getTableRows(path);
      expect(rows, `${path} should be in the cache`).toBeDefined();
      expect(rows!.map((row) => [row[0].fields[1].val, row[1].fields[0].val])).toEqual([
        [`${prefix}_one`, 11],
        [`${prefix}_two`, 22],
      ]);
    }

    // A table read after the unparsable one is not shifted or truncated by it.
    expect(meta.tables.map((table) => table.packedFilePath)).toContain(GOOD_AFTER);
    reader!.close();
  });

  it("leaves out a table whose version is newer than any the schema describes", async () => {
    const { skipped, meta } = await buildFromPack(await writeStalePack());

    expect(meta.tables.map((table) => table.packedFilePath)).not.toContain(NEWER_VERSION);
    expect(skipped).toContainEqual({ packedFilePath: NEWER_VERSION, reason: "no schema" });
  });

  it("keeps going after a table the parse gives up on part way through", async () => {
    const { meta, bytes } = await buildFromPack(await writeStalePack());

    // readPack collects rows as it goes and keeps what it had when the read ran off the end, so the
    // table is stored short rather than dropped. Every later table is untouched by it.
    const truncated = meta.tables.find((table) => table.packedFilePath === MISSING_COLUMN);
    expect(truncated).toBeDefined();
    expect(truncated!.rowCount).toBeLessThan(3);

    const reader = openVanillaDbCache(createMemorySource(bytes))!;
    expect(
      reader.getTableRows(GOOD_AFTER)!.map((row) => [row[0].fields[1].val, row[1].fields[0].val]),
    ).toEqual([
      ["after_one", 11],
      ["after_two", 22],
    ]);
    reader.close();
  });

  it("stores back exactly what readPack parsed, including for the table with an extra column", async () => {
    const { parsed, bytes } = await buildFromPack(await writeStalePack());

    const reader = openVanillaDbCache(createMemorySource(bytes))!;

    // Nothing here claims the extra column table is *right* - the schema cannot describe those bytes,
    // so nothing could be. What must hold is that the cache says whatever reading the pack says, so
    // turning the cache on cannot change what the app shows. Compared against the app's own chunker
    // rather than a copy of it, since that is what every consumer of a directly read pack uses.
    for (const packedFile of parsed.packedFiles) {
      const dbVersionForFile = resolveSchema(packedFile);
      if (!dbVersionForFile || !packedFile.schemaFields) continue;

      expect(reader.getTableRows(packedFile.name), packedFile.name).toEqual(
        chunkSchemaIntoRows(packedFile.schemaFields, dbVersionForFile),
      );
    }

    reader.close();
  });
});
