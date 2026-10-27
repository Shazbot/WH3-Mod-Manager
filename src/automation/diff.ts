import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import {
  getSupportedVisualReferenceDetails,
  type VisualReferenceDetail,
  type UnsupportedVisualReferenceDetail,
} from "../visuals/dependencies";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { parseDBTablePath } from "../utility/packFileHelpers";
import { getCanonicalLogicalTableName } from "../utility/effectiveDbRow";
import {
  compareRmv2PartGeometry,
  parseRmv2,
  Rmv2CodecError,
  type CorePack,
  type CorePackEntry,
  type ParsedDbTable,
  type Rmv2Part,
} from "../packCore";
import { decodePackedTextBuffer } from "../utility/packFileViewing";
import { decodeDds } from "../esfMap/dds";
import { DDS_MAX_PIXELS, inspectDdsLayout, type DdsLayout } from "../utility/ddsLayout";
import { AutomationError, throwIfAborted, yieldToEventLoop, type AutomationDiagnostic } from "./errors";
import { getAutomationSchemaProvider, readAutomationPack, readAutomationPayload, readAutomationReadonlyTable } from "./packAccess";
import { loadPackedTable, tableRowsToJson, type TableRow } from "./tables";
import { vanillaInputs } from "./vanilla";
import { prepareReferenceEnvironment, resolveReferenceAsset, type ReferenceEnvironment } from "./references";
import { collectUnitVisualIndex } from "./units";
import { collectUnitVisualRoots } from "./visualRoots";
import { createIncomingVisualReferenceIndex, type VisualRootChain } from "./graphUsers";
import type { AutomationContext } from "./operations";

export const packDiffSchema = z
  .object({
    operation: z.literal("pack_diff"),
    beforePath: z.string().min(1),
    afterPath: z.string().min(1),
    packPaths: z.array(z.string().min(1)).max(512).default([]),
    ...vanillaInputs,
    affectedUnits: z.boolean().default(false),
    affectedMaxDepth: z.number().int().min(0).max(32).default(32),
    affectedMaxNodes: z.number().int().min(1).max(1000000).default(100000),
    affectedMaxEdges: z.number().int().min(1).max(5000000).default(500000),
    affectedMaxRoots: z.number().int().min(1).max(1000000).default(100000),
    affectedMaxScanSources: z.number().int().min(1).max(5000000).default(1000000),
    affectedMaxIndexEdges: z.number().int().min(1).max(5000000).default(1000000),
    pathPrefix: z.string().optional(),
    glob: z.string().optional(),
    fileTypes: z.array(z.string().min(1)).max(256).optional(),
    details: z.boolean().default(false),
    detectMoves: z.boolean().default(true),
    semanticOffset: z.number().int().min(0).default(0),
    semanticLimit: z.number().int().min(1).max(1000).default(100),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(1000).default(100),
    reportPath: z.string().min(1).optional(),
  })
  .strict();

type DiffRequest = z.output<typeof packDiffSchema>;

const diagnostic = (
  code: string,
  message: string,
  severity: AutomationDiagnostic["severity"] = "warning",
  path?: string,
): AutomationDiagnostic => ({
  code,
  message,
  severity,
  ...(path ? { path } : {}),
});

const indexByCanonicalPath = (pack: CorePack): Map<string, CorePackEntry> => {
  const result = new Map<string, CorePackEntry>();
  for (const entry of pack.entries) {
    const key = normalizePackFilePathKey(entry.name);
    if (result.has(key))
      throw new AutomationError("CONFLICT", `Pack contains duplicate normalized file path: ${entry.name}`, {
        packPath: pack.path,
        key,
      });
    result.set(key, entry);
  }
  return result;
};

const pathMatches = (name: string, request: DiffRequest): boolean => {
  const normalized = name.replace(/\\/g, "/").toLowerCase();
  if (request.pathPrefix) {
    const prefix = request.pathPrefix.replace(/\\/g, "/").toLowerCase();
    if (!normalized.startsWith(prefix)) return false;
  }
  if (request.glob && !path.posix.matchesGlob(normalized, request.glob.replace(/\\/g, "/").toLowerCase())) return false;
  if (request.fileTypes?.length) {
    const matchesType = request.fileTypes.some((value) => {
      const extension = value.startsWith(".") ? value.toLowerCase() : `.${value.toLowerCase()}`;
      return normalized.endsWith(extension);
    });
    if (!matchesType) return false;
  }
  return true;
};

const hashStream = async (packPath: string, entry: CorePackEntry): Promise<string> => {
  const hash = createHash("sha256");
  if (entry.file_size === 0) return hash.digest("hex");
  const stream = fs.createReadStream(packPath, { start: entry.start_pos, end: entry.start_pos + entry.file_size - 1 });
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

const hashEntry = async (
  pack: CorePack,
  entry: CorePackEntry,
  context: AutomationContext,
): Promise<{ sha256: string; logicalSize: number }> => {
  if (!entry.is_compressed) return { sha256: await hashStream(pack.path, entry), logicalSize: entry.file_size };
  const payload = await readAutomationPayload(pack, entry, context);
  return { sha256: createHash("sha256").update(payload).digest("hex"), logicalSize: payload.length };
};

const changedHeaderField = (before: unknown, after: unknown) => ({
  before,
  after,
  changed: JSON.stringify(before) !== JSON.stringify(after),
});

const ddsHeaderDiff = (beforeBytes: Buffer, before: DdsLayout, afterBytes: Buffer, after: DdsLayout) => {
  const dx10 = (bytes: Buffer, layout: DdsLayout) =>
    layout.fourCc === "DX10"
      ? {
          dxgiFormat: layout.dxgiFormat,
          resourceDimension: layout.resourceDimension,
          arraySize: layout.arraySize,
          cube: layout.isCubemap,
          miscFlags2: bytes.length >= 148 ? bytes.readUInt32LE(144) : null,
        }
      : null;
  const srgb = (layout: DdsLayout) => /_SRGB(?:_|$)/i.test(layout.format);
  const beforeDx10 = dx10(beforeBytes, before);
  const afterDx10 = dx10(afterBytes, after);
  return {
    format: changedHeaderField(
      { format: before.format, fourCc: before.fourCc, dxgiFormat: before.dxgiFormat },
      { format: after.format, fourCc: after.fourCc, dxgiFormat: after.dxgiFormat },
    ),
    sRGB: changedHeaderField(srgb(before), srgb(after)),
    dx10Header: changedHeaderField(beforeDx10, afterDx10),
    width: changedHeaderField(before.width, after.width),
    height: changedHeaderField(before.height, after.height),
    declaredMipCount: changedHeaderField(before.declaredMipCount, after.declaredMipCount),
    effectiveMipCount: changedHeaderField(before.mipCount, after.mipCount),
    arraySize: changedHeaderField(before.arraySize, after.arraySize),
    cubemap: changedHeaderField(before.isCubemap, after.isCubemap),
    volume: changedHeaderField(
      { isVolume: before.resourceDimension === "3D", depth: before.depth },
      { isVolume: after.resourceDimension === "3D", depth: after.depth },
    ),
  };
};

const rgbaError = (before: Buffer, after: Buffer, width: number, height: number) => {
  const sums = [0, 0, 0, 0];
  const maxima = [0, 0, 0, 0];
  let differingTexels = 0;
  const pixels = width * height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const error = Math.abs(before[offset + channel] - after[offset + channel]);
      if (error) differs = true;
      if (error > maxima[channel]) maxima[channel] = error;
      sums[channel] += error * error;
    }
    if (differs) differingTexels += 1;
  }
  const stats = (channel: number) => ({
    maxError: maxima[channel],
    rmse: Math.sqrt(sums[channel] / pixels),
  });
  const allMax = Math.max(...maxima);
  const allSum = sums.reduce((total, value) => total + value, 0);
  return {
    channels: { r: stats(0), g: stats(1), b: stats(2), a: stats(3) },
    overall: { maxError: allMax, rmse: Math.sqrt(allSum / (pixels * 4)) },
    differingTexels,
  };
};

const identicalBlocks = (
  beforeBytes: Buffer,
  before: DdsLayout,
  afterBytes: Buffer,
  after: DdsLayout,
  mipLevel: number,
  surface: number,
) => {
  const mipBefore = before.mips[mipLevel];
  const mipAfter = after.mips[mipLevel];
  if (
    !mipBefore ||
    !mipAfter ||
    !before.blockBytes ||
    !after.blockBytes ||
    before.blockBytes !== after.blockBytes ||
    !before.chainBytes ||
    !after.chainBytes
  )
    return undefined;
  const blockCount = Math.ceil(mipBefore.width / 4) * Math.ceil(mipBefore.height / 4);
  const beforeStart = mipBefore.offset + surface * before.chainBytes;
  const afterStart = mipAfter.offset + surface * after.chainBytes;
  if (beforeStart + mipBefore.byteLength > beforeBytes.length || afterStart + mipAfter.byteLength > afterBytes.length)
    return undefined;
  let identicalCount = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const offsetBefore = beforeStart + block * before.blockBytes;
    const offsetAfter = afterStart + block * after.blockBytes;
    if (
      beforeBytes
        .subarray(offsetBefore, offsetBefore + before.blockBytes)
        .equals(afterBytes.subarray(offsetAfter, offsetAfter + after.blockBytes))
    )
      identicalCount += 1;
  }
  return { identical: identicalCount, total: blockCount };
};

