/** Clips returned for one fetched chunk, keyed like the requested keys. Missing keys are treated as failed. */
export interface AnimationClipChunkResult<T> {
  clips: ReadonlyMap<string, T>;
  /** Optional per-key failure reasons for keys that produced no clip. */
  failures?: ReadonlyMap<string, string>;
}

export interface AnimationClipCacheOptions<T> {
  /** Loads the given keys in one request. Must not throw for single failed clips. */
  fetchChunk: (keys: readonly string[]) => Promise<AnimationClipChunkResult<T>>;
  /** Keys per background request. Priority requests are always fetched on their own. */
  chunkSize?: number;
  /** Upper bound on cached clips; the least recently used clip is evicted past it. */
  maxClips?: number;
  /** Called when a clip leaves the cache (evicted or disposed). */
  onRelease?: (key: string, clip: T) => void;
  onFailure?: (key: string, reason: string) => void;
}

export const DEFAULT_CLIP_CHUNK_SIZE = 20;
export const DEFAULT_MAX_CACHED_CLIPS = 200;

/**
 * Per-model clip store with a background prefetch queue. A requested key jumps the queue, a cached key
 * is returned without any fetch, and disposing the cache drops queued work and ignores in-flight results.
 */
export class AnimationClipCache<T> {
  private readonly clips = new Map<string, T>();
  private readonly failed = new Set<string>();
  private readonly queue: string[] = [];
  private readonly priority: string[] = [];
  private readonly waiters = new Map<string, Array<(clip: T | undefined) => void>>();
  private readonly inFlight = new Set<string>();
  private readonly chunkSize: number;
  private readonly maxClips: number;
  private pumping = false;
  private disposed = false;
  fetchCount = 0;

  constructor(private readonly options: AnimationClipCacheOptions<T>) {
    this.chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CLIP_CHUNK_SIZE);
    this.maxClips = Math.max(1, options.maxClips ?? DEFAULT_MAX_CACHED_CLIPS);
  }

  get size() {
    return this.clips.size;
  }

  get isDisposed() {
    return this.disposed;
  }

  /** Number of keys still waiting for a background fetch. */
  get pendingCount() {
    return this.queue.length;
  }

  /** Adds a clip that arrived with the model so it never needs a fetch. */
  seed(key: string, clip: T) {
    if (this.disposed) return;
    this.store(key, clip);
  }

  /** Returns a cached clip (and marks it recently used) without any fetch. */
  peek(key: string): T | undefined {
    const clip = this.clips.get(key);
    if (clip !== undefined) {
      this.clips.delete(key);
      this.clips.set(key, clip);
    }
    return clip;
  }

  /** Queues keys for background loading, skipping cached and known-failed ones. Stops at the cache cap. */
  prefetch(keys: readonly string[]) {
    if (this.disposed) return;
    const queued = new Set(this.queue);
    for (const key of keys) {
      if (this.clips.has(key) || this.failed.has(key) || this.inFlight.has(key) || queued.has(key)) continue;
      queued.add(key);
      this.queue.push(key);
    }
    void this.pump();
  }

  /** Resolves with the clip, fetching it ahead of the background queue when it is not cached. */
  request(key: string): Promise<T | undefined> {
    const cached = this.peek(key);
    if (cached !== undefined) return Promise.resolve(cached);
    if (this.disposed || this.failed.has(key)) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const waiting = this.waiters.get(key);
      if (waiting) waiting.push(resolve);
      else this.waiters.set(key, [resolve]);
      if (!this.inFlight.has(key)) {
        const queued = this.queue.indexOf(key);
        if (queued >= 0) this.queue.splice(queued, 1);
        if (!this.priority.includes(key)) this.priority.push(key);
      }
      void this.pump();
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    this.priority.length = 0;
    for (const [key, clip] of this.clips) this.options.onRelease?.(key, clip);
    this.clips.clear();
    for (const resolvers of this.waiters.values()) for (const resolve of resolvers) resolve(undefined);
    this.waiters.clear();
  }

  private store(key: string, clip: T) {
    this.clips.delete(key);
    this.clips.set(key, clip);
    while (this.clips.size > this.maxClips) {
      const oldest = this.clips.keys().next().value as string;
      const released = this.clips.get(oldest) as T;
      this.clips.delete(oldest);
      this.options.onRelease?.(oldest, released);
    }
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.disposed) {
        let keys: string[];
        if (this.priority.length > 0) {
          // A user selection is fetched alone so it is not delayed by a large chunk.
          keys = [this.priority.shift() as string];
        } else if (this.queue.length > 0 && this.clips.size + this.chunkSize <= this.maxClips) {
          keys = this.queue.splice(0, this.chunkSize);
        } else {
          // Background work never evicts: leave the rest unfetched once the cap is near.
          this.queue.length = 0;
          break;
        }
        keys = keys.filter((key) => !this.clips.has(key));
        if (keys.length === 0) continue;
        for (const key of keys) this.inFlight.add(key);
        let result: AnimationClipChunkResult<T>;
        let transientFailure = false;
        try {
          this.fetchCount += 1;
          result = await this.options.fetchChunk(keys);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Failed to load the animation.";
          transientFailure = true;
          result = { clips: new Map(), failures: new Map(keys.map((key) => [key, reason])) };
        }
        for (const key of keys) this.inFlight.delete(key);
        for (const key of keys) {
          const clip = result.clips.get(key);
          if (this.disposed) {
            if (clip !== undefined) this.options.onRelease?.(key, clip);
            continue;
          }
          if (clip !== undefined) this.store(key, clip);
          else {
            // A transport error may succeed on retry; a clip the host skipped will not.
            if (!transientFailure) this.failed.add(key);
            this.options.onFailure?.(key, result.failures?.get(key) ?? "The host produced no clip.");
          }
          const resolvers = this.waiters.get(key);
          this.waiters.delete(key);
          for (const resolve of resolvers ?? []) resolve(clip);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}
