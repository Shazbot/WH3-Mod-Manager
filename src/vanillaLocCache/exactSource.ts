import {
  parseLocTable,
  readPackIndex,
  readPayload,
  type CorePack,
  type CorePackEntry,
  type PackGame,
} from "../packCore";
import * as crypto from "crypto";
import { canonicalizeExistingPath } from "../vanillaCacheIdentity";
import { collator } from "../utility/packFileSorting";
import { normalizePackFilePath, normalizePackFilePathKey, hasParentSegment } from "../utility/packFilePathUtils";
import { VANILLA_LOC_CACHE_DECODER_REVISION, VANILLA_LOC_CACHE_EXACT_SOURCE_FORMAT } from "./format";
import type { VanillaLocCacheEntry } from "./build";

export { VANILLA_LOC_CACHE_DECODER_REVISION, VANILLA_LOC_CACHE_EXACT_SOURCE_FORMAT };

export class VanillaLocSourceReadCanceled extends Error {
  constructor() {
    super("Vanilla localisation source read canceled");
    this.name = "VanillaLocSourceReadCanceled";
  }
}

export interface ExactVanillaLocSourceOptions {
  shouldCancel?: () => boolean;
  assertSourceCurrent?: (pack: CorePack) => Promise<void>;
}

export type ExactVanillaLocFileOrder = "gui" | "packIndex";

export interface ExactVanillaLocPackSet {
  game: PackGame;
  order: ExactVanillaLocFileOrder;
  orderFingerprint: string;
  packs: Array<{
    pack: CorePack;
    locEntries: CorePackEntry[];
  }>;
}

/** Indexes a pack set and fingerprints the LOC file order used by its consumer. */
export const indexExactVanillaLocPackSet = (
  packPaths: readonly string[],
  game: PackGame,
  order: ExactVanillaLocFileOrder,
  getPackIndex: (packPath: string, game: PackGame) => CorePack = (packPath, selectedGame) =>
    readPackIndex(packPath, { game: selectedGame }),
): ExactVanillaLocPackSet => {
  const packs: ExactVanillaLocPackSet["packs"] = [];
  const fingerprintParts: Array<[canonicalPackPath: string, locPaths: string[]]> = [];

  for (const packPath of packPaths) {
    const canonicalPackPath = canonicalizeExistingPath(packPath);
    const pack = getPackIndex(canonicalPackPath, game);
    const locEntries = pack.entries.filter((entry) =>
      order === "gui" ? entry.name.endsWith(".loc") : entry.name.toLowerCase().endsWith(".loc"),
    );
    const seenLocPaths = new Set<string>();
    for (const entry of locEntries) {
      const normalizedPath = normalizePackFilePath(entry.name);
      if (
        !normalizedPath ||
        entry.name.startsWith("\\") ||
        entry.name.startsWith("/") ||
        /^[a-z]:/i.test(normalizedPath) ||
        hasParentSegment(normalizedPath)
      ) {
        throw new Error(`Invalid LOC path ${JSON.stringify(entry.name)} in ${packPath}`);
      }
      const pathKey = normalizePackFilePathKey(normalizedPath);
      if (seenLocPaths.has(pathKey)) {
        throw new Error(`Duplicate LOC path ${JSON.stringify(entry.name)} in ${packPath}`);
      }
      seenLocPaths.add(pathKey);
    }
    if (order === "gui") locEntries.sort((first, second) => collator.compare(first.name, second.name));
    fingerprintParts.push([canonicalPackPath, locEntries.map((entry) => entry.name)]);
    packs.push({ pack, locEntries });
  }

  return {
    game,
    order,
    orderFingerprint: crypto.createHash("sha256").update(JSON.stringify(fingerprintParts)).digest("hex"),
    packs,
  };
};

/** Reads and validates LOC data through packCore, retaining each row's source file and row index. */
export const readExactVanillaLocEntries = async (
  packSet: ExactVanillaLocPackSet,
  options: ExactVanillaLocSourceOptions = {},
): Promise<VanillaLocCacheEntry[]> => {
  const entries: VanillaLocCacheEntry[] = [];
  const checkCanceled = () => {
    if (options.shouldCancel?.()) throw new VanillaLocSourceReadCanceled();
  };

  for (const { pack, locEntries } of packSet.packs) {
    checkCanceled();
    for (const entry of locEntries) {
      await options.assertSourceCurrent?.(pack);
      const payload = await readPayload(pack, entry, { game: packSet.game });
      await options.assertSourceCurrent?.(pack);
      checkCanceled();
      const parsed = parseLocTable(payload);
      for (let rowIndex = 0; rowIndex < parsed.rows.length; rowIndex++) {
        const row = parsed.rows[rowIndex];
        const key = row.cells[0]?.fields[0]?.val;
        const value = row.cells[1]?.fields[0]?.val;
        if (typeof key !== "string" || typeof value !== "string") {
          throw new Error(`Invalid LOC row ${rowIndex} in ${entry.name} from ${pack.path}`);
        }
        if (key !== "") {
          entries.push([key, value, `${pack.path}\0${entry.name}`, rowIndex]);
        }
      }
    }
  }

  checkCanceled();
  return entries;
};

export const EXACT_VANILLA_LOC_SOURCE_FORMAT = VANILLA_LOC_CACHE_EXACT_SOURCE_FORMAT;
export const EXACT_VANILLA_LOC_DECODER_REVISION = VANILLA_LOC_CACHE_DECODER_REVISION;
