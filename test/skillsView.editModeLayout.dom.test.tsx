import React, { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";

import initialState from "../src/initialAppState";
import appReducer from "../src/appSlice";
import SkillsView, { SkillsViewHandle } from "../src/components/skillsViewer/SkillsView";
import {
  skillArrow,
  skillEntry,
  skillGroup,
  skillGroupWidth,
  skillVariantStackY,
} from "../src/components/skillsViewer/skillPanelLayout";

vi.mock("@xyflow/react", () => {
  const React = require("react");

  const useNodesState = (initialNodes: unknown[]) => {
    const [nodes, setNodes] = React.useState(initialNodes);
    return [nodes, setNodes, vi.fn()];
  };
  const useEdgesState = (initialEdges: unknown[]) => {
    const [edges, setEdges] = React.useState(initialEdges);
    return [edges, setEdges, vi.fn()];
  };
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const ReactFlow = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Position: { Left: "left", Right: "right" },
    ReactFlow,
    Panel: passthrough,
    ViewportPortal: passthrough,
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    useNodesState,
    useEdgesState,
  };
});

vi.mock("../src/components/skillsViewer/Skill", () => ({ default: () => null }));
vi.mock("../src/components/skillsViewer/AddNodeModal", () => ({ default: () => null }));
vi.mock("flowbite-react", () => ({
  Dropdown: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownItem: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../src/flowbite/components/Modal/index", () => {
  const Modal = ({ children, show }: { children?: React.ReactNode; show?: boolean }) => (show ? <>{children}</> : null);
  Modal.Header = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  Modal.Body = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  Modal.Footer = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { Modal };
});

const skillAtRow = (row: number): Skill => ({
  title: `Skill ${row}`,
  description: "",
  x: row,
  y: 0,
  img: "skill.png",
  effects: [],
  id: `skill_${row}`,
  maxLevel: 1,
  origIndent: `${row}`,
  origTier: "tier",
  isHiddentInUI: false,
  nodeId: `node_${row}`,
  unlockRank: 0,
});

const skillsData = {
  currentSubtype: "test",
  currentSubtypeIndex: 0,
  currentSkills: Array.from({ length: 6 }, (_, row) => skillAtRow(row)),
  subtypeToNumSets: { test: 1 },
  subtypesToSet: { test: ["test"] },
  nodeLinks: {},
  nodeRequirements: {},
  icons: {},
  subtypes: ["test"],
  subtypesToLocalizedNames: {},
  nodeToSkillLocks: {},
  abilityTooltipsByKey: {},
  effectToUnitAbilityEnables: {},
} as SkillsData;

describe("SkillsView edit-mode layout", () => {
  it("does not reinterpret normal-mode rows when edit mode is exited", async () => {
    window.api = {
      ...window.api,
      getSkillsEditorData: vi.fn().mockResolvedValue(undefined),
    } as NonNullable<Window["api"]>;

    const viewRef = createRef<SkillsViewHandle>();
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          skillsData,
        },
      },
    });

    render(
      <Provider store={store}>
        <SkillsView ref={viewRef} skillsData={skillsData} />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(viewRef.current?.getSnapshot().isEditMode).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Edit Mode: ON" }));
    await waitFor(() => expect(viewRef.current?.getSnapshot().isEditMode).toBe(false));

    const nodes = viewRef.current!.getSnapshot().nodes;
    expect(nodes.find((node) => node.id === "node_3")?.position.y).toBe(3 * skillEntry.rowPitch);
    expect(nodes.find((node) => node.id === "node_4")?.position.y).toBe(4 * skillEntry.rowPitch);
    expect(nodes.find((node) => node.id === "node_5")?.position.y).toBe(5 * skillEntry.rowPitch);
  });

  it("reapplies normal-mode hidden-skill filtering after edit mode", async () => {
    const filteredSkillsData = {
      ...skillsData,
      currentSkills: skillsData.currentSkills.map((skill) =>
        skill.nodeId === "node_5" ? { ...skill, isHiddentInUI: true } : skill,
      ),
    } as SkillsData;
    window.api = {
      ...window.api,
      getSkillsEditorData: vi.fn().mockResolvedValue(undefined),
    } as NonNullable<Window["api"]>;

    const viewRef = createRef<SkillsViewHandle>();
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          isShowingHiddenSkills: false,
          skillsData: filteredSkillsData,
        },
      },
    });

    render(
      <Provider store={store}>
        <SkillsView ref={viewRef} skillsData={filteredSkillsData} />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(viewRef.current?.getSnapshot().isEditMode).toBe(true));
    expect(viewRef.current?.getSnapshot().nodes.some((node) => node.id === "node_5")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Edit Mode: ON" }));
    await waitFor(() => expect(viewRef.current?.getSnapshot().isEditMode).toBe(false));

    expect(viewRef.current?.getSnapshot().nodes.some((node) => node.id === "node_5")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(viewRef.current?.getSnapshot().isEditMode).toBe(true));
    expect(viewRef.current?.getSnapshot().nodes.some((node) => node.id === "node_5")).toBe(true);
  });
});

