import { describe, expect, it, vi } from "vitest";

import { runGuarded } from "../src/utility/runGuarded";

describe("runGuarded", () => {
  it("returns the work's result and runs onFinally", async () => {
    const onFinally = vi.fn();
    await expect(runGuarded(async () => 42, { onFinally })).resolves.toBe(42);
    expect(onFinally).toHaveBeenCalledOnce();
  });

  it("passes a rejection to onError and resolves to undefined", async () => {
    const error = new Error("boom");
    const onError = vi.fn();
    const onFinally = vi.fn();
    await expect(
      runGuarded(
        async () => {
          throw error;
        },
        { onError, onFinally },
      ),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(error);
    expect(onFinally).toHaveBeenCalledOnce();
  });

  it("rethrows without onError, after running onFinally", async () => {
    const onFinally = vi.fn();
    await expect(
      runGuarded(
        async () => {
          throw new Error("boom");
        },
        { onFinally },
      ),
    ).rejects.toThrow("boom");
    expect(onFinally).toHaveBeenCalledOnce();
  });
});
