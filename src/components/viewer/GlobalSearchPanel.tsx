import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AutoSizer, List, ListRowProps } from "react-virtualized";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight, faXmark } from "@fortawesome/free-solid-svg-icons";
import { IoSearch } from "react-icons/io5";

import localizationContext from "../../localizationContext";
import { getPackNameFromPath } from "@/src/utility/packFileHelpers";
import { createSearchMatcher } from "@/src/globalSearch/matcher";
import {
  DEFAULT_GLOBAL_SEARCH_KINDS,
  GLOBAL_SEARCH_RESULT_KINDS,
  MAX_GLOBAL_SEARCH_QUERY_LENGTH,
  getGlobalSearchResultFilePath,
  type GlobalSearchDbResult,
  type GlobalSearchKinds,
  type GlobalSearchLocResult,
  type GlobalSearchProgress,
  type GlobalSearchRequest,
  type GlobalSearchResult,
  type GlobalSearchResultKind,
  type GlobalSearchSkippedFile,
  type GlobalSearchSource,
} from "@/src/globalSearch/types";

export type GlobalSearchOpenPack = { packPath: string; label: string };

export type GlobalSearchPanelProps = {
  /**
   * Whether the dock is showing it. The panel stays mounted while hidden so its query and results
   * survive a close, so it cannot infer this from being rendered.
   */
  isOpen: boolean;
  /** The packs with a tab in the viewer right now, for the per-pack source checkboxes. */
  openPacks: GlobalSearchOpenPack[];
  onOpenDbResult: (result: GlobalSearchDbResult | GlobalSearchLocResult) => void;
  onOpenFileResult: (result: Exclude<GlobalSearchResult, GlobalSearchDbResult | GlobalSearchLocResult>) => void;
  onClose: () => void;
};

type ViewerPackCatalogEntry = {
  path: string;
  name: string;
  humanName?: string;
  isEnabled: boolean;
  isInData: boolean;
};

/** One rendered line. The tree is flattened so it can go through a windowed list. */
type PanelRow =
  | { type: "pack"; key: string; packPath: string; packLabel: string; count: number }
  | {
      type: "file";
      key: string;
      packPath: string;
      filePath: string;
      /** What to show for the file: a DB table names its table, not its `data__` file. */
      label: string;
      sublabel?: string;
      kind: GlobalSearchResultKind;
      count: number;
    }
  | { type: "result"; key: string; result: GlobalSearchResult };

const PACK_ROW_HEIGHT = 32;
const FILE_ROW_HEIGHT = 34;
const RESULT_ROW_HEIGHT = 28;

const packPathKey = (value: string) => value.replaceAll("/", "\\").toLowerCase();

/** Splits a value around a match so the matched run can be marked. */
const renderHighlighted = (value: string, start: number, end: number) => {
  if (start < 0 || end <= start || start > value.length) return <>{value}</>;
  const safeEnd = Math.min(end, value.length);
  return (
    <>
      {value.slice(0, start)}
      <mark className="rounded-sm bg-amber-400/40 px-0.5 font-semibold text-amber-100">
        {value.slice(start, safeEnd)}
      </mark>
      {value.slice(safeEnd)}
    </>
  );
};

const shortFileName = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath;

/**
 * How a file group names itself.
 *
 * Every DB table in a pack is a file called `data__` (or a modder's own name for it), so the
 * basename alone identifies nothing - the table is what the reader is looking for. The file name
 * still matters when a pack carries several under one table, so it stays as a secondary label.
 */
const describeFileGroup = (result: GlobalSearchResult, filePath: string): { label: string; sublabel?: string } =>
  result.kind === "db"
    ? { label: result.dbName, sublabel: result.dbSubname }
    : { label: shortFileName(filePath), sublabel: undefined };

