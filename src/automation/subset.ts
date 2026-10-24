import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { parseDBTablePath } from "../utility/packFileHelpers";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import { readPackIndex, rewriteDbTableRows, writeRawPack, type CorePack, type CorePackEntry, type RawPackWriteEntry } from "../packCore";
import { AutomationError, throwIfAborted, yieldToEventLoop, type AutomationDiagnostic } from "./errors";
import { normalizeInternalPackPath } from "./filesystem";
import { readAutomationPayload, getAutomationSchemaProvider } from "./packAccess";
import {
  buildReferenceGraph,
  loadEffectiveDbRows,
  loadExactDbFileRows,
  prepareReferenceEnvironment,
  resolveReferenceAsset,
  type EffectiveDbRow,
  type ReferenceGraphRoot,
  type ReferenceProvider,
} from "./references";
import { loadPackedTable, queryTableRows, type TableFilter } from "./tables";
import type { AutomationContext } from "./operations";

const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))]);
const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in", "contains"]),
  value: scalarSchema,
}).strict();
const rowRootSchema = z.object({ filePath: z.string().min(1), where: z.array(filterSchema).max(1000) }).strict();

export const packSubsetSchema = z.object({
  operation: z.literal("pack_subset"),
  sourcePackPaths: z.array(z.string().min(1)).min(1).max(512),
  /** Complete low-to-high mod load order. Every sourcePackPath must occur here. */
  packPaths: z.array(z.string().min(1)).min(1).max(512).optional(),
  vanillaPackPaths: z.array(z.string().min(1)).max(512).optional(),
  gameDataPath: z.string().min(1).optional(),
  paths: z.array(z.string().min(1)).max(10000).default([]),
  prefixes: z.array(z.string().min(1)).max(1000).default([]),
  globs: z.array(z.string().min(1)).max(1000).default([]),
  tableNames: z.array(z.string().min(1)).max(1000).default([]),
  assetRoots: z.array(z.string().min(1)).max(1000).default([]),
  rows: z.array(rowRootSchema).max(1000).default([]),
  closure: z.enum(["none", "direct", "transitive"]).default("none"),
  mode: z.enum(["external", "selfContained"]).default("external"),
  includeVanilla: z.boolean().default(false),
  strict: z.boolean().default(false),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(100),
  outputPath: z.string().min(1),
  overwrite: z.boolean().default(false),
  manifestPath: z.string().min(1).optional(),
  reportPath: z.string().min(1).optional(),
}).strict().refine((request) =>
  request.paths.length + request.prefixes.length + request.globs.length + request.tableNames.length + request.assetRoots.length + request.rows.length > 0,
"At least one subset selection is required");

type SubsetRequest = z.output<typeof packSubsetSchema>;

interface SelectedFile {
  provider: ReferenceProvider;
  entry: CorePackEntry;
  reasons: Set<string>;
  shadowedCandidates?: Array<{ packPath: string; entryPath: string; kind: "mod" | "vanilla" }>;
}

interface SelectedRows {
  provider: ReferenceProvider;
  entry: CorePackEntry;
  rows: Map<number, EffectiveDbRow>;
}

interface ExpectedPayload {
  name: string;
  sourcePack?: CorePack;
  sourceEntry?: CorePackEntry;
  buffer?: Buffer;
}

const canonicalAbsolute = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
const pathExt = (value: string) => {
  const lower = value.toLowerCase();
  if (lower.endsWith(".xml.material")) return "xml.material";
  if (lower.endsWith(".variantmeshdefinition")) return "variantmeshdefinition";
  if (lower.endsWith(".rigid_model_v2")) return "rigid_model_v2";
  return lower.split("\\").at(-1)?.match(/\.([a-z0-9_]+)$/)?.[1] ?? "";
};
const isDbPath = (value: string) => parseDBTablePath(normalizePackFilePathKey(value))?.dbFolder === "db";

