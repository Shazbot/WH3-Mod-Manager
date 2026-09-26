import type { Pack } from "../packFileTypes";
import { parseDBTablePath } from "../utility/packFileHelpers";
import { collectVanillaFilesMatching, type VanillaPackIndex } from "../vanillaPackIndex/format";
import type { VanillaLocCacheReader } from "../vanillaLocCache/read";
import type { VanillaSearchOptions, VanillaSearchResult } from "../vanillaDbCache/search";
import { isTextPackedFilePath } from "../utility/packFileViewing";
import { createSearchMatcher, type SearchMatcher } from "./matcher";
import { getSearchTargetKey, resolveSearchTargets, type GlobalSearchCatalog, type GlobalSearchTarget } from "./plan";
import { searchPackDb, searchPackLoc, type PackLocVisitor } from "./searchDb";
import { searchPackFiles, type PackedFileBufferVisitor } from "./searchFiles";
import type { SearchEngineContext } from "./engineTypes";
import { MAX_GLOBAL_SEARCH_QUERY_LENGTH } from "./types";
import type {
  GlobalSearchDbResult,
  GlobalSearchProgress,
  GlobalSearchRequest,
  GlobalSearchResponse,
  GlobalSearchResult,
  GlobalSearchResultKind,
  GlobalSearchResultBatch,
  GlobalSearchSkippedFile,
} from "./types";

// Keep this structural rather than importing the global declaration from index.d.ts. It makes this
// module usable in node tests and by a future worker without bringing the app's ambient types along.
export interface SearchPackReadingOptions {
  skipParsingTables?: boolean;
  readLocs?: boolean;
}

export interface GlobalSearchRunDeps {
  getVanillaPackIndex: () => Promise<VanillaPackIndex | undefined>;
  getVanillaPackPathsInLoadOrder: () => readonly string[];
  searchVanillaDb: (options: VanillaSearchOptions) => Promise<VanillaSearchResult | undefined>;
  getVanillaLocReader: () => Promise<VanillaLocCacheReader | undefined>;
  forEachPackedFileBuffer: PackedFileBufferVisitor;
  readPackRegistered: (packPath: string, options: SearchPackReadingOptions) => Promise<Pack>;
  forEachPackLocEntry: PackLocVisitor;
  isCanceled: () => boolean;
  report: (progress: GlobalSearchProgress) => void;
  emit: (batch: GlobalSearchResultBatch) => void;
  yieldToEventLoop?: () => Promise<void>;
}

const DEFAULT_MAX_RESULTS = 5000;
const DEFAULT_MAX_RESULTS_PER_TARGET = 1000;
const DEFAULT_MAX_RESULTS_PER_FILE = 20;
/**
 * Largest packed file the scanners will read whole.
 *
 * Defaulted here rather than in the panel so every caller gets the guard: `forEachPackedFileBuffer`
 * allocates the whole payload, and one oversized entry would otherwise be read into memory with
 * nothing to stop it. A file over the limit is reported through `skippedFiles` as "tooLarge".
 */
const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;

const emptyCounts = (): Record<GlobalSearchResultKind, number> => ({ db: 0, loc: 0, text: 0, rigidModel: 0 });

const packLabelFromPath = (packPath: string): string => packPath.split(/[\\/]/).pop() || packPath;

const makeBatchEmitter = (searchId: string, emit: (batch: GlobalSearchResultBatch) => void) => {
  let pending: GlobalSearchResult[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    emit({ searchId, results: batch });
  };

  return {
    push(result: GlobalSearchResult) {
      pending.push(result);
      if (pending.length >= 200) flush();
      else if (timer === undefined) timer = setTimeout(flush, 250);
    },
    flush,
  };
};

interface RunState {
  readonly request: GlobalSearchRequest;
  readonly matcher: SearchMatcher;
  readonly deps: GlobalSearchRunDeps;
  readonly emitter: ReturnType<typeof makeBatchEmitter>;
  readonly results: GlobalSearchResult[];
  readonly counts: Record<GlobalSearchResultKind, number>;
  readonly warnings: Set<string>;
  readonly skippedFiles: GlobalSearchSkippedFile[];
  readonly skippedKeys: Set<string>;
  readonly targetCounts: Map<string, number>;
  readonly fileCounts: Map<string, number>;
  readonly scannedFiles: Set<string>;
  maxResults: number;
  maxResultsPerTarget: number;
  maxResultsPerFile: number;
  truncated: boolean;
  globalLimitReached: boolean;
  filesScanned: number;
  targetsSearched: number;
  currentProgress: Omit<GlobalSearchProgress, "searchId">;
}

