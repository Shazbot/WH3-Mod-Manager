import { fork, type ChildProcess, type ForkOptions } from "child_process";

const intentionallyTerminatedWorkers = new WeakSet<ChildProcess>();

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
  child.once("error", (error) => {
    console.error(`Steam worker failed to start (${modulePath}):`, error);
  });
  child.once("exit", (code, signal) => {
    const intentionallyTerminated = intentionallyTerminatedWorkers.delete(child);
    if (isUnexpectedSteamWorkerExit(code, signal, intentionallyTerminated)) {
      console.error(`Steam worker exited unexpectedly (${modulePath})`, { code, signal });
    }
  });
  return child;
};
