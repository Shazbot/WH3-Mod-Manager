import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVanillaPackPathsInLoadOrder: vi.fn(),
  hasCurrentVanillaPackIndex: vi.fn(),
  saveVanillaPackFilesCache: vi.fn(),
  readPack: vi.fn(),
}));

vi.mock("../src/utility/vanillaPackPaths", () => ({
  getVanillaPackPathsInLoadOrder: mocks.getVanillaPackPathsInLoadOrder,
}));

vi.mock("../src/vanillaPackFilesCache", () => ({
  hasCurrentVanillaPackIndex: mocks.hasCurrentVanillaPackIndex,
  saveVanillaPackFilesCache: mocks.saveVanillaPackFilesCache,
}));

vi.mock("../src/packFileSerializer", () => ({
  readPack: mocks.readPack,
}));

import { ensureWh3AssetHostVanillaCache } from "../src/wh3AssetHostVanillaCache";

describe("WH3AssetHost vanilla cache warming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVanillaPackPathsInLoadOrder.mockReturnValue([
      "C:\\game\\data\\data.pack",
      "C:\\game\\data\\anim.pack",
      "C:\\game\\data\\models.pack",
    ]);
    mocks.hasCurrentVanillaPackIndex.mockResolvedValue(false);
    mocks.readPack.mockResolvedValue({});
    mocks.saveVanillaPackFilesCache.mockResolvedValue(undefined);
  });

  it("builds every missing vanilla index and flushes once before the host can consume the cache", async () => {
    mocks.hasCurrentVanillaPackIndex
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    const result = await ensureWh3AssetHostVanillaCache();

    expect(mocks.readPack).toHaveBeenCalledTimes(2);
    expect(mocks.readPack).toHaveBeenNthCalledWith(1, "C:\\game\\data\\anim.pack", {
      skipParsingTables: true,
      skipSorting: true,
    });
    expect(mocks.readPack).toHaveBeenNthCalledWith(2, "C:\\game\\data\\models.pack", {
      skipParsingTables: true,
      skipSorting: true,
    });
    expect(mocks.saveVanillaPackFilesCache).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ totalPacks: 3, cacheHits: 1, rebuiltPacks: 2 });
  });

  it("does not reparse current cached packs", async () => {
    mocks.hasCurrentVanillaPackIndex.mockResolvedValue(true);

    const result = await ensureWh3AssetHostVanillaCache();

    expect(mocks.readPack).not.toHaveBeenCalled();
    expect(mocks.saveVanillaPackFilesCache).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ totalPacks: 3, cacheHits: 3, rebuiltPacks: 0 });
  });
});
