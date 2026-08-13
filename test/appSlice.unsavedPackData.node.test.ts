import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appReducer, { setUnsavedPacksData } from "../src/appSlice";
import initialState from "../src/initialAppState";
import type { PackedFile } from "../src/packFileTypes";

const file = (name: string): PackedFile => ({ name, file_size: 1, start_pos: -1 });

beforeEach(() => vi.stubGlobal("window", { location: { pathname: "/test" } }));
afterEach(() => vi.unstubAllGlobals());

describe("authoritative unsaved pack data updates", () => {
  it("replaces the previous list so files saved to disk do not remain as stale overrides", () => {
    const packPath = "/mods/mod.pack";
    const previousState = {
      ...initialState,
      unsavedPacksData: { [packPath]: [file("whmmflows\\old.json"), file("db\\a\\b")] },
    };

    const nextState = appReducer(previousState, setUnsavedPacksData({ packPath, unsavedFileData: [file("db\\a\\b")] }));

    expect(nextState.unsavedPacksData[packPath].map((packedFile) => packedFile.name)).toEqual(["db\\a\\b"]);
  });

  it("removes the pack entry when the backend reports no unsaved files", () => {
    const packPath = "/mods/mod.pack";
    const previousState = {
      ...initialState,
      unsavedPacksData: { [packPath]: [file("whmmflows\\old.json")] },
    };

    const nextState = appReducer(previousState, setUnsavedPacksData({ packPath, unsavedFileData: [] }));

    expect(nextState.unsavedPacksData[packPath]).toBeUndefined();
  });
});
