import React, { useCallback, useEffect, useMemo, useRef, useState, DragEvent } from "react";
import {
  Background,
  Connection,
  Edge,
  Node,
  ReactFlow,
  ReactFlowInstance,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { addToast } from "../appSlice";
import { useAppDispatch, useAppSelector } from "../hooks";
import { useLocalizations } from "../localizationContext";
import { DBVersion } from "../packFileTypes";
import { applyConnection, rehydrateGraph, removeEdge } from "../nodeGraph/connectionRules";
import { applyNodeDataPatch, deleteSelectedNodesFromGraph, withNodeEditorActions } from "../nodeGraph/editorState";
import { FlowOptionsModal } from "../nodeGraph/FlowOptionsModal";
import {
  deserializeNodeGraph,
  prepareGraphForExecution,
  serializeNodeGraphState,
} from "../nodeGraph/graphSerialization";
import {
  createFallbackNode,
  createNodeFromDefinition,
  DraggableNodeData,
  isRegisteredNodeType,
  nodeTypeSectionDefinitions,
  NodeTypeSection,
} from "../nodeGraph/nodeRegistry";
import { DefaultTableVersionsContext, nodeEditorDebugLog, stopWheelPropagation } from "../nodeGraph/nodes/shared";
import { reactFlowNodeTypes } from "../nodeGraph/nodeTypes";
import { FlowNodeDataPatch, FlowOption, SerializedNode, SerializedNodeGraph } from "../nodeGraph/types";

interface NodeExecutionResult {
  success: boolean;
  data?: unknown;
  elseData?: unknown;
  multiOutputs?: Record<string, unknown>;
  error?: string;
}

// Backend graph execution service
const executeGraphInBackend = async (
  nodes: Node[],
  edges: Edge[],
  currentPackName?: string,
  flowOptions?: FlowOption[],
): Promise<{
  success: boolean;
  executionResults: Map<string, NodeExecutionResult>;
  totalExecuted: number;
  successCount: number;
  failureCount: number;
  error?: string;
}> => {
  try {
    const preparedGraph = prepareGraphForExecution({
      nodes,
      edges,
      currentPackName,
      flowOptions,
    });

    const response = await window.api?.executeNodeGraph({
      nodes: preparedGraph.nodes,
      connections: preparedGraph.connections,
    });

    if (!response) {
      return {
        success: false,
        executionResults: new Map(),
        totalExecuted: 0,
        successCount: 0,
        failureCount: 0,
        error: "Backend API not available",
      };
    }

    // Convert serialized execution results back to Map
    const executionResults = new Map(response.executionResults);

    return {
      success: response.success,
      executionResults,
      totalExecuted: response.totalExecuted,
      successCount: response.successCount,
      failureCount: response.failureCount,
      error: response.error,
    };
  } catch (error) {
    console.error("Error executing node graph in backend:", error);
    return {
      success: false,
      executionResults: new Map(),
      totalExecuted: 0,
      successCount: 0,
      failureCount: 0,
      error: error instanceof Error ? error.message : "Backend graph execution failed",
    };
  }
};


const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

let sidebarNodeLastClickedTopLeftCorner = { left: 0, top: 0 };
let nodeDropOffset = { left: 0, top: 0 };

let nodeId = 0;
const getNodeId = () => `node_${nodeId++}`;

const NodeSidebar: React.FC<{
  onDragStart: (event: DragEvent, nodeType: DraggableNodeData) => void;
}> = ({ onDragStart }) => {
  const localized = useLocalizations();
  const localizationMap = localized as Record<string, string | undefined>;
  const [filterText, setFilterText] = useState("");
  const [useCompactView, setUseCompactView] = useState(true);

  const nodeTypeSections: NodeTypeSection[] = useMemo(() => {
    return nodeTypeSectionDefinitions.map((section) => ({
      title: localizationMap[section.titleKey] || section.titleFallback,
      nodes: section.nodes.map((node) => ({
        type: node.type,
        label: localizationMap[node.labelKey] || node.labelFallback,
        description: localizationMap[node.descriptionKey] || node.descriptionFallback,
      })),
    }));
  }, [localizationMap]);

  // Filter nodes based on search text
  const filteredSections = nodeTypeSections
    .map((section) => ({
      ...section,
      nodes: section.nodes.filter(
        (node) =>
          node.label.toLowerCase().includes(filterText.toLowerCase()) ||
          node.description.toLowerCase().includes(filterText.toLowerCase()),
      ),
    }))
    .filter((section) => section.nodes.length > 0); // Only show sections that have matching nodes

  return (
    <div
      className="w-64 height-without-topbar-and-padding bg-gray-800 border-r border-gray-600 p-4 overflow-y-auto scrollable-node-content"
      onWheel={stopWheelPropagation}
    >
      <h3 className="font-bold text-lg text-white">{localized.nodeEditorNodeTypesHeader || "Node Types"}</h3>

      {/* Sticky Filter textbox */}
      <div className="py-4 px-4 -mx-4 bg-gray-800 sticky top-0">
        <input
          type="text"
          placeholder={localized.nodeEditorFilterNodesPlaceholder || "Filter nodes..."}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="sticky top-0 w-full p-2 text-sm bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-teal-400 z-10"
        />
      </div>

      <div className="mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useCompactView}
            onChange={(event) => {
              const newValue = event.target.checked;
              setUseCompactView(newValue);
            }}
            className="w-4 h-4"
          />
          <span className="text-xs text-gray-300">{localized.nodeEditorCompactView || "Compact View"}</span>
        </label>
      </div>

      <div className="space-y-4">
        {filteredSections.map((section) => (
          <div key={section.title} className="space-y-2">
            <h4 className="font-semibold text-sm text-gray-300 uppercase tracking-wide border-b border-gray-600 pb-1">
              {section.title}
            </h4>
            <div className="space-y-2">
              {section.nodes.map((nodeType) => (
                <div
                  key={nodeType.type}
                  draggable
                  onMouseDown={(event) => {
                    const r = event.currentTarget.getBoundingClientRect();
                    sidebarNodeLastClickedTopLeftCorner = {
                      left: r.left,
                      top: r.top,
                    };
                  }}
                  onDragStart={(event) => onDragStart(event, nodeType)}
                  className="p-3 bg-gray-700 border border-gray-600 rounded-lg cursor-move hover:bg-gray-600 shadow-sm transition-colors duration-150"
                >
                  <div className="font-medium text-sm text-white">{nodeType.label}</div>
                  {!useCompactView && (
                    <div className="text-xs text-gray-300 mt-1">{nodeType.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface NodeEditorProps {
  currentFile?: string;
  currentPack?: string;
}

const collator = new Intl.Collator("en");

const NodeEditor: React.FC<NodeEditorProps> = ({ currentFile, currentPack }: NodeEditorProps) => {
  const dispatch = useAppDispatch();
  const localized = useLocalizations();
  const unsavedPacksData = useAppSelector((state) => state.app.unsavedPacksData);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  const [DBNameToDBVersions, setDBNameToDBVersions] = useState<Record<string, DBVersion[]> | undefined>(
    undefined,
  );
  const [defaultTableVersions, setDefaultTableVersions] = useState<Record<string, number> | undefined>(
    undefined,
  );

  const sortedTableNames = useMemo(() => {
    return Object.keys(DBNameToDBVersions || {}).toSorted((firstTableName, secondTableName) => {
      return collator.compare(firstTableName, secondTableName);
    });
  }, [DBNameToDBVersions]);

  // Flow options state
  const [flowOptions, setFlowOptions] = useState<FlowOption[]>([]);
  const [isFlowOptionsModalOpen, setIsFlowOptionsModalOpen] = useState(false);
  const [isGraphEnabled, setIsGraphEnabled] = useState(false);
  const [graphStartsEnabled, setGraphStartsEnabled] = useState(true);

  const updateNodeData = useCallback(
    (nodeId: string, detail: FlowNodeDataPatch) => {
      const nextGraph = applyNodeDataPatch(
        {
          nodes: nodesRef.current,
          edges,
        },
        nodeId,
        detail,
        {
          DBNameToDBVersions,
          defaultTableVersions,
          sortedTableNames,
        },
      );

      setNodes(nextGraph.nodes);
      setEdges(nextGraph.edges);
    },
    [DBNameToDBVersions, defaultTableVersions, edges, setEdges, setNodes, sortedTableNames],
  );

  const deleteSelectedNodes = useCallback(() => {
    const nextGraph = deleteSelectedNodesFromGraph(nodesRef.current, edges);
    if (nextGraph.deletedNodeIds.length === 0) {
      return;
    }

    setNodes(nextGraph.nodes);
    setEdges(nextGraph.edges);
  }, [edges, setEdges, setNodes]);

  const nodesWithEditorActions = useMemo(() => {
    return withNodeEditorActions(nodes, {
      updateNodeData,
    });
  }, [nodes, updateNodeData]);

  // Keep the ref updated with current nodes
  React.useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  React.useEffect(() => {
    nodeEditorDebugLog("getDBNameToDBVersions");
    window.api?.getDBNameToDBVersions().then((data) => {
      // console.log("getDBNameToDBVersions:", Object.keys(data));
      setDBNameToDBVersions(data);
    });
    window.api?.getDefaultTableVersions().then((data) => {
      setDefaultTableVersions(data);
    });
  }, []);

  const onConnect = useCallback(
    (params: Connection) => {
      const nextGraph = applyConnection(
        {
          nodes: nodesRef.current,
          edges,
        },
        params,
        {
          DBNameToDBVersions,
          defaultTableVersions,
          sortedTableNames,
        },
      );

      if (!nextGraph.accepted) {
        return;
      }

      setNodes(nextGraph.nodes);
      setEdges(nextGraph.edges);
    },
    [DBNameToDBVersions, defaultTableVersions, edges, setEdges, setNodes, sortedTableNames],
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const nextGraph = removeEdge(
        {
          nodes: nodesRef.current,
          edges,
        },
        edge.id,
        {
          DBNameToDBVersions,
          defaultTableVersions,
          sortedTableNames,
        },
      );

      setNodes(nextGraph.nodes);
      setEdges(nextGraph.edges);
    },
    [DBNameToDBVersions, defaultTableVersions, edges, setEdges, setNodes, sortedTableNames],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      const type = event.dataTransfer.getData("application/reactflow");

      if (typeof type === "undefined" || !type || !reactFlowBounds || !reactFlowInstance) {
        return;
      }

      const nodeData = JSON.parse(type) as Partial<DraggableNodeData> & { type?: string; label?: string };

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - nodeDropOffset.left * reactFlowInstance.getZoom(),
        y: event.clientY - reactFlowBounds.top,
      });

      if (typeof nodeData.type !== "string" || typeof nodeData.label !== "string") {
        return;
      }

      const nextNodeId = getNodeId();
      const newNode = isRegisteredNodeType(nodeData.type)
        ? createNodeFromDefinition(nodeData.type, {
            nodeId: nextNodeId,
            position,
            label: nodeData.label,
            sortedTableNames,
            DBNameToDBVersions,
          })
        : createFallbackNode(nodeData.type, {
            nodeId: nextNodeId,
            position,
            label: nodeData.label,
          });

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes, DBNameToDBVersions, sortedTableNames],
  );

  const onDragStart = (event: DragEvent, nodeType: DraggableNodeData) => {
    event.dataTransfer.setData("application/reactflow", JSON.stringify(nodeType));
    event.dataTransfer.effectAllowed = "move";

    nodeDropOffset = {
      left: event.clientX - sidebarNodeLastClickedTopLeftCorner.left,
      top: event.clientY - sidebarNodeLastClickedTopLeftCorner.top,
    };
  };

  const serializeNodeGraph = useCallback((): SerializedNodeGraph => {
    return serializeNodeGraphState({
      nodes,
      edges,
      flowOptions,
      isGraphEnabled,
      graphStartsEnabled,
    });
  }, [nodes, edges, flowOptions, isGraphEnabled, graphStartsEnabled]);

  const saveNodeGraph = useCallback(() => {
    const serializedGraph = serializeNodeGraph();
    const jsonString = JSON.stringify(serializedGraph, null, 2);

    // Create and trigger download
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `node-graph-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [serializeNodeGraph]);

  const loadNodeGraph = useCallback(
    (jsonContent: string) => {
      try {
        const { serializedGraph, nodes: deserializedNodes, edges: loadedEdges, nextNodeId } =
          deserializeNodeGraph(jsonContent);

        const loadedNodes: Node[] = deserializedNodes.map((node) => {
          const serializedNode = serializedGraph.nodes.find((candidate) => candidate.id === node.id)!;
          const serializedData = serializedNode.data;

          // Add styling for default nodes
          if (!serializedNode.type) {
            node.style = {
              border: "2px solid #3b82f6",
              borderRadius: "8px",
              padding: "10px",
              background: "#374151",
              color: "#ffffff",
            };
          }

          nodeEditorDebugLog("deserialized node type", node.data.type);

          // Debug: Check if generaterows/generaterowsschema node has transformations when loaded
          if (node.type === "generaterows" || node.type === "generaterowsschema") {
            nodeEditorDebugLog(`[LOAD] GenerateRows node ${node.id} loaded with:`, {
              hasTransformations: !!serializedData.transformations,
              transformationsLength: (serializedData.transformations || []).length,
              hasOutputTables: !!serializedData.outputTables,
              outputTablesLength: (serializedData.outputTables || []).length,
              transformations: serializedData.transformations,
              outputTables: serializedData.outputTables,
              hasCustomSchemaData: !!serializedData.customSchemaData,
              customSchemaData: serializedData.customSchemaData,
            });
          }

          // Debug: Check if groupby node has groupByColumns and aggregations when loaded
          if (node.type === "groupby") {
            nodeEditorDebugLog(`[LOAD] GroupBy node ${node.id} loaded with:`, {
              hasGroupByColumns: !!serializedData.groupByColumns,
              groupByColumnsLength: (serializedData.groupByColumns || []).length,
              hasAggregations: !!serializedData.aggregations,
              aggregationsLength: (serializedData.aggregations || []).length,
              groupByColumns: serializedData.groupByColumns,
              aggregations: serializedData.aggregations,
            });
          }
          return node;
        });
        const hydratedGraph = rehydrateGraph(
          {
            nodes: loadedNodes,
            edges: loadedEdges,
          },
          {
            DBNameToDBVersions,
            defaultTableVersions,
            sortedTableNames,
          },
        );

        nodeId = nextNodeId;

        setNodes(hydratedGraph.nodes);
        setEdges(hydratedGraph.edges);

        // Load flow options if they exist
        setFlowOptions(serializedGraph.options || []);
        setIsGraphEnabled(serializedGraph.isGraphEnabled ?? false);
        setGraphStartsEnabled(serializedGraph.graphStartsEnabled ?? true);
        nodeEditorDebugLog(
          `Loaded graph with ${hydratedGraph.nodes.length} nodes and ${hydratedGraph.edges.length} connections`,
        );
      } catch (error) {
        console.error("Failed to load node graph:", error);
        dispatch(
          addToast({
            type: "warning",
            messages: [
              localized.nodeEditorFailedToLoadNodeGraphFile ||
                "Failed to load the node graph file. Please check the file format.",
            ],
            startTime: Date.now(),
          }),
        );
      }
    },
    [
      setNodes,
      setEdges,
      DBNameToDBVersions,
      setFlowOptions,
      setIsGraphEnabled,
      setGraphStartsEnabled,
      dispatch,
      localized,
      defaultTableVersions,
      sortedTableNames,
    ],
  );

  const loadNodeGraphFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const jsonContent = event.target?.result as string;
        loadNodeGraph(jsonContent);
      };

      reader.readAsText(file);
    },
    [loadNodeGraph],
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        loadNodeGraphFile(file);
      }
      // Clear the input so the same file can be loaded again
      event.target.value = "";
    },
    [loadNodeGraphFile],
  );

  // Handle keyboard events for node deletion
  React.useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Delete or Backspace key
      if (event.key === "Delete" || event.key === "Backspace") {
        // Prevent default behavior if we're not in a text input
        const target = event.target as HTMLElement;
        if (target.tagName !== "TEXTAREA" && target.tagName !== "INPUT") {
          event.preventDefault();
          deleteSelectedNodes();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [deleteSelectedNodes]);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);

  // Save current file handler
  const saveCurrentFile = useCallback(async () => {
    if (!currentFile || !currentPack) {
      console.error("No current file or pack to save to");
      return;
    }

    const serializedGraph = serializeNodeGraph();
    const flowData = JSON.stringify(serializedGraph, null, 2);

    try {
      const result = await window.api?.saveNodeFlow(currentFile, flowData, currentPack);
      if (result?.success) {
        nodeEditorDebugLog("Flow saved successfully to:", result.filePath);
        // alert(`Flow saved successfully!`);
        dispatch(
          addToast({
            type: "success",
            messages: [localized.nodeEditorFlowSavedSuccessfully || "Flow saved successfully!"],
            startTime: Date.now(),
          }),
        );
      } else {
        console.error("Failed to save flow:", result?.error);
        dispatch(
          addToast({
            type: "warning",
            messages: [
              `${localized.nodeEditorFailedToSaveFlowPrefix || "Failed to save flow:"} ${
                result?.error || localized.nodeEditorUnknownError || "Unknown error"
              }`,
            ],
            startTime: Date.now(),
          }),
        );
      }
    } catch (error) {
      console.error("Error saving flow:", error);
      dispatch(
        addToast({
          type: "warning",
          messages: [
            `${localized.nodeEditorErrorSavingFlowPrefix || "Error saving flow:"} ${
              error instanceof Error ? error.message : localized.nodeEditorUnknownError || "Unknown error"
            }`,
          ],
          startTime: Date.now(),
        }),
      );
    }
  }, [currentFile, currentPack, serializeNodeGraph, dispatch, localized]);

  // Node execution system
  const executeNodeGraph = useCallback(async () => {
    if (isExecuting) return;

    setIsExecuting(true);
    nodeEditorDebugLog("Starting node graph execution in backend...");
    nodeEditorDebugLog("Flow options at execution time:", flowOptions);

    try {
      if (nodes.length === 0) {
        console.error("No nodes found in the graph");
        dispatch(
          addToast({
            type: "warning",
            messages: [
              localized.nodeEditorNoNodesFoundAddNodesBeforeExecuting ||
                "No nodes found. Add nodes to the graph before executing.",
            ],
            startTime: Date.now(),
          }),
        );
        return;
      }

      // Debug: Check generaterows/generaterowsschema node data before execution
      const generateRowsNodes = nodes.filter(
        (n) => n.type === "generaterows" || n.type === "generaterowsschema",
      );
      generateRowsNodes.forEach((grNode) => {
        const nodeData = grNode.data as Partial<SerializedNode["data"]>;
        nodeEditorDebugLog(`[PRE-EXECUTION] GenerateRows node ${grNode.id} data:`);
        nodeEditorDebugLog(`  transformationsLength: ${(nodeData.transformations || []).length}`);
        nodeEditorDebugLog(`  transformations:`, JSON.stringify(nodeData.transformations));
        nodeEditorDebugLog(`  outputTablesLength: ${(nodeData.outputTables || []).length}`);
        nodeEditorDebugLog(`  outputTables:`, JSON.stringify(nodeData.outputTables));
      });

      // Execute the entire graph in the backend
      const result = await executeGraphInBackend(nodes, edges, currentPack, flowOptions);

      nodeEditorDebugLog(
        `Backend graph execution completed: ${result.successCount}/${result.totalExecuted} nodes succeeded`,
      );

      if (result.error) {
        console.error("Graph execution error:", result.error);
      }

      // Show results in alert (in a real app, you'd show this in a better UI)
      const summary = Array.from(result.executionResults.entries())
        .map(
          ([nodeId, nodeResult]) =>
            `${nodeId}: ${
              nodeResult.success ? "✅" : "❌" + (nodeResult.error ? ` (${nodeResult.error})` : "")
            }`,
        )
        .join("\n");

      const statusMessage = result.success
        ? localized.nodeEditorGraphExecutionSuccessful || "✅ Graph execution successful!"
        : result.failureCount > 0
          ? localized.nodeEditorGraphExecutionCompletedWithErrors ||
            "❌ Graph execution completed with errors"
          : localized.nodeEditorGraphExecutionFailed || "❌ Graph execution failed";

      const executionSummaryLabel = localized.nodeEditorExecutionSummaryLabel || "Execution Summary";
      const nodesSucceededLabel = localized.nodeEditorNodesSucceededLabel || "nodes succeeded";
      const checkConsoleLabel =
        localized.nodeEditorCheckConsoleForDetailedResults || "Check console for detailed results.";

      dispatch(
        addToast({
          type: result.successCount === result.totalExecuted ? "success" : "warning",
          messages: [
            `${statusMessage}\n\n${executionSummaryLabel} (${result.successCount}/${result.totalExecuted} ${nodesSucceededLabel}):\n${summary}\n\n${checkConsoleLabel}`,
          ],
          startTime: Date.now(),
        }),
      );
    } catch (error) {
      console.error("Error during graph execution:", error);
      dispatch(
        addToast({
          type: "warning",
          messages: [
            `${localized.nodeEditorGraphExecutionFailedPrefix || "Graph execution failed:"} ${
              error instanceof Error ? error.message : localized.nodeEditorUnknownError || "Unknown error"
            }`,
          ],
          startTime: Date.now(),
        }),
      );
    } finally {
      setIsExecuting(false);
    }
  }, [nodes, edges, isExecuting, currentPack, flowOptions, dispatch, localized]);

  useEffect(() => {
    const loadFileContent = async () => {
      if (!currentFile || !currentPack) return;

      // First try to load from unsaved files
      const unsavedFiles = unsavedPacksData[currentPack];
      if (unsavedFiles) {
        const unsavedFile = unsavedFiles.find((file) => file.name == currentFile);
        if (unsavedFile && unsavedFile.text) {
          loadNodeGraph(unsavedFile.text);
          return;
        }
      }

      // If not in unsaved files, read from pack
      try {
        const result = await window.api?.readFileFromPack(currentPack, currentFile);
        if (result?.success && result.text) {
          loadNodeGraph(result.text);
        } else {
          console.error("Failed to read file from pack:", result?.error);
          dispatch(
            addToast({
              type: "warning",
              messages: [
                `${localized.nodeEditorFailedToLoadFilePrefix || "Failed to load file:"} ${
                  result?.error || localized.nodeEditorUnknownError || "Unknown error"
                }`,
              ],
              startTime: Date.now(),
            }),
          );
        }
      } catch (error) {
        console.error("Error loading file:", error);
        dispatch(
          addToast({
            type: "warning",
            messages: [
              `${localized.nodeEditorErrorLoadingFilePrefix || "Error loading file:"} ${
                error instanceof Error ? error.message : localized.nodeEditorUnknownError || "Unknown error"
              }`,
            ],
            startTime: Date.now(),
          }),
        );
      }
    };

    loadFileContent();
  }, [currentFile, currentPack, unsavedPacksData, loadNodeGraph, dispatch, localized]);

  return (
    <div className="flex explicit-height-without-topbar-and-padding">
      <NodeSidebar onDragStart={onDragStart} />
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <DefaultTableVersionsContext.Provider value={defaultTableVersions}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodesWithEditorActions}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgeClick={onEdgeClick}
              onInit={setReactFlowInstance}
              onDrop={onDrop}
              onDragOver={onDragOver}
              nodeTypes={reactFlowNodeTypes}
              noWheelClassName="scrollable-node-content"
              fitView
            >
              <Background />
            </ReactFlow>

            {/* Control buttons positioned in top-right corner */}
            <div className="absolute top-4 right-4 z-10 flex gap-2">
              {/* Hidden file input */}
              <input
                type="file"
                accept=".json"
                onChange={handleFileInput}
                className="hidden"
                id="load-graph-input"
              />

              {/* Flow Options button */}
              <button
                onClick={() => setIsFlowOptionsModalOpen(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4"
                  />
                </svg>
                {localized.nodeEditorFlowOptions || "Flow Options"}
              </button>

              {/* Save button - only shown when currentFile exists */}
              {currentFile && (
                <button
                  onClick={saveCurrentFile}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  {localized.save || "Save"}
                </button>
              )}

              {/* Run button */}
              <button
                onClick={executeNodeGraph}
                disabled={nodes.length === 0 || isExecuting}
                className={`px-4 py-2 font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2 ${
                  nodes.length > 0 && !isExecuting
                    ? "bg-purple-600 hover:bg-purple-700 text-white cursor-pointer"
                    : "bg-gray-400 text-gray-600 cursor-not-allowed"
                }`}
              >
                {isExecuting ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    {localized.nodeEditorRunning || "Running..."}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1M9 16h1m4 0h1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    {localized.nodeEditorRun || "Run"}
                  </>
                )}
              </button>

              {/* Delete selected nodes button */}
              <button
                onClick={deleteSelectedNodes}
                disabled={!nodes.some((node) => node.selected)}
                className={`px-4 py-2 font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2 ${
                  nodes.some((node) => node.selected)
                    ? "bg-red-600 hover:bg-red-700 text-white cursor-pointer"
                    : "bg-gray-400 text-gray-600 cursor-not-allowed"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                {localized.delete || "Delete"}
              </button>

              {/* Load button */}
              <label
                htmlFor="load-graph-input"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                  />
                </svg>
                {localized.nodeEditorLoadGraph || "Load Graph"}
              </label>

              {/* Save button */}
              <button
                onClick={saveNodeGraph}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                {localized.nodeEditorSaveGraph || "Save Graph"}
              </button>
            </div>
          </ReactFlowProvider>
        </DefaultTableVersionsContext.Provider>
      </div>

      {/* Flow Options Modal */}
      <FlowOptionsModal
        isOpen={isFlowOptionsModalOpen}
        onClose={() => setIsFlowOptionsModalOpen(false)}
        options={flowOptions}
        onOptionsChange={setFlowOptions}
        isGraphEnabled={isGraphEnabled}
        onGraphEnabledChange={setIsGraphEnabled}
        graphStartsEnabled={graphStartsEnabled}
        onGraphStartsEnabledChange={setGraphStartsEnabled}
      />
    </div>
  );
};

export default NodeEditor;
