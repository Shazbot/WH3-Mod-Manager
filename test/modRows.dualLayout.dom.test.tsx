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
    renderDualLayout([createMod("alpha", false), createMod("delta", false, 6), createMod("beta", true, 0)], {
      isShowingDisabledModsLoadOrder: false,
    });

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
    // The wording leads the title; the shift-click hint that follows is about sorting both panes.
    expect(orderLabel.title.split("\n")[0]).toBe(localization.order);

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

  it("numbers the disabled list by default", async () => {
    renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)]);

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

describe("categories view in the dual layout", () => {
  beforeEach(() => {
    window.api = {
      ...window.api,
      getCustomizableMods: vi.fn(),
    } as NonNullable<Window["api"]>;
  });

  /** The rows and headings of the left pane, in the order they are rendered. */
  const getLeftPaneLabels = (left: HTMLElement) =>
    Array.from(left.querySelectorAll<HTMLElement>(".row-div-paddings, [aria-expanded]")).map(
      (element) => element.id || (element.textContent ?? ""),
    );

  const withCategories = (mod: Mod, categories: string[]): Mod => ({ ...mod, categories });

  const getHeading = (left: HTMLElement, category: string) =>
    within(left).getByText(category).closest("button") as HTMLButtonElement;

  it("groups the left pane only once the toggle is on, and keeps the toggle out of the enabled pane", async () => {
    const { testStore } = renderDualLayout([
      withCategories(createMod("alpha", false), ["Units"]),
      withCategories(createMod("gamma", false), ["Graphics"]),
      withCategories(createMod("beta", true, 0), ["Units"]),
    ]);

    const { left, right } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());
    expect(within(left).queryByText("Units")).toBeNull();

    const toggle = document.getElementById("categoryViewToggle") as HTMLButtonElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(within(right).queryByRole("button", { name: /group by category/i })).toBeNull();

    await act(async () => fireEvent.click(toggle));

    expect(testStore.getState().app.isModListCategoryViewEnabled).toBe(true);
    await waitFor(() => expect(within(left).queryByText("Graphics")).toBeInTheDocument());
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    // Units holds two mods, one of them already enabled, so only one is left to list.
    expect(getLeftPaneLabels(left)).toEqual(["Graphics1/1", "gamma.pack", "Units1/2", "alpha.pack"]);

    // The enabled pane's row order is the load order, so it stays a flat list.
    expect(within(right).queryByText("Units")).toBeNull();
    expect(within(right).queryByText("beta human name")).toBeInTheDocument();
  });

  it("files a mod with no categories under Uncategorized, and lists a multi-category mod under each", async () => {
    renderDualLayout([withCategories(createMod("alpha", false), ["Units", "Graphics"]), createMod("gamma", false)], {
      isModListCategoryViewEnabled: true,
    });

    const { left } = getPanes();
    await waitFor(() => expect(within(left).queryByText("Uncategorized")).toBeInTheDocument());

    expect(getLeftPaneLabels(left)).toEqual([
      "Uncategorized1/1",
      "gamma.pack",
      "Graphics1/1",
      "alpha.pack",
      "Units1/1",
      "alpha.pack",
    ]);
  });

  it("keeps the heading of a category whose mods are all enabled, with nothing left to list", async () => {
    renderDualLayout(
      [withCategories(createMod("alpha", true, 0), ["Units"]), withCategories(createMod("gamma", false), ["Graphics"])],
      { isModListCategoryViewEnabled: true },
    );

    const { left } = getPanes();
    await waitFor(() => expect(within(left).queryByText("Units")).toBeInTheDocument());

    // Nothing to enable in Units, but the heading is what there is to right click to switch it back off.
    expect(getLeftPaneLabels(left)).toEqual(["Graphics1/1", "gamma.pack", "Units0/1"]);
  });

  it("collapses a category when its heading is clicked, and still counts what it holds", async () => {
    renderDualLayout(
      [withCategories(createMod("alpha", false), ["Units"]), withCategories(createMod("beta", false), ["Units"])],
      { isModListCategoryViewEnabled: true },
    );

    const { left } = getPanes();
    await waitFor(() => expect(within(left).queryByText("Units")).toBeInTheDocument());
    expect(getLeftPaneLabels(left)).toEqual(["Units2/2", "alpha.pack", "beta.pack"]);

    const heading = getHeading(left, "Units");
    expect(heading).toHaveAttribute("aria-expanded", "true");
    await act(async () => fireEvent.click(heading));

    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeNull());
    // The heading survives the collapse, and its count still covers the hidden rows.
    expect(getLeftPaneLabels(left)).toEqual(["Units2/2"]);
    expect(getHeading(left, "Units")).toHaveAttribute("aria-expanded", "false");
  });

  it("enables every mod of a category when its heading is right clicked, and disables them once they all are", async () => {
    const { testStore } = renderDualLayout(
      [
        withCategories(createMod("alpha", false), ["Units"]),
        withCategories(createMod("beta", false), ["Units"]),
        withCategories(createMod("gamma", false), ["Graphics"]),
      ],
      { isModListCategoryViewEnabled: true },
    );

    const { left, right } = getPanes();
    await waitFor(() => expect(within(left).queryByText("Units")).toBeInTheDocument());

    await act(async () => fireEvent.contextMenu(getHeading(left, "Units")));

    const isEnabled = (name: string) =>
      testStore.getState().app.currentPreset.mods.find((mod) => mod.name === `${name}.pack`)?.isEnabled;
    expect([isEnabled("alpha"), isEnabled("beta"), isEnabled("gamma")]).toEqual([true, true, false]);

    await waitFor(() => expect(within(right).queryByText("alpha human name")).toBeInTheDocument());
    // The category is left with a heading and no rows, which is what there is to right click again.
    expect(getLeftPaneLabels(left)).toEqual(["Graphics1/1", "gamma.pack", "Units0/2"]);

    await act(async () => fireEvent.contextMenu(getHeading(left, "Units")));

    expect([isEnabled("alpha"), isEnabled("beta")]).toEqual([false, false]);
    await waitFor(() =>
      expect(getLeftPaneLabels(left)).toEqual(["Graphics1/1", "gamma.pack", "Units2/2", "alpha.pack", "beta.pack"]),
    );
  });

  it("leaves an always enabled mod alone when a category is switched off", async () => {
    const { testStore } = renderDualLayout(
      [withCategories(createMod("alpha", true, 0), ["Units"]), withCategories(createMod("beta", true, 1), ["Units"])],
      { isModListCategoryViewEnabled: true, alwaysEnabledModNames: ["alpha.pack"] },
    );

    const { left } = getPanes();
    await waitFor(() => expect(within(left).queryByText("Units")).toBeInTheDocument());
    // An always enabled mod counts as enabled, so the category reads as fully enabled.
    expect(getLeftPaneLabels(left)).toEqual(["Units0/2"]);

    await act(async () => fireEvent.contextMenu(getHeading(left, "Units")));

    const isEnabled = (name: string) =>
      testStore.getState().app.currentPreset.mods.find((mod) => mod.name === `${name}.pack`)?.isEnabled;
    expect(isEnabled("alpha")).toBe(true);
    expect(isEnabled("beta")).toBe(false);
  });

  it("collapses and expands every category from the toggle's context menu", async () => {
    renderDualLayout(
      [withCategories(createMod("alpha", false), ["Units"]), withCategories(createMod("gamma", false), ["Graphics"])],
      { isModListCategoryViewEnabled: true },
    );

    const { left } = getPanes();
    await waitFor(() => expect(within(left).queryByText("Units")).toBeInTheDocument());

    const toggle = document.getElementById("categoryViewToggle") as HTMLButtonElement;
    await act(async () => fireEvent.contextMenu(toggle));
    await waitFor(() => expect(getLeftPaneLabels(left)).toEqual(["Graphics1/1", "Units1/1"]));

    await act(async () => fireEvent.contextMenu(toggle));
    await waitFor(() =>
      expect(getLeftPaneLabels(left)).toEqual(["Graphics1/1", "gamma.pack", "Units1/1", "alpha.pack"]),
    );
  });

  it("groups only the mods the search filter left behind", async () => {
    renderDualLayout(
      [withCategories(createMod("alpha", false), ["Units"]), withCategories(createMod("gamma", false), ["Graphics"])],
      { isModListCategoryViewEnabled: true, filter: "alpha" },
    );

    const { left } = getPanes();
    await waitFor(() => expect(within(left).queryByText("Units")).toBeInTheDocument());

    // A category with nothing left to show drops out along with its rows.
    expect(getLeftPaneLabels(left)).toEqual(["Units1/1", "alpha.pack"]);
  });
});