const makeEngineContext = (
  state: RunState,
  target: GlobalSearchTarget,
  targetId: string,
  label: string,
): SearchEngineContext => ({
  request: {
    ...state.request,
    maxFileBytes: state.request.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    kinds: {
      db: target.kinds.includes("db"),
      loc: target.kinds.includes("loc"),
      text: target.kinds.includes("text"),
      rigidModel: target.kinds.includes("rigidModel"),
    },
  },
  matcher: state.matcher,
  packLabel: label,
  maxResultsPerFile: state.maxResultsPerFile,
  isCanceled: state.deps.isCanceled,
  addResult(result) {
    if (state.results.length >= state.maxResults) {
      state.truncated = true;
      return "stopTarget";
    }
    const targetCount = state.targetCounts.get(targetId) ?? 0;
    if (targetCount >= state.maxResultsPerTarget) {
      state.truncated = true;
      return "stopTarget";
    }
    const filePath = result.kind === "db" ? result.packedFilePath : result.filePath;
    const fileKey = `${targetId}\0${result.packPath.toLowerCase()}\0${filePath.toLowerCase()}`;
    const fileCount = state.fileCounts.get(fileKey) ?? 0;
    if (fileCount >= state.maxResultsPerFile) {
      state.truncated = true;
      return "stopFile";
    }

    state.results.push(result);
    state.counts[result.kind]++;
    state.targetCounts.set(targetId, targetCount + 1);
    state.fileCounts.set(fileKey, fileCount + 1);
    state.currentProgress = { ...state.currentProgress, resultCount: state.results.length };
    state.emitter.push(result);
    state.deps.report({ searchId: state.request.searchId, ...state.currentProgress });
    if (state.results.length >= state.maxResults) {
      state.truncated = true;
      state.globalLimitReached = true;
      return "stopTarget";
    }
    if (targetCount + 1 >= state.maxResultsPerTarget) {
      state.truncated = true;
      return "stopTarget";
    }
    return "continue";
  },
  markFile(packPath, filePath) {
    const key = `${targetId}\0${packPath.toLowerCase()}\0${filePath.toLowerCase()}`;
    if (state.scannedFiles.has(key)) return;
    state.scannedFiles.add(key);
    state.filesScanned++;
    state.currentProgress = { ...state.currentProgress, filesScanned: state.filesScanned };
    state.deps.report({ searchId: state.request.searchId, ...state.currentProgress });
  },
  markTruncated() {
    state.truncated = true;
  },
  addWarning(warning) {
    if (warning) state.warnings.add(warning);
  },
  addSkipped(file) {
    const key = `${file.packPath.toLowerCase()}\0${file.filePath.toLowerCase()}\0${file.reason}`;
    if (state.skippedKeys.has(key)) return;
    state.skippedKeys.add(key);
    state.skippedFiles.push(file);
  },
  yieldToEventLoop: state.deps.yieldToEventLoop,
});

const sourceFromLabel = (
  sourceLabel: string | undefined,
  fallbackPackPath: string | undefined,
): { packPath: string; filePath: string; packLabel: string } | undefined => {
  if (sourceLabel) {
    const separator = sourceLabel.indexOf("\0");
    if (separator > 0) {
      const packPath = sourceLabel.slice(0, separator);
      return { packPath, filePath: sourceLabel.slice(separator + 1), packLabel: packLabelFromPath(packPath) };
    }
  }
  if (!fallbackPackPath) return undefined;
  const packPath = fallbackPackPath;
  return { packPath, filePath: sourceLabel ?? "", packLabel: packLabelFromPath(packPath) };
};

