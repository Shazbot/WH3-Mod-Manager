import React from "react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";
import { FlowSourcePackContext } from "../../src/nodeGraph/nodes/shared";

vi.mock("../../src/hooks", () => ({
  useAppSelector: (selector: (state: any) => unknown) => selector({ app: { currentPreset: { mods: [] } } }),
}));

const previousApi = window.api;
afterEach(() => {
  window.api = previousApi;
});

const setup = (overrides: Record<string, unknown> = {}, response?: any) => {
  const inspect = vi.fn(
    async () =>
      response ?? {
        success: true,
        mode: "bundle",
        inputs: [],
        models: [],
        bindingCandidates: { columns: [], references: [] },
      },
  );
  window.api = { ...window.api, inspectOnnxFlowPack: inspect } as any;
  const update = vi.fn();
  const node = {
    id: "onnx",
    type: "onnx",
    position: { x: 0, y: 0 },
    data: {
      label: "ONNX Prediction",
      type: "onnx",
      mode: "bundle",
      rootTableName: "main_units_tables",
      DBNameToDBVersions: { main_units_tables: [], land_units_tables: [], projectiles_tables: [] },
      inputBindings: {},
      outputBindings: {},
      strength: 1,
      onUpdateNodeData: update,
      ...overrides,
    },
  };
  const view = render(
    <FlowSourcePackContext.Provider value={{ path: "/models.pack", name: "models.pack" }}>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlowProvider>
          <ReactFlow nodes={[node as any]} edges={[]} nodeTypes={reactFlowNodeTypes} />
        </ReactFlowProvider>
      </div>
    </FlowSourcePackContext.Provider>,
  );
  return { view, inspect, update };
};

