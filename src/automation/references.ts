import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { getSupportedVisualReferenceDetails, type VisualReferenceDetail } from "../visuals/dependencies";
import { toVariantMeshDefinitionPath } from "../visuals/paths";
import { getFilenameRelativePathMatch, parseFilenameRelativePaths } from "../utility/filenameRelativePaths";
import { getCanonicalLogicalTableName, shouldReplaceEffectiveDbRowWinner } from "../utility/effectiveDbRow";
import { parseDBTablePath } from "../utility/packFileHelpers";
import { normalizePackFilePath, normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { parseRmv2, Rmv2CodecError, type CorePack, type CorePackEntry } from "../packCore";
import { decodePackedTextBuffer } from "../utility/packFileViewing";
import { AutomationError, throwIfAborted, yieldToEventLoop, type AutomationDiagnostic } from "./errors";
import { normalizeInternalPackPath } from "./filesystem";
import { readAutomationPack, readAutomationPayload, readAutomationReadonlyTable } from "./packAccess";
import { queryTableRows, type TableFilter, type TableRow } from "./tables";
import type { ReadonlyTableData } from "./cacheService";
import type { AutomationContext } from "./operations";

const filterValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))]);
const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in", "contains"]),
  value: filterValueSchema,
}).strict();
const dbRootSchema = z.object({ filePath: z.string().min(1), where: z.array(filterSchema).max(1000) }).strict();

const referenceBounds = {
  maxDepth: z.number().int().min(0).max(32).default(32),
  maxNodes: z.number().int().min(1).max(10000).default(10000),
  maxEdges: z.number().int().min(1).max(50000).default(50000),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(100),
  reportPath: z.string().min(1).optional(),
};

export const assetResolveReferencesSchema = z.object({
  operation: z.literal("asset_resolve_references"),
  packPaths: z.array(z.string().min(1)).min(1).max(512),
  vanillaPackPaths: z.array(z.string().min(1)).max(512).optional(),
  gameDataPath: z.string().min(1).optional(),
  roots: z.array(z.union([z.string().min(1), dbRootSchema])).min(1).max(1000),
  traversal: z.enum(["direct", "recursive"]).default("recursive"),
  ...referenceBounds,
}).strict();

export const assetFindReferencesSchema = z.object({
  operation: z.literal("asset_find_references"),
  packPaths: z.array(z.string().min(1)).min(1).max(512),
  vanillaPackPaths: z.array(z.string().min(1)).max(512).optional(),
  gameDataPath: z.string().min(1).optional(),
  targetPath: z.string().min(1),
  maxNodes: z.number().int().min(1).max(10000).default(10000),
  maxEdges: z.number().int().min(1).max(50000).default(50000),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(100),
  reportPath: z.string().min(1).optional(),
}).strict();

type ResolveRequest = z.output<typeof assetResolveReferencesSchema>;
type FindRequest = z.output<typeof assetFindReferencesSchema>;

export interface ReferenceProvider {
  pack: CorePack;
  kind: "mod" | "vanilla";
  order: number;
  entriesByPath: Map<string, CorePackEntry[]>;
}

interface DbFileRef {
  provider: ReferenceProvider;
  entry: CorePackEntry;
  logicalTable: string;
}

export interface EffectiveDbRow {
  id: string;
  provider: ReferenceProvider;
  entry: CorePackEntry;
  logicalTable: string;
  loaded: ReadonlyTableData;
  rowIndex: number;
  row: Readonly<TableRow>;
  identity?: string;
}

export interface ReferenceEnvironment {
  context: AutomationContext;
  sourcePaths: string[];
  providers: ReferenceProvider[];
  diagnostics: AutomationDiagnostic[];
  complete: boolean;
  assetCandidates: Map<string, Array<{ provider: ReferenceProvider; entry: CorePackEntry }>>;
  dbFiles: Map<string, DbFileRef[]>;
  dbEffectiveFilesCache: Map<string, DbFileRef[]>;
  dbRowsCache: Map<string, Promise<EffectiveDbRow[]>>;
  dbExactRowsCache: Map<string, Promise<EffectiveDbRow[]>>;
  rowById: Map<string, EffectiveDbRow>;
}

const diagnostic = (code: string, message: string, pathValue?: string, severity: AutomationDiagnostic["severity"] = "warning"): AutomationDiagnostic => ({
  code,
  message,
  severity,
  ...(pathValue ? { path: pathValue } : {}),
});

const canonicalAbsolute = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);

const parseManifestPackNames = (text: string): string[] => text.split(/\r?\n/)
  .map((line) => line.match(/([^\s]+)/)?.[1])
  .filter((value): value is string => Boolean(value && value.toLowerCase().endsWith(".pack")));

const validateManifestPackName = (name: string): string => {
  if (!name || name.includes("\0") || path.posix.isAbsolute(name) || path.win32.isAbsolute(name) || /^[a-zA-Z]:/.test(name)) {
    throw new AutomationError("VALIDATION", `Invalid pack name in manifest: ${JSON.stringify(name)}`);
  }
  const segments = name.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new AutomationError("VALIDATION", `Manifest pack name escapes the game data folder: ${JSON.stringify(name)}`);
  }
  return name;
};

