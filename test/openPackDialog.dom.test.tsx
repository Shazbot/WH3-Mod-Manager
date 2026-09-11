import React from "react";

import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import OpenPackDialog from "../src/components/viewer/OpenPackDialog";
import LocalizationContext from "../src/localizationContext";

describe("open pack dialog", () => {
  const originalApi = window.api;
  const getViewerPackCatalog = vi.fn();
  const selectFlowPackFile = vi.fn();
  const requestOpenModInViewer = vi.fn();

  beforeEach(() => {
    getViewerPackCatalog.mockResolvedValue({
      success: true,
      packs: [
        {
          path: "C:\\content\\same.pack",
          name: "same.pack",
          humanName: "Same Pack",
          isEnabled: false,
          isInData: false,
          priority: 3,
        },
        {
          path: "C:\\data\\same.pack",
          name: "same.pack",
          humanName: "Same Pack",
          isEnabled: false,
          isInData: true,
          priority: 1,
        },
        {
          path: "C:\\content\\enabled.pack",
          name: "enabled.pack",
          humanName: "Enabled Pack",
          isEnabled: true,
          isInData: false,
          priority: 3,
        },
      ],
    });
    selectFlowPackFile.mockReset();
    requestOpenModInViewer.mockReset();
    window.api = {
      ...originalApi,
      getViewerPackCatalog,
      selectFlowPackFile,
      requestOpenModInViewer,
    } as NonNullable<Window["api"]>;
  });

  afterEach(() => {
    window.api = originalApi;
  });

  const renderDialog = () => {
    const store = configureStore({ reducer: { app: appReducer } });
    render(
      <Provider store={store}>
        <LocalizationContext.Provider value={{}}>
          <OpenPackDialog show currentPackPath={null} onClose={vi.fn()} onOpenPack={requestOpenModInViewer} />
        </LocalizationContext.Provider>
      </Provider>,
    );
  };

  it("groups packs by enabled state and shows priority, data coloring, and full paths", async () => {
    renderDialog();

    const select = await screen.findByLabelText("Select Pack...");
    const groups = [...select.querySelectorAll("optgroup")];
    expect(groups.map((group) => group.label)).toEqual(["Enabled mods", "Disabled mods"]);

    const disabledOptions = [...groups[1].querySelectorAll("option")];
    expect(disabledOptions[0]?.textContent).toContain("C:\\data\\same.pack");
    expect(disabledOptions[1]?.textContent).toContain("C:\\content\\same.pack");
    expect(disabledOptions[1]?.textContent).toContain("↳");
    expect(disabledOptions[0]).toHaveClass("text-orange-500");
    expect(disabledOptions[0]?.title).toBe("C:\\data\\same.pack");
  });

  it("uses the browse result as the selected pack and opens it", async () => {
    const user = userEvent.setup();
    selectFlowPackFile.mockResolvedValue("D:\\picked\\external.pack");
    renderDialog();

    await screen.findByLabelText("Select Pack...");
    await user.click(screen.getByRole("button", { name: "Browse" }));
    expect(await screen.findByText(/D:\\picked\\external\.pack/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Pack" }));
    expect(requestOpenModInViewer).toHaveBeenCalledWith("D:\\picked\\external.pack");
  });
});
