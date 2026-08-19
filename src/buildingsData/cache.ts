/**
 * The Buildings disk cache, split in two.
 *
 * The derived Buildings model cannot be combined a piece at a time: it has to be built from the
 * complete row set so that overrides and relationships are resolved in the same order as the game.
 * The expensive part that can be reused, however, is the raw source data. Keep the game's rows and
 * localisation snapshot in one cache, and one independently reusable segment for every mod pack.
 *
 *   buildings/vanilla.bin  db.pack, UI frame, startpos files, and vanilla locs
 *   buildings/mods.bin     one raw source segment per mod pack
 */
import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import type { BuildingsCloneSourcePackPaths, BuildingsTableRows } from "./types";

/** Bump whenever the extraction rules or cached shape change. */
const BUILDINGS_CACHE_VERSION = 1;
/** Subfolder under `app.getPath("userData")`, so the two files stay together. */
export const BUILDINGS_CACHE_DIR = "buildings";
const VANILLA_CACHE_FILE = "vanilla.bin";
const MODS_CACHE_FILE = "mods.bin";

/** What one source contributes before the rows are merged and derived. */
export interface BuildingsSource {
  tables: BuildingsTableRows;
  localizations: Record<string, string>;
  /** Vanilla construction-panel frame, retained so it is not read again on every mod switch. */
  buildingFrame?: string;
  /** Source paths for the rows DB Clone can open. */
  cloneSourcePackPaths?: BuildingsCloneSourcePackPaths;
}

/** A pack's identity on disk. `-1, -1` records a pack that could not be stat'd. */
export type PackIdentity = readonly [size: number, mtimeMs: number];

export interface BuildingsModSegment extends BuildingsSource {
  identity: PackIdentity;
  /** For LRU pruning. Refreshed whenever a build reuses or rebuilds the segment. */
  lastUsedMs: number;
}

export type BuildingsModSegments = Record<string, BuildingsModSegment>;

export interface BuildingsVanillaSignatureInputs {
  feature: number;
  game: string;
  schema: string | undefined;
  /** db.pack, the building frame pack, localisation packs, and vanilla startpos files. */
  identities: Array<readonly [string, number, number]>;
}

type VanillaDiskPayload = {
  version: number;
  signature: string;
  /** Optional so cache files written before diagnostic inputs were added remain readable. */
  signatureInputs?: BuildingsVanillaSignatureInputs;
} & BuildingsSource;

type ModsDiskPayload = {
  version: number;
  segments: BuildingsModSegments;
};

/** Keep the same bounded LRU policy as the Ancillaries cache. */
const MOD_SEGMENT_CAP = 100;

let cachedVanilla: VanillaDiskPayload | undefined;
let cachedModSegments: BuildingsModSegments | undefined;

const cacheDir = (userDataPath: string) => nodePath.join(userDataPath, BUILDINGS_CACHE_DIR);

const readCompressedJson = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    const compressed = await fs.promises.readFile(filePath);
    const json = await zstdDecompress(compressed);
    return JSON.parse(json.toString("utf8")) as T;
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode !== "ENOENT") {
      console.log("Buildings cache: file could not be read or decoded", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return undefined;
  }
};

const writeCompressedJson = async (filePath: string, value: unknown, label: string): Promise<void> => {
  try {
    await fs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });
    const json = Buffer.from(JSON.stringify(value), "utf8");
    const compressed = await zstdCompress(json, 1);
    await fs.promises.writeFile(filePath, compressed);
  } catch (error) {
    console.error(`Failed to save Buildings ${label} cache:`, error);
  }
};

export const describeBuildingsVanillaSignatureChanges = (
  previous: BuildingsVanillaSignatureInputs | undefined,
  current: BuildingsVanillaSignatureInputs,
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

  const previousOrder = previous.identities.map(([path]) => path);
  const currentOrder = current.identities.map(([path]) => path);
  if (
    previousOrder.length === currentOrder.length &&
    JSON.stringify([...previousOrder].sort()) === JSON.stringify([...currentOrder].sort()) &&
    JSON.stringify(previousOrder) !== JSON.stringify(currentOrder)
  ) {
    changes.push("pack identity order changed");
  }

  return changes.length > 0 ? changes : ["signature inputs match; cache signature generation changed"];
};

// Keep the public names parallel with the Ancillaries cache; the longer aliases above make call
// sites that import both caches readable without collisions.
export const describeVanillaSignatureChanges = describeBuildingsVanillaSignatureChanges;

// ---------------------------------------------------------------------------
// Vanilla half
// ---------------------------------------------------------------------------

export const loadVanillaBuildingsCache = async (
  userDataPath: string,
  signature: string,
  signatureInputs?: BuildingsVanillaSignatureInputs,
): Promise<BuildingsSource | undefined> => {
  if (cachedVanilla?.signature === signature && cachedVanilla.version === BUILDINGS_CACHE_VERSION) {
    return cachedVanilla;
  }
  const filePath = nodePath.join(cacheDir(userDataPath), VANILLA_CACHE_FILE);
  const payload = await readCompressedJson<VanillaDiskPayload>(filePath);
  if (!payload) {
    console.log("Buildings vanilla cache miss: no readable cache file", { filePath });
    return undefined;
  }
  if (payload.version !== BUILDINGS_CACHE_VERSION) {
    console.log("Buildings vanilla cache miss: version mismatch", {
      cachedVersion: payload.version,
      expectedVersion: BUILDINGS_CACHE_VERSION,
    });
    return undefined;
  }
  if (payload.signature !== signature) {
    console.log("Buildings vanilla cache miss: signature mismatch", {
      changedInputs: signatureInputs
        ? describeBuildingsVanillaSignatureChanges(payload.signatureInputs, signatureInputs)
        : ["current signature inputs were not provided"],
    });
    return undefined;
  }
  cachedVanilla = payload;
  return payload;
};

