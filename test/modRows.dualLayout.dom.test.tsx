import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import ModRows from "../src/components/ModRows";
import { SortingType } from "../src/utility/modRowSorting";

vi.mock("../src/components/ModDropdown", () => ({
  default: () => null,
}));

// react-virtualized renders nothing at the zero width jsdom reports, so only AutoSizer is replaced; the
// real List, CellMeasurer and cache still run.
vi.mock("react-virtualized", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-virtualized")>();
  return {
    ...actual,
    AutoSizer: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
      children({ width: 800, height: 600 }),
  };
});

const createMod = (name: string, isEnabled: boolean, loadOrder?: number): Mod => ({
  name: `${name}.pack`,
  humanName: `${name} human name`,
  path: `/mods/${name}.pack`,
  imgPath: "",
  workshopId: name,
  isEnabled,
  modDirectory: "/mods",
  isInData: true,
  loadOrder,
  author: `${name} author`,
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  tags: [],
  reqModIdToName: [],
});

const renderDualLayout = (mods: Mod[], extraState: Partial<AppState> = {}) => {
  const testStore = configureStore({
    reducer: { app: appReducer },
    preloadedState: {
      app: {
        ...initialState,
        currentTab: "mods" as MainWindowTab,
        isDualModListLayoutEnabled: true,
        areThumbnailsEnabled: false,
        modRowsSortingType: SortingType.Ordered,
        currentPreset: { name: "", mods },
        ...extraState,
      },
    },
  });
  const scrollRef = React.createRef<HTMLDivElement>();

  const utils = render(
    <Provider store={testStore}>
      <div ref={scrollRef} id="mod-rows-scroll">
        <ModRows scrollElement={scrollRef} />
      </div>
    </Provider>,
  );

  return { ...utils, testStore };
};

const getPanes = () => ({
  left: document.getElementById("disabledModsPaneScroll") as HTMLElement,
  right: document.getElementById("enabledModsPaneScroll") as HTMLElement,
});

describe("dual mod list layout", () => {
  beforeEach(() => {
    window.api = {
      ...window.api,
      getCustomizableMods: vi.fn(),
    } as NonNullable<Window["api"]>;
  });

  it("splits the mods into a disabled pane and an enabled pane", async () => {
    renderDualLayout([createMod("alpha", false), createMod("beta", true, 0), createMod("gamma", false)]);

    await waitFor(() => expect(document.getElementById("disabledModsPaneScroll")).toBeInTheDocument());
    const { left, right } = getPanes();

    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());
    expect(within(left).queryByText("gamma human name")).toBeInTheDocument();
    expect(within(left).queryByText("beta human name")).toBeNull();

    expect(within(right).queryByText("beta human name")).toBeInTheDocument();
    expect(within(right).queryByText("alpha human name")).toBeNull();

    // Each pane scrolls itself, so both carry their own sticky header, and only the enabled one has the
    // extra configuration column.
    const leftHeaderCells = left.querySelectorAll(".mod-row-header-pane").length;
    expect(leftHeaderCells).toBe(3);
    expect(right.querySelectorAll(".mod-row-header-pane").length).toBe(leftHeaderCells + 1);
    // The enabled checkbox column is gone; clicking the row is what toggles a mod.
    expect(document.getElementById("enabledHeader")).toBeNull();
    expect(document.getElementById("sortHeader")).toBeNull();
  });

  it("stacks the human name, author and pack name in one cell", async () => {
    renderDualLayout([createMod("alpha", false)]);

    const { left } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());
    expect(within(left).queryByText("alpha author")).toBeInTheDocument();
    expect(within(left).queryByText("alpha")).toBeInTheDocument();
  });

  it("moves a mod to the other pane when its row is clicked", async () => {
    const { testStore } = renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)]);

    const { left, right } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());

    await act(async () => fireEvent.click(within(left).getByText("alpha human name")));

    expect(testStore.getState().app.currentPreset.mods.find((mod) => mod.workshopId === "alpha")?.isEnabled).toBe(true);
    await waitFor(() => expect(within(right).queryByText("alpha human name")).toBeInTheDocument());
    expect(within(left).queryByText("alpha human name")).toBeNull();
  });

  it("only shows the configuration column on the enabled pane", async () => {
    renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)], {
      customizableMods: {
        "/mods/alpha.pack": ["db\\some_table\\data"],
        "/mods/beta.pack": ["db\\some_table\\data"],
      },
    });

    const { left, right } = getPanes();
    await waitFor(() => expect(within(right).queryByText("beta human name")).toBeInTheDocument());

    expect(right.querySelectorAll("svg.bigger-gear-icon").length).toBe(1);
    expect(left.querySelectorAll("svg.bigger-gear-icon").length).toBe(0);
  });

  it("lets the enabled pane reorder, and leaves the disabled pane alone", async () => {
    renderDualLayout([createMod("alpha", false), createMod("beta", true, 0), createMod("gamma", true, 1)]);

    const { left, right } = getPanes();
    await waitFor(() => expect(within(right).queryByText("beta human name")).toBeInTheDocument());

    // Disabled mods have no order to place, so their rows carry no reorder control at all.
    expect(document.getElementById("load-order-icon-alpha.pack")).toBeNull();

    const reorderButton = document.getElementById("load-order-icon-beta.pack") as HTMLButtonElement;
    expect(reorderButton).toBeInTheDocument();

    const betaRow = right.querySelector<HTMLElement>("[id='beta.pack']") as HTMLElement;
    fireEvent.mouseEnter(betaRow);
    expect(reorderButton).not.toHaveClass("hidden");

    await act(async () => fireEvent.click(reorderButton));
    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeInTheDocument());

    // Placement mode runs inside the enabled pane only.
    expect(within(right).queryByText("gamma human name")).toBeInTheDocument();
    expect(left.querySelector("[id^='enabled-mod-placeholder-']")).toBeNull();

    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeNull());
  });
});