const semanticDdsDiff = async (
  beforePack: CorePack,
  beforeEntry: CorePackEntry,
  afterPack: CorePack,
  afterEntry: CorePackEntry,
  context: AutomationContext,
  diagnostics: AutomationDiagnostic[],
) => {
  try {
    const [beforeBytes, afterBytes] = await Promise.all([
      readAutomationPayload(beforePack, beforeEntry, context),
      readAutomationPayload(afterPack, afterEntry, context),
    ]);
    const before = inspectDdsLayout(beforeBytes);
    const after = inspectDdsLayout(afterBytes);
    const header = ddsHeaderDiff(beforeBytes, before, afterBytes, after);
    const issue = (code: string, message: string) =>
      diagnostics.push(diagnostic(code, message, "warning", beforeEntry.name));
    const skip = (reason: string, code?: string) => {
      if (code) issue(code, reason);
      return {
        type: "dds" as const,
        available: true,
        complete: false,
        header,
        pixelComparison: "skipped" as const,
        reason,
        mipComparisons: [],
        mipComparisonCount: 0,
      };
    };
    if (before.width !== after.width || before.height !== after.height)
      return skip("Pixel comparison requires equal width and height");
    if (before.surfaceCount !== after.surfaceCount)
      return skip(
        "Pixel comparison requires the same number of array/cubemap surfaces",
        "DDS_PIXEL_COMPARISON_SKIPPED",
      );
    if (
      before.resourceDimension !== after.resourceDimension ||
      before.isCubemap !== after.isCubemap ||
      before.arraySize !== after.arraySize
    )
      return skip(
        "Pixel comparison requires compatible array, cubemap, and resource dimensions",
        "DDS_PIXEL_COMPARISON_SKIPPED",
      );
    if (before.resourceDimension === "3D" || after.resourceDimension === "3D")
      return skip("Pixel comparison of volume textures is unsupported", "UNSUPPORTED_DDS_PIXEL_COMPARISON");
    if (!before.previewSupported || !after.previewSupported || !before.layoutSupported || !after.layoutSupported)
      return skip(
        `Pixel comparison is unsupported for ${!before.previewSupported ? before.format : after.format}`,
        "UNSUPPORTED_DDS_PIXEL_COMPARISON",
      );
    if (before.complete === false || after.complete === false)
      issue("TRUNCATED_DDS_PIXEL_COMPARISON", "One or both DDS mip/surface chains are truncated");

    const mipComparisons: Array<Record<string, unknown>> = [];
    const skippedMips: Array<{ mipLevel: number; surface?: number; reason: string }> = [];
    let complete = before.complete !== false && after.complete !== false;
    const mipCount = Math.min(before.mipCount, after.mipCount);
    if (before.mipCount !== after.mipCount) {
      complete = false;
      for (let mipLevel = mipCount; mipLevel < Math.max(before.mipCount, after.mipCount); mipLevel += 1)
        skippedMips.push({ mipLevel, reason: "Mip is present in only one texture" });
    }
    const sameBlockFormat = before.format === after.format && before.blockBytes !== null && after.blockBytes !== null;
    for (let mipLevel = 0; mipLevel < mipCount; mipLevel += 1) {
      throwIfAborted(context.signal);
      const beforeMip = before.mips[mipLevel];
      const afterMip = after.mips[mipLevel];
      if (!beforeMip?.present || !afterMip?.present) {
        complete = false;
        skippedMips.push({ mipLevel, reason: "Mip payload is truncated or unavailable" });
        continue;
      }
      if (beforeMip.width * beforeMip.height > DDS_MAX_PIXELS || afterMip.width * afterMip.height > DDS_MAX_PIXELS) {
        complete = false;
        skippedMips.push({
          mipLevel,
          reason: `Mip exceeds the ${DDS_MAX_PIXELS.toLocaleString("en-US")} pixel limit`,
        });
        continue;
      }
      for (let surface = 0; surface < before.surfaceCount; surface += 1) {
        if ((surface & 15) === 0) await yieldToEventLoop(context.signal);
        try {
          const [beforeImage, afterImage] = await Promise.all([
            Promise.resolve(decodeDds(beforeBytes, mipLevel, surface, DDS_MAX_PIXELS)),
            Promise.resolve(decodeDds(afterBytes, mipLevel, surface, DDS_MAX_PIXELS)),
          ]);
          const blockComparison = sameBlockFormat
            ? identicalBlocks(beforeBytes, before, afterBytes, after, mipLevel, surface)
            : undefined;
          mipComparisons.push({
            mipLevel,
            surface,
            width: beforeMip.width,
            height: beforeMip.height,
            ...rgbaError(beforeImage.pixels, afterImage.pixels, beforeMip.width, beforeMip.height),
            ...(blockComparison
              ? { identicalBlocks: blockComparison.identical, totalBlocks: blockComparison.total }
              : {}),
          });
        } catch (error) {
          complete = false;
          const reason = error instanceof Error ? error.message : String(error);
          skippedMips.push({ mipLevel, surface, reason });
          issue("DDS_PIXEL_COMPARISON_FAILED", reason);
        }
      }
    }
    if (before.mipCount !== after.mipCount)
      issue("DDS_MIP_COUNT_MISMATCH", "Only mip levels present on both textures were compared");
    return {
      type: "dds" as const,
      available: true,
      complete,
      header,
      pixelComparison: mipComparisons.length ? (complete ? "complete" : "partial") : "skipped",
      ...(mipComparisons.length ? {} : { reason: "No common mip payloads could be decoded" }),
      mipComparisonCount: mipComparisons.length,
      mipComparisons,
      skippedMips,
    };
  } catch (error) {
    if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push(diagnostic("DDS_PARSE_FAILED", message, "warning", beforeEntry.name));
    return {
      type: "dds" as const,
      available: false,
      complete: false,
      pixelComparison: "skipped" as const,
      reason: message,
    };
  }
};

const semanticSchemaMatches = (before: ParsedDbTable, after: ParsedDbTable): boolean =>
  before.schema.version === after.schema.version &&
  before.schema.fields.length === after.schema.fields.length &&
  before.schema.fields.every((field, index) => {
    const other = after.schema.fields[index];
    return field.name === other.name && field.field_type === other.field_type && field.is_key === other.is_key;
  });

const canonicalRow = (row: TableRow, fields: readonly { name: string }[]): string =>
  JSON.stringify(fields.map((field) => [field.name, row[field.name]]));

const getTableRows = (table: ParsedDbTable): TableRow[] => tableRowsToJson(table);

const rowKeyNames = (table: ParsedDbTable, isLoc: boolean): string[] =>
  table.schema.fields.flatMap((field) => ((isLoc ? field.name === "key" : field.is_key) ? [field.name] : []));

const multisetDiff = (
  beforeRows: readonly TableRow[],
  afterRows: readonly TableRow[],
  fields: readonly { name: string }[],
  includeDetails: boolean,
) => {
  const counts = (rows: readonly TableRow[]) => {
    const values = new Map<string, { count: number; row: TableRow }>();
    for (const row of rows) {
      const key = canonicalRow(row, fields);
      const current = values.get(key);
      values.set(key, { count: (current?.count ?? 0) + 1, row });
    }
    return values;
  };
  const before = counts(beforeRows);
  const after = counts(afterRows);
  const added: TableRow[] = [];
  const removed: TableRow[] = [];
  let addedCount = 0;
  let deletedCount = 0;
  for (const [key, value] of after) {
    const delta = value.count - (before.get(key)?.count ?? 0);
    addedCount += Math.max(0, delta);
    if (includeDetails) for (let index = 0; index < delta; index++) added.push(value.row);
  }
  for (const [key, value] of before) {
    const delta = value.count - (after.get(key)?.count ?? 0);
    deletedCount += Math.max(0, delta);
    if (includeDetails) for (let index = 0; index < delta; index++) removed.push(value.row);
  }
  return { added, removed, addedCount, deletedCount };
};

const semanticDbDiff = (
  before: ParsedDbTable,
  after: ParsedDbTable,
  beforeLoc: boolean,
  afterLoc: boolean,
  includeDetails: boolean,
) => {
  if (beforeLoc !== afterLoc || !semanticSchemaMatches(before, after)) return undefined;
  const fields = before.schema.fields;
  const beforeRows = getTableRows(before);
  const afterRows = getTableRows(after);
  const keyNames = rowKeyNames(before, beforeLoc);
  if (keyNames.length === 0) {
    const delta = multisetDiff(beforeRows, afterRows, fields, includeDetails);
    return {
      mode: "whole-row-multiset" as const,
      ...(includeDetails ? { added: delta.added, deleted: delta.removed, modified: [] } : {}),
      addedCount: delta.addedCount,
      deletedCount: delta.deletedCount,
      modifiedCount: 0,
    };
  }
  const keyed = (rows: readonly TableRow[]) => {
    const result = new Map<string, TableRow[]>();
    for (const row of rows) {
      const key = JSON.stringify(keyNames.map((name) => [name, row[name]]));
      const values = result.get(key) ?? [];
      values.push(row);
      result.set(key, values);
    }
    return result;
  };
  const beforeByKey = keyed(beforeRows);
  const afterByKey = keyed(afterRows);
  if ([...beforeByKey.values(), ...afterByKey.values()].some((rows) => rows.length > 1)) {
    const delta = multisetDiff(beforeRows, afterRows, fields, includeDetails);
    return {
      mode: "whole-row-multiset" as const,
      ...(includeDetails ? { added: delta.added, deleted: delta.removed, modified: [] } : {}),
      addedCount: delta.addedCount,
      deletedCount: delta.deletedCount,
      modifiedCount: 0,
      duplicateKeys: true,
    };
  }
  const added: TableRow[] = [];
  const deleted: TableRow[] = [];
  const modified: Array<{
    key: Record<string, unknown>;
    fields: Array<{ field: string; before: unknown; after: unknown }>;
  }> = [];
  let addedCount = 0;
  let deletedCount = 0;
  let modifiedCount = 0;
  for (const [key, values] of afterByKey) {
    const oldValues = beforeByKey.get(key);
    if (!oldValues) {
      addedCount += 1;
      if (includeDetails) added.push(values[0]);
      continue;
    }
    const oldRow = oldValues[0];
    const newRow = values[0];
    const changes = fields.flatMap((field) =>
      oldRow[field.name] === newRow[field.name]
        ? []
        : [{ field: field.name, before: oldRow[field.name], after: newRow[field.name] }],
    );
    if (changes.length) {
      modifiedCount += 1;
      if (includeDetails)
        modified.push({ key: Object.fromEntries(keyNames.map((name) => [name, newRow[name]])), fields: changes });
    }
  }
  for (const [key, values] of beforeByKey)
    if (!afterByKey.has(key)) {
      deletedCount += 1;
      if (includeDetails) deleted.push(values[0]);
    }
  return {
    mode: "schema-key" as const,
    ...(includeDetails ? { added, deleted, modified } : {}),
    addedCount,
    deletedCount,
    modifiedCount,
  };
};

const parseSemanticTable = async (pack: CorePack, entry: CorePackEntry, context: AutomationContext) => {
  const payload = await readAutomationPayload(pack, entry, context);
  return loadPackedTable(entry.name, payload, getAutomationSchemaProvider(context));
};

const referenceIdentity = (reference: VisualReferenceDetail | UnsupportedVisualReferenceDetail): string =>
  JSON.stringify([
    normalizePackFilePathKey(reference.path),
    reference.location,
    reference.sourceField,
    "relationship" in reference ? reference.relationship : "unsupported",
    reference.conditional ?? null,
  ]);

const detailMultisetDiff = <T extends VisualReferenceDetail | UnsupportedVisualReferenceDetail>(
  before: readonly T[],
  after: readonly T[],
  includeDetails: boolean,
) => {
  const count = (items: readonly T[]) => {
    const result = new Map<string, { count: number; value: T }>();
    for (const value of items) {
      const key = referenceIdentity(value);
      const item = result.get(key);
      result.set(key, { count: (item?.count ?? 0) + 1, value });
    }
    return result;
  };
  const beforeCounts = count(before);
  const afterCounts = count(after);
  const added: T[] = [];
  const removed: T[] = [];
  let addedCount = 0;
  let removedCount = 0;
  for (const [key, item] of afterCounts) {
    const difference = item.count - (beforeCounts.get(key)?.count ?? 0);
    addedCount += Math.max(0, difference);
    if (includeDetails) for (let index = 0; index < difference; index += 1) added.push(item.value);
  }
  for (const [key, item] of beforeCounts) {
    const difference = item.count - (afterCounts.get(key)?.count ?? 0);
    removedCount += Math.max(0, difference);
    if (includeDetails) for (let index = 0; index < difference; index += 1) removed.push(item.value);
  }
  return { added, removed, addedCount, removedCount };
};

const normalizedParameters = (part: Rmv2Part) =>
  [
    ["string", part.stringParams ?? []],
    ["float", part.floatParams ?? []],
    ["int", part.intParams ?? []],
    ["vec4", part.vec4Params ?? []],
  ] as const;

