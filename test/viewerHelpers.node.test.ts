import { describe, expect, it } from "vitest";

import { getDefaultSaveAsPackName, getPackFileInventory } from "../src/components/viewer/viewerHelpers";

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
