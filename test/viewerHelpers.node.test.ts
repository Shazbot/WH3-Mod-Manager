import { describe, expect, it } from "vitest";

import { getPackFileInventory } from "../src/components/viewer/viewerHelpers";

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
