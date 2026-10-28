import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as nodePath from "node:path";

export const FEATURE_MOD_SEGMENTS_STORE_VERSION = 1;

export interface FeatureModSegmentIdentity {
  size: number;
  mtimeMs: number;
}

export interface FeatureModSegmentIndexEntry extends FeatureModSegmentIdentity {
  /** Original pack spelling for consumers that must map paths across platforms. */
  sourcePackPath: string;
  /** Normalized lower-case absolute path used as the lookup key and payload filename input. */
  packPath: string;
  lastUsedMs: number;
}

export interface FeatureModSegmentsIndex {
  version: typeof FEATURE_MOD_SEGMENTS_STORE_VERSION;
  dataVersion: number;
  entries: Record<string, FeatureModSegmentIndexEntry>;
}

export interface FeatureModSegmentPayload<T = unknown> extends FeatureModSegmentIdentity {
  version: typeof FEATURE_MOD_SEGMENTS_STORE_VERSION;
  dataVersion: number;
  packPath: string;
  sourcePackPath: string;
  segment: T;
}

export interface FeatureModSegmentsStoreOptions<T extends { lastUsedMs: number }> {
  userDataPath: string;
  feature: "buildings" | "ancillaries" | "visuals";
  dataVersion: number;
  maxEntries: number;
  getIdentity: (segment: T) => FeatureModSegmentIdentity;
  isValidSegment: (value: unknown) => value is T;
  getSourcePackPath?: (segment: T) => string;
}

interface StoreState {
  key: string;
  userDataPath: string;
  feature: FeatureModSegmentsStoreOptions<{ lastUsedMs: number }>["feature"];
  dataVersion: number;
  index?: FeatureModSegmentsIndex;
  indexPromise?: Promise<FeatureModSegmentsIndex>;
  loaded: Map<string, { lastUsedMs: number }>;
  reads: Map<string, Promise<{ lastUsedMs: number } | undefined>>;
  revisions: Map<string, number>;
  generation: number;
  saveChain: Promise<void>;
}

const storeStates = new Map<string, StoreState>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isValidSegment = <T extends { lastUsedMs: number }>(
  options: FeatureModSegmentsStoreOptions<T>,
  value: unknown,
): value is T => {
  try {
    return options.isValidSegment(value);
  } catch {
    return false;
  }
};

/** Normalized pack keys are absolute and lower-cased on every platform. */
export const normalizeFeatureModSegmentPackPath = (packPath: string): string =>
  nodePath.resolve(packPath).toLowerCase();

const isNormalizedAbsolutePath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value === value.toLowerCase() &&
  (nodePath.isAbsolute(value) || nodePath.win32.isAbsolute(value));

const hashPackKey = (normalizedPackPath: string): string =>
  createHash("sha256").update(normalizedPackPath).digest("hex");

export const getFeatureModSegmentsDirectory = (userDataPath: string, feature: string): string =>
  nodePath.join(nodePath.resolve(userDataPath), feature, "mods");

export const getFeatureModSegmentsIndexPath = (userDataPath: string, feature: string): string =>
  nodePath.join(getFeatureModSegmentsDirectory(userDataPath, feature), "index.bin");

/** Computes a payload path from the stored normalized key without resolving it on this host. */
export const getFeatureModSegmentPayloadPathForKey = (
  userDataPath: string,
  feature: string,
  normalizedPackPath: string,
): string =>
  nodePath.join(getFeatureModSegmentsDirectory(userDataPath, feature), `${hashPackKey(normalizedPackPath)}.bin`);

export const getFeatureModSegmentPayloadPath = (userDataPath: string, feature: string, packPath: string): string =>
  getFeatureModSegmentPayloadPathForKey(userDataPath, feature, normalizeFeatureModSegmentPackPath(packPath));

/** Parses the small metadata index and drops malformed rows independently. */
export const parseFeatureModSegmentsIndex = (
  value: unknown,
  dataVersion: number,
): FeatureModSegmentsIndex | undefined => {
  if (
    !isRecord(value) ||
    value.version !== FEATURE_MOD_SEGMENTS_STORE_VERSION ||
    value.dataVersion !== dataVersion ||
    !isRecord(value.entries)
  ) {
    return undefined;
  }

  const entries: Record<string, FeatureModSegmentIndexEntry> = {};
  for (const [key, candidate] of Object.entries(value.entries)) {
    if (
      !isNormalizedAbsolutePath(key) ||
      !isRecord(candidate) ||
      candidate.packPath !== key ||
      (candidate.sourcePackPath !== undefined && typeof candidate.sourcePackPath !== "string") ||
      !isFiniteNumber(candidate.size) ||
      !isFiniteNumber(candidate.mtimeMs) ||
      !isFiniteNumber(candidate.lastUsedMs)
    ) {
      continue;
    }
    entries[key] = {
      packPath: key,
      sourcePackPath: (candidate.sourcePackPath as string | undefined) ?? key,
      size: candidate.size,
      mtimeMs: candidate.mtimeMs,
      lastUsedMs: candidate.lastUsedMs,
    };
  }
  return { version: FEATURE_MOD_SEGMENTS_STORE_VERSION, dataVersion, entries };
};

