import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";

import appReducer, { setAutoSkillNodeLevels, setSkillNodeLevel } from "../src/appSlice";
import initialState from "../src/initialAppState";
import { getAutoUnlockedLevel } from "../src/skills";

describe("getAutoUnlockedLevel", () => {
  // Raw DB ranks 0, 10 and 20 show as ranks 1, 11 and 21.
  const unlocks = [
    { rank: 0, skillLevel: 1 },
    { rank: 10, skillLevel: 2 },
    { rank: 20, skillLevel: 3 },
  ];

  it("grants the highest level the rank has reached", () => {
    expect(getAutoUnlockedLevel(unlocks, 1, 3)).toBe(1);
    expect(getAutoUnlockedLevel(unlocks, 10, 3)).toBe(1);
    expect(getAutoUnlockedLevel(unlocks, 11, 3)).toBe(2);
    expect(getAutoUnlockedLevel(unlocks, 30, 3)).toBe(3);
  });

  it("grants nothing below the first rank and never more than the skill's levels", () => {
    expect(getAutoUnlockedLevel([{ rank: 8, skillLevel: 1 }], 8, 1)).toBe(0);
    expect(getAutoUnlockedLevel(unlocks, 30, 2)).toBe(2);
  });
});

describe("automatic skill levels", () => {
  const makeStore = () => configureStore({ reducer: { app: appReducer }, preloadedState: { app: initialState } });

  it("leaves automatic levels out of the rank", () => {
    const store = makeStore();
    store.dispatch(setSkillNodeLevel({ skillNodeId: "bought", level: 2 }));
    expect(store.getState().app.currentRank).toBe(3);

    store.dispatch(setAutoSkillNodeLevels({ auto: 3 }));
    expect(store.getState().app.skillNodesToLevel.auto).toBe(3);
    expect(store.getState().app.currentRank).toBe(3);

    store.dispatch(setSkillNodeLevel({ skillNodeId: "bought", level: 1 }));
    expect(store.getState().app.currentRank).toBe(2);
    store.dispatch(setAutoSkillNodeLevels({ auto: 1 }));
    expect(store.getState().app.skillNodesToLevel.auto).toBe(1);
    expect(store.getState().app.currentRank).toBe(2);
  });
});