const searchVanillaDbTarget = async (
  state: RunState,
  context: SearchEngineContext,
): Promise<"canceled" | "complete" | "stopped"> => {
  const result = await state.deps.searchVanillaDb({
    query: state.request.query,
    mode: "contains",
    caseSensitive: state.request.caseSensitive,
    maxResults: state.maxResultsPerTarget,
    matchesPoolValue: state.matcher.test,
    shouldCancel: state.deps.isCanceled,
  });
  if (!result) {
    context.addWarning("Base game DB cache unavailable.");
    return "complete";
  }
  if (result.truncated) context.markTruncated();
  if (result.canceled || state.deps.isCanceled()) return "canceled";
  for (const match of result.matches) {
    if (state.deps.isCanceled()) return "canceled";
    const parsed = parseDBTablePath(match.packedFilePath);
    if (!parsed) continue;
    context.markFile(result.dbPackPath, match.packedFilePath);
    if (!state.matcher.test(match.value)) continue;
    const found = state.matcher.find(match.value);
    if (!found) continue;
    const outcome = context.addResult({
      kind: "db",
      packPath: result.dbPackPath,
      packLabel: packLabelFromPath(result.dbPackPath),
      packedFilePath: match.packedFilePath,
      dbName: parsed.dbName,
      dbSubname: parsed.dbSubname,
      dbFolder: parsed.dbFolder,
      columnName: match.columnName,
      rowIndex: match.rowIndex,
      value: match.value,
      matchStart: found.start,
      matchEnd: found.end,
    } satisfies GlobalSearchDbResult);
    if (outcome === "stopTarget") return "stopped";
  }
  context.addWarning("base game DB: text columns only");
  return "complete";
};

const searchVanillaLocTarget = async (
  state: RunState,
  contextForLabel: (label?: string) => SearchEngineContext,
): Promise<"canceled" | "complete" | "stopped"> => {
  const reader = await state.deps.getVanillaLocReader();
  if (!reader) {
    contextForLabel().addWarning("Base game localisation cache unavailable.");
    return "complete";
  }
  const fallbackPackPath = state.deps.getVanillaPackPathsInLoadOrder()[0];
  let stopped: "canceled" | "stopped" | undefined;
  const visit = (key: string, value: string, _rank: number, sourceLabel?: string) => {
    if (state.deps.isCanceled()) {
      stopped = "canceled";
      return false;
    }
    const source = sourceFromLabel(sourceLabel, fallbackPackPath);
    if (!source) {
      contextForLabel().addWarning("Base game loc result provenance unavailable.");
      return undefined;
    }
    const searchIn = state.request.locSearchIn ?? "both";
    const searchedValues: Array<["key" | "value", string]> = [];
    if (searchIn === "keys" || searchIn === "both") searchedValues.push(["key", key]);
    if (searchIn === "values" || searchIn === "both") searchedValues.push(["value", value]);
    let context: SearchEngineContext | undefined;
    for (const [matchedIn, searched] of searchedValues) {
      if (!state.matcher.test(searched)) continue;
      const found = state.matcher.find(searched);
      if (!found) continue;
      context ??= contextForLabel(source.packLabel);
      context.markFile(source.packPath, source.filePath);
      const outcome = context.addResult({
        kind: "loc",
        packPath: source.packPath,
        packLabel: source.packLabel,
        filePath: source.filePath,
        key,
        value,
        matchedIn,
        matchStart: found.start,
        matchEnd: found.end,
      });
      if (outcome === "stopTarget") {
        stopped = "stopped";
        return false;
      }
    }
    return undefined;
  };
  if (reader.forEachEntryAsync) {
    await reader.forEachEntryAsync(visit, {
      yieldEvery: 512,
      yieldToEventLoop: state.deps.yieldToEventLoop,
    });
  } else {
    reader.forEachEntry(visit);
  }
  contextForLabel().addWarning("base game loc: localisation packs only");
  return stopped ?? (state.deps.isCanceled() ? "canceled" : "complete");
};

