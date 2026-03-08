import { Edge, Node } from "@xyflow/react";

import {
  GraphMutationResult,
  GraphState,
  SchemaContext,
  getTableVersion,
  synchronizeDerivedGraphState,
} from "./connectionRules";
import { DBVersion } from "../packFileTypes";
import type {
  CustomSchemaNodeData,
  GenerateRowsNodeData,
  ReferenceTableLookupNodeData,
  ReverseReferenceLookupNodeData,
} from "./nodes/types";
import { FlowNodeDataPatch, NodeEditorActionData } from "./types";

export interface NodeEditorActions {
  updateNodeData: (nodeId: string, patch: FlowNodeDataPatch) => void;
}

export const patchNodeData = (nodes: Node[], nodeId: string, patch: FlowNodeDataPatch): Node[] => {
  return nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    return {
      ...node,
      data: {
        ...node.data,
        ...patch,
      },
    };
  });
};

export const withNodeEditorActions = (nodes: Node[], actions: NodeEditorActions): Node[] => {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onUpdateNodeData: (patch: FlowNodeDataPatch) => actions.updateNodeData(node.id, patch),
    } satisfies NodeEditorActionData,
  }));
};

const REFERENCE_TARGET_TYPES = new Set([
  "columnselectiondropdown",
  "groupbycolumns",
  "filter",
  "deduplicate",
  "referencelookup",
  "generaterows",
  "generaterowsschema",
]);

const REVERSE_REFERENCE_TARGET_TYPES = new Set([
  ...REFERENCE_TARGET_TYPES,
  "reversereferencelookup",
]);

const updateConnectedTargetNodes = (
  nodes: Node[],
  edges: Edge[],
  sourceNodeId: string,
  targetTypes: Set<string>,
  patch: Record<string, unknown>,
) => {
  const connectedTargetIds = new Set(
    edges
      .filter((edge) => edge.source === sourceNodeId)
      .map((edge) => edge.target)
      .filter((targetId): targetId is string => Boolean(targetId)),
  );

  return nodes.map((node) => {
    if (!connectedTargetIds.has(node.id) || !targetTypes.has(node.type || "")) {
      return node;
    }

    return {
      ...node,
      data: {
        ...node.data,
        ...patch,
      },
    };
  });
};

const getFieldNamesForTable = (
  tableName: string,
  DBNameToDBVersions: Record<string, DBVersion[]> | undefined,
  defaultTableVersions?: Record<string, number>,
) => {
  const tableVersions = DBNameToDBVersions?.[tableName];
  if (!tableVersions || tableVersions.length === 0) {
    return [];
  }

  const selectedVersion = getTableVersion(tableName, tableVersions, defaultTableVersions);
  return (selectedVersion?.fields || []).map((field) => field.name);
};

