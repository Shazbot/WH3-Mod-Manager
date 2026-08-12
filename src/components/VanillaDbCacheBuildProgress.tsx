import React, { memo, useEffect, useRef, useState } from "react";

type BuildKind = NonNullable<VanillaDbCacheBuildProgress["kind"]>;
type BuildPhase = VanillaDbCacheBuildProgress["phase"];
type BuildStatus = VanillaDbCacheBuildProgress["status"];

interface BuildCopy {
  title: string;
  progressLabel: string;
  runningNote: string;
  phases: Record<BuildPhase, string>;
  terminal: Partial<Record<BuildStatus, string>>;
}

/**
 * Both caches report on one channel and share this card, so every string it shows is chosen by the
 * report's `kind`. Reports without one are from the database cache, which had the channel first.
 */
const copyByKind: Record<BuildKind, BuildCopy> = {
  db: {
    title: "Preparing vanilla database cache",
    progressLabel: "Vanilla database cache build progress",
    runningNote:
      "This is created once after a game or schema update. The current operation will continue when it is ready.",
    phases: {
      indexing: "Reading the database pack index",
      parsing: "Parsing vanilla database tables",
      encoding: "Encoding the database cache",
      validating: "Validating the new cache",
      writing: "Saving the cache",
      complete: "Database cache ready",
      "reading-packs": "Reading vanilla pack file lists",
    },
    terminal: {
      failed: "Database cache unavailable; using the game pack",
      cancelled: "Database cache build cancelled",
    },
  },
  packIndex: {
    title: "Preparing vanilla file index",
    progressLabel: "Vanilla file index build progress",
    runningNote:
      "This is created once after a game update. The current operation will continue when it is ready.",
    phases: {
      indexing: "Reading the vanilla pack list",
      parsing: "Reading vanilla pack file lists",
      encoding: "Sorting and encoding vanilla file names",
      validating: "Validating the new index",
      writing: "Saving the file index",
      complete: "File index ready",
      "reading-packs": "Reading vanilla pack file lists",
    },
    terminal: {
      failed: "File index unavailable; reading packs directly",
      cancelled: "File index build cancelled",
    },
  },
};

export const VanillaDbCacheBuildProgressCard = memo(() => {
  const [progress, setProgress] = useState<VanillaDbCacheBuildProgress>();
  // Which builds have already been seen, so the first report of a build can be told from the rest.
  const seenBuildIds = useRef(new Set<string>());

  useEffect(() => {
    const unsubscribe = window.api?.onVanillaDbCacheBuildProgress((_event, nextProgress) => {
      const isFirstReport = !seenBuildIds.current.has(nextProgress.buildId);
      seenBuildIds.current.add(nextProgress.buildId);
      setProgress((currentProgress) => {
        // A build that has just started takes the card, so a build invalidated by a game switch
        // cannot hold it with a late terminal event. Otherwise only the build currently shown may
        // update the card.
        if (isFirstReport && nextProgress.status === "running") return nextProgress;
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

  const copy = copyByKind[progress.kind ?? "db"];
  const isRunning = progress.status === "running";
  const percent = Math.min(100, Math.max(0, Math.round(progress.percent)));
  const label = copy.terminal[progress.status] ?? copy.phases[progress.phase];

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
          <p className="font-medium">{copy.title}</p>
          <p className="text-sm text-gray-300">{label}</p>
        </div>
        <span className="text-sm tabular-nums text-gray-300">{percent}%</span>
      </div>
      <div
        aria-label={copy.progressLabel}
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
      {isRunning && <p className="mt-2 text-xs text-gray-400">{copy.runningNote}</p>}
      {progress.detail && <p className="mt-2 break-words text-xs text-gray-400">{progress.detail}</p>}
    </div>
  );
});
