import { deflateRawSync, deflateSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { main } from "../../src/cli/main";
import { writeRawPack, type RawPackWriteEntry } from "../../src/packCore";

const root = mkdtempSync(path.join(os.tmpdir(), "whmm-diff-validate-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const metadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
  dependencies: [] as string[],
};

const writePack = (name: string, entries: RawPackWriteEntry[]) => {
  const packPath = path.join(root, name);
  return writeRawPack(packPath, entries, metadata).then(() => packPath);
};

const makeDds = (
  options: {
    width?: number;
    height?: number;
    mipCount?: number;
    surfaces?: number;
    format?: "BC1" | "BC3" | "BC4" | "BC7";
    blocks?: Buffer[];
  } = {},
) => {
  const width = options.width ?? 8;
  const height = options.height ?? 4;
  const mipCount = options.mipCount ?? 1;
  const surfaces = options.surfaces ?? 1;
  const format = options.format ?? "BC1";
  const blockBytes = format === "BC1" || format === "BC4" ? 8 : format === "BC7" ? 16 : 16;
  const dxgi = format === "BC1" ? 71 : format === "BC3" ? 77 : format === "BC4" ? 80 : 98;
  const headerBytes = format === "BC1" ? 128 : 148;
  const dataSize = Array.from({ length: mipCount }).reduce((size, _, mipLevel) => {
    const mipWidth = Math.max(1, Math.floor(width / 2 ** mipLevel));
    const mipHeight = Math.max(1, Math.floor(height / 2 ** mipLevel));
    const blocks = Math.ceil(mipWidth / 4) * Math.ceil(mipHeight / 4);
    return size + blocks * blockBytes * surfaces;
  }, 0);
  const buffer = Buffer.alloc(headerBytes + dataSize);
  buffer.write("DDS ", 0, "ascii");
  buffer.writeUInt32LE(124, 4);
  buffer.writeUInt32LE(height, 12);
  buffer.writeUInt32LE(width, 16);
  buffer.writeUInt32LE(mipCount, 28);
  buffer.writeUInt32LE(32, 76);
  buffer.writeUInt32LE(4, 80);
  buffer.write(format === "BC1" ? "DXT1" : "DX10", 84, "ascii");
  if (format !== "BC1") {
    buffer.writeUInt32LE(dxgi, 128);
    buffer.writeUInt32LE(3, 132);
    buffer.writeUInt32LE(surfaces, 140);
  }
  let offset = headerBytes;
  let blockIndex = 0;
  for (let surface = 0; surface < surfaces; surface += 1) {
    for (let mipLevel = 0; mipLevel < mipCount; mipLevel += 1) {
      const mipWidth = Math.max(1, Math.floor(width / 2 ** mipLevel));
      const mipHeight = Math.max(1, Math.floor(height / 2 ** mipLevel));
      const blockCount = Math.ceil(mipWidth / 4) * Math.ceil(mipHeight / 4);
      for (let block = 0; block < blockCount; block += 1) {
        const output = buffer.subarray(offset, offset + blockBytes);
        if (options.blocks?.[blockIndex]) options.blocks[blockIndex].copy(output);
        else if (format === "BC1") {
          output.writeUInt16LE(0xf800, 0);
          output.writeUInt16LE(0x07e0, 2);
        } else if (format === "BC7") {
          Buffer.from("c0ff1f000000fe7f0000000000000000", "hex").copy(output);
        }
        offset += blockBytes;
        blockIndex += 1;
      }
    }
  }
  return buffer;
};

const expectData = <T>(response: Awaited<ReturnType<typeof executeAutomationRequest>>): T => {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.data as T;
};

describe("pack diff moves and DDS details", () => {
  it("pairs exact logical moves deterministically, flags duplicate candidates, and preserves --no-moves output", async () => {
    const logicalPayload = Buffer.from("same logical content");
    const beforePath = await writePack("moves-before.pack", [
      { name: "old\\one.bin", buffer: logicalPayload },
      { name: "old\\dup-a.bin", buffer: Buffer.from("duplicate") },
      { name: "old\\dup-b.bin", buffer: Buffer.from("duplicate") },
      { name: "old\\different.bin", buffer: Buffer.from("old") },
      {
        name: "old\\compressed.bin",
        buffer: deflateSync(Buffer.from("compressed logical payload")),
        is_compressed: true,
      },
    ]);
    const afterPath = await writePack("moves-after.pack", [
      { name: "new\\one.bin", buffer: logicalPayload },
      { name: "new\\dup-a.bin", buffer: Buffer.from("duplicate") },
      { name: "new\\dup-b.bin", buffer: Buffer.from("duplicate") },
      { name: "new\\different.bin", buffer: Buffer.from("new") },
      {
        name: "new\\compressed.bin",
        buffer: deflateRawSync(Buffer.from("compressed logical payload")),
        is_compressed: true,
      },
    ]);
    const result = expectData<{
      summary: { added: number; removed: number; movedCount: number; logicalSizeDelta: number };
      files: Array<{ status: string; from?: string; to?: string; ambiguous?: boolean }>;
    }>(await executeAutomationRequest({ operation: "pack_diff", beforePath, afterPath, details: true }));
    expect(result.summary).toMatchObject({ added: 1, removed: 1, movedCount: 4 });
    expect(result.files).toContainEqual(
      expect.objectContaining({ status: "moved", from: "old\\one.bin", to: "new\\one.bin" }),
    );
    expect(result.files.filter((item) => item.ambiguous)).toHaveLength(2);
    expect(result.files).toContainEqual(
      expect.objectContaining({ status: "moved", from: "old\\dup-a.bin", to: "new\\dup-a.bin", ambiguous: true }),
    );
    expect(result.files).toContainEqual(
      expect.objectContaining({ status: "moved", from: "old\\dup-b.bin", to: "new\\dup-b.bin", ambiguous: true }),
    );

    const filtered = expectData<{
      summary: { added: number; removed: number; movedCount: number; logicalSizeDelta: number };
      hasChanges: boolean;
    }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath,
        afterPath,
        pathPrefix: "new",
      }),
    );
    expect(filtered).toMatchObject({
      summary: { added: 5, removed: 0, movedCount: 0, logicalSizeDelta: 67 },
      hasChanges: true,
    });
    const reportPath = path.join(root, "moves-report.json");
    const paged = expectData<{ total: number; files: unknown[] }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath,
        afterPath,
        details: true,
        offset: 1,
        limit: 1,
        reportPath,
      }),
    );
    expect(paged).toMatchObject({ total: 6, offset: 1, limit: 1, files: [expect.any(Object)] });
    expect(JSON.parse(readFileSync(reportPath, "utf8")).files).toHaveLength(6);

    const oldShape = expectData<{ summary: Record<string, number>; files: Array<{ status: string }> }>(
      await executeAutomationRequest({ operation: "pack_diff", beforePath, afterPath, detectMoves: false }),
    );
    expect(oldShape.summary).toMatchObject({ added: 5, removed: 5 });
    expect(oldShape.summary).not.toHaveProperty("movedCount");
    expect(oldShape.files.some((item) => item.status === "moved")).toBe(false);

    const cliOutput: string[] = [];
    const exitCode = await main(["pack", "diff", beforePath, afterPath, "--no-moves", "--format", "json"], {
      stdout: (value) => cliOutput.push(value),
      stderr: () => undefined,
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(cliOutput.join(""))).toMatchObject({
      data: { summary: { added: 5, removed: 5 } },
    });
  });

  it("reports zero pixel error for unchanged blocks and partial identity for re-encoded BC1 blocks", async () => {
    const beforeTexture = makeDds({ width: 8, height: 4 });
    const afterTexture = Buffer.concat([beforeTexture, Buffer.from([0xaa])]);
    const unchangedBefore = await writePack("dds-equal-before.pack", [
      { name: "textures\\equal.dds", buffer: beforeTexture },
    ]);
    const unchangedAfter = await writePack("dds-equal-after.pack", [
      { name: "textures\\equal.dds", buffer: afterTexture },
    ]);
    const equal = expectData<{
      files: Array<{
        semantic: { mipComparisonCount: number; recordPreview: Array<{ record: Record<string, unknown> }> };
      }>;
    }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath: unchangedBefore,
        afterPath: unchangedAfter,
        details: true,
      }),
    );
    const equalMip = equal.files[0].semantic.recordPreview[0].record;
    expect(equalMip).toMatchObject({
      differingTexels: 0,
      overall: { maxError: 0, rmse: 0 },
      identicalBlocks: 2,
      totalBlocks: 2,
    });

    const changedBlocks = [
      Buffer.from(beforeTexture.subarray(128, 136)),
      Buffer.from(beforeTexture.subarray(136, 144)),
    ];
    changedBlocks[0].writeUInt16LE(0xe800, 0);
    const changedTexture = makeDds({ width: 8, height: 4, blocks: changedBlocks });
    const changedBefore = await writePack("dds-changed-before.pack", [
      { name: "textures\\changed.dds", buffer: beforeTexture },
    ]);
    const changedAfter = await writePack("dds-changed-after.pack", [
      { name: "textures\\changed.dds", buffer: changedTexture },
    ]);
    const changed = expectData<{
      files: Array<{ semantic: { recordPreview: Array<{ record: Record<string, unknown> }> } }>;
    }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath: changedBefore,
        afterPath: changedAfter,
        details: true,
      }),
    );
    const changedMip = changed.files[0].semantic.recordPreview[0].record;
    expect(changedMip).toMatchObject({ totalBlocks: 2, identicalBlocks: 1 });
    expect((changedMip.overall as { maxError: number }).maxError).toBeGreaterThan(0);

    const bc7Block = Buffer.from("c0ff1f000000fe7f0000000000000000", "hex");
    const changedBc7Block = Buffer.from(bc7Block);
    changedBc7Block[1] ^= 0x10;
    const bc7Before = await writePack("bc7-before.pack", [
      {
        name: "textures\\bc7.dds",
        buffer: makeDds({ width: 8, height: 4, format: "BC7", blocks: [bc7Block, bc7Block] }),
      },
    ]);
    const bc7After = await writePack("bc7-after.pack", [
      {
        name: "textures\\bc7.dds",
        buffer: makeDds({ width: 8, height: 4, format: "BC7", blocks: [changedBc7Block, bc7Block] }),
      },
    ]);
    const bc7 = expectData<{
      files: Array<{ semantic: { recordPreview: Array<{ record: Record<string, unknown> }> } }>;
    }>(
      await executeAutomationRequest({
        operation: "pack_diff",
        beforePath: bc7Before,
        afterPath: bc7After,
        details: true,
      }),
    );
    const bc7Mip = bc7.files[0].semantic.recordPreview[0].record;
    expect(bc7Mip).toMatchObject({ totalBlocks: 2, identicalBlocks: 1 });
    expect((bc7Mip.overall as { maxError: number }).maxError).toBeGreaterThan(0);

    const withoutDetails = expectData<{ files: Array<Record<string, unknown>> }>(
      await executeAutomationRequest({ operation: "pack_diff", beforePath: changedBefore, afterPath: changedAfter }),
    );
    expect(withoutDetails.files[0]).not.toHaveProperty("semantic");
  });

  it("reports format and dimension skips, unsupported formats, array mips, paging, and full reports", async () => {
    const bc3 = makeDds({ width: 4, height: 4, format: "BC3" });
    const bc1 = makeDds({ width: 4, height: 4, format: "BC1" });
    const beforePath = await writePack("dds-headers-before.pack", [
      { name: "format.dds", buffer: bc3 },
      { name: "size.dds", buffer: makeDds({ width: 4, height: 4 }) },
      { name: "unsupported.dds", buffer: makeDds({ width: 4, height: 4, format: "BC4" }) },
      { name: "array.dds", buffer: makeDds({ width: 8, height: 4, mipCount: 2, surfaces: 2, format: "BC3" }) },
      { name: "array-layout.dds", buffer: makeDds({ width: 4, height: 4, format: "BC3" }) },
      { name: "truncated.dds", buffer: makeDds({ width: 8, height: 4, mipCount: 2 }) },
      { name: "malformed.dds", buffer: Buffer.from("DDS before") },
    ]);
    const reportPath = path.join(root, "dds-report.json");
    const afterPath = await writePack("dds-headers-after.pack", [
      { name: "format.dds", buffer: bc1 },
      { name: "size.dds", buffer: makeDds({ width: 8, height: 4 }) },
      {
        name: "unsupported.dds",
        buffer: makeDds({ width: 4, height: 4, format: "BC4", blocks: [Buffer.alloc(8, 3)] }),
      },
      {
        name: "array.dds",
        buffer: makeDds({
          width: 8,
          height: 4,
          mipCount: 2,
          surfaces: 2,
          format: "BC3",
          blocks: [Buffer.alloc(16, 0xaa)],
        }),
      },
      { name: "array-layout.dds", buffer: makeDds({ width: 4, height: 4, format: "BC3", surfaces: 2 }) },
      { name: "truncated.dds", buffer: makeDds({ width: 8, height: 4, mipCount: 2 }).subarray(0, -8) },
      { name: "malformed.dds", buffer: Buffer.from("DDS after") },
    ]);
    const response = await executeAutomationRequest({
      operation: "pack_diff",
      beforePath,
      afterPath,
      details: true,
      semanticLimit: 1,
      reportPath,
    });
    const result = expectData<{
      files: Array<{
        path: string;
        semantic: {
          type: string;
          pixelComparison: string;
          complete: boolean;
          totalRecords: number;
          recordPreview: unknown[];
          reason?: string;
          header: { format: { changed: boolean }; width: { changed: boolean } };
          skippedMips?: Array<{ mipLevel: number }>;
        };
      }>;
    }>(response);
    const byPath = new Map(result.files.map((item) => [item.path, item.semantic]));
    expect(byPath.get("format.dds")).toMatchObject({ pixelComparison: "complete", complete: true });
    expect(byPath.get("format.dds")?.header.format.changed).toBe(true);
    expect(byPath.get("size.dds")).toMatchObject({ pixelComparison: "skipped", complete: false });
    expect(byPath.get("unsupported.dds")).toMatchObject({ pixelComparison: "skipped", complete: false });
    expect(byPath.get("size.dds")?.header.width.changed).toBe(true);
    expect(byPath.get("size.dds")?.reason).toContain("equal width and height");
    expect(byPath.get("array-layout.dds")?.reason).toContain("same number of array/cubemap surfaces");
    expect(byPath.get("truncated.dds")?.skippedMips).toContainEqual(expect.objectContaining({ mipLevel: 1 }));
    expect(response).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "DDS_PARSE_FAILED" }),
        expect.objectContaining({ code: "UNSUPPORTED_DDS_PIXEL_COMPARISON" }),
        expect.objectContaining({ code: "DDS_PIXEL_COMPARISON_SKIPPED" }),
        expect.objectContaining({ code: "TRUNCATED_DDS_PIXEL_COMPARISON" }),
      ]),
    });
    expect(result.files.find((item) => item.path === "array.dds")?.semantic).toMatchObject({
      totalRecords: 4,
      recordPreview: [{ kind: "mipComparisons" }],
    });
    expect(readFileSync(reportPath, "utf8")).toContain('"mipComparisonCount": 4');
  });

  it("skips above-cap mips and continues with smaller stored mips", async () => {
    const width = 5_000;
    const height = 4_000;
    const beforeTexture = makeDds({ width, height, mipCount: 2 });
    const changedBlock = Buffer.from(beforeTexture.subarray(128, 136));
    changedBlock.writeUInt16LE(0xe800, 0);
    const afterTexture = makeDds({ width, height, mipCount: 2, blocks: [changedBlock] });
    const beforePath = await writePack("dds-cap-before.pack", [{ name: "cap.dds", buffer: beforeTexture }]);
    const afterPath = await writePack("dds-cap-after.pack", [{ name: "cap.dds", buffer: afterTexture }]);
    const result = expectData<{
      files: Array<{
        semantic: {
          complete: boolean;
          skippedMips: Array<{ mipLevel: number }>;
          recordPreview: Array<{ kind: string; record: { mipLevel: number } }>;
        };
      }>;
    }>(await executeAutomationRequest({ operation: "pack_diff", beforePath, afterPath, details: true }));
    expect(result.files[0].semantic.complete).toBe(false);
    expect(result.files[0].semantic.skippedMips).toContainEqual(expect.objectContaining({ mipLevel: 0 }));
    expect(result.files[0].semantic.recordPreview).toContainEqual(
      expect.objectContaining({ kind: "mipComparisons", record: expect.objectContaining({ mipLevel: 1 }) }),
    );
  });
});

