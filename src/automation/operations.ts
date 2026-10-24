import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import type { Field } from "../packFileTypes";
import { parseDBTablePath } from "../utility/packFileHelpers";
import { decodePackedTextBuffer, isTextPackedFilePath } from "../utility/packFileViewing";
import { createSearchMatcher } from "../globalSearch/matcher";
import { scanTextForMatches } from "../globalSearch/textScan";
import {
  DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES,
  readPackIndex,
  rewriteDbTableRows,
  serializeSchemaFieldToBuffer,
  writeRawPack,
  type CorePack,
  type DbSerializedCell,
  type ParsedDbTable,
  type RawPackWriteEntry,
  type RawPackWriteMetadata,
} from "../packCore";
import { hasPackedFileNameHash } from "../utility/packFileIndex";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import {
  applyRecordToCells,
  jsonValueFromCell,
  loadPackedTable,
  makeRowFields,
  queryTableRows,
  tableRowsToJson,
  type TableFilter,
  type TableRow,
  type TableSchemaProvider,
  type TableSort,
} from "./tables";
import { AutomationError, throwIfAborted, yieldToEventLoop, type AutomationDiagnostic } from "./errors";
import { packDiffSchema, runPackDiff } from "./diff";
import {
  assetFindReferencesSchema,
  assetResolveReferencesSchema,
  runAssetFindReferences,
  runAssetResolveReferences,
} from "./references";
import { packSubsetSchema, runPackSubset } from "./subset";
import { localizationLookupSchema, runLocalizationLookup } from "./localization";
import { unitResolveSchema, runUnitResolve } from "./units";
import { packTextureInspectSchema, runPackTextureInspect } from "./textures";
import { FilesystemPolicy, normalizeInternalPackPath } from "./filesystem";
import {
  findAutomationPackEntry as findEntry,
  getAutomationSchemaProvider as schemaProviderFor,
  readAutomationPack as readIndex,
  readAutomationPayload as readLogical,
  readAutomationReadonlyTable,
} from "./packAccess";
import type { AutomationCacheRequestScope, AutomationCacheService } from "./cacheService";

const pageShape = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(100),
  reportPath: z.string().min(1).optional(),
};
const createFileSchema = z.object({
  path: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
  text: z.string().optional(),
}).strict().refine(
  (value) => Number(value.sourcePath !== undefined) + Number(value.text !== undefined) === 1,
  "create file requires exactly one of sourcePath or text",
);
const fileChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: z.string().min(1), sourcePath: z.string().min(1).optional(), text: z.string().optional() })
    .strict()
    .refine((value) => Number(value.sourcePath !== undefined) + Number(value.text !== undefined) === 1, "add requires exactly one of sourcePath or text"),
  z.object({ op: z.literal("replace"), path: z.string().min(1), sourcePath: z.string().min(1).optional(), text: z.string().optional() })
    .strict()
    .refine((value) => Number(value.sourcePath !== undefined) + Number(value.text !== undefined) === 1, "replace requires exactly one of sourcePath or text"),
  z.object({ op: z.literal("remove"), path: z.string().min(1) }).strict(),
]);
const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in", "contains"]),
  value: z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))]),
}).strict();
const sortSchema = z.object({ field: z.string().min(1), direction: z.enum(["asc", "desc"]) }).strict();
const patchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("insert"), row: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ op: z.literal("update"), where: z.array(filterSchema).max(1000), set: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ op: z.literal("delete"), where: z.array(filterSchema).max(1000) }).strict(),
]);

