import { EventEmitter } from "node:events";
import * as os from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BackgroundPass,
  type BackgroundStatus,
  BackgroundOptimizer,
} from "../src/workshopModOptimizer/background";
import { type HostChildProcess, runHost } from "../src/workshopModOptimizer/hostRunner";
import type {
  WorkshopStagingOptimizerContext,
  WorkshopStagingOptimizerMod,
  WorkshopStagingOptimizerResult,
} from "../src/utility/workshopModStaging";

const mod = (name: string): WorkshopStagingOptimizerMod => ({
  name,
  path: `C:\\mods\\${name}`,
  sourceFingerprint: { size: 1, mtimeMs: 1 },
});

interface Harness {
  background: BackgroundOptimizer<string>;
  statuses: BackgroundStatus[];
  logs: string[];
  planCalls: string[];
  produced: string[];
  /** Resolves/rejects the running produce call of a mod. */
  finish: (name: string) => void;
  signalOf: (name: string) => AbortSignal | undefined;
  progress: (name: string, fraction: number) => void;
  setGameRunning: (running: boolean) => void;
}

const makeHarness = (jobsFor: (snapshot: string) => string[]): Harness => {
  const statuses: BackgroundStatus[] = [];
  const logs: string[] = [];
  const planCalls: string[] = [];
  const produced: string[] = [];
  const pending = new Map<string, { resolve: () => void; context: WorkshopStagingOptimizerContext }>();
  let gameRunning = false;
  const background = new BackgroundOptimizer<string>({
    debounceMs: 60_000,
    afterGameMs: 15_000,
    plan: async (snapshot): Promise<BackgroundPass | undefined> => {
      planCalls.push(snapshot);
      const names = jobsFor(snapshot);
      return {
        considered: names.length + 1,
        jobs: names.map((name) => ({ mod: mod(name), plan: { key: `key-${name}`, cached: false } })),
        produce: (target, _plan, context) =>
          new Promise<WorkshopStagingOptimizerResult>((resolve, reject) => {
            produced.push(target.name);
            context.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
            pending.set(target.name, {
              context,
              resolve: () => resolve({ status: "ready", packPath: "p", fromCache: false, warnings: [] }),
            });
          }),
        describe: (job, result) => `${job.mod.name}: ${result.status}`,
      };
    },
    isGameRunning: () => gameRunning,
    log: (message) => logs.push(message),
    onStatus: (status) => statuses.push(status),
  });
  return {
    background,
    statuses,
    logs,
    planCalls,
    produced,
    finish: (name) => pending.get(name)?.resolve(),
    signalOf: (name) => pending.get(name)?.context.signal,
    progress: (name, fraction) => pending.get(name)?.context.onProgress({ stage: "Stage", fraction }),
    setGameRunning: (running) => {
      gameRunning = running;
      background.gameRunningChanged(running);
    },
  };
};

const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

