import { describe, expect, it } from "vitest";
import {
  createEmptyVisualsDataCache,
  getCurrentVisualsTableContribution,
  getCurrentVisualsPackCacheEntry,
  getOrCreateVisualsPackCacheEntry,
  getVisualsFilesFromNames,
  mergeVisualsFileContributions,
  mergeVisualsLocContributions,
  mergeVisualsTableContributions,
  type VisualsTableContribution,
} from "../src/visuals/cache";

const emptyContribution = (): VisualsTableContribution => ({
  variants: [],
  unitVariants: [],
  landUnits: [],
});

describe("Visuals data cache", () => {
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
    expect(
      getCurrentVisualsPackCacheEntry(cache, { ...originalIdentity, mtimeMs: 11 }),
    ).toBeUndefined();

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
    const mod = getVisualsFilesFromNames([
      "VariantMeshes\\UNIT.variantmeshdefinition",
      "models\\unit.wsmodel",
    ]);

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
});
