import { describe, expect, it } from "vitest";

import {
  decodeVanillaPackFilesCache,
  encodeVanillaPackFilesCache,
  inspectVanillaPackFilesCache,
  type VanillaPackFilesCache,
} from "../src/vanillaPackFilesCacheFormat";

describe("vanilla pack files compact binary format", () => {
  it("round-trips complete expanded and names-only entries", () => {
    const cache: VanillaPackFilesCache = {
      version: 3,
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

    const cache: VanillaPackFilesCache = { version: 3, entries: {} };
    const encoded = encodeVanillaPackFilesCache(cache);
    encoded.writeUInt32LE(99, 4);
    expect(decodeVanillaPackFilesCache(encoded)).toBeUndefined();
  });

  it("rejects non-contiguous expanded offsets instead of silently changing them", () => {
    const cache: VanillaPackFilesCache = {
      version: 3,
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