const semanticRmv2Diff = (
  beforeModel: ReturnType<typeof parseRmv2>,
  afterModel: ReturnType<typeof parseRmv2>,
  beforePath: string,
  includeDetails: boolean,
  diagnostics: AutomationDiagnostic[],
) => {
  const added: Array<Record<string, unknown>> = [];
  const deleted: Array<Record<string, unknown>> = [];
  const modified: Array<Record<string, unknown>> = [];
  let lodAddedCount = 0;
  let lodRemovedCount = 0;
  let partAddedCount = 0;
  let partRemovedCount = 0;
  let vertexChangedCount = 0;
  let positionChangedCount = 0;
  let uvChangedCount = 0;
  let indexChangedCount = 0;
  let materialChangedCount = 0;
  let textureSlotChangedCount = 0;
  let textureSlotAddedCount = 0;
  let textureSlotRemovedCount = 0;
  let parameterChangedCount = 0;
  let modifiedRecordCount = 0;
  let complete = beforeModel.validationComplete && afterModel.validationComplete;
  const addRecord = (group: "added" | "deleted" | "modified", record: Record<string, unknown>) => {
    if (group === "modified") modifiedRecordCount += 1;
    if (includeDetails) (group === "added" ? added : group === "deleted" ? deleted : modified).push(record);
  };
  if (beforeModel.version !== afterModel.version || beforeModel.skeletonName !== afterModel.skeletonName) {
    addRecord("modified", {
      kind: "model",
      version: { before: beforeModel.version, after: afterModel.version },
      skeletonName: { before: beforeModel.skeletonName, after: afterModel.skeletonName },
    });
  }
  const beforeLods = new Map(beforeModel.lods.map((lod) => [lod.lodIndex, lod]));
  const afterLods = new Map(afterModel.lods.map((lod) => [lod.lodIndex, lod]));
  for (const lodIndex of [...new Set([...beforeLods.keys(), ...afterLods.keys()])].sort(
    (left, right) => left - right,
  )) {
    const beforeLod = beforeLods.get(lodIndex);
    const afterLod = afterLods.get(lodIndex);
    if (!beforeLod) {
      lodAddedCount += 1;
      addRecord("added", { kind: "lod", lodIndex, distance: afterLod!.distance, partCount: afterLod!.meshCount });
      continue;
    }
    if (!afterLod) {
      lodRemovedCount += 1;
      addRecord("deleted", { kind: "lod", lodIndex, distance: beforeLod.distance, partCount: beforeLod.meshCount });
      continue;
    }
    if (
      beforeLod.distance !== afterLod.distance ||
      beforeLod.authoredLodIndex !== afterLod.authoredLodIndex ||
      beforeLod.qualityLevel !== afterLod.qualityLevel
    ) {
      addRecord("modified", {
        kind: "lod",
        lodIndex,
        before: {
          distance: beforeLod.distance,
          authoredLodIndex: beforeLod.authoredLodIndex,
          qualityLevel: beforeLod.qualityLevel,
        },
        after: {
          distance: afterLod.distance,
          authoredLodIndex: afterLod.authoredLodIndex,
          qualityLevel: afterLod.qualityLevel,
        },
      });
    }
    const beforeParts = new Map(beforeLod.parts.map((part) => [part.partIndex, part]));
    const afterParts = new Map(afterLod.parts.map((part) => [part.partIndex, part]));
    for (const partIndex of [...new Set([...beforeParts.keys(), ...afterParts.keys()])].sort(
      (left, right) => left - right,
    )) {
      const beforePart = beforeParts.get(partIndex);
      const afterPart = afterParts.get(partIndex);
      if (!beforePart) {
        partAddedCount += 1;
        addRecord("added", {
          kind: "part",
          lodIndex,
          partIndex,
          name: afterPart!.name,
          materialTypeId: afterPart!.materialTypeId,
          materialTypeName: afterPart!.materialTypeName,
          vertexCount: afterPart!.vertexCount,
          indexCount: afterPart!.indexCount,
        });
        continue;
      }
      if (!afterPart) {
        partRemovedCount += 1;
        addRecord("deleted", {
          kind: "part",
          lodIndex,
          partIndex,
          name: beforePart.name,
          materialTypeId: beforePart.materialTypeId,
          materialTypeName: beforePart.materialTypeName,
          vertexCount: beforePart.vertexCount,
          indexCount: beforePart.indexCount,
        });
        continue;
      }
      if (!beforePart.complete || !afterPart.complete) {
        complete = false;
        diagnostics.push(
          diagnostic(
            "UNSUPPORTED_RMV2_DIFF_PART",
            `LOD ${lodIndex} part ${partIndex} has an unsupported material or vertex layout; semantic comparison is incomplete`,
            "warning",
            beforePath,
          ),
        );
        continue;
      }
      const materialChanged =
        beforePart.materialTypeId !== afterPart.materialTypeId ||
        beforePart.vertexFormatId !== afterPart.vertexFormatId ||
        beforePart.renderFlags !== afterPart.renderFlags;
      if (materialChanged) {
        materialChangedCount += 1;
        addRecord("modified", {
          kind: "material",
          lodIndex,
          partIndex,
          name: { before: beforePart.name, after: afterPart.name },
          materialType: {
            before: { id: beforePart.materialTypeId, name: beforePart.materialTypeName },
            after: { id: afterPart.materialTypeId, name: afterPart.materialTypeName },
          },
          vertexFormat: {
            before: { id: beforePart.vertexFormatId, name: beforePart.vertexFormatName },
            after: { id: afterPart.vertexFormatId, name: afterPart.vertexFormatName },
          },
          renderFlags: { before: beforePart.renderFlags, after: afterPart.renderFlags },
        });
      } else if (beforePart.name !== afterPart.name) {
        addRecord("modified", {
          kind: "part",
          lodIndex,
          partIndex,
          name: { before: beforePart.name, after: afterPart.name },
        });
      }
      const textureOccurrences = (textures: Rmv2Part["textures"] | undefined) => {
        const byType = new Map<string, Array<{ texture: NonNullable<Rmv2Part["textures"]>[number]; index: number }>>();
        for (const [index, texture] of (textures ?? []).entries()) {
          const typeKey = texture.source === "terrainTexturePath" ? "terrain-path" : `texture:${texture.typeId}`;
          const values = byType.get(typeKey) ?? [];
          values.push({ texture, index });
          byType.set(typeKey, values);
        }
        return byType;
      };
      const beforeTextureTypes = textureOccurrences(beforePart.textures);
      const afterTextureTypes = textureOccurrences(afterPart.textures);
      const textureTypeKeys = [...new Set([...beforeTextureTypes.keys(), ...afterTextureTypes.keys()])].sort();
      for (const textureTypeKey of textureTypeKeys) {
        const beforeValues = beforeTextureTypes.get(textureTypeKey) ?? [];
        const afterValues = afterTextureTypes.get(textureTypeKey) ?? [];
        for (let occurrence = 0; occurrence < Math.max(beforeValues.length, afterValues.length); occurrence++) {
          const beforeItem = beforeValues[occurrence];
          const afterItem = afterValues[occurrence];
          const beforeTexture = beforeItem?.texture;
          const afterTexture = afterItem?.texture;
          if (JSON.stringify(beforeTexture ?? null) === JSON.stringify(afterTexture ?? null)) continue;
          textureSlotChangedCount += 1;
          const record = {
            kind: "textureSlot",
            lodIndex,
            partIndex,
            typeId: beforeTexture?.typeId ?? afterTexture?.typeId ?? null,
            typeName: beforeTexture?.typeName ?? afterTexture?.typeName ?? "TerrainTexturePath",
            occurrence,
            beforeIndex: beforeItem?.index ?? null,
            afterIndex: afterItem?.index ?? null,
            before: beforeTexture ?? null,
            after: afterTexture ?? null,
          };
          if (!beforeTexture) {
            textureSlotAddedCount += 1;
            addRecord("added", record);
          } else if (!afterTexture) {
            textureSlotRemovedCount += 1;
            addRecord("deleted", record);
          } else {
            addRecord("modified", record);
          }
        }
      }
      for (const [parameterType, beforeValues] of normalizedParameters(beforePart)) {
        const afterValues = normalizedParameters(afterPart).find(([type]) => type === parameterType)![1];
        const count = Math.max(beforeValues.length, afterValues.length);
        for (let parameterIndex = 0; parameterIndex < count; parameterIndex++) {
          const beforeValue = beforeValues[parameterIndex];
          const afterValue = afterValues[parameterIndex];
          if (JSON.stringify(beforeValue ?? null) === JSON.stringify(afterValue ?? null)) continue;
          parameterChangedCount += 1;
          addRecord("modified", {
            kind: "parameter",
            parameterType,
            lodIndex,
            partIndex,
            parameterIndex,
            before: beforeValue ?? null,
            after: afterValue ?? null,
          });
        }
      }
      const geometry = compareRmv2PartGeometry(beforeModel.version, beforePart, afterModel.version, afterPart);
      vertexChangedCount += geometry.vertexChangedCount;
      positionChangedCount += geometry.positionChangedCount;
      uvChangedCount += geometry.uvChangedCount;
      indexChangedCount += geometry.indexChangedCount;
      if (
        geometry.vertexChangedCount ||
        geometry.positionChangedCount ||
        geometry.uvChangedCount ||
        geometry.indexChangedCount ||
        !geometry.layoutComparable
      ) {
        addRecord("modified", { kind: "geometry", lodIndex, partIndex, ...geometry });
      }
    }
  }
  const addedCount = lodAddedCount + partAddedCount + textureSlotAddedCount;
  const deletedCount = lodRemovedCount + partRemovedCount + textureSlotRemovedCount;
  const modifiedCount = modifiedRecordCount;
  return {
    type: "rmv2" as const,
    semanticScope: "registeredRmv2Layouts" as const,
    available: true,
    complete,
    addedCount,
    deletedCount,
    modifiedCount,
    lodAddedCount,
    lodRemovedCount,
    partAddedCount,
    partRemovedCount,
    vertexChangedCount,
    positionChangedCount,
    uvChangedCount,
    indexChangedCount,
    materialChangedCount,
    textureSlotChangedCount,
    textureSlotAddedCount,
    textureSlotRemovedCount,
    parameterChangedCount,
    ...(includeDetails ? { added, deleted, modified } : {}),
  };
};

