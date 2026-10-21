import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (buffer: Buffer, level: number) => zlib.zstdCompressSync(buffer, { params: { 0: level } }),
  decompress: async (buffer: Buffer) => zlib.zstdDecompressSync(buffer),
}));
vi.mock("electron-is-dev", () => ({ default: false }));

import { WorkshopOptimizerCache } from "../src/workshopModOptimizer/cache";
import { runHost as realRunHost } from "../src/workshopModOptimizer/hostRunner";
import { buildOptimizerLaunchLog } from "../src/workshopModOptimizer/logFormat";
import { WorkshopModOptimizer } from "../src/workshopModOptimizer/optimizer";
import {
  computeGameIdentity,
  hashFileSha256,
  packHasOptimizableVisuals,
} from "../src/workshopModOptimizer/packInspection";
import { comparableDirectory, selectCustomFolderStaging } from "../src/workshopModOptimizer/stagingSelection";
import { buildWorkshopStagingWorkingDirectoryLines, stageWorkshopMods } from "../src/utility/workshopModStaging";
import { lz4CompressFrame, lz4DecompressFrame } from "./helpers/lz4Frame";

/**
 * Opt in with `WHMM_OPTIMIZER_E2E=1`. Stages a pack from a custom mod folder (read-only: the test
 * compares the folder's listing before and after) into WHMM_OPTIMIZER_E2E_CUSTOM_DIR.
 */
const enabled = process.env.WHMM_OPTIMIZER_E2E === "1";
const customFolder = process.env.WHMM_CUSTOM_FOLDER ?? "K:\\wh3mods\\albion";
const dataFolder = process.env.WHMM_GAME_DATA ?? "K:\\SteamLibrary\\steamapps\\common\\Total War WARHAMMER III\\data";
const outputRoot = process.env.WHMM_OPTIMIZER_E2E_CUSTOM_DIR ?? "K:\\projects\\assedfork-bench\\staging-e2e-custom";
const hostPath = process.env.WH3_ASSET_HOST_PATH ?? path.resolve(__dirname, "../tools/WH3AssetHost/WH3AssetHost.exe");
const vanillaIndex =
  process.env.WHMM_VANILLA_INDEX ?? "C:\\Users\\tilic\\AppData\\Roaming\\wh3mm\\vanilla-pack-files-cache.bin";
const schemaPath = path.resolve(__dirname, "../schema/schema_wh3.json.zst");
const sourcePack = path.join(customFolder, "!ak_teb3.pack");

const listing = (directory: string) =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const stats = fs.statSync(path.join(directory, entry.name));
      return `${entry.name}|${entry.isDirectory() ? "dir" : stats.size}|${stats.mtimeMs}`;
    })
    .sort();

describe.skipIf(!enabled)("custom mod folder end to end", () => {
  it(
    "stages and optimizes a pack from a custom folder without touching the folder, then restores it",
    async () => {
      const before = { folder: listing(customFolder), parent: listing(path.dirname(customFolder)) };
      fs.rmSync(outputRoot, { recursive: true, force: true });
      fs.mkdirSync(outputRoot, { recursive: true });
      const cache = new WorkshopOptimizerCache({ root: path.join(outputRoot, "cache") });
      const gameFolder = path.join(outputRoot, "game");
      fs.mkdirSync(gameFolder, { recursive: true });
      const vanillaPacks = fs
        .readdirSync(dataFolder)
        .filter((f) => f.endsWith(".pack"))
        .map((f) => path.join(dataFolder, f));
      const hostHash = await hashFileSha256(hostPath);
      let hostRuns = 0;
      const countingRunHost: typeof realRunHost = async (options) => {
        if (options.args.includes("--request")) hostRuns++;
        return realRunHost(options);
      };
      const codecs = {
        lz4Compress: lz4CompressFrame,
        lz4Decompress: lz4DecompressFrame,
        zstdCompress: async (data: Buffer) => zlib.zstdCompressSync(data),
        zstdDecompress: async (data: Buffer) => zlib.zstdDecompressSync(data),
      };
      const enabledMods = [
        { name: "!ak_teb3.pack", path: sourcePack, modDirectory: customFolder, sourceKind: "custom" as const },
      ];

      const run = async (label: string) => {
        const started = Date.now();
        const folders = await selectCustomFolderStaging({
          mods: enabledMods,
          dataPackNames: new Set(),
          hasVisualAssets: packHasOptimizableVisuals,
          listPackNames: async () => new Set(),
        });
        const optimizer = new WorkshopModOptimizer({
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
          loadOrder: enabledMods.map((mod) => ({ name: mod.name, path: mod.path })),
          hasVisualAssets: packHasOptimizableVisuals,
          runHost: countingRunHost,
        });
        const result = await stageWorkshopMods({
          gameFolder,
          mode: "copy",
          workshopMods: folders.mods.map((mod) => ({ name: mod.name, path: mod.path, isEnabled: true })),
          compressMods: true,
          includeRigidModelV2: true,
          compressionCodecs: codecs,
          optimizer,
          optimizerProfile: "wh3-visual-v1",
          getFreeBytes: async () => 1e12,
        });
        const lines = buildWorkshopStagingWorkingDirectoryLines({
          dataFolder,
          destinationPath: result.destinationPath,
          stagedModNames: result.stagedModNames,
          stagedDirectories: folders.stagedDirectories,
          mods: enabledMods.map((mod) => ({ name: mod.name, modDirectory: mod.modDirectory, isWorkshop: false })),
        });
        const log = buildOptimizerLaunchLog({
          mods: enabledMods,
          dataPackNames: new Set(),
          stagedDirectories: folders.stagedDirectories,
          comparableDirectory,
          recordFor: (packPath) => optimizer.getRecord(packPath),
          outcomes: result.optimizerResults,
          userSkipped: false,
        });
        console.log(`[e2e-custom] ${label}: ${(Date.now() - started) / 1000}s`, lines, log);
        return { result, lines, log, folders };
      };

      const first = await run("run1");
      expect(first.result.optimizerResults).toEqual([expect.objectContaining({ status: "optimized" })]);
      expect(first.lines).toEqual([`add_working_directory "${first.result.destinationPath}";`]);
      expect(first.log[0]).toContain("(custom folder) -> optimized in");
      const stagedPack = path.join(first.result.destinationPath, "!ak_teb3.pack");
      const firstHash = await hashFileSha256(stagedPack);
      expect(fs.statSync(stagedPack).size).toBeLessThan(fs.statSync(sourcePack).size);
      expect(hostRuns).toBe(1);

      // The cleanup after the game exit removes the copy; the next launch restores it from the cache.
      fs.rmSync(first.result.destinationPath, { recursive: true, force: true });
      const second = await run("run2");
      expect(second.result.optimizerResults).toEqual([expect.objectContaining({ status: "restored" })]);
      expect(second.log[0]).toContain("restored from cache");
      expect(hostRuns).toBe(1);
      expect(await hashFileSha256(stagedPack)).toBe(firstHash);

      expect(listing(customFolder)).toEqual(before.folder);
      expect(listing(path.dirname(customFolder))).toEqual(before.parent);
    },
    20 * 60 * 1000,
  );
});
