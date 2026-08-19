import * as nodePath from "path";
import * as fs from "fs";

/** Bump whenever the extraction rules or the cached shape change. */
export const VISUALS_DATA_CACHE_VERSION = 2;
/** Subfolder under `app.getPath("userData")`, so the two files stay together. */
export const VISUALS_CACHE_DIR = "visuals";
const VANILLA_CACHE_FILE = "vanilla.bin";
const MODS_CACHE_FILE = "mods.bin";

/** Keep the mod cache bounded while retaining disabled mods for quick re-enabling. */
const MOD_SEGMENT_CAP = 100;

export type VisualsFileExtension = "variantmeshdefinition" | "wsmodel" | "rigid_model_v2";

export interface VisualsFileResult {
  path: string;
  ext: VisualsFileExtension;
}

export interface VisualsTableContribution {
  variants: Array<[variantName: string, variantFilename: string]>;
  unitVariants: Array<[unitKey: string, faction: string, variantName: string]>;
  landUnits: string[];
}

export interface VisualsMergedTableData {
  variantsByName: Map<string, string>;
  unitToVariantRows: Map<string, Array<{ faction: string; variantName: string }>>;
  landUnitKeys: Set<string>;
  unitKeyToOriginPackPath: Map<string, string>;
}

export interface VisualsPackCacheIdentity {
  packPath: string;
  size: number;
  mtimeMs: number;
}

export interface VisualsPackCacheEntry {
  identity: VisualsPackCacheIdentity;
  tables?: {
    schemaHash: string;
    contribution: VisualsTableContribution;
  };
  /** Parsed localization entries. Payload buffers are deliberately never persisted. */
  locs?: Array<[key: string, value: string]>;
  /** Only searchable paths and extensions, never model or XML payloads. */
  files?: VisualsFileResult[];
}

export interface VisualsDataDiskCache {
  version: number;
  entries: Record<string, VisualsPackCacheEntry>;
}

export interface VisualsVanillaSignatureInputs {
  feature: number;
  game: string;
  schema: string | undefined;
  /** Vanilla pack identities which affect the cached source data. */
  identities: Array<readonly [path: string, size: number, mtimeMs: number]>;
}

/** One independently reusable mod-pack contribution. */
export interface VisualsModSegment extends VisualsPackCacheEntry {
  /** Refreshed whenever the segment is used, for LRU pruning. */
  lastUsedMs: number;
}

export type VisualsModSegments = Record<string, VisualsModSegment>;

type VanillaDiskPayload = VisualsDataDiskCache & {
  signature: string;
  signatureInputs?: VisualsVanillaSignatureInputs;
};

type ModsDiskPayload = {
  version: number;
  segments: VisualsModSegments;
};

let cachedVanilla: VanillaDiskPayload | undefined;
let cachedModSegments: VisualsModSegments | undefined;

const cacheDir = (userDataPath: string) => nodePath.join(userDataPath, VISUALS_CACHE_DIR);

const readVisualsCache = async <T>(filePath: string): Promise<T | undefined> => {
  // Keep the pure cache helpers importable in node tests without loading the optional native zstd
  // binding. The main-process disk path is the only caller that needs it.
  const { readJsonDiskCache } = await import("../utility/jsonDiskCache");
  return readJsonDiskCache<T>(filePath);
};

const writeVisualsCache = async (filePath: string, value: unknown): Promise<void> => {
  try {
    // `writeJsonDiskCache` intentionally does not create parent directories because most callers
    // write beside an existing cache. The split visuals cache owns a new subdirectory.
    await fs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });
  } catch (error) {
    console.error("Failed to create Visuals cache directory:", error);
    return;
  }
  const { writeJsonDiskCache } = await import("../utility/jsonDiskCache");
  await writeJsonDiskCache(filePath, value);
};

export const createEmptyVisualsDataCache = (): VisualsDataDiskCache => ({
  version: VISUALS_DATA_CACHE_VERSION,
  entries: {},
});