describe("pack validate baseline diagnostics", () => {
  it("multiset-diffs diagnostics, pages additions and resolutions, and writes a complete report", async () => {
    const baselinePath = await writePack("validate-baseline.pack", [
      { name: "unchanged.xml", buffer: Buffer.from("<unchanged>") },
      { name: "resolved.xml", buffer: Buffer.from("<resolved>") },
      { name: "duplicate.xml", buffer: Buffer.from("<duplicate>") },
      { name: "duplicate.xml", buffer: Buffer.from("<duplicate>") },
    ]);
    const targetPath = await writePack("validate-target.pack", [
      { name: "unchanged.xml", buffer: Buffer.from("<unchanged>") },
      { name: "resolved.xml", buffer: Buffer.from("<resolved/>") },
      { name: "added.xml", buffer: Buffer.from("<added>") },
      { name: "duplicate.xml", buffer: Buffer.from("<duplicate>") },
      { name: "duplicate.xml", buffer: Buffer.from("<duplicate>") },
      { name: "duplicate.xml", buffer: Buffer.from("<duplicate>") },
    ]);
    const reportPath = path.join(root, "validate-report.json");
    const response = await executeAutomationRequest(
      {
        operation: "pack_validate",
        packPath: targetPath,
        baselinePackPath: baselinePath,
        fullPayloads: true,
        offset: 0,
        limit: 1,
        reportPath,
        vanillaPackPaths: [targetPath],
        packPaths: [baselinePath],
      },
      createAutomationContext(),
    );
    const data = expectData<{
      valid: boolean;
      validationComplete: boolean;
      diagnostics: Array<{ code: string }>;
      baselineComparison: {
        added: { total: number; items: Array<{ code: string }> };
        resolved: { total: number; items: Array<{ code: string }> };
        unchanged: number;
        perCode: Array<{ code: string; before: number; after: number; delta: number }>;
        regressed: boolean;
      };
    }>(response);
    expect(data).toMatchObject({
      valid: false,
      validationComplete: true,
      textureResolutionPacks: [{ path: targetPath, kind: "mod" }],
      baselineComparison: { added: { total: 3 }, resolved: { total: 1 }, regressed: true },
    });
    expect(data.diagnostics).toEqual(data.baselineComparison.added.items);
    expect(response).toMatchObject({ diagnostics: data.baselineComparison.added.items });
    expect(data.baselineComparison.perCode).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_PACKED_PATH", before: 1, after: 2, delta: 1 }),
    );
    const fullReport = JSON.parse(readFileSync(reportPath, "utf8")) as {
      diagnostics: unknown[];
      baselineComparison: { added: { items: unknown[] }; resolved: { items: unknown[] } };
    };
    expect(fullReport.diagnostics.length).toBeGreaterThan(data.diagnostics.length);
    expect(fullReport.baselineComparison.added.items).toHaveLength(3);
    expect(fullReport.baselineComparison.resolved.items).toHaveLength(1);

    const cliOutput: string[] = [];
    const exitCode = await main(
      [
        "pack",
        "validate",
        targetPath,
        "--baseline",
        baselinePath,
        "--full-payloads",
        "--limit",
        "1",
        "--format",
        "json",
      ],
      { stdout: (value) => cliOutput.push(value), stderr: () => undefined },
    );
    expect(exitCode).toBe(5);
    expect(JSON.parse(cliOutput.join(""))).toMatchObject({
      ok: true,
      data: { valid: false, baselineComparison: { added: { total: 3 }, resolved: { total: 1 }, regressed: true } },
    });

    const beyondPage = expectData<{
      valid: boolean;
      diagnostics: unknown[];
      baselineComparison: { added: { items: unknown[] }; regressed: boolean };
    }>(
      await executeAutomationRequest({
        operation: "pack_validate",
        packPath: targetPath,
        baselinePackPath: baselinePath,
        fullPayloads: true,
        offset: 1000,
        limit: 1,
      }),
    );
    expect(beyondPage).toMatchObject({
      valid: false,
      diagnostics: [],
      baselineComparison: { added: { items: [] }, regressed: true },
    });

    const unchanged = expectData<{
      valid: boolean;
      baselineComparison: {
        added: { total: number };
        resolved: { total: number };
        unchanged: number;
        regressed: boolean;
      };
    }>(
      await executeAutomationRequest({
        operation: "pack_validate",
        packPath: targetPath,
        baselinePackPath: targetPath,
        fullPayloads: true,
      }),
    );
    expect(unchanged).toMatchObject({
      valid: false,
      baselineComparison: { added: { total: 0 }, resolved: { total: 0 }, regressed: false },
    });

    const unchangedCliOutput: string[] = [];
    const unchangedCliCode = await main(
      [
        "pack",
        "validate",
        targetPath,
        "--baseline",
        targetPath,
        "--full-payloads",
        "--offset",
        "1000",
        "--format",
        "json",
      ],
      { stdout: (value) => unchangedCliOutput.push(value), stderr: () => undefined },
    );
    expect(unchangedCliCode).toBe(5);
    expect(JSON.parse(unchangedCliOutput.join(""))).toMatchObject({
      data: { valid: false, diagnostics: [], baselineComparison: { added: { total: 0 }, regressed: false } },
    });
  });

  it("marks new warnings as regressions without changing target validity", async () => {
    const baselinePath = await writePack("warning-baseline.pack", []);
    const unsupportedModel = Buffer.alloc(140);
    unsupportedModel.write("RMV2", 0, "ascii");
    unsupportedModel.writeUInt32LE(9, 4);
    const targetPath = await writePack("warning-target.pack", [
      { name: "models\\unsupported.rigid_model_v2", buffer: unsupportedModel },
    ]);
    const result = expectData<{
      valid: boolean;
      validationComplete: boolean;
      baselineComparison: { added: { total: number; items: Array<{ severity: string }> }; regressed: boolean };
    }>(
      await executeAutomationRequest({
        operation: "pack_validate",
        packPath: targetPath,
        baselinePackPath: baselinePath,
      }),
    );
    expect(result).toMatchObject({
      valid: true,
      validationComplete: false,
      baselineComparison: { added: { total: 1, items: [{ severity: "warning" }] }, regressed: true },
    });
  });
});
