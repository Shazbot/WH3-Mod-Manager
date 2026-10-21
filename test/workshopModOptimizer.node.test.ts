import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import * as crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkshopOptimizerCache } from "../src/workshopModOptimizer/cache";
import { type OptimizerKeyBase, buildExactKey, buildNarrowKey } from "../src/workshopModOptimizer/cacheKey";
import {
  type HostChildProcess,
  type HostRunOutcome,
  HostProgressTracker,
  parseHostLine,
  runHost,
} from "../src/workshopModOptimizer/hostRunner";
import { WorkshopModOptimizer } from "../src/workshopModOptimizer/optimizer";
import { stageWorkshopMods, WORKSHOP_MOD_STAGING_FOLDER } from "../src/utility/workshopModStaging";

const directories: string[] = [];
const makeDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-optimizer-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const baseKey: OptimizerKeyBase = {
  profile: "wh3-visual-v1",
  options: { a: true, b: false },
  source: { name: "mod.pack", size: 100, mtimeMs: 5000 },
  outputVersion: 1,
  scanVersion: 1,
  gameIdentity: "g",
  schemaDigest: "s",
};

describe("optimizer cache keys", () => {
  const first = { path: "C:\\w\\a.pack", size: 1, mtimeMs: 1, beforeSource: true };
  const second = { path: "C:\\w\\z.pack", size: 2, mtimeMs: 2, beforeSource: false };

  it("keys the narrow key on relevant consumers only and on their side of the mod", () => {
    expect(buildNarrowKey(baseKey, [])).toBe(buildNarrowKey({ ...baseKey }, []));
    expect(buildNarrowKey(baseKey, [first])).not.toBe(buildNarrowKey(baseKey, []));
    expect(buildNarrowKey(baseKey, [first])).not.toBe(buildNarrowKey(baseKey, [{ ...first, beforeSource: false }]));
    expect(buildNarrowKey(baseKey, [first])).not.toBe(buildNarrowKey(baseKey, [{ ...first, size: 9 }]));
  });

  it("changes with the source, output version, game, schema and options, not with the host build", () => {
    const reference = buildNarrowKey(baseKey, []);
    for (const changed of [
      { source: { ...baseKey.source, size: 101 } },
      { outputVersion: 2 },
      { gameIdentity: "x" },
      { schemaDigest: "x" },
      { options: { a: false, b: false } },
      { profile: "wh3-visual-v2" },
    ]) {
      expect(buildNarrowKey({ ...baseKey, ...changed }, [])).not.toBe(reference);
    }

    // The scan version only decides the exact-to-narrow alias.
    expect(buildNarrowKey({ ...baseKey, scanVersion: 2 }, [])).toBe(reference);
    expect(buildExactKey({ ...baseKey, scanVersion: 2 }, [])).not.toBe(buildExactKey(baseKey, []));
  });

  it("keys the exact key on every consumer", () => {
    expect(buildExactKey(baseKey, [first, second])).not.toBe(buildExactKey(baseKey, [first]));
    expect(buildExactKey(baseKey, [first, second])).toBe(buildExactKey(baseKey, [first, second]));
  });
});

