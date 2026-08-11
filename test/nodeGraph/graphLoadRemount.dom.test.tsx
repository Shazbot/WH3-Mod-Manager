import React from "react";

import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";

/**
 * Node ids restart at node_0 in every graph, so loading a second graph frequently reuses an id at
 * the same node type. React keeps the component instance in that case, and the local state behind a
 * text field goes with it - which is how a value from a previous graph turned up in a new one.
 *
 * The editor bumps a key on the ReactFlow element for each load so the node components remount.
 */
const renderGraph = (textValue: string, instanceKey: number) => (
  <div style={{ width: 800, height: 600 }}>
    {/* Keyed on the provider, matching the editor: React Flow's store lives here, so keying only
        the inner flow would leave the previous graph's node data in place. */}
    <ReactFlowProvider key={instanceKey}>
      <ReactFlow
        fitView
        edges={[]}
        nodeTypes={reactFlowNodeTypes}
        nodes={[
          {
            id: "node_2",
            type: "packedfiles",
            position: { x: 0, y: 0 },
            data: {
              label: "Pack Files",
              type: "packedfiles",
              textValue,
              outputType: "PackFiles",
              onUpdateNodeData: vi.fn(),
            },
          } as never,
        ]}
      />
    </ReactFlowProvider>
  </div>
);

const textboxValue = (container: HTMLElement) =>
  (container.querySelector("textarea") as HTMLTextAreaElement | null)?.value;

describe("loading a second graph", () => {
  it("keeps the previous graph's text when the node instance is reused", () => {
    const { container, rerender } = render(renderGraph("{{oldOption}}", 0));
    expect(textboxValue(container)).toBe("{{oldOption}}");

    // The user edits, as they would while working on the first graph.
    fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, {
      target: { value: "{{oldOption}}_edited" },
    });
    expect(textboxValue(container)).toBe("{{oldOption}}_edited");

    // Second graph, same id and type, no key change: the stale value survives. This is the bug.
    rerender(renderGraph("", 0));
    expect(textboxValue(container)).toBe("{{oldOption}}_edited");
  });

  it("starts clean when the load bumps the instance key", () => {
    const { container, rerender } = render(renderGraph("{{oldOption}}", 0));
    fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, {
      target: { value: "{{oldOption}}_edited" },
    });

    // A new graph load remounts the node components.
    rerender(renderGraph("", 1));

    expect(textboxValue(container)).toBe("");
  });

  it("takes the new graph's own value rather than nothing", () => {
    const { container, rerender } = render(renderGraph("{{oldOption}}", 0));

    rerender(renderGraph("{{newOption}}", 1));

    expect(textboxValue(container)).toBe("{{newOption}}");
  });

  it("retains a saved connection after the provider is remounted", async () => {
    const onInit = vi.fn();
    const renderConnectedGraph = (instanceKey: number) => (
      <div style={{ width: 800, height: 600 }}>
        <ReactFlowProvider key={instanceKey}>
          <ReactFlow
            fitView
            onInit={onInit}
            nodeTypes={reactFlowNodeTypes}
            nodes={[
              {
                id: "source",
                type: "packedfiles",
                position: { x: 0, y: 0 },
                data: {
                  label: "Pack Files",
                  type: "packedfiles",
                  textValue: "source.pack",
                  outputType: "PackFiles",
                  onUpdateNodeData: vi.fn(),
                },
              } as never,
              {
                id: "target",
                type: "tableselection",
                position: { x: 300, y: 0 },
                data: {
                  label: "Table Selection",
                  type: "tableselection",
                  textValue: "units_tables",
                  inputType: "PackFiles",
                  outputType: "TableSelection",
                  onUpdateNodeData: vi.fn(),
                },
              } as never,
            ]}
            edges={[{ id: "saved-edge", source: "source", target: "target" }]}
          />
        </ReactFlowProvider>
      </div>
    );
    const { rerender } = render(renderGraph("old", 0));

    rerender(renderConnectedGraph(1));

    await waitFor(() => expect(onInit).toHaveBeenCalled());
    const instance = onInit.mock.calls.at(-1)?.[0];
    expect(instance.getEdges()).toEqual([
      expect.objectContaining({ id: "saved-edge", source: "source", target: "target" }),
    ]);
  });
});
