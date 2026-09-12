import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../flowbite";
import { useLocalizations } from "../localizationContext";
import type { SupportedGames } from "../supportedGames";
import type {
  CompressionAnalysisProgress,
  CompressionAnalysisResult,
  CompressionPackAnalysis,
} from "../compressionAnalysis";

interface CompressionAnalysisProps {
  isOpen: boolean;
  onClose: () => void;
  currentGame: SupportedGames;
  enabledModPaths: string[];
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
};

const formatPercent = (value: number): string => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

const statusLabel = (pack: CompressionPackAnalysis, localized: Record<string, string | undefined>): string => {
  if (!pack.success) return localized.compressionAnalysisPackError || "Pack could not be analyzed";
  return `${pack.testedCount} ${localized.compressionAnalysisTested || "tested"}, ${pack.skippedCount} ${
    localized.compressionAnalysisSkipped || "skipped"
  }, ${pack.errorCount} ${localized.compressionAnalysisErrors || "errors"}`;
};

const CompressionAnalysis = ({ isOpen, onClose, currentGame, enabledModPaths }: CompressionAnalysisProps) => {
  const localized = useLocalizations() as Record<string, string | undefined>;
  const [result, setResult] = useState<CompressionAnalysisResult>();
  const [progress, setProgress] = useState<CompressionAnalysisProgress>();
  const [isRunning, setIsRunning] = useState(false);
  const [startError, setStartError] = useState<string>();
  const startedForOpen = useRef(false);
  const pathsForRun = useMemo(() => [...new Set(enabledModPaths.filter(Boolean))], [enabledModPaths]);

  const start = useCallback(() => {
    if (currentGame !== "wh3" || pathsForRun.length === 0 || isRunning) return;
    setResult(undefined);
    setStartError(undefined);
    setProgress(undefined);
    setIsRunning(true);
    void window.api
      ?.startCompressionAnalysis({ packPaths: pathsForRun })
      .then((response) => {
        if (!response) {
          setStartError(localized.compressionAnalysisUnavailable || "Compression analysis is unavailable.");
          setIsRunning(false);
          return;
        }
        if (!response.accepted) {
          setStartError(
            response.reason === "alreadyRunning"
              ? localized.compressionAnalysisAlreadyRunning || "An analysis is already running."
              : response.reason === "unsupportedGame"
                ? localized.compressionAnalysisOnlyWH3 || "Compression analysis is available for Warhammer 3 only."
                : localized.compressionAnalysisNoEnabledMods || "Enable at least one mod first.",
          );
          setIsRunning(false);
          return;
        }
        if (response.result) setResult(response.result);
        setIsRunning(false);
      })
      .catch((error: unknown) => {
        setStartError(error instanceof Error ? error.message : String(error));
        setIsRunning(false);
      });
  }, [currentGame, isRunning, localized, pathsForRun]);

  useEffect(() => {
    if (!isOpen) {
      startedForOpen.current = false;
      return;
    }
    const removeProgressListener = window.api?.onCompressionAnalysisProgress((_, nextProgress) => {
      setProgress(nextProgress);
    });
    if (!startedForOpen.current) {
      startedForOpen.current = true;
      start();
    }
    return () => {
      removeProgressListener?.();
    };
  }, [isOpen, start]);

  const close = useCallback(() => {
    if (isRunning) window.api?.cancelCompressionAnalysis();
    onClose();
  }, [isRunning, onClose]);

  const reason =
    currentGame !== "wh3"
      ? localized.compressionAnalysisOnlyWH3 || "Compression analysis is available for Warhammer 3 only."
      : pathsForRun.length === 0
        ? localized.compressionAnalysisNoEnabledMods || "Enable at least one mod first."
        : undefined;
  const overall = result?.overall;
  const progressPercent = progress?.packCount
    ? Math.min(
        100,
        Math.max(
          0,
          ((progress.packIndex + (progress.fileIndex ?? 0) / Math.max(1, progress.fileCount ?? 1)) /
            progress.packCount) *
            100,
        ),
      )
    : 0;

  return (
    <Modal show={isOpen} onClose={close} size="4xl" position="center" explicitClasses={["max-h-[90vh]"]}>
      <Modal.Header>{localized.compressionAnalysis || "Compression Analysis"}</Modal.Header>
      <Modal.Body>
        <div className="max-h-[72vh] overflow-y-auto pr-1">
          <p className="text-sm text-gray-500 dark:text-gray-300">
            {localized.compressionAnalysisDescription ||
              "Benchmarks currently enabled Warhammer 3 mod packs without changing any files. Existing compression is retained."}
          </p>
          {reason && (
            <p className="mt-3 rounded border border-yellow-700 bg-yellow-900/30 p-2 text-sm text-yellow-200">
              {reason}
            </p>
          )}
          {startError && (
            <p className="mt-3 rounded border border-red-700 bg-red-900/30 p-2 text-sm text-red-200">{startError}</p>
          )}
          {isRunning && (
            <div className="mt-4 rounded border border-gray-600 p-3" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  {progress?.fileName || progress?.packName || localized.compressionAnalysisStarting || "Starting…"}
                </span>
                <span>{formatPercent(progressPercent)}</span>
              </div>
              <progress className="mt-2 h-2 w-full" max={100} value={progressPercent} />
              <button
                type="button"
                onClick={() => window.api?.cancelCompressionAnalysis()}
                className="mt-3 rounded bg-gray-600 px-3 py-1.5 text-xs text-white hover:bg-gray-500"
              >
                {localized.compressionAnalysisCancel || "Cancel"}
              </button>
            </div>
          )}
          {!isRunning && !result && !startError && !reason && (
            <p className="mt-4 text-sm text-gray-400">{localized.compressionAnalysisStarting || "Starting…"}</p>
          )}
          {overall && (
            <>
              <section className="mt-4 rounded border border-gray-600 p-3">
                <h6 className="font-semibold">{localized.compressionAnalysisOverall || "Overall"}</h6>
                <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                  <span>
                    {localized.compressionAnalysisCurrentSize || "Current size"}: {formatBytes(overall.currentSize)}
                  </span>
                  <span>
                    {localized.compressionAnalysisProjectedSize || "Projected size"}:{" "}
                    {formatBytes(overall.projectedSize)}
                  </span>
                  <span>
                    {localized.compressionAnalysisSaved || "Saved"}: {formatBytes(overall.bytesSaved)}
                  </span>
                  <span>
                    {localized.compressionAnalysisPercentSaved || "% saved"}:{" "}
                    {formatPercent(overall.wholePackPercentSaved)}
                  </span>
                  <span>
                    {localized.compressionAnalysisPacks || "Packs"}: {overall.analyzedPackCount}/{overall.packCount}
                  </span>
                  <span>
                    {localized.compressionAnalysisAccepted || "Accepted"}: {overall.acceptedCount}
                  </span>
                  <span>
                    {localized.compressionAnalysisTested || "Tested"}: {overall.testedCount}
                  </span>
                  <span>
                    {localized.compressionAnalysisSkipped || "Skipped"}: {overall.skippedCount}
                  </span>
                  <span>
                    {localized.compressionAnalysisErrors || "Errors"}: {overall.errorCount}
                  </span>
                </div>
                <div className="mt-3 text-xs text-gray-400">
                  {(["NONE", "LZ4", "ZSTD", "UNKNOWN"] as const).map((method) => (
                    <span key={method} className="mr-3 inline-block">
                      {method}: {overall.existingCounts[method]} ({formatBytes(overall.existingStoredBytes[method])})
                    </span>
                  ))}
                </div>
              </section>
              <section className="mt-4 space-y-2">
                <h6 className="font-semibold">{localized.compressionAnalysisPerPack || "Per pack"}</h6>
                {result?.packs.map((pack) => (
                  <details
                    key={pack.packPath}
                    className="rounded border border-gray-600 p-3"
                    open={result.packs.length === 1}
                  >
                    <summary className="cursor-pointer text-sm font-medium">
                      <span className="break-all">{pack.packName}</span>
                      <span className="ml-2 text-xs text-gray-400">{statusLabel(pack, localized)}</span>
                    </summary>
                    <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                      <span>
                        {localized.compressionAnalysisCurrentSize || "Current size"}: {formatBytes(pack.currentSize)}
                      </span>
                      <span>
                        {localized.compressionAnalysisProjectedSize || "Projected size"}:{" "}
                        {formatBytes(pack.projectedSize)}
                      </span>
                      <span>
                        {localized.compressionAnalysisPercentSaved || "% saved"}:{" "}
                        {formatPercent(pack.wholePackPercentSaved)}
                      </span>
                      <span>
                        {localized.compressionAnalysisAccepted || "Accepted"}: {pack.acceptedCount}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-gray-400">
                      {(["NONE", "LZ4", "ZSTD", "UNKNOWN"] as const).map((method) => (
                        <span key={method} className="mr-3 inline-block">
                          {method}: {pack.existingCounts[method]} ({formatBytes(pack.existingStoredBytes[method])})
                        </span>
                      ))}
                    </div>
                    {pack.errors.length > 0 && (
                      <div className="mt-2 text-sm text-red-300">{pack.errors.join("; ")}</div>
                    )}
                    {pack.warnings.length > 0 && (
                      <div className="mt-2 text-sm text-yellow-200">{pack.warnings.join("; ")}</div>
                    )}
                    {pack.topWins.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-semibold uppercase text-gray-400">
                          {localized.compressionAnalysisTopWins || "Largest wins"}
                        </div>
                        <ul className="mt-1 space-y-1 text-xs">
                          {pack.topWins.map((win) => (
                            <li key={win.fileName} className="flex justify-between gap-2">
                              <span className="truncate" title={win.fileName}>
                                {win.fileName}
                              </span>
                              <span className="whitespace-nowrap">
                                {win.selectedCodec}: {formatBytes(win.savingsBytes)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {pack.rigidModelV2Wins.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-semibold uppercase text-yellow-300">
                          {localized.compressionAnalysisRigidWins ||
                            ".rigid_model_v2 wins (excluded from primary totals)"}
                        </div>
                        <ul className="mt-1 space-y-1 text-xs">
                          {pack.rigidModelV2Wins.slice(0, 10).map((win) => (
                            <li key={win.fileName} className="flex justify-between gap-2">
                              <span className="truncate" title={win.fileName}>
                                {win.fileName}
                              </span>
                              <span className="whitespace-nowrap">
                                {win.selectedCodec}: {formatBytes(win.savingsBytes)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </details>
                ))}
              </section>
            </>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        {!isRunning && (result || startError) && !reason && (
          <button
            type="button"
            onClick={start}
            className="rounded bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700"
          >
            {localized.compressionAnalysisRetry || "Retry"}
          </button>
        )}
        <button
          type="button"
          onClick={close}
          className="rounded bg-gray-600 px-4 py-2 text-sm text-white hover:bg-gray-500"
        >
          {localized.close || "Close"}
        </button>
      </Modal.Footer>
    </Modal>
  );
};

export default CompressionAnalysis;
