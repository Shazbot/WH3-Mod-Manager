import { describe, expect, it } from "vitest";

import {
  buildKeyPrefixDisplay,
  getPercentileWidth,
  getDefaultSaveAsPackName,
  getPackFileInventory,
  getPreferredTreeTab,
  hasLoadedDBTable,
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

describe("preferred tree tab", () => {
  it("uses the active file tab for each pack independently", () => {
    const packA = "/mods/a.pack";
    const packB = "/mods/b.pack";

    expect(
      getPreferredTreeTab(
        { packPath: packA, openTabs: [{ id: "a-flow", kind: "flow" }], activeTabId: "a-flow" },
        {
          [packA]: { packName: "a", packPath: packA, tables: ["db\\units_tables\\data__"], packedFiles: {} },
          [packB]: { packName: "b", packPath: packB, tables: ["file.txt"], packedFiles: {} },
        },
        {},
      ),
    ).toBe("files");
    expect(
      getPreferredTreeTab(
        { packPath: packB, openTabs: [], activeTabId: null },
        {
          [packA]: { packName: "a", packPath: packA, tables: ["db\\units_tables\\data__"], packedFiles: {} },
          [packB]: { packName: "b", packPath: packB, tables: ["file.txt"], packedFiles: {} },
        },
        {},
      ),
    ).toBe("files");
  });
});

describe("loaded DB table detection", () => {
  const selection: DBTableSelection = {
    packPath: "K:\\game\\data\\db.pack",
    dbName: "units_tables",
    dbSubname: "data__",
  };
  const loaded = {
    name: "db\\units_tables\\data__",
    schemaFields: [],
    tableSchema: { version: 1, fields: [] },
  } as PackedFile;

  it("accepts a parsed table already held by the renderer, including an empty table", () => {
    expect(hasLoadedDBTable({ packedFiles: { [loaded.name]: loaded } }, [], selection)).toBe(true);
  });

  it("accepts unsaved data before the disk-backed copy", () => {
    expect(hasLoadedDBTable(undefined, [loaded], selection)).toBe(true);
  });

  it("does not mistake an index-only descriptor for loaded rows", () => {
    const indexed = { name: loaded.name, schemaFields: [] } as PackedFile;
    expect(hasLoadedDBTable({ packedFiles: { [indexed.name]: indexed } }, [], selection)).toBe(false);
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

describe("percentile column width", () => {
  it("sizes to the target percentile instead of one long outlier", () => {
    const widths = [...Array.from({ length: 19 }, (_, index) => 120 + index), 600];

    expect(getPercentileWidth(widths, 0.95, 110, 280)).toBe(138);
  });

  it("clamps a percentile above the content budget", () => {
    expect(getPercentileWidth([120, 140, 300, 500], 0.95, 110, 280)).toBe(280);
  });

  it("preserves the minimum for narrow or empty input", () => {
    expect(getPercentileWidth([20, 40], 0.95, 110, 280)).toBe(110);
    expect(getPercentileWidth([], 0.95, 110, 280)).toBe(110);
  });
});

describe("repeated key prefix", () => {
  const display = (values: string[]) => {
    const built = buildKeyPrefixDisplay(values);
    return values.map((value) => built.shortened.get(value) ?? value);
  };

  it("hides the game and release segments a table repeats", () => {
    const values = [
      "wh3_dlc27_chs_inf_chaos_warriors_0",
      "wh3_dlc27_chs_mon_chaos_spawn",
      "wh3_dlc27_kho_inf_bloodletters",
      "wh2_dlc09_tmb_cav_hexwraiths",
      "wh2_dlc09_tmb_inf_skeleton_warriors",
      "wh2_dlc09_skv_inf_clanrats",
      "wh_main_emp_inf_spearmen",
      "wh_main_emp_cav_knights",
      "wh_main_vmp_inf_zombies",
    ];

    expect(buildKeyPrefixDisplay(values).depth).toBe(2);
    expect(display(values)).toEqual([
      "chs_inf_chaos_warriors_0",
      "chs_mon_chaos_spawn",
      "kho_inf_bloodletters",
      "tmb_cav_hexwraiths",
      "tmb_inf_skeleton_warriors",
      "skv_inf_clanrats",
      "emp_inf_spearmen",
      "emp_cav_knights",
      "vmp_inf_zombies",
    ]);
  });

  it("takes the depth from the data rather than assuming two segments", () => {
    // The skill node table repeats four segments, not two.
    const values = [
      "wh3_dlc24_skill_node_ksl_hag_witch_magic",
      "wh3_dlc24_skill_node_cth_dragon_melee",
      "wh3_dlc24_skill_node_kho_bloodthirster_rage",
      "wh3_dlc24_skill_node_nur_plague_lore",
      "wh3_dlc24_skill_node_tze_horror_winds",
      "wh3_dlc24_skill_node_sla_seeker_speed",
    ];

    expect(buildKeyPrefixDisplay(values).depth).toBe(4);
    expect(display(values)).toEqual([
      "ksl_hag_witch_magic",
      "cth_dragon_melee",
      "kho_bloodthirster_rage",
      "nur_plague_lore",
      "tze_horror_winds",
      "sla_seeker_speed",
    ]);
  });

  it("leaves a row its full key when shortening would make it read the same as another", () => {
    // The same unit re-added in a later release: the release is all that tells the two apart, so
    // neither may lose it, while the rows around them still can.
    const values = [
      "wh3_dlc27_chs_inf_chaos_warriors_0",
      "wh_main_chs_inf_chaos_warriors_0",
      "wh3_dlc27_chs_mon_chaos_spawn",
      "wh3_dlc27_kho_inf_bloodletters",
      "wh3_dlc27_nur_inf_plaguebearers",
      "wh3_dlc27_tze_inf_pink_horrors",
      "wh3_dlc27_sla_inf_daemonettes",
      "wh_main_emp_inf_spearmen",
      "wh_main_emp_cav_knights",
      "wh_main_vmp_inf_zombies",
    ];

    const shown = display(values);
    expect(shown[0]).toBe("wh3_dlc27_chs_inf_chaos_warriors_0");
    expect(shown[1]).toBe("wh_main_chs_inf_chaos_warriors_0");
    expect(shown[2]).toBe("chs_mon_chaos_spawn");
    // Whatever is shown still identifies its row.
    expect(new Set(shown).size).toBe(values.length);
  });

  it("leaves a row alone when its leading segments are its own rather than the table's", () => {
    const values = [
      "wh3_dlc27_inf_spearmen",
      "wh3_dlc27_cav_knights",
      "wh3_dlc27_mon_dragon",
      "inf_spearmen_extra_long",
    ];

    // Only "wh3_dlc27_" repeats. The last row's own head is not boilerplate, so it is not cut off -
    // which also keeps it from colliding with what the first row now shows.
    expect(display(values)).toEqual(["inf_spearmen", "cav_knights", "mon_dragon", "inf_spearmen_extra_long"]);
  });

  it("shortens nothing when the keys share no prefix", () => {
    const values = ["277629906", "277629907", "412330012"];

    expect(buildKeyPrefixDisplay(values)).toMatchObject({ depth: 0 });
    expect(display(values)).toEqual(values);
  });

  it("refuses to strip a key down to a fragment", () => {
    // Every value would still be unique at depth 3, but "1" and "2" are not worth reading.
    const values = ["wh3_dlc27_chs_1", "wh3_dlc27_chs_2", "wh3_dlc27_chs_3", "wh3_dlc27_chs_4"];

    expect(buildKeyPrefixDisplay(values).depth).toBe(2);
    expect(display(values)).toEqual(["chs_1", "chs_2", "chs_3", "chs_4"]);
  });

  it("handles an empty column", () => {
    expect(buildKeyPrefixDisplay([])).toMatchObject({ depth: 0 });
  });
});
