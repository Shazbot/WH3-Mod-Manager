import { promises as fsPromises } from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildUpdateTempDirPath, removeStaleUpdateTempDirs } from "../src/utility/updateTempDirs";

describe("buildUpdateTempDirPath", () => {
  it("names the staging area after the process that owns it", () => {
    expect(buildUpdateTempDirPath(nodePath.join("root", "temp"), 52116)).toBe(
      nodePath.join("root", "temp", "wh3mm-update-52116"),
    );
  });
});

describe("removeStaleUpdateTempDirs", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fsPromises.mkdtemp(nodePath.join(nodeOs.tmpdir(), "wh3mm-temp-dirs-test-"));
  });

  afterEach(async () => {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  });

  const listTempRoot = async () => (await fsPromises.readdir(tempRoot)).sort();

  it("removes the staging areas earlier updates left behind, contents and all", async () => {
    const staleDir = buildUpdateTempDirPath(tempRoot, 52116);
    await fsPromises.mkdir(nodePath.join(staleDir, "staging", "resources"), { recursive: true });
    await fsPromises.writeFile(nodePath.join(staleDir, "update.zip"), "archive");
    await fsPromises.writeFile(nodePath.join(staleDir, "staging", "resources", "app.asar"), "payload");
    await fsPromises.writeFile(nodePath.join(staleDir, "update.cmd"), "@echo off");

    const result = await removeStaleUpdateTempDirs(tempRoot, process.pid);

    expect(result.removed).toEqual([staleDir]);
    expect(result.failed).toEqual([]);
    expect(await listTempRoot()).toEqual([]);
  });

  it("keeps the directory this process would use for an update of its own", async () => {
    const ownDir = buildUpdateTempDirPath(tempRoot, process.pid);
    await fsPromises.mkdir(ownDir);

    const result = await removeStaleUpdateTempDirs(tempRoot, process.pid);

    expect(result.removed).toEqual([]);
    expect(await listTempRoot()).toEqual([nodePath.basename(ownDir)]);
  });

  it("leaves anything that is not an update staging directory alone", async () => {
    await fsPromises.mkdir(nodePath.join(tempRoot, "wh3mm-update-not-a-pid"));
    await fsPromises.mkdir(nodePath.join(tempRoot, "wh3mm-cache"));
    await fsPromises.mkdir(nodePath.join(tempRoot, "unrelated"));
    // A file whose name matches the pattern is still not a staging area.
    await fsPromises.writeFile(nodePath.join(tempRoot, "wh3mm-update-99"), "");

    const result = await removeStaleUpdateTempDirs(tempRoot, process.pid);

    expect(result.removed).toEqual([]);
    expect(await listTempRoot()).toEqual(["unrelated", "wh3mm-cache", "wh3mm-update-99", "wh3mm-update-not-a-pid"]);
  });

  it("removes every stale directory it finds", async () => {
    const first = buildUpdateTempDirPath(tempRoot, 101);
    const second = buildUpdateTempDirPath(tempRoot, 202);
    await fsPromises.mkdir(first);
    await fsPromises.mkdir(second);

    const result = await removeStaleUpdateTempDirs(tempRoot, process.pid);

    expect(result.removed.sort()).toEqual([first, second].sort());
    expect(await listTempRoot()).toEqual([]);
  });

  it("reports a directory that is still in use instead of giving up on the rest", async () => {
    const lockedDir = buildUpdateTempDirPath(tempRoot, 101);
    const freeDir = buildUpdateTempDirPath(tempRoot, 202);
    await fsPromises.mkdir(lockedDir);
    await fsPromises.mkdir(freeDir);

    // What a helper still running out of its own staging area looks like from here.
    const rm = vi.spyOn(fsPromises, "rm").mockImplementationOnce(() => {
      const error: NodeJS.ErrnoException = new Error("EBUSY: resource busy or locked");
      error.code = "EBUSY";
      return Promise.reject(error);
    });

    try {
      const result = await removeStaleUpdateTempDirs(tempRoot, process.pid);

      expect(result.removed).toEqual([freeDir]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].path).toBe(lockedDir);
      expect(result.failed[0].error.message).toContain("EBUSY");
      expect(await listTempRoot()).toEqual([nodePath.basename(lockedDir)]);
    } finally {
      rm.mockRestore();
    }
  });

  it("does nothing when the temporary directory does not exist", async () => {
    const missingRoot = nodePath.join(tempRoot, "missing");

    await expect(removeStaleUpdateTempDirs(missingRoot, process.pid)).resolves.toEqual({ removed: [], failed: [] });
  });
});