export const prepareReferenceEnvironment = async (
  context: AutomationContext,
  modPackPaths: readonly string[],
  explicitVanillaPackPaths: readonly string[] = [],
  gameDataPath?: string,
): Promise<ReferenceEnvironment> => {
  const diagnostics: AutomationDiagnostic[] = [];
  const vanillaPaths = [...explicitVanillaPackPaths];
  const manifestPaths: string[] = [];
  if (gameDataPath) {
    const dataPath = await context.policy.assertReadPath(gameDataPath);
    const manifest = await context.policy.readFile(path.join(dataPath, "manifest.txt"));
    for (const name of parseManifestPackNames(manifest.bytes.toString("utf8"))) {
      const safeName = validateManifestPackName(name);
      const resolved = path.resolve(dataPath, safeName);
      const relative = path.relative(dataPath, resolved);
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new AutomationError("VALIDATION", `Manifest pack name escapes the game data folder: ${JSON.stringify(name)}`);
      }
      vanillaPaths.push(resolved);
      manifestPaths.push(resolved);
    }
  }

  const vanillaPacks: CorePack[] = [];
  const modPacks: CorePack[] = [];
  const loadPaths = async (paths: readonly string[], target: CorePack[]) => {
    const seen = new Set(target.map((pack) => canonicalAbsolute(pack.path)));
    let loadedPackCount = 0;
    for (const requestedPath of paths) {
      throwIfAborted(context.signal);
      if ((loadedPackCount++ & 31) === 0) await yieldToEventLoop(context.signal);
      const pack = await readAutomationPack(requestedPath, context);
      const key = canonicalAbsolute(pack.path);
      if (seen.has(key)) continue;
      seen.add(key);
      target.push(pack);
    }
  };
  await loadPaths(vanillaPaths, vanillaPacks);
  await loadPaths(modPackPaths, modPacks);

  const providers: ReferenceProvider[] = [];
  const assetCandidates = new Map<string, Array<{ provider: ReferenceProvider; entry: CorePackEntry }>>();
  const dbFiles = new Map<string, DbFileRef[]>();
  let indexedEntries = 0;
  const appendProviders = async (packs: CorePack[], kind: ReferenceProvider["kind"]) => {
    for (const pack of packs) {
      throwIfAborted(context.signal);
      await yieldToEventLoop(context.signal);
      const provider: ReferenceProvider = { pack, kind, order: providers.length, entriesByPath: new Map() };
      providers.push(provider);
      for (const entry of pack.entries) {
        throwIfAborted(context.signal);
        if ((indexedEntries++ & 127) === 0) await yieldToEventLoop(context.signal);
        const key = normalizePackFilePathKey(entry.name);
        const group = provider.entriesByPath.get(key) ?? [];
        group.push(entry);
        provider.entriesByPath.set(key, group);
        const candidates = assetCandidates.get(key) ?? [];
        candidates.push({ provider, entry });
        assetCandidates.set(key, candidates);
        const parsed = parseDBTablePath(key);
        if (parsed?.dbFolder === "db") {
          const logicalTable = getCanonicalLogicalTableName(`db\\${parsed.dbName}`);
          const files = dbFiles.get(logicalTable) ?? [];
          files.push({ provider, entry, logicalTable });
          dbFiles.set(logicalTable, files);
        }
      }
    }
  };
  await appendProviders(vanillaPacks, "vanilla");
  await appendProviders(modPacks, "mod");
  const sourcePaths = [
    ...providers.map((provider) => provider.pack.path),
    ...manifestPaths,
    ...(gameDataPath ? [path.join(await context.policy.assertReadPath(gameDataPath), "manifest.txt")] : []),
  ];
  return { context, sourcePaths: [...new Set(sourcePaths)], providers, diagnostics, complete: true, assetCandidates, dbFiles, dbEffectiveFilesCache: new Map(), dbRowsCache: new Map(), dbExactRowsCache: new Map(), rowById: new Map() };
};

const assetNodeId = (provider: ReferenceProvider, key: string) => `asset:${provider.pack.path}::${key}`;
const missingAssetNodeId = (key: string) => `asset:unresolved::${key}`;
const rowNodeId = (provider: ReferenceProvider, entry: CorePackEntry, rowIndex: number) =>
  `dbrow:${provider.pack.path}::${normalizePackFilePathKey(entry.name)}::${rowIndex}`;

export const resolveReferenceAsset = (environment: ReferenceEnvironment, requestedPath: string, allowVmdFallback = false) => {
  let safePath = normalizeInternalPackPath(requestedPath);
  let key = normalizePackFilePathKey(safePath);
  let candidates = environment.assetCandidates.get(key) ?? [];
  const leaf = safePath.split("\\").at(-1) ?? safePath;
  const hasExtension = /\.[a-z0-9_]+$/i.test(leaf);
  if (!candidates.length && allowVmdFallback && !hasExtension) {
    safePath = normalizeInternalPackPath(toVariantMeshDefinitionPath(safePath));
    key = normalizePackFilePathKey(safePath);
    candidates = environment.assetCandidates.get(key) ?? [];
  }
  if (!candidates.length) return { path: safePath, key, status: "missing" as const, candidates: [] as typeof candidates, shadowed: [] as typeof candidates };
  const highestOrder = candidates[candidates.length - 1].provider.order;
  const top = candidates.filter((candidate) => candidate.provider.order === highestOrder);
  const winner = top[0];
  return {
    path: safePath,
    key,
    status: top.length > 1 ? "ambiguous" as const : "found" as const,
    winner,
    candidates,
    shadowed: candidates.filter((candidate) => candidate.provider.order < highestOrder),
  };
};

const loadedSchemaCompatible = (first: ReadonlyTableData, next: ReadonlyTableData) =>
  first.isLoc === next.isLoc && first.schema.version === next.schema.version &&
  first.schema.fields.length === next.schema.fields.length && first.schema.fields.every((field, index) => {
    const other = next.schema.fields[index];
    return field.name === other.name && field.field_type === other.field_type && field.is_key === other.is_key;
  });

const tableLogicalName = (packedPath: string): string | undefined => {
  const parsed = parseDBTablePath(normalizePackFilePathKey(packedPath));
  return parsed?.dbFolder === "db" ? getCanonicalLogicalTableName(`db\\${parsed.dbName}`) : undefined;
};

const getEffectiveDbFileRefs = (environment: ReferenceEnvironment, canonical: string): DbFileRef[] => {
  const cached = environment.dbEffectiveFilesCache.get(canonical);
  if (cached) return cached;
  const allFileRefs = environment.dbFiles.get(canonical) ?? [];
  const refsByPath = new Map<string, DbFileRef[]>();
  for (const ref of allFileRefs) {
    const key = normalizePackFilePathKey(ref.entry.name);
    const refs = refsByPath.get(key) ?? [];
    refs.push(ref);
    refsByPath.set(key, refs);
  }
  const fileRefs: DbFileRef[] = [];
  for (const refs of refsByPath.values()) {
    const highestOrder = refs[refs.length - 1].provider.order;
    const top = refs.filter((ref) => ref.provider.order === highestOrder);
    if (refs.length > top.length) {
      environment.diagnostics.push(diagnostic("SHADOWED_DB_FILE", "A higher-priority pack supplies this DB file path", top[0].entry.name, "info"));
    }
    if (top.length !== 1) {
      environment.complete = false;
      environment.diagnostics.push(diagnostic("AMBIGUOUS_DB_FILE", "DB path occurs more than once in the winning pack and was excluded from row resolution", top[0].entry.name));
      continue;
    }
    fileRefs.push(top[0]);
  }
  environment.dbEffectiveFilesCache.set(canonical, fileRefs);
  return fileRefs;
};

/** Loads the rows from the winning provider of one exact packed DB file path. */
export const loadExactDbFileRows = (environment: ReferenceEnvironment, packedPath: string): Promise<EffectiveDbRow[]> => {
  const canonicalPath = normalizePackFilePathKey(normalizeInternalPackPath(packedPath));
  const cached = environment.dbExactRowsCache.get(canonicalPath);
  if (cached) return cached;
  const logical = tableLogicalName(canonicalPath);
  const promise = (async () => {
    if (!logical) return [];
    const ref = getEffectiveDbFileRefs(environment, logical).find((candidate) => normalizePackFilePathKey(candidate.entry.name) === canonicalPath);
    if (!ref) return [];
    try {
      const loaded = await readAutomationReadonlyTable(ref.provider.pack, ref.entry, environment.context);
      if (loaded.isLoc) return [];
      const values = loaded.rows;
      const keyFields = loaded.schema.fields.filter((field) => field.is_key);
      const rows = values.map((row, rowIndex): EffectiveDbRow => {
        throwIfAborted(environment.context.signal);
        const completeKey = keyFields.length > 0 && keyFields.every((field) => row[field.name] !== null && row[field.name] !== undefined);
        const identity = completeKey ? JSON.stringify([logical, keyFields.map((field) => [field.name, row[field.name]])]) : undefined;
        return {
          id: rowNodeId(ref.provider, ref.entry, rowIndex),
          provider: ref.provider,
          entry: ref.entry,
          logicalTable: logical,
          loaded,
          rowIndex,
          row,
          ...(identity ? { identity } : {}),
        };
      });
      for (const row of rows) environment.rowById.set(row.id, row);
      return rows;
    } catch (error) {
      if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code)) throw error;
      environment.complete = false;
      environment.diagnostics.push(diagnostic(
        error instanceof AutomationError && error.code === "UNSUPPORTED" ? "UNSUPPORTED_DB_TABLE" : "INVALID_DB_TABLE",
        error instanceof Error ? error.message : String(error),
        ref.entry.name,
      ));
      return [];
    }
  })();
  environment.dbExactRowsCache.set(canonicalPath, promise);
  return promise;
};

