import type { CompressionCodec, CompressionCodecResult } from "./types";

/** Size and maximum compressed-ratio rules used by the analyzer. */
export const compressionEligibilityRules = [
  { minimumBytes: 4 * 1024, maximumBytes: 64 * 1024, maximumRatioPercent: 85 },
  { minimumBytes: 64 * 1024, maximumBytes: 1024 * 1024, maximumRatioPercent: 92 },
  { minimumBytes: 1024 * 1024, maximumBytes: 100 * 1024 * 1024 + 1, maximumRatioPercent: 95 },
  { minimumBytes: 100 * 1024 * 1024 + 1, maximumBytes: Number.POSITIVE_INFINITY, maximumRatioPercent: 97 },
] as const;

/** Files smaller than this are intentionally never benchmarked. */
export const MINIMUM_COMPRESSION_BYTES = 4 * 1024;
export const LARGE_FILE_SAMPLE_THRESHOLD_BYTES = 100 * 1024 * 1024;
export const LARGE_FILE_SAMPLE_BYTES = 4 * 1024 * 1024;
export const TOP_COMPRESSION_WINS = 10;
export const ZSTD_COMPRESSION_LEVEL = 3;
export const RIGID_MODEL_V2_MINIMUM_BYTES = 256 * 1024;
export const RIGID_MODEL_V2_MAXIMUM_RATIO_PERCENT = 75;

/**
 * Returns the strict maximum ratio for a file size, or undefined for the below-4KiB skip band.
 * Exactly 64KiB and 1MiB belong to the next band; exactly 100MiB remains in the 1MiB–100MiB band.
 */
export const getCompressionEligibilityThreshold = (originalBytes: number): number | undefined => {
  if (!Number.isFinite(originalBytes) || originalBytes < MINIMUM_COMPRESSION_BYTES) return undefined;
  return compressionEligibilityRules.find(
    (rule) => originalBytes >= rule.minimumBytes && originalBytes < rule.maximumBytes,
  )?.maximumRatioPercent;
};

/** Alias kept deliberately small and convenient for policy-focused tests and consumers. */
export const getEligibilityThresholdPercent = getCompressionEligibilityThreshold;

export const compressionRatioPercent = (compressedBytes: number, originalBytes: number): number => {
  if (originalBytes <= 0) return Number.POSITIVE_INFINITY;
  return (compressedBytes / originalBytes) * 100;
};

export const compressionRatio = (compressedBytes: number, originalBytes: number): number => {
  if (originalBytes <= 0) return Number.POSITIVE_INFINITY;
  return compressedBytes / originalBytes;
};

/** The threshold is strict: equal-to-threshold ratios do not qualify. */
export const passesCompressionThreshold = (originalBytes: number, compressedBytes: number): boolean => {
  const threshold = getCompressionEligibilityThreshold(originalBytes);
  return threshold !== undefined && compressionRatioPercent(compressedBytes, originalBytes) < threshold;
};

/**
 * Selects the codec after failed benchmarks have been excluded. If both qualify, ZSTD wins only
 * when its ratio is at least ten percentage points smaller than LZ4's ratio; ties otherwise go to
 * LZ4 so the game gets the cheaper/faster frame in the common case.
 */
export const chooseCompressionCodec = (
  originalBytes: number,
  results: Partial<Record<CompressionCodec, CompressionCodecResult | undefined>>,
): CompressionCodec | undefined => {
  const threshold = getCompressionEligibilityThreshold(originalBytes);
  if (threshold === undefined) return undefined;

  const eligible = (codec: CompressionCodec): CompressionCodecResult | undefined => {
    const result = results[codec];
    if (!result || result.error || result.ratioPercent === undefined) return undefined;
    return result.ratioPercent < threshold ? result : undefined;
  };
  const lz4 = eligible("LZ4");
  const zstd = eligible("ZSTD");
  if (!lz4 && !zstd) return undefined;
  if (!lz4) return "ZSTD";
  if (!zstd) return "LZ4";
  return zstd.ratioPercent! <= lz4.ratioPercent! - 10 ? "ZSTD" : "LZ4";
};

export const selectCompressionCodec = chooseCompressionCodec;

/** Conservative, LZ4-only policy for rigid models based on the vanilla compression findings. */
export const passesRigidModelV2CompressionThreshold = (originalBytes: number, compressedBytes: number): boolean =>
  originalBytes >= RIGID_MODEL_V2_MINIMUM_BYTES &&
  compressionRatioPercent(compressedBytes, originalBytes) <= RIGID_MODEL_V2_MAXIMUM_RATIO_PERCENT;
