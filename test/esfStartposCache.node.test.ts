import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appData from "../src/appData";
import { clearStartposRegionSlotTemplatesCache, loadStartposRegionSlotTemplates } from "../src/esfMap/loader";
import {
  STARTPOS_REGION_SLOT_TEMPLATE_CACHE_FILE,
  STARTPOS_REGION_SLOT_TEMPLATE_CACHE_VERSION,
} from "../src/esfMap/startposTemplateCache";

const mocked = vi.hoisted(() => ({
  readPackedFileBuffersFromIndex: vi.fn(),
  readPack: vi.fn(),
  extractCampaignTableIdentity: vi.fn(),
  extractStartposRegionSlotTemplates: vi.fn(),
  openEsfBuffer: vi.fn(),
  parseEsfDocument: vi.fn(),
}));

vi.mock("../src/packFileSerializer", () => ({
  readPackedFileBuffersFromIndex: mocked.readPackedFileBuffersFromIndex,
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

const createFixture = async (campaigns: string[] = ["wh3_main_combi"], createCampaignsFolder = true) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-startpos-cache-"));
  temporaryDirectories.push(root);
  const dataFolder = path.join(root, "data");
  if (createCampaignsFolder) {
    await fs.promises.mkdir(path.join(dataFolder, "campaigns"), { recursive: true });
    for (const campaign of campaigns) {
      const campaignFolder = path.join(dataFolder, "campaigns", campaign);
      await fs.promises.mkdir(campaignFolder, { recursive: true });
      await fs.promises.writeFile(path.join(campaignFolder, "startpos.esf"), campaign);
    }
  } else {
    await fs.promises.mkdir(dataFolder, { recursive: true });
  }
  const userDataPath = path.join(root, "user-data");
  await fs.promises.mkdir(userDataPath, { recursive: true });
  appData.gamesToGameFolderPaths.wh3.dataFolder = dataFolder;
  return { root, dataFolder, userDataPath };
};

const createModPack = async (dataFolder: string, name: string, files: string[]) => {
  const packPath = path.join(dataFolder, name);
  await fs.promises.writeFile(packPath, "pack contents");
  const pack = {
    name,
    path: packPath,
    packedFiles: files.map((fileName) => ({ name: fileName, file_size: 1, start_pos: 0 })),
    packHeader: {} as any,
    lastChangedLocal: 0,
    size: 13,
    readTables: [],
  } as any;
  return { pack, mod: { name, path: packPath, loadOrder: 0 } as Mod };
};

const cachePath = (userDataPath: string) => path.join(userDataPath, STARTPOS_REGION_SLOT_TEMPLATE_CACHE_FILE);

afterEach(async () => {
  clearStartposRegionSlotTemplatesCache();
  appData.currentGame = "wh3";
  appData.packsData = [];
  appData.gamesToGameFolderPaths.wh3.dataFolder = undefined;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("startpos-derived Buildings inputs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.readPack.mockRejectedValue(new Error("unexpected uncached pack read"));
    mocked.readPackedFileBuffersFromIndex.mockImplementation(
      async (_pack: any, fileNames: string[]) =>
        new Map(fileNames.map((fileName) => [fileName, Buffer.from(fileName)])),
    );
    mocked.extractCampaignTableIdentity.mockImplementation((buffer: Buffer) => {
      const pathParts = buffer.toString("utf8").replace(/\\/g, "/").split("/");
      const campaignsIndex = pathParts.indexOf("campaigns");
      return { campaignName: pathParts[campaignsIndex + 1] ?? pathParts.at(-1) };
    });
    mocked.parseEsfDocument.mockReturnValue({});
    mocked.openEsfBuffer.mockImplementation((buffer: Buffer) => ({ buffer }));
    mocked.extractStartposRegionSlotTemplates.mockImplementation(
      (_buffer: Buffer, _document: unknown, campaign: string) => [
        { campaign, region: "region", slotTemplate: "template", slotType: "slot" },
      ],
    );
    appData.currentGame = "wh3";
  });

  it("reads packed startpos candidates together and reuses the in-memory result", async () => {
    const { dataFolder } = await createFixture([]);
    const startposFiles = ["campaigns\\wh3_main_chaos\\startpos.esf", "campaigns\\wh3_main_combi\\startpos.esf"];
    const { pack, mod } = await createModPack(dataFolder, "mod.pack", startposFiles);
    appData.packsData = [pack];

    const first = await loadStartposRegionSlotTemplates([mod]);
    const second = await loadStartposRegionSlotTemplates([mod]);

    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    expect(mocked.readPackedFileBuffersFromIndex).toHaveBeenCalledOnce();
    expect(mocked.readPackedFileBuffersFromIndex.mock.calls[0][1]).toEqual(startposFiles);
    expect(mocked.readPack).not.toHaveBeenCalled();
  });

  it("reuses the persisted rows after the process-local cache is cleared", async () => {
    const { userDataPath } = await createFixture();
    const first = await loadStartposRegionSlotTemplates([], userDataPath);
    expect(first).toHaveLength(1);
    expect(fs.existsSync(cachePath(userDataPath))).toBe(true);

    clearStartposRegionSlotTemplatesCache();
    const second = await loadStartposRegionSlotTemplates([], userDataPath);

    expect(second).toEqual(first);
    expect(mocked.extractCampaignTableIdentity).toHaveBeenCalledOnce();
    expect(mocked.extractStartposRegionSlotTemplates).toHaveBeenCalledOnce();
  });

  it("invalidates the disk result when a loose vanilla startpos changes", async () => {
    const { dataFolder, userDataPath } = await createFixture();
    const filePath = path.join(dataFolder, "campaigns", "wh3_main_combi", "startpos.esf");
    await loadStartposRegionSlotTemplates([], userDataPath);

    clearStartposRegionSlotTemplatesCache();
    await fs.promises.appendFile(filePath, " changed");
    await loadStartposRegionSlotTemplates([], userDataPath);

    expect(mocked.extractCampaignTableIdentity).toHaveBeenCalledTimes(2);
  });

  it("invalidates the disk result when a mod pack changes", async () => {
    const { dataFolder, userDataPath } = await createFixture([]);
    const { pack, mod } = await createModPack(dataFolder, "mod.pack", ["campaigns\\wh3_main_combi\\startpos.esf"]);
    appData.packsData = [pack];
    await loadStartposRegionSlotTemplates([mod], userDataPath);

    clearStartposRegionSlotTemplatesCache();
    await fs.promises.appendFile(mod.path, " changed");
    await loadStartposRegionSlotTemplates([mod], userDataPath);

    expect(mocked.extractCampaignTableIdentity).toHaveBeenCalledTimes(2);
    expect(mocked.readPackedFileBuffersFromIndex).toHaveBeenCalledTimes(2);
  });

  it("invalidates the disk result when enabled-mod load order changes", async () => {
    const { dataFolder, userDataPath } = await createFixture([]);
    const fileName = "campaigns\\wh3_main_combi\\startpos.esf";
    const firstPack = await createModPack(dataFolder, "a.pack", [fileName]);
    const secondPack = await createModPack(dataFolder, "b.pack", [fileName]);
    const mods = [
      { ...firstPack.mod, name: "Alpha", loadOrder: 0 },
      { ...secondPack.mod, name: "Beta", loadOrder: 1 },
    ] as Mod[];
    appData.packsData = [firstPack.pack, secondPack.pack];
    await loadStartposRegionSlotTemplates(mods, userDataPath);

    clearStartposRegionSlotTemplatesCache();
    mods[0].loadOrder = 1;
    mods[1].loadOrder = 0;
    await loadStartposRegionSlotTemplates(mods, userDataPath);

    expect(mocked.extractCampaignTableIdentity).toHaveBeenCalledTimes(4);
    expect(mocked.readPackedFileBuffersFromIndex).toHaveBeenCalledTimes(4);
  });

  it.each(["corrupt", "malformed", "old-version"] as const)("rebuilds after a %s disk cache", async (failureKind) => {
    const { userDataPath } = await createFixture();
    const first = await loadStartposRegionSlotTemplates([], userDataPath);
    clearStartposRegionSlotTemplatesCache();
    if (failureKind === "corrupt") {
      await fs.promises.writeFile(cachePath(userDataPath), "not zstd json");
    } else {
      const cache = JSON.parse(await fs.promises.readFile(cachePath(userDataPath), "utf8"));
      if (failureKind === "malformed") cache.rows = [{ campaign: "missing fields" }];
      else cache.version = STARTPOS_REGION_SLOT_TEMPLATE_CACHE_VERSION - 1;
      await fs.promises.writeFile(cachePath(userDataPath), JSON.stringify(cache));
    }

    clearStartposRegionSlotTemplatesCache();
    const second = await loadStartposRegionSlotTemplates([], userDataPath);

    expect(second).toEqual(first);
    expect(mocked.extractCampaignTableIdentity).toHaveBeenCalledTimes(2);
  });

  it("does not persist rows when one candidate payload cannot be read", async () => {
    const { dataFolder, userDataPath } = await createFixture([]);
    const { pack, mod } = await createModPack(dataFolder, "mod.pack", ["campaigns\\wh3_main_combi\\startpos.esf"]);
    appData.packsData = [pack];
    mocked.readPackedFileBuffersFromIndex.mockResolvedValueOnce(new Map());

    const partial = await loadStartposRegionSlotTemplates([mod], userDataPath);
    expect(partial).toEqual([]);
    expect(fs.existsSync(cachePath(userDataPath))).toBe(false);

    clearStartposRegionSlotTemplatesCache();
    const recovered = await loadStartposRegionSlotTemplates([mod], userDataPath);
    expect(recovered).toHaveLength(1);
    expect(fs.existsSync(cachePath(userDataPath))).toBe(true);
    expect(mocked.readPackedFileBuffersFromIndex).toHaveBeenCalledTimes(2);
  });

  it("does not persist rows when a mod index read fails", async () => {
    const { dataFolder, userDataPath } = await createFixture([]);
    const { pack, mod } = await createModPack(dataFolder, "mod.pack", ["campaigns\\wh3_main_combi\\startpos.esf"]);
    appData.packsData = [];
    mocked.readPack.mockRejectedValueOnce(new Error("temporary pack index failure"));

    expect(await loadStartposRegionSlotTemplates([mod], userDataPath)).toEqual([]);
    expect(fs.existsSync(cachePath(userDataPath))).toBe(false);

    clearStartposRegionSlotTemplatesCache();
    appData.packsData = [pack];
    expect(await loadStartposRegionSlotTemplates([mod], userDataPath)).toHaveLength(1);
    expect(fs.existsSync(cachePath(userDataPath))).toBe(true);
  });

  it("keeps persistence failures nonfatal", async () => {
    const { root } = await createFixture();
    const invalidUserDataPath = path.join(root, "not-a-directory");
    await fs.promises.writeFile(invalidUserDataPath, "file");
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(loadStartposRegionSlotTemplates([], invalidUserDataPath)).resolves.toHaveLength(1);
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });

  it("coalesces concurrent cold reads", async () => {
    const { dataFolder, userDataPath } = await createFixture([]);
    const { pack, mod } = await createModPack(dataFolder, "mod.pack", ["campaigns\\wh3_main_combi\\startpos.esf"]);
    appData.packsData = [pack];
    let signalStarted!: () => void;
    let releaseRead!: () => void;
    const started = new Promise<void>((resolve) => (signalStarted = resolve));
    const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
    mocked.readPackedFileBuffersFromIndex.mockImplementationOnce(async (_pack: any, fileNames: string[]) => {
      signalStarted();
      await readGate;
      return new Map(fileNames.map((fileName) => [fileName, Buffer.from(fileName)]));
    });

    const first = loadStartposRegionSlotTemplates([mod], userDataPath);
    await started;
    const second = loadStartposRegionSlotTemplates([mod], userDataPath);
    releaseRead();

    expect(await second).toEqual(await first);
    expect(mocked.readPackedFileBuffersFromIndex).toHaveBeenCalledOnce();
  });

  it("does not publish an in-flight result after the cache is cleared", async () => {
    const { dataFolder, userDataPath } = await createFixture([]);
    const { pack, mod } = await createModPack(dataFolder, "mod.pack", ["campaigns\\wh3_main_combi\\startpos.esf"]);
    appData.packsData = [pack];
    let signalStarted!: () => void;
    let releaseRead!: () => void;
    const started = new Promise<void>((resolve) => (signalStarted = resolve));
    const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
    mocked.readPackedFileBuffersFromIndex.mockImplementationOnce(async (_pack: any, fileNames: string[]) => {
      signalStarted();
      await readGate;
      return new Map(fileNames.map((fileName) => [fileName, Buffer.from(fileName)]));
    });

    const inFlight = loadStartposRegionSlotTemplates([mod], userDataPath);
    await started;
    clearStartposRegionSlotTemplatesCache();
    releaseRead();
    expect(await inFlight).toHaveLength(1);
    expect(fs.existsSync(cachePath(userDataPath))).toBe(false);

    await loadStartposRegionSlotTemplates([mod], userDataPath);
    expect(mocked.readPackedFileBuffersFromIndex).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(cachePath(userDataPath))).toBe(true);
  });
});
