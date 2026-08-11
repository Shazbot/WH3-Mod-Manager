import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { packedFileIndexHasStartpos, readPackHeader } from "../src/packFileHandler";

const makeIndexEntry = (name: string, hasCompressionFlag: boolean) => {
  const metadata = Buffer.alloc(hasCompressionFlag ? 5 : 4);
  metadata.writeInt32LE(123, 0);
  if (hasCompressionFlag) metadata.writeInt8(0, 4);
  return Buffer.concat([metadata, Buffer.from(name, "utf8"), Buffer.from([0])]);
};

describe("pack header file index metadata", () => {
  it("reads dependencies and startpos presence from a pack header", async () => {
    const dependencies = Buffer.from("data.pack\0", "utf8");
    const packedFileIndex = Buffer.concat([
      makeIndexEntry("db\\units_tables\\data__", true),
      makeIndexEntry("campaigns\\main_warhammer\\startpos.esf", true),
    ]);
    const header = Buffer.alloc(28);
    header.write("PFH5", 0, "ascii");
    header.writeInt32LE(0, 4);
    header.writeInt32LE(0, 8);
    header.writeInt32LE(dependencies.length, 12);
    header.writeInt32LE(2, 16);
    header.writeInt32LE(packedFileIndex.length, 20);

    const testDirectory = await mkdtemp(path.join(tmpdir(), "whmm-pack-header-"));
    const packPath = path.join(testDirectory, "startpos.pack");
    try {
      await writeFile(packPath, Buffer.concat([header, dependencies, packedFileIndex]));

      await expect(readPackHeader(packPath, true)).resolves.toEqual({
        path: packPath,
        isMovie: false,
        hasStartpos: true,
        dependencyPacks: ["data.pack"],
      });
    } finally {
      await rm(testDirectory, { recursive: true });
    }
  });

  it("finds a nested startpos.esf without reading packed file contents", () => {
    const index = Buffer.concat([
      makeIndexEntry("db\\units_tables\\data__", true),
      makeIndexEntry("campaigns/main_warhammer/STARTPOS.ESF", true),
    ]);

    expect(packedFileIndexHasStartpos(index, 2, true)).toBe(true);
  });

  it("supports pack indexes without compression flag bytes", () => {
    const index = makeIndexEntry("campaigns\\main_attila\\startpos.esf", false);

    expect(packedFileIndexHasStartpos(index, 1, false)).toBe(true);
  });

  it("does not match similarly named files or malformed indexes", () => {
    const index = makeIndexEntry("campaigns\\main_warhammer\\not_startpos.esf", true);

    expect(packedFileIndexHasStartpos(index, 1, true)).toBe(false);
    expect(packedFileIndexHasStartpos(index.subarray(0, 4), 1, true)).toBe(false);
  });
});
