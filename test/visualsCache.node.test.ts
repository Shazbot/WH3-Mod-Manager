import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VISUALS_CACHE_DIR,
  clearVisualsMemoryCache,
  createEmptyVisualsDataCache,
  getCurrentVisualsModSegment,
  getCurrentVisualsTableContribution,
  getCurrentVisualsPackCacheEntry,
  getOrCreateVisualsModSegment,
  getOrCreateVisualsPackCacheEntry,
  getVisualsFilesFromNames,
  loadVisualsModSegments,
  loadVanillaVisualsCache,
  mergeVisualsFileContributions,
  mergeVisualsLocContributions,
  mergeVisualsTableContributions,
  pruneVisualsModSegments,
  saveVisualsModSegments,
  saveVanillaVisualsCache,
  visualsModSegmentKey,
  type VisualsModSegments,
  type VisualsTableContribution,
} from "../src/visuals/cache";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  clearVisualsMemoryCache();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

const emptyContribution = (): VisualsTableContribution => ({
  variants: [],
  unitVariants: [],
  landUnits: [],
});

describe("Visuals data cache", () => {
  it("stores vanilla and mod halves separately and round-trips both", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-visuals-"));
    temporaryDirectories.push(directory);
    const vanilla = createEmptyVisualsDataCache();
    const vanillaIdentity = { packPath: "/game/data/db.pack", size: 100, mtimeMs: 10 };
    const vanillaEntry = getOrCreateVisualsPackCacheEntry(vanilla, vanillaIdentity);
    vanillaEntry.files = [{ path: "models\\vanilla.wsmodel", ext: "wsmodel" }];
    const signatureInputs = {
      feature: 1,
      game: "wh3",
      schema: "schema-a",
      identities: [["/game/data/db.pack", 100, 10]] as Array<readonly [string, number, number]>,
    };
    const modIdentity = { packPath: "/mods/example.pack", size: 200, mtimeMs: 20 };
    const modSegments: VisualsModSegments = {};
    const modSegment = getOrCreateVisualsModSegment(modSegments, modIdentity);
    modSegment.lastUsedMs = 1;
    modSegment.locs = [["unit_name", "Example"]];

    await saveVanillaVisualsCache(directory, "sig-a", vanilla, signatureInputs);
    const vanillaPath = path.join(directory, VISUALS_CACHE_DIR, "vanilla.bin");
    const vanillaBefore = await fs.promises.readFile(vanillaPath);
    await saveVisualsModSegments(directory, modSegments);
    clearVisualsMemoryCache();

    const restoredVanilla = await loadVanillaVisualsCache(directory, "sig-a", signatureInputs);
    const restoredMods = await loadVisualsModSegments(directory);
    expect(restoredVanilla?.entries[visualsModSegmentKey(vanillaIdentity.packPath)]?.files).toEqual(vanillaEntry.files);
    expect(restoredMods[visualsModSegmentKey(modIdentity.packPath)]?.locs).toEqual([["unit_name", "Example"]]);

    restoredMods[visualsModSegmentKey(modIdentity.packPath)].locs = [["unit_name", "Changed"]];
    await saveVisualsModSegments(directory, restoredMods);
    expect(await fs.promises.readFile(vanillaPath)).toEqual(vanillaBefore);
  });

  it("reuses an unchanged pack and discards every section when its disk identity changes", () => {
    const cache = createEmptyVisualsDataCache();
    const originalIdentity = { packPath: "/mods/example.pack", size: 100, mtimeMs: 10 };
    const entry = getOrCreateVisualsPackCacheEntry(cache, originalIdentity);
    entry.files = [{ path: "models\\one.wsmodel", ext: "wsmodel" }];
    entry.locs = [["land_units_onscreen_name_one", "One"]];
    entry.tables = { schemaHash: "schema-a", contribution: emptyContribution() };

    expect(getCurrentVisualsPackCacheEntry(cache, { ...originalIdentity })).toBe(entry);
    expect(getCurrentVisualsTableContribution(entry, "schema-a")).toBe(entry.tables.contribution);
    expect(getCurrentVisualsTableContribution(entry, "schema-b")).toBeUndefined();
    expect(getCurrentVisualsPackCacheEntry(cache, { ...originalIdentity, mtimeMs: 11 })).toBeUndefined();

    const replacement = getOrCreateVisualsPackCacheEntry(cache, {
      ...originalIdentity,
      mtimeMs: 11,
    });
    expect(replacement).not.toBe(entry);
    expect(replacement.files).toBeUndefined();
    expect(replacement.locs).toBeUndefined();
  });

  it("indexes only Visuals paths and lets higher-priority packs override path casing", () => {
    const vanilla = getVisualsFilesFromNames([
      "variantmeshes\\unit.variantmeshdefinition",
      "models\\unit.rigid_model_v2",
      "textures\\unit.dds",
    ]);
    const mod = getVisualsFilesFromNames(["VariantMeshes\\UNIT.variantmeshdefinition", "models\\unit.wsmodel"]);

    expect(mergeVisualsFileContributions([vanilla, mod])).toEqual([
      { path: "models\\unit.rigid_model_v2", ext: "rigid_model_v2" },
      { path: "models\\unit.wsmodel", ext: "wsmodel" },
      { path: "VariantMeshes\\UNIT.variantmeshdefinition", ext: "variantmeshdefinition" },
    ]);
  });

  it("preserves table, origin, and localization override priority", () => {
    const vanilla = emptyContribution();
    vanilla.variants.push(["shared_variant", "vanilla.variantmeshdefinition"]);
    vanilla.unitVariants.push(["shared_unit", "faction", "shared_variant"]);
    vanilla.landUnits.push("shared_unit", "vanilla_only");

    const mod = emptyContribution();
    mod.variants.push(["shared_variant", "mod.variantmeshdefinition"]);
    mod.unitVariants.push(["shared_unit", "faction", "shared_variant"]);
    mod.landUnits.push("shared_unit", "mod_only");

    const merged = mergeVisualsTableContributions(
      [
        { packPath: "db.pack", contribution: vanilla },
        { packPath: "mod.pack", contribution: mod },
      ],
      [
        { packPath: "mod.pack", contribution: mod },
        { packPath: "db.pack", contribution: vanilla },
      ],
    );

    expect(merged.variantsByName.get("shared_variant")).toBe("mod.variantmeshdefinition");
    expect(merged.unitKeyToOriginPackPath.get("shared_unit")).toBe("mod.pack");
    expect(merged.unitKeyToOriginPackPath.get("vanilla_only")).toBe("db.pack");
    expect(merged.landUnitKeys).toEqual(new Set(["shared_unit", "vanilla_only", "mod_only"]));

    expect(
      mergeVisualsLocContributions([
        [["land_units_onscreen_name_shared_unit", "Vanilla Name"]],
        [["land_units_onscreen_name_shared_unit", "Mod Name"]],
      ]).get("land_units_onscreen_name_shared_unit"),
    ).toBe("Mod Name");
  });

  it("keeps mod entries independent and prunes the least recently used segments", () => {
    const segments: VisualsModSegments = {};
    const originalIdentity = { packPath: "/mods/example.pack", size: 100, mtimeMs: 10 };
    const original = getOrCreateVisualsModSegment(segments, originalIdentity);
    original.lastUsedMs = 1;
    original.files = [{ path: "models\\one.wsmodel", ext: "wsmodel" }];

    expect(getCurrentVisualsModSegment(segments, { ...originalIdentity })).toBe(original);
    const replacement = getOrCreateVisualsModSegment(segments, { ...originalIdentity, mtimeMs: 11 });
    expect(replacement).not.toBe(original);
    expect(replacement.files).toBeUndefined();

    for (let index = 0; index < 100; index += 1) {
      const segment = getOrCreateVisualsModSegment(segments, {
        packPath: `/mods/other-${index}.pack`,
        size: index,
        mtimeMs: index,
      });
      segment.lastUsedMs = index + 2;
    }
    const pruned = pruneVisualsModSegments(segments);

    expect(Object.keys(pruned)).toHaveLength(100);
    expect(pruned[visualsModSegmentKey(originalIdentity.packPath)]).toBeUndefined();
    expect(pruned[visualsModSegmentKey("/mods/other-99.pack")]).toBeDefined();
  });
});