export const loadEffectiveDbRows = (environment: ReferenceEnvironment, logicalTable: string): Promise<EffectiveDbRow[]> => {
  const canonical = getCanonicalLogicalTableName(logicalTable);
  const cached = environment.dbRowsCache.get(canonical);
  if (cached) return cached;
  const promise = (async () => {
    const fileRefs = getEffectiveDbFileRefs(environment, canonical);
    const parsedByFile: Array<{ ref: DbFileRef; loaded: ReadonlyTableData; rows: EffectiveDbRow[] }> = [];
    for (const ref of fileRefs) {
      const rows = await loadExactDbFileRows(environment, ref.entry.name);
      if (rows.length) parsedByFile.push({ ref, loaded: rows[0].loaded, rows });
      else if (environment.complete === false) continue;
    }

    for (let index = 1; index < parsedByFile.length; index += 1) {
      if (!loadedSchemaCompatible(parsedByFile[0].loaded, parsedByFile[index].loaded)) {
        environment.complete = false;
        environment.diagnostics.push(diagnostic("DB_SCHEMA_MISMATCH", `DB table files for ${canonical} use different schemas`, parsedByFile[index].ref.entry.name));
      }
    }

    const rows: EffectiveDbRow[] = [];
    const winners = new Map<string, EffectiveDbRow>();
    for (const { rows: values } of parsedByFile) {
      for (const item of values) {
        throwIfAborted(environment.context.signal);
        if (!item.identity) {
          rows.push(item);
          continue;
        }
        const current = winners.get(item.identity);
        if (!current || shouldReplaceEffectiveDbRowWinner(item.entry.name, current.entry.name)) winners.set(item.identity, item);
      }
    }
    rows.push(...winners.values());
    rows.sort((left, right) => left.provider.order - right.provider.order || left.entry.name.localeCompare(right.entry.name) || left.rowIndex - right.rowIndex);
    for (const row of rows) environment.rowById.set(row.id, row);
    return rows;
  })();
  environment.dbRowsCache.set(canonical, promise);
  return promise;
};

export interface ReferenceGraphNode {
  id: string;
  path: string;
  type: "asset" | "db-row";
  status: "found" | "missing" | "ambiguous" | "unsupported";
  coverage?: "pending" | "supportedReferences" | "supportedFields" | "opaqueLeaf" | "supportedRigidInternals" | "unsupportedInternals" | "unsupportedType" | "unreadable";
  loadModes?: Array<"direct" | "wsmodel">;
  provider?: string;
  providerKind?: "mod" | "vanilla";
  extension?: string;
  rowIndex?: number;
  table?: string;
  key?: Record<string, unknown>;
  shadowedCandidates?: Array<{ packPath: string; entryPath: string; kind: "mod" | "vanilla" }>;
  candidates?: Array<{ packPath: string; entryPath: string }>;
}

export interface ReferenceGraphEdge {
  source: string;
  target: string;
  relationship: string;
  sourceField?: string;
  location?: string;
  conditional?: VisualReferenceDetail["conditional"];
  loadMode?: "direct" | "wsmodel";
  lodIndex?: number;
  partIndex?: number;
  textureSlotIndex?: number;
  textureTypeId?: number | null;
  textureTypeName?: string | null;
  legacy?: boolean;
  materialTypeId?: number;
  materialTypeName?: string;
  targetField?: string;
  status?: "found" | "missing" | "ambiguous" | "unsupported";
}

export interface ReferenceGraphResult {
  roots: string[];
  nodes: ReferenceGraphNode[];
  edges: ReferenceGraphEdge[];
  diagnostics: AutomationDiagnostic[];
  complete: boolean;
  coverage: { nodes: number; edges: number; maxDepth: number; maxNodes: number; maxEdges: number; hitLimit: boolean };
}

export interface ReferenceGraphOptions {
  traversal: "direct" | "recursive";
  maxDepth: number;
  maxNodes: number;
  maxEdges: number;
  /** Set false for consumers that inspect RMV materials in a loader-aware pass. */
  traverseRigidInternals?: boolean;
  /** Set false when WS materials are resolved through exact LOD/part bindings. */
  traverseWsmodelMaterials?: boolean;
}

export type ReferenceGraphRoot = {
  type: "asset";
  path: string;
} | {
  type: "db";
  path: string;
  where?: TableFilter[];
} | {
  type: "db-row";
  row: EffectiveDbRow;
};

class ReferenceGraphBuilder {
  readonly nodes = new Map<string, ReferenceGraphNode>();
  readonly edges: ReferenceGraphEdge[] = [];
  readonly roots: string[] = [];
  readonly diagnostics: AutomationDiagnostic[];
  readonly environment: ReferenceEnvironment;
  readonly options: ReferenceGraphOptions;
  private readonly queue: Array<{ kind: "asset" | "db"; id: string; depth: number }> = [];
  private readonly processed = new Set<string>();
  private hitLimit = false;
  private limitDiagnosticAdded = false;
  private environmentDiagnosticCount: number;

  constructor(environment: ReferenceEnvironment, options: ReferenceGraphOptions) {
    this.environment = environment;
    this.options = options;
    this.diagnostics = [...environment.diagnostics];
    this.environmentDiagnosticCount = environment.diagnostics.length;
  }

  get atCapacity(): boolean {
    return this.hitLimit || this.nodes.size >= this.options.maxNodes || this.edges.length >= this.options.maxEdges;
  }

  noteCapacityReached(): void {
    this.markLimit(this.edges.length >= this.options.maxEdges ? "Reference graph reached maxEdges" : "Reference graph reached maxNodes");
  }

  private addNode(node: ReferenceGraphNode): string {
    if (!this.nodes.has(node.id)) {
      if (this.nodes.size >= this.options.maxNodes) {
        this.markLimit("Reference graph reached maxNodes");
        return node.id;
      }
      this.nodes.set(node.id, node);
    }
    return node.id;
  }

