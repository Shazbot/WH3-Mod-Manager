// Forked by writeCampaignSave (webpack entry "campaignSaveWriteWorker"). Decompressing, editing and recompressing a
// ~126 MB save takes tens of seconds and several GB, which would block the main process.
import * as fs from "fs";
import { applyCampaignEdits } from "../../tools/esf/src";
import type { CampaignSaveWriteWorkerRequest, CampaignSaveWriteWorkerResponse } from "./campaignSaveTypes";

process.once("message", async (request: CampaignSaveWriteWorkerRequest) => {
  let response: CampaignSaveWriteWorkerResponse;
  try {
    const result = await applyCampaignEdits(fs.readFileSync(request.sourcePath), request.edits);
    fs.writeFileSync(request.outputPath, result.buffer);
    response = { ok: true, applied: result.applied, skipped: result.skipped };
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  process.send?.(response, () => process.exit(0));
});
