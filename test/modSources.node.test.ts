import { describe, expect, it } from "vitest";

import {
  DATA_MOD_SOURCE_ID,
  getWorkshopModSyncItems,
  insertCustomSourceAfterData,
  normalizeModSourceOrder,
  resolveModsBySourcePriority,
  WORKSHOP_MOD_SOURCE_ID,
} from "../src/modSources";

const createMod = (overrides: Partial<Mod>): Mod => ({
  humanName: "",
  name: "example.pack",
  path: "/mods/example.pack",
  imgPath: "",
  workshopId: "example.pack",
  isEnabled: false,
  modDirectory: "/mods",
  isInData: false,
  loadOrder: undefined,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  tags: ["mod"],
  ...overrides,
});

describe("mod source priority", () => {
  it("preserves Data before Workshop for existing configurations", () => {
    expect(normalizeModSourceOrder({}, false)).toEqual([DATA_MOD_SOURCE_ID, WORKSHOP_MOD_SOURCE_ID]);
    expect(
      normalizeModSourceOrder({ modSourceOrder: [WORKSHOP_MOD_SOURCE_ID, DATA_MOD_SOURCE_ID] }, false),
    ).toEqual([DATA_MOD_SOURCE_ID, WORKSHOP_MOD_SOURCE_ID]);
  });

  it("allows built-in source reordering with modder features", () => {
    expect(
      normalizeModSourceOrder({ modSourceOrder: [WORKSHOP_MOD_SOURCE_ID, DATA_MOD_SOURCE_ID] }, true),
    ).toEqual([WORKSHOP_MOD_SOURCE_ID, DATA_MOD_SOURCE_ID]);
  });

  it("keeps custom positions while restoring built-in order for non-modders", () => {
    expect(
      normalizeModSourceOrder(
        {
          customModFolders: [{ id: "custom-1", path: "/custom" }],
          modSourceOrder: [WORKSHOP_MOD_SOURCE_ID, "custom-1", DATA_MOD_SOURCE_ID],
        },
        false,
      ),
    ).toEqual([DATA_MOD_SOURCE_ID, "custom-1", WORKSHOP_MOD_SOURCE_ID]);
  });

  it("inserts ordinary custom folders immediately after Data", () => {
    expect(insertCustomSourceAfterData([DATA_MOD_SOURCE_ID, WORKSHOP_MOD_SOURCE_ID], "custom-1")).toEqual([
      DATA_MOD_SOURCE_ID,
      "custom-1",
      WORKSHOP_MOD_SOURCE_ID,
    ]);
  });

  it("gives a new custom folder priority below Data and above every existing source", () => {
    expect(
      insertCustomSourceAfterData(
        ["custom-old", WORKSHOP_MOD_SOURCE_ID, DATA_MOD_SOURCE_ID],
        "custom-new",
      ),
    ).toEqual([
      DATA_MOD_SOURCE_ID,
      "custom-new",
      "custom-old",
      WORKSHOP_MOD_SOURCE_ID,
    ]);
  });

  it("resolves duplicate names using configured priority", () => {
    const dataMod = createMod({
      path: "/game/data/example.pack",
      isInData: true,
      sourceId: DATA_MOD_SOURCE_ID,
      sourceKind: "data",
    });
    const customMod = createMod({
      path: "/custom/example.pack",
      sourceId: "custom-1",
      sourceKind: "custom",
    });

    expect(
      resolveModsBySourcePriority(
        [dataMod, customMod],
        {
          customModFolders: [{ id: "custom-1", path: "/custom" }],
          modSourceOrder: ["custom-1", DATA_MOD_SOURCE_ID, WORKSHOP_MOD_SOURCE_ID],
        },
        false,
      ),
    ).toEqual([customMod]);
  });

  it("treats Modding as Data priority but lets it win within Data", () => {
    const dataMod = createMod({
      path: "/game/data/example.pack",
      isInData: true,
      sourceId: DATA_MOD_SOURCE_ID,
      sourceKind: "data",
    });
    const moddingMod = createMod({
      path: "/game/data/modding/example.pack",
      isInData: true,
      isInModding: true,
      sourceId: DATA_MOD_SOURCE_ID,
      sourceKind: "data",
    });

    expect(resolveModsBySourcePriority([dataMod, moddingMod], {}, false)).toEqual([moddingMod]);
  });

  it("syncs newer Workshop copies already in a custom folder", () => {
    const workshopMod = createMod({
      path: "/workshop/123/example.pack",
      sourceId: WORKSHOP_MOD_SOURCE_ID,
      sourceKind: "workshop",
      lastChangedLocal: 200,
    });
    const customMod = createMod({
      path: "/custom/nested/example.pack",
      sourceId: "custom-1",
      sourceKind: "custom",
      lastChangedLocal: 100,
    });

    expect(getWorkshopModSyncItems([customMod, workshopMod], "custom-1", [])).toEqual([
      { workshopMod, customMod },
    ]);
  });

  it("does not overwrite an up-to-date or newer custom copy", () => {
    const workshopMod = createMod({
      sourceId: WORKSHOP_MOD_SOURCE_ID,
      sourceKind: "workshop",
      lastChangedLocal: 100,
    });
    const customMod = createMod({
      sourceId: "custom-1",
      sourceKind: "custom",
      lastChangedLocal: 200,
    });

    expect(getWorkshopModSyncItems([workshopMod, customMod], "custom-1", [])).toEqual([]);
  });

  it("adds newly enabled Workshop mods that are absent from the custom folder", () => {
    const workshopMod = createMod({
      name: "new.pack",
      sourceId: WORKSHOP_MOD_SOURCE_ID,
      sourceKind: "workshop",
    });

    expect(getWorkshopModSyncItems([workshopMod], "custom-1", ["new.pack"])).toEqual([
      { workshopMod },
    ]);
    expect(getWorkshopModSyncItems([workshopMod], "custom-1", [])).toEqual([]);
  });
});