  private addEdge(edge: ReferenceGraphEdge): void {
    if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) {
      this.markLimit("Reference graph reached maxNodes before an edge endpoint could be added");
      return;
    }
    if (this.edges.length >= this.options.maxEdges) {
      this.markLimit("Reference graph reached maxEdges");
      return;
    }
    this.edges.push(edge);
  }

  private markLimit(message: string): void {
    this.hitLimit = true;
    this.environment.complete = false;
    if (!this.limitDiagnosticAdded) {
      this.limitDiagnosticAdded = true;
      this.diagnostics.push(diagnostic("REFERENCE_GRAPH_LIMIT", message));
    }
  }

  private queueNode(kind: "asset" | "db", id: string, depth: number): void {
    if (this.options.traversal === "direct" && depth > 0) return;
    if (depth > this.options.maxDepth) {
      this.markLimit("Reference graph reached maxDepth");
      return;
    }
    this.queue.push({ kind, id, depth });
  }

  addAssetRoot(inputPath: string, allowVmdFallback = true): string {
    const resolved = resolveReferenceAsset(this.environment, inputPath, allowVmdFallback);
    const id = resolved.status === "found" && resolved.winner
      ? assetNodeId(resolved.winner.provider, resolved.key)
      : missingAssetNodeId(resolved.key);
    const ext = resolved.winner ? pathExtension(resolved.winner.entry.name) : "";
    const node: ReferenceGraphNode = {
      id,
      path: resolved.path,
      type: "asset",
      status: resolved.status,
      ...(resolved.status === "found" && resolved.winner ? {
        provider: resolved.winner.provider.pack.path,
        providerKind: resolved.winner.provider.kind,
        extension: pathExtension(resolved.winner.entry.name),
        coverage: pathExtension(resolved.winner.entry.name) === "dds" ? "opaqueLeaf" :
          pathExtension(resolved.winner.entry.name) === "rigid_model_v2" ? "pending" :
            ["variantmeshdefinition", "wsmodel", "xml.material"].includes(pathExtension(resolved.winner.entry.name)) ? "pending" : "unsupportedType",
        shadowedCandidates: resolved.shadowed?.map(({ provider, entry }) => ({ packPath: provider.pack.path, entryPath: entry.name, kind: provider.kind })),
      } : {}),
      ...(resolved.status === "ambiguous" ? { candidates: resolved.candidates.map(({ provider, entry }) => ({ packPath: provider.pack.path, entryPath: entry.name })) } : {}),
    };
    if (ext === "rigid_model_v2") node.loadModes = ["direct"];
    this.addNode(node);
    if (this.nodes.has(id)) this.roots.push(id);
    if (resolved.status === "found" && resolved.winner && ["variantmeshdefinition", "wsmodel", "xml.material", "rigid_model_v2"].includes(ext) && this.nodes.has(id)) {
      this.queueNode("asset", id, 0);
    } else if (resolved.status === "found" && ext === "dds") {
      // DDS is a fully covered leaf.
    } else if (resolved.status === "found") {
      this.environment.complete = false;
      node.status = "unsupported";
      node.coverage = "unsupportedType";
      this.diagnostics.push(diagnostic("UNSUPPORTED_ASSET_TYPE", `Reference traversal does not support ${resolved.path}`, resolved.path));
    }
    else {
      this.environment.complete = false;
      this.diagnostics.push(diagnostic(resolved.status === "missing" ? "MISSING_ASSET" : "AMBIGUOUS_ASSET", `${resolved.status === "missing" ? "No provider contains" : "Multiple entries provide"} ${resolved.path}`, resolved.path));
    }
    return id;
  }

  async addDbRoot(filePath: string, where: TableFilter[]): Promise<string[]> {
    const normalizedPath = normalizeInternalPackPath(filePath);
    const logical = tableLogicalName(normalizedPath);
    if (!logical) throw new AutomationError("INVALID_ARGUMENT", `DB row root must name a live DB table file: ${filePath}`);
    const exactFiles = (this.environment.dbFiles.get(logical) ?? [])
      .filter((ref) => normalizePackFilePathKey(ref.entry.name) === normalizePackFilePathKey(normalizedPath));
    if (exactFiles.length === 0) throw new AutomationError("INVALID_ARGUMENT", `DB table file is not present in the supplied packs: ${normalizedPath}`);
    const highestOrder = Math.max(...exactFiles.map((ref) => ref.provider.order));
    const topFiles = exactFiles.filter((ref) => ref.provider.order === highestOrder);
    if (topFiles.length !== 1) throw new AutomationError("CONFLICT", `DB table path is duplicated in the winning pack: ${normalizedPath}`);
    const schemaRef = topFiles[0];
    try {
      const schemaTable = await readAutomationReadonlyTable(schemaRef.provider.pack, schemaRef.entry, this.environment.context);
      queryTableRows(schemaTable, [], where);
    } catch (error) {
      if (error instanceof AutomationError && ["UNSUPPORTED", "CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code)) throw error;
      throw new AutomationError("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error), { filePath: normalizedPath });
    }
    const rows = await loadExactDbFileRows(this.environment, normalizedPath);
    const matches: EffectiveDbRow[] = [];
    for (const row of rows) {
      if (queryTableRows(row.loaded, [row.row], where).length) matches.push(row);
    }
    if (matches.length === 0) {
      this.environment.complete = false;
      this.diagnostics.push(diagnostic("DB_ROOT_NOT_FOUND", `No effective row matches the selector in ${normalizedPath}`, normalizedPath));
    }
    const ids: string[] = [];
    for (const row of matches) ids.push(this.addDbRowRoot(row));
    return ids;
  }

  addDbRowRoot(row: EffectiveDbRow): string {
    const keyFields = row.loaded.schema.fields.filter((field) => field.is_key);
    const node: ReferenceGraphNode = {
      id: row.id,
      path: row.entry.name,
      type: "db-row",
      status: "found",
      coverage: "pending",
      provider: row.provider.pack.path,
      providerKind: row.provider.kind,
      rowIndex: row.rowIndex,
      table: row.logicalTable,
      ...(keyFields.length ? { key: Object.fromEntries(keyFields.map((field) => [field.name, row.row[field.name]])) } : {}),
    };
    this.addNode(node);
    if (this.nodes.has(row.id)) {
      this.roots.push(row.id);
      this.queueNode("db", row.id, 0);
    }
    return row.id;
  }

  private addAssetReference(source: string, requestedPath: string, relation: string, details: {
    sourceField?: string;
    location?: string;
    conditional?: VisualReferenceDetail["conditional"];
    lodIndex?: number;
    partIndex?: number;
    textureSlotIndex?: number;
    textureTypeId?: number | null;
    textureTypeName?: string | null;
    legacy?: boolean;
    materialTypeId?: number;
    materialTypeName?: string;
    targetField?: string;
  }, depth: number): void {
    const resolved = resolveReferenceAsset(this.environment, requestedPath);
    const extension = resolved.winner ? pathExtension(resolved.winner.entry.name) : pathExtension(resolved.path);
    const sourceNode = this.nodes.get(source);
    const loadMode = extension === "rigid_model_v2"
      ? sourceNode?.extension === "wsmodel" ? "wsmodel" as const : "direct" as const
      : undefined;
    const id = resolved.status === "found" && resolved.winner
      ? assetNodeId(resolved.winner.provider, resolved.key)
      : missingAssetNodeId(resolved.key);
    const node: ReferenceGraphNode = {
      id,
      path: resolved.path,
      type: "asset",
      status: resolved.status,
      ...(resolved.status === "found" && resolved.winner ? {
        provider: resolved.winner.provider.pack.path,
        providerKind: resolved.winner.provider.kind,
        extension: pathExtension(resolved.winner.entry.name),
        coverage: pathExtension(resolved.winner.entry.name) === "dds" ? "opaqueLeaf" :
          pathExtension(resolved.winner.entry.name) === "rigid_model_v2" ? "pending" :
            ["variantmeshdefinition", "wsmodel", "xml.material"].includes(pathExtension(resolved.winner.entry.name)) ? "pending" : "unsupportedType",
        shadowedCandidates: resolved.shadowed?.map(({ provider, entry }) => ({ packPath: provider.pack.path, entryPath: entry.name, kind: provider.kind })),
      } : {}),
      ...(resolved.status === "ambiguous" ? { candidates: resolved.candidates.map(({ provider, entry }) => ({ packPath: provider.pack.path, entryPath: entry.name })) } : {}),
    };
    this.addNode(node);
    if (loadMode && resolved.status === "found") {
      const targetNode = this.nodes.get(id);
      if (targetNode) targetNode.loadModes = [...new Set([...(targetNode.loadModes ?? []), loadMode])];
    }
    if (!this.nodes.has(id)) return;
    this.addEdge({ source, target: id, relationship: relation, ...details, ...(loadMode ? { loadMode } : {}), status: resolved.status });
    if (resolved.status !== "found" || !resolved.winner) {
      this.environment.complete = false;
      this.diagnostics.push(diagnostic(resolved.status === "missing" ? "MISSING_ASSET" : "AMBIGUOUS_ASSET", `${resolved.status === "missing" ? "No provider contains" : "Multiple entries provide"} ${resolved.path}`, resolved.path));
      return;
    }
    if (["variantmeshdefinition", "wsmodel", "xml.material", "rigid_model_v2"].includes(extension)) {
      this.queueNode("asset", id, depth);
    } else if (extension !== "dds") {
      const node = this.nodes.get(id);
      if (node) {
        node.status = "unsupported";
        node.coverage = "unsupportedType";
      }
      this.environment.complete = false;
      this.diagnostics.push(diagnostic("UNSUPPORTED_ASSET_TYPE", `Reference traversal does not support ${resolved.path}`, resolved.path));
    }
  }

  private async processAsset(id: string, depth: number): Promise<void> {
    const node = this.nodes.get(id);
    if (!node || node.status !== "found" || !node.provider) return;
    const ext = node.extension;
    if (ext === "dds") return;
    if (ext !== "variantmeshdefinition" && ext !== "wsmodel" && ext !== "xml.material" && ext !== "rigid_model_v2") return;
    if (ext === "rigid_model_v2" && this.options.traverseRigidInternals === false) return;
    const provider = this.environment.providers.find((candidate) => candidate.pack.path === node.provider);
    const entry = provider?.entriesByPath.get(normalizePackFilePathKey(node.path))?.[0];
    if (!provider || !entry) return;
    if (ext === "rigid_model_v2") {
      await this.processRigidModel(id, depth, provider, entry);
      return;
    }
    let extraction;
    try {
      const bytes = await readAutomationPayload(provider.pack, entry, this.environment.context);
      extraction = getSupportedVisualReferenceDetails(decodePackedTextBuffer(bytes));
    } catch (error) {
      if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code)) throw error;
      node.coverage = "unreadable";
      this.environment.complete = false;
      this.diagnostics.push(diagnostic("XML_READ_FAILED", error instanceof Error ? error.message : String(error), entry.name));
      return;
    }
    if (!extraction.valid) {
      node.coverage = "unreadable";
      this.environment.complete = false;
      this.diagnostics.push(diagnostic("XML_PARSE_FAILED", extraction.error ?? "XML document is malformed", entry.name));
      return;
    }
    node.coverage = "supportedReferences";
    for (const reference of extraction.references) {
      if (this.hitLimit) break;
      if (ext === "wsmodel" && this.options.traverseWsmodelMaterials === false && reference.extension === "xml.material") continue;
      this.addAssetReference(id, reference.path, reference.relationship, {
        sourceField: reference.sourceField,
        location: reference.location,
        ...(reference.conditional ? { conditional: reference.conditional } : {}),
      }, depth + 1);
    }
    for (const reference of extraction.unsupportedReferences) {
      if (this.hitLimit) break;
      const key = normalizePackFilePathKey(reference.path);
      const target = this.addNode({ id: `asset:unsupported::${key}`, path: reference.path, type: "asset", status: "unsupported" });
      this.addEdge({ source: id, target, relationship: "unsupported-reference", sourceField: reference.sourceField, location: reference.location, ...(reference.conditional ? { conditional: reference.conditional } : {}), status: "unsupported" });
      this.environment.complete = false;
      this.diagnostics.push(diagnostic("UNSUPPORTED_ASSET_REFERENCE", `Unsupported referenced asset extension: ${reference.path}`, reference.path));
    }
  }

  private async processRigidModel(id: string, depth: number, provider: ReferenceProvider, entry: CorePackEntry): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) return;
    let model;
    try {
      const bytes = await readAutomationPayload(provider.pack, entry, this.environment.context);
      model = parseRmv2(bytes);
    } catch (error) {
      if (error instanceof AutomationError && ["CANCELLED", "CONFLICT", "IO_ACCESS"].includes(error.code)) throw error;
      this.environment.complete = false;
      if (error instanceof Rmv2CodecError && error.code === "UNSUPPORTED") {
        node.coverage = "unsupportedInternals";
        this.diagnostics.push(diagnostic("UNSUPPORTED_RMV2_MODEL", error.message, entry.name));
      } else {
        node.coverage = "unreadable";
        this.diagnostics.push(diagnostic("INVALID_RMV2_MODEL", error instanceof Error ? error.message : String(error), entry.name));
      }
      return;
    }
    const unsupportedParts = model.lods.flatMap((lod) => lod.parts.filter((part) => !part.complete));
    node.coverage = unsupportedParts.length ? "unsupportedInternals" : "supportedRigidInternals";
    if (unsupportedParts.length) this.environment.complete = false;
    for (const part of unsupportedParts) {
      this.diagnostics.push(diagnostic(
        "UNSUPPORTED_RMV2_PART",
        `LOD ${part.lodIndex} part ${part.partIndex}: ${part.unsupportedReason ?? "unsupported layout"}`,
        entry.name,
      ));
    }
    for (const lod of model.lods) {
      throwIfAborted(this.environment.context.signal);
      for (const part of lod.parts) {
        if (!part.complete || !part.textures) continue;
        for (let textureSlotIndex = 0; textureSlotIndex < part.textures.length; textureSlotIndex++) {
          const texture = part.textures[textureSlotIndex];
          if (!texture.path.trim()) continue;
          this.addAssetReference(id, texture.path, "embedded-texture", {
            sourceField: texture.typeName ?? "texturePath",
            location: `lod[${lod.lodIndex}]/part[${part.partIndex}]/texture[${textureSlotIndex}]`,
            lodIndex: lod.lodIndex,
            partIndex: part.partIndex,
            textureSlotIndex,
            textureTypeId: texture.typeId,
            textureTypeName: texture.typeName,
            legacy: texture.legacy,
            materialTypeId: part.materialTypeId,
            materialTypeName: part.materialTypeName,
          }, depth + 1);
        }
      }
    }
  }

  private async processDbRow(id: string, depth: number): Promise<void> {
    const source = this.environment.rowById.get(id);
    if (!source) return;
    const sourceNode = this.nodes.get(id);
    if (sourceNode) sourceNode.coverage = "supportedFields";
    for (const field of source.loaded.schema.fields) {
      if (this.hitLimit) break;
      const value = source.row[field.name];
      if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) continue;
      const directEngineModel = source.logicalTable === "db\\battlefield_engines_tables" && field.name === "model" &&
        typeof value === "string" && ["rigid_model_v2", "wsmodel", "variantmeshdefinition"].includes(getAssetExtension(value));
      if (directEngineModel) {
        this.addAssetReference(id, value as string, "db-filename", { sourceField: field.name }, depth + 1);
        continue;
      }
      if (field.is_reference && field.is_reference.length > 0) {
        if (field.is_reference.length < 2 || !field.is_reference[1]) {
          this.environment.complete = false;
          this.diagnostics.push(diagnostic("UNSUPPORTED_DB_REFERENCE_SCHEMA", `Reference field ${field.name} has no target-field mapping`, source.entry.name));
          continue;
        }
        const targetTableName = field.is_reference[0].toLowerCase();
        const logical = getCanonicalLogicalTableName(`db\\${targetTableName.replace(/^db\\/, "")}`);
        const targetField = field.is_reference[1];
        const candidates = (await loadEffectiveDbRows(this.environment, logical)).filter((row) => row.row[targetField] === value);
        if (candidates.length === 1) {
          const target = candidates[0];
          this.addNode({
            id: target.id,
            path: target.entry.name,
            type: "db-row",
            status: "found",
            provider: target.provider.pack.path,
            providerKind: target.provider.kind,
            rowIndex: target.rowIndex,
            table: target.logicalTable,
            key: Object.fromEntries(target.loaded.schema.fields.filter((item) => item.is_key).map((item) => [item.name, target.row[item.name]])),
          });
          this.addEdge({ source: id, target: target.id, relationship: "db-reference", sourceField: field.name, status: "found" });
          if (this.nodes.has(target.id)) this.queueNode("db", target.id, depth + 1);
        } else {
          const targetId = `dbrow:${candidates.length ? "ambiguous" : "missing"}::${logical}::${targetField}::${JSON.stringify(value)}`;
          this.addNode({
            id: targetId,
            path: logical,
            table: logical,
            type: "db-row",
            status: candidates.length ? "ambiguous" : "missing",
            ...(candidates.length ? { candidates: candidates.map((row) => ({ packPath: row.provider.pack.path, entryPath: row.entry.name })) } : {}),
          });
          this.addEdge({ source: id, target: targetId, relationship: "db-reference", sourceField: field.name, status: candidates.length ? "ambiguous" : "missing" });
          this.environment.complete = false;
          this.diagnostics.push(diagnostic(candidates.length ? "AMBIGUOUS_DB_REFERENCE" : "MISSING_DB_REFERENCE", `${candidates.length ? "Multiple rows match" : "No row matches"} ${logical}.${targetField}=${String(value)}`, source.entry.name));
        }
      }

      if (typeof value === "string" && value.trim() !== "") {
        const patterns = parseFilenameRelativePaths(field.filename_relative_path);
        const direct = field.is_filename && patterns.length === 0 && getAssetExtension(value);
        if (field.is_filename && patterns.length === 0 && !direct) {
          this.environment.complete = false;
          this.diagnostics.push(diagnostic("UNSUPPORTED_FILENAME_MAPPING", `Filename field ${field.name} has no packed path mapping`, source.entry.name));
          continue;
        }
        if (patterns.length === 0 && !direct) continue;
        const matchedPaths = new Set<string>();
        if (patterns.length) {
          for (const pattern of patterns) {
            if (this.hitLimit) break;
            const match = getFilenameRelativePathMatch(pattern, value);
            if (match.exactPath) matchedPaths.add(normalizePackFilePath(match.exactPath));
            else if (match.prefix) {
              for (const [key, candidates] of this.environment.assetCandidates) {
                if (this.hitLimit) break;
                const candidateName = candidates[0]?.entry.name;
                if (candidateName && normalizePackFilePathKey(candidateName).startsWith(normalizePackFilePathKey(match.prefix))) matchedPaths.add(candidateName);
              }
            }
          }
        } else if (direct) matchedPaths.add(normalizePackFilePath(value));
        if (matchedPaths.size === 0) {
          this.environment.complete = false;
          this.diagnostics.push(diagnostic("MISSING_FILENAME_REFERENCE", `No packed asset matches ${field.name}=${value}`, source.entry.name));
        }
        for (const matchedPath of matchedPaths) {
          if (this.hitLimit) break;
          this.addAssetReference(id, matchedPath, "db-filename", { sourceField: field.name }, depth + 1);
        }
      }
    }
    if (source.logicalTable === "db\\warscape_animated_tables") {
      const animatedKey = source.row.key;
      if (animatedKey !== null && animatedKey !== undefined && String(animatedKey).trim()) {
        const lodRows = (await loadEffectiveDbRows(this.environment, "db\\warscape_animated_lod_tables"))
          .filter((row) => row.row.animated === animatedKey);
        if (lodRows.length === 0) {
          this.environment.complete = false;
          this.diagnostics.push(diagnostic(
            "MISSING_ANIMATED_LOD",
            `No warscape_animated_lod row references warscape_animated.key=${String(animatedKey)}`,
            source.entry.name,
          ));
        }
        for (const target of lodRows) {
          this.addNode({
            id: target.id,
            path: target.entry.name,
            type: "db-row",
            status: "found",
            provider: target.provider.pack.path,
            providerKind: target.provider.kind,
            rowIndex: target.rowIndex,
            table: target.logicalTable,
            key: Object.fromEntries(target.loaded.schema.fields.filter((item) => item.is_key).map((item) => [item.name, target.row[item.name]])),
          });
          this.addEdge({ source: id, target: target.id, relationship: "animated-lod", sourceField: "key", targetField: "animated", status: "found" });
          if (this.nodes.has(target.id)) this.queueNode("db", target.id, depth + 1);
        }
      }
    }
  }

  async drain(): Promise<void> {
    let drainedNodes = 0;
    while (this.queue.length && !this.hitLimit) {
      throwIfAborted(this.environment.context.signal);
      if ((drainedNodes++ & 63) === 0) await yieldToEventLoop(this.environment.context.signal);
      const item = this.queue.shift()!;
      if (this.processed.has(item.id)) continue;
      this.processed.add(item.id);
      if (item.kind === "asset") await this.processAsset(item.id, item.depth);
      else await this.processDbRow(item.id, item.depth);
    }
    if (this.environment.diagnostics.length > this.environmentDiagnosticCount) {
      this.diagnostics.push(...this.environment.diagnostics.slice(this.environmentDiagnosticCount));
      this.environmentDiagnosticCount = this.environment.diagnostics.length;
    }
  }

  async run(roots: readonly ReferenceGraphRoot[]): Promise<ReferenceGraphResult> {
    for (const root of roots) {
      if (this.hitLimit) break;
      if (root.type === "asset") this.addAssetRoot(root.path);
      else if (root.type === "db") await this.addDbRoot(root.path, root.where ?? []);
      else this.addDbRowRoot(root.row);
    }
    await this.drain();
    return {
      roots: this.roots,
      nodes: [...this.nodes.values()],
      edges: this.edges,
      diagnostics: this.diagnostics,
      complete: this.environment.complete && !this.hitLimit,
      coverage: {
        nodes: this.nodes.size,
        edges: this.edges.length,
        maxDepth: this.options.maxDepth,
        maxNodes: this.options.maxNodes,
        maxEdges: this.options.maxEdges,
        hitLimit: this.hitLimit,
      },
    };
  }
}

