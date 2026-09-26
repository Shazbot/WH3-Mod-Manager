import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearUnitViewerMemoryCache, loadUnitViewerDiskCache, saveUnitViewerDiskCache } from "../src/unitViewer/cache";
import { buildUnitViewerData, type UnitViewerTableRows } from "../src/unitViewer/data";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  clearUnitViewerMemoryCache();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("Unit Viewer disk cache", () => {
  it("round-trips merged data and rejects a stale signature", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-unit-viewer-"));
    temporaryDirectories.push(directory);
    const tables: UnitViewerTableRows = {
      main_units_tables: [{ unit: "unit", land_unit: "land", num_men: "1" }],
      land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon" }],
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "50" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
    };
    const data = buildUnitViewerData(tables, () => undefined);
    data.statIcons["ui\\skins\\default\\icon_stat_health.png"] = "cached-health-icon";

    await saveUnitViewerDiskCache(directory, "current", data);
    clearUnitViewerMemoryCache();

    const restored = await loadUnitViewerDiskCache(directory, "current");
    expect(restored?.units.get("unit")?.baseEntity.hitPoints).toBe(100);
    expect(restored?.groups[0].name).toBe("Unassigned");
    expect(restored?.statIcons).toEqual({
      "ui\\skins\\default\\icon_stat_health.png": "cached-health-icon",
    });

    clearUnitViewerMemoryCache();
    await expect(loadUnitViewerDiskCache(directory, "stale")).resolves.toBeUndefined();
  });
});
