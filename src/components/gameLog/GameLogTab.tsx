import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { toggleIsScriptLoggingEnabled } from "../../appSlice";
import {
  OTHER_TAG,
  compileQuery,
  countTags,
  filterLines,
  isCompileError,
  errorStartLines,
  ALL_TAGS,
  type TagFilter,
  type PrefixMode,
} from "../../gameLog/parse";
import type { GameLogInfo } from "../../utility/logPaths";
import GameLogList from "./GameLogList";
import GameLogTagBar from "./GameLogTagBar";
import GameLogViewer from "./GameLogViewer";
import GameLogSearchPanel from "./GameLogSearchPanel";

export type GameLogTabProps = { isActive?: boolean };

const LIVE_WINDOW_MS = 60_000;
const FLASH_MS = 1800;

type PatternState = { text: string; isRegex: boolean; caseSensitive: boolean };
const emptyPattern: PatternState = { text: "", isRegex: false, caseSensitive: false };

type PatternInputProps = { label: string; value: PatternState; onChange: (value: PatternState) => void };

const PatternInput = ({ label, value, onChange }: PatternInputProps) => {
  const compiled = compileQuery(value.text, value);
  const isInvalid = isCompileError(compiled);
  const toggleClass = (isOn: boolean) =>
    `px-1.5 py-0.5 text-xs rounded border ${
      isOn ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-700 border-gray-600 text-gray-300"
    }`;
  return (
    <div className="flex items-center gap-1">
      <input
        value={value.text}
        onChange={(event) => onChange({ ...value, text: event.target.value })}
        placeholder={label}
        aria-label={label}
        title={isInvalid ? `Invalid regex: ${compiled.error}` : label}
        className={`w-40 p-1 text-sm rounded-lg bg-gray-700 text-white border ${
          isInvalid ? "border-red-500" : "border-gray-600"
        }`}
      />
      <button
        type="button"
        className={toggleClass(value.isRegex)}
        title="Regular expression"
        aria-pressed={value.isRegex}
        onClick={() => onChange({ ...value, isRegex: !value.isRegex })}
      >
        .*
      </button>
      <button
        type="button"
        className={toggleClass(value.caseSensitive)}
        title="Match case"
        aria-pressed={value.caseSensitive}
        onClick={() => onChange({ ...value, caseSensitive: !value.caseSensitive })}
      >
        Aa
      </button>
    </div>
  );
};