export const saveVanillaBuildingsCache = async (
  userDataPath: string,
  signature: string,
  source: BuildingsSource,
  signatureInputs?: BuildingsVanillaSignatureInputs,
): Promise<void> => {
  const payload: VanillaDiskPayload = {
    version: BUILDINGS_CACHE_VERSION,
    signature,
    signatureInputs,
    ...source,
  };
  await writeCompressedJson(nodePath.join(cacheDir(userDataPath), VANILLA_CACHE_FILE), payload, "vanilla");
  cachedVanilla = payload;
};

// ---------------------------------------------------------------------------
// Mod half
// ---------------------------------------------------------------------------

/** Segment keys are resolved, lower-cased paths so a differently-spelled path is still a hit. */
export const buildingsModSegmentKey = (packPath: string) => nodePath.resolve(packPath).toLowerCase();
export const modSegmentKey = buildingsModSegmentKey;

export const loadBuildingsModSegments = async (userDataPath: string): Promise<BuildingsModSegments> => {
  if (cachedModSegments) return cachedModSegments;
  const filePath = nodePath.join(cacheDir(userDataPath), MODS_CACHE_FILE);
  const payload = await readCompressedJson<ModsDiskPayload>(filePath);
  cachedModSegments = payload?.version === BUILDINGS_CACHE_VERSION && payload.segments ? payload.segments : {};
  return cachedModSegments;
};

/** Drops the least recently used segments once the file would exceed the cap. */
export const pruneBuildingsModSegments = (segments: BuildingsModSegments): BuildingsModSegments => {
  const entries = Object.entries(segments);
  if (entries.length <= MOD_SEGMENT_CAP) return segments;
  entries.sort((a, b) => b[1].lastUsedMs - a[1].lastUsedMs);
  return Object.fromEntries(entries.slice(0, MOD_SEGMENT_CAP));
};
export const pruneModSegments = pruneBuildingsModSegments;

export const saveBuildingsModSegments = async (
  userDataPath: string,
  segments: BuildingsModSegments,
): Promise<BuildingsModSegments> => {
  const pruned = pruneBuildingsModSegments(segments);
  await writeCompressedJson(
    nodePath.join(cacheDir(userDataPath), MODS_CACHE_FILE),
    { version: BUILDINGS_CACHE_VERSION, segments: pruned } satisfies ModsDiskPayload,
    "mod",
  );
  cachedModSegments = pruned;
  return pruned;
};

export const isSameBuildingsIdentity = (a: PackIdentity | undefined, b: PackIdentity | undefined) =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1];
export const isSameIdentity = isSameBuildingsIdentity;

/** A pack's identity, or `-1, -1` when it could not be stat'd. */
export const readBuildingsPackIdentity = async (packPath: string): Promise<PackIdentity> => {
  try {
    const stat = await fs.promises.stat(packPath);
    return [stat.size, stat.mtimeMs];
  } catch {
    return [-1, -1];
  }
};
export const readPackIdentity = readBuildingsPackIdentity;

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Raw rows and metadata in vanilla-first, mod-load-order order. */
export type MergedBuildingsSources = BuildingsSource;

/**
 * Concatenates vanilla rows and then each mod's rows. The Buildings builder performs the final
 * last-row-wins dedupe, matching the game's override behaviour.
 */
export const mergeBuildingsSources = (
  vanilla: BuildingsSource,
  modsInLoadOrder: Array<{ packPath: string; source: BuildingsSource }>,
): MergedBuildingsSources => {
  const tables: BuildingsTableRows = {};
  for (const [tableName, rows] of Object.entries(vanilla.tables)) tables[tableName] = [...rows];

  const localizations: Record<string, string> = { ...vanilla.localizations };
  const cloneSourcePackPaths: BuildingsCloneSourcePackPaths = {
    levels: { ...(vanilla.cloneSourcePackPaths?.levels ?? {}) },
    cultureVariants: { ...(vanilla.cloneSourcePackPaths?.cultureVariants ?? {}) },
    sets: { ...(vanilla.cloneSourcePackPaths?.sets ?? {}) },
  };

  for (const { packPath, source } of modsInLoadOrder) {
    for (const [tableName, rows] of Object.entries(source.tables)) {
      if (rows.length) (tables[tableName] ||= []).push(...rows);
    }
    Object.assign(localizations, source.localizations);
    for (const [key] of Object.entries(source.cloneSourcePackPaths?.levels ?? {})) {
      cloneSourcePackPaths.levels[key] = packPath;
    }
    for (const [key] of Object.entries(source.cloneSourcePackPaths?.cultureVariants ?? {})) {
      cloneSourcePackPaths.cultureVariants[key] = packPath;
    }
    for (const [key] of Object.entries(source.cloneSourcePackPaths?.sets ?? {})) {
      cloneSourcePackPaths.sets[key] = packPath;
    }
  }

  return {
    tables,
    localizations,
    buildingFrame: vanilla.buildingFrame,
    cloneSourcePackPaths,
  };
};

export const clearBuildingsMemoryCache = () => {
  cachedVanilla = undefined;
  cachedModSegments = undefined;
};