const semanticDiffForFile = async (
  beforePack: CorePack,
  beforeEntry: CorePackEntry,
  afterPack: CorePack,
  afterEntry: CorePackEntry,
  context: AutomationContext,
  diagnostics: AutomationDiagnostic[],
  includeDetails: boolean,
) => {
  const beforeNormalized = normalizePackFilePathKey(beforeEntry.name);
  const afterNormalized = normalizePackFilePathKey(afterEntry.name);
  if (beforeNormalized.endsWith(".dds") || afterNormalized.endsWith(".dds")) {
    if (!includeDetails) return undefined;
    return semanticDdsDiff(beforePack, beforeEntry, afterPack, afterEntry, context, diagnostics);
  }
  const beforeIsTable = beforeNormalized.endsWith(".loc") || Boolean(parseDBTablePath(beforeNormalized));
  const afterIsTable = afterNormalized.endsWith(".loc") || Boolean(parseDBTablePath(afterNormalized));
  if (beforeIsTable || afterIsTable) {
    try {
      const [before, after] = await Promise.all([
        parseSemanticTable(beforePack, beforeEntry, context),
        parseSemanticTable(afterPack, afterEntry, context),
      ]);
      const semantic = semanticDbDiff(before.parsed, after.parsed, before.isLoc, after.isLoc, includeDetails);
      if (!semantic)
        diagnostics.push(
          diagnostic(
            "DB_SCHEMA_MISMATCH",
            "DB semantic comparison was skipped because table versions or field layouts differ",
            "warning",
            beforeEntry.name,
          ),
        );
      return semantic ? { type: "db-rows" as const, ...semantic } : { type: "db-rows" as const, available: false };
    } catch (error) {
      if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
      const code =
        error instanceof AutomationError && error.code === "UNSUPPORTED" ? "DB_SCHEMA_UNAVAILABLE" : "DB_PARSE_FAILED";
      diagnostics.push(
        diagnostic(code, error instanceof Error ? error.message : String(error), "warning", beforeEntry.name),
      );
      return { type: "db-rows" as const, available: false };
    }
  }
  const extension = beforeEntry.name.toLowerCase();
  if (extension.endsWith(".rigid_model_v2")) {
    try {
      const [beforeBytes, afterBytes] = await Promise.all([
        readAutomationPayload(beforePack, beforeEntry, context),
        readAutomationPayload(afterPack, afterEntry, context),
      ]);
      let beforeModel;
      let afterModel;
      try {
        beforeModel = parseRmv2(beforeBytes);
        afterModel = parseRmv2(afterBytes);
      } catch (error) {
        const unsupported = error instanceof Rmv2CodecError && error.code === "UNSUPPORTED";
        diagnostics.push(
          diagnostic(
            unsupported ? "UNSUPPORTED_RMV2_DIFF" : "INVALID_RMV2_DIFF",
            error instanceof Error ? error.message : String(error),
            "warning",
            beforeEntry.name,
          ),
        );
        return { type: "rmv2" as const, available: false, complete: false };
      }
      return semanticRmv2Diff(beforeModel, afterModel, beforeEntry.name, includeDetails, diagnostics);
    } catch (error) {
      if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code)) throw error;
      diagnostics.push(
        diagnostic(
          "INVALID_RMV2_DIFF",
          error instanceof Error ? error.message : String(error),
          "warning",
          beforeEntry.name,
        ),
      );
      return { type: "rmv2" as const, available: false, complete: false };
    }
  }
  if (
    !extension.endsWith(".variantmeshdefinition") &&
    !extension.endsWith(".wsmodel") &&
    !extension.endsWith(".xml.material")
  )
    return undefined;
  try {
    const [beforeBytes, afterBytes] = await Promise.all([
      readAutomationPayload(beforePack, beforeEntry, context),
      readAutomationPayload(afterPack, afterEntry, context),
    ]);
    const beforeText = decodePackedTextBuffer(beforeBytes);
    const afterText = decodePackedTextBuffer(afterBytes);
    const beforeRefs = getSupportedVisualReferenceDetails(beforeText);
    const afterRefs = getSupportedVisualReferenceDetails(afterText);
    if (!beforeRefs.valid || !afterRefs.valid) {
      diagnostics.push(
        diagnostic(
          "XML_PARSE_FAILED",
          "XML reference comparison was skipped because a document is invalid",
          "warning",
          beforeEntry.name,
        ),
      );
      return { type: "xml-references" as const, available: false };
    }
    if (beforeRefs.unsupportedReferences.length || afterRefs.unsupportedReferences.length) {
      diagnostics.push(
        diagnostic(
          "UNSUPPORTED_XML_REFERENCES",
          "Some XML references use unsupported extensions and were excluded from semantic reference comparison",
          "warning",
          beforeEntry.name,
        ),
      );
    }
    const supported = detailMultisetDiff(beforeRefs.references, afterRefs.references, includeDetails);
    const unsupported = detailMultisetDiff(
      beforeRefs.unsupportedReferences,
      afterRefs.unsupportedReferences,
      includeDetails,
    );
    return {
      type: "xml-references" as const,
      semanticScope: "supportedReferences" as const,
      addedCount: supported.addedCount,
      removedCount: supported.removedCount,
      unsupportedAddedCount: unsupported.addedCount,
      unsupportedRemovedCount: unsupported.removedCount,
      ...(includeDetails
        ? {
            added: supported.added,
            removed: supported.removed,
            unsupportedAdded: unsupported.added,
            unsupportedRemoved: unsupported.removed,
          }
        : {}),
    };
  } catch (error) {
    if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
    diagnostics.push(
      diagnostic(
        "XML_PARSE_FAILED",
        error instanceof Error ? error.message : String(error),
        "warning",
        beforeEntry.name,
      ),
    );
    return { type: "xml-references" as const, available: false };
  }
};

const metadataDifferences = (
  before: CorePack,
  after: CorePack,
): Record<string, { before: unknown; after: unknown }> => {
  const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  const values: Record<string, [unknown, unknown]> = {
    byteMask: [before.header.byteMask, after.header.byteMask],
    refFileCount: [before.header.refFileCount, after.header.refFileCount],
    dependencies: [before.dependencies, after.dependencies],
    dependencyBytes: [hash(before.dependencyBytes), hash(after.dependencyBytes)],
    headerBuffer: [before.header.headerBuffer.toString("hex"), after.header.headerBuffer.toString("hex")],
    trailingBytes: [
      { length: before.trailingBytes.length, sha256: hash(before.trailingBytes) },
      { length: after.trailingBytes.length, sha256: hash(after.trailingBytes) },
    ],
  };
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, [oldValue, newValue]]) =>
      JSON.stringify(oldValue) === JSON.stringify(newValue) ? [] : [[key, { before: oldValue, after: newValue }]],
    ),
  );
};

const semanticRecordPreview = (semantic: Record<string, unknown>, offset: number, limit: number) => {
  const recordGroups = [
    "added",
    "deleted",
    "removed",
    "modified",
    "unsupportedAdded",
    "unsupportedRemoved",
    "mipComparisons",
  ] as const;
  const records: Array<{ kind: string; record: unknown }> = [];
  for (const kind of recordGroups) {
    const items = semantic[kind];
    if (Array.isArray(items)) for (const record of items) records.push({ kind, record });
  }
  const totalRecords =
    Number(semantic.addedCount ?? 0) +
    Number(semantic.deletedCount ?? semantic.removedCount ?? 0) +
    Number(semantic.modifiedCount ?? 0) +
    Number(semantic.unsupportedAddedCount ?? 0) +
    Number(semantic.unsupportedRemovedCount ?? 0) +
    Number(semantic.mipComparisonCount ?? 0);
  return {
    type: semantic.type,
    mode: semantic.mode,
    semanticScope: semantic.semanticScope,
    available: semantic.available,
    complete: semantic.complete,
    header: semantic.header,
    pixelComparison: semantic.pixelComparison,
    reason: semantic.reason,
    skippedMips: semantic.skippedMips,
    mipComparisonCount: semantic.mipComparisonCount,
    addedCount: semantic.addedCount,
    deletedCount: semantic.deletedCount,
    removedCount: semantic.removedCount,
    modifiedCount: semantic.modifiedCount,
    unsupportedAddedCount: semantic.unsupportedAddedCount,
    unsupportedRemovedCount: semantic.unsupportedRemovedCount,
    lodAddedCount: semantic.lodAddedCount,
    lodRemovedCount: semantic.lodRemovedCount,
    partAddedCount: semantic.partAddedCount,
    partRemovedCount: semantic.partRemovedCount,
    vertexChangedCount: semantic.vertexChangedCount,
    positionChangedCount: semantic.positionChangedCount,
    uvChangedCount: semantic.uvChangedCount,
    indexChangedCount: semantic.indexChangedCount,
    materialChangedCount: semantic.materialChangedCount,
    textureSlotChangedCount: semantic.textureSlotChangedCount,
    textureSlotAddedCount: semantic.textureSlotAddedCount,
    textureSlotRemovedCount: semantic.textureSlotRemovedCount,
    parameterChangedCount: semantic.parameterChangedCount,
    duplicateKeys: semantic.duplicateKeys,
    totalRecords,
    semanticOffset: offset,
    semanticLimit: limit,
    recordPreview: records.slice(offset, offset + limit),
    semanticNextOffset: offset + limit < totalRecords ? offset + limit : null,
    semanticHasMore: offset + limit < totalRecords,
  };
};

type DiffRecord = {
  key: string;
  beforeEntry?: CorePackEntry;
  afterEntry?: CorePackEntry;
  beforeHash?: { sha256: string; logicalSize: number };
  afterHash?: { sha256: string; logicalSize: number };
  status: "added" | "removed" | "changed" | "identical" | "moved";
  from?: string;
  to?: string;
  ambiguous?: boolean;
  suppressed?: boolean;
};

const logicalTableForEntry = (entry: CorePackEntry | undefined): string | undefined => {
  if (!entry) return undefined;
  const normalized = normalizePackFilePathKey(entry.name);
  if (normalized.endsWith(".loc")) return `loc:${normalized}`;
  const parsed = parseDBTablePath(normalized);
  return parsed?.dbFolder === "db" ? getCanonicalLogicalTableName(`db\\${parsed.dbName}`) : undefined;
};
const samePhysicalPath = (left: string, right: string) => {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return process.platform === "win32" ? leftPath.toLowerCase() === rightPath.toLowerCase() : leftPath === rightPath;
};

const prioritizeAffectedRoots = (
  environment: ReferenceEnvironment,
  roots: readonly import("./units").UnitVisualRoot[],
  targetPackPath: string,
) => roots.map((root, index) => {
  const provider = resolveReferenceAsset(environment, root.path).winner?.provider;
  const rank = provider
    ? samePhysicalPath(provider.pack.path, targetPackPath) ? 0 : provider.kind === "mod" ? 1 : 2
    : 3;
  return { root, index, rank };
}).sort((left, right) => left.rank - right.rank || left.index - right.index).map(({ root }) => root);

type SemanticRowDelta = {
  table: string;
  status: "added" | "removed" | "changed";
  identity: Record<string, unknown>;
  keyFields: string[];
  beforeFilePath?: string;
  afterFilePath?: string;
  beforePackPath?: string;
  afterPackPath?: string;
  rowIndex?: number;
  changedFields: string[];
};

const rowIdentity = (loaded: Awaited<ReturnType<typeof readAutomationReadonlyTable>>, row: TableRow, index: number) => {
  const fields = loaded.isLoc ? [{ name: "key" }] : loaded.schema.fields.filter((field) => field.is_key);
  const usable = fields.length > 0 && fields.every((field) => row[field.name] !== null && row[field.name] !== undefined);
  const identity = usable ? Object.fromEntries(fields.map((field) => [field.name, row[field.name]])) : { rowIndex: index };
  return { key: JSON.stringify(identity), identity, keyFields: usable ? fields.map((field) => field.name) : [], rowIndex: index };
};

