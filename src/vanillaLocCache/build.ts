import { buildFrontCodedBlock } from "../vanillaDbCache/frontCodedBlock";
import { getVanillaLocCacheSections, writeVanillaLocCacheHeader, type VanillaLocCacheMeta } from "./format";

const textEncoder = new TextEncoder();

/**
 * Encodes loc entries into the cache layout.
 *
 * Takes entries in pack order and applies last-wins, which is how a later pack has always shadowed
 * an earlier one. Sorting happens here rather than in the caller because ranks in the key block have
 * to agree with the value offsets, and keeping both in one place is what guarantees that.
 */
export type VanillaLocCacheEntry = readonly [key: string, value: string, sourceLabel?: string];

export const buildVanillaLocCacheBytes = (entriesInPackOrder: Iterable<VanillaLocCacheEntry>) => {
  const byKey = new Map<string, { value: string; sourceLabel?: string }>();
  for (const [key, value, sourceLabel] of entriesInPackOrder) {
    if (key !== "") byKey.set(key, { value, sourceLabel });
  }

  const keys = Array.from(byKey.keys()).sort();
  const keyBlock = buildFrontCodedBlock(keys);

  const sourceLabels = Array.from(
    new Set(keys.map((key) => byKey.get(key)?.sourceLabel).filter((source): source is string => !!source)),
  ).sort();
  const sourceBlock = buildFrontCodedBlock(sourceLabels);
  const sourceIdByLabel = new Map(sourceLabels.map((source, index) => [source, index]));
  const sourceIds = keys.map((key) => sourceIdByLabel.get(byKey.get(key)?.sourceLabel ?? "") ?? 0xffff);
  const encodedSourceBytes = sourceBlock.bytes;

  const encodedValues = keys.map((key) => textEncoder.encode(byKey.get(key)!.value));
  const valueBlobLength = encodedValues.reduce((total, value) => total + value.length, 0);

  const meta: VanillaLocCacheMeta = {
    count: keys.length,
    keyBytesLength: keyBlock.bytes.length,
    checkpointCount: keyBlock.checkpoints.length,
    valueBlobLength,
    sourceBytesLength: encodedSourceBytes.length,
    sourceCheckpointCount: sourceBlock.checkpoints.length,
    sourceCount: sourceLabels.length,
  };
  const sections = getVanillaLocCacheSections(meta);
  const bytes = new Uint8Array(sections.requiredSize);
  bytes.set(writeVanillaLocCacheHeader(meta), 0);
  bytes.set(keyBlock.bytes, sections.keyBytesOffset);

  const view = new DataView(bytes.buffer);
  for (let index = 0; index < keyBlock.checkpoints.length; index++) {
    view.setUint32(sections.checkpointsOffset + index * 4, keyBlock.checkpoints[index], true);
  }

  let valueCursor = 0;
  for (let rank = 0; rank < encodedValues.length; rank++) {
    view.setUint32(sections.valueOffsetsOffset + rank * 4, valueCursor, true);
    bytes.set(encodedValues[rank], sections.valueBlobOffset + valueCursor);
    valueCursor += encodedValues[rank].length;
  }
  view.setUint32(sections.valueOffsetsOffset + encodedValues.length * 4, valueCursor, true);

  bytes.set(encodedSourceBytes, sections.sourceBytesOffset);
  for (let index = 0; index < sourceBlock.checkpoints.length; index++) {
    view.setUint32(sections.sourceCheckpointsOffset + index * 4, sourceBlock.checkpoints[index], true);
  }
  for (let index = 0; index < sourceIds.length; index++) {
    view.setUint16(sections.sourceIdsOffset + index * 2, sourceIds[index], true);
  }

  return bytes;
};
