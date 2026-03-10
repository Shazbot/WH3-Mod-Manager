import { Edge, Node } from "@xyflow/react";

import { FlowOption, SerializedConnection, SerializedNode, SerializedNodeGraph } from "./types";

interface SerializeGraphInput {
  nodes: Node[];
  edges: Edge[];
  flowOptions: FlowOption[];
  isGraphEnabled: boolean;
  graphStartsEnabled: boolean;
}

interface PrepareGraphForExecutionInput {
  nodes: Node[];
  edges: Edge[];
  currentPackName?: string;
  flowOptions?: FlowOption[];
}

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const maybeString = (value: unknown) => (value ? String(value) : "");

type SerializableNodeData = Partial<SerializedNode["data"]> & Record<string, unknown>;

const getSerializableNodeData = (node: Node): SerializableNodeData => {
  return (node.data || {}) as SerializableNodeData;
};

const toNodeEdgeType = (value: unknown): NodeEdgeTypes | undefined => {
  return typeof value === "string" ? (value as NodeEdgeTypes) : undefined;
};

export const serializeReactFlowNodes = (nodes: Node[]): SerializedNode[] => {
  return nodes.map((node) => {
    const data = getSerializableNodeData(node);

    return {
      id: node.id,
      type: node.type as FlowNodeType,
      position: node.position,
      data: {
        label: String(data.label || ""),
        type: String(data.type || "") as FlowNodeType,
        textValue: maybeString(data.textValue),
        selectedPack: maybeString(data.selectedPack),
        selectedTable: maybeString(data.selectedTable),
        selectedColumn: maybeString(data.selectedColumn),
        selectedColumn1: maybeString(data.selectedColumn1),
        selectedColumn2: maybeString(data.selectedColumn2),
        columnNames: data.columnNames || [],
        dedupeByColumns: data.dedupeByColumns || [],
        dedupeAgainstVanilla: data.dedupeAgainstVanilla || false,
        connectedTableName: maybeString(data.connectedTableName),
        outputType: data.outputType,
        inputType: data.inputType,
        groupedTextSelection: data.groupedTextSelection,
        filters: data.filters,
        splitValues: data.splitValues || [],
        selectedReferenceTable: maybeString(data.selectedReferenceTable),
        referenceTableNames: data.referenceTableNames || [],
        selectedReverseTable: maybeString(data.selectedReverseTable),
        reverseTableNames: data.reverseTableNames || [],
        packName: maybeString(data.packName),
        packedFileName: maybeString(data.packedFileName),
        pattern: maybeString(data.pattern),
        joinSeparator: maybeString(data.joinSeparator),
        beforeText: maybeString(data.beforeText),
        afterText: maybeString(data.afterText),
        includeBaseGame: data.includeBaseGame,
        inputCount: data.inputCount,
        useCurrentPack: data.useCurrentPack,
        onlyForMultiple: data.onlyForMultiple,
        indexColumns: data.indexColumns || [],
        lookupColumn: maybeString(data.lookupColumn),
        joinType: data.joinType || "inner",
        tablePrefix: maybeString(data.tablePrefix),
        tablePrefixes: data.tablePrefixes || [],
        aggregateColumn: maybeString(data.aggregateColumn),
        aggregateType: data.aggregateType || "min",
        filterColumn: maybeString(data.filterColumn),
        filterOperator: data.filterOperator || "equals",
        filterValue: maybeString(data.filterValue),
        transformations: data.transformations || [],
        outputTables: data.outputTables || [],
        outputCount: data.outputCount || 2,
        groupByColumns: data.groupByColumns || [],
        aggregations: data.aggregations || [],
        inputColumnNames: data.inputColumnNames || [],
        schemaColumns: data.schemaColumns || [],
        customRows: data.customRows || [],
        newColumnName: maybeString(data.newColumnName),
        tsvFileName: maybeString(data.tsvFileName),
        tableName: maybeString(data.tableName),
        sourceInputColumns: data.sourceInputColumns || null,
        indexedTableColumns: data.indexedTableColumns || null,
        openInWindows: data.openInWindows,
        customSchemaColumns: data.customSchemaColumns || [],
        customSchemaData: data.customSchemaData || null,
      },
    };
  });
};

export const serializeReactFlowEdges = (nodes: Node[], edges: Edge[]): SerializedConnection[] => {
  return edges.map((edge) => {
    const sourceNode = nodes.find((node) => node.id === edge.source);
    const targetNode = nodes.find((node) => node.id === edge.target);
    const sourceData = sourceNode ? getSerializableNodeData(sourceNode) : undefined;
    const targetData = targetNode ? getSerializableNodeData(targetNode) : undefined;

    return {
      id: edge.id || `${edge.source}-${edge.target}`,
      sourceId: edge.source || "",
      targetId: edge.target || "",
      sourceType: toNodeEdgeType(sourceData?.outputType),
      targetType: toNodeEdgeType(targetData?.inputType),
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    };
  });
};

