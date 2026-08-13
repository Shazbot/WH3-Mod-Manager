import { describe, expect, it } from "vitest";

import { createSerializedBuilds } from "../src/utility/serializedBuilds";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("createSerializedBuilds", () => {
  it("shares a build in flight with the same key", async () => {
    const builds = createSerializedBuilds();
    const gate = deferred<string>();
    let started = 0;

    const first = builds.run("same", () => {
      started++;
      return gate.promise;
    });
    const second = builds.run("same", () => {
      started++;
      return gate.promise;
    });

    gate.resolve("built once");
    await expect(first).resolves.toBe("built once");
    await expect(second).resolves.toBe("built once");
    expect(started).toBe(1);
  });

  it("never runs a differently keyed build beside one in flight", async () => {
    const builds = createSerializedBuilds();
    const firstGate = deferred<string>();
    let running = 0;
    let mostRunningAtOnce = 0;

    const track = async <T>(work: Promise<T>) => {
      running++;
      mostRunningAtOnce = Math.max(mostRunningAtOnce, running);
      try {
        return await work;
      } finally {
        running--;
      }
    };

    const first = builds.run("first", () => track(firstGate.promise));
    const second = builds.run("second", () => track(Promise.resolve("second result")));

    // The second build must not have started while the first one is still in flight.
    await Promise.resolve();
    expect(running).toBe(1);

    firstGate.resolve("first result");
    await expect(first).resolves.toBe("first result");
    await expect(second).resolves.toBe("second result");
    expect(mostRunningAtOnce).toBe(1);
  });

  it("lets the queue through when a build fails, and hands the failure to its own caller", async () => {
    const builds = createSerializedBuilds();
    const failing = builds.run("failing", () => Promise.reject(new Error("build failed")));
    const following = builds.run("following", () => Promise.resolve("built anyway"));

    await expect(failing).rejects.toThrow("build failed");
    await expect(following).resolves.toBe("built anyway");
  });

  it("runs again once nothing is in flight", async () => {
    const builds = createSerializedBuilds();
    let started = 0;
    const build = () => {
      started++;
      return Promise.resolve(started);
    };

    await expect(builds.run("same", build)).resolves.toBe(1);
    await expect(builds.run("same", build)).resolves.toBe(2);
  });
});
