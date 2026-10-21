import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The persistent store of optimized packs. It lives next to the staging folder, in
 * `<game folder>\whmm_optimized_mods` (a sibling of `whmm_copied_mods`, never inside it), so "Clean up
 * after game exit" and "Clear copied mods" do not touch it. Everything the optimizer keeps lives here
 * (results, failure markers, aliases, reports, host logs, the host's scan cache), so one "Clear optimized
 * mods cache" removes it all. An entry is the final pack (optimized and compressed by the host) plus a
 * small JSON file. Restoring one is a hard link into the staging folder (a copy when linking fails), so
 * the entry is read-only and nothing may ever write a staged file in place: a staged pack and its cache
 * entry are the same file.
 *
 * Layout under `root`:
 *   entries/<key>.pack, entries/<key>.json     a result
 *   entries/<key>.failed.json                  the host failed for this key (do not retry)
 *   aliases/<exactKey>.txt                     exact key -> narrow key
 *   reports/<pack name>.report.txt             the latest host report per mod
 *   tmp/                                       host output
 *   logs/                                      host logs of failed runs
 *   host-cache/                                the host's own cacheDirectory (probe scans)
 */

export const DEFAULT_OPTIMIZER_CACHE_BUDGET_BYTES = 12 * 1024 * 1024 * 1024;
export const DEFAULT_OPTIMIZER_MAX_ENTRIES_PER_SOURCE = 2;
const MAX_ALIASES = 400;

export interface OptimizerCacheEntryMeta {
  key: string;
  sourceName: string;
  sourcePath: string;
  profile: string;
  size: number;
  createdAt: number;
  lastUsed: number;
  hostVersion?: string;
  outputVersion?: number;
  relevantConsumers?: string[];
  summary?: OptimizerSummary;
}

/** What an optimization saved, as the host reports it. Sizes are bytes. */
export interface OptimizerSummary {
  sourceBytes: number;
  outputBytes: number;
  textureBytesSaved: number;
  drawCallsEliminated: number;
  mergedModelsGenerated: number;
}

export interface OptimizerCacheFailure {
  key: string;
  message: string;
  createdAt: number;
}

export interface OptimizerCacheOptions {
  root: string;
  budgetBytes?: number;
  maxEntriesPerSource?: number;
  now?: () => number;
}

const writeJsonAtomically = async (path: string, value: unknown) => {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(value));
    await fs.promises.rename(temporaryPath, path);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
};

const readJson = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await fs.promises.readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const safeKey = (key: string) => /^[0-9a-f]{16,64}$/.test(key);

export class WorkshopOptimizerCache {
  readonly root: string;
  private readonly budgetBytes: number;
  private readonly maxEntriesPerSource: number;
  private readonly now: () => number;
  /** Keys used by the launch in progress; never evicted. */
  private readonly pinned = new Set<string>();

  constructor(options: OptimizerCacheOptions) {
    this.root = options.root;
    this.budgetBytes = options.budgetBytes ?? DEFAULT_OPTIMIZER_CACHE_BUDGET_BYTES;
    this.maxEntriesPerSource = options.maxEntriesPerSource ?? DEFAULT_OPTIMIZER_MAX_ENTRIES_PER_SOURCE;
    this.now = options.now ?? Date.now;
  }

  get entriesDirectory() {
    return nodePath.join(this.root, "entries");
  }
  get aliasesDirectory() {
    return nodePath.join(this.root, "aliases");
  }
  get reportsDirectory() {
    return nodePath.join(this.root, "reports");
  }
  get tempDirectory() {
    return nodePath.join(this.root, "tmp");
  }
  get hostCacheDirectory() {
    return nodePath.join(this.root, "host-cache");
  }

  private packPath(key: string) {
    return nodePath.join(this.entriesDirectory, `${key}.pack`);
  }
  private metaPath(key: string) {
    return nodePath.join(this.entriesDirectory, `${key}.json`);
  }
  private failurePath(key: string) {
    return nodePath.join(this.entriesDirectory, `${key}.failed.json`);
  }

  async ensureDirectories() {
    await Promise.all(
      [
        this.entriesDirectory,
        this.aliasesDirectory,
        this.reportsDirectory,
        this.tempDirectory,
        this.hostCacheDirectory,
      ].map((directory) => fs.promises.mkdir(directory, { recursive: true })),
    );
  }

  /** Never evict the entries this launch uses. */
  pin(key: string) {
    this.pinned.add(key);
  }

