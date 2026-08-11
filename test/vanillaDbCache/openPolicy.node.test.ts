import { describe, expect, it, vi } from "vitest";

import { openCacheCandidate } from "../../src/vanillaDbCache/openPolicy";

const resource = () => ({ close: vi.fn() });

describe("cache candidate open policy", () => {
  it("keeps a current reader open", () => {
    const source = resource();
    const reader = resource();

    expect(
      openCacheCandidate({
        openSource: () => source,
        openReader: () => reader,
        isCurrent: () => true,
        isMissingError: () => false,
      }),
    ).toEqual({ kind: "opened", reader });
    expect(reader.close).not.toHaveBeenCalled();
  });

  it("distinguishes a missing file from a transient I/O failure", () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
    const options = (error: Error & { code: string }) => ({
      openSource: () => {
        throw error;
      },
      openReader: () => resource(),
      isCurrent: () => true,
      isMissingError: (candidate: unknown) =>
        (candidate as NodeJS.ErrnoException).code === "ENOENT",
    });

    expect(openCacheCandidate(options(missing))).toEqual({ kind: "missing" });
    expect(openCacheCandidate(options(busy))).toEqual({ kind: "io-error", error: busy });
  });

  it("closes the source when the reader rejects invalid bytes", () => {
    const source = resource();

    expect(
      openCacheCandidate({
        openSource: () => source,
        openReader: () => undefined,
        isCurrent: () => true,
        isMissingError: () => false,
      }),
    ).toEqual({ kind: "invalid" });
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("closes a stale reader", () => {
    const reader = resource();

    expect(
      openCacheCandidate({
        openSource: resource,
        openReader: () => reader,
        isCurrent: () => false,
        isMissingError: () => false,
      }),
    ).toEqual({ kind: "stale" });
    expect(reader.close).toHaveBeenCalledOnce();
  });
});
