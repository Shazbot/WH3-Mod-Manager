import React, { useCallback, useState, useRef, DragEvent } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Serialization types
interface SerializedNode {
  id: string;
  type: string;
  position: XYPosition;
  data: {
    label: string;
    type: string;
    textValue?: string;
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

interface NodeExecutionContext {
  nodeId: string;
  inputData: any;
  nodeData: NodeData;
}

type NodeActionFunction = (context: NodeExecutionContext) => Promise<NodeExecutionResult>;

interface NodeData {
  label: string;
  type: string;
  textValue?: string;
  outputType?: NodeEdgeTypes;
}

interface PackFilesNodeData extends NodeData {
  textValue: string;
  outputType: 'PackFiles';
}

interface TableSelectionNodeData extends NodeData {
  textValue: string;
  inputType: 'PackFiles';
  outputType: 'TableSelection';
}

interface ColumnSelectionNodeData extends NodeData {
  textValue: string;
  inputType: 'TableSelection';
  outputType: 'ColumnSelection';
}

interface NumericAdjustmentNodeData extends NodeData {
  textValue: string;
  inputType: 'ColumnSelection';
  outputType: 'ChangedColumnSelection';
}

interface DraggableNodeData {
  type: string;
  label: string;
  description: string;
}

// Custom PackFiles node component with built-in textbox
const PackFilesNode: React.FC<{ data: PackFilesNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || '');

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent('nodeDataUpdate', {
      detail: { nodeId: id, textValue: newValue }
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-blue-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-blue-500"
      />
      
      <div className="text-white font-medium text-sm mb-2">
        {data.label}
      </div>
      
      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter pack files configuration..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-blue-400"
      />
      
      <div className="mt-2 text-xs text-gray-400">
        Output: PackFiles
      </div>

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
  const [textValue, setTextValue] = useState(data.textValue || '');

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent('nodeDataUpdate', {
      detail: { nodeId: id, textValue: newValue }
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
      
      <div className="text-white font-medium text-sm mb-2">
        {data.label}
      </div>
      
      <div className="text-xs text-gray-400 mb-2">
        Input: PackFiles
      </div>
      
      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter table selection criteria..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-purple-400"
      />
      
      <div className="mt-2 text-xs text-gray-400">
        Output: TableSelection
      </div>
      
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
  const [textValue, setTextValue] = useState(data.textValue || '');

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent('nodeDataUpdate', {
      detail: { nodeId: id, textValue: newValue }
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

      <div className="text-white font-medium text-sm mb-2">
        {data.label}
      </div>

      <div className="text-xs text-gray-400 mb-2">
        Input: TableSelection
      </div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter column selection criteria..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-emerald-400"
      />

      <div className="mt-2 text-xs text-gray-400">
        Output: ColumnSelection
      </div>

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
  const [textValue, setTextValue] = useState(data.textValue || '');

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent('nodeDataUpdate', {
      detail: { nodeId: id, textValue: newValue }
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

      <div className="text-white font-medium text-sm mb-2">
        {data.label}
      </div>

      <div className="text-xs text-gray-400 mb-2">
        Input: ColumnSelection
      </div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter formula using x as input (e.g., x + 10, x * 1.5, x^2 + 3*x - 5)..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-yellow-400"
      />

      <div className="mt-2 text-xs text-gray-400">
        Output: ChangedColumnSelection
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-cyan-500"
        data-output-type="ChangedColumnSelection"
      />
    </div>
  );
};

const nodeTypes = [
  { type: 'input', label: 'Input Node', description: 'Starting point for data flow' },
  { type: 'output', label: 'Output Node', description: 'End point for data flow' },
  { type: 'process', label: 'Process Node', description: 'Transform or process data' },
  { type: 'decision', label: 'Decision Node', description: 'Conditional logic' },
  { type: 'data', label: 'Data Node', description: 'Store or retrieve data' },
  { type: 'packedfiles', label: 'PackFiles Node', description: 'Node with textbox that outputs PackFiles' },
  { type: 'tableselection', label: 'Table Selection Node', description: 'Accepts PackFiles input, outputs TableSelection' },
  { type: 'columnselection', label: 'Column Selection Node', description: 'Accepts TableSelection input, outputs ColumnSelection' },
  { type: 'numericadjustment', label: 'Numeric Adjustment Node', description: 'Accepts ColumnSelection input, outputs ChangedColumnSelection' },
];

// Backend execution service
const executeNodeInBackend = async (context: NodeExecutionContext): Promise<NodeExecutionResult> => {
  try {
    const response = await window.api?.executeNode({
      nodeId: context.nodeId,
      nodeType: context.nodeData.type,
      textValue: (context.nodeData as any).textValue || '',
      inputData: context.inputData
    });

    if (!response) {
      return { success: false, error: 'Backend API not available' };
    }

    return response;
  } catch (error) {
    console.error(`Error executing node ${context.nodeId} in backend:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Backend execution failed'
    };
  }
};

// Register custom node types for ReactFlow
const reactFlowNodeTypes = {
  packedfiles: PackFilesNode,
  tableselection: TableSelectionNode,
  columnselection: ColumnSelectionNode,
  numericadjustment: NumericAdjustmentNode,
};

const initialNodes: Node<NodeData>[] = [];
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
      const { nodeId, textValue } = event.detail;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                textValue: textValue,
              },
            };
          }
          return node;
        })
      );
    };

    window.addEventListener('nodeDataUpdate', handleNodeDataUpdate as EventListener);
    return () => {
      window.removeEventListener('nodeDataUpdate', handleNodeDataUpdate as EventListener);
    };
  }, [setNodes]);


  const onConnect = useCallback(
    (params: Connection) => {
      // Validate connection types before allowing the connection
      if (!params.source || !params.target) return;

      const currentNodes = nodesRef.current;
      const sourceNode = currentNodes.find(node => node.id === params.source);
      const targetNode = currentNodes.find(node => node.id === params.target);

      if (!sourceNode || !targetNode) return;

      // Get output type from source node
      let sourceOutputType: NodeEdgeTypes | undefined;
      if (sourceNode.type === 'packedfiles' && sourceNode.data) {
        sourceOutputType = (sourceNode.data as PackFilesNodeData).outputType;
      } else if (sourceNode.type === 'tableselection' && sourceNode.data) {
        sourceOutputType = (sourceNode.data as TableSelectionNodeData).outputType;
      } else if (sourceNode.type === 'columnselection' && sourceNode.data) {
        sourceOutputType = (sourceNode.data as ColumnSelectionNodeData).outputType;
      } else if (sourceNode.type === 'numericadjustment' && sourceNode.data) {
        sourceOutputType = (sourceNode.data as NumericAdjustmentNodeData).outputType;
      }

      // Get input type from target node
      let targetInputType: NodeEdgeTypes | undefined;
      if (targetNode.type === 'tableselection' && targetNode.data) {
        targetInputType = (targetNode.data as TableSelectionNodeData).inputType;
      } else if (targetNode.type === 'columnselection' && targetNode.data) {
        targetInputType = (targetNode.data as ColumnSelectionNodeData).inputType;
      } else if (targetNode.type === 'numericadjustment' && targetNode.data) {
        targetInputType = (targetNode.data as NumericAdjustmentNodeData).inputType;
      }

      // Allow connection only if types are compatible
      if (sourceOutputType && targetInputType && sourceOutputType === targetInputType) {
        setEdges((eds) => {
          const newEdge = {
            ...params,
            id: `edge-${params.source}-${params.target}`,
            type: 'default',
            style: { stroke: '#3b82f6', strokeWidth: 2 },
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
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      const type = event.dataTransfer.getData('application/reactflow');

      if (typeof type === 'undefined' || !type || !reactFlowBounds || !reactFlowInstance) {
        return;
      }

      const nodeData = JSON.parse(type) as DraggableNodeData;
      
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      let newNode: Node<NodeData>;

      if (nodeData.type === 'packedfiles') {
        // Create PackFiles node with special data structure
        newNode = {
          id: getNodeId(),
          type: 'packedfiles',
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: '',
            outputType: 'PackFiles' as NodeEdgeTypes,
          } as PackFilesNodeData,
        };
      } else if (nodeData.type === 'tableselection') {
        // Create TableSelection node with special data structure
        newNode = {
          id: getNodeId(),
          type: 'tableselection',
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: '',
            inputType: 'PackFiles' as NodeEdgeTypes,
            outputType: 'TableSelection' as NodeEdgeTypes,
          } as TableSelectionNodeData,
        };
      } else if (nodeData.type === 'columnselection') {
        // Create ColumnSelection node with special data structure
        newNode = {
          id: getNodeId(),
          type: 'columnselection',
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: '',
            inputType: 'TableSelection' as NodeEdgeTypes,
            outputType: 'ColumnSelection' as NodeEdgeTypes,
          } as ColumnSelectionNodeData,
        };
      } else if (nodeData.type === 'numericadjustment') {
        // Create NumericAdjustment node with special data structure
        newNode = {
          id: getNodeId(),
          type: 'numericadjustment',
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: '',
            inputType: 'ColumnSelection' as NodeEdgeTypes,
            outputType: 'ChangedColumnSelection' as NodeEdgeTypes,
          } as NumericAdjustmentNodeData,
        };
      } else {
        // Create standard node
        newNode = {
          id: getNodeId(),
          type: 'default',
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
          },
          style: {
            border: '2px solid #3b82f6',
            borderRadius: '8px',
            padding: '10px',
            background: '#374151',
            color: '#ffffff',
          },
        };
      }

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onDragStart = (event: DragEvent, nodeType: DraggableNodeData) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(nodeType));
    event.dataTransfer.effectAllowed = 'move';
  };

  const serializeNodeGraph = useCallback((): SerializedNodeGraph => {
    const serializedNodes: SerializedNode[] = nodes.map(node => ({
      id: node.id,
      type: node.type || 'default',
      position: node.position,
      data: {
        label: node.data?.label || '',
        type: node.data?.type || '',
        textValue: (node.data as any)?.textValue || '',
        outputType: (node.data as any)?.outputType,
        inputType: (node.data as any)?.inputType,
      }
    }));

    const serializedConnections: SerializedConnection[] = edges.map(edge => {
      const sourceNode = nodes.find(n => n.id === edge.source);
      const targetNode = nodes.find(n => n.id === edge.target);

      return {
        id: edge.id || `${edge.source}-${edge.target}`,
        sourceId: edge.source || '',
        targetId: edge.target || '',
        sourceType: (sourceNode?.data as any)?.outputType,
        targetType: (targetNode?.data as any)?.inputType,
      };
    });

    return {
      version: '1.0',
      timestamp: Date.now(),
      nodes: serializedNodes,
      connections: serializedConnections,
      metadata: {
        nodeCount: nodes.length,
        connectionCount: edges.length,
      }
    };
  }, [nodes, edges]);

  const saveNodeGraph = useCallback(() => {
    const serializedGraph = serializeNodeGraph();
    const jsonString = JSON.stringify(serializedGraph, null, 2);

    // Create and trigger download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `node-graph-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [serializeNodeGraph]);

  const loadNodeGraph = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonContent = event.target?.result as string;
        const serializedGraph: SerializedNodeGraph = JSON.parse(jsonContent);

        // Validate the loaded data structure
        if (!serializedGraph.nodes || !serializedGraph.connections) {
          throw new Error('Invalid file format: missing nodes or connections');
        }

        // Convert serialized nodes back to ReactFlow nodes
        const loadedNodes: Node<NodeData>[] = serializedGraph.nodes.map(serializedNode => {
          const node: Node<NodeData> = {
            id: serializedNode.id,
            type: serializedNode.type,
            position: serializedNode.position,
            data: serializedNode.data,
          };

          // Add styling for default nodes
          if (serializedNode.type === 'default') {
            node.style = {
              border: '2px solid #3b82f6',
              borderRadius: '8px',
              padding: '10px',
              background: '#374151',
              color: '#ffffff',
            };
          }

          return node;
        });

        // Convert serialized connections back to ReactFlow edges
        const loadedEdges: Edge[] = serializedGraph.connections.map(serializedConnection => ({
          id: serializedConnection.id,
          source: serializedConnection.sourceId,
          target: serializedConnection.targetId,
          type: 'default',
          style: { stroke: '#3b82f6', strokeWidth: 2 },
          animated: true,
        }));

        // Update node ID counter to avoid conflicts
        const maxNodeId = Math.max(
          ...serializedGraph.nodes
            .map(node => parseInt(node.id.replace('node_', ''), 10))
            .filter(id => !isNaN(id)),
          -1
        );
        nodeId = maxNodeId + 1;

        // Set the loaded data
        setNodes(loadedNodes);
        setEdges(loadedEdges);

        console.log(`Loaded graph with ${loadedNodes.length} nodes and ${loadedEdges.length} connections`);
      } catch (error) {
        console.error('Failed to load node graph:', error);
        alert('Failed to load the node graph file. Please check the file format.');
      }
    };

    reader.readAsText(file);
  }, [setNodes, setEdges]);

  const handleFileInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      loadNodeGraph(file);
    }
    // Clear the input so the same file can be loaded again
    event.target.value = '';
  }, [loadNodeGraph]);

  // Handle keyboard events for node deletion
  React.useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Delete or Backspace key
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Prevent default behavior if we're not in a text input
        const target = event.target as HTMLElement;
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT') {
          event.preventDefault();

          // Find selected nodes
          const selectedNodes = nodes.filter(node => node.selected);
          if (selectedNodes.length > 0) {
            const selectedNodeIds = selectedNodes.map(node => node.id);

            // Remove selected nodes
            setNodes((nds) => nds.filter(node => !selectedNodeIds.includes(node.id)));

            // Remove edges connected to deleted nodes
            setEdges((eds) => eds.filter(edge =>
              !selectedNodeIds.includes(edge.source || '') &&
              !selectedNodeIds.includes(edge.target || '')
            ));

            console.log(`Deleted ${selectedNodes.length} nodes and their connections`);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [nodes, setNodes, setEdges]);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);

  // Node execution system
  const executeNodeGraph = useCallback(async () => {
    if (isExecuting) return;

    setIsExecuting(true);
    console.log('Starting node graph execution in backend...');

    try {
      // Build execution graph
      const nodeMap = new Map(nodes.map(node => [node.id, node]));
      const edgeMap = new Map<string, string[]>();

      // Build adjacency list for connections
      edges.forEach(edge => {
        if (!edge.source || !edge.target) return;
        if (!edgeMap.has(edge.source)) {
          edgeMap.set(edge.source, []);
        }
        edgeMap.get(edge.source)?.push(edge.target);
      });

      // Find starting nodes (nodes with no incoming edges)
      const incomingEdges = new Set(edges.map(edge => edge.target).filter(Boolean));
      const startingNodes = nodes.filter(node => !incomingEdges.has(node.id));

      if (startingNodes.length === 0) {
        console.error('No starting nodes found in the graph');
        alert('No starting nodes found. Add nodes without inputs to begin execution.');
        return;
      }

      // Execute nodes in topological order using BFS
      const executionResults = new Map<string, any>();
      const executionQueue = [...startingNodes.map(node => ({ node, inputData: null }))];
      const executed = new Set<string>();

      while (executionQueue.length > 0) {
        const { node, inputData } = executionQueue.shift()!;

        if (executed.has(node.id)) continue;

        try {
          console.log(`Executing node: ${node.id} (${node.type}) in backend...`);

          // Execute the node in the backend
          const result = await executeNodeInBackend({
            nodeId: node.id,
            inputData: inputData,
            nodeData: node.data || {}
          });

          executionResults.set(node.id, result);
          executed.add(node.id);

          if (result.success) {
            console.log(`Node ${node.id} executed successfully:`, result.data);

            // Queue connected nodes for execution
            const connectedNodeIds = edgeMap.get(node.id) || [];
            connectedNodeIds.forEach(targetNodeId => {
              const targetNode = nodeMap.get(targetNodeId);
              if (targetNode && !executed.has(targetNodeId)) {
                executionQueue.push({
                  node: targetNode,
                  inputData: result.data
                });
              }
            });
          } else {
            console.error(`Node ${node.id} execution failed:`, result.error);
          }

        } catch (error) {
          console.error(`Error executing node ${node.id}:`, error);
          executionResults.set(node.id, {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          executed.add(node.id);
        }
      }

      // Summary
      const successCount = Array.from(executionResults.values()).filter(r => r.success).length;
      const totalCount = executionResults.size;

      console.log(`Backend execution completed: ${successCount}/${totalCount} nodes succeeded`);

      // Show results in alert (in a real app, you'd show this in a better UI)
      const summary = Array.from(executionResults.entries())
        .map(([nodeId, result]) => `${nodeId}: ${result.success ? '✅' : '❌' + (result.error ? ` (${result.error})` : '')}`)
        .join('\n');

      alert(`Backend Execution Summary:\n${summary}\n\nCheck console for detailed results.`);

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
                  ? 'bg-purple-600 hover:bg-purple-700 text-white cursor-pointer'
                  : 'bg-gray-400 text-gray-600 cursor-not-allowed'
              }`}
            >
              {isExecuting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Running...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1M9 16h1m4 0h1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Run
                </>
              )}
            </button>

            {/* Delete selected nodes button */}
            <button
              onClick={() => {
                const selectedNodes = nodes.filter(node => node.selected);
                if (selectedNodes.length > 0) {
                  const selectedNodeIds = selectedNodes.map(node => node.id);
                  setNodes((nds) => nds.filter(node => !selectedNodeIds.includes(node.id)));
                  setEdges((eds) => eds.filter(edge =>
                    !selectedNodeIds.includes(edge.source || '') &&
                    !selectedNodeIds.includes(edge.target || '')
                  ));
                }
              }}
              disabled={!nodes.some(node => node.selected)}
              className={`px-4 py-2 font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2 ${
                nodes.some(node => node.selected)
                  ? 'bg-red-600 hover:bg-red-700 text-white cursor-pointer'
                  : 'bg-gray-400 text-gray-600 cursor-not-allowed'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>

            {/* Load button */}
            <label
              htmlFor="load-graph-input"
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
              Load Graph
            </label>

            {/* Save button */}
            <button
              onClick={saveNodeGraph}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12" />
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