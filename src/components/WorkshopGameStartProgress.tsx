import React, { memo, useCallback, useContext, useEffect, useRef, useState } from "react";

import { Modal } from "../flowbite";
import localizationContext from "../localizationContext";

/**
 * Progress emitted while a game-start Workshop staging run is preparing the files the game will
 * load.  The IPC implementation owns the exact staging work; the renderer only needs a stable
 * run id so a late report from an older launch cannot take over the card.
 */
export type WorkshopGameStartProgressStatus = WorkshopModStagingProgressStatus;
export type WorkshopGameStartProgress = WorkshopModStagingProgressEvent;

type WorkshopGameStartProgressCallback = (
  event: Electron.IpcRendererEvent,
  progress: WorkshopGameStartProgress,
) => void;

const terminalStatuses = new Set(["cancelled", "canceled", "complete", "completed", "failed", "error"]);

const normalizeStatus = (status: unknown): WorkshopGameStartProgressStatus => {
  switch (String(status).toLowerCase()) {
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "canceling":
    case "cancelling":
    case "cancelrequested":
    case "cancel_requested":
      return "canceling";
    case "complete":
    case "completed":
    case "finished":
    case "done":
    case "success":
      return "complete";
    case "aborted":
    case "failed":
    case "error":
      return "failed";
    default:
      return "running";
  }
};

const asFiniteNumber = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  return value.length > 0 ? value : undefined;
};

/** Normalize the small differences between preload versions while the app is being upgraded. */
const normalizeProgress = (value: unknown): WorkshopGameStartProgress | undefined => {
  if (!value || typeof value !== "object") return undefined;

  const raw = value as Record<string, unknown>;
  const runId = asString(raw.runId) ?? asString(raw.gameStartId) ?? asString(raw.launchId) ?? asString(raw.id);
  if (!runId) return undefined;

  const completedMods =
    asFiniteNumber(raw.completedMods) ??
    asFiniteNumber(raw.completed) ??
    asFiniteNumber(raw.modsCompleted) ??
    asFiniteNumber(raw.current);
  const totalMods = asFiniteNumber(raw.totalMods) ?? asFiniteNumber(raw.total) ?? asFiniteNumber(raw.modsTotal);
  const fileIndex = asFiniteNumber(raw.fileIndex);
  const fileCount = asFiniteNumber(raw.fileCount);
  const bytesCopied = asFiniteNumber(raw.bytesCopied);
  const totalBytes = asFiniteNumber(raw.totalBytes);
  const explicitPercent = asFiniteNumber(raw.percent) ?? asFiniteNumber(raw.progress);
  const percent =
    explicitPercent ??
    (completedMods !== undefined && totalMods !== undefined && totalMods > 0
      ? ((completedMods +
          (fileIndex !== undefined && fileCount !== undefined && fileCount > 0 ? fileIndex / fileCount : 0)) /
          totalMods) *
        100
      : undefined);
  const phase = asString(raw.stage) ?? asString(raw.phase) ?? "preparing";

  return {
    runId,
    status: normalizeStatus(raw.status ?? phase),
    stage: phase,
    percent,
    completedMods,
    totalMods,
    bytesCopied,
    totalBytes,
    fileIndex,
    fileCount,
    currentMod:
      asString(raw.currentMod) ?? asString(raw.currentModName) ?? asString(raw.modName) ?? asString(raw.currentPack),
    currentFile: asString(raw.currentFile) ?? asString(raw.fileName) ?? asString(raw.filePath),
    detail: asString(raw.detail) ?? asString(raw.message),
    error: asString(raw.error),
  };
};

const humanizeStage = (stage: string): string =>
  stage
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (first) => first.toUpperCase());

const stageCopyKey: Record<string, string> = {
  prepare: "workshopGameStartPreparing",
  preparing: "workshopGameStartPreparing",
  planning: "workshopGameStartPreparing",
  discover: "workshopGameStartPreparing",
  discovering: "workshopGameStartPreparing",
  pruning: "workshopGameStartCleaning",
  copy: "workshopGameStartCopying",
  copying: "workshopGameStartCopying",
  compress: "workshopGameStartCompressing",
  compressing: "workshopGameStartCompressing",
  cleanup: "workshopGameStartCleaning",
  cleaning: "workshopGameStartCleaning",
  checkpointing: "workshopGameStartCheckpointing",
  saving: "workshopGameStartCheckpointing",
  launch: "workshopGameStartLaunching",
  launching: "workshopGameStartLaunching",
  completed: "workshopGameStartComplete",
};

