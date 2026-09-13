import * as nodePath from "node:path";

import { compressAnalyzedPack } from "./compressor";
import type { CompressionCodecs } from "./analyzer";
import type { CompressionPackAnalysis } from "./types";
import type { CompressionAnalysisProgress } from "./types";

/** The terminal outcomes of a staging compression attempt. */
export type StagedPackCompressionStatus = "compressed" | "noEligibleFiles" | "failed";

export interface CompressStagedPackOptions {
  /** Include the conservative LZ4-only .rigid_model_v2 path. Disabled by default for staging. */
  includeRigidModelV2?: boolean;
  /** Codec overrides used by focused tests and embedders. */
  codecs?: Partial<CompressionCodecs>;
  /** Abort before or during the staged rewrite. */
  signal?: AbortSignal;
  /** Receives analyzer progress while the pack is being inspected. */
  onProgress?: (progress: CompressionAnalysisProgress) => void;
}

export interface CompressStagedPackResult {
  /** `noEligibleFiles` is a successful no-op; `failed` means the staged pack remains uncompressed. */
  status: StagedPackCompressionStatus;
  /** Convenience flag for callers that only need to decide whether staging may continue. */
  success: boolean;
  packPath: string;
  originalSize?: number;
  compressedSize?: number;
  compressedFileCount: number;
  error?: string;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason !== undefined) throw reason;
  const error = new Error("Compression canceled");
  error.name = "AbortError";
  throw error;
};

const hasEligibleFile = (analysis: CompressionPackAnalysis, includeRigidModelV2: boolean): boolean =>
  analysis.fileResults.some(
    (file) => file.status === "accepted" && !!file.selectedCodec && (includeRigidModelV2 || !file.isRigidModelV2),
  );

/**
 * Compresses a copied Workshop destination in place without creating a persistent backup.
 *
 * The requested path must be the path analyzed by `analyzeCompressionPacks`. The lower-level
 * compressor validates the PFH5 header/index again and uses a same-directory rollback rename, so
 * codec or replacement failures leave the exact pre-compression staged bytes in place. This helper
 * deliberately receives only the staged path; it has no source-path parameter and never opens a
 * Workshop source file.
 */
export const compressStagedPack = async (
  packPath: string,
  analysis: CompressionPackAnalysis,
  options: CompressStagedPackOptions = {},
): Promise<CompressStagedPackResult> => {
  throwIfAborted(options.signal);
  const includeRigidModelV2 = options.includeRigidModelV2 === true;
  const baseResult = {
    packPath,
    originalSize: analysis.currentSize,
    compressedFileCount: 0,
  };

  if (!analysis.success) {
    return {
      ...baseResult,
      status: "failed",
      success: false,
      error: analysis.errors[0] || "The staged pack did not pass compression analysis.",
    };
  }
  if (nodePath.resolve(packPath) !== nodePath.resolve(analysis.packPath)) {
    return {
      ...baseResult,
      status: "failed",
      success: false,
      error: "The analysis does not belong to the requested staged pack.",
    };
  }
  if (!hasEligibleFile(analysis, includeRigidModelV2)) {
    return { ...baseResult, status: "noEligibleFiles", success: true };
  }

  try {
    // `createBackup: false` is the important staging distinction. The manual API keeps its
    // persistent backup default, while the compressor's rollback path is removed after commit.
    const result = await compressAnalyzedPack(packPath, analysis, nodePath.dirname(packPath), includeRigidModelV2, {
      codecs: options.codecs,
      createBackup: false,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    if (!result.success) {
      return {
        ...baseResult,
        status: "failed",
        success: false,
        error: result.error || "Staged pack compression failed.",
      };
    }
    return {
      packPath,
      status: "compressed",
      success: true,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      compressedFileCount: result.compressedFileCount || 0,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return {
      ...baseResult,
      status: "failed",
      success: false,
      error: errorMessage(error),
    };
  }
};
