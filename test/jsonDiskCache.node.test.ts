import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as nodePath from "path";

/**
 * Pass-through, as everywhere else in the suite: the native zstd binding is an Electron prebuild and
 * does not load here. What is under test is the error handling around it, not the compression.
 */
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

import { readJsonDiskCache, writeJsonDiskCache } from "../src/utility/jsonDiskCache";

const tempFile = (name: string) => nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), "whmm-cache-")), name);

describe("json disk cache", () => {
  it("reads back what it wrote", async () => {
    const path = tempFile("cache.bin");
    const value = { wh3: { dbPackSize: 12345, tableNameToVersion: { main_units_tables: 7 } } };

    await writeJsonDiskCache(path, value);

    expect(await readJsonDiskCache(path)).toEqual(value);
  });

  it("returns undefined for a cache that was never written", async () => {
    expect(await readJsonDiskCache(tempFile("absent.bin"))).toBeUndefined();
  });

  it("returns undefined for a corrupt cache instead of throwing", async () => {
    // The case that matters: a half-written file from a crash must not take the app down on the next
    // start, it must just miss and be recomputed.
    const path = tempFile("corrupt.bin");
    fs.writeFileSync(path, Buffer.from([0x00, 0x01, 0x02, 0xff]));

    await expect(readJsonDiskCache(path)).resolves.toBeUndefined();
  });

  it("returns undefined when the cache holds valid bytes that are not JSON", async () => {
    const path = tempFile("nonjson.bin");
    fs.writeFileSync(path, Buffer.from("this is not json", "utf8"));

    await expect(readJsonDiskCache(path)).resolves.toBeUndefined();
  });

  it("does not throw when the cache cannot be written", async () => {
    // A directory that does not exist - writing must be best effort, since the caller has already
    // computed the value and only wanted to save it for next time.
    const path = nodePath.join(tempFile("x"), "missing-dir", "cache.bin");

    await expect(writeJsonDiskCache(path, { a: 1 })).resolves.toBeUndefined();
  });

  it("overwrites a previous entry rather than appending to it", async () => {
    const path = tempFile("cache.bin");

    await writeJsonDiskCache(path, { version: 1 });
    await writeJsonDiskCache(path, { version: 2 });

    expect(await readJsonDiskCache(path)).toEqual({ version: 2 });
  });
});
