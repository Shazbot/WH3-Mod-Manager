import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as nodePath from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeCompressionPacks,
  detectCompressionMethod,
  LZ4_FRAME_MAGIC,
  parsePFH5PackBuffer,
  ZSTD_FRAME_MAGIC,
} from "../src/compressionAnalysis/analyzer";
import {
  chooseCompressionCodec,
  getCompressionEligibilityThreshold,
  ZSTD_COMPRESSION_LEVEL,
} from "../src/compressionAnalysis/policy";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

interface TestPackEntry {
  name: string;
  data: Buffer;
  compressed?: boolean;
}

const makePFH5Pack = (entries: TestPackEntry[], hashed = false): Buffer => {
  const indexParts: Buffer[] = [];
  for (const [index, entry] of entries.entries()) {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(entry.data.length);
    indexParts.push(size);
    if (hashed) {
      const hash = Buffer.alloc(4);
      hash.writeUInt32LE(index + 100);
      indexParts.push(hash);
    }
    indexParts.push(Buffer.from([entry.compressed ? 1 : 0]));
    indexParts.push(Buffer.from(`${entry.name}\0`, "utf8"));
  }
  const index = Buffer.concat(indexParts);
  const header = Buffer.alloc(28);
  header.write("PFH5", 0, "ascii");
  header.writeUInt32LE(hashed ? 0x40 : 0, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(entries.length, 16);
  header.writeUInt32LE(index.length, 20);
  header.writeUInt32LE(0x7fffffff, 24);
  return Buffer.concat([header, index, ...entries.map((entry) => entry.data)]);
};

const makeFakeCodecs = (lz4Ratio: number, zstdRatio: number, fail?: Partial<Record<"LZ4" | "ZSTD", boolean>>) => {
  const originals = new Map<string, Buffer>();
  const make = (codec: "LZ4" | "ZSTD", ratio: number) => {
    const compress = vi.fn((data: Buffer) => {
      if (fail?.[codec]) throw new Error(`${codec} failed`);
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
  const lz4 = make("LZ4", lz4Ratio);
  const zstd = make("ZSTD", zstdRatio);
  return {
    codecs: {
      lz4Compress: lz4.compress,
      lz4Decompress: lz4.decompress,
      zstdCompress: zstd.compress,
      zstdDecompress: zstd.decompress,
    },
    calls: { lz4, zstd },
  };
};

const writeTempPack = async (directory: string, name: string, pack: Buffer): Promise<string> => {
  const packPath = nodePath.join(directory, name);
  await writeFile(packPath, pack);
  return packPath;
};

describe("compression policy", () => {
  it("uses the strict size bands and codec tie-break", () => {
    expect(ZSTD_COMPRESSION_LEVEL).toBe(3);
    expect(getCompressionEligibilityThreshold(4095)).toBeUndefined();
    expect(getCompressionEligibilityThreshold(4096)).toBe(85);
    expect(getCompressionEligibilityThreshold(64 * 1024)).toBe(92);
    expect(getCompressionEligibilityThreshold(1024 * 1024)).toBe(95);
    expect(getCompressionEligibilityThreshold(100 * 1024 * 1024)).toBe(95);
    expect(getCompressionEligibilityThreshold(100 * 1024 * 1024 + 1)).toBe(97);
    expect(
      chooseCompressionCodec(8192, {
        LZ4: { codec: "LZ4", ratioPercent: 80 },
        ZSTD: { codec: "ZSTD", ratioPercent: 70 },
      }),
    ).toBe("ZSTD");
    expect(
      chooseCompressionCodec(8192, {
        LZ4: { codec: "LZ4", ratioPercent: 80 },
        ZSTD: { codec: "ZSTD", ratioPercent: 71 },
      }),
    ).toBe("LZ4");
    expect(
      chooseCompressionCodec(8192, {
        LZ4: { codec: "LZ4", ratioPercent: 80 },
        ZSTD: { codec: "ZSTD", ratioPercent: 70, error: "failed" },
      }),
    ).toBe("LZ4");
  });
});

describe("PFH5 compression analysis", () => {
  it("reads hashed indexes, existing methods, deduplicates paths, and computes top wins", async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "whmm-compression-"));
    tempDirectories.push(directory);
    const pack = makePFH5Pack(
      [
        { name: "db\\good.foo", data: Buffer.alloc(8192, 1) },
        { name: "audio\\song.wem", data: Buffer.alloc(8192, 2) },
        { name: "models\\already_lz4.foo", data: Buffer.concat([LZ4_FRAME_MAGIC, Buffer.alloc(12)]), compressed: true },
        {
          name: "models\\already_zstd.foo",
          data: Buffer.concat([ZSTD_FRAME_MAGIC, Buffer.alloc(12)]),
          compressed: true,
        },
        { name: "misc\\unknown.foo", data: Buffer.alloc(4), compressed: true },
      ],
      true,
    );
    const packPath = await writeTempPack(directory, "hashed.pack", pack);
    const parsed = parsePFH5PackBuffer(pack, packPath);
    expect(parsed.entries.map((entry) => entry.name)).toEqual([
      "db\\good.foo",
      "audio\\song.wem",
      "models\\already_lz4.foo",
      "models\\already_zstd.foo",
      "misc\\unknown.foo",
    ]);
    expect(detectCompressionMethod(LZ4_FRAME_MAGIC)).toBe("LZ4");
    expect(detectCompressionMethod(ZSTD_FRAME_MAGIC)).toBe("ZSTD");

    const fake = makeFakeCodecs(0.82, 0.7);
    const result = await analyzeCompressionPacks([packPath, packPath], {
      codecs: fake.codecs,
      vanillaCsv: [
        "extension,total_files,NONE_count,NONE_percent,LZ4_count,LZ4_percent,ZSTD_count,ZSTD_percent,UNKNOWN_count,UNKNOWN_percent",
        ".wem,1,1,100,0,0,0,0,0,0",
      ].join("\n"),
    });
    expect(result.requestedPackCount).toBe(2);
    expect(result.packs).toHaveLength(1);
    const analyzed = result.packs[0];
    expect(analyzed.existingCounts).toEqual({ NONE: 2, LZ4: 1, ZSTD: 1, UNKNOWN: 1 });
    expect(analyzed.existingStoredBytes.LZ4).toBe(16);
    expect(analyzed.acceptedCount).toBe(1);
    expect(analyzed.topWins[0].selectedCodec).toBe("ZSTD");
    expect(analyzed.skippedCount).toBe(4);
    expect(fake.calls.lz4.compress).toHaveBeenCalledTimes(1);
    expect(fake.calls.zstd.compress).toHaveBeenCalledTimes(1);
  });

  it("continues after malformed packs and codec failures", async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "whmm-compression-"));
    tempDirectories.push(directory);
    const goodPath = await writeTempPack(
      directory,
      "good.pack",
      makePFH5Pack([{ name: "good.foo", data: Buffer.alloc(8192) }]),
    );
    const badPath = await writeTempPack(directory, "bad.pack", Buffer.from("PFH5"));
    const fake = makeFakeCodecs(0.8, 0.8, { ZSTD: true });
    const result = await analyzeCompressionPacks([badPath, goodPath], {
      codecs: fake.codecs,
      vanillaCsv: "extension,total_files,NONE_count,NONE_percent\n.bar,1,0,0",
    });
    expect(result.packs.map((pack) => pack.packName)).toEqual(["bad.pack", "good.pack"]);
    expect(result.packs[0].success).toBe(false);
    expect(result.packs[1].success).toBe(true);
    expect(result.overall.analyzedPackCount).toBe(1);
    expect(result.packs[1].acceptedCount).toBe(1);
    expect(result.packs[1].topWins[0].selectedCodec).toBe("LZ4");
    expect(result.packs[1].topWins[0].warning).toContain("ZSTD");
  });

  it("counts threshold misses as skipped", async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "whmm-compression-"));
    tempDirectories.push(directory);
    const packPath = await writeTempPack(
      directory,
      "threshold-miss.pack",
      makePFH5Pack([{ name: "poor.foo", data: Buffer.alloc(8192) }]),
    );
    const fake = makeFakeCodecs(0.9, 0.9);
    const result = await analyzeCompressionPacks([packPath], {
      codecs: fake.codecs,
      vanillaRecords: new Map(),
    });
    const analyzed = result.packs[0];
    expect(analyzed.fileResults[0].skipReason).toBe("compressionThresholdNotMet");
    expect(analyzed.skippedCount).toBe(1);
    expect(analyzed.errorCount).toBe(0);
  });

  it("ignores .rpfm_reserved files", async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "whmm-compression-"));
    tempDirectories.push(directory);
    const packPath = await writeTempPack(
      directory,
      "reserved.pack",
      makePFH5Pack([{ name: "db\\table.rpfm_reserved", data: Buffer.alloc(8192) }]),
    );
    const fake = makeFakeCodecs(0.5, 0.5);
    const result = await analyzeCompressionPacks([packPath], {
      codecs: fake.codecs,
      vanillaRecords: new Map(),
    });
    const analyzed = result.packs[0];
    expect(analyzed.fileResults[0].skipReason).toBe("guardrailNeverCompress");
    expect(analyzed.testedCount).toBe(0);
    expect(analyzed.skippedCount).toBe(1);
    expect(analyzed.bytesSaved).toBe(0);
    expect(analyzed.fileResults[0].warning).toBeUndefined();
    expect(analyzed.warnings).not.toContain("No vanilla compression precedent for extension .rpfm_reserved");
    expect(fake.calls.lz4.compress).not.toHaveBeenCalled();
    expect(fake.calls.zstd.compress).not.toHaveBeenCalled();
  });

  it("keeps rigid_model_v2 savings out of the primary totals", async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "whmm-compression-"));
    tempDirectories.push(directory);
    const packPath = await writeTempPack(
      directory,
      "rigid.pack",
      makePFH5Pack([{ name: "variantmeshes\\unit.rigid_model_v2", data: Buffer.alloc(8192) }]),
    );
    const fake = makeFakeCodecs(0.8, 0.5);
    const result = await analyzeCompressionPacks([packPath], {
      codecs: fake.codecs,
      vanillaRecords: new Map([
        [
          ".rigid_model_v2",
          {
            extension: ".rigid_model_v2",
            totalFiles: 1,
            counts: { NONE: 0, LZ4: 1, ZSTD: 0, UNKNOWN: 0 },
            percentages: { NONE: 0, LZ4: 100, ZSTD: 0, UNKNOWN: 0 },
          },
        ],
      ]),
    });
    expect(result.packs[0].acceptedCount).toBe(0);
    expect(result.packs[0].rigidModelV2Wins).toHaveLength(1);
    expect(result.packs[0].bytesSaved).toBe(0);
    expect(result.packs[0].projectedSizeIncludingRigidModelV2).toBeLessThan(result.packs[0].currentSize);
    expect(fake.calls.zstd.compress).not.toHaveBeenCalled();
  });

  it("limits displayed wins to ten without dropping additional savings from totals", async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "whmm-compression-"));
    tempDirectories.push(directory);
    const entries = Array.from({ length: 12 }, (_, index) => ({
      name: `files\\win_${String(index).padStart(2, "0")}.foo`,
      data: Buffer.alloc(8192, index),
    }));
    const packPath = await writeTempPack(directory, "many-wins.pack", makePFH5Pack(entries));
    const fake = makeFakeCodecs(0.8, 0.8);
    const result = await analyzeCompressionPacks([packPath], {
      codecs: fake.codecs,
      vanillaRecords: new Map(),
    });
    const analyzed = result.packs[0];
    const savingsPerFile = 8192 - Math.ceil(8192 * 0.8);
    expect(analyzed.acceptedCount).toBe(12);
    expect(analyzed.topWins).toHaveLength(10);
    expect(analyzed.bytesSaved).toBe(savingsPerFile * 12);
    expect(analyzed.projectedSize).toBe(analyzed.currentSize - savingsPerFile * 12);
  });

  it("rejects a large file from three samples without claiming exact savings", async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "whmm-compression-"));
    tempDirectories.push(directory);
    const data = makePFH5Pack([{ name: "large.foo", data: Buffer.alloc(100 * 1024 * 1024 + 1) }]);
    const packPath = await writeTempPack(directory, "large.pack", data);
    const fake = makeFakeCodecs(1, 1);
    const result = await analyzeCompressionPacks([packPath], { codecs: fake.codecs, vanillaRecords: new Map() });
    const file = result.packs[0].fileResults[0];
    expect(file.status).toBe("sampled-rejected");
    expect(file.savingsBytes).toBeUndefined();
    expect(result.packs[0].sampledRejectedCount).toBe(1);
    expect(fake.calls.lz4.compress).toHaveBeenCalledTimes(3);
    expect(fake.calls.zstd.compress).toHaveBeenCalledTimes(3);
  }, 30000);

  it("reports cancellation and progress without modifying the pack", async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "whmm-compression-"));
    tempDirectories.push(directory);
    const packPath = await writeTempPack(
      directory,
      "cancel.pack",
      makePFH5Pack([
        { name: "one.foo", data: Buffer.alloc(8192) },
        { name: "two.foo", data: Buffer.alloc(8192) },
      ]),
    );
    const before = await readFile(packPath);
    const progress: string[] = [];
    let canceled = false;
    const fake = makeFakeCodecs(0.8, 0.8);
    const result = await analyzeCompressionPacks([packPath], {
      codecs: fake.codecs,
      vanillaRecords: new Map(),
      onProgress: (item) => {
        progress.push(item.phase);
        if (item.phase === "file" && item.fileIndex === 0) canceled = true;
      },
      isCanceled: () => canceled,
    });
    expect(result.status).toBe("canceled");
    expect(progress).toContain("file");
    expect(progress.at(-1)).toBe("canceled");
    expect(await readFile(packPath)).toEqual(before);
  });
});
