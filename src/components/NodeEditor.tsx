import React, { useCallback, useState, useRef, DragEvent } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  ReactFlowProvider,
  ReactFlowInstance,
  XYPosition,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Serialization types
interface SerializedNode {
  id: string;
  type: string;
  position: XYPosition;
  data: {
    label: string;
    type: string;
    textValue?: string;
    selectedPack?: string;
    outputType?: NodeEdgeTypes;
    inputType?: NodeEdgeTypes;
  };
}

interface SerializedConnection {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType?: NodeEdgeTypes;
  targetType?: NodeEdgeTypes;
}

interface SerializedNodeGraph {
  version: string;
  timestamp: number;
  nodes: SerializedNode[];
  connections: SerializedConnection[];
  metadata: {
    nodeCount: number;
    connectionCount: number;
  };
}

// Execution system types
interface NodeExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
}

interface NodeData extends Record<string, unknown> {
  label: string;
  type: string;
  textValue?: string;
  outputType?: NodeEdgeTypes;
}

interface PackFilesNodeData extends NodeData {
  textValue: string;
  outputType: "PackFiles";
}

interface TableSelectionNodeData extends NodeData {
  textValue: string;
  inputType: "PackFiles";
  outputType: "TableSelection";
}

interface ColumnSelectionNodeData extends NodeData {
  textValue: string;
  inputType: "TableSelection";
  outputType: "ColumnSelection";
}

interface NumericAdjustmentNodeData extends NodeData {
  textValue: string;
  inputType: "ColumnSelection";
  outputType: "ChangedColumnSelection";
}

interface SaveChangesNodeData extends NodeData {
  textValue: string;
  inputType: "ChangedColumnSelection";
}

interface PackFilesDropdownNodeData extends NodeData {
  selectedPack: string;
  outputType: "PackFiles";
}

interface DraggableNodeData {
  type: string;
  label: string;
  description: string;
}

// Custom PackFiles dropdown node component
const PackFilesDropdownNode: React.FC<{ data: PackFilesDropdownNodeData; id: string }> = ({ data, id }) => {
  const allMods = window.api?.getAppState?.()?.allMods || [];
  const [selectedPack, setSelectedPack] = useState(data.selectedPack || "");

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedPack(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, selectedPack: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-cyan-500 rounded-lg p-4 min-w-[200px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-cyan-500" />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <select
        value={selectedPack}
        onChange={handleDropdownChange}
        className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-cyan-400"
      >
        <option value="">Select a pack...</option>
        {allMods.map((mod) => (
          <option key={mod.name} value={mod.name}>
            {mod.humanName || mod.name}
          </option>
        ))}
      </select>

      <div className="mt-2 text-xs text-gray-400">Output: PackFiles</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-green-500"
        data-output-type="PackFiles"
      />
    </div>
  );
};

// Custom PackFiles node component with built-in textbox
const PackFilesNode: React.FC<{ data: PackFilesNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, textValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-blue-500 rounded-lg p-4 min-w-[200px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-blue-500" />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter pack files configuration..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-blue-400"
      />

      <div className="mt-2 text-xs text-gray-400">Output: PackFiles</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-green-500"
        data-output-type="PackFiles"
      />
    </div>
  );
};

// Custom TableSelection node component that accepts PackedFiles input and outputs TableSelection
const TableSelectionNode: React.FC<{ data: TableSelectionNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, textValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-purple-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-blue-500"
        data-input-type="PackFiles"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: PackFiles</div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter table selection criteria..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-purple-400"
      />

      <div className="mt-2 text-xs text-gray-400">Output: TableSelection</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-orange-500"
        data-output-type="TableSelection"
      />
    </div>
  );
};

// Custom ColumnSelection node component that accepts TableSelection input and outputs ColumnSelection
const ColumnSelectionNode: React.FC<{ data: ColumnSelectionNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, textValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-emerald-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: TableSelection</div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter column selection criteria..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-emerald-400"
      />

      <div className="mt-2 text-xs text-gray-400">Output: ColumnSelection</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-pink-500"
        data-output-type="ColumnSelection"
      />
    </div>
  );
};