export const operationSchemas = {
  pack_info: z.object({ operation: z.literal("pack_info"), packPath: z.string().min(1), reportPath: z.string().min(1).optional() }).strict(),
  pack_list_files: z.object({
    operation: z.literal("pack_list_files"), packPath: z.string().min(1), pathPrefix: z.string().optional(), glob: z.string().optional(),
    ...pageShape,
  }).strict(),
  pack_read_file: z.object({
    operation: z.literal("pack_read_file"), packPath: z.string().min(1), filePath: z.string().min(1),
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(65536).default(65536),
    extractTo: z.string().min(1).optional(), overwrite: z.boolean().default(false), reportPath: z.string().min(1).optional(),
  }).strict(),
  pack_search: z.object({
    operation: z.literal("pack_search"), packPath: z.string().min(1), query: z.string().min(1).max(2048),
    caseSensitive: z.boolean().default(false), regex: z.boolean().default(false), fileGlob: z.string().optional(),
    content: z.boolean().default(true), maxResults: z.number().int().min(1).max(10000).default(1000),
    reportPath: z.string().min(1).optional(),
  }).strict(),
  pack_read_table: z.object({
    operation: z.literal("pack_read_table"), packPath: z.string().min(1), tablePath: z.string().min(1),
    columns: z.array(z.string().min(1)).max(1024).optional(), ...pageShape,
  }).strict(),
  pack_query_table: z.object({
    operation: z.literal("pack_query_table"), packPath: z.string().min(1), tablePath: z.string().min(1),
    filters: z.array(filterSchema).max(1000).default([]), columns: z.array(z.string().min(1)).max(1024).optional(),
    sort: z.array(sortSchema).max(128).default([]), ...pageShape,
  }).strict(),
  pack_create: z.object({
    operation: z.literal("pack_create"), outputPath: z.string().min(1), overwrite: z.boolean().default(false),
    packType: z.enum(["mod", "movie"]).default("mod"), dependencies: z.array(z.string()).default([]),
    files: z.array(createFileSchema).default([]),
    reportPath: z.string().min(1).optional(),
  }).strict(),
  pack_write_files: z.object({
    operation: z.literal("pack_write_files"), packPath: z.string().min(1), outputPath: z.string().min(1), overwrite: z.boolean().default(false),
    files: z.array(fileChangeSchema).min(1).max(10000), reportPath: z.string().min(1).optional(),
  }).strict(),
  pack_patch_table: z.object({
    operation: z.literal("pack_patch_table"), packPath: z.string().min(1), outputPath: z.string().min(1), tablePath: z.string().min(1),
    overwrite: z.boolean().default(false), patches: z.array(patchSchema).min(1).max(10000), reportPath: z.string().min(1).optional(),
  }).strict(),
  pack_validate: z.object({
    operation: z.literal("pack_validate"), packPath: z.string().min(1), fullPayloads: z.boolean().default(false),
    reportPath: z.string().min(1).optional(),
  }).strict(),
  pack_clone: z.object({
    operation: z.literal("pack_clone"), packPath: z.string().min(1), outputPath: z.string().min(1),
    overwrite: z.boolean().default(false), verifySha256: z.boolean().default(false), reportPath: z.string().min(1).optional(),
  }).strict(),
  pack_diff: packDiffSchema,
  asset_resolve_references: assetResolveReferencesSchema,
  asset_find_references: assetFindReferencesSchema,
  pack_subset: packSubsetSchema,
  localization_lookup: localizationLookupSchema,
  unit_resolve: unitResolveSchema,
  pack_texture_inspect: packTextureInspectSchema,
} as const;

export type OperationName = keyof typeof operationSchemas;
export type AutomationContext = {
  policy: FilesystemPolicy;
  schemaProvider?: TableSchemaProvider;
  maxLogicalPayloadBytes?: number;
  signal?: AbortSignal;
  cache?: AutomationCacheService;
  /** Per-operation scope attached by executeAutomationRequest. */
  cacheRequest?: AutomationCacheRequestScope;
};
export type OperationOutput<T = unknown> = { data: T; diagnostics: AutomationDiagnostic[] };
type Request<K extends OperationName> = z.output<(typeof operationSchemas)[K]>;
type OperationHandler<K extends OperationName> = (request: Request<K>, context: AutomationContext) => Promise<OperationOutput>;
export type OperationRegistry = { [K in OperationName]: { schema: (typeof operationSchemas)[K]; execute: OperationHandler<K> } };

const defaultContext = (): AutomationContext => ({ policy: new FilesystemPolicy() });
const diagnostic = (
  code: string,
  message: string,
  severity: AutomationDiagnostic["severity"] = "warning",
  packedPath?: string,
): AutomationDiagnostic => ({ code, message, severity, ...(packedPath ? { path: packedPath } : {}) });

const hashBytes = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const hashFile = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

const parseTablePath = (inputPath: string) => {
  try {
    return parseDBTablePath(normalizeInternalPackPath(inputPath).toLowerCase());
  } catch {
    return undefined;
  }
};
const isDbTablePath = (inputPath: string): boolean => Boolean(parseTablePath(inputPath));

const page = <T>(values: readonly T[], offset: number, limit: number) => ({
  total: values.length,
  offset,
  limit,
  items: values.slice(offset, offset + limit),
  nextOffset: offset + limit < values.length ? offset + limit : null,
  hasMore: offset + limit < values.length,
});

const withReport = async (
  context: AutomationContext,
  reportPath: string | undefined,
  sourcePaths: readonly string[],
  fullResult: unknown,
): Promise<string | undefined> => {
  if (!reportPath) return undefined;
  const result = await context.policy.withAtomicOutput({
    outputPath: reportPath,
    sourcePaths,
    produce: async (temporaryPath) => fs.promises.writeFile(temporaryPath, `${JSON.stringify(fullResult, null, 2)}\n`),
  });
  return result.path;
};

const packMetadata = (pack: CorePack) => ({
  path: pack.path,
  game: pack.game,
  header: pack.header.signature.toString("ascii"),
  byteMask: pack.header.byteMask,
  isMovie: (pack.header.byteMask & 0x7) === 4,
  refFileCount: pack.header.refFileCount,
  dependencyIndexSize: pack.header.dependencyIndexSize,
  dependencies: pack.dependencies,
  fileCount: pack.entries.length,
  fileIndexSize: pack.header.fileIndexSize,
  dataStart: pack.dataStart,
  fileSize: pack.fileSize,
  trailingBytes: pack.trailingBytes.length,
});

