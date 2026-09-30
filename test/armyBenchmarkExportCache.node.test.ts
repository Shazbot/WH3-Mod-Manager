import { describe, expect, it, vi } from "vitest";
import {
  createArmyBenchmarkExportCache,
  getArmyBenchmarkExportCacheKey,
} from "../src/visuals/armyBenchmarkExportCache";

describe("army benchmark export cache", () => {
  it("shares in-flight and completed exports and disposes each entry once", async () => {
    const dispose = vi.fn();
    const create = vi.fn(async () => ({ previewId: "preview-1" }));
    const cache = createArmyBenchmarkExportCache(dispose);

    const first = cache.get("same", create);
    const second = await cache.get("same", create);

    expect((await first).cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);

    await cache.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith({ previewId: "preview-1" });
  });

  it("keeps represented export failures reusable", async () => {
    const create = vi.fn(async () => ({ error: "malformed VMD" }));
    const cache = createArmyBenchmarkExportCache(() => undefined);

    const first = await cache.get("broken", create);
    const second = await cache.get("broken", create);

    expect(first.value).toEqual({ error: "malformed VMD" });
    expect(second).toEqual({ value: { error: "malformed VMD" }, cacheHit: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("isolates exports resolved from different source snapshots", () => {
    const original = getArmyBenchmarkExportCacheKey("VARIANTMESHES/UNIT.VARIANTMESHDEFINITION", [
      { name: "source", path: "C:/mods/original.pack", loadOrder: 4 },
    ]);
    const sameIdentity = getArmyBenchmarkExportCacheKey("variantmeshes\\unit.variantmeshdefinition", [
      { name: "source", path: "c:\\mods\\original.pack", loadOrder: 4 },
    ]);
    const atlas = getArmyBenchmarkExportCacheKey("variantmeshes\\unit.variantmeshdefinition", [
      { name: "source", path: "c:\\mods\\original_atlas.pack", loadOrder: 4 },
    ]);

    expect(sameIdentity).toBe(original);
    expect(atlas).not.toBe(original);
  });
});
