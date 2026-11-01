/** Saved optimize-request fields. Compression follows WHMM's existing rigid compression setting. */
export const DEFAULT_WORKSHOP_OPTIMIZER_OPTIONS = {
  mergeCompatibleMeshes: true,
  shareAtlasesAcrossVmds: true,
  optimizeGeometry: true,
  atlasAllVmds: false,
  scoreAllGameUnits: false,
  lodAwareAtlasPlanning: true,
  crossRigidOnly: false,
  crossRigidMerges: true,
  buildAtlases: false,
  downscaleTextures: true,
  sharedTextureRepack: true,
  compactTextures: true,
  dropUnreadAlpha: true,
  remakeEditorLods: true,
  pruneDeadFiles: true,
  switchOpaqueAlphaShaders: true,
  reportDiagnostics: false,
  armyScope: "subculture",
  siblingScope: "model",
} as const;

export type WorkshopOptimizerOptions = {
  -readonly [K in keyof typeof DEFAULT_WORKSHOP_OPTIMIZER_OPTIONS]:
    K extends "armyScope" ? "subculture" | "culture" : K extends "siblingScope" ? "model" | "pack" : boolean;
};

/** Host options that are accepted but have no effect under the selected mode. Keep their saved values. */
export const getWorkshopOptimizerOptionUnavailableReason = (
  key: keyof WorkshopOptimizerOptions,
  options: WorkshopOptimizerOptions,
): string | undefined => {
  if (options.crossRigidOnly) {
    if (key === "crossRigidMerges") return "Cross-rigid merges only already enables this.";
    if (key !== "crossRigidOnly" && key !== "reportDiagnostics") {
      return "Unavailable while Cross-rigid merges only is on.";
    }
  }
  if (
    !options.buildAtlases &&
    (key === "shareAtlasesAcrossVmds" || key === "atlasAllVmds" || key === "lodAwareAtlasPlanning" ||
      key === "scoreAllGameUnits" || key === "armyScope" || key === "siblingScope")
  ) {
    return "Requires Build new atlases.";
  }
  if (
    key === "optimizeGeometry" &&
    !options.mergeCompatibleMeshes && !options.crossRigidMerges && !options.buildAtlases &&
    !options.sharedTextureRepack && !options.remakeEditorLods
  ) {
    return "Requires a model rewriting option, such as mesh merging or old editor LOD repair.";
  }
  if (key === "dropUnreadAlpha" && !options.compactTextures) return "Requires Compact textures.";
  return undefined;
};

/** Ignore unknown keys and invalid values from old or hand-edited config files and IPC payloads. */
export const normalizeWorkshopOptimizerOptions = (value: unknown): WorkshopOptimizerOptions => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_WORKSHOP_OPTIMIZER_OPTIONS } as WorkshopOptimizerOptions;
  for (const key of Object.keys(result) as (keyof WorkshopOptimizerOptions)[]) {
    const candidate = source[key];
    if (key === "armyScope") {
      if (candidate === "subculture" || candidate === "culture") result.armyScope = candidate;
    } else if (key === "siblingScope") {
      if (candidate === "model" || candidate === "pack") result.siblingScope = candidate;
    } else if (typeof candidate === "boolean") {
      (result as Record<string, unknown>)[key] = candidate;
    }
  }
  return result;
};
