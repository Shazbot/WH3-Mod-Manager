import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CompressionAnalysis from "../src/components/CompressionAnalysis";
import LocalizationContext from "../src/localizationContext";
import type { CompressionAnalysisResult, CompressionAnalysisProgress } from "../src/compressionAnalysis";

const makeResult = (): CompressionAnalysisResult => ({
  status: "completed",
  packs: [
    {
      packPath: "/mods/example.pack",
      packName: "example.pack",
      currentSize: 10000,
      projectedSize: 9000,
      bytesSaved: 1000,
      wholePackPercentSaved: 10,
      projectedSizeIncludingRigidModelV2: 9000,
      wholePackPercentSavedIncludingRigidModelV2: 10,
      fileCount: 1,
      testedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      acceptedCount: 1,
      sampledRejectedCount: 0,
      existing: {
        NONE: { count: 1, storedBytes: 10000 },
        LZ4: { count: 0, storedBytes: 0 },
        ZSTD: { count: 0, storedBytes: 0 },
        UNKNOWN: { count: 0, storedBytes: 0 },
      },
      existingCounts: { NONE: 1, LZ4: 0, ZSTD: 0, UNKNOWN: 0 },
      existingStoredBytes: { NONE: 10000, LZ4: 0, ZSTD: 0, UNKNOWN: 0 },
      topWins: [],
      rigidModelV2Wins: [],
      fileResults: [],
      warnings: [],
      errors: [],
      success: true,
    },
  ],
  overall: {
    currentSize: 10000,
    projectedSize: 9000,
    bytesSaved: 1000,
    wholePackPercentSaved: 10,
    projectedSizeIncludingRigidModelV2: 9000,
    wholePackPercentSavedIncludingRigidModelV2: 10,
    packCount: 1,
    analyzedPackCount: 1,
    testedCount: 1,
    skippedCount: 0,
    errorCount: 0,
    acceptedCount: 1,
    sampledRejectedCount: 0,
    existing: {
      NONE: { count: 1, storedBytes: 10000 },
      LZ4: { count: 0, storedBytes: 0 },
      ZSTD: { count: 0, storedBytes: 0 },
      UNKNOWN: { count: 0, storedBytes: 0 },
    },
    existingCounts: { NONE: 1, LZ4: 0, ZSTD: 0, UNKNOWN: 0 },
    existingStoredBytes: { NONE: 10000, LZ4: 0, ZSTD: 0, UNKNOWN: 0 },
  },
});

describe("CompressionAnalysis", () => {
  afterEach(() => {
    window.api = undefined;
  });

  it("starts for enabled WH3 packs and renders overall/per-pack results", async () => {
    let progressCallback: ((event: unknown, progress: CompressionAnalysisProgress) => void) | undefined;
    const start = vi.fn(async () => ({ accepted: true, result: makeResult() }));
    window.api = {
      startCompressionAnalysis: start,
      cancelCompressionAnalysis: vi.fn(),
      onCompressionAnalysisProgress: vi.fn((callback) => {
        progressCallback = callback;
        return () => undefined;
      }),
    } as unknown as NonNullable<Window["api"]>;

    render(
      <LocalizationContext.Provider value={{}}>
        <CompressionAnalysis
          isOpen
          onClose={vi.fn()}
          currentGame="wh3"
          enabledModPaths={["/mods/example.pack", "/mods/example.pack"]}
        />
      </LocalizationContext.Provider>,
    );

    await waitFor(() => expect(start).toHaveBeenCalledWith({ packPaths: ["/mods/example.pack"] }));
    expect(await screen.findByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("example.pack")).toBeInTheDocument();
    progressCallback?.({}, { phase: "file", packIndex: 0, packCount: 1, fileIndex: 0, fileCount: 1 });
  });

  it("cancels a running job from the panel", async () => {
    let resolveStart!: (value: { accepted: true; result: CompressionAnalysisResult }) => void;
    const start = vi.fn(
      () =>
        new Promise<{ accepted: true; result: CompressionAnalysisResult }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const cancel = vi.fn();
    window.api = {
      startCompressionAnalysis: start,
      cancelCompressionAnalysis: cancel,
      onCompressionAnalysisProgress: vi.fn(() => () => undefined),
    } as unknown as NonNullable<Window["api"]>;
    render(
      <LocalizationContext.Provider value={{}}>
        <CompressionAnalysis isOpen onClose={vi.fn()} currentGame="wh3" enabledModPaths={["/mods/example.pack"]} />
      </LocalizationContext.Provider>,
    );
    await waitFor(() => expect(start).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    resolveStart({ accepted: true, result: makeResult() });
  });
});
