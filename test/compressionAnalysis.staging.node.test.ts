import * as fs from "node:fs/promises";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyzeCompressionPacks,
  parsePFH5PackBuffer,
  type CompressionCodecs,
} from "../src/compressionAnalysis/analyzer";
import { compressStagedPack } from "../src/compressionAnalysis/stagingCompressor";

const temporaryDirectories: string[] = [];

interface TestPackEntry {
  name: string;
  data: Buffer;
  compressed?: boolean;
}

const makePFH5Pack = (entries: TestPackEntry[]): Buffer => {
  const indexParts: Buffer[] = [];
  for (const entry of entries) {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(entry.data.length);
    indexParts.push(size, Buffer.from([entry.compressed ? 1 : 0]), Buffer.from(`${entry.name}\0`, "utf8"));
  }
  const index = Buffer.concat(indexParts);
  const header = Buffer.alloc(28);
  header.write("PFH5", 0, "ascii");
  header.writeUInt32LE(entries.length, 16);
  header.writeUInt32LE(index.length, 20);
  return Buffer.concat([header, index, ...entries.map((entry) => entry.data)]);
};

const makeFakeCodecs = (ratio: number) => {
  const originals = new Map<string, Buffer>();
  const make = (codec: "LZ4" | "ZSTD") => {
    const compress = vi.fn((data: Buffer) => {
      const compressed = Buffer.alloc(Math.max(1, Math.ceil(data.length * ratio)), codec === "LZ4" ? 0x4c : 0x5a);
      originals.set(`${codec}:${compressed.toString("hex")}`, Buffer.from(data));
      return compressed;
    });
    const decompress = vi.fn((data: Buffer) => {
      const original = originals.get(`${codec}:${data.toString("hex")}`);
      if (!original) throw new Error(`${codec} frame missing`);
      return original;
    });
    return { compress, decompress };
  };
  const lz4 = make("LZ4");
  const zstd = make("ZSTD");
  return {
    codecs: {
      lz4Compress: lz4.compress,
      lz4Decompress: lz4.decompress,
      zstdCompress: zstd.compress,
      zstdDecompress: zstd.decompress,
    } satisfies CompressionCodecs,
    calls: { lz4, zstd },
  };
};

const makeDirectory = async () => {
  const directory = await fs.mkdtemp(nodePath.join(tmpdir(), "whmm-staging-compression-"));
  temporaryDirectories.push(directory);
  return directory;
};

const writePack = async (directory: string, name: string, pack: Buffer) => {
  const packPath = nodePath.join(directory, name);
  await fs.writeFile(packPath, pack);
  return packPath;
};

