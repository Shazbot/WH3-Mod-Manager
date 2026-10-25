import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAutomationCacheService,
  createAutomationContext,
  executeAutomationRequest,
} from "../../src/automation/registry";
import { FilesystemPolicy } from "../../src/automation/filesystem";
import { readAutomationPayload } from "../../src/automation/packAccess";
import {
  dbPreambleMarkers,
  parseDbTable,
  readPackIndex,
  readPayload,
  serializeDbTable,
  writeRawPack,
} from "../../src/packCore";
import { LocVersion, type DBField, type DBVersion, type Field } from "../../src/packFileTypes";
import { getCanonicalFileIdentity } from "../../src/vanillaCacheIdentity";
import { buildVanillaDbCacheFromTables } from "../../src/vanillaDbCache/build";
import { createFileSource, openVanillaDbCache } from "../../src/vanillaDbCache/read";
import {
  VANILLA_DB_CACHE_DECODER_REVISION,
  VANILLA_DB_CACHE_EXACT_SOURCE_FORMAT,
  type VanillaDbCacheIdentity,
} from "../../src/vanillaDbCache/format";
import {
  VANILLA_LOC_CACHE_DECODER_REVISION,
  VANILLA_LOC_CACHE_EXACT_SOURCE_FORMAT,
  VANILLA_LOC_UNKNOWN_ROW_INDEX,
} from "../../src/vanillaLocCache/format";
import { buildVanillaLocCacheBytes } from "../../src/vanillaLocCache/build";
import { indexExactVanillaLocPackSet, readExactVanillaLocEntries } from "../../src/vanillaLocCache/exactSource";
import { getVanillaLocCacheFilePath, getVanillaLocCacheIdentity } from "../../src/vanillaLocCache/identity";
import { getSchemaFilePath, getSchemaForGame } from "../../src/schema";

const temporaryDirectories: string[] = [];
const services: Array<ReturnType<typeof createAutomationCacheService>> = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const workspace = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-automation-cache-"));
  temporaryDirectories.push(directory);
  return directory;
};

const makeService = (options: Parameters<typeof createAutomationCacheService>[0] = {}) => {
  const service = createAutomationCacheService(options);
  services.push(service);
  return service;
};

const metadata = () => ({
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
  dependencies: [] as string[],
});

const field = (name: string, field_type: DBField["field_type"], is_key = false): DBField => ({
  name,
  field_type,
  is_key,
  default_value: "",
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

const schema: DBVersion = { version: 3, fields: [field("key", "StringU8", true), field("count", "I32")] };
const schemaProvider = async (): Promise<Record<string, DBVersion[]>> => ({ sample_tables: [schema] });
const stringFields = (value: string): Field[] => [
  { type: "Int16", val: Buffer.byteLength(value, "utf8") },
  { type: "String", val: value },
];

const dbPayload = (rows: Array<[string, number]> = [["probe", 84]]): Buffer => {
  const version = Buffer.alloc(4);
  version.writeInt32LE(schema.version);
  const preamble = Buffer.concat([dbPreambleMarkers.version, version, Buffer.from([1])]);
  return serializeDbTable(
    schema,
    rows.map(([key, count]) => [stringFields(key), [{ type: "I32", val: count }]]),
    { preamble },
  );
};

const locPayload = (rows: Array<[string, string]>): Buffer => {
  return serializeDbTable(
    LocVersion,
    rows.map(([key, value]) => [
      [{ type: "String", val: key }],
      [{ type: "String", val: value }],
      [{ type: "UInt8", val: 0 }],
    ]),
    { preamble: Buffer.from([0xff, 0xfe, 0x4c, 0x4f, 0x43, 0, 1, 0, 0, 0]) },
  );
};

const writeDbPack = async (
  packPath: string,
  fileName = "db\\sample_tables\\data__",
  rows: Array<[string, number]> = [["probe", 84]],
) => writeRawPack(packPath, [{ name: fileName, buffer: dbPayload(rows) }], metadata());

const makeContext = (
  root: string,
  cache: ReturnType<typeof createAutomationCacheService>,
  options: { writeRoots?: readonly string[]; signal?: AbortSignal } = {},
) =>
  createAutomationContext({
    readRoots: [root],
    writeRoots: options.writeRoots ?? [root],
    schemaProvider,
    cache,
    ...(options.signal ? { signal: options.signal } : {}),
  });

const filesUnder = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  });
};

