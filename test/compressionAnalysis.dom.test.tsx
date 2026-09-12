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
      topWins: [
        {
          fileName: "db\\example.foo",
          extension: ".foo",
          storedBytes: 8192,
          originalBytes: 8192,
          existingMethod: "NONE",
          status: "accepted",
          selectedCodec: "ZSTD",
          selectedRatioPercent: 50,
          selectedRatio: 0.5,
          savingsBytes: 4096,
        },
      ],
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
    expect(screen.getByText("10% saved")).toBeInTheDocument();
    expect(screen.getByText("(1,000 B)")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Compression type" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "ZSTD" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "4 KiB" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "50%" })).toBeInTheDocument();
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

  it("orders pack results by saved bytes", async () => {
    const result = makeResult();
    result.packs.push({
      ...result.packs[0],
      packPath: "/mods/larger-savings.pack",
      packName: "larger-savings.pack",
      bytesSaved: 2000,
      projectedSize: 8000,
      projectedSizeIncludingRigidModelV2: 8000,
    });
    result.packs[0].bytesSaved = 1000;
    result.overall.packCount = 2;
    result.overall.analyzedPackCount = 2;

    window.api = {
      startCompressionAnalysis: vi.fn(async () => ({ accepted: true, result })),
      cancelCompressionAnalysis: vi.fn(),
      onCompressionAnalysisProgress: vi.fn(() => () => undefined),
    } as unknown as NonNullable<Window["api"]>;

    render(
      <LocalizationContext.Provider value={{}}>
        <CompressionAnalysis isOpen onClose={vi.fn()} currentGame="wh3" enabledModPaths={["/mods/example.pack"]} />
      </LocalizationContext.Provider>,
    );

    const largerPack = await screen.findByText("larger-savings.pack");
    const smallerPack = screen.getByText("example.pack");
    expect(largerPack.compareDocumentPosition(smallerPack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows pack-writing controls only for modders and forwards the rigid-model choice", async () => {
    const compressPack = vi.fn(async () => ({
      success: true,
      backupPath: "/game/whmm_backups/example.2026.pack",
      compressedFileCount: 1,
    }));
    window.api = {
      startCompressionAnalysis: vi.fn(async () => ({ accepted: true, result: makeResult() })),
      compressPack,
      cancelCompressionAnalysis: vi.fn(),
      onCompressionAnalysisProgress: vi.fn(() => () => undefined),
    } as unknown as NonNullable<Window["api"]>;

    const { rerender } = render(
      <LocalizationContext.Provider value={{}}>
        <CompressionAnalysis isOpen onClose={vi.fn()} currentGame="wh3" enabledModPaths={["/mods/example.pack"]} />
      </LocalizationContext.Provider>,
    );
    await screen.findByText("Overall");
    expect(screen.queryByRole("button", { name: "Compress this pack" })).not.toBeInTheDocument();

    rerender(
      <LocalizationContext.Provider value={{}}>
        <CompressionAnalysis
          isOpen
          onClose={vi.fn()}
          currentGame="wh3"
          enabledModPaths={["/mods/example.pack"]}
          isFeaturesForModdersEnabled
        />
      </LocalizationContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compress this pack" }));
    await waitFor(() =>
      expect(compressPack).toHaveBeenCalledWith({ packPath: "/mods/example.pack", includeRigidModelV2: true }),
    );
  });

  it("hides the rigid-model checkbox while packs are being read", async () => {
    let resolveStart!: (value: { accepted: true; result: CompressionAnalysisResult }) => void;
    const start = vi.fn(
      () =>
        new Promise<{ accepted: true; result: CompressionAnalysisResult }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    window.api = {
      startCompressionAnalysis: start,
      cancelCompressionAnalysis: vi.fn(),
      onCompressionAnalysisProgress: vi.fn(() => () => undefined),
    } as unknown as NonNullable<Window["api"]>;

    render(
      <LocalizationContext.Provider value={{}}>
        <CompressionAnalysis
          isOpen
          onClose={vi.fn()}
          currentGame="wh3"
          enabledModPaths={["/mods/example.pack"]}
          isFeaturesForModdersEnabled
        />
      </LocalizationContext.Provider>,
    );

    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(screen.queryByRole("checkbox", { name: /rigid_model_v2/i })).not.toBeInTheDocument();

    resolveStart({ accepted: true, result: makeResult() });
    expect(await screen.findByRole("checkbox", { name: /rigid_model_v2/i })).toBeInTheDocument();
  });

  it("uses the persisted rigid-model setting and reports checkbox changes to its owner", async () => {
    const onRigidModelV2CompressionEnabledChange = vi.fn();
    window.api = {
      startCompressionAnalysis: vi.fn(async () => ({ accepted: true, result: makeResult() })),
      cancelCompressionAnalysis: vi.fn(),
      onCompressionAnalysisProgress: vi.fn(() => () => undefined),
    } as unknown as NonNullable<Window["api"]>;

    render(
      <LocalizationContext.Provider value={{}}>
        <CompressionAnalysis
          isOpen
          onClose={vi.fn()}
          currentGame="wh3"
          enabledModPaths={["/mods/example.pack"]}
          isFeaturesForModdersEnabled
          isRigidModelV2CompressionEnabled={false}
          onRigidModelV2CompressionEnabledChange={onRigidModelV2CompressionEnabledChange}
        />
      </LocalizationContext.Provider>,
    );

    await screen.findByText("Overall");
    const checkbox = screen.getByRole("checkbox", { name: /rigid_model_v2/i });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onRigidModelV2CompressionEnabledChange).toHaveBeenCalledWith(true);
  });

  it("counts rigid-model savings when the persisted option is enabled", async () => {
    const result = makeResult();
    const rigidWin = {
      fileName: "variantmeshes\\unit.rigid_model_v2",
      extension: ".rigid_model_v2",
      storedBytes: 1000,
      originalBytes: 1000,
      existingMethod: "NONE" as const,
      status: "accepted" as const,
      selectedCodec: "LZ4" as const,
      selectedRatioPercent: 50,
      selectedRatio: 0.5,
      savingsBytes: 500,
      isRigidModelV2: true,
    };
    result.packs[0].rigidModelV2Wins = [rigidWin];
    result.packs[0].projectedSizeIncludingRigidModelV2 = 8500;
    result.packs[0].wholePackPercentSavedIncludingRigidModelV2 = 15;
    result.overall.projectedSizeIncludingRigidModelV2 = 8500;
    result.overall.wholePackPercentSavedIncludingRigidModelV2 = 15;
    window.api = {
      startCompressionAnalysis: vi.fn(async () => ({ accepted: true, result })),
      cancelCompressionAnalysis: vi.fn(),
      onCompressionAnalysisProgress: vi.fn(() => () => undefined),
    } as unknown as NonNullable<Window["api"]>;

    const commonProps = {
      isOpen: true,
      onClose: vi.fn(),
      currentGame: "wh3" as const,
      enabledModPaths: ["/mods/example.pack"],
      isFeaturesForModdersEnabled: true,
    };
    const { rerender } = render(
      <LocalizationContext.Provider value={{}}>
        <CompressionAnalysis {...commonProps} isRigidModelV2CompressionEnabled />
      </LocalizationContext.Provider>,
    );

    await screen.findByText("Overall");
    expect(screen.getAllByText("Projected size: 8.3 KiB")).toHaveLength(2);
    expect(screen.getAllByText("Accepted: 2")).toHaveLength(2);
    expect(screen.getByText("15% saved")).toBeInTheDocument();

    const checkboxLabel = screen.getByText(/Compress eligible \.rigid_model_v2 files/);
    fireEvent.mouseEnter(checkboxLabel);
    expect(await screen.findByText(/Vanilla leaves 89\.72% of rigid models uncompressed/)).toBeInTheDocument();

    rerender(
      <LocalizationContext.Provider value={{}}>
        <CompressionAnalysis {...commonProps} isRigidModelV2CompressionEnabled={false} />
      </LocalizationContext.Provider>,
    );
    expect(screen.getAllByText("Projected size: 8.8 KiB")).toHaveLength(2);
    expect(screen.getAllByText("Accepted: 1")).toHaveLength(2);
    expect(screen.getByText("10% saved")).toBeInTheDocument();
  });
});
