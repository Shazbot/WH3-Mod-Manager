import * as fs from "node:fs/promises";
import { z } from "zod";
import {
  getRmv2MaterialLayout,
  parseRmv2,
  readRawPayload,
  resolveRmv2MaterialType,
  resolveRmv2TextureType,
  type Rmv2File,
  type Rmv2MaterialLayout,
  type Rmv2Part,
  type RawPackWriteMetadata,
  writeRawPack,
  readPackIndex,
} from "../packCore";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { AutomationError, throwIfAborted, type AutomationDiagnostic } from "./errors";
import { findAutomationPackEntry, readAutomationPack, readAutomationPayload } from "./packAccess";
import { normalizeInternalPackPath } from "./filesystem";
import type { AutomationContext } from "./operations";

const textureEditSchema = z
  .object({
    type: z.union([z.string().min(1).max(128), z.number().int().min(-0x80000000).max(0x7fffffff)]),
    path: z.string().nullable(),
  })
  .strict();

const editSchema = z
  .object({
    lodIndex: z.number().int().min(0).optional(),
    partIndex: z.number().int().min(0).optional(),
    textures: z.array(textureEditSchema).min(1).max(1000).optional(),
    materialType: z.union([z.string().min(1).max(128), z.number().int().min(0).max(0xffff)]).optional(),
    alphaMode: z.enum(["opaque", "transparent"]).optional(),
  })
  .strict()
  .refine(
    (edit) => edit.textures !== undefined || edit.materialType !== undefined || edit.alphaMode !== undefined,
    "each rigid edit must change textures, materialType, or alphaMode",
  );

export const rigidPatchSchema = z
  .object({
    operation: z.literal("rigid_patch"),
    packPath: z.string().min(1),
    filePath: z.string().min(1),
    outputPath: z.string().min(1),
    overwrite: z.boolean().default(false),
    edits: z.array(editSchema).min(1).max(1000),
    reportPath: z.string().min(1).optional(),
  })
  .strict();

type RigidPatchRequest = z.output<typeof rigidPatchSchema>;
type NormalizedTextureEdit = { typeId: number | null; typeName: string; path: string | null };
type NormalizedEdit = {
  lodIndex?: number;
  partIndex?: number;
  textures?: NormalizedTextureEdit[];
  materialType?: { typeId: number; typeName: string; layout?: Rmv2MaterialLayout };
  alphaMode?: "opaque" | "transparent";
};
type PartEditPlan = { edit: NormalizedEdit; properties: Set<string> };

const diagnostic = (code: string, message: string, path?: string): AutomationDiagnostic => ({
  code,
  message,
  severity: "warning",
  ...(path ? { path } : {}),
});

const isModelPath = (filePath: string) => filePath.toLowerCase().endsWith(".rigid_model_v2");
const partKey = (part: Rmv2Part) => `${part.lodIndex}:${part.partIndex}`;

const normalizedEdits = (request: RigidPatchRequest): NormalizedEdit[] =>
  request.edits.map((edit) => {
    const textures: NormalizedTextureEdit[] | undefined = edit.textures?.map((texture) => {
      if (typeof texture.path === "string") {
        if (texture.path.includes("\0"))
          throw new AutomationError("INVALID_ARGUMENT", "Texture paths cannot contain NUL characters");
        if (Buffer.from(texture.path, "utf8").toString("utf8") !== texture.path)
          throw new AutomationError("INVALID_ARGUMENT", "Texture paths must be valid UTF-8 strings");
        const size = Buffer.byteLength(texture.path, "utf8");
        if (size === 0)
          throw new AutomationError("INVALID_ARGUMENT", "Use path:null to remove or clear a texture slot");
        if (size > 255)
          throw new AutomationError(
            "INVALID_ARGUMENT",
            `Texture path exceeds the 255-byte RMV2 fixed-string capacity: ${size}`,
          );
      }
      const type = resolveRmv2TextureType(texture.type);
      if (!type)
        throw new AutomationError("INVALID_ARGUMENT", `Unknown RMV2 texture slot name: ${String(texture.type)}`);
      return { ...type, path: texture.path };
    });
    const seenTypes = new Set<string>();
    for (const texture of textures ?? []) {
      const typeKey = texture.typeId === null ? "TerrainTexturePath" : String(texture.typeId);
      if (seenTypes.has(typeKey))
        throw new AutomationError("CONFLICT", `A rigid edit targets texture slot ${typeKey} more than once`);
      seenTypes.add(typeKey);
    }
    let materialType: NormalizedEdit["materialType"];
    if (edit.materialType !== undefined) {
      const resolved = resolveRmv2MaterialType(edit.materialType);
      if (!resolved)
        throw new AutomationError("INVALID_ARGUMENT", `Unknown RMV2 material type: ${String(edit.materialType)}`);
      materialType = resolved;
    }
    return {
      ...(edit.lodIndex === undefined ? {} : { lodIndex: edit.lodIndex }),
      ...(edit.partIndex === undefined ? {} : { partIndex: edit.partIndex }),
      ...(textures ? { textures } : {}),
      ...(materialType ? { materialType } : {}),
      ...(edit.alphaMode ? { alphaMode: edit.alphaMode } : {}),
    };
  });