describe("SkillsView normal-mode layout", () => {
  it("lays a group out as one chain item, pushing later columns past it", async () => {
    const groupedSkillsData = {
      ...skillsData,
      currentSkills: [0, 1, 2, 3].map((column) => ({
        ...skillAtRow(0),
        y: column,
        id: `skill_c${column}`,
        nodeId: `node_c${column}`,
        origTier: `${column}`,
        group: column == 1 || column == 2 ? "group" : undefined,
      })),
    } as SkillsData;
    window.api = {
      ...window.api,
      getSkillsEditorData: vi.fn().mockResolvedValue(undefined),
    } as NonNullable<Window["api"]>;

    const viewRef = createRef<SkillsViewHandle>();
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: { app: { ...initialState, skillsData: groupedSkillsData } },
    });

    render(
      <Provider store={store}>
        <SkillsView ref={viewRef} skillsData={groupedSkillsData} />
      </Provider>,
    );

    await waitFor(() => expect(viewRef.current?.getSnapshot().nodes.length).toBeGreaterThan(0));
    const nodes = viewRef.current!.getSnapshot().nodes;
    const positionOf = (id: string) => nodes.find((node) => node.id === id)?.position;
    expect(positionOf("group_group")).toEqual({ x: skillEntry.columnPitch, y: skillGroup.artY });
    expect(positionOf("node_c1")).toEqual({ x: skillGroup.marginX, y: -skillGroup.artY });
    expect(positionOf("node_c2")).toEqual({
      x: skillGroup.marginX + skillEntry.width + skillGroup.spacing,
      y: -skillGroup.artY,
    });
    expect(positionOf("node_c3")?.x).toBe(
      skillEntry.columnPitch + skillGroupWidth(2) + skillEntry.columnPitch - skillEntry.width,
    );
  });
  it("leaves no gap for an indent that holds no shown skills", async () => {
    const gappedSkillsData = {
      ...skillsData,
      currentSkills: [skillAtRow(0), { ...skillAtRow(1), isHiddentInUI: true }, skillAtRow(2), skillAtRow(4)],
    } as SkillsData;
    window.api = {
      ...window.api,
      getSkillsEditorData: vi.fn().mockResolvedValue(undefined),
    } as NonNullable<Window["api"]>;

    const viewRef = createRef<SkillsViewHandle>();
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: { app: { ...initialState, isShowingHiddenSkills: false, skillsData: gappedSkillsData } },
    });

    render(
      <Provider store={store}>
        <SkillsView ref={viewRef} skillsData={gappedSkillsData} />
      </Provider>,
    );

    await waitFor(() => expect(viewRef.current?.getSnapshot().nodes.length).toBeGreaterThan(0));
    const nodes = viewRef.current!.getSnapshot().nodes;
    expect(nodes.find((node) => node.id === "node_2")?.position.y).toBe(skillEntry.rowPitch);
    expect(nodes.find((node) => node.id === "node_4")?.position.y).toBe(2 * skillEntry.rowPitch);
  });
  it("makes room for stacked faction variants of a group", async () => {
    // Two variants of a two-skill group share the same spots in row 0, each linking to its own stacked lone card after
    // the group. Row 1 holds one more skill.
    const variant = (group: string, column: number) => ({
      ...skillAtRow(0),
      y: column,
      id: `skill_${group}${column}`,
      nodeId: `node_${group}${column}`,
      origTier: `${column}`,
      group,
    });
    const lone = (group: string) => ({ ...variant(group, 2), group: undefined });
    const linked = (group: string) => ({ ...variant(group, 1), linkedToNode: `node_${group}2` });
    const stackedSkillsData = {
      ...skillsData,
      currentSkills: [variant("a", 0), linked("a"), lone("a"), variant("b", 0), linked("b"), lone("b"), skillAtRow(1)],
    } as SkillsData;
    window.api = {
      ...window.api,
      getSkillsEditorData: vi.fn().mockResolvedValue(undefined),
    } as NonNullable<Window["api"]>;

    const viewRef = createRef<SkillsViewHandle>();
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: { app: { ...initialState, skillsData: stackedSkillsData } },
    });

    render(
      <Provider store={store}>
        <SkillsView ref={viewRef} skillsData={stackedSkillsData} />
      </Provider>,
    );

    await waitFor(() => expect(viewRef.current?.getSnapshot().nodes.length).toBeGreaterThan(0));
    const nodes = viewRef.current!.getSnapshot().nodes;
    const nodeOf = (id: string) => nodes.find((node) => node.id === id);
    // Both group boxes sit on the row and grow to hold the stacked cards, which carry the stack offset themselves.
    for (const id of ["a_group", "b_group"]) {
      expect(nodeOf(id)?.position.y).toBe(skillGroup.artY);
      expect(nodeOf(id)?.height).toBe(skillGroup.artHeight + skillVariantStackY);
    }
    // The stacked members line up with the ones above them, a card's height lower.
    const stackedYs = ["node_a0", "node_b0"].map((id) => nodeOf(id)!.position.y).sort((a, b) => a - b);
    expect(stackedYs).toEqual([-skillGroup.artY, -skillGroup.artY + skillVariantStackY]);
    expect(nodeOf("node_b0")?.position.x).toBe(skillGroup.marginX);
    expect(nodeOf("node_1")?.position.y).toBe(skillEntry.rowPitch + skillVariantStackY);
    // Each group's arrow leaves from its own row of cards, not both from the top one.
    // Each arrow is placed with translate(xpx, ypx).
    const arrowYs = screen.getAllByAltText("arrow").map((arrow) => parseFloat(arrow.style.transform.split(",")[1]));
    expect(arrowYs.sort((a, b) => a - b)).toEqual([skillArrow.y, skillArrow.y + skillVariantStackY]);
  });
});