const semanticRowsForPair = async (
  beforePack: CorePack,
  beforeEntry: CorePackEntry | undefined,
  afterPack: CorePack,
  afterEntry: CorePackEntry | undefined,
  context: AutomationContext,
  diagnostics: AutomationDiagnostic[],
): Promise<SemanticRowDelta[]> => {
  const beforeTable = logicalTableForEntry(beforeEntry);
  const afterTable = logicalTableForEntry(afterEntry);
  if (!beforeTable && !afterTable) return [];
  if (beforeTable && afterTable && beforeTable !== afterTable) return [];
  const table = afterTable ?? beforeTable!;
  try {
    const [beforeLoaded, afterLoaded] = await Promise.all([
      beforeEntry ? readAutomationReadonlyTable(beforePack, beforeEntry, context) : undefined,
      afterEntry ? readAutomationReadonlyTable(afterPack, afterEntry, context) : undefined,
    ]);
    const beforeRows = beforeLoaded?.rows ?? [];
    const afterRows = afterLoaded?.rows ?? [];
    const mapRows = async (loaded: NonNullable<typeof beforeLoaded>, rows: readonly TableRow[]) => {
      const map = new Map<string, { row: TableRow; identity: Record<string, unknown>; keyFields: string[]; rowIndex: number }[]>();
      for (let index = 0; index < rows.length; index++) {
        throwIfAborted(context.signal);
        if ((index & 255) === 0) await yieldToEventLoop(context.signal);
        const row = rows[index];
        const identified = rowIdentity(loaded, row, index);
        const group = map.get(identified.key) ?? [];
        group.push({ row, ...identified });
        map.set(identified.key, group);
      }
      return map;
    };
    const beforeMap = beforeLoaded ? await mapRows(beforeLoaded, beforeRows) : new Map();
    const afterMap = afterLoaded ? await mapRows(afterLoaded, afterRows) : new Map();
    const deltas: SemanticRowDelta[] = [];
    let scannedKeys = 0;
    for (const key of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
      throwIfAborted(context.signal);
      if ((scannedKeys++ & 255) === 0) await yieldToEventLoop(context.signal);
      const oldRows = beforeMap.get(key) ?? [];
      const newRows = afterMap.get(key) ?? [];
      const identitySource = newRows[0] ?? oldRows[0];
      if (oldRows.length > 1 || newRows.length > 1) {
        diagnostics.push(diagnostic("AFFECTED_UNITS_DUPLICATE_ROW_KEY", `Duplicate row identity in ${table}; unit correlation may be incomplete`, "warning", afterEntry?.name ?? beforeEntry?.name));
        continue;
      }
      const oldRow = oldRows[0]?.row;
      const newRow = newRows[0]?.row;
      if (!oldRow && newRow) {
        deltas.push({ table, status: "added", identity: identitySource.identity, keyFields: identitySource.keyFields, afterFilePath: afterEntry?.name, afterPackPath: afterPack.path, rowIndex: identitySource.rowIndex, changedFields: Object.keys(newRow) });
      } else if (oldRow && !newRow) {
        deltas.push({ table, status: "removed", identity: identitySource.identity, keyFields: identitySource.keyFields, beforeFilePath: beforeEntry?.name, beforePackPath: beforePack.path, rowIndex: identitySource.rowIndex, changedFields: Object.keys(oldRow) });
      } else if (oldRow && newRow && JSON.stringify(oldRow) !== JSON.stringify(newRow)) {
        deltas.push({
          table,
          status: "changed",
          identity: identitySource.identity,
          keyFields: identitySource.keyFields,
          beforeFilePath: beforeEntry?.name,
          afterFilePath: afterEntry?.name,
          beforePackPath: beforePack.path,
          afterPackPath: afterPack.path,
          rowIndex: identitySource.rowIndex,
          changedFields: [...new Set([...Object.keys(oldRow), ...Object.keys(newRow)])].filter((field) => JSON.stringify(oldRow[field]) !== JSON.stringify(newRow[field])),
        });
      }
    }
    return deltas;
  } catch (error) {
    if (error instanceof AutomationError && ["CANCELLED", "IO_ACCESS"].includes(error.code)) throw error;
    diagnostics.push(diagnostic("AFFECTED_UNITS_TABLE_DELTA_UNAVAILABLE", error instanceof Error ? error.message : String(error), "warning", afterEntry?.name ?? beforeEntry?.name));
    return [];
  }
};

const evidenceMatchesDelta = (evidence: unknown, delta: SemanticRowDelta, state: "before" | "after") => {
  if (!evidence || typeof evidence !== "object") return false;
  const record = evidence as Record<string, unknown>;
  const filePath = state === "before" ? delta.beforeFilePath : delta.afterFilePath;
  const packPath = state === "before" ? delta.beforePackPath : delta.afterPackPath;
  if (!filePath || typeof record.filePath !== "string" || normalizePackFilePathKey(record.filePath) !== normalizePackFilePathKey(filePath)) return false;
  if (packPath && (typeof record.packPath !== "string" || !samePhysicalPath(record.packPath, packPath))) return false;
  if (delta.table.startsWith("loc:")) {
    return (delta.identity.key ?? "") === (record.row as Record<string, unknown> | undefined)?.key;
  }
  if (typeof record.table !== "string" || normalizePackFilePathKey(record.table) !== normalizePackFilePathKey(delta.table)) return false;
  if (!delta.keyFields.length) return record.rowIndex === delta.rowIndex;
  const row = record.row as Record<string, unknown> | undefined;
  return Boolean(row && delta.keyFields.every((field) => JSON.stringify(row[field]) === JSON.stringify(delta.identity[field])));
};

