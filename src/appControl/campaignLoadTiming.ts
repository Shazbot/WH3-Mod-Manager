import * as fs from "node:fs";
import { listGameLogs } from "../utility/logPaths";
import type { AppControlCampaignLoad } from "./protocol";

export type CampaignLoadParse = number | "missing-start" | "continue-not-found" | undefined;

const TOOK_PATTERN = /WHMM: campaign load took ([\d.]+) seconds/g;

/** Reads the campaign load result out of a script log; the last measurement wins. */
export const parseCampaignLoadTime = (text: string): CampaignLoadParse => {
  let seconds: number | undefined;
  for (const match of text.matchAll(TOOK_PATTERN)) seconds = Number(match[1]);
  if (seconds !== undefined && Number.isFinite(seconds)) return seconds;
  if (text.includes("WHMM: campaign load start time missing")) return "missing-start";
  if (text.includes("WHMM: loading screen continue button not found")) return "continue-not-found";
  return undefined;
};

const failureReason = (parsed: "missing-start" | "continue-not-found") =>
  parsed === "missing-start"
    ? "The campaign script could not find the saved start time."
    : "The loading screen Continue button was not found.";

export interface WaitForCampaignLoadOptions {
  gamePath: string;
  /** Only script logs modified at or after this time are read. */
  sinceMs: number;
  timeoutMs: number;
  isGameRunning: () => boolean;
  pollIntervalMs?: number;
  /** How long the game may look stopped before giving up; the running flag is polled slowly. */
  exitGraceMs?: number;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const waitForCampaignLoadTime = async ({
  gamePath,
  sinceMs,
  timeoutMs,
  isGameRunning,
  pollIntervalMs = 1000,
  exitGraceMs = 5000,
}: WaitForCampaignLoadOptions): Promise<AppControlCampaignLoad> => {
  const deadline = Date.now() + timeoutMs;
  let stoppedSince: number | undefined;
  for (;;) {
    let parsed: CampaignLoadParse;
    let scriptLog = "";
    try {
      const logs = (await listGameLogs(gamePath)).filter((log) => log.isScriptLog && log.mtimeMs >= sinceMs);
      logs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const log of logs) {
        parsed = parseCampaignLoadTime(await fs.promises.readFile(log.path, "utf8"));
        if (parsed !== undefined) {
          scriptLog = log.name;
          break;
        }
      }
    } catch {
      // The game may be writing or rotating logs; try again on the next poll.
    }
    if (typeof parsed === "number") return { measured: true, seconds: parsed, scriptLog };
    if (parsed !== undefined) return { measured: false, reason: failureReason(parsed) };

    if (isGameRunning()) stoppedSince = undefined;
    else {
      stoppedSince ??= Date.now();
      if (Date.now() - stoppedSince >= exitGraceMs)
        return { measured: false, reason: "The game exited before the campaign load time was logged." };
    }
    if (Date.now() >= deadline)
      return { measured: false, reason: "Timed out waiting for the campaign load time in the script log." };
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
};
