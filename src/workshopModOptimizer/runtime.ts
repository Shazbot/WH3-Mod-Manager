import * as fs from "node:fs";
import * as nodePath from "node:path";
import { app } from "electron";

import appData from "../appData";
import { getVanillaPackFilesCachePath } from "../vanillaPackFilesCache";
import { getVanillaPackPathsInLoadOrder } from "../utility/vanillaPackPaths";
import { ensureWh3AssetHostVanillaCache } from "../wh3AssetHostVanillaCache";
import { resolveWh3AssetHostExecutablePath } from "../wh3AssetHostIpc";
import { WorkshopOptimizerCache, removeLegacyUserDataCache } from "./cache";
import { WORKSHOP_OPTIMIZED_MODS_FOLDER } from "../utility/workshopModStaging";
import { type OptimizerBackgroundJoin, type WorkshopOptimizerEnabledMod, WorkshopModOptimizer } from "./optimizer";
import { computeGameIdentity, hashFileSha256, packHasOptimizableVisuals } from "./packInspection";

/**
 * The persistent store lives next to the staging folder (`<game folder>\whmm_optimized_mods`), so
 * "Clean up after game exit" and "Clear copied mods" never touch it. One instance per game folder.
 */
const sharedCaches = new Map<string, WorkshopOptimizerCache>();
export const getWorkshopOptimizerCache = (gameFolder: string): WorkshopOptimizerCache => {
  const key = nodePath.resolve(gameFolder).toLowerCase();
  let cache = sharedCaches.get(key);
  if (!cache) {
    cache = new WorkshopOptimizerCache({ root: nodePath.join(gameFolder, WORKSHOP_OPTIMIZED_MODS_FOLDER) });
    sharedCaches.set(key, cache);
  }

  return cache;
};

let legacyCacheChecked = false;
/** Removes the cache of earlier versions from the user data folder, once per run, with a log line. */
export const removeLegacyOptimizerCacheOnce = async (): Promise<void> => {
  if (legacyCacheChecked) return;
  legacyCacheChecked = true;
  try {
    if (await removeLegacyUserDataCache(app.getPath("userData"))) {
      console.log("Optimizer: removed the old optimized mods cache from the app data folder (it is not migrated).");
    }
  } catch (error) {
    console.warn("Optimizer: could not remove the old optimized mods cache:", error);
  }
};

export const getBundledSchemaPath = () => nodePath.join(__dirname, "../schema/schema_wh3.json.zst");

export interface CreateWorkshopModOptimizerOptions {
  cache: WorkshopOptimizerCache;
  loadOrder: readonly WorkshopOptimizerEnabledMod[];
  dataFolder: string;
  lowPriority?: boolean;
  background?: OptimizerBackgroundJoin;
  onHostStarted?: (pid: number | undefined) => void;
  log?: (message: string) => void;
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
    vanillaFileIndexPath,
    ensureVanillaIndex: async () => {
      await ensureWh3AssetHostVanillaCache();
    },
    gameDataFolder: options.dataFolder,
    dbSchemaPath: fs.existsSync(schemaPath) ? schemaPath : undefined,
    gameIdentity: () => computeGameIdentity(getVanillaPackPathsInLoadOrder()),
    schemaDigest: async () => (fs.existsSync(schemaPath) ? hashFileSha256(schemaPath) : "none"),
    compressRigidModels: appData.isRigidModelV2CompressionEnabled,
    lowPriority: options.lowPriority,
    background: options.background,
    onHostStarted: options.onHostStarted,
    loadOrder: options.loadOrder,
    hasVisualAssets: packHasOptimizableVisuals,
    parentProcessId: process.pid,
    log: options.log ?? ((message) => console.log(`[optimizer] ${message}`)),
  });
};
