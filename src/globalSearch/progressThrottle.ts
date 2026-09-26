/**
 * Coalescing for progress reports.
 *
 * The search reports once per result and once per file scanned, which over a whole-game search is
 * tens of thousands of updates - the same cost the batched result emitter exists to avoid, and the
 * flaw the pack collisions check already works around by throttling to 50 ms. Intermediate updates
 * are worth dropping because only the newest one carries information; a terminal update is not,
 * because it is the state the reader settles on.
 *
 * Kept pure and injectable so the behaviour is testable without an Electron sender or a real clock.
 */

type TimerHandle = ReturnType<typeof setTimeout>;

export const DEFAULT_PROGRESS_THROTTLE_MS = 50;

export interface ProgressThrottleOptions<TProgress> {
  deliver: (progress: TProgress) => void;
  /** Delivered immediately and never coalesced away. Defaults to nothing being terminal. */
  isTerminal?: (progress: TProgress) => boolean;
  intervalMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  unschedule?: (handle: TimerHandle) => void;
}

export interface ProgressThrottle<TProgress> {
  send(progress: TProgress): void;
  /** Delivers whatever is queued, if anything. */
  flush(): void;
  /** Drops whatever is queued, for a run that ended without a terminal report. */
  cancel(): void;
}

export const createProgressThrottle = <TProgress>({
  deliver,
  isTerminal = () => false,
  intervalMs = DEFAULT_PROGRESS_THROTTLE_MS,
  now = Date.now,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  unschedule = (handle) => clearTimeout(handle),
}: ProgressThrottleOptions<TProgress>): ProgressThrottle<TProgress> => {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: { progress: TProgress } | undefined;
  let timer: TimerHandle | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    unschedule(timer);
    timer = undefined;
  };

  const deliverNow = (progress: TProgress) => {
    pending = undefined;
    lastSentAt = now();
    deliver(progress);
  };

  return {
    send(progress) {
      pending = { progress };
      const sinceLast = now() - lastSentAt;
      if (isTerminal(progress) || sinceLast >= intervalMs) {
        clearTimer();
        deliverNow(progress);
        return;
      }
      // Inside the window: keep the newest state and let the timer already running deliver it.
      if (timer !== undefined) return;
      timer = schedule(() => {
        timer = undefined;
        if (pending) deliverNow(pending.progress);
      }, intervalMs - sinceLast);
    },
    flush() {
      clearTimer();
      if (pending) deliverNow(pending.progress);
    },
    cancel() {
      clearTimer();
      pending = undefined;
    },
  };
};
