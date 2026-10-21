import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildOptimizerLaunchLog,
  formatOptimizerLogLine,
  type OptimizerModRecord,
} from "../src/workshopModOptimizer/logFormat";
import {
  type SelectionMod,
  comparableDirectory,
  selectCustomFolderStaging,
} from "../src/workshopModOptimizer/stagingSelection";
import {
  buildWorkshopStagingWorkingDirectoryLines,
  cleanupWorkshopModStaging,
  stageWorkshopMods,
  WORKSHOP_MOD_STAGING_FOLDER,
} from "../src/utility/workshopModStaging";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
const tempDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-custom-"));
  directories.push(directory);
  return directory;
};

const DATA = path.resolve("/game/data");
const STAGING = path.resolve("/game/whmm_copied_mods");
const WORKSHOP_A = path.resolve("/steam/workshop/1");
const FOLDER_ONE = path.resolve("/mods/albion");
const FOLDER_TWO = path.resolve("/mods/misc");

const mod = (name: string, directory: string, sourceKind: SelectionMod["sourceKind"]): SelectionMod => ({
  name,
  path: path.join(directory, name),
  modDirectory: directory,
  sourceKind,
});

const optimizable = new Set(["unit.pack"]);
const hasVisualAssets = async (packPath: string) => optimizable.has(path.basename(packPath).toLowerCase());
const folderContents: Record<string, string[]> = {
  [comparableDirectory(FOLDER_ONE)]: ["unit.pack", "readme.pack"],
  [comparableDirectory(FOLDER_TWO)]: ["scripts.pack"],
};
const listPackNames = async (directory: string) => new Set(folderContents[comparableDirectory(directory)] ?? []);

const linesFor = (
  mods: SelectionMod[],
  staged: Awaited<ReturnType<typeof selectCustomFolderStaging>> | undefined,
  dataNames: string[] = [],
) => {
  const stagedNames = [
    ...mods.filter((item) => item.sourceKind === "workshop").map((item) => item.name),
    ...(staged?.mods.map((item) => item.name) ?? []),
  ];
  return buildWorkshopStagingWorkingDirectoryLines({
    dataFolder: DATA,
    destinationPath: STAGING,
    stagedModNames: stagedNames,
    realDataPackNames: dataNames,
    stagedDirectories: staged?.stagedDirectories,
    mods: mods.map((item) => ({
      name: item.name,
      modDirectory: item.modDirectory,
      isWorkshop: item.sourceKind === "workshop",
    })),
  });
};

describe("custom mod folders and the optimizer", () => {
  it("stages a whole custom folder that holds an optimizable mod and drops its line", async () => {
    const mods = [mod("unit.pack", FOLDER_ONE, "custom"), mod("readme.pack", FOLDER_ONE, "custom")];
    const staged = await selectCustomFolderStaging({
      mods,
      dataPackNames: new Set(),
      hasVisualAssets,
      listPackNames,
    });

    expect(staged.mods.map((item) => item.name)).toEqual(["unit.pack", "readme.pack"]);
    expect(linesFor(mods, staged)).toEqual([`add_working_directory "${STAGING}";`]);
    // Without the optimizer the folder line is emitted exactly as before.
    expect(linesFor(mods, undefined)).toEqual([`add_working_directory "${FOLDER_ONE}";`]);
  });

  it("mixed folders: only the folder with an optimizable mod is staged, the others keep their lines", async () => {
    const mods = [
      mod("w.pack", WORKSHOP_A, "workshop"),
      mod("unit.pack", FOLDER_ONE, "custom"),
      mod("scripts.pack", FOLDER_TWO, "custom"),
    ];
    const staged = await selectCustomFolderStaging({ mods, dataPackNames: new Set(), hasVisualAssets, listPackNames });

    expect(staged.mods.map((item) => item.name)).toEqual(["unit.pack"]);
    expect(linesFor(mods, staged)).toEqual([
      `add_working_directory "${STAGING}";`,
      `add_working_directory "${FOLDER_TWO}";`,
    ]);

    // A staged name is not findable through any other emitted directory.
    const stagedNames = new Set(["w.pack", ...staged.mods.map((item) => item.name.toLowerCase())]);
    for (const line of linesFor(mods, staged)) {
      const directory = /"(.*)"/.exec(line)![1];
      if (directory === STAGING) continue;
      for (const name of await listPackNames(directory)) expect(stagedNames.has(name)).toBe(false);
    }
  });

  it("a custom mod whose name exists in Data is never staged; Data wins", async () => {
    const mods = [mod("unit.pack", FOLDER_ONE, "custom"), mod("readme.pack", FOLDER_ONE, "custom")];
    const staged = await selectCustomFolderStaging({
      mods,
      dataPackNames: new Set(["readme.pack"]),
      hasVisualAssets,
      listPackNames,
    });

    expect(staged.mods.map((item) => item.name)).toEqual(["unit.pack"]);
    expect(linesFor(mods, staged, ["readme.pack"])).toEqual([`add_working_directory "${STAGING}";`]);

    // An optimizable custom mod that is also in Data is left to Data entirely.
    const onlyData = await selectCustomFolderStaging({
      mods: [mod("unit.pack", FOLDER_ONE, "custom")],
      dataPackNames: new Set(["unit.pack"]),
      hasVisualAssets,
      listPackNames,
    });
    expect(onlyData.mods).toEqual([]);
    expect(onlyData.stagedDirectories.size).toBe(0);
  });

  it("stages a kept folder that holds a pack with a staged name from another source", async () => {
    const mods = [mod("w.pack", WORKSHOP_A, "workshop"), mod("scripts.pack", FOLDER_TWO, "custom")];
    const clashing: Record<string, string[]> = { [comparableDirectory(FOLDER_TWO)]: ["scripts.pack", "w.pack"] };
    const staged = await selectCustomFolderStaging({
      mods,
      dataPackNames: new Set(),
      hasVisualAssets,
      listPackNames: async (directory) => new Set(clashing[comparableDirectory(directory)] ?? []),
    });

    expect(staged.mods.map((item) => item.name)).toEqual(["scripts.pack"]);
    expect([...staged.folderReasons.values()][0]).toContain("w.pack");
    expect(linesFor(mods, staged)).toEqual([`add_working_directory "${STAGING}";`]);
  });

  it("copies the custom folder's mods, never writes to the source folder, and cleanup removes the copies", async () => {
    const folder = tempDirectory();
    const gameFolder = tempDirectory();
    fs.writeFileSync(path.join(folder, "unit.pack"), "unit");
    fs.writeFileSync(path.join(folder, "readme.pack"), "readme");
    const before = fs.readdirSync(folder).map((name) => [name, fs.statSync(path.join(folder, name)).mtimeMs]);

    await stageWorkshopMods({
      gameFolder,
      mode: "copy",
      workshopMods: ["unit.pack", "readme.pack"].map((name) => ({
        name,
        path: path.join(folder, name),
        isEnabled: true,
      })),
      getFreeBytes: async () => 1e9,
    });
    const stagedFolder = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER);
    expect(
      fs
        .readdirSync(stagedFolder)
        .filter((name) => name.endsWith(".pack"))
        .sort(),
    ).toEqual(["readme.pack", "unit.pack"]);
    expect(fs.readdirSync(folder).map((name) => [name, fs.statSync(path.join(folder, name)).mtimeMs])).toEqual(before);

    await cleanupWorkshopModStaging(gameFolder);
    expect(fs.existsSync(stagedFolder)).toBe(false);
  });
});

