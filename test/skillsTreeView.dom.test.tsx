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
});
