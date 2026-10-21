import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { describe, expect, it, vi } from "vitest";

// The app's native zstd and lz4 builds do not load under plain node; equivalent codecs stand in.
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (buffer: Buffer, level: number) => zlib.zstdCompressSync(buffer, { params: { 0: level } }),
  decompress: async (buffer: Buffer) => zlib.zstdDecompressSync(buffer),
}));
vi.mock("electron-is-dev", () => ({ default: false }));

import { BackgroundOptimizer } from "../src/workshopModOptimizer/background";
import { WorkshopOptimizerCache } from "../src/workshopModOptimizer/cache";
import { runHost as realRunHost } from "../src/workshopModOptimizer/hostRunner";
import { WorkshopModOptimizer } from "../src/workshopModOptimizer/optimizer";
import {
  computeGameIdentity,
  hashFileSha256,
  packHasOptimizableVisuals,
} from "../src/workshopModOptimizer/packInspection";
import {
  cleanupWorkshopModStaging,
  stageWorkshopMods,
  WORKSHOP_MOD_STAGING_FOLDER,
  WORKSHOP_OPTIMIZED_MODS_FOLDER,
} from "../src/utility/workshopModStaging";
import { lz4CompressFrame, lz4DecompressFrame } from "./helpers/lz4Frame";

describe("test LZ4 frame helper", () => {
  it("round-trips", async () => {
    const data = Buffer.from("abcabcabcabc".repeat(5000) + crypto.randomBytes(3000).toString("hex"));
    const frame = await lz4CompressFrame(data);
    expect(frame.length).toBeLessThan(data.length);
    expect((await lz4DecompressFrame(frame)).equals(data)).toBe(true);
  });
});

/**
 * Opt in with `WHMM_OPTIMIZER_E2E=1`. Needs the game, the Workshop mods named below, the vanilla
 * pack index, and a built WH3AssetHost.exe; it runs the real host for minutes. Everything it writes
 * goes under WHMM_OPTIMIZER_E2E_DIR; the Workshop and game folders are only read. The cache is created
 * where the app puts it: `whmm_optimized_mods`, a sibling of the staging folder `whmm_copied_mods`.
 */
const enabled = process.env.WHMM_OPTIMIZER_E2E === "1";
const workshop = process.env.WHMM_WORKSHOP_DIR ?? "K:\\SteamLibrary\\steamapps\\workshop\\content\\1142710";
const dataFolder = process.env.WHMM_GAME_DATA ?? "K:\\SteamLibrary\\steamapps\\common\\Total War WARHAMMER III\\data";
const outputRoot = process.env.WHMM_OPTIMIZER_E2E_DIR ?? "K:\\projects\\assedfork-bench\\staging-e2e";
const hostPath = process.env.WH3_ASSET_HOST_PATH ?? path.resolve(__dirname, "../tools/WH3AssetHost/WH3AssetHost.exe");
const vanillaIndex =
  process.env.WHMM_VANILLA_INDEX ?? "C:\\Users\\tilic\\AppData\\Roaming\\wh3mm\\vanilla-pack-files-cache.bin";
const schemaPath = path.resolve(__dirname, "../schema/schema_wh3.json.zst");

const sourcePack = path.join(workshop, "2927296206", "!ak_teb3.pack");
const relevantConsumer = path.join(workshop, "3147025997", "Professional_Empire_state_troops_reskin.pack");
// Another consumer the probe calls relevant (its DB tables name the mod's units).
const secondRelevantConsumer = path.join(workshop, "3280233154", "gra_cecil_gastonne.pack");

