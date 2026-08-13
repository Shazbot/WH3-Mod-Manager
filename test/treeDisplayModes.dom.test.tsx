import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appReducer, { setIsFeaturesForModdersEnabled, setWorkshopUpdateCheckMessage } from "../src/appSlice";
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
  unitViewerTab: "Unit Viewer",
  nodeEditorTab: "Node Editor",
  dbViewer: "DB Viewer",
  faqAbbreviated: "FAQ",
  workshopModsMayBeOutdated: "Workshop mods may be outdated",
};

const createMod = (overrides: Partial<Mod> = {}): Mod => ({
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
  ...overrides,
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

  const renderResult = render(
    <Provider store={store}>
      <localizationContext.Provider value={localizedStrings}>{ui}</localizationContext.Provider>
    </Provider>,
  );

  return { ...renderResult, store };
};

describe("tree display DOM behavior", () => {
  beforeEach(() => {
    window.api = {
      ...window.api,
      getUpdateData: vi.fn().mockResolvedValue(undefined),
      requestOpenSkillsWindow: vi.fn(),
      requestOpenTechTreesWindow: vi.fn(),
      requestOpenModInViewer: vi.fn(),
      repairOutdatedWorkshopMods: vi.fn(),
      cancelWorkshopRepairAndResubscribeMods: vi.fn(),
      forceResubscribeMods: vi.fn(),
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
    expect(screen.getByText("Unit Viewer")).toBeInTheDocument();
    expect(screen.queryByText("Node Editor")).not.toBeInTheDocument();
  });

  it("shows Unit Viewer for WH3 without modder features and hides it for other games", () => {
    const { rerender } = renderWithState(<LeftSidebar />, {
      currentGame: "wh3",
      isFeaturesForModdersEnabled: false,
    });
    expect(screen.getByText("Unit Viewer")).toBeInTheDocument();

    const otherGameStore = configureStore({
      reducer: { app: appReducer },
      preloadedState: { app: { ...initialState, currentGame: "wh2" as const } },
    });
    rerender(
      <Provider store={otherGameStore}>
        <localizationContext.Provider value={localizedStrings}>
          <LeftSidebar />
        </localizationContext.Provider>
      </Provider>,
    );
    expect(screen.queryByText("Unit Viewer")).not.toBeInTheDocument();
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

  it("selects the Node Editor after modder features are enabled at runtime", () => {
    const { store } = renderWithState(<LeftSidebar />, {
      isFeaturesForModdersEnabled: false,
      skillTreesDisplayMode: "tab",
      technologyTreesDisplayMode: "tab",
    });

    expect(screen.queryByText("Node Editor")).not.toBeInTheDocument();

    act(() => {
      store.dispatch(setIsFeaturesForModdersEnabled(true));
    });
    fireEvent.click(screen.getByText("Node Editor"));

    expect(store.getState().app.currentTab).toBe("nodeEditor");
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

  it("warns when multiple enabled mods contain startpos.esf", () => {
    const firstMod = createMod({
      name: "first-startpos.pack",
      path: "/mods/first-startpos.pack",
      workshopId: "1",
      hasStartpos: true,
    });
    const secondMod = createMod({
      name: "second-startpos.pack",
      path: "/mods/second-startpos.pack",
      workshopId: "2",
      hasStartpos: true,
    });

    renderWithState(<Sidebar />, {
      currentPreset: { name: "", mods: [firstMod, secondMod] },
      allMods: [firstMod, secondMod],
    });

    expect(screen.getByText("Multiple startpos mods enabled!")).toBeInTheDocument();
  });

  it("does not warn for a single enabled startpos mod", () => {
    const startposMod = createMod({ hasStartpos: true });

    renderWithState(<Sidebar />, {
      currentPreset: { name: "", mods: [startposMod] },
      allMods: [startposMod],
    });

    expect(screen.queryByText("Multiple startpos mods enabled!")).not.toBeInTheDocument();
  });

  it("does not warn when one startpos mod depends on the other", () => {
    const baseMod = createMod({
      name: "base-startpos.pack",
      path: "/mods/base-startpos.pack",
      workshopId: "1",
      hasStartpos: true,
    });
    const dependentMod = createMod({
      name: "dependent-startpos.pack",
      path: "/mods/dependent-startpos.pack",
      workshopId: "2",
      hasStartpos: true,
      dependencyPacks: ["base-startpos.pack"],
    });

    renderWithState(<Sidebar />, {
      currentPreset: { name: "", mods: [baseMod, dependentMod] },
      allMods: [baseMod, dependentMod],
    });

    expect(screen.queryByText("Multiple startpos mods enabled!")).not.toBeInTheDocument();
  });

  it("warns when an enabled Workshop mod has an older installed timestamp", () => {
    const mod = createMod({ lastChanged: 200_000 });

    const { store } = renderWithState(<Sidebar />, {
      currentPreset: { name: "", mods: [mod] },
      allMods: [mod],
      workshopInstallStatuses: {
        "1": { installedTimestamp: 100, state: 5 },
      },
    });

    expect(screen.getByText("Workshop mods may be outdated")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Workshop mods may be outdated"));
    expect(screen.getByText("Repair Workshop Mods")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Force Update" }));
    expect(window.api?.repairOutdatedWorkshopMods).toHaveBeenCalledWith([{ mod, remoteTimestampMs: 200_000 }]);

    act(() => {
      store.dispatch(
        setWorkshopUpdateCheckMessage({
          type: "progress",
          checkedCount: 1,
          items: [
            {
              workshopId: "1",
              initialState: 13,
              finalState: 45,
              status: "downloading",
              requestAccepted: true,
              installTimestampBefore: 100,
              downloadedBytes: "0",
              totalBytes: "0",
            },
          ],
        }),
      );
    });
    expect(screen.getByText("Update status: queued by Steam")).toBeInTheDocument();
    expect(screen.queryByText(/0 B \/ 0 B/)).not.toBeInTheDocument();

    act(() => {
      store.dispatch(
        setWorkshopUpdateCheckMessage({
          type: "progress",
          checkedCount: 1,
          items: [
            {
              workshopId: "1",
              initialState: 13,
              finalState: 21,
              status: "downloading",
              requestAccepted: true,
              installTimestampBefore: 100,
              downloadedBytes: "1073741824",
              totalBytes: "4294967296",
            },
          ],
        }),
      );
    });
    expect(screen.getByText("Update status: downloading (1 GB / 4 GB)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel and Resubscribe" }));
    expect(window.api?.cancelWorkshopRepairAndResubscribeMods).toHaveBeenCalledWith([mod]);
  });

  it("suppresses the outdated warning while Steam is downloading the update", () => {
    const mod = createMod({ lastChanged: 200_000 });

    renderWithState(<Sidebar />, {
      currentPreset: { name: "", mods: [mod] },
      allMods: [mod],
      workshopInstallStatuses: {
        "1": { installedTimestamp: 100, state: 21 },
      },
      workshopUpdateCheckResults: {
        "1": {
          workshopId: "1",
          initialState: 13,
          finalState: 21,
          status: "downloading",
          requestAccepted: true,
          installTimestampBefore: 100,
        },
      },
    });

    expect(screen.queryByText("Workshop mods may be outdated")).not.toBeInTheDocument();
  });
});
