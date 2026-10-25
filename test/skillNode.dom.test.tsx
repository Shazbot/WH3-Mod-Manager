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
    taggedImages: {},
    effectAttributes: {},
    skillLockTexts: {},
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

const renderSkill = (data: SkillData, app: Partial<AppState> = {}, tree: Partial<SkillsData> = {}) => {
  const store = configureStore({
    reducer: { app: appReducer },
    preloadedState: { app: { ...initialState, ...app } },
  });
  const nodeRequirements = { node_child: { single: ["node_parent"], multiple: [], numMultiple: 0 } };
  return render(
    <localizationContext.Provider value={enTranslation}>
      <Provider store={store}>
        <SkillsDataContext.Provider value={{ ...treeSkillsData("tab", nodeRequirements), ...tree }}>
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

  it("draws a padlock, not chains, when the rank is too low", () => {
    const { container } = renderSkill({ ...skillData, unlockRank: 5 }, { skillNodesToLevel: { node_parent: 1 } });

    expect(container.querySelector('img[alt="padlock"]')).not.toBeNull();
    expect(container.querySelector('img[alt="lockedRank"]')).toBeNull();
  });

  it("draws chains instead of the padlock when another skill locks it out", () => {
    const { container } = renderSkill(
      skillData,
      { skillNodesToLevel: { node_parent: 1, node_other: 1 } },
      {
        currentSkills: [{ id: "skill_other", nodeId: "node_other" } as Skill],
        nodeToSkillLocks: { node_child: [["skill_other", 1]] },
      },
    );

    expect(container.querySelector('img[alt="lockedRank"]')).not.toBeNull();
    expect(container.querySelector('img[alt="padlock"]')).toBeNull();
  });

  it("previews chains on the skills that the hovered skill would lock out", () => {
    const tree = {
      currentSkills: [{ id: "skill_child", nodeId: "node_child" } as Skill],
      nodeToSkillLocks: { node_child: [["skill_locker", 1]] as [string, number][] },
    };
    const locker = renderSkill({ ...skillData, id: "skill_locker", nodeId: "node_locker" }, {}, tree).container
      .firstElementChild!;
    const { container } = renderSkill(skillData, { skillNodesToLevel: { node_parent: 1 } }, tree);
    expect(container.querySelector('img[alt="lockedRank"]')).toBeNull();

    fireEvent.mouseEnter(locker);
    expect(container.querySelector('img[alt="lockedRank"]')).not.toBeNull();

    fireEvent.mouseLeave(locker);
    expect(container.querySelector('img[alt="lockedRank"]')).toBeNull();
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

  it("shows a hovered level pip's effects in the tooltip", () => {
    vi.useFakeTimers();
    try {
      const levelEffect = (level: number) =>
        ({
          key: `effect_${level}`,
          effectKey: `effect_${level}`,
          localizedKey: `Level ${level} effect`,
          level,
        }) as Effect;
      const { container } = renderSkill(
        { ...skillData, numLevels: 3, effects: [levelEffect(1), levelEffect(2), levelEffect(3)] },
        { skillNodesToLevel: { node_parent: 1 } },
      );

      const pips = container.querySelectorAll('img[alt="skillLevelImg"]');
      fireEvent.mouseEnter(pips[2].parentElement!);
      act(() => void vi.advanceTimersByTime(250));
      expect(screen.getByText("Level 3 effect")).not.toBeNull();
      expect(screen.queryByText("Level 1 effect")).toBeNull();
      expect(container.querySelector('img[alt="levelHover"]')).not.toBeNull();

      // Off the pip but still on the card.
      fireEvent.mouseLeave(pips[2].parentElement!, { relatedTarget: pips[2].parentElement!.parentElement });
      expect(screen.getByText("Level 1 effect")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it("leaves effects the game hides out of the tooltip", () => {
    vi.useFakeTimers();
    try {
      const effect = (name: string, priority: string) =>
        ({ key: name, effectKey: name, localizedKey: name, level: 1, priority }) as Effect;
      const { container } = renderSkill({
        ...skillData,
        effects: [effect("Shown effect", "51"), effect("Hidden effect", "0")],
      });

      fireEvent.mouseEnter(container.firstElementChild!);
      act(() => void vi.advanceTimersByTime(250));
      expect(screen.getByText("Shown effect")).not.toBeNull();
      expect(screen.queryByText("Hidden effect")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the spell an effect row names beside the tooltip while the row is hovered", () => {
    vi.useFakeTimers();
    try {
      const spell = (key: string, name: string, overpowerOption?: string) =>
        ({
          key,
          name,
          description: "",
          sourceTypeName: "",
          loreGroupName: "",
          abilityTypeName: "",
          overpowerOption,
          stats: {},
          bonuses: [],
          additionalUiEffects: [],
        }) as AbilityTooltipData;
      const overcast = {
        key: "overcast",
        effectKey: "overcast",
        localizedKey: 'Overcast spell: "Leech Upgraded"',
        level: 1,
        priority: "51",
      } as Effect;
      const cooldown = {
        ...overcast,
        key: "cooldown",
        effectKey: "cooldown",
        localizedKey: 'Cooldown: -30% to "Leech"',
      };
      const { container } = renderSkill(
        { ...skillData, effects: [overcast, cooldown] },
        {},
        {
          abilityTooltipsByKey: {
            leech: spell("leech", "Leech", "leech_upgraded"),
            leech_upgraded: spell("leech_upgraded", "Leech Upgraded"),
          },
          effectToUnitAbilityEnables: {
            overcast: [
              { unitAbilityKey: "leech", bonusValueId: "enable" },
              { unitAbilityKey: "leech_upgraded", bonusValueId: "enable_overcharge" },
            ],
            cooldown: [{ unitAbilityKey: "leech", bonusValueId: "enable" }],
          },
        },
      );

      // The skill's tooltip sticks first, so the mouse can reach its rows.
      fireEvent.mouseEnter(container.firstElementChild!);
      act(() => void vi.advanceTimersByTime(600));
      expect(screen.queryByText("Leech Upgraded")).toBeNull();

      const row = container.querySelector('img[alt="tooltipAvailable"]')!.closest("[id]")!;
      fireEvent.mouseEnter(row);
      expect(screen.getByText("Leech Upgraded")).not.toBeNull();
      fireEvent.mouseLeave(row);
      expect(screen.queryByText("Leech Upgraded")).toBeNull();

      // After the stick delay the spell's tooltip stays up while the mouse moves into it.
      fireEvent.mouseEnter(row);
      const spellTooltip = () => screen.getByText("Leech Upgraded").closest(".ml-1")!;
      const isSpellLockFilling = () =>
        spellTooltip().querySelector('img[alt="lockBar"]')!.parentElement!.classList.contains("skillTooltipLockFill");
      expect(isSpellLockFilling()).toBe(true);
      act(() => void vi.advanceTimersByTime(350));
      expect(isSpellLockFilling()).toBe(false);
      // Crossing another spell's row on the way does not swap it out.
      const cooldownRow = container.querySelectorAll('img[alt="tooltipAvailable"]')[1].closest("[id]")!;
      fireEvent.mouseLeave(row);
      fireEvent.mouseEnter(cooldownRow);
      act(() => void vi.advanceTimersByTime(100));
      fireEvent.mouseLeave(cooldownRow);
      fireEvent.mouseEnter(spellTooltip());
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.getByText("Leech Upgraded")).not.toBeNull();
      // Back into the skill's tooltip, which stays up.
      fireEvent.mouseLeave(spellTooltip(), { relatedTarget: cooldownRow.parentElement });
      act(() => void vi.advanceTimersByTime(150));
      expect(screen.queryByText("Leech Upgraded")).toBeNull();
      expect(cooldownRow.isConnected).toBe(true);

      // Resting on another row does.
      fireEvent.mouseEnter(row);
      act(() => void vi.advanceTimersByTime(350));
      fireEvent.mouseLeave(row);
      fireEvent.mouseEnter(cooldownRow);
      act(() => void vi.advanceTimersByTime(250));
      expect(screen.queryByText("Leech Upgraded")).toBeNull();
      expect(screen.getByText("Leech")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists effects by priority and colours them by whether they help", () => {
    vi.useFakeTimers();
    try {
      const effect = (name: string, priority: string, isGood: boolean) =>
        ({ key: name, effectKey: name, localizedKey: name, level: 1, priority, isGood }) as Effect;
      const { container } = renderSkill({
        ...skillData,
        effects: [effect("Third", "541", true), effect("First", "2", true), effect("Second", "401", false)],
      });

      fireEvent.mouseEnter(container.firstElementChild!);
      act(() => void vi.advanceTimersByTime(250));
      const rows = ["First", "Second", "Third"].map((name) => screen.getByText(name));
      expect(rows[0].compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(rows[1].compareDocumentPosition(rows[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(rows[0].closest("span[style]")!.getAttribute("style")).toContain("rgb(160, 255, 55)");
      expect(rows[1].closest("span[style]")!.getAttribute("style")).toContain("rgb(255, 45, 45)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds the game's rank lock text to the description", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderSkill(
        { ...skillData, description: "Lead.", unlockRank: 5 },
        { skillNodesToLevel: { node_parent: 1 } },
        { skillLockTexts: { rank: "\n\n[[col:red]]Available at rank %d.[[/col]]" } },
      );

      fireEvent.mouseEnter(container.firstElementChild!);
      act(() => void vi.advanceTimersByTime(250));
      expect(screen.getByText("Available at rank 5.")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an effect's unit attributes under the tooltip while its row is hovered", () => {
    vi.useFakeTimers();
    try {
      const unbreakable = {
        key: "unbreakable",
        effectKey: "unbreakable",
        localizedKey: "Unbreakable",
        level: 1,
        priority: "320",
      } as Effect;
      const { container } = renderSkill(
        { ...skillData, effects: [unbreakable] },
        {},
        { effectAttributes: { unbreakable: [{ name: "Unbreakable", description: "Never routs." }] } },
      );

      fireEvent.mouseEnter(container.firstElementChild!);
      act(() => void vi.advanceTimersByTime(250));
      expect(screen.queryByText("Never routs.")).toBeNull();

      const row = container.querySelector('img[alt="tooltipAvailable"]')!.closest("[id]")!;
      fireEvent.mouseEnter(row);
      expect(screen.getByText("Never routs.")).not.toBeNull();
      fireEvent.mouseLeave(row);
      expect(screen.queryByText("Never routs.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws a 59 px ability icon from the skills folder in the smaller ability icon box", () => {
    const { container } = renderSkill({ ...skillData, skillIcon: "ability.png" });
    const icon = container.querySelector('img[alt="ability.png"]') as HTMLImageElement;
    expect(icon.style.width).toBe("72px");

    Object.defineProperty(icon, "naturalWidth", { value: 59 });
    fireEvent.load(icon);
    expect(icon.style.width).toBe("48px");
  });

  it("draws a tiny trait icon at its own size in the full icon box", () => {
    const { container } = renderSkill({ ...skillData, skillIcon: "trait.png" });
    const icon = container.querySelector('img[alt="trait.png"]') as HTMLImageElement;

    Object.defineProperty(icon, "naturalWidth", { value: 24 });
    fireEvent.load(icon);
    expect(icon.style.width).toBe("72px");
    expect(icon.classList).toContain("object-none");
  });

  it("draws the auto-grant badge until the rank that grants the skill", () => {
    const autoSkill = { ...skillData, autoUnlocks: [{ rank: 4, skillLevel: 1 }] };

    expect(renderSkill(autoSkill).container.querySelector('img[alt="autoUnlockRank"]')).not.toBeNull();
    expect(renderSkill(autoSkill, { currentRank: 4 }).container.querySelector('img[alt="autoUnlockRank"]')).toBeNull();
  });

  it("keeps the badge for a later upgrade once an earlier level is held", () => {
    const autoSkill = {
      ...skillData,
      numLevels: 3,
      autoUnlocks: [
        { rank: 1, skillLevel: 1 },
        { rank: 11, skillLevel: 2 },
      ],
    };
    const app = { currentRank: 5, skillNodesToLevel: { node_parent: 1, node_child: 1 } };

    expect(renderSkill(autoSkill, app).container.querySelector('img[alt="autoUnlockRank"]')).not.toBeNull();
    expect(
      renderSkill(autoSkill, { ...app, currentRank: 11 }).container.querySelector('img[alt="autoUnlockRank"]'),
    ).toBeNull();
  });
});
