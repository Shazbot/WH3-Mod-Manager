import { describe, expect, it, vi } from "vitest";

import { createLatestWinsQueue } from "../src/utility/latestWinsQueue";

const deferred = () => {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((res) => (resolve = res));
  return { promise, resolve };
};

describe("createLatestWinsQueue", () => {
  it("runs the first request immediately and the second after it", async () => {
    const gates: Record<string, ReturnType<typeof deferred>> = { a: deferred(), b: deferred() };
    const run = vi.fn((key: string) => gates[key].promise);
    const queue = createLatestWinsQueue(run);
    const first = queue.request("a");
    const second = queue.request("b");
    expect(run).toHaveBeenCalledTimes(1);
    gates.a.resolve("A");
    expect(await first).toBe("A");
    expect(run).toHaveBeenCalledWith("b");
    gates.b.resolve("B");
    expect(await second).toBe("B");
  });

  it("replaces a waiting request with a newer one", async () => {
    const gate = deferred();
    const run = vi.fn(async (key: string) => (key === "a" ? gate.promise : key.toUpperCase()));
    const queue = createLatestWinsQueue(run);
    const first = queue.request("a");
    const second = queue.request("b");
    const third = queue.request("c");
    expect(await second).toBeUndefined();
    gate.resolve("A");
    expect(await first).toBe("A");
    expect(await third).toBe("C");
    expect(run).not.toHaveBeenCalledWith("b");
  });

  it("drops the waiting request but not the running one", async () => {
    const gate = deferred();
    const run = vi.fn(async (key: string) => (key === "a" ? gate.promise : key));
    const queue = createLatestWinsQueue(run);
    const first = queue.request("a");
    const second = queue.request("b");
    queue.dropQueued();
    expect(await second).toBeUndefined();
    gate.resolve("A");
    expect(await first).toBe("A");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("resolves undefined when a run throws and keeps going", async () => {
    const run = vi.fn(async (key: string) => {
      if (key === "bad") throw new Error("boom");
      return key;
    });
    const queue = createLatestWinsQueue(run);
    const bad = queue.request("bad");
    const good = queue.request("good");
    expect(await bad).toBeUndefined();
    expect(await good).toBe("good");
  });
});
