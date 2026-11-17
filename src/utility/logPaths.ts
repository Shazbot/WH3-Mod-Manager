import * as fs from "fs";
import * as nodePath from "path";

const SCRIPT_LOG_PREFIX = "script_log_";

export const findLatestScriptLog = async (gamePath: string): Promise<string | undefined> => {
  const entries = await fs.promises.readdir(gamePath, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && entry.name.startsWith(SCRIPT_LOG_PREFIX));

  const candidatesWithModifiedTimes = await Promise.all(
    candidates.map(async (entry) => {
      const filePath = nodePath.join(gamePath, entry.name);
      const stats = await fs.promises.stat(filePath);
      return { filePath, modifiedTime: stats.mtimeMs };
    }),
  );

  candidatesWithModifiedTimes.sort(
    (first, second) => second.modifiedTime - first.modifiedTime || second.filePath.localeCompare(first.filePath),
  );
  return candidatesWithModifiedTimes[0]?.filePath;
};

const LUA_MOD_LOG_NAME = "lua_mod_log.txt";
const SCRIPT_LOG_NAME_PATTERN = /^script_log_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})\.txt$/i;

export type GameLogInfo = {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  /** Local time parsed from a script_log_DDMMYY_HHMM filename, as epoch ms. */
  parsedDate?: number;
  isScriptLog: boolean;
  /** Script environment the log was written in, from its lib_header line; undefined until the game writes it. */
  environment?: GameLogEnvironment;
};

export type GameLogEnvironment = "frontend" | "campaign" | "battle";

const ENVIRONMENT_HEAD_BYTES = 8 * 1024;
const ENVIRONMENT_PATTERN = /script libraries reloaded in (frontend|campaign|battle) configuration/;

/** Pure: the environment named in the start of a script log, if any. */
export const parseGameLogEnvironment = (head: string): GameLogEnvironment | undefined =>
  ENVIRONMENT_PATTERN.exec(head)?.[1] as GameLogEnvironment | undefined;

// path -> environment. Only settled results are kept: a found marker, or a head already full without one.
const environmentCache = new Map<string, GameLogEnvironment | undefined>();

const readGameLogEnvironment = async (filePath: string, size: number) => {
  if (environmentCache.has(filePath)) return environmentCache.get(filePath);
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(size, ENVIRONMENT_HEAD_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const environment = parseGameLogEnvironment(buffer.toString("latin1", 0, bytesRead));
    if (environment || bytesRead >= ENVIRONMENT_HEAD_BYTES) environmentCache.set(filePath, environment);
    return environment;
  } finally {
    await handle.close();
  }
};

/** script_log_DDMMYY_HHMM.txt -> local epoch ms, or undefined when the name does not match or is not a real date. */
export const parseScriptLogTimestamp = (fileName: string): number | undefined => {
  const match = SCRIPT_LOG_NAME_PATTERN.exec(fileName);
  if (!match) return undefined;
  const [day, month, year, hour, minute] = match.slice(1).map(Number);
  const date = new Date(2000 + year, month - 1, day, hour, minute);
  if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getHours() !== hour) return undefined;
  return date.getTime();
};

/** Only the game's own log names may be opened or tailed. */
export const isGameLogFileName = (fileName: string) =>
  fileName === LUA_MOD_LOG_NAME || (fileName.startsWith(SCRIPT_LOG_PREFIX) && fileName.endsWith(".txt"));

/** All script_log_* files plus lua_mod_log.txt in the game folder, newest first. */
export const listGameLogs = async (gamePath: string): Promise<GameLogInfo[]> => {
  const entries = await fs.promises.readdir(gamePath, { withFileTypes: true });
  const logs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isGameLogFileName(entry.name))
      .map(async (entry): Promise<GameLogInfo | undefined> => {
        const filePath = nodePath.join(gamePath, entry.name);
        try {
          const stats = await fs.promises.stat(filePath);
          const isScriptLog = entry.name !== LUA_MOD_LOG_NAME;
          return {
            name: entry.name,
            path: filePath,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            parsedDate: parseScriptLogTimestamp(entry.name),
            isScriptLog,
            environment: isScriptLog
              ? await readGameLogEnvironment(filePath, stats.size).catch(() => undefined)
              : undefined,
          };
        } catch {
          return undefined;
        }
      }),
  );
  return logs
    .filter((log): log is GameLogInfo => log !== undefined)
    .sort((a, b) => (b.parsedDate ?? b.mtimeMs) - (a.parsedDate ?? a.mtimeMs) || b.name.localeCompare(a.name));
};
