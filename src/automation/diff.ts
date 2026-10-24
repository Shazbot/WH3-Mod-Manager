import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { getSupportedVisualReferenceDetails, type VisualReferenceDetail, type UnsupportedVisualReferenceDetail } from "../visuals/dependencies";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { parseDBTablePath } from "../utility/packFileHelpers";
import type { CorePack, CorePackEntry, ParsedDbTable } from "../packCore";
import { decodePackedTextBuffer } from "../utility/packFileViewing";
import { AutomationError, throwIfAborted, yieldToEventLoop, type AutomationDiagnostic } from "./errors";
import {
  getAutomationSchemaProvider,
  readAutomationPack,
  readAutomationPayload,
} from "./packAccess";
import { loadPackedTable, tableRowsToJson, type TableRow } from "./tables";
import type { AutomationContext } from "./operations";

export const packDiffSchema = z.object({
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
}).strict();

type DiffRequest = z.output<typeof packDiffSchema>;

const diagnostic = (code: string, message: string, severity: AutomationDiagnostic["severity"] = "warning", path?: string): AutomationDiagnostic => ({
  code,
  message,
  severity,
  ...(path ? { path } : {}),
});

const indexByCanonicalPath = (pack: CorePack): Map<string, CorePackEntry> => {
  const result = new Map<string, CorePackEntry>();
  for (const entry of pack.entries) {
    const key = normalizePackFilePathKey(entry.name);
    if (result.has(key)) throw new AutomationError("CONFLICT", `Pack contains duplicate normalized file path: ${entry.name}`, { packPath: pack.path, key });
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
  table.schema.fields.flatMap((field) => (isLoc ? field.name === "key" : field.is_key) ? [field.name] : []);

const multisetDiff = (beforeRows: readonly TableRow[], afterRows: readonly TableRow[], fields: readonly { name: string }[], includeDetails: boolean) => {
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

const semanticDbDiff = (before: ParsedDbTable, after: ParsedDbTable, beforeLoc: boolean, afterLoc: boolean, includeDetails: boolean) => {
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
  const modified: Array<{ key: Record<string, unknown>; fields: Array<{ field: string; before: unknown; after: unknown }> }> = [];
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
    const changes = fields.flatMap((field) => oldRow[field.name] === newRow[field.name] ? [] : [{ field: field.name, before: oldRow[field.name], after: newRow[field.name] }]);
    if (changes.length) {
      modifiedCount += 1;
      if (includeDetails) modified.push({ key: Object.fromEntries(keyNames.map((name) => [name, newRow[name]])), fields: changes });
    }
  }
  for (const [key, values] of beforeByKey) if (!afterByKey.has(key)) {
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

const referenceIdentity = (reference: VisualReferenceDetail | UnsupportedVisualReferenceDetail): string => JSON.stringify([
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
      if (!semantic) diagnostics.push(diagnostic("DB_SCHEMA_MISMATCH", "DB semantic comparison was skipped because table versions or field layouts differ", "warning", beforeEntry.name));
      return semantic ? { type: "db-rows" as const, ...semantic } : { type: "db-rows" as const, available: false };
    } catch (error) {
      if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
      const code = error instanceof AutomationError && error.code === "UNSUPPORTED" ? "DB_SCHEMA_UNAVAILABLE" : "DB_PARSE_FAILED";
      diagnostics.push(diagnostic(code, error instanceof Error ? error.message : String(error), "warning", beforeEntry.name));
      return { type: "db-rows" as const, available: false };
    }
  }
  const extension = beforeEntry.name.toLowerCase();
  if (!extension.endsWith(".variantmeshdefinition") && !extension.endsWith(".wsmodel") && !extension.endsWith(".xml.material")) return undefined;
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
      diagnostics.push(diagnostic("XML_PARSE_FAILED", "XML reference comparison was skipped because a document is invalid", "warning", beforeEntry.name));
      return { type: "xml-references" as const, available: false };
    }
    if (beforeRefs.unsupportedReferences.length || afterRefs.unsupportedReferences.length) {
      diagnostics.push(diagnostic("UNSUPPORTED_XML_REFERENCES", "Some XML references use unsupported extensions and were excluded from semantic reference comparison", "warning", beforeEntry.name));
    }
    const supported = detailMultisetDiff(beforeRefs.references, afterRefs.references, includeDetails);
    const unsupported = detailMultisetDiff(beforeRefs.unsupportedReferences, afterRefs.unsupportedReferences, includeDetails);
    return {
      type: "xml-references" as const,
      semanticScope: "supportedReferences" as const,
      addedCount: supported.addedCount,
      removedCount: supported.removedCount,
      unsupportedAddedCount: unsupported.addedCount,
      unsupportedRemovedCount: unsupported.removedCount,
      ...(includeDetails ? {
        added: supported.added,
        removed: supported.removed,
        unsupportedAdded: unsupported.added,
        unsupportedRemoved: unsupported.removed,
      } : {}),
    };
  } catch (error) {
    if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
    diagnostics.push(diagnostic("XML_PARSE_FAILED", error instanceof Error ? error.message : String(error), "warning", beforeEntry.name));
    return { type: "xml-references" as const, available: false };
  }
};

const metadataDifferences = (before: CorePack, after: CorePack): Record<string, { before: unknown; after: unknown }> => {
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
  return Object.fromEntries(Object.entries(values).flatMap(([key, [oldValue, newValue]]) =>
    JSON.stringify(oldValue) === JSON.stringify(newValue) ? [] : [[key, { before: oldValue, after: newValue }]],
  ));
};

const semanticRecordPreview = (semantic: Record<string, unknown>, offset: number, limit: number) => {
  const recordGroups = ["added", "deleted", "removed", "modified", "unsupportedAdded", "unsupportedRemoved"] as const;
  const records: Array<{ kind: string; record: unknown }> = [];
  for (const kind of recordGroups) {
    const items = semantic[kind];
    if (Array.isArray(items)) for (const record of items) records.push({ kind, record });
  }
  const totalRecords = Number(semantic.addedCount ?? 0) + Number(semantic.deletedCount ?? semantic.removedCount ?? 0) +
    Number(semantic.modifiedCount ?? 0) + Number(semantic.unsupportedAddedCount ?? 0) + Number(semantic.unsupportedRemovedCount ?? 0);
  return {
    type: semantic.type,
    mode: semantic.mode,
    semanticScope: semantic.semanticScope,
    available: semantic.available,
    addedCount: semantic.addedCount,
    deletedCount: semantic.deletedCount,
    removedCount: semantic.removedCount,
    modifiedCount: semantic.modifiedCount,
    unsupportedAddedCount: semantic.unsupportedAddedCount,
    unsupportedRemovedCount: semantic.unsupportedRemovedCount,
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
    const status = !beforeEntry ? "added" : !afterEntry ? "removed" : beforeHash!.sha256 === afterHash!.sha256 ? "identical" : "changed";
    if (status === "added") addedCount += 1;
    else if (status === "removed") removedCount += 1;
    else if (status === "changed") changedCount += 1;
    else identicalCount += 1;
    logicalSizeDelta += (afterHash?.logicalSize ?? 0) - (beforeHash?.logicalSize ?? 0);
    storedSizeDelta += (afterEntry?.file_size ?? 0) - (beforeEntry?.file_size ?? 0);
    const item: Record<string, unknown> = {
      path: (afterEntry ?? beforeEntry)!.name,
      status,
      ...(request.details ? {
        before: beforeEntry ? { storedSize: beforeEntry.file_size, logicalSize: beforeHash!.logicalSize, sha256: beforeHash!.sha256, compressed: beforeEntry.is_compressed } : undefined,
        after: afterEntry ? { storedSize: afterEntry.file_size, logicalSize: afterHash!.logicalSize, sha256: afterHash!.sha256, compressed: afterEntry.is_compressed } : undefined,
      } : {}),
    };
    if (status === "changed" && beforeEntry && afterEntry) {
      const semantic = await semanticDiffForFile(beforePack, beforeEntry, afterPack, afterEntry, context, diagnostics, request.details);
      if (semantic) {
        item.semantic = request.details ? semanticRecordPreview(semantic, request.semanticOffset, request.semanticLimit) : semantic;
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
      produce: async (temporaryPath) => fs.promises.writeFile(temporaryPath, `${JSON.stringify({ ...data, files: reportFiles, preview }, null, 2)}\n`),
    });
    reportPath = output.path;
  }
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};