export const applyNodeDataPatch = (
  state: GraphState,
  nodeId: string,
  patch: FlowNodeDataPatch,
  context: SchemaContext,
): GraphMutationResult => {
  let nextNodes = patchNodeData(state.nodes, nodeId, patch);
  const { DBNameToDBVersions, defaultTableVersions } = context;
  const sourceNode = nextNodes.find((node) => node.id === nodeId);

  if (!sourceNode) {
    return {
      nodes: nextNodes,
      edges: state.edges,
    };
  }

  if (patch.selectedReferenceTable !== undefined && sourceNode.type === "referencelookup") {
    const selectedReferenceTable = (sourceNode.data as Partial<ReferenceTableLookupNodeData>).selectedReferenceTable;
    if (selectedReferenceTable) {
      const fieldNames = getFieldNamesForTable(
        selectedReferenceTable,
        DBNameToDBVersions,
        defaultTableVersions,
      );
      nextNodes = updateConnectedTargetNodes(nextNodes, state.edges, nodeId, REFERENCE_TARGET_TYPES, {
        connectedTableName: selectedReferenceTable,
        columnNames: fieldNames,
        inputColumnNames: fieldNames,
      });
    }
  }

  if (patch.selectedReverseTable !== undefined && sourceNode.type === "reversereferencelookup") {
    const selectedReverseTable = (sourceNode.data as Partial<ReverseReferenceLookupNodeData>).selectedReverseTable;
    if (selectedReverseTable) {
      const fieldNames = getFieldNamesForTable(
        selectedReverseTable,
        DBNameToDBVersions,
        defaultTableVersions,
      );
      nextNodes = updateConnectedTargetNodes(
        nextNodes,
        state.edges,
        nodeId,
        REVERSE_REFERENCE_TARGET_TYPES,
        {
          connectedTableName: selectedReverseTable,
          columnNames: fieldNames,
          inputColumnNames: fieldNames,
        },
      );
    }
  }

  if (
    patch.outputTables !== undefined &&
    (sourceNode.type === "generaterows" || sourceNode.type === "generaterowsschema")
  ) {
    const outputTables = ((sourceNode.data as Partial<GenerateRowsNodeData>).outputTables || []).map((outputTable) => ({
      handleId: outputTable.handleId,
      existingTableName: outputTable.existingTableName,
      tableVersion: outputTable.tableVersion,
    }));

    nextNodes = nextNodes.map((node) => {
      const edge = state.edges.find((candidate) => candidate.source === nodeId && candidate.target === node.id);
      if (!edge) {
        return node;
      }

      const outputConfig = outputTables.find((outputTable) => outputTable.handleId === edge.sourceHandle);
      if (!outputConfig?.existingTableName) {
        return node;
      }

      let tableName: string | undefined;
      let columnNames: string[] = [];

      if (outputConfig.existingTableName === "__custom_schema__") {
        tableName = `_custom_schema_${nodeId}`;
        columnNames = (sourceNode.data as Partial<GenerateRowsNodeData>).customSchemaColumns || [];
      } else {
        tableName = outputConfig.existingTableName;
        const tableVersions = DBNameToDBVersions?.[tableName];
        if (tableVersions && tableVersions.length > 0) {
          const selectedVersion =
            (outputConfig.tableVersion !== undefined
              ? tableVersions.find((version) => version.version === outputConfig.tableVersion)
              : undefined) ??
            getTableVersion(tableName, tableVersions, defaultTableVersions) ??
            tableVersions[0];
          columnNames = selectedVersion.fields.map((field) => field.name);
        }
      }

      if (!tableName) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          connectedTableName: tableName,
          columnNames,
          inputColumnNames: columnNames,
        },
      };
    });
  }

  if (patch.schemaColumns !== undefined && sourceNode.type === "customschema") {
    const currentSchemaColumns = (sourceNode.data as Partial<CustomSchemaNodeData>).schemaColumns || [];
    const schemaColumns = currentSchemaColumns.map((column) => column.name);

    nextNodes = nextNodes.map((node) => {
      const isConnected = state.edges.some((edge) => edge.source === nodeId && edge.target === node.id);
      if (!isConnected || (node.type !== "generaterows" && node.type !== "generaterowsschema")) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          customSchemaColumns: schemaColumns,
          customSchemaData: currentSchemaColumns,
        },
      };
    });
  }

  return synchronizeDerivedGraphState(
    {
      nodes: nextNodes,
      edges: state.edges,
    },
    context,
  );
};

export const deleteSelectedNodesFromGraph = (nodes: Node[], edges: Edge[]) => {
  const selectedNodeIds = nodes.filter((node) => node.selected).map((node) => node.id);

  if (selectedNodeIds.length === 0) {
    return { nodes, edges, deletedNodeIds: selectedNodeIds };
  }

  return {
    nodes: nodes.filter((node) => !selectedNodeIds.includes(node.id)),
    edges: edges.filter(
      (edge) => !selectedNodeIds.includes(edge.source || "") && !selectedNodeIds.includes(edge.target || ""),
    ),
    deletedNodeIds: selectedNodeIds,
  };
};
