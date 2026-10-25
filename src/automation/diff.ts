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
import { AutomationError, throwIfAborted, yieldToEventLoop, type AutomationDiagnostic } from "./errors";
import { getAutomationSchemaProvider, readAutomationPack, readAutomationPayload } from "./packAccess";
import { loadPackedTable, tableRowsToJson, type TableRow } from "./tables";
import type { AutomationContext } from "./operations";

export const packDiffSchema = z
  .object({
    operation: z.literal("pack_diff"),
    beforePath: z.string().min(1),
    afterPath: z.string().min(1),
    pathPrefix: z.string().optional(),
    glob: z.string().optional(),
    fileTypes: z.array(z.string().min(1)).max(256).optional(),
    details: z.boolean().default(false),
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
  const recordGroups = ["added", "deleted", "removed", "modified", "unsupportedAdded", "unsupportedRemoved"] as const;
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
    Number(semantic.unsupportedRemovedCount ?? 0);
  return {
    type: semantic.type,
    mode: semantic.mode,
    semanticScope: semantic.semanticScope,
    available: semantic.available,
    complete: semantic.complete,
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

export const runPackDiff = async (request: DiffRequest, context: AutomationContext) => {
  const [beforePack, afterPack] = await Promise.all([
    readAutomationPack(request.beforePath, context),
    readAutomationPack(request.afterPath, context),
  ]);
  const beforeEntries = indexByCanonicalPath(beforePack);
  const afterEntries = indexByCanonicalPath(afterPack);
  const allKeys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])]
    .filter((key) => pathMatches((afterEntries.get(key) ?? beforeEntries.get(key))!.name, request))
    .sort();
  const diagnostics: AutomationDiagnostic[] = [];
  const files: Array<Record<string, unknown>> = [];
  const reportFiles: Array<Record<string, unknown>> = [];
  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;
  let identicalCount = 0;
  let logicalSizeDelta = 0;
  let storedSizeDelta = 0;

  let comparedEntries = 0;
  for (const key of allKeys) {
    throwIfAborted(context.signal);
    if ((comparedEntries++ & 127) === 0) await yieldToEventLoop(context.signal);
    const beforeEntry = beforeEntries.get(key);
    const afterEntry = afterEntries.get(key);
    const beforeHash = beforeEntry ? await hashEntry(beforePack, beforeEntry, context) : undefined;
    const afterHash = afterEntry ? await hashEntry(afterPack, afterEntry, context) : undefined;
    const status = !beforeEntry
      ? "added"
      : !afterEntry
        ? "removed"
        : beforeHash!.sha256 === afterHash!.sha256
          ? "identical"
          : "changed";
    if (status === "added") addedCount += 1;
    else if (status === "removed") removedCount += 1;
    else if (status === "changed") changedCount += 1;
    else identicalCount += 1;
    logicalSizeDelta += (afterHash?.logicalSize ?? 0) - (beforeHash?.logicalSize ?? 0);
    storedSizeDelta += (afterEntry?.file_size ?? 0) - (beforeEntry?.file_size ?? 0);
    const item: Record<string, unknown> = {
      path: (afterEntry ?? beforeEntry)!.name,
      status,
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
      total: files.length,
      logicalSizeDelta,
      storedSizeDelta,
      metadata,
      packMetadataChanged: Object.keys(metadata).length > 0,
    },
    hasChanges: addedCount > 0 || removedCount > 0 || changedCount > 0 || Object.keys(metadata).length > 0,
    total: files.length,
    ...page,
    files: preview,
  };
  let reportPath: string | undefined;
  if (request.reportPath) {
    const output = await context.policy.withAtomicOutput({
      outputPath: request.reportPath,
      sourcePaths: [beforePack.path, afterPack.path],
      produce: async (temporaryPath) =>
        fs.promises.writeFile(temporaryPath, `${JSON.stringify({ ...data, files: reportFiles, preview }, null, 2)}\n`),
    });
    reportPath = output.path;
  }
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};
