import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as nodePath from "path";
import * as os from "os";

import { parseLocTable, serializeDbTable, writeRawPack, type RawPackWriteMetadata } from "../../src/packCore";
import { LocVersion } from "../../src/packFileTypes";
import { buildVanillaLocCacheBytes } from "../../src/vanillaLocCache/build";
import { createMemorySource, openVanillaLocCache } from "../../src/vanillaLocCache/read";
import { indexExactVanillaLocPackSet, readExactVanillaLocEntries } from "../../src/vanillaLocCache/exactSource";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

const metadata: RawPackWriteMetadata = {
  game: "wh3",
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([255, 255, 255, 127]),
  dependencies: [],
};
const locPreamble = Buffer.from([255, 254, 76, 79, 67, 0, 1, 0, 0, 0]);
const locTable = (value: string) =>
  serializeDbTable(
    LocVersion,
    [
      [
        [{ type: "String", val: "shared_key" }],
        [{ type: "String", val: value }],
        [{ type: "UInt8", val: 0 }],
      ],
    ],
    { preamble: locPreamble },
  );
const emptyLocTable = () => serializeDbTable(LocVersion, [], { preamble: locPreamble });

const openBuilt = async (entries: Awaited<ReturnType<typeof readExactVanillaLocEntries>>) => {
  const reader = openVanillaLocCache(createMemorySource(buildVanillaLocCacheBytes(entries)));
  if (!reader) throw new Error("expected exact LOC cache to open");
  return reader;
};

describe("exact vanilla LOC source", () => {
  it("preserves pack-index and GUI file ordering in distinct fingerprints and last-wins results", async () => {
    temporaryDirectory = fs.mkdtempSync(nodePath.join(os.tmpdir(), "whmm-exact-loc-"));
    const packPath = nodePath.join(temporaryDirectory, "local.pack");
    await writeRawPack(
      packPath,
      [
        { name: "text\\z.loc", buffer: locTable("from z") },
        { name: "text\\a.loc", buffer: locTable("from a") },
        { name: "text\\empty.loc", buffer: emptyLocTable() },
      ],
      metadata,
    );

    const guiPackSet = indexExactVanillaLocPackSet([packPath], "wh3", "gui");
    const indexedPackSet = indexExactVanillaLocPackSet([packPath], "wh3", "packIndex");
    expect(guiPackSet.orderFingerprint).not.toBe(indexedPackSet.orderFingerprint);
    expect(guiPackSet.packs[0].locEntries.map((entry) => entry.name)).toEqual([
      "text\\a.loc",
      "text\\empty.loc",
      "text\\z.loc",
    ]);
    expect(indexedPackSet.packs[0].locEntries.map((entry) => entry.name)).toEqual([
      "text\\z.loc",
      "text\\a.loc",
      "text\\empty.loc",
    ]);

    const guiReader = await openBuilt(await readExactVanillaLocEntries(guiPackSet));
    const packIndexReader = await openBuilt(await readExactVanillaLocEntries(indexedPackSet));
    expect(guiReader.getEntry("shared_key")).toMatchObject({ value: "from z", rowIndex: 0 });
    expect(guiReader.getEntry("shared_key")?.sourceLabel).toBe(`${nodePath.resolve(packPath)}\0text\\z.loc`);
    expect(packIndexReader.get("shared_key")).toBe("from a");
    guiReader.close();
    packIndexReader.close();

    await writeRawPack(
      packPath,
      [
        { name: "text\\z.loc", buffer: locTable("from z") },
        { name: "text\\a.loc", buffer: locTable("from a") },
      ],
      metadata,
    );
    expect(indexExactVanillaLocPackSet([packPath], "wh3", "gui").orderFingerprint).not.toBe(
      guiPackSet.orderFingerprint,
    );
  });

  it("rejects duplicate normalized LOC paths instead of caching a partial file set", async () => {
    temporaryDirectory = fs.mkdtempSync(nodePath.join(os.tmpdir(), "whmm-exact-loc-"));
    const packPath = nodePath.join(temporaryDirectory, "duplicate.pack");
    await writeRawPack(
      packPath,
      [
        { name: "text\\same.loc", buffer: locTable("first") },
        { name: "TEXT/same.loc", buffer: locTable("second") },
      ],
      metadata,
    );

    expect(() => indexExactVanillaLocPackSet([packPath], "wh3", "gui")).toThrow(/Duplicate LOC path/);
  });

  it("rejects rooted or parent-traversing LOC paths", async () => {
    temporaryDirectory = fs.mkdtempSync(nodePath.join(os.tmpdir(), "whmm-exact-loc-"));
    const packPath = nodePath.join(temporaryDirectory, "malformed.pack");
    await writeRawPack(packPath, [{ name: "text\\..\\outside.loc", buffer: locTable("value") }], metadata);

    expect(() => indexExactVanillaLocPackSet([packPath], "wh3", "gui")).toThrow(/Invalid LOC path/);
  });

  it("parses valid source LOC payloads with the shared exact decoder", () => {
    const parsed = parseLocTable(locTable("exact text"));
    expect(parsed.rows[0].cells[1].fields[0].val).toBe("exact text");
  });
});
