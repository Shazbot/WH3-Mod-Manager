import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANCILLARIES_CACHE_DIR,
  clearAncillariesMemoryCache,
  describeVanillaSignatureChanges,
  isSameIdentity,
  loadAncillariesModSegments,
  loadVanillaAncillariesCache,
  mergeAncillariesSources,
  modSegmentKey,
  pruneModSegments,
  saveAncillariesModSegments,
  saveVanillaAncillariesCache,
  type AncillariesModSegments,
  type AncillariesSource,
  type AncillariesVanillaSignatureInputs,
} from "../src/ancillariesData/cache";
import { ANCILLARY_TABLES } from "../src/ancillariesData/data";
import type { AncillariesTableRows } from "../src/ancillariesData/types";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

const temporaryDirectories: string[] = [];

const makeUserDataPath = async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-ancillaries-"));
  temporaryDirectories.push(directory);
  return directory;
};

const cacheFile = (userDataPath: string, name: string) => path.join(userDataPath, ANCILLARIES_CACHE_DIR, name);

const emptyTables = (): AncillariesTableRows =>
  Object.fromEntries(ANCILLARY_TABLES.map((table) => [table, []])) as AncillariesTableRows;

const sourceWithAncillaries = (keys: string[], localizations: Record<string, string> = {}): AncillariesSource => {
  const tables = emptyTables();
  tables.ancillaries_tables = keys.map((key) => ({ key, category: "weapon", subcategory: "", type: "t" }));
  return { tables, localizations };
};

