import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import SkillsTreeView from "../src/components/skillsViewer/SkillsTreeView";

const subtypes = ["emp_karl_franz", "vmp_mannfred", "dwf_thorgrim"];

const skillsData = {
  currentSubtype: "emp_karl_franz",
  currentSubtypeIndex: 0,
  currentSkills: [],
  subtypeToNumSets: Object.fromEntries(subtypes.map((subtype) => [subtype, 1])),
  subtypesToSet: Object.fromEntries(subtypes.map((subtype) => [subtype, [`wh_main_skill_node_set_${subtype}`]])),
  nodeLinks: {},
  nodeRequirements: {},
  icons: {},
  subtypes,
  subtypesToLocalizedNames: {},
  nodeToSkillLocks: {},
  abilityTooltipsByKey: {},
  effectToUnitAbilityEnables: {},
  allEffects: [],
  allSkills: [],
  allSkillIcons: [],
} as SkillsData;

const createStore = () =>
  configureStore({
    reducer: { app: appReducer },
    preloadedState: { app: { ...initialState, skillsData } },
  });

describe("SkillsTreeView", () => {
  it("selects on the first click and tells a double-click that the click already selected the row", () => {
    const onSelect = vi.fn();
    const onDoubleClick = vi.fn();

    render(
      <Provider store={createStore()}>
        <SkillsTreeView tableFilter="" onSelect={onSelect} onDoubleClick={onDoubleClick} />
      </Provider>,
    );

    const thorgrim = screen.getByText("dwf_thorgrim");
    fireEvent.click(thorgrim, { detail: 1 });
    expect(onSelect).toHaveBeenCalledWith("dwf_thorgrim", 0);

    fireEvent.click(thorgrim, { detail: 2 });
    fireEvent.dblClick(thorgrim);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDoubleClick).toHaveBeenCalledWith("dwf_thorgrim", 0, true);

    // A double-click on the row that was already selected leaves the active tab alone.
    fireEvent.click(thorgrim, { detail: 1 });
    fireEvent.click(thorgrim, { detail: 2 });
    fireEvent.dblClick(thorgrim);
    expect(onDoubleClick).toHaveBeenLastCalledWith("dwf_thorgrim", 0, false);
  });

  it("deselects the row when the selection is cleared", () => {
    const store = createStore();
    const onSelect = vi.fn();
    const renderTree = (isSelectionCleared: boolean) => (
      <Provider store={store}>
        <SkillsTreeView tableFilter="" onSelect={onSelect} isSelectionCleared={isSelectionCleared} />
      </Provider>
    );

    const { rerender } = render(renderTree(false));
    const thorgrim = screen.getByText("dwf_thorgrim");
    const row = thorgrim.closest('[role="treeitem"]')!;
    fireEvent.click(thorgrim, { detail: 1 });
    expect(row).toHaveAttribute("aria-selected", "true");

    rerender(renderTree(true));
    expect(row).not.toHaveAttribute("aria-selected", "true");
    expect(onSelect).toHaveBeenCalledTimes(1);

    // The row can be picked again while the selection stays cleared.
    fireEvent.click(thorgrim, { detail: 1 });
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("reports a hovered row once the pointer rests on it, and right away on mouse down", () => {
    vi.useFakeTimers();
    const onHover = vi.fn();

    render(
      <Provider store={createStore()}>
        <SkillsTreeView tableFilter="" onHover={onHover} />
      </Provider>,
    );

    // Passing over a row does not count.
    const mannfred = screen.getByText("vmp_mannfred");
    fireEvent.mouseEnter(mannfred);
    fireEvent.mouseLeave(mannfred);
    vi.advanceTimersByTime(500);
    expect(onHover).not.toHaveBeenCalled();

    const thorgrim = screen.getByText("dwf_thorgrim");
    fireEvent.mouseEnter(thorgrim);
    vi.advanceTimersByTime(100);
    expect(onHover).toHaveBeenCalledWith("dwf_thorgrim", 0);

    fireEvent.mouseDown(screen.getByText("emp_karl_franz"), { detail: 1, button: 0 });
    expect(onHover).toHaveBeenLastCalledWith("emp_karl_franz", 0);
    expect(onHover).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
