import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";

import initialState from "../src/initialAppState";
import appReducer from "../src/appSlice";
import Skill, { SkillData } from "../src/components/skillsViewer/Skill";
import { SkillsDataContext } from "../src/components/skillsViewer/skillsDataContext";
import localizationContext from "../src/localizationContext";
import enTranslation from "../locales/en/translation.json";

vi.mock("@xyflow/react", () => ({
  Position: { Left: "left", Right: "right" },
  Handle: () => null,
  NodeToolbar: ({ children, isVisible }: { children?: React.ReactNode; isVisible?: boolean }) =>
    isVisible ? <>{children}</> : null,
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
    <localizationContext.Provider value={enTranslation}>
      <Provider store={store}>
        <SkillsDataContext.Provider value={treeSkillsData("tab", nodeRequirements)}>
          <Skill data={data} />
        </SkillsDataContext.Provider>
      </Provider>
    </localizationContext.Provider>,
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

  it("shows the tooltip after the appear delay and sticks it after the stick delay", () => {
    vi.useFakeTimers();
    try {
      const effect = { key: "effect_1", effectKey: "effect_1", localizedKey: "Level 1 effect", level: 1 } as Effect;
      const { container } = renderSkill({ ...skillData, effects: [effect] }, { skillNodesToLevel: { node_parent: 1 } });
      const card = container.firstElementChild!;
      const tooltip = () => screen.queryByText("Level 1 effect")?.closest(".nowheel");
      const isBarFilling = () =>
        container.querySelector('img[alt="lockBar"]')!.parentElement!.classList.contains("skillTooltipLockFill");

      // Passing over the card before the appear delay shows nothing.
      fireEvent.mouseEnter(card);
      act(() => void vi.advanceTimersByTime(200));
      expect(container.querySelector('img[alt="hover"]')).not.toBeNull();
      fireEvent.mouseLeave(card);
      act(() => void vi.advanceTimersByTime(1000));
      expect(tooltip()).toBeFalsy();

      fireEvent.mouseEnter(card);
      act(() => void vi.advanceTimersByTime(250));
      expect(isBarFilling()).toBe(true);
      act(() => void vi.advanceTimersByTime(350));
      expect(isBarFilling()).toBe(false);
      // A stuck tooltip waits longer after leaving the card, so a slow move into it keeps it.
      fireEvent.mouseLeave(card);
      act(() => void vi.advanceTimersByTime(250));
      fireEvent.mouseEnter(tooltip()!);
      act(() => void vi.advanceTimersByTime(1000));
      expect(tooltip()).toBeTruthy();
      // Leaving the tooltip itself closes it after the normal hide delay.
      fireEvent.mouseLeave(tooltip()!);
      act(() => void vi.advanceTimersByTime(100));
      expect(tooltip()).toBeTruthy();
      act(() => void vi.advanceTimersByTime(50));
      expect(tooltip()).toBeFalsy();

      // Shown but not stuck yet, so moving into it does not keep it.
      fireEvent.mouseEnter(card);
      act(() => void vi.advanceTimersByTime(250));
      fireEvent.mouseLeave(card);
      fireEvent.mouseEnter(tooltip()!);
      act(() => void vi.advanceTimersByTime(150));
      expect(tooltip()).toBeFalsy();

      // Stuck, but the mouse never reaches the tooltip.
      fireEvent.mouseEnter(card);
      act(() => void vi.advanceTimersByTime(600));
      fireEvent.mouseLeave(card);
      act(() => void vi.advanceTimersByTime(1000));
      expect(tooltip()).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a stuck tooltip when another card's tooltip appears", () => {
    vi.useFakeTimers();
    try {
      const effect = (name: string) => ({ key: name, effectKey: name, localizedKey: name, level: 1 }) as Effect;
      const first = renderSkill({ ...skillData, effects: [effect("First effect")] }).container.firstElementChild!;
      const second = renderSkill({ ...skillData, nodeId: "node_second", effects: [effect("Second effect")] }).container
        .firstElementChild!;

      fireEvent.mouseEnter(first);
      act(() => void vi.advanceTimersByTime(600));
      fireEvent.mouseLeave(first);
      // Crossing another card on the way to the tooltip leaves it open.
      fireEvent.mouseEnter(second);
      expect(screen.getByText("First effect")).not.toBeNull();
      act(() => void vi.advanceTimersByTime(250));
      expect(screen.queryByText("First effect")).toBeNull();
      expect(screen.getByText("Second effect")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
