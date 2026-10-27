import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PackHeader } from "../src/packFileTypes";
import {
  decodeVanillaPackFilesCache,
  encodeVanillaPackFilesCache,
  indexVanillaPackFilesCache,
  type VanillaPackFilesCache,
} from "../src/vanillaPackFilesCacheFormat";

const electronState = vi.hoisted(() => ({ userDataPath: "", decompressCount: 0 }));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.userDataPath),
  },
  shell: {},
}));

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (value: Uint8Array) => value,
  decompress: async (value: Uint8Array) => {
    electronState.decompressCount++;
    return value;
  },
}));

describe("vanilla pack files cache", () => {
  let cacheApi: typeof import("../src/vanillaPackFilesCache");
  let appData: typeof import("../src/appData").default;
  let originalDataFolder: string;
  let originalVanillaPackNames: Set<string>;
  let root = "";

  beforeEach(async () => {
    vi.resetModules();
    appData = (await import("../src/appData")).default;
    originalDataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
    originalVanillaPackNames = appData.allVanillaPackNames;
    cacheApi = await import("../src/vanillaPackFilesCache");
    electronState.decompressCount = 0;
    root = await mkdtemp(path.join(tmpdir(), "whmm-vanilla-files-cache-"));
    electronState.userDataPath = root;
    appData.gamesToGameFolderPaths.wh3.dataFolder = root;
    appData.allVanillaPackNames = new Set(["vanilla.pack", "new-vanilla.pack", "stale.pack"]);
  });

  afterEach(async () => {
    appData.gamesToGameFolderPaths.wh3.dataFolder = originalDataFolder;
    appData.allVanillaPackNames = originalVanillaPackNames;
    if (root) await rm(root, { recursive: true, force: true });
    electronState.userDataPath = "";
  });

  const expandedEntry = (size: number, lastChangedLocal: number, name: string) => ({
    size,
    lastChangedLocal,
    packedFiles: [{ name, file_size: 12, start_pos: 36, is_compressed: false }],
    packHeader: {
      header: Buffer.from("PFH5"),
      byteMask: 0x41,
      refFileCount: 0,
      pack_file_index_size: 0,
      pack_file_count: 1,
      header_buffer: Buffer.alloc(4),
    },
    dependencyPacks: ["dependency.pack"],
  });

  const writeCache = async (cache: VanillaPackFilesCache): Promise<Buffer> => {
    const bytes = encodeVanillaPackFilesCache(cache);
    await writeFile(path.join(root, "vanilla-pack-files-cache.bin"), bytes);
    return bytes;
  };

  it("loads and memoizes only requested records while sharing decompression with metadata reads", async () => {
    const packPath = path.join(root, "vanilla.pack");
    const stalePath = path.join(root, "stale.pack");
    const modPath = path.join(root, "mod.pack");
    await writeFile(packPath, Buffer.from("vanilla"));
    await writeFile(stalePath, Buffer.from("stale"));
    await writeFile(modPath, Buffer.from("mod"));
    const packStats = await stat(packPath);
    const staleStats = await stat(stalePath);
    const modStats = await stat(modPath);
    await writeCache({
      version: 4,
      entries: {
        [packPath.toLowerCase()]: expandedEntry(packStats.size, packStats.mtimeMs, "case-alias.anim"),
        [packPath]: expandedEntry(packStats.size, packStats.mtimeMs, "animations\\stand_idle.anim"),
        [stalePath]: expandedEntry(staleStats.size + 1, staleStats.mtimeMs, "stale.anim"),
        [modPath]: { size: modStats.size, lastChangedLocal: modStats.mtimeMs, packedFileNames: ["mod.bin"] },
      },
    });

    const windowsVariant = packPath.replaceAll("\\", "/").toUpperCase();
    const [hasIndex, first, second, modEntry, staleEntry] = await Promise.all([
      cacheApi.hasCurrentVanillaPackIndex(packPath),
      cacheApi.getCurrentVanillaPackIndex(windowsVariant),
      cacheApi.getCurrentVanillaPackIndex(packPath),
      cacheApi.getCurrentPackFilesCacheEntry(modPath),
      cacheApi.getCurrentVanillaPackFilesCacheEntry(stalePath),
    ]);

    expect(hasIndex).toBe(true);
    expect(first?.packedFiles[0]?.name).toBe("case-alias.anim");
    expect(second?.packedFiles[0]?.name).toBe("animations\\stand_idle.anim");
    expect(second?.dependencyPacks).toEqual(["dependency.pack"]);
    expect(modEntry?.packedFileNames).toEqual(["mod.bin"]);
    expect(staleEntry).toBeUndefined();
    expect(electronState.decompressCount).toBe(1);

    second!.packedFiles[0]!.name = "changed.anim";
    second!.packHeader.byteMask = 0;
    second!.dependencyPacks.push("changed.pack");
    const defensiveCopy = await cacheApi.getCurrentVanillaPackIndex(packPath);
    expect(defensiveCopy).toMatchObject({
      packedFiles: [{ name: "animations\\stand_idle.anim" }],
      packHeader: { byteMask: 0x41 },
      dependencyPacks: ["dependency.pack"],
    });

    // A save with no mutation is intentionally a no-op and keeps the lazy view.
    await cacheApi.saveVanillaPackFilesCache();
    expect(electronState.decompressCount).toBe(1);
  });

  it("skips a corrupt unrequested body and rejects it when that record is selected", async () => {
    const goodPath = path.join(root, "vanilla.pack");
    const badPath = path.join(root, "mod.pack");
    await writeFile(goodPath, Buffer.from("vanilla"));
    await writeFile(badPath, Buffer.from("mod"));
    const goodStats = await stat(goodPath);
    const badStats = await stat(badPath);
    const bytes = await writeCache({
      version: 4,
      entries: {
        [goodPath]: expandedEntry(goodStats.size, goodStats.mtimeMs, "good.anim"),
        [badPath]: { size: badStats.size, lastChangedLocal: badStats.mtimeMs, packedFileNames: ["broken.bin"] },
      },
    });
    const badRecord = indexVanillaPackFilesCache(bytes)!.get(badPath)!;
    const suffixLengthOffset = badRecord.dataOffset + 4 + Buffer.byteLength(badPath, "utf8") + 8 + 8 + 4 + 4;
    bytes.writeUInt32LE(0xffffffff, suffixLengthOffset);
    await writeFile(path.join(root, "vanilla-pack-files-cache.bin"), bytes);

    await expect(cacheApi.getCurrentVanillaPackFilesCacheEntry(goodPath)).resolves.toMatchObject({
      packedFiles: [{ name: "good.anim" }],
    });
    await expect(cacheApi.getCurrentPackFilesCacheEntry(badPath)).resolves.toBeUndefined();
    expect(decodeVanillaPackFilesCache(bytes)).toBeUndefined();
    expect(electronState.decompressCount).toBe(1);
  });

  it("fully hydrates before expanded and names-only mutations, then explicitly saves every entry", async () => {
    const existingPath = path.join(root, "vanilla.pack");
    const newVanillaPath = path.join(root, "new-vanilla.pack");
    const existingModPath = path.join(root, "existing-mod.pack");
    const newModPath = path.join(root, "new-mod.pack");
    await Promise.all(
      [existingPath, newVanillaPath, existingModPath, newModPath].map((packPath) =>
        writeFile(packPath, Buffer.from(path.basename(packPath))),
      ),
    );
    const existingStats = await stat(existingPath);
    const newVanillaStats = await stat(newVanillaPath);
    const existingModStats = await stat(existingModPath);
    const newModStats = await stat(newModPath);
    await writeCache({
      version: 4,
      entries: {
        [existingPath]: expandedEntry(existingStats.size, existingStats.mtimeMs, "existing.anim"),
        [existingModPath]: {
          size: existingModStats.size,
          lastChangedLocal: existingModStats.mtimeMs,
          packedFileNames: ["existing.bin"],
        },
      },
    });

    await cacheApi.getCurrentVanillaPackFilesCacheEntry(existingPath);
    const packHeader: PackHeader = {
      header: Buffer.from("PFH5"),
      byteMask: 0x41,
      refFileCount: 0,
      pack_file_index_size: 0,
      pack_file_count: 1,
      header_buffer: Buffer.alloc(4),
    };
    cacheApi.rememberVanillaPackIndex(
      newVanillaPath,
      newVanillaStats.size,
      newVanillaStats.mtimeMs,
      [{ name: "new.anim", file_size: 12, start_pos: 36, is_compressed: false }],
      packHeader,
      [],
    );
    cacheApi.rememberPackFileNames(newModPath, newModStats.size, newModStats.mtimeMs, ["new.bin"]);
    await cacheApi.saveVanillaPackFilesCache();

    const full = await cacheApi.loadVanillaPackFilesCache();
    expect(Object.keys(full.entries).sort()).toEqual(
      [existingPath, existingModPath, newVanillaPath, newModPath].map((value) => path.resolve(value)).sort(),
    );
    expect(full.entries[existingPath]).toMatchObject({ packedFiles: [{ name: "existing.anim" }] });
    expect(full.entries[existingModPath]).toMatchObject({ packedFileNames: ["existing.bin"] });
    expect(full.entries[newVanillaPath]).toMatchObject({ packedFiles: [{ name: "new.anim" }] });
    expect(full.entries[newModPath]).toMatchObject({ packedFileNames: ["new.bin"] });

    const written = decodeVanillaPackFilesCache(await readFile(path.join(root, "vanilla-pack-files-cache.bin")));
    expect(Object.keys(written?.entries ?? {}).sort()).toEqual(Object.keys(full.entries).sort());
    expect(electronState.decompressCount).toBe(1);
  });
});
