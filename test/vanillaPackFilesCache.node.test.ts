import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import appData from "../src/appData";
import {
  getCurrentPackFilesCacheEntry,
  getCurrentVanillaPackIndex,
  loadVanillaPackFilesCache,
  rememberPackFileNames,
  rememberVanillaPackIndex,
  saveVanillaPackFilesCache,
} from "../src/vanillaPackFilesCache";
import type { PackHeader } from "../src/packFileTypes";
import { decodeVanillaPackFilesCache } from "../src/vanillaPackFilesCacheFormat";
import { readPack } from "../src/packFileSerializer";

const electronState = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.userDataPath),
  },
  shell: {},
}));

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (value: Uint8Array) => value,
  decompress: async (value: Uint8Array) => value,
}));

describe("vanilla pack files cache", () => {
  const originalDataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
  const originalVanillaPackNames = appData.allVanillaPackNames;

  afterEach(async () => {
    appData.gamesToGameFolderPaths.wh3.dataFolder = originalDataFolder;
    appData.allVanillaPackNames = originalVanillaPackNames;
    if (electronState.userDataPath) await rm(electronState.userDataPath, { recursive: true, force: true });
    electronState.userDataPath = "";
  });

  it("invalidates the old names-only format and stores expanded vanilla index metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-vanilla-files-cache-"));
    electronState.userDataPath = root;
    appData.gamesToGameFolderPaths.wh3.dataFolder = root;
    appData.allVanillaPackNames = new Set(["vanilla.pack"]);

    const packPath = path.join(root, "vanilla.pack");
    const modPath = path.join(root, "mod.pack");
    await writeFile(packPath, Buffer.from("pack"));
    await writeFile(modPath, Buffer.from("mod"));
    await writeFile(
      path.join(root, "vanilla-pack-files-cache.bin"),
      Buffer.from(JSON.stringify({ [packPath]: { size: 4, lastChangedLocal: 1, packedFileNames: ["old.bin"] } })),
    );

    await expect(loadVanillaPackFilesCache()).resolves.toMatchObject({ version: 3, entries: {} });

    const packStats = await stat(packPath);
    const packHeader: PackHeader = {
      header: Buffer.from("PFH5"),
      byteMask: 0x41,
      refFileCount: 0,
      pack_file_index_size: 0,
      pack_file_count: 1,
      header_buffer: Buffer.alloc(4),
    };
    rememberVanillaPackIndex(
      packPath,
      packStats.size,
      packStats.mtimeMs,
      [{ name: "animations\\stand_idle.anim", file_size: 12, start_pos: 36, is_compressed: false }],
      packHeader,
      ["dependency.pack"],
    );
    const modStats = await stat(modPath);
    rememberPackFileNames(modPath, modStats.size, modStats.mtimeMs, ["mod.bin"]);
    await saveVanillaPackFilesCache();

    const written = decodeVanillaPackFilesCache(await readFile(path.join(root, "vanilla-pack-files-cache.bin")));
    expect(written?.version).toBe(3);
    expect(Object.keys(written?.entries ?? {})).toEqual([path.resolve(packPath), path.resolve(modPath)]);
    await expect(getCurrentVanillaPackIndex(packPath)).resolves.toMatchObject({
      packedFiles: [{ name: "animations\\stand_idle.anim", file_size: 12, start_pos: 36, is_compressed: false }],
      packHeader: { byteMask: 0x41, pack_file_count: 1 },
      dependencyPacks: ["dependency.pack"],
    });
    await expect(readPack(packPath, { skipParsingTables: true, skipSorting: true })).resolves.toMatchObject({
      packedFiles: [{ name: "animations\\stand_idle.anim", start_pos: 36 }],
    });
    await expect(getCurrentPackFilesCacheEntry(modPath)).resolves.toMatchObject({
      packedFileNames: ["mod.bin"],
    });
  });
});
