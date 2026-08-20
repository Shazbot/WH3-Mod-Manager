import { fork, type ForkOptions } from "child_process";

/** Forks a Steam worker while making native Steam initialization failures visible in the main log. */
export const forkSteamWorker = (modulePath: string, args: string[], options: ForkOptions = {}) => {
  const child = fork(modulePath, args, options);
  child.once("error", (error) => {
    console.error(`Steam worker failed to start (${modulePath}):`, error);
  });
  child.once("exit", (code, signal) => {
    // A null code means the worker was killed by a signal, which is how deliberate teardown looks.
    if (code !== 0 && code !== null) {
      console.error(`Steam worker exited unexpectedly (${modulePath})`, { code, signal });
    }
  });
  return child;
};
