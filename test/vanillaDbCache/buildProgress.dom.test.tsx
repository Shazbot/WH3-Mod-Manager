import React from "react";

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VanillaDbCacheBuildProgressCard } from "../../src/components/VanillaDbCacheBuildProgress";

describe("vanilla DB cache build progress", () => {
  const originalApi = window.api;
  let listener:
    | ((event: Electron.IpcRendererEvent, progress: VanillaDbCacheBuildProgress) => void)
    | undefined;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    listener = undefined;
    unsubscribe.mockClear();
    window.api = {
      ...originalApi,
      onVanillaDbCacheBuildProgress: vi.fn((callback) => {
        listener = callback;
        return unsubscribe;
      }),
    } as NonNullable<Window["api"]>;
  });

  afterEach(() => {
    window.api = originalApi;
  });

  const send = (progress: VanillaDbCacheBuildProgress) => {
    act(() => listener?.({} as Electron.IpcRendererEvent, progress));
  };

  it("shows the current build stage and weighted percentage", () => {
    render(<VanillaDbCacheBuildProgressCard />);

    send({
      buildId: "wh3-1",
      game: "wh3",
      phase: "parsing",
      status: "running",
      percent: 20,
    });

    expect(screen.getByRole("status")).toHaveTextContent("Parsing vanilla database tables");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
  });

  it("does not let an invalidated build overwrite a newer build", () => {
    render(<VanillaDbCacheBuildProgressCard />);

    send({
      buildId: "wh3-1",
      game: "wh3",
      phase: "parsing",
      status: "running",
      percent: 20,
    });
    send({
      buildId: "wh2-2",
      game: "wh2",
      phase: "indexing",
      status: "running",
      percent: 5,
    });
    send({
      buildId: "wh3-1",
      game: "wh3",
      phase: "complete",
      status: "cancelled",
      percent: 0,
    });

    expect(screen.getByRole("status")).toHaveTextContent("Reading the database pack index");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
  });

  it("removes its IPC listener when unmounted", () => {
    const view = render(<VanillaDbCacheBuildProgressCard />);

    view.unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
