import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/main";
import { createCliProgressReporter, defaultCliCacheDirectory, formatAffectedChecklist } from "../../src/cli/feedback";
import { writeRawPack } from "../../src/packCore";

let root: string;
const metadata = { game: "wh3" as const, byteMask: 3, refFileCount: 0, headerBuffer: Buffer.from([255, 255, 255, 127]), dependencies: [] as string[] };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-feedback-cli-"));
  vi.stubEnv("XDG_CACHE_HOME", path.join(root, "cache"));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const run = async (args: string[]) => {
  const stdout: string[] = [], stderr: string[] = [];
  const code = await main(args, { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) });
  return { code, out: stdout.join(""), err: stderr.join("") };
};
const pack = async () => {
  const file = path.join(root, "input.pack");
  await writeRawPack(file, [
    { name: "models\\a.variantmeshdefinition", buffer: Buffer.from("<root><source>textures/a.dds</source></root>") },
    { name: "textures\\a.dds", buffer: Buffer.from("fixture") },
    { name: "text\\a.txt", buffer: Buffer.from("alpha beta") },
  ], metadata);
  return file;
};

describe("feedback CLI", () => {
  it("reads a UTF-8 path batch, ignoring blank lines, and protects the input from report overwrite", async () => {
    const source = await pack(), list = path.join(root, "paths.txt");
    const content = "\ufefftextures/a.dds\r\n\r\nmodels/a.variantmeshdefinition\r\n";
    fs.writeFileSync(list, content);
    const result = await run(["asset", "users", source, "--paths-from", list, "--format", "json", "--no-cache"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ ok: true, data: { totalTargets: 2, targets: expect.arrayContaining([
      expect.objectContaining({ targetPath: "textures\\a.dds" }),
      expect.objectContaining({ targetPath: "models\\a.variantmeshdefinition" }),
    ]) } });
    const conflicting = await run(["asset", "users", source, "textures/a.dds", "--paths-from", list, "--format", "json"]);
    expect(conflicting.code).toBe(2);
    const overwrite = await run(["asset", "users", source, "--paths-from", list, "--report", list, "--format", "json"]);
    expect(overwrite.code).not.toBe(0);
    expect(fs.readFileSync(list, "utf8")).toBe(content);
  });

  it("supports search regex, glob aliases, and batched queries", async () => {
    const source = await pack();
    const result = await run(["pack", "search", source, "alpha|beta", "--regex", "--glob", "**/*.txt", "--format", "json", "--no-cache"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).data.results).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "text", filePath: "text\\a.txt" })]));
    const input = path.join(root, "queries.json");
    fs.writeFileSync(input, JSON.stringify({ queries: ["alpha", "beta"] }));
    const batch = await run(["pack", "search", source, "--input", input, "--file-glob", "**/*.txt", "--format", "json", "--no-cache"]);
    expect(batch.code).toBe(0);
    expect(JSON.parse(batch.out).data.queries).toEqual(["alpha", "beta"]);
    const conflict = await run(["pack", "search", source, "alpha", "--glob", "**/*.txt", "--file-glob", "**/*.dds", "--format", "json"]);
    expect(conflict.code).toBe(2);
  });

  it("passes a unit-query list through the shared lookup and rejects ambiguous single/list input", async () => {
    const source = await pack(), list = path.join(root, "units.txt");
    fs.writeFileSync(list, "unit_a\nunit_b\n");
    const result = await run(["unit", "resolve", source, "--paths-from", list, "--format", "json", "--no-cache"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ ok: true, data: { queries: ["unit_a", "unit_b"], results: [
      expect.objectContaining({ query: "unit_a", total: 0 }), expect.objectContaining({ query: "unit_b", total: 0 }),
    ] } });
    expect((await run(["unit", "resolve", source, "unit_a", "--paths-from", list, "--format", "json"])).code).toBe(2);
  });

  it("allows affected diff budgets above 50000 and keeps progress off JSON stdout", async () => {
    const source = await pack();
    const result = await run(["pack", "diff", source, source, "--affected-units", "--max-edges", "500001", "--max-scan-sources", "7", "--progress", "--format", "json", "--no-cache"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ ok: true, data: { affectedUnits: { analysis: { before: { graph: { maxEdges: 500001 } } } } } });
    expect(result.err).toContain("[progress]");
    const disabled = await run(["pack", "diff", source, source, "--affected-units", "--no-progress", "--format", "checklist", "--no-cache"]);
    expect(disabled.code).toBe(0);
    expect(disabled.err).not.toContain("[progress]");
    expect(disabled.out).toContain("0 affected units; complete");
    expect((await run(["pack", "info", source, "--format", "checklist"])).code).toBe(2);
  });

  it("persists visual references by default across CLI calls and --no-cache disables it", async () => {
    const source = await pack();
    const input = path.join(root, "references.json");
    fs.writeFileSync(input, JSON.stringify({ packPaths: [source], roots: ["models/a.variantmeshdefinition"], traversal: "direct" }));
    const args = ["asset", "resolve", "--input", input, "--cache-stats", "--format", "json"];
    const cold = await run(args), warm = await run(args);
    expect(cold.code).toBe(0); expect(warm.code).toBe(0);
    const stats = (result: { err: string }) => JSON.parse(result.err.split("\n").find((line) => line.startsWith("[cache-stats] "))!.slice(14));
    expect(stats(cold).visuals.sourceParses).toBeGreaterThan(0);
    expect(stats(warm).visuals).toMatchObject({ sourceParses: 0, referenceHits: 1 });
    expect(fs.existsSync(path.join(root, "cache", "wh3mm", "headless", "visuals", "references"))).toBe(true);
    expect(stats(await run([...args, "--no-cache"])).enabled).toBe(false);
  });

  it("throttles progress but emits phase changes and completion", () => {
    let time = 0;
    const output: string[] = [];
    const report = createCliProgressReporter((value) => output.push(value), () => time);
    report({ stage: "indexing", completed: 0, total: 10 });
    time = 10; report({ stage: "indexing", completed: 1, total: 10 });
    report({ stage: "indexing", completed: 10, total: 10 });
    report({ stage: "indexing", completed: 10, total: 10 });
    report({ stage: "traversal", message: "next\nphase" });
    expect(output).toHaveLength(3);
    expect(output[2]).toContain("next phase");
  });

  it("falls back from an unavailable default cache while rejecting an invalid explicit root", async () => {
    const source = await pack();
    const cacheRoot = path.join(root, "cache", "wh3mm");
    fs.mkdirSync(path.dirname(cacheRoot), { recursive: true });
    fs.writeFileSync(cacheRoot, "not a directory");
    const fallback = await run(["pack", "info", source, "--format", "json"]);
    expect(fallback.code).toBe(0);
    expect(fallback.err).toContain("Default disk cache unavailable; using memory cache");
    const explicit = await run(["pack", "info", source, "--format", "json", "--cache-dir", cacheRoot]);
    expect(explicit.code).toBe(3);
  });

  it("uses platform cache locations and prints compact single-line unit evidence", () => {
    expect(defaultCliCacheDirectory("linux", { XDG_CACHE_HOME: "/cache" }, "/home/user")).toBe("/cache/wh3mm");
    expect(defaultCliCacheDirectory("linux", {}, "/home/user")).toBe("/home/user/.cache/wh3mm");
    expect(defaultCliCacheDirectory("win32", { LOCALAPPDATA: "C:\\Local" }, "C:\\User")).toBe("C:\\Local\\wh3mm");
    const output = formatAffectedChecklist({ affectedUnits: { total: 1, complete: false, unresolvedPaths: ["textures/unresolved.dds"], checklist: { units: [
      { key: "unit_a", name: "Some\nName", role: "lord", customBattleFactions: [{ key: "faction_a" }], changedBytes: 40, changedFiles: [{ path: "models/a.rigid_model_v2" }] },
    ] } } });
    expect(output).toContain("unit_a | Some Name | lord | custom battle: faction_a | 40 bytes | models/a.rigid_model_v2");
    expect(output).toContain("unresolved | textures/unresolved.dds");
  });
});
