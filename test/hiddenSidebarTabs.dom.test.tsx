import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import appReducer, { setCurrentTab, toggleMainWindowTabHidden } from "../src/appSlice";
import initialState from "../src/initialAppState";
import localizationContext from "../src/localizationContext";
import LeftSidebar from "../src/components/LeftSidebar";

const localizedStrings = {
  allMods: "All Mods",
  enabledModsCapitalized: "Enabled Mods",
  categories: "Categories",
  presetsTab: "Presets",
  skillsViewer: "Skill Trees",
  techTreesTab: "Tech Trees",
  unitViewerTab: "Unit Viewer",
  buildingsTab: "Buildings",
  ancillariesTab: "Ancillaries",
  mapTab: "Map",
  nodeEditorTab: "Node Editor",
};

const renderSidebar = (stateOverrides: Partial<AppState> = {}) => {
  const store = configureStore({
    reducer: { app: appReducer },
    preloadedState: {
      app: { ...initialState, currentGame: "wh3" as const, ...stateOverrides },
    },
  });

  render(
    <Provider store={store}>
      <localizationContext.Provider value={localizedStrings}>
        <LeftSidebar />
      </localizationContext.Provider>
    </Provider>,
  );

  return store;
};

describe("hidden sidebar tabs", () => {
  it("hides the tabs listed in hiddenMainWindowTabs", () => {
    renderSidebar({ hiddenMainWindowTabs: ["categories", "map"] });

    expect(screen.queryByText("Categories")).not.toBeInTheDocument();
    expect(screen.queryByText("Map")).not.toBeInTheDocument();
    expect(screen.getByText("All Mods")).toBeInTheDocument();
    expect(screen.getByText("Enabled Mods")).toBeInTheDocument();
    expect(screen.getByText("Buildings")).toBeInTheDocument();
  });

  it("renumbers the Ctrl shortcuts of the tabs that are left", () => {
    const store = renderSidebar({ hiddenMainWindowTabs: ["enabledMods", "categories"] });

    expect(screen.getByText("Ctrl+2")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Presets"));
    expect(store.getState().app.currentTab).toBe("presets");
  });

  it("never hides All Mods", () => {
    const store = configureStore({ reducer: { app: appReducer } });

    act(() => {
      store.dispatch(toggleMainWindowTabHidden("mods"));
    });

    expect(store.getState().app.hiddenMainWindowTabs).toEqual([]);
  });

  it("falls back to All Mods when the open tab gets hidden, and restores it on untoggle", () => {
    const store = renderSidebar({ currentTab: "buildings" });

    act(() => {
      store.dispatch(toggleMainWindowTabHidden("buildings"));
    });
    expect(store.getState().app.currentTab).toBe("mods");
    expect(screen.queryByText("Buildings")).not.toBeInTheDocument();

    act(() => {
      store.dispatch(toggleMainWindowTabHidden("buildings"));
    });
    expect(screen.getByText("Buildings")).toBeInTheDocument();

    act(() => {
      store.dispatch(setCurrentTab("buildings"));
    });
    expect(store.getState().app.currentTab).toBe("buildings");
  });

  it("keeps a hidden tab unselectable", () => {
    const store = renderSidebar({ hiddenMainWindowTabs: ["ancillaries"] });

    act(() => {
      store.dispatch(setCurrentTab("ancillaries"));
    });

    expect(store.getState().app.currentTab).toBe("mods");
  });

  it("hides the Node Editor when it is unchecked even with modder features on", () => {
    renderSidebar({ isFeaturesForModdersEnabled: true, hiddenMainWindowTabs: ["nodeEditor"] });

    expect(screen.queryByText("Node Editor")).not.toBeInTheDocument();
  });
});