describe("optimizer cache store", () => {
  const key = (n: number) => n.toString(16).padStart(32, "0");
  const addEntry = async (cache: WorkshopOptimizerCache, id: number, source: string, bytes: number) => {
    await cache.ensureDirectories();
    const temporary = cache.newTempPath(`${id}.pack`);
    fs.writeFileSync(temporary, Buffer.alloc(bytes, id));
    await cache.commit(key(id), temporary, {
      sourceName: `${source}.pack`,
      sourcePath: `C:\\w\\${source}.pack`,
      profile: "p",
    });
  };

  it("keeps at most two entries per source and never evicts pinned ones", async () => {
    let now = 1;
    const cache = new WorkshopOptimizerCache({ root: makeDirectory(), now: () => now++ });
    await addEntry(cache, 1, "a", 10);
    await addEntry(cache, 2, "a", 10);
    cache.unpinAll();
    await addEntry(cache, 3, "a", 10);
    cache.unpinAll();
    const keys = (await cache.listEntries()).map((entry) => entry.key).sort();
    expect(keys).toEqual([key(2), key(3)]);

    cache.pin(key(2));
    await addEntry(cache, 4, "a", 10);
    const afterPin = (await cache.listEntries()).map((entry) => entry.key);
    expect(afterPin).toContain(key(2));
    expect(afterPin).toContain(key(4));
  });

  it("evicts least recently used entries over the budget but keeps the current launch's", async () => {
    let now = 1;
    const cache = new WorkshopOptimizerCache({ root: makeDirectory(), budgetBytes: 25, now: () => now++ });
    await addEntry(cache, 1, "a", 10);
    cache.unpinAll();
    await addEntry(cache, 2, "b", 10);
    cache.unpinAll();
    await addEntry(cache, 3, "c", 10);
    expect((await cache.listEntries()).map((entry) => entry.key).sort()).toEqual([key(2), key(3)]);
    expect((await cache.getInfo()).size).toBe(20);
  });

  it("drops an entry whose pack size no longer matches and clears everything", async () => {
    const cache = new WorkshopOptimizerCache({ root: makeDirectory() });
    await addEntry(cache, 1, "a", 10);
    expect(await cache.lookup(key(1))).toBeDefined();
    const entryPath = path.join(cache.entriesDirectory, `${key(1)}.pack`);
    // Entries are read-only: an accidental in-place write fails instead of corrupting a staged link.
    expect(() => fs.appendFileSync(entryPath, "x")).toThrow(/EPERM|EACCES/);
    fs.chmodSync(entryPath, 0o666);
    fs.appendFileSync(entryPath, "x");
    expect(await cache.lookup(key(1))).toBeUndefined();
    await addEntry(cache, 2, "a", 10);
    await cache.clear();
    expect((await cache.getInfo()).hasContents).toBe(false);
  });

  it("remembers failures per key", async () => {
    const cache = new WorkshopOptimizerCache({ root: makeDirectory() });
    await cache.recordFailure(key(7), "boom");
    expect((await cache.lookupFailure(key(7)))?.message).toBe("boom");
    expect(await cache.lookupFailure(key(8))).toBeUndefined();
  });
});

const fakeChild = () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  let killed = false;
  const child = {
    stdout,
    stderr,
    on: (event: string, listener: (...args: never[]) => void) => emitter.on(event, listener),
    kill: () => {
      killed = true;
      emitter.emit("exit", null, "SIGTERM");
      return true;
    },
  } as unknown as HostChildProcess;
  return { child, stdout, stderr, emitter, wasKilled: () => killed };
};

