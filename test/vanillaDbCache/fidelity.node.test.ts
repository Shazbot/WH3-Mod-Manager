import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as nodePath from "path";
import * as zlib from "zlib";

/**
 * The app's zstd is a native Electron prebuild that does not load under plain node. Node's own zstd
 * reads the same frames, so the pack can be parsed here exactly as the app parses it.
 */
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (buffer: Buffer, level: number) => zlib.zstdCompressSync(buffer, { params: { 0: level } }),
  decompress: async (buffer: Buffer) => zlib.zstdDecompressSync(buffer),
}));
vi.mock("electron-is-dev", () => ({ default: false }));

import appData from "../../src/appData";
import { readPack } from "../../src/packFileSerializer";
import { DBNameToDBVersions } from "../../src/schema";
import { parseDBTablePath, resolveParsedDBVersion } from "../../src/utility/packFileHelpers";
import { buildVanillaDbCache } from "../../src/vanillaDbCache/build";
import { createMemorySource, openVanillaDbCache } from "../../src/vanillaDbCache/read";
import { searchVanillaDbCache } from "../../src/vanillaDbCache/search";
import type { DBVersion, SchemaField } from "../../src/packFileTypes";

/**
 * Opt in with `WHMM_FIDELITY=1 npx vitest run test/vanillaDbCache/fidelity.node.test.ts`.
 *
 * Off by default because it parses the whole pack twice and takes minutes - too slow to sit in the
 * suite everyone runs, and it needs the game installed. This is the test that actually proves the
 * cache works, so it is worth running whenever the format, the codecs or the pack reader change.
 *
 * Set WHMM_DB_PACK to point at a pack somewhere other than the default.
 */
const DB_PACK_PATH =
  process.env.WHMM_DB_PACK ??
  "/mnt/k/SteamLibrary/steamapps/common/Total War WARHAMMER III/data/db.pack";
const SCHEMA_JSON_PATH = nodePath.join(__dirname, "../../schema/schema_wh3.json");

const havePackAndSchema =
  process.env.WHMM_FIDELITY === "1" && fs.existsSync(DB_PACK_PATH) && fs.existsSync(SCHEMA_JSON_PATH);

/** Loads the uncompressed schema straight into the map readPack consults. */
const loadSchema = () => {
  const raw = JSON.parse(fs.readFileSync(SCHEMA_JSON_PATH, "utf8")) as {
    definitions: Record<string, DBVersion[]>;
  };
  for (const [tableName, versions] of Object.entries(raw.definitions)) {
    DBNameToDBVersions.wh3[tableName] = versions.toSorted((a, b) => b.version - a.version);
  }
};

const identity = {
  game: "wh3",
  dbPackPath: DB_PACK_PATH,
  dbPackSize: 0,
  dbPackMtimeMs: 0,
  schemaHash: "fidelity-test",
};

const chunkIntoRows = (schemaFields: SchemaField[], columnCount: number): SchemaField[][] => {
  const rows: SchemaField[][] = [];
  for (let start = 0; start + columnCount <= schemaFields.length; start += columnCount) {
    rows.push(schemaFields.slice(start, start + columnCount));
  }
  return rows;
};

