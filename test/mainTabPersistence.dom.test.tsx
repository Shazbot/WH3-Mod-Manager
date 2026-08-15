import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import appReducer, { setCurrentTab } from "../src/appSlice";
import initialState from "../src/initialAppState";
import Main from "../src/components/Main";

vi.mock("../src/components/VisualsTab", () => ({
  default: () => <input aria-label="Visuals state" defaultValue="" />,
}));
vi.mock("../src/components/NodeEditor", () => ({ default: () => <div /> }));
vi.mock("../src/components/UnitViewerTab", () => ({ default: () => <div /> }));
vi.mock("../src/components/skillsViewer/SkillsTab", () => ({
  default: () => <input aria-label="Skills state" defaultValue="" />,
}));
vi.mock("../src/components/techTrees/TechTreesTab", () => ({
  default: () => <input aria-label="Tech trees state" defaultValue="" />,
}));
vi.mock("../src/components/buildings/BuildingsTab", () => ({
  default: () => <input aria-label="Buildings state" defaultValue="" />,
}));
vi.mock("../src/components/PresetsTab", () => ({ default: () => <div /> }));
vi.mock("../src/components/Categories", () => ({ default: () => <div>Categories tab</div> }));
vi.mock("../src/components/ModRows", () => ({ default: () => <div /> }));
vi.mock("../src/components/Sidebar", () => ({ default: () => <div /> }));
vi.mock("../src/components/ModTagPicker", () => ({ default: () => <div /> }));

describe("main tab persistence", () => {
  const renderMain = (overrides: Partial<typeof initialState> = {}) => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          currentTab: "categories" as const,
          currentGame: "wh3" as const,
          isFeaturesForModdersEnabled: true,
          isDev: true,
          // Both only exist as tabs in this mode; otherwise they open in their own window.
          skillTreesDisplayMode: "tab" as const,
          technologyTreesDisplayMode: "tab" as const,
          ...overrides,
        },
      },
    });
    render(
      <Provider store={store}>
        <Main scrollElement={React.createRef<HTMLDivElement>()} />
      </Provider>,
    );
    return store;
  };

  /** Opened, edited, switched away from and returned to: the same element with the same value. */
  const expectTabKeepsItsState = (
    store: ReturnType<typeof renderMain>,
    tab: "visuals" | "skills" | "techTrees" | "buildings",
    label: string,
  ) => {
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();

    act(() => store.dispatch(setCurrentTab(tab)));
    const tabState = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(tabState, { target: { value: "preserved selection" } });

    act(() => store.dispatch(setCurrentTab("categories")));
    expect(tabState.parentElement).toHaveClass("hidden");

    act(() => store.dispatch(setCurrentTab(tab)));
    expect(screen.getByLabelText(label)).toBe(tabState);
    expect(tabState).toHaveValue("preserved selection");
    expect(tabState.parentElement).not.toHaveClass("hidden");
  };

  it("lazily mounts Visuals and keeps its state after switching away", () => {
    expectTabKeepsItsState(renderMain(), "visuals", "Visuals state");
  });

  it("lazily mounts Skills and keeps its state after switching away", () => {
    expectTabKeepsItsState(renderMain(), "skills", "Skills state");
  });

  it("lazily mounts Tech Trees and keeps its state after switching away", () => {
    expectTabKeepsItsState(renderMain(), "techTrees", "Tech trees state");
  });

  it("lazily mounts Buildings and keeps its state after switching away", () => {
    expectTabKeepsItsState(renderMain(), "buildings", "Buildings state");
  });

  it("does not mount Buildings for a game that has none", () => {
    const store = renderMain({ currentGame: "wh2" as const });

    act(() => store.dispatch(setCurrentTab("buildings")));

    expect(store.getState().app.currentTab).toBe("mods");
    expect(screen.queryByLabelText("Buildings state")).not.toBeInTheDocument();
  });

  it("does not mount Tech Trees for a game that has none", () => {
    const store = renderMain({ currentGame: "wh2" as const });

    act(() => store.dispatch(setCurrentTab("techTrees")));

    // The tab is not available for wh2, so the request lands on mods and nothing is mounted.
    expect(store.getState().app.currentTab).toBe("mods");
    expect(screen.queryByLabelText("Tech trees state")).not.toBeInTheDocument();
  });
});