const GlobalSearchPanel = memo(
  ({ isOpen, openPacks, onOpenDbResult, onOpenFileResult, onClose }: GlobalSearchPanelProps) => {
    const localized: Record<string, string> = useContext(localizationContext);
    const kindLabels = useMemo<Record<GlobalSearchResultKind, string>>(
      () => ({
        db: localized.globalSearchDbTables || "DB tables",
        loc: localized.globalSearchLocTables || "Loc tables",
        text: localized.globalSearchTextFiles || "Text files",
        rigidModel: localized.globalSearchRigidModels || "Rigid models",
      }),
      [localized],
    );

    const [query, setQuery] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [isRegex, setIsRegex] = useState(false);
    const [kinds, setKinds] = useState<GlobalSearchKinds>(DEFAULT_GLOBAL_SEARCH_KINDS);

    const [searchVanilla, setSearchVanilla] = useState(true);
    const [selectedOpenPackPaths, setSelectedOpenPackPaths] = useState<string[]>([]);
    const [includeEnabledMods, setIncludeEnabledMods] = useState(false);
    const [includeAllMods, setIncludeAllMods] = useState(false);

    const [packCatalog, setPackCatalog] = useState<ViewerPackCatalogEntry[]>([]);
    const [results, setResults] = useState<GlobalSearchResult[]>([]);
    const [progress, setProgress] = useState<GlobalSearchProgress | undefined>(undefined);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [skippedFiles, setSkippedFiles] = useState<GlobalSearchSkippedFile[]>([]);
    const [isTruncated, setIsTruncated] = useState(false);
    const [wasCanceled, setWasCanceled] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [collapsedKeys, setCollapsedKeys] = useState<string[]>([]);

    /** The run whose messages are still wanted. A late batch from a cancelled run is dropped. */
    const activeSearchIdRef = useRef<string | null>(null);
    const searchCounterRef = useRef(0);
    const queryInputRef = useRef<HTMLInputElement>(null);

    const isRegexValid = useMemo(
      () => createSearchMatcher(query, { caseSensitive, regex: isRegex }).isValidRegex,
      [caseSensitive, isRegex, query],
    );

    // Every open, not only the first: the panel is hidden rather than unmounted, so reopening it has
    // to put the caret back in the box the way a fresh mount would.
    useEffect(() => {
      if (isOpen) queryInputRef.current?.focus();
    }, [isOpen]);

    // Counts on the two mod-scope checkboxes come from the catalog the copy-into picker already uses.
    // The viewer window holds no mod list in Redux, so this is the only way to know how many there are.
    useEffect(() => {
      let isCancelled = false;
      void (async () => {
        try {
          const result = await window.api?.getViewerPackCatalog();
          if (isCancelled || !result?.success) return;
          setPackCatalog(result.packs || []);
        } catch (catalogError) {
          console.error("Global search: could not load the pack catalog:", catalogError);
        }
      })();
      return () => {
        isCancelled = true;
      };
    }, []);

    useEffect(() => {
      const unsubscribe = window.api?.onGlobalSearchResults((_event, batch) => {
        if (batch.searchId !== activeSearchIdRef.current) return;
        setResults((previous) => previous.concat(batch.results));
      });
      return () => unsubscribe?.();
    }, []);

    useEffect(() => {
      const unsubscribe = window.api?.onGlobalSearchProgress((_event, nextProgress) => {
        if (nextProgress.searchId !== activeSearchIdRef.current) return;
        setProgress(nextProgress);
      });
      return () => unsubscribe?.();
    }, []);

    const enabledModCount = useMemo(() => packCatalog.filter((pack) => pack.isEnabled).length, [packCatalog]);

    const selectedOpenPackKeys = useMemo(() => selectedOpenPackPaths.map(packPathKey), [selectedOpenPackPaths]);

    const sources = useMemo<GlobalSearchSource[]>(() => {
      const next: GlobalSearchSource[] = [];
      for (const packPath of selectedOpenPackPaths) next.push({ kind: "pack", path: packPath });
      // "All mods" is a superset, so sending both would only make main deduplicate them again.
      if (includeAllMods) next.push({ kind: "allMods" });
      else if (includeEnabledMods) next.push({ kind: "enabledMods" });
      if (searchVanilla) next.push({ kind: "vanilla" });
      return next;
    }, [includeAllMods, includeEnabledMods, searchVanilla, selectedOpenPackPaths]);

    const selectedKindCount = GLOBAL_SEARCH_RESULT_KINDS.filter((kind) => kinds[kind]).length;
    const canSearch =
      !isSearching &&
      query.trim() !== "" &&
      query.length <= MAX_GLOBAL_SEARCH_QUERY_LENGTH &&
      isRegexValid &&
      selectedKindCount > 0 &&
      sources.length > 0;

    const toggleKind = useCallback((kind: GlobalSearchResultKind) => {
      setKinds((previous) => ({ ...previous, [kind]: !previous[kind] }));
    }, []);

    const toggleOpenPack = useCallback((packPath: string) => {
      setSelectedOpenPackPaths((previous) =>
        previous.some((selected) => packPathKey(selected) === packPathKey(packPath))
          ? previous.filter((selected) => packPathKey(selected) !== packPathKey(packPath))
          : [...previous, packPath],
      );
    }, []);

    const handleSearch = useCallback(async () => {
      if (!canSearch) return;

      const searchId = `viewer-global-search-${++searchCounterRef.current}-${Date.now()}`;
      activeSearchIdRef.current = searchId;

      setIsSearching(true);
      setHasSearched(true);
      setResults([]);
      setProgress(undefined);
      setError(undefined);
      setWarnings([]);
      setSkippedFiles([]);
      setIsTruncated(false);
      setWasCanceled(false);
      setCollapsedKeys([]);

      const request: GlobalSearchRequest = {
        searchId,
        query,
        caseSensitive,
        regex: isRegex,
        kinds,
        sources,
      };

      try {
        const response = await window.api?.runGlobalSearch(request);
        if (activeSearchIdRef.current !== searchId) return;

        if (!response) {
          setError(localized.globalSearchBackendNoResponse || "The search backend did not respond.");
          return;
        }
        if (!response.success) {
          setError(response.error || localized.globalSearchFailed || "The search failed.");
          return;
        }

        // The response carries the full result set, streamed batches included, so replacing rather
        // than appending is what keeps a batch that arrived twice from showing twice.
        setResults(response.results);
        setWarnings(response.warnings || []);
        setSkippedFiles(response.skippedFiles || []);
        setIsTruncated(response.truncated);
        setWasCanceled(response.canceled);
      } catch (searchError) {
        if (activeSearchIdRef.current !== searchId) return;
        const message = searchError instanceof Error ? searchError.message : String(searchError);
        // Until the main-process handler exists, `invoke` rejects with "No handler registered".
        setError(
          message.includes("No handler registered")
            ? localized.globalSearchUnavailableBuild ||
                "Global search is not available in this build: the main-process handler is not registered yet."
            : message,
        );
      } finally {
        if (activeSearchIdRef.current === searchId) {
          setIsSearching(false);
          activeSearchIdRef.current = null;
        }
      }
    }, [canSearch, caseSensitive, isRegex, kinds, localized, query, sources]);

    const handleStop = useCallback(() => {
      window.api?.cancelGlobalSearch();
      setWasCanceled(true);
    }, []);

    const toggleCollapsed = useCallback((key: string) => {
      setCollapsedKeys((previous) =>
        previous.includes(key) ? previous.filter((collapsed) => collapsed !== key) : [...previous, key],
      );
    }, []);

    /**
     * Grouped pack -> file -> result, flattened to the rows the windowed list draws.
     *
     * Insertion order is kept rather than sorted: main emits targets in the order it searched them,
     * which is the order the user picked, and re-sorting would shuffle the tree as batches stream in.
     */
    const rows = useMemo<PanelRow[]>(() => {
      const byPack = new Map<
        string,
        { packPath: string; packLabel: string; files: Map<string, GlobalSearchResult[]> }
      >();

      for (const result of results) {
        const packKey = packPathKey(result.packPath);
        let packGroup = byPack.get(packKey);
        if (!packGroup) {
          packGroup = {
            packPath: result.packPath,
            packLabel: result.packLabel || getPackNameFromPath(result.packPath) || result.packPath,
            files: new Map(),
          };
          byPack.set(packKey, packGroup);
        }
        const filePath = getGlobalSearchResultFilePath(result);
        const fileGroup = packGroup.files.get(filePath);
        if (fileGroup) fileGroup.push(result);
        else packGroup.files.set(filePath, [result]);
      }

      const collapsed = new Set(collapsedKeys);
      const nextRows: PanelRow[] = [];

      for (const [packKey, packGroup] of byPack) {
        let packCount = 0;
        for (const fileResults of packGroup.files.values()) packCount += fileResults.length;

        nextRows.push({
          type: "pack",
          key: packKey,
          packPath: packGroup.packPath,
          packLabel: packGroup.packLabel,
          count: packCount,
        });
        if (collapsed.has(packKey)) continue;

        for (const [filePath, fileResults] of packGroup.files) {
          const fileKey = `${packKey}|${filePath.toLowerCase()}`;
          nextRows.push({
            type: "file",
            key: fileKey,
            packPath: packGroup.packPath,
            filePath,
            ...describeFileGroup(fileResults[0], filePath),
            kind: fileResults[0].kind,
            count: fileResults.length,
          });
          if (collapsed.has(fileKey)) continue;

          for (let index = 0; index < fileResults.length; index++) {
            nextRows.push({ type: "result", key: `${fileKey}|${index}`, result: fileResults[index] });
          }
        }
      }

      return nextRows;
    }, [collapsedKeys, results]);

    const openResult = useCallback(
      (result: GlobalSearchResult) => {
        if (result.kind === "db" || result.kind === "loc") {
          onOpenDbResult(result);
          return;
        }
        // Rigid models have no compatible content pane. Keep their results useful as search hits,
        // but do not send them into PackFileView where they can only produce an error.
        if (result.kind === "rigidModel") return;
        onOpenFileResult(result);
      },
      [onOpenDbResult, onOpenFileResult],
    );

    const getRowHeight = useCallback(
      ({ index }: { index: number }) => {
        const row = rows[index];
        if (row.type === "pack") return PACK_ROW_HEIGHT;
        if (row.type === "file") return FILE_ROW_HEIGHT;
        return RESULT_ROW_HEIGHT;
      },
      [rows],
    );

    const renderRow = useCallback(
      ({ index, key, style }: ListRowProps) => {
        const row = rows[index];

        if (row.type === "pack") {
          const isCollapsed = collapsedKeys.includes(row.key);
          return (
            <div key={key} style={style} className="flex items-center">
              <button
                type="button"
                onClick={() => toggleCollapsed(row.key)}
                title={row.packPath}
                className="flex w-full items-center gap-2 px-2 text-left text-sm font-semibold text-gray-100 hover:bg-gray-700/60"
              >
                <FontAwesomeIcon icon={isCollapsed ? faChevronRight : faChevronDown} className="w-2.5 shrink-0" />
                <span className="truncate">{row.packLabel}</span>
                <span className="ml-auto shrink-0 tabular-nums text-gray-400">{row.count}</span>
              </button>
            </div>
          );
        }

        if (row.type === "file") {
          const isCollapsed = collapsedKeys.includes(row.key);
          return (
            <div key={key} style={style} className="flex items-center">
              <button
                type="button"
                onClick={() => toggleCollapsed(row.key)}
                title={row.filePath}
                className="flex w-full items-center gap-2 pl-5 pr-2 text-left text-sm text-gray-200 hover:bg-gray-700/60"
              >
                <FontAwesomeIcon icon={isCollapsed ? faChevronRight : faChevronDown} className="w-2.5 shrink-0" />
                {/* The table, or the file name - the label the reader navigates by, so it is the
                    largest thing in the tree. Its own file name and the kind sit right of the gap,
                    quiet enough not to compete with it. */}
                <span className="truncate text-base font-medium text-gray-50">{row.label}</span>
                {row.sublabel && <span className="shrink-0 truncate text-xs text-gray-400">{row.sublabel}</span>}
                <span className="ml-auto shrink-0 text-[11px] uppercase tracking-wide text-gray-500">
                  {kindLabels[row.kind]}
                </span>
                <span className="shrink-0 tabular-nums text-gray-400">{row.count}</span>
              </button>
            </div>
          );
        }

        const { result } = row;
        const isOpenable = result.kind === "db" || result.kind === "loc" || result.kind === "text";
        const unsupportedTitle =
          localized.globalSearchRigidModelTitle || "Rigid models have no viewer; use the path to locate the file.";
        return (
          <div key={key} style={style} className="flex items-center">
            <button
              type="button"
              onClick={() => openResult(result)}
              disabled={!isOpenable}
              title={isOpenable ? undefined : unsupportedTitle}
              className={
                "flex w-full items-center gap-3 pl-9 pr-2 text-left text-sm " +
                // The colours live on the spans below, so a row that cannot be opened is dimmed as a
                // whole rather than by restating them.
                (isOpenable ? "hover:bg-gray-700/60" : "cursor-default opacity-60")
              }
            >
              {result.kind === "db" && (
                <>
                  <span className="shrink-0 whitespace-nowrap text-gray-400">
                    {result.columnName} · {localized.globalSearchRow || "row"} {result.rowIndex}
                  </span>
                  <span className="truncate font-mono text-gray-50">
                    {renderHighlighted(result.value, result.matchStart, result.matchEnd)}
                  </span>
                </>
              )}
              {result.kind === "loc" && (
                <>
                  <span className="shrink-0 whitespace-nowrap text-gray-400">
                    {result.matchedIn === "key"
                      ? localized.globalSearchKey || "key"
                      : localized.globalSearchValue || "value"}
                  </span>
                  <span className="truncate font-mono text-gray-50">
                    {result.matchedIn === "key"
                      ? renderHighlighted(result.key, result.matchStart, result.matchEnd)
                      : renderHighlighted(result.value, result.matchStart, result.matchEnd)}
                  </span>
                </>
              )}
              {result.kind === "text" && (
                <>
                  <span className="shrink-0 tabular-nums text-gray-400">:{result.line}</span>
                  <span className="truncate font-mono text-gray-50">
                    {renderHighlighted(result.excerpt, result.matchStartInExcerpt, result.matchEndInExcerpt)}
                  </span>
                </>
              )}
              {result.kind === "rigidModel" && (
                <>
                  <span className="shrink-0 tabular-nums text-gray-400">
                    @{result.offset} · {result.encoding}
                  </span>
                  <span className="truncate font-mono text-gray-50">
                    {renderHighlighted(result.excerpt, result.matchStartInExcerpt, result.matchEndInExcerpt)}
                  </span>
                </>
              )}
            </button>
          </div>
        );
      },
      [collapsedKeys, kindLabels, localized, openResult, rows, toggleCollapsed],
    );

    const checkboxClass = "flex shrink-0 items-center gap-1.5 text-sm text-gray-200";

    const resultsBody =
      rows.length === 0 ? (
        <div className="p-3 text-sm text-gray-400">
          {!hasSearched
            ? localized.globalSearchIdle || "Pick what to search and where, then press Search."
            : isSearching
              ? localized.globalSearchRunning || "Searching…"
              : error
                ? ""
                : localized.globalSearchNoMatches || "No matches."}
        </div>
      ) : (
        <AutoSizer>
          {({ height, width }) => (
            <List
              width={width}
              height={height}
              rowCount={rows.length}
              rowHeight={getRowHeight}
              rowRenderer={renderRow}
              overscanRowCount={12}
            />
          )}
        </AutoSizer>
      );

    return (
      // A result line is a path and a short excerpt, so it never needs the window's full width. The
      // controls take the space it does not, which keeps them off the top and leaves the dock's height
      // to results - the panel is short, and rows are what the user is here to read.
      <div className="flex h-full border-t border-gray-600 bg-gray-800" data-testid="global-search-panel">
        <div className="min-h-0 min-w-0 flex-1" data-testid="global-search-results">
          {resultsBody}
        </div>

        <div
          className="flex w-1/3 min-w-[17rem] max-w-[32rem] shrink-0 flex-col gap-2 overflow-y-auto border-l border-gray-700 p-2 scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700"
          data-testid="global-search-controls"
        >
          <label
            className={
              "flex items-center gap-2 rounded border bg-gray-900 px-2 " +
              (isRegexValid ? "border-gray-700" : "border-amber-600")
            }
          >
            <IoSearch className="shrink-0 text-gray-400" />
            <input
              ref={queryInputRef}
              aria-label={localized.globalSearchQueryLabel || "Global search"}
              value={query}
              maxLength={MAX_GLOBAL_SEARCH_QUERY_LENGTH}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSearch();
              }}
              placeholder={localized.globalSearchPlaceholder || "Search packs…"}
              className="w-full min-w-0 bg-transparent py-2 text-base text-white outline-none"
            />
          </label>

          {!isRegexValid && (
            <div className="text-xs text-amber-400">
              {localized.globalSearchInvalidRegex || "Not a valid regular expression yet."}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className={checkboxClass}>
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(event) => setCaseSensitive(event.target.checked)}
              />
              {localized.globalSearchCaseSensitive || "Case sensitive"}
            </label>
            <label className={checkboxClass}>
              <input type="checkbox" checked={isRegex} onChange={(event) => setIsRegex(event.target.checked)} />
              {localized.globalSearchRegex || "Regex"}
            </label>

            {isSearching ? (
              <button
                type="button"
                onClick={handleStop}
                className="ml-auto shrink-0 rounded bg-red-700 px-4 py-2 text-sm font-medium uppercase text-white hover:bg-red-600"
              >
                {localized.globalSearchStop || "Stop"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSearch()}
                disabled={!canSearch}
                className="ml-auto shrink-0 rounded bg-purple-600 px-4 py-2 text-sm font-medium uppercase text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
              >
                {localized.search || "Search"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={localized.globalSearchClose || "Close global search"}
              className="shrink-0 px-1 text-gray-400 hover:text-white"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-700 pt-2">
            <span className="w-full text-xs font-medium uppercase tracking-wide text-gray-400">
              {localized.globalSearchIn || "Search in"}
            </span>
            {GLOBAL_SEARCH_RESULT_KINDS.map((kind) => (
              <label key={kind} className={checkboxClass}>
                <input type="checkbox" checked={kinds[kind]} onChange={() => toggleKind(kind)} />
                {kindLabels[kind]}
                {kind === "rigidModel" && (
                  <span className="text-gray-400">{localized.globalSearchSlow || "(slow)"}</span>
                )}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-700 pt-2">
            <span className="w-full text-xs font-medium uppercase tracking-wide text-gray-400">
              {localized.globalSearchSources || "Sources"}
            </span>
            <label className={checkboxClass}>
              <input
                type="checkbox"
                checked={searchVanilla}
                onChange={(event) => setSearchVanilla(event.target.checked)}
              />
              {localized.globalSearchVanillaPacks || "Vanilla packs"}
            </label>
            <label className={checkboxClass}>
              <input
                type="checkbox"
                checked={includeEnabledMods || includeAllMods}
                disabled={includeAllMods}
                title={
                  includeAllMods
                    ? localized.globalSearchAlreadyCoveredByAllMods || "Already covered by All mods"
                    : undefined
                }
                onChange={(event) => setIncludeEnabledMods(event.target.checked)}
              />
              {localized.globalSearchEnabledMods || "Enabled mods"}
              {packCatalog.length > 0 && <span className="text-gray-400">({enabledModCount})</span>}
            </label>
            <label className={checkboxClass}>
              <input
                type="checkbox"
                checked={includeAllMods}
                onChange={(event) => setIncludeAllMods(event.target.checked)}
              />
              {localized.globalSearchAllMods || "All mods"}
              {packCatalog.length > 0 && <span className="text-gray-400">({packCatalog.length})</span>}
            </label>
          </div>

          {openPacks.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-700 pt-2">
              <span className="w-full text-xs font-medium uppercase tracking-wide text-gray-400">
                {localized.globalSearchOpenPacks || "Open packs"}
              </span>
              {openPacks.map((pack) => (
                <label key={pack.packPath} className={checkboxClass} title={pack.packPath}>
                  <input
                    type="checkbox"
                    checked={selectedOpenPackKeys.includes(packPathKey(pack.packPath))}
                    onChange={() => toggleOpenPack(pack.packPath)}
                  />
                  <span className="max-w-[12rem] truncate">{pack.label}</span>
                </label>
              ))}
            </div>
          )}

          {(isSearching || progress) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-700 pt-2 text-sm text-gray-300">
              {isSearching && (
                <div
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400"
                />
              )}
              {progress && (
                <>
                  <span className="tabular-nums">
                    {progress.targetsDone}/{progress.targetsTotal} {localized.globalSearchPacks || "packs"}
                  </span>
                  {progress.filesScanned > 0 && (
                    <span className="tabular-nums">
                      {progress.filesScanned} {localized.globalSearchFiles || "files"}
                    </span>
                  )}
                </>
              )}
              <span className="ml-auto shrink-0 tabular-nums">
                {results.length} {localized.globalSearchMatches || "matches"}
              </span>
              {progress?.currentLabel && <span className="w-full truncate">{progress.currentLabel}</span>}
            </div>
          )}

          {error && <div className="border-t border-gray-700 pt-2 text-sm text-red-300">{error}</div>}

          {(isTruncated || wasCanceled || skippedFiles.length > 0) && (
            <div className="border-t border-gray-700 pt-2 text-xs text-gray-300">
              {isTruncated && (
                <span className="mr-3">
                  {(localized.globalSearchShowingFirst || "Showing the first {{count}} matches.").replace(
                    "{{count}}",
                    String(results.length),
                  )}
                </span>
              )}
              {wasCanceled && (
                <span className="mr-3">{localized.globalSearchStoppedEarly || "Search stopped early."}</span>
              )}
              {skippedFiles.length > 0 && (
                <span>
                  {(localized.globalSearchSkippedFiles || "{{count}} file(s) skipped.").replace(
                    "{{count}}",
                    String(skippedFiles.length),
                  )}
                </span>
              )}
            </div>
          )}

          {warnings.map((warning) => (
            <div key={warning} className="border-t border-gray-700 pt-2 text-xs text-amber-400">
              {warning}
            </div>
          ))}
        </div>
      </div>
    );
  },
);

export default GlobalSearchPanel;
