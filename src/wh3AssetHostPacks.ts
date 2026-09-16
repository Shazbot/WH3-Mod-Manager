import * as nodePath from "node:path";
import appData from "./appData";
import { sortByNameAndLoadOrder } from "./modSortingHelpers";
import { getVanillaPackPathsInLoadOrder } from "./utility/vanillaPackPaths";
import type { Wh3AssetHostClient, Wh3AssetHostInitializeResult } from "./wh3AssetHostClient";

export type Wh3AssetHostMod = Pick<Mod, "name" | "path" | "loadOrder">;

export class Wh3AssetHostPackStateError extends Error {
  readonly code: "MissingVanillaPacks" | "MissingPackPaths";

  constructor(code: "MissingVanillaPacks" | "MissingPackPaths", message: string) {
    super(message);
    this.name = "Wh3AssetHostPackStateError";
    this.code = code;
  }
}

/**
 * Mirrors WH3AssetHost's Windows path identity closely enough for manager-owned
 * pack paths: path separators and case do not distinguish the same physical
 * pack. The manager stores absolute paths, so resolving relative paths here is
 * intentionally unnecessary and would make node tests platform-dependent.
 */
const packPathKey = (packPath: string): string => nodePath.win32.normalize(packPath).toLowerCase();

/**
 * Removes duplicate physical pack paths while preserving the highest-priority
 * occurrence. Input and output are both ordered lowest priority -> highest
 * priority, matching WH3AssetHost's "last added container wins" lookup rule.
 */
export const deduplicateWh3AssetHostPackPaths = (packPaths: readonly string[]): string[] => {
  const seen = new Set<string>();
  const resultReversed: string[] = [];

  for (let index = packPaths.length - 1; index >= 0; index--) {
    const packPath = packPaths[index]?.trim();
    if (!packPath) continue;
    const key = packPathKey(packPath);
    if (seen.has(key)) continue;
    seen.add(key);
    resultReversed.push(packPath);
  }

  return resultReversed.reverse();
};

/**
 * Builds the complete asset-host universe in game load order:
 *
 *   every installed vanilla pack (manifest order), then enabled mods in the
 *   same effective load order used elsewhere by the manager.
 *
 * WH3AssetHost resolves duplicate virtual files from the last supplied pack,
 * so this low -> high ordering is deliberate.
 */
export const buildWh3AssetHostPackPaths = (
  vanillaPackPaths: readonly string[],
  enabledMods: readonly Wh3AssetHostMod[],
): string[] => {
  if (vanillaPackPaths.length === 0) {
    throw new Wh3AssetHostPackStateError(
      "MissingVanillaPacks",
      "Cannot initialize WH3AssetHost without the current game's vanilla pack list.",
    );
  }

  const sortedEnabledModPaths = sortByNameAndLoadOrder([...enabledMods]).map((mod) => mod.path);
  const packPaths = deduplicateWh3AssetHostPackPaths([...vanillaPackPaths, ...sortedEnabledModPaths]);

  if (packPaths.length === 0) {
    throw new Wh3AssetHostPackStateError("MissingPackPaths", "No pack paths are available for WH3AssetHost.");
  }

  return packPaths;
};

/** Uses the same manifest-backed vanilla list and effective enabled-mod order as the main process. */
export const getCurrentWh3AssetHostPackPaths = (): string[] =>
  buildWh3AssetHostPackPaths(getVanillaPackPathsInLoadOrder(), appData.enabledMods);

/** Builds from an explicit renderer/session snapshot so Visuals and the host resolve the same mod universe. */
export const getWh3AssetHostPackPathsForMods = (enabledMods: readonly Wh3AssetHostMod[]): string[] =>
  buildWh3AssetHostPackPaths(getVanillaPackPathsInLoadOrder(), enabledMods);

const packStateKey = (packPaths: readonly string[], outputRoot: string): string =>
  `${packPathKey(outputRoot)}\n${packPaths.map(packPathKey).join("\n")}`;

/**
 * Owns the initialization revision for one running WH3AssetHost client.
 * Callers may pass either the current main-process state or a Visuals session's
 * explicit pack list; the host is only reinitialized when that effective state
 * or the output root actually changes.
 */
export class Wh3AssetHostPackInitializer {
  private initializedStateKey: string | null = null;

  constructor(private readonly client: Pick<Wh3AssetHostClient, "initialize">) {}

  ensureInitialized(outputRoot: string): Promise<Wh3AssetHostInitializeResult | null> {
    return this.ensureInitializedForPackPaths(getCurrentWh3AssetHostPackPaths(), outputRoot);
  }

  async ensureInitializedForPackPaths(
    packPaths: readonly string[],
    outputRoot: string,
  ): Promise<Wh3AssetHostInitializeResult | null> {
    const deduplicatedPackPaths = deduplicateWh3AssetHostPackPaths(packPaths);
    if (deduplicatedPackPaths.length === 0) {
      throw new Wh3AssetHostPackStateError("MissingPackPaths", "No pack paths are available for WH3AssetHost.");
    }

    const stateKey = packStateKey(deduplicatedPackPaths, outputRoot);
    if (stateKey === this.initializedStateKey) return null;

    // Only record the new state after a successful host swap. If initialize
    // fails, the host keeps its previous runtime and the next call retries.
    const result = await this.client.initialize({ packPaths: deduplicatedPackPaths, outputRoot });
    this.initializedStateKey = stateKey;
    return result;
  }

  reset(): void {
    this.initializedStateKey = null;
  }
}

/** One-shot helper for callers that intentionally want to force initialization. */
export const initializeWh3AssetHostForCurrentPackState = (
  client: Pick<Wh3AssetHostClient, "initialize">,
  outputRoot: string,
): Promise<Wh3AssetHostInitializeResult> =>
  client.initialize({
    packPaths: getCurrentWh3AssetHostPackPaths(),
    outputRoot,
  });
