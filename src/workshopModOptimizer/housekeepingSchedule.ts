/**
 * Starts cache housekeeping a little after startup without ever blocking it: the work is scheduled on a
 * timer, never awaited, and a failure is swallowed (the run itself logs).
 */
export const scheduleStartupHousekeeping = (
  run: () => Promise<void>,
  delayMs = 20_000,
  setTimer: (callback: () => void, ms: number) => { unref?: () => void } | unknown = setTimeout,
): void => {
  const handle = setTimer(() => {
    void run().catch(() => undefined);
  }, delayMs);
  (handle as { unref?: () => void } | undefined)?.unref?.();
};
