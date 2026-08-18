/**
 * The Ancillaries disk cache, split in two.
 *
 * Buildings and the Unit Viewer each key one monolithic file on a signature covering *every* pack,
 * so enabling any mod throws away the vanilla work too - and re-reading the game's ancillary tables
 * out of `db.pack` is the expensive half. Here the two halves are stored apart:
 *
 *   ancillaries/vanilla.bin  one payload, keyed on db.pack + the loc packs. No mod list, so
 *                            toggling a mod leaves it valid.
 *   ancillaries/mods.bin     one file, one segment per mod pack, each keyed on that pack's own
 *                            size+mtime. Changing, adding or removing one mod rewrites one segment
 *                            and leaves the rest of the file byte-for-byte identical.
 *
 * What is cached is the **raw rows per source**, not derived output: derivation has to run over the
 * merged row set anyway, so a per-half derived structure could not be merged back together.
 */
import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import { ANCILLARY_TABLES } from "./data";
import type { AncillariesTableRows } from "./types";

/** Bump whenever the extraction rules or the cached shape change. */
const ANCILLARIES_CACHE_VERSION = 2;
/** Subfolder under `app.getPath("userData")`, so the two files stay together. */
export const ANCILLARIES_CACHE_DIR = "ancillaries";
const VANILLA_CACHE_FILE = "vanilla.bin";
const MODS_CACHE_FILE = "mods.bin";

/**
 * How many mod segments to keep.
 *
 * Segments for mods that are no longer enabled are deliberately retained - re-enabling a mod is
 * common and its rows are already correct - but the file cannot grow without bound, so the least
 * recently used ones are dropped past this many.
 */
const MOD_SEGMENT_CAP = 100;

/** What one source contributes: its rows, and the loc entries the builder consumed from it. */
export interface AncillariesSource {
  tables: AncillariesTableRows;
  localizations: Record<string, string>;
}

/** A pack's identity on disk. `-1, -1` records a pack that could not be stat'd. */
export type PackIdentity = readonly [size: number, mtimeMs: number];

export interface AncillariesModSegment extends AncillariesSource {
  identity: PackIdentity;
  /** For LRU pruning. Refreshed every time a build reuses or rebuilds the segment. */
  lastUsedMs: number;
}

export type AncillariesModSegments = Record<string, AncillariesModSegment>;

export interface AncillariesVanillaSignatureInputs {
  feature: number;
  game: string;
  schema: string | undefined;
  /** db.pack and the localisation packs, resolved paths with size and mtime. */
  identities: Array<readonly [string, number, number]>;
}

type VanillaDiskPayload = {
  version: number;
  signature: string;
  signatureInputs?: AncillariesVanillaSignatureInputs;
} & AncillariesSource;

type ModsDiskPayload = {
  version: number;
  segments: AncillariesModSegments;
};

let cachedVanilla: VanillaDiskPayload | undefined;
let cachedModSegments: AncillariesModSegments | undefined;

const cacheDir = (userDataPath: string) => nodePath.join(userDataPath, ANCILLARIES_CACHE_DIR);

const readCompressedJson = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    const compressed = await fs.promises.readFile(filePath);
    const json = await zstdDecompress(compressed);
    return JSON.parse(json.toString("utf8")) as T;
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode !== "ENOENT") {
      console.log("Ancillaries cache: file could not be read or decoded", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return undefined;
  }
};

const writeCompressedJson = async (filePath: string, value: unknown): Promise<void> => {
  try {
    await fs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });
    const json = Buffer.from(JSON.stringify(value), "utf8");
    const compressed = await zstdCompress(json, 1);
    await fs.promises.writeFile(filePath, compressed);
  } catch (error) {
    console.error("Failed to save Ancillaries cache:", filePath, error);
  }
};

