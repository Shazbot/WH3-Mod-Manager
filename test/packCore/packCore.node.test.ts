import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseDbTable,
  parseTypeBufferExact,
  patchDbTableCells,
  readPackIndex,
  readPayload,
  readRawPayload,
  rewritePackFromIndex,
  writeRawPack,
  type RawPackWriteMetadata,
} from "../../src/packCore";
import type { DBVersion } from "../../src/packFileTypes";

const projectRoot = path.resolve(__dirname, "../..");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "whmm-pack-core-"));
const defaultMetadata: RawPackWriteMetadata = {
  game: "wh3",
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
  dependencies: [],
};

beforeAll(() => {
  execFileSync(process.execPath, [path.join(projectRoot, "scripts/build-pack-core.mjs")], { cwd: projectRoot });
});

afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

describe("shared pack core", () => {
  it("imports as standalone CommonJS without loading Electron", () => {
    const corePath = path.join(projectRoot, "tools/packCore/dist/index.cjs");
    const program = [
      `const core = require(${JSON.stringify(corePath)});`,
      `if (Object.keys(require.cache).some((entry) => /[\\/]electron([\\/]|$)/i.test(entry))) throw new Error("Electron was loaded");`,
      `if (typeof core.readPackIndex !== "function" || typeof core.writeRawPack !== "function") throw new Error("missing core exports");`,
    ].join("\n");
    const result = spawnSync(process.execPath, ["-e", program], { cwd: projectRoot, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  it("strictly indexes raw payloads and preserves filename hashes and stored bytes", async () => {
    const sourcePath = path.join(tempRoot, "source.pack");
    const outputPath = path.join(tempRoot, "rewritten.pack");
    const metadata = { ...defaultMetadata, byteMask: 0x43 };
    const storedPayload = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    await writeRawPack(
      sourcePath,
      [{ name: "data\\raw.bin", buffer: storedPayload, is_compressed: true, file_name_hash: 0xf1234567 }],
      metadata,
    );

    const indexed = readPackIndex(sourcePath, { game: "wh3" });
    expect(indexed.entries[0]).toMatchObject({ name: "data\\raw.bin", file_name_hash: 0xf1234567, is_compressed: true });
    expect(readRawPayload(indexed, indexed.entries[0])).toEqual(storedPayload);
    expect(await readPayload(indexed, { ...indexed.entries[0], is_compressed: false })).toEqual(storedPayload);

    await rewritePackFromIndex(outputPath, indexed, [], { removedFileNames: [] });
    const rewritten = readPackIndex(outputPath, { game: "wh3" });
    expect(rewritten.header.byteMask).toBe(0x43);
    expect(rewritten.entries[0].file_name_hash).toBe(0xf1234567);
    expect(readRawPayload(rewritten, rewritten.entries[0])).toEqual(storedPayload);
  });

  it("rejects malformed counts, payload bounds, and truncated headers", async () => {
    const validPath = path.join(tempRoot, "valid.pack");
    await writeRawPack(validPath, [{ name: "one.bin", buffer: Buffer.from([1]) }], defaultMetadata);
    const validBytes = Buffer.from(await import("node:fs/promises").then(({ readFile }) => readFile(validPath)));

    const truncatedPath = path.join(tempRoot, "truncated.pack");
    writeFileSync(truncatedPath, validBytes.subarray(0, 12));
    expect(() => readPackIndex(truncatedPath, { game: "wh3" })).toThrow(/header is truncated/);

    const badCountPath = path.join(tempRoot, "bad-count.pack");
    const badCountBytes = Buffer.from(validBytes);
    badCountBytes.writeInt32LE(2, 16);
    writeFileSync(badCountPath, badCountBytes);
    expect(() => readPackIndex(badCountPath, { game: "wh3" })).toThrow(/packed-file index entry|cannot fit/);

    const badPayloadPath = path.join(tempRoot, "bad-payload.pack");
    const badPayloadBytes = Buffer.from(validBytes);
    badPayloadBytes.writeInt32LE(100, 28);
    writeFileSync(badPayloadPath, badPayloadBytes);
    expect(() => readPackIndex(badPayloadPath, { game: "wh3" })).toThrow(/beyond file size/);
  });

  it("keeps I64 decimal exact and preserves DB preambles and untouched cell bytes", () => {
    const i64Bytes = Buffer.alloc(8);
    i64Bytes.writeBigInt64LE(9007199254740993n);
    expect(parseTypeBufferExact(i64Bytes, 0, "I64").fields[0].val).toBe("9007199254740993");

    const schema: DBVersion = {
      version: 7,
      fields: [
        { name: "id", field_type: "I32", is_key: true, default_value: "0", is_filename: false, is_reference: [], description: "", ca_order: 0, is_bitwise: 0, enum_values: {} },
        { name: "name", field_type: "StringU8", is_key: false, default_value: "", is_filename: false, is_reference: [], description: "", ca_order: 1, is_bitwise: 0, enum_values: {} },
      ],
    };
    const prefix = Buffer.from([0xfc, 0xfd, 0xfe, 0xff, 7, 0, 0, 0, 1]);
    const count = Buffer.from([1, 0, 0, 0]);
    const firstCell = Buffer.from([4, 3, 2, 1]);
    const untouchedCell = Buffer.from([3, 0, 65, 66, 67]);
    const original = Buffer.concat([prefix, count, firstCell, untouchedCell]);
    const parsed = parseDbTable(original, schema);
    const patched = patchDbTableCells(parsed, [
      { rowIndex: 0, fieldIndex: 0, fields: [{ type: "I32", val: 99 }] },
    ]);
    expect(patched.subarray(0, prefix.length)).toEqual(prefix);
    expect(patched.subarray(prefix.length + count.length + firstCell.length)).toEqual(untouchedCell);
  });

  it("writes and reads an empty mod or movie pack", async () => {
    for (const packType of ["mod", "movie"] as const) {
      const packPath = path.join(tempRoot, `${packType}.pack`);
      await writeRawPack(packPath, [], { ...defaultMetadata, packType });
      const indexed = readPackIndex(packPath, { game: "wh3" });
      expect(indexed.entries).toEqual([]);
      expect(indexed.header.byteMask).toBe(packType === "movie" ? 4 : 3);
    }
  });
});