const runAffectedUnitAnalysis = async (
  request: DiffRequest,
  context: AutomationContext,
  beforePack: CorePack,
  afterPack: CorePack,
  records: readonly DiffRecord[],
) => {
  const emptyCoverage = {
    nodes: 0,
    edges: 0,
    maxDepth: request.affectedMaxDepth,
    maxNodes: request.affectedMaxNodes,
    maxEdges: request.affectedMaxEdges,
    hitLimit: false,
    scannedSources: 0,
    indexedEdges: 0,
    reversePathWalks: 0,
  };
  if (!records.some((record) => record.status !== "identical")) return {
    complete: true,
    total: 0,
    offset: request.semanticOffset,
    limit: request.semanticLimit,
    nextOffset: null,
    hasMore: false,
    items: [],
    reportItems: [],
    checklist: { units: [], campaignReviewAssets: [], byteMetric: "unique changed internal paths; each path uses max(before logical size, after logical size)" },
    changedPathCoverage: [],
    unresolvedPaths: [],
    limitReasons: [],
    analysis: {
      before: { complete: true, graph: emptyCoverage, roots: 0 },
      after: { complete: true, graph: emptyCoverage, roots: 0 },
      changedPaths: 0,
      unsupportedChangedFiles: [],
      diagnostics: [],
    },
    sourcePaths: [],
  };
  const supportPacks = request.packPaths.filter((packPath) => {
    const canonical = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    return canonical(packPath) !== canonical(beforePack.path) && canonical(packPath) !== canonical(afterPack.path);
  });
  const changedPathBytes = new Map<string, { path: string; bytes: number; status: string }>();
  for (const record of records) {
    if (record.status === "identical") continue;
    const paths = [
      ...(record.beforeEntry ? [{ path: record.beforeEntry.name, bytes: record.beforeHash?.logicalSize ?? record.beforeEntry.file_size }] : []),
      ...(record.afterEntry ? [{ path: record.afterEntry.name, bytes: record.afterHash?.logicalSize ?? record.afterEntry.file_size }] : []),
      ...(record.from ? [{ path: record.from, bytes: record.beforeHash?.logicalSize ?? record.beforeEntry?.file_size ?? 0 }] : []),
      ...(record.to ? [{ path: record.to, bytes: record.afterHash?.logicalSize ?? record.afterEntry?.file_size ?? 0 }] : []),
    ];
    for (const item of paths) {
      const key = normalizePackFilePathKey(item.path);
      const existing = changedPathBytes.get(key);
      changedPathBytes.set(key, {
        path: existing?.path ?? item.path,
        bytes: Math.max(existing?.bytes ?? 0, item.bytes),
        status: existing?.status ?? record.status,
      });
    }
  }
  const changedPaths = [...changedPathBytes.entries()].map(([key, item]) => ({ key, ...item }));
  const assetPaths = changedPaths.filter(({ path: changedPath }) =>
    /\.(?:dds|variantmeshdefinition|wsmodel|rigid_model_v2|xml\.material)$/i.test(changedPath));
  const unsupportedChangedFiles: Array<{ path: string; status: string; extension: string }> = [];
  for (const item of changedPaths) {
    const supportedAsset = assetPaths.some(({ key }) => key === item.key);
    const supportedTable = item.key.endsWith(".loc") || Boolean(parseDBTablePath(item.key));
    if (!supportedAsset && !supportedTable) unsupportedChangedFiles.push({
      path: item.path,
      status: item.status,
      extension: path.extname(item.path).slice(1).toLowerCase() || "(none)",
    });
  }

  context.progress?.({ stage: "roots", state: "before", completed: 0, total: 2, paths: changedPaths.length, message: "Discovering before-state unit roots" });
  const beforeEnvironment = await prepareReferenceEnvironment(context, [...supportPacks, beforePack.path], request.vanillaPackPaths, request.gameDataPath, request.withVanilla, true);
  let beforeRootScan = await collectUnitVisualRoots(beforeEnvironment);
  let beforeUnitRoots = prioritizeAffectedRoots(beforeEnvironment, beforeRootScan.roots, beforePack.path).slice(0, request.affectedMaxRoots);
  let beforeRootLimit = beforeRootScan.roots.length > request.affectedMaxRoots;
  if (beforeRootLimit) {
    beforeEnvironment.complete = false;
    beforeEnvironment.diagnostics.push(diagnostic("AFFECTED_UNITS_ROOT_LIMIT", `Before-state unit roots exceed affectedMaxRoots (${request.affectedMaxRoots})`));
  }
  let beforeRootScanComplete = beforeEnvironment.complete && !beforeRootLimit;
  context.progress?.({ stage: "roots", state: "after", completed: 1, total: 2, units: beforeUnitRoots.length, message: "Discovering after-state unit roots" });
  const afterEnvironment = await prepareReferenceEnvironment(context, [...supportPacks, afterPack.path], request.vanillaPackPaths, request.gameDataPath, request.withVanilla, true);
  let afterRootScan = await collectUnitVisualRoots(afterEnvironment);
  let afterUnitRoots = prioritizeAffectedRoots(afterEnvironment, afterRootScan.roots, afterPack.path).slice(0, request.affectedMaxRoots);
  let afterRootLimit = afterRootScan.roots.length > request.affectedMaxRoots;
  if (afterRootLimit) {
    afterEnvironment.complete = false;
    afterEnvironment.diagnostics.push(diagnostic("AFFECTED_UNITS_ROOT_LIMIT", `After-state unit roots exceed affectedMaxRoots (${request.affectedMaxRoots})`));
  }
  let afterRootScanComplete = afterEnvironment.complete && !afterRootLimit;
  const affected = new Map<string, { unitKey: string; landUnitKey: string; states: Array<Record<string, unknown>> }>();
  const diagnostics: AutomationDiagnostic[] = [];
  const addVisualMatches = (state: "before" | "after", targetPath: string, matches: readonly VisualRootChain[]) => {
    for (const { root, chain } of matches) {
      const identity = `${root.unitKey}\0${root.landUnitKey}`;
      const unit = affected.get(identity) ?? { unitKey: root.unitKey, landUnitKey: root.landUnitKey, states: [] };
      let stateRecord = unit.states.find((item) => item.state === state);
      if (!stateRecord) {
        stateRecord = { state, paths: [] };
        unit.states.push(stateRecord);
      }
      const paths = stateRecord.paths as Array<Record<string, unknown>>;
      const candidate = { path: targetPath, rootPath: root.path, rootKind: root.rootKind, reason: root.reason, chain };
      if (!paths.some((item) => JSON.stringify(item) === JSON.stringify(candidate))) paths.push(candidate);
      affected.set(identity, unit);
    }
  };
  const beforeIncoming = assetPaths.length
    ? await createIncomingVisualReferenceIndex(beforeEnvironment, assetPaths.map((item) => item.path), {
        maxSources: request.affectedMaxScanSources,
        maxIndexEdges: request.affectedMaxIndexEdges,
      })
    : { complete: true, edges: 0, scannedSources: 0, diagnostics: [], findMany: async () => ({ matches: new Map(), coverageByPath: new Map(), walks: 0 }) };
  let beforeTraversal = await beforeIncoming.findMany(assetPaths.map((item) => item.path), beforeUnitRoots, {
    maxDepth: request.affectedMaxDepth,
    maxNodes: request.affectedMaxNodes,
    maxEdges: request.affectedMaxEdges,
  });
  for (const item of assetPaths) addVisualMatches("before", item.path, beforeTraversal.matches.get(item.key) ?? []);
  context.progress?.({ stage: "indexing", state: "after", completed: 0, total: 2, paths: assetPaths.length, message: "Indexing after-state visual references" });
  const afterIncoming = assetPaths.length
    ? await createIncomingVisualReferenceIndex(afterEnvironment, assetPaths.map((item) => item.path), {
        maxSources: request.affectedMaxScanSources,
        maxIndexEdges: request.affectedMaxIndexEdges,
      })
    : { complete: true, edges: 0, scannedSources: 0, diagnostics: [], findMany: async () => ({ matches: new Map(), coverageByPath: new Map(), walks: 0 }) };
  let afterTraversal = await afterIncoming.findMany(assetPaths.map((item) => item.path), afterUnitRoots, {
    maxDepth: request.affectedMaxDepth,
    maxNodes: request.affectedMaxNodes,
    maxEdges: request.affectedMaxEdges,
  });
  for (const item of assetPaths) addVisualMatches("after", item.path, afterTraversal.matches.get(item.key) ?? []);

  const semanticDeltas: SemanticRowDelta[] = [];
  for (const record of records) {
    throwIfAborted(context.signal);
    if (record.status === "identical") continue;
    const deltas = await semanticRowsForPair(beforePack, record.beforeEntry, afterPack, record.afterEntry, context, diagnostics);
    semanticDeltas.push(...deltas);
  }
  let beforeSemanticIndex: Awaited<ReturnType<typeof collectUnitVisualIndex>> | undefined;
  let afterSemanticIndex: Awaited<ReturnType<typeof collectUnitVisualIndex>> | undefined;
  if (semanticDeltas.length) {
    // Semantic row analysis remains exhaustive. Visual-only changes take the lightweight path;
    // DB/LOC changes need all-unit source evidence before pagination can be applied.
    beforeSemanticIndex = await collectUnitVisualIndex(beforeEnvironment);
    afterSemanticIndex = await collectUnitVisualIndex(afterEnvironment);
    for (const delta of semanticDeltas) {
      const sideEntries = delta.status === "changed" ? ["before", "after"] as const : [delta.status === "added" ? "after" : "before"] as const;
      for (const state of sideEntries) {
        const index = state === "before" ? beforeSemanticIndex : afterSemanticIndex;
        let unitIndex = 0;
        for (const unit of index.units) {
          throwIfAborted(context.signal);
          if ((unitIndex++ & 255) === 0) await yieldToEventLoop(context.signal);
          const evidence = unit.evidence ?? [];
          const sourceFilePath = state === "before" ? delta.beforeFilePath : delta.afterFilePath;
          const sourcePackPath = state === "before" ? delta.beforePackPath : delta.afterPackPath;
          const locMatch = delta.table.startsWith("loc:") &&
            String(delta.identity.key ?? "") === unit.locKey &&
            Boolean(sourceFilePath && sourcePackPath && unit.locEvidence?.filePath && unit.locEvidence.packPath &&
              normalizePackFilePathKey(sourceFilePath) === normalizePackFilePathKey(unit.locEvidence.filePath) &&
              samePhysicalPath(sourcePackPath, unit.locEvidence.packPath));
          const rowMatch = evidence.some((item) => evidenceMatchesDelta(item, delta, state));
          if (!locMatch && !rowMatch) continue;
          const identity = `${unit.unitKey}\0${unit.landUnitKey}`;
          const target = affected.get(identity) ?? { unitKey: unit.unitKey, landUnitKey: unit.landUnitKey, states: [] };
          let stateRecord = target.states.find((item) => item.state === state);
          if (!stateRecord) {
            stateRecord = { state, paths: [] };
            target.states.push(stateRecord);
          }
          const paths = stateRecord.paths as Array<Record<string, unknown>>;
          const filePath = state === "before" ? delta.beforeFilePath : delta.afterFilePath;
          const reason = {
            kind: delta.table.startsWith("loc:") ? "localizationRow" : "databaseRow",
            table: delta.table,
            rowStatus: delta.status,
            rowIdentity: delta.identity,
            changedFields: delta.changedFields,
            filePath,
          };
          if (!paths.some((item) => JSON.stringify(item) === JSON.stringify(reason))) paths.push(reason);
          affected.set(identity, target);
        }
      }
    }
  }

  let metadataComplete = true;
  const metadataDiagnostics: AutomationDiagnostic[] = [];
  const loadMatchedDetail = async (environment: ReferenceEnvironment, keys: ReadonlySet<string>, exhaustive?: Awaited<ReturnType<typeof collectUnitVisualIndex>>) => {
    if (exhaustive) return exhaustive;
    if (!keys.size) return { roots: [], units: [], missingTables: [] };
    const scope = { ...environment, complete: true, diagnostics: [] as AutomationDiagnostic[] };
    const result = await collectUnitVisualIndex(scope, keys);
    if (!scope.complete || result.missingTables.length) metadataComplete = false;
    metadataDiagnostics.push(...scope.diagnostics);
    return result;
  };
  const keysForState = (stateName: "before" | "after") => new Set([...affected.values()]
    .filter((item) => item.states.some((state) => state.state === stateName)).map((item) => item.unitKey).filter(Boolean));
  context.progress?.({ stage: "hydration", state: "before", completed: 0, total: 2,
    units: keysForState("before").size, message: "Loading before-state evidence for matched units" });
  let beforeDetailIndex = await loadMatchedDetail(beforeEnvironment, keysForState("before"), beforeSemanticIndex);
  context.progress?.({ stage: "hydration", state: "after", completed: 1, total: 2,
    units: keysForState("after").size, message: "Loading after-state evidence for matched units" });
  let afterDetailIndex = await loadMatchedDetail(afterEnvironment, keysForState("after"), afterSemanticIndex);
  context.progress?.({ stage: "hydration", completed: 2, total: 2, message: "Matched-unit evidence loaded" });
  const rootSignature = (unitKey: string, landUnitKey: string, rootPath: string, rootKind: string, reason: string) =>
    JSON.stringify([unitKey, landUnitKey, normalizePackFilePathKey(rootPath), rootKind, reason]);
  const unmatchedVisualRoots = (stateName: "before" | "after", detail: Awaited<ReturnType<typeof collectUnitVisualIndex>>) => {
    const roots = new Set(detail.roots.map((root) => rootSignature(root.unitKey, root.landUnitKey, root.path, root.rootKind, root.reason)));
    const mismatches: Array<{ key: string; path: string; rootPath: string }> = [];
    for (const [key, unit] of affected) for (const state of unit.states) {
      if (state.state !== stateName || !Array.isArray(state.paths)) continue;
      for (const candidate of state.paths as Array<Record<string, unknown>>) {
        if (typeof candidate.rootPath !== "string" || typeof candidate.rootKind !== "string" || typeof candidate.reason !== "string") continue;
        if (!roots.has(rootSignature(unit.unitKey, unit.landUnitKey, candidate.rootPath, candidate.rootKind, candidate.reason)))
          mismatches.push({ key, path: String(candidate.path ?? candidate.rootPath), rootPath: candidate.rootPath });
      }
    }
    return mismatches;
  };
  const clearVisualMatches = (stateName: "before" | "after") => {
    for (const [key, unit] of affected) {
      for (let index = unit.states.length - 1; index >= 0; index--) {
        const state = unit.states[index];
        if (state.state !== stateName || !Array.isArray(state.paths)) continue;
        state.paths = (state.paths as Array<Record<string, unknown>>).filter((item) => typeof item.rootPath !== "string");
        if (!(state.paths as unknown[]).length) unit.states.splice(index, 1);
      }
      if (!unit.states.length) affected.delete(key);
    }
  };
  const fallbackVisualRoots = async (stateName: "before" | "after") => {
    const environment = stateName === "before" ? beforeEnvironment : afterEnvironment;
    const incomingIndex = stateName === "before" ? beforeIncoming : afterIncoming;
    if (stateName === "before") {
      beforeRootScan = await collectUnitVisualRoots(environment, false);
      beforeUnitRoots = prioritizeAffectedRoots(environment, beforeRootScan.roots, beforePack.path).slice(0, request.affectedMaxRoots);
      beforeRootLimit = beforeRootScan.roots.length > request.affectedMaxRoots;
      beforeRootScanComplete = environment.complete && !beforeRootLimit;
    } else {
      afterRootScan = await collectUnitVisualRoots(environment, false);
      afterUnitRoots = prioritizeAffectedRoots(environment, afterRootScan.roots, afterPack.path).slice(0, request.affectedMaxRoots);
      afterRootLimit = afterRootScan.roots.length > request.affectedMaxRoots;
      afterRootScanComplete = environment.complete && !afterRootLimit;
    }
    environment.diagnostics = environment.diagnostics.filter((item) => item.code !== "AFFECTED_UNITS_ROOT_LIMIT");
    const rootLimit = stateName === "before" ? beforeRootLimit : afterRootLimit;
    if (rootLimit) environment.diagnostics.push(diagnostic("AFFECTED_UNITS_ROOT_LIMIT",
      `${stateName === "before" ? "Before" : "After"}-state unit roots exceed affectedMaxRoots (${request.affectedMaxRoots})`));
    clearVisualMatches(stateName);
    const roots = stateName === "before" ? beforeUnitRoots : afterUnitRoots;
    const traversal = await incomingIndex.findMany(assetPaths.map((item) => item.path), roots, {
      maxDepth: request.affectedMaxDepth,
      maxNodes: request.affectedMaxNodes,
      maxEdges: request.affectedMaxEdges,
    });
    if (stateName === "before") beforeTraversal = traversal;
    else afterTraversal = traversal;
    for (const item of assetPaths) addVisualMatches(stateName, item.path, traversal.matches.get(item.key) ?? []);
  };
  const initialBeforeMismatch = unmatchedVisualRoots("before", beforeDetailIndex);
  if (initialBeforeMismatch.length && beforeEnvironment.usedVisualCatalog) {
    await fallbackVisualRoots("before");
    beforeDetailIndex = await loadMatchedDetail(beforeEnvironment, keysForState("before"), beforeSemanticIndex);
  }
  const initialAfterMismatch = unmatchedVisualRoots("after", afterDetailIndex);
  if (initialAfterMismatch.length && afterEnvironment.usedVisualCatalog) {
    await fallbackVisualRoots("after");
    afterDetailIndex = await loadMatchedDetail(afterEnvironment, keysForState("after"), afterSemanticIndex);
  }
  const unconfirmedPaths = new Set<string>();
  for (const [stateName, detail] of [["before", beforeDetailIndex], ["after", afterDetailIndex]] as const) {
    const mismatches = unmatchedVisualRoots(stateName, detail);
    if (!mismatches.length) continue;
    metadataComplete = false;
    for (const item of mismatches) unconfirmedPaths.add(normalizePackFilePathKey(item.path));
    diagnostics.push(diagnostic("AFFECTED_UNITS_VISUAL_EVIDENCE_MISSING",
      `Source root evidence did not confirm ${mismatches.length} visual match(es) in ${stateName}`, "warning"));
    for (const mismatch of mismatches) {
      const unit = affected.get(mismatch.key);
      for (const state of unit?.states ?? []) if (state.state === stateName && Array.isArray(state.paths))
        state.paths = (state.paths as Array<Record<string, unknown>>).filter((item) => item.rootPath !== mismatch.rootPath);
      if (unit && !unit.states.some((state) => Array.isArray(state.paths) && (state.paths as unknown[]).length)) affected.delete(mismatch.key);
    }
  }
  const detailByState = {
    before: new Map(beforeDetailIndex.units.map((unit) => [`${unit.unitKey}\0${unit.landUnitKey}`, unit])),
    after: new Map(afterDetailIndex.units.map((unit) => [`${unit.unitKey}\0${unit.landUnitKey}`, unit])),
  };
  for (const [identity, item] of affected) for (const state of item.states) {
    const detail = detailByState[state.state as "before" | "after"].get(identity);
    if (!detail) {
      metadataComplete = false;
      diagnostics.push(diagnostic("AFFECTED_UNITS_METADATA_MISSING", `Source detail could not be confirmed for ${item.unitKey}/${item.landUnitKey}`, "warning"));
      continue;
    }
    state.localizedName = detail.localizedName;
    state.locKey = detail.locKey;
    state.scopeSource = detail.scopeSource;
    state.unscoped = detail.unscoped;
    state.factions = detail.factions;
    state.customBattlePermissionEvidence = detail.customBattlePermissions;
  }
  diagnostics.push(...metadataDiagnostics);
  if (unsupportedChangedFiles.length) diagnostics.push(diagnostic("AFFECTED_UNITS_UNSUPPORTED_CHANGED_TYPES", "Some changed files are outside supported visual, DB, and LOC analysis", "warning"));

  const semanticUnitsForPath = (key: string, stateName: "before" | "after") => {
    const units = new Set<string>();
    for (const unit of affected.values()) for (const state of unit.states) {
      if (state.state !== stateName || !Array.isArray(state.paths)) continue;
      if ((state.paths as Array<Record<string, unknown>>).some((item) =>
        typeof item.filePath === "string" && normalizePackFilePathKey(item.filePath) === key)) units.add(`${unit.unitKey}\0${unit.landUnitKey}`);
    }
    return units.size;
  };
  const semanticCoverageComplete = !diagnostics.some((entry) => entry.code === "AFFECTED_UNITS_TABLE_DELTA_UNAVAILABLE") &&
    (!beforeSemanticIndex || beforeSemanticIndex.missingTables.length === 0) &&
    (!afterSemanticIndex || afterSemanticIndex.missingTables.length === 0);
  const pathCoverage = changedPaths.map((item) => {
    const supportedAsset = assetPaths.some((asset) => asset.key === item.key);
    const supportedTable = item.key.endsWith(".loc") || Boolean(parseDBTablePath(item.key));
    const sides = [
      ["before", beforeTraversal, beforeIncoming.complete && beforeRootScanComplete] as const,
      ["after", afterTraversal, afterIncoming.complete && afterRootScanComplete] as const,
    ].map(([state, traversal, stateComplete]) => {
      if (!supportedAsset) {
        if (!supportedTable) return { state, status: "unsupported", complete: false, units: 0, walks: 0 };
        const matchedUnits = semanticUnitsForPath(item.key, state);
        return {
          state,
          status: matchedUnits ? "matched" : semanticCoverageComplete ? "noMatch" : "incomplete",
          complete: semanticCoverageComplete,
          units: matchedUnits,
          walks: 0,
          ...(!semanticCoverageComplete ? { limitReason: "semantic table coverage incomplete" } : {}),
        };
      }
      const key = item.key;
      const coverage = traversal.coverageByPath.get(key);
      const confirmedUnitKeys = new Set<string>();
      for (const unit of affected.values()) for (const stateEntry of unit.states) {
        if (stateEntry.state !== state || !Array.isArray(stateEntry.paths)) continue;
        if ((stateEntry.paths as Array<Record<string, unknown>>).some((candidate) =>
          typeof candidate.path === "string" && normalizePackFilePathKey(candidate.path) === key))
          confirmedUnitKeys.add(`${unit.unitKey}\0${unit.landUnitKey}`);
      }
      const complete = Boolean(stateComplete && coverage?.complete && !unconfirmedPaths.has(key));
      return {
        state,
        status: confirmedUnitKeys.size ? "matched" : complete ? "noMatch" : "incomplete",
        complete,
        units: confirmedUnitKeys.size,
        walks: coverage?.walks ?? 0,
        ...(!complete ? { limitReason: coverage?.limitReason ?? (!stateComplete ? "incoming index or roots incomplete" : "traversal incomplete") } : {}),
      };
    });
    const supported = supportedAsset || supportedTable;
    const matched = sides.some((side) => side.status === "matched");
    const complete = sides.every((side) => side.complete || side.status === "unsupported");
    const status = !supported ? "unsupported" : matched ? "matched" : complete ? "noMatch" : "incomplete";
    return { path: item.path, bytes: item.bytes, status, complete, states: sides };
  });
  const unresolvedPaths = pathCoverage.filter((item) => item.status !== "unsupported" && !item.complete)
    .map((item) => item.path);
  const limitReasons = [...new Set(pathCoverage.flatMap((item) => item.states.flatMap((state) => "limitReason" in state ? [state.limitReason] : [])))];
  for (const [state, incomingIndex, rootLimit, traversal] of [
    ["before", beforeIncoming, beforeRootLimit, beforeTraversal] as const,
    ["after", afterIncoming, afterRootLimit, afterTraversal] as const,
  ]) {
    diagnostics.push(...incomingIndex.diagnostics.map((item) => diagnostic(item.code, item.message, item.severity, item.path)));
    if (!incomingIndex.complete || rootLimit || [...traversal.coverageByPath.values()].some((item) => !item.complete)) {
      const environment = state === "before" ? beforeEnvironment : afterEnvironment;
      environment.complete = false;
    }
  }

  const affectedItems = [...affected.values()].sort((left, right) => left.unitKey.localeCompare(right.unitKey) || left.landUnitKey.localeCompare(right.landUnitKey));
  const factionGroups = new Map<string, { key: string; name?: string; evidence: string; units: string[] }>();
  const unscoped = new Map<string, { unitKey: string; landUnitKey: string; classification: string }>();
  const unknown: Array<{ unitKey: string; landUnitKey: string }> = [];
  for (const unit of affectedItems) {
    let recognized = false;
    for (const state of unit.states) {
      const factions = Array.isArray(state.factions) ? state.factions as Array<Record<string, unknown>> : [];
      const source = state.scopeSource === "customBattlePermissions" ? "customBattlePermission" : state.scopeSource === "visualFallback" ? "visualFallback" : "unknown";
      for (const faction of factions) {
        const key = String(faction.key ?? "");
        if (!key) continue;
        recognized = true;
        const group = factionGroups.get(`${source}:${key}`) ?? { key, name: typeof faction.name === "string" ? faction.name : undefined, evidence: source, units: [] };
        const unitId = `${unit.unitKey || "(land-only)"}/${unit.landUnitKey}`;
        if (!group.units.includes(unitId)) group.units.push(unitId);
        factionGroups.set(`${source}:${key}`, group);
      }
      if (state.unscoped) unscoped.set(JSON.stringify([unit.unitKey, unit.landUnitKey, source]), {
        unitKey: unit.unitKey, landUnitKey: unit.landUnitKey, classification: source,
      });
    }
    if (!recognized && !unit.states.some((state) => state.unscoped)) unknown.push({ unitKey: unit.unitKey, landUnitKey: unit.landUnitKey });
  }
  const allDiagnostics = new Map<string, AutomationDiagnostic>();
  for (const item of [...diagnostics, ...beforeEnvironment.diagnostics, ...afterEnvironment.diagnostics]) {
    allDiagnostics.set(`${item.code}\0${item.path ?? ""}\0${item.message}`, item);
  }
  const changedBytes = new Map(changedPaths.map((item) => [item.key, item.bytes]));
  const checklistUnits = affectedItems.map((unit) => {
    const changedFiles = new Map<string, { path: string; bytes: number }>();
    const casteValues: string[] = [];
    const customBattleFactions = new Map<string, { key: string; name?: string }>();
    const rootKinds = new Set<string>();
    for (const state of unit.states) {
      if (state.scopeSource === "customBattlePermissions" && Array.isArray(state.factions)) for (const raw of state.factions) {
        if (!raw || typeof raw !== "object") continue;
        const faction = raw as Record<string, unknown>;
        const key = String(faction.key ?? "");
        if (key) customBattleFactions.set(key, { key, ...(typeof faction.name === "string" ? { name: faction.name } : {}) });
      }
      const paths = Array.isArray(state.paths) ? state.paths as Array<Record<string, unknown>> : [];
      for (const changed of paths) {
        const changedPath = typeof changed.path === "string" ? changed.path : typeof changed.filePath === "string" ? changed.filePath : "";
        if (!changedPath) continue;
        const key = normalizePackFilePathKey(changedPath);
        changedFiles.set(key, { path: changedPath, bytes: changedBytes.get(key) ?? 0 });
        if (typeof changed.rootKind === "string") rootKinds.add(changed.rootKind);
      }
    }
    for (const detail of [detailByState.before.get(`${unit.unitKey}\0${unit.landUnitKey}`), detailByState.after.get(`${unit.unitKey}\0${unit.landUnitKey}`)]) {
      for (const evidence of detail?.evidence ?? []) {
        if (!evidence || typeof evidence !== "object") continue;
        const record = evidence as Record<string, unknown>;
        if (typeof record.table !== "string" || !normalizePackFilePathKey(record.table).endsWith("main_units_tables")) continue;
        const row = record.row && typeof record.row === "object" ? record.row as Record<string, unknown> : {};
        if (typeof row.caste === "string" && row.caste) casteValues.push(row.caste.toLowerCase());
      }
    }
    const caste = casteValues[0];
    const role = rootKinds.has("mount") ? "mount" : caste
      ? /lord/.test(caste) ? "lord" : /hero/.test(caste) ? "hero" : "unit"
      : "unknown";
    const files = [...changedFiles.values()].sort((left, right) => left.path.localeCompare(right.path));
    return {
      key: unit.unitKey || unit.landUnitKey,
      unitKey: unit.unitKey || null,
      landUnitKey: unit.landUnitKey,
      name: unit.states.find((state) => typeof state.localizedName === "string")?.localizedName ?? null,
      role,
      customBattleFactions: [...customBattleFactions.values()].sort((left, right) => left.key.localeCompare(right.key)),
      factionStatus: customBattleFactions.size ? "explicit" : "unknown",
      changedFiles: files,
      changedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    };
  }).sort((left, right) => right.changedBytes - left.changedBytes || left.key.localeCompare(right.key));
  const matchedChangedPathKeys = new Set(checklistUnits.flatMap((unit) => unit.changedFiles.map((item) => normalizePackFilePathKey(item.path))));
  const coverageByKey = new Map(pathCoverage.map((item) => [normalizePackFilePathKey(item.path), item]));
  const campaignPathHint = (filePath: string) => filePath.split("\\").some((segment) => ["campaign", "campaign_map", "campaignmap"].includes(segment.toLowerCase()));
  const campaignReviewAssets = assetPaths.filter((item) => campaignPathHint(item.path)).map((item) => {
    const coverage = coverageByKey.get(item.key);
    const status = coverage?.status ?? "incomplete";
    const complete = coverage?.complete ?? false;
    const mappedUnits = checklistUnits.filter((unit) => unit.changedFiles.some((file) =>
      normalizePackFilePathKey(file.path) === item.key)).map((unit) => ({
        key: unit.key, unitKey: unit.unitKey, landUnitKey: unit.landUnitKey, name: unit.name,
      }));
    return {
      path: item.path,
      bytes: item.bytes,
      classification: "campaign-review-candidate",
      campaignOnly: false,
      status,
      complete,
      mappedUnits,
      reason: mappedUnits.length
        ? "Path suggests campaign use and also maps to battle unit(s); the campaign role still needs review."
        : status === "noMatch" && complete
          ? "No custom-battle unit visual mapping was found; review campaign-map or other non-battle use."
          : status === "matched"
            ? "Incoming visual references were found, but no unit mapping was confirmed; review campaign use and source evidence."
            : "Path suggests campaign use; battle use is unconfirmed because visual coverage is incomplete.",
    };
  }).sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
  const unmappedAssets = assetPaths.filter((item) => !matchedChangedPathKeys.has(item.key) && !campaignPathHint(item.path)).map((item) => ({
    path: item.path,
    bytes: item.bytes,
    status: coverageByKey.get(item.key)?.status ?? "incomplete",
  }));
  const complete = beforeIncoming.complete && afterIncoming.complete && !beforeRootLimit && !afterRootLimit &&
    beforeEnvironment.complete && afterEnvironment.complete && metadataComplete && pathCoverage.every((item) => item.complete) && diagnostics.length === 0;
  return {
    complete,
    total: affectedItems.length,
    offset: request.semanticOffset,
    limit: request.semanticLimit,
    nextOffset: request.semanticOffset + request.semanticLimit < affectedItems.length ? request.semanticOffset + request.semanticLimit : null,
    hasMore: request.semanticOffset + request.semanticLimit < affectedItems.length,
    items: affectedItems.slice(request.semanticOffset, request.semanticOffset + request.semanticLimit),
    reportItems: affectedItems,
    checklist: {
      units: checklistUnits,
      campaignReviewAssets,
      unmappedAssets,
      metadataCoverage: { complete: metadataComplete, diagnostics: metadataDiagnostics },
      byteMetric: "unique changed internal paths; each path uses max(before logical size, after logical size)",
      factions: [...factionGroups.values()].sort((left, right) => left.key.localeCompare(right.key) || left.evidence.localeCompare(right.evidence)),
      unscoped: [...unscoped.values()],
      unknown,
    },
    changedPathCoverage: pathCoverage,
    unresolvedPaths,
    limitReasons,
    analysis: {
      before: { complete: beforeIncoming.complete && !beforeRootLimit && beforeEnvironment.complete,
        graph: { ...emptyCoverage, edges: beforeIncoming.edges, nodes: beforeUnitRoots.length, scannedSources: beforeIncoming.scannedSources,
          indexedEdges: beforeIncoming.edges, reversePathWalks: beforeTraversal.walks,
          hitLimit: beforeRootLimit || beforeIncoming.diagnostics.some((item) =>
            item.code === "INCOMING_REFERENCE_SOURCE_LIMIT" || item.code === "INCOMING_REFERENCE_EDGE_LIMIT") ||
            [...beforeTraversal.coverageByPath.values()].some((item) => item.limitReason?.startsWith("max")) },
        roots: beforeRootScan.roots.length },
      after: { complete: afterIncoming.complete && !afterRootLimit && afterEnvironment.complete,
        graph: { ...emptyCoverage, edges: afterIncoming.edges, nodes: afterUnitRoots.length, scannedSources: afterIncoming.scannedSources,
          indexedEdges: afterIncoming.edges, reversePathWalks: afterTraversal.walks,
          hitLimit: afterRootLimit || afterIncoming.diagnostics.some((item) =>
            item.code === "INCOMING_REFERENCE_SOURCE_LIMIT" || item.code === "INCOMING_REFERENCE_EDGE_LIMIT") ||
            [...afterTraversal.coverageByPath.values()].some((item) => item.limitReason?.startsWith("max")) },
        roots: afterRootScan.roots.length },
      changedPaths: changedPaths.length,
      unsupportedChangedFiles,
      budgets: {
        maxDepth: request.affectedMaxDepth,
        maxNodes: request.affectedMaxNodes,
        maxEdges: request.affectedMaxEdges,
        maxRoots: request.affectedMaxRoots,
        maxScanSources: request.affectedMaxScanSources,
        maxIndexEdges: request.affectedMaxIndexEdges,
      },
      diagnostics: [...allDiagnostics.values()],
    },
    sourcePaths: [...new Set([...beforeEnvironment.sourcePaths, ...afterEnvironment.sourcePaths])],
  };
};