describe("host runner", () => {
  it("parses progress, result, probe and error lines and ignores other output", () => {
    expect(
      parseHostLine('{"type":"progress","stage":"Loading source pack","item":"a.pack","current":0,"total":0}'),
    ).toMatchObject({
      type: "progress",
      stage: "Loading source pack",
    });
    expect(parseHostLine("0.6.0+abc")).toBeUndefined();
    expect(parseHostLine('{"type":"result","status":"succeeded"}')?.type).toBe("result");
    expect(parseHostLine("{not json")).toBeUndefined();
  });

  it("reads a real host run's captured stdout", async () => {
    const captured = path.join("K:\\projects\\assedfork-bench", "warm-1", "stdout.txt");
    if (!fs.existsSync(captured)) return;
    const text = new TextDecoder("utf-16le").decode(fs.readFileSync(captured)).replace(/^\uFEFF/, "");
    const stages: string[] = [];
    const { child, stdout, emitter } = fakeChild();
    const run = runHost({
      executablePath: "x",
      args: [],
      spawnProcess: () => child,
      onProgress: (line) => stages.push(line.stage),
    });
    stdout.write(text.slice(0, 5000));
    stdout.write(text.slice(5000));
    stdout.end();
    await new Promise((resolve) => setImmediate(resolve));
    emitter.emit("exit", 0, null);
    const outcome = await run;
    expect(outcome.kind).toBe("result");
    expect(stages).toContain("Saving output pack");
    const tracker = new HostProgressTracker();
    let previous = 0;
    for (const stage of stages) {
      const value = tracker.update(stage);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("maps exit codes and kills the process on abort", async () => {
    const failed = fakeChild();
    const failedRun = runHost({ executablePath: "x", args: [], spawnProcess: () => failed.child });
    failed.stdout.write('{"type":"error","message":"bad input"}\n');
    await new Promise((resolve) => setImmediate(resolve));
    failed.emitter.emit("exit", 1, null);
    expect(await failedRun).toMatchObject({ kind: "failed", exitCode: 1, message: "bad input" });

    const canceled = fakeChild();
    const controller = new AbortController();
    const canceledRun = runHost({
      executablePath: "x",
      args: [],
      signal: controller.signal,
      spawnProcess: () => canceled.child,
    });
    controller.abort();
    expect(await canceledRun).toEqual({ kind: "canceled" });
    expect(canceled.wasKilled()).toBe(true);
  });
});

interface FakeHostCalls {
  probes: number;
  probedSources: string[];
  hostBuild?: string;
  outputVersion?: number;
  optimizations: number;
  relevant: Set<string>;
  failNext: boolean;
  block?: Promise<void>;
}

const makeFakeHost =
  (calls: FakeHostCalls) =>
  async (options: Parameters<typeof runHost>[0]): Promise<HostRunOutcome> => {
    if (options.args.includes("--check-dds")) return { kind: "ok" };
    if (options.args.includes("--version")) {
      return { kind: "version", text: `0.6.0+${calls.hostBuild ?? "a"} output=${calls.outputVersion ?? 1} scan=1` };
    }
    const request = JSON.parse(fs.readFileSync(options.args[options.args.indexOf("--request") + 1], "utf8"));
    const consumers: string[] = request.consumerPackPaths ?? [];
    const describe = (list: string[]) =>
      list.map((consumerPath) => ({
        path: consumerPath,
        relevant: calls.relevant.has(path.basename(consumerPath)),
        reasons: { frozenFiles: 0, usedFiles: 0, dbMentions: 0, undecodableTables: 0, vanillaOverridesReached: 0 },
      }));
    const packs = describe(consumers);
    if (request.probeOnly) {
      calls.probes++;
      if (request.probeSources) {
        calls.probedSources.push(...request.probeSources);
        return {
          kind: "probe",
          probe: {
            type: "probe",
            hostVersion: "t",
            consumers: [],
            sources: request.probeSources.map((source: string) => ({
              sourcePackPath: source,
              consumers: describe(consumers.filter((item) => item !== source)),
            })),
          },
        };
      }
      return { kind: "probe", probe: { type: "probe", hostVersion: "t", consumers: packs } };
    }
    calls.optimizations++;
    options.onProgress?.({ type: "progress", stage: "Loading source pack", current: 0, total: 0 });
    if (calls.block) {
      await Promise.race([
        calls.block,
        new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve(), { once: true })),
      ]);
    }
    if (options.signal?.aborted) {
      fs.writeFileSync(`${request.outputPackPath}.optimizing`, "partial");
      return { kind: "canceled" };
    }
    if (calls.failNext) {
      calls.failNext = false;
      return { kind: "failed", exitCode: 1, message: "host failed" };
    }
    fs.writeFileSync(request.outputPackPath, `optimized:${fs.readFileSync(request.sourcePackPath, "utf8")}`);
    fs.writeFileSync(request.reportPath, "report");
    return {
      kind: "result",
      result: {
        type: "result",
        status: "succeeded",
        outputPackPath: request.outputPackPath,
        reportPath: request.reportPath,
        consumerPacks: packs,
        hostVersion: "t",
        outputVersion: 1,
        summary: {
          sourceBytes: 1000,
          outputBytes: 400,
          textureBytesSaved: 100,
          drawCallsEliminated: 12.4,
          mergedModelsGenerated: 3,
        },
      },
    };
  };

describe("Workshop mod optimizer staging", () => {
  const setup = (loadOrderNames: string[], calls: FakeHostCalls, cacheRoot = makeDirectory()) => {
    const workshop = makeDirectory();
    const gameFolder = makeDirectory();
    const files = new Map<string, string>();
    const mods = loadOrderNames.map((name) => {
      const filePath = path.join(workshop, name);
      fs.writeFileSync(filePath, `content-${name}`);
      files.set(name, filePath);
      return { name, path: filePath, isEnabled: true };
    });
    const host = path.join(workshop, "host.exe");
    fs.writeFileSync(host, "host");
    const cache = new WorkshopOptimizerCache({ root: cacheRoot });
    const compressionCalls: string[] = [];
    const make = (enabled = mods) =>
      new WorkshopModOptimizer({
        cache,
        hostExecutablePath: host,
        vanillaFileIndexPath: "index.bin",
        ensureVanillaIndex: async () => undefined,
        gameDataFolder: "data",
        gameIdentity: async () => "game",
        schemaDigest: async () => "schema",
        compressRigidModels: true,
        loadOrder: enabled.map((mod) => ({ name: mod.name, path: mod.path })),
        hasVisualAssets: async (packPath) => path.basename(packPath).startsWith("unit"),
        runHost: makeFakeHost(calls),
      });
    const stage = (
      optimizer: WorkshopModOptimizer | undefined,
      extra: Partial<Parameters<typeof stageWorkshopMods>[0]> = {},
    ) =>
      stageWorkshopMods({
        gameFolder,
        mode: "copy",
        workshopMods: mods,
        compressMods: true,
        optimizer,
        optimizerProfile: optimizer ? "wh3-visual-v1" : undefined,
        getFreeBytes: async () => 1e9,
        compressionRunner: async (packPath) => {
          compressionCalls.push(path.basename(packPath));
          fs.appendFileSync(packPath, "+lz4");
          return {
            status: "compressed" as const,
            success: true,
            packPath,
            originalSize: 1,
            compressedSize: 1,
            compressedFileCount: 1,
          };
        },
        ...extra,
      });
    return { mods, cache, make, stage, gameFolder, compressionCalls, files };
  };
  const read = (gameFolder: string, name: string) =>
    fs.readFileSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER, name), "utf8");

  it("optimizes eligible mods only, does not compress the host's output again and restores it from the cache next time", async () => {
    const calls: FakeHostCalls = {
      probes: 0,
      probedSources: [],
      optimizations: 0,
      relevant: new Set(),
      failNext: false,
    };
    const { make, stage, gameFolder, compressionCalls } = setup(["aaa.pack", "unit_one.pack", "zzz.pack"], calls);

    const first = await stage(make());
    expect(read(gameFolder, "unit_one.pack")).toBe("optimized:content-unit_one.pack");
    expect(read(gameFolder, "aaa.pack")).toBe("content-aaa.pack+lz4");
    expect(first.optimizerResults).toEqual([expect.objectContaining({ name: "unit_one.pack", status: "optimized" })]);
    expect(calls.optimizations).toBe(1);
    // The host compresses its own output; whmm's compressor only handles the plain copies.
    expect(compressionCalls.sort()).toEqual(["aaa.pack", "zzz.pack"]);

    // Same input again: nothing is staged or optimized.
    const second = await stage(make());
    expect(calls.optimizations).toBe(1);
    expect(second.changedEntries).toHaveLength(0);

    // The staging folder is gone (clean-up after exit): restored from the cache, no host run.
    fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
    const third = await stage(make());
    expect(calls.optimizations).toBe(1);
    expect(third.optimizerResults).toEqual([expect.objectContaining({ status: "restored" })]);
    expect(read(gameFolder, "unit_one.pack")).toBe("optimized:content-unit_one.pack");
  });

  const newCalls = (overrides: Partial<FakeHostCalls> = {}): FakeHostCalls => ({
    probes: 0,
    probedSources: [],
    optimizations: 0,
    relevant: new Set(),
    failNext: false,
    ...overrides,
  });
  const entryPath = (cache: WorkshopOptimizerCache) => {
    const names = fs.readdirSync(cache.entriesDirectory).filter((name) => name.endsWith(".pack"));
    expect(names).toHaveLength(1);
    return path.join(cache.entriesDirectory, names[0]);
  };
  const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

  it("restores a cached result as a hard link to the cache entry and never writes it in place", async () => {
    const calls = newCalls();
    const { make, stage, gameFolder, cache } = setup(["unit_one.pack", "zzz.pack"], calls);
    await stage(make());
    const staged = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER, "unit_one.pack");
    const entry = entryPath(cache);
    const entryBefore = { bytes: sha(entry), ino: fs.statSync(entry).ino, mtimeMs: fs.statSync(entry).mtimeMs };

    // A fresh result is linked too: the staged file and the cache entry are one file.
    expect(fs.statSync(staged).ino).toBe(entryBefore.ino);
    expect(fs.statSync(staged).nlink).toBe(2);

    // Nothing a launch does writes the linked file: restaging unchanged, restaging after the staging
    // folder was cleaned (a fresh link), and the cleanup itself.
    await stage(make());
    expect(fs.statSync(staged).ino).toBe(entryBefore.ino);
    // The data folder-style cleanup removes the staged links only.
    fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
    expect(fs.statSync(entry).nlink).toBe(1);
    const restored = await stage(make());
    expect(restored.optimizerResults).toEqual([
      expect.objectContaining({ status: "restored", placement: "hard link" }),
    ]);
    expect(fs.statSync(staged).ino).toBe(entryBefore.ino);
    expect(calls.optimizations).toBe(1);

    expect(sha(entry)).toBe(entryBefore.bytes);
    expect(fs.statSync(entry).ino).toBe(entryBefore.ino);
    expect(fs.statSync(entry).mtimeMs).toBe(entryBefore.mtimeMs);
    // An in-place write through the staged link fails: the shared file is read-only.
    expect(() => fs.appendFileSync(staged, "x")).toThrow(/EPERM|EACCES/);
    expect(sha(entry)).toBe(entryBefore.bytes);
  });

  it("copies instead when linking fails and says why", async () => {
    const calls = newCalls();
    const { make, stage, gameFolder, cache } = setup(["unit_one.pack"], calls);
    await stage(make());
    fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });

    const spy = vi
      .spyOn(fs.promises, "link")
      .mockRejectedValue(Object.assign(new Error("cross-device"), { code: "EXDEV" }));
    try {
      const result = await stage(make());
      expect(result.optimizerResults).toEqual([
        expect.objectContaining({ status: "restored", placement: "copy", placementReason: "EXDEV" }),
      ]);
    } finally {
      spy.mockRestore();
    }

    const staged = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER, "unit_one.pack");
    const entry = entryPath(cache);
    expect(fs.statSync(staged).ino).not.toBe(fs.statSync(entry).ino);
    expect(fs.readFileSync(staged, "utf8")).toBe("optimized:content-unit_one.pack");
  });

  it("probes every mod in one host run", async () => {
    const calls = newCalls();
    const { make, stage } = setup(["unit_a.pack", "unit_b.pack", "unit_c.pack", "zzz.pack"], calls);
    await stage(make());
    expect(calls.probes).toBe(1);
    expect(calls.probedSources.map((source) => path.basename(source)).sort()).toEqual([
      "unit_a.pack",
      "unit_b.pack",
      "unit_c.pack",
    ]);
    expect(calls.optimizations).toBe(3);
  });

  it("keeps cached results across a host build change and drops them with a new output version", async () => {
    const calls = newCalls();
    const { make, stage, gameFolder } = setup(["unit_one.pack"], calls);
    await stage(make());
    expect(calls.optimizations).toBe(1);

    fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
    calls.hostBuild = "newer-build";
    await stage(make());
    expect(calls.optimizations).toBe(1);

    fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
    calls.outputVersion = 2;
    await stage(make());
    expect(calls.optimizations).toBe(2);
  });

  it("carries the host's savings summary to the outcome and the cache entry", async () => {
    const calls = newCalls();
    const { make, stage, gameFolder, cache } = setup(["unit_one.pack"], calls);
    const first = await stage(make());
    const expected = {
      sourceBytes: 1000,
      outputBytes: 400,
      textureBytesSaved: 100,
      drawCallsEliminated: 12.4,
      mergedModelsGenerated: 3,
    };
    expect(first.optimizerResults[0].summary).toEqual(expected);

    fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
    const restored = await stage(make());
    expect(restored.optimizerResults[0]).toMatchObject({ status: "restored", summary: expected });
    expect((await cache.listEntries())[0].summary).toEqual(expected);
  });

  it("ignores an unrelated mod being added but re-optimizes for a relevant one", async () => {
    const calls: FakeHostCalls = {
      probes: 0,
      probedSources: [],
      optimizations: 0,
      relevant: new Set(),
      failNext: false,
    };
    const cacheRoot = makeDirectory();
    const one = setup(["unit_one.pack", "zzz.pack"], calls, cacheRoot);
    await one.stage(one.make());
    expect(calls.optimizations).toBe(1);

    // Same source file, one more enabled mod that the host calls irrelevant.
    const extraPath = path.join(path.dirname(one.mods[0].path), "extra.pack");
    fs.writeFileSync(extraPath, "extra");
    const withExtra = [...one.mods, { name: "extra.pack", path: extraPath, isEnabled: true }];
    fs.rmSync(path.join(one.gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
    const irrelevant = await one.stage(one.make(withExtra), { workshopMods: withExtra });
    expect(calls.optimizations).toBe(1);
    expect(irrelevant.optimizerResults).toEqual([expect.objectContaining({ status: "restored" })]);

    // A relevant consumer changes the result.
    calls.relevant.add("extra.pack");
    fs.writeFileSync(extraPath, "extra changed!");
    fs.rmSync(path.join(one.gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
    await one.stage(one.make(withExtra), { workshopMods: withExtra });
    expect(calls.optimizations).toBe(2);
  });

  it("falls back to a plain copy after a host failure and does not retry the same input", async () => {
    const calls: FakeHostCalls = {
      probes: 0,
      probedSources: [],
      optimizations: 0,
      relevant: new Set(),
      failNext: true,
    };
    const { make, stage, gameFolder } = setup(["unit_one.pack"], calls);
    const result = await stage(make());
    expect(result.optimizerResults).toEqual([expect.objectContaining({ status: "failed", message: "host failed" })]);
    expect(read(gameFolder, "unit_one.pack")).toBe("content-unit_one.pack+lz4");

    fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
    await stage(make());
    expect(calls.optimizations).toBe(1);
    expect(read(gameFolder, "unit_one.pack")).toBe("content-unit_one.pack+lz4");
  });

  it("leaves no partial pack when canceled and falls back when optimization is skipped", async () => {
    let release!: () => void;
    const calls: FakeHostCalls = {
      probes: 0,
      probedSources: [],
      optimizations: 0,
      relevant: new Set(),
      failNext: false,
      block: new Promise<void>((resolve) => (release = resolve)),
    };
    const cacheRoot = makeDirectory();
    const canceled = setup(["unit_one.pack"], calls, cacheRoot);
    const controller = new AbortController();
    const run = canceled.stage(canceled.make(), { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await expect(run).rejects.toMatchObject({ code: "CANCELED" });
    const tempFiles = fs.existsSync(canceled.cache.tempDirectory) ? fs.readdirSync(canceled.cache.tempDirectory) : [];
    expect(tempFiles).toEqual([]);
    expect(await canceled.cache.listEntries()).toHaveLength(0);

    const skipped = setup(["unit_one.pack", "unit_two.pack"], calls, makeDirectory());
    const skip = new AbortController();
    const skipRun = skipped.stage(skipped.make(), { skipOptimizationSignal: skip.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    skip.abort();
    const result = await skipRun;
    expect(read(skipped.gameFolder, "unit_one.pack")).toBe("content-unit_one.pack+lz4");
    expect(read(skipped.gameFolder, "unit_two.pack")).toBe("content-unit_two.pack+lz4");
    expect(result.optimizerResults.map((outcome) => outcome.status)).not.toContain("optimized");
    release();
  });
});