describe.skipIf(!havePackAndSchema)("vanilla db cache fidelity against the real pack", () => {
  it("gives back exactly what readPack parsed, for every table", async () => {
    loadSchema();
    appData.currentGame = "wh3";

    const indexOnly = await readPack(DB_PACK_PATH, { skipParsingTables: true });
    const tablePaths = indexOnly.packedFiles
      .filter((packedFile) => parseDBTablePath(packedFile.name) != undefined)
      .map((packedFile) => packedFile.name);
    expect(tablePaths.length).toBeGreaterThan(1000);

    const parseStarted = performance.now();
    const parsed = await readPack(DB_PACK_PATH, { tablesToRead: tablePaths });
    const parseMs = performance.now() - parseStarted;

    const resolveSchema = (packedFile: (typeof parsed.packedFiles)[number]) => {
      const dbName = parseDBTablePath(packedFile.name)?.dbName;
      return dbName ? resolveParsedDBVersion(packedFile.version, DBNameToDBVersions.wh3[dbName]) : undefined;
    };

    const buildStarted = performance.now();
    const { bytes, meta, skipped } = buildVanillaDbCache(parsed.packedFiles, resolveSchema, identity);
    const buildMs = performance.now() - buildStarted;

    const reader = openVanillaDbCache(createMemorySource(bytes));
    expect(reader).toBeDefined();

    let comparedTables = 0;
    let comparedCells = 0;
    const failures: string[] = [];

    for (const packedFile of parsed.packedFiles) {
      const dbVersion = resolveSchema(packedFile);
      if (!dbVersion || !packedFile.schemaFields) continue;
      if (!meta.tables.some((table) => table.packedFilePath === packedFile.name)) continue;

      const expectedRows = chunkIntoRows(packedFile.schemaFields, dbVersion.fields.length);
      const actualRows = reader!.getTableRows(packedFile.name);

      if (!actualRows || actualRows.length !== expectedRows.length) {
        failures.push(`${packedFile.name}: ${actualRows?.length ?? "missing"} rows, want ${expectedRows.length}`);
        continue;
      }

      for (let row = 0; row < expectedRows.length; row++) {
        for (let column = 0; column < dbVersion.fields.length; column++) {
          comparedCells++;
          const expectedCell = expectedRows[row][column];
          const actualCell = actualRows[row][column];
          if (JSON.stringify(actualCell) !== JSON.stringify(expectedCell)) {
            if (failures.length < 10) {
              failures.push(
                `${packedFile.name} row ${row} col ${dbVersion.fields[column].name}` +
                  ` (${dbVersion.fields[column].field_type}):` +
                  ` got ${JSON.stringify(actualCell)} want ${JSON.stringify(expectedCell)}`,
              );
            }
          }
        }
      }
      comparedTables++;
    }

    const metaBlockLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      8,
      true,
    );
    console.log(
      `  metadata block ${(metaBlockLength / 1048576).toFixed(2)} MB stored` +
        ` (${(zlib.gunzipSync(Buffer.from(bytes.subarray(12, 12 + metaBlockLength))).length / 1048576).toFixed(2)} MB of JSON)`,
    );
    console.log(
      `pack ${(fs.statSync(DB_PACK_PATH).size / 1048576).toFixed(1)} MB` +
        ` -> cache ${(bytes.length / 1048576).toFixed(1)} MB` +
        ` | ${meta.tables.length} tables stored, ${skipped.length} skipped` +
        ` | parse ${(parseMs / 1000).toFixed(1)}s, build ${(buildMs / 1000).toFixed(1)}s`,
    );
    console.log(`  compared ${comparedTables} tables, ${comparedCells} cells`);
    if (skipped.length > 0) {
      const reasons = new Map<string, number>();
      for (const entry of skipped) reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
      console.log(`  skipped:`, Object.fromEntries(reasons));
    }

    expect(failures).toEqual([]);
    expect(comparedTables).toBeGreaterThan(1000);
    reader!.close();
  }, 900000);

  it("searches every table for a value", async () => {
    loadSchema();
    appData.currentGame = "wh3";

    const indexOnly = await readPack(DB_PACK_PATH, { skipParsingTables: true });
    const allTablePaths = indexOnly.packedFiles
      .filter((packedFile) => parseDBTablePath(packedFile.name) != undefined)
      .map((packedFile) => packedFile.name);
    const parsed = await readPack(DB_PACK_PATH, { tablesToRead: allTablePaths });
    const { bytes } = buildVanillaDbCache(
      parsed.packedFiles,
      (packedFile) => {
        const dbName = parseDBTablePath(packedFile.name)?.dbName;
        return dbName ? resolveParsedDBVersion(packedFile.version, DBNameToDBVersions.wh3[dbName]) : undefined;
      },
      identity,
    );

    for (const [label, options] of [
      ["prefix wh_main_grn_", { query: "wh_main_grn_", mode: "prefix", caseSensitive: true }],
      ["contains grn_greenskins", { query: "grn_greenskins" }],
      ["contains nothing_matches_this", { query: "nothing_matches_this" }],
    ] as const) {
      // A fresh reader each time, so nothing is warmed by the previous query.
      const reader = openVanillaDbCache(createMemorySource(bytes))!;
      const started = performance.now();
      const result = searchVanillaDbCache(reader, { ...options, maxResults: 100_000 });
      const elapsed = performance.now() - started;
      console.log(
        `  search ${label}: ${result.matches.length} matches in ${elapsed.toFixed(0)}ms` +
          ` | scanned ${result.columnsScanned} of ${result.columnsConsidered} columns` +
          ` | read ${(reader.stats().bytesRead / 1048576).toFixed(1)} MB`,
      );
      expect(result.truncated).toBe(false);
      reader.close();
    }
  }, 900000);

  it("serves one table far faster than parsing the pack for it", async () => {
    // The point of the whole exercise, measured rather than assumed.
    loadSchema();
    appData.currentGame = "wh3";

    const tablePath = "db\\main_units_tables\\data__";
    const indexOnly = await readPack(DB_PACK_PATH, { skipParsingTables: true });
    const allTablePaths = indexOnly.packedFiles
      .filter((packedFile) => parseDBTablePath(packedFile.name) != undefined)
      .map((packedFile) => packedFile.name);

    const resolveSchema = (packedFile: { name: string; version?: number }) => {
      const dbName = parseDBTablePath(packedFile.name)?.dbName;
      return dbName ? resolveParsedDBVersion(packedFile.version, DBNameToDBVersions.wh3[dbName]) : undefined;
    };
    const parsedAll = await readPack(DB_PACK_PATH, { tablesToRead: allTablePaths });
    const { bytes } = buildVanillaDbCache(parsedAll.packedFiles, resolveSchema, identity);

    const packStarted = performance.now();
    const fromPack = await readPack(DB_PACK_PATH, { tablesToRead: [tablePath] });
    const packMs = performance.now() - packStarted;
    const packRows = fromPack.packedFiles.find((packedFile) => packedFile.name === tablePath)?.schemaFields
      ?.length;

    const cacheStarted = performance.now();
    const reader = openVanillaDbCache(createMemorySource(bytes))!;
    const rows = reader.getTableRows(tablePath)!;
    const cacheMs = performance.now() - cacheStarted;

    console.log(
      `one table: readPack ${packMs.toFixed(0)}ms vs cache open+read ${cacheMs.toFixed(0)}ms` +
        ` | ${rows.length} rows, ${reader.stats().bytesRead} bytes read of ${bytes.length}`,
    );
    expect(rows.length * rows[0].length).toBe(packRows);
    reader.close();
  }, 900000);
});
