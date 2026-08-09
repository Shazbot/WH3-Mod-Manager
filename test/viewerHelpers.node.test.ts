import { describe, expect, it } from "vitest";

import {
  getDefaultSaveAsPackName,
  getPackFileInventory,
  pickWidestValue,
} from "../src/components/viewer/viewerHelpers";

describe("viewer pack inventory", () => {
  it("recognizes a genuinely empty pack", () => {
    expect(getPackFileInventory({ tables: [], packedFiles: {} }, [])).toEqual({
      isEmpty: true,
      hasDBTables: false,
      hasFiles: false,
    });
  });

  it("recognizes a pack containing only files", () => {
    expect(
      getPackFileInventory(
        {
          tables: ["variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition"],
          packedFiles: {},
        },
        [],
      ),
    ).toEqual({
      isEmpty: false,
      hasDBTables: false,
      hasFiles: true,
    });
  });

  it("includes loaded and unsaved files that are not in the pack table list", () => {
    expect(
      getPackFileInventory(
        {
          tables: [],
          packedFiles: { "db\\units_tables\\data__": {} as PackedFile },
        },
        [{ name: "script\\campaign\\mod.lua" }],
      ),
    ).toEqual({
      isEmpty: false,
      hasDBTables: true,
      hasFiles: true,
    });
  });
});

describe("default Save As pack name", () => {
  it("uses the open pack's own name, without the extension", () => {
    expect(getDefaultSaveAsPackName("K:\\SteamLibrary\\...\\data\\my_mod.pack")).toBe("my_mod");
  });

  it("uses the name a memory pack carries in its path", () => {
    expect(getDefaultSaveAsPackName("memory://new_mod_pack")).toBe("new_mod_pack");
  });

  it("handles a forward-slash path, which getPackNameFromPath does not match", () => {
    expect(getDefaultSaveAsPackName("/home/user/mods/my_mod.pack")).toBe("my_mod");
  });

  it("keeps a name that is not a .pack file intact", () => {
    expect(getDefaultSaveAsPackName("C:\\mods\\something_else")).toBe("something_else");
  });

  it("strips the extension whatever its case", () => {
    expect(getDefaultSaveAsPackName("C:\\mods\\My_Mod.PACK")).toBe("My_Mod");
  });
});

describe("widest column value", () => {
  // A stand-in for a proportional font: "W" is wide, "l" is narrow, everything else is average.
  const measure = (text: string) =>
    [...text].reduce((width, char) => width + (char === "W" ? 20 : char === "l" ? 4 : 10), 0);
  const MAX_GLYPH = 20;

  const widestOf = (values: string[]) =>
    values.reduce((widest, value) => pickWidestValue(widest, value, measure, MAX_GLYPH), {
      value: "",
      width: 0,
    });

  it("prefers a shorter value that renders wider, which sizing by length gets wrong", () => {
    // "lllllllll" is longer by character count; "WWWW" is what actually has to fit.
    expect(widestOf(["lllllllll", "WWWW"])).toEqual({ value: "WWWW", width: 80 });
  });

  it("keeps the widest whatever order the values arrive in", () => {
    expect(widestOf(["WWWW", "lllllllll"]).value).toBe("WWWW");
  });

  it("reports the width of the value it chose", () => {
    expect(widestOf(["abc"])).toEqual({ value: "abc", width: 30 });
  });

  it("skips measuring values too short to possibly win", () => {
    const measured: string[] = [];
    const countingMeasure = (text: string) => {
      measured.push(text);
      return measure(text);
    };

    // Ten glyphs at the 20px bound is 200px, under the incumbent's 400, so it cannot win.
    const current = { value: "WWWWWWWWWWWWWWWWWWWW", width: 400 };
    expect(pickWidestValue(current, "aaaaaaaaaa", countingMeasure, MAX_GLYPH)).toBe(current);
    expect(measured).toEqual([]);
  });

  it("still measures a value the bound cannot rule out", () => {
    const measured: string[] = [];
    const countingMeasure = (text: string) => {
      measured.push(text);
      return measure(text);
    };

    pickWidestValue({ value: "aa", width: 20 }, "WW", countingMeasure, MAX_GLYPH);
    expect(measured).toEqual(["WW"]);
  });
});
