import { describe, expect, it } from "vitest";

import {
  VanillaPackIndexIdentity,
  buildVanillaPackIndex,
  collectVanillaPackTreeChildrenPageFromFlat,
  collectVanillaPackTreeChildren,
  collectVanillaFilesMatching,
  collectVanillaFilesUnderPrefix,
  decodeVanillaPackIndex,
  encodeVanillaPackIndex,
  findVanillaPackContaining,
  findVanillaPacksUnderPrefix,
  isVanillaPackIndexCurrent,
  normalizeVanillaPackPath,
  searchVanillaPackFileTree,
} from "../../src/vanillaPackIndex/format";

const identity: VanillaPackIndexIdentity = {
  game: "wh3",
  dataFolder: "C:\\games\\wh3\\data",
  manifestSize: 12345,
  manifestMtimeMs: 1700000000000,
  packCount: 3,
};

// Manifest order: data.pack lowest priority, variants_bl.pack highest.
const packs = [
  {
    packName: "data.pack",
    fileNames: [
      "script\\campaign\\mod\\shared.lua",
      "variantmeshes\\variantmeshdefinitions\\shared.variantmeshdefinition",
    ],
  },
  {
    packName: "variants.pack",
    fileNames: [
      "variantmeshes\\variantmeshdefinitions\\emp_state_troops_shields_set1.variantmeshdefinition",
      "variantmeshes\\variantmeshdefinitions\\shared.variantmeshdefinition",
      "variantmeshes\\wh_variantmodels\\hu1\\emp\\emp_props\\shield.wsmodel",
    ],
  },
  {
    packName: "variants_bl.pack",
    fileNames: ["variantmeshes\\variantmeshdefinitions\\shared.variantmeshdefinition"],
  },
];

const index = buildVanillaPackIndex(identity, packs);

