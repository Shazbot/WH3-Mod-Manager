import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Onboarding from "../src/components/Onboarding";
import LocalizationContext from "../src/localizationContext";
import { setIsOnboardingToRun, setWasOnboardingEverRun } from "../src/appSlice";

const { dispatch, app } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  app: {
    isOnboardingToRun: true,
    isSetAppFolderPathsDone: true,
    appFolderPaths: { contentFolder: "content", gamePath: "game" },
  },
}));

vi.mock("../src/hooks", () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: (selector: (state: { app: typeof app }) => unknown) => selector({ app }),
}));

describe("onboarding with React 19", () => {
  beforeEach(() => {
    dispatch.mockClear();
    app.isOnboardingToRun = true;
  });

  it("renders the real tour and records skipping it", async () => {
    const user = userEvent.setup();
    render(
      <LocalizationContext.Provider value={{ onbWelcome: "Welcome to WHMM" }}>
        <Onboarding />
      </LocalizationContext.Provider>,
    );

    expect(await screen.findByText("Welcome to WHMM")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /skip/i }));
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(setIsOnboardingToRun(false));
      expect(dispatch).toHaveBeenCalledWith(setWasOnboardingEverRun(true));
    });
  });

  it("keeps the tour hidden when it has not been requested", () => {
    app.isOnboardingToRun = false;
    render(<Onboarding />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
