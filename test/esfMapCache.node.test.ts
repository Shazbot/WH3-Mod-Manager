import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearEsfMapMemoryCache, loadEsfMapDiskCache, saveEsfMapDiskCache } from "../src/esfMap/cache";
import type { EsfMapPayload } from "../src/esfMap/types";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  clearEsfMapMemoryCache();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("ESF map disk cache", () => {
  it("round-trips a derived map and rejects a stale signature", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-esf-map-"));
    temporaryDirectories.push(directory);
    const data: EsfMapPayload = {
      campaignKey: "wh3_main_combi",
      availableCampaigns: [{ key: "wh3_main_combi", label: "Main Combi" }],
      settlementTypes: [],
      settlementTypesByRegion: {},
      mapDataPath: "campaign_maps\\wh3_main_combi_map_1\\map_data.esf",
      startposPath: "campaigns\\wh3_main_combi\\startpos.esf",
      lookupPath: "campaign_maps\\wh3_main_combi_map_1\\wh3_main_combi_lookup.tga",
      backgroundImage: { width: 2, height: 2, src: "data:image/png;base64,map" },
      backgroundTextImage: { width: 2, height: 2, src: "data:image/png;base64,text" },
      startposWasCompressed: true,
      gridSource: "lookup",
      displayFlipY: false,
      width: 2,
      height: 2,
      areas: [
        {
          componentId: 0,
          areaId: 0,
          pixelCount: 4,
          loops: [[0, 0, 2, 0, 2, 2, 0, 2]],
          colour: [10, 20, 30],
          regionKey: "wh3_main_combi_region_1",
          ownerFaction: "wh3_main_faction",
        },
      ],
      markers: [
        {
          id: 0,
          regionIndex: 0,
          key: "wh3_main_combi_region_1",
          gx: 1,
          gy: 1,
          areaId: 0,
          componentId: 0,
          ownerFaction: "wh3_main_faction",
          subculture: "wh3_main_sc_dwarfs",
          settlementKey: "settlement_1",
        },
      ],
      componentCount: 1,
      totalLoops: 1,
      totalVertices: 4,
      regionCount: 1,
      ownedRegionCount: 1,
    };

    await saveEsfMapDiskCache(directory, "current", data);
    clearEsfMapMemoryCache();

    await expect(loadEsfMapDiskCache(directory, "current")).resolves.toEqual(data);
    await expect(loadEsfMapDiskCache(directory, "stale")).resolves.toBeUndefined();
  });
});
