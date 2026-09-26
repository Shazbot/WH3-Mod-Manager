import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appReducer, { applySavedPackData, removePackData, requestOpenPackTab } from "../src/appSlice";
import initialState from "../src/initialAppState";
import type { PackedFile } from "../src/packFileTypes";

const file = (name: string): PackedFile => ({ name, file_size: 1, start_pos: -1 });

beforeEach(() => vi.stubGlobal("window", { location: { pathname: "/test" } }));
afterEach(() => vi.unstubAllGlobals());

describe("viewer pack tabs", () => {
  it("increments the open nonce when the same pack is requested again", () => {
    const first = appReducer(initialState, requestOpenPackTab("/mods/example.pack"));
    const second = appReducer(first, requestOpenPackTab("/mods/example.pack"));

    expect(first.packOpenRequest).toEqual({ packPath: "/mods/example.pack", nonce: 1 });
    expect(second.packOpenRequest).toEqual({ packPath: "/mods/example.pack", nonce: 2 });
  });

  it("purges only the closed pack and matching singular selections", () => {
    const closedPackPath = "/mods/closed.pack";
    const remainingPackPath = "/mods/remaining.pack";
    const state = {
      ...initialState,
      packsData: {
        [closedPackPath]: { packName: "closed", packPath: closedPackPath, tables: [], packedFiles: {} },
        [remainingPackPath]: { packName: "remaining", packPath: remainingPackPath, tables: [], packedFiles: {} },
      },
      unsavedPacksData: {
        [closedPackPath]: [file("db\\closed\\data__")],
        [remainingPackPath]: [file("db\\remaining\\data__")],
      },
      currentDBTableSelection: { packPath: closedPackPath, dbName: "closed", dbSubname: "data__" },
      currentFlowFileSelection: "whmmflows\\closed.json",
      currentFlowFilePackPath: closedPackPath,
      packOpenRequest: { packPath: closedPackPath, nonce: 3 },
    };

    const next = appReducer(state, removePackData(closedPackPath));

    expect(next.packsData[closedPackPath]).toBeUndefined();
    expect(next.unsavedPacksData[closedPackPath]).toBeUndefined();
    expect(next.packsData[remainingPackPath]).toBeDefined();
    expect(next.unsavedPacksData[remainingPackPath]).toHaveLength(1);
    expect(next.currentDBTableSelection).toBeUndefined();
    expect(next.currentFlowFileSelection).toBeUndefined();
    expect(next.currentFlowFilePackPath).toBeUndefined();
    expect(next.packOpenRequest).toBeUndefined();
  });

  it("leaves selections for other packs alone and no-ops for unknown packs", () => {
    const selectedPackPath = "/mods/selected.pack";
    const otherPackPath = "/mods/other.pack";
    const state = {
      ...initialState,
      packsData: {
        [selectedPackPath]: { packName: "selected", packPath: selectedPackPath, tables: [], packedFiles: {} },
        [otherPackPath]: { packName: "other", packPath: otherPackPath, tables: [], packedFiles: {} },
      },
      unsavedPacksData: { [selectedPackPath]: [file("flow.json")] },
      currentDBTableSelection: { packPath: selectedPackPath, dbName: "selected", dbSubname: "data__" },
      currentFlowFileSelection: "other.json",
      currentFlowFilePackPath: otherPackPath,
    };

    const afterUnknown = appReducer(state, removePackData("/mods/missing.pack"));
    const afterOther = appReducer(afterUnknown, removePackData(otherPackPath));

    expect(afterUnknown).toEqual(state);
    expect(afterOther.packsData[selectedPackPath]).toBeDefined();
    expect(afterOther.unsavedPacksData[selectedPackPath]).toHaveLength(1);
    expect(afterOther.currentDBTableSelection?.packPath).toBe(selectedPackPath);
    expect(afterOther.currentFlowFileSelection).toBeUndefined();
    expect(afterOther.currentFlowFilePackPath).toBeUndefined();
  });

  it("promotes saved files into the pack cache and removes deleted files and staging", () => {
    const packPath = "/mods/saved.pack";
    const oldPath = "db\\units_tables\\old";
    const changedPath = "db\\units_tables\\changed";
    const state = {
      ...initialState,
      packsData: {
        [packPath]: {
          packName: "saved.pack",
          packPath,
          tables: [oldPath, changedPath],
          packedFiles: {
            [oldPath]: file(oldPath),
            [changedPath]: file(changedPath),
          },
        },
      },
      unsavedPacksData: { [packPath]: [file(changedPath)] },
      deletedPackFilePaths: { [packPath]: [oldPath] },
    };

    const next = appReducer(
      state,
      applySavedPackData({
        packPath,
        savedFileData: [{ ...file(changedPath), text: "new contents" }],
        deletedFilePaths: [oldPath],
      }),
    );

    expect(next.packsData[packPath].tables).toEqual([changedPath]);
    expect(next.packsData[packPath].packedFiles[oldPath]).toBeUndefined();
    expect(next.packsData[packPath].packedFiles[changedPath]?.text).toBe("new contents");
    expect(next.unsavedPacksData[packPath]).toBeUndefined();
    expect(next.deletedPackFilePaths[packPath]).toBeUndefined();
  });
});