export const runPackDiff = async (request: DiffRequest, context: AutomationContext) => {
  context.progress?.({ stage: "reading", completed: 0, total: 2, message: "Reading before and after pack indexes" });
  const [beforePack, afterPack] = await Promise.all([
    readAutomationPack(request.beforePath, context),
    readAutomationPack(request.afterPath, context),
  ]);
  const beforeEntries = indexByCanonicalPath(beforePack);
  const afterEntries = indexByCanonicalPath(afterPack);
  const allKeys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])]
    .filter((key) => pathMatches((afterEntries.get(key) ?? beforeEntries.get(key))!.name, request))
    .sort();
  context.progress?.({ stage: "hashing", completed: 0, total: allKeys.length, paths: allKeys.length,
    message: `Hashing ${allKeys.length} candidate paths` });
  const diagnostics: AutomationDiagnostic[] = [];
  const files: Array<Record<string, unknown>> = [];
  const reportFiles: Array<Record<string, unknown>> = [];
  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;
  let identicalCount = 0;
  let movedCount = 0;
  let logicalSizeDelta = 0;
  let storedSizeDelta = 0;

  const records: DiffRecord[] = [];
  let comparedEntries = 0;
  for (const key of allKeys) {
    throwIfAborted(context.signal);
    if ((comparedEntries++ & 127) === 0) await yieldToEventLoop(context.signal);
    const beforeEntry = beforeEntries.get(key);
    const afterEntry = afterEntries.get(key);
    const beforeHash = beforeEntry ? await hashEntry(beforePack, beforeEntry, context) : undefined;
    const afterHash = afterEntry ? await hashEntry(afterPack, afterEntry, context) : undefined;
    if ((comparedEntries & 127) === 0 || comparedEntries === allKeys.length) context.progress?.({
      stage: "hashing", completed: comparedEntries, total: allKeys.length, paths: allKeys.length,
      message: `Hashed ${comparedEntries} of ${allKeys.length} candidate paths`,
    });
    const status = !beforeEntry
      ? "added"
      : !afterEntry
        ? "removed"
        : beforeHash!.sha256 === afterHash!.sha256
          ? "identical"
          : "changed";
    logicalSizeDelta += (afterHash?.logicalSize ?? 0) - (beforeHash?.logicalSize ?? 0);
    storedSizeDelta += (afterEntry?.file_size ?? 0) - (beforeEntry?.file_size ?? 0);
    records.push({ key, beforeEntry, afterEntry, beforeHash, afterHash, status });
  }

  if (request.detectMoves) {
    const candidates = new Map<string, { removed: typeof records; added: typeof records }>();
    for (const record of records) {
      if (record.status !== "added" && record.status !== "removed") continue;
      const content = record.status === "removed" ? record.beforeHash! : record.afterHash!;
      const contentKey = `${content.logicalSize}\0${content.sha256}`;
      const group = candidates.get(contentKey) ?? { removed: [], added: [] };
      group[record.status].push(record);
      candidates.set(contentKey, group);
    }
    for (const group of candidates.values()) {
      const pairCount = Math.min(group.removed.length, group.added.length);
      const ambiguous = group.removed.length > 1 || group.added.length > 1;
      for (let index = 0; index < pairCount; index += 1) {
        const removed = group.removed[index];
        const added = group.added[index];
        removed.suppressed = true;
        added.status = "moved";
        added.beforeEntry = removed.beforeEntry;
        added.beforeHash = removed.beforeHash;
        added.from = removed.beforeEntry!.name;
        added.to = added.afterEntry!.name;
        added.ambiguous = ambiguous;
      }
    }
  }

  const emittedRecords = records.filter((record) => !record.suppressed);
  if (request.detectMoves)
    emittedRecords.sort((left, right) =>
      normalizePackFilePathKey((left.afterEntry ?? left.beforeEntry)!.name).localeCompare(
        normalizePackFilePathKey((right.afterEntry ?? right.beforeEntry)!.name),
      ),
    );

  let emittedCount = 0;
  context.progress?.({ stage: "semantic", completed: 0, total: emittedRecords.length, paths: emittedRecords.length,
    message: `Comparing semantics for ${emittedRecords.length} changed paths` });
  for (const record of emittedRecords) {
    throwIfAborted(context.signal);
    if ((emittedCount++ & 127) === 0) await yieldToEventLoop(context.signal);
    const { beforeEntry, afterEntry, beforeHash, afterHash, status } = record;
    if (status === "added") addedCount += 1;
    else if (status === "removed") removedCount += 1;
    else if (status === "changed") changedCount += 1;
    else if (status === "identical") identicalCount += 1;
    else movedCount += 1;
    const item: Record<string, unknown> = {
      path: (afterEntry ?? beforeEntry)!.name,
      status,
      ...(status === "moved"
        ? { from: record.from, to: record.to, ...(record.ambiguous ? { ambiguous: true } : {}) }
        : {}),
      ...(request.details
        ? {
            before: beforeEntry
              ? {
                  storedSize: beforeEntry.file_size,
                  logicalSize: beforeHash!.logicalSize,
                  sha256: beforeHash!.sha256,
                  compressed: beforeEntry.is_compressed,
                }
              : undefined,
            after: afterEntry
              ? {
                  storedSize: afterEntry.file_size,
                  logicalSize: afterHash!.logicalSize,
                  sha256: afterHash!.sha256,
                  compressed: afterEntry.is_compressed,
                }
              : undefined,
          }
        : {}),
    };
    if (status === "changed" && beforeEntry && afterEntry) {
      const semantic = await semanticDiffForFile(
        beforePack,
        beforeEntry,
        afterPack,
        afterEntry,
        context,
        diagnostics,
        request.details,
      );
      if (semantic) {
        item.semantic = request.details
          ? semanticRecordPreview(semantic, request.semanticOffset, request.semanticLimit)
          : semantic;
        reportFiles.push(request.details ? { ...item, semantic } : item);
      } else {
        reportFiles.push(item);
      }
    } else {
      reportFiles.push(item);
    }
    files.push(item);
    if ((emittedCount & 127) === 0 || emittedCount === emittedRecords.length) context.progress?.({
      stage: "semantic", completed: emittedCount, total: emittedRecords.length, paths: emittedRecords.length,
      message: `Processed ${emittedCount} of ${emittedRecords.length} changed paths`,
    });
  }

  let affectedData: Record<string, unknown> | undefined;
  let affectedReportItems: unknown[] | undefined;
  let affectedSourcePaths: string[] = [];
  if (request.affectedUnits) {
    const affected = await runAffectedUnitAnalysis(request, context, beforePack, afterPack, emittedRecords);
    const { sourcePaths, reportItems, ...response } = affected;
    affectedData = response as Record<string, unknown>;
    affectedReportItems = reportItems;
    affectedSourcePaths = sourcePaths;
    diagnostics.push(...(affected.analysis.diagnostics as AutomationDiagnostic[]));
  }

  const metadata = metadataDifferences(beforePack, afterPack);
  const preview = files.slice(request.offset, request.offset + request.limit);
  const page = {
    offset: request.offset,
    limit: request.limit,
    nextOffset: request.offset + request.limit < files.length ? request.offset + request.limit : null,
    hasMore: request.offset + request.limit < files.length,
  };
  const data = {
    before: { path: beforePack.path, fileCount: beforePack.entries.length },
    after: { path: afterPack.path, fileCount: afterPack.entries.length },
    summary: {
      added: addedCount,
      removed: removedCount,
      changed: changedCount,
      identical: identicalCount,
      ...(request.detectMoves ? { movedCount } : {}),
      total: files.length,
      logicalSizeDelta,
      storedSizeDelta,
      metadata,
      packMetadataChanged: Object.keys(metadata).length > 0,
    },
    hasChanges:
      addedCount > 0 || removedCount > 0 || changedCount > 0 || movedCount > 0 || Object.keys(metadata).length > 0,
    total: files.length,
    ...page,
    files: preview,
    ...(affectedData ? { affectedUnits: affectedData } : {}),
  };
  let reportPath: string | undefined;
  if (request.reportPath) {
    const output = await context.policy.withAtomicOutput({
      outputPath: request.reportPath,
      sourcePaths: [beforePack.path, afterPack.path, ...affectedSourcePaths],
      produce: async (temporaryPath) => fs.promises.writeFile(
        temporaryPath,
        `${JSON.stringify({
          ...data,
          files: reportFiles,
          preview,
          ...(affectedData && affectedReportItems ? { affectedUnits: { ...affectedData, items: affectedReportItems } } : {}),
        }, null, 2)}\n`,
      ),
    });
    reportPath = output.path;
  }
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};
