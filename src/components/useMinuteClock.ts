import { useSyncExternalStore } from "react";

const TICK_MS = 60_000;

let now = Date.now();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | undefined;

const refresh = () => {
  now = Date.now();
  for (const listener of listeners) listener();
};

// A hidden window skips ticks entirely and catches up the moment it is shown again.
const onTick = () => {
  if (!document.hidden) refresh();
};
const onVisibilityChange = () => {
  if (!document.hidden) refresh();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    intervalId = setInterval(onTick, TICK_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(intervalId);
      intervalId = undefined;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
};

const getSnapshot = () => now;

/**
 * The current time, refreshed about once a minute through one timer shared by every subscriber.
 * For relative labels like "5 minutes ago" that should keep up with wall-clock time.
 */
export const useMinuteClock = () => useSyncExternalStore(subscribe, getSnapshot);
