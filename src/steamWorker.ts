import { fork, type ChildProcess, type ForkOptions } from "child_process";

const intentionallyTerminatedWorkers = new WeakSet<ChildProcess>();
const STEAM_WORKER_FAILURE_LOG_WINDOW_MS = 60_000;

type SteamWorkerFailureLogger = Pick<Console, "error" | "warn">;

type SteamWorkerFailureLogState = {
  message: string;
  details?: unknown;
  suppressedCount: number;
  timer: NodeJS.Timeout;
};

/** Coalesces repeated failures from a broken Steam IPC session without hiding the first failure. */
export const createSteamWorkerFailureReporter = (
  logger: SteamWorkerFailureLogger = console,
  windowMs = STEAM_WORKER_FAILURE_LOG_WINDOW_MS,
) => {
  const states = new Map<string, SteamWorkerFailureLogState>();

  const flush = (key: string) => {
    const state = states.get(key);
    if (!state) return;
    clearTimeout(state.timer);
    states.delete(key);
    if (state.suppressedCount === 0) return;

    logger.warn(`${state.message} Repeated failure; suppressed ${state.suppressedCount} duplicate report(s).`, {
      key,
      details: state.details,
    });
  };

  const report = (key: string, message: string, details?: unknown) => {
    const existing = states.get(key);
    if (existing) {
      existing.suppressedCount += 1;
      return;
    }

    const timer = setTimeout(() => flush(key), windowMs);
    timer.unref?.();
    states.set(key, { message, details, suppressedCount: 0, timer });
    logger.error(message, details);
  };

  const dispose = () => {
    for (const state of states.values()) clearTimeout(state.timer);
    states.clear();
  };

  return { report, flush, dispose };
};

const reportSteamWorkerFailure = createSteamWorkerFailureReporter();

export const isUnexpectedSteamWorkerExit = (
  code: number | null,
  signal: NodeJS.Signals | null,
  intentionallyTerminated: boolean,
) => !intentionallyTerminated && (code !== 0 || signal !== null);

/** Marks a Steam worker as intentionally terminated before sending it a signal. */
export const terminateSteamWorker = (child: ChildProcess, signal: NodeJS.Signals | number = "SIGTERM") => {
  intentionallyTerminatedWorkers.add(child);
  try {
    const didSignal = child.kill(signal);
    if (!didSignal) intentionallyTerminatedWorkers.delete(child);
    return didSignal;
  } catch (error) {
    intentionallyTerminatedWorkers.delete(child);
    throw error;
  }
};

/** Forks a Steam worker while making native Steam initialization failures visible in the main log. */
export const forkSteamWorker = (modulePath: string, args: string[], options: ForkOptions = {}) => {
  const child = fork(modulePath, args, options);
  let reportedStartError = false;
  child.once("error", (error) => {
    reportedStartError = true;
    reportSteamWorkerFailure.report(`start:${modulePath}`, `Steam worker failed to start (${modulePath}):`, error);
  });
  child.once("exit", (code, signal) => {
    const intentionallyTerminated = intentionallyTerminatedWorkers.delete(child);
    if (!reportedStartError && isUnexpectedSteamWorkerExit(code, signal, intentionallyTerminated)) {
      reportSteamWorkerFailure.report(
        `exit:${modulePath}:${code}:${signal}`,
        `Steam worker exited unexpectedly (${modulePath})`,
        { code, signal },
      );
    }
  });
  return child;
};
