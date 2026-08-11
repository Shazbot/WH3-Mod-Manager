import * as nodePath from "path";

export const VISUALS_DATA_CACHE_VERSION = 1;

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

export const createEmptyVisualsDataCache = (): VisualsDataDiskCache => ({
  version: VISUALS_DATA_CACHE_VERSION,
  entries: {},
});

export const getVisualsPackCacheKey = (packPath: string): string => {
  const resolved = nodePath.resolve(packPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export const isSameVisualsPackIdentity = (
  first: VisualsPackCacheIdentity,
  second: VisualsPackCacheIdentity,
): boolean =>
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
  schemaHash && entry?.tables?.schemaHash === schemaHash
    ? entry.tables.contribution
    : undefined;

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
export const mergeVisualsFileContributions = (
  contributions: VisualsFileResult[][],
): VisualsFileResult[] => {
  const filesByPath = new Map<string, VisualsFileResult>();
  for (const files of contributions) {
    for (const file of files) {
      filesByPath.set(file.path.replace(/\//g, "\\").toLowerCase(), file);
    }
  }
  return Array.from(filesByPath.values()).sort((first, second) =>
    first.path.localeCompare(second.path, "en"),
  );
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
  const unitToVariantRows = new Map<
    string,
    Array<{ faction: string; variantName: string }>
  >();
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
