import type {
  WorkshopStagingOptimizerContext,
  WorkshopStagingOptimizerMod,
  WorkshopStagingOptimizerPlan,
  WorkshopStagingOptimizerResult,
} from "../utility/workshopModStaging";
import type { OptimizerBackgroundJoin } from "./optimizer";

/**
 * Optimizes the enabled mods in the background so a launch finds the results in the cache.
 *
 * - A pass plans the whole mod list exactly as a launch would (the caller's `plan`) and produces the
 *   results that are not cached yet, one host process at a time, at below-normal priority.
 * - A change of the mod list, of an enabled pack or of the game starts the debounce again; a change during
 *   a pass stops it (killing the host) and replans.
 * - While the game runs nothing runs; the pass is redone after it exits. "Paused" is shown only when the
 *   game stopped jobs that were running: with nothing left to do (or not known yet) the status stays idle.
 * - A launch takes over: it waits for the job that makes a mod it needs (without restarting it), stops any
 *   other job and holds the background back until it is done.
 * Results go to the cache only. Nothing here touches the staging folder.
 */

export interface BackgroundJob {
  mod: WorkshopStagingOptimizerMod;
  plan: WorkshopStagingOptimizerPlan;
}

export interface BackgroundPass {
  jobs: BackgroundJob[];
  /** How many mods the pass looked at (those with something to optimize). */
  considered: number;
  produce(
    mod: WorkshopStagingOptimizerMod,
    plan: WorkshopStagingOptimizerPlan,
    context: WorkshopStagingOptimizerContext,
  ): Promise<WorkshopStagingOptimizerResult>;
  /** Called when the pass ends (unless a launch has started): lets go of what planning held on to. */
  release?(): void;
  /** One main.log line for a finished job. */
  describe(job: BackgroundJob, result: WorkshopStagingOptimizerResult | { status: "stopped" }): string;
}

export type BackgroundState = "idle" | "waiting" | "running" | "paused";

export interface BackgroundStatus {
  state: BackgroundState;
  /** Jobs of the pass, and how many are finished. */
  total: number;
  done: number;
  currentMod?: string;
  /** Progress of the current job, 0..1. */
  fraction?: number;
  stage?: string;
  /** True when the last plan for the current mod list found nothing left to optimize; unknown otherwise. */
  upToDate?: boolean;
}

export interface BackgroundDeps<Snapshot> {
  /** Plans the mod list as a launch would. Resolves undefined when optimization does not apply. */
  plan(snapshot: Snapshot, signal: AbortSignal): Promise<BackgroundPass | undefined>;
  isGameRunning(): boolean;
  log(message: string): void;
  onStatus(status: BackgroundStatus): void;
  /** Called between jobs and when a pass ends (never while a launch is preparing): cache housekeeping. */
  afterJob?(): Promise<void>;
  debounceMs?: number;
  /** How long after the game exits the pass is redone. */
  afterGameMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface RunningJob {
  key: string;
  mod: WorkshopStagingOptimizerMod;
  controller: AbortController;
  done: Promise<void>;
  listeners: Set<(progress: { stage: string; fraction: number }) => void>;
  last?: { stage: string; fraction: number };
}

export class BackgroundOptimizer<Snapshot> implements OptimizerBackgroundJoin {
  private snapshot: Snapshot | undefined;
  private timer: unknown;
  private passController: AbortController | undefined;
  private passDone: Promise<void> = Promise.resolve();
  private running: RunningJob | undefined;
  private launchActive = false;
  private gameWasRunning = false;
  private status: BackgroundStatus = { state: "idle", total: 0, done: 0 };
  private disposed = false;
  private upToDate = false;
  /** The last pass planned the mods and found nothing to optimize. */
  private lastPassFoundNothing = false;

  constructor(private readonly deps: BackgroundDeps<Snapshot>) {}

  getStatus(): BackgroundStatus {
    return this.status;
  }

  private setTimer(callback: () => void, ms: number) {
    return (this.deps.setTimer ?? ((cb, delay) => setTimeout(cb, delay)))(callback, ms);
  }

  private clearTimer(handle: unknown) {
    (this.deps.clearTimer ?? ((value) => clearTimeout(value as NodeJS.Timeout)))(handle);
  }

  private publish(status: BackgroundStatus) {
    this.status = { ...status, upToDate: this.upToDate };
    this.deps.onStatus(this.status);
  }

