import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildBuildingsData } from "../src/buildingsData/data";
import { clearBuildingsMemoryCache, loadBuildingsDiskCache, saveBuildingsDiskCache } from "../src/buildingsData/cache";

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
  it("round-trips the cached vanilla building frame", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-buildings-"));
    temporaryDirectories.push(directory);
    const data = buildBuildingsData({}, () => undefined);
    data.buildingFrame = Buffer.from("cached-frame").toString("base64");

    await saveBuildingsDiskCache(directory, "current", data);
    clearBuildingsMemoryCache();

    const restored = await loadBuildingsDiskCache(directory, "current");
    expect(restored?.buildingFrame).toBe(data.buildingFrame);
    await expect(loadBuildingsDiskCache(directory, "stale")).resolves.toBeUndefined();
  });
});
