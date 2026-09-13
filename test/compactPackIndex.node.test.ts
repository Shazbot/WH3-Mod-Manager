import { describe, expect, it } from "vitest";

import { Pack } from "../src/packFileTypes";
import {
  buildCompactPackIndex,
  findCompactPackFile,
  findCompactPackFilesUnderPrefix,
  forEachCompactPackFileName,
} from "../src/utility/compactPackIndex";

const pack: Pack = {
  name: "units.pack",
  path: "C:\\mods\\units.pack",
  size: 9000,
  lastChangedLocal: 1234,
  packHeader: {
    header: Buffer.from("PFH5"),
    byteMask: 0,
    refFileCount: 0,
    pack_file_index_size: 0,
    pack_file_count: 3,
    header_buffer: Buffer.alloc(4),
  },
  dependencyPacks: [],
  readTables: [],
  packedFiles: [
    { name: "text\\notes.txt", file_size: 30, start_pos: 800, is_compressed: false },
    { name: "db\\main_units_tables\\z", file_size: 20, start_pos: 500, is_compressed: true },
    { name: "db\\main_units_tables\\a", file_size: 10, start_pos: 300, is_compressed: false },
  ],
};

describe("compact pack index", () => {
  it("preserves payload metadata while storing names in searchable rank order", () => {
    const index = buildCompactPackIndex(pack);

    expect(findCompactPackFile(index, "db\\main_units_tables\\z")).toMatchObject({
      file_size: 20,
      start_pos: 500,
      is_compressed: true,
    });
    expect(findCompactPackFile(index, "missing")).toBeUndefined();
    expect(findCompactPackFilesUnderPrefix(index, "db\\main_units_tables").map((file) => file.name)).toEqual([
      "db\\main_units_tables\\a",
      "db\\main_units_tables\\z",
    ]);
  });

  it("streams all names without materializing a retained string array", () => {
    const names: string[] = [];
    forEachCompactPackFileName(buildCompactPackIndex(pack), (name) => names.push(name));
    expect(names).toEqual(["db\\main_units_tables\\a", "db\\main_units_tables\\z", "text\\notes.txt"]);
  });
});
