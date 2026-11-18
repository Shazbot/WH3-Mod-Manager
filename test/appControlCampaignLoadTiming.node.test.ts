import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCampaignLoadTime, waitForCampaignLoadTime } from "../src/appControl/campaignLoadTiming";

describe("parseCampaignLoadTime", () => {
  it("reads the last measurement", () => {
    const text = "[out] <74.2s>    \tWHMM: campaign load took 12.50 seconds\nWHMM: campaign load took 61.25 seconds\n";
    expect(parseCampaignLoadTime(text)).toBe(61.25);
  });
  it("reports failure lines", () => {
    expect(parseCampaignLoadTime("WHMM: campaign load start time missing")).toBe("missing-start");
    expect(parseCampaignLoadTime("WHMM: loading screen continue button not found")).toBe("continue-not-found");
  });
  it("ignores unrelated text", () => {
    expect(parseCampaignLoadTime("WHMM: pressed loading screen continue button")).toBeUndefined();
  });
});

describe("waitForCampaignLoadTime", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-load-timing-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const base = () => ({
    gamePath: dir,
    sinceMs: Date.now(),
    pollIntervalMs: 20,
    exitGraceMs: 60,
    isGameRunning: () => true,
  });

  it("finds a line written after a delay", async () => {
    const file = path.join(dir, "script_log_181126_1128.txt");
    setTimeout(() => fs.writeFileSync(file, "WHMM: campaign load took 65.40 seconds\n"), 80);
    const result = await waitForCampaignLoadTime({ ...base(), timeoutMs: 3000 });
    expect(result).toEqual({ measured: true, seconds: 65.4, scriptLog: "script_log_181126_1128.txt" });
  });

  it("ignores logs older than the launch", async () => {
    const file = path.join(dir, "script_log_181126_1100.txt");
    fs.writeFileSync(file, "WHMM: campaign load took 10.00 seconds\n");
    const old = new Date(Date.now() - 600_000);
    fs.utimesSync(file, old, old);
    const result = await waitForCampaignLoadTime({ ...base(), timeoutMs: 200 });
    expect(result).toMatchObject({ measured: false });
  });

  it("stops when the game exits", async () => {
    const started = Date.now();
    const result = await waitForCampaignLoadTime({ ...base(), isGameRunning: () => false, timeoutMs: 5000 });
    expect(result).toMatchObject({ measured: false, reason: expect.stringContaining("exited") });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("times out", async () => {
    const result = await waitForCampaignLoadTime({ ...base(), timeoutMs: 150 });
    expect(result).toMatchObject({ measured: false, reason: expect.stringContaining("Timed out") });
  });

  it("returns a failure line", async () => {
    fs.writeFileSync(path.join(dir, "script_log_181126_1129.txt"), "WHMM: campaign load start time missing\n");
    const result = await waitForCampaignLoadTime({ ...base(), timeoutMs: 2000 });
    expect(result).toMatchObject({ measured: false });
  });
});
