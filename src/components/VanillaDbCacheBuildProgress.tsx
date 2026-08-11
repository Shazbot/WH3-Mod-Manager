import React, { memo, useEffect, useState } from "react";

const phaseLabels: Record<VanillaDbCacheBuildProgress["phase"], string> = {
  indexing: "Reading the database pack index",
  parsing: "Parsing vanilla database tables",
  encoding: "Encoding the database cache",
  validating: "Validating the new cache",
  writing: "Saving the cache",
  complete: "Database cache ready",
};

const terminalLabels: Partial<Record<VanillaDbCacheBuildProgress["status"], string>> = {
  failed: "Database cache unavailable; using the game pack",
  cancelled: "Database cache build cancelled",
};

export const VanillaDbCacheBuildProgressCard = memo(() => {
  const [progress, setProgress] = useState<VanillaDbCacheBuildProgress>();

  useEffect(() => {
    const unsubscribe = window.api?.onVanillaDbCacheBuildProgress((_event, nextProgress) => {
      setProgress((currentProgress) => {
        // A new indexing event supersedes a late terminal event from a build invalidated by a game
        // switch. Otherwise only the build currently shown is allowed to update the card.
        if (nextProgress.status === "running" && nextProgress.phase === "indexing") {
          return nextProgress;
        }
        if (!currentProgress || currentProgress.buildId === nextProgress.buildId) {
          return nextProgress;
        }
        return currentProgress;
      });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!progress || progress.status === "running") return;
    const hideAfterMs = progress.status === "complete" ? 1800 : 5000;
    const timeout = window.setTimeout(() => {
      setProgress((currentProgress) =>
        currentProgress?.buildId === progress.buildId ? undefined : currentProgress,
      );
    }, hideAfterMs);
    return () => window.clearTimeout(timeout);
  }, [progress]);

  if (!progress) return null;

  const isRunning = progress.status === "running";
  const percent = Math.min(100, Math.max(0, Math.round(progress.percent)));
  const label = terminalLabels[progress.status] ?? phaseLabels[progress.phase];

  return (
    <div
      aria-live="polite"
      className="dark fixed right-[1%] bottom-[1%] z-[110] w-96 rounded-lg border border-gray-600 bg-gray-800 p-4 text-gray-100 shadow-xl"
      data-testid="vanilla-db-cache-progress"
      role="status"
    >
      <div className="flex items-center gap-3">
        {isRunning && (
          <div
            aria-hidden="true"
            className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-gray-500 border-t-blue-400"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">Preparing vanilla database cache</p>
          <p className="text-sm text-gray-300">{label}</p>
        </div>
        <span className="text-sm tabular-nums text-gray-300">{percent}%</span>
      </div>
      <div
        aria-label="Vanilla database cache build progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-600"
        role="progressbar"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            progress.status === "failed" ? "bg-red-500" : "bg-blue-500"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {isRunning && (
        <p className="mt-2 text-xs text-gray-400">
          This is created once after a game or schema update. The current operation will continue when
          it is ready.
        </p>
      )}
      {progress.detail && <p className="mt-2 break-words text-xs text-gray-400">{progress.detail}</p>}
    </div>
  );
});