const stageFallback: Record<string, string> = {
  prepare: "Preparing Workshop mods…",
  preparing: "Preparing Workshop mods…",
  planning: "Preparing Workshop mods…",
  discover: "Preparing Workshop mods…",
  discovering: "Preparing Workshop mods…",
  pruning: "Cleaning up stale Workshop mods…",
  copy: "Copying Workshop mods…",
  copying: "Copying Workshop mods…",
  compress: "Compressing Workshop mods…",
  compressing: "Compressing Workshop mods…",
  cleanup: "Cleaning up Workshop mods…",
  cleaning: "Cleaning up Workshop mods…",
  checkpointing: "Saving Workshop staging checkpoint…",
  saving: "Saving Workshop staging checkpoint…",
  launch: "Launching game…",
  launching: "Launching game…",
  completed: "Workshop mods ready",
};

const getStageLabel = (localized: Record<string, string>, stage: string): string => {
  const normalizedStage = stage.toLowerCase();
  const key = stageCopyKey[normalizedStage];
  return (key && localized[key]) || stageFallback[normalizedStage] || humanizeStage(stage);
};

const getCurrentItem = (progress: WorkshopGameStartProgress): string | undefined =>
  progress.currentMod || progress.currentFile;

const getProgressPercent = (progress: WorkshopGameStartProgress): number | undefined => {
  const percent =
    progress.percent ??
    (progress.completedMods !== undefined && progress.totalMods !== undefined
      ? progress.totalMods > 0
        ? (progress.completedMods / progress.totalMods) * 100
        : 0
      : undefined);
  if (percent === undefined || !Number.isFinite(percent)) return undefined;
  return Math.min(100, Math.max(0, Math.round(percent)));
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${(bytes / 1024 ** (unitIndex + 1)).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
};

/** The main process keeps the run alive while it prepares the rest of the launch command. */
const isStagingComplete = (progress: WorkshopGameStartProgress): boolean => {
  const status = normalizeStatus(progress.status);
  return status === "complete" || (status === "running" && progress.stage.toLowerCase() === "launching");
};

const WorkshopGameStartProgressCard = memo(() => {
  const localized = useContext(localizationContext) as Record<string, string>;
  const [progress, setProgress] = useState<WorkshopGameStartProgress>();
  const [cancelRequestedRunId, setCancelRequestedRunId] = useState<string>();
  const cancelRequestedRunIdRef = useRef<string>();
  const seenRunIds = useRef(new Set<string>());

  useEffect(() => {
    const api = window.api;
    if (!api) return undefined;

    const onProgress: WorkshopGameStartProgressCallback = (_event, rawProgress) => {
      const nextProgress = normalizeProgress(rawProgress);
      if (!nextProgress) return;

      const isFirstReport = !seenRunIds.current.has(nextProgress.runId);
      seenRunIds.current.add(nextProgress.runId);
      setProgress((currentProgress) => {
        // A new active run takes over immediately. Every later report must belong to the run on
        // screen, otherwise a canceled/failed old launch could replace a newer launch's status.
        if (
          !currentProgress ||
          (isFirstReport && (nextProgress.status === "running" || nextProgress.status === "canceling"))
        ) {
          return nextProgress;
        }
        if (currentProgress.runId === nextProgress.runId && currentProgress.status === "canceling") {
          return nextProgress.status === "running" ? { ...nextProgress, status: "canceling" } : nextProgress;
        }
        return currentProgress.runId === nextProgress.runId ? nextProgress : currentProgress;
      });

      if (nextProgress.status !== "running") {
        setCancelRequestedRunId((currentRunId) =>
          currentRunId === nextProgress.runId && nextProgress.status !== "canceling" ? undefined : currentRunId,
        );
        if (cancelRequestedRunIdRef.current === nextProgress.runId && nextProgress.status !== "canceling") {
          cancelRequestedRunIdRef.current = undefined;
        }
      } else if (cancelRequestedRunIdRef.current && cancelRequestedRunIdRef.current !== nextProgress.runId) {
        cancelRequestedRunIdRef.current = undefined;
        setCancelRequestedRunId(undefined);
      }
    };

    const unsubscribe = api.onWorkshopModStagingProgress(onProgress);
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!progress) return undefined;
    const normalizedStatus = normalizeStatus(progress.status);
    if (!terminalStatuses.has(String(progress.status).toLowerCase()) && !isStagingComplete(progress)) return undefined;

    const runId = progress.runId;
    // Success and cancellation are short confirmations; failures stay visible a little longer
    // so the user can read the reason returned by the main process.
    const hideAfterMs = isStagingComplete(progress) || normalizedStatus === "cancelled" ? 1800 : 5000;
    const timeout = window.setTimeout(() => {
      setProgress((currentProgress) => (currentProgress?.runId === runId ? undefined : currentProgress));
      setCancelRequestedRunId((currentRunId) => (currentRunId === runId ? undefined : currentRunId));
      if (cancelRequestedRunIdRef.current === runId) cancelRequestedRunIdRef.current = undefined;
    }, hideAfterMs);
    return () => window.clearTimeout(timeout);
  }, [progress]);

  const status = progress ? normalizeStatus(progress.status) : undefined;
  const stagingComplete = progress ? isStagingComplete(progress) : false;
  const isRunning = status === "running" && !stagingComplete;
  const isCanceling = status === "canceling" || cancelRequestedRunId === progress?.runId;
  const cancel = window.api?.cancelWorkshopModStaging;
  const canCancel = isRunning && !isCanceling && !!cancel;

  const requestCancel = useCallback(() => {
    if (!progress || !canCancel || !cancel || cancelRequestedRunIdRef.current === progress.runId) return;
    cancelRequestedRunIdRef.current = progress.runId;
    setCancelRequestedRunId(progress.runId);
    setProgress((currentProgress) =>
      currentProgress?.runId === progress.runId ? { ...currentProgress, status: "canceling" } : currentProgress,
    );
    cancel(progress.runId);
  }, [canCancel, cancel, progress]);

  useEffect(() => {
    if (!progress || (!isRunning && !isCanceling)) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isCanceling, isRunning, progress, requestCancel]);

  if (!progress || !status) return null;

  const percent = getProgressPercent(progress);
  const currentItem = getCurrentItem(progress);
  const stageLabel = getStageLabel(localized, progress.stage);
  const title = localized.workshopGameStartTitle || "Preparing Workshop mods for game start";
  const progressLabel = localized.workshopGameStartProgressLabel || "Workshop mod staging progress";
  const statusLabel = stagingComplete
    ? localized.workshopGameStartComplete || "Workshop mods ready"
    : status === "cancelled"
      ? localized.workshopGameStartCanceled || "Workshop mod staging canceled"
      : status === "failed"
        ? localized.workshopGameStartFailed || "Workshop mod staging failed"
        : isCanceling
          ? localized.workshopGameStartCanceling || "Canceling Workshop mod staging…"
          : stageLabel;
  const cancelLabel = localized.workshopGameStartCancel || localized.cancel || "Cancel";

  return (
    <Modal
      aria-labelledby="workshop-game-start-progress-title"
      aria-modal="true"
      onClose={requestCancel}
      position="center"
      show
      size="md"
      style={{ zIndex: 200 }}
    >
      <Modal.Header>
        <span id="workshop-game-start-progress-title">{title}</span>
      </Modal.Header>
      <Modal.Body>
        <div
          aria-busy={isRunning || isCanceling}
          aria-live="polite"
          data-testid="workshop-game-start-progress"
          role="status"
        >
          <div className="flex items-start gap-3">
            {isRunning && (
              <div
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-gray-500 border-t-blue-400"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600 dark:text-gray-300">{statusLabel}</p>
              {currentItem && <p className="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">{currentItem}</p>}
              {progress.completedMods !== undefined && progress.totalMods !== undefined && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {progress.completedMods} / {progress.totalMods} mods
                </p>
              )}
              {progress.bytesCopied !== undefined && progress.totalBytes !== undefined && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {formatBytes(progress.bytesCopied)} / {formatBytes(progress.totalBytes)}
                </p>
              )}
              {progress.detail && (
                <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{progress.detail}</p>
              )}
              {progress.error && <p className="mt-1 break-words text-xs text-red-600">{progress.error}</p>}
            </div>
            {percent !== undefined && <span className="text-sm tabular-nums text-gray-500">{percent}%</span>}
          </div>
          <div
            aria-label={progressLabel}
            aria-valuemax={100}
            aria-valuemin={0}
            {...(percent === undefined ? {} : { "aria-valuenow": percent })}
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-300 dark:bg-gray-600"
            role="progressbar"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                status === "failed" ? "bg-red-500" : status === "cancelled" ? "bg-gray-400" : "bg-blue-500"
              } ${percent === undefined ? "w-1/3 animate-pulse" : ""}`}
              style={percent === undefined ? undefined : { width: `${percent}%` }}
            />
          </div>
        </div>
      </Modal.Body>
      {((isRunning && !!cancel) || isCanceling) && (
        <Modal.Footer>
          <button
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canCancel}
            onClick={requestCancel}
            type="button"
          >
            {isCanceling ? localized.workshopGameStartCanceling || "Canceling Workshop mod staging…" : cancelLabel}
          </button>
        </Modal.Footer>
      )}
    </Modal>
  );
});

export { WorkshopGameStartProgressCard };
export default WorkshopGameStartProgressCard;
