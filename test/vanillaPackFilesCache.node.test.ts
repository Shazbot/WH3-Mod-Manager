import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
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

const electronState = vi.hoisted(() => ({
  userDataPath: "",
  decompressCount: 0,
  decompressGate: undefined as Promise<void> | undefined,
  onDecompressStart: undefined as (() => void) | undefined,
}));

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
    electronState.onDecompressStart?.();
    if (electronState.decompressGate) await electronState.decompressGate;
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
    electronState.decompressGate = undefined;
    electronState.onDecompressStart = undefined;
    root = await mkdtemp(path.join(tmpdir(), "whmm-vanilla-files-cache-"));
    electronState.userDataPath = root;
    appData.gamesToGameFolderPaths.wh3.dataFolder = root;
    appData.allVanillaPackNames = new Set(["vanilla.pack", "new-vanilla.pack", "stale.pack"]);
  });

  afterEach(async () => {
    await cacheApi.saveVanillaPackFilesCache();
    electronState.decompressGate = undefined;
    electronState.onDecompressStart = undefined;
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

  const reloadCacheApi = async () => {
    vi.resetModules();
    appData = (await import("../src/appData")).default;
    appData.gamesToGameFolderPaths.wh3.dataFolder = root;
    appData.allVanillaPackNames = new Set(["vanilla.pack", "new-vanilla.pack", "stale.pack"]);
    cacheApi = await import("../src/vanillaPackFilesCache");
  };

  const modNamesSidecarPath = (packPath: string, userDataPath = root) => {
    const normalizedPackPath = path.resolve(packPath).toLowerCase();
    const hash = createHash("sha256").update(normalizedPackPath).digest("hex");
    return path.join(userDataPath, "mod-pack-file-names", `${hash}.bin`);
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
    // Exercise cache-key aliases even on a case-sensitive filesystem.
    const originalStat = fs.promises.stat.bind(fs.promises);
    vi.spyOn(fs.promises, "stat").mockImplementation((file, ...args) =>
      originalStat(file === windowsVariant ? packPath : file, ...args),
    );
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
    expect(modEntry).toBeUndefined();
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

  it("does not decode corrupt legacy mod names during a sidecar lookup", async () => {
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

  it("stores mod names separately without reading or rewriting the vanilla cache", async () => {
    const modPath = path.join(root, "new-mod.pack");
    const vanillaCacheBytes = Buffer.from("corrupt vanilla cache body");
    await writeFile(modPath, Buffer.from("mod"));
    await writeFile(path.join(root, "vanilla-pack-files-cache.bin"), vanillaCacheBytes);
    const modStats = await stat(modPath);

    cacheApi.rememberPackFileNames(modPath, modStats.size, modStats.mtimeMs, ["first.bin", "second.bin", "first.bin"]);
    await cacheApi.saveVanillaPackFilesCache();

    expect(electronState.decompressCount).toBe(0);
    expect(await readFile(path.join(root, "vanilla-pack-files-cache.bin"))).toEqual(vanillaCacheBytes);
    expect(await readdir(path.join(root, "mod-pack-file-names"))).toHaveLength(1);

    await reloadCacheApi();
    const persisted = await cacheApi.getCurrentPackFilesCacheEntry(modPath);

    expect(persisted?.packedFileNames).toEqual(["first.bin", "second.bin", "first.bin"]);
    expect(electronState.decompressCount).toBe(1);
    expect(await readFile(path.join(root, "vanilla-pack-files-cache.bin"))).toEqual(vanillaCacheBytes);

    persisted!.packedFileNames!.push("mutated.bin");
    const aliasPath =
      process.platform === "win32" ? modPath.toUpperCase().replaceAll("\\", "/") : modPath.replaceAll("\\", "/");
    expect((await cacheApi.getCurrentPackFilesCacheEntry(aliasPath))?.packedFileNames).toEqual([
      "first.bin",
      "second.bin",
      "first.bin",
    ]);
  });

  it.each(["corrupt", "old-version"] as const)("treats a %s mod names sidecar as a cache miss", async (failureKind) => {
    const modPath = path.join(root, "mod.pack");
    await writeFile(modPath, Buffer.from("mod"));
    const modStats = await stat(modPath);
    cacheApi.rememberPackFileNames(modPath, modStats.size, modStats.mtimeMs, ["cached.bin"]);
    await cacheApi.saveVanillaPackFilesCache();

    const sidecarPath = modNamesSidecarPath(modPath);
    if (failureKind === "corrupt") {
      await writeFile(sidecarPath, Buffer.from("not json"));
    } else {
      await writeFile(sidecarPath, JSON.stringify({ version: 0, packedFileNames: ["old.bin"] }));
    }
    await reloadCacheApi();
    electronState.decompressCount = 0;

    await expect(cacheApi.getCurrentPackFilesCacheEntry(modPath)).resolves.toBeUndefined();
    expect(electronState.decompressCount).toBe(1);
  });

  it("keeps a newer in-memory names update when an older disk read finishes later", async () => {
    const modPath = path.join(root, "mod.pack");
    await writeFile(modPath, Buffer.from("mod"));
    const modStats = await stat(modPath);
    cacheApi.rememberPackFileNames(modPath, modStats.size, modStats.mtimeMs, ["disk.bin"]);
    await cacheApi.saveVanillaPackFilesCache();
    await reloadCacheApi();

    let signalStarted!: () => void;
    let releaseRead!: () => void;
    const started = new Promise<void>((resolve) => (signalStarted = resolve));
    electronState.decompressGate = new Promise<void>((resolve) => (releaseRead = resolve));
    electronState.onDecompressStart = signalStarted;

    const diskRead = cacheApi.getCurrentPackFilesCacheEntry(modPath);
    await started;
    cacheApi.rememberPackFileNames(modPath, modStats.size, modStats.mtimeMs, ["memory.bin"]);
    releaseRead();

    expect((await diskRead)?.packedFileNames).toEqual(["memory.bin"]);
    expect((await cacheApi.getCurrentPackFilesCacheEntry(modPath))?.packedFileNames).toEqual(["memory.bin"]);
    electronState.decompressGate = undefined;
    electronState.onDecompressStart = undefined;
  });

  it("keeps a newer memory entry available while an older-identity disk read is pending", async () => {
    const modPath = path.join(root, "mod.pack");
    await writeFile(modPath, Buffer.from("mod"));
    const modStats = await stat(modPath);
    const namesCache = await import("../src/modPackFileNamesCache");
    const newerSize = modStats.size + 1;
    namesCache.rememberModPackFileNamesCacheEntry(root, modPath, newerSize, modStats.mtimeMs, ["newer.bin"]);
    await namesCache.flushModPackFileNamesCache();

    let signalFirstRead!: () => void;
    let signalSecondRead!: () => void;
    let releaseReads!: () => void;
    const firstReadStarted = new Promise<void>((resolve) => (signalFirstRead = resolve));
    const secondReadStarted = new Promise<void>((resolve) => (signalSecondRead = resolve));
    electronState.decompressGate = new Promise<void>((resolve) => (releaseReads = resolve));
    electronState.onDecompressStart = () => {
      if (electronState.decompressCount === 1) signalFirstRead();
      if (electronState.decompressCount === 2) signalSecondRead();
    };

    const olderLookup = namesCache.getModPackFileNamesCacheEntry(root, modPath, modStats.size, modStats.mtimeMs);
    await firstReadStarted;
    const newerLookup = namesCache.getModPackFileNamesCacheEntry(root, modPath, newerSize, modStats.mtimeMs);
    const nextEvent = await Promise.race([
      newerLookup.then(() => "memory-hit" as const),
      secondReadStarted.then(() => "second-disk-read" as const),
    ]);

    expect(nextEvent).toBe("memory-hit");
    releaseReads();
    await expect(olderLookup).resolves.toBeUndefined();
    await expect(newerLookup).resolves.toEqual(["newer.bin"]);
    electronState.decompressGate = undefined;
    electronState.onDecompressStart = undefined;
  });

  it("captures the user-data path when a sidecar write is queued", async () => {
    const modPath = path.join(root, "mod.pack");
    const otherUserData = path.join(root, "other-user-data");
    await writeFile(modPath, Buffer.from("mod"));
    const modStats = await stat(modPath);

    cacheApi.rememberPackFileNames(modPath, modStats.size, modStats.mtimeMs, ["captured.bin"]);
    electronState.userDataPath = otherUserData;
    await cacheApi.saveVanillaPackFilesCache();

    expect(await readFile(modNamesSidecarPath(modPath))).toBeDefined();
    await expect(readdir(path.join(otherUserData, "mod-pack-file-names"))).rejects.toMatchObject({ code: "ENOENT" });
    electronState.userDataPath = root;
  });

  it("keeps a sidecar write failure nonfatal", async () => {
    const modPath = path.join(root, "mod.pack");
    const blockedUserData = path.join(root, "user-data-file");
    await writeFile(modPath, Buffer.from("mod"));
    await writeFile(blockedUserData, Buffer.from("not a directory"));
    const modStats = await stat(modPath);
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    electronState.userDataPath = blockedUserData;

    cacheApi.rememberPackFileNames(modPath, modStats.size, modStats.mtimeMs, ["cached.bin"]);
    await expect(cacheApi.saveVanillaPackFilesCache()).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
    electronState.userDataPath = root;
  });

  it("invalidates sidecar names after pack size or mtime changes", async () => {
    const modPath = path.join(root, "mod.pack");
    await writeFile(modPath, Buffer.from("mod"));
    let modStats = await stat(modPath);

    cacheApi.rememberPackFileNames(modPath, modStats.size, modStats.mtimeMs, ["old.bin"]);
    await cacheApi.saveVanillaPackFilesCache();
    expect((await cacheApi.getCurrentPackFilesCacheEntry(modPath))?.packedFileNames).toEqual(["old.bin"]);

    await writeFile(modPath, Buffer.from("mod with a different size"));
    expect(await cacheApi.getCurrentPackFilesCacheEntry(modPath)).toBeUndefined();
    modStats = await stat(modPath);
    cacheApi.rememberPackFileNames(modPath, modStats.size, modStats.mtimeMs, ["new.bin"]);
    await cacheApi.saveVanillaPackFilesCache();

    const newMtime = new Date(modStats.mtimeMs + 5000);
    await utimes(modPath, new Date(modStats.atimeMs), newMtime);
    expect(await cacheApi.getCurrentPackFilesCacheEntry(modPath)).toBeUndefined();
  });

  it("keeps legacy mod rows when a vanilla mutation rewrites the shared cache", async () => {
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

    const vanillaCachePath = path.join(root, "vanilla-pack-files-cache.bin");
    const originalVanillaCache = await readFile(vanillaCachePath);
    cacheApi.rememberPackFileNames(newModPath, newModStats.size, newModStats.mtimeMs, ["new.bin"]);
    await cacheApi.saveVanillaPackFilesCache();
    expect(electronState.decompressCount).toBe(0);
    expect(await readFile(vanillaCachePath)).toEqual(originalVanillaCache);

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
    await cacheApi.saveVanillaPackFilesCache();

    const full = await cacheApi.loadVanillaPackFilesCache();
    expect(Object.keys(full.entries).sort()).toEqual(
      [existingPath, existingModPath, newVanillaPath].map((value) => path.resolve(value)).sort(),
    );
    expect(full.entries[existingPath]).toMatchObject({ packedFiles: [{ name: "existing.anim" }] });
    expect(full.entries[existingModPath]).toMatchObject({ packedFileNames: ["existing.bin"] });
    expect(full.entries[newVanillaPath]).toMatchObject({ packedFiles: [{ name: "new.anim" }] });
    expect(await cacheApi.getCurrentPackFilesCacheEntry(newModPath)).toMatchObject({ packedFileNames: ["new.bin"] });

    const written = decodeVanillaPackFilesCache(await readFile(vanillaCachePath));
    expect(Object.keys(written?.entries ?? {}).sort()).toEqual(Object.keys(full.entries).sort());
    expect(electronState.decompressCount).toBe(1);
  });
});
