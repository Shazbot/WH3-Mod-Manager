import * as fs from "node:fs/promises";
import { z } from "zod";
import { parseRmv2, Rmv2CodecError, type Rmv2Part } from "../packCore";
import { AutomationError, type AutomationDiagnostic } from "./errors";
import { findAutomationPackEntry, readAutomationPack, readAutomationPayload } from "./packAccess";
import type { AutomationContext } from "./operations";

export const rigidInspectSchema = z
  .object({
    operation: z.literal("rigid_inspect"),
    packPath: z.string().min(1),
    filePath: z.string().min(1),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(1000).default(100),
    textureSlotsOnly: z.boolean().default(false),
    reportPath: z.string().min(1).optional(),
  })
  .strict();

const partSummary = (part: Rmv2Part) => ({
  lodIndex: part.lodIndex,
  partIndex: part.partIndex,
  name: part.name,
  complete: part.complete,
  ...(part.unsupportedReason ? { unsupportedReason: part.unsupportedReason } : {}),
  materialTypeId: part.materialTypeId,
  materialTypeName: part.materialTypeName,
  renderFlags: part.renderFlags,
  meshSectionSize: part.meshSectionSize,
  vertexOffset: part.vertexOffset,
  indexOffset: part.indexOffset,
  vertexCount: part.vertexCount,
  indexCount: part.indexCount,
  triangleCount: part.triangleCount,
  vertexFormatId: part.vertexFormatId,
  vertexFormatName: part.vertexFormatName,
  boundingBox: part.boundingBox,
  ...(part.textures ? { textures: part.textures } : {}),
  ...(part.alphaMode ? { alphaMode: part.alphaMode } : {}),
  ...(part.stringParams ? { stringParams: part.stringParams } : {}),
  ...(part.floatParams ? { floatParams: part.floatParams } : {}),
  ...(part.intParams ? { intParams: part.intParams } : {}),
  ...(part.vec4Params ? { vec4Params: part.vec4Params } : {}),
  ...(part.uvRanges ? { uvRanges: part.uvRanges } : {}),
});

export const runRigidInspect = async (request: z.output<typeof rigidInspectSchema>, context: AutomationContext) => {
  const pack = await readAutomationPack(request.packPath, context);
  const entry = findAutomationPackEntry(pack, request.filePath);
  const bytes = await readAutomationPayload(pack, entry, context);
  let model: ReturnType<typeof parseRmv2>;
  try {
    model = parseRmv2(bytes, { textureSlotsOnly: request.textureSlotsOnly });
  } catch (error) {
    if (error instanceof Rmv2CodecError) {
      throw new AutomationError(
        error.code === "UNSUPPORTED" ? "UNSUPPORTED" : "VALIDATION",
        error.message,
        error.details,
      );
    }
    throw error;
  }
  const items = model.lods.flatMap((lod) => lod.parts.map(partSummary));
  const end = request.offset + request.limit;
  const preview = {
    packPath: pack.path,
    filePath: entry.name,
    version: model.version,
    skeletonName: model.skeletonName,
    lods: model.lods.map((lod) => ({
      lodIndex: lod.lodIndex,
      meshCount: lod.meshCount,
      distance: lod.distance,
      ...(lod.authoredLodIndex === undefined ? {} : { authoredLodIndex: lod.authoredLodIndex }),
      ...(lod.qualityLevel === undefined ? {} : { qualityLevel: lod.qualityLevel }),
    })),
    validationComplete: model.validationComplete,
    total: items.length,
    offset: request.offset,
    limit: request.limit,
    items: items.slice(request.offset, end),
    nextOffset: end < items.length ? end : null,
    hasMore: end < items.length,
    textureSlotsOnly: request.textureSlotsOnly,
  };
  const diagnostics: AutomationDiagnostic[] = model.lods.flatMap((lod) =>
    lod.parts
      .filter((part) => !part.complete)
      .map((part) => ({
        code: "UNSUPPORTED_RMV2_PART",
        message: `LOD ${part.lodIndex} part ${part.partIndex}: ${part.unsupportedReason ?? "unsupported layout"}`,
        severity: "warning" as const,
        path: entry.name,
      })),
  );
  let reportPath: string | undefined;
  if (request.reportPath) {
    await context.policy.assertOutputDistinctFromSources(request.reportPath, [pack.path]);
    const report = {
      ...preview,
      total: items.length,
      offset: 0,
      limit: items.length,
      items,
      nextOffset: null,
      hasMore: false,
    };
    reportPath = (
      await context.policy.withAtomicOutput({
        outputPath: request.reportPath,
        sourcePaths: [pack.path],
        produce: async (temporaryPath) =>
          fs.writeFile(temporaryPath, `${JSON.stringify({ ...report, diagnostics }, null, 2)}\n`),
      })
    ).path;
  }
  return { data: { ...preview, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};