// Custom NumericAdjustment node component that accepts ColumnSelection input and outputs ChangedColumnSelection
const NumericAdjustmentNode: React.FC<{ data: NumericAdjustmentNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, textValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-yellow-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-pink-500"
        data-input-type="ColumnSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: ColumnSelection</div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter formula using x as input (e.g., x + 10, x * 1.5, x^2 + 3*x - 5)..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-yellow-400"
      />

      <div className="mt-2 text-xs text-gray-400">Output: ChangedColumnSelection</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-cyan-500"
        data-output-type="ChangedColumnSelection"
      />
    </div>
  );
};

// Custom SaveChanges node component that accepts ChangedColumnSelection input
const SaveChangesNode: React.FC<{ data: SaveChangesNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, textValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-green-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-cyan-500"
        data-input-type="ChangedColumnSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: ChangedColumnSelection</div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter save configuration (file path, format, etc.)..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-green-400"
      />

      <div className="mt-2 text-xs text-gray-400">Final save operation</div>
    </div>
  );
};

const nodeTypes = [
  { type: "packedfiles", label: "PackFiles Node", description: "Node with textbox that outputs PackFiles" },
  { type: "packfilesdropdown", label: "PackFiles Dropdown", description: "Node with dropdown for pack selection" },
  {
    type: "tableselection",
    label: "Table Selection Node",
    description: "Accepts PackFiles input, outputs TableSelection",
  },
  {
    type: "columnselection",
    label: "Column Selection Node",
    description: "Accepts TableSelection input, outputs ColumnSelection",
  },
  {
    type: "numericadjustment",
    label: "Numeric Adjustment Node",
    description: "Accepts ColumnSelection input, outputs ChangedColumnSelection",
  },
  {
    type: "savechanges",
    label: "Save Changes Node",
    description: "Accepts ChangedColumnSelection input and saves the changes",
  },
] as { type: FlowNodeType; label: string; description: string }[];

