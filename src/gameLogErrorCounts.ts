import * as fs from "fs";
import * as nodePath from "path";
import { app } from "electron";

import { countErrors, initialErrorCountState, type ErrorCountState } from "./gameLog/parse";
import { readJsonDiskCache, writeJsonDiskCache } from "./utility/jsonDiskCache";
import type { GameLogInfo } from "./utility/logPaths";

const CACHE_FILE_NAME = "game-log-error-counts.bin";
const CACHE_VERSION = 1;

type Entry = {
  /** Shown count, including a trailing partial line. */
  errors: number;
  /** Count state up to scannedBytes, which a resumed scan continues from. */
  resume: ErrorCountState;
  size: number;
  mtimeMs: number;
  /** Bytes counted so far: up to the last complete line, so a growing log resumes from here. */
  scannedBytes: number;
};
type CacheFile = { version: number; entries: Record<string, Entry> };

let entries: Map<string, Entry> | undefined;
let isDirty = false;
let running: Promise<void> | undefined;
let pending: { gamePath: string; logs: GameLogInfo[] } | undefined;

const cachePath = () => nodePath.join(app.getPath("userData"), CACHE_FILE_NAME);

const loadEntries = async () => {
  if (entries) return entries;
  const file = await readJsonDiskCache<CacheFile>(cachePath());
  entries = new Map(file?.version === CACHE_VERSION ? Object.entries(file.entries) : []);
  return entries;
};

const isCurrent = (entry: Entry | undefined, log: GameLogInfo): entry is Entry =>
  !!entry && entry.size === log.size && entry.mtimeMs === log.mtimeMs;

const readRange = async (path: string, start: number, end: number) => {
  const handle = await fs.promises.open(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const scanLog = async (log: GameLogInfo, previous: Entry | undefined): Promise<Entry> => {
  // Script logs are only ever appended to; lua_mod_log.txt is rewritten each launch, so it is always rescanned.
  const canResume = !!previous && log.isScriptLog && log.size >= previous.scannedBytes;
  const start = canResume ? previous.scannedBytes : 0;
  const buffer = await readRange(log.path, start, log.size);
  // Leave a partial last line for the next scan; a log that is not growing any more gets it counted in full.
  const lastNewline = buffer.lastIndexOf(0x0a);
  const end = lastNewline < 0 ? 0 : lastNewline + 1;
  const state = countErrors(
    buffer.toString("latin1", 0, end).split(/\r?\n/).slice(0, -1),
    canResume ? previous.resume : initialErrorCountState(),
  );
  const tail = buffer.toString("latin1", end).trim();
  const counted = tail ? countErrors([tail], state) : state;
  // The tail is counted for display but not resumed from: the next scan reads it again as a complete line.
  return { errors: counted.errors, resume: state, size: log.size, mtimeMs: log.mtimeMs, scannedBytes: start + end };
};

/** Counts already known for these logs at their current size and mtime. */
export const getCachedGameLogErrorCounts = async (logs: GameLogInfo[]): Promise<Record<string, number>> => {
  const cache = await loadEntries();
  const counts: Record<string, number> = {};
  for (const log of logs) {
    const entry = cache.get(log.path);
    if (isCurrent(entry, log)) counts[log.path] = entry.errors;
  }
  return counts;
};

const runScan = async (gamePath: string, logs: GameLogInfo[], onCounts: (counts: Record<string, number>) => void) => {
  const cache = await loadEntries();
  const resolvedGamePath = nodePath.resolve(gamePath);
  const present = new Set(logs.map((log) => log.path));
  for (const path of cache.keys()) {
    if (nodePath.dirname(nodePath.resolve(path)) === resolvedGamePath && !present.has(path)) {
      cache.delete(path);
      isDirty = true;
    }
  }

  for (const log of logs) {
    if (pending) break;
    const previous = cache.get(log.path);
    if (isCurrent(previous, log)) continue;
    try {
      const entry = await scanLog(log, previous);
      cache.set(log.path, entry);
      isDirty = true;
      onCounts({ [log.path]: entry.errors });
    } catch {
      // Locked or removed mid-scan: try again on the next listing.
    }
  }

  if (isDirty) {
    isDirty = false;
    await writeJsonDiskCache(cachePath(), {
      version: CACHE_VERSION,
      entries: Object.fromEntries(cache),
    } satisfies CacheFile);
  }
};

/**
 * Counts errors in every log whose size or mtime changed since it was last counted, in the background, and drops
 * cached logs that are gone from the game folder. A call while a scan runs restarts it with the newer listing.
 */
export const scanGameLogErrorCounts = (
  gamePath: string,
  logs: GameLogInfo[],
  onCounts: (counts: Record<string, number>) => void,
) => {
  pending = { gamePath, logs };
  if (running) return;
  const next = pending;
  pending = undefined;
  running = runScan(next.gamePath, next.logs, onCounts)
    .catch((error) => console.log("Game log error scan failed:", error))
    .finally(() => {
      running = undefined;
      if (pending) scanGameLogErrorCounts(pending.gamePath, pending.logs, onCounts);
    });
};
