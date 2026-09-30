export type ArmyBenchmarkExportSourceMod = {
  name?: string;
  path: string;
  loadOrder?: number;
};

export type ArmyBenchmarkExportCacheLookup<T> = {
  value: T;
  cacheHit: boolean;
};

export type ArmyBenchmarkExportCache<T> = {
  get: (key: string, create: () => Promise<T>) => Promise<ArmyBenchmarkExportCacheLookup<T>>;
  dispose: () => Promise<void>;
};

const normalizePath = (value: string) => value.replace(/\//g, "\\").toLowerCase();

/**
 * Identifies an export by both the asset and the complete source-mod snapshot.
 * The same VMD can resolve differently when the active source pack or load order changes.
 */
export const getArmyBenchmarkExportCacheKey = (
  assetPath: string,
  sourceMods: readonly ArmyBenchmarkExportSourceMod[],
) =>
  JSON.stringify([
    normalizePath(assetPath),
    sourceMods.map(({ name, path, loadOrder }) => [name ?? "", normalizePath(path), loadOrder ?? null]),
  ]);

/**
 * Caches one benchmark run's export promises and owns their cleanup. Failed exports are
 * cacheable values when the caller represents failures in its result type, while rejected
 * creators are removed so transient transport failures can be retried.
 */
export const createArmyBenchmarkExportCache = <T>(
  disposeValue: (value: T) => Promise<void> | void,
): ArmyBenchmarkExportCache<T> => {
  const entries = new Map<string, Promise<T>>();

  const get = async (key: string, create: () => Promise<T>): Promise<ArmyBenchmarkExportCacheLookup<T>> => {
    const cached = entries.get(key);
    if (cached) return { value: await cached, cacheHit: true };

    const pending = Promise.resolve().then(create);
    entries.set(key, pending);
    try {
      return { value: await pending, cacheHit: false };
    } catch (error) {
      if (entries.get(key) === pending) entries.delete(key);
      throw error;
    }
  };

  const dispose = async () => {
    const pendingEntries = [...entries.values()];
    entries.clear();
    const results = await Promise.allSettled(pendingEntries);
    await Promise.all(
      results.flatMap((result) =>
        result.status === "fulfilled" ? [Promise.resolve(disposeValue(result.value)).catch(() => undefined)] : [],
      ),
    );
  };

  return { get, dispose };
};
