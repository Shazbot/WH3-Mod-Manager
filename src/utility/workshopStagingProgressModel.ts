/**
 * The overall progress of a staging run, as one number that never goes backwards.
 *
 * Every staged mod has a weight (its estimated seconds) and its own progress 0..1 that is spread
 * over the phases it goes through. A phase reports 0..1 of itself and lands inside its band of the
 * mod, so a later phase starting from zero cannot pull the bar back. The overall value is
 * (finished weight + weight of the mod in progress * its progress) / total weight.
 */

export type StagingModKind =
  /** The optimizer runs: optimize the pack, compress it, copy it. */
  | "optimize"
  /** An optimized pack is restored from the cache: a copy. */
  | "restore"
  /** Copy, then compress the copy. */
  | "copy-compress"
  | "copy";

export type StagingPhaseKey = "optimizing" | "compressing" | "copying";

type Band = readonly [number, number];

/**
 * Shares of one mod's time. Measured: the host takes about 80 % of an optimized mod (112 to 140 s of
 * 140 to 175 s), compressing the result most of the rest; a plain copy of a large pack is about
 * 15 % copy and 85 % compress.
 */
const BANDS: Record<StagingModKind, Partial<Record<StagingPhaseKey, Band>>> = {
  optimize: { optimizing: [0, 0.78], compressing: [0.78, 0.97], copying: [0.97, 1] },
  restore: { copying: [0, 1] },
  "copy-compress": { copying: [0, 0.15], compressing: [0.15, 1] },
  copy: { copying: [0, 1] },
};

/** Estimated seconds per megabyte of the source pack, measured on a 824 MB mod. */
const SECONDS_PER_MEGABYTE: Record<StagingModKind, number> = {
  optimize: 0.2,
  restore: 0.005,
  "copy-compress": 0.07,
  copy: 0.01,
};

const MINIMUM_WEIGHT_SECONDS = 0.5;

export const estimateStagingWeight = (kind: StagingModKind, sourceBytes: number): number =>
  Math.max(MINIMUM_WEIGHT_SECONDS, (sourceBytes / (1024 * 1024)) * SECONDS_PER_MEGABYTE[kind]);

export interface StagingProgressEntry {
  name: string;
  kind: StagingModKind;
  weight: number;
}

interface ModState {
  kind: StagingModKind;
  weight: number;
  /** Progress 0..1 inside the mod; only grows. */
  progress: number;
  /** Where the current kind's bands start, after a change of kind. */
  floor: number;
  done: boolean;
}

const key = (name: string) => name.toLowerCase();

export class StagingProgressModel {
  private readonly mods = new Map<string, ModState>();
  private readonly totalWeight: number;
  private highest = 0;

  constructor(entries: readonly StagingProgressEntry[]) {
    for (const entry of entries) {
      this.mods.set(key(entry.name), {
        kind: entry.kind,
        weight: Math.max(0, entry.weight),
        progress: 0,
        floor: 0,
        done: false,
      });
    }
    this.totalWeight = [...this.mods.values()].reduce((total, mod) => total + mod.weight, 0);
  }

  /** Mods that have work, and how many of them are finished. */
  get workCount(): number {
    return [...this.mods.values()].filter((mod) => mod.weight > 0).length;
  }

  get doneCount(): number {
    return [...this.mods.values()].filter((mod) => mod.weight > 0 && mod.done).length;
  }

  /** The mod turned out to need other work (optimizing failed or was skipped): carry on from here. */
  changeKind(name: string, kind: StagingModKind): void {
    const mod = this.mods.get(key(name));
    if (!mod || mod.kind === kind) return;
    mod.kind = kind;
    mod.floor = mod.progress;
  }

  /** `within` is how far (0..1) the phase has got; returns the overall progress (0..1). */
  update(name: string, phase: StagingPhaseKey, within: number): number {
    const mod = this.mods.get(key(name));
    if (mod && !mod.done) {
      const band = BANDS[mod.kind][phase];
      if (band) {
        const clamped = Math.min(1, Math.max(0, Number.isFinite(within) ? within : 0));
        const inMod = band[0] + (band[1] - band[0]) * clamped;
        mod.progress = Math.max(mod.progress, mod.floor + (1 - mod.floor) * inMod);
      }
    }
    return this.overall();
  }

  complete(name: string): number {
    const mod = this.mods.get(key(name));
    if (mod) {
      mod.done = true;
      mod.progress = 1;
    }
    return this.overall();
  }

  overall(): number {
    if (this.totalWeight <= 0) return this.highest;
    let sum = 0;
    for (const mod of this.mods.values()) sum += mod.weight * (mod.done ? 1 : mod.progress);
    this.highest = Math.max(this.highest, Math.min(1, sum / this.totalWeight));
    return this.highest;
  }
}
