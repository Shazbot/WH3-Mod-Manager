import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { encodeDdsMipAsPng } from "../esfMap/dds";
import { DDS_MAX_PIXELS, inspectDdsLayout } from "../utility/ddsLayout";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { AutomationError, throwIfAborted, yieldToEventLoop, type AutomationDiagnostic } from "./errors";
import { vanillaInputs } from "./vanilla";
import { findAutomationPackEntry, readAutomationPack, readAutomationPayload, readAutomationPayloadPrefix } from "./packAccess";
import { prepareReferenceEnvironment } from "./references";
import type { AutomationContext } from "./operations";

const pageInputs = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(100),
  reportPath: z.string().min(1).optional(),
};

export const packTexturesSchema = z
  .object({
    operation: z.literal("pack_textures"),
    packPath: z.string().min(1),
    packPaths: z.array(z.string().min(1)).max(512).default([]),
    ...vanillaInputs,
    glob: z.string().optional(),
    effective: z.boolean().default(false),
    ...pageInputs,
  })
  .strict();

const textureExtension = (value: string) => value.toLowerCase().endsWith(".dds");
const isPowerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;
const samePhysicalPath = (left: string, right: string) => {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return process.platform === "win32" ? leftPath.toLowerCase() === rightPath.toLowerCase() : leftPath === rightPath;
};

