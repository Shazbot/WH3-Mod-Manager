import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import WorkshopOptimizerOptions from "../src/components/WorkshopOptimizerOptions";

const renderOptions = () => {
  const store = configureStore({ reducer: { app: appReducer }, preloadedState: { app: initialState } });
  render(<Provider store={store}><WorkshopOptimizerOptions /></Provider>);
  fireEvent.click(screen.getByText("Advanced optimization settings"));
  return store;
};

describe("advanced optimizer option availability", () => {
  it("shows atlas prerequisites and retains choices when atlas building is switched off", () => {
    const store = renderOptions();
    const share = screen.getByRole("checkbox", { name: /Share atlases across variants/ });
    const build = screen.getByRole("checkbox", { name: /^Build new atlases \(experimental\)/ });
    expect(share).toBeDisabled();
    expect(share).toBeChecked();
    expect(screen.getAllByText("Requires Build new atlases.").length).toBeGreaterThan(1);

    fireEvent.click(build);
    expect(share).toBeEnabled();
    fireEvent.click(share);
    expect(store.getState().app.workshopOptimizerOptions.shareAtlasesAcrossVmds).toBe(false);
    fireEvent.click(build);
    expect(share).toBeDisabled();
    expect(share).not.toBeChecked();
    fireEvent.click(build);
    expect(share).toBeEnabled();
    expect(share).not.toBeChecked();
  });

  it("shows compaction and cross-rigid-only dependencies", () => {
    renderOptions();
    const compact = screen.getByRole("checkbox", { name: /^Compact textures/ });
    const alpha = screen.getByRole("checkbox", { name: /Remove unused alpha/ });
    fireEvent.click(compact);
    expect(alpha).toBeDisabled();
    expect(screen.getByText("Requires Compact textures.")).toBeInTheDocument();
    fireEvent.click(compact);
    expect(alpha).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /^Cross-rigid merges only/ }));
    expect(compact).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Detailed report audits/ })).toBeEnabled();
    expect(screen.getAllByText("Unavailable while Cross-rigid merges only is on.").length).toBeGreaterThan(1);
  });
});
