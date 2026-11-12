// Forked by getTrimmedMixerStartpos (webpack entry "mixerStartposWorker"). The edit peaks around 3.2 GB, so it
// cannot run in the main process or a renderer.
import * as fs from "fs";
import { removeFactionsFromStartpos } from "../../tools/esf/src/edit/removeFactionsFromStartpos";
import type { MixerStartposWorkerRequest, MixerStartposWorkerResponse } from "./types";

process.once("message", async (request: MixerStartposWorkerRequest) => {
  let response: MixerStartposWorkerResponse;
  try {
    const { buffer, report } = await removeFactionsFromStartpos(fs.readFileSync(request.inputPath), request.keys, {
      keepRegionOwners: true,
    });
    fs.writeFileSync(request.outputPath, buffer);
    response = {
      ok: true,
      removedCount: report.removedKeys.length,
      keptRegionOwners: report.keptRegionOwners,
    };
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  process.send?.(response, () => process.exit(0));
});