export const getVisualsPackCacheKey = (packPath: string): string => {
  const resolved = nodePath.resolve(packPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export const isSameVisualsPackIdentity = (first: VisualsPackCacheIdentity, second: VisualsPackCacheIdentity): boolean =>
  getVisualsPackCacheKey(first.packPath) === getVisualsPackCacheKey(second.packPath) &&
  first.size === second.size &&
  first.mtimeMs === second.mtimeMs;

export const getCurrentVisualsPackCacheEntry = (
  cache: VisualsDataDiskCache,
  identity: VisualsPackCacheIdentity,
): VisualsPackCacheEntry | undefined => {
  if (cache.version !== VISUALS_DATA_CACHE_VERSION) return undefined;
  const entry = cache.entries[getVisualsPackCacheKey(identity.packPath)];
  return entry && isSameVisualsPackIdentity(entry.identity, identity) ? entry : undefined;
};

export const describeVisualsVanillaSignatureChanges = (
  previous: VisualsVanillaSignatureInputs | undefined,
  current: VisualsVanillaSignatureInputs,
): string[] => {
  if (!previous) return ["cached signature inputs were not recorded"];

  const changes: string[] = [];
  if (previous.feature !== current.feature) {
    changes.push(`feature version changed (${previous.feature} -> ${current.feature})`);
  }
  if (previous.game !== current.game) changes.push(`game changed (${previous.game} -> ${current.game})`);
  if (previous.schema !== current.schema) changes.push("schema changed");

  const previousByPath = new Map(previous.identities.map(([path, size, mtimeMs]) => [path, { size, mtimeMs }]));
  const currentByPath = new Map(current.identities.map(([path, size, mtimeMs]) => [path, { size, mtimeMs }]));
  for (const path of new Set([...previousByPath.keys(), ...currentByPath.keys()])) {
    const before = previousByPath.get(path);
    const after = currentByPath.get(path);
    if (!before) changes.push(`pack identity added: ${path}`);
    else if (!after) changes.push(`pack identity removed: ${path}`);
    else if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      changes.push(`pack identity changed: ${path}`);
    }
  }

  return changes.length > 0 ? changes : ["signature inputs match; cache signature generation changed"];
};

/**
 * Loads the vanilla half. The old `userData/visuals-data-cache.bin` is deliberately not consulted:
 * the split cache starts clean and the normal extraction path repopulates it.
 */
export const loadVanillaVisualsCache = async (
  userDataPath: string,
  signature: string,
  signatureInputs?: VisualsVanillaSignatureInputs,
): Promise<VisualsDataDiskCache | undefined> => {
  if (cachedVanilla?.signature === signature && cachedVanilla.version === VISUALS_DATA_CACHE_VERSION) {
    return { version: cachedVanilla.version, entries: cachedVanilla.entries };
  }

  const filePath = nodePath.join(cacheDir(userDataPath), VANILLA_CACHE_FILE);
  const payload = await readVisualsCache<VanillaDiskPayload>(filePath);
  if (!payload || payload.version !== VISUALS_DATA_CACHE_VERSION || !payload.entries) return undefined;
  if (payload.signature !== signature) {
    console.log("Visuals vanilla cache miss: signature mismatch", {
      changedInputs: signatureInputs
        ? describeVisualsVanillaSignatureChanges(payload.signatureInputs, signatureInputs)
        : ["current signature inputs were not provided"],
    });
    return undefined;
  }

  cachedVanilla = payload;
  return { version: payload.version, entries: payload.entries };
};

export const saveVanillaVisualsCache = async (
  userDataPath: string,
  signature: string,
  cache: VisualsDataDiskCache,
  signatureInputs?: VisualsVanillaSignatureInputs,
): Promise<void> => {
  const payload: VanillaDiskPayload = {
    version: VISUALS_DATA_CACHE_VERSION,
    signature,
    signatureInputs,
    entries: cache.entries,
  };
  await writeVisualsCache(nodePath.join(cacheDir(userDataPath), VANILLA_CACHE_FILE), payload);
  cachedVanilla = payload;
};

/** Segment keys are resolved, lower-cased paths so a differently-spelled path is still a hit. */
export const visualsModSegmentKey = (packPath: string) => nodePath.resolve(packPath).toLowerCase();

export const getCurrentVisualsModSegment = (
  segments: VisualsModSegments,
  identity: VisualsPackCacheIdentity,
): VisualsModSegment | undefined => {
  const segment = segments[visualsModSegmentKey(identity.packPath)];
  return segment && isSameVisualsPackIdentity(segment.identity, identity) ? segment : undefined;
};

export const getOrCreateVisualsModSegment = (
  segments: VisualsModSegments,
  identity: VisualsPackCacheIdentity,
): VisualsModSegment => {
  const current = getCurrentVisualsModSegment(segments, identity);
  if (current) return current;

  const segment: VisualsModSegment = { identity, lastUsedMs: 0 };
  segments[visualsModSegmentKey(identity.packPath)] = segment;
  return segment;
};

export const loadVisualsModSegments = async (userDataPath: string): Promise<VisualsModSegments> => {
  if (cachedModSegments) return cachedModSegments;
  const filePath = nodePath.join(cacheDir(userDataPath), MODS_CACHE_FILE);
  const payload = await readVisualsCache<ModsDiskPayload>(filePath);
  cachedModSegments =
    payload?.version === VISUALS_DATA_CACHE_VERSION && payload.segments && typeof payload.segments === "object"
      ? payload.segments
      : {};
  return cachedModSegments;
};

/** Drops the least recently used segments once the file would exceed the cap. */
export const pruneVisualsModSegments = (segments: VisualsModSegments): VisualsModSegments => {
  const entries = Object.entries(segments);
  if (entries.length <= MOD_SEGMENT_CAP) return segments;
  entries.sort((first, second) => second[1].lastUsedMs - first[1].lastUsedMs);
  return Object.fromEntries(entries.slice(0, MOD_SEGMENT_CAP));
};

export const saveVisualsModSegments = async (
  userDataPath: string,
  segments: VisualsModSegments,
): Promise<VisualsModSegments> => {
  const pruned = pruneVisualsModSegments(segments);
  await writeVisualsCache(nodePath.join(cacheDir(userDataPath), MODS_CACHE_FILE), {
    version: VISUALS_DATA_CACHE_VERSION,
    segments: pruned,
  } satisfies ModsDiskPayload);
  cachedModSegments = pruned;
  return pruned;
};

export const clearVisualsMemoryCache = () => {
  cachedVanilla = undefined;
  cachedModSegments = undefined;
};

/**
 * Returns the current entry, replacing stale data when the pack changed. Sections can then be filled
 * independently, so a DB/schema change need not discard the still-valid file-name index.
 */
export const getOrCreateVisualsPackCacheEntry = (
  cache: VisualsDataDiskCache,
  identity: VisualsPackCacheIdentity,
): VisualsPackCacheEntry => {
  const current = getCurrentVisualsPackCacheEntry(cache, identity);
  if (current) return current;

  const entry: VisualsPackCacheEntry = { identity };
  cache.entries[getVisualsPackCacheKey(identity.packPath)] = entry;
  return entry;
};

export const getCurrentVisualsTableContribution = (
  entry: VisualsPackCacheEntry | undefined,
  schemaHash: string | undefined,
): VisualsTableContribution | undefined =>
  schemaHash && entry?.tables?.schemaHash === schemaHash ? entry.tables.contribution : undefined;

export const getVisualsFileExtension = (fileName: string): VisualsFileExtension | undefined => {
  const normalizedName = fileName.toLowerCase();
  if (normalizedName.endsWith(".variantmeshdefinition")) return "variantmeshdefinition";
  if (normalizedName.endsWith(".wsmodel")) return "wsmodel";
  if (normalizedName.endsWith(".rigid_model_v2")) return "rigid_model_v2";
  return undefined;
};

export const getVisualsFilesFromNames = (fileNames: Iterable<string>): VisualsFileResult[] => {
  const files: VisualsFileResult[] = [];
  for (const path of fileNames) {
    const ext = getVisualsFileExtension(path);
    if (ext) files.push({ path, ext });
  }
  return files;
};

/** Merge low-to-high priority contributions with the same override semantics as pack resolution. */
export const mergeVisualsFileContributions = (contributions: VisualsFileResult[][]): VisualsFileResult[] => {
  const filesByPath = new Map<string, VisualsFileResult>();
  for (const files of contributions) {
    for (const file of files) {
      filesByPath.set(file.path.replace(/\//g, "\\").toLowerCase(), file);
    }
  }
  return Array.from(filesByPath.values()).sort((first, second) => first.path.localeCompare(second.path, "en"));
};

/**
 * Merges decoded DB contributions. `tableOrder` is low-to-high override priority. `originOrder` is
 * highest-to-lowest because the first pack defining a unit owns the origin label.
 */
export const mergeVisualsTableContributions = (
  tableOrder: Array<{ packPath: string; contribution: VisualsTableContribution }>,
  originOrder: Array<{ packPath: string; contribution: VisualsTableContribution }>,
): VisualsMergedTableData => {
  const variantsByName = new Map<string, string>();
  const unitToVariantRows = new Map<string, Array<{ faction: string; variantName: string }>>();
  const landUnitKeys = new Set<string>();
  const unitKeyToOriginPackPath = new Map<string, string>();

  for (const { contribution } of tableOrder) {
    for (const [variantName, variantFilename] of contribution.variants) {
      variantsByName.set(variantName, variantFilename);
    }
    for (const [unitKey, faction, variantName] of contribution.unitVariants) {
      const rows = unitToVariantRows.get(unitKey) || [];
      const existingIndex = rows.findIndex((row) => row.faction === faction);
      const nextRow = { faction, variantName };
      if (existingIndex >= 0) rows.splice(existingIndex, 1, nextRow);
      else rows.push(nextRow);
      unitToVariantRows.set(unitKey, rows);
    }
    for (const unitKey of contribution.landUnits) landUnitKeys.add(unitKey);
  }

  for (const { packPath, contribution } of originOrder) {
    for (const unitKey of contribution.landUnits) {
      if (!unitKeyToOriginPackPath.has(unitKey)) {
        unitKeyToOriginPackPath.set(unitKey, packPath);
      }
    }
  }

  return { variantsByName, unitToVariantRows, landUnitKeys, unitKeyToOriginPackPath };
};

/** Merge localization entries in the same low-to-high priority order used by the live pack path. */
export const mergeVisualsLocContributions = (
  contributions: Array<Array<[key: string, value: string]>>,
): Map<string, string> => {
  const localizedNames = new Map<string, string>();
  for (const entries of contributions) {
    for (const [key, value] of entries) localizedNames.set(key, value);
  }
  return localizedNames;
};
