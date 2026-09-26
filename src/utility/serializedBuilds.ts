/**
 * Runs a feature's data builds one at a time, sharing a build that is already under way.
 *
 * Builders like the Unit Viewer's fill parsed rows into the packs held in `appData.packsData`, use
 * them across several awaits, and then hand those rows back with `releaseParsedTables`. That release
 * is safe only while nothing else is mid-build over the same tables: a second build of the same
 * feature parks on an await, the first one finishes and drops the rows out from under it, and the
 * second reads a vanilla pack with nothing parsed in it. Nothing throws - the pack is still there,
 * its tables just have no rows - so the half-empty result is treated as real and cached.
 *
 * Two callers asking for the same `key` get the same build. A different `key` - a mod enabled while
 * the first build was running, which is the usual way two builds overlap - waits for the one in
 * flight rather than running beside it.
 */
export interface SerializedBuilds {
  run<T>(key: string, build: () => Promise<T>): Promise<T>;
}

export const createSerializedBuilds = (): SerializedBuilds => {
  let pendingKey: string | undefined;
  let pending: Promise<unknown> | undefined;

  return {
    run<T>(key: string, build: () => Promise<T>): Promise<T> {
      if (pending && pendingKey === key) return pending as Promise<T>;

      // Both handlers run the build: a build that failed still releases the queue, and the failure
      // belongs to whoever asked for it rather than to the request behind it.
      const started = (pending ?? Promise.resolve()).then(build, build);
      pendingKey = key;
      pending = started;
      void started
        .catch(() => undefined)
        .then(() => {
          if (pending === started) {
            pending = undefined;
            pendingKey = undefined;
          }
        });
      return started;
    },
  };
};
