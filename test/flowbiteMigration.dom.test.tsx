import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { ReactFlowProvider } from "@xyflow/react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getVersion } from "flowbite-react/store";
import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import LocalizationContext from "../src/localizationContext";
import SidebarTooltip from "../src/components/SidebarTooltip";
import SkillsToolbar from "../src/components/skillsViewer/SkillsToolbar";
import { Toasts } from "../src/components/Toasts";
import { UpdateNotification } from "../src/components/UpdateNotification";

vi.mock("../src/components/VanillaDbCacheBuildProgress", () => ({ VanillaDbCacheBuildProgressCard: () => null }));

const makeStore = (overrides = {}) =>
  configureStore({
    reducer: { app: appReducer },
    preloadedState: { app: { ...initialState, ...overrides } },
  });

describe("Flowbite React migration", () => {
  it("uses Tailwind 4 and portals the sidebar tooltip outside its scroll container", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SidebarTooltip content="A sidebar warning" placement="right">
        <button>Warning details</button>
      </SidebarTooltip>,
    );
    expect(getVersion()).toBe(4);
    await user.hover(screen.getByRole("button", { name: "Warning details" }));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("A sidebar warning");
    expect(container).not.toContainElement(tooltip);
    expect(tooltip).toHaveStyle({ position: "fixed" });
    expect(tooltip).toHaveClass("bg-gray-900", "z-300");
  });

  it("keeps options open after checkbox changes and dismisses a faction selection", async () => {
    const user = userEvent.setup();
    const store = makeStore({ isFeaturesForModdersEnabled: false, isShowingHiddenSkills: false });
    const onFactionFilterChange = vi.fn();
    const noop = vi.fn();
    render(
      <Provider store={store}>
        <LocalizationContext.Provider value={{ options: "Options", showHiddenSkills: "Hidden skills", all: "All" }}>
          <ReactFlowProvider>
            <SkillsToolbar
              isEditMode={false}
              isRequirementsMode={false}
              isSkillLocksMode={false}
              canUndo={false}
              canRedo={false}
              factionFilter="all"
              factionOptions={[{ label: "Empire", value: "empire" }]}
              onFactionFilterChange={onFactionFilterChange}
              onNewSkillTree={noop}
              onToggleEditMode={noop}
              onToggleRequirementsMode={noop}
              onToggleSkillLocksMode={noop}
              onUndo={noop}
              onRedo={noop}
              onAddNode={noop}
              onReset={noop}
              onImport={noop}
              onExport={noop}
              onSavePack={noop}
            />
          </ReactFlowProvider>
        </LocalizationContext.Provider>
      </Provider>,
    );
    const optionsButton = screen.getByRole("button", { name: "Options" });
    expect(optionsButton).toHaveClass("bg-blue-700");
    await user.click(optionsButton);
    await user.click(await screen.findByRole("checkbox", { name: "Hidden skills" }));
    expect(store.getState().app.isShowingHiddenSkills).toBe(true);
    expect(screen.getByRole("menu")).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "All" }));
    const empireItem = await screen.findByRole("menuitem", { name: "Empire" });
    await user.click(within(empireItem).getByRole("button", { name: "Empire" }));
    expect(onFactionFilterChange).toHaveBeenCalledWith("empire");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("dismisses a real toast through Redux", async () => {
    const user = userEvent.setup();
    const store = makeStore({
      toasts: [{ type: "info", messages: ["Saved changes"], startTime: Date.now(), duration: 60000 }],
    });
    render(
      <Provider store={store}>
        <Toasts />
      </Provider>,
    );
    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("Saved changes");
    await user.click(within(toast).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("Saved changes")).not.toBeInTheDocument());
  });

  it("keeps the update download action working", async () => {
    const user = userEvent.setup();
    const downloadAndInstallUpdate = vi.fn().mockResolvedValue(undefined);
    const previousApi = window.api;
    window.api = { ...previousApi, downloadAndInstallUpdate } as typeof window.api;
    const setIsUpdateAvailable = vi.fn();
    try {
      render(
        <Provider store={makeStore()}>
          <LocalizationContext.Provider
            value={{ updateAvailable: "Update available", newVersionAvailable: "A new version", download: "Download" }}
          >
            <UpdateNotification
              downloadURL="https://example.test/update.exe"
              releaseNotesURL=""
              setIsUpdateAvailable={setIsUpdateAvailable}
            />
          </LocalizationContext.Provider>
        </Provider>,
      );
      const download = screen.getByRole("button", { name: "Download" });
      expect(download).toHaveClass("bg-blue-700");
      await user.click(download);
      expect(setIsUpdateAvailable).toHaveBeenCalledWith(false);
      expect(downloadAndInstallUpdate).toHaveBeenCalledWith("https://example.test/update.exe");
    } finally {
      window.api = previousApi;
    }
  });
});