const selectedParts = (model: Rmv2File, edit: NormalizedEdit): Rmv2Part[] =>
  model.lods
    .filter((lod) => edit.lodIndex === undefined || lod.lodIndex === edit.lodIndex)
    .flatMap((lod) => lod.parts.filter((part) => edit.partIndex === undefined || part.partIndex === edit.partIndex));

const buildPartPlans = (model: Rmv2File, edits: readonly NormalizedEdit[]): Map<string, PartEditPlan[]> => {
  const plans = new Map<string, PartEditPlan[]>();
  const propertiesByPart = new Map<string, Set<string>>();
  for (const edit of edits) {
    const targets = selectedParts(model, edit);
    if (!targets.length) {
      throw new AutomationError(
        "VALIDATION",
        `Rigid edit selector matched no parts${edit.lodIndex === undefined ? "" : ` in LOD ${edit.lodIndex}`}${edit.partIndex === undefined ? "" : ` at part ${edit.partIndex}`}`,
      );
    }
    const properties = new Set<string>();
    if (edit.materialType) properties.add("materialType");
    if (edit.alphaMode) properties.add("alphaMode");
    for (const texture of edit.textures ?? [])
      properties.add(`texture:${texture.typeId === null ? "TerrainTexturePath" : texture.typeId}`);
    for (const part of targets) {
      if (!part.complete)
        throw new AutomationError(
          "UNSUPPORTED",
          `Cannot patch unsupported RMV2 material at LOD ${part.lodIndex} part ${part.partIndex}: ${part.unsupportedReason ?? "unsupported layout"}`,
        );
      const currentLayout = getRmv2MaterialLayout(part.materialTypeId);
      if (!currentLayout)
        throw new AutomationError(
          "UNSUPPORTED",
          `Cannot patch unsupported material type ${part.materialTypeId} at LOD ${part.lodIndex} part ${part.partIndex}`,
        );
      if (edit.materialType && edit.materialType.layout !== currentLayout) {
        throw new AutomationError(
          "UNSUPPORTED",
          `Material type conversion from ${part.materialTypeName} to ${edit.materialType.typeName} changes the registered layout`,
        );
      }
      if (edit.alphaMode && currentLayout !== "weighted") {
        throw new AutomationError("UNSUPPORTED", `Alpha mode is not encoded for ${part.materialTypeName}`);
      }
      if (edit.alphaMode && part.alphaMode?.reason === "duplicate") {
        throw new AutomationError(
          "UNSUPPORTED",
          `Cannot change duplicate alpha parameter records at LOD ${part.lodIndex} part ${part.partIndex}`,
        );
      }
      for (const texture of edit.textures ?? []) {
        if (currentLayout === "customTerrain") {
          if (texture.typeName !== "TerrainTexturePath" || texture.typeId !== null) {
            throw new AutomationError("UNSUPPORTED", `Custom terrain exposes only its TerrainTexturePath field`);
          }
        } else if (currentLayout === "terrainTiles") {
          throw new AutomationError("UNSUPPORTED", "Terrain tile materials do not encode texture slots");
        } else if (texture.typeId === null) {
          throw new AutomationError("UNSUPPORTED", "TerrainTexturePath is valid only for custom terrain materials");
        }
      }
      const key = partKey(part);
      const seen = propertiesByPart.get(key) ?? new Set<string>();
      for (const property of properties) {
        if (seen.has(property))
          throw new AutomationError(
            "CONFLICT",
            `Overlapping rigid edits target ${property} at LOD ${part.lodIndex} part ${part.partIndex}`,
          );
        seen.add(property);
      }
      propertiesByPart.set(key, seen);
      const values = plans.get(key) ?? [];
      values.push({ edit, properties: new Set(properties) });
      plans.set(key, values);
    }
  }
  return plans;
};

