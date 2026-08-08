import React from "react";

import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";
import type { DBField, DBVersion } from "../../src/packFileTypes";

const createField = (
  name: string,
  options: { isKey?: boolean; reference?: [string, string] } = {},
): DBField =>
  ({
    name,
    field_type: "StringU8",
    is_key: options.isKey ?? false,
    default_value: "",
    is_filename: false,
    is_reference: options.reference ?? [],
    description: "",
    ca_order: 0,
    is_bitwise: 0,
    enum_values: {},
  }) as DBField;

const DBNameToDBVersions: Record<string, DBVersion[]> = {
  main_units_tables: [
    {
      version: 1,
      fields: [
        createField("unit", { isKey: true }),
        createField("land_unit", { reference: ["land_units_tables", "key"] }),
        createField("caste", { reference: ["unit_castes_tables", "caste"] }),
      ],
    },
  ],
  land_units_tables: [{ version: 1, fields: [createField("key", { isKey: true }), createField("shield")] }],
  unit_castes_tables: [{ version: 1, fields: [createField("caste", { isKey: true })] }],
};

const renderDeepCloneNode = (onUpdateNodeData = vi.fn()) => {
  const result = render(
    <div style={{ width: 800, height: 700 }}>
      <ReactFlowProvider>
        <ReactFlow
          fitView
          edges={[]}
          nodeTypes={reactFlowNodeTypes}
          nodes={[
            {
              id: "deepclone_1",
              type: "deepclone",
              position: { x: 0, y: 0 },
              data: {
                label: "Deep Clone",
                type: "deepclone",
                inputType: "TableSelection",
                outputType: "TableSelection",
                connectedTableName: "main_units_tables",
                columnNames: [],
                DBNameToDBVersions,
                nameTemplate: "my_new_unit{variant}",
                useModdersPrefix: true,
                variantAxes: [],
                columnOverrides: [],
                generateLoc: true,
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

/** The help markers are rendered as "?" badges carrying a native title tooltip. */
const getHelpTooltips = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("span[title]"))
    .map((element) => element.getAttribute("title") ?? "")
    .filter((title) => title.length > 0);

describe("Deep Clone node", () => {
  it("builds the reference tree from the connected table's schema", () => {
    const { container } = renderDeepCloneNode();

    expect(container.textContent).toContain("main_units_tables.unit");
    // Root starts expanded, so its one-hop references are listed.
    expect(container.textContent).toContain("land_units_tables.key");
    expect(container.textContent).toContain("unit_castes_tables.caste");
  });

  it("explains the variant axes and the key template through help tooltips", () => {
    const { container } = renderDeepCloneNode();
    const tooltips = getHelpTooltips(container);

    const variantAxesTooltip = tooltips.find((title) => title.includes("cross product"));
    expect(variantAxesTooltip).toBeDefined();
    expect(variantAxesTooltip).toContain("_shielded_t1");
    expect(variantAxesTooltip).toContain("256 variants");

    const nameTemplateTooltip = tooltips.find((title) => title.includes("{selfOriginal}"));
    expect(nameTemplateTooltip).toBeDefined();
    expect(nameTemplateTooltip).toContain("{original}");
    expect(nameTemplateTooltip).toContain("{variant}");

    expect(tooltips.some((title) => title.includes("modders prefix"))).toBe(true);
    expect(tooltips.some((title) => title.includes("reverse references"))).toBe(true);
    expect(tooltips.some((title) => title.includes(".loc"))).toBe(true);
  });

  it("dispatches the edited key template back to the graph", () => {
    const { container, onUpdateNodeData } = renderDeepCloneNode();

    const templateInput = container.querySelector(
      'input[placeholder="{original}{variant}"]',
    ) as HTMLInputElement;
    expect(templateInput).not.toBeNull();

    fireEvent.change(templateInput, { target: { value: "{selfOriginal}_clone{variant}" } });

    expect(onUpdateNodeData).toHaveBeenCalled();
    const patches = onUpdateNodeData.mock.calls.map((call) => call[0]);
    expect(patches.some((patch) => patch.nameTemplate === "{selfOriginal}_clone{variant}")).toBe(true);
  });

  it("adds a variant axis and reports the resulting variant count", () => {
    const { container, getByText } = renderDeepCloneNode();

    fireEvent.click(getByText("+ Add"));

    const axisSuffix = container.querySelector('input[placeholder="_suffix"]');
    // A freshly added axis has no values yet, so the product is still a single plain clone.
    expect(axisSuffix).toBeNull();
    expect(container.textContent).toContain("1 variants");

    fireEvent.click(getByText("+ Add variant"));
    expect(container.querySelector('input[placeholder="_suffix"]')).not.toBeNull();
  });
});
