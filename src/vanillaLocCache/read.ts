import {
  findFrontCodedRank,
  forEachFrontCodedEntry,
  iterateFrontCodedEntries,
  type FrontCodedBlock,
} from "../vanillaDbCache/frontCodedBlock";
import { createFileSource, createMemorySource, type VanillaDbCacheSource } from "../vanillaDbCache/read";
import { getVanillaLocCacheSections, readVanillaLocCacheHeader, VANILLA_LOC_CACHE_HEADER_BYTES } from "./format";

export { createFileSource, createMemorySource };
export type VanillaLocCacheSource = VanillaDbCacheSource;

const textDecoder = new TextDecoder();

export interface VanillaLocCacheReader {
  /** The value for a key, or undefined if this cache does not hold it. */
  get(key: string): string | undefined;
  /** Visits every entry in key order. The optional fourth argument is its source label. */
  forEachEntry(
    visit: (key: string, value: string, rank: number, sourceLabel?: string) => boolean | void,
    options?: { batchBytes?: number },
  ): void;
  /** Async counterpart for long walks that must give cancellation and IPC messages a turn. */
  forEachEntryAsync?: (
    visit: (key: string, value: string, rank: number, sourceLabel?: string) => boolean | void,
    options?: {
      batchBytes?: number;
      yieldEvery?: number;
      yieldToEventLoop?: () => Promise<void>;
    },
  ) => Promise<void>;
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
  const sourceBytes = source.read(sections.sourceBytesOffset, meta.sourceBytesLength);
  const sourceCheckpointBytes = source.read(sections.sourceCheckpointsOffset, meta.sourceCheckpointCount * 4);
  const sourceIdBytes = source.read(sections.sourceIdsOffset, meta.count * 2);

  // Copied into aligned arrays rather than viewed in place: a source is free to hand back a slice at
  // any byte offset, and a Uint32Array cannot be laid over one that is not 4-byte aligned.
  const checkpoints = new Uint32Array(meta.checkpointCount);
  const checkpointView = new DataView(checkpointBytes.buffer, checkpointBytes.byteOffset, checkpointBytes.byteLength);
  for (let index = 0; index < meta.checkpointCount; index++) {
    checkpoints[index] = checkpointView.getUint32(index * 4, true);
  }

  const valueOffsets = new Uint32Array(meta.count + 1);
  const offsetView = new DataView(offsetBytes.buffer, offsetBytes.byteOffset, offsetBytes.byteLength);
  for (let index = 0; index <= meta.count; index++) {
    valueOffsets[index] = offsetView.getUint32(index * 4, true);
  }

  const keyBlock: FrontCodedBlock = { bytes: keyBytes, checkpoints, count: meta.count };
  const sourceCheckpoints = new Uint32Array(meta.sourceCheckpointCount);
  const sourceCheckpointView = new DataView(
    sourceCheckpointBytes.buffer,
    sourceCheckpointBytes.byteOffset,
    sourceCheckpointBytes.byteLength,
  );
  for (let index = 0; index < meta.sourceCheckpointCount; index++) {
    sourceCheckpoints[index] = sourceCheckpointView.getUint32(index * 4, true);
  }
  const sourceIds = new Uint16Array(meta.count);
  const sourceIdView = new DataView(sourceIdBytes.buffer, sourceIdBytes.byteOffset, sourceIdBytes.byteLength);
  for (let index = 0; index < meta.count; index++) sourceIds[index] = sourceIdView.getUint16(index * 2, true);
  const sourceBlock: FrontCodedBlock = {
    bytes: sourceBytes,
    checkpoints: sourceCheckpoints,
    count: meta.sourceCount,
  };
  const sourceLabels: Array<string | undefined> = new Array(meta.sourceCount);
  forEachFrontCodedEntry(sourceBlock, (sourceLabel, sourceId) => {
    sourceLabels[sourceId] = sourceLabel;
  });
  const sourceById = (sourceId: number): string | undefined =>
    sourceId === 0xffff ? undefined : sourceLabels[sourceId];

  const decodeValueAt = (rank: number): string => {
    const start = valueOffsets[rank];
    const length = valueOffsets[rank + 1] - start;
    return length === 0 ? "" : textDecoder.decode(source.read(sections.valueBlobOffset + start, length));
  };

  return {
    get(key) {
      const rank = findFrontCodedRank(keyBlock, key);
      if (rank < 0) return undefined;
      return decodeValueAt(rank);
    },
    forEachEntry(visit, { batchBytes = 1024 * 1024 } = {}) {
      if (meta.count === 0) return;
      const safeBatchBytes = Math.max(1, batchBytes);
      const keyIterator = iterateFrontCodedEntries(keyBlock);
      let batchStart = 0;
      while (batchStart < meta.count) {
        let batchEnd = batchStart + 1;
        while (batchEnd < meta.count && valueOffsets[batchEnd + 1] - valueOffsets[batchStart] <= safeBatchBytes) {
          batchEnd++;
        }
        const batchLength = valueOffsets[batchEnd] - valueOffsets[batchStart];
        const batch = source.read(sections.valueBlobOffset + valueOffsets[batchStart], batchLength);
        for (let rank = batchStart; rank < batchEnd; rank++) {
          const keyEntry = keyIterator.next().value;
          if (!keyEntry) return;
          const start = valueOffsets[rank] - valueOffsets[batchStart];
          const end = valueOffsets[rank + 1] - valueOffsets[batchStart];
          const value = textDecoder.decode(batch.subarray(start, end));
          const sourceLabel = sourceById(sourceIds[rank]);
          if (visit(keyEntry.value, value, rank, sourceLabel) === false) return;
        }
        batchStart = batchEnd;
      }
    },
    async forEachEntryAsync(visit, { batchBytes = 1024 * 1024, yieldEvery = 512, yieldToEventLoop } = {}) {
      if (meta.count === 0) return;
      const safeBatchBytes = Math.max(1, batchBytes);
      const safeYieldEvery = Math.max(1, yieldEvery);
      const keyIterator = iterateFrontCodedEntries(keyBlock);
      let visited = 0;
      let batchStart = 0;
      while (batchStart < meta.count) {
        let batchEnd = batchStart + 1;
        while (batchEnd < meta.count && valueOffsets[batchEnd + 1] - valueOffsets[batchStart] <= safeBatchBytes) {
          batchEnd++;
        }
        const batchLength = valueOffsets[batchEnd] - valueOffsets[batchStart];
        const batch = source.read(sections.valueBlobOffset + valueOffsets[batchStart], batchLength);
        for (let rank = batchStart; rank < batchEnd; rank++) {
          const keyEntry = keyIterator.next().value;
          if (!keyEntry) return;
          const start = valueOffsets[rank] - valueOffsets[batchStart];
          const end = valueOffsets[rank + 1] - valueOffsets[batchStart];
          const value = textDecoder.decode(batch.subarray(start, end));
          const sourceLabel = sourceById(sourceIds[rank]);
          if (visit(keyEntry.value, value, rank, sourceLabel) === false) return;
          visited++;
          if (yieldToEventLoop && visited % safeYieldEvery === 0) await yieldToEventLoop();
        }
        batchStart = batchEnd;
      }
    },
    count: meta.count,
    residentBytes:
      keyBytes.length +
      checkpoints.byteLength +
      valueOffsets.byteLength +
      sourceBytes.length +
      sourceCheckpoints.byteLength +
      sourceIds.byteLength,
    close: source.close,
  };
};