const searchVanillaFilesTarget = async (
  state: RunState,
  target: GlobalSearchTarget,
  contextForPack: (packPath: string) => SearchEngineContext,
): Promise<"canceled" | "complete" | "stopped"> => {
  const index = await state.deps.getVanillaPackIndex();
  if (!index) {
    contextForPack("vanilla").addWarning("Base game pack file index unavailable.");
    return "complete";
  }
  const winningFiles = collectVanillaFilesMatching(index, (filePath) => {
    return (
      (target.kinds.includes("text") && isTextPackedFilePath(filePath)) ||
      (target.kinds.includes("rigidModel") && filePath.endsWith(".rigid_model_v2"))
    );
  });
  const pathsByPack = new Map<string, Set<string>>();
  for (const [filePath, packName] of winningFiles) {
    const key = packName.toLowerCase();
    let files = pathsByPack.get(key);
    if (!files) {
      files = new Set();
      pathsByPack.set(key, files);
    }
    files.add(filePath);
  }
  const packPaths = state.deps.getVanillaPackPathsInLoadOrder();
  for (const [packName, files] of pathsByPack) {
    if (state.deps.isCanceled()) return "canceled";
    const packPath = packPaths.find((candidate) => packLabelFromPath(candidate).toLowerCase() === packName);
    if (!packPath) continue;
    const context = contextForPack(packPath);
    const visitFiles: PackedFileBufferVisitor = async (path, wanted, visit, options) =>
      state.deps.forEachPackedFileBuffer(
        path,
        (name) => files.has(name.replace(/\//g, "\\").toLowerCase()) && wanted(name),
        visit,
        options,
      );
    try {
      const status = await searchPackFiles(packPath, context, visitFiles);
      if (status !== "complete") return status;
    } catch (error) {
      context.addWarning(
        `${context.packLabel}: could not read pack (${error instanceof Error ? error.message : String(error)}).`,
      );
      if (state.deps.isCanceled()) return "canceled";
    }
  }
  return state.deps.isCanceled() ? "canceled" : "complete";
};

const searchPackTarget = async (state: RunState, target: GlobalSearchTarget, context: SearchEngineContext) => {
  const packPath = target.path!;
  const needsDb = target.kinds.includes("db");
  const needsLoc = target.kinds.includes("loc");
  if (needsDb || needsLoc) {
    try {
      const pack = await state.deps.readPackRegistered(packPath, {
        skipParsingTables: !needsDb,
        readLocs: needsLoc,
      });
      if (needsDb) {
        const status = await searchPackDb(pack, context);
        if (status !== "complete") return status;
      }
      if (needsLoc) {
        const status = searchPackLoc(pack, context, state.deps.forEachPackLocEntry);
        if (status !== "complete") return status;
      }
    } catch (error) {
      context.addWarning(
        `${context.packLabel}: could not read pack (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  }
  if (target.kinds.includes("text") || target.kinds.includes("rigidModel")) {
    try {
      return await searchPackFiles(packPath, context, state.deps.forEachPackedFileBuffer);
    } catch (error) {
      context.addWarning(
        `${context.packLabel}: could not read pack (${error instanceof Error ? error.message : String(error)}).`,
      );
      return state.deps.isCanceled() ? "canceled" : "complete";
    }
  }
  return state.deps.isCanceled() ? "canceled" : "complete";
};

/** Runs one complete global-search request. It has no Electron dependency; IPC supplies all I/O. */
export const runGlobalSearch = async (
  request: GlobalSearchRequest,
  catalog: GlobalSearchCatalog,
  deps: GlobalSearchRunDeps,
): Promise<GlobalSearchResponse> => {
  const matcher = createSearchMatcher(request.query, {
    caseSensitive: request.caseSensitive,
    regex: request.regex,
  });
  const baseResponse = {
    success: true,
    searchId: request.searchId,
    canceled: false,
    truncated: false,
    results: [] as GlobalSearchResult[],
    counts: emptyCounts(),
    targetsSearched: 0,
    filesScanned: 0,
    skippedFiles: [] as GlobalSearchSkippedFile[],
    warnings: [] as string[],
    elapsedMs: 0,
  };
  if (matcher.isEmpty) return { ...baseResponse, success: false, error: "Search query is empty." };
  if (request.regex && !matcher.isValidRegex) {
    return { ...baseResponse, success: false, error: "Search query is not a valid regular expression." };
  }
  if (request.query.length > MAX_GLOBAL_SEARCH_QUERY_LENGTH) {
    return { ...baseResponse, success: false, error: "Search query is too long." };
  }

  const targets = resolveSearchTargets(request, catalog);
  const startTime = performance.now();
  const emitter = makeBatchEmitter(request.searchId, deps.emit);
  const state: RunState = {
    request,
    matcher,
    deps,
    emitter,
    results: baseResponse.results,
    counts: baseResponse.counts,
    warnings: new Set(),
    skippedFiles: baseResponse.skippedFiles,
    skippedKeys: new Set(),
    targetCounts: new Map(),
    fileCounts: new Map(),
    scannedFiles: new Set(),
    maxResults: request.maxResults ?? DEFAULT_MAX_RESULTS,
    maxResultsPerTarget: request.maxResultsPerTarget ?? DEFAULT_MAX_RESULTS_PER_TARGET,
    maxResultsPerFile: request.maxResultsPerFile ?? DEFAULT_MAX_RESULTS_PER_FILE,
    truncated: false,
    globalLimitReached: false,
    filesScanned: 0,
    targetsSearched: 0,
    currentProgress: {
      stage: "planning",
      targetsDone: 0,
      targetsTotal: targets.length,
      filesScanned: 0,
      resultCount: 0,
      elapsedMs: 0,
    },
  };
  const report = (stage: GlobalSearchProgress["stage"], targetIndex: number, currentLabel?: string) => {
    state.currentProgress = {
      ...state.currentProgress,
      stage,
      targetsDone: targetIndex,
      targetsTotal: targets.length,
      currentLabel,
      elapsedMs: performance.now() - startTime,
    };
    deps.report({ searchId: request.searchId, ...state.currentProgress });
  };

  report("planning", 0);
  let canceled = false;
  try {
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      const target = targets[targetIndex];
      if (deps.isCanceled()) {
        canceled = true;
        break;
      }
      const targetId = getSearchTargetKey(target);
      state.targetsSearched++;
      const contextForLabel = (label?: string) => makeEngineContext(state, target, targetId, label ?? target.label);
      if (target.kind === "pack" && target.hasUnsavedChanges) {
        contextForLabel().addWarning(
          `${target.label}: unsaved viewer changes are not included; search uses saved data.`,
        );
      }
      report(target.kind === "vanilla" ? "vanillaDb" : "pack", targetIndex, target.label);

      let status: "canceled" | "complete" | "stopped" = "complete";
      if (target.kind === "vanilla") {
        if (target.kinds.includes("db")) {
          report("vanillaDb", targetIndex, "Vanilla DB");
          status = await searchVanillaDbTarget(state, contextForLabel());
        }
        if (status === "complete" && target.kinds.includes("loc")) {
          report("vanillaLoc", targetIndex, "Vanilla localisation");
          status = await searchVanillaLocTarget(state, contextForLabel);
        }
        if (status === "complete" && (target.kinds.includes("text") || target.kinds.includes("rigidModel"))) {
          report("pack", targetIndex, "Vanilla files");
          status = await searchVanillaFilesTarget(state, target, (packPath) =>
            contextForLabel(packLabelFromPath(packPath)),
          );
        }
      } else {
        status = await searchPackTarget(state, target, contextForLabel());
      }
      if (status === "canceled" || deps.isCanceled()) {
        canceled = true;
        break;
      }
      if (state.globalLimitReached) break;
      report("pack", targetIndex + 1, target.label);
      await (deps.yieldToEventLoop?.() ?? Promise.resolve());
    }
  } catch (error) {
    emitter.flush();
    return {
      ...baseResponse,
      success: false,
      results: state.results,
      counts: state.counts,
      targetsSearched: state.targetsSearched,
      filesScanned: state.filesScanned,
      skippedFiles: state.skippedFiles,
      warnings: [...state.warnings],
      elapsedMs: performance.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    emitter.flush();
  }

  report("done", targets.length, canceled ? "Search stopped early" : undefined);
  return {
    ...baseResponse,
    canceled,
    truncated: state.truncated,
    results: state.results,
    counts: state.counts,
    targetsSearched: state.targetsSearched,
    filesScanned: state.filesScanned,
    skippedFiles: state.skippedFiles,
    warnings: [...state.warnings],
    elapsedMs: performance.now() - startTime,
  };
};

export const DEFAULT_GLOBAL_SEARCH_LIMITS = {
  maxResults: DEFAULT_MAX_RESULTS,
  maxResultsPerTarget: DEFAULT_MAX_RESULTS_PER_TARGET,
  maxResultsPerFile: DEFAULT_MAX_RESULTS_PER_FILE,
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
};