export const serializeNodeGraphState = ({
  nodes,
  edges,
  flowOptions,
  isGraphEnabled,
  graphStartsEnabled,
}: SerializeGraphInput): SerializedNodeGraph => {
  return {
    version: "1.0",
    timestamp: Date.now(),
    nodes: serializeReactFlowNodes(nodes),
    connections: serializeReactFlowEdges(nodes, edges),
    metadata: {
      nodeCount: nodes.length,
      connectionCount: edges.length,
    },
    options: flowOptions,
    isGraphEnabled,
    graphStartsEnabled,
  };
};

const replaceFlowOptionPlaceholders = (value: string, flowOptions: FlowOption[]) => {
  return flowOptions.reduce((nextValue, option) => {
    const placeholder = `{{${option.id}}}`;
    if (!nextValue.includes(placeholder)) {
      return nextValue;
    }

    return nextValue.replace(new RegExp(escapeForRegExp(placeholder), "g"), String(option.value));
  }, value);
};

export const prepareGraphForExecution = ({
  nodes,
  edges,
  currentPackName,
  flowOptions = [],
}: PrepareGraphForExecutionInput) => {
  const flowExecutionId = new Date().toISOString().slice(0, 19).replace(/:/g, "-").replace("T", "_");

  const preparedNodes = nodes.map((node) => {
    const nodeData = { ...node.data } as Record<string, unknown>;
    let modified = false;
    const currentData = getSerializableNodeData(node);

    if (node.type === "savechanges") {
      nodeData.flowExecutionId = flowExecutionId;
      modified = true;
    }

    if (currentPackName && currentData.useCurrentPack === true) {
      if (node.type === "packfilesdropdown") {
        nodeData.selectedPack = currentPackName;
        modified = true;
      } else if (node.type === "packedfiles") {
        nodeData.textValue = currentPackName;
        modified = true;
      }
    }

    if (flowOptions.length > 0) {
      const textFields = ["textValue", "pattern", "beforeText", "afterText", "joinSeparator", "packName", "packedFileName"];

      for (const fieldName of textFields) {
        const fieldValue = nodeData[fieldName];
        if (typeof fieldValue === "string" && fieldValue) {
          const nextValue = replaceFlowOptionPlaceholders(fieldValue, flowOptions);
          if (nextValue !== fieldValue) {
            nodeData[fieldName] = nextValue;
            modified = true;
          }
        }
      }

      if (Array.isArray(nodeData.transformations)) {
        nodeData.transformations = nodeData.transformations.map((transformation) => {
          if (!transformation || typeof transformation !== "object") {
            return transformation;
          }

          let transformationModified = false;
          const nextTransformation = { ...(transformation as Record<string, unknown>) };

          for (const fieldName of ["rangeStart", "endNumber", "rangeIncrement", "prefix", "suffix", "filterValue"]) {
            const fieldValue = nextTransformation[fieldName];
            if (typeof fieldValue === "string" && fieldValue) {
              const nextValue = replaceFlowOptionPlaceholders(fieldValue, flowOptions);
              if (nextValue !== fieldValue) {
                nextTransformation[fieldName] = nextValue;
                transformationModified = true;
              }
            }
          }

          if (transformationModified) {
            modified = true;
          }

          return transformationModified ? nextTransformation : transformation;
        });
      }
    }

    return modified ? { ...node, data: nodeData } : node;
  });

  return {
    nodes: serializeReactFlowNodes(preparedNodes),
    connections: serializeReactFlowEdges(preparedNodes, edges),
  };
};

export const deserializeNodeGraph = (jsonContent: string) => {
  const serializedGraph: SerializedNodeGraph = JSON.parse(jsonContent);

  if (!serializedGraph.nodes || !serializedGraph.connections) {
    throw new Error("Invalid file format: missing nodes or connections");
  }

  const nodes: Node[] = serializedGraph.nodes.map((serializedNode) => {
    const node: Node = {
      id: serializedNode.id,
      type: serializedNode.type,
      position: serializedNode.position ?? { x: 0, y: 0 },
      data: serializedNode.data,
    };

    if (!serializedNode.type) {
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

  const edges: Edge[] = serializedGraph.connections.map((serializedConnection) => ({
    id: serializedConnection.id,
    source: serializedConnection.sourceId,
    target: serializedConnection.targetId,
    sourceHandle: serializedConnection.sourceHandle,
    targetHandle: serializedConnection.targetHandle,
    type: "default",
    style: { stroke: "#3b82f6", strokeWidth: 2 },
    animated: true,
  }));

  const maxNodeId = Math.max(
    ...serializedGraph.nodes
      .map((node) => parseInt(node.id.replace("node_", ""), 10))
      .filter((id) => !isNaN(id)),
    -1,
  );

  return {
    serializedGraph,
    nodes,
    edges,
    nextNodeId: maxNodeId + 1,
  };
};
