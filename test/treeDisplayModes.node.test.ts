import { describe, expect, it } from "vitest";

import appReducer, {
  setFromConfig,
  setSkillTreesDisplayMode,
  setTechnologyTreesDisplayMode,
} from "../src/appSlice";
import initialState from "../src/initialAppState";

const createConfigState = (overrides: Partial<AppStateToRead> = {}): AppStateToRead =>
  ({
    ...initialState,
    currentPreset: {
      ...initialState.currentPreset,
      mods: [],
      version: 2,
    },
    presets: [],
    hiddenMods: [],
    alwaysEnabledMods: [],
    categories: [],
    categoryColors: {},
    packDataOverwrites: {},
    userFlowOptions: {},
    currentGame: "wh3",
    isFeaturesForModdersEnabled: true,
    currentLanguage: "en",
    ...overrides,
  }) as AppStateToRead;

describe("tree display modes", () => {
  it("falls back to mods when the skills tab is disabled", () => {
    const state = appReducer(
      {
        ...initialState,
        currentGame: "wh3",
        currentTab: "skills",
        skillTreesDisplayMode: "tab",
      },
      setSkillTreesDisplayMode("window"),
    );

    expect(state.skillTreesDisplayMode).toBe("window");
    expect(state.currentTab).toBe("mods");
  });

  it("falls back to mods when the tech trees tab is disabled", () => {
    const state = appReducer(
      {
        ...initialState,
        currentTab: "techTrees",
        isFeaturesForModdersEnabled: true,
        technologyTreesDisplayMode: "tab",
      },
      setTechnologyTreesDisplayMode("off"),
    );

    expect(state.technologyTreesDisplayMode).toBe("off");
    expect(state.currentTab).toBe("mods");
  });

  it("defaults missing config values to window for both tree modes", () => {
    const legacyConfig = createConfigState({
      skillTreesDisplayMode: undefined,
      technologyTreesDisplayMode: undefined,
    });

    const state = appReducer(initialState, setFromConfig(legacyConfig));

    expect(state.skillTreesDisplayMode).toBe("window");
    expect(state.technologyTreesDisplayMode).toBe("window");
  });
});
