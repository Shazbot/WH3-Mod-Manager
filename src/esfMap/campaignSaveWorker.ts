// Forked by readCampaignSaveMap (webpack entry "campaignSaveWorker"). A save decompresses to ~126 MB and takes a few
// seconds to walk, which would block the main process.
import * as fs from "fs";
import { extractCampaignState, openEsfBuffer, parseEsfDocument } from "../../tools/esf/src";
import type { CampaignSaveWorkerRequest, CampaignSaveWorkerResponse } from "./campaignSaveTypes";

process.once("message", (request: CampaignSaveWorkerRequest) => {
  let response: CampaignSaveWorkerResponse;
  try {
    const buffer = openEsfBuffer(fs.readFileSync(request.filePath)).buffer;
    const state = extractCampaignState(buffer, parseEsfDocument(buffer), {
      resourceBySlotTemplate: request.resourceBySlotTemplate,
    });
    response = {
      ok: true,
      campaignKey: state.campaignKey,
      text: JSON.stringify({ regions: state.regions, faction_to_chars: state.faction_to_chars }),
      warnings: state.warnings,
    };
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  process.send?.(response, () => process.exit(0));
});
