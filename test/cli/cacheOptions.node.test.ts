import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/main";
import { writeRawPack } from "../../src/packCore";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const temporaryWorkspace = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-cli-cache-options-"));
  temporaryDirectories.push(directory);
  return directory;
};

describe("CLI cache options", () => {
  it("reports structured cache stats on stderr without changing the JSON envelope", async () => {
    const root = temporaryWorkspace();
    const packPath = path.join(root, "input.pack");
    await writeRawPack(packPath, [{ name: "one.txt", buffer: Buffer.from("one") }], {
      game: "wh3",
      byteMask: 3,
      refFileCount: 0,
      headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
      dependencies: [],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await main(["pack", "info", packPath, "--format", "json", "--cache-stats"], {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ ok: true, data: { fileCount: 1 } });
    const statsLine = stderr
      .join("")
      .split(/\r?\n/)
      .find((line) => line.startsWith("[cache-stats] "));
    expect(statsLine).toBeDefined();
    expect(JSON.parse(statsLine!.slice("[cache-stats] ".length))).toMatchObject({
      enabled: true,
      memoryLimitBytes: 128 * 1024 * 1024,
      misses: { packIndexes: 1 },
    });
  });

  it("lets --no-cache win over cache settings and validates enabled memory sizes", async () => {
    const root = temporaryWorkspace();
    const packPath = path.join(root, "input.pack");
    await writeRawPack(packPath, [], {
      game: "wh3",
      byteMask: 3,
      refFileCount: 0,
      headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
      dependencies: [],
    });
    const output: string[] = [];
    const stats: string[] = [];
    const noCacheCode = await main(
      [
        "pack",
        "info",
        packPath,
        "--format",
        "json",
        "--no-cache",
        "--cache-memory-mib",
        "0",
        "--cache-dir",
        path.join(root, "should-not-be-created"),
        "--cache-stats",
      ],
      {
        stdout: (value) => output.push(value),
        stderr: (value) => stats.push(value),
      },
    );
    expect(noCacheCode).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({ ok: true, data: { fileCount: 0 } });
    expect(
      JSON.parse(
        stats
          .join("")
          .split(/\r?\n/)
          .find((line) => line.startsWith("[cache-stats] "))!
          .slice("[cache-stats] ".length),
      ),
    ).toMatchObject({
      enabled: false,
      memoryLimitBytes: 0,
    });
    expect(fs.existsSync(path.join(root, "should-not-be-created"))).toBe(false);

    const badOutput: string[] = [];
    const badCode = await main(["pack", "info", packPath, "--format", "json", "--cache-memory-mib", "1025"], {
      stdout: (value) => badOutput.push(value),
      stderr: () => undefined,
    });
    expect(badCode).not.toBe(0);
    expect(JSON.parse(badOutput.join(""))).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });
});