describe("sorting the dual layout's panes", () => {
  beforeEach(() => {
    window.api = {
      ...window.api,
      getCustomizableMods: vi.fn(),
    } as NonNullable<Window["api"]>;
  });

  /** The name column of one pane; the compact header is an icon with the wording behind it. */
  const getNameHeader = (pane: HTMLElement) =>
    within(pane).getByText(localization.name).closest(".mod-row-header-pane") as HTMLElement;

  const getRenderedNames = (pane: HTMLElement) =>
    Array.from(pane.querySelectorAll<HTMLElement>(".row-div-paddings")).map((row) => row.id);

  it("sorts one pane without touching the other", async () => {
    // The human names invert the pack name order, so the two sorts are told apart by what is rendered.
    const { testStore } = renderDualLayout([
      { ...createMod("b_two", false), humanName: "a first" },
      { ...createMod("a_one", false), humanName: "z last" },
      createMod("m_beta", true, 0),
      createMod("m_alpha", true, 1),
    ]);

    const { left, right } = getPanes();
    await waitFor(() => expect(within(left).queryByText("a first")).toBeInTheDocument());
    // Both panes open on the order the load order gives them.
    expect(getRenderedNames(left)).toEqual(["a_one.pack", "b_two.pack"]);
    expect(getRenderedNames(right)).toEqual(["m_beta.pack", "m_alpha.pack"]);

    await act(async () => fireEvent.click(getNameHeader(right)));

    expect(testStore.getState().app.enabledModsPaneSortingType).toBe(SortingType.HumanName);
    // Only the enabled pane re-sorted; the disabled one is still on its own sorting type.
    expect(getRenderedNames(right)).toEqual(["m_alpha.pack", "m_beta.pack"]);
    expect(testStore.getState().app.modRowsSortingType).toBe(SortingType.Ordered);
    expect(getRenderedNames(left)).toEqual(["a_one.pack", "b_two.pack"]);

    await act(async () => fireEvent.click(getNameHeader(left)));

    expect(testStore.getState().app.modRowsSortingType).toBe(SortingType.HumanName);
    expect(getRenderedNames(left)).toEqual(["b_two.pack", "a_one.pack"]);
    // And the enabled pane kept the sort it was given.
    expect(getRenderedNames(right)).toEqual(["m_alpha.pack", "m_beta.pack"]);
  });

  it("reverses only the pane that was clicked a second time", async () => {
    const { testStore } = renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)]);

    const { left, right } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());

    await act(async () => fireEvent.click(getNameHeader(right)));
    await act(async () => fireEvent.click(getNameHeader(right)));

    expect(testStore.getState().app.enabledModsPaneSortingType).toBe(SortingType.HumanNameReverse);
    expect(testStore.getState().app.modRowsSortingType).toBe(SortingType.Ordered);
  });

  it("sorts both panes by the clicked column when shift is held", async () => {
    const { testStore } = renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)]);

    const { left, right } = getPanes();
    await waitFor(() => expect(within(left).queryByText("alpha human name")).toBeInTheDocument());

    await act(async () => fireEvent.click(getNameHeader(right), { shiftKey: true }));

    // The pane that was not clicked takes the same sorting type rather than flipping its own direction.
    expect(testStore.getState().app.enabledModsPaneSortingType).toBe(SortingType.HumanName);
    expect(testStore.getState().app.modRowsSortingType).toBe(SortingType.HumanName);

    await act(async () => fireEvent.click(getNameHeader(left), { shiftKey: true }));

    expect(testStore.getState().app.modRowsSortingType).toBe(SortingType.HumanNameReverse);
    expect(testStore.getState().app.enabledModsPaneSortingType).toBe(SortingType.HumanNameReverse);
  });

  it("does not let the shift click extend a text selection over the list", async () => {
    renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)]);

    const { right } = getPanes();
    await waitFor(() => expect(within(right).queryByText("beta human name")).toBeInTheDocument());

    // fireEvent returns false when the handler called preventDefault, which is what stops the selection.
    expect(fireEvent.mouseDown(getNameHeader(right), { shiftKey: true })).toBe(false);
    // An ordinary click is left alone.
    expect(fireEvent.mouseDown(getNameHeader(right))).toBe(true);
    // And a row is never swallowed, shift or not.
    const betaRow = right.querySelector<HTMLElement>("[id='beta.pack']") as HTMLElement;
    expect(fireEvent.mouseDown(betaRow, { shiftKey: true })).toBe(true);
  });

  it("keeps reordering available on the pane that is sorted by load order", async () => {
    const { testStore } = renderDualLayout([createMod("alpha", false), createMod("beta", true, 0)]);

    const { right } = getPanes();
    await waitFor(() => expect(within(right).queryByText("beta human name")).toBeInTheDocument());
    expect(document.getElementById("load-order-icon-beta.pack")).toBeInTheDocument();

    // Sorting the enabled pane by anything else makes a dropped position meaningless, so placement goes.
    await act(async () => fireEvent.click(getNameHeader(right)));
    expect(testStore.getState().app.enabledModsPaneSortingType).toBe(SortingType.HumanName);

    const betaRow = right.querySelector<HTMLElement>("[id='beta.pack']") as HTMLElement;
    fireEvent.mouseEnter(betaRow);
    expect(document.getElementById("load-order-icon-beta.pack")).toHaveClass("hidden");

    // The disabled pane's own sorting type has no say in it.
    const { left } = getPanes();
    await act(async () => fireEvent.click(getNameHeader(left)));
    fireEvent.mouseEnter(betaRow);
    expect(document.getElementById("load-order-icon-beta.pack")).toHaveClass("hidden");
  });
});
