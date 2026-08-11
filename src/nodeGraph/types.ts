import type { XYPosition } from "@xyflow/react";

import { DBVersion } from "../packFileTypes";
import type { DeepCloneOverride, DeepCloneTreeNode, DeepCloneVariantAxis } from "./nodes/types";

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

/**
 * A textarea whose value is a list: one entry per line. Substituted into a node field as the raw
 * newline-separated text, which the filter node reads as a set of values to match against.
 */
export interface MultilineTextboxFlowOption extends BaseFlowOption {
  type: "multiline";
  value: string;
  placeholder?: string;
}

/** One choice of a radio option. Ids are what nodes bind to, so a label can change freely. */
export interface RadioFlowOptionChoice {
  id: string;
  label: string;
}

/** A set of mutually exclusive choices, of which exactly one is selected. */
export interface RadioFlowOption extends BaseFlowOption {
  type: "radio";
  /** The id of the selected choice. */
  value: string;
  choices: RadioFlowOptionChoice[];
}

export type FlowOption =
  | TextboxFlowOption
  | RangeSliderFlowOption
  | CheckboxFlowOption
  | MultilineTextboxFlowOption
  | RadioFlowOption;

/**
 * The choice a radio option resolves to: the selected one, falling back to the first.
 *
 * A stored selection can point at a choice the author has since removed, and a branch that activates
 * nothing would silently skip every path, so the first choice stands in.
 */
export const resolveRadioChoiceId = (option: RadioFlowOption, userValue?: unknown): string => {
  const choices = option.choices || [];
  const selected = typeof userValue === "string" ? userValue : option.value;
  if (choices.some((choice) => choice.id === selected)) return selected;
  return choices[0]?.id ?? "";
};

/** Splits a multiline option value into its entries, ignoring blank lines and surrounding spaces. */
export const splitMultilineOptionValue = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export interface SerializedNode {
  id: string;
  type: FlowNodeType;
  position?: XYPosition;
  data: {
    label: string;
    type: FlowNodeType;
    isDisabled?: boolean;
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
    joinType?: "inner" | "left" | "anti" | "nested" | "cross";
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
    filename?: string;
    tsvFileName?: string;
    tableName?: string;
    sourceInputColumns?: string[] | null;
    indexedTableColumns?: string[] | null;
    openInWindows?: boolean;
    openInViewer?: boolean;
    customSchemaColumns?: string[];
    customSchemaData?: unknown;
    cloneTree?: DeepCloneTreeNode;
    nameTemplate?: string;
    useModdersPrefix?: boolean;
    moddersPrefix?: string;
    variantAxes?: DeepCloneVariantAxis[];
    columnOverrides?: DeepCloneOverride[];
    generateLoc?: boolean;
    autoFollowReferences?: boolean;
    selectedFlowOptionId?: string;
    flowOptionChecked?: boolean;
    flowOptionKind?: "checkbox" | "radio";
    flowOptionChoiceId?: string;
    flowOptionChoices?: Array<{ id: string; label: string }>;
    tablesToRemove?: string[];
    locRules?: Array<Record<string, unknown>>;
    textFileRules?: Array<Record<string, unknown>>;
    textFileFormatter?: "none" | "autoIndent" | "prettyXml" | "compactXml";
    fileOperations?: Array<Record<string, unknown>>;
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