  /**
   * The inputs changed (or were set for the first time). Restarts the debounce; stops a pass in
   * progress. `undefined` means optimization does not apply (setting off, not Warhammer III, ...).
   */
  notifyChange(snapshot: Snapshot | undefined) {
    this.snapshot = snapshot;
    this.upToDate = false;
    this.stopPass();
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    if (snapshot === undefined || this.disposed) {
      this.publish({ state: "idle", total: 0, done: 0 });
      return;
    }

    this.publish({ state: "waiting", total: 0, done: 0 });
    this.timer = this.setTimer(() => this.start(), this.deps.debounceMs ?? 60_000);
  }

  private stopPass() {
    this.passController?.abort();
    this.passController = undefined;
  }

  /** The game started or exited; call with the current state. */
  gameRunningChanged(isRunning: boolean) {
    if (isRunning === this.gameWasRunning) return;
    this.gameWasRunning = isRunning;
    if (isRunning) {
      this.stopPass();
      if (this.timer !== undefined) this.clearTimer(this.timer);
      this.timer = undefined;
      // Only work the game actually interrupted counts as paused.
      const interrupted = this.status.state === "running" || this.status.state === "paused";
      this.publish({ state: interrupted && this.snapshot !== undefined ? "paused" : "idle", total: 0, done: 0 });
    } else if (this.snapshot !== undefined && !this.launchActive) {
      if (this.timer !== undefined) this.clearTimer(this.timer);
      this.timer = this.setTimer(() => this.start(), this.deps.afterGameMs ?? 15_000);
      this.publish({ state: "waiting", total: 0, done: 0 });
    }
  }

  /** A launch is preparing its mods: stop planning new work, the launch decides what runs. */
  setLaunchActive(active: boolean) {
    this.launchActive = active;
    if (active) {
      if (this.timer !== undefined) this.clearTimer(this.timer);
      this.timer = undefined;
      // The job that is running stays so the launch can wait for it; no new ones start. Planning is
      // stopped: the launch plans for itself.
      if (!this.running) {
        this.stopPass();
        this.publish({ state: "idle", total: 0, done: 0 });
      }
    }
  }

  /** The cache lost results (it was cleared): the mods are no longer known to be up to date. */
  markStale() {
    if (!this.upToDate) return;
    this.upToDate = false;
    this.publish(this.status);
  }

  /**
   * Starts a pass now instead of waiting for the debounce. Resolves when that pass ends:
   * "nothingToDo" when every mod was optimized already, "ran" otherwise, "notStarted" when a pass
   * could not or need not start.
   */
  async runNow(): Promise<"nothingToDo" | "ran" | "notStarted"> {
    if (this.disposed || this.snapshot === undefined || this.launchActive || this.deps.isGameRunning()) {
      return "notStarted";
    }
    if (this.passController || this.running) return "notStarted";
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    this.lastPassFoundNothing = false;
    this.start();
    await this.passDone;
    return this.lastPassFoundNothing ? "nothingToDo" : "ran";
  }

  /** The user cancelled: nothing runs until the next change. */
  cancel() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    this.stopPass();
    this.running?.controller.abort();
    this.publish({ state: "idle", total: 0, done: 0 });
  }

  /** Cancels like `cancel` and resolves once the job and the pass have really ended. */
  async stop(): Promise<void> {
    const running = this.running;
    this.cancel();
    await running?.done;
    await this.passDone;
  }

  dispose() {
    this.disposed = true;
    this.cancel();
  }

  /** Resolves when the current pass has ended (for tests and for shutdown). */
  async idle(): Promise<void> {
    await this.passDone;
  }

  private start() {
    this.timer = undefined;
    if (this.disposed || this.snapshot === undefined || this.launchActive) return;
    if (this.deps.isGameRunning()) {
      // Nothing was planned yet, so it is unknown whether anything needs optimizing: the pass is redone
      // after the game exits without claiming work is paused.
      this.gameWasRunning = true;
      if (this.status.state !== "paused") this.publish({ state: "idle", total: 0, done: 0 });
      return;
    }

    const controller = new AbortController();
    this.passController = controller;
    const snapshot = this.snapshot;
    this.passDone = this.runPass(snapshot, controller)
      .catch((error) => {
        this.deps.log(
          `Optimizer (background): the pass failed (${error instanceof Error ? error.message : String(error)}).`,
        );
      })
      .finally(() => {
        if (this.passController === controller) this.passController = undefined;
      });
  }