const analyze = async (packPath: string, codecs: CompressionCodecs) => {
  const result = await analyzeCompressionPacks([packPath], {
    codecs,
    vanillaRecords: new Map(),
  });
  expect(result.packs[0]?.success).toBe(true);
  return result.packs[0];
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("staged PFH5 compression", () => {
  it("compresses only the staged destination and does not create a persistent backup", async () => {
    const root = await makeDirectory();
    const sourceDirectory = nodePath.join(root, "workshop");
    const stagingDirectory = nodePath.join(root, "whmm_copied_mods");
    await fs.mkdir(sourceDirectory);
    await fs.mkdir(stagingDirectory);
    const originalPayload = Buffer.alloc(8192, 7);
    const originalPack = makePFH5Pack([{ name: "db\\compressible.foo", data: originalPayload }]);
    const sourcePath = await writePack(sourceDirectory, "alpha.pack", originalPack);
    const stagedPath = await writePack(stagingDirectory, "alpha.pack", originalPack);
    const fake = makeFakeCodecs(0.5);

    const analysis = await analyze(stagedPath, fake.codecs);
    const result = await compressStagedPack(stagedPath, analysis, { codecs: fake.codecs });

    expect(result).toMatchObject({ status: "compressed", success: true, compressedFileCount: 1 });
    expect(await fs.readFile(sourcePath)).toEqual(originalPack);
    await expect(fs.stat(nodePath.join(root, "whmm_backups"))).rejects.toMatchObject({ code: "ENOENT" });

    const rewritten = await fs.readFile(stagedPath);
    const parsed = parsePFH5PackBuffer(rewritten, stagedPath);
    expect(parsed.entries[0].isCompressed).toBe(true);
    const compressedPayload = rewritten.subarray(parsed.entries[0].payloadOffset);
    expect(await fake.codecs.lz4Decompress(compressedPayload)).toEqual(originalPayload);
  });

  it("reports an already-compressed/no-eligible destination without changing it", async () => {
    const root = await makeDirectory();
    const stagedPath = await writePack(
      root,
      "already.pack",
      makePFH5Pack([{ name: "db\\already.foo", data: Buffer.from("existing-frame"), compressed: true }]),
    );
    const before = await fs.readFile(stagedPath);
    const fake = makeFakeCodecs(0.5);
    const analysis = await analyze(stagedPath, fake.codecs);

    const result = await compressStagedPack(stagedPath, analysis, { codecs: fake.codecs });

    expect(result).toMatchObject({ status: "noEligibleFiles", success: true, compressedFileCount: 0 });
    expect(await fs.readFile(stagedPath)).toEqual(before);
    expect(fake.calls.lz4.compress).not.toHaveBeenCalled();
    expect(fake.calls.zstd.compress).not.toHaveBeenCalled();
  });

  it("reports codec failures and leaves both staged and Workshop files unchanged", async () => {
    const root = await makeDirectory();
    const sourceDirectory = nodePath.join(root, "workshop");
    await fs.mkdir(sourceDirectory);
    const originalPack = makePFH5Pack([{ name: "db\\compressible.foo", data: Buffer.alloc(8192, 3) }]);
    const sourcePath = await writePack(sourceDirectory, "alpha.pack", originalPack);
    const stagedPath = await writePack(root, "alpha.pack", originalPack);
    const fake = makeFakeCodecs(0.5);
    const analysis = await analyze(stagedPath, fake.codecs);
    const failingCodecs: CompressionCodecs = {
      ...fake.codecs,
      lz4Compress: vi.fn(() => {
        throw new Error("codec unavailable");
      }),
    };

    const result = await compressStagedPack(stagedPath, analysis, { codecs: failingCodecs });

    expect(result.status).toBe("failed");
    expect(result.success).toBe(false);
    expect(result.error).toContain("codec unavailable");
    expect(await fs.readFile(stagedPath)).toEqual(originalPack);
    expect(await fs.readFile(sourcePath)).toEqual(originalPack);
  });

  it("restores the exact uncompressed staged pack when replacement fails", async () => {
    const root = await makeDirectory();
    const originalPack = makePFH5Pack([{ name: "db\\compressible.foo", data: Buffer.alloc(8192, 4) }]);
    const stagedPath = await writePack(root, "alpha.pack", originalPack);
    const fake = makeFakeCodecs(0.5);
    const analysis = await analyze(stagedPath, fake.codecs);
    const realRename = nodeFs.promises.rename.bind(nodeFs.promises);
    let renameCount = 0;
    vi.spyOn(nodeFs.promises, "rename").mockImplementation(async (oldPath, newPath) => {
      renameCount++;
      if (renameCount === 2) throw new Error("replacement blocked");
      return realRename(oldPath, newPath);
    });

    const result = await compressStagedPack(stagedPath, analysis, { codecs: fake.codecs });

    expect(result).toMatchObject({ status: "failed", success: false });
    expect(result.error).toContain("replacement blocked");
    expect(await fs.readFile(stagedPath)).toEqual(originalPack);
    expect((await fs.readdir(root)).filter((name) => name.includes("whmm-staging-rollback"))).toEqual([]);
  });

  it("uses a copy fallback when rollback rename fails", async () => {
    const root = await makeDirectory();
    const originalPack = makePFH5Pack([{ name: "db\\compressible.foo", data: Buffer.alloc(8192, 5) }]);
    const stagedPath = await writePack(root, "alpha.pack", originalPack);
    const fake = makeFakeCodecs(0.5);
    const analysis = await analyze(stagedPath, fake.codecs);
    const realRename = nodeFs.promises.rename.bind(nodeFs.promises);
    let renameCount = 0;
    vi.spyOn(nodeFs.promises, "rename").mockImplementation(async (oldPath, newPath) => {
      renameCount++;
      if (renameCount === 2 || renameCount === 3) throw new Error("rename blocked");
      return realRename(oldPath, newPath);
    });

    const result = await compressStagedPack(stagedPath, analysis, { codecs: fake.codecs });

    expect(result).toMatchObject({ status: "failed", success: false });
    expect(result.error).toContain("rename blocked");
    expect(await fs.readFile(stagedPath)).toEqual(originalPack);
    expect((await fs.readdir(root)).filter((name) => name.includes("whmm-staging-rollback"))).toEqual([]);
  });

  it("honors cancellation during staged compression and cleans temporary artifacts", async () => {
    const root = await makeDirectory();
    const originalPack = makePFH5Pack([{ name: "db\\compressible.foo", data: Buffer.alloc(8192, 6) }]);
    const stagedPath = await writePack(root, "alpha.pack", originalPack);
    const fake = makeFakeCodecs(0.5);
    const analysis = await analyze(stagedPath, fake.codecs);
    const controller = new AbortController();
    const cancelingCodecs: CompressionCodecs = {
      ...fake.codecs,
      lz4Compress: vi.fn(async (data: Buffer) => {
        controller.abort();
        return fake.codecs.lz4Compress(data);
      }),
    };

    await expect(
      compressStagedPack(stagedPath, analysis, { codecs: cancelingCodecs, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await fs.readFile(stagedPath)).toEqual(originalPack);
    expect((await fs.readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