describe.skipIf(!enabled)("Workshop mod optimizer end to end", () => {
  it(
    "optimizes, links, restores, plans in the background, hands over at Play, cancels, skips and falls back",
    async () => {
      fs.rmSync(outputRoot, { recursive: true, force: true });
      fs.mkdirSync(outputRoot, { recursive: true });
      const gameFolder = path.join(outputRoot, "game");
      fs.mkdirSync(gameFolder, { recursive: true });
      const cache = new WorkshopOptimizerCache({ root: path.join(gameFolder, WORKSHOP_OPTIMIZED_MODS_FOLDER) });
      const stagingFolder = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER);

      // An extra enabled mod the probe should call irrelevant: any Workshop pack that is not a visual mod.
      const extraCandidates = fs
        .readdirSync(workshop)
        .map((id) => path.join(workshop, id))
        .filter((dir) => !dir.includes("2927296206") && !dir.includes("3147025997") && fs.statSync(dir).isDirectory())
        .flatMap((dir) =>
          fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".pack"))
            .map((f) => path.join(dir, f)),
        )
        .filter((p) => fs.statSync(p).size < 20 * 1024 * 1024);
      const extra = extraCandidates[0];

      const vanillaPacks = fs
        .readdirSync(dataFolder)
        .filter((f) => f.endsWith(".pack"))
        .map((f) => path.join(dataFolder, f));
      const counters = { probes: 0, optimizations: 0 };
      let failNextOptimization = false;
      const countingRunHost: typeof realRunHost = async (options) => {
        const requestIndex = options.args.indexOf("--request");
        if (requestIndex >= 0) {
          const request = JSON.parse(fs.readFileSync(options.args[requestIndex + 1], "utf8"));
          if (request.probeOnly) counters.probes++;
          else {
            counters.optimizations++;
            if (failNextOptimization) {
              failNextOptimization = false;
              return { kind: "failed", exitCode: 1, message: "simulated host failure" };
            }
          }
        }
        return realRunHost(options);
      };

      const makeOptimizer = (
        loadOrder: string[],
        options: Partial<ConstructorParameters<typeof WorkshopModOptimizer>[0]> = {},
      ) =>
        new WorkshopModOptimizer({
          cache,
          hostExecutablePath: hostPath,
          vanillaFileIndexPath: vanillaIndex,
          ensureVanillaIndex: async () => undefined,
          gameDataFolder: dataFolder,
          dbSchemaPath: schemaPath,
          gameIdentity: () => computeGameIdentity(vanillaPacks),
          schemaDigest: () => hashFileSha256(schemaPath),
          compressRigidModels: true,
          loadOrder: loadOrder.map((p) => ({ name: path.basename(p), path: p })),
          hasVisualAssets: packHasOptimizableVisuals,
          runHost: countingRunHost,
          ...options,
        });

      const codecs = {
        lz4Compress: lz4CompressFrame,
        lz4Decompress: lz4DecompressFrame,
        zstdCompress: async (data: Buffer) => zlib.zstdCompressSync(data),
        zstdDecompress: async (data: Buffer) => zlib.zstdDecompressSync(data),
      };
      const staged = path.join(stagingFolder, path.basename(sourcePack));
      const timings: Record<string, number> = {};
      const stage = async (
        label: string,
        loadOrder: string[],
        extraOptions: Partial<Parameters<typeof stageWorkshopMods>[0]> = {},
        optimizerOptions: Partial<ConstructorParameters<typeof WorkshopModOptimizer>[0]> = {},
      ) => {
        const started = Date.now();
        const mods = loadOrder.map((p) => ({ name: path.basename(p), path: p, isEnabled: true }));
        const optimizer = makeOptimizer(loadOrder, optimizerOptions);
        const result = await stageWorkshopMods({
          gameFolder,
          mode: "copy",
          workshopMods: mods.filter((mod) => mod.path === sourcePack),
          compressMods: true,
          includeRigidModelV2: true,
          compressionCodecs: codecs,
          optimizer,
          optimizerProfile: "wh3-visual-v1",
          getFreeBytes: async () => 1e12,
          ...extraOptions,
        });
        timings[label] = (Date.now() - started) / 1000;
        console.log(`[e2e] ${label}: ${timings[label]}s optimizer=${JSON.stringify(result.optimizerResults)}`);
        return { result, optimizer };
      };
      const sha = async () => hashFileSha256(staged);
      const sourceStat = fs.statSync(sourcePack);
      const entry = () => {
        const names = fs.readdirSync(cache.entriesDirectory).filter((name) => name.endsWith(".pack"));
        return names.map((name) => path.join(cache.entriesDirectory, name));
      };

      // 1. Cold: optimizes, links into the staging folder, and the cache is a sibling of it.
      const first = await stage("run1-optimize", [sourcePack]);
      expect(first.result.optimizerResults).toEqual([
        expect.objectContaining({ status: "optimized", placement: "hard link" }),
      ]);
      expect(counters.optimizations).toBe(1);
      expect(path.dirname(cache.root)).toBe(path.dirname(stagingFolder));
      expect(cache.root.startsWith(stagingFolder + path.sep)).toBe(false);
      const optimizedHash = await sha();
      expect(fs.statSync(staged).size).toBeLessThan(sourceStat.size);
      const [entryPath] = entry();
      const entryStat = fs.statSync(entryPath);
      expect(fs.statSync(staged).ino).toBe(entryStat.ino);
      expect(first.result.optimizerResults[0].summary?.outputBytes).toBe(entryStat.size);

      // 2. The cleanup after game exit removes the staging folder and leaves the cache alone.
      await cleanupWorkshopModStaging(gameFolder);
      expect(fs.existsSync(stagingFolder)).toBe(false);
      expect(fs.existsSync(entryPath)).toBe(true);
      expect(hashFileSha256Sync(entryPath)).toBe(optimizedHash);
      expect(fs.statSync(entryPath).ino).toBe(entryStat.ino);

      // 3. Restore: a hard link to the same file, no host process.
      const hostRuns = counters.optimizations + counters.probes;
      const second = await stage("run2-restore", [sourcePack]);
      expect(second.result.optimizerResults).toEqual([
        expect.objectContaining({ status: "restored", placement: "hard link" }),
      ]);
      expect(counters.optimizations + counters.probes).toBe(hostRuns);
      expect(fs.statSync(staged).ino).toBe(entryStat.ino);
      expect(await sha()).toBe(optimizedHash);

      // 4. A mod-list change by an unrelated mod: one batch probe, restored, no optimization.
      await cleanupWorkshopModStaging(gameFolder);
      const optimizationsBefore = counters.optimizations;
      const probesBefore = counters.probes;
      const third = await stage("run3-irrelevant-extra", [extra, sourcePack]);
      expect(third.result.optimizerResults).toEqual([expect.objectContaining({ status: "restored" })]);
      expect(counters.optimizations).toBe(optimizationsBefore);
      expect(counters.probes).toBe(probesBefore + 1);
      expect(fs.statSync(staged).ino).toBe(entryStat.ino);

      // 5. A mod-list change that matters, made in the background before "Play".
      await cleanupWorkshopModStaging(gameFolder);
      const changedList = [sourcePack, relevantConsumer];
      const background = new BackgroundOptimizer<string[]>({
        debounceMs: 500,
        plan: async (list, signal) => {
          const optimizer = makeOptimizer(list, { lowPriority: true });
          const mod = {
            name: path.basename(sourcePack),
            path: sourcePack,
            sourceFingerprint: { size: sourceStat.size, mtimeMs: sourceStat.mtimeMs },
          };
          await optimizer.prepare([mod], signal);
          const plan = await optimizer.plan(mod, signal);
          return {
            considered: plan ? 1 : 0,
            jobs: plan && !plan.cached ? [{ mod, plan }] : [],
            produce: (target, jobPlan, context) => optimizer.produce(target, jobPlan, context),
            describe: (job, result) => `[background] ${job.mod.name}: ${result.status}`,
          };
        },
        isGameRunning: () => false,
        log: (message) => console.log(`[e2e] ${message}`),
        onStatus: () => undefined,
      });
      const backgroundStarted = Date.now();
      background.notifyChange(changedList);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await background.idle();
      timings["run4-background"] = (Date.now() - backgroundStarted) / 1000;
      console.log(`[e2e] run4-background: ${timings["run4-background"]}s`);
      expect(counters.optimizations).toBe(optimizationsBefore + 1);

      // "Play": the background result restores instantly (a hard link), nothing new is optimized.
      const fourth = await stage("run4-play", changedList, {}, { background });
      expect(fourth.result.optimizerResults).toEqual([
        expect.objectContaining({ status: "restored", placement: "hard link" }),
      ]);
      expect(counters.optimizations).toBe(optimizationsBefore + 1);
      expect(timings["run4-play"]).toBeLessThan(20);
      expect(await sha()).not.toBe(optimizedHash);

      // 6. Play while the background is still working on the mod: the launch waits for that job.
      await cleanupWorkshopModStaging(gameFolder);
      const handoverList = [relevantConsumer, sourcePack];
      const optimizationsBeforeHandover = counters.optimizations;
      const handoverBackground = new BackgroundOptimizer<string[]>({
        debounceMs: 100,
        plan: async (list, signal) => {
          const optimizer = makeOptimizer(list, { lowPriority: true });
          const mod = {
            name: path.basename(sourcePack),
            path: sourcePack,
            sourceFingerprint: { size: sourceStat.size, mtimeMs: sourceStat.mtimeMs },
          };
          await optimizer.prepare([mod], signal);
          const plan = await optimizer.plan(mod, signal);
          return {
            considered: 1,
            jobs: plan && !plan.cached ? [{ mod, plan }] : [],
            produce: (target, jobPlan, context) => optimizer.produce(target, jobPlan, context),
            describe: (job, result) => `[background] ${job.mod.name}: ${result.status}`,
          };
        },
        isGameRunning: () => false,
        log: (message) => console.log(`[e2e] ${message}`),
        onStatus: () => undefined,
      });
      handoverBackground.notifyChange(handoverList);
      for (let waited = 0; handoverBackground.getStatus().state !== "running" && waited < 120_000; waited += 250) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(handoverBackground.getStatus().state).toBe("running");
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      handoverBackground.setLaunchActive(true);
      const progressSeen: number[] = [];
      const handover = await stage(
        "run5-handover",
        handoverList,
        { onProgress: (progress) => {
            if (progress.fraction !== undefined) progressSeen.push(progress.fraction);
          } },
        { background: handoverBackground },
      );
      handoverBackground.setLaunchActive(false);
      expect(handover.result.optimizerResults).toEqual([
        expect.objectContaining({ status: "restored", placement: "hard link" }),
      ]);
      expect(handover.optimizer.getRecord(sourcePack)?.joinedBackground).toBe(true);
      expect(counters.optimizations).toBe(optimizationsBeforeHandover + 1);
      expect(Math.max(...progressSeen)).toBeGreaterThan(0.5);
      for (let index = 1; index < progressSeen.length; index++) {
        expect(progressSeen[index]).toBeGreaterThanOrEqual(progressSeen[index - 1]);
      }

      // 7. Cancel mid-optimization at launch: nothing partial is left (new key: order swapped again).
      await cleanupWorkshopModStaging(gameFolder);
      const entriesBefore = entry().length;
      const controller = new AbortController();
      const cancelList = [secondRelevantConsumer, sourcePack];
      const cancelRun = stage("run6-cancel", cancelList, { signal: controller.signal });
      const cancelWatch = setInterval(() => {
        if (counters.optimizations === optimizationsBeforeHandover + 2) {
          clearInterval(cancelWatch);
          setTimeout(() => controller.abort(), 15000);
        }
      }, 200);
      await expect(cancelRun).rejects.toMatchObject({ code: "CANCELED" });
      clearInterval(cancelWatch);
      expect(fs.existsSync(staged)).toBe(false);
      expect(entry().length).toBe(entriesBefore);
      expect(fs.readdirSync(cache.tempDirectory)).toEqual([]);

      // 8. Launch without optimizing: plain copy + compress.
      const skip = new AbortController();
      const skipWatch = setInterval(() => {
        if (counters.optimizations === optimizationsBeforeHandover + 3) {
          clearInterval(skipWatch);
          setTimeout(() => skip.abort(), 10000);
        }
      }, 200);
      const sixth = await stage("run7-skip", cancelList, { skipOptimizationSignal: skip.signal });
      clearInterval(skipWatch);
      expect(sixth.result.optimizerResults.map((r) => r.status)).toEqual(["skipped"]);
      expect(Math.abs(fs.statSync(staged).size - sourceStat.size)).toBeLessThan(sourceStat.size * 0.5);
      expect(fs.readdirSync(cache.tempDirectory)).toEqual([]);

      // 9. Host failure: fall back to the plain copy, remember the failure.
      await cleanupWorkshopModStaging(gameFolder);
      failNextOptimization = true;
      const seventh = await stage("run8-failure", cancelList);
      expect(seventh.result.optimizerResults).toEqual([expect.objectContaining({ status: "failed" })]);
      const afterFailure = counters.optimizations;
      await cleanupWorkshopModStaging(gameFolder);
      await stage("run9-after-failure", cancelList);
      expect(counters.optimizations).toBe(afterFailure);

      // The cache survived all the cleanups.
      expect(entry().length).toBeGreaterThanOrEqual(3);
      console.log("[e2e] timings", JSON.stringify(timings));
    },
    60 * 60 * 1000,
  );
});

const hashFileSha256Sync = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
