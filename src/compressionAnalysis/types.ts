/** Compression methods represented in a PFH5 pack or in the vanilla guardrail data. */
export const compressionMethods = ["NONE", "LZ4", "ZSTD", "UNKNOWN"] as const;
export type CompressionMethod = (typeof compressionMethods)[number];

export const compressionCodecs = ["LZ4", "ZSTD"] as const;
export type CompressionCodec = (typeof compressionCodecs)[number];

export type CompressionAnalysisStatus = "completed" | "canceled" | "busy" | "error";

export interface CompressionMethodStats {
  count: number;
  storedBytes: number;
}

export type CompressionMethodStatsByMethod = Record<CompressionMethod, CompressionMethodStats>;

export interface CompressionCodecResult {
  codec: CompressionCodec;
  /** Compressed bytes divided by original bytes, expressed as a percentage. */
  ratioPercent?: number;
  /** Compressed bytes divided by original bytes, expressed as a fraction. */
  ratio?: number;
  compressedBytes?: number;
  error?: string;
}

export type CompressionFileStatus = "accepted" | "skipped" | "sampled-rejected" | "error";

export interface CompressionFileAnalysis {
  fileName: string;
  extension: string;
  storedBytes: number;
  /** For an uncompressed source this equals storedBytes. */
  originalBytes?: number;
  existingMethod: CompressionMethod;
  status: CompressionFileStatus;
  selectedCodec?: CompressionCodec;
  selectedRatioPercent?: number;
  selectedRatio?: number;
  lz4?: CompressionCodecResult;
  zstd?: CompressionCodecResult;
  savingsBytes?: number;
  /** True when the extension does not occur in the vanilla CSV guardrail. */
  noVanillaPrecedent?: boolean;
  /** True for .rigid_model_v2, which is intentionally outside primary totals. */
  isRigidModelV2?: boolean;
  warning?: string;
  skipReason?: string;
  error?: string;
}

export interface CompressionWin extends CompressionFileAnalysis {
  status: "accepted";
  selectedCodec: CompressionCodec;
  selectedRatioPercent: number;
  savingsBytes: number;
}

export interface CompressionPackAnalysis {
  packPath: string;
  packName: string;
  /** Actual on-disk pack size, including headers and indexes. */
  currentSize: number;
  /** Projected size after primary (non-rigid) accepted wins. */
  projectedSize: number;
  bytesSaved: number;
  wholePackPercentSaved: number;
  /** Projection including the separately reported rigid_model_v2 wins. */
  projectedSizeIncludingRigidModelV2: number;
  wholePackPercentSavedIncludingRigidModelV2: number;
  fileCount: number;
  testedCount: number;
  skippedCount: number;
  errorCount: number;
  acceptedCount: number;
  sampledRejectedCount: number;
  existing: CompressionMethodStatsByMethod;
  /** Convenience count-only view for consumers that do not need bytes. */
  existingCounts: Record<CompressionMethod, number>;
  /** Convenience stored-byte view for consumers that do not need counts. */
  existingStoredBytes: Record<CompressionMethod, number>;
  /** Accepted primary wins, ordered from largest to smallest savings. */
  topWins: CompressionWin[];
  /** Accepted rigid_model_v2 wins, ordered from largest to smallest savings. */
  rigidModelV2Wins: CompressionWin[];
  fileResults: CompressionFileAnalysis[];
  warnings: string[];
  errors: string[];
  /** False when the pack could not be read or its index was malformed. */
  success: boolean;
}

export interface CompressionAnalysisOverall {
  /** Sum of currentSize for successfully indexed packs only. */
  currentSize: number;
  projectedSize: number;
  bytesSaved: number;
  wholePackPercentSaved: number;
  projectedSizeIncludingRigidModelV2: number;
  wholePackPercentSavedIncludingRigidModelV2: number;
  packCount: number;
  analyzedPackCount: number;
  testedCount: number;
  skippedCount: number;
  errorCount: number;
  acceptedCount: number;
  sampledRejectedCount: number;
  existing: CompressionMethodStatsByMethod;
  existingCounts: Record<CompressionMethod, number>;
  existingStoredBytes: Record<CompressionMethod, number>;
}

export interface CompressionAnalysisResult {
  status: CompressionAnalysisStatus;
  packs: CompressionPackAnalysis[];
  overall: CompressionAnalysisOverall;
  /** Paths that were deduplicated before analysis. */
  requestedPackCount?: number;
  /** Human-readable terminal error for a job-level failure. */
  error?: string;
}

export type CompressionAnalysisProgressPhase = "starting" | "pack" | "file" | "complete" | "canceled" | "error";

export interface CompressionAnalysisProgress {
  phase: CompressionAnalysisProgressPhase;
  packIndex: number;
  packCount: number;
  fileIndex?: number;
  fileCount?: number;
  packPath?: string;
  packName?: string;
  fileName?: string;
  testedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  acceptedCount?: number;
  message?: string;
}

export interface CompressionAnalysisRequest {
  packPaths: string[];
}

export interface CompressionAnalysisStartResponse {
  accepted: boolean;
  busy?: boolean;
  reason?: "unsupportedGame" | "noEnabledMods" | "alreadyRunning";
  result?: CompressionAnalysisResult;
}

export interface CompressPackRequest {
  packPath: string;
  includeRigidModelV2: boolean;
  /** When true, copy compression output to the game's data folder when the source is elsewhere. */
  copyToDataFolder?: boolean;
}

export interface CompressPackResponse {
  success: boolean;
  packPath?: string;
  backupPath?: string;
  originalSize?: number;
  compressedSize?: number;
  compressedFileCount?: number;
  error?: string;
}
