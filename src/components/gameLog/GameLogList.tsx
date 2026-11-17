import { memo } from "react";
import type { IconType } from "react-icons";
import { LuHouse, LuMap, LuSwords } from "react-icons/lu";
import type { GameLogEnvironment, GameLogInfo } from "../../utility/logPaths";

export type GameLogListProps = {
  logs: GameLogInfo[];
  selectedPath: string | undefined;
  livePath: string | undefined;
  hideSmall: boolean;
  onHideSmallChange: (value: boolean) => void;
  followLatest: boolean;
  onFollowLatestChange: (value: boolean) => void;
  onSelect: (path: string) => void;
  onOpenFolder: () => void;
};

export const SMALL_LOG_BYTES = 5 * 1024;

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const environments: Record<GameLogEnvironment, { label: string; Icon: IconType }> = {
  frontend: { label: "Frontend", Icon: LuHouse },
  campaign: { label: "Campaign", Icon: LuMap },
  battle: { label: "Battle", Icon: LuSwords },
};

const EnvironmentTag = ({ environment }: { environment: GameLogEnvironment }) => {
  const { label, Icon } = environments[environment];
  return (
    <span className="inline-flex items-center gap-1 text-gray-300">
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
};

const formatWhen = (log: GameLogInfo) => new Date(log.parsedDate ?? log.mtimeMs).toLocaleString();

const GameLogList = memo((props: GameLogListProps) => {
  const visibleLogs = props.logs.filter(
    (log) => !props.hideSmall || log.size >= SMALL_LOG_BYTES || log.path === props.selectedPath,
  );

  return (
    <div className="flex flex-col h-full min-h-0 border-r border-gray-600 bg-gray-800 text-sm text-gray-200">
      <div className="flex flex-col gap-1 p-2 border-b border-gray-600">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.hideSmall}
            onChange={(event) => props.onHideSmallChange(event.target.checked)}
          />
          Hide logs &lt; 5 KB
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.followLatest}
            onChange={(event) => props.onFollowLatestChange(event.target.checked)}
          />
          Follow latest log
        </label>
        <button
          type="button"
          className="px-2 py-1 text-xs rounded-lg bg-gray-700 border border-gray-600 hover:bg-gray-600 text-left"
          onClick={props.onOpenFolder}
        >
          Open in Explorer
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {visibleLogs.length === 0 && <div className="p-2 text-gray-400">No game logs found.</div>}
        {visibleLogs.map((log) => {
          const isSelected = log.path === props.selectedPath;
          return (
            <button
              type="button"
              key={log.path}
              title={log.name}
              onClick={() => props.onSelect(log.path)}
              className={`block w-full text-left px-2 py-1 border-l-4 ${
                isSelected ? "bg-gray-700 border-blue-600 text-white" : "border-transparent hover:bg-gray-700"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{log.isScriptLog ? formatWhen(log) : log.name}</span>
                {log.path === props.livePath && (
                  <span className="text-xs px-1 rounded border border-green-500 text-green-400">LIVE</span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-400">
                {log.environment && (
                  <>
                    <EnvironmentTag environment={log.environment} />·
                  </>
                )}
                <span>{formatSize(log.size)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default GameLogList;
