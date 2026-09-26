import { describe, expect, it } from "vitest";

import appReducer, { setRecentPackPaths } from "../src/appSlice";
import initialState from "../src/initialAppState";

describe("recent viewer packs in app state", () => {
  it("accepts the synchronized list after applying the safety filters", () => {
    const next = appReducer(
      initialState,
      setRecentPackPaths(["/mods/first.pack", "/mods/db.pack", "/mods/second.pack", "/mods/FIRST.PACK"]),
    );

    expect(next.recentPackPaths).toEqual(["/mods/first.pack", "/mods/second.pack"]);
  });
});
