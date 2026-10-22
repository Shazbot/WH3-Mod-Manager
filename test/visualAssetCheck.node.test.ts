import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import enTranslation from "../locales/en/translation.json";
import {
  type HostChildProcess,
  type HostRunOutcome,
  CHECK_STAGE_SECONDS,
  HostProgressTracker,
  parseHostLine,
  parseHostVersionLine,
  runHost,
} from "../src/workshopModOptimizer/hostRunner";
import type { runHost as RunHost } from "../src/workshopModOptimizer/hostRunner";
import {
  buildCheckRequest,
  checkReportFileNameFor,
  dependencyPacksOf,
  runVisualAssetCheck,
} from "../src/workshopModOptimizer/visualCheck";

const directories: string[] = [];
const makeDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-visual-check-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const checkLine = {
  type: "check",
  status: "succeeded",
  hostVersion: "0.6.0+abc",
  findings: [
    {
      severity: "error",
      code: "MissingTexture",
      category: "Textures",
      message: "Material references 1 texture(s) found neither in the pack nor in the game packs.",
      path: "m\\a.xml.material",
      relatedPaths: ["t\\a.dds"],
      relatedCount: 1,
      details: "t_xml_base_colour -> t\\a.dds",
      usedByGame: true,
    },
  ],
  summary: {
    errors: 1,
    warnings: 0,
    infos: 0,
    byCode: { MissingTexture: 1 },
    byCategory: { Textures: 1 },
    findingsUsed: 1,
    findingsUnused: 0,
    findingsUnknown: 0,
    usageKnown: true,
    vmdsUsed: 2,
    vmdsUnused: 1,
  },
  reportPath: "C:\\reports\\a.check.txt",
  elapsedSeconds: 12.5,
  vmdCount: 3,
  wsModelCount: 4,
  rigidCount: 5,
  materialCount: 6,
};

const fakeChild = () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  const child = {
    stdout,
    stderr,
    on: (event: string, listener: (...args: never[]) => void) => emitter.on(event, listener),
    kill: () => {
      emitter.emit("exit", null, "SIGTERM");
      return true;
    },
  } as unknown as HostChildProcess;
  return { child, stdout, emitter };
};

