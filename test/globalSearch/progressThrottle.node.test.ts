import { describe, expect, it } from "vitest";

import { createProgressThrottle } from "../../src/globalSearch/progressThrottle";

type Progress = { stage: string; resultCount: number };

/** A fake clock and timer queue, so the behaviour is checked without waiting on a real one. */
const makeHarness = (intervalMs = 50) => {
  const delivered: Progress[] = [];
  let clock = 1000;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();

  const throttle = createProgressThrottle<Progress>({
    intervalMs,
    deliver: (progress) => delivered.push(progress),
    isTerminal: (progress) => progress.stage === "done",
    now: () => clock,
    schedule: ((callback: () => void, delayMs: number) => {
      const handle = nextHandle++;
      timers.set(handle, { at: clock + delayMs, callback });
      return handle;
    }) as never,
    unschedule: ((handle: number) => timers.delete(handle)) as never,
  });

  return {
    delivered,
    throttle,
    pendingTimers: () => timers.size,
    advance(ms: number) {
      clock += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at > clock) continue;
        timers.delete(handle);
        timer.callback();
      }
    },
  };
};

const progress = (resultCount: number, stage = "pack"): Progress => ({ stage, resultCount });

describe("progress throttle", () => {
  it("delivers the first update immediately", () => {
    const { throttle, delivered } = makeHarness();
    throttle.send(progress(1));
    expect(delivered).toEqual([progress(1)]);
  });

  it("coalesces a burst into one delivery carrying the newest state", () => {
    const harness = makeHarness();
    harness.throttle.send(progress(1));
    for (let count = 2; count <= 500; count++) harness.throttle.send(progress(count));

    expect(harness.delivered).toEqual([progress(1)]);

    harness.advance(50);
    expect(harness.delivered).toEqual([progress(1), progress(500)]);
  });

  it("delivers again once the window has passed", () => {
    const harness = makeHarness();
    harness.throttle.send(progress(1));
    harness.advance(60);
    harness.throttle.send(progress(2));

    expect(harness.delivered).toEqual([progress(1), progress(2)]);
    expect(harness.pendingTimers()).toBe(0);
  });

  it("never coalesces away a terminal update", () => {
    const harness = makeHarness();
    harness.throttle.send(progress(1));
    harness.throttle.send(progress(2));
    harness.throttle.send(progress(3, "done"));

    expect(harness.delivered).toEqual([progress(1), progress(3, "done")]);
    // The queued intermediate update must not arrive after the terminal one.
    harness.advance(50);
    expect(harness.delivered).toEqual([progress(1), progress(3, "done")]);
  });

  it("drops a queued update when the run is canceled", () => {
    const harness = makeHarness();
    harness.throttle.send(progress(1));
    harness.throttle.send(progress(2));
    harness.throttle.cancel();
    harness.advance(50);

    expect(harness.delivered).toEqual([progress(1)]);
    expect(harness.pendingTimers()).toBe(0);
  });

  it("flushes a queued update on demand", () => {
    const harness = makeHarness();
    harness.throttle.send(progress(1));
    harness.throttle.send(progress(2));
    harness.throttle.flush();

    expect(harness.delivered).toEqual([progress(1), progress(2)]);
    expect(harness.pendingTimers()).toBe(0);
  });
});