const makeGuiDbCache = (packPath: string, directory: string, includeTarget = true, proven = true): string => {
  const pack = readPackIndex(packPath, { game: "wh3" });
  const entry = pack.entries[0];
  const parsed = parseDbTable(dbPayload(), schema, { game: "wh3" });
  const source = getCanonicalFileIdentity(packPath)!;
  const identity: VanillaDbCacheIdentity = {
    game: "wh3",
    dbPackPath: source.path,
    dbPackSize: Number(source.size),
    dbPackMtimeMs: source.mtimeMs,
    dbPackMtimeNs: source.mtimeNs.toString(10),
    dbPackCtimeNs: source.ctimeNs.toString(10),
    dbPackDev: source.dev.toString(10),
    dbPackIno: source.ino.toString(10),
    schemaHash: "fixture-schema-v1",
    ...(proven
      ? { sourceFormat: VANILLA_DB_CACHE_EXACT_SOURCE_FORMAT, decoderRevision: VANILLA_DB_CACHE_DECODER_REVISION }
      : {}),
  };
  const built = buildVanillaDbCacheFromTables(
    [
      {
        packedFilePath: includeTarget ? entry.name : "db\\other_tables\\data__",
        schema: parsed.schema,
        rows: parsed.rows.map((row) => row.cells.map((cell) => cell.fields)),
        packedFileVersion: parsed.preamble.version,
        guid: parsed.preamble.guid,
      },
    ],
    identity,
  );
  fs.writeFileSync(path.join(directory, "vanilla-db-cache-wh3.bin"), built.bytes);
  return path.join(directory, "vanilla-db-cache-wh3.bin");
};

