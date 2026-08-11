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
import { addToast, selectFlowFile, setNodeEditorFavorites } from "../appSlice";
import { useAppDispatch, useAppSelector } from "../hooks";
import { useLocalizations } from "../localizationContext";
import { DBVersion } from "../packFileTypes";
import { resolveManualFlowSourcePack } from "../flowExecutionSupport";
import { applyConnection, rehydrateGraph, removeEdge } from "../nodeGraph/connectionRules";
import {
  applyNodeDataPatchFromRef,
  deleteSelectedNodesFromGraph,
  getNodesDisabledByUpstream,
  selectAllNodes,
  toggleSelectedNodesDisabled,
  withNodeEditorActions,
} from "../nodeGraph/editorState";
import { FlowOptionsModal } from "../nodeGraph/FlowOptionsModal";
import { buildQuickConnectionCandidates, hasDirectedConnection } from "../nodeGraph/quickConnect";
import {
  NodeGraphClipboard,
  copySelectedNodes,
  isTextEntryTarget,
  pasteNodes,
} from "../nodeGraph/clipboard";
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
import {
  DefaultTableVersionsContext,
  FlowOptionsContext,
  nodeEditorDebugLog,
  stopWheelPropagation,
} from "../nodeGraph/nodes/shared";
import { reactFlowNodeTypes } from "../nodeGraph/nodeTypes";
import {
  moveFavoriteNodeType,
  toggleFavoriteNodeType,
  withFavoritesSection,
} from "../nodeGraph/favorites";
import { FlowNodeDataPatch, FlowOption, SerializedNode, SerializedNodeGraph } from "../nodeGraph/types";
import FlowPackDialog from "./FlowPackDialog";

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
  flowSourcePack?: string,
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
      flowSourcePack,
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
  const dispatch = useAppDispatch();
  const favorites = useAppSelector((state) => state.app.nodeEditorFavorites);
  const [filterText, setFilterText] = useState("");
  const [useCompactView, setUseCompactView] = useState(true);
  const [contextMenu, setContextMenu] = useState<
    { nodeType: FlowNodeType; x: number; y: number } | undefined
  >(undefined);
  /** The favorite currently being dragged within the list, so a drop knows what to move. */
  const reorderingFavorite = useRef<FlowNodeType | undefined>(undefined);

  const setFavorites = useCallback(
    (nextFavorites: FlowNodeType[]) => dispatch(setNodeEditorFavorites(nextFavorites)),
    [dispatch],
  );

  const toggleFavorite = useCallback(
    (nodeType: FlowNodeType) => setFavorites(toggleFavoriteNodeType(favorites, nodeType)),
    [favorites, setFavorites],
  );

  const moveFavoriteTo = useCallback(
    (dragged: FlowNodeType, target: FlowNodeType) =>
      setFavorites(moveFavoriteNodeType(favorites, dragged, target)),
    [favorites, setFavorites],
  );

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

  const sectionsWithFavorites = useMemo(
    () =>
      withFavoritesSection(
        nodeTypeSections,
        favorites,
        localized.nodeEditorSectionFavorites || "Favorites",
      ),
    [favorites, nodeTypeSections, localized],
  );

  // Filter nodes based on search text
  const filteredSections = sectionsWithFavorites
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

      {contextMenu && (
        <>
          {/* A click anywhere else dismisses the menu. */}
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(undefined)} />
          <div
            className="fixed z-50 bg-gray-700 border border-gray-500 rounded shadow-lg text-xs text-white"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="block w-full text-left px-3 py-2 hover:bg-gray-600"
              onClick={() => {
                toggleFavorite(contextMenu.nodeType);
                setContextMenu(undefined);
              }}
            >
              {favorites.includes(contextMenu.nodeType)
                ? localized.nodeEditorRemoveFromFavorites || "Remove from favorites"
                : localized.nodeEditorAddToFavorites || "Add to favorites"}
            </button>
          </div>
        </>
      )}

      <div className="space-y-4">
        {filteredSections.map((section, sectionIndex) => (
          <div key={section.title} className="space-y-2">
            <h4 className="font-semibold text-sm text-gray-300 uppercase tracking-wide border-b border-gray-600 pb-1">
              {section.title}
            </h4>
            <div className="space-y-2">
              {section.nodes.map((nodeType) => (
                <div
                  key={nodeType.type}
                  draggable
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ nodeType: nodeType.type, x: event.clientX, y: event.clientY });
                  }}
                  onDragEnd={() => {
                    reorderingFavorite.current = undefined;
                  }}
                  {...(sectionIndex === 0 && favorites.length > 0
                    ? {
                        // Dragging a favorite onto another reorders the list. The drag still carries
                        // its node type, so dropping on the canvas creates a node as before.
                        onDragOver: (event: DragEvent) => {
                          if (reorderingFavorite.current) event.preventDefault();
                        },
                        onDrop: (event: DragEvent) => {
                          const dragged = reorderingFavorite.current;
                          if (!dragged) return;
                          event.preventDefault();
                          event.stopPropagation();
                          moveFavoriteTo(dragged, nodeType.type);
                          reorderingFavorite.current = undefined;
                        },
                      }
                    : {})}
                  onMouseDown={(event) => {
                    const r = event.currentTarget.getBoundingClientRect();
                    sidebarNodeLastClickedTopLeftCorner = {
                      left: r.left,
                      top: r.top,
                    };
                  }}
                  onDragStart={(event) => {
                    reorderingFavorite.current =
                      sectionIndex === 0 && favorites.length > 0 ? nodeType.type : undefined;
                    onDragStart(event, nodeType);
                  }}
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
  const localizedRef = useRef(localized);
  localizedRef.current = localized;
  const unsavedPacksData = useAppSelector((state) => state.app.unsavedPacksData);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [quickConnectSourceNodeId, setQuickConnectSourceNodeId] = useState<string | null>(null);
  /**
   * Bumped on every full graph load to force the node components to remount.
   *
   * Node ids restart at node_0 in every graph, so loading a second graph often reuses an id at the
   * same type - node_2 being a table dropdown in both. React then keeps the existing component
   * instance, and with it the local state behind its text fields, so a value from the previous graph
   * survives into the new one and gets written back into its node data.
   */
  const [graphInstanceKey, setGraphInstanceKey] = useState(0);
  /** Copied nodes live for the session rather than in the system clipboard, which holds text. */
  const nodeClipboardRef = useRef<NodeGraphClipboard | undefined>(undefined);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  const [DBNameToDBVersions, setDBNameToDBVersions] = useState<Record<string, DBVersion[]> | undefined>(
    undefined,
  );
  const [defaultTableVersions, setDefaultTableVersions] = useState<Record<string, number> | undefined>(
    undefined,
  );
  const [isSchemaContextReady, setIsSchemaContextReady] = useState(false);
  const flowLoadRequestIdRef = useRef(0);

  const sortedTableNames = useMemo(() => {
    return Object.keys(DBNameToDBVersions || {}).toSorted((firstTableName, secondTableName) => {
      return collator.compare(firstTableName, secondTableName);
    });
  }, [DBNameToDBVersions]);

  // Flow options state
  const [flowOptions, setFlowOptions] = useState<FlowOption[]>([]);
  const [isFlowOptionsModalOpen, setIsFlowOptionsModalOpen] = useState(false);
  const [packDialogMode, setPackDialogMode] = useState<"load" | "save" | undefined>();
  const [isPackMenuOpen, setIsPackMenuOpen] = useState(false);
  const [isGraphEnabled, setIsGraphEnabled] = useState(false);
  const [graphStartsEnabled, setGraphStartsEnabled] = useState(true);

  const updateNodeData = useCallback(
    (nodeId: string, detail: FlowNodeDataPatch) => {
      const nextGraph = applyNodeDataPatchFromRef(
        nodesRef,
        edges,
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

  const selectedNodes = nodes.filter((node) => node.selected);
  const hasSelectedNodes = selectedNodes.length > 0;
  const areAllSelectedNodesDisabled =
    hasSelectedNodes && selectedNodes.every((node) => node.data.isDisabled === true);

  const toggleSelectedNodes = useCallback(() => {
    const nextGraph = toggleSelectedNodesDisabled(nodesRef.current);
    if (nextGraph.selectedNodeIds.length === 0) {
      return;
    }

    nodesRef.current = nextGraph.nodes;
    setNodes(nextGraph.nodes);
    if (
      nextGraph.disabled &&
      quickConnectSourceNodeId &&
      nextGraph.selectedNodeIds.includes(quickConnectSourceNodeId)
    ) {
      setQuickConnectSourceNodeId(null);
    }
  }, [quickConnectSourceNodeId, setNodes]);

  const manuallyDisabledNodeIds = useMemo(
    () => new Set(nodes.filter((node) => node.data.isDisabled === true).map((node) => node.id)),
    [nodes],
  );
  const nodesDisabledByUpstream = useMemo(
    () => getNodesDisabledByUpstream(nodes, edges),
    [edges, nodes],
  );

  const nodesWithEditorActions = useMemo(() => {
    const actionNodes = withNodeEditorActions(nodes, {
      updateNodeData,
    });

    return actionNodes.map((node) => {
      const className = [
        node.className,
        node.id === quickConnectSourceNodeId ? "quick-connect-source" : undefined,
        manuallyDisabledNodeIds.has(node.id) ? "node-disabled" : undefined,
        nodesDisabledByUpstream.has(node.id) ? "node-disabled-by-upstream" : undefined,
      ]
        .filter(Boolean)
        .join(" ");

      return className === node.className ? node : { ...node, className };
    });
  }, [manuallyDisabledNodeIds, nodes, nodesDisabledByUpstream, quickConnectSourceNodeId, updateNodeData]);

  const edgesWithDisabledState = useMemo(
    () =>
      edges.map((edge) => {
        const disabledClassName = manuallyDisabledNodeIds.has(edge.source)
          ? "disabled-source"
          : nodesDisabledByUpstream.has(edge.source) || nodesDisabledByUpstream.has(edge.target)
            ? "disabled-consequence"
            : undefined;

        return disabledClassName
          ? {
              ...edge,
              animated: false,
              className: [edge.className, disabledClassName].filter(Boolean).join(" "),
            }
          : edge;
      }),
    [edges, manuallyDisabledNodeIds, nodesDisabledByUpstream],
  );

  // Keep the ref updated with current nodes
  React.useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  React.useEffect(() => {
    if (quickConnectSourceNodeId && !nodes.some((node) => node.id === quickConnectSourceNodeId)) {
      setQuickConnectSourceNodeId(null);
    }
  }, [nodes, quickConnectSourceNodeId]);

  React.useEffect(() => {
    let cancelled = false;
    nodeEditorDebugLog("getDBNameToDBVersions");

    void Promise.allSettled([
      window.api?.getDBNameToDBVersions() ?? Promise.resolve(undefined),
      window.api?.getDefaultTableVersions() ?? Promise.resolve(undefined),
    ]).then(([schemas, defaults]) => {
      if (cancelled) return;
      if (schemas.status === "fulfilled") setDBNameToDBVersions(schemas.value);
      else console.error("Failed to load node editor schemas:", schemas.reason);
      if (defaults.status === "fulfilled") setDefaultTableVersions(defaults.value);
      else console.error("Failed to load default table versions:", defaults.reason);
      // Flow rehydration derives connected column state from both values. Waiting for both requests
      // to settle avoids remounting the same packed flow once per request.
      setIsSchemaContextReady(true);
    });

    return () => {
      cancelled = true;
    };
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

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const eventTarget = event.target as HTMLElement;
      if (eventTarget.closest("input, textarea, select, button, a, .react-flow__handle")) {
        return;
      }

      if (!event.shiftKey) {
        setQuickConnectSourceNodeId(null);
        return;
      }

      if (!quickConnectSourceNodeId) {
        const sourceHandles =
          reactFlowInstance?.getInternalNode(node.id)?.internals.handleBounds?.source ?? [];
        if (sourceHandles.length > 0) {
          setQuickConnectSourceNodeId(node.id);
        }
        return;
      }

      if (quickConnectSourceNodeId === node.id) {
        setQuickConnectSourceNodeId(null);
        return;
      }

      if (hasDirectedConnection(edges, quickConnectSourceNodeId, node.id)) {
        setQuickConnectSourceNodeId(null);
        return;
      }

      const sourceHandles =
        reactFlowInstance?.getInternalNode(quickConnectSourceNodeId)?.internals.handleBounds?.source ?? [];
      const targetHandles =
        reactFlowInstance?.getInternalNode(node.id)?.internals.handleBounds?.target ?? [];
      const candidates = buildQuickConnectionCandidates({
        sourceNodeId: quickConnectSourceNodeId,
        targetNodeId: node.id,
        sourceHandles,
        targetHandles,
        edges,
      });

      for (const candidate of candidates) {
        const nextGraph = applyConnection(
          { nodes: nodesRef.current, edges },
          candidate,
          { DBNameToDBVersions, defaultTableVersions, sortedTableNames },
        );
        if (!nextGraph.accepted) {
          continue;
        }

        setNodes(nextGraph.nodes);
        setEdges(nextGraph.edges);
        setQuickConnectSourceNodeId(null);
        return;
      }
    },
    [
      DBNameToDBVersions,
      defaultTableVersions,
      edges,
      quickConnectSourceNodeId,
      reactFlowInstance,
      setEdges,
      setNodes,
      sortedTableNames,
    ],
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

  const getSerializedFlowData = useCallback(
    () => JSON.stringify(serializeNodeGraph(), null, 2),
    [serializeNodeGraph],
  );

  const openFlowFromPack = useCallback(
    (selection: { flowFile: string; packPath: string }) => {
      dispatch(selectFlowFile(selection));
    },
    [dispatch],
  );

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

        setGraphInstanceKey((previousKey) => previousKey + 1);
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
      setGraphInstanceKey,
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
  const loadNodeGraphRef = useRef(loadNodeGraph);
  loadNodeGraphRef.current = loadNodeGraph;

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
        // A local JSON file has no owning pack, even though the editor keeps a working pack context.
        dispatch(
          currentPack
            ? selectFlowFile({ flowFile: undefined, packPath: currentPack })
            : selectFlowFile(undefined),
        );
        loadNodeGraphFile(file);
      }
      // Clear the input so the same file can be loaded again
      event.target.value = "";
    },
    [currentPack, dispatch, loadNodeGraphFile],
  );

  const newNodeGraph = useCallback(() => {
    // Everything a graph can leave behind is reset here. The instance key is the important one:
    // node ids restart at node_0, so without a remount React reuses the component behind an id and
    // the local state behind its text fields comes back in the blank graph.
    setGraphInstanceKey((previousKey) => previousKey + 1);
    nodeId = 0;
    nodesRef.current = [];
    setNodes([]);
    setEdges([]);
    setFlowOptions([]);
    setIsGraphEnabled(false);
    setGraphStartsEnabled(true);
    setQuickConnectSourceNodeId(null);
    // Detach the blank graph from the previously open file. Keeping the pack selected makes the
    // pack dialog convenient, while clearing the file guarantees that choosing the same flow again
    // changes currentFile and reruns the loader.
    dispatch(
      currentPack
        ? selectFlowFile({ flowFile: undefined, packPath: currentPack })
        : selectFlowFile(undefined),
    );
    nodeEditorDebugLog("Started a blank graph");
  }, [currentPack, dispatch, setNodes, setEdges]);

  const selectAll = useCallback(() => {
    const nextGraph = selectAllNodes(nodesRef.current);
    if (!nextGraph.changed) return;

    nodesRef.current = nextGraph.nodes;
    setNodes(nextGraph.nodes);
  }, [setNodes]);

  const copySelection = useCallback(() => {
    const copied = copySelectedNodes(nodesRef.current, edges);
    if (!copied) return;
    nodeClipboardRef.current = copied;
    nodeEditorDebugLog(`Copied ${copied.nodes.length} node(s) and ${copied.edges.length} edge(s)`);
  }, [edges]);

  const pasteSelection = useCallback(() => {
    const clipboard = nodeClipboardRef.current;
    if (!clipboard) return;

    const nextGraph = pasteNodes({ nodes: nodesRef.current, edges }, clipboard, getNodeId);
    setNodes(nextGraph.nodes);
    setEdges(nextGraph.edges);
    nodeEditorDebugLog(`Pasted ${clipboard.nodes.length} node(s)`);
  }, [edges, setNodes, setEdges]);

  // Handle keyboard events for node deletion, copy and paste
  React.useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Everything here acts on the graph, so it must not fire while the user is typing in a field.
      if (isTextEntryTarget(event.target)) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedNodes();
        return;
      }

      if (!event.ctrlKey && !event.metaKey) return;

      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        selectAll();
        return;
      }

      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        copySelection();
        return;
      }

      if (event.key === "v" || event.key === "V") {
        event.preventDefault();
        pasteSelection();
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [deleteSelectedNodes, selectAll, copySelection, pasteSelection]);

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
        // show success dialog here if this path is revived.
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
      const result = await executeGraphInBackend(
        nodes,
        edges,
        currentPack,
        flowOptions,
        resolveManualFlowSourcePack(currentFile, currentPack),
      );

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
  }, [nodes, edges, isExecuting, currentFile, currentPack, flowOptions, dispatch, localized]);

  const selectedUnsavedFlowText =
    currentFile && currentPack
      ? unsavedPacksData[currentPack]?.find((file) => file.name === currentFile)?.text
      : undefined;

  useEffect(() => {
    const requestId = ++flowLoadRequestIdRef.current;
    const loadFileContent = async () => {
      if (!isSchemaContextReady || !currentFile || !currentPack) return;

      // First try to load from unsaved files
      if (selectedUnsavedFlowText) {
        if (requestId !== flowLoadRequestIdRef.current) return;
        loadNodeGraphRef.current(selectedUnsavedFlowText);
        return;
      }

      // If not in unsaved files, read from pack
      try {
        const result = await window.api?.readFileFromPack(currentPack, currentFile);
        if (requestId !== flowLoadRequestIdRef.current) return;
        if (result?.success && result.text) {
          loadNodeGraphRef.current(result.text);
        } else {
          console.error("Failed to read file from pack:", result?.error);
          const currentLocalized = localizedRef.current;
          dispatch(
            addToast({
              type: "warning",
              messages: [
                `${currentLocalized.nodeEditorFailedToLoadFilePrefix || "Failed to load file:"} ${
                  result?.error || currentLocalized.nodeEditorUnknownError || "Unknown error"
                }`,
              ],
              startTime: Date.now(),
            }),
          );
        }
      } catch (error) {
        if (requestId !== flowLoadRequestIdRef.current) return;
        console.error("Error loading file:", error);
        const currentLocalized = localizedRef.current;
        dispatch(
          addToast({
            type: "warning",
            messages: [
              `${currentLocalized.nodeEditorErrorLoadingFilePrefix || "Error loading file:"} ${
                error instanceof Error
                  ? error.message
                  : currentLocalized.nodeEditorUnknownError || "Unknown error"
              }`,
            ],
            startTime: Date.now(),
          }),
        );
      }
    };

    void loadFileContent();
    return () => {
      if (flowLoadRequestIdRef.current === requestId) flowLoadRequestIdRef.current += 1;
    };
  }, [
    currentFile,
    currentPack,
    selectedUnsavedFlowText,
    dispatch,
    isSchemaContextReady,
  ]);

  return (
    <div className="flex explicit-height-without-topbar-and-padding">
      <NodeSidebar onDragStart={onDragStart} />
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <DefaultTableVersionsContext.Provider value={defaultTableVersions}>
        <FlowOptionsContext.Provider value={flowOptions}>
          {/* Keyed on the provider, not the flow: React Flow's node store lives in the provider, so
              remounting only the inner flow would leave the previous graph's state behind. */}
          <ReactFlowProvider key={graphInstanceKey}>
            <ReactFlow
              className="node-editor-flow"
              nodes={nodesWithEditorActions}
              edges={edgesWithDisabledState}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onPaneClick={() => setQuickConnectSourceNodeId(null)}
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

            {quickConnectSourceNodeId && (
              <div
                className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-lg border border-blue-600 bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-xl"
                role="status"
                aria-live="polite"
              >
                <div className="font-semibold">
                  {localized.nodeEditorQuickConnectionStarted || "Quick connection started."}
                </div>
                <div className="mt-1 text-xs text-slate-300">
                  {localized.nodeEditorQuickConnectionSelectSecondNode ||
                    "Shift-click a second node to create the connection."}
                </div>
              </div>
            )}

            {/* Control buttons positioned in top-right corner */}
            <div className="absolute top-4 right-4 z-10 flex max-w-[calc(100%-2rem)] flex-wrap justify-end gap-2">
              {/* Hidden file input */}
              <input
                type="file"
                accept=".json"
                onChange={handleFileInput}
                className="hidden"
                id="load-graph-input"
              />

              {/* Pack operations */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsPackMenuOpen((isOpen) => !isOpen)}
                  aria-haspopup="menu"
                  aria-expanded={isPackMenuOpen}
                  className="flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 font-medium text-white shadow-lg transition-colors duration-200 hover:bg-cyan-600"
                >
                  {localized.nodeEditorPackMenu || "Pack"}
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {isPackMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-48 overflow-hidden rounded-lg border border-gray-600 bg-gray-800 shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsPackMenuOpen(false);
                        setPackDialogMode("load");
                      }}
                      className="block w-full px-4 py-3 text-left text-sm text-white hover:bg-gray-700"
                    >
                      {localized.nodeEditorLoadFromPack || "Load From Pack…"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsPackMenuOpen(false);
                        setPackDialogMode("save");
                      }}
                      className="block w-full px-4 py-3 text-left text-sm text-white hover:bg-gray-700"
                    >
                      {localized.nodeEditorSaveToPack || "Save To Pack…"}
                    </button>
                  </div>
                )}
              </div>

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

              {/* Enable or disable selected nodes */}
              <button
                onClick={toggleSelectedNodes}
                disabled={!hasSelectedNodes}
                title={
                  areAllSelectedNodesDisabled
                    ? "Enable the selected nodes"
                    : "Disable the selected nodes and stop their outgoing branches"
                }
                className={`px-4 py-2 font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2 ${
                  hasSelectedNodes
                    ? areAllSelectedNodesDisabled
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                      : "bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
                    : "bg-gray-400 text-gray-600 cursor-not-allowed"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {areAllSelectedNodesDisabled ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 12h14m-7-7v14"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  )}
                </svg>
                {areAllSelectedNodesDisabled ? "Enable" : "Disable"}
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

              {/* New button */}
              <button
                onClick={newNodeGraph}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
                title={
                  localized.nodeEditorNewGraphTooltip ||
                  "Clears the editor and starts an empty flow. Save the current one first if you want to keep it."
                }
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                {localized.nodeEditorNewGraph || "New"}
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
        </FlowOptionsContext.Provider>
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
      <FlowPackDialog
        show={packDialogMode !== undefined}
        mode={packDialogMode || "load"}
        currentFile={currentFile}
        currentPack={currentPack}
        getFlowData={getSerializedFlowData}
        onClose={() => setPackDialogMode(undefined)}
        onOpenFlow={openFlowFromPack}
      />
    </div>
  );
};

export default NodeEditor;
