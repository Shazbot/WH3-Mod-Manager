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

const renderSkill = (data: SkillData, app: Partial<AppState> = {}) => {
  const store = configureStore({
    reducer: { app: appReducer },
    preloadedState: { app: { ...initialState, ...app } },
  });
  const nodeRequirements = { node_child: { single: ["node_parent"], multiple: [], numMultiple: 0 } };
  return render(
    <Provider store={store}>
      <SkillsDataContext.Provider value={treeSkillsData("tab", nodeRequirements)}>
        <Skill data={data} />
      </SkillsDataContext.Provider>
    </Provider>,
  );
};

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

  it("draws a padlock when the parent skill is not levelled", () => {
    const { container } = renderSkill(skillData);

    expect(container.querySelector('img[alt="inactive"]')).not.toBeNull();
    expect(container.querySelector('img[alt="padlock"]')).not.toBeNull();
    expect(container.querySelector('img[alt="lockedRank"]')).toBeNull();
  });

  it("draws the rank chains instead of the padlock when the rank is too low", () => {
    const { container } = renderSkill({ ...skillData, unlockRank: 5 }, { skillNodesToLevel: { node_parent: 1 } });

    expect(container.querySelector('img[alt="lockedRank"]')).not.toBeNull();
    expect(container.querySelector('img[alt="padlock"]')).toBeNull();
  });

  it("draws a levelled skill on the selected tab with its pips lit", () => {
    const { container } = renderSkill(
      { ...skillData, numLevels: 3 },
      { skillNodesToLevel: { node_parent: 1, node_child: 2 } },
    );

    expect(container.querySelector('img[alt="selected"]')).not.toBeNull();
    expect(container.querySelector('img[alt="inactive"]')).toBeNull();
    expect(container.querySelector(".grayscale")).toBeNull();
    expect(container.querySelectorAll('img[alt="skillLevelLitIcon"]')).toHaveLength(2);
  });
});