describe("ONNX configuration panel", () => {
  it("defaults key reuse on and allows disabling it", () => {
    const { view, update } = setup();
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    const dialog = within(view.getByRole("dialog"));
    const option = dialog.getByRole("checkbox", { name: "Reuse existing keys for unshared rows" });
    expect(option).toBeChecked();
    fireEvent.click(option);
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ reuseExistingKeys: false }));
  });
  it("shows all matching long binding labels and saves a searched selection", async () => {
    const missing = { kind: "unresolved", reason: "Choose a column" };
    const columns = Array.from({ length: 240 }, (_, index) => ({
      id: `choice-${index}`,
      tableName: "main_units_tables",
      column: `field_${index}`,
      path: [],
      fieldType: "F32",
      label: `field_${index} via ${"long_reference_path_".repeat(30)}`,
    }));
    const { view, update } = setup(
      { inputBindings: { feature: missing } },
      {
        success: true,
        mode: "bundle",
        inputs: [{ name: "feature", type: "float32", defaultBinding: missing }],
        models: [],
        bindingCandidates: { columns, references: [] },
      },
    );
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    const dialog = within(view.getByRole("dialog"));
    const input = await dialog.findByRole("combobox", { name: "feature input mapping" });
    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
    expect(within(dialog.getByRole("listbox")).getAllByRole("option")).toHaveLength(482);
    expect(dialog.queryByText(/Showing the first 100/)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "field_239 via" } });
    fireEvent.click(await dialog.findByText(columns[239].label, { exact: true }));
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        inputBindings: {
          feature: {
            kind: "column",
            tableName: "main_units_tables",
            column: "field_239",
            path: [],
          },
        },
      }),
    );
  });
  it("offers all DB tables and defaults to main_units_tables", async () => {
    const { view, update } = setup();
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    const dialog = within(view.getByRole("dialog"));
    const root = dialog.getByRole("combobox", { name: "Root table" });
    expect(root).toHaveValue("main_units_tables");
    expect(
      within(root)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["land_units_tables", "main_units_tables", "projectiles_tables"]);
    fireEvent.change(root, { target: { value: "projectiles_tables" } });
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ rootTableName: "projectiles_tables" }));
  });
  it("warns about unassigned mappings on the node and in the panel", async () => {
    const missing = { kind: "unresolved", reason: "Choose a derived input" };
    const output = { enabled: true, tableName: "main_units_tables", column: "", path: [], mode: "delta" };
    const { view } = setup(
      {
        inputBindings: { known: { kind: "constant", value: 1 }, is_ranged: missing },
        outputBindings: { prediction: output },
      },
      {
        success: true,
        mode: "bundle",
        inputs: [
          { name: "known", type: "float32", defaultBinding: { kind: "constant", value: 1 } },
          { name: "is_ranged", type: "float32", defaultBinding: missing },
        ],
        models: [{ key: "prediction", defaultBinding: output }],
        bindingCandidates: { columns: [], references: [] },
      },
    );
    expect(view.getByText("⚠ 1 input unassigned · 1 output destination unassigned")).toBeInTheDocument();
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    const dialog = within(view.getByRole("dialog"));
    await waitFor(() => expect(dialog.getByRole("status")).toHaveTextContent("Choose these mappings before running"));
    const warning = within(dialog.getByRole("status"));
    expect(within(warning.getByRole("list", { name: "Unassigned inputs" })).getByText("is_ranged")).toBeInTheDocument();
    expect(warning.getByText("Choose a derived input")).toBeInTheDocument();
    expect(
      within(warning.getByRole("list", { name: "Unassigned output destinations" })).getByText("prediction"),
    ).toBeInTheDocument();
    expect(warning.getByText("Choose a destination column.")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Review inputs" })).not.toBeInTheDocument();
    fireEvent.change(dialog.getByPlaceholderText("Filter inputs…"), { target: { value: "known" } });
    expect(warning.getByText("is_ranged")).toBeInTheDocument();
    fireEvent.click(warning.getByRole("button", { name: "is_ranged" }));
    expect(dialog.getByPlaceholderText("Filter inputs…")).toHaveValue("is_ranged");
    expect(dialog.getByRole("button", { name: /Unassigned.*is_ranged/ })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: /^known →/ })).not.toBeInTheDocument();
    fireEvent.change(dialog.getByPlaceholderText("Filter inputs…"), { target: { value: "" } });
    expect(dialog.getByRole("button", { name: /^known →/ })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /Unassigned.*prediction/ })).toBeInTheDocument();
  });

  it("filters warning clicks to the exact standalone feature row", async () => {
    const unresolved = { kind: "unresolved", reason: "Assign feature" };
    const { view } = setup(
      {
        mode: "standalone",
        standaloneInputBindings: { features: [unresolved, unresolved] },
        outputBindings: { standalone: { enabled: false } },
      },
      {
        success: true,
        mode: "standalone",
        inputs: [{ name: "features", type: "float32", width: 2, defaultBinding: unresolved }],
        outputs: [],
        bindingCandidates: { columns: [], references: [] },
      },
    );
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    const dialog = within(view.getByRole("dialog"));
    const warningButton = await dialog.findByRole("button", { name: "features [2]" });
    fireEvent.click(warningButton);
    expect(dialog.getAllByRole("button", { name: /^⚠ Unassigned · features/ })).toHaveLength(1);
    expect(dialog.getByRole("button", { name: /^⚠ Unassigned · features\[2\]/ })).toBeInTheDocument();
  });

  it("does not warn about deliberately disabled outputs", async () => {
    const output = { enabled: false, tableName: "", column: "", path: [], mode: "delta" };
    const { view } = setup(
      { outputBindings: { prediction: output } },
      {
        success: true,
        mode: "bundle",
        inputs: [],
        models: [{ key: "prediction", defaultBinding: output }],
        bindingCandidates: { columns: [], references: [] },
      },
    );
    expect(view.queryByText(/unassigned/)).not.toBeInTheDocument();
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    const dialog = within(view.getByRole("dialog"));
    await waitFor(() => expect(dialog.getByText("Model metadata loaded")).toBeInTheDocument());
    expect(dialog.queryByRole("status")).not.toBeInTheDocument();
  });
  it.each([true, false])(
    "refreshes unresolved inputs while preserving explicit mappings (unresolved=%s)",
    async (unresolved) => {
      const inferred = { kind: "column", tableName: "main_units_tables", column: "tier", path: [] };
      const existing = unresolved ? { kind: "unresolved", reason: "ambiguous" } : { kind: "constant", value: 9 };
      const { view, update } = setup(
        { inputBindings: { feature: existing } },
        {
          success: true,
          mode: "bundle",
          models: [],
          inputs: [{ name: "feature", type: "float32", defaultBinding: inferred }],
          bindingCandidates: { columns: [], references: [] },
        },
      );
      fireEvent.click(view.getByText("Configure", { selector: "button" }));
      await waitFor(() => expect(view.getByText("Model metadata loaded")).toBeInTheDocument());
      fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Apply" }));
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ inputBindings: { feature: unresolved ? inferred : existing } }),
      );
    },
  );
  it("resets canceled advanced JSON edits when reopened", () => {
    const { view, update } = setup();
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    const dialog = view.getByRole("dialog");
    const inputJson = dialog.querySelector("textarea")!;
    fireEvent.change(inputJson, { target: { value: "invalid JSON" } });
    fireEvent.blur(inputJson);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    expect(view.getByRole("dialog").querySelector("textarea")).toHaveValue("{}");
    expect(update).not.toHaveBeenCalled();
  });
  it("keeps controls out of the graph and inspects only when Configure is opened", async () => {
    const { view, inspect } = setup();
    expect(view.queryByRole("dialog")).not.toBeInTheDocument();
    expect(view.queryByRole("textbox")).not.toBeInTheDocument();
    expect(inspect).not.toHaveBeenCalled();
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    expect(view.getByRole("dialog", { name: "Configure ONNX Prediction" })).toBeInTheDocument();
    await waitFor(() => expect(inspect).toHaveBeenCalledOnce());
  });

  it("applies a local draft only when Apply is pressed", async () => {
    const { view, update } = setup();
    fireEvent.click(view.getByText("Configure", { selector: "button" }));
    const dialog = within(view.getByRole("dialog"));
    fireEvent.change(dialog.getByDisplayValue("main_units_tables"), { target: { value: "land_units_tables" } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ rootTableName: "land_units_tables" }));
    await waitFor(() => expect(view.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("discards edits on Cancel and Escape", async () => {
    const { view, update } = setup();
    for (const action of ["cancel", "escape"]) {
      fireEvent.click(view.getByText("Configure", { selector: "button" }));
      const dialog = within(view.getByRole("dialog"));
      expect(dialog.getByDisplayValue("main_units_tables")).toBeInTheDocument();
      fireEvent.change(dialog.getByDisplayValue("main_units_tables"), { target: { value: "land_units_tables" } });
      if (action === "cancel") fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
      else fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(view.queryByRole("dialog")).not.toBeInTheDocument());
    }
    expect(update).not.toHaveBeenCalled();
  });
});