afterEach(async () => {
  clearAncillariesMemoryCache();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("Ancillaries vanilla cache", () => {
  const inputs: AncillariesVanillaSignatureInputs = {
    feature: 1,
    game: "wh3",
    schema: "schema-1",
    identities: [["db.pack", 10, 1]],
  };

  it("round trips a payload under its signature", async () => {
    const userDataPath = await makeUserDataPath();
    const source = sourceWithAncillaries(["anc_a"], { ancillaries_onscreen_name_anc_a: "A" });

    await saveVanillaAncillariesCache(userDataPath, "sig-1", source, inputs);
    clearAncillariesMemoryCache();

    const loaded = await loadVanillaAncillariesCache(userDataPath, "sig-1", inputs);
    expect(loaded?.tables.ancillaries_tables).toHaveLength(1);
    expect(loaded?.localizations.ancillaries_onscreen_name_anc_a).toBe("A");
  });

  it("misses when the signature changes", async () => {
    const userDataPath = await makeUserDataPath();
    await saveVanillaAncillariesCache(userDataPath, "sig-1", sourceWithAncillaries(["anc_a"]), inputs);
    clearAncillariesMemoryCache();

    expect(await loadVanillaAncillariesCache(userDataPath, "sig-2", inputs)).toBeUndefined();
  });

  it("misses rather than throwing when there is no cache file", async () => {
    const userDataPath = await makeUserDataPath();
    expect(await loadVanillaAncillariesCache(userDataPath, "sig-1", inputs)).toBeUndefined();
  });

  it("names the inputs that changed between signatures", () => {
    const changes = describeVanillaSignatureChanges(inputs, {
      ...inputs,
      schema: "schema-2",
      identities: [
        ["db.pack", 11, 1],
        ["local_en.pack", 5, 5],
      ],
    });
    expect(changes).toContain("schema changed");
    expect(changes).toContain("pack identity changed: db.pack");
    expect(changes).toContain("pack identity added: local_en.pack");
  });
});

describe("Ancillaries mod cache segments", () => {
  const segment = (keys: string[], identity: readonly [number, number], lastUsedMs = 1) => ({
    ...sourceWithAncillaries(keys),
    identity,
    lastUsedMs,
  });

  it("rewrites only the changed mod's segment and never touches the vanilla file", async () => {
    const userDataPath = await makeUserDataPath();
    const vanillaInputs: AncillariesVanillaSignatureInputs = {
      feature: 1,
      game: "wh3",
      schema: "schema-1",
      identities: [["db.pack", 10, 1]],
    };
    await saveVanillaAncillariesCache(userDataPath, "sig-1", sourceWithAncillaries(["anc_vanilla"]), vanillaInputs);
    const vanillaPath = cacheFile(userDataPath, "vanilla.bin");
    const vanillaBefore = await fs.promises.readFile(vanillaPath);

    const modA = "C:\\mods\\a.pack";
    const modB = "C:\\mods\\b.pack";
    await saveAncillariesModSegments(userDataPath, {
      [modSegmentKey(modA)]: segment(["anc_a"], [100, 1000]),
      [modSegmentKey(modB)]: segment(["anc_b"], [200, 2000]),
    });
    clearAncillariesMemoryCache();

    // B changes on disk. A's identity still matches, so only B is rebuilt.
    const segments = { ...(await loadAncillariesModSegments(userDataPath)) };
    expect(isSameIdentity(segments[modSegmentKey(modA)].identity, [100, 1000])).toBe(true);
    expect(isSameIdentity(segments[modSegmentKey(modB)].identity, [200, 2999])).toBe(false);

    const reusedA = segments[modSegmentKey(modA)];
    segments[modSegmentKey(modB)] = segment(["anc_b", "anc_b2"], [200, 2999]);
    await saveAncillariesModSegments(userDataPath, segments);
    clearAncillariesMemoryCache();

    const after = await loadAncillariesModSegments(userDataPath);
    // A's segment came through byte-identical in content; it was never re-read.
    expect(after[modSegmentKey(modA)]).toEqual(reusedA);
    expect(after[modSegmentKey(modB)].tables.ancillaries_tables).toHaveLength(2);
    // The vanilla half is exactly as it was.
    expect(await fs.promises.readFile(vanillaPath)).toEqual(vanillaBefore);
  });

  it("keeps existing segments when a third mod is enabled", async () => {
    const userDataPath = await makeUserDataPath();
    const modA = "C:\\mods\\a.pack";
    const modB = "C:\\mods\\b.pack";
    const modC = "C:\\mods\\c.pack";
    await saveAncillariesModSegments(userDataPath, {
      [modSegmentKey(modA)]: segment(["anc_a"], [100, 1000]),
      [modSegmentKey(modB)]: segment(["anc_b"], [200, 2000]),
    });
    clearAncillariesMemoryCache();

    const segments = { ...(await loadAncillariesModSegments(userDataPath)) };
    segments[modSegmentKey(modC)] = segment(["anc_c"], [300, 3000]);
    const saved = await saveAncillariesModSegments(userDataPath, segments);

    expect(Object.keys(saved)).toHaveLength(3);
    expect(saved[modSegmentKey(modA)].tables.ancillaries_tables[0].key).toBe("anc_a");
    expect(saved[modSegmentKey(modB)].tables.ancillaries_tables[0].key).toBe("anc_b");
  });

  it("retains a segment for a mod that is no longer enabled", async () => {
    const userDataPath = await makeUserDataPath();
    const modA = "C:\\mods\\a.pack";
    await saveAncillariesModSegments(userDataPath, { [modSegmentKey(modA)]: segment(["anc_a"], [100, 1000]) });
    clearAncillariesMemoryCache();

    // A build with no mods enabled writes no new segments and must not drop the old one - re-enabling
    // a mod is common and its rows are still correct.
    const segments = await loadAncillariesModSegments(userDataPath);
    const saved = await saveAncillariesModSegments(userDataPath, segments);
    expect(saved[modSegmentKey(modA)]).toBeDefined();
  });

  it("matches segment keys case-insensitively, so a differently-spelled path still hits", async () => {
    expect(modSegmentKey("C:\\Mods\\A.pack")).toBe(modSegmentKey("c:\\mods\\a.pack"));
  });

  it("prunes the least recently used segments past the cap", () => {
    const segments: AncillariesModSegments = {};
    for (let index = 0; index < 105; index++) {
      segments[`pack-${index}`] = segment([`anc_${index}`], [index, index], index);
    }
    const pruned = pruneModSegments(segments);

    expect(Object.keys(pruned)).toHaveLength(100);
    // The five oldest stamps went, the newest stayed.
    expect(pruned["pack-104"]).toBeDefined();
    expect(pruned["pack-4"]).toBeUndefined();
    expect(pruned["pack-5"]).toBeDefined();
  });

  it("leaves a segment set under the cap untouched", () => {
    const segments: AncillariesModSegments = { a: segment(["anc_a"], [1, 1], 1) };
    expect(pruneModSegments(segments)).toBe(segments);
  });
});

describe("mergeAncillariesSources", () => {
  it("puts vanilla first and mods in load order, so the last one wins on dedupe", () => {
    const merged = mergeAncillariesSources(sourceWithAncillaries(["anc_a"]), [
      { packPath: "C:\\mods\\first.pack", source: sourceWithAncillaries(["anc_b"]) },
      { packPath: "C:\\mods\\second.pack", source: sourceWithAncillaries(["anc_a", "anc_c"]) },
    ]);

    expect(merged.tables.ancillaries_tables.map((row) => row.key)).toEqual(["anc_a", "anc_b", "anc_a", "anc_c"]);
  });

  it("attributes each ancillary to the last mod that defined it", () => {
    const merged = mergeAncillariesSources(sourceWithAncillaries(["anc_a"]), [
      { packPath: "C:\\mods\\first.pack", source: sourceWithAncillaries(["anc_a"]) },
      { packPath: "C:\\mods\\second.pack", source: sourceWithAncillaries(["anc_a"]) },
    ]);

    expect(merged.originPackPathByAncillary.anc_a).toBe("C:\\mods\\second.pack");
  });

  it("leaves a purely vanilla ancillary without an origin, which is how the filter spots it", () => {
    const merged = mergeAncillariesSources(sourceWithAncillaries(["anc_vanilla"]), [
      { packPath: "C:\\mods\\first.pack", source: sourceWithAncillaries(["anc_modded"]) },
    ]);

    expect(merged.originPackPathByAncillary.anc_vanilla).toBeUndefined();
    expect(merged.originPackPathByAncillary.anc_modded).toBe("C:\\mods\\first.pack");
  });

  it("lets a mod loc shadow the vanilla one", () => {
    const merged = mergeAncillariesSources(sourceWithAncillaries(["anc_a"], { key_a: "vanilla", key_b: "kept" }), [
      { packPath: "C:\\mods\\first.pack", source: sourceWithAncillaries([], { key_a: "modded" }) },
    ]);

    expect(merged.localizations).toEqual({ key_a: "modded", key_b: "kept" });
  });

  it("does not mutate the vanilla source it was handed", () => {
    const vanilla = sourceWithAncillaries(["anc_a"]);
    mergeAncillariesSources(vanilla, [{ packPath: "C:\\mods\\first.pack", source: sourceWithAncillaries(["anc_b"]) }]);

    expect(vanilla.tables.ancillaries_tables).toHaveLength(1);
  });
});