const assertSafePattern = (value: string): string => {
  if (!value || value.includes("\0") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
    throw new AutomationError("INVALID_ARGUMENT", `Invalid packed path pattern: ${JSON.stringify(value)}`);
  }
  const normalized = value.replace(/\\/g, "/");
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new AutomationError("INVALID_ARGUMENT", `Packed path pattern cannot contain parent segments: ${value}`);
  }
  return normalized.toLowerCase();
};

const entryMatches = (entry: CorePackEntry, request: SubsetRequest): boolean => {
  const key = normalizePackFilePathKey(entry.name);
  for (const value of request.paths) if (key === normalizePackFilePathKey(normalizeInternalPackPath(value))) return true;
  for (const value of request.prefixes) {
    const prefix = normalizePackFilePathKey(normalizeInternalPackPath(value));
    if (key === prefix || key.startsWith(`${prefix}\\`)) return true;
  }
  const slashName = key.replace(/\\/g, "/");
  for (const pattern of request.globs) if (path.posix.matchesGlob(slashName, assertSafePattern(pattern))) return true;
  for (const table of request.tableNames) {
    const parsed = parseDBTablePath(key);
    const requested = table.toLowerCase().replace(/^db\\/, "");
    if (parsed?.dbFolder === "db" && parsed.dbName.toLowerCase() === requested) return true;
  }
  return false;
};