const runPackInfo: OperationHandler<"pack_info"> = async (request, context) => {
  const pack = await readIndex(request.packPath, context);
  const data = packMetadata(pack);
  const reportPath = await withReport(context, request.reportPath, [pack.path], data);
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics: [] };
};

const isPackedPathMatch = (entryName: string, pathPrefix?: string, pattern?: string): boolean => {
  const normalizedName = entryName.replace(/\\/g, "/").toLowerCase();
  if (pathPrefix) {
    const prefix = normalizeInternalPackPath(pathPrefix).replace(/\\/g, "/").toLowerCase();
    if (!normalizedName.startsWith(prefix)) return false;
  }
  if (pattern) {
    const normalizedPattern = pattern.replace(/\\/g, "/").toLowerCase();
    if (!path.posix.matchesGlob(normalizedName, normalizedPattern)) return false;
  }
  return true;
};

const runListFiles: OperationHandler<"pack_list_files"> = async (request, context) => {
  const pack = await readIndex(request.packPath, context);
  const files = pack.entries
    .filter((entry) => isPackedPathMatch(entry.name, request.pathPrefix, request.glob))
    .map((entry) => ({
      path: entry.name,
      size: entry.file_size,
      compressed: entry.is_compressed,
      ...(entry.file_name_hash === undefined ? {} : { fileNameHash: entry.file_name_hash }),
    }))
    .sort((a, b) => {
      const first = a.path.toLowerCase();
      const second = b.path.toLowerCase();
      return first === second ? (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) : first < second ? -1 : 1;
    });
  const result = { packPath: pack.path, ...page(files, request.offset, request.limit) };
  const reportPath = await withReport(context, request.reportPath, [pack.path], {
    packPath: pack.path,
    total: files.length,
    items: files,
    preview: result,
  });
  return { data: { ...result, ...(reportPath ? { reportPath } : {}) }, diagnostics: [] };
};