const writePath = (buffer: Buffer, offset: number, capacity: number, value: string | null): void => {
  buffer.fill(0, offset, offset + capacity);
  if (value === null) return;
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > capacity - 1)
    throw new AutomationError(
      "INVALID_ARGUMENT",
      `Texture path exceeds the ${capacity - 1}-byte RMV2 fixed-string capacity`,
    );
  encoded.copy(buffer, offset);
};

const buildWeightedMaterial = (
  part: Rmv2Part,
  textureEdits: readonly NormalizedTextureEdit[],
  alphaMode?: "opaque" | "transparent",
): Buffer => {
  const original = part.raw.material.bytes;
  const fixedSize = 860;
  if (original.length < fixedSize) throw new AutomationError("VALIDATION", "Weighted material span is truncated");
  const fixed = Buffer.from(original.subarray(0, fixedSize));
  const attachmentsCount = fixed.readUInt32LE(712);
  const textureCount = fixed.readUInt32LE(716);
  const stringCount = fixed.readUInt32LE(720);
  const floatCount = fixed.readUInt32LE(724);
  const intCount = fixed.readUInt32LE(728);
  const vec4Count = fixed.readUInt32LE(732);
  let cursor = fixedSize;
  const attachmentsLength = attachmentsCount * 84;
  const attachments = Buffer.from(original.subarray(cursor, cursor + attachmentsLength));
  cursor += attachmentsLength;
  const textureStart = cursor;
  const textureRecords = Array.from({ length: textureCount }, (_, index) =>
    Buffer.from(original.subarray(textureStart + index * 260, textureStart + (index + 1) * 260)),
  );
  cursor += textureCount * 260;
  const stringsStart = cursor;
  for (let index = 0; index < stringCount; index++) {
    if (cursor + 6 > original.length)
      throw new AutomationError("VALIDATION", "Weighted string parameter span is truncated");
    const byteLength = original.readInt16LE(cursor + 4);
    if (byteLength < 0 || cursor + 6 + byteLength > original.length)
      throw new AutomationError("VALIDATION", "Weighted string parameter has an invalid size");
    cursor += 6 + byteLength;
  }
  const strings = Buffer.from(original.subarray(stringsStart, cursor));
  const floatsStart = cursor;
  const floatsLength = floatCount * 8;
  const floats = Buffer.from(original.subarray(floatsStart, floatsStart + floatsLength));
  cursor += floatsLength;
  const intsStart = cursor;
  const intRecords = Array.from({ length: intCount }, (_, index) =>
    Buffer.from(original.subarray(intsStart + index * 8, intsStart + (index + 1) * 8)),
  );
  cursor += intCount * 8;
  const vec4Length = vec4Count * 20;
  const vec4s = Buffer.from(original.subarray(cursor, cursor + vec4Length));
  cursor += vec4Length;
  if (cursor > original.length)
    throw new AutomationError("VALIDATION", "Weighted material parameter span is truncated");
  const tail = Buffer.from(original.subarray(cursor));

  for (const edit of textureEdits) {
    const matches = textureRecords.flatMap((record, index) => (record.readInt32LE(0) === edit.typeId ? [index] : []));
    if (matches.length > 1)
      throw new AutomationError("CONFLICT", `Texture type ${edit.typeId} is duplicated; refusing an ambiguous patch`);
    if (edit.path === null) {
      if (!matches.length)
        throw new AutomationError("VALIDATION", `Texture type ${edit.typeId} is not present and cannot be removed`);
      textureRecords.splice(matches[0], 1);
    } else if (matches.length) {
      writePath(textureRecords[matches[0]], 4, 256, edit.path);
    } else {
      const record = Buffer.alloc(260);
      record.writeInt32LE(edit.typeId!, 0);
      writePath(record, 4, 256, edit.path);
      textureRecords.push(record);
    }
  }
  if (alphaMode) {
    const alphaRecords = intRecords.filter((record) => record.readInt32LE(0) === 0);
    if (alphaRecords.length > 1)
      throw new AutomationError("UNSUPPORTED", "Duplicate alpha parameter records cannot be rewritten safely");
    const encodedAlpha = alphaMode === "transparent" ? 1 : 0;
    if (alphaRecords.length) alphaRecords[0].writeInt32LE(encodedAlpha, 4);
    else {
      const record = Buffer.alloc(8);
      record.writeInt32LE(0, 0);
      record.writeInt32LE(encodedAlpha, 4);
      intRecords.push(record);
    }
  }
  fixed.writeUInt32LE(textureRecords.length, 716);
  fixed.writeUInt32LE(intRecords.length, 728);
  return Buffer.concat([fixed, attachments, ...textureRecords, strings, floats, ...intRecords, vec4s, tail]);
};

