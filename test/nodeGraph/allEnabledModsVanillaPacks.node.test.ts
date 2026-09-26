import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { executeNodeAction } from "../../src/nodeExecutor";
import { getVanillaPackPathsInLoadOrder } from "../../src/utility/vanillaPackPaths";
import { buildPackPriority, resolveFileSourcePacks } from "../../src/nodeGraph/packPriority";
import type { Mod } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

let dataFolder: string | undefined;
const originalCurrentGame = appData.currentGame;
const originalDataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
const originalVanillaPackNames = appData.allVanillaPackNames;
const originalEnabledMods = appData.enabledMods;

afterEach(async () => {
  appData.currentGame = originalCurrentGame;
  appData.gamesToGameFolderPaths.wh3.dataFolder = originalDataFolder;
  appData.allVanillaPackNames = originalVanillaPackNames;
  appData.enabledMods = originalEnabledMods;
  if (dataFolder) {
    await rm(dataFolder, { recursive: true, force: true });
    dataFolder = undefined;
  }
});

/** A data folder holding the named vanilla packs, in the order the manifest lists them. */
const setUpVanillaDataFolder = async (packNames: string[]): Promise<string> => {
  dataFolder = await mkdtemp(path.join(tmpdir(), "whmm-vanilla-packs-"));
  for (const packName of packNames) {
    await writeFile(path.join(dataFolder, packName), "");
  }
  appData.currentGame = "wh3";
  appData.gamesToGameFolderPaths.wh3.dataFolder = dataFolder;
  // A fresh Set each time, because the listing is memoized on the folder and the name count.
  appData.allVanillaPackNames = new Set(packNames);
  return dataFolder;
};

const runAllEnabledMods = (includeBaseGame: boolean) =>
  executeNodeAction({
    nodeId: "all_enabled_mods_1",
    nodeType: "allenabledmods",
    textValue: "",
    config: { includeBaseGame },
    inputData: null,
  });

describe("All Enabled Mods with Include Base Game", () => {
  it("hands the flow every vanilla pack, not only the one holding db tables", async () => {
    const folder = await setUpVanillaDataFolder(["db.pack", "variants.pack", "ui.pack"]);
    appData.enabledMods = [];

    const result = await runAllEnabledMods(true);

    expect(result.success).toBe(true);
    const files = (result.data as PackFilesNodeData).files;
    expect(files.map((file) => file.name).sort()).toEqual(["db.pack", "ui.pack", "variants.pack"]);
    // Vanilla files are found by path, so a name alone is not enough.
    expect(files.every((file) => file.path.startsWith(folder))).toBe(true);
    expect(files.every((file) => file.loaded)).toBe(true);
  });

  it("adds no vanilla pack at all when the box is unchecked", async () => {
    await setUpVanillaDataFolder(["db.pack", "variants.pack"]);
    appData.enabledMods = [];

    const result = await runAllEnabledMods(false);

    expect(result.success).toBe(true);
    expect((result.data as PackFilesNodeData).files).toHaveLength(0);
  });

  it("skips a pack the manifest names but the install does not have", async () => {
    await setUpVanillaDataFolder(["db.pack"]);
    appData.allVanillaPackNames = new Set(["db.pack", "missing_dlc.pack"]);
    appData.enabledMods = [];

    const result = await runAllEnabledMods(true);

    expect((result.data as PackFilesNodeData).files.map((file) => file.name)).toEqual(["db.pack"]);
  });
});

describe("vanilla pack load order", () => {
  it("ranks vanilla packs in manifest order and below every mod", async () => {
    const folder = await setUpVanillaDataFolder(["data.pack", "data_bl.pack"]);
    const modPath = path.join(folder, "some_mod.pack");
    appData.enabledMods = [{ name: "some_mod.pack", path: modPath } as Mod];

    const priority = buildPackPriority([
      ...getVanillaPackPathsInLoadOrder(),
      ...appData.enabledMods.map((mod) => mod.path),
    ]);

    // Every pack carries the same file: the mod wins, and between the two vanilla packs the one
    // the manifest lists later wins, which is the order the game loads them in.
    const sharedFile = "variantmeshes\\variantmeshdefinitions\\shared.variantmeshdefinition";
    const winners = resolveFileSourcePacks(
      [
        { packPath: path.join(folder, "data.pack"), fileNames: [sharedFile] },
        { packPath: path.join(folder, "data_bl.pack"), fileNames: [sharedFile] },
        { packPath: modPath, fileNames: [sharedFile] },
      ],
      priority,
    );
    expect(winners.get(sharedFile)).toBe(modPath);

    const vanillaOnlyWinners = resolveFileSourcePacks(
      [
        { packPath: path.join(folder, "data.pack"), fileNames: [sharedFile] },
        { packPath: path.join(folder, "data_bl.pack"), fileNames: [sharedFile] },
      ],
      priority,
    );
    expect(vanillaOnlyWinners.get(sharedFile)).toBe(path.join(folder, "data_bl.pack"));
  });
});