  unpinAll() {
    this.pinned.clear();
  }

  async lookup(key: string): Promise<{ packPath: string; meta: OptimizerCacheEntryMeta } | undefined> {
    if (!safeKey(key)) return undefined;
    const meta = await readJson<OptimizerCacheEntryMeta>(this.metaPath(key));
    if (!meta || meta.key !== key) return undefined;
    try {
      const stats = await fs.promises.stat(this.packPath(key));
      if (!stats.isFile() || stats.size !== meta.size) throw new Error("size mismatch");
    } catch {
      await this.remove(key);
      return undefined;
    }
    meta.lastUsed = this.now();
    this.pin(key);
    await writeJsonAtomically(this.metaPath(key), meta).catch(() => undefined);
    // Removing a staged link clears the read-only flag it shares with the entry; put it back.
    await fs.promises.chmod(this.packPath(key), 0o444).catch(() => undefined);
    return { packPath: this.packPath(key), meta };
  }

  async lookupFailure(key: string): Promise<OptimizerCacheFailure | undefined> {
    if (!safeKey(key)) return undefined;
    return readJson<OptimizerCacheFailure>(this.failurePath(key));
  }

  async recordFailure(key: string, message: string) {
    await this.ensureDirectories();
    await writeJsonAtomically(this.failurePath(key), {
      key,
      message,
      createdAt: this.now(),
    } satisfies OptimizerCacheFailure);
  }

  newTempPath(packName: string): string {
    return nodePath.join(this.tempDirectory, `${randomUUID()}-${packName}`);
  }

  /** Moves a finished pack into the cache (atomic rename) and enforces the bounds. */
  async commit(
    key: string,
    temporaryPackPath: string,
    meta: Omit<OptimizerCacheEntryMeta, "key" | "size" | "createdAt" | "lastUsed">,
    reportSourcePath?: string,
  ): Promise<string> {
    await this.ensureDirectories();
    const stats = await fs.promises.stat(temporaryPackPath);
    const finalPath = this.packPath(key);
    await fs.promises.rm(finalPath, { force: true });
    await fs.promises.rename(temporaryPackPath, finalPath);
    // The entry is shared with staged hard links: make an accidental in-place write fail.
    await fs.promises.chmod(finalPath, 0o444).catch(() => undefined);
    const entry: OptimizerCacheEntryMeta = {
      ...meta,
      key,
      size: stats.size,
      createdAt: this.now(),
      lastUsed: this.now(),
    };
    await writeJsonAtomically(this.metaPath(key), entry);
    await fs.promises.rm(this.failurePath(key), { force: true }).catch(() => undefined);
    this.pin(key);
    if (reportSourcePath) await this.storeReport(meta.sourceName, reportSourcePath);
    await this.evict();
    return finalPath;
  }

  async storeReport(packName: string, reportPath: string) {
    try {
      await fs.promises.mkdir(this.reportsDirectory, { recursive: true });
      await fs.promises.copyFile(reportPath, this.reportPathFor(packName));
    } catch {
      // The report is a convenience; a missing one never fails the launch.
    }
  }

  reportPathFor(packName: string) {
    return nodePath.join(this.reportsDirectory, `${nodePath.basename(packName)}.report.txt`);
  }

  async listReportNames(): Promise<string[]> {
    try {
      return (await fs.promises.readdir(this.reportsDirectory))
        .filter((name) => name.endsWith(".report.txt"))
        .map((name) => name.slice(0, -".report.txt".length));
    } catch {
      return [];
    }
  }

  async resolveAlias(exactKey: string): Promise<string | undefined> {
    if (!safeKey(exactKey)) return undefined;
    try {
      const narrow = (
        await fs.promises.readFile(nodePath.join(this.aliasesDirectory, `${exactKey}.txt`), "utf8")
      ).trim();
      return safeKey(narrow) ? narrow : undefined;
    } catch {
      return undefined;
    }
  }

  async writeAlias(exactKey: string, narrowKey: string) {
    if (!safeKey(exactKey) || !safeKey(narrowKey)) return;
    await fs.promises.mkdir(this.aliasesDirectory, { recursive: true });
    await fs.promises.writeFile(nodePath.join(this.aliasesDirectory, `${exactKey}.txt`), narrowKey);
  }

  private async remove(key: string) {
    await Promise.all(
      [this.packPath(key), this.metaPath(key), this.failurePath(key)].map((path) =>
        fs.promises.rm(path, { force: true }).catch(() => undefined),
      ),
    );
  }

