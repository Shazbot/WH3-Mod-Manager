import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import LocalizationContext from "../src/localizationContext";
import LoadOrderRulesView from "../src/components/viewer/LoadOrderRulesView";

describe("load order rules viewer", () => {
  const renderView = () => {
    const user = userEvent.setup();
    const packPath = "C:\\mods\\rules.pack";
    const filePath = "whmm\\load_order.whmm";
    const saveTextPackedFileEdits = vi.fn().mockResolvedValue({ success: true });
    const getViewerPackCatalog = vi.fn().mockResolvedValue({
      success: true,
      packs: [
        {
          path: "C:\\mods\\available.pack",
          name: "available.pack",
          isEnabled: false,
          isInData: false,
        },
      ],
    });
    window.api = { saveTextPackedFileEdits, getViewerPackCatalog } as unknown as NonNullable<Window["api"]>;

    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          currentPreset: {
            ...initialState.currentPreset,
            mods: [],
          },
          packsData: {
            [packPath]: {
              packName: "rules.pack",
              packPath,
              tables: [],
              packedFiles: {
                [filePath]: {
                  name: filePath,
                  file_size: 1,
                  start_pos: 0,
                  text: "BEFORE\tother.pack\n",
                },
              },
            },
          },
        },
      },
    });

    render(
      <Provider store={store}>
        <LocalizationContext.Provider value={{}}>
          <LoadOrderRulesView packPath={packPath} filePath={filePath} showDialog={vi.fn()} />
        </LocalizationContext.Provider>
      </Provider>,
    );

    return {
      input: document.getElementById("load-order-rules-pack-name-0") as HTMLInputElement,
      saveTextPackedFileEdits,
      user,
    };
  };

  it("does not save when the pack name selection is unchanged", async () => {
    const { input, saveTextPackedFileEdits, user } = renderView();

    await user.click(input);
    await user.click(screen.getByText("Load Order Rules"));

    expect(saveTextPackedFileEdits).not.toHaveBeenCalled();
  });

  it("explains that a BEFORE pack overrides the pack below it", async () => {
    renderView();

    expect(
      await screen.findByText(
        /BEFORE means this pack appears higher in the visible mod list \(with a lower load-order number\)/,
      ),
    ).toBeInTheDocument();
  });

  it("offers pack names from the viewer catalog", async () => {
    const { input, user } = renderView();

    await user.click(input);

    expect(await screen.findByText("available.pack")).toBeInTheDocument();
  });

  it("keeps the editable pack name selection focused while typing", async () => {
    const { input, user } = renderView();

    await user.type(input, "x");

    expect(input).toHaveValue("x");
    expect(input).toHaveFocus();
  });
});
