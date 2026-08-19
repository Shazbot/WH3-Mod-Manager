import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appData from "../src/appData";
import {
  clearStartposRegionSlotTemplatesCache,
  loadStartposRegionSlotTemplates,
} from "../src/esfMap/loader";

const mocked = vi.hoisted(() => ({
  readFromExistingPack: vi.fn(),
  readPack: vi.fn(),
  extractCampaignTableIdentity: vi.fn(),
  extractStartposRegionSlotTemplates: vi.fn(),
  openEsfBuffer: vi.fn(),
  parseEsfDocument: vi.fn(),
}));

vi.mock("../src/packFileSerializer", () => ({
  readFromExistingPack: mocked.readFromExistingPack,
  readPack: mocked.readPack,
}));

vi.mock("../tools/esf/src", () => ({
  extractCampaignTableIdentity: mocked.extractCampaignTableIdentity,
  extractStartposRegionSlotTemplates: mocked.extractStartposRegionSlotTemplates,
  openEsfBuffer: mocked.openEsfBuffer,
  parseEsfDocument: mocked.parseEsfDocument,
}));

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  clearStartposRegionSlotTemplatesCache();
  appData.packsData = [];
  appData.gamesToGameFolderPaths.wh3.dataFolder = undefined;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("startpos-derived Buildings inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.readFromExistingPack.mockImplementation(async (pack: any, options: any) => ({
      ...pack,
      packedFiles: pack.packedFiles.map((file: any) =>
        options.filesToRead?.includes(file.name) ? { ...file, buffer: Buffer.from(file.name) } : file,
      ),
    }));
    mocked.readPack.mockRejectedValue(new Error("unexpected uncached pack read"));
    mocked.extractCampaignTableIdentity.mockImplementation((buffer: Buffer) => ({
      campaignName: buffer.toString(),
    }));
    mocked.parseEsfDocument.mockReturnValue({});
    mocked.openEsfBuffer.mockImplementation((buffer: Buffer) => ({ buffer }));
    mocked.extractStartposRegionSlotTemplates.mockImplementation((_buffer: Buffer, _document: unknown, campaign: string) => [
      { campaign, region: "region", slotTemplate: "template", slotType: "slot" },
    ]);
    appData.currentGame = "wh3";
  });

  it("reads all startpos candidates from one pack in one pass and reuses the result", async () => {
    const dataFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-startpos-cache-"));
    temporaryDirectories.push(dataFolder);
    appData.gamesToGameFolderPaths.wh3.dataFolder = dataFolder;

    const modPath = path.join(dataFolder, "mod.pack");
    await fs.promises.writeFile(modPath, "pack");
    const startposFiles = [
      "campaigns\\wh3_main_chaos\\startpos.esf",
      "campaigns\\wh3_main_combi\\startpos.esf",
    ];
    appData.packsData = [
      {
        name: "mod.pack",
        path: modPath,
        packedFiles: startposFiles.map((name) => ({ name, file_size: 1, start_pos: 0 })),
        packHeader: {} as any,
        lastChangedLocal: 0,
        size: 4,
        readTables: [],
      } as any,
    ];
    const mod = { name: "Test mod", path: modPath, loadOrder: 0 } as Mod;

    const first = await loadStartposRegionSlotTemplates([mod]);
    const second = await loadStartposRegionSlotTemplates([mod]);

    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    expect(mocked.readFromExistingPack).toHaveBeenCalledTimes(1);
    expect(mocked.readFromExistingPack.mock.calls[0][1].filesToRead).toEqual(startposFiles);
    expect(mocked.readPack).not.toHaveBeenCalled();
  });

  it("invalidates the derived result when an enabled mod pack changes", async () => {
    const dataFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-startpos-cache-"));
    temporaryDirectories.push(dataFolder);
    appData.gamesToGameFolderPaths.wh3.dataFolder = dataFolder;

    const modPath = path.join(dataFolder, "mod.pack");
    await fs.promises.writeFile(modPath, "pack");
    appData.packsData = [
      {
        name: "mod.pack",
        path: modPath,
        packedFiles: [{ name: "campaigns\\wh3_main_combi\\startpos.esf", file_size: 1, start_pos: 0 }],
        packHeader: {} as any,
        lastChangedLocal: 0,
        size: 4,
        readTables: [],
      } as any,
    ];
    const mod = { name: "Test mod", path: modPath, loadOrder: 0 } as Mod;

    await loadStartposRegionSlotTemplates([mod]);
    await fs.promises.appendFile(modPath, "changed");
    await loadStartposRegionSlotTemplates([mod]);

    expect(mocked.readFromExistingPack).toHaveBeenCalledTimes(2);
  });
});