const hashRange = async (filePath: string, start: number, size: number): Promise<string> => {
  const hash = createHash("sha256");
  if (size === 0) return hash.digest("hex");
  const stream = fs.createReadStream(filePath, { start, end: start + size - 1 });
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

const jsonOutput = async (
  context: AutomationContext,
  outputPath: string | undefined,
  sourcePaths: readonly string[],
  value: unknown,
): Promise<string | undefined> => {
  if (!outputPath) return undefined;
  const result = await context.policy.withAtomicOutput({
    outputPath,
    sourcePaths,
    produce: async (temporaryPath) => fsp.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`),
  });
  return result.path;
};

const selectEffectiveSource = (
  environment: Awaited<ReturnType<typeof prepareReferenceEnvironment>>,
  sourceProviderPaths: ReadonlySet<string>,
  packedPath: string,
  reason: string,
  selectedFiles: Map<string, SelectedFile>,
): SelectedFile => {
  const resolved = resolveReferenceAsset(environment, packedPath, false);
  if (resolved.status === "missing") throw new AutomationError("VALIDATION", `Selected packed file does not exist: ${packedPath}`);
  if (resolved.status === "ambiguous" || !resolved.winner) throw new AutomationError("CONFLICT", `Selected packed file path is ambiguous: ${packedPath}`);
  if (!sourceProviderPaths.has(canonicalAbsolute(resolved.winner.provider.pack.path))) {
    throw new AutomationError("CONFLICT", `Selected file ${packedPath} is shadowed by a pack outside sourcePackPaths`, {
      winner: resolved.winner.provider.pack.path,
      sourcePackPaths: [...sourceProviderPaths],
      hint: "Add the winning pack to sourcePackPaths or reorder the complete packPaths load list.",
    });
  }
  const selected: SelectedFile = {
    provider: resolved.winner.provider,
    entry: resolved.winner.entry,
    reasons: selectedFiles.get(resolved.key)?.reasons ?? new Set<string>(),
    shadowedCandidates: resolved.shadowed?.map(({ provider, entry }) => ({ packPath: provider.pack.path, entryPath: entry.name, kind: provider.kind })),
  };
  selected.reasons.add(reason);
  selectedFiles.set(resolved.key, selected);
  return selected;
};

const assertUniqueEntries = (entries: readonly RawPackWriteEntry[]) => {
  const names = new Map<string, string>();
  for (const entry of entries) {
    const key = normalizePackFilePathKey(entry.name);
    const previous = names.get(key);
    if (previous) throw new AutomationError("CONFLICT", `Subset output contains duplicate normalized path ${entry.name}`, { previous, name: entry.name });
    names.set(key, entry.name);
  }
};

const rowJsonKey = (row: EffectiveDbRow): Record<string, unknown> => Object.fromEntries(
  row.loaded.schema.fields.filter((field) => field.is_key).map((field) => [field.name, row.row[field.name]]),
);

export const runPackSubset = async (request: SubsetRequest, context: AutomationContext) => {
  const modLoadOrder = request.packPaths ?? request.sourcePackPaths;
  const environment = await prepareReferenceEnvironment(context, modLoadOrder, request.vanillaPackPaths, request.gameDataPath);
  const canonicalSourcePaths = await Promise.all(request.sourcePackPaths.map((sourcePath) => context.policy.assertReadPath(sourcePath)));
  const sourceProviderPaths = new Set(canonicalSourcePaths.map(canonicalAbsolute));
  const providersByPath = new Map(environment.providers.map((provider) => [canonicalAbsolute(provider.pack.path), provider]));
  const missingSources = [...sourceProviderPaths].filter((sourcePath) => !providersByPath.has(sourcePath));
  if (missingSources.length) throw new AutomationError("INVALID_ARGUMENT", "Every sourcePackPath must occur in the complete packPaths list", { missingSourcePackPaths: missingSources });
  if (request.packPaths) {
    const canonicalLoadOrder = await Promise.all(request.packPaths.map((value) => context.policy.assertReadPath(value)));
    const completePaths = new Set(canonicalLoadOrder.map(canonicalAbsolute));
    const omitted = [...sourceProviderPaths].filter((sourcePath) => !completePaths.has(sourcePath));
    if (omitted.length) throw new AutomationError("INVALID_ARGUMENT", "packPaths is the complete mod load order and must contain every sourcePackPath", { omitted });
  }
  const primaryProvider = providersByPath.get(canonicalAbsolute(canonicalSourcePaths[0]));
  if (!primaryProvider || primaryProvider.kind !== "mod") throw new AutomationError("INVALID_ARGUMENT", "The first sourcePackPath could not be loaded as a mod pack");

  const selectedFiles = new Map<string, SelectedFile>();
  const selectedRows = new Map<string, SelectedRows>();
  const selectedReasons = new Map<string, Set<string>>();
  const graphRoots: ReferenceGraphRoot[] = [];
  const exactPathMatches = new Set<string>();

  let candidateEntries = 0;
  for (const provider of environment.providers.filter((candidate) => candidate.kind === "mod" && sourceProviderPaths.has(canonicalAbsolute(candidate.pack.path)))) {
    throwIfAborted(context.signal);
    for (const entry of provider.pack.entries) {
      throwIfAborted(context.signal);
      if ((candidateEntries++ & 127) === 0) await yieldToEventLoop(context.signal);
      if (!entryMatches(entry, request)) continue;
      const key = normalizePackFilePathKey(entry.name);
      exactPathMatches.add(key);
      const reasons = selectedReasons.get(key) ?? new Set<string>();
      if (request.paths.some((value) => normalizePackFilePathKey(normalizeInternalPackPath(value)) === key)) reasons.add("path");
      if (request.prefixes.some((value) => {
        const prefix = normalizePackFilePathKey(normalizeInternalPackPath(value));
        return key === prefix || key.startsWith(`${prefix}\\`);
      })) reasons.add("prefix");
      if (request.globs.some((value) => path.posix.matchesGlob(key.replace(/\\/g, "/"), assertSafePattern(value)))) reasons.add("glob");
      if (request.tableNames.some((table) => {
        const parsed = parseDBTablePath(key);
        return parsed?.dbFolder === "db" && parsed.dbName.toLowerCase() === table.toLowerCase().replace(/^db\\/, "");
      })) reasons.add("tableName");
      selectedReasons.set(key, reasons);
    }
  }

  for (const value of request.paths) {
    const key = normalizePackFilePathKey(normalizeInternalPackPath(value));
    if (!exactPathMatches.has(key)) throw new AutomationError("VALIDATION", `Selected path was not found in sourcePackPaths: ${value}`);
  }

  for (const key of exactPathMatches) {
    const entryName = environment.providers
      .filter((provider) => sourceProviderPaths.has(canonicalAbsolute(provider.pack.path)))
      .find((provider) => provider.entriesByPath.has(key))
      ?.entriesByPath.get(key)?.[0]?.name;
    if (!entryName) continue;
    selectEffectiveSource(environment, sourceProviderPaths, entryName, [...(selectedReasons.get(key) ?? ["selection"])].join(","), selectedFiles);
  }

  for (const assetRoot of request.assetRoots) {
    throwIfAborted(context.signal);
    const resolved = resolveReferenceAsset(environment, normalizeInternalPackPath(assetRoot), true);
    if (resolved.status !== "found" || !resolved.winner) throw new AutomationError(resolved.status === "ambiguous" ? "CONFLICT" : "VALIDATION", `Asset root could not be resolved: ${assetRoot}`);
    const selected = selectEffectiveSource(environment, sourceProviderPaths, resolved.path, "assetRoot", selectedFiles);
    graphRoots.push({ type: "asset", path: selected.entry.name });
  }

  const exactRowsFor = async (filePath: string): Promise<EffectiveDbRow[]> => {
    const resolved = resolveReferenceAsset(environment, filePath, false);
    if (resolved.status !== "found" || !resolved.winner) throw new AutomationError(resolved.status === "ambiguous" ? "CONFLICT" : "VALIDATION", `DB table file could not be resolved: ${filePath}`);
    if (!sourceProviderPaths.has(canonicalAbsolute(resolved.winner.provider.pack.path))) {
      throw new AutomationError("CONFLICT", `Selected DB file ${filePath} is shadowed by a pack outside sourcePackPaths`, { winner: resolved.winner.provider.pack.path });
    }
    return loadExactDbFileRows(environment, resolved.path);
  };

  const loadDbSchema = async (filePath: string) => {
    const resolved = resolveReferenceAsset(environment, filePath, false);
    if (resolved.status !== "found" || !resolved.winner) throw new AutomationError("VALIDATION", `DB table file could not be resolved: ${filePath}`);
    const bytes = await readAutomationPayload(resolved.winner.provider.pack, resolved.winner.entry, context);
    return loadPackedTable(resolved.winner.entry.name, bytes, getAutomationSchemaProvider(context));
  };

  const fullDbFiles = [...selectedFiles.values()].filter((selected) => isDbPath(selected.entry.name));
  for (const selected of fullDbFiles) {
    try {
      const rows = await loadExactDbFileRows(environment, selected.entry.name);
      for (const row of rows) graphRoots.push({ type: "db-row", row });
    } catch {
      // Raw whole-table inclusion remains possible; validation diagnostics below record unknown schema coverage.
    }
  }

  for (const rowRoot of request.rows) {
    throwIfAborted(context.signal);
    const filePath = normalizeInternalPackPath(rowRoot.filePath);
    const rows = await exactRowsFor(filePath);
    const schema = rows[0]?.loaded.schema ?? (await loadDbSchema(filePath)).parsed.schema;
    try {
      queryTableRows({ schema }, [], rowRoot.where as TableFilter[]);
    } catch (error) {
      throw new AutomationError("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error), { filePath });
    }
    const matches = rows.filter((row) => queryTableRows(row.loaded, [row.row], rowRoot.where as TableFilter[]).length > 0);
    if (matches.length === 0) throw new AutomationError("VALIDATION", `No rows match selector in ${filePath}`);
    for (const row of matches) {
      const key = normalizePackFilePathKey(row.entry.name);
      const group = selectedRows.get(key) ?? { provider: row.provider, entry: row.entry, rows: new Map<number, EffectiveDbRow>() };
      group.rows.set(row.rowIndex, row);
      selectedRows.set(key, group);
      graphRoots.push({ type: "db-row", row });
    }
  }
  const explicitlySelectedRows = [...selectedRows.values()].map(({ entry, provider, rows }) => ({
    path: entry.name,
    provider: provider.pack.path,
    rowIndexes: [...rows.keys()].sort((left, right) => left - right),
  }));

  if (selectedFiles.size === 0 && selectedRows.size === 0) throw new AutomationError("VALIDATION", "Subset selection matched no packed files or DB rows");
  for (const [key, selected] of selectedFiles) {
    throwIfAborted(context.signal);
    if (isDbPath(selected.entry.name)) continue;
    const extension = pathExt(selected.entry.name);
    if (request.closure !== "none" || ["variantmeshdefinition", "wsmodel", "xml.material", "rigid_model_v2", "dds"].includes(extension)) {
      graphRoots.push({ type: "asset", path: selected.entry.name });
    }
  }

  const closureTraversal = request.closure === "transitive" ? "recursive" : "direct";
  const graph = graphRoots.length
    ? await buildReferenceGraph(environment, graphRoots, { traversal: closureTraversal, maxDepth: 32, maxNodes: 10000, maxEdges: 50000 })
    : { roots: [], nodes: [], edges: [], diagnostics: environment.diagnostics, complete: environment.complete, coverage: { nodes: 0, edges: 0, maxDepth: 32, maxNodes: 10000, maxEdges: 50000, hitLimit: false } };

  for (const selected of selectedFiles.values()) {
    selected.reasons.add("selected");
  }
  for (const [key, selected] of selectedRows) {
    if (selectedFiles.has(key)) selectedRows.delete(key);
  }

  const includedFiles = new Map(selectedFiles);
  const includedRows = new Map(selectedRows);
  const external: Array<Record<string, unknown>> = [];
  const unresolved: Array<Record<string, unknown>> = [];
  const unsupported: Array<Record<string, unknown>> = [];
  const canCopyProvider = (provider: ReferenceProvider): boolean => {
    if (sourceProviderPaths.has(canonicalAbsolute(provider.pack.path))) return true;
    if (request.mode !== "selfContained") return false;
    return provider.kind === "mod" || request.includeVanilla;
  };

  let graphNodes = 0;
  for (const node of graph.nodes) {
    throwIfAborted(context.signal);
    if ((graphNodes++ & 127) === 0) await yieldToEventLoop(context.signal);
    if (node.type === "asset" && node.status === "found" && node.provider) {
      const provider = providersByPath.get(canonicalAbsolute(node.provider));
      const entry = provider?.entriesByPath.get(normalizePackFilePathKey(node.path))?.[0];
      if (!provider || !entry) {
        unresolved.push({ path: node.path, status: "missing-provider" });
        continue;
      }
      const key = normalizePackFilePathKey(entry.name);
      if (includedFiles.has(key) || request.closure === "none" || !canCopyProvider(provider)) continue;
      includedFiles.set(key, { provider, entry, reasons: new Set(["referenceClosure"]), shadowedCandidates: node.shadowedCandidates });
    } else if (node.type === "db-row" && node.status === "found") {
      const row = environment.rowById.get(node.id);
      if (!row) continue;
      const key = normalizePackFilePathKey(row.entry.name);
      if (includedFiles.has(key) || includedRows.get(key)?.rows.has(row.rowIndex) || request.closure === "none" || !canCopyProvider(row.provider)) continue;
      const group = includedRows.get(key) ?? { provider: row.provider, entry: row.entry, rows: new Map<number, EffectiveDbRow>() };
      group.rows.set(row.rowIndex, row);
      includedRows.set(key, group);
    }
    if (node.status === "missing" || node.status === "ambiguous") unresolved.push({ path: node.path, status: node.status, candidates: node.candidates });
    if (node.status === "unsupported" || node.coverage === "unsupportedInternals" || node.coverage === "unsupportedType" || node.coverage === "unreadable") {
      unsupported.push({ path: node.path, status: node.status, coverage: node.coverage });
    }
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const target = nodeById.get(edge.target);
    if (!target) continue;
    const record: Record<string, unknown> = {
      path: target.path,
      relationship: edge.relationship,
      ...(edge.sourceField ? { sourceField: edge.sourceField } : {}),
      ...(edge.location ? { location: edge.location } : {}),
      ...(edge.conditional ? { conditional: edge.conditional } : {}),
      status: edge.status,
      ...(target.provider ? { provider: target.provider } : {}),
      ...(target.providerKind ? { providerKind: target.providerKind } : {}),
    };
    if (target.status === "missing" || target.status === "ambiguous") unresolved.push({ ...record, candidates: target.candidates });
    if (target.status === "unsupported") unsupported.push(record);
    if (target.status === "found") {
      const row = target.type === "db-row" ? environment.rowById.get(target.id) : undefined;
      const key = normalizePackFilePathKey(row?.entry.name ?? target.path);
      const included = target.type === "asset"
        ? includedFiles.has(key)
        : includedFiles.has(key) || Boolean(row && includedRows.get(key)?.rows.has(row.rowIndex));
      if (!included) external.push(record);
    }
  }
  const deduplicate = (items: Array<Record<string, unknown>>) => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
  external.splice(0, external.length, ...deduplicate(external));
  unresolved.splice(0, unresolved.length, ...deduplicate(unresolved));
  unsupported.splice(0, unsupported.length, ...deduplicate(unsupported));

  const graphDiagnostics = graph.diagnostics;
  for (const item of graphDiagnostics) {
    throwIfAborted(context.signal);
    if (item.code.startsWith("UNSUPPORTED") && !unsupported.some((value) => value.path === item.path && value.code === item.code)) unsupported.push({ code: item.code, path: item.path, message: item.message });
    if (["MISSING_ASSET", "AMBIGUOUS_ASSET", "MISSING_DB_REFERENCE", "AMBIGUOUS_DB_REFERENCE"].includes(item.code)) unresolved.push({ code: item.code, path: item.path, message: item.message });
  }

  if (request.strict && request.closure !== "none" && !graph.complete) {
    throw new AutomationError("VALIDATION", "Strict subset closure is incomplete; no output pack was published", { diagnostics: graphDiagnostics, unresolved, unsupported });
  }
  if (request.strict && request.mode === "selfContained" && request.closure !== "transitive") {
    throw new AutomationError("VALIDATION", "Strict self-contained output requires transitive closure");
  }
  if (request.strict && request.mode === "selfContained" && (external.length > 0 || unresolved.length > 0 || unsupported.length > 0)) {
    throw new AutomationError("VALIDATION", "Strict self-contained subset has external, unresolved, or unsupported dependencies", { external, unresolved, unsupported });
  }

  const writeEntries: RawPackWriteEntry[] = [];
  const expected: ExpectedPayload[] = [];
  let selectedFileCount = 0;
  for (const selected of includedFiles.values()) {
    throwIfAborted(context.signal);
    if ((selectedFileCount++ & 127) === 0) await yieldToEventLoop(context.signal);
    const key = normalizePackFilePathKey(selected.entry.name);
    if (selectedRows.has(key)) selectedRows.delete(key);
    writeEntries.push({
      name: selected.entry.name,
      is_compressed: selected.entry.is_compressed,
      source: { path: selected.provider.pack.path, start_pos: selected.entry.start_pos, file_size: selected.entry.file_size },
    });
    expected.push({ name: selected.entry.name, sourcePack: selected.provider.pack, sourceEntry: selected.entry });
  }
  for (const group of includedRows.values()) {
    throwIfAborted(context.signal);
    if (!group.rows.size) continue;
    const bytes = await readAutomationPayload(group.provider.pack, group.entry, context);
    const loaded = await loadPackedTable(group.entry.name, bytes, getAutomationSchemaProvider(context));
    if (loaded.isLoc) throw new AutomationError("VALIDATION", `Selected DB file is a localization table: ${group.entry.name}`);
    const table = loaded.parsed;
    const selectedIndexes = [...group.rows.keys()].sort((left, right) => left - right);
    const outputBytes = rewriteDbTableRows(table, selectedIndexes.map((index) => {
      const row = table.rows[index];
      if (!row) throw new AutomationError("VALIDATION", `Selected DB row index ${index} is outside ${group.entry.name}`);
      return row.cells.map((cell) => ({ bytes: cell.bytes }));
    }));
    writeEntries.push({ name: group.entry.name, is_compressed: false, buffer: outputBytes });
    expected.push({ name: group.entry.name, buffer: outputBytes });
  }
  assertUniqueEntries(writeEntries);
  if (!writeEntries.length) throw new AutomationError("VALIDATION", "Subset selection produced no output files");

  const primary = primaryProvider.pack;
  const externalModProviders = new Set(external.filter((entry) => entry.providerKind === "mod").map((entry) => path.basename(String(entry.provider))));
  const dependencies = [...new Set([...primary.dependencies, ...externalModProviders])];
  const packType: "movie" | "mod" = (primary.header.byteMask & 0x7) === 4 ? "movie" : "mod";
  const metadata = {
    game: "wh3" as const,
    byteMask: primary.header.byteMask & ~0x40,
    refFileCount: primary.header.refFileCount,
    headerBuffer: primary.header.headerBuffer,
    dependencies,
    ...(JSON.stringify(dependencies) === JSON.stringify(primary.dependencies) ? { dependencyBytes: primary.dependencyBytes } : {}),
    trailingBytes: primary.trailingBytes,
    packType,
  };

  const preflightJsonOutput = async (outputPath: string | undefined) => {
    if (!outputPath) return;
    const canonical = await context.policy.assertOutputDistinctFromSources(outputPath, environment.sourcePaths);
    const existing = await fsp.stat(canonical).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing) throw new AutomationError("CONFLICT", `Output already exists: ${outputPath}`, { path: outputPath });
  };
  await preflightJsonOutput(request.manifestPath);
  await preflightJsonOutput(request.reportPath);

  const output = await context.policy.withAtomicOutput({
    outputPath: request.outputPath,
    overwrite: request.overwrite,
    sourcePaths: environment.sourcePaths,
    produce: (temporaryPath) => writeRawPack(temporaryPath, writeEntries, metadata),
    validate: async (temporaryPath) => {
      const reopened = readPackIndex(temporaryPath, { game: "wh3" });
      if (reopened.entries.length !== expected.length) throw new AutomationError("VALIDATION", "Subset output file count does not match the selected manifest", { expected: expected.length, actual: reopened.entries.length });
      if ((reopened.header.byteMask & 0x40) !== 0) throw new AutomationError("VALIDATION", "Subset output unexpectedly retains the filename-hash flag");
      if (!reopened.trailingBytes.equals(primary.trailingBytes)) throw new AutomationError("VALIDATION", "Subset output did not preserve source trailing bytes");
      if (JSON.stringify(reopened.dependencies) !== JSON.stringify(dependencies)) throw new AutomationError("VALIDATION", "Subset output dependency metadata does not match the manifest");
      const outputEntries = new Map<string, CorePackEntry[]>();
      for (const entry of reopened.entries) {
        const key = normalizePackFilePathKey(entry.name);
        const values = outputEntries.get(key) ?? [];
        values.push(entry);
        outputEntries.set(key, values);
      }
      for (const item of expected) {
        const entries = outputEntries.get(normalizePackFilePathKey(item.name));
        if (entries?.length !== 1) throw new AutomationError("VALIDATION", `Subset output failed to reopen ${item.name}`);
        const entry = entries[0];
        const outputHash = await hashRange(temporaryPath, entry.start_pos, entry.file_size);
        const expectedHash = item.buffer
          ? createHash("sha256").update(item.buffer).digest("hex")
          : await hashRange(item.sourcePack!.path, item.sourceEntry!.start_pos, item.sourceEntry!.file_size);
        if (outputHash !== expectedHash) throw new AutomationError("VALIDATION", `Subset output payload changed for ${item.name}`);
        const sourceEntry = item.sourceEntry;
        if (sourceEntry && (entry.file_size !== sourceEntry.file_size || entry.is_compressed !== sourceEntry.is_compressed)) {
          throw new AutomationError("VALIDATION", `Subset output did not preserve stored metadata for ${item.name}`);
        }
      }
    },
  });

  const includedFileManifest = [...includedFiles.values()].map(({ provider, entry, reasons, shadowedCandidates }) => ({
    path: entry.name,
    provider: provider.pack.path,
    providerKind: provider.kind,
    storedSize: entry.file_size,
    compressed: entry.is_compressed,
    reasons: [...reasons],
    ...(shadowedCandidates?.length ? { shadowedCandidates } : {}),
  }));
  const includedRowManifest = [...includedRows.values()].map(({ provider, entry, rows }) => ({
    path: entry.name,
    provider: provider.pack.path,
    providerKind: provider.kind,
    rows: [...rows.values()].sort((a, b) => a.rowIndex - b.rowIndex).map((row) => ({ rowIndex: row.rowIndex, key: rowJsonKey(row) })),
  }));
  const selfContained = request.mode === "selfContained" && request.closure === "transitive" && graph.complete && external.length === 0 && unresolved.length === 0 && unsupported.length === 0;
  const manifest = {
    sourcePackPaths: request.sourcePackPaths,
    packPaths: modLoadOrder,
    vanillaPackPaths: request.vanillaPackPaths ?? [],
    closure: request.closure,
    mode: request.mode,
    roots: {
      explicitFiles: [...selectedFiles.values()].map(({ provider, entry }) => ({ path: entry.name, provider: provider.pack.path })),
      explicitRows: explicitlySelectedRows,
      assetRoots: request.assetRoots,
      rowSelectors: request.rows,
      graphRoots: graph.roots,
    },
    includedFiles: includedFileManifest,
    includedRows: includedRowManifest,
    externalDependencies: external,
    dependenciesCopied: dependencies,
    unresolved,
    unsupported,
    diagnostics: graphDiagnostics,
    coverage: graph.coverage,
    selfContained,
    conflicts: [],
    outputPath: output.path,
  };
  const report = {
    outputPath: output.path,
    inputFiles: includedFileManifest.length,
    inputRows: includedRowManifest.reduce((sum, group) => sum + group.rows.length, 0),
    fileCount: writeEntries.length,
    closure: request.closure,
    mode: request.mode,
    complete: graph.complete,
    selfContained,
    manifest,
  };
  const manifestPath = await jsonOutput(context, request.manifestPath, [...environment.sourcePaths, output.path], manifest);
  const reportPath = await jsonOutput(context, request.reportPath, [...environment.sourcePaths, output.path], report);
  const page = <T>(items: readonly T[]) => ({
    total: items.length,
    offset: request.offset,
    limit: request.limit,
    items: items.slice(request.offset, request.offset + request.limit),
    nextOffset: request.offset + request.limit < items.length ? request.offset + request.limit : null,
    hasMore: request.offset + request.limit < items.length,
  });
  const manifestPreview = {
    ...manifest,
    roots: {
      ...manifest.roots,
      explicitFiles: page(manifest.roots.explicitFiles),
      explicitRows: page(manifest.roots.explicitRows),
      graphRoots: page(manifest.roots.graphRoots),
    },
    includedFiles: page(manifest.includedFiles),
    includedRows: page(manifest.includedRows),
    externalDependencies: page(manifest.externalDependencies),
    unresolved: page(manifest.unresolved),
    unsupported: page(manifest.unsupported),
    diagnostics: page(manifest.diagnostics),
  };
  return {
    data: { ...report, manifest: manifestPreview, ...(manifestPath ? { manifestPath } : {}), ...(reportPath ? { reportPath } : {}) },
    diagnostics: graphDiagnostics.slice(0, 1000),
  };
};
