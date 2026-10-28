import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import type { DBField, DBVersion, Pack, PackedFile } from "../../src/packFileTypes";
import { getCanonicalFileIdentity } from "../../src/vanillaCacheIdentity";
import { buildVanillaDbCacheFromTables, type VanillaDbCacheBuildRow } from "../../src/vanillaDbCache/build";
import {
  VANILLA_DB_CACHE_DECODER_REVISION,
  VANILLA_DB_CACHE_EXACT_SOURCE_FORMAT,
  VANILLA_DB_CACHE_HEADER_BYTES,
  decodeVanillaDbCacheHeader,
  type VanillaDbCacheIdentity,
} from "../../src/vanillaDbCache/format";
import { closeVanillaDbCacheReaders, readVanillaTablesAsTypedRows } from "../../src/vanillaDbCache/store";

const electronState = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => electronState.userDataPath) },
  shell: {},
}));

const field = (name: string, fieldType: DBField["field_type"], isKey = false): DBField =>
  ({ name, field_type: fieldType, is_key: isKey, default_value: "", is_filename: false }) as DBField;

const schema = (version = 1): DBVersion => ({
  version,
  fields: [field("key", "StringU8", true), field("value", "I32")],
});

const stringCell = (value: string) => [
  { type: "Int16" as const, val: Buffer.byteLength(value, "utf8") },
  { type: "String" as const, val: value },
];

const numberCell = (value: number) => [{ type: "I32" as const, val: value }];

const textAndNumberRows = (entries: Array<[string, number]>): VanillaDbCacheBuildRow[] =>
  entries.map(([key, value]) => [stringCell(key), numberCell(value)]);

interface CacheTableFixture {
  packedFilePath: string;
  schema: DBVersion;
  rows: VanillaDbCacheBuildRow[];
  packedFileVersion?: number;
}

