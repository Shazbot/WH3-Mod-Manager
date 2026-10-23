import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { Position, ReactFlow, ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import appReducer from "../../src/appSlice";
import initialState from "../../src/initialAppState";
import { serializeNodeConfigForExecution } from "../../src/nodeGraphExecutor";
import { FlowOptionsContext, FlowSourcePackContext } from "../../src/nodeGraph/nodes/shared";
import { NativePatchFlowNode } from "../../src/nodeGraph/nodes/renderers";
import { patchNodeData, withNodeEditorActions } from "../../src/nodeGraph/editorState";
import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";

const descriptor = {
  path: "whmm_patch_templates/example.wh3patchtemplate.json",
  id: "example.keys",
  version: "1.0.0",
  name: "Key list example",
  fingerprint: "f".repeat(64),
  scalars: [
    {
      id: "keys",
      parameter: "key_list",
      type: "ascii_key_list" as const,
      default: ["initial"],
      capacity: 8,
      max_key_bytes: 32,
    },
  ],
  tables: [
    {
      id: "initial_mapping",
      table_name: "Initial mappings",
      parameter: "mapping_data",
      max_rows: 8,
      group_by: "flag",
      value_column: "unit_set",
      columns: [
        { name: "flag", type: "ascii", max_bytes: 32 },
        { name: "unit_set", type: "ascii", max_bytes: 32 },
      ],
    },
  ],
};
const replacementDescriptor = {
  ...descriptor,
  path: "whmm_patch_templates/replacement.wh3patchtemplate.json",
  id: "example.replacement",
  name: "Replacement mapping",
  tables: descriptor.tables.map((table) => ({
    ...table,
    id: "replacement_mapping",
    table_name: "Replacement mappings",
  })),
};

const previousApi = window.api;

afterEach(() => {
  Object.defineProperty(window, "api", { configurable: true, value: previousApi });
  vi.unstubAllGlobals();
});

describe("Native Patch flow controls", () => {
  it("starts drags from the chosen output and keeps legacy connections on the patch output", async () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        m22 = 1;
      },
    );
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        listNativePatchFlowTemplates: vi.fn().mockResolvedValue({ success: true, templates: [descriptor], errors: [] }),
      },
    });
    let flowStore!: ReturnType<typeof useStoreApi>;
    const StoreProbe = () => {
      flowStore = useStoreApi();
      return null;
    };
    const store = configureStore({ reducer: { app: appReducer }, preloadedState: { app: initialState as any } });
    const { container } = render(
      <Provider store={store}>
        <FlowSourcePackContext.Provider value={{ path: "owner.pack", name: "owner.pack" }}>
          <ReactFlowProvider>
            <StoreProbe />
            <div style={{ width: 800, height: 600 }}>
              <ReactFlow
                nodeTypes={reactFlowNodeTypes}
                nodes={[
                  {
                    id: "patch",
                    type: "nativepatch",
                    position: { x: 0, y: 0 },
                    data: {
                      label: "Native Patch",
                      type: "nativepatch",
                      selectedPackName: "",
                      templatePath: descriptor.path,
                      scalarValues: {},
                      scalarOptionBindings: {},
                      tableBindings: [],
                      outputType: "TableSelection",
                      onUpdateNodeData: vi.fn(),
                    },
                  },
                ]}
                edges={[]}
                connectionDragThreshold={0}
                autoPanOnConnect={false}
              />
            </div>
          </ReactFlowProvider>
        </FlowSourcePackContext.Provider>
      </Provider>,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-handleid="output-schema:initial_mapping"]')).not.toBeNull(),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const handles = [...container.querySelectorAll<HTMLElement>(".react-flow__handle.source")];
    expect(handles.map((handle) => handle.dataset.handleid)).toEqual(["output", "output-schema:initial_mapping"]);

    // jsdom has no layout or ResizeObserver measurements. Supply the bounds React Flow normally measures.
    const node = flowStore.getState().nodeLookup.get("patch")!;
    node.internals.handleBounds = {
      source: handles.map((handle, index) => ({
        id: handle.dataset.handleid!,
        nodeId: "patch",
        type: "source" as const,
        position: Position.Right,
        x: 300,
        y: 100 + index * 80,
        width: 12,
        height: 12,
      })),
      target: [],
    };
    // React Flow uses the first measured handle for older edges whose sourceHandle is null.
    expect(node.internals.handleBounds.source![0].id).toBe("output");
    for (const handle of handles) {
      fireEvent.mouseDown(handle, { button: 0, clientX: 300, clientY: 100 });
      expect(flowStore.getState().connection.fromHandle?.id).toBe(handle.dataset.handleid);
      fireEvent.mouseUp(document, { button: 0, clientX: 300, clientY: 100 });
    }
  });

  it("persists normalized key-list edits while retaining a trailing newline draft before blur", async () => {
    const listTemplates = vi
      .fn()
      .mockResolvedValue({ success: true, templates: [descriptor, replacementDescriptor], errors: [] });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { listNativePatchFlowTemplates: listTemplates },
    });

    const store = configureStore({ reducer: { app: appReducer }, preloadedState: { app: initialState as any } });
    const initialNode: any = {
      id: "patch",
      type: "nativepatch",
      position: { x: 0, y: 0 },
      data: {
        label: "Native Patch",
        type: "nativepatch",
        selectedPackName: "",
        templatePath: descriptor.path,
        scalarValues: { keys: ["initial"] },
        scalarOptionBindings: {},
        tableBindings: [],
      },
    };

    const Harness = () => {
      const [nodes, setNodes] = React.useState([initialNode]);
      const actions = React.useMemo(
        () => ({
          updateNodeData: (nodeId: string, patch: any) =>
            setNodes((current) => patchNodeData(current as any, nodeId, patch) as any),
        }),
        [],
      );
      const nodesWithActions = withNodeEditorActions(nodes as any, actions);
      return (
        <>
          <NativePatchFlowNode id="patch" data={nodesWithActions[0].data as any} />
          <output data-testid="serialized-config">{serializeNodeConfigForExecution(nodes[0] as any)}</output>
        </>
      );
    };

    render(
      <Provider store={store}>
        <FlowSourcePackContext.Provider value={{ path: "owner.pack", name: "owner.pack" }}>
          <FlowOptionsContext.Provider value={[]}>
            <ReactFlowProvider>
              <Harness />
            </ReactFlowProvider>
          </FlowOptionsContext.Provider>
        </FlowSourcePackContext.Provider>
      </Provider>,
    );

    const textarea = await screen.findByLabelText(/keys \(ascii_key_list\)/);
    await waitFor(() => expect(listTemplates).toHaveBeenCalledWith("owner.pack"));
    expect(
      document.querySelector('[data-handleid="output-schema:initial_mapping"][data-output-type="CustomSchema"]'),
    ).not.toBeNull();
    fireEvent.change(textarea, { target: { value: "alpha\nbeta\n" } });

    expect(textarea).toHaveValue("alpha\nbeta\n");
    await waitFor(() => {
      const serialized = JSON.parse(screen.getByTestId("serialized-config").textContent || "{}");
      expect(serialized.scalarValues.keys).toEqual(["alpha", "beta"]);
    });

    fireEvent.change(screen.getByLabelText("Native Patch template"), { target: { value: replacementDescriptor.path } });
    await waitFor(() => {
      const serialized = JSON.parse(screen.getByTestId("serialized-config").textContent || "{}");
      expect(serialized.tableBindings).toEqual(["replacement_mapping"]);
    });
    await waitFor(() =>
      expect(document.querySelector('[data-handleid="input-table:replacement_mapping"]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-handleid="output-schema:replacement_mapping"]')).not.toBeNull();
    expect(document.querySelector('[data-handleid="output-schema:initial_mapping"]')).toBeNull();
  });
});
