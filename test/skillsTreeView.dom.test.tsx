import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import SkillsTreeView from "../src/components/skillsViewer/SkillsTreeView";

const nodeSetKeys = [
  "wh_main_skill_node_set_emp_karl_franz",
  "wh_main_skill_node_set_emp_balthasar_gelt",
  "wh_main_skill_node_emp_teclis_magic",
  "wh_main_skill_node_lzd_kroq_gar",
  "wh_main_skill_node_dwf_thorgrim",
  "wh_main_skill_node_vmp_mannfred",
];

const skillsData = {
  currentSubtype: "wh_main_emp_karl_franz",
  currentSubtypeIndex: 0,
  currentSkills: [],
  subtypeToNumSets: Object.fromEntries(nodeSetKeys.map((_, index) => [`subtype_${index}`, 1])),
  subtypesToSet: Object.fromEntries(nodeSetKeys.map((nodeSetKey, index) => [`subtype_${index}`, [nodeSetKey]])),
  nodeLinks: {},
  nodeRequirements: {},
  icons: {},
  subtypes: nodeSetKeys.map((_, index) => `subtype_${index}`),
  subtypesToLocalizedNames: {},
  nodeToSkillLocks: {},
  abilityTooltipsByKey: {},
  effectToUnitAbilityEnables: {},
} as SkillsData;

const outlierSkillsData = {
  ...skillsData,
  currentSubtype: "outlier_subtype",
  subtypeToNumSets: { outlier_subtype: 1 },
  subtypesToSet: {
    outlier_subtype: ["wh3_dlc123_skill_node_set_emp_louen"],
  },
  subtypes: ["outlier_subtype"],
} as SkillsData;

describe("SkillsTreeView", () => {
  it("also hides the repeated set marker in node-set mode", () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isShowingSkillNodeSetNames: true,
          skillsData,
        },
      },
    });

    render(
      <Provider store={store}>
        <SkillsTreeView tableFilter="" />
      </Provider>,
    );

    expect(screen.getByText("emp_karl_franz")).toBeInTheDocument();
    expect(screen.queryByText("set_emp_karl_franz")).not.toBeInTheDocument();

    const balthasar = screen.getByText("emp_balthasar_gelt");
    const karl = screen.getByText("emp_karl_franz");
    expect(Boolean(balthasar.compareDocumentPosition(karl) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("removes numeric game and DLC prefixes from unique node-set labels", () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isShowingSkillNodeSetNames: true,
          skillsData: outlierSkillsData,
        },
      },
    });

    render(
      <Provider store={store}>
        <SkillsTreeView tableFilter="" />
      </Provider>,
    );

    expect(screen.getByText("emp_louen")).toBeInTheDocument();
    expect(screen.queryByText("wh3_dlc123_skill_node_set_emp_louen")).not.toBeInTheDocument();
  });

  it("selects on the first click and tells a double-click that the click already selected the row", () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: { app: { ...initialState, isShowingSkillNodeSetNames: true, skillsData } },
    });
    const onSelect = vi.fn();
    const onDoubleClick = vi.fn();

    render(
      <Provider store={store}>
        <SkillsTreeView tableFilter="" onSelect={onSelect} onDoubleClick={onDoubleClick} />
      </Provider>,
    );

    const thorgrim = screen.getByText("dwf_thorgrim");
    fireEvent.click(thorgrim, { detail: 1 });
    expect(onSelect).toHaveBeenCalledWith("subtype_4", 0);

    fireEvent.click(thorgrim, { detail: 2 });
    fireEvent.dblClick(thorgrim);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDoubleClick).toHaveBeenCalledWith("subtype_4", 0, true);

    // A double-click on the row that was already selected leaves the active tab alone.
    fireEvent.click(thorgrim, { detail: 1 });
    fireEvent.click(thorgrim, { detail: 2 });
    fireEvent.dblClick(thorgrim);
    expect(onDoubleClick).toHaveBeenLastCalledWith("subtype_4", 0, false);
  });

  it("deselects the row when the selection is cleared", () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: { app: { ...initialState, isShowingSkillNodeSetNames: true, skillsData } },
    });
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
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: { app: { ...initialState, isShowingSkillNodeSetNames: true, skillsData } },
    });
    const onHover = vi.fn();

    render(
      <Provider store={store}>
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
    expect(onHover).toHaveBeenCalledWith("subtype_4", 0);

    fireEvent.mouseDown(screen.getByText("emp_karl_franz"), { detail: 1, button: 0 });
    expect(onHover).toHaveBeenLastCalledWith("subtype_0", 0);
    expect(onHover).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
