import { describe, expect, it } from "vitest";

import * as nodePath from "path";

import { selectPacksToCheck } from "../src/modCompat/compatScope";

/** Built with the platform's own separator, so path comparison is exercised rather than string equality. */
const modPath = (...parts: string[]) => nodePath.join("mods", ...parts);
const gamePath = (...parts: string[]) => nodePath.join("game", "data", ...parts);
const pack = (path: string) => ({ path, name: nodePath.basename(path) });

describe("packs a compat check should look at", () => {
  it("keeps only the packs that were asked about", () => {
    const loaded = [pack(modPath("a.pack")), pack(modPath("b.pack")), pack(modPath("c.pack"))];

    const selected = selectPacksToCheck(loaded, [modPath("a.pack"), modPath("c.pack")]);

    expect(selected.map((entry) => entry.name)).toEqual(["a.pack", "c.pack"]);
  });

  it("leaves out a pack that is merely loaded", () => {
    // The bug this fixes: a mod browsed in the viewer, or enabled and later disabled, stays in
    // appData.packsData and was being reported as conflicting with mods the user had selected.
    const loaded = [pack(modPath("enabled.pack")), pack(modPath("browsed-earlier.pack"))];

    const selected = selectPacksToCheck(loaded, [modPath("enabled.pack")]);

    expect(selected.map((entry) => entry.name)).toEqual(["enabled.pack"]);
  });

  it("keeps vanilla packs, which reference resolution needs", () => {
    // Without vanilla keys, every mod reference to a base game row reads as missing.
    const loaded = [pack(gamePath("db.pack")), pack(modPath("a.pack"))];

    const selected = selectPacksToCheck(loaded, [modPath("a.pack"), gamePath("db.pack")]);

    expect(selected).toHaveLength(2);
  });

  it("matches paths that differ only in separators or traversal", () => {
    const loaded = [pack(modPath("a.pack"))];

    expect(selectPacksToCheck(loaded, [modPath("sub", "..", "a.pack")])).toHaveLength(1);
  });

  it("ignores a requested pack that was never loaded", () => {
    // A pack that failed to read simply is not checked, as before.
    const selected = selectPacksToCheck([pack(modPath("a.pack"))], [
      modPath("a.pack"),
      modPath("never-read.pack"),
    ]);

    expect(selected).toHaveLength(1);
  });

  it("keeps the loaded order, so progress reporting stays stable", () => {
    const loaded = [pack(modPath("b.pack")), pack(modPath("a.pack"))];

    expect(
      selectPacksToCheck(loaded, [modPath("a.pack"), modPath("b.pack")]).map((e) => e.name),
    ).toEqual(["b.pack", "a.pack"]);
  });

  it("checks nothing when nothing was asked about", () => {
    expect(selectPacksToCheck([pack(modPath("a.pack"))], [])).toEqual([]);
  });
});
