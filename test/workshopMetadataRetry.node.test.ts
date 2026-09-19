import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModData, getWorkshopMetadataRetryDelay, WORKSHOP_METADATA_RETRY_DELAYS_MS } from "../src/modFunctions";

const steamWorkerMocks = vi.hoisted(() => ({
  forkSteamWorker: vi.fn(),
}));

vi.mock("../src/steamWorker", () => steamWorkerMocks);

class FakeChild extends EventEmitter {
  kill() {
    return true;
  }
}

afterEach(() => {
  vi.useRealTimers();
  steamWorkerMocks.forkSteamWorker.mockReset();
});

describe("Workshop metadata worker retries", () => {
  it("uses the bounded batch retry schedule", () => {
    expect(WORKSHOP_METADATA_RETRY_DELAYS_MS).toEqual([5_000, 30_000]);
    expect(getWorkshopMetadataRetryDelay(0)).toBe(5_000);
    expect(getWorkshopMetadataRetryDelay(1)).toBe(30_000);
    expect(getWorkshopMetadataRetryDelay(2)).toBeUndefined();
  });

  it("retries the batch instead of forking one worker per ID", async () => {
    vi.useFakeTimers();
    const children: FakeChild[] = [];
    steamWorkerMocks.forkSteamWorker.mockImplementation(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
    const logs: string[] = [];

    fetchModData(["100", "200", ""], vi.fn(), (message) => logs.push(message));

    expect(children).toHaveLength(1);
    expect(children[0]).toBeDefined();
    children[0].emit("error", new Error("Steam unavailable"));
    children[0].emit("exit", 1, null);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("retrying in 5s");
    expect(logs[0]).not.toContain("one item at a time");

    await vi.advanceTimersByTimeAsync(4_999);
    expect(children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(children).toHaveLength(2);
    expect(steamWorkerMocks.forkSteamWorker.mock.calls[1]?.[1]?.[2]).toBe("100,200");

    children[1].emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(children).toHaveLength(3);
    expect(steamWorkerMocks.forkSteamWorker.mock.calls[2]?.[1]?.[2]).toBe("100,200");

    children[2].emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(children).toHaveLength(3);
    expect(logs.at(-1)).toContain("after 3 attempt(s)");
  });
});
