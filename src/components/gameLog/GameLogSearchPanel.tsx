import { memo, useState } from "react";
import { compileQuery, isCompileError } from "../../gameLog/parse";
import type { GameLogSearchMatch } from "../../gameLogIpc";

export type GameLogSearchPanelProps = {
  onJump: (path: string, lineNumber: number) => void;
  onClose: () => void;
};

const fileLabel = (path: string) => path.split(/[\\/]/).pop() ?? path;

const GameLogSearchPanel = memo(({ onJump, onClose }: GameLogSearchPanelProps) => {
  const [query, setQuery] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string>();
  const [matches, setMatches] = useState<GameLogSearchMatch[]>();
  const [truncated, setTruncated] = useState(false);

  const compiled = compileQuery(query, { isRegex, caseSensitive });
  const isInvalid = isCompileError(compiled);

  const runSearch = async () => {
    if (!query || isInvalid || isSearching) return;
    setIsSearching(true);
    setError(undefined);
    const result = await window.api?.gameLogSearch({ query, isRegex, caseSensitive });
    setIsSearching(false);
    if (!result?.success) {
      setError(result?.error ?? "Search failed.");
      return;
    }
    setMatches(result.matches ?? []);
    setTruncated(result.truncated === true);
  };

  const groups: { file: string; items: GameLogSearchMatch[] }[] = [];
  for (const match of matches ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.file === match.file) last.items.push(match);
    else groups.push({ file: match.file, items: [match] });
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-96 border-l border-gray-600 bg-gray-800 text-sm text-gray-200">
      <div className="flex items-center justify-between p-2 border-b border-gray-600">
        <span className="font-medium">Search all logs</span>
        <button type="button" className="px-2 py-1 text-xs rounded-lg hover:bg-gray-700" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-col gap-1 p-2 border-b border-gray-600">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void runSearch()}
          placeholder="Search every log"
          aria-label="Search every log"
          className={`p-1.5 text-sm rounded-lg bg-gray-700 border text-white ${
            isInvalid ? "border-red-500" : "border-gray-600"
          }`}
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={isRegex} onChange={(event) => setIsRegex(event.target.checked)} />
            Regex
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(event) => setCaseSensitive(event.target.checked)}
            />
            Case
          </label>
          <button
            type="button"
            disabled={!query || isInvalid || isSearching}
            onClick={() => void runSearch()}
            className="ml-auto px-3 py-1 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
        </div>
        {isInvalid && <div className="text-xs text-red-400">Invalid regex: {compiled.error}</div>}
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {matches && matches.length === 0 && <div className="p-2 text-gray-400">No matches.</div>}
        {groups.map((group) => (
          <div key={group.file}>
            <div className="sticky top-0 px-2 py-1 bg-gray-700 text-xs font-medium truncate" title={group.file}>
              {fileLabel(group.file)} ({group.items.length})
            </div>
            {group.items.map((item) => (
              <button
                type="button"
                key={`${item.file}:${item.lineNumber}`}
                onClick={() => onJump(item.file, item.lineNumber)}
                className="flex w-full gap-2 px-2 py-0.5 text-left font-mono text-xs hover:bg-gray-700"
              >
                <span className="shrink-0 w-12 text-right text-gray-500">{item.lineNumber}</span>
                <span className="truncate whitespace-pre">{item.text}</span>
              </button>
            ))}
          </div>
        ))}
        {truncated && (
          <div className="p-2 text-xs text-yellow-400">
            Results truncated (max 200 per file, 2000 total). Refine the search.
          </div>
        )}
      </div>
    </div>
  );
});

export default GameLogSearchPanel;
