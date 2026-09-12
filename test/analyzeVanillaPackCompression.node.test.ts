import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as nodePath from "node:path";
import { tmpdir } from "node:os";
import * as zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../scripts/analyze-vanilla-pack-compression.mjs";

const require = createRequire(import.meta.url);
const lz4 = require("lz4-napi") as { compressFrameSync: (data: Buffer) => Buffer };
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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("vanilla compression report", () => {
  it("writes per-file rigid-model data and grouped pattern summaries", async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "whmm-vanilla-compression-"));
    temporaryDirectories.push(directory);
    const original = Buffer.alloc(8192, 7);
    const zstd = zlib.zstdCompressSync(original);
    const lz4Frame = lz4.compressFrameSync(original);
    const packPath = nodePath.join(directory, "vanilla.pack");
    await writeFile(nodePath.join(directory, "manifest.txt"), "vanilla.pack\tPFH5\n");
    await writeFile(
      packPath,
      makePFH5Pack([
        { name: "variantmeshes\\wh_variantmodels\\emp\\plain.rigid_model_v2", data: original },
        { name: "variantmeshes\\wh_variantmodels\\emp\\lz4.rigid_model_v2", data: lz4Frame, compressed: true },
        { name: "variantmeshes\\wh_variantmodels\\chs\\zstd.rigid_model_v2", data: zstd, compressed: true },
      ]),
    );

    const aggregatePath = nodePath.join(directory, "aggregate.csv");
    const filesPath = nodePath.join(directory, "rigid-files.csv");
    const summaryPath = nodePath.join(directory, "rigid-summary.csv");
    main([directory, aggregatePath, "--rigid-report", filesPath, "--rigid-summary", summaryPath]);
    expect(await readFile(aggregatePath, "utf8")).toContain(".rigid_model_v2,3,1,33.33,1,33.33,1,33.33,0,0.00");

    const rigidFiles = await readFile(filesPath, "utf8");
    expect(rigidFiles).toContain("pack_name,file_number,file_name");
    expect(rigidFiles).toContain(",lz4.rigid_model_v2,");
    expect(rigidFiles).toMatch(/lz4\.rigid_model_v2,[^\n]*,LZ4,0,8192,decompressed-payload,[^\n]*,.*?,ok,/);
    expect(rigidFiles).toMatch(/zstd\.rigid_model_v2,[^\n]*,ZSTD,0,8192,decompressed-payload,[^\n]*,.*?,ok,/);

    const rigidSummary = await readFile(summaryPath, "utf8");
    expect(rigidSummary).toContain("group_type,group,total_files");
    expect(rigidSummary).toContain("pack,vanilla.pack,3,1,33.33,1,33.33,1,33.33");
    expect(rigidSummary).toContain("original_size_bucket,8 KiB-<16 KiB,3,1,33.33,1,33.33,1,33.33");
    expect(rigidSummary).toContain("directory_depth_3,variantmeshes\\wh_variantmodels\\emp");
  });
});
