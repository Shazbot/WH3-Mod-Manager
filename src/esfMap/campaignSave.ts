import { fork } from "child_process";
import * as nodePath from "path";
import type { CampaignSaveWorkerRequest, CampaignSaveWorkerResponse } from "./campaignSaveTypes";

const WORKER_TIMEOUT_MS = 2 * 60 * 1000;
const WORKER_MAX_OLD_SPACE_MB = 4096;

/** Reads a campaign `.save` / startpos `.esf` into extended map JSON text in a forked worker. */
export const readCampaignSaveMap = (filePath: string, resourceBySlotTemplate?: Record<string, string>) =>
  new Promise<Extract<CampaignSaveWorkerResponse, { ok: true }>>((resolve, reject) => {
    const child = fork(nodePath.join(__dirname, "campaignSaveWorker.js"), [], {
      execArgv: [`--max-old-space-size=${WORKER_MAX_OLD_SPACE_MB}`],
    });
    let settled = false;
    const finish = (error?: Error, response?: Extract<CampaignSaveWorkerResponse, { ok: true }>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (response) resolve(response);
      else reject(error ?? new Error("Worker failed"));
    };
    const timer = setTimeout(() => finish(new Error("Timed out reading the save file")), WORKER_TIMEOUT_MS);
    child.once("message", (response: CampaignSaveWorkerResponse) =>
      response.ok ? finish(undefined, response) : finish(new Error(response.error)),
    );
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => finish(new Error(`Worker exited with code ${code}`)));
    const request: CampaignSaveWorkerRequest = { filePath, resourceBySlotTemplate };
    child.send(request);
  });
