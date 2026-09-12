import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronRight } from "react-icons/lu";
import { Modal } from "../flowbite";
import { useLocalizations } from "../localizationContext";
import type { SupportedGames } from "../supportedGames";
import type {
  CompressionAnalysisProgress,
  CompressionAnalysisResult,
  CompressionPackAnalysis,
  CompressionWin,
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

const formatFileSavingsPercent = (file: CompressionWin): string => {
  const originalBytes = file.originalBytes ?? file.storedBytes;
  if (!Number.isFinite(originalBytes) || originalBytes <= 0 || !Number.isFinite(file.savingsBytes)) return "—";
  return formatPercent((file.savingsBytes / originalBytes) * 100);
};

interface CompressionWinTableProps {
  wins: CompressionWin[];
  localized: Record<string, string | undefined>;
}

const CompressionWinTable = ({ wins, localized }: CompressionWinTableProps) => (
  <div className="mt-1 overflow-x-auto">
    <table className="min-w-[30rem] w-full table-fixed text-xs">
      <colgroup>
        <col />
        <col className="w-28" />
        <col className="w-24" />
        <col className="w-20" />
      </colgroup>
      <thead className="text-left text-gray-400">
        <tr>
          <th scope="col" className="pr-3 font-medium">
            {localized.compressionAnalysisFile || "File"}
          </th>
          <th scope="col" className="whitespace-nowrap pr-3 font-medium">
            {localized.compressionAnalysisCompressionType || "Compression type"}
          </th>
          <th scope="col" className="whitespace-nowrap pr-3 text-right font-medium">
            {localized.compressionAnalysisSaved || "Saved"}
          </th>
          <th scope="col" className="whitespace-nowrap text-right font-medium">
            {localized.compressionAnalysisPercentSaved || "% saved"}
          </th>
        </tr>
      </thead>
      <tbody>
        {wins.map((win) => (
          <tr key={win.fileName} className="border-t border-gray-700/60">
            <td className="max-w-0 truncate py-1 pr-3" title={win.fileName}>
              {win.fileName}
            </td>
            <td className="whitespace-nowrap py-1 pr-3">{win.selectedCodec}</td>
            <td className="whitespace-nowrap py-1 pr-3 text-right">{formatBytes(win.savingsBytes)}</td>
            <td className="whitespace-nowrap py-1 text-right">{formatFileSavingsPercent(win)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

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
  const orderedPacks = useMemo(() => {
    if (!result) return [];
    return [...result.packs].sort(
      (first, second) => second.bytesSaved - first.bytesSaved || first.packName.localeCompare(second.packName),
    );
  }, [result]);
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
                {orderedPacks.map((pack) => (
                  <details
                    key={pack.packPath}
                    className="group rounded border border-gray-600 p-3"
                    open={orderedPacks.length === 1}
                  >
                    <summary className="flex list-none cursor-pointer items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                      <LuChevronRight
                        className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 break-all">{pack.packName}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-gray-400">
                        <span className="whitespace-nowrap">{statusLabel(pack, localized)}</span>
                        <span className="flex items-center gap-1.5 whitespace-nowrap font-semibold text-gray-200">
                          <span>
                            {formatPercent(pack.wholePackPercentSaved)}{" "}
                            {localized.compressionAnalysisSavedSuffix || "saved"}
                          </span>
                          <span className="font-normal text-gray-400">({formatBytes(pack.bytesSaved)})</span>
                        </span>
                      </span>
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
                        <CompressionWinTable wins={pack.topWins} localized={localized} />
                      </div>
                    )}
                    {pack.rigidModelV2Wins.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-semibold uppercase text-yellow-300">
                          {localized.compressionAnalysisRigidWins ||
                            ".rigid_model_v2 wins (reported separately; LZ4 is the cautious default)"}
                        </div>
                        <CompressionWinTable wins={pack.rigidModelV2Wins.slice(0, 10)} localized={localized} />
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
