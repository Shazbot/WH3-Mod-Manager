import * as fs from "fs";
import * as os from "os";
import * as nodePath from "path";
import { afterEach, describe, expect, it } from "vitest";

import { GameLogTail } from "../src/gameLogTail";

const directories: string[] = [];
const tails: GameLogTail[] = [];

afterEach(async () => {
  tails.splice(0).forEach((tail) => tail.close());
  await Promise.all(
    directories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  expect(predicate()).toBe(true);
};

describe("game log tail", () => {
  it("emits complete lines, carries partial ones, and resends after truncation", async () => {
    const directory = await fs.promises.mkdtemp(nodePath.join(os.tmpdir(), "whmm-log-tail-"));
    directories.push(directory);
    const file = nodePath.join(directory, "script_log_010126_1200.txt");
    await fs.promises.writeFile(file, "one\r\ntwo\r\npartial");

    const appended: string[][] = [];
    const resets: string[][] = [];
    const tail = new GameLogTail(file, {
      intervalMs: 20,
      onAppend: (lines) => appended.push(lines),
      onReset: (lines) => resets.push(lines),
    });
    tails.push(tail);

    expect(await tail.open()).toEqual(["one", "two"]);

    await fs.promises.appendFile(file, " line\nthree\nfour");
    await waitFor(() => appended.flat().length >= 2);
    expect(appended.flat()).toEqual(["partial line", "three"]);

    await fs.promises.appendFile(file, "\n");
    await waitFor(() => appended.flat().length >= 3);
    expect(appended.flat()).toEqual(["partial line", "three", "four"]);

    await fs.promises.writeFile(file, "fresh\n");
    await waitFor(() => resets.length >= 1);
    expect(resets[0]).toEqual(["fresh"]);
  });
});