export const describeVanillaSignatureChanges = (
  previous: AncillariesVanillaSignatureInputs | undefined,
  current: AncillariesVanillaSignatureInputs,
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

// ---------------------------------------------------------------------------
// Vanilla half
// ---------------------------------------------------------------------------

export const loadVanillaAncillariesCache = async (
  userDataPath: string,
  signature: string,
  signatureInputs?: AncillariesVanillaSignatureInputs,
): Promise<AncillariesSource | undefined> => {
  if (cachedVanilla?.signature === signature && cachedVanilla.version === ANCILLARIES_CACHE_VERSION) {
    return { tables: cachedVanilla.tables, localizations: cachedVanilla.localizations };
  }
  const filePath = nodePath.join(cacheDir(userDataPath), VANILLA_CACHE_FILE);
  const payload = await readCompressedJson<VanillaDiskPayload>(filePath);
  if (!payload) {
    console.log("Ancillaries vanilla cache miss: no readable cache file", { filePath });
    return undefined;
  }
  if (payload.version !== ANCILLARIES_CACHE_VERSION) {
    console.log("Ancillaries vanilla cache miss: version mismatch", {
      cachedVersion: payload.version,
      expectedVersion: ANCILLARIES_CACHE_VERSION,
    });
    return undefined;
  }
  if (payload.signature !== signature) {
    console.log("Ancillaries vanilla cache miss: signature mismatch", {
      changedInputs: signatureInputs
        ? describeVanillaSignatureChanges(payload.signatureInputs, signatureInputs)
        : ["current signature inputs were not provided"],
    });
    return undefined;
  }
  cachedVanilla = payload;
  return { tables: payload.tables, localizations: payload.localizations };
};

export const saveVanillaAncillariesCache = async (
  userDataPath: string,
  signature: string,
  source: AncillariesSource,
  signatureInputs?: AncillariesVanillaSignatureInputs,
): Promise<void> => {
  const payload: VanillaDiskPayload = {
    version: ANCILLARIES_CACHE_VERSION,
    signature,
    signatureInputs,
    tables: source.tables,
    localizations: source.localizations,
  };
  await writeCompressedJson(nodePath.join(cacheDir(userDataPath), VANILLA_CACHE_FILE), payload);
  cachedVanilla = payload;
};

// ---------------------------------------------------------------------------
// Mod half
// ---------------------------------------------------------------------------

/** Segment keys are resolved, lower-cased paths so a differently-spelled path is still a hit. */
export const modSegmentKey = (packPath: string) => nodePath.resolve(packPath).toLowerCase();

export const loadAncillariesModSegments = async (userDataPath: string): Promise<AncillariesModSegments> => {
  if (cachedModSegments) return cachedModSegments;
  const filePath = nodePath.join(cacheDir(userDataPath), MODS_CACHE_FILE);
  const payload = await readCompressedJson<ModsDiskPayload>(filePath);
  cachedModSegments = payload?.version === ANCILLARIES_CACHE_VERSION && payload.segments ? payload.segments : {};
  return cachedModSegments;
};

/** Drops the least recently used segments once the file would exceed {@link MOD_SEGMENT_CAP}. */
export const pruneModSegments = (segments: AncillariesModSegments): AncillariesModSegments => {
  const entries = Object.entries(segments);
  if (entries.length <= MOD_SEGMENT_CAP) return segments;
  entries.sort((a, b) => b[1].lastUsedMs - a[1].lastUsedMs);
  return Object.fromEntries(entries.slice(0, MOD_SEGMENT_CAP));
};

export const saveAncillariesModSegments = async (
  userDataPath: string,
  segments: AncillariesModSegments,
): Promise<AncillariesModSegments> => {
  const pruned = pruneModSegments(segments);
  await writeCompressedJson(nodePath.join(cacheDir(userDataPath), MODS_CACHE_FILE), {
    version: ANCILLARIES_CACHE_VERSION,
    segments: pruned,
  } satisfies ModsDiskPayload);
  cachedModSegments = pruned;
  return pruned;
};

export const isSameIdentity = (a: PackIdentity | undefined, b: PackIdentity | undefined) =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1];

/** A pack's identity, or `-1, -1` when it could not be stat'd - which never matches a cached one. */
export const readPackIdentity = async (packPath: string): Promise<PackIdentity> => {
  try {
    const stat = await fs.promises.stat(packPath);
    return [stat.size, stat.mtimeMs];
  } catch {
    return [-1, -1];
  }
};

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergedAncillariesSources extends AncillariesSource {
  /** Ancillary key -> the pack that last defined it. Vanilla keys are absent. */
  originPackPathByAncillary: Record<string, string>;
}

/**
 * Concatenates vanilla rows and then each mod's, in load order.
 *
 * Nothing is collapsed here: `dedupeRowsByKey` in the builder keeps the last row per key, which is
 * exactly the game's override behaviour once the sources are in this order.
 */
export const mergeAncillariesSources = (
  vanilla: AncillariesSource,
  modsInLoadOrder: Array<{ packPath: string; source: AncillariesSource }>,
): MergedAncillariesSources => {
  const tables: AncillariesTableRows = {};
  for (const tableName of ANCILLARY_TABLES) {
    tables[tableName] = [...(vanilla.tables[tableName] ?? [])];
  }
  const localizations: Record<string, string> = { ...vanilla.localizations };
  const originPackPathByAncillary: Record<string, string> = {};

  for (const { packPath, source } of modsInLoadOrder) {
    for (const tableName of ANCILLARY_TABLES) {
      const rows = source.tables[tableName];
      if (rows?.length) (tables[tableName] ||= []).push(...rows);
    }
    Object.assign(localizations, source.localizations);
    for (const row of source.tables.ancillaries_tables ?? []) {
      const key = (row.key ?? "").trim();
      if (key) originPackPathByAncillary[key] = packPath;
    }
  }

  return { tables, localizations, originPackPathByAncillary };
};

export const clearAncillariesMemoryCache = () => {
  cachedVanilla = undefined;
  cachedModSegments = undefined;
};
