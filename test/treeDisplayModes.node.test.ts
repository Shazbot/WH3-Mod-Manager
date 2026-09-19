import { describe, expect, it } from "vitest";

import appReducer, {
  setFromConfig,
  setCurrentTab,
  setSkillTreesDisplayMode,
  setTechnologyTreesDisplayMode,
  setUnitViewerMode,
} from "../src/appSlice";
import initialState from "../src/initialAppState";

const createConfigState = (overrides: Partial<ConfigForRenderer> = {}): ConfigForRenderer =>
  ({
    ...initialState,
    configVersion: 3,
    currentPreset: { name: "", mods: [], version: 2 },
    presets: [],
    modUserData: {},
    hiddenModNames: [],
    alwaysEnabledModNames: [],
    categories: [],
    categoryColors: {},
    packDataOverwrites: {},
    userFlowOptions: {},
    currentGame: "wh3",
    isFeaturesForModdersEnabled: true,
    currentLanguage: "en",
    ...overrides,
  }) as ConfigForRenderer;

describe("tree display modes", () => {
  it("allows Unit Viewer for WH3 without modder features and rejects it for other games", () => {
    const wh3State = appReducer(
      { ...initialState, currentGame: "wh3", isFeaturesForModdersEnabled: false },
      setCurrentTab("unitViewer"),
    );
    expect(wh3State.currentTab).toBe("unitViewer");

    const wh2State = appReducer(
      { ...initialState, currentGame: "wh2", isFeaturesForModdersEnabled: true },
      setCurrentTab("unitViewer"),
    );
    expect(wh2State.currentTab).toBe("mods");
  });

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

describe("unit viewer mode", () => {
  it("starts in visualize mode for new and pre-feature configs", () => {
    expect(initialState.unitViewerMode).toBe("visualize");

    const legacyConfig = { ...initialState } as Partial<AppState>;
    delete legacyConfig.unitViewerMode;
    expect(appReducer(initialState, setFromConfig(legacyConfig as AppState)).unitViewerMode).toBe("visualize");
  });

  it("restores, validates, and updates the mode", () => {
    const restored = appReducer(initialState, setFromConfig({ ...initialState, unitViewerMode: "visualize" }));
    expect(restored.unitViewerMode).toBe("visualize");

    const invalid = appReducer(initialState, setFromConfig({ ...initialState, unitViewerMode: "other" } as never));
    expect(invalid.unitViewerMode).toBe("visualize");
    expect(appReducer(restored, setUnitViewerMode("compare")).unitViewerMode).toBe("compare");
  });
});
