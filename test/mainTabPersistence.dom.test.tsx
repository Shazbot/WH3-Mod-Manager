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
vi.mock("../src/components/skillsViewer/SkillsTab", () => ({ default: () => <div /> }));
vi.mock("../src/components/techTrees/TechTreesTab", () => ({ default: () => <div /> }));
vi.mock("../src/components/PresetsTab", () => ({ default: () => <div /> }));
vi.mock("../src/components/Categories", () => ({ default: () => <div>Categories tab</div> }));
vi.mock("../src/components/ModRows", () => ({ default: () => <div /> }));
vi.mock("../src/components/Sidebar", () => ({ default: () => <div /> }));
vi.mock("../src/components/ModTagPicker", () => ({ default: () => <div /> }));

describe("main tab persistence", () => {
  it("lazily mounts Visuals and keeps its state after switching away", () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          currentTab: "categories" as const,
          currentGame: "wh3" as const,
          isFeaturesForModdersEnabled: true,
          isDev: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <Main scrollElement={React.createRef<HTMLDivElement>()} />
      </Provider>,
    );

    expect(screen.queryByLabelText("Visuals state")).not.toBeInTheDocument();

    act(() => store.dispatch(setCurrentTab("visuals")));
    const visualsState = screen.getByLabelText("Visuals state") as HTMLInputElement;
    fireEvent.change(visualsState, { target: { value: "preserved selection" } });

    act(() => store.dispatch(setCurrentTab("categories")));
    expect(visualsState.parentElement).toHaveClass("hidden");

    act(() => store.dispatch(setCurrentTab("visuals")));
    expect(screen.getByLabelText("Visuals state")).toBe(visualsState);
    expect(visualsState).toHaveValue("preserved selection");
    expect(visualsState.parentElement).not.toHaveClass("hidden");
  });
});
