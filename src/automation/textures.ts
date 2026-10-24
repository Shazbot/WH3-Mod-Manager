import * as fs from "node:fs/promises";
import { z } from "zod";
import { encodeDdsMipAsPng } from "../esfMap/dds";
import { inspectDdsLayout } from "../utility/ddsLayout";
import { AutomationError, type AutomationDiagnostic } from "./errors";
import { findAutomationPackEntry, readAutomationPack, readAutomationPayload } from "./packAccess";
import type { AutomationContext } from "./operations";

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
    if (selectedMip.width * selectedMip.height > 16_777_216)
      throw new AutomationError("VALIDATION", "Preview exceeds the 16,777,216-pixel limit; select a smaller mip");
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
