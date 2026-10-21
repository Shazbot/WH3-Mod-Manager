import * as fs from "node:fs";
import * as nodePath from "node:path";
import { app } from "electron";

import appData from "../appData";
import { getVanillaPackFilesCachePath } from "../vanillaPackFilesCache";
import { getVanillaPackPathsInLoadOrder } from "../utility/vanillaPackPaths";
import { ensureWh3AssetHostVanillaCache } from "../wh3AssetHostVanillaCache";
import { resolveWh3AssetHostExecutablePath } from "../wh3AssetHostIpc";
import { WorkshopOptimizerCache } from "./cache";
import { type WorkshopOptimizerEnabledMod, WorkshopModOptimizer } from "./optimizer";
import { computeGameIdentity, hashFileSha256, packHasOptimizableVisuals } from "./packInspection";

/** The persistent store lives in userData, so "Clean up after game exit" never touches it. */
let sharedCache: WorkshopOptimizerCache | undefined;
export const getWorkshopOptimizerCache = (): WorkshopOptimizerCache =>
  (sharedCache ??= new WorkshopOptimizerCache({ root: nodePath.join(app.getPath("userData"), "workshop-optimizer") }));

const hostHashByPath = new Map<string, { size: number; mtimeMs: number; hash: Promise<string> }>();

const hostHash = (hostPath: string): Promise<string> => {
  const stats = fs.statSync(hostPath);
  const cached = hostHashByPath.get(hostPath);
  if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) return cached.hash;
  const hash = hashFileSha256(hostPath);
  hostHashByPath.set(hostPath, { size: stats.size, mtimeMs: stats.mtimeMs, hash });
  return hash;
};

export const getBundledSchemaPath = () => nodePath.join(__dirname, "../schema/schema_wh3.json.zst");

export interface CreateWorkshopModOptimizerOptions {
  cache: WorkshopOptimizerCache;
  loadOrder: readonly WorkshopOptimizerEnabledMod[];
  dataFolder: string;
}

/** Builds the optimizer for one launch, or undefined when the host is unavailable. */
export const createWorkshopModOptimizer = (
  options: CreateWorkshopModOptimizerOptions,
): WorkshopModOptimizer | undefined => {
  const vanillaFileIndexPath = getVanillaPackFilesCachePath();
  let hostExecutablePath: string;
  try {
    hostExecutablePath = resolveWh3AssetHostExecutablePath();
  } catch (error) {
    console.warn("Mod optimizer unavailable:", error);
    return undefined;
  }
  if (!vanillaFileIndexPath) return undefined;
  const schemaPath = getBundledSchemaPath();
  return new WorkshopModOptimizer({
    cache: options.cache,
    hostExecutablePath,
    hostHash: () => hostHash(hostExecutablePath),
    vanillaFileIndexPath,
    ensureVanillaIndex: async () => {
      await ensureWh3AssetHostVanillaCache();
    },
    gameDataFolder: options.dataFolder,
    dbSchemaPath: fs.existsSync(schemaPath) ? schemaPath : undefined,
    gameIdentity: () => computeGameIdentity(getVanillaPackPathsInLoadOrder()),
    schemaDigest: async () => (fs.existsSync(schemaPath) ? hashFileSha256(schemaPath) : "none"),
    includeRigidModelV2: appData.isRigidModelV2CompressionEnabled,
    loadOrder: options.loadOrder,
    hasVisualAssets: packHasOptimizableVisuals,
    parentProcessId: process.pid,
    log: (message) => console.log(`[optimizer] ${message}`),
  });
};