const buildMaterial = (part: Rmv2Part, edits: readonly PartEditPlan[]): { materialTypeId: number; bytes: Buffer } => {
  let materialTypeId = part.materialTypeId;
  let alphaMode: "opaque" | "transparent" | undefined;
  const textureEdits: NormalizedTextureEdit[] = [];
  for (const { edit } of edits) {
    if (edit.materialType) materialTypeId = edit.materialType.typeId;
    if (edit.alphaMode) alphaMode = edit.alphaMode;
    textureEdits.push(...(edit.textures ?? []));
  }
  const layout = getRmv2MaterialLayout(part.materialTypeId);
  if (layout === "weighted") return { materialTypeId, bytes: buildWeightedMaterial(part, textureEdits, alphaMode) };
  if (layout === "customTerrain") {
    const output = Buffer.from(part.raw.material.bytes);
    for (const edit of textureEdits) writePath(output, 0, 256, edit.path);
    return { materialTypeId, bytes: output };
  }
  return { materialTypeId, bytes: Buffer.from(part.raw.material.bytes) };
};

const rebuildPart = (part: Rmv2Part, edits?: readonly PartEditPlan[]): Buffer => {
  const common = Buffer.from(part.raw.commonHeader.bytes);
  const material = edits?.length
    ? buildMaterial(part, edits)
    : { materialTypeId: part.materialTypeId, bytes: Buffer.from(part.raw.material.bytes) };
  const vertices = part.raw.vertices.bytes;
  const indices = part.raw.indices.bytes;
  const padding = part.raw.sectionPadding.bytes;
  const vertexOffset = common.length + material.bytes.length;
  const indexOffset = vertexOffset + vertices.length;
  const sectionSize = indexOffset + indices.length + padding.length;
  if (
    !Number.isSafeInteger(sectionSize) ||
    sectionSize > 0xffffffff ||
    vertexOffset > 0xffffffff ||
    indexOffset > 0xffffffff
  ) {
    throw new AutomationError(
      "VALIDATION",
      `Rebuilt section exceeds the RMV2 32-bit offset limit at LOD ${part.lodIndex} part ${part.partIndex}`,
    );
  }
  common.writeUInt16LE(material.materialTypeId, 0);
  common.writeUInt32LE(sectionSize, 4);
  common.writeUInt32LE(vertexOffset, 8);
  common.writeUInt32LE(indexOffset, 16);
  return Buffer.concat([common, material.bytes, vertices, indices, padding]);
};

