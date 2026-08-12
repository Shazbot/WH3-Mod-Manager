/**
 * On-disk layout for the vanilla localisation cache.
 *
 * The game ships ~242k loc entries and a feature build reads a few thousand of them. Parsing the
 * .loc files and holding them in `src/utility/trie.ts` costs ~97 MB of heap for ~30 MB of text,
 * because a node-per-underscore-segment trie pays V8 object overhead on every segment. This cache
 * exists to make that cost disappear: keys live in one front-coded block, values in a plain blob,
 * and a reader can answer a lookup by binary-searching the block and range-reading one value.
 *
 * Keys reuse `vanillaDbCache/frontCodedBlock`. Measured over the WH3 text/db dump that takes 16.4 MB
 * of keys to 3.3 MB, because loc keys repeat long prefixes (`unit_abilities_tooltip_text_...`) and
 * sorting brings those neighbours together.
 *
 * Values are stored inline rather than pooled. 43% of values are duplicates, but deduplicating them
 * saves only 2.6 MB of a 17.6 MB file - the 45,551 empty values are already zero-length and dedupe
 * to nothing - and it buys no memory at all, since a range read decodes a fresh string either way.
 * Pooling can be added later without moving anything, as sections are addressed by offset.
 *
 * Sections are uncompressed, for the same reason `vanillaDbCache/format.ts` gives: this cache exists
 * to make a read cheap, and a decompress step on the read path works against that.
 */

export const VANILLA_LOC_CACHE_MAGIC = "WLCC";

/** Bump when the layout changes. A reader rejects anything it does not recognise. */
export const VANILLA_LOC_CACHE_VERSION = 1;

export const VANILLA_LOC_CACHE_HEADER_BYTES = 24;

export interface VanillaLocCacheMeta {
  count: number;
  keyBytesLength: number;
  checkpointCount: number;
  valueBlobLength: number;
}

/** Where each section starts, derived from the header so nothing stores redundant offsets. */
export interface VanillaLocCacheSections {
  keyBytesOffset: number;
  checkpointsOffset: number;
  valueOffsetsOffset: number;
  valueBlobOffset: number;
  /** The furthest byte the layout points at, used to reject a file truncated mid-write. */
  requiredSize: number;
}

export const getVanillaLocCacheSections = (meta: VanillaLocCacheMeta): VanillaLocCacheSections => {
  const keyBytesOffset = VANILLA_LOC_CACHE_HEADER_BYTES;
  const checkpointsOffset = keyBytesOffset + meta.keyBytesLength;
  const valueOffsetsOffset = checkpointsOffset + meta.checkpointCount * 4;
  // One extra offset closes the last value, so a value's length is always offsets[n + 1] - offsets[n].
  const valueBlobOffset = valueOffsetsOffset + (meta.count + 1) * 4;
  return {
    keyBytesOffset,
    checkpointsOffset,
    valueOffsetsOffset,
    valueBlobOffset,
    requiredSize: valueBlobOffset + meta.valueBlobLength,
  };
};

export const writeVanillaLocCacheHeader = (meta: VanillaLocCacheMeta): Uint8Array => {
  const header = new Uint8Array(VANILLA_LOC_CACHE_HEADER_BYTES);
  for (let index = 0; index < 4; index++) header[index] = VANILLA_LOC_CACHE_MAGIC.charCodeAt(index);
  const view = new DataView(header.buffer);
  view.setUint32(4, VANILLA_LOC_CACHE_VERSION, true);
  view.setUint32(8, meta.count, true);
  view.setUint32(12, meta.keyBytesLength, true);
  view.setUint32(16, meta.checkpointCount, true);
  view.setUint32(20, meta.valueBlobLength, true);
  return header;
};

/** Undefined for anything that is not this format at this version. */
export const readVanillaLocCacheHeader = (bytes: Uint8Array): VanillaLocCacheMeta | undefined => {
  if (bytes.length < VANILLA_LOC_CACHE_HEADER_BYTES) return undefined;
  for (let index = 0; index < 4; index++) {
    if (bytes[index] !== VANILLA_LOC_CACHE_MAGIC.charCodeAt(index)) return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== VANILLA_LOC_CACHE_VERSION) return undefined;
  return {
    count: view.getUint32(8, true),
    keyBytesLength: view.getUint32(12, true),
    checkpointCount: view.getUint32(16, true),
    valueBlobLength: view.getUint32(20, true),
  };
};