const pathExtension = (filePath: string): string => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".xml.material")) return "xml.material";
  if (lower.endsWith(".variantmeshdefinition")) return "variantmeshdefinition";
  if (lower.endsWith(".rigid_model_v2")) return "rigid_model_v2";
  return lower.split("\\").at(-1)?.match(/\.([a-z0-9_]+)$/)?.[1] ?? "";
};
const getAssetExtension = (filePath: string) => pathExtension(normalizePackFilePath(filePath));

export const buildReferenceGraph = async (
  environment: ReferenceEnvironment,
  roots: readonly ReferenceGraphRoot[],
  options: ReferenceGraphOptions,
): Promise<ReferenceGraphResult> => new ReferenceGraphBuilder(environment, options).run(roots);

export const findRigidLoaderEdges = async (
  environment: ReferenceEnvironment,
  targetPaths: readonly string[],
  limits: { maxNodes?: number; maxEdges?: number } = {},
): Promise<{ edges: Array<{ targetPath: string; sourcePath: string; edge: ReferenceGraphEdge }>; hitLimit: boolean }> => {
  const targetKeys = new Set(targetPaths.map((target) => normalizePackFilePathKey(normalizeInternalPackPath(target))));
  if (!targetKeys.size) return { edges: [], hitLimit: false };
  const builder = new ReferenceGraphBuilder(environment, {
    traversal: "direct",
    maxDepth: 32,
    maxNodes: limits.maxNodes ?? 25_000,
    maxEdges: limits.maxEdges ?? 50_000,
    traverseRigidInternals: false,
    traverseWsmodelMaterials: false,
  });
  let scannedAssets = 0;
  for (const candidates of environment.assetCandidates.values()) {
    throwIfAborted(environment.context.signal);
    if ((scannedAssets++ & 127) === 0) await yieldToEventLoop(environment.context.signal);
    if (builder.atCapacity) {
      builder.noteCapacityReached();
      break;
    }
    const highestOrder = candidates[candidates.length - 1].provider.order;
    const top = candidates.filter((candidate) => candidate.provider.order === highestOrder);
    if (top.length !== 1) continue;
    const entry = top[0].entry;
    const extension = pathExtension(entry.name);
    if (extension !== "variantmeshdefinition" && extension !== "wsmodel") continue;
    builder.addAssetRoot(entry.name, false);
    await builder.drain();
  }
  for (const logical of environment.dbFiles.keys()) {
    throwIfAborted(environment.context.signal);
    if (builder.atCapacity) {
      builder.noteCapacityReached();
      break;
    }
    const rows = await loadEffectiveDbRows(environment, logical);
    let scannedRows = 0;
    for (const row of rows) {
      throwIfAborted(environment.context.signal);
      if ((scannedRows++ & 127) === 0) await yieldToEventLoop(environment.context.signal);
      if (builder.atCapacity) {
        builder.noteCapacityReached();
        break;
      }
      builder.addDbRowRoot(row);
      await builder.drain();
    }
  }
  const graph = await builder.run([]);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges.flatMap((edge) => {
    if (!edge.loadMode || edge.status !== "found") return [];
    const target = nodes.get(edge.target);
    const source = nodes.get(edge.source);
    if (!target || !source) return [];
    const key = normalizePackFilePathKey(target.path);
    return targetKeys.has(key) ? [{ targetPath: target.path, sourcePath: source.path, edge }] : [];
  });
  return { edges, hitLimit: graph.coverage.hitLimit };
};