describe("background optimizer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plans 60 seconds after the last change and restarts the wait on a new change", async () => {
    const h = makeHarness(() => []);
    h.background.notifyChange("one");
    await vi.advanceTimersByTimeAsync(59_000);
    expect(h.planCalls).toEqual([]);
    h.background.notifyChange("two");
    await vi.advanceTimersByTimeAsync(59_000);
    expect(h.planCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(h.planCalls).toEqual(["two"]);
  });

  it("runs the jobs one at a time, reports progress and logs each one", async () => {
    const h = makeHarness(() => ["a.pack", "b.pack"]);
    h.background.notifyChange("s");
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    expect(h.produced).toEqual(["a.pack"]);
    h.progress("a.pack", 0.5);
    expect(h.background.getStatus()).toMatchObject({
      state: "running",
      total: 2,
      done: 0,
      currentMod: "a.pack",
      fraction: 0.5,
    });
    h.finish("a.pack");
    await flush();
    expect(h.produced).toEqual(["a.pack", "b.pack"]);
    h.finish("b.pack");
    await h.background.idle();
    expect(h.background.getStatus().state).toBe("idle");
    expect(h.logs.filter((line) => /: ready$/.test(line))).toEqual(["a.pack: ready", "b.pack: ready"]);
  });

  it("a change during a job stops it and replans after the debounce", async () => {
    const h = makeHarness(() => ["a.pack"]);
    h.background.notifyChange("first");
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    const signal = h.signalOf("a.pack")!;
    expect(signal.aborted).toBe(false);

    h.background.notifyChange("second");
    await flush();
    expect(signal.aborted).toBe(true);
    expect(h.planCalls).toEqual(["first"]);
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    expect(h.planCalls).toEqual(["first", "second"]);
  });

  it("pauses while the game runs and plans again after it exits", async () => {
    const h = makeHarness(() => ["a.pack"]);
    h.background.notifyChange("s");
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    const signal = h.signalOf("a.pack")!;

    h.setGameRunning(true);
    await flush();
    expect(signal.aborted).toBe(true);
    expect(h.background.getStatus().state).toBe("paused");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.planCalls).toEqual(["s"]);

    h.setGameRunning(false);
    await vi.advanceTimersByTimeAsync(16_000);
    await flush();
    expect(h.planCalls).toEqual(["s", "s"]);
  });

  it("does not start while the game is running", async () => {
    const h = makeHarness(() => ["a.pack"]);
    h.setGameRunning(true);
    h.background.notifyChange("s");
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.planCalls).toEqual([]);
    // Nothing was planned, so no work is known to be waiting: no "paused" notice.
    expect(h.background.getStatus().state).toBe("idle");
  });

  it("does not report paused when the game starts with every mod already optimized", async () => {
    const h = makeHarness(() => []);
    h.background.notifyChange("s");
    await vi.advanceTimersByTimeAsync(61_000);
    await h.background.idle();
    expect(h.background.getStatus().state).toBe("idle");

    h.setGameRunning(true);
    expect(h.background.getStatus().state).toBe("idle");
    expect(h.statuses.some((status) => status.state === "paused")).toBe(false);
  });

  it("does not report paused when the game starts during the debounce", async () => {
    const h = makeHarness(() => ["a.pack"]);
    h.background.notifyChange("s");
    await vi.advanceTimersByTimeAsync(10_000);
    h.setGameRunning(true);
    expect(h.background.getStatus().state).toBe("idle");
    h.setGameRunning(false);
    await vi.advanceTimersByTimeAsync(16_000);
    await flush();
    expect(h.planCalls).toEqual(["s"]);
  });

  it("stop() resolves after the running job has ended", async () => {
    const h = makeHarness(() => ["a.pack"]);
    h.background.notifyChange("s");
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    const signal = h.signalOf("a.pack")!;
    await h.background.stop();
    expect(signal.aborted).toBe(true);
    expect(h.background.getStatus().state).toBe("idle");
    expect(h.logs).toContain("a.pack: stopped");
  });

  it("hands a running job to the launch without restarting it, and stops jobs for other mods", async () => {
    const h = makeHarness(() => ["a.pack", "b.pack"]);
    h.background.notifyChange("s");
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();

    h.background.setLaunchActive(true);
    const seen: number[] = [];
    h.progress("a.pack", 0.25);
    const joining = h.background.joinOrPreempt("key-a.pack", (progress) => seen.push(progress.fraction));
    await flush();
    h.progress("a.pack", 0.75);
    h.finish("a.pack");
    await expect(joining).resolves.toBe("joined");
    expect(seen).toEqual([0.25, 0.75]);
    // The pass does not go on to b.pack while a launch is preparing.
    await flush();
    expect(h.produced).toEqual(["a.pack"]);

    const other = makeHarness(() => ["x.pack"]);
    other.background.notifyChange("s");
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    const signal = other.signalOf("x.pack")!;
    await expect(other.background.joinOrPreempt("key-something-else", () => undefined)).resolves.toBe("preempted");
    expect(signal.aborted).toBe(true);
    await expect(other.background.joinOrPreempt("key-x.pack", () => undefined)).resolves.toBe("none");
  });

  it("cancel stops the job and nothing runs until the next change", async () => {
    const h = makeHarness(() => ["a.pack"]);
    h.background.notifyChange("s");
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    const signal = h.signalOf("a.pack")!;
    h.background.cancel();
    await flush();
    expect(signal.aborted).toBe(true);
    expect(h.background.getStatus().state).toBe("idle");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(h.planCalls).toEqual(["s"]);
  });
});

describe("host priority", () => {
  it("lowers the host's priority when asked, and leaves it alone otherwise", async () => {
    const spy = vi.fn();
    const makeChild = (): HostChildProcess => {
      const emitter = new EventEmitter();
      const child = {
        pid: 4242,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        on: (event: string, listener: (...args: never[]) => void) => emitter.on(event, listener),
        kill: () => true,
      };
      setImmediate(() => emitter.emit("exit", 0, null));
      return child as unknown as HostChildProcess;
    };
    try {
      await runHost({ executablePath: "x", args: [], spawnProcess: makeChild, lowPriority: true, setPriority: spy });
      expect(spy).toHaveBeenCalledWith(4242, os.constants.priority.PRIORITY_BELOW_NORMAL);
      spy.mockClear();
      await runHost({ executablePath: "x", args: [], spawnProcess: makeChild, setPriority: spy });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockReset();
    }
  });
});