export const isFeatureModSegmentPayload = (
  value: unknown,
  indexEntry: FeatureModSegmentIndexEntry,
  dataVersion: number,
): value is FeatureModSegmentPayload =>
  isRecord(value) &&
  value.version === FEATURE_MOD_SEGMENTS_STORE_VERSION &&
  value.dataVersion === dataVersion &&
  value.packPath === indexEntry.packPath &&
  value.sourcePackPath === indexEntry.sourcePackPath &&
  value.size === indexEntry.size &&
  value.mtimeMs === indexEntry.mtimeMs &&
  isRecord(value.segment);

const emptyIndex = (dataVersion: number): FeatureModSegmentsIndex => ({
  version: FEATURE_MOD_SEGMENTS_STORE_VERSION,
  dataVersion,
  entries: {},
});

const getStoreKey = (userDataPath: string, feature: string, dataVersion: number): string =>
  `${nodePath.resolve(userDataPath).toLowerCase()}\0${feature}\0${dataVersion}`;

const getStoreState = <T extends { lastUsedMs: number }>(options: FeatureModSegmentsStoreOptions<T>): StoreState => {
  const userDataPath = nodePath.resolve(options.userDataPath);
  const key = getStoreKey(userDataPath, options.feature, options.dataVersion);
  let state = storeStates.get(key);
  if (!state) {
    state = {
      key,
      userDataPath,
      feature: options.feature,
      dataVersion: options.dataVersion,
      loaded: new Map(),
      reads: new Map(),
      revisions: new Map(),
      generation: 0,
      saveChain: Promise.resolve(),
    };
    storeStates.set(key, state);
  }
  return state;
};

const readCompressedJson = async (filePath: string): Promise<unknown> => {
  const { readJsonDiskCache } = await import("./utility/jsonDiskCache");
  return readJsonDiskCache(filePath);
};

const readIndex = async (state: StoreState): Promise<FeatureModSegmentsIndex> => {
  if (state.index) return state.index;
  if (state.indexPromise) return state.indexPromise;

  const generationAtStart = state.generation;
  const pending = (async () => {
    const value = await readCompressedJson(getFeatureModSegmentsIndexPath(state.userDataPath, state.feature));
    const parsed = parseFeatureModSegmentsIndex(value, state.dataVersion) ?? emptyIndex(state.dataVersion);
    if (state.generation === generationAtStart && !state.index) state.index = parsed;
    return state.generation === generationAtStart ? (state.index ?? parsed) : parsed;
  })();
  state.indexPromise = pending;
  try {
    return await pending;
  } finally {
    if (state.indexPromise === pending) state.indexPromise = undefined;
  }
};

const readSegment = async <T extends { lastUsedMs: number }>(
  state: StoreState,
  options: FeatureModSegmentsStoreOptions<T>,
  packKey: string,
  indexEntry: FeatureModSegmentIndexEntry,
): Promise<T | undefined> => {
  const generationAtStart = state.generation;
  const revisionAtStart = state.revisions.get(packKey) ?? 0;
  const pending = (async () => {
    const payload = await readCompressedJson(
      getFeatureModSegmentPayloadPathForKey(state.userDataPath, state.feature, packKey),
    );
    let segment: T | undefined;
    if (
      isFeatureModSegmentPayload(payload, indexEntry, state.dataVersion) &&
      isValidSegment(options, payload.segment)
    ) {
      try {
        const identity = options.getIdentity(payload.segment);
        if (identity.size === indexEntry.size && identity.mtimeMs === indexEntry.mtimeMs) {
          segment = { ...payload.segment, lastUsedMs: indexEntry.lastUsedMs };
        }
      } catch {
        // Treat malformed feature data as a miss so the feature can rebuild it.
      }
    }
    if (state.generation !== generationAtStart) return undefined;
    if ((state.revisions.get(packKey) ?? 0) !== revisionAtStart) {
      return state.loaded.get(packKey) as T | undefined;
    }
    if (segment) state.loaded.set(packKey, segment);
    return segment;
  })();
  state.reads.set(packKey, pending);
  try {
    return (await pending) as T | undefined;
  } finally {
    if (state.reads.get(packKey) === pending) state.reads.delete(packKey);
  }
};