describe("automation cache service", () => {
  it("uses the default schema file identity in source tests and caps readers at eight", async () => {
    const root = workspace();
    const packPath = path.join(root, "default-schema.pack");
    const tableName = "main_units_tables";
    const versions = await getSchemaForGame("wh3");
    const schema = versions[tableName][0];
    expect(fs.existsSync(getSchemaFilePath("wh3"))).toBe(true);
    await writeRawPack(
      packPath,
      [
        {
          name: `db\\${tableName}\\data__`,
          buffer: serializeDbTable(schema, [], { version: schema.version }),
        },
      ],
      metadata(),
    );
    const cache = makeService();
    const scope = cache.beginRequest({ policy: new FilesystemPolicy({ readRoots: [root] }) });
    try {
      const first = await scope.getReadonlyTable(packPath, `db\\${tableName}\\data__`);
      const second = await scope.getReadonlyTable(packPath, `db\\${tableName}\\data__`);
      expect(first?.schema.version).toBe(schema.version);
      expect(second?.rows).toEqual([]);
      expect(cache.stats().hits.typedTables).toBe(1);
    } finally {
      scope.close();
    }
    expect(() => createAutomationCacheService({ maxReaders: 9 })).toThrow(RangeError);
  });

  it("shares request-scoped pack indexes and bypasses source payload bytes", async () => {
    const root = workspace();
    const packPath = path.join(root, "source.pack");
    await writeRawPack(packPath, [{ name: "one.txt", buffer: Buffer.from("fresh payload") }], metadata());
    const cache = makeService();
    const context = makeContext(root, cache);

    for (let index = 0; index < 2; index++) {
      const response = await executeAutomationRequest(
        { operation: "pack_read_file", packPath, filePath: "one.txt" },
        context,
      );
      expect(response).toMatchObject({ ok: true, data: { content: "fresh payload" } });
    }
    expect(cache.stats().hits.packIndexes).toBe(1);
    expect(cache.stats().entries.packIndexes).toBe(1);
  });

  it("detects same-size source edits with restored mtime and atomic replacement", async () => {
    const root = workspace();
    const packPath = path.join(root, "source.pack");
    const replacementPath = path.join(root, "replacement.pack");
    await writeRawPack(packPath, [{ name: "a.txt", buffer: Buffer.from("one") }], metadata());
    const cache = makeService();
    const policy = new FilesystemPolicy({ readRoots: [root] });

    const firstScope = cache.beginRequest({ policy });
    const first = await firstScope.readPackIndex(packPath);
    const previous = fs.statSync(packPath);
    await writeRawPack(packPath, [{ name: "b.txt", buffer: Buffer.from("one") }], metadata());
    fs.utimesSync(packPath, previous.atime, previous.mtime);
    await expect(firstScope.readPackIndex(packPath)).rejects.toMatchObject({ code: "CONFLICT" });
    firstScope.close();
    const secondScope = cache.beginRequest({ policy });
    const second = await secondScope.readPackIndex(packPath);
    secondScope.close();
    expect(second.entries.map((entry) => entry.name)).toEqual(["b.txt"]);

    await writeRawPack(replacementPath, [{ name: "c.txt", buffer: Buffer.from("one") }], metadata());
    fs.renameSync(replacementPath, packPath);
    const thirdScope = cache.beginRequest({ policy });
    const third = await thirdScope.readPackIndex(packPath);
    thirdScope.close();
    expect(third.entries.map((entry) => entry.name)).toEqual(["c.txt"]);
    expect(cache.stats().misses.packIndexes).toBe(3);
  });

  it("rejects a source change during awaited cache-file identity validation", async () => {
    const root = workspace();
    const packPath = path.join(root, "db.pack");
    const guiDir = path.join(root, "gui-cache");
    fs.mkdirSync(guiDir);
    await writeDbPack(packPath);
    const cachePath = makeGuiDbCache(packPath, guiDir);
    const cache = makeService({ whmmCacheDir: guiDir, schemaFingerprint: "fixture-schema-v1" });
    const normalPolicy = new FilesystemPolicy({ readRoots: [root] });
    const warm = cache.beginRequest({ policy: normalPolicy, schemaProvider });
    try {
      await warm.getReadonlyTable(packPath, "db\\sample_tables\\data__");
    } finally {
      warm.close();
    }

    let signalValidationStarted!: () => void;
    let releaseValidation!: () => void;
    const validationStarted = new Promise<void>((resolve) => {
      signalValidationStarted = resolve;
    });
    const validationGate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    class GatedPolicy extends FilesystemPolicy {
      private blockNextCacheValidation = true;
      override async assertReadPath(requestedPath: string): Promise<string> {
        if (this.blockNextCacheValidation && path.resolve(requestedPath) === cachePath) {
          this.blockNextCacheValidation = false;
          signalValidationStarted();
          await validationGate;
        }
        return super.assertReadPath(requestedPath);
      }
    }
    const scope = cache.beginRequest({ policy: new GatedPolicy({ readRoots: [root] }), schemaProvider });
    try {
      const pending = scope.getReadonlyTable(packPath, "db\\sample_tables\\data__");
      await validationStarted;
      await writeDbPack(packPath, undefined, [["changed", 99]]);
      releaseValidation();
      await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      scope.close();
    }
  });

  it("returns immutable typed rows and persists a cold request as a one-table cache", async () => {
    const root = workspace();
    const packPath = path.join(root, "db.pack");
    const cacheDir = path.join(root, "cache");
    await writeDbPack(packPath, undefined, [
      ["probe", 84],
      ["second", 9],
    ]);
    const cache = makeService({ cacheDir, memoryMiB: 32, schemaFingerprint: "fixture-schema-v1" });
    const context = makeContext(root, cache);
    await cache.validateConfiguredPaths(context.policy);
    const scope = cache.beginRequest({ policy: context.policy, schemaProvider, useTypedCache: true });
    try {
      const table = await scope.getReadonlyTable(packPath, "db\\sample_tables\\data__");
      expect(table?.rows).toEqual([
        { key: "probe", count: 84 },
        { key: "second", count: 9 },
      ]);
      expect(Object.isFrozen(table)).toBe(true);
      expect(Object.isFrozen(table?.rows)).toBe(true);
      expect(Object.isFrozen(table?.rows[0])).toBe(true);
      expect(() => {
        (table!.rows[0] as Record<string, unknown>).count = 1;
      }).toThrow();
    } finally {
      scope.close();
    }

    const cacheFiles = filesUnder(path.join(cacheDir, "headless", "db"));
    expect(cacheFiles).toHaveLength(1);
    const reader = openVanillaDbCache(createFileSource(cacheFiles[0]))!;
    expect(reader.listTablePaths()).toEqual(["db\\sample_tables\\data__"]);
    reader.close();
  });

  it("does not retain one table whose conservative logical estimate exceeds the configured budget", async () => {
    const root = workspace();
    const packPath = path.join(root, "large-db.pack");
    const rows = Array.from({ length: 7000 }, (_, index): [string, number] => [`k${index}_${"x".repeat(185)}`, index]);
    await writeDbPack(packPath, undefined, rows);
    const cache = makeService({ memoryMiB: 1, schemaFingerprint: "fixture-schema-v1" });
    const context = makeContext(root, cache);
    const read = async () => {
      const scope = cache.beginRequest({ policy: context.policy, schemaProvider });
      try {
        const table = await scope.getReadonlyTable(packPath, "db\\sample_tables\\data__");
        expect(table?.rows).toHaveLength(rows.length);
      } finally {
        scope.close();
      }
    };

    await read();
    expect(cache.stats().entries.typedTables).toBe(0);
    await read();
    expect(cache.stats().hits.typedTables).toBe(0);
    expect(cache.stats().misses.typedTables).toBe(2);
    expect(cache.stats().retainedBytes).toBeLessThanOrEqual(cache.stats().memoryLimitBytes);
  });

  it("bypasses typed and LOC persistence for custom schemas without a fingerprint", async () => {
    const root = workspace();
    const packPath = path.join(root, "db.pack");
    const locPack = path.join(root, "local.pack");
    const cacheDir = path.join(root, "cache");
    await writeDbPack(packPath);
    await writeRawPack(locPack, [{ name: "text\\names.loc", buffer: locPayload([["key", "text"]]) }], metadata());
    const cache = makeService({ cacheDir });
    const policy = new FilesystemPolicy({ readRoots: [root], writeRoots: [root] });

    for (let index = 0; index < 2; index++) {
      const scope = cache.beginRequest({ policy, schemaProvider });
      try {
        expect((await scope.getReadonlyTable(packPath, "db\\sample_tables\\data__"))?.rows).toEqual([
          { key: "probe", count: 84 },
        ]);
        expect(await scope.getVanillaRawLoc([locPack])).toBeUndefined();
      } finally {
        scope.close();
      }
    }
    expect(cache.stats().hits.typedTables).toBe(0);
    expect(cache.stats().entries.typedTables).toBe(0);
    expect(cache.stats().persistentWrites).toBe(0);
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it("bypasses typed and LOC caches when a nondefault logical payload limit is supplied", async () => {
    const root = workspace();
    const dbPack = path.join(root, "db.pack");
    const locPack = path.join(root, "local.pack");
    const cacheDir = path.join(root, "cache");
    await writeDbPack(dbPack);
    await writeRawPack(locPack, [{ name: "text\\names.loc", buffer: locPayload([["key", "text"]]) }], metadata());
    const cache = makeService({ cacheDir, schemaFingerprint: "fixture-schema-v1" });
    const policy = new FilesystemPolicy({ readRoots: [root], writeRoots: [root] });
    const scope = cache.beginRequest({ policy, schemaProvider, maxLogicalPayloadBytes: 1 });
    try {
      await expect(scope.getReadonlyTable(dbPack, "db\\sample_tables\\data__")).rejects.toThrow();
      expect(await scope.getVanillaRawLoc([locPack])).toBeUndefined();
    } finally {
      scope.close();
    }
    expect(cache.stats().entries.typedTables).toBe(0);
    expect(cache.stats().entries.locReaders).toBe(0);
    expect(cache.stats().persistentWrites).toBe(0);
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it("persists managed raw LOC with an identity stamp and reopens it in a fresh service", async () => {
    const root = workspace();
    const packPath = path.join(root, "local.pack");
    const cacheDir = path.join(root, "cache");
    await writeRawPack(
      packPath,
      [{ name: "text\\names.loc", buffer: locPayload([["key", "cached text"]]) }],
      metadata(),
    );
    const policy = new FilesystemPolicy({ readRoots: [root], writeRoots: [root] });
    const firstService = makeService({ cacheDir });
    const firstScope = firstService.beginRequest({ policy });
    try {
      const lease = await firstScope.getVanillaRawLoc([packPath]);
      expect(lease?.lookup.getRaw("key")?.rawText).toBe("cached text");
      lease?.release();
    } finally {
      firstScope.close();
    }
    expect(firstService.stats().persistentWrites).toBe(1);
    const managedLocFiles = filesUnder(path.join(cacheDir, "headless", "loc"));
    expect(managedLocFiles).toHaveLength(2);
    expect(managedLocFiles.some((file) => file.endsWith(".id"))).toBe(true);

    await firstService.close();
    services.splice(services.indexOf(firstService), 1);
    const secondService = makeService({ cacheDir });
    const secondScope = secondService.beginRequest({ policy });
    try {
      const lease = await secondScope.getVanillaRawLoc([packPath]);
      expect(lease?.lookup.getRaw("key")?.rawText).toBe("cached text");
      lease?.release();
    } finally {
      secondScope.close();
    }
    expect(secondService.stats().hits.locReaders).toBe(1);
    expect(secondService.stats().persistentWrites).toBe(0);
  });

  it("uses only exact, strong GUI DB caches and falls back for unproven, corrupt, v3, or missing tables", async () => {
    const root = workspace();
    const packPath = path.join(root, "db.pack");
    const guiDir = path.join(root, "gui-cache");
    fs.mkdirSync(guiDir);
    await writeDbPack(packPath);

    const validPath = makeGuiDbCache(packPath, guiDir);
    const validCache = makeService({ whmmCacheDir: guiDir, schemaFingerprint: "fixture-schema-v1" });
    const validContext = makeContext(root, validCache);
    await validCache.validateConfiguredPaths(validContext.policy);
    const validScope = validCache.beginRequest({ policy: validContext.policy, schemaProvider });
    try {
      expect((await validScope.getReadonlyTable(packPath, "db\\sample_tables\\data__"))?.rows).toEqual([
        { key: "probe", count: 84 },
      ]);
    } finally {
      validScope.close();
    }
    expect(validCache.stats().hits.typedTables).toBe(1);
    expect(fs.readdirSync(guiDir)).toEqual(["vanilla-db-cache-wh3.bin"]);

    const originalBytes = fs.readFileSync(validPath);
    const unprovenBytes = buildVanillaDbCacheFromTables([{ packedFilePath: "unused", schema, rows: [] }], {
      ...getDbIdentityForTest(packPath),
      sourceFormat: undefined,
      decoderRevision: undefined,
    }).bytes;
    const v3Bytes = Uint8Array.from(originalBytes);
    new DataView(v3Bytes.buffer, v3Bytes.byteOffset, v3Bytes.byteLength).setUint32(4, 3, true);
    const corruptBytes = Uint8Array.from(originalBytes);
    corruptBytes[corruptBytes.length - 1] ^= 0xff;
    const missingBytesPath = makeGuiDbCache(packPath, guiDir, false, true);
    const missingBytes = fs.readFileSync(missingBytesPath);

    for (const invalid of [unprovenBytes, v3Bytes, corruptBytes, missingBytes]) {
      fs.writeFileSync(validPath, invalid);
      const cache = makeService({ whmmCacheDir: guiDir, schemaFingerprint: "fixture-schema-v1" });
      const context = makeContext(root, cache);
      const scope = cache.beginRequest({ policy: context.policy, schemaProvider });
      try {
        expect((await scope.getReadonlyTable(packPath, "db\\sample_tables\\data__"))?.rows).toEqual([
          { key: "probe", count: 84 },
        ]);
        expect(cache.stats().sourceFallbacks).toBe(1);
      } finally {
        scope.close();
      }
    }
  });

  it("rechecks GUI DB cache identity after same-size edits and atomic replacement", async () => {
    const root = workspace();
    const sourceRoot = path.join(root, "sources");
    const guiDir = path.join(root, "gui-cache");
    fs.mkdirSync(sourceRoot);
    fs.mkdirSync(guiDir);
    const packPath = path.join(sourceRoot, "db.pack");
    await writeDbPack(packPath);
    const cachePath = makeGuiDbCache(packPath, guiDir);
    const originalBytes = fs.readFileSync(cachePath);
    const originalStat = fs.statSync(cachePath);

    const editedCache = makeService({ whmmCacheDir: guiDir, schemaFingerprint: "fixture-schema-v1" });
    const editedContext = makeContext(root, editedCache);
    const warm = editedCache.beginRequest({ policy: editedContext.policy, schemaProvider });
    try {
      await warm.getReadonlyTable(packPath, "db\\sample_tables\\data__");
    } finally {
      warm.close();
    }
    const corrupted = Buffer.from(originalBytes);
    corrupted[corrupted.length - 1] ^= 0xff;
    fs.writeFileSync(cachePath, corrupted);
    fs.utimesSync(cachePath, originalStat.atime, originalStat.mtime);
    const afterEdit = editedCache.beginRequest({ policy: editedContext.policy, schemaProvider });
    try {
      expect((await afterEdit.getReadonlyTable(packPath, "db\\sample_tables\\data__"))?.rows).toEqual([
        { key: "probe", count: 84 },
      ]);
    } finally {
      afterEdit.close();
    }
    expect(editedCache.stats().sourceFallbacks).toBe(1);

    fs.writeFileSync(cachePath, originalBytes);
    const replacedCache = makeService({ whmmCacheDir: guiDir, schemaFingerprint: "fixture-schema-v1" });
    const replacedContext = makeContext(root, replacedCache);
    const first = replacedCache.beginRequest({ policy: replacedContext.policy, schemaProvider });
    try {
      await first.getReadonlyTable(packPath, "db\\sample_tables\\data__");
    } finally {
      first.close();
    }
    const replacementPath = path.join(guiDir, "replacement.bin");
    fs.writeFileSync(replacementPath, originalBytes);
    fs.rmSync(cachePath);
    fs.renameSync(replacementPath, cachePath);
    const second = replacedCache.beginRequest({ policy: replacedContext.policy, schemaProvider });
    try {
      expect((await second.getReadonlyTable(packPath, "db\\sample_tables\\data__"))?.rows).toEqual([
        { key: "probe", count: 84 },
      ]);
    } finally {
      second.close();
    }
    expect(replacedCache.stats().misses.dbReaders).toBe(2);
  });

  it("rechecks cached-file roots on memory hits and falls back to an allowed source", async () => {
    const root = workspace();
    const sourceRoot = path.join(root, "sources");
    fs.mkdirSync(sourceRoot);
    const packPath = path.join(sourceRoot, "db.pack");
    const guiDir = path.join(root, "gui-cache");
    fs.mkdirSync(guiDir);
    await writeDbPack(packPath);
    makeGuiDbCache(packPath, guiDir);
    const cache = makeService({ whmmCacheDir: guiDir, schemaFingerprint: "fixture-schema-v1" });
    const allowed = cache.beginRequest({ policy: new FilesystemPolicy({ readRoots: [root] }), schemaProvider });
    try {
      await allowed.getReadonlyTable(packPath, "db\\sample_tables\\data__");
    } finally {
      allowed.close();
    }

    const deniedCacheRoot = cache.beginRequest({
      policy: new FilesystemPolicy({ readRoots: [sourceRoot] }),
      schemaProvider,
    });
    try {
      expect((await deniedCacheRoot.getReadonlyTable(packPath, "db\\sample_tables\\data__"))?.rows).toEqual([
        { key: "probe", count: 84 },
      ]);
    } finally {
      deniedCacheRoot.close();
    }
    expect(cache.stats().sourceFallbacks).toBe(1);
  });

  it("retains separate typed table entries for one unchanged pack", async () => {
    const root = workspace();
    const packPath = path.join(root, "db.pack");
    await writeRawPack(
      packPath,
      [
        { name: "db\\sample_tables\\data__", buffer: dbPayload() },
        { name: "db\\sample_tables\\other", buffer: dbPayload([["other", 7]]) },
      ],
      metadata(),
    );
    const cache = makeService({ memoryMiB: 8, schemaFingerprint: "fixture-schema-v1" });
    const context = makeContext(root, cache);
    const request = () => cache.beginRequest({ policy: context.policy, schemaProvider });

    const one = request();
    try {
      await one.getReadonlyTable(packPath, "db\\sample_tables\\data__");
    } finally {
      one.close();
    }
    const two = request();
    try {
      await two.getReadonlyTable(packPath, "db\\sample_tables\\other");
    } finally {
      two.close();
    }
    const three = request();
    try {
      await three.getReadonlyTable(packPath, "db\\sample_tables\\data__");
      await three.getReadonlyTable(packPath, "db\\sample_tables\\other");
    } finally {
      three.close();
    }

    expect(cache.stats().hits.typedTables).toBe(2);
    expect(cache.stats().entries.typedTables).toBe(2);
  });

  it("keeps LOC and multiple DB views warm together for one unchanged pack", async () => {
    const root = workspace();
    const packPath = path.join(root, "mixed.pack");
    await writeRawPack(
      packPath,
      [
        { name: "db\\sample_tables\\data__", buffer: dbPayload() },
        { name: "db\\sample_tables\\other", buffer: dbPayload([["other", 7]]) },
        { name: "text\\names.loc", buffer: locPayload([["name", "text"]]) },
      ],
      metadata(),
    );
    const cache = makeService({ memoryMiB: 8, schemaFingerprint: "fixture-schema-v1" });
    const context = makeContext(root, cache);
    const scope = cache.beginRequest({ policy: context.policy, schemaProvider });
    const paths = ["db\\sample_tables\\data__", "db\\sample_tables\\other", "text\\names.loc"];
    try {
      for (const tablePath of paths) await scope.getReadonlyTable(packPath, tablePath);
      for (const tablePath of paths) await scope.getReadonlyTable(packPath, tablePath);
    } finally {
      scope.close();
    }
    expect(cache.stats().hits.typedTables).toBe(3);
    expect(cache.stats().entries.typedTables).toBe(3);
  });

  it("reopens a managed table cache when the pack stores its path with forward slashes", async () => {
    const root = workspace();
    const packPath = path.join(root, "slash-path.pack");
    const cacheDir = path.join(root, "cache");
    await writeRawPack(packPath, [{ name: "db/sample_tables/data__", buffer: dbPayload() }], metadata());
    const policy = new FilesystemPolicy({ readRoots: [root], writeRoots: [root] });
    const first = makeService({ cacheDir, schemaFingerprint: "fixture-schema-v1" });
    const firstScope = first.beginRequest({ policy, schemaProvider });
    try {
      expect((await firstScope.getReadonlyTable(packPath, "DB\\SAMPLE_TABLES\\DATA__"))?.rows).toEqual([
        { key: "probe", count: 84 },
      ]);
    } finally {
      firstScope.close();
    }
    await first.close();
    services.splice(services.indexOf(first), 1);

    const second = makeService({ cacheDir, schemaFingerprint: "fixture-schema-v1" });
    const secondScope = second.beginRequest({ policy, schemaProvider });
    try {
      expect((await secondScope.getReadonlyTable(packPath, "db\\sample_tables\\data__"))?.rows).toEqual([
        { key: "probe", count: 84 },
      ]);
    } finally {
      secondScope.close();
    }
    expect(second.stats().hits.typedTables).toBe(1);
    expect(second.stats().sourceFallbacks).toBe(0);
  });

  it("uses per-file LOC views without a DB schema and exposes exact raw provenance under a pinned lease", async () => {
    const root = workspace();
    const firstPack = path.join(root, "local_a.pack");
    const secondPack = path.join(root, "local_b.pack");
    await writeRawPack(
      firstPack,
      [
        {
          name: "text\\first.loc",
          buffer: locPayload([
            ["same", "first"],
            ["blank", ""],
          ]),
        },
      ],
      metadata(),
    );
    await writeRawPack(secondPack, [{ name: "text\\second.loc", buffer: locPayload([["same", "last"]]) }], metadata());
    const cache = makeService({ maxReaders: 1, memoryMiB: 16 });
    const scope = cache.beginRequest({ policy: new FilesystemPolicy({ readRoots: [root] }) });
    try {
      const view = await scope.getReadonlyTable(firstPack, "text\\first.loc");
      expect(view?.isLoc).toBe(true);
      expect(view?.rows).toContainEqual({ key: "same", text: "first", tooltip: false });
      const lease = await scope.getVanillaRawLoc([firstPack]);
      expect(lease?.lookup.getRaw("same")).toMatchObject({
        rawText: "first",
        packPath: fs.realpathSync(firstPack),
        filePath: "text\\first.loc",
        rowIndex: 0,
      });
      expect(lease?.lookup.getRaw("blank")?.rawText).toBe("");
      expect(lease?.lookup.getRaw("missing")).toBeUndefined();
      const secondWhilePinned = await scope.getVanillaRawLoc([secondPack]);
      expect(secondWhilePinned).toBeUndefined();
      expect(cache.stats().readerCount).toBe(1);
      lease?.release();
      const secondAfterRelease = await scope.getVanillaRawLoc([secondPack]);
      expect(secondAfterRelease?.lookup.getRaw("same")?.rawText).toBe("last");
      secondAfterRelease?.release();
    } finally {
      scope.close();
    }
    expect(cache.stats().readerCount).toBe(1);
    await cache.close();
    expect(cache.stats().readerCount).toBe(0);
  });

  it("normalizes away no-LOC packs for GUI LOC cache reuse, then includes them when they gain LOC files", async () => {
    const root = workspace();
    const dbPack = path.join(root, "db.pack");
    const locPack = path.join(root, "local_en.pack");
    const guiDir = path.join(root, "gui-cache");
    fs.mkdirSync(guiDir);
    await writeRawPack(dbPack, [{ name: "db\\sample_tables\\data__", buffer: dbPayload() }], metadata());
    await writeRawPack(
      locPack,
      [{ name: "text\\names.loc", buffer: locPayload([["shared", "from local"]]) }],
      metadata(),
    );

    const guiPackSet = indexExactVanillaLocPackSet([locPack], "wh3", "gui");
    const guiEntries = await readExactVanillaLocEntries(guiPackSet);
    const guiBytes = buildVanillaLocCacheBytes(guiEntries);
    const guiFile = getVanillaLocCacheFilePath(guiDir, "wh3", [locPack]);
    fs.writeFileSync(guiFile, guiBytes);
    fs.writeFileSync(
      `${guiFile}.id`,
      JSON.stringify({
        identity: getVanillaLocCacheIdentity("wh3", [locPack]),
        sourceFormat: VANILLA_LOC_CACHE_EXACT_SOURCE_FORMAT,
        decoderRevision: VANILLA_LOC_CACHE_DECODER_REVISION,
        orderFingerprint: guiPackSet.orderFingerprint,
        contentSha256: crypto.createHash("sha256").update(guiBytes).digest("hex"),
      }),
    );

    const cache = makeService({ whmmCacheDir: guiDir });
    const policy = new FilesystemPolicy({ readRoots: [root] });
    const first = cache.beginRequest({ policy });
    try {
      const lease = await first.getVanillaRawLoc([dbPack, locPack]);
      expect(lease?.lookup.getRaw("shared")?.rawText).toBe("from local");
      lease?.release();
    } finally {
      first.close();
    }
    expect(cache.stats().hits.locReaders).toBe(1);

    await writeRawPack(
      dbPack,
      [
        { name: "db\\sample_tables\\data__", buffer: dbPayload() },
        {
          name: "text\\db_names.loc",
          buffer: locPayload([
            ["db_only", "from db"],
            ["shared", "from db"],
          ]),
        },
      ],
      metadata(),
    );
    const second = cache.beginRequest({ policy });
    try {
      const lease = await second.getVanillaRawLoc([dbPack, locPack]);
      expect(lease?.lookup.getRaw("db_only")?.rawText).toBe("from db");
      expect(lease?.lookup.getRaw("shared")?.rawText).toBe("from local");
      lease?.release();
    } finally {
      second.close();
    }
    expect(cache.stats().misses.locReaders).toBe(2);
  });

  it("keeps cache writes inside write roots and warns once when they are denied", async () => {
    const root = workspace();
    const packPath = path.join(root, "db.pack");
    const cacheDir = path.join(root, "cache");
    await writeDbPack(packPath);
    const warnings: string[] = [];
    const cache = makeService({
      cacheDir,
      memoryMiB: 4,
      schemaFingerprint: "fixture-schema-v1",
      onWarning: (message) => warnings.push(message),
    });
    const context = makeContext(root, cache, { writeRoots: [] });
    const scope = cache.beginRequest({ policy: context.policy, schemaProvider });
    try {
      await scope.getReadonlyTable(packPath, "db\\sample_tables\\data__");
    } finally {
      scope.close();
    }
    expect(fs.existsSync(path.join(cacheDir, "headless"))).toBe(false);
    expect(warnings).toHaveLength(1);
    const otherReadRoot = path.join(root, "allowed-read-root");
    fs.mkdirSync(otherReadRoot);
    await expect(
      cache.validateConfiguredPaths(new FilesystemPolicy({ readRoots: [otherReadRoot] })),
    ).rejects.toMatchObject({ code: "IO_ACCESS" });

    const fileCachePath = path.join(root, "cache-file");
    fs.writeFileSync(fileCachePath, "not a directory");
    const fileCache = makeService({ cacheDir: fileCachePath });
    await expect(fileCache.validateConfiguredPaths(new FilesystemPolicy({ readRoots: [root] }))).rejects.toMatchObject({
      code: "IO_ACCESS",
      message: expect.stringContaining("--cache-dir must be a directory"),
    });
  });

  it("rejects cache directories reached through a symlink outside the authorized read root", async () => {
    const root = workspace();
    const outside = workspace();
    const alias = path.join(root, "cache-alias");
    fs.symlinkSync(outside, alias, "dir");
    const cache = makeService({ whmmCacheDir: alias });
    await expect(cache.validateConfiguredPaths(new FilesystemPolicy({ readRoots: [root] }))).rejects.toMatchObject({
      code: "IO_ACCESS",
    });
  });

  it("rejects changed source snapshots and unauthorized source/cache reads", async () => {
    const root = workspace();
    const packPath = path.join(root, "source.pack");
    await writeRawPack(packPath, [{ name: "one.txt", buffer: Buffer.from("one") }], metadata());
    const cache = makeService();
    const scope = cache.beginRequest({ policy: new FilesystemPolicy({ readRoots: [root] }) });
    const pack = await scope.readPackIndex(packPath);
    await writeRawPack(packPath, [{ name: "two.txt", buffer: Buffer.from("two") }], metadata());
    await expect(scope.assertPackSnapshot(pack)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      readAutomationPayload(pack, pack.entries[0], { ...makeContext(root, cache), cacheRequest: scope }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    scope.close();

    const denied = cache.beginRequest({ policy: new FilesystemPolicy({ readRoots: [] }) });
    await expect(denied.readPackIndex(packPath)).rejects.toMatchObject({ code: "IO_ACCESS" });
    denied.close();
  });

  it("clears inherited cache scope and service inside cache-bypassed write requests", async () => {
    const root = workspace();
    const payloadPath = path.join(root, "table.bin");
    const outputPath = path.join(root, "created.pack");
    fs.writeFileSync(payloadPath, dbPayload());
    const cache = makeService({ schemaFingerprint: "fixture-schema-v1" });
    const context = makeContext(root, cache);
    const inheritedScope = cache.beginRequest({ policy: context.policy, schemaProvider });
    try {
      const response = await executeAutomationRequest(
        {
          operation: "pack_create",
          outputPath,
          files: [{ path: "db\\sample_tables\\data__", sourcePath: payloadPath }],
        },
        { ...context, cacheRequest: inheritedScope },
      );
      expect(response).toMatchObject({ ok: true, data: { fileCount: 1 } });
      expect(cache.stats().misses.packIndexes).toBe(0);
      expect(fs.existsSync(outputPath)).toBe(true);
    } finally {
      inheritedScope.close();
    }
  });

  it("propagates cancellation from LOC enumeration and releases its reader lease", async () => {
    const root = workspace();
    const packPath = path.join(root, "local.pack");
    await writeRawPack(
      packPath,
      [
        {
          name: "text\\many.loc",
          buffer: locPayload(Array.from({ length: 700 }, (_, index) => [`key_${index}`, `value_${index}`])),
        },
      ],
      metadata(),
    );
    const cache = makeService();
    const controller = new AbortController();
    const scope = cache.beginRequest({
      policy: new FilesystemPolicy({ readRoots: [root], signal: controller.signal }),
      signal: controller.signal,
    });
    try {
      const lease = await scope.getVanillaRawLoc([packPath]);
      expect(lease).toBeDefined();
      const visited: string[] = [];
      await lease!.lookup.forEachEntry(async (key) => {
        await Promise.resolve();
        visited.push(key);
      });
      expect(visited).toHaveLength(700);
      await expect(
        lease!.lookup.forEachEntry(() => {
          controller.abort();
        }),
      ).rejects.toMatchObject({ code: "CANCELLED" });
      lease!.release();
    } finally {
      scope.close();
    }
    expect(cache.stats().readerCount).toBe(1);
    await cache.close();
    expect(cache.stats().readerCount).toBe(0);
  });

  it("does not create managed cache files when a request is already cancelled", async () => {
    const root = workspace();
    const packPath = path.join(root, "local.pack");
    const cacheDir = path.join(root, "cache");
    await writeRawPack(packPath, [{ name: "text\\names.loc", buffer: locPayload([["key", "value"]]) }], metadata());
    const controller = new AbortController();
    controller.abort();
    const cache = makeService({ cacheDir });
    const scope = cache.beginRequest({
      policy: new FilesystemPolicy({ readRoots: [root], signal: controller.signal }),
      signal: controller.signal,
    });
    try {
      await expect(scope.getVanillaRawLoc([packPath])).rejects.toMatchObject({ code: "CANCELLED" });
    } finally {
      scope.close();
    }
    expect(fs.existsSync(cacheDir)).toBe(false);
  });
});

const getDbIdentityForTest = (packPath: string): VanillaDbCacheIdentity => {
  const source = getCanonicalFileIdentity(packPath)!;
  return {
    game: "wh3",
    dbPackPath: source.path,
    dbPackSize: Number(source.size),
    dbPackMtimeMs: source.mtimeMs,
    dbPackMtimeNs: source.mtimeNs.toString(10),
    dbPackCtimeNs: source.ctimeNs.toString(10),
    dbPackDev: source.dev.toString(10),
    dbPackIno: source.ino.toString(10),
    schemaHash: "fixture-schema-v1",
    sourceFormat: VANILLA_DB_CACHE_EXACT_SOURCE_FORMAT,
    decoderRevision: VANILLA_DB_CACHE_DECODER_REVISION,
  };
};
