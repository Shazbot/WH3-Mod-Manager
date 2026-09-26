import { describe, expect, it } from "vitest";

import {
  buildPackPriority,
  getPackPriority,
  resolveFileSourcePacks,
  sortPacksByAscendingPriority,
} from "../../src/nodeGraph/packPriority";

const DB_PACK = "C:\\game\\data\\db.pack";
const FIRST_MOD = "C:\\game\\data\\first_mod.pack";
const SECOND_MOD = "C:\\game\\data\\second_mod.pack";
const THIRD_MOD = "C:\\game\\data\\third_mod.pack";

// As written to used_mods.txt: lowest priority first, so third_mod overrides the two before it.
const loadOrder = [FIRST_MOD, SECOND_MOD, THIRD_MOD];
const priority = buildPackPriority(loadOrder);

describe("getPackPriority", () => {
  it("ranks a mod by its place in the load order", () => {
    expect(getPackPriority(THIRD_MOD, priority)).toBeGreaterThan(getPackPriority(FIRST_MOD, priority));
  });

  it("puts a vanilla pack below every mod, because any mod overrides it", () => {
    expect(getPackPriority(DB_PACK, priority)).toBeLessThan(getPackPriority(FIRST_MOD, priority));
  });
});

describe("resolveFileSourcePacks", () => {
  it("reads a shared file from the pack the game would load it from", () => {
    const resolved = resolveFileSourcePacks(
      [
        { packPath: FIRST_MOD, fileNames: ["script\\shared.lua", "script\\only_first.lua"] },
        { packPath: THIRD_MOD, fileNames: ["script\\shared.lua"] },
      ],
      priority,
    );

    expect(resolved.get("script\\shared.lua")).toBe(THIRD_MOD);
    // A file only one pack has still comes from that pack.
    expect(resolved.get("script\\only_first.lua")).toBe(FIRST_MOD);
  });

  it("does not let input order decide the winner", () => {
    const highFirst = resolveFileSourcePacks(
      [
        { packPath: THIRD_MOD, fileNames: ["script\\shared.lua"] },
        { packPath: FIRST_MOD, fileNames: ["script\\shared.lua"] },
      ],
      priority,
    );

    expect(highFirst.get("script\\shared.lua")).toBe(THIRD_MOD);
  });

  it("prefers any mod over the vanilla pack that also carries the file", () => {
    const resolved = resolveFileSourcePacks(
      [
        { packPath: FIRST_MOD, fileNames: ["ui\\shared.twui.xml"] },
        { packPath: DB_PACK, fileNames: ["ui\\shared.twui.xml"] },
      ],
      priority,
    );

    expect(resolved.get("ui\\shared.twui.xml")).toBe(FIRST_MOD);
  });

  it("falls back to the first listed when neither pack is in the load order", () => {
    const resolved = resolveFileSourcePacks(
      [
        { packPath: "C:\\game\\data\\ui.pack", fileNames: ["ui\\shared.twui.xml"] },
        { packPath: DB_PACK, fileNames: ["ui\\shared.twui.xml"] },
      ],
      priority,
    );

    expect(resolved.get("ui\\shared.twui.xml")).toBe("C:\\game\\data\\ui.pack");
  });
});

describe("sortPacksByAscendingPriority", () => {
  const pathOf = (pack: { path: string }) => pack.path;

  it("puts the highest-priority pack last, so writing in order leaves it holding the field", () => {
    const sorted = sortPacksByAscendingPriority(
      [{ path: THIRD_MOD }, { path: DB_PACK }, { path: FIRST_MOD }],
      pathOf,
      priority,
    );

    expect(sorted.map(pathOf)).toEqual([DB_PACK, FIRST_MOD, THIRD_MOD]);
  });

  it("keeps equally ranked packs in the order they came in", () => {
    const unranked = [{ path: "C:\\a.pack" }, { path: "C:\\b.pack" }, { path: "C:\\c.pack" }];

    expect(sortPacksByAscendingPriority(unranked, pathOf, priority).map(pathOf)).toEqual([
      "C:\\a.pack",
      "C:\\b.pack",
      "C:\\c.pack",
    ]);
  });
});
