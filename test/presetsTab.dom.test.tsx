import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import PresetsTab from "../src/components/PresetsTab";
import initialState from "../src/initialAppState";
import localizationContext from "../src/localizationContext";

vi.mock("react-select", () => ({
  __esModule: true,
  default: () => <div data-testid="react-select" />,
}));

const createMod = (name: string, humanName: string, isEnabled: boolean): Mod => ({
  humanName,
  name,
  path: `/mods/${name}`,
  imgPath: "",
  workshopId: name,
  isEnabled,
  modDirectory: "",
  isInData: false,
  loadOrder: undefined,
  author: "",
  isDeleted: false,
  isMovie: false,
  dependencyPacks: [],
  reqModIdToName: [],
  size: 0,
  isSymbolicLink: false,
  categories: [],
  tags: [],
  isInModding: false,
});

describe("preset editor additions", () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    scrollIntoView.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
  });

  it("reveals, centers, and temporarily highlights a mod added to the preset", () => {
    const enabledMod = {
      ...createMod("enabled.pack", "", true),
      isInData: true,
      workshopId: "",
    };
    const enabledWorkshopMod = {
      ...createMod("enabled.pack", "Enabled Mod", true),
      path: "/workshop/enabled.pack",
      workshopId: "enabled-workshop-id",
    };
    const addedMod = createMod("added.pack", "Added Mod", false);
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          currentPreset: { name: "", mods: [enabledMod, addedMod] },
          allMods: [enabledMod, enabledWorkshopMod, addedMod],
        },
      },
    });

    const { container } = render(
      <Provider store={store}>
        <localizationContext.Provider value={{}}>
          <PresetsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    const enabledRow = container.querySelector<HTMLElement>('[data-preset-mod-name="enabled.pack"]');
    expect(enabledRow).toHaveTextContent("Enabled Mod");
    expect(enabledRow).not.toHaveTextContent("enabled.pack");

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const addedRow = container.querySelector<HTMLElement>('[data-preset-mod-name="added.pack"]');
    expect(addedRow).not.toBeNull();
    expect(addedRow).toHaveTextContent("Added Mod");
    expect(addedRow).not.toHaveTextContent("added.pack");
    expect(addedRow).toHaveClass("bg-emerald-500/30", "ring-emerald-400");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });

    act(() => vi.advanceTimersByTime(2400));
    expect(addedRow).not.toHaveClass("bg-emerald-500/30", "ring-emerald-400");
  });
});
