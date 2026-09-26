import React from "react";

import { configureStore } from "@reduxjs/toolkit";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";

import appReducer, { initialState } from "../../src/appSlice";

import { applyConnection } from "../../src/nodeGraph/connectionRules";
import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";

/**
 * The three pack source nodes start a graph - they read packs by name and have nothing upstream of
 * them. Two of them used to draw an input handle anyway, which invited a connection the rules would
 * always reject.
 */
const packSourceNodes = [
  { type: "packedfiles", data: { textValue: "", outputType: "PackFiles" } },
  {
    type: "packfilesdropdown",
    data: { selectedPack: "", outputType: "PackFiles" },
  },
  { type: "allenabledmods", data: { outputType: "PackFiles" } },
] as const;

// The dropdown node reads the mod list out of the store to fill its options.
const renderNode = (type: string, data: Record<string, unknown>) =>
  render(
    <Provider
      store={configureStore({
        reducer: { app: appReducer },
        preloadedState: { app: initialState },
      })}
    >
      <div style={{ width: 640, height: 360 }}>
        <ReactFlowProvider>
          <ReactFlow
            fitView
            edges={[]}
            nodeTypes={reactFlowNodeTypes}
            nodes={[
              {
                id: "node_0",
                type,
                position: { x: 0, y: 0 },
                data: { label: type, type, onUpdateNodeData: vi.fn(), ...data },
              } as never,
            ]}
          />
        </ReactFlowProvider>
      </div>
    </Provider>,
  );

describe("pack source nodes", () => {
  it.each(packSourceNodes)("draws no input handle on $type", ({ type, data }) => {
    const { container } = renderNode(type, data as Record<string, unknown>);

    expect(container.querySelectorAll(".react-flow__handle-left")).toHaveLength(0);
    // The output handle is still there - these nodes feed the rest of the graph.
    expect(container.querySelectorAll(".react-flow__handle-right").length).toBeGreaterThan(0);
  });

  it("draws PackFiles input and output handles on Remove Pack Source", () => {
    const { container } = renderNode("removepacksource", {
      selectedPack: "",
      inputType: "PackFiles",
      outputType: "PackFiles",
      useCurrentPack: false,
    });

    expect(container.querySelectorAll('.react-flow__handle-left[data-input-type="PackFiles"]')).toHaveLength(1);
    expect(container.querySelectorAll('.react-flow__handle-right[data-output-type="PackFiles"]')).toHaveLength(1);
  });

  it("accepts All Enabled Mods as input to Remove Pack Source", () => {
    const state = {
      nodes: [
        {
          id: "all-mods",
          type: "allenabledmods",
          position: { x: 0, y: 0 },
          data: { label: "All Enabled Mods", type: "allenabledmods", outputType: "PackFiles" },
        },
        {
          id: "remove-pack",
          type: "removepacksource",
          position: { x: 200, y: 0 },
          data: {
            label: "Remove Pack Source",
            type: "removepacksource",
            selectedPack: "mod.pack",
            inputType: "PackFiles",
            outputType: "PackFiles",
          },
        },
      ] as never[],
      edges: [],
    };

    const result = applyConnection(
      state,
      { source: "all-mods", target: "remove-pack" } as never,
      {
        DBNameToDBVersions: undefined,
        defaultTableVersions: undefined,
        sortedTableNames: [],
      } as never,
    );

    expect(result.accepted).toBe(true);
    expect(result.edges).toHaveLength(1);
  });

  it.each(packSourceNodes)("rejects a connection into $type", ({ type, data }) => {
    const state = {
      nodes: [
        {
          id: "source",
          type: "packedfiles",
          position: { x: 0, y: 0 },
          data: {
            label: "Pack Files",
            type: "packedfiles",
            textValue: "",
            outputType: "PackFiles",
          },
        },
        {
          id: "target",
          type,
          position: { x: 200, y: 0 },
          data: { label: type, type, ...data },
        },
      ] as never[],
      edges: [],
    };

    const result = applyConnection(
      state,
      { source: "source", target: "target" } as never,
      {
        DBNameToDBVersions: undefined,
        defaultTableVersions: undefined,
        sortedTableNames: [],
      } as never,
    );

    // No inputType is declared on these, so there is nothing an edge could satisfy.
    expect(result.accepted).toBe(false);
    expect(result.edges).toEqual([]);
  });
});
