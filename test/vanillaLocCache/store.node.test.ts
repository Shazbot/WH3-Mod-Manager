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
    expect(getVanillaLocCacheIdentity("wh3", [packPath, other])).not.toBe(base);
    expect(getVanillaLocCacheIdentity("wh2", [packPath])).not.toBe(base);
    // Order counts: packs are folded last-wins, so swapping two of them is a different cache. A
    // language pack listed after English means something different from one listed before it.
    expect(getVanillaLocCacheIdentity("wh3", [other, packPath])).not.toBe(
      getVanillaLocCacheIdentity("wh3", [packPath, other]),
    );
  });

  it("gives consumers with different pack sets their own file instead of evicting each other", async () => {
    const { userDataPath, packPath } = makeWorkspace();
    const otherPack = `${packPath}.data`;
    fs.writeFileSync(otherPack, "another vanilla pack");

    // Two consumers of the same game that disagree about which packs they read locs from.
    const narrow = vi.fn(() => [["key", "narrow"] as const]);
    const broad = vi.fn(() => [["key", "broad"] as const]);
    const narrowRequest = { userDataPath, game: "wh3", packPaths: [packPath], readEntries: narrow };
    const broadRequest = {
      userDataPath,
      game: "wh3",
      packPaths: [packPath, otherPack],
      readEntries: broad,
    };

    expect((await openOrBuildVanillaLocCache(narrowRequest))?.get("key")).toBe("narrow");
    expect((await openOrBuildVanillaLocCache(broadRequest))?.get("key")).toBe("broad");

    // Both files survive, so neither consumer rebuilds just because the other ran.
    closeVanillaLocCaches();
    expect((await openOrBuildVanillaLocCache(narrowRequest))?.get("key")).toBe("narrow");
    expect((await openOrBuildVanillaLocCache(broadRequest))?.get("key")).toBe("broad");
    expect(narrow).toHaveBeenCalledTimes(1);
    expect(broad).toHaveBeenCalledTimes(1);
  });

  it("reuses one file per pack set across game patches rather than accumulating them", async () => {
    const { userDataPath, packPath } = makeWorkspace();
    const request = {
      userDataPath,
      game: "wh3",
      packPaths: [packPath],
      readEntries: () => [["key", "value"] as const],
    };
    await openOrBuildVanillaLocCache(request);
    closeVanillaLocCaches();
    fs.writeFileSync(packPath, "patched vanilla locs, a different length entirely");
    await openOrBuildVanillaLocCache(request);

    expect(fs.readdirSync(userDataPath).filter((entry) => entry.endsWith(".bin"))).toHaveLength(1);
  });

  it("rebuilds rather than serving a cache built with the packs in the other order", async () => {
    const { userDataPath, packPath } = makeWorkspace();
    const preferred = `${packPath}.de`;
    fs.writeFileSync(preferred, "the player's language");

    // English first, preferred language last: the later pack wins.
    const build = vi.fn(() => [["key", "value"] as const]);
    await openOrBuildVanillaLocCache({
      userDataPath,
      game: "wh3",
      packPaths: [packPath, preferred],
      readEntries: build,
    });
    closeVanillaLocCaches();

    // The same packs the other way round must not be served the file built for the first order.
    const rebuilt = vi.fn(() => [["key", "other order"] as const]);
    const reader = await openOrBuildVanillaLocCache({
      userDataPath,
      game: "wh3",
      packPaths: [preferred, packPath],
      readEntries: rebuilt,
    });

    expect(rebuilt).toHaveBeenCalledTimes(1);
    expect(reader?.get("key")).toBe("other order");
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
    const stamp = fs.readdirSync(userDataPath).find((entry) => entry.endsWith(".bin.id"))!;
    expect(stamp).toBeDefined();
    fs.writeFileSync(nodePath.join(userDataPath, stamp), "stale identity");
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
