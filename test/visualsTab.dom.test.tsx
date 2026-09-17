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

describe("VisualsTab filtering", () => {
  beforeEach(() => {
    window.api = {
      ...window.api,
      getVisualsUnitsData: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "visuals-session",
        units,
      }),
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
});
