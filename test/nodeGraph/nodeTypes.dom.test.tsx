import React from "react";

import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { applyNodeDataPatchFromRef, withNodeEditorActions } from "../../src/nodeGraph/editorState";
import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";

describe("react flow node types", () => {
  it("renders an extracted node type and dispatches typed updates", async () => {
    const onUpdateNodeData = vi.fn();

    const { container } = render(
      <div style={{ width: 640, height: 360 }}>
        <ReactFlowProvider>
          <ReactFlow
            fitView
            edges={[]}
            nodeTypes={reactFlowNodeTypes}
            nodes={[
              {
                id: "node_1",
                type: "textsurround",
                position: { x: 0, y: 0 },
                data: {
                  label: "Text Surround",
                  type: "textsurround",
                  textValue: "",
                  inputType: "Text",
                  outputType: "Text",
                  onUpdateNodeData,
                },
              } as any,
            ]}
          />
        </ReactFlowProvider>
      </div>,
    );

    const textbox = container.querySelector("textarea");
    expect(textbox).not.toBeNull();

    fireEvent.change(textbox as HTMLTextAreaElement, { target: { value: "abc" } });

    expect(onUpdateNodeData).toHaveBeenCalled();
    expect(onUpdateNodeData).toHaveBeenLastCalledWith({ textValue: "abc" });
  });

  it("offers a user-friendly unmatched-source lookup mode", () => {
    const { getByText } = render(
      <div style={{ width: 640, height: 500 }}>
        <ReactFlowProvider>
          <ReactFlow
            fitView
            edges={[]}
            nodeTypes={reactFlowNodeTypes}
            nodes={[
              {
                id: "lookup_1",
                type: "lookup",
                position: { x: 0, y: 0 },
                data: {
                  label: "Lookup",
                  type: "lookup",
                  lookupColumn: "key",
                  indexJoinColumn: "agent_subtype",
                  indexColumns: ["agent_subtype"],
                  joinType: "anti",
                  inputType: "TableSelection",
                  indexedInputType: "TableSelection",
                  outputType: "TableSelection",
                  columnNames: [],
                  sourceInputColumns: ["key"],
                  indexedTableColumns: ["agent_subtype"],
                  connectedTableName: "agent_subtypes_tables",
                  indexedTableName: "unique_agents_tables",
                  DBNameToDBVersions: {},
                  inputCount: 2,
                },
              } as any,
            ]}
          />
        </ReactFlowProvider>
      </div>,
    );

    const antiJoinLabel = getByText("Only source rows without a match").closest("label");
    expect(antiJoinLabel).not.toBeNull();
    expect(antiJoinLabel?.querySelector("input")).toBeChecked();
  });

  it("keeps the unmatched-source lookup mode selected while derived columns update", async () => {
    const initialLookupNode = {
      id: "lookup_1",
      type: "lookup",
      position: { x: 0, y: 0 },
      data: {
        label: "Lookup",
        type: "lookup",
        lookupColumn: "key",
        indexJoinColumn: "agent_subtype",
        indexColumns: ["agent_subtype"],
        joinType: "inner",
        inputType: "TableSelection",
        indexedInputType: "TableSelection",
        outputType: "TableSelection",
        columnNames: ["agent_subtypes_tables_key", "unique_agents_tables_agent_subtype"],
        sourceInputColumns: ["key"],
        indexedTableColumns: ["agent_subtype"],
        connectedTableName: "agent_subtypes_tables",
        indexedTableName: "unique_agents_tables",
        DBNameToDBVersions: {},
        inputCount: 2,
      },
    } as any;

    const LookupHarness = () => {
      const [nodes, setNodes] = React.useState([initialLookupNode]);
      const nodesRef = React.useRef(nodes);
      const edges = React.useMemo(() => [], []);

      const updateNodeData = React.useCallback(
        (nodeId: string, patch: any) => {
          const nextGraph = applyNodeDataPatchFromRef(nodesRef, edges, nodeId, patch, {});
          setNodes(nextGraph.nodes as typeof nodes);
        },
        [edges],
      );

      React.useEffect(() => {
        nodesRef.current = nodes;
      }, [nodes]);

      const nodesWithActions = withNodeEditorActions(nodes, { updateNodeData });

      return (
        <>
          <div style={{ width: 640, height: 500 }}>
            <ReactFlow fitView edges={edges} nodeTypes={reactFlowNodeTypes} nodes={nodesWithActions} />
          </div>
          <output data-testid="lookup-state">
            {String(nodes[0].data.joinType)}:{(nodes[0].data.columnNames as string[]).join(",")}
          </output>
        </>
      );
    };

    const { getByTestId, getByText } = render(
      <ReactFlowProvider>
        <LookupHarness />
      </ReactFlowProvider>,
    );

    const getAntiJoinInput = () =>
      getByText("Only source rows without a match").closest("label")?.querySelector("input");

    fireEvent.click(getAntiJoinInput() as HTMLInputElement);

    await waitFor(() => expect(getAntiJoinInput()).toBeChecked());
    await waitFor(() => expect(getByTestId("lookup-state")).toHaveTextContent("anti:key"));
  });
});
