import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { describeDBCloneSaveError, writeDBClonePackAtomically } from "../src/utility/dbCloneSave";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("DB Clone pack saving", () => {
  it("publishes a completed temporary pack at the requested path", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-dbclone-"));
    temporaryDirectories.push(directory);
    const target = path.join(directory, "clone.pack");

    await writeDBClonePackAtomically(target, (temporaryPath) => fs.promises.writeFile(temporaryPath, "complete"));

    await expect(fs.promises.readFile(target, "utf8")).resolves.toBe("complete");
    await expect(fs.promises.readdir(directory)).resolves.toEqual(["clone.pack"]);
  });

  it("keeps an existing pack and removes the temporary file when writing fails", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-dbclone-"));
    temporaryDirectories.push(directory);
    const target = path.join(directory, "clone.pack");
    await fs.promises.writeFile(target, "existing");

    await expect(
      writeDBClonePackAtomically(target, async (temporaryPath) => {
        await fs.promises.writeFile(temporaryPath, "partial");
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      }),
    ).rejects.toMatchObject({ code: "ENOSPC" });

    await expect(fs.promises.readFile(target, "utf8")).resolves.toBe("existing");
    await expect(fs.promises.readdir(directory)).resolves.toEqual(["clone.pack"]);
  });

  it("turns ENOSPC into an actionable message", () => {
    const error = Object.assign(new Error("write failed"), { code: "ENOSPC" });
    expect(describeDBCloneSaveError(error, "C:\\data\\clone.pack")).toContain("Not enough free disk space");
  });
});
