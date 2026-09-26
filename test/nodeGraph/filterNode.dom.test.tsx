import React from "react";

import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";

const renderFilterNode = (filters: Array<Record<string, unknown>>) => {
  const onUpdateNodeData = vi.fn();
  const result = render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <ReactFlow
          fitView
          edges={[]}
          nodeTypes={reactFlowNodeTypes}
          nodes={[
            {
              id: "filter_1",
              type: "filter",
              position: { x: 0, y: 0 },
              data: {
                label: "Filter",
                type: "filter",
                inputType: "TableSelection",
                outputType: "TableSelection",
                columnNames: ["unit"],
                filters,
                onUpdateNodeData,
              },
            } as any,
          ]}
        />
      </ReactFlowProvider>
    </div>,
  );

  return { ...result, onUpdateNodeData };
};

const selectedModeLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="group"][aria-label="Filter match mode"]')).map(
    (group) => group.querySelector('button[aria-pressed="true"]')?.textContent,
  );

const clickAddFilter = (container: HTMLElement) => {
  const addButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Add Filter",
  );
  expect(addButton).not.toBeUndefined();
  fireEvent.click(addButton as HTMLButtonElement);
};

describe("FilterNode match mode control", () => {
  it("shows concise tooltips and inherits the last row's mode for a new row", () => {
    const { container } = renderFilterNode([
      { column: "unit", value: "emp_", not: false, operator: "AND", matchMode: "partial" },
      { column: "unit", value: "spearmen", not: false, operator: "AND", matchMode: "regex" },
    ]);

    const modeGroup = container.querySelector('[role="group"][aria-label="Filter match mode"]');
    expect(modeGroup?.getAttribute("title")).toBe("Choose how this condition matches the value.");
    const partialButton = Array.from(modeGroup?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Partial",
    );
    expect(partialButton?.getAttribute("title")).toBe("Case-insensitive substring matching.");

    clickAddFilter(container);

    expect(selectedModeLabels(container)).toEqual(["Partial", "Regex", "Regex"]);
  });

  it("defaults a new row to full when the last existing row is legacy", () => {
    const { container } = renderFilterNode([
      { column: "unit", value: "emp_", not: false, operator: "AND", matchMode: "partial" },
      { column: "unit", value: "spearmen", not: false, operator: "AND" },
    ]);

    clickAddFilter(container);

    expect(selectedModeLabels(container)).toEqual(["Partial", "Full", "Full"]);
  });

  it("shows invalid regex feedback", () => {
    const { container } = renderFilterNode([
      { column: "unit", value: "[", not: false, operator: "AND", matchMode: "regex" },
    ]);

    expect(container.querySelector('input[aria-invalid="true"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid regex:");
  });
});
