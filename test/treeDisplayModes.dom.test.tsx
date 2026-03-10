import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import localizationContext from "../src/localizationContext";
import LeftSidebar from "../src/components/LeftSidebar";
import Sidebar from "../src/components/Sidebar";

vi.mock("react-select", () => ({
  __esModule: true,
  default: () => <div data-testid="react-select" />,
}));

vi.mock("react-select/creatable", () => ({
  __esModule: true,
  default: () => <div data-testid="react-select-creatable" />,
}));

vi.mock("@/components/ui/accordion", () => ({
  __esModule: true,
  Accordion: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../src/components/OptionsDrawer", () => ({
  __esModule: true,
  default: () => <div data-testid="options-drawer" />,
}));

vi.mock("../src/components/CompatScreen", () => ({
  __esModule: true,
  default: () => <div data-testid="compat-screen" />,
}));

vi.mock("../src/components/SaveGames", () => ({
  __esModule: true,
  default: () => <div data-testid="save-games" />,
}));

vi.mock("../src/components/RequiredMods", () => ({
  __esModule: true,
  default: () => <div data-testid="required-mods" />,
}));

vi.mock("../src/components/Help", () => ({
  __esModule: true,
  default: () => <div data-testid="help" />,
}));

vi.mock("../src/components/UpdateNotification", () => ({
  __esModule: true,
  UpdateNotification: () => <div data-testid="update-notification" />,
}));

const localizedStrings = {
  allMods: "All Mods",
  enabledModsCapitalized: "Enabled Mods",
  categories: "Categories",
  presetsTab: "Presets",
  skillsViewer: "Skill Trees",
  techTreesTab: "Tech Trees",
  nodeEditorTab: "Node Editor",
  dbViewer: "DB Viewer",
  faqAbbreviated: "FAQ",
};

const createMod = (): Mod => ({
  humanName: "mod",
  name: "mod.pack",
  path: "/mods/mod.pack",
  imgPath: "",
  workshopId: "1",
  isEnabled: true,
  modDirectory: "",
  isInData: false,
  lastChanged: undefined,
  lastChangedLocal: undefined,
  loadOrder: 0,
  author: "",
  isDeleted: false,
  isMovie: false,
  dependencyPacks: [],
  reqModIdToName: [],
  size: 0,
  mergedModsData: undefined,
  subbedTime: undefined,
  isSymbolicLink: false,
  categories: [],
  tags: [],
  isInModding: false,
});

const renderWithState = (ui: React.ReactNode, stateOverrides: Partial<AppState> = {}) => {
  const store = configureStore({
    reducer: {
      app: appReducer,
    },
    preloadedState: {
      app: {
        ...initialState,
        currentGame: "wh3",
        currentPreset: {
          ...initialState.currentPreset,
          mods: [createMod()],
        },
        allMods: [createMod()],
        ...stateOverrides,
      },
    },
  });

  return render(
    <Provider store={store}>
      <localizationContext.Provider value={localizedStrings}>
        {ui}
      </localizationContext.Provider>
    </Provider>,
  );
};

describe("tree display DOM behavior", () => {
  beforeEach(() => {
    window.api = {
      ...window.api,
      getUpdateData: vi.fn().mockResolvedValue(undefined),
      requestOpenSkillsWindow: vi.fn(),
      requestOpenTechTreesWindow: vi.fn(),
      requestOpenModInViewer: vi.fn(),
    } as NonNullable<Window["api"]>;
  });

  it("shows separate Skills and Tech Trees tabs when both are tabbed", () => {
    renderWithState(<LeftSidebar />, {
      isFeaturesForModdersEnabled: false,
      skillTreesDisplayMode: "tab",
      technologyTreesDisplayMode: "tab",
    });

    expect(screen.getByText("Skill Trees")).toBeInTheDocument();
    expect(screen.getByText("Tech Trees")).toBeInTheDocument();
    expect(screen.queryByText("Node Editor")).not.toBeInTheDocument();
  });

  it("hides tree tabs when both are configured as windows", () => {
    renderWithState(<LeftSidebar />, {
      isFeaturesForModdersEnabled: false,
      skillTreesDisplayMode: "window",
      technologyTreesDisplayMode: "window",
    });

    expect(screen.queryByText("Skill Trees")).not.toBeInTheDocument();
    expect(screen.queryByText("Tech Trees")).not.toBeInTheDocument();
    expect(screen.queryByText("Node Editor")).not.toBeInTheDocument();
  });

  it("shows a combined Trees menu button when both trees use standalone windows", () => {
    renderWithState(<Sidebar />, {
      isFeaturesForModdersEnabled: false,
      skillTreesDisplayMode: "window",
      technologyTreesDisplayMode: "window",
    });

    fireEvent.click(screen.getByRole("button", { name: "Trees" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Technologies" })[0]);

    expect(window.api?.requestOpenTechTreesWindow).toHaveBeenCalledTimes(1);
  });

  it("shows only the Tech Trees window button when skills are off and tech trees are windows", () => {
    renderWithState(<Sidebar />, {
      isFeaturesForModdersEnabled: false,
      skillTreesDisplayMode: "off",
      technologyTreesDisplayMode: "window",
    });

    expect(screen.getByRole("button", { name: "Tech Trees" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trees" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skill Trees" })).not.toBeInTheDocument();
  });
});
