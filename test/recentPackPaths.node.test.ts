import { describe, expect, it } from "vitest";

import {
  addRecentPackPath,
  getVisibleRecentPackCount,
  MAX_RECENT_PACKS,
  sanitizeRecentPackPaths,
} from "../src/utility/recentPackPaths";

describe("recent pack paths", () => {
  it("keeps the newest twenty physical non-vanilla packs", () => {
    const paths = Array.from({ length: 21 }, (_, index) => `/mods/pack-${index}.pack`);

    expect(addRecentPackPath(paths.slice(0, 20), "/mods/pack-20.pack", ["db.pack"])).toEqual([
      "/mods/pack-20.pack",
      ...paths.slice(0, 19),
    ]);
    expect(addRecentPackPath(undefined, "C:\\game\\data\\db.pack", ["db.pack"])).toEqual([]);
    expect(addRecentPackPath(undefined, "memory://new-pack", ["db.pack"])).toEqual([]);
    expect(MAX_RECENT_PACKS).toBe(20);
  });

  it("deduplicates paths without caring about slash direction or case", () => {
    expect(addRecentPackPath(["C:\\Mods\\Example.pack", "C:\\mods\\other.pack"], "c:/mods/example.pack")).toEqual([
      "c:/mods/example.pack",
      "C:\\mods\\other.pack",
    ]);
  });

  it("sanitizes malformed persisted entries", () => {
    expect(
      sanitizeRecentPackPaths(
        ["", null, " memory://draft", "/mods/data.pack", "/mods/valid.pack", "/mods/VALID.PACK"],
        ["data.pack"],
      ),
    ).toEqual(["/mods/valid.pack"]);
  });

  it("limits the visible rows to the height available below the menu", () => {
    expect(getVisibleRecentPackCount(800, 36)).toBe(20);
    expect(getVisibleRecentPackCount(100, 36)).toBe(2);
    expect(getVisibleRecentPackCount(20, 36)).toBe(0);
  });
});
