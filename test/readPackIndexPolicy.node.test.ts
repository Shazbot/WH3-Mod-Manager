import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readPackIndex, writeRawPack } from "../src/packCore";
import { collator } from "../src/utility/packFileSorting";

const cacheState = vi.hoisted(() => ({ userDataPath: "", decompressCount: 0 }));

vi.mock("electron", () => ({ app: { getPath: () => cacheState.userDataPath }, shell: {} }));
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (value: Uint8Array) => Buffer.from(value),
  decompress: async (value: Uint8Array) => {
    cacheState.decompressCount += 1;
    return Buffer.from(value);
  },
}));

const metadata = {
  game: "wh3" as const,
  byteMask: 0x41,
  refFileCount: 0,
  headerBuffer: Buffer.alloc(4),
  dependencies: ["dependency.pack"],
};
const cacheFileName = "vanilla-pack-files-cache.bin";

let root = "";
let dataFolder = "";
let packPath = "";
let userDataPath = "";
let appData: typeof import("../src/appData").default;
let cacheApi: typeof import("../src/vanillaPackFilesCache");
let serializer: typeof import("../src/packFileSerializer");

const loadRuntimeModules = async () => {
  vi.resetModules();
  cacheState.decompressCount = 0;
  appData = (await import("../src/appData")).default;
  appData.currentGame = "wh3";
  appData.gamesToGameFolderPaths.wh3.dataFolder = dataFolder;
  appData.allVanillaPackNames = new Set(["ui.pack"]);
  cacheApi = await import("../src/vanillaPackFilesCache");
  serializer = await import("../src/packFileSerializer");
};

const cachePath = () => path.join(userDataPath, cacheFileName);

const makePack = async () => {
  await writeRawPack(
    packPath,
    [
      { name: "ui\\z-last.png", buffer: Buffer.from("z"), file_name_hash: 0x11111111 },
      { name: "ui\\a-first.png", buffer: Buffer.from("a"), file_name_hash: 0x22222222, is_compressed: true },
      { name: "ui\\middle.png", buffer: Buffer.from("m"), file_name_hash: 0x33333333 },
    ],
    metadata,
  );
};

const seedValidCache = async () => {
  await serializer.readPack(packPath, { skipParsingTables: true });
  await cacheApi.saveVanillaPackFilesCache();
  return readFile(cachePath());
};

const expectLiveIndexShape = (pack: Awaited<ReturnType<typeof serializer.readPack>>) => {
  const indexed = readPackIndex(packPath, { game: "wh3" });
  const expectedFiles = indexed.entries
    .map((entry) => ({
      name: entry.name,
      file_size: entry.file_size,
      start_pos: entry.start_pos,
      is_compressed: entry.is_compressed,
      ...(entry.file_name_hash === undefined ? {} : { file_name_hash: entry.file_name_hash }),
    }))
    .sort((first, second) => collator.compare(first.name, second.name));
  expect(pack.packedFiles).toEqual(expectedFiles);
  expect(pack.packHeader).toEqual({
    header: indexed.header.signature,
    byteMask: indexed.header.byteMask,
    refFileCount: indexed.header.refFileCount,
    pack_file_index_size: indexed.header.dependencyIndexSize,
    pack_file_count: indexed.header.fileCount,
    packed_file_index_size: indexed.header.fileIndexSize,
    header_buffer: indexed.header.headerBuffer,
  });
  expect(pack.dependencyPacks).toEqual(indexed.dependencies);
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "whmm-pack-index-policy-"));
  dataFolder = path.join(root, "data");
  userDataPath = path.join(root, "userData");
  packPath = path.join(dataFolder, "ui.pack");
  cacheState.userDataPath = userDataPath;
  await Promise.all([mkdir(dataFolder, { recursive: true }), mkdir(userDataPath, { recursive: true })]);
  await makePack();
  await loadRuntimeModules();
});

afterEach(async () => {
  await cacheApi?.saveVanillaPackFilesCache();
  await rm(root, { recursive: true, force: true });
  cacheState.userDataPath = "";
});

describe("readPack skipVanillaIndexCache policy", () => {
  it("reads the live index with all fields and does not create the vanilla cache", async () => {
    const bypassed = await serializer.readPack(packPath, {
      skipParsingTables: true,
      skipVanillaIndexCache: true,
    });

    expectLiveIndexShape(bypassed);
    expect(cacheState.decompressCount).toBe(0);
    await cacheApi.saveVanillaPackFilesCache();
    await expect(readFile(cachePath())).rejects.toMatchObject({ code: "ENOENT" });

    const defaultRead = await serializer.readPack(packPath, { skipParsingTables: true });
    expectLiveIndexShape(defaultRead);
    await cacheApi.saveVanillaPackFilesCache();
    expect((await readFile(cachePath())).subarray(0, 4).toString("ascii")).toBe("WVFC");
  });

  it("ignores an existing valid cache and leaves it unchanged", async () => {
    const seeded = await seedValidCache();
    await loadRuntimeModules();

    const bypassed = await serializer.readPack(packPath, {
      skipParsingTables: true,
      skipVanillaIndexCache: true,
    });

    expectLiveIndexShape(bypassed);
    expect(cacheState.decompressCount).toBe(0);
    expect(await readFile(cachePath())).toEqual(seeded);
    await cacheApi.saveVanillaPackFilesCache();
    expect(await readFile(cachePath())).toEqual(seeded);
  });

  it("ignores a corrupt cache without trying to decode or rewrite it", async () => {
    const corrupt = Buffer.from("corrupt WVFC fixture");
    await writeFile(cachePath(), corrupt);
    await loadRuntimeModules();

    const bypassed = await serializer.readPack(packPath, {
      skipParsingTables: true,
      skipVanillaIndexCache: true,
    });

    expectLiveIndexShape(bypassed);
    expect(cacheState.decompressCount).toBe(0);
    expect(await readFile(cachePath())).toEqual(corrupt);
    await cacheApi.saveVanillaPackFilesCache();
    expect(await readFile(cachePath())).toEqual(corrupt);
  });

  it("uses and updates the vanilla cache by default", async () => {
    const liveRead = await serializer.readPack(packPath, { skipParsingTables: true });
    await cacheApi.saveVanillaPackFilesCache();
    expectLiveIndexShape(liveRead);
    const seeded = await readFile(cachePath());
    expect(seeded.subarray(0, 4).toString("ascii")).toBe("WVFC");

    await loadRuntimeModules();
    const cachedRead = await serializer.readPack(packPath, { skipParsingTables: true });

    expect(cacheState.decompressCount).toBe(1);
    expect(cachedRead.packedFiles.map((file) => file.name)).toEqual(liveRead.packedFiles.map((file) => file.name));
    expect(cachedRead.dependencyPacks).toEqual(liveRead.dependencyPacks);
  });
});
