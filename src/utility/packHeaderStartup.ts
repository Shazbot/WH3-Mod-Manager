/** Shares the first asynchronous load, including its fallback, across all callers. */
export function createSharedAsyncLoader<T>(load: () => Promise<T>, fallback: () => T): () => Promise<T> {
  let promise: Promise<T> | null = null;

  return () => {
    if (promise !== null) return promise;
    promise = Promise.resolve()
      .then(load)
      .catch(() => fallback());
    return promise;
  };
}

/** Runs asynchronous work with at most `concurrency` callbacks active at once. */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  callback: (item: T, index: number) => void | Promise<void>,
): Promise<void> {
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        await callback(items[index], index);
      }
    }),
  );
}