const writeFullReport = async (
  context: AutomationContext,
  reportPath: string | undefined,
  sourcePaths: readonly string[],
  full: unknown,
): Promise<string | undefined> => {
  if (!reportPath) return undefined;
  const report = await context.policy.withAtomicOutput({
    outputPath: reportPath,
    sourcePaths,
    produce: async (temporaryPath) => fs.writeFile(temporaryPath, `${JSON.stringify(full, null, 2)}\n`),
  });
  return report.path;
};

const previewPage = <T>(items: readonly T[], offset: number, limit: number) => ({
    total: items.length,
    offset,
    limit,
    items: items.slice(offset, offset + limit),
    nextOffset: offset + limit < items.length ? offset + limit : null,
    hasMore: offset + limit < items.length,
});

export const runAssetResolveReferences = async (request: ResolveRequest, context: AutomationContext) => {
  const environment = await prepareReferenceEnvironment(context, request.packPaths, request.vanillaPackPaths, request.gameDataPath);
  const roots: ReferenceGraphRoot[] = request.roots.map((root) => typeof root === "string"
    ? (() => {
        const normalized = normalizeInternalPackPath(root);
        if (tableLogicalName(normalized)) throw new AutomationError("INVALID_ARGUMENT", "DB row roots must include filePath and where filters", { filePath: normalized });
        return { type: "asset" as const, path: normalized };
      })()
    : { type: "db", path: normalizeInternalPackPath(root.filePath), where: root.where as TableFilter[] });
  const graph = await buildReferenceGraph(environment, roots, {
    traversal: request.traversal,
    maxDepth: request.maxDepth,
    maxNodes: request.maxNodes,
    maxEdges: request.maxEdges,
  });
  const reportPath = await writeFullReport(context, request.reportPath, environment.sourcePaths, graph);
  const data = {
    roots: graph.roots,
    complete: graph.complete,
    coverage: graph.coverage,
    nodePage: previewPage(graph.nodes, request.offset, request.limit),
    edgePage: previewPage(graph.edges, request.offset, request.limit),
    diagnosticsTotal: graph.diagnostics.length,
    diagnostics: graph.diagnostics.slice(0, 1000),
    ...(reportPath ? { reportPath } : {}),
  };
  return { data, diagnostics: graph.diagnostics.slice(0, 1000) };
};

