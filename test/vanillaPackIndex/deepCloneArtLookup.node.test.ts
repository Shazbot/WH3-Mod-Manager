import { describe, expect, it } from "vitest";

import { buildVanillaPackIndex, collectVanillaFilesUnderPrefix } from "../../src/vanillaPackIndex/format";

/**
 * Deep Clone used to carry a hand-written folder -> vanilla pack table, because indexing all ~260
 * packs to find art was too slow. These are the folders that table declared, plus one it did not:
 * the index has to resolve all of them without being told.
 */
const index = buildVanillaPackIndex(
  {
    game: "wh3",
    dataFolder: "C:\\games\\wh3\\data",
    manifestSize: 1,
    manifestMtimeMs: 1,
    packCount: 3,
  },
  [
    { packName: "data.pack", fileNames: ["ui\\skins\\default.twui.xml"] },
    {
      packName: "ui.pack",
      fileNames: [
        "ui\\units\\icons\\emp_spearmen.png",
        "ui\\units\\mask\\emp_spearmen.png",
        "ui\\units\\minspec_portholes\\emp_spearmen.png",
        // A folder the old table never declared.
        "ui\\battle ui\\ability_icons\\spell.png",
      ],
    },
    {
      packName: "variants.pack",
      fileNames: ["variantmeshes\\variantmeshdefinitions\\emp_spearmen.variantmeshdefinition"],
    },
  ],
);

const packsFor = (folder: string) => [...new Set(collectVanillaFilesUnderPrefix(index, folder).values())];

describe("deep clone art lookup without a declared pack table", () => {
  it("resolves every folder the old table declared", () => {
    expect(packsFor("ui\\units\\icons\\")).toEqual(["ui.pack"]);
    expect(packsFor("ui\\units\\mask\\")).toEqual(["ui.pack"]);
    expect(packsFor("ui\\units\\minspec_portholes\\")).toEqual(["ui.pack"]);
    expect(packsFor("variantmeshes\\variantmeshdefinitions\\")).toEqual(["variants.pack"]);
  });

  it("resolves a folder the old table did not declare, which used to be a warning and a miss", () => {
    const found = collectVanillaFilesUnderPrefix(index, "ui\\battle ui\\ability_icons\\");
    expect([...found.keys()]).toEqual(["ui\\battle ui\\ability_icons\\spell.png"]);
    expect([...found.values()]).toEqual(["ui.pack"]);
  });

  it("keeps a folder's files apart from its siblings", () => {
    const icons = collectVanillaFilesUnderPrefix(index, "ui\\units\\icons\\");
    expect([...icons.keys()]).toEqual(["ui\\units\\icons\\emp_spearmen.png"]);
    // ui\units\mask\ and ui\units\minspec_portholes\ sort adjacent to it and must not leak in.
    expect(collectVanillaFilesUnderPrefix(index, "ui\\units\\").size).toBe(3);
  });

  it("finds nothing for a folder no vanilla pack has", () => {
    expect(collectVanillaFilesUnderPrefix(index, "ui\\units\\nonexistent\\").size).toBe(0);
  });
});