export const loadFeatureModSegments = async <T extends { lastUsedMs: number }>(
  options: FeatureModSegmentsStoreOptions<T>,
  requestedPackPaths?: readonly string[],
): Promise<Record<string, T>> => {
  const state = getStoreState(options);
  const generationAtStart = state.generation;
  const index = await readIndex(state);
  if (state.generation !== generationAtStart) return {};

  const requestedKeys = requestedPackPaths
    ? requestedPackPaths.map(normalizeFeatureModSegmentPackPath)
    : Object.keys(index.entries);
  const segments: Record<string, T> = {};
  await Promise.all(
    [...new Set(requestedKeys)].map(async (packKey) => {
      const memorySegment = state.loaded.get(packKey);
      if (memorySegment) {
        segments[packKey] = memorySegment as T;
        return;
      }
      const indexEntry = index.entries[packKey];
      if (!indexEntry) return;
      const pending = state.reads.get(packKey);
      const segment = pending
        ? ((await pending) as T | undefined)
        : await readSegment(state, options, packKey, indexEntry);
      if (state.generation === generationAtStart && segment) segments[packKey] = segment;
    }),
  );
  return segments;
};

const writeCompressedJsonAtomically = async (filePath: string, json: string): Promise<void> => {
  const { compress } = await import("@mongodb-js/zstd");
  const compressed = await compress(Buffer.from(json, "utf8"), 1);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(temporaryPath, compressed);
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
};

interface SaveUpdate<T> {
  packKey: string;
  sourcePackPath: string;
  segment: T;
  identity: FeatureModSegmentIdentity;
  lastUsedMs: number;
  revision: number;
  payloadJson?: string;
}

const cloneIndex = (index: FeatureModSegmentsIndex): FeatureModSegmentsIndex => ({
  version: index.version,
  dataVersion: index.dataVersion,
  entries: { ...index.entries },
});

const pruneIndex = (index: FeatureModSegmentsIndex, maxEntries: number): FeatureModSegmentsIndex => {
  const sorted = Object.entries(index.entries).sort((first, second) => second[1].lastUsedMs - first[1].lastUsedMs);
  const entries: FeatureModSegmentsIndex["entries"] = {};
  for (const [packKey, entry] of sorted.slice(0, maxEntries)) entries[packKey] = entry;
  return { ...index, entries };
};

