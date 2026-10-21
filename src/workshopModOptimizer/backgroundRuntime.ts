import * as fs from "node:fs";

import appData from "../appData";
import { type SelectionMod, comparableDirectory, selectCustomFolderStaging } from "./stagingSelection";
import { type BackgroundPass, type BackgroundStatus, BackgroundOptimizer } from "./background";
import { formatOptimizerLogLine } from "./logFormat";
import { packHasOptimizableVisuals } from "./packInspection";
import { createWorkshopModOptimizer, getWorkshopOptimizerCache, removeLegacyOptimizerCacheOnce } from "./runtime";
import type { WorkshopStagingOptimizerMod } from "../utility/workshopModStaging";

/**
 * Main-process side of the background optimization: it receives the enabled mods from the renderer,
 * plans them like a launch does (same selection rules, same keys) and hands the work to
 * `BackgroundOptimizer`. Results go to the cache only.
 */

export interface BackgroundModsPayload {
  /** The enabled mods in load order, as the launch sorts them. */
  mods: SelectionMod[];
  gamePath: string;
  dataFolder: string;
}

export interface OptimizerBackgroundSettings {
  optimize: boolean;
  workshopModStagingMode: string;
  currentGame: string;
}

interface Hooks {
  getDataPackNames: (dataFolder: string) => Promise<Set<string>>;
  sendStatus: (status: BackgroundStatus) => void;
}

let hooks: Hooks | undefined;
let background: BackgroundOptimizer<BackgroundModsPayload> | undefined;
let lastPayload: BackgroundModsPayload | undefined;

const sourceLabel = (mod: SelectionMod) => (mod.sourceKind === "custom" ? "custom folder" : mod.sourceKind);

const planPass = async (payload: BackgroundModsPayload, signal: AbortSignal): Promise<BackgroundPass | undefined> => {
  if (!hooks) return undefined;
  await removeLegacyOptimizerCacheOnce();
  const cache = getWorkshopOptimizerCache(payload.gamePath);
  const optimizer = createWorkshopModOptimizer({
    cache,
    dataFolder: payload.dataFolder,
    loadOrder: payload.mods.map((mod) => ({ name: mod.name, path: mod.path })),
    lowPriority: true,
    log: (message) => console.log(`Optimizer (background): ${message}`),
  });
  if (!optimizer) return undefined;

  const dataPackNames = await hooks.getDataPackNames(payload.dataFolder);
  const folders = await selectCustomFolderStaging({
    mods: payload.mods,
    dataPackNames,
    hasVisualAssets: packHasOptimizableVisuals,
    listPackNames: async (directory) => {
      try {
        return new Set(
          (await fs.promises.readdir(directory))
            .filter((name) => name.toLowerCase().endsWith(".pack"))
            .map((name) => name.toLowerCase()),
        );
      } catch {
        return new Set<string>();
      }
    },
  });
  const stagedCustomPaths = new Set(folders.mods.map((mod) => mod.path));
  const candidates: WorkshopStagingOptimizerMod[] = [];
  const seen = new Set<string>();
  for (const mod of payload.mods) {
    if (!(mod.sourceKind === "workshop" || stagedCustomPaths.has(mod.path))) continue;
    if (dataPackNames.has(mod.name.toLowerCase()) || seen.has(mod.name.toLowerCase())) continue;
    seen.add(mod.name.toLowerCase());
    try {
      const stats = await fs.promises.stat(mod.path);
      if (stats.isFile()) {
        candidates.push({
          name: mod.name,
          path: mod.path,
          sourceFingerprint: { size: stats.size, mtimeMs: stats.mtimeMs },
        });
      }
    } catch {
      // A pack that vanished is not planned.
    }
  }

  await optimizer.prepare(candidates, signal);
  const jobs: BackgroundPass["jobs"] = [];
  let considered = 0;
  for (const mod of candidates) {
    if (signal.aborted) break;
    const plan = await optimizer.plan(mod, signal);
    if (!plan) continue;
    considered++;
    if (!plan.cached) jobs.push({ mod, plan });
  }

  const byPath = new Map(payload.mods.map((mod) => [mod.path, mod] as const));
  return {
    jobs,
    considered,
    release: () => cache.unpinAll(),
    produce: (mod, plan, context) => optimizer.produce(mod, plan, context),
    describe: (job, result) => {
      const source = byPath.get(job.mod.path);
      return (
        "Optimizer (background): " +
        formatOptimizerLogLine({
          pack: job.mod.name,
          source: source ? (sourceLabel(source) as "workshop" | "custom folder" | "data") : "workshop",
          status:
            result.status === "ready"
              ? result.fromCache
                ? "restored"
                : "optimized"
              : result.status === "failed"
                ? "failed"
                : "skipped",
          failureMessage: result.status === "failed" ? result.message : undefined,
          record: optimizer.getRecord(job.mod.path),
        }) +
        (result.status === "stopped" ? " (stopped; it restarts when the background pass runs again)" : "")
      );
    },
  };
};

export const initOptimizerBackground = (newHooks: Hooks): BackgroundOptimizer<BackgroundModsPayload> => {
  hooks = newHooks;
  background ??= new BackgroundOptimizer<BackgroundModsPayload>({
    plan: planPass,
    isGameRunning: () => appData.isWH3Running,
    log: (message) => console.log(message),
    onStatus: (status) => hooks?.sendStatus(status),
  });
  return background;
};

export const getOptimizerBackground = () => background;

/** The renderer's mod list or settings changed. */
export const updateOptimizerBackground = (payload: BackgroundModsPayload, settings: OptimizerBackgroundSettings) => {
  if (!background) return;
  const applies = settings.optimize && settings.currentGame === "wh3" && settings.workshopModStagingMode === "copy";
  lastPayload = applies ? payload : undefined;
  background.notifyChange(lastPayload);
};

/** An enabled pack changed on disk (a Workshop update or a local edit). */
export const optimizerPackChanged = (packPath: string) => {
  if (!background || !lastPayload) return;
  const key = packPath.replace(/\//g, "\\").toLowerCase();
  if (lastPayload.mods.some((mod) => mod.path.replace(/\//g, "\\").toLowerCase() === key)) {
    background.notifyChange(lastPayload);
  }
};

/** The game's packs changed (a patch): everything cached for the old game is stale. */
export const optimizerGameChanged = () => {
  if (background && lastPayload) background.notifyChange(lastPayload);
};

export const optimizerGameRunningChanged = (isRunning: boolean) => background?.gameRunningChanged(isRunning);

export { comparableDirectory };
