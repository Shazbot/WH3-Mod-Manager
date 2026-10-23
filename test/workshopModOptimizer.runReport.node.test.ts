import { describe, expect, it } from "vitest";

import { buildOptimizerRunReport, totalOptimizerRun } from "../src/workshopModOptimizer/runReport";

const base = (name: string, sourceKind: "workshop" | "custom" | "data" = "workshop") => ({
  name,
  humanName: `Human ${name}`,
  path: `C:\\w\\${name}`,
  modDirectory: "C:\\w",
  sourceKind,
});

describe("optimizer run report", () => {
  it("classifies each mod and totals the savings", () => {
    const report = buildOptimizerRunReport({
      game: "wh3",
      mods: [base("a.pack"), base("b.pack"), base("c.pack"), base("d.pack"), base("e.pack", "data"), base("f.pack")],
      dataPackNames: new Set(),
      stagedDirectories: new Set(),
      comparableDirectory: (directory) => directory,
      recordFor: (path) => (path.endsWith("f.pack") ? { skipReason: "cached-failure" } : undefined),
      outcomes: [
        {
          name: "a.pack",
          status: "optimized",
          summary: {
            sourceBytes: 1000,
            outputBytes: 400,
            textureBytesSaved: 500,
            drawCallsEliminated: 12,
            mergedModelsGenerated: 2,
          },
        },
        {
          name: "b.pack",
          status: "restored",
          summary: {
            sourceBytes: 100,
            outputBytes: 100,
            textureBytesSaved: 0,
            drawCallsEliminated: 0,
            mergedModelsGenerated: 0,
          },
        },
        { name: "c.pack", status: "failed", message: "boom" },
      ],
      userSkipped: false,
    });
    expect(report.mods.map((mod) => [mod.packName, mod.status, mod.skipReason])).toEqual([
      ["a.pack", "optimized", undefined],
      ["b.pack", "alreadyOptimal", undefined],
      ["c.pack", "failed", undefined],
      ["d.pack", "skipped", "noVisualAssets"],
      ["e.pack", "skipped", "dataFolder"],
      ["f.pack", "skipped", "previouslyFailed"],
    ]);
    expect(report.mods[0].name).toBe("Human a.pack");
    expect(totalOptimizerRun(report)).toMatchObject({
      optimized: 1,
      alreadyOptimal: 1,
      failed: 1,
      skipped: 3,
      sourceBytes: 1100,
      outputBytes: 500,
      savedBytes: 600,
      drawCallsEliminated: 12,
    });
  });
});