describe("host check line", () => {
  it("parses a check line and normalizes missing fields", () => {
    const line = parseHostLine(JSON.stringify(checkLine));
    expect(line).toMatchObject({ type: "check", status: "succeeded", reportPath: "C:\\reports\\a.check.txt" });
    if (line?.type !== "check") throw new Error("not a check line");
    expect(line.findings[0]).toMatchObject({ severity: "error", code: "MissingTexture", relatedCount: 1 });
    expect(line.summary.byCode).toEqual({ MissingTexture: 1 });
    expect(line.findings[0].usedByGame).toBe(true);
    expect(line.summary).toMatchObject({ usageKnown: true, findingsUsed: 1, vmdsUnused: 1 });

    const sparse = parseHostLine('{"type":"check","status":"cancelled","findings":[{"severity":"odd","code":"X"}]}');
    if (sparse?.type !== "check") throw new Error("not a check line");
    expect(sparse.summary).toEqual({
      errors: 0,
      warnings: 0,
      infos: 0,
      byCode: {},
      byCategory: {},
      findingsUsed: 0,
      findingsUnused: 0,
      findingsUnknown: 0,
      usageKnown: false,
      vmdsUsed: 0,
      vmdsUnused: 0,
    });
    expect(sparse.findings[0]).toMatchObject({
      severity: "info",
      path: "",
      relatedPaths: [],
      relatedCount: 0,
      details: null,
      usedByGame: null,
    });
  });

  it("reads the check capability from the version line", () => {
    expect(parseHostVersionLine("0.6.0+abc output=2 scan=2 check=2")?.checkVersion).toBe(2);
    expect(parseHostVersionLine("0.6.0+abc output=2 scan=2")).toEqual({
      hostVersion: "0.6.0+abc",
      outputVersion: 2,
      scanVersion: 2,
    });
  });

  it("runHost resolves a check outcome, a cancelled one and a failure", async () => {
    const ok = fakeChild();
    const okRun = runHost({ executablePath: "x", args: [], spawnProcess: () => ok.child });
    ok.stdout.write(`${JSON.stringify(checkLine)}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    ok.emitter.emit("exit", 0, null);
    expect(await okRun).toMatchObject({ kind: "check", check: { vmdCount: 3 } });

    const cancelled = fakeChild();
    const cancelledRun = runHost({ executablePath: "x", args: [], spawnProcess: () => cancelled.child });
    cancelled.stdout.write(`${JSON.stringify({ ...checkLine, status: "cancelled" })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    cancelled.emitter.emit("exit", 3, null);
    expect(await cancelledRun).toEqual({ kind: "canceled" });

    const failed = fakeChild();
    const failedRun = runHost({ executablePath: "x", args: [], spawnProcess: () => failed.child });
    failed.stdout.write('{"type":"error","message":"sourcePackPath does not exist"}\n');
    await new Promise((resolve) => setImmediate(resolve));
    failed.emitter.emit("exit", 2, null);
    expect(await failedRun).toMatchObject({ kind: "failed", exitCode: 2, message: "sourcePackPath does not exist" });
  });

  it("tracks check progress monotonically over the check stages", () => {
    const tracker = new HostProgressTracker(CHECK_STAGE_SECONDS);
    let previous = 0;
    for (const [stage] of CHECK_STAGE_SECONDS) {
      const value = tracker.update(stage, 1, 2);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(previous).toBeLessThan(1);
    expect(tracker.update("Unknown stage")).toBe(previous);
  });
});

describe("runVisualAssetCheck", () => {
  const setup = (versionText: string, checkOutcome: HostRunOutcome) => {
    const directory = makeDirectory();
    const host = path.join(directory, "WH3AssetHost.exe");
    fs.writeFileSync(host, "x");
    const calls: string[][] = [];
    const requests: unknown[] = [];
    const deps = {
      hostExecutablePath: host,
      vanillaFileIndexPath: "C:\\index.bin",
      gameDataFolder: "C:\\game\\data",
      reportsDirectory: path.join(directory, "reports"),
      tempDirectory: path.join(directory, "tmp"),
      hostCacheDirectory: path.join(directory, "cache"),
      ensureVanillaIndex: async () => undefined,
      parentProcessId: 77,
      now: () => 1234,
      runHost: (async (options) => {
        calls.push(options.args);
        if (options.args[0] === "--version") return { kind: "version", text: versionText } as HostRunOutcome;
        requests.push(JSON.parse(fs.readFileSync(options.args[2], "utf8")));
        options.onProgress?.({ type: "progress", stage: "Auditing LODs", item: "a", current: 1, total: 2 });
        return checkOutcome;
      }) as typeof RunHost,
    };
    return { deps, calls, requests, directory };
  };

  it("runs the host's check action and returns the report", async () => {
    const { deps, calls, requests } = setup("0.6.0 output=2 scan=2 check=2", {
      kind: "check",
      check: parseHostLine(JSON.stringify(checkLine)) as never,
    });
    const progress: number[] = [];
    const outcome = await runVisualAssetCheck(
      deps,
      { name: "mod.pack", path: "C:\\mods\\mod.pack" },
      {
        dependencyPackPaths: ["C:\\mods\\dep.pack"],
        onProgress: (value) => progress.push(value.fraction),
      },
    );

    expect(outcome.status).toBe("done");
    if (outcome.status !== "done") return;
    expect(outcome.report).toMatchObject({ modName: "mod.pack", generatedAt: 1234, vmdCount: 3, elapsedSeconds: 12.5 });
    expect(outcome.report.findings).toHaveLength(1);
    expect(calls[1].slice(0, 1)).toEqual(["check"]);
    expect(calls[1].slice(3)).toEqual(["--parent-pid", "77"]);
    expect(requests[0]).toEqual(
      buildCheckRequest(
        deps,
        "C:\\mods\\mod.pack",
        path.join(deps.reportsDirectory, checkReportFileNameFor("C:\\mods\\mod.pack")),
        ["C:\\mods\\dep.pack"],
      ),
    );
    expect(requests[0]).toMatchObject({ dependencyPackPaths: ["C:\\mods\\dep.pack"] });
    expect(requests[0]).toMatchObject({ schemaVersion: 1, sourcePackPath: "C:\\mods\\mod.pack" });
    expect(progress[0]).toBeGreaterThan(0);
    expect(fs.readdirSync(deps.tempDirectory)).toEqual([]);
  });

  it("reports a missing host, an older host without check, and host failures", async () => {
    const ok = setup("0.6.0 output=2 scan=2 check=2", { kind: "failed", exitCode: 1, message: "boom" });
    expect(await runVisualAssetCheck(ok.deps, { name: "m", path: "C:\\m.pack" })).toEqual({
      status: "failed",
      code: "HOST_FAILED",
      message: "boom",
    });

    const old = setup("0.5.0 output=1 scan=1", { kind: "ok" });
    const oldOutcome = await runVisualAssetCheck(old.deps, { name: "m", path: "C:\\m.pack" });
    expect(oldOutcome).toMatchObject({ status: "failed", code: "HOST_TOO_OLD" });
    expect(old.calls).toEqual([["--version"]]);

    const missing = await runVisualAssetCheck(
      { ...ok.deps, hostExecutablePath: path.join(ok.directory, "nope.exe") },
      { name: "m", path: "C:\\m.pack" },
    );
    expect(missing).toMatchObject({ status: "failed", code: "HOST_MISSING" });
  });

  it("maps a canceled host and a failing vanilla index", async () => {
    const canceled = setup("0.6.0 output=2 scan=2 check=2", { kind: "canceled" });
    expect(await runVisualAssetCheck(canceled.deps, { name: "m", path: "C:\\m.pack" })).toEqual({ status: "canceled" });

    const index = setup("0.6.0 output=2 scan=2 check=2", { kind: "ok" });
    const outcome = await runVisualAssetCheck(
      {
        ...index.deps,
        ensureVanillaIndex: async () => {
          throw new Error("no index");
        },
      },
      { name: "m", path: "C:\\m.pack" },
    );
    expect(outcome).toEqual({ status: "failed", code: "INDEX_FAILED", message: "no index" });
  });

  it("names stored reports after the pack", () => {
    const workshop = checkReportFileNameFor("C:\\workshop\\1\\!ak_teb3.pack");
    const custom = checkReportFileNameFor("D:\\custom\\!ak_teb3.pack");
    expect(workshop).toMatch(/^!ak_teb3\.[0-9a-f]{8}\.check\.txt$/);
    expect(custom).not.toBe(workshop);
    expect(checkReportFileNameFor("C:\\WORKSHOP\\1\\!ak_teb3.pack")).toBe(workshop);
  });
});

describe("visual asset check localization", () => {
  it("has every key the check UI uses in the English file", () => {
    const root = path.join(__dirname, "..", "src");
    const keys = new Set<string>(["checkVisualAssets"]);
    for (const file of ["components/VisualAssetCheckModal.tsx", "components/ModDropdownOptions.tsx"]) {
      for (const match of fs
        .readFileSync(path.join(root, file), "utf8")
        .matchAll(/localized\.(visualCheck\w+|checkVisualAssets)/g)) {
        keys.add(match[1]);
      }
    }
    expect([...keys].filter((key) => !(key in enTranslation))).toEqual([]);
    expect(keys.size).toBeGreaterThan(20);
  });
});

describe("dependency packs", () => {
  it("lists the other enabled packs in load order without this mod", async () => {
    const directory = makeDirectory();
    const files = ["b.pack", "a.pack", "me.pack"].map((name) => {
      const file = path.join(directory, name);
      fs.writeFileSync(file, "x");
      return file;
    });
    const result = dependencyPacksOf({ name: "me.pack", path: files[2] }, [
      { name: "b.pack", path: files[0] },
      { name: "a.pack", path: files[1] },
      { name: "me.pack", path: files[2] },
      { name: "gone.pack", path: path.join(directory, "gone.pack") },
      { name: "folder", path: directory },
    ]);
    expect(result).toEqual([files[1], files[0]]);
  });
});