export const runPackTextures = async (request: z.output<typeof packTexturesSchema>, context: AutomationContext) => {
  const target = await readAutomationPack(request.packPath, context);
  const useEffective = request.effective || request.withVanilla || request.gameDataPath !== undefined || (request.vanillaPackPaths?.length ?? 0) > 0 || request.packPaths.length > 0;
  const environment = useEffective
    ? await prepareReferenceEnvironment(
        context,
        [...request.packPaths.filter((candidate) => !samePhysicalPath(candidate, request.packPath)), request.packPath],
        request.vanillaPackPaths,
        request.gameDataPath,
        request.withVanilla,
      )
    : undefined;
  const selected = new Map<string, { entry: (typeof target.entries)[number]; pack: typeof target; role: string; kind: string; status: string }>();
  let selectionComplete = true;
  const diagnostics: AutomationDiagnostic[] = environment?.diagnostics.slice() ?? [];
  if (!environment) {
    for (const entry of target.entries) {
      if (!textureExtension(entry.name)) continue;
      if (request.glob && !path.posix.matchesGlob(entry.name.replace(/\\/g, "/").toLowerCase(), request.glob.replace(/\\/g, "/").toLowerCase())) continue;
      const key = normalizePackFilePathKey(entry.name);
      if (selected.has(key)) {
        selected.get(key)!.status = "ambiguous";
        selectionComplete = false;
        diagnostics.push({ code: "AMBIGUOUS_TEXTURE_PROVIDER", message: "Target pack contains duplicate normalized DDS paths", severity: "warning", path: entry.name });
      } else selected.set(key, { entry, pack: target, role: "target", kind: "mod", status: "effective" });
    }
  } else {
    for (const [key, candidates] of environment.assetCandidates) {
      throwIfAborted(context.signal);
      if (!textureExtension(candidates[0]?.entry.name ?? "")) continue;
      if (request.glob && !path.posix.matchesGlob(candidates[0].entry.name.replace(/\\/g, "/").toLowerCase(), request.glob.replace(/\\/g, "/").toLowerCase())) continue;
      const highest = candidates[candidates.length - 1].provider.order;
      const top = candidates.filter((candidate) => candidate.provider.order === highest);
      if (top.length !== 1) {
        selected.set(key, {
          entry: top[0].entry,
          pack: top[0].provider.pack,
          role: samePhysicalPath(top[0].provider.pack.path, target.path) ? "target" : "support",
          kind: top[0].provider.kind,
          status: "ambiguous",
        });
        continue;
      }
      const winner = top[0];
      selected.set(key, {
        entry: winner.entry,
        pack: winner.provider.pack,
        role: samePhysicalPath(winner.provider.pack.path, target.path) ? "target" : "support",
        kind: winner.provider.kind,
        status: "effective",
      });
    }
  }

  const records: Array<Record<string, unknown>> = [];
  const formatTotals = new Map<string, { files: number; logicalBytes: number; estimatedPayloadBytes: number; unknownEstimates: number }>();
  const dimensions = new Map<string, number>();
  let storedBytes = 0;
  let logicalBytes = 0;
  let estimatedPayloadBytes = 0;
  let unknownEstimates = 0;
  let unknownLogicalSizes = 0;
  let powerOfTwo = 0;
  let nonPowerOfTwo = 0;

  let scanned = 0;
  for (const { entry, pack, role, kind, status } of selected.values()) {
    throwIfAborted(context.signal);
    if ((scanned++ & 63) === 0) await yieldToEventLoop(context.signal);
    storedBytes += entry.file_size;
    let header: Buffer;
    let logicalLength: number | undefined = entry.is_compressed ? undefined : entry.file_size;
    try {
      if (entry.is_compressed) {
        const payload = await readAutomationPayload(pack, entry, context);
        header = payload.subarray(0, 148);
        logicalLength = payload.length;
      } else {
        header = await readAutomationPayloadPrefix(pack, entry, 148, context);
      }
      const layout = inspectDdsLayout(header, logicalLength!);
      logicalBytes += logicalLength!;
      const estimate = layout.expectedBytes === null ? null : Math.max(0, layout.expectedBytes - layout.dataOffset);
      if (estimate === null) unknownEstimates += 1;
      else estimatedPayloadBytes += estimate;
      const format = layout.format;
      const totals = formatTotals.get(format) ?? { files: 0, logicalBytes: 0, estimatedPayloadBytes: 0, unknownEstimates: 0 };
      totals.files += 1;
      totals.logicalBytes += logicalLength!;
      if (estimate === null) totals.unknownEstimates += 1;
      else totals.estimatedPayloadBytes += estimate;
      formatTotals.set(format, totals);
      const sizeKey = layout.resourceDimension === "3D"
        ? `${layout.width}x${layout.height}x${layout.depth}`
        : `${layout.width}x${layout.height}`;
      const powerOfTwoDimensions = isPowerOfTwo(layout.width) && isPowerOfTwo(layout.height) && isPowerOfTwo(layout.depth);
      dimensions.set(sizeKey, (dimensions.get(sizeKey) ?? 0) + 1);
      if (powerOfTwoDimensions) powerOfTwo += 1;
      else nonPowerOfTwo += 1;
      if (status === "ambiguous") {
        diagnostics.push({ code: "AMBIGUOUS_TEXTURE_PROVIDER", message: "Multiple entries share the highest provider priority", severity: "warning", path: entry.name });
      }
      records.push({
        filePath: entry.name,
        packPath: pack.path,
        providerKind: kind,
        role,
        status,
        storedSize: entry.file_size,
        logicalSize: logicalLength,
        compressed: entry.is_compressed,
        width: layout.width,
        height: layout.height,
        dimensions: sizeKey,
        format,
        declaredMipCount: layout.declaredMipCount,
        effectiveMipCount: layout.mipCount,
        surfaces: layout.surfaceCount,
        depth: layout.depth,
        resourceDimension: layout.resourceDimension,
        arraySize: layout.arraySize,
        isCubemap: layout.isCubemap,
        isPowerOfTwo: powerOfTwoDimensions,
        estimatedDdsPayloadBytes: estimate,
        complete: layout.complete,
        layoutSupported: layout.layoutSupported,
      });
      if (layout.complete === false || !layout.layoutSupported) diagnostics.push({
        code: layout.complete === false ? "TRUNCATED_DDS_CHAIN" : "UNSUPPORTED_DDS_LAYOUT",
        message: layout.complete === false ? "DDS payload is shorter than its declared mip/surface chain" : "DDS format has no supported payload size estimate",
        severity: "warning",
        path: entry.name,
      });
    } catch (error) {
      if (error instanceof AutomationError && ["CANCELLED", "IO_ACCESS"].includes(error.code)) throw error;
      unknownEstimates += 1;
      if (logicalLength === undefined) unknownLogicalSizes += 1;
      else logicalBytes += logicalLength;
      diagnostics.push({ code: "INVALID_DDS", message: error instanceof Error ? error.message : String(error), severity: "warning", path: entry.name });
      records.push({ filePath: entry.name, packPath: pack.path, providerKind: kind, role, status: "invalid", storedSize: entry.file_size, logicalSize: logicalLength ?? null, compressed: entry.is_compressed, estimatedDdsPayloadBytes: null });
    }
  }
  const files = [...records].sort((left, right) => String(left.filePath).localeCompare(String(right.filePath)));
  const full = {
    packPath: target.path,
    scope: useEffective ? "effective" : "target",
    complete: selectionComplete && (environment?.complete ?? true) && !diagnostics.some((item) => item.severity === "warning"),
    total: files.length,
    totals: {
      files: files.length,
      storedBytes,
      logicalBytes,
      estimatedDdsPayloadBytes: estimatedPayloadBytes,
      unknownEstimates,
      unknownLogicalSizes,
      powerOfTwo,
      nonPowerOfTwo,
      formats: Object.fromEntries(formatTotals),
      dimensions: Object.fromEntries([...dimensions].sort(([a], [b]) => a.localeCompare(b))),
    },
    offset: request.offset,
    limit: request.limit,
    nextOffset: request.offset + request.limit < files.length ? request.offset + request.limit : null,
    hasMore: request.offset + request.limit < files.length,
    files: files.slice(request.offset, request.offset + request.limit),
  };
  let reportPath: string | undefined;
  if (request.reportPath) {
    const result = await context.policy.withAtomicOutput({
      outputPath: request.reportPath,
      sourcePaths: environment?.sourcePaths ?? [target.path],
      produce: async (temporaryPath) => fs.writeFile(temporaryPath, `${JSON.stringify({ ...full, files }, null, 2)}\n`),
    });
    reportPath = result.path;
  }
  return { data: { ...full, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};

export const packTextureInspectSchema = z
  .object({
    operation: z.literal("pack_texture_inspect"),
    packPath: z.string().min(1),
    filePath: z.string().min(1),
    mipLevel: z.number().int().min(0).max(31).default(0),
    surface: z.number().int().min(0).default(0),
    outputPath: z.string().min(1).optional(),
    overwrite: z.boolean().default(false),
    reportPath: z.string().min(1).optional(),
  })
  .strict();

export const runPackTextureInspect = async (
  request: z.output<typeof packTextureInspectSchema>,
  context: AutomationContext,
) => {
  const pack = await readAutomationPack(request.packPath, context);
  const entry = findAutomationPackEntry(pack, request.filePath);
  const bytes = await readAutomationPayload(pack, entry, context);
  let texture: ReturnType<typeof inspectDdsLayout>;
  try {
    texture = inspectDdsLayout(bytes);
  } catch (error) {
    throw new AutomationError("VALIDATION", error instanceof Error ? error.message : String(error));
  }
  if (request.mipLevel >= texture.mipCount)
    throw new AutomationError(
      "INVALID_ARGUMENT",
      `Mip ${request.mipLevel} is outside the texture's ${texture.mipCount} levels (zero-based)`,
    );
  if (request.surface >= texture.surfaceCount)
    throw new AutomationError(
      "INVALID_ARGUMENT",
      `Surface ${request.surface} is outside the texture's ${texture.surfaceCount} surfaces`,
    );
  const diagnostics: AutomationDiagnostic[] = [];
  if (!texture.layoutSupported)
    diagnostics.push({
      code: "UNSUPPORTED_DDS_LAYOUT",
      message: "Header metadata is available, but mip byte ranges cannot be verified for this layout",
      severity: "warning",
      path: entry.name,
    });
  if (texture.complete === false)
    diagnostics.push({
      code: "TRUNCATED_DDS_CHAIN",
      message: "DDS payload is shorter than its declared mip/surface chain",
      severity: "warning",
      path: entry.name,
    });
  const mip = texture.mips[request.mipLevel];
  const selectedMip = mip
    ? {
        ...mip,
        surface: request.surface,
        offset: mip.offset + request.surface * texture.chainBytes!,
        present: mip.offset + request.surface * texture.chainBytes! + mip.byteLength <= bytes.length,
      }
    : null;
  for (const output of [request.outputPath, request.reportPath]) {
    if (output) await context.policy.assertOutputDistinctFromSources(output, [pack.path]);
  }
  let preview: { width: number; height: number; outputPath: string; mipLevel: number; surface: number } | undefined;
  if (request.outputPath) {
    if (!texture.previewSupported)
      throw new AutomationError("UNSUPPORTED", texture.previewUnsupportedReason ?? "Unsupported DDS preview format");
    if (!selectedMip?.present) throw new AutomationError("VALIDATION", "Selected DDS mip/surface payload is truncated");
    if (selectedMip.width * selectedMip.height > DDS_MAX_PIXELS)
      throw new AutomationError(
        "VALIDATION",
        `Preview exceeds the ${DDS_MAX_PIXELS.toLocaleString("en-US")}-pixel limit; select a smaller mip`,
      );
    let image: ReturnType<typeof encodeDdsMipAsPng>;
    try {
      image = encodeDdsMipAsPng(bytes, request.mipLevel, request.surface);
    } catch (error) {
      throw new AutomationError("VALIDATION", error instanceof Error ? error.message : String(error));
    }
    const output = await context.policy.withAtomicOutput({
      outputPath: request.outputPath,
      sourcePaths: [pack.path],
      overwrite: request.overwrite,
      produce: async (temporaryPath) => fs.writeFile(temporaryPath, image.png),
    });
    preview = {
      width: image.width,
      height: image.height,
      outputPath: output.path,
      mipLevel: request.mipLevel,
      surface: request.surface,
    };
  }
  const data = {
    packPath: pack.path,
    filePath: entry.name,
    texture,
    selectedMip,
    ...(preview ? { outputPath: preview.outputPath, preview } : {}),
  };
  let reportPath: string | undefined;
  if (request.reportPath) {
    reportPath = (
      await context.policy.withAtomicOutput({
        outputPath: request.reportPath,
        sourcePaths: [pack.path, ...(preview ? [preview.outputPath] : [])],
        produce: async (temporaryPath) =>
          fs.writeFile(temporaryPath, `${JSON.stringify({ ...data, diagnostics }, null, 2)}\n`),
      })
    ).path;
  }
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};
