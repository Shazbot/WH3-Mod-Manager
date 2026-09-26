import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appReducer, { addLoadOrderRule, setModLoadOrderRules } from "../src/appSlice";
import initialState from "../src/initialAppState";
import ModRows from "../src/components/ModRows";
import LocalizationContext from "../src/localizationContext";
import { resetActiveLoadOrderEdges } from "../src/modSortingHelpers";
import { SortingType } from "../src/utility/modRowSorting";

vi.mock("../src/components/ModDropdown", () => ({ default: () => null }));

vi.mock("react-virtualized", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-virtualized")>();
  return {
    ...actual,
    AutoSizer: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
      children({ width: 800, height: 600 }),
  };
});

const createMod = (name: string): Mod => ({
  name: `${name}.pack`,
  humanName: `${name} human name`,
  path: `/mods/${name}.pack`,
  imgPath: "",
  workshopId: name,
  isEnabled: true,
  modDirectory: "/mods",
  isInData: true,
  loadOrder: undefined,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  tags: [],
  reqModIdToName: [],
});

const localization = { order: "Order", name: "Name", pack: "Pack", author: "Author", categories: "Categories" };

const renderModRows = (mods: Mod[]) => {
  const testStore = configureStore({
    reducer: { app: appReducer },
    preloadedState: {
      app: {
        ...initialState,
        currentTab: "mods" as MainWindowTab,
        areThumbnailsEnabled: false,
        modRowsSortingType: SortingType.Ordered,
        currentPreset: { name: "", mods },
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

/** The rendered rows in order; each row carries its pack name as its DOM id. */
const visibleModNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(".row-div-paddings")).map((element) => element.id);

describe("load order rules in the mod list", () => {
  beforeEach(() => {
    resetActiveLoadOrderEdges();
    window.api = { ...window.api, getCustomizableMods: vi.fn() } as NonNullable<Window["api"]>;
  });

  /**
   * The regression guard for the sort being memoised on the mod array alone: the rules live in a
   * module level registry, which a useMemo cannot depend on, so a rule arriving after the list has
   * rendered would leave a stale order on screen with nothing to signal it.
   */
  it("re-sorts when a rule arrives and the mod list itself has not changed", async () => {
    const { container, testStore } = renderModRows([createMod("alpha"), createMod("beta"), createMod("gamma")]);

    await waitFor(() => expect(within(container).queryByText("alpha human name")).toBeInTheDocument());
    expect(visibleModNames(container)).toEqual(["alpha.pack", "beta.pack", "gamma.pack"]);

    act(() => {
      testStore.dispatch(
        addLoadOrderRule({ before: "gamma.pack", after: "alpha.pack", subjectPackName: "gamma.pack" }),
      );
    });

    // gamma steps in front of alpha; beta is named by no rule and keeps its place after alpha.
    await waitFor(() => expect(visibleModNames(container)).toEqual(["gamma.pack", "alpha.pack", "beta.pack"]));
  });

  it("re-sorts when a mod's own rules arrive from the pack scan", async () => {
    const { container, testStore } = renderModRows([createMod("alpha"), createMod("beta"), createMod("gamma")]);

    await waitFor(() => expect(within(container).queryByText("alpha human name")).toBeInTheDocument());

    act(() => {
      testStore.dispatch(
        setModLoadOrderRules({
          "gamma.pack": [
            {
              before: "gamma.pack",
              after: "alpha.pack",
              sourcePackName: "gamma.pack",
              subjectPackName: "gamma.pack",
            },
          ],
        }),
      );
    });

    await waitFor(() => expect(visibleModNames(container)).toEqual(["gamma.pack", "alpha.pack", "beta.pack"]));
  });

  it("leaves the order alone when the rules resolve to nothing", async () => {
    const { container, testStore } = renderModRows([createMod("alpha"), createMod("beta")]);

    await waitFor(() => expect(within(container).queryByText("alpha human name")).toBeInTheDocument());

    act(() => {
      // Names a pack that is not installed, so it can never take effect.
      testStore.dispatch(
        addLoadOrderRule({ before: "nowhere.pack", after: "alpha.pack", subjectPackName: "nowhere.pack" }),
      );
    });

    await waitFor(() => expect(visibleModNames(container)).toEqual(["alpha.pack", "beta.pack"]));
  });
});
