import { describe, expect, it, vi } from "vitest";

import { createSharedAsyncLoader, forEachWithConcurrency } from "../src/utility/packHeaderStartup";

describe("pack header startup helpers", () => {
  it("shares one in-flight cache load and retains mutations on its object", async () => {
    let finishLoad!: (value: Record<string, boolean>) => void;
    const load = vi.fn(
      () =>
        new Promise<Record<string, boolean>>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const getCache = createSharedAsyncLoader(load, () => ({}));

    const firstRead = getCache();
    const secondRead = getCache();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    const cache = { initial: true };
    finishLoad(cache);
    const [first, second] = await Promise.all([firstRead, secondRead]);

    expect(first).toBe(cache);
    expect(second).toBe(cache);
    first.updatedByCaller = true;
    expect(await getCache()).toBe(second);
    expect(second.updatedByCaller).toBe(true);
  });

  it("shares one empty fallback after the cache load fails", async () => {
    const failure = vi.fn(async (): Promise<Record<string, boolean>> => {
      throw new Error("corrupt cache");
    });
    const fallback = {};
    const getCache = createSharedAsyncLoader(failure, () => fallback);

    const [first, second] = await Promise.all([getCache(), getCache()]);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(first).toBe(fallback);
    expect(second).toBe(fallback);

    first.recovered = true;
    expect(await getCache()).toBe(second);
    expect(second.recovered).toBe(true);
  });

  it("keeps startup header and rules work within the configured concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const processed: number[] = [];
    const failedItems: number[] = [];

    await forEachWithConcurrency(
      Array.from({ length: 12 }, (_, index) => index),
      4,
      async (item) => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 1));
          try {
            if (item === 5) throw new Error("failed pack");
            processed.push(item);
          } catch {
            failedItems.push(item);
          }
        } finally {
          active--;
        }
      },
    );

    expect(maxActive).toBe(4);
    expect(processed.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
    expect(failedItems).toEqual([5]);

    let calledForEmptyInput = false;
    await forEachWithConcurrency([], 4, () => {
      calledForEmptyInput = true;
    });
    expect(calledForEmptyInput).toBe(false);
  });
});
