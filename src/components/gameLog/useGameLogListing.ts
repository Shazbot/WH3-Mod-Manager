import { useEffect, useSyncExternalStore } from "react";
import type { GameLogInfo } from "../../utility/logPaths";

const LIVE_WINDOW_MS = 60_000;

export type GameLogListingSnapshot = {
  logs: GameLogInfo[];
  errorCounts: Record<string, number>;
  listError?: string;
  livePath?: string;
};

const emptySnapshot: GameLogListingSnapshot = { logs: [], errorCounts: {} };

let snapshot = emptySnapshot;
let refCount = 0;
let sequence = 0;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let removeListChanged: (() => void) | undefined;
let removeErrorCounts: (() => void) | undefined;
const listeners = new Set<() => void>();

const setSnapshot = (next: GameLogListingSnapshot) => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const clearLiveTimer = () => {
  if (liveTimer !== undefined) clearTimeout(liveTimer);
  liveTimer = undefined;
};

const refresh = async () => {
  const mySequence = ++sequence;
  const result = await window.api?.gameLogList();
  if (mySequence !== sequence || refCount === 0) return;
  if (!result?.success) {
    setSnapshot({ ...snapshot, listError: result?.error ?? "Could not read the game logs." });
    return;
  }
  const nextLogs = result.logs ?? [];
  // Keep the last known count of a log that is being recounted, so a growing live log doesn't flicker.
  const errorCounts: Record<string, number> = {};
  for (const log of nextLogs) {
    const count = result.errorCounts?.[log.path] ?? snapshot.errorCounts[log.path];
    if (count !== undefined) errorCounts[log.path] = count;
  }
  const newest = nextLogs.find((log) => log.isScriptLog);
  const remaining = newest ? newest.mtimeMs + LIVE_WINDOW_MS - Date.now() : 0;
  const livePath = newest && remaining > 0 ? newest.path : undefined;
  clearLiveTimer();
  if (livePath) {
    liveTimer = setTimeout(() => {
      liveTimer = undefined;
      setSnapshot({ ...snapshot, livePath: undefined });
    }, remaining);
  }
  setSnapshot({ logs: nextLogs, errorCounts, listError: undefined, livePath });
};

const start = () => {
  void refresh();
  removeListChanged = window.api?.onGameLogListChanged(() => void refresh());
  removeErrorCounts = window.api?.onGameLogErrorCounts((counts) => {
    if (refCount === 0) return;
    setSnapshot({ ...snapshot, errorCounts: { ...snapshot.errorCounts, ...counts } });
  });
};

const stop = () => {
  sequence++;
  removeListChanged?.();
  removeErrorCounts?.();
  removeListChanged = undefined;
  removeErrorCounts = undefined;
  clearLiveTimer();
  void window.api?.gameLogStopWatching();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => snapshot;

export const selectLiveErrorCount = (value: GameLogListingSnapshot) =>
  value.livePath ? (value.errorCounts[value.livePath] ?? 0) : 0;

/** Shared game log listing; the list watcher and error scan run while any consumer is enabled. */
export const useGameLogListing = (isEnabled: boolean): GameLogListingSnapshot => {
  useEffect(() => {
    if (!isEnabled) return;
    // A later consumer (opening the tab) still re-lists, e.g. after the game folder changed.
    if (refCount++ === 0) start();
    else void refresh();
    return () => {
      if (--refCount === 0) stop();
    };
  }, [isEnabled]);
  return useSyncExternalStore(subscribe, getSnapshot);
};