describe("vanilla pack index", () => {
  it("finds the pack holding an exact path", () => {
    expect(
      findVanillaPackContaining(
        index,
        "variantmeshes\\variantmeshdefinitions\\emp_state_troops_shields_set1.variantmeshdefinition",
      ),
    ).toBe("variants.pack");
  });

  it("matches a target written with forward slashes or in mixed case", () => {
    const forwardSlashes = "variantmeshes/variantmeshdefinitions/emp_state_troops_shields_set1.variantmeshdefinition";
    expect(findVanillaPackContaining(index, forwardSlashes)).toBe("variants.pack");
    expect(findVanillaPackContaining(index, forwardSlashes.toUpperCase())).toBe("variants.pack");
  });

  it("gives a file carried by several packs to the one loaded last", () => {
    // All three packs have it; manifest order makes variants_bl.pack the copy the game uses.
    expect(
      findVanillaPackContaining(index, "variantmeshes\\variantmeshdefinitions\\shared.variantmeshdefinition"),
    ).toBe("variants_bl.pack");
  });

  it("returns undefined for a path no vanilla pack has", () => {
    expect(findVanillaPackContaining(index, "variantmeshes\\nope.variantmeshdefinition")).toBeUndefined();
  });

  it("lists a folder without being told which pack holds it", () => {
    const found = collectVanillaFilesUnderPrefix(index, "variantmeshes\\variantmeshdefinitions\\");
    expect([...found.keys()].sort()).toEqual([
      "variantmeshes\\variantmeshdefinitions\\emp_state_troops_shields_set1.variantmeshdefinition",
      "variantmeshes\\variantmeshdefinitions\\shared.variantmeshdefinition",
    ]);
    expect(found.get("variantmeshes\\variantmeshdefinitions\\shared.variantmeshdefinition")).toBe("variants_bl.pack");
    // The sibling folder under variantmeshes\ must not be swept in by the prefix.
    expect(found.has("variantmeshes\\wh_variantmodels\\hu1\\emp\\emp_props\\shield.wsmodel")).toBe(false);
  });

  it("lists only immediate tree children and can omit DB paths", () => {
    const treeIndex = buildVanillaPackIndex(identity, [
      {
        packName: "data.pack",
        fileNames: [
          "db\\units_tables\\data__",
          "scripts\\campaign\\main.lua",
          "scripts\\campaign\\sub\\helpers.lua",
          "ui\\menu.png",
        ],
      },
    ]);

    expect(collectVanillaPackTreeChildren(treeIndex, "")).toEqual([
      { path: "db", isBranch: true },
      { path: "scripts", isBranch: true },
      { path: "ui", isBranch: true },
    ]);
    expect(collectVanillaPackTreeChildren(treeIndex, "scripts")).toEqual([
      { path: "scripts\\campaign", isBranch: true },
    ]);
    expect(collectVanillaPackTreeChildren(treeIndex, "scripts\\campaign")).toEqual([
      { path: "scripts\\campaign\\main.lua", isBranch: false },
      { path: "scripts\\campaign\\sub", isBranch: true },
    ]);
    expect(collectVanillaPackTreeChildren(treeIndex, "", (filePath) => !filePath.startsWith("db\\"))).toEqual([
      { path: "scripts", isBranch: true },
      { path: "ui", isBranch: true },
    ]);
  });

  it("pages a large flat folder without decoding its whole descendant range", () => {
    const pagedIndex = buildVanillaPackIndex(identity, [
      {
        packName: "data.pack",
        fileNames: [
          "audio\\wwise\\0001.wem",
          "audio\\wwise\\0002.wem",
          "audio\\wwise\\0003.wem",
          "audio\\wwise\\english\\0001.wem",
          "db\\main_units_tables\\data__",
        ],
      },
    ]);
    const includeFile = (filePath: string) => !filePath.startsWith("db\\");
    const includeBranch = (folderPath: string) => folderPath !== "db";

    expect(
      collectVanillaPackTreeChildrenPageFromFlat(pagedIndex, "audio\\wwise", 0, 2, includeFile, includeBranch),
    ).toEqual({
      children: [
        { path: "audio\\wwise\\0001.wem", isBranch: false },
        { path: "audio\\wwise\\0002.wem", isBranch: false },
      ],
      hasMore: true,
      nextOffset: 2,
    });
    expect(
      collectVanillaPackTreeChildrenPageFromFlat(pagedIndex, "audio\\wwise", 2, 2, includeFile, includeBranch),
    ).toEqual({
      children: [
        { path: "audio\\wwise\\0003.wem", isBranch: false },
        { path: "audio\\wwise\\english", isBranch: true },
      ],
      hasMore: false,
    });
  });

  it("searches file names and folders without returning every descendant of a matching folder", () => {
    const searchIndex = buildVanillaPackIndex(identity, [
      {
        packName: "data.pack",
        fileNames: [
          "audio\\wwise\\dragon.anim",
          "audio\\wwise\\english\\voice.wem",
          "db\\units_tables\\data__",
          "ui\\dragon_icon.png",
        ],
      },
    ]);

    expect(searchVanillaPackFileTree(searchIndex, "dragon", 10, (filePath) => !filePath.startsWith("db\\"))).toEqual({
      filePaths: ["audio\\wwise\\dragon.anim", "ui\\dragon_icon.png"],
      folderPaths: [],
      truncated: false,
    });
    expect(searchVanillaPackFileTree(searchIndex, "audio", 10, (filePath) => !filePath.startsWith("db\\"))).toEqual({
      filePaths: [],
      folderPaths: ["audio"],
      truncated: false,
    });
    expect(searchVanillaPackFileTree(searchIndex, "dragon", 1, (filePath) => !filePath.startsWith("db\\"))).toEqual({
      filePaths: ["audio\\wwise\\dragon.anim"],
      folderPaths: [],
      truncated: true,
    });
  });

  it("names the packs that win a file under a folder, in load order", () => {
    // data.pack has a file under variantmeshes\ but variants_bl.pack overrides it, so reading
    // data.pack for that folder would only produce a copy the game never loads.
    expect(findVanillaPacksUnderPrefix(index, "variantmeshes\\")).toEqual(["variants.pack", "variants_bl.pack"]);
    expect(findVanillaPacksUnderPrefix(index, "script\\")).toEqual(["data.pack"]);
    expect(findVanillaPacksUnderPrefix(index, "ui\\")).toEqual([]);
  });

  it("walks every path for a match sort order cannot narrow", () => {
    const found = collectVanillaFilesMatching(index, (path) => path.endsWith(".lua"));
    expect([...found.entries()]).toEqual([["script\\campaign\\mod\\shared.lua", "data.pack"]]);
  });

  it("survives a round trip through the encoded form", () => {
    const decoded = decodeVanillaPackIndex(encodeVanillaPackIndex(index));

    expect(decoded).toBeDefined();
    expect(decoded?.identity).toEqual(identity);
    expect(decoded?.packNames).toEqual(["data.pack", "variants.pack", "variants_bl.pack"]);
    expect(decoded?.block.count).toBe(index.block.count);
    expect(
      findVanillaPackContaining(
        decoded as NonNullable<typeof decoded>,
        "variantmeshes\\variantmeshdefinitions\\emp_state_troops_shields_set1.variantmeshdefinition",
      ),
    ).toBe("variants.pack");
  });

  it("rejects bytes that are not an index rather than throwing", () => {
    expect(decodeVanillaPackIndex(Buffer.alloc(0))).toBeUndefined();
    expect(decodeVanillaPackIndex(Buffer.from("not an index at all, really", "utf8"))).toBeUndefined();
    // Truncated after the header: the regions it promises are not there.
    expect(decodeVanillaPackIndex(encodeVanillaPackIndex(index).subarray(0, 40))).toBeUndefined();
  });

  it("goes stale when the manifest changes, and only then", () => {
    expect(isVanillaPackIndexCurrent(index, identity)).toBe(true);
    expect(isVanillaPackIndexCurrent(index, { ...identity, manifestMtimeMs: 1 })).toBe(false);
    expect(isVanillaPackIndexCurrent(index, { ...identity, manifestSize: 1 })).toBe(false);
    expect(isVanillaPackIndexCurrent(index, { ...identity, packCount: 2 })).toBe(false);
    expect(isVanillaPackIndexCurrent(index, { ...identity, dataFolder: "D:\\elsewhere" })).toBe(false);
  });

  it("normalizes slashes and case together", () => {
    expect(normalizeVanillaPackPath("UI/Units/Icons/Foo.png")).toBe("ui\\units\\icons\\foo.png");
  });

  it("handles an empty index without special casing at the call site", () => {
    const empty = buildVanillaPackIndex(identity, []);
    expect(findVanillaPackContaining(empty, "anything")).toBeUndefined();
    expect(collectVanillaFilesUnderPrefix(empty, "ui\\").size).toBe(0);
    expect(decodeVanillaPackIndex(encodeVanillaPackIndex(empty))?.packNames).toEqual([]);
  });
});
