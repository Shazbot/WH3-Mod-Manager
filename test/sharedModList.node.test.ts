import { describe, expect, it } from "vitest";

import { getMissingSharedWorkshopIds, parseSharedModList, serializeSharedModList } from "../src/sharedModList";

const createMod = (overrides: Partial<Mod>): Mod => ({
  name: "example.pack",
  humanName: "Example",
  path: "/mods/example.pack",
  imgPath: "",
  workshopId: "",
  isEnabled: true,
  modDirectory: "/mods",
  isInData: true,
  loadOrder: undefined,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  tags: [],
  reqModIdToName: [],
  ...overrides,
});

describe("shared mod lists", () => {
  it("exports and imports both Workshop and data-folder mods", () => {
    const sharedList = serializeSharedModList([
      createMod({
        name: "workshop.pack",
        workshopId: "123456",
        isInData: false,
        sourceKind: "workshop",
        loadOrder: 0,
      }),
      createMod({ name: "local balance;v2.pack", loadOrder: 1 }),
      createMod({ name: "disabled.pack", isEnabled: false }),
    ]);

    expect(sharedList).toBe("123456;0|local:local%20balance%3Bv2.pack;1");
    expect(parseSharedModList(sharedList)).toEqual([
      { workshopId: "123456", loadOrder: 0 },
      { workshopId: "", modName: "local balance;v2.pack", loadOrder: 1 },
    ]);
  });

  it("continues to parse legacy Workshop-only lists", () => {
    expect(parseSharedModList("123|456;2")).toEqual([
      { workshopId: "123", loadOrder: undefined },
      { workshopId: "456", loadOrder: 2 },
    ]);
  });

  it("includes a Workshop fallback for an active data-folder copy", () => {
    const dataCopy = createMod({ name: "shared.pack", loadOrder: 0 });
    const workshopCopy = createMod({
      name: "shared.pack",
      workshopId: "987654",
      isEnabled: false,
      isInData: false,
      sourceKind: "workshop",
    });

    const sharedList = serializeSharedModList([dataCopy], [dataCopy, workshopCopy]);

    expect(sharedList).toBe("local:shared.pack:987654;0");
    expect(parseSharedModList(sharedList)).toEqual([{ workshopId: "987654", modName: "shared.pack", loadOrder: 0 }]);
  });

  it("still requests the Workshop fallback when only the local copy is installed", () => {
    const localCopy = createMod({ name: "shared.pack" });
    const sharedMods = [{ workshopId: "987654", modName: localCopy.name, loadOrder: 0 }];

    expect(getMissingSharedWorkshopIds(sharedMods, [localCopy])).toEqual(["987654"]);

    const workshopCopy = createMod({
      name: localCopy.name,
      workshopId: "987654",
      isInData: false,
      sourceKind: "workshop",
    });
    expect(getMissingSharedWorkshopIds(sharedMods, [localCopy, workshopCopy])).toEqual([]);
  });
});
