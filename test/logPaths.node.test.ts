import * as fs from "fs";
import * as os from "os";
import * as nodePath from "path";
import { afterEach, describe, expect, it } from "vitest";

import { findLatestScriptLog } from "../src/utility/logPaths";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.promises.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("log paths", () => {
  it("finds the most recently modified script log in the game folder", async () => {
    const gamePath = await fs.promises.mkdtemp(nodePath.join(os.tmpdir(), "whmm-log-paths-"));
    temporaryDirectories.push(gamePath);

    const olderLog = nodePath.join(gamePath, "script_log_older.txt");
    const latestLog = nodePath.join(gamePath, "script_log_latest.txt");
    await fs.promises.writeFile(olderLog, "older");
    await fs.promises.writeFile(latestLog, "latest");
    await fs.promises.writeFile(nodePath.join(gamePath, "not_a_script_log.txt"), "ignored");
    await fs.promises.mkdir(nodePath.join(gamePath, "script_log_directory"));
    await fs.promises.utimes(olderLog, new Date(1_000), new Date(1_000));
    await fs.promises.utimes(latestLog, new Date(2_000), new Date(2_000));

    expect(await findLatestScriptLog(gamePath)).toBe(latestLog);
  });

  it("returns undefined when there are no script logs", async () => {
    const gamePath = await fs.promises.mkdtemp(nodePath.join(os.tmpdir(), "whmm-log-paths-"));
    temporaryDirectories.push(gamePath);

    expect(await findLatestScriptLog(gamePath)).toBeUndefined();
  });
});
