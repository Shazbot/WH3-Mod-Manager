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

import { WorkshopOptimizerCache } from "../src/workshopModOptimizer/cache";
import { runHost as realRunHost } from "../src/workshopModOptimizer/hostRunner";
import { WorkshopModOptimizer } from "../src/workshopModOptimizer/optimizer";
import {
  computeGameIdentity,
  hashFileSha256,
  packHasOptimizableVisuals,
} from "../src/workshopModOptimizer/packInspection";
import { stageWorkshopMods, WORKSHOP_MOD_STAGING_FOLDER } from "../src/utility/workshopModStaging";
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
 * goes under WHMM_OPTIMIZER_E2E_DIR; the Workshop and game folders are only read.
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

describe.skipIf(!enabled)("Workshop mod optimizer end to end", () => {
  it(
    "optimizes, caches, restores, re-keys, cancels, skips and falls back",
    async () => {
      fs.rmSync(outputRoot, { recursive: true, force: true });
      fs.mkdirSync(outputRoot, { recursive: true });
      const cache = new WorkshopOptimizerCache({ root: path.join(outputRoot, "cache") });
      const gameFolder = path.join(outputRoot, "game");
      fs.mkdirSync(gameFolder, { recursive: true });

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
      const hostHash = await hashFileSha256(hostPath);
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

      const makeOptimizer = (loadOrder: string[]) =>
        new WorkshopModOptimizer({
          cache,
          hostExecutablePath: hostPath,
          hostHash: async () => hostHash,
          vanillaFileIndexPath: vanillaIndex,
          ensureVanillaIndex: async () => undefined,
          gameDataFolder: dataFolder,
          dbSchemaPath: schemaPath,
          gameIdentity: () => computeGameIdentity(vanillaPacks),
          schemaDigest: () => hashFileSha256(schemaPath),
          includeRigidModelV2: true,
          loadOrder: loadOrder.map((p) => ({ name: path.basename(p), path: p })),
          hasVisualAssets: packHasOptimizableVisuals,
          runHost: countingRunHost,
        });

      const codecs = {
        lz4Compress: lz4CompressFrame,
        lz4Decompress: lz4DecompressFrame,
        zstdCompress: async (data: Buffer) => zlib.zstdCompressSync(data),
        zstdDecompress: async (data: Buffer) => zlib.zstdDecompressSync(data),
      };
      const staged = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER, path.basename(sourcePack));
      const timings: Record<string, number> = {};
      const stage = async (
        label: string,
        loadOrder: string[],
        extra: Partial<Parameters<typeof stageWorkshopMods>[0]> = {},
      ) => {
        const started = Date.now();
        const mods = loadOrder.map((p) => ({ name: path.basename(p), path: p, isEnabled: true }));
        const stages: string[] = [];
        const result = await stageWorkshopMods({
          gameFolder,
          mode: "copy",
          workshopMods: mods.filter((mod) => mod.path === sourcePack),
          compressMods: true,
          includeRigidModelV2: true,
          compressionCodecs: codecs,
          optimizer: makeOptimizer(loadOrder),
          optimizerProfile: "wh3-visual-v1",
          getFreeBytes: async () => 1e12,
          onProgress: (progress) => {
            if (!stages.includes(progress.phase)) stages.push(progress.phase);
          },
          ...extra,
        });
        timings[label] = (Date.now() - started) / 1000;
        console.log(
          `[e2e] ${label}: ${timings[label]}s phases=${stages.join(",")} optimizer=${JSON.stringify(result.optimizerResults)}`,
        );
        return result;
      };
      const sha = async () => hashFileSha256(staged);
      const sourceStat = fs.statSync(sourcePack);

      // 1. Cold: optimizes.
      const first = await stage("run1-optimize", [sourcePack]);
      expect(first.optimizerResults).toEqual([expect.objectContaining({ status: "optimized" })]);
      expect(counters.optimizations).toBe(1);
      const optimizedHash = await sha();
      expect(fs.statSync(staged).size).toBeLessThan(sourceStat.size);

      // 2. Staging folder removed, same input: restored from the cache, no host process.
      fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
      const hostRuns = counters.optimizations + counters.probes;
      const second = await stage("run2-restore", [sourcePack]);
      expect(second.optimizerResults).toEqual([expect.objectContaining({ status: "restored" })]);
      expect(counters.optimizations + counters.probes).toBe(hostRuns);
      expect(await sha()).toBe(optimizedHash);

      // 3. An unrelated extra mod: one probe, no optimization, same bytes.
      fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
      const optimizationsBefore = counters.optimizations;
      const third = await stage("run3-irrelevant-extra", [extra, sourcePack]);
      expect(third.optimizerResults).toEqual([expect.objectContaining({ status: "restored" })]);
      expect(counters.optimizations).toBe(optimizationsBefore);
      expect(await sha()).toBe(optimizedHash);

      // 4. A consumer that reskins the mod's assets: re-optimized.
      fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
      const fourth = await stage("run4-relevant-consumer", [sourcePack, relevantConsumer]);
      expect(fourth.optimizerResults).toEqual([expect.objectContaining({ status: "optimized" })]);
      expect(counters.optimizations).toBe(optimizationsBefore + 1);
      expect(await sha()).not.toBe(optimizedHash);

      // 5. Cancel mid-optimization (new key: consumer loads before the mod): nothing partial is left.
      fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
      const entriesBefore = (await cache.listEntries()).length;
      const controller = new AbortController();
      const cancelRun = stage("run5-cancel", [relevantConsumer, sourcePack], { signal: controller.signal });
      const cancelWatch = setInterval(() => {
        if (counters.optimizations === optimizationsBefore + 2)
          (setTimeout(() => controller.abort(), 15000), clearInterval(cancelWatch));
      }, 200);
      await expect(cancelRun).rejects.toMatchObject({ code: "CANCELED" });
      clearInterval(cancelWatch);
      expect(fs.existsSync(staged)).toBe(false);
      expect((await cache.listEntries()).length).toBe(entriesBefore);
      expect(fs.readdirSync(cache.tempDirectory)).toEqual([]);

      // 6. Launch without optimizing: plain copy + compress.
      const skip = new AbortController();
      const skipWatch = setInterval(() => {
        if (counters.optimizations === optimizationsBefore + 3)
          (setTimeout(() => skip.abort(), 10000), clearInterval(skipWatch));
      }, 200);
      const sixth = await stage("run6-skip", [relevantConsumer, sourcePack], { skipOptimizationSignal: skip.signal });
      clearInterval(skipWatch);
      expect(sixth.optimizerResults.map((r) => r.status)).toEqual(["skipped"]);
      expect(fs.existsSync(staged)).toBe(true);
      expect(Math.abs(fs.statSync(staged).size - sourceStat.size)).toBeLessThan(sourceStat.size * 0.5);
      expect(await sha()).not.toBe(optimizedHash);
      expect(fs.readdirSync(cache.tempDirectory)).toEqual([]);

      // 7. Host failure: fall back to the plain copy, remember the failure.
      fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
      failNextOptimization = true;
      const seventh = await stage("run7-failure", [relevantConsumer, sourcePack]);
      expect(seventh.optimizerResults).toEqual([expect.objectContaining({ status: "failed" })]);
      expect(await sha()).not.toBe(optimizedHash);
      const afterFailure = counters.optimizations;
      fs.rmSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER), { recursive: true, force: true });
      await stage("run8-after-failure", [relevantConsumer, sourcePack]);
      expect(counters.optimizations).toBe(afterFailure);
      console.log("[e2e] timings", JSON.stringify(timings));
    },
    40 * 60 * 1000,
  );
});
