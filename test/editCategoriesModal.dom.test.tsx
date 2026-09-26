import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";

import appReducer from "../src/appSlice";
import EditCategoriesModal from "../src/components/EditCategoriesModal";
import initialState from "../src/initialAppState";
import localizationContext from "../src/localizationContext";
import esTranslation from "../locales/es/translation.json";

describe("EditCategoriesModal", () => {
  it("stores a stable color key when the color label is localized", async () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          categories: ["Alpha"],
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={esTranslation}>
          <EditCategoriesModal isOpen onClose={() => undefined} />
        </localizationContext.Provider>
      </Provider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Establecer color de Alpha a Rojo"));

    expect(store.getState().app.categoryColors.Alpha).toBe("red");
  });
});
