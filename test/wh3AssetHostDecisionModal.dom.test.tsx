import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import Wh3AssetHostDecisionModal from "../src/components/Wh3AssetHostDecisionModal";
import LocalizationContext from "../src/localizationContext";
import enTranslation from "../locales/en/translation.json";
import type { Wh3AssetHostDecisionRequest } from "../src/wh3AssetHostClient";

const originalApi = window.api;

const decisionRequest: Wh3AssetHostDecisionRequest = {
  protocolVersion: 1,
  requestId: "decision-1",
  command: "decisionRequest",
  decisionType: "missingSkeleton",
  skeletonName: "missing_skeleton",
  message: "A skeleton is not present.",
};

afterEach(() => {
  window.api = originalApi;
});

const renderModal = () => {
  let listener: ((event: Electron.IpcRendererEvent, request: Wh3AssetHostDecisionRequest) => void) | undefined;
  const respond = vi.fn().mockResolvedValue({ success: true });
  window.api = {
    onWh3AssetHostDecisionRequest: (nextListener) => {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
    respondWh3AssetHostDecision: respond,
  } as unknown as NonNullable<Window["api"]>;

  render(
    <LocalizationContext.Provider value={enTranslation}>
      <Wh3AssetHostDecisionModal />
    </LocalizationContext.Provider>,
  );

  return {
    listener: (request = decisionRequest) => act(() => listener?.({} as Electron.IpcRendererEvent, request)),
    respond,
  };
};

describe("Wh3AssetHostDecisionModal", () => {
  it("shows the host request and sends the continue action", async () => {
    const user = userEvent.setup();
    const { listener, respond } = renderModal();

    listener();
    expect(screen.getByRole("dialog")).toHaveTextContent("missing_skeleton");

    await user.click(screen.getByTestId("wh3-asset-host-continue-skeleton"));

    expect(respond).toHaveBeenCalledWith("decision-1", "continueWithoutSkeleton");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancels when the modal is dismissed", async () => {
    const user = userEvent.setup();
    const { listener, respond } = renderModal();

    listener();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(respond).toHaveBeenCalledWith("decision-1", "cancelExport");
  });
});