describe("typed vanilla table reads", () => {
  let root = "";
  let dataFolder = "";
  let packPath = "";
  let cachePath = "";
  let previousDataFolder: string | undefined;
  let previousGame = appData.currentGame;

  beforeEach(async () => {
    root = await mkdtemp(nodePath.join(tmpdir(), "whmm-typed-table-rows-"));
    dataFolder = nodePath.join(root, "data");
    const userDataPath = nodePath.join(root, "user-data");
    await Promise.all([mkdir(dataFolder), mkdir(userDataPath)]);
    packPath = nodePath.join(dataFolder, "db.pack");
    cachePath = nodePath.join(userDataPath, "vanilla-db-cache-wh3.bin");
    await writeFile(packPath, "unchanged source pack identity");
    electronState.userDataPath = userDataPath;
    previousDataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
    previousGame = appData.currentGame;
    appData.currentGame = "wh3";
    appData.gamesToGameFolderPaths.wh3.dataFolder = dataFolder;
  });

  afterEach(async () => {
    closeVanillaDbCacheReaders();
    appData.currentGame = previousGame;
    appData.gamesToGameFolderPaths.wh3.dataFolder = previousDataFolder;
    electronState.userDataPath = "";
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  const writeCache = async (tables: CacheTableFixture[]) => {
    const source = getCanonicalFileIdentity(packPath)!;
    const schemaHash = createHash("sha1")
      .update(await readFile(nodePath.join(process.cwd(), "schema/schema_wh3.json.zst")))
      .digest("hex");
    const identity: VanillaDbCacheIdentity = {
      game: "wh3",
      dbPackPath: source.path,
      dbPackSize: Number(source.size),
      dbPackMtimeMs: source.mtimeMs,
      dbPackMtimeNs: source.mtimeNs.toString(10),
      dbPackCtimeNs: source.ctimeNs.toString(10),
      dbPackDev: source.dev.toString(10),
      dbPackIno: source.ino.toString(10),
      schemaHash,
      sourceFormat: VANILLA_DB_CACHE_EXACT_SOURCE_FORMAT,
      decoderRevision: VANILLA_DB_CACHE_DECODER_REVISION,
    };
    const built = buildVanillaDbCacheFromTables(tables, identity);
    await writeFile(cachePath, built.bytes);
    return built;
  };

  const indexedPack = (paths: string[], version = 91): Pack => {
    const packedFiles = paths.map(
      (name) =>
        ({
          name,
          file_size: 16,
          start_pos: 0,
          version,
        }) as PackedFile,
    );
    return { name: "db.pack", path: packPath, packedFiles, readTables: ["keep-me"] } as Pack;
  };

  it("returns complete rows in request-prefix and live index order without mutating the pack", async () => {
    const firstPath = "db\\first_tables\\z__";
    const secondPath = "db\\first_tables\\a__";
    const thirdPath = "db\\second_tables\\data__";
    await writeCache([
      { packedFilePath: firstPath, schema: schema(), rows: textAndNumberRows([["z", 1]]), packedFileVersion: 1 },
      { packedFilePath: secondPath, schema: schema(), rows: textAndNumberRows([["a", 2]]), packedFileVersion: 1 },
      { packedFilePath: thirdPath, schema: schema(), rows: textAndNumberRows([["two", 3]]), packedFileVersion: 1 },
    ]);
    const pack = indexedPack([firstPath, secondPath, thirdPath]);
    const firstDescriptor = pack.packedFiles[0];
    const resolverDescriptors: PackedFile[] = [];
    const resolverVersions: Array<number | undefined> = [];
    const resolveSchema = vi.fn((descriptor: PackedFile) => {
      resolverDescriptors.push(descriptor);
      resolverVersions.push(descriptor.version);
      descriptor.version = 999;
      return schema();
    });

    const result = await readVanillaTablesAsTypedRows(
      pack,
      ["db\\second_tables\\", "db\\first_tables\\", "db\\absent_tables\\"],
      resolveSchema,
    );

    expect(result?.prefixes.map(({ prefix }) => prefix)).toEqual([
      "db\\second_tables\\",
      "db\\first_tables\\",
      "db\\absent_tables\\",
    ]);
    expect(result?.prefixes.map(({ tables }) => tables.map(({ packedFilePath }) => packedFilePath))).toEqual([
      [thirdPath],
      [firstPath, secondPath],
      [],
    ]);
    expect(result?.prefixes[1].tables.map(({ rows }) => rows)).toEqual([
      [{ key: "z", value: 1 }],
      [{ key: "a", value: 2 }],
    ]);
    expect(result?.prefixes[1].tables[0].columns).toEqual([
      { name: "key", fieldType: "StringU8" },
      { name: "value", fieldType: "I32" },
    ]);
    expect(resolveSchema).toHaveBeenCalledTimes(3);
    expect(resolverDescriptors.every((descriptor) => !pack.packedFiles.includes(descriptor))).toBe(true);
    expect(resolverVersions).toEqual([1, 1, 1]);
    expect(firstDescriptor.version).toBe(91);
    expect(pack.readTables).toEqual(["keep-me"]);
    expect(firstDescriptor.schemaFields).toBeUndefined();
  });

  it("fails closed for an indexed table missing from the cache or a consumer schema version mismatch", async () => {
    const firstPath = "db\\tables_a_tables\\data__";
    const missingPath = "db\\tables_b_tables\\data__";
    await writeCache([
      {
        packedFilePath: firstPath,
        schema: schema(),
        rows: textAndNumberRows([["available", 1]]),
        packedFileVersion: 1,
      },
    ]);

    const missingResult = await readVanillaTablesAsTypedRows(
      indexedPack([firstPath, missingPath]),
      ["db\\tables_a_tables\\", "db\\tables_b_tables\\"],
      () => schema(),
    );
    expect(missingResult).toBeUndefined();

    const versionResult = await readVanillaTablesAsTypedRows(indexedPack([firstPath]), ["db\\tables_a_tables\\"], () =>
      schema(2),
    );
    expect(versionResult).toBeUndefined();
  });

  it("treats ordinary typed decode errors as misses without deleting the cache", async () => {
    const packedFilePath = "db\\bad_number_tables\\data__";
    const badSchema: DBVersion = { version: 1, fields: [field("value", "F64")] };
    await writeCache([
      {
        packedFilePath,
        schema: badSchema,
        rows: [[[{ type: "F64", val: Number.NaN }]]],
        packedFileVersion: 1,
      },
    ]);

    const result = await readVanillaTablesAsTypedRows(
      indexedPack([packedFilePath]),
      ["db\\bad_number_tables\\"],
      () => badSchema,
    );

    expect(result).toBeUndefined();
    await expect(readFile(cachePath)).resolves.toBeDefined();
  });

  it("discards the cache after a typed payload checksum failure", async () => {
    const packedFilePath = "db\\damaged_tables\\data__";
    const built = await writeCache([
      { packedFilePath, schema: schema(), rows: textAndNumberRows([["valid", 1]]), packedFileVersion: 1 },
    ]);
    const header = decodeVanillaDbCacheHeader(built.bytes.subarray(0, VANILLA_DB_CACHE_HEADER_BYTES))!;
    const column = built.meta.tables[0].columns[0];
    const damaged = new Uint8Array(built.bytes);
    damaged[VANILLA_DB_CACHE_HEADER_BYTES + header.metaJsonLength + column.offset] ^= 0xff;
    await writeFile(cachePath, damaged);

    const result = await readVanillaTablesAsTypedRows(indexedPack([packedFilePath]), ["db\\damaged_tables\\"], () =>
      schema(),
    );

    expect(result).toBeUndefined();
    await expect(readFile(cachePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
