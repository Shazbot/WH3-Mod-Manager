import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import appData from "../../src/appData";
import { narrowFilesToPacksWithTables } from "../../src/nodeExecutor";
import { buildVanillaPackIndex } from "../../src/vanillaPackIndex/format";
import { getVanillaPackIndex } from "../../src/vanillaPackIndex/store";
import type { VanillaPackFileNames, VanillaPackIndex } from "../../src/vanillaPackIndex/format";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));
vi.mock("../../src/vanillaPackIndex/store", () => ({
  getVanillaPackIndex: vi.fn(async () => undefined),
}));

const mockedGetVanillaPackIndex = vi.mocked(getVanillaPackIndex);

let dataFolder: string | undefined;
const originalCurrentGame = appData.currentGame;
const originalDataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
const originalVanillaPackNames = appData.allVanillaPackNames;

afterEach(async () => {
  appData.currentGame = originalCurrentGame;
  appData.gamesToGameFolderPaths.wh3.dataFolder = originalDataFolder;
  appData.allVanillaPackNames = originalVanillaPackNames;
  mockedGetVanillaPackIndex.mockClear();
  mockedGetVanillaPackIndex.mockResolvedValue(undefined);
  if (dataFolder) {
    await rm(dataFolder, { recursive: true, force: true });
    dataFolder = undefined;
  }
});

/** A data folder holding the named vanilla packs, in the order the manifest lists them. */
const setUpVanillaDataFolder = async (packNames: string[]): Promise<string> => {
  dataFolder = await mkdtemp(path.join(tmpdir(), "whmm-narrowing-"));
  for (const packName of packNames) {
    await writeFile(path.join(dataFolder, packName), "");
  }
  appData.currentGame = "wh3";
  appData.gamesToGameFolderPaths.wh3.dataFolder = dataFolder;
  // A fresh Set each time, because the listing is memoized on the folder and the name count.
  appData.allVanillaPackNames = new Set(packNames);
  return dataFolder;
};

/** `packs` runs lowest priority first, the order the manifest lists them in. */
const indexOf = (packs: VanillaPackFileNames[]): VanillaPackIndex =>
  buildVanillaPackIndex(
    { game: "wh3", dataFolder: dataFolder as string, manifestSize: 1, manifestMtimeMs: 1, packCount: packs.length },
    packs,
  );

const vanillaFile = (folder: string, packName: string) => ({
  name: packName,
  path: path.join(folder, packName),
  loaded: true,
});

describe("narrowing a flow's packs to the ones that can hold a db table", () => {
  it("drops the vanilla packs that carry no file under the table", async () => {
    const folder = await setUpVanillaDataFolder(["db.pack", "variants.pack", "ui.pack"]);
    mockedGetVanillaPackIndex.mockResolvedValue(
      indexOf([
        { packName: "db.pack", fileNames: ["db\\main_units_tables\\data__", "db\\land_units_tables\\data__"] },
        { packName: "variants.pack", fileNames: ["variantmeshes\\a.variantmeshdefinition"] },
        { packName: "ui.pack", fileNames: ["ui\\campaign ui\\a.twui.xml"] },
      ]),
    );

    const narrowed = await narrowFilesToPacksWithTables(
      ["db.pack", "variants.pack", "ui.pack"].map((packName) => vanillaFile(folder, packName)),
      ["db\\main_units_tables"],
      "test",
    );

    expect(narrowed.map((file) => file.name)).toEqual(["db.pack"]);
  });

  it("keeps a pack that carries any one of the requested tables", async () => {
    const folder = await setUpVanillaDataFolder(["db.pack", "audio.pack"]);
    mockedGetVanillaPackIndex.mockResolvedValue(
      indexOf([
        { packName: "db.pack", fileNames: ["db\\main_units_tables\\data__"] },
        { packName: "audio.pack", fileNames: ["db\\_kv_rules_tables\\data__"] },
      ]),
    );

    const narrowed = await narrowFilesToPacksWithTables(
      ["db.pack", "audio.pack"].map((packName) => vanillaFile(folder, packName)),
      ["db\\main_units_tables", "db\\_kv_rules_tables"],
      "test",
    );

    expect(narrowed.map((file) => file.name).sort()).toEqual(["audio.pack", "db.pack"]);
  });

  it("keeps every mod pack, because the index says nothing about what a mod holds", async () => {
    const folder = await setUpVanillaDataFolder(["db.pack", "variants.pack", "ui.pack"]);
    mockedGetVanillaPackIndex.mockResolvedValue(
      indexOf([
        { packName: "db.pack", fileNames: ["db\\main_units_tables\\data__"] },
        { packName: "variants.pack", fileNames: ["variantmeshes\\a.variantmeshdefinition"] },
        { packName: "ui.pack", fileNames: ["ui\\campaign ui\\a.twui.xml"] },
      ]),
    );

    const narrowed = await narrowFilesToPacksWithTables(
      [
        vanillaFile(folder, "db.pack"),
        vanillaFile(folder, "variants.pack"),
        vanillaFile(folder, "ui.pack"),
        { name: "some_mod.pack", path: path.join(folder, "mods", "some_mod.pack"), loaded: true },
      ],
      ["db\\main_units_tables"],
      "test",
    );

    expect(narrowed.map((file) => file.name).sort()).toEqual(["db.pack", "some_mod.pack"]);
  });

  it("drops a vanilla pack whose copy of the table a later vanilla pack overrides", async () => {
    const folder = await setUpVanillaDataFolder(["data.pack", "data_bl.pack", "ui.pack"]);
    mockedGetVanillaPackIndex.mockResolvedValue(
      indexOf([
        { packName: "data.pack", fileNames: ["db\\main_units_tables\\data__"] },
        { packName: "data_bl.pack", fileNames: ["db\\main_units_tables\\data__"] },
        { packName: "ui.pack", fileNames: ["ui\\campaign ui\\a.twui.xml"] },
      ]),
    );

    const narrowed = await narrowFilesToPacksWithTables(
      ["data.pack", "data_bl.pack", "ui.pack"].map((packName) => vanillaFile(folder, packName)),
      ["db\\main_units_tables"],
      "test",
    );

    // Reading data.pack would only produce a table the game never loads.
    expect(narrowed.map((file) => file.name)).toEqual(["data_bl.pack"]);
  });

  it("reads everything when there is no index, so a missing index costs speed not correctness", async () => {
    const folder = await setUpVanillaDataFolder(["db.pack", "variants.pack", "ui.pack"]);
    mockedGetVanillaPackIndex.mockResolvedValue(undefined);

    const files = ["db.pack", "variants.pack", "ui.pack"].map((packName) => vanillaFile(folder, packName));
    const narrowed = await narrowFilesToPacksWithTables(files, ["db\\main_units_tables"], "test");

    expect(narrowed.map((file) => file.name)).toEqual(["db.pack", "variants.pack", "ui.pack"]);
  });

  it("does not consult the index when there is at most one vanilla pack to save", async () => {
    const folder = await setUpVanillaDataFolder(["db.pack"]);

    const narrowed = await narrowFilesToPacksWithTables(
      [
        vanillaFile(folder, "db.pack"),
        { name: "some_mod.pack", path: path.join(folder, "mods", "some_mod.pack"), loaded: true },
      ],
      ["db\\main_units_tables"],
      "test",
    );

    expect(narrowed).toHaveLength(2);
    expect(mockedGetVanillaPackIndex).not.toHaveBeenCalled();
  });
});
