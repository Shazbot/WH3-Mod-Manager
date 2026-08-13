import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CellMeasurerCache } from "react-virtualized";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import ModRows from "../src/components/ModRows";
import { SortingType } from "../src/utility/modRowSorting";

vi.mock("../src/components/ModDropdown", () => ({
  default: () => null,
}));

const createMod = (name: string, loadOrder: number): Mod => ({
  name,
  humanName: name,
  path: `/mods/${name}`,
  imgPath: "",
  workshopId: name,
  isEnabled: true,
  modDirectory: "/mods",
  isInData: true,
  loadOrder,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  tags: [],
  reqModIdToName: [],
});

const rectAt = (top: number, height = 32) =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: 500,
    width: 500,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe("ModRows load-order scroll anchoring", () => {
  it("keeps the source row anchored on entry and restores the original scroll on exit", async () => {
    window.api = {
      ...window.api,
      getCustomizableMods: vi.fn(),
    } as NonNullable<Window["api"]>;
    const mods = [createMod("alpha.pack", 0), createMod("beta.pack", 1), createMod("gamma.pack", 2)];
    const testStore = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          currentTab: "enabledMods" as MainWindowTab,
          modRowsSortingType: SortingType.Ordered,
          currentPreset: { name: "", mods },
        },
      },
    });
    const scrollRef = React.createRef<HTMLDivElement>();

    const { container } = render(
      <Provider store={testStore}>
        <div ref={scrollRef} id="mod-rows-scroll">
          <ModRows scrollElement={scrollRef} />
        </div>
      </Provider>,
    );

    const scrollElement = scrollRef.current as HTMLDivElement;
    scrollElement.scrollTop = 100;
    scrollElement.getBoundingClientRect = vi.fn(() => rectAt(50, 500));

    const sourceRow = container.querySelector<HTMLElement>("[id='beta.pack']") as HTMLElement;
    sourceRow.getBoundingClientRect = vi.fn(() => rectAt(0, 0));
    const sourceAnchor = document.getElementById("load-order-row-anchor-beta.pack") as HTMLElement;
    sourceAnchor.getBoundingClientRect = vi.fn(() => {
      const contentTop = document.getElementById("enabled-mod-placeholder-0") ? 850 : 530;
      return rectAt(50 + contentTop - scrollElement.scrollTop);
    });

    const loadOrderButton = document.getElementById("load-order-icon-beta.pack") as HTMLButtonElement;
    const otherRow = container.querySelector<HTMLElement>("[id='gamma.pack']") as HTMLElement;
    const otherLoadOrderButton = document.getElementById("load-order-icon-gamma.pack") as HTMLButtonElement;
    fireEvent.mouseEnter(otherRow);
    expect(otherLoadOrderButton).not.toHaveClass("hidden");

    await act(async () => fireEvent.click(loadOrderButton));

    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeInTheDocument());
    await waitFor(() => expect(scrollElement.scrollTop).toBe(420));
    expect(otherLoadOrderButton).toHaveClass("hidden");
    expect(otherRow).not.toHaveClass("row-hover-highlight");
    expect(document.getElementById("enabled-mod-placeholder-2")).toHaveClass(
      "hover:bg-blue-700/40",
      "hover:opacity-100",
    );
    fireEvent.mouseEnter(otherRow);
    expect(otherLoadOrderButton).toHaveClass("hidden");
    expect(sourceRow.getBoundingClientRect().height).toBe(0);
    expect(sourceAnchor.getBoundingClientRect().top).toBeGreaterThanOrEqual(scrollElement.getBoundingClientRect().top);
    expect(sourceAnchor.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scrollElement.getBoundingClientRect().bottom,
    );

    await act(async () => fireEvent.click(loadOrderButton));

    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeNull());
    expect(scrollElement.scrollTop).toBe(100);
    expect(otherLoadOrderButton).toHaveClass("hidden");
    expect(otherRow).toHaveClass("row-hover-highlight");

    await act(async () => fireEvent.click(document.getElementById("load-order-icon-beta.pack") as HTMLButtonElement));
    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeInTheDocument());
    await waitFor(() => expect(scrollElement.scrollTop).toBe(420));
    fireEvent.mouseEnter(otherRow);
    expect(otherLoadOrderButton).toHaveClass("hidden");

    await act(async () => fireEvent.click(document.getElementById("enabled-mod-placeholder-3") as HTMLButtonElement));
    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeNull());
    expect(container.querySelector<HTMLElement>("[id='beta.pack']")).toHaveClass("recently-reordered-row");
    expect(container.querySelector<HTMLElement>("[id='gamma.pack']")).not.toHaveClass("recently-reordered-row");
    expect(scrollElement.scrollTop).toBe(100);
    expect(otherLoadOrderButton).toHaveClass("hidden");
  });

  it("does not invalidate measured row heights when opening the context menu", async () => {
    window.api = {
      ...window.api,
      getCustomizableMods: vi.fn(),
    } as NonNullable<Window["api"]>;
    const clearAllSpy = vi.spyOn(CellMeasurerCache.prototype, "clearAll");
    const testStore = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          currentTab: "enabledMods" as MainWindowTab,
          currentPreset: {
            name: "",
            mods: [createMod("long-name.pack", 0)],
          },
        },
      },
    });
    const scrollRef = React.createRef<HTMLDivElement>();

    const { getByText } = render(
      <Provider store={testStore}>
        <div ref={scrollRef} id="mod-rows-scroll">
          <ModRows scrollElement={scrollRef} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(clearAllSpy).toHaveBeenCalled());
    const callsBeforeContextMenu = clearAllSpy.mock.calls.length;

    await act(async () => fireEvent.contextMenu(getByText("long-name")));
    await waitFor(() => expect(document.getElementById("modDropdownOverlay")).not.toHaveClass("hidden"));
    expect(clearAllSpy).toHaveBeenCalledTimes(callsBeforeContextMenu);
  });
});
