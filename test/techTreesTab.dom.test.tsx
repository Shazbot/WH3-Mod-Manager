import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import TechTreesTab from "../src/components/techTrees/TechTreesTab";

vi.mock("../src/components/techTrees/TechTreeCanvas", () => ({
  __esModule: true,
  default: () => <div data-testid="tech-tree-canvas" />,
}));

describe("TechTreesTab", () => {
  it("labels node sets that contain no nodes", async () => {
    const getTechnologyNodeSets = vi.fn().mockResolvedValue([
      { key: "empty_set", localizedName: "Empty Set", nodeCount: 0 },
      { key: "populated_set", localizedName: "Populated Set", nodeCount: 2 },
    ] satisfies TechnologyNodeSetSummary[]);
    window.api = {
      ...window.api,
      getTechnologyNodeSets,
    } as NonNullable<Window["api"]>;

    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: { app: initialState },
    });

    render(
      <Provider store={store}>
        <TechTreesTab />
      </Provider>,
    );

    await waitFor(() => expect(getTechnologyNodeSets).toHaveBeenCalledTimes(1));

    expect(screen.getByText("No nodes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Empty Set.*No nodes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Populated Set populated_set$/ })).toBeInTheDocument();
  });
});