  private async runPass(snapshot: Snapshot, controller: AbortController) {
    let pass: BackgroundPass | undefined;
    try {
      pass = await this.deps.plan(snapshot, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    }

    if (controller.signal.aborted) {
      if (!this.launchActive) pass?.release?.();
      return;
    }
    if (!pass || pass.jobs.length === 0) {
      this.upToDate = !!pass;
      this.lastPassFoundNothing = !!pass;
      if (!this.launchActive) pass?.release?.();
      if (pass && pass.considered > 0) {
        this.deps.log(`Optimizer (background): all ${pass.considered} mod(s) are optimized already.`);
      }

      this.publish({ state: "idle", total: 0, done: 0 });
      return;
    }

    this.deps.log(
      `Optimizer (background): ${pass.jobs.length} of ${pass.considered} mod(s) to optimize: ` +
        pass.jobs.map((job) => job.mod.name).join(", "),
    );
    let done = 0;
    let allReady = true;
    for (const job of pass.jobs) {
      if (controller.signal.aborted || this.launchActive) break;
      this.publish({ state: "running", total: pass.jobs.length, done, currentMod: job.mod.name, fraction: 0 });
      const result = await this.runJob(pass, job, controller, done);
      if (!this.launchActive) await this.deps.afterJob?.().catch(() => undefined);
      if (result === "stopped") break;
      if (result === "failed") allReady = false;
      done++;
    }
    // Only a pass that made every job's result counts; a failed job is not cached and can be retried.
    if (allReady && done === pass.jobs.length && !controller.signal.aborted) this.upToDate = true;

    if (!this.launchActive) pass.release?.();
    if (!controller.signal.aborted || this.status.state === "running") {
      this.publish({ state: this.gameWasRunning ? "paused" : "idle", total: 0, done: 0 });
    }
  }

  private async runJob(
    pass: BackgroundPass,
    job: BackgroundJob,
    pass_: AbortController,
    done: number,
  ): Promise<"finished" | "failed" | "stopped"> {
    const controller = new AbortController();
    const forward = () => controller.abort();
    pass_.signal.addEventListener("abort", forward, { once: true });
    const running: RunningJob = {
      key: job.plan.key,
      mod: job.mod,
      controller,
      listeners: new Set(),
      done: Promise.resolve(),
    };
    this.running = running;
    let outcome: WorkshopStagingOptimizerResult | { status: "stopped" };
    const work = (async () => {
      try {
        outcome = await pass.produce(job.mod, job.plan, {
          signal: controller.signal,
          compress: async () => ({
            name: job.mod.name,
            status: "noEligibleFiles",
            success: true,
            compressedFileCount: 0,
            warnings: [],
          }),
          onProgress: (progress) => {
            const value = { stage: progress.stage, fraction: progress.fraction ?? running.last?.fraction ?? 0 };
            running.last = value;
            for (const listener of running.listeners) listener(value);
            if (this.running === running) {
              this.publish({
                state: "running",
                total: this.status.total,
                done,
                currentMod: job.mod.name,
                fraction: value.fraction,
                stage: value.stage,
              });
            }
          },
        });
      } catch (error) {
        outcome =
          controller.signal.aborted || (error instanceof Error && error.name === "AbortError")
            ? { status: "stopped" }
            : { status: "failed", message: error instanceof Error ? error.message : String(error), warnings: [] };
      }
    })();
    running.done = work;
    await work;
    pass_.signal.removeEventListener("abort", forward);
    if (this.running === running) this.running = undefined;
    this.deps.log(pass.describe(job, outcome!));
    if (outcome!.status === "stopped" || controller.signal.aborted) return "stopped";
    return outcome!.status === "ready" ? "finished" : "failed";
  }

  async joinOrPreempt(
    key: string,
    onProgress: (progress: { stage: string; fraction: number }) => void,
    signal?: AbortSignal,
  ): Promise<"joined" | "preempted" | "none"> {
    const running = this.running;
    if (!running) return "none";
    if (running.key !== key) {
      running.controller.abort();
      await running.done;
      return "preempted";
    }

    if (running.last) onProgress(running.last);
    running.listeners.add(onProgress);
    const stop = signal
      ? new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      : undefined;
    try {
      await (stop ? Promise.race([running.done, stop]) : running.done);
    } finally {
      running.listeners.delete(onProgress);
    }

    return "joined";
  }
}