const rebuildModel = (
  bytes: Buffer,
  model: Rmv2File,
  plans: ReadonlyMap<string, PartEditPlan[]>,
  signal?: AbortSignal,
): Buffer => {
  const headersEnd = model.raw.header.length + model.raw.lodHeaders.length;
  const headerBytes = Buffer.concat([model.raw.header.bytes, model.raw.lodHeaders.bytes]);
  const ranges = model.lods
    .filter((lod) => lod.meshCount > 0)
    .map((lod) => ({
      lod,
      start: lod.firstMeshOffset,
      end: lod.firstMeshOffset + lod.parts.reduce((total, part) => total + part.meshSectionSize, 0),
    }))
    .sort((left, right) => left.start - right.start || left.lod.lodIndex - right.lod.lodIndex);
  const chunks: Buffer[] = [headerBytes];
  let inputCursor = headersEnd;
  let outputCursor = headersEnd;
  const rebasedOffsets = new Map<number, number>([[headersEnd, headersEnd]]);
  for (const range of ranges) {
    throwIfAborted(signal);
    if (range.start < inputCursor || range.end > bytes.length)
      throw new AutomationError("VALIDATION", "RMV2 physical LOD range is invalid during rebuild");
    const gap = bytes.subarray(inputCursor, range.start);
    rebasedOffsets.set(inputCursor, outputCursor);
    chunks.push(gap);
    outputCursor += gap.length;
    rebasedOffsets.set(range.start, outputCursor);
    if (outputCursor > 0xffffffff)
      throw new AutomationError("VALIDATION", "Rebuilt RMV2 offsets exceed the 32-bit format limit");
    headerBytes.writeUInt32LE(outputCursor, range.lod.raw.offset + 12);
    const sections = range.lod.parts.map((part) => rebuildPart(part, plans.get(partKey(part))));
    chunks.push(...sections);
    outputCursor += sections.reduce((size, section) => size + section.length, 0);
    if (!Number.isSafeInteger(outputCursor) || outputCursor > 0xffffffff)
      throw new AutomationError("VALIDATION", "Rebuilt RMV2 offsets exceed the 32-bit format limit");
    inputCursor = range.end;
    rebasedOffsets.set(range.end, outputCursor);
  }
  const trailing = bytes.subarray(inputCursor);
  chunks.push(trailing);
  const rebuiltLength = outputCursor + trailing.length;
  if (!Number.isSafeInteger(rebuiltLength) || rebuiltLength > 0xffffffff)
    throw new AutomationError("VALIDATION", "Rebuilt RMV2 offsets exceed the 32-bit format limit");
  rebasedOffsets.set(bytes.length, rebuiltLength);
  for (const lod of model.lods) {
    if (lod.meshCount > 0 || lod.firstMeshOffset === 0) continue;
    const rebased = rebasedOffsets.get(lod.firstMeshOffset);
    if (rebased !== undefined) headerBytes.writeUInt32LE(rebased, lod.raw.offset + 12);
  }
  return Buffer.concat(chunks);
};

const resolveOutputTypeAndEdits = (request: RigidPatchRequest, model: Rmv2File) => {
  const edits = normalizedEdits(request);
  const plans = buildPartPlans(model, edits);
  return { edits, plans };
};

const verifyPatchedModel = (
  before: Rmv2File,
  after: Rmv2File,
  edits: readonly NormalizedEdit[],
  plans: ReadonlyMap<string, PartEditPlan[]>,
): void => {
  if (
    after.version !== before.version ||
    after.skeletonName !== before.skeletonName ||
    after.lods.length !== before.lods.length
  ) {
    throw new AutomationError("VALIDATION", "Rebuilt RMV2 changed its version, skeleton, or LOD count");
  }
  for (const beforeLod of before.lods) {
    const afterLod = after.lods[beforeLod.lodIndex];
    if (!afterLod || beforeLod.parts.length !== afterLod.parts.length)
      throw new AutomationError("VALIDATION", `Rebuilt RMV2 changed LOD ${beforeLod.lodIndex} part count`);
    for (const beforePart of beforeLod.parts) {
      const afterPart = afterLod.parts[beforePart.partIndex];
      if (
        !afterPart ||
        !beforePart.raw.vertices.bytes.equals(afterPart.raw.vertices.bytes) ||
        !beforePart.raw.indices.bytes.equals(afterPart.raw.indices.bytes) ||
        !beforePart.raw.sectionPadding.bytes.equals(afterPart.raw.sectionPadding.bytes)
      ) {
        throw new AutomationError(
          "VALIDATION",
          `Rebuilt RMV2 changed geometry or section padding at LOD ${beforePart.lodIndex} part ${beforePart.partIndex}`,
        );
      }
      if (!plans.has(partKey(beforePart)) && !beforePart.raw.material.bytes.equals(afterPart.raw.material.bytes)) {
        throw new AutomationError(
          "VALIDATION",
          `Rebuilt RMV2 changed an untouched material at LOD ${beforePart.lodIndex} part ${beforePart.partIndex}`,
        );
      }
    }
  }
  if (
    !before.trailing.bytes.equals(after.trailing.bytes) ||
    before.interstitial.length !== after.interstitial.length ||
    before.interstitial.some((span, index) => !span.bytes.equals(after.interstitial[index].bytes))
  ) {
    throw new AutomationError("VALIDATION", "Rebuilt RMV2 changed interstitial or trailing bytes");
  }
  for (const edit of edits) {
    for (const part of selectedParts(after, edit)) {
      if (edit.materialType && part.materialTypeId !== edit.materialType.typeId)
        throw new AutomationError(
          "VALIDATION",
          `Material type edit was not preserved at LOD ${part.lodIndex} part ${part.partIndex}`,
        );
      if (edit.alphaMode && part.alphaMode?.value !== edit.alphaMode)
        throw new AutomationError(
          "VALIDATION",
          `Alpha mode edit was not preserved at LOD ${part.lodIndex} part ${part.partIndex}`,
        );
      for (const texture of edit.textures ?? []) {
        const matches = (part.textures ?? []).filter((candidate) => candidate.typeId === texture.typeId);
        if (texture.path === null) {
          if (matches.length !== 0 && texture.typeId !== null)
            throw new AutomationError(
              "VALIDATION",
              `Texture removal was not preserved at LOD ${part.lodIndex} part ${part.partIndex}`,
            );
          if (texture.typeId === null && matches.some((candidate) => candidate.path !== ""))
            throw new AutomationError(
              "VALIDATION",
              `Terrain texture clearing was not preserved at LOD ${part.lodIndex} part ${part.partIndex}`,
            );
        } else if (matches.length !== 1 || matches[0].path !== texture.path) {
          throw new AutomationError(
            "VALIDATION",
            `Texture edit was not preserved at LOD ${part.lodIndex} part ${part.partIndex}`,
          );
        }
      }
    }
  }
};

