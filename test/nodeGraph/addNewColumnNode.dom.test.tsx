import React from "react";

import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";

/**
 * The column-sync effect writes columnNames and also depends on it. Rendering the node with data
 * that feeds back - no inputColumnNames, and columnNames already carrying a generated column - used
 * to append the generated column again on every pass, growing the array without bound and repeating
 * React key warnings until the editor crawled.
 */
const renderWithData = (data: Record<string, unknown>, onUpdateNodeData = vi.fn()) => {
  const result = render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <ReactFlow
          fitView
          edges={[]}
          nodeTypes={reactFlowNodeTypes}
          nodes={[
            {
              id: "addcol_1",
              type: "addnewcolumn",
              position: { x: 0, y: 0 },
              data: {
                label: "Add New Column",
                type: "addnewcolumn",
                inputType: "TableSelection",
                outputType: "TableSelection",
                onUpdateNodeData,
                ...data,
              },
            } as any,
          ]}
        />
      </ReactFlowProvider>
    </div>,
  );
  return { ...result, onUpdateNodeData };
};

const transformation = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  sourceColumn: "text",
  transformationType: "suffix",
  suffix: " (Big)",
  outputColumnName: "new_column_1",
  ...overrides,
});

const columnNamePatches = (onUpdateNodeData: ReturnType<typeof vi.fn>) =>
  onUpdateNodeData.mock.calls
    .map((call) => call[0])
    .filter((patch) => patch.columnNames !== undefined)
    .map((patch) => patch.columnNames as string[]);

describe("AddNewColumnNode column syncing", () => {
  it("does not re-append its generated column when columnNames feeds back in", async () => {
    const onUpdateNodeData = vi.fn();
    renderWithData(
      {
        transformations: [transformation()],
        // No inputColumnNames, and columnNames already holds the generated column.
        columnNames: ["key", "text", "tooltip", "new_column_1"],
      },
      onUpdateNodeData,
    );

    await waitFor(() => expect(onUpdateNodeData).toHaveBeenCalled());

    for (const columnNames of columnNamePatches(onUpdateNodeData)) {
      expect(columnNames.filter((name) => name === "new_column_1")).toHaveLength(1);
    }
  });

  it("keeps the input columns ahead of the generated one", async () => {
    const onUpdateNodeData = vi.fn();
    renderWithData(
      {
        transformations: [transformation()],
        inputColumnNames: ["key", "text", "tooltip"],
        columnNames: [],
      },
      onUpdateNodeData,
    );

    await waitFor(() => expect(columnNamePatches(onUpdateNodeData).length).toBeGreaterThan(0));
    expect(columnNamePatches(onUpdateNodeData)[0]).toEqual(["key", "text", "tooltip", "new_column_1"]);
  });

  it("adds no column for an overwriting transformation", async () => {
    const onUpdateNodeData = vi.fn();
    renderWithData(
      {
        transformations: [transformation({ overwriteSource: true, outputColumnName: "text" })],
        inputColumnNames: ["key", "text", "tooltip"],
        columnNames: [],
      },
      onUpdateNodeData,
    );

    await waitFor(() => expect(columnNamePatches(onUpdateNodeData).length).toBeGreaterThan(0));
    // Overwriting writes into an existing column, so the output shape is unchanged.
    expect(columnNamePatches(onUpdateNodeData)[0]).toEqual(["key", "text", "tooltip"]);
  });

  it("renders each column once, so React never sees a repeated key", async () => {
    const { container } = renderWithData({
      transformations: [transformation()],
      // A duplicate that previously reached the option lists verbatim.
      columnNames: ["key", "text", "new_column_1", "new_column_1"],
    });

    await waitFor(() => expect(container.querySelectorAll("select").length).toBeGreaterThan(0));

    for (const select of Array.from(container.querySelectorAll("select"))) {
      const values = Array.from(select.querySelectorAll("option")).map((option) => option.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
