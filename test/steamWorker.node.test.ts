import { describe, expect, it, vi } from "vitest";

import { createSteamWorkerFailureReporter, isUnexpectedSteamWorkerExit } from "../src/steamWorker";

describe("isUnexpectedSteamWorkerExit", () => {
  it("treats a clean exit as expected", () => {
    expect(isUnexpectedSteamWorkerExit(0, null, false)).toBe(false);
  });

  it("reports nonzero exit codes", () => {
    expect(isUnexpectedSteamWorkerExit(1, null, false)).toBe(true);
  });

  it("reports signal exits even though their exit code is null", () => {
    expect(isUnexpectedSteamWorkerExit(null, "SIGSEGV", false)).toBe(true);
    expect(isUnexpectedSteamWorkerExit(null, "SIGABRT", false)).toBe(true);
  });

  it("does not report an explicitly terminated worker", () => {
    expect(isUnexpectedSteamWorkerExit(null, "SIGTERM", true)).toBe(false);
  });
});

describe("createSteamWorkerFailureReporter", () => {
  it("keeps the first failure and summarizes duplicate reports", () => {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const reporter = createSteamWorkerFailureReporter(logger, 60_000);

    reporter.report("worker-exit", "Steam worker exited unexpectedly", { code: 1 });
    reporter.report("worker-exit", "Steam worker exited unexpectedly", { code: 1 });
    reporter.report("worker-exit", "Steam worker exited unexpectedly", { code: 1 });

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();

    reporter.flush("worker-exit");

    expect(logger.warn).toHaveBeenCalledWith(
      "Steam worker exited unexpectedly Repeated failure; suppressed 2 duplicate report(s).",
      { key: "worker-exit", details: { code: 1 } },
    );
    reporter.dispose();
  });

  it("keeps different failure keys independent", () => {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const reporter = createSteamWorkerFailureReporter(logger, 60_000);

    reporter.report("worker-exit:1", "first");
    reporter.report("worker-exit:2", "second");

    expect(logger.error).toHaveBeenCalledTimes(2);
    reporter.dispose();
  });
});