const GameLogTab = memo(({ isActive = true }: GameLogTabProps) => {
  const dispatch = useAppDispatch();
  const isScriptLoggingEnabled = useAppSelector((state) => state.app.isScriptLoggingEnabled);

  const [logs, setLogs] = useState<GameLogInfo[]>([]);
  const [errorCounts, setErrorCounts] = useState<Record<string, number>>({});
  const [listError, setListError] = useState<string>();
  const [livePath, setLivePath] = useState<string>();
  const [hideSmall, setHideSmall] = useState(true);
  const [followLatest, setFollowLatest] = useState(true);
  const [manualPath, setManualPath] = useState<string>();

  const [loaded, setLoaded] = useState<{ path: string; lines: string[] }>();
  const [isPinned, setIsPinned] = useState(true);

  const [include, setInclude] = useState<PatternState>(emptyPattern);
  const [exclude, setExclude] = useState<PatternState>(emptyPattern);
  const [context, setContext] = useState(0);
  const [prefixMode, setPrefixMode] = useState<PrefixMode>("full");
  const [tagFilter, setTagFilter] = useState<TagFilter>(ALL_TAGS);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollRequest, setScrollRequest] = useState<{ position: number; nonce: number }>();
  const [pendingJump, setPendingJump] = useState<{ path: string; lineNumber: number }>();
  const [pendingFirstError, setPendingFirstError] = useState<string>();
  const [flashIndex, setFlashIndex] = useState<number>();
  const [errorCursor, setErrorCursor] = useState(-1);

  const newestScriptLog = logs.find((log) => log.isScriptLog);
  const selectedPath = followLatest ? (newestScriptLog?.path ?? manualPath) : manualPath;
  // Keep showing the previous log until the newly selected one loads, so switching doesn't blank the panel.
  const lines = useMemo(() => (loaded && selectedPath ? loaded.lines : []), [loaded, selectedPath]);

  const refreshList = useCallback(async () => {
    const result = await window.api?.gameLogList();
    if (!result?.success) {
      setListError(result?.error ?? "Could not read the game logs.");
      return;
    }
    const nextLogs = result.logs ?? [];
    setListError(undefined);
    setLogs(nextLogs);
    // Keep the last known count of a log that is being recounted, so a growing live log doesn't flicker.
    setErrorCounts((previous) => {
      const next: Record<string, number> = {};
      for (const log of nextLogs) {
        const count = result.errorCounts?.[log.path] ?? previous[log.path];
        if (count !== undefined) next[log.path] = count;
      }
      return next;
    });
    const newest = nextLogs.find((log) => log.isScriptLog);
    setLivePath(newest && Date.now() - newest.mtimeMs < LIVE_WINDOW_MS ? newest.path : undefined);
  }, []);

  // The list and its watcher only run while the tab is visible; the tab itself stays mounted.
  useEffect(() => {
    if (!isActive) return;
    void refreshList();
    const removeListChanged = window.api?.onGameLogListChanged(() => void refreshList());
    const removeErrorCounts = window.api?.onGameLogErrorCounts((counts) =>
      setErrorCounts((previous) => ({ ...previous, ...counts })),
    );
    return () => {
      removeListChanged?.();
      removeErrorCounts?.();
      void window.api?.gameLogClose();
    };
  }, [isActive, refreshList]);

  useEffect(() => {
    if (!isActive || !selectedPath) return;
    let isCancelled = false;
    const removeAppend = window.api?.onGameLogAppend((payload) => {
      if (isCancelled || payload.path !== selectedPath) return;
      setLoaded((previous) =>
        previous && previous.path === payload.path && !payload.isReset
          ? { path: payload.path, lines: previous.lines.concat(payload.lines) }
          : { path: payload.path, lines: payload.lines },
      );
    });
    void window.api?.gameLogOpen(selectedPath).then((result) => {
      if (isCancelled || !result?.success) return;
      setLoaded({ path: selectedPath, lines: result.lines ?? [] });
      setIsPinned(true);
    });
    return () => {
      isCancelled = true;
      removeAppend?.();
    };
  }, [isActive, selectedPath]);

  // An invalid regex leaves that filter off.
  const activeInclude = useMemo(() => {
    const compiled = compileQuery(include.text, include);
    return compiled instanceof RegExp ? compiled : undefined;
  }, [include]);
  const activeExclude = useMemo(() => {
    const compiled = compileQuery(exclude.text, exclude);
    return compiled instanceof RegExp ? compiled : undefined;
  }, [exclude]);

  const rows = useMemo(
    () => filterLines(lines, { include: activeInclude, exclude: activeExclude, tagFilter, context }),
    [lines, activeInclude, activeExclude, tagFilter, context],
  );
  const tagCounts = useMemo(() => countTags(lines), [lines]);
  const sortedTags = useMemo(
    () =>
      [...tagCounts.entries()].sort(([a], [b]) => (a === OTHER_TAG ? 1 : b === OTHER_TAG ? -1 : a.localeCompare(b))),
    [tagCounts],
  );
  // One stop per error: a SCRIPT ERROR and its stack traceback are one error, as in the log list's count.
  const errorStarts = useMemo(() => new Set(errorStartLines(lines)), [lines]);
  const errorPositions = useMemo(() => {
    const positions: number[] = [];
    rows.forEach((row, position) => {
      if (row.kind === "line" && errorStarts.has(row.index)) positions.push(position);
    });
    return positions;
  }, [rows, errorStarts]);

  // Jump from a search result once that log has loaded.
  useEffect(() => {
    if (!pendingJump || loaded?.path !== pendingJump.path || selectedPath !== pendingJump.path) return;
    const lineIndex = pendingJump.lineNumber - 1;
    const position = rows.findIndex((row) => row.kind === "line" && row.index === lineIndex);
    setPendingJump(undefined);
    if (position < 0) return;
    setIsPinned(false);
    setScrollRequest({ position, nonce: Date.now() });
    setFlashIndex(lineIndex);
  }, [pendingJump, loaded, selectedPath, rows]);

  // Jump to the first error of a log picked by its error count, once that log has loaded.
  useEffect(() => {
    if (!pendingFirstError || loaded?.path !== pendingFirstError || selectedPath !== pendingFirstError) return;
    setPendingFirstError(undefined);
    if (errorPositions.length === 0) return;
    setErrorCursor(0);
    setIsPinned(false);
    setScrollRequest({ position: errorPositions[0], nonce: Date.now() });
  }, [pendingFirstError, loaded, selectedPath, errorPositions]);

  useEffect(() => {
    if (flashIndex === undefined) return;
    const timer = setTimeout(() => setFlashIndex(undefined), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashIndex]);

  const selectLog = useCallback((path: string) => {
    setFollowLatest(false);
    setManualPath(path);
  }, []);

  const onJump = useCallback(
    (path: string, lineNumber: number) => {
      if (path !== selectedPath) selectLog(path);
      setPendingJump({ path, lineNumber });
    },
    [selectedPath, selectLog],
  );

  const goToError = (direction: 1 | -1) => {
    if (errorPositions.length === 0) return;
    const next = (errorCursor + direction + errorPositions.length) % errorPositions.length;
    setErrorCursor(next);
    setIsPinned(false);
    setScrollRequest({ position: errorPositions[next], nonce: Date.now() });
  };

  // The list's error count: the next error in the open log, or the first error of another log.
  const onErrorCountClick = (path: string) => {
    if (path === selectedPath && loaded?.path === path) {
      goToError(1);
      return;
    }
    selectLog(path);
    setPendingFirstError(path);
  };

  const openFolder = () => {
    const path = logs[0]?.path;
    if (path) window.api?.openFolderInExplorer(path);
  };

  const buttonClass =
    "px-2 py-1 text-xs rounded-lg bg-gray-700 border border-gray-600 hover:bg-gray-600 text-white disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col text-white">
      {!isScriptLoggingEnabled && (
        <div className="flex items-center gap-3 px-3 py-1 text-sm bg-yellow-900/60 border-b border-yellow-700">
          <span>Script logging is off — new logs won&apos;t be written.</span>
          <button type="button" className={buttonClass} onClick={() => dispatch(toggleIsScriptLoggingEnabled())}>
            Enable
          </button>
        </div>
      )}
      {listError && <div className="px-3 py-1 text-sm text-red-300 bg-red-900/40">{listError}</div>}
      <div className="flex flex-1 min-h-0">
        <div className="w-64 shrink-0 min-h-0">
          <GameLogList
            logs={logs}
            errorCounts={errorCounts}
            selectedPath={selectedPath}
            livePath={livePath}
            hideSmall={hideSmall}
            onHideSmallChange={setHideSmall}
            followLatest={followLatest}
            onFollowLatestChange={setFollowLatest}
            onSelect={selectLog}
            onErrorCountClick={onErrorCountClick}
            onOpenFolder={openFolder}
          />
        </div>
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 bg-gray-800 border-b border-gray-600">
            <PatternInput label="Include" value={include} onChange={setInclude} />
            <PatternInput label="Exclude" value={exclude} onChange={setExclude} />
            <label className="flex items-center gap-1 text-xs text-gray-300">
              Context ±
              <input
                type="number"
                min={0}
                max={50}
                value={context}
                onChange={(event) => setContext(Math.max(0, Math.min(50, Number(event.target.value) || 0)))}
                className="w-14 p-1 text-sm rounded-lg bg-gray-700 border border-gray-600 text-white"
              />
            </label>
            <select
              value={prefixMode}
              onChange={(event) => setPrefixMode(event.target.value as PrefixMode)}
              aria-label="Prefix mode"
              className="p-1 text-sm rounded-lg bg-gray-700 border border-gray-600 text-white"
            >
              <option value="full">Full prefix</option>
              <option value="hideTimestamp">Hide timestamp</option>
              <option value="hideTagAndTimestamp">Hide tag + timestamp</option>
            </select>
            <span className="flex items-center gap-1 text-xs text-gray-300">
              {errorPositions.length} {errorPositions.length === 1 ? "error" : "errors"}
              <button
                type="button"
                className={buttonClass}
                disabled={errorPositions.length === 0}
                onClick={() => goToError(-1)}
              >
                Prev error
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={errorPositions.length === 0}
                onClick={() => goToError(1)}
              >
                Next error
              </button>
            </span>
            <button type="button" className={buttonClass} onClick={() => setIsSearchOpen((open) => !open)}>
              Search all logs
            </button>
          </div>
          {sortedTags.length > 0 && (
            <GameLogTagBar tags={sortedTags} filter={tagFilter} onFilterChange={setTagFilter} />
          )}
          <GameLogViewer
            logPath={loaded?.path}
            lines={lines}
            rows={rows}
            prefixMode={prefixMode}
            isPinned={isPinned}
            onPinnedChange={setIsPinned}
            scrollRequest={scrollRequest}
            flashIndex={flashIndex}
          />
        </div>
        {isSearchOpen && <GameLogSearchPanel onJump={onJump} onClose={() => setIsSearchOpen(false)} />}
      </div>
    </div>
  );
});

export default GameLogTab;
