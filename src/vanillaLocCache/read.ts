import { findFrontCodedRank, type FrontCodedBlock } from "../vanillaDbCache/frontCodedBlock";
import { createFileSource, createMemorySource, type VanillaDbCacheSource } from "../vanillaDbCache/read";
import {
  getVanillaLocCacheSections,
  readVanillaLocCacheHeader,
  VANILLA_LOC_CACHE_HEADER_BYTES,
} from "./format";

export { createFileSource, createMemorySource };
export type VanillaLocCacheSource = VanillaDbCacheSource;

const textDecoder = new TextDecoder();

export interface VanillaLocCacheReader {
  /** The value for a key, or undefined if this cache does not hold it. */
  get(key: string): string | undefined;
  readonly count: number;
  /** Bytes held resident: the key block, its checkpoints and the value offsets. */
  readonly residentBytes: number;
  close(): void;
}

/**
 * Opens a cache for keyed lookups.
 *
 * The key block, its checkpoints and the value offsets are held resident, because a binary search
 * has to compare against decoded keys and paying two reads per lookup to avoid ~4 MB is the wrong
 * trade. Value bytes are not: they are the bulk of the file and a lookup reads exactly the one it
 * asked for. That is the whole point of the cache - the trie it replaces costs ~97 MB.
 *
 * Undefined for a file that is not this format, is at another version, or is shorter than its own
 * header says it should be. Callers treat that as a miss and fall back.
 */
export const openVanillaLocCache = (source: VanillaLocCacheSource): VanillaLocCacheReader | undefined => {
  const meta = readVanillaLocCacheHeader(source.read(0, Math.min(VANILLA_LOC_CACHE_HEADER_BYTES, source.size)));
  if (!meta) {
    source.close();
    return undefined;
  }
  const sections = getVanillaLocCacheSections(meta);
  if (source.size < sections.requiredSize) {
    source.close();
    return undefined;
  }

  const keyBytes = source.read(sections.keyBytesOffset, meta.keyBytesLength);
  const checkpointBytes = source.read(sections.checkpointsOffset, meta.checkpointCount * 4);
  const offsetBytes = source.read(sections.valueOffsetsOffset, (meta.count + 1) * 4);

  // Copied into aligned arrays rather than viewed in place: a source is free to hand back a slice at
  // any byte offset, and a Uint32Array cannot be laid over one that is not 4-byte aligned.
  const checkpoints = new Uint32Array(meta.checkpointCount);
  const checkpointView = new DataView(
    checkpointBytes.buffer,
    checkpointBytes.byteOffset,
    checkpointBytes.byteLength,
  );
  for (let index = 0; index < meta.checkpointCount; index++) {
    checkpoints[index] = checkpointView.getUint32(index * 4, true);
  }

  const valueOffsets = new Uint32Array(meta.count + 1);
  const offsetView = new DataView(offsetBytes.buffer, offsetBytes.byteOffset, offsetBytes.byteLength);
  for (let index = 0; index <= meta.count; index++) {
    valueOffsets[index] = offsetView.getUint32(index * 4, true);
  }

  const keyBlock: FrontCodedBlock = { bytes: keyBytes, checkpoints, count: meta.count };

  return {
    get(key) {
      const rank = findFrontCodedRank(keyBlock, key);
      if (rank < 0) return undefined;
      const start = valueOffsets[rank];
      const length = valueOffsets[rank + 1] - start;
      if (length === 0) return "";
      return textDecoder.decode(source.read(sections.valueBlobOffset + start, length));
    },
    count: meta.count,
    residentBytes: keyBytes.length + checkpoints.byteLength + valueOffsets.byteLength,
    close: source.close,
  };
};
