import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { formatSavedBytes, totalOptimizations } from "../src/workshopModOptimizer/summary";
import {
  WORKSHOP_MOD_STAGING_FOLDER,
  WORKSHOP_OPTIMIZED_MODS_FOLDER,
  getWorkshopModStagingFolderInfo,
} from "../src/utility/workshopModStaging";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const MB = 1024 * 1024;

describe("optimization summary", () => {
  it("totals the savings of the optimized mods and formats them", () => {
    const totals = totalOptimizations([
      {
        sourceBytes: 800 * MB,
        outputBytes: 464 * MB,
        textureBytesSaved: 40 * MB,
        drawCallsEliminated: 28.2,
        mergedModelsGenerated: 141,
      },
      undefined,
      {
        sourceBytes: 10 * MB,
        outputBytes: 12 * MB,
        textureBytesSaved: 0,
        drawCallsEliminated: 0,
        mergedModelsGenerated: 0,
      },
    ]);
    expect(totals).toEqual({ mods: 2, savedBytes: 336 * MB, drawCalls: 28.2 });
    expect(formatSavedBytes(336 * MB)).toBe("336 MB");
    expect(formatSavedBytes(1536 * MB)).toBe("1.5 GB");
    expect(totalOptimizations([undefined])).toBeUndefined();
  });
});

describe("staging folder size", () => {
  it("counts a pack hard-linked from the optimizer cache once, in the cache", async () => {
    const game = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-size-"));
    directories.push(game);
    const staging = path.join(game, WORKSHOP_MOD_STAGING_FOLDER);
    const cache = path.join(game, WORKSHOP_OPTIMIZED_MODS_FOLDER);
    fs.mkdirSync(staging);
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, "entry.pack"), Buffer.alloc(1000));
    fs.linkSync(path.join(cache, "entry.pack"), path.join(staging, "linked.pack"));
    fs.writeFileSync(path.join(staging, "plain.pack"), Buffer.alloc(300));

    expect((await getWorkshopModStagingFolderInfo(game)).size).toBe(300);
  });
});
