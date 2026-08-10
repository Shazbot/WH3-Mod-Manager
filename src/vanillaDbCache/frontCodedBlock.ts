/**
 * A sorted string set stored as one byte block, with prefixes shared between neighbours.
 *
 * This is the compression that makes the vanilla DB cache worth having: game keys repeat long
 * prefixes (`wh_main_grn_greenskins_...`), and sorting brings those neighbours together. Measured over
 * the WH3 tables it takes the distinct-string pool from 14.4 MB to 5.2 MB.
 *
 * Deliberately not a node-per-segment trie. One object per node with a children array - what
 * `src/utility/trie.ts` does - costs more in V8 object overhead for this many strings than the plain
 * strings it was meant to save, and searching a node's children is linear. A flat block has no
 * per-node overhead, supports binary search, and gives prefix matches as a contiguous rank range.
 *
 * Entries are addressed by **rank**, their position in sort order. Callers use the rank as the value's
 * id, which is what lets a prefix match become an integer range test.
 */

/**
 * Entries per checkpoint. Every checkpoint entry is stored whole, so reaching any rank costs at most
 * this many decode steps, and a chunk can be decoded without touching the one before it.
 */
export const FRONT_CODED_CHECKPOINT_INTERVAL = 64;

export interface FrontCodedBlock {
  bytes: Uint8Array;
  /** Byte offset of the first entry of each chunk of FRONT_CODED_CHECKPOINT_INTERVAL. */
  checkpoints: Uint32Array;
  count: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const decodeSuffix = (bytes: Uint8Array, start: number, end: number): string =>
  start === end ? "" : textDecoder.decode(bytes.subarray(start, end));

const isHighSurrogate = (codeUnit: number) => codeUnit >= 0xd800 && codeUnit <= 0xdbff;

/**
 * Length of the prefix the two share, in UTF-16 code units.
 *
 * Backs off a code unit rather than splitting a surrogate pair: half a pair is a different string
 * from the character it came from, so a split there would not round-trip.
 */
export const sharedPrefixLength = (previous: string, current: string): number => {
  const limit = Math.min(previous.length, current.length);
  let shared = 0;
  while (shared < limit && previous.charCodeAt(shared) === current.charCodeAt(shared)) shared++;
  if (shared > 0 && isHighSurrogate(previous.charCodeAt(shared - 1))) shared--;
  return shared;
};

const varintSize = (value: number) => {
  let size = 1;
  let remaining = value;
  while (remaining >= 0x80) {
    remaining >>>= 7;
    size++;
  }
  return size;
};

const writeVarint = (bytes: Uint8Array, offset: number, value: number): number => {
  let remaining = value;
  let position = offset;
  while (remaining >= 0x80) {
    bytes[position++] = (remaining & 0x7f) | 0x80;
    remaining >>>= 7;
  }
  bytes[position++] = remaining;
  return position;
};

const readVarint = (bytes: Uint8Array, offset: number): [value: number, nextOffset: number] => {
  let value = 0;
  let shift = 0;
  let position = offset;
  for (;;) {
    const byte = bytes[position++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, position];
    shift += 7;
  }
};

/**
 * Encodes values that are **already sorted**. The caller owns the ordering because ranks become ids,
 * and those ids are written into column data that must agree with this block.
 */
export const buildFrontCodedBlock = (sortedValues: readonly string[]): FrontCodedBlock => {
  const suffixes: Uint8Array[] = [];
  const sharedLengths: number[] = [];
  let totalBytes = 0;

  let previous = "";
  for (let rank = 0; rank < sortedValues.length; rank++) {
    const value = sortedValues[rank];
    // Chunk starts are stored whole so a chunk can be decoded on its own.
    const shared = rank % FRONT_CODED_CHECKPOINT_INTERVAL === 0 ? 0 : sharedPrefixLength(previous, value);
    const suffix = textEncoder.encode(value.slice(shared));

    sharedLengths.push(shared);
    suffixes.push(suffix);
    totalBytes += varintSize(shared) + varintSize(suffix.length) + suffix.length;
    previous = value;
  }

  const bytes = new Uint8Array(totalBytes);
  const checkpointCount = Math.ceil(sortedValues.length / FRONT_CODED_CHECKPOINT_INTERVAL);
  const checkpoints = new Uint32Array(checkpointCount);

  let offset = 0;
  for (let rank = 0; rank < sortedValues.length; rank++) {
    if (rank % FRONT_CODED_CHECKPOINT_INTERVAL === 0) {
      checkpoints[rank / FRONT_CODED_CHECKPOINT_INTERVAL] = offset;
    }
    offset = writeVarint(bytes, offset, sharedLengths[rank]);
    offset = writeVarint(bytes, offset, suffixes[rank].length);
    bytes.set(suffixes[rank], offset);
    offset += suffixes[rank].length;
  }

  return { bytes, checkpoints, count: sortedValues.length };
};

/** The value at a rank, decoded from the start of its chunk. */
export const readFrontCodedEntry = (block: FrontCodedBlock, rank: number): string | undefined => {
  if (rank < 0 || rank >= block.count) return undefined;

  const chunkStart = Math.floor(rank / FRONT_CODED_CHECKPOINT_INTERVAL) * FRONT_CODED_CHECKPOINT_INTERVAL;
  let offset = block.checkpoints[chunkStart / FRONT_CODED_CHECKPOINT_INTERVAL];
  let value = "";

  for (let current = chunkStart; current <= rank; current++) {
    const [shared, afterShared] = readVarint(block.bytes, offset);
    const [suffixLength, afterLength] = readVarint(block.bytes, afterShared);
    value = value.slice(0, shared) + decodeSuffix(block.bytes, afterLength, afterLength + suffixLength);
    offset = afterLength + suffixLength;
  }

  return value;
};

/** Every value in the block, in rank order. For building indexes, not for lookups. */
export const readAllFrontCodedEntries = (block: FrontCodedBlock): string[] => {
  const values: string[] = new Array(block.count);
  let offset = 0;
  let value = "";

  for (let rank = 0; rank < block.count; rank++) {
    const [shared, afterShared] = readVarint(block.bytes, offset);
    const [suffixLength, afterLength] = readVarint(block.bytes, afterShared);
    value = value.slice(0, shared) + decodeSuffix(block.bytes, afterLength, afterLength + suffixLength);
    values[rank] = value;
    offset = afterLength + suffixLength;
  }

  return values;
};

/**
 * Rank of the first value not ordered before `target`, i.e. where it would be inserted.
 *
 * Narrows to a chunk first by comparing only chunk-start values, which are readable without decoding
 * anything before them, then walks that chunk. So a lookup costs log2(count/64) cheap reads plus at
 * most 64 decode steps, rather than a full decode per binary search step.
 */
export const findFrontCodedLowerBound = (block: FrontCodedBlock, target: string): number => {
  if (block.count === 0) return 0;

  let lowChunk = 0;
  let highChunk = block.checkpoints.length;
  while (lowChunk < highChunk) {
    const midChunk = (lowChunk + highChunk) >>> 1;
    const chunkStartValue = readFrontCodedEntry(block, midChunk * FRONT_CODED_CHECKPOINT_INTERVAL);
    if (chunkStartValue !== undefined && chunkStartValue < target) lowChunk = midChunk + 1;
    else highChunk = midChunk;
  }

  // lowChunk is the first chunk starting at or after the target, so the target sits in the one before.
  const searchChunk = Math.max(0, lowChunk - 1);
  const scanStart = searchChunk * FRONT_CODED_CHECKPOINT_INTERVAL;
  const scanEnd = Math.min(block.count, scanStart + FRONT_CODED_CHECKPOINT_INTERVAL);

  // Decoded forward, each value from the one before. Calling readFrontCodedEntry per candidate would
  // restart from the chunk head every time, making the scan quadratic in the chunk size.
  let offset = block.checkpoints[searchChunk];
  let value = "";
  for (let rank = scanStart; rank < scanEnd; rank++) {
    const [shared, afterShared] = readVarint(block.bytes, offset);
    const [suffixLength, afterLength] = readVarint(block.bytes, afterShared);
    value = value.slice(0, shared) + decodeSuffix(block.bytes, afterLength, afterLength + suffixLength);
    offset = afterLength + suffixLength;
    if (value >= target) return rank;
  }
  return scanEnd;
};

/** Rank of an exact value, or -1. */
export const findFrontCodedRank = (block: FrontCodedBlock, target: string): number => {
  const rank = findFrontCodedLowerBound(block, target);
  if (rank >= block.count) return -1;
  return readFrontCodedEntry(block, rank) === target ? rank : -1;
};

/**
 * The half-open rank range `[start, end)` of every value starting with `prefix`.
 *
 * Sorted order puts them together, so a prefix match is a range of ids - which lets a search filter
 * cells by integer comparison without decoding any strings.
 */
export const findFrontCodedPrefixRange = (
  block: FrontCodedBlock,
  prefix: string,
): { start: number; end: number } => {
  const start = findFrontCodedLowerBound(block, prefix);

  // Walked forward from the chunk holding `start`, decoding each value from the one before, for the
  // same reason as the scan above.
  let chunkIndex = Math.floor(start / FRONT_CODED_CHECKPOINT_INTERVAL);
  let rank = chunkIndex * FRONT_CODED_CHECKPOINT_INTERVAL;
  let offset = block.checkpoints[chunkIndex] ?? 0;
  let value = "";

  while (rank < block.count) {
    if (rank % FRONT_CODED_CHECKPOINT_INTERVAL === 0) {
      chunkIndex = rank / FRONT_CODED_CHECKPOINT_INTERVAL;
      offset = block.checkpoints[chunkIndex];
    }
    const [shared, afterShared] = readVarint(block.bytes, offset);
    const [suffixLength, afterLength] = readVarint(block.bytes, afterShared);
    value = value.slice(0, shared) + decodeSuffix(block.bytes, afterLength, afterLength + suffixLength);
    offset = afterLength + suffixLength;

    if (rank >= start && !value.startsWith(prefix)) return { start, end: rank };
    rank++;
  }

  return { start, end: block.count };
};
