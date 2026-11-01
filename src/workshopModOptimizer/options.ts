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
