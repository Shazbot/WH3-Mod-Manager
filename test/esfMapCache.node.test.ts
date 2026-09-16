import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearEsfMapMemoryCache,
  loadEsfMapDiskCache,
  resolveEsfMapCachedImage,
  saveEsfMapDiskCache,
} from "../src/esfMap/cache";
import type { EsfMapPayload } from "../src/esfMap/types";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

const temporaryDirectories: string[] = [];
const sha256 = (value: string) => createHash("sha256").update(Buffer.from(value)).digest("hex");

const createMapData = (): EsfMapPayload => ({
  campaignKey: "wh3_main_combi",
  availableCampaigns: [{ key: "wh3_main_combi", label: "Main Combi" }],
  settlementTypes: [],
  settlementTypesByRegion: {},
  climates: [],
  climatesByRegion: {},
  mapDataPath: "campaign_maps\\wh3_main_combi_map_1\\map_data.esf",
  startposPath: "campaigns\\wh3_main_combi\\startpos.esf",
  lookupPath: "campaign_maps\\wh3_main_combi_map_1\\wh3_main_combi_lookup.tga",
  backgroundImage: { width: 2, height: 2, src: `data:image/png;base64,${Buffer.from("map").toString("base64")}` },
  backgroundTextImage: {
    width: 2,
    height: 2,
    src: `data:image/png;base64,${Buffer.from("text").toString("base64")}`,
  },
  startposWasCompressed: true,
  gridSource: "lookup",
  displayFlipY: false,
  characterCoordinateGrid: { width: 2, height: 2, displayFlipY: true },
  characterPathfinding: null,
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
  factions: [
    {
      key: "wh3_main_faction",
      label: "Faction",
      flagPath: "ui\\flags\\wh3_main_faction\\mon_64.png",
      regionCount: 1,
    },
  ],
  componentCount: 1,
  totalLoops: 1,
  totalVertices: 4,
  regionCount: 1,
  ownedRegionCount: 1,
});

afterEach(async () => {
  clearEsfMapMemoryCache();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("ESF map disk cache", () => {
  it("content-addresses map images across signatures and rejects missing image content", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-esf-map-"));
    temporaryDirectories.push(directory);
    const mapHash = sha256("map");
    const textHash = sha256("text");

    const data = createMapData();
    await saveEsfMapDiskCache(directory, "current", data);
    expect(data.backgroundImage?.src).toBe(`whmm://map-cache/${mapHash}/background.png`);
    expect(data.backgroundTextImage?.src).toBe(`whmm://map-cache/${textHash}/background-text.png`);
    await expect(resolveEsfMapCachedImage(directory, mapHash, "background")).resolves.toMatchObject({
      mimeType: "image/png",
      buffer: Buffer.from("map"),
    });
    await expect(resolveEsfMapCachedImage(directory, textHash, "background-text")).resolves.toMatchObject({
      mimeType: "image/png",
      buffer: Buffer.from("text"),
    });

    clearEsfMapMemoryCache();
    await expect(loadEsfMapDiskCache(directory, "current")).resolves.toEqual(data);
    await expect(loadEsfMapDiskCache(directory, "stale")).resolves.toBeUndefined();

    const nextData = createMapData();
    await saveEsfMapDiskCache(directory, "next", nextData);
    expect(nextData.backgroundImage?.src).toBe(data.backgroundImage?.src);
    expect(nextData.backgroundTextImage?.src).toBe(data.backgroundTextImage?.src);
    await expect(fs.promises.readdir(path.join(directory, "esf-map-images"))).resolves.toEqual(
      [mapHash + ".png", textHash + ".png"].sort(),
    );

    await fs.promises.rm(path.join(directory, "esf-map-images", mapHash + ".png"));
    clearEsfMapMemoryCache();
    await expect(loadEsfMapDiskCache(directory, "next")).resolves.toBeUndefined();
  });
});
