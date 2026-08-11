import React from "react";

import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import FlowPackDialog from "../src/components/FlowPackDialog";

describe("flow pack dialog", () => {
  const originalApi = window.api;
  const saveFlowToPack = vi.fn();
  const getPackData = vi.fn();

  beforeEach(() => {
    saveFlowToPack.mockReset();
    getPackData.mockReset();
    window.api = {
      ...originalApi,
      getFlowPackCatalog: vi.fn(async () => ({
        success: true,
        packs: [
          {
            path: "/mods/with-flows.pack",
            name: "with-flows.pack",
            humanName: "Enabled Flow Mod",
            isEnabled: true,
            hasFlows: true,
          },
          {
            path: "/mods/other.pack",
            name: "other.pack",
            humanName: "Other Mod",
            isEnabled: false,
            hasFlows: false,
          },
        ],
      })),
      getFlowFilesFromPack: vi.fn(async () => ({
        success: true,
        flowFiles: [{ name: "whmmflows\\existing.json", content: "{}" }],
      })),
      saveFlowToPack,
      getPackData,
    } as NonNullable<Window["api"]>;
  });

  afterEach(() => {
    window.api = originalApi;
  });

  it("asks before replacing an existing flow and saves after confirmation", async () => {
    const user = userEvent.setup();
    const onOpenFlow = vi.fn();
    saveFlowToPack
      .mockResolvedValueOnce({
        success: false,
        alreadyExists: true,
        packPath: "/mods/with-flows.pack",
        flowName: "whmmflows\\existing.json",
      })
      .mockResolvedValueOnce({
        success: true,
        packPath: "/mods/with-flows.pack",
        flowName: "whmmflows\\existing.json",
      });
    const store = configureStore({ reducer: { app: appReducer } });

    render(
      <Provider store={store}>
        <FlowPackDialog
          show
          mode="save"
          currentFile={"whmmflows\\existing.json"}
          currentPack="/mods/with-flows.pack"
          getFlowData={() => "{\"nodes\":[]}"}
          onClose={vi.fn()}
          onOpenFlow={onOpenFlow}
        />
      </Provider>,
    );

    await screen.findByRole("option", { name: "Enabled Flow Mod" });
    await user.click(screen.getByRole("button", { name: "Save To Pack" }));

    expect(await screen.findByRole("heading", { name: "Overwrite Flow?" })).toBeInTheDocument();
    expect(saveFlowToPack).toHaveBeenCalledWith(
      "/mods/with-flows.pack",
      "whmmflows\\existing.json",
      "{\"nodes\":[]}",
      false,
    );

    await user.click(screen.getByRole("button", { name: "Overwrite" }));
    await waitFor(() => expect(onOpenFlow).toHaveBeenCalledOnce());
    expect(saveFlowToPack).toHaveBeenLastCalledWith(
      "/mods/with-flows.pack",
      "whmmflows\\existing.json",
      "{\"nodes\":[]}",
      true,
    );
  });

  it("opens a selected flow through the viewer selection callback", async () => {
    const user = userEvent.setup();
    const onOpenFlow = vi.fn();
    const store = configureStore({ reducer: { app: appReducer } });

    render(
      <Provider store={store}>
        <FlowPackDialog
          show
          mode="load"
          currentPack="/mods/with-flows.pack"
          getFlowData={() => "{}"}
          onClose={vi.fn()}
          onOpenFlow={onOpenFlow}
        />
      </Provider>,
    );

    await screen.findByRole("radio", { name: "existing.json" });
    await user.click(screen.getByRole("button", { name: "Open Flow" }));

    expect(getPackData).toHaveBeenCalledWith("/mods/with-flows.pack");
    expect(onOpenFlow).toHaveBeenCalledWith({
      packPath: "/mods/with-flows.pack",
      flowFile: "whmmflows\\existing.json",
    });
  });
});
