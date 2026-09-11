import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildWorkshopStagingWorkingDirectoryLines,
  buildWorkshopStagingPlan,
  cleanupWorkshopModStaging,
  stageWorkshopMods,
  WORKSHOP_MOD_STAGING_FOLDER,
  WorkshopModStagingError,
} from "../src/utility/workshopModStaging";

const temporaryDirectories: string[] = [];

const makeDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-workshop-staging-"));
  temporaryDirectories.push(directory);
  return directory;
};

const writeSourceMod = (directory: string, name: string, contents: string) => {
  const sourcePath = path.join(directory, name);
  fs.writeFileSync(sourcePath, contents);
  return sourcePath;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Workshop mod staging", () => {
  it("substitutes the staging directory and omits staged or Data-shadowed Workshop directories", () => {
    const lines = buildWorkshopStagingWorkingDirectoryLines({
      dataFolder: "/game/data",
      destinationPath: "/game/whmm_copied_mods",
      stagedModNames: ["Staged.PACK"],
      realDataPackNames: ["DATA.PACK"],
      pathPrefix: "Z:",
      mods: [
        { name: "Staged.PACK", modDirectory: "/steam/workshop/staged", isWorkshop: true },
        { name: "data.pack", modDirectory: "/steam/workshop/data", isWorkshop: true },
        { name: "other.pack", modDirectory: "/steam/workshop/other", isWorkshop: true },
        { name: "vanilla.pack", modDirectory: "/game/data", isWorkshop: false },
        { name: "generated.pack", modDirectory: "/game/data/modding", isInModding: true, isWorkshop: false },
      ],
    });

    expect(lines).toEqual([
      'add_working_directory "Z:/game/whmm_copied_mods";',
      'add_working_directory "Z:/steam/workshop/other";',
    ]);
  });

  it("stages enabled Workshop mods and preserves the source mtime", async () => {
    const gameFolder = makeDirectory();
    const sourcePath = writeSourceMod(makeDirectory(), "alpha.pack", "alpha");
    const sourceMtime = new Date("2024-01-02T03:04:05.000Z");
    fs.utimesSync(sourcePath, sourceMtime, sourceMtime);

    const result = await stageWorkshopMods({
      gameFolder,
      mode: "copy",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 100,
    });

    const destinationPath = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER, "alpha.pack");
    expect(result.requiredBytes).toBe(Buffer.byteLength("alpha"));
    expect(result.changedEntries.map((entry) => entry.name)).toEqual(["alpha.pack"]);
    expect(fs.readFileSync(destinationPath, "utf8")).toBe("alpha");
    expect(fs.statSync(destinationPath).mtimeMs).toBeCloseTo(sourceMtime.getTime(), 0);
  });

  it("plans no copy for an unchanged cache entry and copies a changed entry incrementally", async () => {
    const gameFolder = makeDirectory();
    const sourcePath = writeSourceMod(makeDirectory(), "alpha.pack", "alpha");
    await stageWorkshopMods({
      gameFolder,
      mode: "copy",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 100,
    });

    const unchangedPlan = await buildWorkshopStagingPlan({
      gameFolder,
      mode: "copy",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 0,
    });
    expect(unchangedPlan.entries[0].action).toBe("unchanged");
    expect(unchangedPlan.requiredBytes).toBe(0);

    fs.writeFileSync(sourcePath, "alpha-updated");
    const changedPlan = await buildWorkshopStagingPlan({
      gameFolder,
      mode: "copy",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 100,
    });
    expect(changedPlan.entries[0].action).toBe("copy");
    expect(changedPlan.requiredBytes).toBe(Buffer.byteLength("alpha-updated"));
  });

  it("rebuilds cached entries when cleanup is enabled and counts reclaimable destination space", async () => {
    const gameFolder = makeDirectory();
    const sourcePath = writeSourceMod(makeDirectory(), "alpha.pack", "alpha");
    await stageWorkshopMods({
      gameFolder,
      mode: "copy",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 100,
    });
    const stalePath = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER, "stale.pack");
    fs.writeFileSync(stalePath, "stale");

    const plan = await buildWorkshopStagingPlan({
      gameFolder,
      mode: "copy",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 0,
      recreateDestination: true,
    });
    expect(plan.entries[0].action).toBe("copy");
    expect(plan.requiredBytes).toBe(Buffer.byteLength("alpha"));
    expect(plan.availableBytes).toBeGreaterThanOrEqual(Buffer.byteLength("alpha") + Buffer.byteLength("stale"));

    await stageWorkshopMods({
      gameFolder,
      mode: "copy",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 0,
      recreateDestination: true,
    });
    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.readFileSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER, "alpha.pack"), "utf8")).toBe("alpha");
  });

  it("does not remove a cleanup-enabled cache when space remains insufficient after reclaim", async () => {
    const gameFolder = makeDirectory();
    const sourceDirectory = makeDirectory();
    const sourcePath = path.join(sourceDirectory, "alpha.pack");
    fs.writeFileSync(sourcePath, Buffer.alloc(8192, 1));
    const destinationPath = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER);
    fs.mkdirSync(destinationPath);
    const cachedPath = path.join(destinationPath, "cached.pack");
    fs.writeFileSync(cachedPath, "x");

    await expect(
      stageWorkshopMods({
        gameFolder,
        mode: "copy",
        workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
        getFreeBytes: async () => 0,
        recreateDestination: true,
      }),
    ).rejects.toMatchObject<WorkshopModStagingError>({ code: "INSUFFICIENT_SPACE" });
    expect(fs.readFileSync(cachedPath, "utf8")).toBe("x");
  });

  it("stages only enabled Workshop mods and skips case-insensitive Data name collisions", async () => {
    const gameFolder = makeDirectory();
    const sourceDirectory = makeDirectory();
    const enabledPath = writeSourceMod(sourceDirectory, "enabled.pack", "enabled");
    const disabledPath = writeSourceMod(sourceDirectory, "disabled.pack", "disabled");
    const dataCollisionPath = writeSourceMod(sourceDirectory, "collision.pack", "collision");

    const result = await stageWorkshopMods({
      gameFolder,
      mode: "copy",
      workshopMods: [
        { name: "enabled.pack", path: enabledPath, isEnabled: true },
        { name: "disabled.pack", path: disabledPath, isEnabled: false },
        { name: "collision.pack", path: dataCollisionPath, isEnabled: true },
      ],
      realDataPackNames: ["COLLISION.PACK"],
      getFreeBytes: async () => 100,
    });

    expect(result.stagedModNames).toEqual(["enabled.pack"]);
    expect(fs.existsSync(path.join(result.destinationPath, "enabled.pack"))).toBe(true);
    expect(fs.existsSync(path.join(result.destinationPath, "disabled.pack"))).toBe(false);
    expect(fs.existsSync(path.join(result.destinationPath, "collision.pack"))).toBe(false);
  });

  it("rejects insufficient space before creating or changing staging contents", async () => {
    const gameFolder = makeDirectory();
    const sourcePath = writeSourceMod(makeDirectory(), "alpha.pack", "12345");
    const destinationPath = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER);

    await expect(
      stageWorkshopMods({
        gameFolder,
        mode: "copy",
        workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
        getFreeBytes: async () => 4,
      }),
    ).rejects.toMatchObject<WorkshopModStagingError>({
      code: "INSUFFICIENT_SPACE",
      requiredBytes: 5,
      availableBytes: 4,
    });
    expect(fs.existsSync(destinationPath)).toBe(false);
  });

  it("rejects unavailable Windows symlinks before touching the destination", async () => {
    const gameFolder = makeDirectory();
    const sourcePath = writeSourceMod(makeDirectory(), "alpha.pack", "alpha");
    const destinationPath = path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER);

    await expect(
      stageWorkshopMods({
        gameFolder,
        mode: "symlink",
        platform: "win32",
        canCreateSymbolicLinks: false,
        workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
        getFreeBytes: async () => 0,
      }),
    ).rejects.toMatchObject<WorkshopModStagingError>({ code: "SYMLINK_UNAVAILABLE" });
    expect(fs.existsSync(destinationPath)).toBe(false);
  });

  it("reports source-plan failures as staging failures", async () => {
    const gameFolder = makeDirectory();

    await expect(
      stageWorkshopMods({
        gameFolder,
        mode: "copy",
        workshopMods: [{ name: "missing.pack", path: path.join(makeDirectory(), "missing.pack"), isEnabled: true }],
        getFreeBytes: async () => 100,
      }),
    ).rejects.toMatchObject<WorkshopModStagingError>({ code: "STAGING_FAILED" });
  });

  it("reconciles symlinks and converts a symlink cache entry back to a copy", async () => {
    const gameFolder = makeDirectory();
    const sourceDirectory = makeDirectory();
    const sourcePath = writeSourceMod(sourceDirectory, "alpha.pack", "alpha");
    const otherSourcePath = writeSourceMod(sourceDirectory, "other.pack", "other");

    const first = await stageWorkshopMods({
      gameFolder,
      mode: "symlink",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 0,
    });
    const destinationPath = path.join(first.destinationPath, "alpha.pack");
    expect(fs.lstatSync(destinationPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(destinationPath)).toBe(fs.realpathSync(sourcePath));

    const unchanged = await buildWorkshopStagingPlan({
      gameFolder,
      mode: "symlink",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 0,
    });
    expect(unchanged.entries[0].action).toBe("unchanged");

    fs.unlinkSync(destinationPath);
    fs.symlinkSync(otherSourcePath, destinationPath);
    const repaired = await stageWorkshopMods({
      gameFolder,
      mode: "symlink",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 0,
    });
    expect(repaired.entries[0].action).toBe("symlink");
    expect(fs.realpathSync(destinationPath)).toBe(fs.realpathSync(sourcePath));

    const copied = await stageWorkshopMods({
      gameFolder,
      mode: "copy",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 100,
    });
    expect(copied.entries[0].action).toBe("copy");
    expect(fs.lstatSync(destinationPath).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(destinationPath, "utf8")).toBe("alpha");
  });

  it("cleans only the manager-owned staging directory", async () => {
    const gameFolder = makeDirectory();
    const sourcePath = writeSourceMod(makeDirectory(), "alpha.pack", "alpha");
    await stageWorkshopMods({
      gameFolder,
      mode: "copy",
      workshopMods: [{ name: "alpha.pack", path: sourcePath, isEnabled: true }],
      getFreeBytes: async () => 100,
    });

    expect(await cleanupWorkshopModStaging(gameFolder)).toBe(true);
    expect(fs.existsSync(path.join(gameFolder, WORKSHOP_MOD_STAGING_FOLDER))).toBe(false);
    expect(await cleanupWorkshopModStaging(gameFolder)).toBe(false);
  });
});