const runReadFile: OperationHandler<"pack_read_file"> = async (request, context) => {
  const pack = await readIndex(request.packPath, context);
  const entry = findEntry(pack, request.filePath);
  const buffer = await readLogical(pack, entry, context);
  const isText = isTextPackedFilePath(entry.name.replace(/\//g, "\\").toLowerCase());
  const data: Record<string, unknown> = {
    packPath: pack.path,
    filePath: entry.name,
    size: buffer.length,
    compressed: entry.is_compressed,
    sha256: hashBytes(buffer),
  };
  if (isText) {
    const text = decodePackedTextBuffer(buffer);
    data.content = text.slice(request.offset, request.offset + request.limit);
    data.offset = request.offset;
    data.returnedChars = Math.max(0, Math.min(request.limit, text.length - request.offset));
    data.truncated = request.offset + request.limit < text.length;
  } else {
    data.binary = !isText;
    if (!request.extractTo) data.extractionRequired = !isText;
  }
  if (request.extractTo) {
    const published = await context.policy.withAtomicOutput({
      outputPath: request.extractTo,
      overwrite: request.overwrite,
      sourcePaths: [pack.path],
      produce: (temporaryPath) => fs.promises.writeFile(temporaryPath, buffer),
    });
    data.extractedTo = published.path;
  }
  const reportPath = await withReport(context, request.reportPath, [pack.path], data);
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics: [] };
};

const runSearch: OperationHandler<"pack_search"> = async (request, context) => {
  const pack = await readIndex(request.packPath, context);
  const matcher = createSearchMatcher(request.query, {
    caseSensitive: request.caseSensitive,
    regex: request.regex,
  });
  if (!matcher.isValidRegex) throw new AutomationError("INVALID_ARGUMENT", "Search regular expression is invalid or too long");
  const diagnostics: AutomationDiagnostic[] = [];
  const results: Array<Record<string, unknown>> = [];
  let truncated = false;
  const addResult = (result: Record<string, unknown>): void => {
    if (results.length < request.maxResults) results.push(result);
    else truncated = true;
  };
  let searchEntries = 0;
  for (const entry of pack.entries) {
    throwIfAborted(context.signal);
    if ((searchEntries++ & 127) === 0) await yieldToEventLoop(context.signal);
    if (request.fileGlob && !isPackedPathMatch(entry.name, undefined, request.fileGlob)) continue;
    if (matcher.test(entry.name)) addResult({ kind: "filename", filePath: entry.name });
    if (!request.content || !isTextPackedFilePath(entry.name.replace(/\//g, "\\").toLowerCase())) continue;
    if (entry.file_size > (context.maxLogicalPayloadBytes ?? DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES)) {
      diagnostics.push(diagnostic("SKIPPED_TOO_LARGE", "Text entry exceeds the configured read limit", "warning", entry.name));
      continue;
    }
    let content: Buffer;
    try {
      content = await readLogical(pack, entry, context);
    } catch (error) {
      if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
      diagnostics.push(diagnostic("SKIPPED_UNREADABLE", error instanceof Error ? error.message : String(error), "warning", entry.name));
      continue;
    }
    const matches = scanTextForMatches(decodePackedTextBuffer(content), matcher, { maxMatches: 100 });
    for (const match of matches) {
      throwIfAborted(context.signal);
      addResult({ kind: "text", filePath: entry.name, ...match });
    }
    if (matches.truncated) diagnostics.push(diagnostic("TRUNCATED_FILE_MATCHES", "Additional matches in this entry were omitted", "info", entry.name));
  }
  const fullResult = { packPath: pack.path, query: request.query, results, truncated };
  const reportPath = await withReport(context, request.reportPath, [pack.path], fullResult);
  return { data: { ...fullResult, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};

const runTableRead = async (
  packPath: string,
  tablePath: string,
  columns: readonly string[] | undefined,
  offset: number,
  limit: number,
  reportPath: string | undefined,
  context: AutomationContext,
  filters: readonly TableFilter[] = [],
  sort: readonly TableSort[] = [],
) => {
  const pack = await readIndex(packPath, context);
  const entry = findEntry(pack, tablePath);
  const loaded = await readAutomationReadonlyTable(pack, entry, context);
  const allRows = loaded.rows;
  const matchingRows = queryTableRows(loaded, allRows, filters, sort);
  const selectedColumns = columns ?? loaded.schema.fields.map((field) => field.name);
  const columnMetadata = selectedColumns.map((name) => {
    const matches = loaded.schema.fields.filter((field) => field.name === name);
    if (matches.length !== 1) throw new AutomationError("INVALID_ARGUMENT", matches.length === 0 ? `Unknown table field: ${name}` : `Ambiguous table field name: ${name}`);
    return {
      name: matches[0].name,
      type: matches[0].field_type,
      isKey: loaded.isLoc ? matches[0].name === "key" : matches[0].is_key,
    };
  });
  const selectedRows = columns ? matchingRows.map((row) => {
    const projected: TableRow = {};
    for (const column of columns) projected[column] = row[column];
    return projected;
  }) : matchingRows;
  const data = {
    packPath: pack.path,
    tablePath: entry.name,
    version: loaded.schema.version,
    isLoc: loaded.isLoc,
    totalRows: selectedRows.length,
    columns: columnMetadata,
    offset,
    limit,
    rows: selectedRows.slice(offset, offset + limit),
    nextOffset: offset + limit < selectedRows.length ? offset + limit : null,
    hasMore: offset + limit < selectedRows.length,
  };
  const reportPathResult = await withReport(context, reportPath, [pack.path], {
    ...data,
    rows: selectedRows,
    preview: { offset, limit, rows: data.rows, nextOffset: data.nextOffset, hasMore: data.hasMore },
  });
  return { data: { ...data, ...(reportPathResult ? { reportPath: reportPathResult } : {}) }, diagnostics: [] };
};

const runReadTable: OperationHandler<"pack_read_table"> = async (request, context) =>
  runTableRead(request.packPath, request.tablePath, request.columns, request.offset, request.limit, request.reportPath, context);

const runQueryTable: OperationHandler<"pack_query_table"> = async (request, context) =>
  runTableRead(request.packPath, request.tablePath, request.columns, request.offset, request.limit, request.reportPath, context, request.filters, request.sort);

const loadSourceBytes = async (
  context: AutomationContext,
  input: { sourcePath?: string; text?: string },
): Promise<{ bytes: Buffer; sourcePath?: string }> => {
  const hasText = input.text !== undefined;
  const hasSource = input.sourcePath !== undefined;
  if (hasText === hasSource) throw new AutomationError("INVALID_ARGUMENT", "Provide exactly one of text or sourcePath");
  if (hasText) return { bytes: Buffer.from(input.text!, "utf8") };
  const source = await context.policy.readFile(input.sourcePath!);
  return { bytes: source.bytes, sourcePath: source.path };
};

const assertUniqueInternalPaths = (paths: readonly string[]): void => {
  const seen = new Set<string>();
  for (const input of paths) {
    const normalized = normalizeInternalPackPath(input);
    const key = normalizePackFilePathKey(normalized);
    if (seen.has(key)) throw new AutomationError("CONFLICT", `Duplicate packed-file path: ${input}`);
    seen.add(key);
  }
};

const parseChangedPayloads = async (
  packPath: string,
  changedPaths: readonly string[],
  context: AutomationContext,
): Promise<AutomationDiagnostic[]> => {
  const pack = readPackIndex(packPath, { game: "wh3" });
  const diagnostics: AutomationDiagnostic[] = [];
  const changed = new Set(changedPaths.map(normalizePackFilePathKey));
  let changedEntries = 0;
  for (const entry of pack.entries) {
    throwIfAborted(context.signal);
    if ((changedEntries++ & 127) === 0) await yieldToEventLoop(context.signal);
    if (!changed.has(normalizePackFilePathKey(entry.name))) continue;
    const bytes = await readLogical(pack, entry, context);
    if (entry.name.toLowerCase().endsWith(".xml") || entry.name.toLowerCase().endsWith(".variantmeshdefinition") || entry.name.toLowerCase().endsWith(".wsmodel") || entry.name.toLowerCase().endsWith(".xml.material")) {
      const result = XMLValidator.validate(decodePackedTextBuffer(bytes));
      if (result !== true) throw new AutomationError("VALIDATION", `Invalid XML in ${entry.name}`, result);
    }
    if (entry.name.toLowerCase().endsWith(".loc") || isDbTablePath(entry.name)) {
      try {
        await loadPackedTable(entry.name, bytes, schemaProviderFor(context));
      } catch (error) {
        if (error instanceof AutomationError && error.code === "UNSUPPORTED") {
          diagnostics.push(diagnostic("UNSUPPORTED_TABLE_SCHEMA", error.message, "warning", entry.name));
        } else {
          throw error;
        }
      }
    }
  }
  return diagnostics;
};

const runCreate: OperationHandler<"pack_create"> = async (request, context) => {
  assertUniqueInternalPaths(request.files.map((file) => file.path));
  const sources: string[] = [];
  const writeEntries: RawPackWriteEntry[] = [];
  for (const file of request.files) {
    throwIfAborted(context.signal);
    const internalPath = normalizeInternalPackPath(file.path);
    const content = await loadSourceBytes(context, file);
    if (content.sourcePath) sources.push(content.sourcePath);
    writeEntries.push({ name: internalPath, buffer: content.bytes, is_compressed: false });
  }
  const metadata: RawPackWriteMetadata = {
    game: "wh3",
    byteMask: request.packType === "movie" ? 4 : 3,
    refFileCount: 0,
    headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
    dependencies: request.dependencies,
  };
  let diagnostics: AutomationDiagnostic[] = [];
  const published = await context.policy.withAtomicOutput({
    outputPath: request.outputPath,
    overwrite: request.overwrite,
    sourcePaths: sources,
    produce: (temporaryPath) => writeRawPack(temporaryPath, writeEntries, metadata),
    validate: async (temporaryPath) => {
      const index = readPackIndex(temporaryPath, { game: "wh3" });
      diagnostics = await parseChangedPayloads(temporaryPath, index.entries.map((entry) => entry.name), context);
      if (diagnostics.some((item) => item.severity === "error")) throw new AutomationError("VALIDATION", "Created pack failed validation", diagnostics);
    },
  });
  const data = {
    outputPath: published.path,
    packType: request.packType,
    fileCount: writeEntries.length,
    dependencies: request.dependencies,
    validationComplete: !diagnostics.some((item) => item.code === "UNSUPPORTED_TABLE_SCHEMA"),
  };
  const reportPath = await withReport(context, request.reportPath, [...sources, published.path], data);
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};

const runWriteFiles: OperationHandler<"pack_write_files"> = async (request, context) => {
  const pack = await readIndex(request.packPath, context);
  const sourcePaths = [pack.path];
  const changePaths = request.files.map((file) => normalizeInternalPackPath(file.path));
  assertUniqueInternalPaths(changePaths);
  const changesByKey = new Map(request.files.map((file, index) => [normalizePackFilePathKey(changePaths[index]), file]));
  const sourceEntries = pack.entries.filter((entry) => changesByKey.has(normalizePackFilePathKey(entry.name)));
  for (const file of request.files) {
    throwIfAborted(context.signal);
    const key = normalizePackFilePathKey(file.path);
    const existing = sourceEntries.filter((entry) => normalizePackFilePathKey(entry.name) === key);
    if (file.op === "add" && existing.length > 0) throw new AutomationError("CONFLICT", `Packed file already exists: ${file.path}`);
    if (file.op !== "add" && existing.length !== 1) throw new AutomationError(existing.length > 1 ? "CONFLICT" : "VALIDATION", `${file.op} requires exactly one existing packed file: ${file.path}`);
  }
  const byKey = new Map(pack.entries.map((entry) => [normalizePackFilePathKey(entry.name), entry]));
  const additions: RawPackWriteEntry[] = [];
  const changedNames: string[] = [];
  for (const file of request.files) {
    throwIfAborted(context.signal);
    if (file.op === "remove") continue;
    const content = await loadSourceBytes(context, file);
    if (content.sourcePath) sourcePaths.push(content.sourcePath);
    const key = normalizePackFilePathKey(file.path);
    const previous = byKey.get(key);
    if (file.op === "replace" && !previous) throw new AutomationError("VALIDATION", `Packed file does not exist: ${file.path}`);
    if (file.op === "add" && hasPackedFileNameHash(pack.header.byteMask)) {
      throw new AutomationError("UNSUPPORTED", "Adding files to a filename-hashed pack requires a supported hash generator");
    }
    additions.push({
      name: previous?.name ?? normalizeInternalPackPath(file.path),
      buffer: content.bytes,
      is_compressed: false,
      ...(previous?.file_name_hash === undefined ? {} : { file_name_hash: previous.file_name_hash }),
    });
    changedNames.push(previous?.name ?? normalizeInternalPackPath(file.path));
  }
  const removed = request.files.filter((file) => file.op === "remove" || file.op === "replace").map((file) => normalizePackFilePathKey(file.path));
  const keptEntries = pack.entries.filter((entry) => !removed.includes(normalizePackFilePathKey(entry.name)));
  const writeEntries = [
    ...keptEntries.map((entry) => ({
      name: entry.name,
      is_compressed: entry.is_compressed,
      ...(entry.file_name_hash === undefined ? {} : { file_name_hash: entry.file_name_hash }),
      source: { path: pack.path, start_pos: entry.start_pos, file_size: entry.file_size },
    })),
    ...additions,
  ];
  assertUniqueInternalPaths(writeEntries.map((entry) => entry.name));
  let diagnostics: AutomationDiagnostic[] = [];
  const published = await context.policy.withAtomicOutput({
    outputPath: request.outputPath,
    overwrite: request.overwrite,
    sourcePaths,
    produce: (temporaryPath) => writeRawPack(temporaryPath, writeEntries, {
      game: "wh3",
      byteMask: pack.header.byteMask,
      refFileCount: pack.header.refFileCount,
      headerBuffer: pack.header.headerBuffer,
      dependencies: pack.dependencies,
      dependencyBytes: pack.dependencyBytes,
      trailingBytes: pack.trailingBytes,
    }),
    validate: async (temporaryPath) => {
      readPackIndex(temporaryPath, { game: "wh3" });
      diagnostics = await parseChangedPayloads(temporaryPath, changedNames, context);
    },
  });
  const data = {
    inputPath: pack.path,
    outputPath: published.path,
    added: request.files.filter((file) => file.op === "add").length,
    replaced: request.files.filter((file) => file.op === "replace").length,
    removed: request.files.filter((file) => file.op === "remove").length,
    validationComplete: !diagnostics.some((item) => item.code === "UNSUPPORTED_TABLE_SCHEMA"),
  };
  const reportPath = await withReport(context, request.reportPath, [...sourcePaths, published.path], data);
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};

const patchRows = (
  table: ParsedDbTable,
  patches: readonly z.output<typeof patchSchema>[],
  isLoc: boolean,
): { rows: DbSerializedCell[][]; rowCount: number } => {
  type MutableCell = { fields: Field[]; bytes: Buffer; dirty: boolean };
  const rawRows: MutableCell[][] = table.rows.map((row) =>
    row.cells.map((cell) => ({ fields: cell.fields, bytes: cell.bytes, dirty: false })),
  );
  const jsonRowForFilters = (row: MutableCell[], filters: readonly TableFilter[]): TableRow => {
    const result: TableRow = {};
    for (const filter of filters) {
      const fieldIndex = table.schema.fields.findIndex((field) => field.name === filter.field);
      if (fieldIndex < 0) throw new AutomationError("INVALID_ARGUMENT", `Unknown table field: ${filter.field}`);
      const field = table.schema.fields[fieldIndex];
      result[field.name] = jsonValueFromCell(field.field_type, row[fieldIndex].fields);
    }
    return result;
  };
  for (const patch of patches) {
    if (patch.op === "insert") {
      const fields = makeRowFields(table.schema, patch.row, true);
      rawRows.push(fields.map((value) => ({ fields: value, bytes: Buffer.alloc(0), dirty: true })));
      continue;
    }
    const matching = rawRows.flatMap((row, index) =>
      queryTableRows(table, [jsonRowForFilters(row, patch.where)], patch.where as TableFilter[]).length === 1 ? [index] : [],
    );
    if (matching.length !== 1) {
      throw new AutomationError("CONFLICT", `${patch.op} selector must match exactly one row; matched ${matching.length}`, {
        matchedRows: matching.length,
      });
    }
    const rowIndex = matching[0];
    if (patch.op === "delete") {
      rawRows.splice(rowIndex, 1);
    } else {
      const changedCells = applyRecordToCells(table.schema, rawRows[rowIndex], patch.set);
      rawRows[rowIndex] = changedCells.map((cell, index) =>
        "fields" in cell
          ? { fields: cell.fields, bytes: rawRows[rowIndex][index].bytes, dirty: true }
          : rawRows[rowIndex][index],
      );
    }
  }
  const keyIndexes = table.schema.fields.flatMap((field, index) =>
    (isLoc ? field.name === "key" : field.is_key) ? [index] : [],
  );
  if (keyIndexes.length > 0) {
    const seen = new Set<string>();
    for (const row of rawRows) {
      const key = JSON.stringify(keyIndexes.map((index) => {
        const field = table.schema.fields[index];
        return row[index].dirty
          ? serializeSchemaFieldToBuffer({ type: field.field_type, fields: row[index].fields }).toString("hex")
          : row[index].bytes.toString("hex");
      }));
      if (seen.has(key)) throw new AutomationError("CONFLICT", "Resulting table contains duplicate schema key", { key });
      seen.add(key);
    }
  }
  return {
    rows: rawRows.map((row) => row.map((cell) => cell.dirty ? { fields: cell.fields } : { bytes: cell.bytes })),
    rowCount: rawRows.length,
  };
};

const runPatchTable: OperationHandler<"pack_patch_table"> = async (request, context) => {
  const pack = await readIndex(request.packPath, context);
  const entry = findEntry(pack, request.tablePath);
  const originalBytes = await readLogical(pack, entry, context);
  const loaded = await loadPackedTable(entry.name, originalBytes, schemaProviderFor(context));
  const patched = patchRows(loaded.parsed, request.patches, loaded.isLoc);
  const outputBytes = rewriteDbTableRows(loaded.parsed, patched.rows);
  const writeEntries: RawPackWriteEntry[] = pack.entries
    .filter((candidate) => normalizePackFilePathKey(candidate.name) !== normalizePackFilePathKey(entry.name))
    .map((candidate) => ({
      name: candidate.name,
      is_compressed: candidate.is_compressed,
      ...(candidate.file_name_hash === undefined ? {} : { file_name_hash: candidate.file_name_hash }),
      source: { path: pack.path, start_pos: candidate.start_pos, file_size: candidate.file_size },
    }));
  writeEntries.push({
    name: entry.name,
    buffer: outputBytes,
    is_compressed: false,
    ...(entry.file_name_hash === undefined ? {} : { file_name_hash: entry.file_name_hash }),
  });
  assertUniqueInternalPaths(writeEntries.map((candidate) => candidate.name));
  const published = await context.policy.withAtomicOutput({
    outputPath: request.outputPath,
    overwrite: request.overwrite,
    sourcePaths: [pack.path],
    produce: (temporaryPath) => writeRawPack(temporaryPath, writeEntries, {
      game: "wh3",
      byteMask: pack.header.byteMask,
      refFileCount: pack.header.refFileCount,
      headerBuffer: pack.header.headerBuffer,
      dependencies: pack.dependencies,
      dependencyBytes: pack.dependencyBytes,
      trailingBytes: pack.trailingBytes,
    }),
    validate: async (temporaryPath) => {
      const updated = readPackIndex(temporaryPath, { game: "wh3" });
      const updatedEntry = findEntry(updated, entry.name);
      const check = await readLogical(updated, updatedEntry, context);
      await loadPackedTable(updatedEntry.name, check, schemaProviderFor(context));
    },
  });
  const data = { inputPath: pack.path, outputPath: published.path, tablePath: entry.name, rowCount: patched.rowCount };
  const reportPath = await withReport(context, request.reportPath, [pack.path, published.path], data);
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics: [] };
};

const runValidate: OperationHandler<"pack_validate"> = async (request, context) => {
  const pack = await readIndex(request.packPath, context);
  const diagnostics: AutomationDiagnostic[] = [];
  const seenPaths = new Set<string>();
  let validatedEntries = 0;
  for (const entry of pack.entries) {
    throwIfAborted(context.signal);
    if ((validatedEntries++ & 127) === 0) await yieldToEventLoop(context.signal);
    try {
      const normalizedPath = normalizePackFilePathKey(normalizeInternalPackPath(entry.name));
      if (seenPaths.has(normalizedPath)) diagnostics.push(diagnostic("DUPLICATE_PACKED_PATH", "Packed path is duplicated after normalization", "error", entry.name));
      seenPaths.add(normalizedPath);
    } catch (error) {
      diagnostics.push(diagnostic("INVALID_PACKED_PATH", error instanceof Error ? error.message : String(error), "error", entry.name));
    }
    if (!request.fullPayloads && !entry.name.toLowerCase().endsWith(".loc") && !isDbTablePath(entry.name)) continue;
    try {
      const bytes = await readLogical(pack, entry, context);
      if (entry.name.toLowerCase().endsWith(".xml") || entry.name.toLowerCase().endsWith(".variantmeshdefinition") || entry.name.toLowerCase().endsWith(".wsmodel") || entry.name.toLowerCase().endsWith(".xml.material")) {
        const result = XMLValidator.validate(decodePackedTextBuffer(bytes));
        if (result !== true) diagnostics.push(diagnostic("INVALID_XML", JSON.stringify(result), "error", entry.name));
      }
      if (entry.name.toLowerCase().endsWith(".loc") || isDbTablePath(entry.name)) {
        try {
          await loadPackedTable(entry.name, bytes, schemaProviderFor(context));
        } catch (error) {
          if (error instanceof AutomationError && error.code === "UNSUPPORTED") {
            diagnostics.push(diagnostic("UNSUPPORTED_TABLE_SCHEMA", error.message, "warning", entry.name));
          } else throw error;
        }
      }
    } catch (error) {
      if (error instanceof AutomationError && error.code === "CANCELLED") throw error;
      const unsupported = error instanceof AutomationError && error.code === "UNSUPPORTED";
      diagnostics.push(diagnostic(unsupported ? "UNSUPPORTED_PAYLOAD" : "INVALID_PAYLOAD", error instanceof Error ? error.message : String(error), unsupported ? "warning" : "error", entry.name));
    }
  }
  const data = {
    ...packMetadata(pack),
    valid: diagnostics.every((item) => item.severity !== "error"),
    validationComplete: !diagnostics.some((item) => item.code === "UNSUPPORTED_PAYLOAD" || item.code === "UNSUPPORTED_TABLE_SCHEMA"),
    diagnostics,
  };
  const reportPath = await withReport(context, request.reportPath, [pack.path], data);
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics };
};

const runClone: OperationHandler<"pack_clone"> = async (request, context) => {
  const pack = await readIndex(request.packPath, context);
  const sourcePath = pack.path;
  const sourceHash = request.verifySha256 ? await hashFile(sourcePath) : undefined;
  const published = await context.policy.withAtomicOutput({
    outputPath: request.outputPath,
    overwrite: request.overwrite,
    sourcePaths: [sourcePath],
    produce: async (temporaryPath) => fs.promises.copyFile(sourcePath, temporaryPath),
    validate: async (temporaryPath) => {
      readPackIndex(temporaryPath, { game: "wh3" });
      if (sourceHash && sourceHash !== await hashFile(temporaryPath)) {
        throw new AutomationError("VALIDATION", "Cloned pack SHA256 does not match source");
      }
    },
  });
  const data = { inputPath: sourcePath, outputPath: published.path, sha256: sourceHash };
  const reportPath = await withReport(context, request.reportPath, [sourcePath, published.path], data);
  return { data: { ...data, ...(reportPath ? { reportPath } : {}) }, diagnostics: [] };
};

export const operationRegistry: OperationRegistry = {
  pack_info: { schema: operationSchemas.pack_info, execute: runPackInfo },
  pack_list_files: { schema: operationSchemas.pack_list_files, execute: runListFiles },
  pack_read_file: { schema: operationSchemas.pack_read_file, execute: runReadFile },
  pack_search: { schema: operationSchemas.pack_search, execute: runSearch },
  pack_read_table: { schema: operationSchemas.pack_read_table, execute: runReadTable },
  pack_query_table: { schema: operationSchemas.pack_query_table, execute: runQueryTable },
  pack_create: { schema: operationSchemas.pack_create, execute: runCreate },
  pack_write_files: { schema: operationSchemas.pack_write_files, execute: runWriteFiles },
  pack_patch_table: { schema: operationSchemas.pack_patch_table, execute: runPatchTable },
  pack_validate: { schema: operationSchemas.pack_validate, execute: runValidate },
  pack_clone: { schema: operationSchemas.pack_clone, execute: runClone },
  pack_diff: { schema: operationSchemas.pack_diff, execute: runPackDiff },
  asset_resolve_references: { schema: operationSchemas.asset_resolve_references, execute: runAssetResolveReferences },
  asset_find_references: { schema: operationSchemas.asset_find_references, execute: runAssetFindReferences },
  pack_subset: { schema: operationSchemas.pack_subset, execute: runPackSubset },
  localization_lookup: { schema: operationSchemas.localization_lookup, execute: runLocalizationLookup },
  unit_resolve: { schema: operationSchemas.unit_resolve, execute: runUnitResolve },
  pack_texture_inspect: { schema: operationSchemas.pack_texture_inspect, execute: runPackTextureInspect },
};

export const createAutomationContext = (options: {
  readRoots?: readonly string[];
  writeRoots?: readonly string[];
  schemaProvider?: TableSchemaProvider;
  maxLogicalPayloadBytes?: number;
  signal?: AbortSignal;
  cache?: AutomationCacheService;
} = {}): AutomationContext => ({
  policy: new FilesystemPolicy({ readRoots: options.readRoots, writeRoots: options.writeRoots, signal: options.signal }),
  ...(options.schemaProvider ? { schemaProvider: options.schemaProvider } : {}),
  ...(options.maxLogicalPayloadBytes ? { maxLogicalPayloadBytes: options.maxLogicalPayloadBytes } : {}),
  ...(options.signal ? { signal: options.signal } : {}),
  ...(options.cache ? { cache: options.cache } : {}),
});

export const defaultAutomationContext = defaultContext;
