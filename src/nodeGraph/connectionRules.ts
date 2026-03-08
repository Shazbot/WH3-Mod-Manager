import { Connection, Edge, Node } from "@xyflow/react";

import { DBVersion } from "../packFileTypes";
import type {
  AggregateNestedNodeData,
  CustomRowsInputNodeData,
  FilterNodeData,
  GenerateRowsNodeData,
  GetCounterColumnNodeData,
  IndexTableNodeData,
  LookupNodeData,
  ReadTSVFromPackNodeData,
  ReferenceTableLookupNodeData,
  ReverseReferenceLookupNodeData,
  TableSelectionDropdownNodeData,
} from "./nodes/types";

export interface GraphState {
  nodes: Node[];
  edges: Edge[];
}

export interface SchemaContext {
  DBNameToDBVersions?: Record<string, DBVersion[]>;
  defaultTableVersions?: Record<string, number>;
  sortedTableNames?: string[];
}

export interface GraphMutationResult extends GraphState {
  accepted?: boolean;
}

const TABLE_SELECTION_SOURCES = new Set([
  "tableselection",
  "tableselectiondropdown",
  "filter",
  "multifilter",
  "referencelookup",
  "reversereferencelookup",
  "lookup",
  "extracttable",
  "flattennested",
  "groupby",
  "deduplicate",
  "generaterows",
  "generaterowsschema",
  "addnewcolumn",
  "getcountercolumn",
  "customrowsinput",
  "readtsvfrompack",
]);

const TABLE_METADATA_TARGETS = new Set([
  "columnselectiondropdown",
  "groupbycolumns",
  "filter",
  "multifilter",
  "referencelookup",
  "reversereferencelookup",
  "indextable",
  "extracttable",
  "aggregatenested",
  "groupby",
  "deduplicate",
  "addnewcolumn",
  "generaterowsschema",
  "getcountercolumn",
]);

type NodeWithData<TData extends Record<string, unknown>> = Node<TData>;

type LookupIndexedSourceData = Partial<
  Pick<TableSelectionDropdownNodeData, "selectedTable"> &
    Pick<ReferenceTableLookupNodeData, "selectedReferenceTable"> &
    Pick<ReverseReferenceLookupNodeData, "selectedReverseTable"> & {
      connectedTableName?: string;
    }
>;

type GenerateRowsSourceData = {
  columnNames?: string[];
  inputColumnNames?: string[];
  selectedTable?: string;
  selectedReferenceTable?: string;
  selectedReverseTable?: string;
  schemaColumns?: Array<{ name: string }>;
};

type GraphRuleNodeData = Partial<
  Pick<FilterNodeData, "connectedTableName" | "columnNames" | "DBNameToDBVersions"> &
    Pick<TableSelectionDropdownNodeData, "selectedTable"> &
    Pick<ReferenceTableLookupNodeData, "selectedReferenceTable"> &
    Pick<ReverseReferenceLookupNodeData, "selectedReverseTable"> &
    Pick<GetCounterColumnNodeData, "newColumnName" | "selectedColumn"> &
    Pick<IndexTableNodeData, "indexColumns"> &
    Pick<LookupNodeData, "outputType" | "inputType" | "joinType"> & {
      schemaColumns?: Array<{ name: string }>;
      customSchemaColumns?: string[];
      outputTables?: Array<{ handleId: string; existingTableName: string; tableVersion?: number }>;
      tableName?: string;
      tsvFileName?: string;
      customRows?: Array<Record<string, string>>;
      indexedTableColumns?: string[];
      indexedTableColumnNames?: string[];
      indexedTableName?: string;
      connectedIndexTableName?: string;
      sourceTableColumns?: string[];
      sourceTableName?: string;
      aggregateType?: AggregateNestedNodeData["aggregateType"];
      aggregateColumn?: string;
      selectedPack?: string;
    }
>;

const getNodeData = <TData extends Record<string, unknown>>(node: Node): TData => {
  return (node.data || {}) as TData;
};