export const runAssetFindReferences = async (request: FindRequest, context: AutomationContext) => {
  const environment = await prepareReferenceEnvironment(context, request.packPaths, request.vanillaPackPaths, request.gameDataPath);
  const targetPath = normalizeInternalPackPath(request.targetPath);
  const builder = new ReferenceGraphBuilder(environment, {
    traversal: "direct",
    maxDepth: 2,
    maxNodes: request.maxNodes,
    maxEdges: request.maxEdges,
  });
  let xmlRootCount = 0;
  let ddsLeafCount = 0;
  let rigidFileCount = 0;
  let skippedFileCount = 0;
  const skippedFileTypes: Record<string, number> = {};
  let scannedAssets = 0;
  for (const candidates of environment.assetCandidates.values()) {
    throwIfAborted(context.signal);
    if ((scannedAssets++ & 127) === 0) await yieldToEventLoop(context.signal);
    if (builder.atCapacity) {
      builder.noteCapacityReached();
      break;
    }
    const highest = candidates[candidates.length - 1].provider.order;
    const top = candidates.filter((candidate) => candidate.provider.order === highest);
    if (top.length !== 1) {
      environment.complete = false;
      environment.diagnostics.push(diagnostic("AMBIGUOUS_ASSET", `Effective file path is ambiguous: ${top[0]?.entry.name ?? ""}`, top[0]?.entry.name));
      continue;
    }
    const entry = top[0].entry;
    const ext = pathExtension(entry.name);
    if (ext === "variantmeshdefinition" || ext === "wsmodel" || ext === "xml.material") {
      builder.addAssetRoot(entry.name, false);
      xmlRootCount += 1;
      await builder.drain();
    } else if (ext === "dds") {
      ddsLeafCount += 1;
    } else if (tableLogicalName(entry.name)) {
      // DB tables are scanned as rows below, after resolving the effective table files.
      continue;
    } else if (ext === "rigid_model_v2") {
      builder.addAssetRoot(entry.name, false);
      rigidFileCount += 1;
      await builder.drain();
    } else {
      skippedFileCount += 1;
      const type = ext || "(no extension)";
      skippedFileTypes[type] = (skippedFileTypes[type] ?? 0) + 1;
      environment.complete = false;
      environment.diagnostics.push(diagnostic("UNSUPPORTED_REVERSE_SCAN_TYPE", `Reverse scanning skipped unsupported file type ${type}`, entry.name));
    }
  }
  const targetKey = normalizePackFilePathKey(targetPath);
  const targetTable = tableLogicalName(targetPath);
  for (const logical of environment.dbFiles.keys()) {
    throwIfAborted(context.signal);
    if (builder.atCapacity) {
      builder.noteCapacityReached();
      break;
    }
    const dbRows = await loadEffectiveDbRows(environment, logical);
    let scannedRows = 0;
    for (const row of dbRows) {
      throwIfAborted(context.signal);
      if ((scannedRows++ & 127) === 0) await yieldToEventLoop(context.signal);
      if (builder.atCapacity) {
        builder.noteCapacityReached();
        break;
      }
      builder.addDbRowRoot(row);
      await builder.drain();
    }
  }
  const graph = await builder.run([]);
  const unsupportedRigidFileCount = graph.nodes.filter((node) => node.extension === "rigid_model_v2" && node.coverage !== "supportedRigidInternals").length;
  if (unsupportedRigidFileCount > 0) {
    skippedFileTypes.rigid_model_v2 = unsupportedRigidFileCount;
    skippedFileCount += unsupportedRigidFileCount;
  }
  const matchingEdges = graph.edges.filter((edge) => {
    const target = builder.nodes.get(edge.target);
    return target && (normalizePackFilePathKey(target.path) === targetKey || (targetTable && target.table === targetTable));
  });
  const targetNode = graph.nodes.find((node) => node.type === "asset" && normalizePackFilePathKey(node.path) === targetKey);
  const isRigidTarget = targetNode?.extension === "rigid_model_v2";
  const modelBindingEdges = graph.edges.filter((edge) => edge.loadMode);
  const targetBindingEdges = matchingEdges.filter((edge) => edge.loadMode);
  const allEdges = isRigidTarget
    ? matchingEdges.map((edge, index) => ({ edge, index })).sort((left, right) => {
        const rank = (mode: ReferenceGraphEdge["loadMode"]) => mode === "direct" ? 0 : mode === "wsmodel" ? 1 : 2;
        return rank(left.edge.loadMode) - rank(right.edge.loadMode) || left.index - right.index;
      }).map(({ edge }) => edge)
    : matchingEdges;
  const embeddedTextureEdges = graph.edges.filter((edge) => edge.relationship === "embedded-texture");
  const full = {
    targetPath,
    complete: graph.complete,
    coverage: {
      scanScope: "effective XML-backed visual assets and DB rows plus supported RMV2 material textures; DDS files are fully covered leaves",
      xmlFiles: xmlRootCount,
      dbTables: environment.dbFiles.size,
      ddsLeaves: ddsLeafCount,
      rigidFilesScanned: rigidFileCount,
      rigidFilesUnsupported: unsupportedRigidFileCount,
      directRigidBindings: modelBindingEdges.filter((edge) => edge.loadMode === "direct").length,
      wsModelGeometryBindings: modelBindingEdges.filter((edge) => edge.loadMode === "wsmodel").length,
      ...(isRigidTarget ? { loaderCounts: {
        direct: targetBindingEdges.filter((edge) => edge.loadMode === "direct").length,
        wsmodel: targetBindingEdges.filter((edge) => edge.loadMode === "wsmodel").length,
      } } : {}),
      embeddedTextureBindings: embeddedTextureEdges.length,
      skippedFiles: skippedFileCount,
      unsupportedFileTypes: skippedFileTypes,
      nodes: builder.nodes.size,
      edges: graph.edges.length,
    },
    diagnostics: graph.diagnostics,
    references: allEdges,
  };
  const reportPath = await writeFullReport(context, request.reportPath, environment.sourcePaths, full);
  const data = {
    targetPath,
    complete: graph.complete,
    coverage: full.coverage,
    references: previewPage(allEdges, request.offset, request.limit),
    diagnosticsTotal: graph.diagnostics.length,
    diagnostics: graph.diagnostics.slice(0, 1000),
    ...(reportPath ? { reportPath } : {}),
  };
  return { data, diagnostics: graph.diagnostics.slice(0, 1000) };
};
