import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import ModRows from "../src/components/ModRows";
import LocalizationContext from "../src/localizationContext";
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

/** Only the keys these tests read back; the app fills this from the translation catalogue. */
const localization = {
  order: "Order",
  name: "Name",
  thumbnail: "Thumbnail",
  lastUpdated: "Last Updated",
};

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
      <LocalizationContext.Provider value={localization}>
        <div ref={scrollRef} id="mod-rows-scroll">
          <ModRows scrollElement={scrollRef} />
        </div>
      </LocalizationContext.Provider>
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

  it("blanks the position index for disabled mods but keeps a pinned load order", async () => {
    renderDualLayout([createMod("alpha", false), createMod("delta", false, 6), createMod("beta", true, 0)]);

    const { left, right } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());

    // The index a disabled mod happens to sit at says nothing about the order the game will load in.
    const alphaRow = left.querySelector<HTMLElement>("[id='alpha.pack']") as HTMLElement;
    expect(alphaRow.textContent).not.toMatch(/\d/);

    // A pin survives being disabled and is honoured on re-enable, so it is still worth showing.
    expect(within(left).getByText("7")).toBeInTheDocument();
    // The enabled pane numbers every row, pinned or not.
    expect(within(right).getByText("1")).toBeInTheDocument();
  });

  it("names the compact columns with icons, and leaves the single list on text", async () => {
    renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)], { areThumbnailsEnabled: true });

    const { left, right } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());

    // order, thumbnail, name, last updated - and the gear on the enabled pane.
    const leftHeaders = Array.from(left.querySelectorAll<HTMLElement>(".mod-row-header-pane"));
    expect(leftHeaders).toHaveLength(4);
    expect(leftHeaders.every((header) => header.querySelector("svg"))).toBe(true);
    expect(right.querySelectorAll(".mod-row-header-pane")).toHaveLength(5);

    // Every compact header centres its icon rather than hugging the left edge.
    expect(leftHeaders.every((header) => header.classList.contains("justify-center"))).toBe(true);

    // The wording is gone from view but still reaches screen readers and the hover title.
    const orderHeader = leftHeaders[0];
    expect(within(orderHeader).getByText(localization.order)).toHaveClass("sr-only");
    const orderLabel = orderHeader.querySelector("[title]") as HTMLElement;
    expect(orderLabel).toHaveAttribute("title", localization.order);

    // Ordered is the active sort here, so its icon is tinted; font weight would do nothing to an SVG.
    expect(orderLabel).toHaveClass("text-blue-400");
    const nameLabel = leftHeaders[2].querySelector("[title]") as HTMLElement;
    expect(nameLabel).toHaveClass("opacity-60");
    expect(nameLabel).not.toHaveClass("text-blue-400");

    // The single list keeps its worded headers.
    cleanup();
    renderDualLayout([createMod("alpha", false)], { isDualModListLayoutEnabled: false });
    await waitFor(() => expect(document.getElementById("sortHeader")).toBeInTheDocument());
    const singleOrderHeader = document.getElementById("sortHeader") as HTMLElement;
    expect(within(singleOrderHeader).getByText(localization.order)).not.toHaveClass("sr-only");
  });

  it("numbers the disabled list when the option is turned on", async () => {
    renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)], {
      isShowingDisabledModsLoadOrder: true,
    });

    const { left } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());

    const alphaRow = left.querySelector<HTMLElement>("[id='alpha.pack']") as HTMLElement;
    expect(alphaRow.textContent).toMatch(/\d/);
  });

  it("promotes the pack name when a mod has no title or author", async () => {
    // What a data mod with no workshop counterpart looks like: nothing but a pack name.
    const bare = { ...createMod("local_only", false), humanName: "", author: "" };
    renderDualLayout([bare, createMod("alpha", false)]);

    const { left } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());

    // The pack name takes the primary line instead of sitting small under a blank one.
    const bareRow = left.querySelector<HTMLElement>("[id='local_only.pack']") as HTMLElement;
    const bareLines = Array.from(bareRow.querySelectorAll<HTMLElement>("label > span"));
    expect(bareLines).toHaveLength(1);
    expect(bareLines[0]).toHaveClass("mod-row-title");
    expect(bareLines[0]).not.toHaveClass("mod-row-meta");
    expect(bareLines[0].textContent).toContain("local_only");

    // A mod that has both keeps the title on top and the pack name small underneath.
    const fullRow = left.querySelector<HTMLElement>("[id='alpha.pack']") as HTMLElement;
    const fullLines = Array.from(fullRow.querySelectorAll<HTMLElement>("label > span"));
    expect(fullLines).toHaveLength(3);
    expect(fullLines[0].textContent).toBe("alpha human name");
    expect(fullLines[2]).toHaveClass("mod-row-meta");
  });

  it("puts the chosen density on both panes so headers and rows share one set of sizes", async () => {
    renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)], { modListDensity: "roomy" });

    const { left, right } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());

    for (const pane of [left, right]) {
      const grid = pane.querySelector(".mod-list-compact") as HTMLElement;
      expect(grid).toHaveClass("mod-list-roomy");
      // The header cells and the rows have to inherit from the same element, or their tracks drift.
      expect(grid.querySelector(".mod-row-header-pane")).toBeInTheDocument();
      expect(grid.querySelector(".row-div-paddings-compact")).toBeInTheDocument();
    }
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

  it("puts a reordered mod in the position that was picked", async () => {
    /*
     * setModLoadOrderRelativeTo pins a mod by its index in the list it was placed in - here the three
     * enabled mods - so the pane has to re-derive its order from those same three. The disabled mods are
     * named to sort first on purpose: sorting all five by those pins instead would let the disabled ones
     * take the low slots, and the moved mod would land somewhere other than where it was dropped.
     */
    const mods = [
      createMod("aaa_one", false),
      createMod("aaa_two", false),
      createMod("m_alpha", true),
      createMod("m_beta", true),
      createMod("m_gamma", true),
    ];
    const { testStore } = renderDualLayout(mods);

    const { right } = getPanes();
    await waitFor(() => expect(within(right).queryByText("m_alpha human name")).toBeInTheDocument());

    // .row-div-paddings is the row element itself; the anchor and reorder ids also end in ".pack".
    const renderedEnabledOrder = () =>
      Array.from(right.querySelectorAll<HTMLElement>(".row-div-paddings")).map((row) => row.id);

    expect(renderedEnabledOrder()).toEqual(["m_alpha.pack", "m_beta.pack", "m_gamma.pack"]);

    // Move m_alpha from the top to the slot between m_beta and m_gamma.
    fireEvent.mouseEnter(right.querySelector<HTMLElement>("[id='m_alpha.pack']") as HTMLElement);
    await act(async () => fireEvent.click(document.getElementById("load-order-icon-m_alpha.pack") as HTMLElement));
    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-2")).toBeInTheDocument());
    await act(async () => fireEvent.click(document.getElementById("enabled-mod-placeholder-2") as HTMLButtonElement));

    await waitFor(() => expect(document.getElementById("enabled-mod-placeholder-0")).toBeNull());
    expect(testStore.getState().app.currentPreset.mods.find((mod) => mod.name === "m_alpha.pack")?.loadOrder).toBe(1);
    expect(renderedEnabledOrder()).toEqual(["m_beta.pack", "m_alpha.pack", "m_gamma.pack"]);
  });
});
