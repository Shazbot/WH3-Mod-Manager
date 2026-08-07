import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import ModRows from "../src/components/ModRows";
import { SortingType } from "../src/utility/modRowSorting";

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
    await act(async () => fireEvent.click(loadOrderButton));

    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeInTheDocument());
    await waitFor(() => expect(scrollElement.scrollTop).toBe(420));
    expect(sourceRow.getBoundingClientRect().height).toBe(0);
    expect(sourceAnchor.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      scrollElement.getBoundingClientRect().top,
    );
    expect(sourceAnchor.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scrollElement.getBoundingClientRect().bottom,
    );

    await act(async () => fireEvent.click(loadOrderButton));

    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeNull());
    expect(scrollElement.scrollTop).toBe(100);

    await act(async () =>
      fireEvent.click(document.getElementById("load-order-icon-beta.pack") as HTMLButtonElement),
    );
    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeInTheDocument());
    await waitFor(() => expect(scrollElement.scrollTop).toBe(420));

    await act(async () =>
      fireEvent.click(document.getElementById("enabled-mod-placeholder-0") as HTMLButtonElement),
    );
    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeNull());
    expect(scrollElement.scrollTop).toBe(100);
  });
});