export const saveFeatureModSegments = async <T extends { lastUsedMs: number }>(
  options: FeatureModSegmentsStoreOptions<T>,
  segments: Record<string, T>,
  dirtyPackPaths?: readonly string[],
): Promise<Record<string, T>> => {
  const state = getStoreState(options);
  const dirtyKeys = new Set((dirtyPackPaths ?? Object.keys(segments)).map(normalizeFeatureModSegmentPackPath));
  const loadedRevisionsAtStart = new Map(state.revisions);
  const updates: SaveUpdate<T>[] = [];
  for (const [packKey, segment] of Object.entries(segments)) {
    const normalizedKey = normalizeFeatureModSegmentPackPath(packKey);
    if (!isValidSegment(options, segment) || !isNormalizedAbsolutePath(normalizedKey)) continue;
    let identity: FeatureModSegmentIdentity;
    let sourcePackPath: string;
    try {
      identity = options.getIdentity(segment);
      sourcePackPath = options.getSourcePackPath?.(segment) ?? normalizedKey;
    } catch {
      continue;
    }
    const revision = (state.revisions.get(normalizedKey) ?? 0) + 1;
    state.revisions.set(normalizedKey, revision);
    const update: SaveUpdate<T> = {
      packKey: normalizedKey,
      sourcePackPath,
      segment,
      identity,
      lastUsedMs: isFiniteNumber(segment.lastUsedMs) ? segment.lastUsedMs : 0,
      revision,
    };
    if (dirtyKeys.has(normalizedKey)) {
      try {
        update.payloadJson = JSON.stringify({
          version: FEATURE_MOD_SEGMENTS_STORE_VERSION,
          dataVersion: options.dataVersion,
          packPath: normalizedKey,
          sourcePackPath: update.sourcePackPath,
          size: identity.size,
          mtimeMs: identity.mtimeMs,
          segment,
        } satisfies FeatureModSegmentPayload<T>);
      } catch (error) {
        console.error(`Failed to serialize ${options.feature} mod segment cache:`, normalizedKey, error);
      }
    }
    updates.push(update);
    state.loaded.set(normalizedKey, segment);
  }

  const generationAtStart = state.generation;
  const save = state.saveChain.then(async () => {
    const currentIndex = await readIndex(state);
    const nextIndex = cloneIndex(currentIndex);
    const logicalIndex = cloneIndex(currentIndex);

    for (const update of updates) {
      const metadata: FeatureModSegmentIndexEntry = {
        packPath: update.packKey,
        sourcePackPath: update.sourcePackPath,
        size: update.identity.size,
        mtimeMs: update.identity.mtimeMs,
        lastUsedMs: update.lastUsedMs,
      };
      logicalIndex.entries[update.packKey] = metadata;

      const previous = nextIndex.entries[update.packKey];
      const identityMatches = previous?.size === update.identity.size && previous.mtimeMs === update.identity.mtimeMs;
      let payloadWriteSucceeded = false;
      if (update.payloadJson || (!previous && !identityMatches)) {
        const payloadPath = getFeatureModSegmentPayloadPathForKey(state.userDataPath, state.feature, update.packKey);
        try {
          const payloadJson =
            update.payloadJson ??
            JSON.stringify({
              version: FEATURE_MOD_SEGMENTS_STORE_VERSION,
              dataVersion: options.dataVersion,
              packPath: update.packKey,
              sourcePackPath: update.sourcePackPath,
              size: update.identity.size,
              mtimeMs: update.identity.mtimeMs,
              segment: update.segment,
            } satisfies FeatureModSegmentPayload<T>);
          await writeCompressedJsonAtomically(payloadPath, payloadJson);
          payloadWriteSucceeded = true;
        } catch (error) {
          console.error(`Failed to save ${state.feature} mod segment cache:`, payloadPath, error);
        }
      }

      if (identityMatches || payloadWriteSucceeded) nextIndex.entries[update.packKey] = metadata;
    }

    const prunedIndex = pruneIndex(nextIndex, options.maxEntries);
    const logicalPrunedIndex = pruneIndex(logicalIndex, options.maxEntries);
    const persistedKeep = new Set(Object.keys(prunedIndex.entries));
    const logicalKeep = new Set(Object.keys(logicalPrunedIndex.entries));
    const indexChanged = JSON.stringify(prunedIndex) !== JSON.stringify(currentIndex);
    let published = !indexChanged;
    if (indexChanged) {
      const indexPath = getFeatureModSegmentsIndexPath(state.userDataPath, state.feature);
      try {
        await writeCompressedJsonAtomically(indexPath, JSON.stringify(prunedIndex));
        published = true;
        if (state.generation === generationAtStart) state.index = prunedIndex;
      } catch (error) {
        console.error(`Failed to save ${state.feature} mod segment index:`, indexPath, error);
      }
    }

    if (published && indexChanged) {
      for (const packKey of Object.keys(currentIndex.entries)) {
        if (persistedKeep.has(packKey)) continue;
        const payloadPath = getFeatureModSegmentPayloadPathForKey(state.userDataPath, state.feature, packKey);
        await fs.promises.rm(payloadPath, { force: true }).catch(() => undefined);
      }
    }

    const result: Record<string, T> = {};
    for (const update of updates) {
      if (logicalKeep.has(update.packKey)) result[update.packKey] = update.segment;
    }
    const updateByKey = new Map(updates.map((update) => [update.packKey, update]));
    for (const [packKey] of state.loaded) {
      if (logicalKeep.has(packKey)) continue;
      const revisionAtStart = updateByKey.get(packKey)?.revision ?? loadedRevisionsAtStart.get(packKey) ?? 0;
      if ((state.revisions.get(packKey) ?? 0) === revisionAtStart) state.loaded.delete(packKey);
    }
    if (state.generation === generationAtStart && published && !indexChanged) state.index = currentIndex;
    return result;
  });
  state.saveChain = save.then(
    () => undefined,
    () => undefined,
  );
  return save;
};

/** Invalidates pending load publication and in-memory payloads, while keeping save serialization. */
export const clearFeatureModSegmentsMemory = (
  feature?: FeatureModSegmentsStoreOptions<{ lastUsedMs: number }>["feature"],
  userDataPath?: string,
): void => {
  const normalizedRoot = userDataPath ? nodePath.resolve(userDataPath).toLowerCase() : undefined;
  for (const state of storeStates.values()) {
    if (feature && state.feature !== feature) continue;
    if (normalizedRoot && state.key.split("\0")[0] !== normalizedRoot) continue;
    state.generation++;
    state.index = undefined;
    state.indexPromise = undefined;
    state.loaded.clear();
    state.reads.clear();
    state.revisions.clear();
  }
};
