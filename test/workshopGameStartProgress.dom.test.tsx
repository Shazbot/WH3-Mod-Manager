import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkshopGameStartProgressCard,
  type WorkshopGameStartProgress,
} from "../src/components/WorkshopGameStartProgress";

describe("Workshop game-start progress", () => {
  const originalApi = window.api;
  let listener: ((event: Electron.IpcRendererEvent, progress: WorkshopGameStartProgress) => void) | undefined;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listener = undefined;
    unsubscribe = vi.fn();
    window.api = {
      ...originalApi,
      onWorkshopModStagingProgress: vi.fn((callback) => {
        listener = callback;
        return unsubscribe;
      }),
      cancelWorkshopModStaging: vi.fn(),
    } as unknown as NonNullable<Window["api"]>;
  });

  afterEach(() => {
    vi.useRealTimers();
    window.api = originalApi;
  });

  const send = (progress: WorkshopGameStartProgress) => {
    act(() => listener?.({} as Electron.IpcRendererEvent, progress));
  };

  it("shows the current stage, mod, and determinate progress", () => {
    render(<WorkshopGameStartProgressCard />);

    send({
      runId: "launch-1",
      status: "running",
      stage: "copying",
      percent: 25,
      currentMod: "example.pack",
      completedMods: 1,
      totalMods: 4,
      bytesCopied: 512,
      totalBytes: 1024,
    });

    expect(screen.getByRole("dialog")).toHaveTextContent("Preparing Workshop mods for game start");
    expect(screen.getByRole("status")).toHaveTextContent("Copying Workshop mods");
    expect(screen.getByRole("status")).toHaveTextContent("example.pack");
    expect(screen.getByRole("status")).toHaveTextContent("512 B / 1 KiB");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("requests cancellation once and tells the user that cleanup is in progress", () => {
    render(<WorkshopGameStartProgressCard />);
    send({ runId: "launch-1", status: "running", stage: "copying", percent: 50 });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const canceling = screen.getByRole("button", { name: /Canceling Workshop mod staging/ });
    fireEvent.click(canceling);

    expect(window.api?.cancelWorkshopModStaging).toHaveBeenCalledOnce();
    expect(window.api?.cancelWorkshopModStaging).toHaveBeenCalledWith("launch-1");
    expect(screen.getByRole("status")).toHaveTextContent("Canceling Workshop mod staging");
    expect(canceling).toBeDisabled();
  });

  it("uses the modal close button to request cancellation instead of hiding an active run", () => {
    render(<WorkshopGameStartProgressCard />);
    send({ runId: "launch-1", status: "running", stage: "copying", percent: 20 });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(window.api?.cancelWorkshopModStaging).toHaveBeenCalledWith("launch-1");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Canceling Workshop mod staging");
  });

  it("uses Escape to request cancellation instead of hiding an active run", () => {
    render(<WorkshopGameStartProgressCard />);
    send({ runId: "launch-1", status: "running", stage: "copying", percent: 20 });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(window.api?.cancelWorkshopModStaging).toHaveBeenCalledWith("launch-1");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Canceling Workshop mod staging");
  });

  it("does not let a late report from an older launch replace a newer launch", () => {
    render(<WorkshopGameStartProgressCard />);

    send({ runId: "launch-1", status: "running", stage: "copying", percent: 25, currentMod: "old.pack" });
    send({ runId: "launch-2", status: "running", stage: "compressing", percent: 60, currentMod: "new.pack" });
    send({ runId: "launch-1", status: "cancelled", stage: "cleaning", percent: 0 });

    expect(screen.getByRole("status")).toHaveTextContent("Compressing Workshop mods");
    expect(screen.getByRole("status")).toHaveTextContent("new.pack");
    expect(screen.getByRole("status")).not.toHaveTextContent("canceled");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  });

  it("auto-dismisses successful and canceled terminal reports", () => {
    vi.useFakeTimers();
    render(<WorkshopGameStartProgressCard />);

    send({ runId: "launch-1", status: "complete", stage: "complete", percent: 100 });
    expect(screen.getByRole("status")).toHaveTextContent("Workshop mods ready");
    act(() => vi.advanceTimersByTime(1799));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    send({ runId: "launch-2", status: "cancelled", stage: "cleaning", percent: 0 });
    expect(screen.getByRole("status")).toHaveTextContent("Workshop mod staging canceled");
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ends the blocking modal when staging is complete and launch preparation begins", () => {
    vi.useFakeTimers();
    render(<WorkshopGameStartProgressCard />);

    send({ runId: "launch-1", status: "running", stage: "launching", percent: 100 });

    expect(screen.getByRole("dialog")).toHaveTextContent("Workshop mods ready");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes its IPC listener when unmounted", () => {
    const view = render(<WorkshopGameStartProgressCard />);
    view.unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
