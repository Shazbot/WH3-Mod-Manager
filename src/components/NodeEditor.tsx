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

interface NodeData {
  label: string;
  type: string;
  textValue?: string;
  outputType?: NodeEdgeTypes;
}

interface PackedFilesNodeData extends NodeData {
  textValue: string;
  outputType: 'PackedFiles';
}

interface TableSelectionNodeData extends NodeData {
  textValue: string;
  inputType: 'PackedFiles';
  outputType: 'TableSelection';
}

interface ColumnSelectionNodeData extends NodeData {
  textValue: string;
  inputType: 'TableSelection';
  outputType: 'ColumnSelection';
}

interface DraggableNodeData {
  type: string;
  label: string;
  description: string;
}

// Custom PackedFiles node component with built-in textbox
const PackedFilesNode: React.FC<{ data: PackedFilesNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || '');

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextValue(event.target.value);
    // Update the node data (in a real implementation, you'd update the nodes state)
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
        placeholder="Enter packed files configuration..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-blue-400"
      />
      
      <div className="mt-2 text-xs text-gray-400">
        Output: PackedFiles
      </div>
      
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-green-500"
        data-output-type="PackedFiles"
      />
    </div>
  );
};

// Custom TableSelection node component that accepts PackedFiles input and outputs TableSelection
const TableSelectionNode: React.FC<{ data: TableSelectionNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || '');

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextValue(event.target.value);
    // Update the node data (in a real implementation, you'd update the nodes state)
  };

  return (
    <div className="bg-gray-700 border-2 border-purple-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-blue-500"
        data-input-type="PackedFiles"
      />
      
      <div className="text-white font-medium text-sm mb-2">
        {data.label}
      </div>
      
      <div className="text-xs text-gray-400 mb-2">
        Input: PackedFiles
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
    setTextValue(event.target.value);
    // Update the node data (in a real implementation, you'd update the nodes state)
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

const nodeTypes = [
  { type: 'input', label: 'Input Node', description: 'Starting point for data flow' },
  { type: 'output', label: 'Output Node', description: 'End point for data flow' },
  { type: 'process', label: 'Process Node', description: 'Transform or process data' },
  { type: 'decision', label: 'Decision Node', description: 'Conditional logic' },
  { type: 'data', label: 'Data Node', description: 'Store or retrieve data' },
  { type: 'packedfiles', label: 'PackedFiles Node', description: 'Node with textbox that outputs PackedFiles' },
  { type: 'tableselection', label: 'Table Selection Node', description: 'Accepts PackedFiles input, outputs TableSelection' },
  { type: 'columnselection', label: 'Column Selection Node', description: 'Accepts TableSelection input, outputs ColumnSelection' },
];

// Register custom node types for ReactFlow
const reactFlowNodeTypes = {
  packedfiles: PackedFilesNode,
  tableselection: TableSelectionNode,
  columnselection: ColumnSelectionNode,
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

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
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
        // Create PackedFiles node with special data structure
        newNode = {
          id: getNodeId(),
          type: 'packedfiles',
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: '',
            outputType: 'PackedFiles' as NodeEdgeTypes,
          } as PackedFilesNodeData,
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
            inputType: 'PackedFiles' as NodeEdgeTypes,
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

  return (
    <div className="flex h-screen">
      <NodeSidebar onDragStart={onDragStart} />
      <div className="flex-1" ref={reactFlowWrapper}>
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
        </ReactFlowProvider>
      </div>
    </div>
  );
};

export default NodeEditor;