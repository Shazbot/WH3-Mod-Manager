/**
 * Which vanilla pack holds each vanilla file, as one searchable byte block.
 *
 * A Warhammer III install has ~260 vanilla packs holding ~680,000 files between them, and answering
 * "which pack has this file" used to mean parsing every pack's index - about two seconds, repeated
 * per node, per flow run. Holding those names as JS strings is worse than the text suggests: 38 MB of
 * characters costs ~57 MB as strings and ~81 MB once keyed in a Map, because the per-entry overhead
 * dwarfs the text.
 *
 * So the names live front-coded instead, the same representation the vanilla DB cache uses for its
 * string pool: 12.5 MB held, an exact lookup in microseconds, and a folder listing as a contiguous
 * rank range. See `../vanillaDbCache/frontCodedBlock` for why that beats a trie.
 *
 * Everything here is pure so the format can be tested without a game install; `./store` owns the
 * filesystem and the cache file.
 */

import {
  FrontCodedBlock,
  buildFrontCodedBlock,
  findFrontCodedPrefixRange,
  findFrontCodedRank,
  forEachFrontCodedEntry,
  readFrontCodedEntry,
} from "../vanillaDbCache/frontCodedBlock";

/** "WVPI". Guards against handing the decoder some other cache file. */
const MAGIC = 0x57565049;
/** Bumped whenever the layout below changes, which makes every existing file stale rather than wrong. */
const FORMAT_VERSION = 1;
const HEADER_BYTES = 32;

/** Pack ids are stored as Uint16, so the manifest cannot name more packs than this. */
export const MAX_INDEXED_PACKS = 0xffff;

/**
 * What the index was built from. A mismatch means rebuild.
 *
 * manifest.txt is rewritten by a game update and lists every vanilla pack, so its size and mtime
 * stand in for "the vanilla files changed" - one stat rather than 260.
 */
export interface VanillaPackIndexIdentity {
  game: string;
  dataFolder: string;
  manifestSize: number;
  manifestMtimeMs: number;
  packCount: number;
}

export interface VanillaPackIndex {
  identity: VanillaPackIndexIdentity;
  /** Every distinct file path, lowercased, in sort order. */
  block: FrontCodedBlock;
  /** For each rank, the index into `packNames` of the pack that wins for that path. */
  packIdByRank: Uint16Array;
  /** Pack file names in load order, so a bigger id means a pack the game loads later. */
  packNames: string[];
}

/** One pack's contribution, as the pack's own file list. */
export interface VanillaPackFileNames {
  packName: string;
  fileNames: readonly string[];
}

/**
 * Paths are compared lowercased with backslashes, matching `matchesTextFileTarget`, so a target
 * written either way finds the same file.
 *
 * Lowercasing is lossless for the packs this indexes: across a current Warhammer III install every
 * one of the 680,000 names is already lowercase. The only exceptions are the three packs whose header
 * sets mask bit 0x40 (boot, shaders, shaders_bl), whose index layout `readPack` misreads into
 * mojibake - which it does identically whether or not this index is involved, so the two agree.
 */
