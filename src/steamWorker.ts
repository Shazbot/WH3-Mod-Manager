import { fork, type ForkOptions } from "child_process";

/** Forks a Steam worker while making native Steam initialization failures visible in the main log. */
export const forkSteamWorker = (modulePath: string, args: string[], options: ForkOptions = {}) => {
  const child = fork(modulePath, args, options);
  child.once("error", (error) => {
    console.error(`Steam worker failed to start (${modulePath}):`, error);
  });
  child.once("exit", (code, signal) => {
    if (code !== 0) {
      console.error(`Steam worker exited unexpectedly (${modulePath})`, { code, signal });
    }
  });
  return child;
};
