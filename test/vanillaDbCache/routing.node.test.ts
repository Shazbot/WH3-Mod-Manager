import { describe, expect, it } from "vitest";
import * as nodePath from "path";

import type { PackedFile } from "../../src/packFileTypes";
import {
  getIndexedDbTablePathsForPrefix,
  isVanillaDbPackPath,
} from "../../src/vanillaDbCache/routing";

const indexedFile = (name: string): PackedFile =>
  ({ name, file_size: 0, start_pos: 0 }) as PackedFile;

describe("vanilla DB cache routing", () => {
  it("rejects an ordinary mod before a cache reader can be opened or built", () => {
    const dataFolder = nodePath.join("game", "data");
    expect(isVanillaDbPackPath(nodePath.join("mods", "units.pack"), dataFolder, "db.pack")).toBe(false);
    expect(isVanillaDbPackPath(nodePath.join(dataFolder, "db.pack"), dataFolder, "db.pack")).toBe(true);
  });

  it("uses every indexed file under a prefix as the completeness requirement", () => {
    const files = [
      indexedFile("db\\units_tables\\data__"),
      indexedFile("db\\units_tables\\campaign_override"),
      indexedFile("db\\other_tables\\data__"),
      indexedFile("text\\notes.txt"),
    ];

    expect(getIndexedDbTablePathsForPrefix(files, "db\\units_tables\\")).toEqual([
      "db\\units_tables\\data__",
      "db\\units_tables\\campaign_override",
    ]);
  });
});
