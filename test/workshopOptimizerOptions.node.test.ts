import { describe, expect, it } from "vitest";
import { buildNarrowKey } from "../src/workshopModOptimizer/cacheKey";
import { buildCacheOptions, buildHostOptions, WORKSHOP_OPTIMIZER_HOST_OPTIONS } from "../src/workshopModOptimizer/hostRunner";
import { DEFAULT_WORKSHOP_OPTIMIZER_OPTIONS, getWorkshopOptimizerOptionUnavailableReason, normalizeWorkshopOptimizerOptions } from "../src/workshopModOptimizer/options";

describe("workshop optimizer settings", () => {
  it("keeps existing host and cache defaults", () => {
    const defaults = normalizeWorkshopOptimizerOptions(undefined);
    expect(buildHostOptions(true, defaults)).toMatchObject({
      ...WORKSHOP_OPTIMIZER_HOST_OPTIONS,
      reportDiagnostics: false,
      armyScope: "subculture",
      siblingScope: "model",
    });
    expect(buildHostOptions(true)).toEqual(buildHostOptions(true, defaults));
    expect(buildCacheOptions(true, defaults)).toEqual(WORKSHOP_OPTIMIZER_HOST_OPTIONS);
  });

  it("rejects invalid stored values and keeps valid choices", () => {
    expect(normalizeWorkshopOptimizerOptions({ buildAtlases: true, armyScope: "culture", siblingScope: "invalid", pruneDeadFiles: "false" }))
      .toMatchObject({ buildAtlases: true, armyScope: "culture", siblingScope: "model", pruneDeadFiles: true });
  });

  it("marks settings inactive only while their host prerequisites are unmet", () => {
    const defaults = normalizeWorkshopOptimizerOptions(undefined);
    expect(getWorkshopOptimizerOptionUnavailableReason("shareAtlasesAcrossVmds", defaults)).toBe("Requires Build new atlases.");
    expect(getWorkshopOptimizerOptionUnavailableReason("shareAtlasesAcrossVmds", { ...defaults, buildAtlases: true })).toBeUndefined();
    expect(getWorkshopOptimizerOptionUnavailableReason("dropUnreadAlpha", { ...defaults, compactTextures: false })).toBe("Requires Compact textures.");
    expect(getWorkshopOptimizerOptionUnavailableReason("sharedTextureRepack", { ...defaults, crossRigidOnly: true })).toBeTruthy();
    expect(getWorkshopOptimizerOptionUnavailableReason("reportDiagnostics", { ...defaults, crossRigidOnly: true })).toBeUndefined();
    expect(getWorkshopOptimizerOptionUnavailableReason("optimizeGeometry", {
      ...defaults, mergeCompatibleMeshes: false, crossRigidMerges: false,
      buildAtlases: false, sharedTextureRepack: false, remakeEditorLods: false,
    })).toMatch(/Requires a model rewriting option/);
  });

  it("separates cache entries for changed output or report settings", () => {
    const base = {
      profile: "wh3-visual-v1", source: { name: "x.pack", size: 1, mtimeMs: 1 },
      outputVersion: 43, scanVersion: 2, gameIdentity: "game", schemaDigest: "schema",
    };
    const key = (options: typeof DEFAULT_WORKSHOP_OPTIMIZER_OPTIONS | ReturnType<typeof normalizeWorkshopOptimizerOptions>) =>
      buildNarrowKey({ ...base, options: buildCacheOptions(true, options) }, []);
    const defaults = normalizeWorkshopOptimizerOptions(undefined);
    expect(key({ ...defaults, buildAtlases: true })).not.toBe(key(defaults));
    expect(key({ ...defaults, armyScope: "culture" })).not.toBe(key(defaults));
    // Reports are stored beside a cache entry, so an audit change needs a new report-bearing entry.
    expect(key({ ...defaults, reportDiagnostics: true })).not.toBe(key(defaults));
    expect(buildHostOptions(false, { ...defaults, reportDiagnostics: true })).toMatchObject({
      compressRigidModels: false, reportDiagnostics: true,
    });
  });
});
