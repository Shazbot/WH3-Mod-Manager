/**
 * Runs requests one at a time and keeps only the newest one waiting, since an older waiting request is stale by the time
 * the current run ends.
 * @param run Does the work for a request. It may resolve undefined or throw, which both give undefined.
 * @returns `request`, which resolves with the run's result or undefined if the request was replaced or dropped, and
 * `dropQueued`, which cancels the waiting request but not the one running.
 */
export function createLatestWinsQueue<A, R>(run: (args: A) => Promise<R | undefined>) {
  let isRunning = false;
  let queued: { args: A; resolve: (result: R | undefined) => void } | undefined;

  const start = async (args: A, resolve: (result: R | undefined) => void) => {
    isRunning = true;
    try {
      resolve(await run(args));
    } catch {
      resolve(undefined);
    }
    isRunning = false;
    const next = queued;
    queued = undefined;
    if (next) void start(next.args, next.resolve);
  };

  const request = (args: A) =>
    new Promise<R | undefined>((resolve) => {
      if (!isRunning) {
        void start(args, resolve);
        return;
      }
      queued?.resolve(undefined);
      queued = { args, resolve };
    });

  const dropQueued = () => {
    queued?.resolve(undefined);
    queued = undefined;
  };

  return { request, dropQueued };
}