// Backend graph execution service
const executeGraphInBackend = async (
  nodes: Node[],
  edges: Edge[]
): Promise<{
  success: boolean;
  executionResults: Map<string, NodeExecutionResult>;
  totalExecuted: number;
  successCount: number;
  failureCount: number;
  error?: string;
}> => {
  try {
    // Convert nodes and edges to serialized format for backend
    const serializedNodes = nodes.map((node) => ({
      id: node.id,
      type: node.type || "default",
      data: {
        label: node.data?.label ? String(node.data.label) : "",
        type: node.data?.type ? String(node.data.type) : "",
        textValue: (node.data as any)?.textValue ? String((node.data as any).textValue) : "",
        selectedPack: (node.data as any)?.selectedPack ? String((node.data as any).selectedPack) : "",
        outputType: (node.data as any)?.outputType,
        inputType: (node.data as any)?.inputType,
      },
    }));

    const serializedConnections = edges.map((edge) => ({
      id: edge.id || `${edge.source}-${edge.target}`,
      sourceId: edge.source || "",
      targetId: edge.target || "",
      sourceType: (nodes.find((n) => n.id === edge.source)?.data as any)?.outputType,
      targetType: (nodes.find((n) => n.id === edge.target)?.data as any)?.inputType,
    }));

    const response = await window.api?.executeNodeGraph({
      nodes: serializedNodes,
      connections: serializedConnections,
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

// Register custom node types for ReactFlow
const reactFlowNodeTypes = {
  packedfiles: PackFilesNode,
  packfilesdropdown: PackFilesDropdownNode,
  tableselection: TableSelectionNode,
  columnselection: ColumnSelectionNode,
  numericadjustment: NumericAdjustmentNode,
  savechanges: SaveChangesNode,
};

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

let nodeId = 0;
const getNodeId = () => `node_${nodeId++}`;

const NodeSidebar: React.FC<{
  onDragStart: (event: DragEvent, nodeType: DraggableNodeData) => void;
}> = ({ onDragStart }) => {
  return (
    <div className="w-64 bg-gray-800 border-r border-gray-600 p-4">
      <h3 className="font-bold text-lg mb-4 text-white">Node Types</h3>
      <div className="space-y-2">
        {nodeTypes.map((nodeType) => (
          <div
            key={nodeType.type}
            draggable
            onDragStart={(event) => onDragStart(event, nodeType)}
            className="p-3 bg-gray-700 border border-gray-600 rounded-lg cursor-move hover:bg-gray-600 shadow-sm"
          >
            <div className="font-medium text-sm text-white">{nodeType.label}</div>
            <div className="text-xs text-gray-300 mt-1">{nodeType.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const NodeEditor: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);

  // Keep the ref updated with current nodes
  React.useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Listen for node data updates from child components
  React.useEffect(() => {
    const handleNodeDataUpdate = (event: CustomEvent) => {
      const { nodeId, textValue, selectedPack } = event.detail;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                textValue: textValue,
                selectedPack: selectedPack,
              },
            };
          }
          return node;
        })
      );
    };

    window.addEventListener("nodeDataUpdate", handleNodeDataUpdate as EventListener);
    return () => {
      window.removeEventListener("nodeDataUpdate", handleNodeDataUpdate as EventListener);
    };
  }, [setNodes]);

  const onConnect = useCallback(
    (params: Connection) => {
      // Validate connection types before allowing the connection
      if (!params.source || !params.target) return;

      const currentNodes = nodesRef.current;
      const sourceNode = currentNodes.find((node) => node.id === params.source);
      const targetNode = currentNodes.find((node) => node.id === params.target);

      if (!sourceNode || !targetNode) return;

      // Get output type from source node
      let sourceOutputType: NodeEdgeTypes | undefined;
      if (sourceNode.type === "packedfiles" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as PackFilesNodeData).outputType;
      } else if (sourceNode.type === "packfilesdropdown" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as PackFilesDropdownNodeData).outputType;
      } else if (sourceNode.type === "tableselection" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as TableSelectionNodeData).outputType;
      } else if (sourceNode.type === "columnselection" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as ColumnSelectionNodeData).outputType;
      } else if (sourceNode.type === "numericadjustment" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as NumericAdjustmentNodeData).outputType;
      }

      // Get input type from target node
      let targetInputType: NodeEdgeTypes | undefined;
      if (targetNode.type === "tableselection" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as TableSelectionNodeData).inputType;
      } else if (targetNode.type === "columnselection" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as ColumnSelectionNodeData).inputType;
      } else if (targetNode.type === "numericadjustment" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as NumericAdjustmentNodeData).inputType;
      } else if (targetNode.type === "savechanges" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as SaveChangesNodeData).inputType;
      }

      // Allow connection only if types are compatible
      if (sourceOutputType && targetInputType && sourceOutputType === targetInputType) {
        setEdges((eds) => {
          const newEdge = {
            ...params,
            id: `edge-${params.source}-${params.target}`,
            type: "default",
            style: { stroke: "#3b82f6", strokeWidth: 2 },
            animated: true,
          };
          return [...eds, newEdge];
        });
      }
      // If types don't match or are undefined, the connection is rejected silently
    },
    [setEdges]
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

      const nodeData = JSON.parse(type) as DraggableNodeData;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      let newNode: Node;

      if (nodeData.type === "packedfiles") {
        // Create PackFiles node with special data structure
        newNode = {
          id: getNodeId(),
          type: "packedfiles",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: "",
            outputType: "PackFiles" as NodeEdgeTypes,
          } as PackFilesNodeData,
        };
      } else if (nodeData.type === "packfilesdropdown") {
        // Create PackFiles dropdown node with special data structure
        newNode = {
          id: getNodeId(),
          type: "packfilesdropdown",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            selectedPack: "",
            outputType: "PackFiles" as NodeEdgeTypes,
          } as PackFilesDropdownNodeData,
        };
      } else if (nodeData.type === "tableselection") {
        // Create TableSelection node with special data structure
        newNode = {
          id: getNodeId(),
          type: "tableselection",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: "",
            inputType: "PackFiles" as NodeEdgeTypes,
            outputType: "TableSelection" as NodeEdgeTypes,
          } as TableSelectionNodeData,
        };
      } else if (nodeData.type === "columnselection") {
        // Create ColumnSelection node with special data structure
        newNode = {
          id: getNodeId(),
          type: "columnselection",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: "",
            inputType: "TableSelection" as NodeEdgeTypes,
            outputType: "ColumnSelection" as NodeEdgeTypes,
          } as ColumnSelectionNodeData,
        };
      } else if (nodeData.type === "numericadjustment") {
        // Create NumericAdjustment node with special data structure
        newNode = {
          id: getNodeId(),
          type: "numericadjustment",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: "",
            inputType: "ColumnSelection" as NodeEdgeTypes,
            outputType: "ChangedColumnSelection" as NodeEdgeTypes,
          } as NumericAdjustmentNodeData,
        };
      } else if (nodeData.type === "savechanges") {
        // Create SaveChanges node with special data structure
        newNode = {
          id: getNodeId(),
          type: "savechanges",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: "",
            inputType: "ChangedColumnSelection" as NodeEdgeTypes,
          } as SaveChangesNodeData,
        };
      } else {
        // Create standard node
        newNode = {
          id: getNodeId(),
          type: "default",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
          },
          style: {
            border: "2px solid #3b82f6",
            borderRadius: "8px",
            padding: "10px",
            background: "#374151",
            color: "#ffffff",
          },
        };
      }

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onDragStart = (event: DragEvent, nodeType: DraggableNodeData) => {
    event.dataTransfer.setData("application/reactflow", JSON.stringify(nodeType));
    event.dataTransfer.effectAllowed = "move";
  };

  const serializeNodeGraph = useCallback((): SerializedNodeGraph => {
    const serializedNodes: SerializedNode[] = nodes.map((node) => ({
      id: node.id,
      type: node.type || "default",
      position: node.position,
      data: {
        label: String(node.data?.label || ""),
        type: String(node.data?.type || ""),
        textValue: String((node.data as any)?.textValue || ""),
        selectedPack: String((node.data as any)?.selectedPack || ""),
        outputType: (node.data as any)?.outputType,
        inputType: (node.data as any)?.inputType,
      },
    }));

    const serializedConnections: SerializedConnection[] = edges.map((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);

      return {
        id: edge.id || `${edge.source}-${edge.target}`,
        sourceId: edge.source || "",
        targetId: edge.target || "",
        sourceType: (sourceNode?.data as any)?.outputType,
        targetType: (targetNode?.data as any)?.inputType,
      };
    });

    return {
      version: "1.0",
      timestamp: Date.now(),
      nodes: serializedNodes,
      connections: serializedConnections,
      metadata: {
        nodeCount: nodes.length,
        connectionCount: edges.length,
      },
    };
  }, [nodes, edges]);

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
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const jsonContent = event.target?.result as string;
          const serializedGraph: SerializedNodeGraph = JSON.parse(jsonContent);

          // Validate the loaded data structure
          if (!serializedGraph.nodes || !serializedGraph.connections) {
            throw new Error("Invalid file format: missing nodes or connections");
          }

          // Convert serialized nodes back to ReactFlow nodes
          const loadedNodes: Node[] = serializedGraph.nodes.map((serializedNode) => {
            const node: Node = {
              id: serializedNode.id,
              type: serializedNode.type,
              position: serializedNode.position,
              data: serializedNode.data,
            };

            // Add styling for default nodes
            if (serializedNode.type === "default") {
              node.style = {
                border: "2px solid #3b82f6",
                borderRadius: "8px",
                padding: "10px",
                background: "#374151",
                color: "#ffffff",
              };
            }

            return node;
          });

          // Convert serialized connections back to ReactFlow edges
          const loadedEdges: Edge[] = serializedGraph.connections.map((serializedConnection) => ({
            id: serializedConnection.id,
            source: serializedConnection.sourceId,
            target: serializedConnection.targetId,
            type: "default",
            style: { stroke: "#3b82f6", strokeWidth: 2 },
            animated: true,
          }));

          // Update node ID counter to avoid conflicts
          const maxNodeId = Math.max(
            ...serializedGraph.nodes
              .map((node) => parseInt(node.id.replace("node_", ""), 10))
              .filter((id) => !isNaN(id)),
            -1
          );
          nodeId = maxNodeId + 1;

          // Set the loaded data
          setNodes(loadedNodes);
          setEdges(loadedEdges);

          console.log(`Loaded graph with ${loadedNodes.length} nodes and ${loadedEdges.length} connections`);
        } catch (error) {
          console.error("Failed to load node graph:", error);
          alert("Failed to load the node graph file. Please check the file format.");
        }
      };

      reader.readAsText(file);
    },
    [setNodes, setEdges]
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        loadNodeGraph(file);
      }
      // Clear the input so the same file can be loaded again
      event.target.value = "";
    },
    [loadNodeGraph]
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

          // Find selected nodes
          const selectedNodes = nodes.filter((node) => node.selected);
          if (selectedNodes.length > 0) {
            const selectedNodeIds = selectedNodes.map((node) => node.id);

            // Remove selected nodes
            setNodes((nds) => nds.filter((node) => !selectedNodeIds.includes(node.id)));

            // Remove edges connected to deleted nodes
            setEdges((eds) =>
              eds.filter(
                (edge) =>
                  !selectedNodeIds.includes(edge.source || "") && !selectedNodeIds.includes(edge.target || "")
              )
            );

            console.log(`Deleted ${selectedNodes.length} nodes and their connections`);
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [nodes, setNodes, setEdges]);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);

  // Node execution system
  const executeNodeGraph = useCallback(async () => {
    if (isExecuting) return;

    setIsExecuting(true);
    console.log("Starting node graph execution in backend...");

    try {
      if (nodes.length === 0) {
        console.error("No nodes found in the graph");
        alert("No nodes found. Add nodes to the graph before executing.");
        return;
      }

      // Execute the entire graph in the backend
      const result = await executeGraphInBackend(nodes, edges);

      console.log(
        `Backend graph execution completed: ${result.successCount}/${result.totalExecuted} nodes succeeded`
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
            }`
        )
        .join("\n");

      const statusMessage = result.success
        ? `✅ Graph execution successful!`
        : `❌ Graph execution ${result.failureCount > 0 ? "completed with errors" : "failed"}`;

      alert(
        `${statusMessage}\n\nExecution Summary (${result.successCount}/${result.totalExecuted} nodes succeeded):\n${summary}\n\nCheck console for detailed results.`
      );
    } catch (error) {
      console.error("Error during graph execution:", error);
      alert(`Graph execution failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsExecuting(false);
    }
  }, [nodes, edges, isExecuting]);

  return (
    <div className="flex h-screen">
      <NodeSidebar onDragStart={onDragStart} />
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={reactFlowNodeTypes}
            fitView
          >
            <Controls />
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
                  Running...
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
                  Run
                </>
              )}
            </button>

            {/* Delete selected nodes button */}
            <button
              onClick={() => {
                const selectedNodes = nodes.filter((node) => node.selected);
                if (selectedNodes.length > 0) {
                  const selectedNodeIds = selectedNodes.map((node) => node.id);
                  setNodes((nds) => nds.filter((node) => !selectedNodeIds.includes(node.id)));
                  setEdges((eds) =>
                    eds.filter(
                      (edge) =>
                        !selectedNodeIds.includes(edge.source || "") &&
                        !selectedNodeIds.includes(edge.target || "")
                    )
                  );
                }
              }}
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
              Delete
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
              Load Graph
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
              Save Graph
            </button>
          </div>
        </ReactFlowProvider>
      </div>
    </div>
  );
};

export default NodeEditor;
