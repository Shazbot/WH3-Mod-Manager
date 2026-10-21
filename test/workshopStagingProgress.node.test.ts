import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { HostProgressTracker } from "../src/workshopModOptimizer/hostRunner";
import {
  type WorkshopStagingOptimizer,
  type WorkshopStagingProgress,
  stageWorkshopMods,
} from "../src/utility/workshopModStaging";
import { makeWorkshopStagingProgressEvent } from "../src/utility/workshopStagingProgressEvent";
import { StagingProgressModel, estimateStagingWeight } from "../src/utility/workshopStagingProgressModel";

/**
 * `optimizerHostStdout.jsonl` is the real stdout of `WH3AssetHost.exe optimize` on `!ak_teb3`
 * (112 s, 412 lines), each line with the second it arrived at. Replaying it through the real
 * mapping (tracker -> staging -> progress event) gives the percent the card shows.
 */
const hostLines = fs
  .readFileSync(path.join(__dirname, "fixtures/optimizerHostStdout.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { t: number; line: string })
  .map((row) => ({ t: row.t, message: JSON.parse(row.line) as Record<string, unknown> }))
  .filter((row) => row.message.type === "progress") as {
  t: number;
  message: { stage: string; current: number; total: number };
}[];

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
const tempDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-progress-"));
  directories.push(directory);
  return directory;
};

describe("host progress tracker", () => {
  it("never goes backwards on the real host output and covers every stage", () => {
    const tracker = new HostProgressTracker();
    let previous = 0;
    for (const { message } of hostLines) {
      const value = tracker.update(message.stage, message.current, message.total);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(previous).toBeGreaterThan(0.9);
    expect(previous).toBeLessThanOrEqual(1);
  });

  it("holds the last value for an unknown stage and when a stage comes back out of order", () => {
    const tracker = new HostProgressTracker();
    const afterCrossRigid = tracker.update("Analyzing cross-rigid merges", 100, 172);
    expect(tracker.update("A stage added by a newer host", 3, 10)).toBe(afterCrossRigid);
    expect(tracker.update("Auditing LODs", 5, 172)).toBe(afterCrossRigid);
    expect(tracker.update("Analyzing cross-rigid merges", 40, 172)).toBe(afterCrossRigid);
  });

  it("keeps current/total inside the stage's band and restarts of current/total do not pull it back", () => {
    const tracker = new HostProgressTracker();
    const start = tracker.update("Serializing modified rigids", 0, 2445);
    const middle = tracker.update("Serializing modified rigids", 1200, 2445);
    const next = tracker.update("Serializing modified WSModels", 165, 2445);
    expect(middle).toBeGreaterThan(start);
    expect(next).toBeGreaterThanOrEqual(middle);
    expect(tracker.update("Serializing modified WSModels", 0, 0)).toBe(next);
  });
});

describe("staging progress model", () => {
  it("spreads a mod over its phases without going back and counts a cache restore as instant", () => {
    const optimize = estimateStagingWeight("optimize", 824 * 1024 * 1024);
    const restore = estimateStagingWeight("restore", 824 * 1024 * 1024);
    expect(restore).toBeLessThan(optimize / 20);

    const model = new StagingProgressModel([
      { name: "big.pack", kind: "optimize", weight: optimize },
      { name: "cached.pack", kind: "restore", weight: restore },
    ]);
    const values = [
      model.update("big.pack", "optimizing", 0.5),
      model.update("big.pack", "optimizing", 1),
      model.update("big.pack", "compressing", 0),
      model.update("big.pack", "compressing", 1),
      model.update("big.pack", "copying", 0),
      model.update("big.pack", "copying", 1),
      model.complete("big.pack"),
      model.update("cached.pack", "copying", 0.5),
      model.complete("cached.pack"),
    ];
    for (let index = 1; index < values.length; index++) expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
    expect(values[6]).toBeGreaterThan(0.95);
    expect(values.at(-1)).toBe(1);
  });

  it("continues from where it was when optimizing falls back to a plain copy", () => {
    const model = new StagingProgressModel([{ name: "a.pack", kind: "optimize", weight: 10 }]);
    const before = model.update("a.pack", "optimizing", 0.5);
    model.changeKind("a.pack", "copy-compress");
    const copying = model.update("a.pack", "copying", 1);
    const compressing = model.update("a.pack", "compressing", 0.5);
    expect(copying).toBeGreaterThanOrEqual(before);
    expect(compressing).toBeGreaterThanOrEqual(copying);
    expect(model.update("a.pack", "compressing", 1)).toBeLessThanOrEqual(1);
  });
});

describe("a whole launch replayed from the captured host output", () => {
  const replay = async (cached: boolean) => {
    const sourceDirectory = tempDirectory();
    const gameFolder = tempDirectory();
    const write = (name: string, size: number) => {
      fs.writeFileSync(path.join(sourceDirectory, name), Buffer.alloc(size, 1));
      return { name, path: path.join(sourceDirectory, name), isEnabled: true };
    };
    const big = write("!ak_teb3.pack", 4 * 1024 * 1024);
    const small = write("!b_mixer.pack", 256 * 1024);
    // The weights come from the real sizes, so the test pretends the big mod is 824 MB.
    const optimizer: WorkshopStagingOptimizer = {
      plan: async (mod) => (mod.name === big.name ? { key: "k", cached } : undefined),
      produce: async (mod, _plan, context) => {
        if (cached) {
          context.onProgress({ stage: "Restoring", fraction: 1, fromCache: true });
        } else {
          const tracker = new HostProgressTracker();
          for (const { message } of hostLines) {
            context.onProgress({
              stage: message.stage,
              fraction: tracker.update(message.stage, message.current, message.total),
            });
          }
          context.onProgress({ stage: "Compressing", fraction: tracker.finish() });
        }
        const output = path.join(tempDirectory(), mod.name);
        fs.writeFileSync(output, "optimized");
        await context.compress(output);
        return { status: "ready", packPath: output, fromCache: cached, warnings: [] };
      },
    };
    const events: { percent: number | undefined; phase: string; what: string }[] = [];
    await stageWorkshopMods({
      gameFolder,
      mode: "copy",
      workshopMods: [big, small],
      compressMods: true,
      optimizer,
      optimizerProfile: "p",
      getFreeBytes: async () => 1e12,
      compressionRunner: async (packPath, options) => {
        for (let index = 0; index <= 10; index++) {
          options.onProgress?.({ fileIndex: index * 390, fileCount: 3900, fileName: "x", message: "x" } as never);
        }
        return { status: "compressed", success: true, packPath, compressedFileCount: 1 };
      },
      onProgress: (progress: WorkshopStagingProgress) => {
        const event = makeWorkshopStagingProgressEvent("run", progress, "running");
        events.push({
          percent: event.percent,
          phase: progress.phase,
          what: `${progress.modName ?? ""} ${progress.message ?? ""}`,
        });
      },
    });
    if (process.env.DUMP_PROGRESS) fs.writeFileSync(process.env.DUMP_PROGRESS, JSON.stringify(events));
    return events.filter((event) => event.percent !== undefined) as { percent: number; phase: string; what: string }[];
  };

  it("never goes backwards and moves in small steps while optimizing", async () => {
    const events = await replay(false);
    let previous = 0;
    let largestStep = 0;
    let largestAt = "";
    for (const event of events) {
      expect(event.percent, `${event.phase}: ${event.what}`).toBeGreaterThanOrEqual(previous);
      if (event.percent - previous > largestStep) {
        largestStep = event.percent - previous;
        largestAt = `${event.phase}: ${event.what}`;
      }
      previous = event.percent;
    }
    // The only large steps are the hand-offs between stages whose share is big (cross-rigid
    // analysis is 39 % of the host run).
    expect(largestStep, largestAt).toBeLessThanOrEqual(15);
    expect(previous).toBeLessThanOrEqual(100);
  });

  it("counts a restored mod as nearly instant", async () => {
    const events = await replay(true);
    let previous = 0;
    for (const event of events) {
      expect(event.percent).toBeGreaterThanOrEqual(previous);
      previous = event.percent;
    }
    expect(events.filter((event) => event.percent >= 1).length).toBeGreaterThan(0);
  });
});
