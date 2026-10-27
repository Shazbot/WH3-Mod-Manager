import { describe, expect, it } from "vitest";

import {
  decodeVanillaPackFilesCache,
  decodeVanillaPackFilesCacheRecord,
  encodeVanillaPackFilesCache,
  inspectVanillaPackFilesCache,
  indexVanillaPackFilesCache,
  type VanillaPackFilesCache,
} from "../src/vanillaPackFilesCacheFormat";

describe("vanilla pack files compact binary format", () => {
  it("round-trips complete expanded and names-only entries", () => {
    const cache: VanillaPackFilesCache = {
      version: 4,
      entries: {
        "C:\\game\\data\\release.pack": {
          size: 123456,
          lastChangedLocal: 1720000000123.5,
          packedFiles: [
            { name: "audio\\voice.wem", file_size: 10, start_pos: 100, is_compressed: false },
            { name: "variantmeshes\\a.wsmodel", file_size: 20, start_pos: 110, is_compressed: true },
            { name: "variantmeshes\\ä.dds", file_size: 30, start_pos: 130, is_compressed: false },
          ],
          packHeader: {
            header: Buffer.from("PFH5"),
            byteMask: 0x41,
            refFileCount: 2,
            pack_file_index_size: 17,
            pack_file_count: 3,
            header_buffer: Buffer.from([1, 2, 3, 4]),
          },
          dependencyPacks: ["data.pack", "models.pack"],
        },
        "C:\\game\\data\\mod.pack": {
          size: 42,
          lastChangedLocal: 1720000000999,
          packedFileNames: ["db\\a", "db\\alphabet", "script\\x.lua"],
        },
      },
    };

    const encoded = encodeVanillaPackFilesCache(cache);
    const metadata = inspectVanillaPackFilesCache(encoded);
    const decoded = decodeVanillaPackFilesCache(encoded);

    expect(encoded.subarray(0, 4).toString("ascii")).toBe("WVFC");
    expect(metadata?.get("C:\\game\\data\\release.pack")).toEqual({
      size: 123456,
      lastChangedLocal: 1720000000123.5,
      hasExpandedIndex: true,
    });
    expect(metadata?.get("C:\\game\\data\\mod.pack")?.hasExpandedIndex).toBe(false);
    expect(decoded).toEqual(cache);
  });

  it("rejects old or corrupt data", () => {
    expect(decodeVanillaPackFilesCache(Buffer.from('{"version":2}', "utf8"))).toBeUndefined();

    const cache: VanillaPackFilesCache = { version: 4, entries: {} };
    const encoded = encodeVanillaPackFilesCache(cache);
    encoded.writeUInt32LE(99, 4);
    expect(decodeVanillaPackFilesCache(encoded)).toBeUndefined();
  });

  it("rejects invalid directory versions, record bounds, and entry-count limits", () => {
    const encoded = encodeVanillaPackFilesCache({ version: 4, entries: {} });
    const oldVersion = Buffer.from(encoded);
    oldVersion.writeUInt32LE(99, 4);
    expect(indexVanillaPackFilesCache(oldVersion)).toBeUndefined();

    const tooManyEntries = Buffer.from(encoded);
    tooManyEntries.writeUInt32LE(100_001, 8);
    expect(indexVanillaPackFilesCache(tooManyEntries)).toBeUndefined();

    const withEntry = encodeVanillaPackFilesCache({
      version: 4,
      entries: { "C:\\game\\data.pack": { size: 1, lastChangedLocal: 1, packedFileNames: [] } },
    });
    const invalidRecordLength = Buffer.from(withEntry);
    invalidRecordLength.writeUInt32LE(0xffffffff, 13);
    expect(indexVanillaPackFilesCache(invalidRecordLength)).toBeUndefined();
    expect(inspectVanillaPackFilesCache(invalidRecordLength)).toBeUndefined();
  });

  it("rejects an oversized selected file count while keeping record indexing lightweight", () => {
    const packPath = "C:\\game\\data.pack";
    const encoded = encodeVanillaPackFilesCache({
      version: 4,
      entries: { [packPath]: { size: 1, lastChangedLocal: 1, packedFileNames: [] } },
    });
    const record = indexVanillaPackFilesCache(encoded)!.get(packPath)!;
    const tooManyNames = Buffer.from(encoded);
    const nameCountOffset = record.dataOffset + 4 + Buffer.byteLength(packPath, "utf8") + 8 + 8;
    tooManyNames.writeUInt32LE(5_000_001, nameCountOffset);

    expect(indexVanillaPackFilesCache(tooManyNames)).toBeUndefined();
    expect(decodeVanillaPackFilesCacheRecord(tooManyNames, record)).toBeUndefined();
    expect(decodeVanillaPackFilesCache(tooManyNames)).toBeUndefined();
  });

  it("enforces the aggregate file-count limit while indexing record prefixes only", () => {
    const firstPath = "C:\\game\\first.pack";
    const secondPath = "C:\\game\\second.pack";
    const encoded = encodeVanillaPackFilesCache({
      version: 4,
      entries: {
        [firstPath]: { size: 1, lastChangedLocal: 1, packedFileNames: [] },
        [secondPath]: { size: 1, lastChangedLocal: 1, packedFileNames: [] },
      },
    });
    const records = indexVanillaPackFilesCache(encoded)!;
    const tooManyFiles = Buffer.from(encoded);
    const firstNameCountOffset = records.get(firstPath)!.dataOffset + 4 + Buffer.byteLength(firstPath, "utf8") + 8 + 8;
    const secondNameCountOffset =
      records.get(secondPath)!.dataOffset + 4 + Buffer.byteLength(secondPath, "utf8") + 8 + 8;
    tooManyFiles.writeUInt32LE(3_000_000, firstNameCountOffset);
    tooManyFiles.writeUInt32LE(2_000_001, secondNameCountOffset);

    expect(indexVanillaPackFilesCache(tooManyFiles)).toBeUndefined();
    expect(decodeVanillaPackFilesCache(tooManyFiles)).toBeUndefined();
  });

  it("tracks all-WEM packs without dropping their files from the complete cache", () => {
    const cache: VanillaPackFilesCache = {
      version: 4,
      entries: {
        "C:\\audio.pack": {
          size: 1000,
          lastChangedLocal: 1,
          packedFiles: [
            { name: "audio\\a.wem", file_size: 5, start_pos: 100, is_compressed: false },
            { name: "audio\\b.WEM", file_size: 7, start_pos: 105, is_compressed: true },
          ],
          packHeader: {
            header: Buffer.from("PFH5"),
            byteMask: 1,
            refFileCount: 0,
            pack_file_index_size: 0,
            pack_file_count: 2,
            header_buffer: Buffer.from([0, 0, 0, 0]),
          },
          dependencyPacks: [],
        },
      },
    };

    expect(decodeVanillaPackFilesCache(encodeVanillaPackFilesCache(cache))).toEqual(cache);
  });

  it("rejects non-contiguous expanded offsets instead of silently changing them", () => {
    const cache: VanillaPackFilesCache = {
      version: 4,
      entries: {
        "C:\\release.pack": {
          size: 1000,
          lastChangedLocal: 1,
          packedFiles: [
            { name: "a", file_size: 5, start_pos: 100, is_compressed: false },
            { name: "b", file_size: 5, start_pos: 200, is_compressed: false },
          ],
          packHeader: {
            header: Buffer.from("PFH5"),
            byteMask: 1,
            refFileCount: 0,
            pack_file_index_size: 0,
            pack_file_count: 2,
            header_buffer: Buffer.from([0, 0, 0, 0]),
          },
          dependencyPacks: [],
        },
      },
    };

    expect(() => encodeVanillaPackFilesCache(cache)).toThrow(/non-contiguous/);
  });
});
