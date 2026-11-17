import * as fs from "fs";
import * as nodePath from "path";
import * as readline from "readline";
import { BrowserWindow, ipcMain } from "electron";
import chokidar from "chokidar";

import appData from "./appData";
import { GameLogTail } from "./gameLogTail";
import { isGameLogFileName, listGameLogs, type GameLogInfo } from "./utility/logPaths";

export type GameLogSearchMatch = { file: string; lineNumber: number; text: string };
export type GameLogSearchResult = {
  success: boolean;
  error?: string;
  matches?: GameLogSearchMatch[];
  truncated?: boolean;
};
export type GameLogOpenResult = { success: boolean; error?: string; lines?: string[] };
export type GameLogListResult = { success: boolean; error?: string; logs?: GameLogInfo[] };

const MAX_MATCHES_PER_FILE = 200;
const MAX_MATCHES_TOTAL = 2000;
const LIST_CHANGED_DEBOUNCE_MS = 300;

const getGamePath = () => appData.gamesToGameFolderPaths[appData.currentGame]?.gamePath || undefined;

/** The renderer only gets to name a log; it must be one of the game's own logs directly in the game folder. */
const resolveLogPath = (value: unknown): string | undefined => {
  const gamePath = getGamePath();
  if (!gamePath || typeof value !== "string") return undefined;
  const resolved = nodePath.resolve(value);
  if (nodePath.dirname(resolved) !== nodePath.resolve(gamePath)) return undefined;
  return isGameLogFileName(nodePath.basename(resolved)) ? resolved : undefined;
};

let tail: GameLogTail | undefined;
let listWatcher: chokidar.FSWatcher | undefined;
let listWatcherPath: string | undefined;
let listChangedTimer: NodeJS.Timeout | undefined;

const stopTail = () => {
  tail?.close();
  tail = undefined;
};

const stopListWatcher = () => {
  clearTimeout(listChangedTimer);
  listChangedTimer = undefined;
  void listWatcher?.close();
  listWatcher = undefined;
  listWatcherPath = undefined;
};

const searchLogs = async (
  gamePath: string,
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
): Promise<GameLogSearchResult> => {
  if (!query) return { success: true, matches: [], truncated: false };
  let regex: RegExp;
  try {
    regex = new RegExp(isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "" : "i");
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Invalid regular expression" };
  }

  const matches: GameLogSearchMatch[] = [];
  let truncated = false;
  for (const log of await listGameLogs(gamePath)) {
    if (matches.length >= MAX_MATCHES_TOTAL) {
      truncated = true;
      break;
    }
    let lineNumber = 0;
    let fileMatches = 0;
    const input = fs.createReadStream(log.path);
    input.on("error", () => undefined);
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const rawLine of lines) {
        lineNumber++;
        // readline decodes as UTF-8; a latin1 log only shows replacement characters, which is fine for matching.
        if (!regex.test(rawLine)) continue;
        if (fileMatches >= MAX_MATCHES_PER_FILE || matches.length >= MAX_MATCHES_TOTAL) {
          truncated = true;
          break;
        }
        fileMatches++;
        matches.push({ file: log.path, lineNumber, text: rawLine.length > 500 ? rawLine.slice(0, 500) : rawLine });
      }
    } catch {
      // Unreadable log (locked or removed mid-search): skip it.
    } finally {
      lines.close();
      input.destroy();
    }
  }
  return { success: true, matches, truncated };
};

export const registerGameLogIpc = (mainWindow: BrowserWindow) => {
  const sendListChanged = () => {
    clearTimeout(listChangedTimer);
    listChangedTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send("gameLogListChanged");
    }, LIST_CHANGED_DEBOUNCE_MS);
  };

  const ensureListWatcher = (gamePath: string) => {
    if (listWatcher && listWatcherPath === gamePath) return;
    stopListWatcher();
    listWatcherPath = gamePath;
    // The game holds the live log open, so native fs events are unreliable: poll.
    listWatcher = chokidar
      .watch(gamePath, {
        depth: 0,
        usePolling: true,
        interval: 1000,
        ignoreInitial: true,
        ignored: (path: string, stats?: fs.Stats) => {
          if (path === gamePath) return false;
          return stats ? stats.isFile() && !isGameLogFileName(nodePath.basename(path)) : false;
        },
      })
      // Without an error listener chokidar's error event throws.
      .on("error", (error) => console.log("Game log watcher error:", error))
      .on("add", (path) => isGameLogFileName(nodePath.basename(path)) && sendListChanged())
      .on("unlink", (path) => isGameLogFileName(nodePath.basename(path)) && sendListChanged())
      .on("change", (path) => isGameLogFileName(nodePath.basename(path)) && sendListChanged());
  };

  ipcMain.removeHandler("gameLogList");
  ipcMain.handle("gameLogList", async (): Promise<GameLogListResult> => {
    const gamePath = getGamePath();
    if (!gamePath) return { success: false, error: "The game folder is not configured." };
    try {
      const logs = await listGameLogs(gamePath);
      ensureListWatcher(gamePath);
      return { success: true, logs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.removeHandler("gameLogOpen");
  ipcMain.handle("gameLogOpen", async (event, path: unknown): Promise<GameLogOpenResult> => {
    const logPath = resolveLogPath(path);
    if (!logPath) return { success: false, error: "Not a game log file." };
    stopTail();
    const sender = event.sender;
    const send = (lines: string[], isReset: boolean) => {
      if (!sender.isDestroyed()) sender.send("gameLogAppend", { path: logPath, lines, isReset });
    };
    const newTail = new GameLogTail(logPath, {
      onAppend: (lines) => send(lines, false),
      onReset: (lines) => send(lines, true),
    });
    try {
      const lines = await newTail.open();
      // A newer open may have replaced this one while the file was being read.
      tail = newTail;
      return { success: true, lines };
    } catch (error) {
      newTail.close();
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.removeHandler("gameLogClose");
  ipcMain.handle("gameLogClose", async (): Promise<{ success: boolean }> => {
    stopTail();
    stopListWatcher();
    return { success: true };
  });

  ipcMain.removeHandler("gameLogSearch");
  ipcMain.handle(
    "gameLogSearch",
    async (
      _event,
      request: { query?: unknown; isRegex?: unknown; caseSensitive?: unknown },
    ): Promise<GameLogSearchResult> => {
      const gamePath = getGamePath();
      if (!gamePath) return { success: false, error: "The game folder is not configured." };
      if (!request || typeof request.query !== "string") return { success: false, error: "Invalid search." };
      try {
        return await searchLogs(gamePath, request.query, request.isRegex === true, request.caseSensitive === true);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  mainWindow.once("closed", () => {
    stopTail();
    stopListWatcher();
  });
};

