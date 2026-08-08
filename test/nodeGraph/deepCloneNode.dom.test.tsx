import React from "react";

import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";

import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";
import appSlice from "../../src/appSlice";
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

/** The node reads the modders prefix from the app store, so the tree needs a Provider. */
const createStore = (moddersPrefix: string) => {
  const store = configureStore({ reducer: { app: appSlice } });
  store.dispatch({ type: "app/setModdersPrefix", payload: moddersPrefix });
  return store;
};

const renderDeepCloneNode = (onUpdateNodeData = vi.fn(), moddersPrefix = "abc_") => {
  const result = render(
    <Provider store={createStore(moddersPrefix)}>
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
    </div>
    </Provider>,
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

  it("follows references by default and can be turned off", () => {
    const { container, getByText, onUpdateNodeData } = renderDeepCloneNode();

    const autoFollowLabel = getByText("Also clone rows that reference the new keys")
      .previousElementSibling as HTMLInputElement;
    expect(autoFollowLabel.type).toBe("checkbox");
    expect(autoFollowLabel.checked).toBe(true);

    expect(
      getHelpTooltips(container).some((title) => title.includes("re-pointed at the new key")),
    ).toBe(true);

    fireEvent.click(autoFollowLabel);

    const patches = onUpdateNodeData.mock.calls.map((call) => call[0]);
    expect(patches.some((patch) => patch.autoFollowReferences === false)).toBe(true);
  });

  it("warns in the editor when variant axes are set but the template ignores {variant}", () => {
    const { container, getByText, queryByText } = renderDeepCloneNode();

    const templateInput = container.querySelector(
      'input[placeholder="{original}{variant}"]',
    ) as HTMLInputElement;
    const warningText = "Add {variant} to the key template, or every variant produces the same key:";

    // One variant, so nothing to warn about yet however the template is written.
    fireEvent.change(templateInput, { target: { value: "my_new_unit" } });
    expect(queryByText(warningText, { exact: false })).toBeNull();

    // Two variants that would now collapse onto the same key.
    fireEvent.click(getByText("+ Add"));
    fireEvent.click(getByText("+ Add variant"));
    fireEvent.click(getByText("+ Add variant"));
    expect(queryByText(warningText, { exact: false })).not.toBeNull();
    expect(container.textContent).toContain("main_units_tables");

    // Putting the placeholder back clears it.
    fireEvent.change(templateInput, { target: { value: "my_new_unit{variant}" } });
    expect(queryByText(warningText, { exact: false })).toBeNull();
  });

  it("saves the author's modders prefix into the flow", () => {
    const { onUpdateNodeData } = renderDeepCloneNode(vi.fn(), "abc_");

    const patches = onUpdateNodeData.mock.calls.map((call) => call[0]);
    expect(patches.some((patch) => patch.moddersPrefix === "abc_")).toBe(true);
  });

  it("warns and saves no prefix when the checkbox is on but no prefix is configured", () => {
    const { getByText, onUpdateNodeData } = renderDeepCloneNode(vi.fn(), "");

    expect(
      getByText("Set a modders prefix in the app options, or untick this.", { exact: false }),
    ).not.toBeNull();
    const patches = onUpdateNodeData.mock.calls.map((call) => call[0]);
    expect(patches.some((patch) => patch.moddersPrefix === "")).toBe(true);
  });

  it("clears the saved prefix and the warning when the checkbox is unticked", () => {
    const { getByText, queryByText, onUpdateNodeData } = renderDeepCloneNode(vi.fn(), "");

    const prefixCheckbox = getByText("Prepend modders prefix").previousElementSibling as HTMLInputElement;
    fireEvent.click(prefixCheckbox);

    expect(queryByText("Set a modders prefix in the app options", { exact: false })).toBeNull();
    const patches = onUpdateNodeData.mock.calls.map((call) => call[0]);
    expect(patches.some((patch) => patch.useModdersPrefix === false)).toBe(true);
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
