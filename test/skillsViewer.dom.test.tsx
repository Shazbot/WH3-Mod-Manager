import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { describe, beforeEach, afterEach, expect, it, vi } from "vitest";

import initialState from "../src/initialAppState";
import appReducer, { setSkillsData } from "../src/appSlice";
import SkillsViewer from "../src/components/skillsViewer/SkillsViewer";

vi.mock("re-resizable", () => ({
  Resizable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../src/components/skillsViewer/SkillsTreeView", () => ({
  default: ({
    tableFilter,
    onSelect,
    onDoubleClick,
  }: {
    tableFilter: string;
    onSelect?: (subtype: string, subtypeIndex: number) => void;
    onDoubleClick?: (subtype: string, subtypeIndex: number) => void;
  }) => (
    <div>
      <div data-testid="tree-filter">{tableFilter}</div>
      <button onClick={() => onSelect?.("beta", 0)}>select-beta</button>
      <button onClick={() => onDoubleClick?.("gamma", 0)}>open-gamma</button>
    </div>
  ),
}));

vi.mock("../src/components/skillsViewer/SkillsView", async () => {
  const React = await import("react");

  const MockSkillsView = React.memo(
    React.forwardRef(
      (
        {
          skillsData,
        }: {
          skillsData: SkillsData;
          initialSnapshot?: unknown;
        },
        ref: React.ForwardedRef<{ getSnapshot: () => object }>,
      ) => {
        React.useImperativeHandle(ref, () => ({
          getSnapshot: () => ({
            nodes: [],
            edges: [],
            isEditMode: false,
            isRequirementsMode: false,
            isSkillLocksMode: false,
            editGroups: {},
            nextGroupId: 1,
            factionFilter: "all",
            isShowingHiddentSkills: true,
            isShowingHiddenModifiersInsideSkills: true,
            isCheckingSkillRequirements: true,
            savedEditEdges: [],
            savedLocksEdges: [],
            allLockEdges: [],
            lockEdgeLevels: {},
            localNodeToSkillLocks: null,
          }),
        }));

        return (
          <div data-testid="skills-view">{`view-${skillsData.currentSubtype}-${skillsData.currentSubtypeIndex}`}</div>
        );
      },
    ),
  );

  return {
    __esModule: true,
    default: MockSkillsView,
  };
});

const createSkillsData = (subtype: string, subtypeIndex = 0): SkillsData =>
  ({
    currentSubtype: subtype,
    currentSubtypeIndex: subtypeIndex,
    currentSkills: [],
    subtypeToNumSets: {
      alpha: 1,
      beta: 1,
      gamma: 1,
    },
    subtypesToSet: {
      alpha: ["alpha"],
      beta: ["beta"],
      gamma: ["gamma"],
    },
    nodeLinks: {},
    nodeRequirements: {},
    icons: {},
    subtypes: ["alpha", "beta", "gamma"],
    subtypesToLocalizedNames: {},
    nodeToSkillLocks: {},
    abilityTooltipsByKey: {},
    effectToUnitAbilityEnables: {},
    allEffects: [],
    allSkills: [],
    allSkillIcons: [],
  }) as SkillsData;

const renderViewer = (skillsData = createSkillsData("alpha")) => {
  const store = configureStore({
    reducer: {
      app: appReducer,
    },
    preloadedState: {
      app: {
        ...initialState,
        skillsData,
      },
    },
  });

  render(
    <Provider store={store}>
      <SkillsViewer />
    </Provider>,
  );

  return store;
};

describe("SkillsViewer", () => {
  let getSkillsForSubtypeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    getSkillsForSubtypeMock = vi.fn();
    window.api = {
      ...window.api,
      getSkillsForSubtype: getSkillsForSubtypeMock,
    } as NonNullable<Window["api"]>;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the filter input and applied tree filter together", () => {
    renderViewer();

    const input = screen.getByPlaceholderText("Filter");
    fireEvent.change(input, { target: { value: "abc" } });

    expect(input).toHaveValue("abc");
    expect(screen.getByTestId("tree-filter")).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByTestId("tree-filter")).toHaveTextContent("abc");

    const clearButton = input.parentElement?.querySelector("button");
    expect(clearButton).not.toBeNull();
    fireEvent.click(clearButton!);

    expect(input).toHaveValue("");
    expect(screen.getByTestId("tree-filter")).toHaveTextContent("");
  });

  it("ignores stale async updates when a new tab request is still pending", () => {
    const store = renderViewer();

    expect(screen.getByTestId("skills-view")).toHaveTextContent("view-alpha-0");

    fireEvent.click(screen.getByRole("button", { name: "select-beta" }));
    fireEvent.click(screen.getByRole("button", { name: "open-gamma" }));

    expect(getSkillsForSubtypeMock).toHaveBeenNthCalledWith(1, "beta", 0);
    expect(getSkillsForSubtypeMock).toHaveBeenNthCalledWith(2, "gamma", 0);

    act(() => {
      store.dispatch(setSkillsData(createSkillsData("beta")));
    });

    expect(screen.getByTestId("skills-view")).toHaveTextContent("view-beta-0");
    expect(screen.queryByText("gamma")).not.toBeInTheDocument();

    act(() => {
      store.dispatch(setSkillsData(createSkillsData("gamma")));
    });

    expect(screen.getByTestId("skills-view")).toHaveTextContent("view-gamma-0");
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
  });
});
