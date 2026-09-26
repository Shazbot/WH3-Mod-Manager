import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BUILDINGS_CACHE_DIR,
  buildingsModSegmentKey,
  clearBuildingsMemoryCache,
  describeBuildingsVanillaSignatureChanges,
  loadBuildingsModSegments,
  loadVanillaBuildingsCache,
  mergeBuildingsSources,
  pruneBuildingsModSegments,
  saveBuildingsModSegments,
  saveVanillaBuildingsCache,
  type BuildingsModSegments,
  type BuildingsSource,
  type BuildingsVanillaSignatureInputs,
} from "../src/buildingsData/cache";
import type { BuildingsTableRows } from "../src/buildingsData/types";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  clearBuildingsMemoryCache();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("Buildings disk cache", () => {
  it("describes the inputs that changed between cache signatures", () => {
    const previous: BuildingsVanillaSignatureInputs = {
      feature: 2,
      game: "wh3",
      schema: "schema-1",
      identities: [
        ["db.pack", 10, 1],
        ["ui2.pack", 20, 2],
      ],
    };
    const current: BuildingsVanillaSignatureInputs = {
      ...previous,
      schema: "schema-2",
      identities: [
        ["db.pack", 11, 1],
        ["ui2.pack", 20, 3],
        ["new.pack", 1, 1],
      ],
    };

    expect(describeBuildingsVanillaSignatureChanges(previous, current)).toEqual([
      "schema changed",
      "pack identity changed: db.pack",
      "pack identity changed: ui2.pack",
      "pack identity added: new.pack",
    ]);
  });

  it("round-trips the cached vanilla building frame", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-buildings-"));
    temporaryDirectories.push(directory);
    const source: BuildingsSource = {
      tables: { building_levels_tables: [{ level_name: "cached" }] },
      localizations: { building_levels_onscreen_name_cached: "Cached" },
      buildingFrame: Buffer.from("cached-frame").toString("base64"),
      cloneSourcePackPaths: {
        levels: { cached: "C:\\mods\\buildings.pack" },
        cultureVariants: { "cached|emp||": "C:\\mods\\buildings.pack" },
        sets: { cached_set: "C:\\mods\\buildings.pack" },
      },
    };

    await saveVanillaBuildingsCache(directory, "current", source);
    clearBuildingsMemoryCache();

    const restored = await loadVanillaBuildingsCache(directory, "current");
    expect(restored?.buildingFrame).toBe(source.buildingFrame);
    expect(restored?.cloneSourcePackPaths).toEqual(source.cloneSourcePackPaths);
    expect(restored?.tables).toEqual(source.tables);
    expect(restored?.localizations).toEqual(source.localizations);
    await expect(loadVanillaBuildingsCache(directory, "stale")).resolves.toBeUndefined();
  });
});

describe("Buildings mod cache segments", () => {
  const segment = (key: string, identity: readonly [number, number], lastUsedMs = 1) => ({
    tables: { building_levels_tables: [{ level_name: key }] } as BuildingsTableRows,
    localizations: {},
    identity,
    lastUsedMs,
  });

  it("keeps the vanilla file independent when one mod segment changes", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-buildings-mods-"));
    temporaryDirectories.push(directory);
    await saveVanillaBuildingsCache(directory, "vanilla", { tables: {}, localizations: {} });
    const vanillaPath = path.join(directory, BUILDINGS_CACHE_DIR, "vanilla.bin");
    const vanillaBefore = await fs.promises.readFile(vanillaPath);
    const modA = "C:\\mods\\a.pack";
    const modB = "C:\\mods\\b.pack";
    await saveBuildingsModSegments(directory, {
      [buildingsModSegmentKey(modA)]: segment("a", [1, 1]),
      [buildingsModSegmentKey(modB)]: segment("b", [2, 2]),
    });
    clearBuildingsMemoryCache();
    const segments = { ...(await loadBuildingsModSegments(directory)) };
    const reusedA = segments[buildingsModSegmentKey(modA)];
    segments[buildingsModSegmentKey(modB)] = segment("b2", [2, 3]);
    await saveBuildingsModSegments(directory, segments);

    expect((await loadBuildingsModSegments(directory))[buildingsModSegmentKey(modA)]).toEqual(reusedA);
    expect((await loadBuildingsModSegments(directory))[buildingsModSegmentKey(modB)].tables).toEqual({
      building_levels_tables: [{ level_name: "b2" }],
    });
    expect(await fs.promises.readFile(vanillaPath)).toEqual(vanillaBefore);
  });

  it("prunes old mod segments", () => {
    const segments: BuildingsModSegments = {};
    for (let index = 0; index < 105; index++) {
      segments[`pack-${index}`] = segment(`level-${index}`, [index, index], index);
    }
    const pruned = pruneBuildingsModSegments(segments);
    expect(Object.keys(pruned)).toHaveLength(100);
    expect(pruned["pack-104"]).toBeDefined();
    expect(pruned["pack-4"]).toBeUndefined();
  });
});

describe("mergeBuildingsSources", () => {
  it("keeps vanilla first, lets later mods override metadata, and does not mutate vanilla", () => {
    const vanilla: BuildingsSource = {
      tables: { building_levels_tables: [{ level_name: "vanilla" }] },
      localizations: { name: "Vanilla" },
      cloneSourcePackPaths: { levels: { vanilla: "db.pack" }, cultureVariants: {}, sets: {} },
    };
    const merged = mergeBuildingsSources(vanilla, [
      {
        packPath: "first.pack",
        source: {
          tables: { building_levels_tables: [{ level_name: "first" }] },
          localizations: { name: "First" },
          cloneSourcePackPaths: { levels: { first: "first.pack" }, cultureVariants: {}, sets: {} },
        },
      },
      {
        packPath: "second.pack",
        source: {
          tables: { building_levels_tables: [{ level_name: "vanilla" }] },
          localizations: { name: "Second" },
          cloneSourcePackPaths: { levels: { vanilla: "second.pack" }, cultureVariants: {}, sets: {} },
        },
      },
    ]);

    expect(merged.tables.building_levels_tables.map((row) => row.level_name)).toEqual(["vanilla", "first", "vanilla"]);
    expect(merged.localizations.name).toBe("Second");
    expect(merged.cloneSourcePackPaths?.levels.vanilla).toBe("second.pack");
    expect(vanilla.tables.building_levels_tables).toHaveLength(1);
  });
});