  async listEntries(): Promise<OptimizerCacheEntryMeta[]> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.entriesDirectory);
    } catch {
      return [];
    }
    const entries: OptimizerCacheEntryMeta[] = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.endsWith(".failed.json")) continue;
      const meta = await readJson<OptimizerCacheEntryMeta>(nodePath.join(this.entriesDirectory, name));
      if (meta && safeKey(meta.key)) entries.push(meta);
    }
    return entries;
  }

  /** At most N entries per (source, profile), then least-recently-used first until under budget. */
  async evict(): Promise<string[]> {
    const removed: string[] = [];
    const entries = (await this.listEntries()).sort((first, second) => second.lastUsed - first.lastUsed);

    const perSource = new Map<string, number>();
    const survivors: OptimizerCacheEntryMeta[] = [];
    for (const entry of entries) {
      const sourceKey = `${entry.sourcePath.toLowerCase()}|${entry.profile}`;
      const count = perSource.get(sourceKey) ?? 0;
      if (count >= this.maxEntriesPerSource && !this.pinned.has(entry.key)) {
        await this.remove(entry.key);
        removed.push(entry.key);
        continue;
      }
      perSource.set(sourceKey, count + 1);
      survivors.push(entry);
    }

    let total = survivors.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of [...survivors].reverse()) {
      if (total <= this.budgetBytes) break;
      if (this.pinned.has(entry.key)) continue;
      await this.remove(entry.key);
      removed.push(entry.key);
      total -= entry.size;
    }

    if (removed.length > 0) await this.pruneAliases(new Set(removed));
    return removed;
  }

  private async pruneAliases(removedKeys: Set<string>) {
    try {
      const names = await fs.promises.readdir(this.aliasesDirectory);
      const stats: { name: string; mtimeMs: number }[] = [];
      for (const name of names) {
        const path = nodePath.join(this.aliasesDirectory, name);
        let target = "";
        try {
          target = (await fs.promises.readFile(path, "utf8")).trim();
        } catch {
          continue;
        }
        if (removedKeys.has(target)) await fs.promises.rm(path, { force: true });
        else stats.push({ name, mtimeMs: (await fs.promises.stat(path)).mtimeMs });
      }
      for (const { name } of stats.sort((first, second) => second.mtimeMs - first.mtimeMs).slice(MAX_ALIASES)) {
        await fs.promises.rm(nodePath.join(this.aliasesDirectory, name), { force: true });
      }
    } catch {
      // Aliases are only a shortcut.
    }
  }

  /**
   * Removes host output left by a crashed run. Only files untouched for a while go: a background job
   * may be writing here while a launch starts.
   */
  async cleanTemp(olderThanMs = 15 * 60 * 1000) {
    await fs.promises.mkdir(this.tempDirectory, { recursive: true }).catch(() => undefined);
    let names: string[] = [];
    try {
      names = await fs.promises.readdir(this.tempDirectory);
    } catch {
      return;
    }

    const cutoff = this.now() - olderThanMs;
    for (const name of names) {
      const path = nodePath.join(this.tempDirectory, name);
      try {
        const stats = await fs.promises.stat(path);
        if (stats.mtimeMs < cutoff) await fs.promises.rm(path, { recursive: true, force: true });
      } catch {
        // Gone already.
      }
    }
  }

  async getInfo(): Promise<{ size: number; entryCount: number; hasContents: boolean }> {
    const entries = await this.listEntries();
    const size = entries.reduce((total, entry) => total + entry.size, 0);
    return {
      size,
      entryCount: entries.length,
      hasContents: entries.length > 0 || (await this.listReportNames()).length > 0,
    };
  }

  /** Removes every result, alias, report and temp file (the host's own cache directory too). */
  async clear() {
    await fs.promises.rm(this.root, { recursive: true, force: true });
    this.pinned.clear();
  }
}

/**
 * The cache used to live in the app's user data folder. It is not migrated (the results are not
 * reusable there); the folder is removed once. Returns whether it existed.
 */
export const removeLegacyUserDataCache = async (userDataPath: string): Promise<boolean> => {
  const legacy = nodePath.join(userDataPath, "workshop-optimizer");
  try {
    await fs.promises.access(legacy);
  } catch {
    return false;
  }

  await fs.promises.rm(legacy, { recursive: true, force: true });
  return true;
};
