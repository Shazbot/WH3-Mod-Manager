import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OPTIMIZER_CACHE_EXPIRY_MS,
  WorkshopOptimizerCache,
  formatHousekeepingLine,
} from "../src/workshopModOptimizer/cache";
import { scheduleStartupHousekeeping } from "../src/workshopModOptimizer/housekeepingSchedule";

const DAY = 24 * 60 * 60 * 1000;
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
const tempDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-housekeeping-"));
  directories.push(directory);
  return directory;
};
const key = (n: number) => n.toString(16).padStart(32, "0");

describe("optimizer cache housekeeping", () => {
  let offset = 0;
  let cache: WorkshopOptimizerCache;
  let sources: string;
  const now = () => Date.now() + offset;

  beforeEach(() => {
    offset = 0;
    sources = tempDirectory();
    cache = new WorkshopOptimizerCache({ root: tempDirectory(), now });
  });

  /** Adds an entry for a source pack that exists on disk unless `missing`. */
  const add = async (id: number, name: string, options: { missing?: boolean; bytes?: number } = {}) => {
    await cache.ensureDirectories();
    const sourcePath = path.join(sources, name);
    if (!options.missing) fs.writeFileSync(sourcePath, "source");
    const temporary = cache.newTempPath(`${id}.pack`);
    fs.writeFileSync(temporary, Buffer.alloc(options.bytes ?? 10, id));
    await cache.commit(key(id), temporary, { sourceName: name, sourcePath, profile: "p" });
    fs.writeFileSync(cache.reportPathFor(name), "report");
    cache.unpinAll();
    return sourcePath;
  };
  const keys = async () => (await cache.listEntries()).map((entry) => entry.key).sort();
  const age = (days: number) => {
    offset = days * DAY;
  };

  it("removes entries whose source pack no longer exists, with its report", async () => {
    await add(1, "alive.pack");
    const gone = await add(2, "gone.pack");
    fs.rmSync(gone);

    const result = await cache.housekeep();

    expect(await keys()).toEqual([key(1)]);
    expect(result.removed["missing source"]).toEqual({ count: 1, bytes: 10 });
    expect(fs.existsSync(cache.reportPathFor("gone.pack"))).toBe(true); // too young to be an orphan yet
    age(1);
    await cache.housekeep();
    expect(fs.existsSync(cache.reportPathFor("gone.pack"))).toBe(false);
    expect(fs.existsSync(cache.reportPathFor("alive.pack"))).toBe(true);
  });

  it("expires entries not used for 30 days, measured by a fake clock", async () => {
    await add(1, "a.pack");
    age(29);
    expect((await cache.housekeep()).removed.expired.count).toBe(0);
    expect(await keys()).toEqual([key(1)]);

    age(OPTIMIZER_CACHE_EXPIRY_MS / DAY + 1);
    const result = await cache.housekeep();
    expect(result.removed.expired).toEqual({ count: 1, bytes: 10 });
    expect(await keys()).toEqual([]);
  });

  it("a use renews the 30 days", async () => {
    await add(1, "a.pack");
    age(25);
    await cache.lookup(key(1));
    age(50);
    expect((await cache.housekeep()).removed.expired.count).toBe(0);
  });

  it("never removes a pinned entry, even with a missing source or after expiry", async () => {
    const source = await add(1, "pinned.pack");
    await add(2, "other.pack");
    fs.rmSync(source);
    age(40);
    cache.pin(key(1));

    await cache.housekeep();

    expect(await keys()).toEqual([key(1)]);
  });

  it("removes reports, host logs, failure markers and aliases that belong to nothing", async () => {
    await add(1, "alive.pack");
    fs.mkdirSync(path.join(cache.root, "logs"), { recursive: true });
    fs.writeFileSync(path.join(cache.root, "logs", "alive.pack.host.log"), "log");
    fs.writeFileSync(path.join(cache.root, "logs", "ghost.pack.host.log"), "log");
    fs.writeFileSync(cache.reportPathFor("ghost.pack"), "report");
    await cache.recordFailure(key(7), "old failure", { name: "alive.pack", path: path.join(sources, "alive.pack") });
    await cache.recordFailure(key(8), "gone source", { name: "ghost.pack", path: path.join(sources, "nowhere.pack") });
    await cache.writeAlias(key(100), key(1));
    await cache.writeAlias(key(101), key(555));
    fs.writeFileSync(path.join(cache.entriesDirectory, `${key(9)}.pack`), "half");
    age(1);

    const result = await cache.housekeep();

    expect(fs.existsSync(path.join(cache.root, "logs", "ghost.pack.host.log"))).toBe(false);
    expect(fs.existsSync(path.join(cache.root, "logs", "alive.pack.host.log"))).toBe(true);
    expect(fs.existsSync(cache.reportPathFor("ghost.pack"))).toBe(false);
    expect(await cache.lookupFailure(key(8))).toBeUndefined();
    expect(await cache.lookupFailure(key(7))).toBeDefined();
    expect(await cache.resolveAlias(key(100))).toBe(key(1));
    expect(await cache.resolveAlias(key(101))).toBeUndefined();
    expect(fs.existsSync(path.join(cache.entriesDirectory, `${key(9)}.pack`))).toBe(false);
    expect(result.removed["orphan files"].count).toBeGreaterThanOrEqual(5);

    // A failure marker of an existing source expires after 30 days too.
    age(31);
    await cache.housekeep();
    expect(await cache.lookupFailure(key(7))).toBeUndefined();
  });

  it("leaves young files alone: a job may be about to write their partner", async () => {
    await cache.ensureDirectories();
    fs.writeFileSync(path.join(cache.entriesDirectory, `${key(9)}.pack`), "arriving");
    fs.writeFileSync(cache.reportPathFor("arriving.pack"), "report");
    await cache.housekeep();
    expect(fs.existsSync(path.join(cache.entriesDirectory, `${key(9)}.pack`))).toBe(true);
    expect(fs.existsSync(cache.reportPathFor("arriving.pack"))).toBe(true);
  });

  it("skips an entry whose pack is still open (EBUSY) and removes it on the next run", async () => {
    const source = await add(1, "busy.pack");
    fs.rmSync(source);
    const real = fs.promises.rm;
    let failures = 1;
    const spy = vi.spyOn(fs.promises, "rm").mockImplementation(async (target, options) => {
      if (String(target).endsWith(`${key(1)}.pack`) && failures-- > 0) {
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      }
      return real(target, options);
    });

    const first = await cache.housekeep();
    expect(first.skipped).toBe(1);
    expect(first.removed["missing source"].count).toBe(0);
    expect(await keys()).toEqual([key(1)]);

    const second = await cache.housekeep();
    spy.mockRestore();
    expect(second.skipped).toBe(0);
    expect(second.removed["missing source"].count).toBe(1);
    expect(await keys()).toEqual([]);
  });

  it("still holds the per-source cap and the size budget", async () => {
    cache = new WorkshopOptimizerCache({ root: tempDirectory(), now, budgetBytes: 25 });
    await add(1, "a.pack", { bytes: 10 });
    offset += 1000;
    await add(2, "a.pack", { bytes: 10 });
    offset += 1000;
    await add(3, "a.pack", { bytes: 10 });
    offset += 1000;
    await add(4, "b.pack", { bytes: 10 });

    // The bounds hold after every commit and again in housekeeping.
    await cache.housekeep();

    expect(await keys()).toEqual([key(3), key(4)]);
    expect((await cache.getInfo()).size).toBeLessThanOrEqual(25);
  });

  it("formats one log line, and none when nothing was removed", async () => {
    expect(formatHousekeepingLine(await cache.housekeep())).toBeUndefined();
    const line = formatHousekeepingLine({
      removed: {
        "missing source": { count: 1, bytes: 400 * 1024 * 1024 },
        expired: { count: 2, bytes: 900 * 1024 * 1024 },
        "over budget": { count: 0, bytes: 0 },
        "per-source cap": { count: 0, bytes: 0 },
        "orphan files": { count: 3, bytes: 4096 },
      },
      skipped: 1,
    });
    expect(line).toBe(
      "Optimizer cache housekeeping: removed 6 item(s), 1.3 GB: missing source 1 (400 MB), expired 2 (900 MB), orphan files 3 (4 KB); 1 in use, retried next time",
    );
  });
});

describe("startup housekeeping", () => {
  it("is scheduled, not run, at start, and never blocks or throws", async () => {
    vi.useFakeTimers();
    try {
      let started = false;
      let release!: () => void;
      const run = vi.fn(async () => {
        started = true;
        await new Promise<void>((resolve) => (release = resolve));
        throw new Error("boom");
      });

      scheduleStartupHousekeeping(run, 20_000);
      expect(run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(19_000);
      expect(started).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(run).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(10);
    } finally {
      vi.useRealTimers();
    }
  });
});