export const normalizeVanillaPackPath = (packFilePath: string): string =>
  packFilePath.replace(/\//g, "\\").toLowerCase();

/**
 * Builds the index from each pack's file list.
 *
 * `packs` runs lowest priority first - manifest order - and a later pack overwrites an earlier one
 * for a path they both carry, which is the pack the game would load.
 */
export const buildVanillaPackIndex = (
  identity: VanillaPackIndexIdentity,
  packs: readonly VanillaPackFileNames[],
): VanillaPackIndex => {
  if (packs.length > MAX_INDEXED_PACKS) {
    throw new Error(`Cannot index ${packs.length} packs, the format holds at most ${MAX_INDEXED_PACKS}`);
  }

  const packIdByPath = new Map<string, number>();
  packs.forEach((pack, packId) => {
    for (const fileName of pack.fileNames) packIdByPath.set(normalizeVanillaPackPath(fileName), packId);
  });

  const sortedPaths = [...packIdByPath.keys()].sort();
  const packIdByRank = new Uint16Array(sortedPaths.length);
  for (let rank = 0; rank < sortedPaths.length; rank++) {
    packIdByRank[rank] = packIdByPath.get(sortedPaths[rank]) as number;
  }
  // Released before the block is allocated: building this index is the peak-memory moment of the
  // whole cache, and the map is the largest thing in it.
  packIdByPath.clear();

  return {
    identity,
    block: buildFrontCodedBlock(sortedPaths),
    packIdByRank,
    packNames: packs.map((pack) => pack.packName),
  };
};

export const encodeVanillaPackIndex = (index: VanillaPackIndex): Buffer => {
  const identityBytes = Buffer.from(JSON.stringify(index.identity), "utf8");
  const packNameBytes = Buffer.from(index.packNames.join("\n"), "utf8");
  const blockBytes = Buffer.from(index.block.bytes.buffer, index.block.bytes.byteOffset, index.block.bytes.byteLength);
  const checkpointBytes = Buffer.from(
    index.block.checkpoints.buffer,
    index.block.checkpoints.byteOffset,
    index.block.checkpoints.byteLength,
  );
  const packIdBytes = Buffer.from(
    index.packIdByRank.buffer,
    index.packIdByRank.byteOffset,
    index.packIdByRank.byteLength,
  );

  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(FORMAT_VERSION, 4);
  header.writeUInt32LE(identityBytes.length, 8);
  header.writeUInt32LE(index.block.count, 12);
  header.writeUInt32LE(blockBytes.length, 16);
  header.writeUInt32LE(checkpointBytes.length, 20);
  header.writeUInt32LE(packIdBytes.length, 24);
  header.writeUInt32LE(packNameBytes.length, 28);

  return Buffer.concat([header, identityBytes, blockBytes, checkpointBytes, packIdBytes, packNameBytes]);
};

/**
 * Reads an encoded index, or undefined if the bytes are not one.
 *
 * Corruption is never thrown: the caller can always rebuild, which is the point of a cache.
 */
export const decodeVanillaPackIndex = (bytes: Buffer): VanillaPackIndex | undefined => {
  try {
    if (bytes.length < HEADER_BYTES) return undefined;
    if (bytes.readUInt32LE(0) !== MAGIC) return undefined;
    if (bytes.readUInt32LE(4) !== FORMAT_VERSION) return undefined;

    const identityLength = bytes.readUInt32LE(8);
    const count = bytes.readUInt32LE(12);
    const blockLength = bytes.readUInt32LE(16);
    const checkpointLength = bytes.readUInt32LE(20);
    const packIdLength = bytes.readUInt32LE(24);
    const packNameLength = bytes.readUInt32LE(28);

    let at = HEADER_BYTES;
    const readRegion = (length: number): Buffer => {
      const region = bytes.subarray(at, at + length);
      if (region.length !== length) throw new Error("truncated");
      at += length;
      return region;
    };

    const identity = JSON.parse(readRegion(identityLength).toString("utf8")) as VanillaPackIndexIdentity;
    // Each view gets its own copy: a typed array over the shared buffer would need its region to
    // land on that type's alignment, which nothing in the layout guarantees.
    const blockBytes = new Uint8Array(readRegion(blockLength));
    const checkpoints = new Uint32Array(new Uint8Array(readRegion(checkpointLength)).buffer);
    const packIdByRank = new Uint16Array(new Uint8Array(readRegion(packIdLength)).buffer);
    const packNamesText = readRegion(packNameLength).toString("utf8");
    const packNames = packNamesText.length === 0 ? [] : packNamesText.split("\n");

    if (packIdByRank.length !== count) return undefined;

    return { identity, block: { bytes: blockBytes, checkpoints, count }, packIdByRank, packNames };
  } catch {
    return undefined;
  }
};

export const isVanillaPackIndexCurrent = (
  index: VanillaPackIndex,
  identity: VanillaPackIndexIdentity,
): boolean =>
  index.identity.game === identity.game &&
  index.identity.dataFolder === identity.dataFolder &&
  index.identity.manifestSize === identity.manifestSize &&
  index.identity.manifestMtimeMs === identity.manifestMtimeMs &&
  index.identity.packCount === identity.packCount;

const packNameAtRank = (index: VanillaPackIndex, rank: number): string | undefined =>
  index.packNames[index.packIdByRank[rank]];

/** The vanilla pack the game would load this exact path from, or undefined if no vanilla pack has it. */
export const findVanillaPackContaining = (
  index: VanillaPackIndex,
  packFilePath: string,
): string | undefined => {
  const rank = findFrontCodedRank(index.block, normalizeVanillaPackPath(packFilePath));
  return rank === -1 ? undefined : packNameAtRank(index, rank);
};

/**
 * Every vanilla file under a folder, mapped to the pack that wins for it.
 *
 * Sort order puts a folder's files together, so this is a rank range rather than a scan - which is
 * what lets a caller ask about a folder without a table saying in advance which pack holds it.
 */
export const collectVanillaFilesUnderPrefix = (
  index: VanillaPackIndex,
  prefix: string,
): Map<string, string> => {
  const normalizedPrefix = normalizeVanillaPackPath(prefix);
  const { start, end } = findFrontCodedPrefixRange(index.block, normalizedPrefix);
  const filesByPath = new Map<string, string>();
  for (let rank = start; rank < end; rank++) {
    const packFilePath = readFrontCodedEntry(index.block, rank);
    const packName = packNameAtRank(index, rank);
    if (packFilePath !== undefined && packName !== undefined) filesByPath.set(packFilePath, packName);
  }
  return filesByPath;
};

/**
 * The distinct vanilla packs that win at least one file under a folder, in load order.
 *
 * Packs whose every file there is overridden by a later pack are left out, because reading them
 * would only produce copies the game never loads.
 */
export const findVanillaPacksUnderPrefix = (index: VanillaPackIndex, prefix: string): string[] => {
  const { start, end } = findFrontCodedPrefixRange(index.block, normalizeVanillaPackPath(prefix));
  const packIds = new Set<number>();
  for (let rank = start; rank < end; rank++) packIds.add(index.packIdByRank[rank]);
  return [...packIds]
    .sort((first, second) => first - second)
    .map((packId) => index.packNames[packId])
    .filter((packName): packName is string => packName !== undefined);
};

/**
 * Every vanilla file the predicate accepts, mapped to the pack that wins for it.
 *
 * This walks all ~680,000 paths, so it is the slow way in - for an exact path or a folder, use the
 * two above. It exists for rules matched on file name or regex, which sort order cannot narrow.
 */
export const collectVanillaFilesMatching = (
  index: VanillaPackIndex,
  matches: (packFilePath: string) => boolean,
): Map<string, string> => {
  const filesByPath = new Map<string, string>();
  forEachFrontCodedEntry(index.block, (packFilePath, rank) => {
    if (!matches(packFilePath)) return;
    const packName = packNameAtRank(index, rank);
    if (packName !== undefined) filesByPath.set(packFilePath, packName);
  });
  return filesByPath;
};
