import { describe, expect, it } from "vitest";
import { AnimationClipCache, type AnimationClipChunkResult } from "../src/visuals/animationClipCache";

const makeFetch = (calls: string[][], fail: Set<string> = new Set()) => {
  const gates: Array<() => void> = [];
  const fetchChunk = async (keys: readonly string[]): Promise<AnimationClipChunkResult<string>> => {
    calls.push([...keys]);
    await new Promise<void>((resolve) => gates.push(resolve));
    return { clips: new Map(keys.filter((key) => !fail.has(key)).map((key) => [key, `clip:${key}`])) };
  };
  const release = async () => {
    // Let the pump reach its next await before opening the gate.
    await new Promise((resolve) => setTimeout(resolve, 0));
    gates.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { fetchChunk, release };
};

describe("AnimationClipCache", () => {
  it("serves seeded and cached clips without fetching", async () => {
    const calls: string[][] = [];
    const cache = new AnimationClipCache<string>({ fetchChunk: makeFetch(calls).fetchChunk });
    cache.seed("a", "clip:a");
    await expect(cache.request("a")).resolves.toBe("clip:a");
    expect(calls).toHaveLength(0);
    expect(cache.fetchCount).toBe(0);
  });

  it("prefetches in chunks and skips cached keys", async () => {
    const calls: string[][] = [];
    const { fetchChunk, release } = makeFetch(calls);
    const cache = new AnimationClipCache<string>({ fetchChunk, chunkSize: 2 });
    cache.seed("b", "clip:b");
    cache.prefetch(["a", "b", "c", "d", "e"]);
    await release();
    await release();
    await release();
    expect(calls).toEqual([
      ["a", "c"],
      ["d", "e"],
    ]);
    expect(cache.size).toBe(5);
    await expect(cache.request("e")).resolves.toBe("clip:e");
    expect(calls).toHaveLength(2);
  });

  it("fetches a requested key ahead of the queued prefetch", async () => {
    const calls: string[][] = [];
    const { fetchChunk, release } = makeFetch(calls);
    const cache = new AnimationClipCache<string>({ fetchChunk, chunkSize: 2 });
    cache.prefetch(["a", "b", "c", "d", "e", "f"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const wanted = cache.request("e");
    await release();
    await release();
    await expect(wanted).resolves.toBe("clip:e");
    expect(calls[0]).toEqual(["a", "b"]);
    expect(calls[1]).toEqual(["e"]);
    expect(calls[2]).toEqual(["c", "d"]);
  });

  it("joins a request for a key that is already in flight", async () => {
    const calls: string[][] = [];
    const { fetchChunk, release } = makeFetch(calls);
    const cache = new AnimationClipCache<string>({ fetchChunk, chunkSize: 3 });
    cache.prefetch(["a", "b", "c"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const wanted = cache.request("b");
    await release();
    await expect(wanted).resolves.toBe("clip:b");
    expect(calls).toEqual([["a", "b", "c"]]);
  });

  it("remembers clips the host skipped and reports them once", async () => {
    const calls: string[][] = [];
    const failures: string[] = [];
    const { fetchChunk, release } = makeFetch(calls, new Set(["bad"]));
    const cache = new AnimationClipCache<string>({ fetchChunk, onFailure: (key) => failures.push(key) });
    const first = cache.request("bad");
    await release();
    await expect(first).resolves.toBeUndefined();
    await expect(cache.request("bad")).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(failures).toEqual(["bad"]);
  });

  it("retries after a transport error", async () => {
    let attempts = 0;
    const cache = new AnimationClipCache<string>({
      fetchChunk: async (keys) => {
        attempts += 1;
        if (attempts === 1) throw new Error("pipe closed");
        return { clips: new Map(keys.map((key) => [key, key])) };
      },
    });
    await expect(cache.request("a")).resolves.toBeUndefined();
    await expect(cache.request("a")).resolves.toBe("a");
  });

  it("evicts the least recently used clip past the cap", () => {
    const released: string[] = [];
    const cache = new AnimationClipCache<string>({
      fetchChunk: async () => ({ clips: new Map() }),
      maxClips: 2,
      onRelease: (key) => released.push(key),
    });
    cache.seed("a", "a");
    cache.seed("b", "b");
    cache.peek("a");
    cache.seed("c", "c");
    expect(released).toEqual(["b"]);
    expect(cache.peek("a")).toBe("a");
  });

  it("drops queued work and ignores in-flight results after dispose", async () => {
    const calls: string[][] = [];
    const released: string[] = [];
    const { fetchChunk, release } = makeFetch(calls);
    const cache = new AnimationClipCache<string>({ fetchChunk, chunkSize: 1, onRelease: (key) => released.push(key) });
    cache.prefetch(["a", "b", "c"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = cache.request("z");
    cache.dispose();
    await release();
    await expect(pending).resolves.toBeUndefined();
    expect(calls).toEqual([["a"]]);
    expect(released).toEqual(["a"]);
    expect(cache.size).toBe(0);
    await expect(cache.request("a")).resolves.toBeUndefined();
  });
});
