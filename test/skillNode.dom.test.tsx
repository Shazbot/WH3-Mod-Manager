import React from "react";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";

import initialState from "../src/initialAppState";
import appReducer from "../src/appSlice";
import Skill, { SkillData } from "../src/components/skillsViewer/Skill";
import { SkillsDataContext } from "../src/components/skillsViewer/skillsDataContext";

vi.mock("@xyflow/react", () => ({
  Position: { Left: "left", Right: "right" },
  Handle: () => null,
  NodeToolbar: () => null,
}));

const treeSkillsData = (subtype: string, nodeRequirements: SkillsData["nodeRequirements"]) =>
  ({
    currentSubtype: subtype,
    currentSubtypeIndex: 0,
    currentSkills: [],
    subtypeToNumSets: { [subtype]: 1 },
    subtypesToSet: { [subtype]: [subtype] },
    nodeLinks: {},
    nodeRequirements,
    icons: {},
    subtypes: [subtype],
    subtypesToLocalizedNames: {},
    nodeToSkillLocks: {},
    abilityTooltipsByKey: {},
    effectToUnitAbilityEnables: {},
  }) as SkillsData;

const skillData = {
  skillBackground: "",
  skillIconBackground: "",
  skillIcon: "",
  skillLevelImg: "",
  skillLevelLitIcon: "",
  tooltipFrame: "",
  label: "Child",
  row: 0,
  isGrouping: false,
  numLevels: 1,
  description: "",
  effects: [],
  isAbilityIcon: false,
  imgPath: "",
  id: "skill_child",
  nodeId: "node_child",
  origIndent: "0",
  origTier: "1",
  isHiddentInUI: false,
  isCheckingSkillRequirements: true,
  unlockRank: 0,
} as SkillData;

describe("Skill", () => {
  it("checks requirements against its own tab's data, not the latest response in Redux", () => {
    // Redux holds another tree, as it does after switching back to an older tab.
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: { app: { ...initialState, skillsData: treeSkillsData("other", {}) } },
    });
    const tabSkillsData = treeSkillsData("tab", {
      node_child: { single: ["node_parent"], multiple: [], numMultiple: 0 },
    });

    const { container } = render(
      <Provider store={store}>
        <SkillsDataContext.Provider value={tabSkillsData}>
          <Skill data={skillData} />
        </SkillsDataContext.Provider>
      </Provider>,
    );

    // The parent is not levelled, so the tab's requirement greys the node out.
    expect(container.querySelector(".grayscale")).not.toBeNull();
  });
});
