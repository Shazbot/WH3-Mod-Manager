import type { XYPosition } from "@xyflow/react";

import { DBVersion } from "../packFileTypes";

export interface BaseFlowOption {
  id: string;
  name: string;
  description?: string;
}

export interface TextboxFlowOption extends BaseFlowOption {
  type: "textbox";
  value: string;
  placeholder?: string;
}

export interface RangeSliderFlowOption extends BaseFlowOption {
  type: "range";
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface CheckboxFlowOption extends BaseFlowOption {
  type: "checkbox";
  value: boolean;
}

export type FlowOption = TextboxFlowOption | RangeSliderFlowOption | CheckboxFlowOption;

export interface SerializedNode {
  id: string;
  type: FlowNodeType;
  position?: XYPosition;
  data: {
    label: string;
    type: FlowNodeType;
    textValue?: string;
    selectedPack?: string;
    selectedTable?: string;
    selectedColumn?: string;
    selectedColumn1?: string;
    selectedColumn2?: string;
    packName?: string;
    packedFileName?: string;
    pattern?: string;
    joinSeparator?: string;
    beforeText?: string;
    afterText?: string;
    useCurrentPack?: boolean;
    onlyForMultiple?: boolean;
    filters?: Array<{ column: string; value: string; not: boolean; operator: "AND" | "OR" }>;
    splitValues?: Array<{ id: string; value: string; enabled: boolean }>;
    columnNames?: string[];
    dedupeByColumns?: string[];
    dedupeAgainstVanilla?: boolean;
    connectedTableName?: string;
    outputType?: string;
    inputType?: string;
    DBNameToDBVersions?: Record<string, DBVersion[]>;
    groupedTextSelection?: "Text" | "Text Lines";
    selectedReferenceTable?: string;
    referenceTableNames?: string[];
    selectedReverseTable?: string;
    reverseTableNames?: string[];
    includeBaseGame?: boolean;
    inputCount?: number;
    flowExecutionId?: string;
    indexColumns?: string[];
    lookupColumn?: string;
    joinType?: "inner" | "left" | "nested" | "cross";
    tablePrefix?: string;
    tablePrefixes?: string[];
    aggregateColumn?: string;
    aggregateType?: "min" | "max" | "sum" | "avg" | "count";
    filterColumn?: string;
    filterOperator?:
      | "equals"
      | "notEquals"
      | "greaterThan"
      | "lessThan"
      | "greaterThanOrEqual"
      | "lessThanOrEqual";
    filterValue?: string;
    transformations?: Array<Record<string, unknown>>;
    outputTables?: Array<{
      handleId: string;
      name: string;
      existingTableName: string;
      tableVersion?: number;
      columnMapping: string[];
      staticValues?: Record<string, string>;
    }>;
    outputCount?: number;
    groupByColumns?: string[];
    aggregations?: Array<Record<string, unknown>>;
    inputColumnNames?: string[];
    schemaColumns?: Array<Record<string, unknown>>;
    customRows?: Array<Record<string, unknown>>;
    newColumnName?: string;
    tsvFileName?: string;
    tableName?: string;
    sourceInputColumns?: string[] | null;
    indexedTableColumns?: string[] | null;
    openInWindows?: boolean;
    customSchemaColumns?: string[];
    customSchemaData?: unknown;
  };
}

export interface SerializedConnection {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType?: NodeEdgeTypes;
  targetType?: NodeEdgeTypes;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface SerializedNodeGraph {
  version: string;
  timestamp: number;
  nodes: SerializedNode[];
  connections: SerializedConnection[];
  options: FlowOption[];
  metadata: {
    nodeCount: number;
    connectionCount: number;
  };
  isGraphEnabled: boolean;
  graphStartsEnabled: boolean;
}

export type FlowNodeData = Omit<
  SerializedNode["data"],
  "transformations" | "aggregations" | "schemaColumns" | "customRows" | "outputTables"
> & {
  transformations?: unknown[];
  aggregations?: unknown[];
  schemaColumns?: unknown[];
  customRows?: unknown[];
  outputTables?: unknown[];
  DBNameToDBVersions?: Record<string, DBVersion[]>;
  onUpdateNodeData?: (patch: FlowNodeDataPatch) => void;
};

export type FlowNodeDataPatch = Partial<Omit<FlowNodeData, "onUpdateNodeData">>;

export interface NodeEditorActionData {
  onUpdateNodeData?: (patch: FlowNodeDataPatch) => void;
}