const updateNode = (nodes: Node[], nodeId: string, patch: Record<string, unknown>) => {
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

const updateNodes = (
  nodes: Node[],
  updater: (node: Node) => Node,
) => nodes.map((node) => updater(node));

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

const getLookupIndexedMetadata = (
  state: GraphState,
  lookupNode: NodeWithData<Partial<LookupNodeData>>,
  context: SchemaContext,
) => {
  const incomingEdge = state.edges.find(
    (edge) => edge.target === lookupNode.id && edge.targetHandle === "input-index",
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = state.nodes.find((node) => node.id === incomingEdge.source);
  if (!sourceNode) {
    return null;
  }

  const sourceData = sourceNode.data as LookupIndexedSourceData;
  const tableName =
    sourceNode.type === "tableselectiondropdown"
      ? sourceData.selectedTable
      : sourceNode.type === "referencelookup"
        ? sourceData.selectedReferenceTable
        : sourceNode.type === "reversereferencelookup"
          ? sourceData.selectedReverseTable
          : sourceData.connectedTableName;

  if (!tableName) {
    return null;
  }

  return {
    indexedTableName: tableName,
    indexedInputType: sourceNode.type === "indextable" ? ("IndexedTable" as NodeEdgeTypes) : ("TableSelection" as NodeEdgeTypes),
    indexedTableColumnNames: getFieldNamesForTable(
      tableName,
      context.DBNameToDBVersions,
      context.defaultTableVersions,
    ),
  };
};

const getGenerateRowsSourceColumns = (
  sourceNode: Node,
  context: SchemaContext,
): string[] => {
  const sourceData = sourceNode.data as GenerateRowsSourceData;

  if (Array.isArray(sourceData.inputColumnNames) && sourceData.inputColumnNames.length > 0) {
    return sourceData.inputColumnNames;
  }

  if (Array.isArray(sourceData.columnNames) && sourceData.columnNames.length > 0) {
    return sourceData.columnNames;
  }

  if (sourceNode.type === "tableselectiondropdown" && sourceData.selectedTable) {
    return getFieldNamesForTable(sourceData.selectedTable, context.DBNameToDBVersions, context.defaultTableVersions);
  }

  if (
    (sourceNode.type === "customrowsinput" || sourceNode.type === "readtsvfrompack") &&
    Array.isArray(sourceData.schemaColumns)
  ) {
    return sourceData.schemaColumns.map((column) => column.name);
  }

  if (sourceNode.type === "referencelookup" && sourceData.selectedReferenceTable) {
    return getFieldNamesForTable(
      sourceData.selectedReferenceTable,
      context.DBNameToDBVersions,
      context.defaultTableVersions,
    );
  }

  if (sourceNode.type === "reversereferencelookup" && sourceData.selectedReverseTable) {
    return getFieldNamesForTable(
      sourceData.selectedReverseTable,
      context.DBNameToDBVersions,
      context.defaultTableVersions,
    );
  }

  return [];
};

export const synchronizeDerivedGraphState = (
  state: GraphState,
  context: SchemaContext,
): GraphMutationResult => {
  let nextNodes = withSchemaContext(state.nodes, context);

  nextNodes = nextNodes.map((node) => {
    if (node.type !== "lookup") {
      return node;
    }

    const patch = getLookupIndexedMetadata(
      {
        nodes: nextNodes,
        edges: state.edges,
      },
      node as NodeWithData<Partial<LookupNodeData>>,
      context,
    );

    if (!patch) {
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

  nextNodes = nextNodes.map((node) => {
    if (node.type !== "generaterows" && node.type !== "generaterowsschema") {
      return node;
    }

    const incomingEdges = state.edges.filter((edge) => edge.target === node.id);
    const mergedColumns = Array.from(
      new Set(
        incomingEdges.flatMap((edge) => {
          const sourceNode = nextNodes.find((candidate) => candidate.id === edge.source);
          return sourceNode ? getGenerateRowsSourceColumns(sourceNode, context) : [];
        }),
      ),
    );

    return {
      ...node,
      data: {
        ...node.data,
        columnNames: mergedColumns,
        inputColumnNames: mergedColumns,
      },
    };
  });

  return {
    nodes: nextNodes,
    edges: state.edges,
  };
};

const needsSchemaContext = (node: Node) =>
  node.type === "filter" ||
  node.type === "referencelookup" ||
  node.type === "reversereferencelookup" ||
  node.type === "columnselectiondropdown" ||
  node.type === "groupbycolumns" ||
  node.type === "indextable" ||
  node.type === "lookup" ||
  node.type === "extracttable" ||
  node.type === "aggregatenested" ||
  node.type === "getcountercolumn" ||
  node.type === "generaterows" ||
  node.type === "generaterowsschema";

export const getTableVersion = (
  tableName: string,
  tableVersions: DBVersion[],
  defaultTableVersions?: Record<string, number>,
): DBVersion | undefined => {
  if (!tableVersions || tableVersions.length === 0) {
    return undefined;
  }

  if (defaultTableVersions && defaultTableVersions[tableName] !== undefined) {
    const defaultVersion = defaultTableVersions[tableName];
    const foundVersion = tableVersions.find((version) => version.version === defaultVersion);
    if (foundVersion) {
      return foundVersion;
    }
  }

  return tableVersions[0];
};

const getSourceNodeOutputInfo = (
  sourceNode: Node,
  sourceData: GraphRuleNodeData,
  DBNameToDBVersions: Record<string, DBVersion[]> | undefined,
  defaultTableVersions?: Record<string, number>,
): { tableName: string | undefined; columnNames: string[] } => {
  let tableName: string | undefined;
  let columnNames: string[] = [];

  if (sourceNode.type === "referencelookup" && sourceData.selectedReferenceTable) {
    tableName = sourceData.selectedReferenceTable;
  } else if (sourceNode.type === "reversereferencelookup" && sourceData.selectedReverseTable) {
    tableName = sourceData.selectedReverseTable;
  } else {
    tableName = sourceData.connectedTableName || sourceData.selectedTable;
    columnNames = sourceData.columnNames || [];
  }

  if (tableName && DBNameToDBVersions && DBNameToDBVersions[tableName]) {
    const tableVersions = DBNameToDBVersions[tableName];
    if (tableVersions && tableVersions.length > 0) {
      const selectedVersion = getTableVersion(tableName, tableVersions, defaultTableVersions);
      const tableFields = selectedVersion?.fields || [];
      columnNames = tableFields.map((field) => field.name);
    }
  }

  return { tableName, columnNames };
};

const withSchemaContext = (nodes: Node[], context: SchemaContext) => {
  const { DBNameToDBVersions, sortedTableNames } = context;

  return nodes.map((node) => {
    if (!needsSchemaContext(node)) {
      if (node.data.type === "tableselectiondropdown" || node.data.type === "getcountercolumn") {
        return {
          ...node,
          data: {
            ...node.data,
            tableNames: sortedTableNames,
          },
        };
      }

      return node;
    }

    const dataPatch: Record<string, unknown> = {
      DBNameToDBVersions,
    };

    if (node.data.type === "tableselectiondropdown" || node.data.type === "getcountercolumn") {
      dataPatch.tableNames = sortedTableNames;
    }

    return {
      ...node,
      data: {
        ...node.data,
        ...dataPatch,
      },
    };
  });
};

export const resolveTargetInputType = (
  state: GraphState,
  params: Pick<Connection, "source" | "target" | "targetHandle">,
): NodeEdgeTypes | undefined => {
  if (!params.source || !params.target) {
    return undefined;
  }

  const sourceNode = state.nodes.find((node) => node.id === params.source);
  const targetNode = state.nodes.find((node) => node.id === params.target);

  if (!sourceNode || !targetNode) {
    return undefined;
  }

  const sourceOutputType: NodeEdgeTypes | undefined = sourceNode.data
    ? (getNodeData<GraphRuleNodeData>(sourceNode).outputType as NodeEdgeTypes | undefined)
    : undefined;

  if (targetNode.type === "lookup" && targetNode.data) {
    if (params.targetHandle === "input-source") {
      return getNodeData<GraphRuleNodeData>(targetNode).inputType as NodeEdgeTypes | undefined;
    }
    if (params.targetHandle === "input-index") {
      return sourceOutputType;
    }
  } else if (targetNode.type === "generaterowsschema" && targetNode.data) {
    return "CustomSchema" as NodeEdgeTypes;
  } else if (targetNode.type === "dumptotsv" && targetNode.data) {
    return sourceOutputType === "ChangedColumnSelection"
      ? sourceOutputType
      : ("TableSelection" as NodeEdgeTypes);
  } else if (targetNode.type === "readtsvfrompack" && targetNode.data) {
    if (params.targetHandle === "input-schema") {
      return "CustomSchema" as NodeEdgeTypes;
    }
    if (params.targetHandle === "input-packs") {
      return "PackFiles" as NodeEdgeTypes;
    }
  } else if (targetNode.data) {
    return getNodeData<GraphRuleNodeData>(targetNode).inputType as NodeEdgeTypes | undefined;
  }

  return undefined;
};

export const isConnectionAllowed = (state: GraphState, params: Connection): boolean => {
  if (!params.source || !params.target) {
    return false;
  }

  const sourceNode = state.nodes.find((node) => node.id === params.source);
  const targetNode = state.nodes.find((node) => node.id === params.target);

  if (!sourceNode || !targetNode) {
    return false;
  }

  const sourceOutputType: NodeEdgeTypes | undefined = sourceNode.data
    ? (getNodeData<GraphRuleNodeData>(sourceNode).outputType as NodeEdgeTypes | undefined)
    : undefined;
  const targetInputType = resolveTargetInputType(state, params);

  const isTextSurroundCompatible =
    targetNode.type === "textsurround" &&
    (sourceOutputType === "Text" || sourceOutputType === "Text Lines" || sourceOutputType === "GroupedText");

  const isAppendTextCompatible =
    targetNode.type === "appendtext" &&
    (sourceOutputType === "Text" || sourceOutputType === "Text Lines" || sourceOutputType === "GroupedText");

  const isTextJoinCompatible =
    targetNode.type === "textjoin" &&
    (sourceOutputType === "Text Lines" || sourceOutputType === "GroupedText");

  const isSaveChangesCompatible =
    targetNode.type === "savechanges" &&
    (sourceOutputType === "ChangedColumnSelection" ||
      sourceOutputType === "Text" ||
      sourceOutputType === "TableSelection");

  return (
    (sourceOutputType && targetInputType && sourceOutputType === targetInputType) ||
    isTextSurroundCompatible ||
    isAppendTextCompatible ||
    isTextJoinCompatible ||
    isSaveChangesCompatible
  );
};

export const applyConnection = (
  state: GraphState,
  params: Connection,
  context: SchemaContext,
): GraphMutationResult => {
  if (!params.source || !params.target) {
    return { ...state, accepted: false };
  }

  const sourceNode = state.nodes.find((node) => node.id === params.source);
  const targetNode = state.nodes.find((node) => node.id === params.target);

  if (!sourceNode || !targetNode) {
    return { ...state, accepted: false };
  }

  const sourceOutputType: NodeEdgeTypes | undefined = sourceNode.data
    ? (getNodeData<GraphRuleNodeData>(sourceNode).outputType as NodeEdgeTypes | undefined)
    : undefined;
  const targetInputType = resolveTargetInputType(state, params);

  const isTextSurroundCompatible =
    targetNode.type === "textsurround" &&
    (sourceOutputType === "Text" || sourceOutputType === "Text Lines" || sourceOutputType === "GroupedText");
  const isAppendTextCompatible =
    targetNode.type === "appendtext" &&
    (sourceOutputType === "Text" || sourceOutputType === "Text Lines" || sourceOutputType === "GroupedText");
  const isTextJoinCompatible =
    targetNode.type === "textjoin" &&
    (sourceOutputType === "Text Lines" || sourceOutputType === "GroupedText");
  const isSaveChangesCompatible =
    targetNode.type === "savechanges" &&
    (sourceOutputType === "ChangedColumnSelection" ||
      sourceOutputType === "Text" ||
      sourceOutputType === "TableSelection");

  if (
    !(
      (sourceOutputType && targetInputType && sourceOutputType === targetInputType) ||
      isTextSurroundCompatible ||
      isAppendTextCompatible ||
      isTextJoinCompatible ||
      isSaveChangesCompatible
    )
  ) {
    return { ...state, accepted: false };
  }

  let nextNodes = state.nodes;
  let nextEdges = state.edges;
  const { DBNameToDBVersions, defaultTableVersions } = context;

  const setNodes = (updater: (nodes: Node[]) => Node[]) => {
    nextNodes = updater(nextNodes);
  };

  const setEdges = (updater: (edges: Edge[]) => Edge[]) => {
    nextEdges = updater(nextEdges);
  };

  setEdges((edges) => {
    const sourceHandlePart = params.sourceHandle ? `-${params.sourceHandle}` : "";
    const targetHandlePart = params.targetHandle ? `-${params.targetHandle}` : "";
    const newEdge: Edge = {
      ...params,
      id: `edge-${params.source}${sourceHandlePart}-${params.target}${targetHandlePart}`,
      type: "default",
      style: { stroke: "#3b82f6", strokeWidth: 2 },
      animated: true,
    };

    if (
      targetNode.type === "generaterows" ||
      targetNode.type === "mergechanges" ||
      targetNode.type === "savechanges" ||
      targetNode.type === "numericadjustment" ||
      targetNode.type === "mathmax" ||
      targetNode.type === "mathceil"
    ) {
      return [...edges, newEdge];
    }

    const filteredEdges = edges.filter(
      (edge) => !(edge.target === params.target && edge.targetHandle === params.targetHandle),
    );
    return [...filteredEdges, newEdge];
  });

  if (targetNode.type === "textsurround" && sourceOutputType) {
    setNodes((nodes) => updateNode(nodes, params.target!, { inputType: sourceOutputType, outputType: sourceOutputType }));
  }

  if (targetNode.type === "appendtext" && sourceOutputType) {
    setNodes((nodes) => updateNode(nodes, params.target!, { inputType: sourceOutputType, outputType: sourceOutputType }));
  }

  if (targetNode.type === "textjoin" && sourceOutputType === "GroupedText") {
    setNodes((nodes) => updateNode(nodes, params.target!, { inputType: "GroupedText" }));
  }

  if (targetNode.type === "savechanges" && sourceOutputType) {
    setNodes((nodes) => updateNode(nodes, params.target!, { inputType: sourceOutputType }));
  }

  if (
    (targetNode.type === "readtsvfrompack" || targetNode.type === "customrowsinput") &&
    sourceNode.type === "customschema" &&
    (params.targetHandle === "input-schema" || !params.targetHandle)
  ) {
    const schemaColumns = getNodeData<GraphRuleNodeData>(sourceNode).schemaColumns || [];
    setNodes((nodes) =>
      updateNodes(nodes, (node) => {
        if (node.id !== params.target) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            schemaColumns,
            tsvFileName: getNodeData<GraphRuleNodeData>(node).tsvFileName,
            customRows: getNodeData<GraphRuleNodeData>(node).customRows,
          },
        };
      }),
    );
  }

  if (
    TABLE_METADATA_TARGETS.has(targetNode.type as string) &&
    TABLE_SELECTION_SOURCES.has(sourceNode.type as string) &&
    sourceNode.type !== "getcountercolumn"
  ) {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    const hasSchemaColumns = sourceNode.type === "customrowsinput" || sourceNode.type === "readtsvfrompack";
    const hasCustomSchemaColumns = sourceNode.type === "generaterowsschema";

    let tableName: string | undefined;
    let cols: string[] = [];

    if (hasSchemaColumns) {
      tableName = sourceData.tableName || `_custom_${sourceNode.id}`;
      cols = (sourceData.schemaColumns || []).map((col) => col.name);
    } else if (hasCustomSchemaColumns) {
      tableName = `_custom_schema_${sourceNode.id}`;
      cols = sourceData.customSchemaColumns || [];
    } else if (sourceNode.type === "generaterows" || sourceNode.type === "generaterowsschema") {
      const outputTables: Array<{ handleId: string; existingTableName: string; tableVersion?: number }> =
        sourceData.outputTables || [];
      const outputConfig = outputTables.find((output) => output.handleId === params.sourceHandle) ?? outputTables[0];

      if (outputConfig?.existingTableName) {
        if (outputConfig.existingTableName === "__custom_schema__") {
          tableName = `_custom_schema_${sourceNode.id}`;
          cols = sourceData.customSchemaColumns || [];
        } else {
          tableName = outputConfig.existingTableName;
          const tableVersions = (sourceData.DBNameToDBVersions || DBNameToDBVersions)?.[tableName];
          if (tableVersions && tableVersions.length > 0) {
            const schema =
              (outputConfig.tableVersion !== undefined
                ? tableVersions.find((version: DBVersion) => version.version === outputConfig.tableVersion)
                : undefined) ??
              getTableVersion(tableName, tableVersions, defaultTableVersions) ??
              tableVersions[0];
            cols = schema.fields.map((field) => field.name);
          }
        }
      }
    } else {
      const outputInfo = getSourceNodeOutputInfo(
        sourceNode,
        sourceData,
        sourceData.DBNameToDBVersions || DBNameToDBVersions,
        defaultTableVersions,
      );
      tableName = outputInfo.tableName;
      cols = outputInfo.columnNames;
    }

    if (cols.length === 0 && tableName && DBNameToDBVersions?.[tableName]) {
      const tableVersions = DBNameToDBVersions[tableName];
      if (tableVersions.length > 0) {
        const selectedVersion = getTableVersion(tableName, tableVersions, defaultTableVersions);
        cols = (selectedVersion?.fields || []).map((field) => field.name);
      }
    }

    if (tableName && (cols.length > 0 || DBNameToDBVersions)) {
      setNodes((nodes) =>
        updateNode(nodes, params.target!, {
          columnNames: cols,
          inputColumnNames: cols,
          connectedTableName: tableName,
          DBNameToDBVersions: hasSchemaColumns
            ? DBNameToDBVersions
            : sourceData.DBNameToDBVersions || DBNameToDBVersions,
        }),
      );
    }
  }

  if (
    (TABLE_METADATA_TARGETS.has(targetNode.type as string) ||
      targetNode.type === "generaterows" ||
      targetNode.type === "lookup") &&
    sourceNode.type === "getcountercolumn"
  ) {
    const counterData = getNodeData<GraphRuleNodeData>(sourceNode);
    const newColumnName = counterData.newColumnName || `counter_${counterData.selectedColumn}`;
    const tableName = `_counter_${counterData.selectedTable}`;
    const syntheticTableVersion: DBVersion = {
      version: 1,
      fields: [
        {
          name: newColumnName,
          field_type: "I32",
          is_key: false,
          default_value: "",
          is_filename: false,
          is_reference: [],
          description: `Counter from ${counterData.selectedTable}.${counterData.selectedColumn}`,
          ca_order: 0,
          is_bitwise: 0,
          enum_values: {},
        },
      ],
    };

    const updatedDBNameToDBVersions = {
      ...(DBNameToDBVersions || {}),
      [tableName]: [syntheticTableVersion],
    };

    setNodes((nodes) =>
      updateNode(nodes, params.target!, {
        columnNames: [newColumnName],
        connectedTableName: tableName,
        DBNameToDBVersions: updatedDBNameToDBVersions,
      }),
    );
  }

  if (targetNode.type === "lookup" && sourceNode.type === "indextable" && params.targetHandle === "input-index") {
    const indexTableData = getNodeData<GraphRuleNodeData>(sourceNode);
    const indexedTableName = indexTableData.connectedTableName;
    const indexColumnNames = indexTableData.columnNames;

    if (indexedTableName) {
      setNodes((nodes) =>
        updateNode(nodes, params.target!, {
          connectedIndexTableName: indexedTableName,
          indexedTableColumnNames: indexColumnNames,
        }),
      );
    }
  }

  if (
    (targetNode.type === "filter" || targetNode.type === "multifilter") &&
    (sourceNode.type === "filter" || sourceNode.type === "multifilter")
  ) {
    const sourceFilterData = getNodeData<GraphRuleNodeData>(sourceNode);
    if (sourceFilterData.connectedTableName && sourceFilterData.DBNameToDBVersions) {
      setNodes((nodes) =>
        updateNode(nodes, params.target!, {
          columnNames: sourceFilterData.columnNames || [],
          connectedTableName: sourceFilterData.connectedTableName,
          DBNameToDBVersions: sourceFilterData.DBNameToDBVersions,
        }),
      );
    }
  }

  if (
    targetNode.type === "referencelookup" &&
    (sourceNode.type === "filter" ||
      sourceNode.type === "multifilter" ||
      sourceNode.type === "referencelookup" ||
      sourceNode.type === "reversereferencelookup")
  ) {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    const outputInfo = getSourceNodeOutputInfo(
      sourceNode,
      sourceData,
      sourceData.DBNameToDBVersions,
      defaultTableVersions,
    );

    if (outputInfo.tableName && sourceData.DBNameToDBVersions) {
      setNodes((nodes) =>
        updateNode(nodes, params.target!, {
          columnNames: outputInfo.columnNames,
          connectedTableName: outputInfo.tableName,
          DBNameToDBVersions: sourceData.DBNameToDBVersions,
        }),
      );
    }
  }

  if (
    targetNode.type === "reversereferencelookup" &&
    (sourceNode.type === "filter" ||
      sourceNode.type === "multifilter" ||
      sourceNode.type === "referencelookup" ||
      sourceNode.type === "reversereferencelookup")
  ) {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    const outputInfo = getSourceNodeOutputInfo(
      sourceNode,
      sourceData,
      sourceData.DBNameToDBVersions,
      defaultTableVersions,
    );

    if (outputInfo.tableName && sourceData.DBNameToDBVersions) {
      setNodes((nodes) =>
        updateNode(nodes, params.target!, {
          columnNames: outputInfo.columnNames,
          connectedTableName: outputInfo.tableName,
          DBNameToDBVersions: sourceData.DBNameToDBVersions,
        }),
      );
    }
  }

  if (
    targetNode.type === "columnselectiondropdown" &&
    (sourceNode.type === "tableselection" || sourceNode.type === "tableselectiondropdown")
  ) {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    const tableName = sourceNode.type === "tableselectiondropdown" ? sourceData.selectedTable : undefined;

    if (tableName && DBNameToDBVersions?.[tableName]) {
      const selectedVersion = getTableVersion(tableName, DBNameToDBVersions[tableName], defaultTableVersions);
      const fieldNames = (selectedVersion?.fields || []).map((field) => field.name);
      setNodes((nodes) => updateNode(nodes, params.target!, { columnNames: fieldNames, connectedTableName: tableName }));
    }
  }

  if (
    targetNode.type === "generaterows" || targetNode.type === "generaterowsschema"
  ) {
    // handled below for merge logic
  }

  if (
    (targetNode.type === "lookup" || targetNode.type === "groupby" || targetNode.type === "deduplicate") &&
    (sourceNode.type === "tableselection" ||
      sourceNode.type === "tableselectiondropdown" ||
      sourceNode.type === "filter" ||
      sourceNode.type === "multifilter" ||
      sourceNode.type === "referencelookup" ||
      sourceNode.type === "reversereferencelookup" ||
      sourceNode.type === "lookup" ||
      sourceNode.type === "extracttable" ||
      sourceNode.type === "flattennested" ||
      sourceNode.type === "generaterows" ||
      sourceNode.type === "generaterowsschema" ||
      sourceNode.type === "addnewcolumn" ||
      sourceNode.type === "customrowsinput" ||
      sourceNode.type === "readtsvfrompack")
  ) {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    const hasSchemaColumns = sourceNode.type === "customrowsinput" || sourceNode.type === "readtsvfrompack";
    let columnNames: string[];
    let tableName: string | undefined;

    if (hasSchemaColumns) {
      columnNames = (sourceData.schemaColumns || []).map((col) => col.name);
      tableName = sourceData.tableName || `_custom_${sourceNode.id}`;
    } else if (sourceNode.type === "generaterows" || sourceNode.type === "generaterowsschema") {
      const outputTables: Array<{ handleId: string; existingTableName: string; tableVersion?: number }> =
        sourceData.outputTables || [];
      const outputConfig = outputTables.find((output) => output.handleId === params.sourceHandle) ?? outputTables[0];

      if (outputConfig?.existingTableName && outputConfig.existingTableName !== "__custom_schema__") {
        tableName = outputConfig.existingTableName;
        const tableVersions = (sourceData.DBNameToDBVersions || DBNameToDBVersions)?.[tableName];
        if (tableVersions && tableVersions.length > 0) {
          const schema =
            (outputConfig.tableVersion !== undefined
              ? tableVersions.find((version: DBVersion) => version.version === outputConfig.tableVersion)
              : undefined) ??
            getTableVersion(tableName, tableVersions, defaultTableVersions) ??
            tableVersions[0];
          columnNames = schema.fields.map((field) => field.name);
        } else {
          columnNames = [];
        }
      } else {
        tableName = `_custom_schema_${sourceNode.id}`;
        columnNames = sourceData.customSchemaColumns || [];
      }
    } else {
      const outputInfo = getSourceNodeOutputInfo(
        sourceNode,
        sourceData,
        sourceData.DBNameToDBVersions || DBNameToDBVersions,
        defaultTableVersions,
      );
      columnNames = outputInfo.columnNames;
      tableName = outputInfo.tableName;
    }

    if (tableName && (columnNames.length > 0 || sourceData.DBNameToDBVersions)) {
      setNodes((nodes) =>
        updateNode(nodes, params.target!, {
          columnNames,
          sourceInputColumns: columnNames,
          connectedTableName: tableName,
          DBNameToDBVersions: hasSchemaColumns ? DBNameToDBVersions : sourceData.DBNameToDBVersions,
        }),
      );
    }
  }

  if (targetNode.type === "extracttable" && (sourceNode.type === "lookup" || sourceNode.type === "flattennested")) {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    if (sourceData.DBNameToDBVersions) {
      setNodes((nodes) =>
        updateNode(nodes, params.target!, {
          columnNames: sourceData.columnNames || [],
          connectedTableName: sourceData.connectedTableName,
          DBNameToDBVersions: sourceData.DBNameToDBVersions,
        }),
      );
    }
  }

  if (targetNode.type === "aggregatenested" && sourceNode.type === "lookup") {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    if (sourceData.DBNameToDBVersions) {
      const columnsToUse =
        sourceData.joinType === "nested"
          ? sourceData.indexedTableColumns || sourceData.columnNames || []
          : sourceData.columnNames || [];
      const tableNameToUse =
        sourceData.joinType === "nested"
          ? sourceData.indexedTableName || sourceData.connectedTableName
          : sourceData.connectedTableName;

      setNodes((nodes) =>
        updateNode(nodes, params.target!, {
          columnNames: columnsToUse,
          connectedTableName: tableNameToUse,
          sourceTableColumns: sourceData.columnNames || [],
          sourceTableName: sourceData.connectedTableName,
          DBNameToDBVersions: sourceData.DBNameToDBVersions,
        }),
      );
    }
  }

  if (targetNode.type === "flattennested" && (sourceNode.type === "lookup" || sourceNode.type === "aggregatenested")) {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    if (sourceData.DBNameToDBVersions) {
      let columnsToUse = sourceData.columnNames || [];
      if (sourceNode.type === "aggregatenested" && sourceData.sourceTableColumns) {
        const aggregateType = sourceData.aggregateType;
        if (aggregateType === "min" || aggregateType === "max") {
          const sourceTableName = sourceData.sourceTableName || "";
          const indexedTableName = sourceData.connectedTableName || "";
          const prefixedSourceColumns = (sourceData.sourceTableColumns || []).map(
            (column: string) => `${sourceTableName}_${column}`,
          );
          const prefixedIndexedColumns = (sourceData.columnNames || []).map(
            (column: string) => `${indexedTableName}_${column}`,
          );
          columnsToUse = [...prefixedSourceColumns, ...prefixedIndexedColumns];
        } else {
          const aggregateColumn = sourceData.aggregateColumn;
          const aggregateColumnName = `${aggregateColumn}_${aggregateType}`;
          const sourceTableName = sourceData.sourceTableName || "";
          const prefixedSourceColumns = (sourceData.sourceTableColumns || []).map(
            (column: string) => `${sourceTableName}_${column}`,
          );
          columnsToUse = [...prefixedSourceColumns, aggregateColumnName];
        }
      }

      setNodes((nodes) =>
        updateNode(nodes, params.target!, {
          columnNames: columnsToUse,
          connectedTableName: sourceData.connectedTableName,
          DBNameToDBVersions: sourceData.DBNameToDBVersions,
        }),
      );
    }
  }

  if (
    (targetNode.type === "generaterows" || targetNode.type === "generaterowsschema") &&
    (sourceNode.type === "tableselection" ||
      sourceNode.type === "tableselectiondropdown" ||
      sourceNode.type === "filter" ||
      sourceNode.type === "multifilter" ||
      sourceNode.type === "referencelookup" ||
      sourceNode.type === "reversereferencelookup" ||
      sourceNode.type === "lookup" ||
      sourceNode.type === "extracttable" ||
      sourceNode.type === "flattennested" ||
      sourceNode.type === "getcountercolumn" ||
      sourceNode.type === "groupby" ||
      sourceNode.type === "deduplicate" ||
      sourceNode.type === "addnewcolumn" ||
      sourceNode.type === "customrowsinput" ||
      sourceNode.type === "readtsvfrompack")
  ) {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    const hasSchemaColumns = sourceNode.type === "customrowsinput" || sourceNode.type === "readtsvfrompack";
    const isTableDropdown = sourceNode.type === "tableselectiondropdown" && !!sourceData.selectedTable;
    const isValidSource =
      (sourceData.connectedTableName &&
        (sourceData.DBNameToDBVersions || (sourceData.columnNames && sourceData.columnNames.length > 0))) ||
      hasSchemaColumns ||
      isTableDropdown;

    if (isValidSource) {
      setNodes((nodes) =>
        updateNodes(nodes, (node) => {
          if (node.id !== params.target) {
            return node;
          }

          const existingEdges = state.edges.filter((edge) => edge.target === params.target);
          const allSourceColumns = new Set<string>();

          for (const existingEdge of existingEdges) {
            const connectedSourceNode = nodes.find((candidate) => candidate.id === existingEdge.source);
            if (connectedSourceNode) {
              const connectedSourceData = getNodeData<GraphRuleNodeData>(connectedSourceNode);
              let cols = connectedSourceData.columnNames || [];

              if (cols.length === 0 && connectedSourceNode.type === "tableselectiondropdown") {
                const selectedTable = connectedSourceData.selectedTable;
                if (selectedTable && DBNameToDBVersions?.[selectedTable]) {
                  const selectedVersion = getTableVersion(
                    selectedTable,
                    DBNameToDBVersions[selectedTable],
                    defaultTableVersions,
                  );
                  cols = (selectedVersion?.fields || []).map((field) => field.name);
                }
              }

              if (
                cols.length === 0 &&
                (connectedSourceNode.type === "customrowsinput" || connectedSourceNode.type === "readtsvfrompack")
              ) {
                cols = (connectedSourceData.schemaColumns || []).map((column) => column.name);
              }

              cols.forEach((column: string) => allSourceColumns.add(column));
            }
          }

          let newSourceColumns = sourceData.columnNames || [];
          let tableNameToUse = sourceData.connectedTableName;

          if (sourceNode.type === "reversereferencelookup" && sourceData.selectedReverseTable) {
            tableNameToUse = sourceData.selectedReverseTable;
            if (DBNameToDBVersions?.[tableNameToUse]) {
              const selectedVersion = getTableVersion(
                tableNameToUse,
                DBNameToDBVersions[tableNameToUse],
                defaultTableVersions,
              );
              newSourceColumns = (selectedVersion?.fields || []).map((field) => field.name);
            }
          } else if (sourceNode.type === "referencelookup" && sourceData.selectedReferenceTable) {
            tableNameToUse = sourceData.selectedReferenceTable;
            if (DBNameToDBVersions?.[tableNameToUse]) {
              const selectedVersion = getTableVersion(
                tableNameToUse,
                DBNameToDBVersions[tableNameToUse],
                defaultTableVersions,
              );
              newSourceColumns = (selectedVersion?.fields || []).map((field) => field.name);
            }
          } else if (newSourceColumns.length === 0 && hasSchemaColumns) {
            newSourceColumns = (sourceData.schemaColumns || []).map((column) => column.name);
          } else if (newSourceColumns.length === 0 && isTableDropdown) {
            const selectedTable = sourceData.selectedTable;
            tableNameToUse = selectedTable;
            if (selectedTable && DBNameToDBVersions?.[selectedTable]) {
              const selectedVersion = getTableVersion(
                selectedTable,
                DBNameToDBVersions[selectedTable],
                defaultTableVersions,
              );
              newSourceColumns = (selectedVersion?.fields || []).map((field) => field.name);
            }
          }

          newSourceColumns.forEach((column: string) => allSourceColumns.add(column));

          return {
            ...node,
            data: {
              ...node.data,
              columnNames: Array.from(allSourceColumns),
              inputColumnNames: Array.from(allSourceColumns),
              connectedTableName: tableNameToUse,
              DBNameToDBVersions: hasSchemaColumns || isTableDropdown ? DBNameToDBVersions : sourceData.DBNameToDBVersions,
            },
          };
        }),
      );
    }
  }

  if (
    (targetNode.type === "generaterows" || targetNode.type === "generaterowsschema") &&
    sourceNode.type === "customschema" &&
    params.targetHandle === "input-schema"
  ) {
    const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
    const schemaColumns = (sourceData.schemaColumns || []).map((column) => column.name);
    setNodes((nodes) =>
      updateNode(nodes, params.target!, {
        customSchemaColumns: schemaColumns,
        customSchemaData: sourceData.schemaColumns,
      }),
    );
  }

  const synchronizedGraph = synchronizeDerivedGraphState(
    {
      nodes: nextNodes,
      edges: nextEdges,
    },
    context,
  );

  return { ...synchronizedGraph, accepted: true };
};

export const removeEdge = (
  state: GraphState,
  edgeId: string,
  context: SchemaContext,
): GraphMutationResult => {
  const edge = state.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) {
    return { ...state };
  }

  const targetNode = state.nodes.find((node) => node.id === edge.target);
  const nextEdges = state.edges.filter((candidate) => candidate.id !== edgeId);

  if (targetNode && (targetNode.type === "generaterows" || targetNode.type === "generaterowsschema")) {
    const remainingIncomingEdges = nextEdges.filter((candidate) => candidate.target === edge.target);
    const allSourceColumns = new Set<string>();

    for (const incomingEdge of remainingIncomingEdges) {
      const sourceNode = state.nodes.find((node) => node.id === incomingEdge.source);
      if (sourceNode) {
        const columns = getNodeData<GraphRuleNodeData>(sourceNode).columnNames || [];
        columns.forEach((column) => allSourceColumns.add(column));
      }
    }

    return synchronizeDerivedGraphState(
      {
        nodes: updateNode(state.nodes, edge.target, {
          columnNames: Array.from(allSourceColumns),
          inputColumnNames: Array.from(allSourceColumns),
        }),
        edges: nextEdges,
      },
      context,
    );
  }

  return synchronizeDerivedGraphState(
    {
      nodes: state.nodes,
      edges: nextEdges,
    },
    context,
  );
};

export const rehydrateGraph = (state: GraphState, context: SchemaContext): GraphMutationResult => {
  const { DBNameToDBVersions, defaultTableVersions } = context;
  let nextNodes = withSchemaContext(state.nodes, context);

  const setNodes = (updater: (nodes: Node[]) => Node[]) => {
    nextNodes = updater(nextNodes);
  };

  state.edges.forEach((edge) => {
    const sourceNode = nextNodes.find((node) => node.id === edge.source);
    const targetNode = nextNodes.find((node) => node.id === edge.target);

    if (!sourceNode || !targetNode) {
      return;
    }

    if (
      (targetNode.type === "columnselectiondropdown" ||
        targetNode.type === "groupbycolumns" ||
        targetNode.type === "filter" ||
        targetNode.type === "referencelookup" ||
        targetNode.type === "getcountercolumn" ||
        targetNode.type === "reversereferencelookup") &&
      (sourceNode.type === "tableselection" || sourceNode.type === "tableselectiondropdown")
    ) {
      const tableName =
        sourceNode.type === "tableselectiondropdown"
          ? getNodeData<GraphRuleNodeData>(sourceNode).selectedTable
          : undefined;

      if (tableName && DBNameToDBVersions?.[tableName]) {
        const selectedVersion = getTableVersion(tableName, DBNameToDBVersions[tableName], defaultTableVersions);
        const fieldNames = (selectedVersion?.fields || []).map((field) => field.name);
        setNodes((nodes) => updateNode(nodes, targetNode.id, { columnNames: fieldNames, connectedTableName: tableName }));
      }
    }

    if (
      targetNode.type === "referencelookup" &&
      (sourceNode.type === "filter" || sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
    ) {
      const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
      const outputInfo = getSourceNodeOutputInfo(
        sourceNode,
        sourceData,
        sourceData.DBNameToDBVersions,
        defaultTableVersions,
      );
      if (outputInfo.tableName && sourceData.DBNameToDBVersions) {
        setNodes((nodes) =>
          updateNode(nodes, targetNode.id, {
            columnNames: outputInfo.columnNames,
            connectedTableName: outputInfo.tableName,
            DBNameToDBVersions: sourceData.DBNameToDBVersions,
          }),
        );
      }
    }

    if (
      targetNode.type === "reversereferencelookup" &&
      (sourceNode.type === "filter" || sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
    ) {
      const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
      const outputInfo = getSourceNodeOutputInfo(
        sourceNode,
        sourceData,
        sourceData.DBNameToDBVersions,
        defaultTableVersions,
      );
      if (outputInfo.tableName && sourceData.DBNameToDBVersions) {
        setNodes((nodes) =>
          updateNode(nodes, targetNode.id, {
            columnNames: outputInfo.columnNames,
            connectedTableName: outputInfo.tableName,
            DBNameToDBVersions: sourceData.DBNameToDBVersions,
          }),
        );
      }
    }

    if (
      targetNode.type === "filter" &&
      (sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
    ) {
      if (sourceNode.type === "referencelookup") {
        const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
        if (sourceData.selectedReferenceTable && sourceData.DBNameToDBVersions) {
          const tableVersions = sourceData.DBNameToDBVersions[sourceData.selectedReferenceTable];
          let columnNamesToUse: string[] = [];
          if (tableVersions?.length > 0) {
            const selectedVersion = getTableVersion(
              sourceData.selectedReferenceTable,
              tableVersions,
              defaultTableVersions,
            );
            columnNamesToUse = (selectedVersion?.fields || []).map((field) => field.name);
          }

          setNodes((nodes) =>
            updateNode(nodes, targetNode.id, {
              columnNames: columnNamesToUse,
              connectedTableName: sourceData.selectedReferenceTable,
              DBNameToDBVersions: sourceData.DBNameToDBVersions,
            }),
          );
        }
      } else {
        const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
        if (sourceData.selectedReverseTable && sourceData.DBNameToDBVersions) {
          const tableVersions = sourceData.DBNameToDBVersions[sourceData.selectedReverseTable];
          let columnNamesToUse: string[] = [];
          if (tableVersions?.length > 0) {
            const selectedVersion = getTableVersion(
              sourceData.selectedReverseTable,
              tableVersions,
              defaultTableVersions,
            );
            columnNamesToUse = (selectedVersion?.fields || []).map((field) => field.name);
          }

          setNodes((nodes) =>
            updateNode(nodes, targetNode.id, {
              columnNames: columnNamesToUse,
              connectedTableName: sourceData.selectedReverseTable,
              DBNameToDBVersions: sourceData.DBNameToDBVersions,
            }),
          );
        }
      }
    }

    if (targetNode.type === "filter" && sourceNode.type === "filter") {
      const sourceFilterData = getNodeData<GraphRuleNodeData>(sourceNode);
      if (sourceFilterData.connectedTableName && sourceFilterData.DBNameToDBVersions) {
        setNodes((nodes) =>
          updateNode(nodes, targetNode.id, {
            columnNames: sourceFilterData.columnNames || [],
            connectedTableName: sourceFilterData.connectedTableName,
            DBNameToDBVersions: sourceFilterData.DBNameToDBVersions,
          }),
        );
      }
    }

    if (
      (targetNode.type === "columnselectiondropdown" || targetNode.type === "groupbycolumns") &&
      (sourceNode.type === "filter" || sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
    ) {
      const sourceData = getNodeData<GraphRuleNodeData>(sourceNode);
      let tableNameToUse = sourceData.connectedTableName;
      let columnNamesToUse = sourceData.columnNames || [];

      if (sourceNode.type === "referencelookup") {
        if (sourceData.selectedReferenceTable && sourceData.DBNameToDBVersions) {
          tableNameToUse = sourceData.selectedReferenceTable;
          const tableVersions = sourceData.DBNameToDBVersions[tableNameToUse];
          if (tableVersions?.length > 0) {
            const selectedVersion = getTableVersion(tableNameToUse, tableVersions, defaultTableVersions);
            columnNamesToUse = (selectedVersion?.fields || []).map((field) => field.name);
          }
        } else if (
          getNodeData<GraphRuleNodeData>(targetNode).connectedTableName &&
          getNodeData<GraphRuleNodeData>(targetNode).connectedTableName !== sourceData.connectedTableName
        ) {
          const targetConnectedTable = getNodeData<GraphRuleNodeData>(targetNode).connectedTableName;
          tableNameToUse = targetConnectedTable;
          columnNamesToUse = getNodeData<GraphRuleNodeData>(targetNode).columnNames || [];
          setNodes((nodes) => updateNode(nodes, sourceNode.id, { selectedReferenceTable: targetConnectedTable }));
        }
      } else if (sourceNode.type === "reversereferencelookup") {
        if (sourceData.selectedReverseTable && sourceData.DBNameToDBVersions) {
          tableNameToUse = sourceData.selectedReverseTable;
          const tableVersions = sourceData.DBNameToDBVersions[tableNameToUse];
          if (tableVersions?.length > 0) {
            const selectedVersion = getTableVersion(tableNameToUse, tableVersions, defaultTableVersions);
            columnNamesToUse = (selectedVersion?.fields || []).map((field) => field.name);
          }
        } else if (
          getNodeData<GraphRuleNodeData>(targetNode).connectedTableName &&
          getNodeData<GraphRuleNodeData>(targetNode).connectedTableName !== sourceData.connectedTableName
        ) {
          const targetConnectedTable = getNodeData<GraphRuleNodeData>(targetNode).connectedTableName;
          tableNameToUse = targetConnectedTable;
          columnNamesToUse = getNodeData<GraphRuleNodeData>(targetNode).columnNames || [];
          setNodes((nodes) => updateNode(nodes, sourceNode.id, { selectedReverseTable: targetConnectedTable }));
        }
      }

      if (tableNameToUse && sourceData.DBNameToDBVersions) {
        setNodes((nodes) =>
          updateNode(nodes, targetNode.id, {
            columnNames: columnNamesToUse,
            connectedTableName: tableNameToUse,
            DBNameToDBVersions: sourceData.DBNameToDBVersions,
          }),
        );
      }
    }

    if (
      targetNode.type === "tableselectiondropdown" &&
      (sourceNode.type === "packedfiles" || sourceNode.type === "packfilesdropdown" || sourceNode.type === "allenabledmods")
    ) {
      const selectedPack =
        sourceNode.type === "packfilesdropdown" ? getNodeData<GraphRuleNodeData>(sourceNode).selectedPack : undefined;
      if (selectedPack) {
        setNodes((nodes) => updateNode(nodes, targetNode.id, {}));
      }
    }
  });

  return synchronizeDerivedGraphState(
    {
      nodes: nextNodes,
      edges: state.edges,
    },
    context,
  );
};
