import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as nodePath from "path";
import * as os from "os";

import {
  closeVanillaLocCaches,
  getVanillaLocCacheIdentity,
  openOrBuildVanillaLocCache,
} from "../../src/vanillaLocCache/store";

const makeWorkspace = () => {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "whmm-loc-cache-"));
  const packPath = nodePath.join(root, "local_en.pack");
  fs.writeFileSync(packPath, "vanilla locs");
  return { userDataPath: root, packPath };
};

afterEach(() => closeVanillaLocCaches());

describe("vanilla loc cache store", () => {
  it("builds once, then serves later sessions from the file without re-reading the packs", async () => {
    const { userDataPath, packPath } = makeWorkspace();
    const readEntries = vi.fn(() => [["land_units_onscreen_name_alpha", "Alpha"] as const]);
    const request = { userDataPath, game: "wh3", packPaths: [packPath], readEntries };

    const first = await openOrBuildVanillaLocCache(request);
    expect(first?.get("land_units_onscreen_name_alpha")).toBe("Alpha");
    expect(readEntries).toHaveBeenCalledTimes(1);

    // A fresh session: the in-memory reader is gone, but the file on disk still applies.
    closeVanillaLocCaches();
    const second = await openOrBuildVanillaLocCache(request);
    expect(second?.get("land_units_onscreen_name_alpha")).toBe("Alpha");
    expect(readEntries).toHaveBeenCalledTimes(1);
  });

  it("rebuilds once a localisation pack changes", async () => {
    const { userDataPath, packPath } = makeWorkspace();
    const readEntries = vi.fn(() => [["key", "before"] as const]);
    const request = { userDataPath, game: "wh3", packPaths: [packPath], readEntries };

    expect((await openOrBuildVanillaLocCache(request))?.get("key")).toBe("before");

    closeVanillaLocCaches();
    // A game patch: same path, different bytes and mtime.
    fs.writeFileSync(packPath, "patched vanilla locs, longer than before");
    readEntries.mockReturnValue([["key", "after"] as const]);

    expect((await openOrBuildVanillaLocCache(request))?.get("key")).toBe("after");
    expect(readEntries).toHaveBeenCalledTimes(2);
  });

  it("shares one build between callers that arrive together", async () => {
    const { userDataPath, packPath } = makeWorkspace();
    const readEntries = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [["key", "value"] as const];
    });
    const request = { userDataPath, game: "wh3", packPaths: [packPath], readEntries };

    const [first, second, third] = await Promise.all([
      openOrBuildVanillaLocCache(request),
      openOrBuildVanillaLocCache(request),
      openOrBuildVanillaLocCache(request),
    ]);

    expect(readEntries).toHaveBeenCalledTimes(1);
    expect(first?.get("key")).toBe("value");
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("gives up rather than retrying a build that throws", async () => {
    const { userDataPath, packPath } = makeWorkspace();
    const readEntries = vi.fn(() => {
      throw new Error("the loc packs could not be read");
    });
    const request = { userDataPath, game: "wh3", packPaths: [packPath], readEntries };

    expect(await openOrBuildVanillaLocCache(request)).toBeUndefined();
    expect(await openOrBuildVanillaLocCache(request)).toBeUndefined();
    // The caller falls back to the live path; repeating a failing multi-second build helps nobody.
    expect(readEntries).toHaveBeenCalledTimes(1);
  });

  it("keys identity on the packs, not on unrelated changes", async () => {
    const { packPath } = makeWorkspace();
    const other = `${packPath}.other`;
    fs.writeFileSync(other, "another language");

    const base = getVanillaLocCacheIdentity("wh3", [packPath]);
    expect(getVanillaLocCacheIdentity("wh3", [packPath])).toBe(base);
    // Order of the same packs is not a difference; adding a pack, or another game, is.
    expect(getVanillaLocCacheIdentity("wh3", [other, packPath]))
      .toBe(getVanillaLocCacheIdentity("wh3", [packPath, other]));
    expect(getVanillaLocCacheIdentity("wh3", [packPath, other])).not.toBe(base);
    expect(getVanillaLocCacheIdentity("wh2", [packPath])).not.toBe(base);
  });

  it("does not accept a cache file left over from a different pack set", async () => {
    const { userDataPath, packPath } = makeWorkspace();
    await openOrBuildVanillaLocCache({
      userDataPath,
      game: "wh3",
      packPaths: [packPath],
      readEntries: () => [["key", "value"] as const],
    });
    closeVanillaLocCaches();

    // The stamp no longer matches, so the file must be rebuilt rather than trusted.
    fs.writeFileSync(nodePath.join(userDataPath, "vanilla-loc-cache-wh3.bin.id"), "stale identity");
    const rebuilt = vi.fn(() => [["key", "rebuilt"] as const]);
    const reader = await openOrBuildVanillaLocCache({
      userDataPath,
      game: "wh3",
      packPaths: [packPath],
      readEntries: rebuilt,
    });

    expect(rebuilt).toHaveBeenCalledTimes(1);
    expect(reader?.get("key")).toBe("rebuilt");
  });
});
