import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildBuildingsData } from "../src/buildingsData/data";
import {
  clearBuildingsMemoryCache,
  describeBuildingsCacheSignatureChanges,
  loadBuildingsDiskCache,
  saveBuildingsDiskCache,
  type BuildingsCacheSignatureInputs,
} from "../src/buildingsData/cache";

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
    const previous: BuildingsCacheSignatureInputs = {
      feature: 2,
      game: "wh3",
      schema: "schema-1",
      mods: "mods-1",
      identities: [
        ["db.pack", 10, 1],
        ["mod.pack", 20, 2],
      ],
    };
    const current: BuildingsCacheSignatureInputs = {
      ...previous,
      schema: "schema-2",
      mods: "mods-2",
      identities: [
        ["db.pack", 11, 1],
        ["mod.pack", 20, 3],
        ["new.pack", 1, 1],
      ],
    };

    expect(describeBuildingsCacheSignatureChanges(previous, current)).toEqual([
      "visuals schema changed",
      "enabled mod list or load order changed",
      "pack identity changed: db.pack",
      "pack identity changed: mod.pack",
      "pack identity added: new.pack",
    ]);
  });

  it("round-trips the cached vanilla building frame", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-buildings-"));
    temporaryDirectories.push(directory);
    const data = buildBuildingsData({}, () => undefined);
    data.buildingFrame = Buffer.from("cached-frame").toString("base64");
    const tables = { building_levels_tables: [{ level_name: "cached" }] };
    const localizations = { building_levels_onscreen_name_cached: "Cached" };

    await saveBuildingsDiskCache(directory, "current", data, tables, localizations);
    clearBuildingsMemoryCache();

    const restored = await loadBuildingsDiskCache(directory, "current");
    expect(restored?.data.buildingFrame).toBe(data.buildingFrame);
    expect(restored?.tables).toEqual(tables);
    expect(restored?.localizations).toEqual(localizations);
    await expect(loadBuildingsDiskCache(directory, "stale")).resolves.toBeUndefined();
  });
});
