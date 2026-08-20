import { describe, expect, it } from "vitest";

import { isUnexpectedSteamWorkerExit } from "../src/steamWorker";

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