describe("optimizer main.log lines", () => {
  const record = (overrides: OptimizerModRecord = {}): OptimizerModRecord => overrides;

  it("formats each outcome on one line", () => {
    expect(
      formatOptimizerLogLine({
        pack: "!ak_teb3.pack",
        source: "custom folder",
        status: "optimized",
        record: record({
          seconds: 151.4,
          exitCode: 0,
          keyKind: "narrow (probed)",
          probeSeconds: 9.04,
          relevantConsumers: ["a.pack", "b.pack"],
        }),
      }),
    ).toBe(
      "Optimizer: !ak_teb3.pack (custom folder) -> optimized in 151 s | key: narrow (probed) | probe 9.0 s, relevant consumers: a.pack, b.pack | host exit code 0",
    );
    expect(
      formatOptimizerLogLine({
        pack: "x.pack",
        source: "workshop",
        status: "restored",
        record: record({ keyKind: "narrow (alias hit)" }),
      }),
    ).toBe("Optimizer: x.pack (workshop) -> restored from cache | key: narrow (alias hit)");
    expect(
      formatOptimizerLogLine({
        pack: "x.pack",
        source: "workshop",
        status: "failed",
        failureMessage: "boom",
        record: record({ exitCode: 1, hostLogPath: "C:\\u\\logs\\x.pack.host.log" }),
      }),
    ).toBe(
      "Optimizer: x.pack (workshop) -> failed: boom (exit code 1) (host log: C:\\u\\logs\\x.pack.host.log) -> fell back to plain copy",
    );
    expect(
      formatOptimizerLogLine({
        pack: "x.pack",
        source: "workshop",
        record: record({
          skipReason: "cached-failure",
          failureMarker: { message: "boom", createdAt: Date.UTC(2026, 9, 21) },
        }),
      }),
    ).toBe("Optimizer: x.pack (workshop) -> skipped: failed before for this input (2026-10-21: boom) -> plain copy");
    expect(
      formatOptimizerLogLine({
        pack: "x.pack",
        source: "workshop",
        record: record({ skipReason: "no-visual-assets" }),
      }),
    ).toBe("Optimizer: x.pack (workshop) -> skipped: no .variantmeshdefinition/.wsmodel");
    expect(formatOptimizerLogLine({ pack: "x.pack", source: "workshop", status: "skipped" })).toContain(
      "Launch without optimizing",
    );
  });

  it("builds one line per enabled mod with the skip reasons", () => {
    const mods = [
      { ...mod("vanilla.pack", DATA, "data") },
      { ...mod("unit.pack", FOLDER_ONE, "custom") },
      { ...mod("scripts.pack", FOLDER_TWO, "custom") },
      { ...mod("w.pack", WORKSHOP_A, "workshop") },
      { ...mod("readme.pack", FOLDER_ONE, "custom") },
    ];
    const lines = buildOptimizerLaunchLog({
      mods,
      dataPackNames: new Set(["readme.pack"]),
      stagedDirectories: new Set([comparableDirectory(FOLDER_ONE)]),
      comparableDirectory,
      recordFor: (packPath) => (path.basename(packPath) === "w.pack" ? { skipReason: "no-visual-assets" } : undefined),
      outcomes: [{ name: "unit.pack", status: "restored" }],
      userSkipped: false,
    });

    expect(lines).toEqual([
      "Optimizer: vanilla.pack (data) -> skipped: data folder",
      "Optimizer: unit.pack (custom folder) -> restored from cache",
      "Optimizer: scripts.pack (custom folder) -> skipped: not staged -> loaded from its own folder",
      "Optimizer: w.pack (workshop) -> skipped: no .variantmeshdefinition/.wsmodel",
      "Optimizer: readme.pack (custom folder) -> skipped: data folder",
    ]);
  });
});
