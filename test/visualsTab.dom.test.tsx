import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import localizationContext from "../src/localizationContext";
import enTranslation from "../locales/en/translation.json";
import VisualsTab from "../src/components/VisualsTab";

vi.mock("react-virtualized", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-virtualized")>();
  return {
    ...actual,
    AutoSizer: ({ children }: { children: (size: { height: number; width: number }) => React.ReactNode }) =>
      children({ height: 600, width: 400 }),
  };
});

vi.mock("re-resizable", () => ({
  Resizable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../src/components/VisualsModelPreview", () => ({
  default: () => <div data-testid="visuals-model-preview" />,
}));

const units = [
  {
    unitKey: "emp_lord",
    faction: "empire",
    localizedName: "Empire Lord",
    variantName: "default",
    variantMeshPath: "variantmeshes\\emp_lord.variantmeshdefinition",
    originPackPath: "/mods/example.pack",
    originLabel: "Example",
    cultureKey: "human",
    cultureName: "Human",
    caste: "lord",
  },
];

const searchVisualsFiles = vi.fn();

describe("VisualsTab filtering", () => {
  beforeEach(() => {
    searchVisualsFiles.mockReset().mockResolvedValue({
      success: true,
      total: 1,
      results: [{ path: "models\\example.wsmodel", ext: "wsmodel" }],
    });
    window.api = {
      ...window.api,
      getVisualsUnitsData: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "visuals-session",
        units,
      }),
      searchVisualsFiles,
    } as NonNullable<Window["api"]>;
  });

  it("expands matching culture and caste groups while filtering", async () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <VisualsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    expect(screen.queryByText("Empire Lord")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Unit filter (regex)"), { target: { value: "Empire" } });

    await waitFor(() => expect(screen.getByText("Empire Lord")).toBeInTheDocument());
  });

  it("loads model files in 1000-item pages", async () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <VisualsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Show all model files"));

    await waitFor(() => expect(searchVisualsFiles).toHaveBeenCalledWith("visuals-session", "", 0, 1000));
    expect(screen.getByText("models\\example.wsmodel")).toBeInTheDocument();
  });
});
