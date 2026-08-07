import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { normalizeZipEntryPaths } = require("../scripts/normalize-zip-paths.cjs") as {
  normalizeZipEntryPaths: (zipPath: string) => Promise<number>;
};

function makeEmptyZip(entryName: string) {
  const name = Buffer.from(entryName, "utf8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6);
  localHeader.writeUInt16LE(name.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(name.length, 28);

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralHeader.length + name.length, 12);
  endOfCentralDirectory.writeUInt32LE(localHeader.length + name.length, 16);

  return Buffer.concat([localHeader, name, centralHeader, name, endOfCentralDirectory]);
}

describe("normalizeZipEntryPaths", () => {
  it("changes Windows separators in both ZIP filename headers", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wh3mm-zip-path-test-"));
    const zipPath = path.join(tempDir, "artifact.zip");

    try {
      await fs.writeFile(zipPath, makeEmptyZip("locales\\af.pak"));

      await expect(normalizeZipEntryPaths(zipPath)).resolves.toBe(1);

      const archive = await fs.readFile(zipPath);
      expect(archive.includes(Buffer.from("locales\\af.pak"))).toBe(false);
      expect(archive.toString("utf8").match(/locales\/af\.pak/g)).toHaveLength(2);

      await expect(normalizeZipEntryPaths(zipPath)).resolves.toBe(0);
    } finally {
      await fs.rm(tempDir, { recursive: true });
    }
  });
});