export const runRigidPatch = async (request: RigidPatchRequest, context: AutomationContext) => {
  const pack = await readAutomationPack(request.packPath, context);
  const entry = findAutomationPackEntry(pack, request.filePath);
  if (!isModelPath(entry.name))
    throw new AutomationError("INVALID_ARGUMENT", `rigid_patch requires a .rigid_model_v2 entry: ${entry.name}`);
  const originalBytes = await readAutomationPayload(pack, entry, context);
  let original: Rmv2File;
  try {
    original = parseRmv2(originalBytes);
  } catch (error) {
    throw new AutomationError(
      error && typeof error === "object" && "code" in error && error.code === "UNSUPPORTED"
        ? "UNSUPPORTED"
        : "VALIDATION",
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
  const { edits, plans } = resolveOutputTypeAndEdits(request, original);
  const editedBytes = rebuildModel(originalBytes, original, plans, context.signal);
  const preflight = parseRmv2(editedBytes);
  verifyPatchedModel(original, preflight, edits, plans);
  const metadata: RawPackWriteMetadata = {
    game: "wh3",
    byteMask: 3,
    refFileCount: 0,
    headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
    dependencies: [],
  };
  const normalizedFilePath = normalizeInternalPackPath(entry.name);
  const published = await context.policy.withAtomicOutput({
    outputPath: request.outputPath,
    overwrite: request.overwrite,
    sourcePaths: [pack.path],
    produce: (temporaryPath) =>
      writeRawPack(temporaryPath, [{ name: normalizedFilePath, buffer: editedBytes, is_compressed: false }], metadata),
    validate: async (temporaryPath) => {
      throwIfAborted(context.signal);
      const outputPack = readPackIndex(temporaryPath, { game: "wh3" });
      if (
        (outputPack.header.byteMask & 0x7) !== 3 ||
        outputPack.dependencies.length !== 0 ||
        outputPack.entries.length !== 1
      ) {
        throw new AutomationError("VALIDATION", "Rigid patch output is not a single-model MOD pack");
      }
      const outputEntry = outputPack.entries[0];
      if (normalizePackFilePathKey(outputEntry.name) !== normalizePackFilePathKey(normalizedFilePath)) {
        throw new AutomationError("VALIDATION", "Rigid patch output changed the internal model path");
      }
      const outputBytes = readRawPayload(outputPack, outputEntry);
      const verified = parseRmv2(outputBytes);
      verifyPatchedModel(original, verified, edits, plans);
    },
  });
  const data = {
    inputPath: pack.path,
    outputPath: published.path,
    filePath: normalizedFilePath,
    fileCount: 1,
    version: original.version,
    editedParts: [...plans.keys()],
    editCount: request.edits.length,
    validationComplete: preflight.validationComplete,
  };
  let reportPath: string | undefined;
  if (request.reportPath) {
    const report = await context.policy.withAtomicOutput({
      outputPath: request.reportPath,
      sourcePaths: [pack.path, published.path],
      produce: async (temporaryPath) => fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`),
    });
    reportPath = report.path;
  }
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics: [] as AutomationDiagnostic[] };
};
