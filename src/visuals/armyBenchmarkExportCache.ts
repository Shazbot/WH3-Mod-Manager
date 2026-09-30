export type ArmyBenchmarkExportSourceMod = {
  name?: string;
  path: string;
  loadOrder?: number;
};

export type ArmyBenchmarkExportVariantSelection = {
  slotPath: string;
  choiceIndex: number;
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
  variantSelections: readonly ArmyBenchmarkExportVariantSelection[] = [],
) =>
  JSON.stringify([
    normalizePath(assetPath),
    sourceMods.map(({ name, path, loadOrder }) => [name ?? "", normalizePath(path), loadOrder ?? null]),
    variantSelections.map(({ slotPath, choiceIndex }) => [normalizePath(slotPath), choiceIndex]),
  ]);

const ARMY_BENCHMARK_PASS_PARAM = "whmmBenchmarkPass";

/**
 * The export itself is intentionally reused between paired army passes, but the renderer should
 * still fetch the GLB and every sidecar texture as a fresh URL identity. Historical benchmarks
 * exported a new preview UUID for every pass, so preserving that cache behavior keeps load/decode
 * diagnostics comparable while avoiding the expensive duplicate host export.
 */
export const getArmyBenchmarkLoadUrl = (url: string, passToken: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "whmm:" || parsed.host !== "model-preview") return url;
  parsed.searchParams.set(ARMY_BENCHMARK_PASS_PARAM, passToken);
  return parsed.toString();
};

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
