import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { packedFileIndexHasStartpos, readPackHeader, scanPackedFileIndex } from "../src/packFileHandler";

const makeIndexEntry = (name: string, hasCompressionFlag: boolean, hasFileNameHash = false) => {
  const metadata = Buffer.alloc(4 + (hasFileNameHash ? 4 : 0) + (hasCompressionFlag ? 1 : 0));
  metadata.writeInt32LE(123, 0);
  let position = 4;
  if (hasFileNameHash) {
    metadata.writeUInt32LE(0x6a53eb17, position);
    position += 4;
  }
  if (hasCompressionFlag) metadata.writeInt8(0, position);
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
        hasLoadOrderRules: false,
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

  it.each([0x40, 0x41])("reads PFH5 hashed indexes with byte mask %#", async (byteMask) => {
    const packedFileIndex = makeIndexEntry("campaigns\\main_warhammer\\startpos.esf", true, true);
    const header = Buffer.alloc(28);
    header.write("PFH5", 0, "ascii");
    header.writeInt32LE(byteMask, 4);
    header.writeInt32LE(0, 8);
    header.writeInt32LE(0, 12);
    header.writeInt32LE(1, 16);
    header.writeInt32LE(packedFileIndex.length, 20);

    const testDirectory = await mkdtemp(path.join(tmpdir(), "whmm-hashed-pack-header-"));
    const packPath = path.join(testDirectory, "hashed.pack");
    try {
      await writeFile(packPath, Buffer.concat([header, packedFileIndex]));

      await expect(readPackHeader(packPath, true)).resolves.toEqual({
        path: packPath,
        isMovie: false,
        hasStartpos: true,
        hasLoadOrderRules: false,
        dependencyPacks: [],
      });
    } finally {
      await rm(testDirectory, { recursive: true });
    }
  });

  it("does not match similarly named files or malformed indexes", () => {
    const index = makeIndexEntry("campaigns\\main_warhammer\\not_startpos.esf", true);

    expect(packedFileIndexHasStartpos(index, 1, true)).toBe(false);
    expect(packedFileIndexHasStartpos(index.subarray(0, 4), 1, true)).toBe(false);
  });
});

describe("scanPackedFileIndex", () => {
  it("spots the load order rules file in the same pass as startpos", () => {
    const index = Buffer.concat([
      makeIndexEntry("db\\units_tables\\data__", true),
      makeIndexEntry("whmm\\load_order.whmm", true),
      makeIndexEntry("campaigns\\main_warhammer\\startpos.esf", true),
    ]);

    expect(scanPackedFileIndex(index, 3, true)).toEqual({
      hasStartpos: true,
      hasLoadOrderRules: true,
      loadOrderRulesFileName: "whmm\\load_order.whmm",
    });
  });

  it("matches the rules file however the pack spells the path, and reports that spelling", () => {
    const index = Buffer.concat([makeIndexEntry("WHMM/Load_Order.WHMM", true)]);
    const scan = scanPackedFileIndex(index, 1, true);

    expect(scan.hasLoadOrderRules).toBe(true);
    // A targeted read looks the file up by its stored name, so the original casing has to survive.
    expect(scan.loadOrderRulesFileName).toBe("WHMM/Load_Order.WHMM");
  });

  it("does not mistake a flow or a nested lookalike for it", () => {
    const index = Buffer.concat([
      makeIndexEntry("whmmflows\\thing.json", true),
      makeIndexEntry("db\\whmm\\load_order.whmm", true),
      makeIndexEntry("whmm\\notes.txt", true),
    ]);

    expect(scanPackedFileIndex(index, 3, true).hasLoadOrderRules).toBe(false);
  });

  it("reports neither for a pack holding nothing special", () => {
    const index = Buffer.concat([makeIndexEntry("db\\units_tables\\data__", true)]);
    expect(scanPackedFileIndex(index, 1, true)).toEqual({ hasStartpos: false, hasLoadOrderRules: false });
  });

  it("skips the filename hash before scanning a hashed PFH5 entry", () => {
    const index = makeIndexEntry("whmm\\load_order.whmm", true, true);

    expect(scanPackedFileIndex(index, 1, true, true)).toEqual({
      hasStartpos: false,
      hasLoadOrderRules: true,
      loadOrderRulesFileName: "whmm\\load_order.whmm",
    });
  });
});
