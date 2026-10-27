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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-cli-asset-users-"));
  temporaryDirectories.push(directory);
  return directory;
};

const metadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([255, 255, 255, 127]),
  dependencies: [] as string[],
};

describe("asset users CLI options", () => {
  it("lets repeated filters and budget flags override JSON input values", async () => {
    const root = temporaryWorkspace();
    const packPath = path.join(root, "empty.pack");
    const inputPath = path.join(root, "asset-users.json");
    await writeRawPack(packPath, [], metadata);
    fs.writeFileSync(inputPath, JSON.stringify({
      maxDepth: 10,
      maxNodes: 20,
      maxEdges: 30,
      maxRoots: 40,
      maxWorkNodes: 50,
      maxWorkEdges: 60,
      unitKeys: ["from_json"],
      rootGlob: "json/**/*.vmd",
    }));
    const stdout: string[] = [];
    const exitCode = await main([
      "asset", "users", packPath, "textures/example.dds", "--input", inputPath, "--format", "json",
      "--max-depth", "0", "--max-nodes", "2", "--max-edges", "3", "--max-roots", "4",
      "--max-work-nodes", "5", "--max-work-edges", "6", "--unit", "Unit_A", "--unit", "LAND_A",
      "--root-glob", "**/VISUAL*.VMD",
    ], { stdout: (value) => stdout.push(value), stderr: () => undefined });

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout.join(""));
    expect(result).toMatchObject({ ok: true, data: {
      coverage: {
        scope: { unitKeys: ["land_a", "unit_a"], rootGlob: "**/visual*.vmd" },
        budgets: { maxDepth: 0, maxNodes: 2, maxEdges: 3, maxRoots: 4, maxWorkNodes: 5, maxWorkEdges: 6 },
      },
    } });
  });

  it.each([
    ["--max-depth", "33"],
    ["--max-nodes", "0"],
    ["--max-edges", "1.5"],
    ["--max-roots", "10001"],
    ["--max-work-nodes", "1000001"],
    ["--max-work-edges", "5000001"],
  ])("rejects out-of-range or non-integer %s values", async (flag, value) => {
    const root = temporaryWorkspace();
    const packPath = path.join(root, "empty.pack");
    await writeRawPack(packPath, [], metadata);
    const stdout: string[] = [];
    const exitCode = await main(["asset", "users", packPath, "textures/example.dds", "--format", "json", flag, value], {
      stdout: (chunk) => stdout.push(chunk), stderr: () => undefined,
    });
    expect(exitCode).not.toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ ok: false });
  });
});
