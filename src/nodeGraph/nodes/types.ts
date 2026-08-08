import { DBVersion, SCHEMA_FIELD_TYPE } from "../../packFileTypes";
import { FlowNodeDataPatch } from "../types";

export interface NodeData extends Record<string, unknown> {
  label: string;
  type: string;
  textValue?: string;
  outputType?: NodeEdgeTypes | "CustomSchema";
  onUpdateNodeData?: (detail: FlowNodeDataPatch) => void;
}

export interface PackFilesNodeData extends NodeData {
  textValue: string;
  outputType: "PackFiles";
  useCurrentPack?: boolean;
}

export interface TableSelectionNodeData extends NodeData {
  textValue: string;
  inputType: "PackFiles";
  outputType: "TableSelection";
}

export interface ColumnSelectionNodeData extends NodeData {
  textValue: string;
  inputType: "TableSelection";
  outputType: "ColumnSelection";
}

export interface NumericAdjustmentNodeData extends NodeData {
  textValue: string;
  inputType: "ColumnSelection";
  outputType: "ChangedColumnSelection";
}

export interface MathMaxNodeData extends NodeData {
  textValue: string;
  inputType: "ChangedColumnSelection";
  outputType: "ChangedColumnSelection";
}

export interface MathCeilNodeData extends NodeData {
  inputType: "ChangedColumnSelection";
  outputType: "ChangedColumnSelection";
}

export interface MergeChangesNodeData extends NodeData {
  inputType: "ChangedColumnSelection";
  outputType: "ChangedColumnSelection";
  inputCount: number;
}

export interface SaveChangesNodeData extends NodeData {
  textValue: string;
  packName: string;
  packedFileName: string;
  openInWindows: boolean;
  inputType: "ChangedColumnSelection" | "Text" | "TableSelection";
}

export interface TextSurroundNodeData extends NodeData {
  textValue: string;
  inputType: "Text" | "Text Lines" | "GroupedText";
  outputType: "Text" | "Text Lines";
  groupedTextSelection?: "Text" | "Text Lines";
}

export interface AppendTextNodeData extends NodeData {
  beforeText: string;
  afterText: string;
  inputType: "Text" | "Text Lines" | "GroupedText";
  outputType: "Text" | "Text Lines" | "GroupedText";
  groupedTextSelection?: "Text" | "Text Lines";
}

export interface TextJoinNodeData extends NodeData {
  textValue: string;
  inputType: "Text Lines" | "GroupedText";
  outputType: "Text";
  groupedTextSelection?: "Text" | "Text Lines";
}

export interface GroupedColumnsToTextNodeData extends NodeData {
  pattern: string;
  joinSeparator: string;
  inputType: "GroupedText";
  outputType: "Text";
}

export interface PackFilesDropdownNodeData extends NodeData {
  selectedPack: string;
  outputType: "PackFiles";
  useCurrentPack?: boolean;
}

export interface AllEnabledModsNodeData extends NodeData {
  outputType: "PackFiles";
  includeBaseGame?: boolean;
}

export interface TableSelectionDropdownNodeData extends NodeData {
  selectedTable: string;
  inputType: "PackFiles";
  outputType: "TableSelection";
  tableNames: string[];
}

export interface ColumnSelectionDropdownNodeData extends NodeData {
  selectedColumn: string;
  inputType: "TableSelection";
  outputType: "ColumnSelection";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

export interface GroupByColumnsNodeData extends NodeData {
  selectedColumn1: string;
  selectedColumn2: string;
  inputType: "TableSelection";
  outputType: "GroupedText";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
  onlyForMultiple?: boolean;
}

export interface FilterRow {
  column: string;
  value: string;
  not: boolean;
  operator: "AND" | "OR";
}

export interface FilterNodeData extends NodeData {
  filters: FilterRow[];
  inputType: "TableSelection";
  outputType: "TableSelection";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

export interface ReferenceTableLookupNodeData extends NodeData {
  selectedReferenceTable: string;
  inputType: "TableSelection";
  outputType: "TableSelection";
  referenceTableNames: string[];
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
  includeBaseGame?: boolean;
}

export interface ReverseReferenceLookupNodeData extends NodeData {
  selectedReverseTable: string;
  inputType: "TableSelection";
  outputType: "TableSelection";
  reverseTableNames: string[];
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
  includeBaseGame?: boolean;
}

export interface IndexTableNodeData extends NodeData {
  indexColumns: string[];
  inputType: "TableSelection";
  outputType: "IndexedTable";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

export interface LookupNodeData extends NodeData {
  lookupColumn: string;
  indexJoinColumn?: string;
  indexColumns?: string[];
  joinType: "inner" | "left" | "anti" | "nested" | "cross";
  inputType: "TableSelection";
  indexedInputType: "IndexedTable" | "TableSelection";
  outputType: "TableSelection" | "NestedTableSelection";
  columnNames: string[]; // Source table columns
  sourceInputColumns?: string[];
  connectedTableName?: string; // Source table name
  indexedTableColumns?: string[]; // Indexed table columns
  indexedTableColumnNames?: string[];
  indexedTableName?: string; // Indexed table name
  connectedIndexTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
  inputCount: 2;
}

export interface FlattenNestedNodeData extends NodeData {
  inputType: "NestedTableSelection";
  outputType: "TableSelection";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

export interface ExtractTableNodeData extends NodeData {
  tablePrefix: string;
  inputType: "TableSelection";
  outputType: "TableSelection";
  tablePrefixes: string[];
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

export interface AggregateNestedNodeData extends NodeData {
  aggregateColumn: string;
  aggregateType: "min" | "max" | "sum" | "avg" | "count";
  inputType: "NestedTableSelection";
  outputType: "NestedTableSelection";
  columnNames: string[]; // Indexed/nested table columns
  connectedTableName?: string; // Indexed/nested table name
  sourceTableColumns?: string[]; // Source table columns (from the outer row)
  sourceTableName?: string; // Source table name
  DBNameToDBVersions: Record<string, DBVersion[]>;
  filterColumn?: string;
  filterOperator?:
    | "equals"
    | "notEquals"
    | "greaterThan"
    | "lessThan"
    | "greaterThanOrEqual"
    | "lessThanOrEqual";
  filterValue?: string;
}

export interface ColumnTransformation {
  id: string; // Unique ID for React key
  sourceColumn: string;
  transformationType:
    | "none"
    | "prefix"
    | "suffix"
    | "add"
    | "subtract"
    | "multiply"
    | "divide"
    | "counter"
    | "counter_range"
    | "filterequal"
    | "filternotequal";
  prefix?: string;
  suffix?: string;
  numericValue?: number;
  startNumber?: number; // For counter transformation
  endNumber?: string; // For counter_range (string to support flow options)
  rangeStart?: string; // For counter_range (string to support flow options)
  rangeIncrement?: string; // For counter_range (string to support flow options)
  filterValue?: string; // For filter transformations
  outputColumnName: string;
  targetTableHandleId: string; // Which output table this transformation is for
}

export interface OutputTableConfig {
  handleId: string; // e.g., "output-table1"
  name: string; // Display name
  existingTableName: string; // Table schema to use
  tableVersion?: number; // Explicit version override; falls back to defaultTableVersions then versions[0]
  columnMapping: string[]; // Which transformation outputs go here
  staticValues?: Record<string, string>; // Static values for columns not in transformations
}

export interface GenerateRowsNodeData extends NodeData {
  sourceColumns: string[];
  transformations: ColumnTransformation[];
  outputTables: OutputTableConfig[];
  inputType: "TableSelection" | "CustomSchema";
  outputType: "TableSelection";
  outputCount: number; // 1-4
  columnNames: string[];
  inputColumnNames?: string[];
  connectedTableName?: string;
  customSchemaColumns?: string[];
  customSchemaData?: CustomSchemaColumnWithId[] | null;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

export interface AddColumnTransformation {
  id: string;
  sourceColumn: string;
  transformationType:
    | "none"
    | "prefix"
    | "suffix"
    | "add"
    | "subtract"
    | "multiply"
    | "divide"
    | "rename_whole"
    | "rename_substring"
    | "replace_substring_whole"
    | "regex_replace"
    | "filterequal"
    | "filternotequal";
  prefix?: string;
  suffix?: string;
  numericValue?: number;
  filterValue?: string;
  matchValue?: string; // For rename_whole
  replaceValue?: string; // For rename types and replace_substring_whole
  findSubstring?: string; // For rename_substring and replace_substring_whole
  regexPattern?: string; // For regex_replace
  regexReplacement?: string; // For regex_replace
  outputColumnName: string;
}

export interface AddNewColumnNodeData extends NodeData {
  transformations: AddColumnTransformation[];
  inputType: "TableSelection";
  outputType: "TableSelection";
  columnNames: string[];
  inputColumnNames?: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

export interface GetCounterColumnNodeData extends NodeData {
  selectedTable: string;
  selectedColumn: string;
  newColumnName: string;
  inputType: "PackFiles";
  outputType: "TableSelection";
  tableNames: string[];
  columnNames: string[];
  inputColumnNames?: string[];
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

export interface DumpToTSVNodeData extends NodeData {
  filename: string;
  openInWindows: boolean;
  inputType: "TableSelection" | "ChangedColumnSelection";
}

export interface GroupByAggregation {
  sourceColumn: string;
  operation: "max" | "min" | "sum" | "avg" | "count" | "first" | "last";
  outputName: string;
  defaultValue?: string;
}

export interface GroupByNodeData extends NodeData {
  groupByColumns: string[];
  aggregations: GroupByAggregation[];
  inputType: "TableSelection";
  outputType: "TableSelection";
  columnNames: string[];
  inputColumnNames?: string[];
}

export interface DeduplicateNodeData extends NodeData {
  dedupeByColumns: string[];
  dedupeAgainstVanilla: boolean;
  inputType: "TableSelection";
  outputType: "TableSelection";
  columnNames: string[];
  inputColumnNames?: string[];
}

export interface CustomSchemaNodeData extends NodeData {
  schemaColumns: CustomSchemaColumnWithId[];
  outputType: "CustomSchema";
}

export interface ReadTSVFromPackNodeData extends NodeData {
  tsvFileName: string;
  tableName: string;
  schemaColumns: Array<{ name: string; type: SCHEMA_FIELD_TYPE }>;
  inputType: "CustomSchema";
  outputType: "TableSelection";
}

export interface CustomRowsInputNodeData extends NodeData {
  customRows: Array<Record<string, string>>;
  schemaColumns: Array<{ name: string; type: SCHEMA_FIELD_TYPE }>;
  tableName: string;
  inputType: "CustomSchema";
  outputType: "TableSelection";
}

export interface MultiFilterSplitValue {
  id: string;
  value: string;
  enabled: boolean;
}

export interface MultiFilterNodeData extends NodeData {
  selectedColumn: string;
  splitValues: MultiFilterSplitValue[];
  inputType: "TableSelection";
  outputType: "TableSelection";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

export interface ConditionalBranchNodeData extends NodeData {
  inputType: "TableSelection";
  outputType: "TableSelection";
  /** Id of the checkbox flow option that decides which branch runs. */
  selectedFlowOptionId: string;
  /**
   * Resolved from the option at prepare time, so the executor never needs the option list. Undefined
   * until then; treated as false.
   */
  flowOptionChecked?: boolean;
  columnNames: string[];
  connectedTableName?: string;
}

/** One hop of the deep clone plan: a table reached from its parent by a schema reference. */
export interface DeepCloneTreeNode {
  /** Table reached by this hop, e.g. "land_units_tables". Root node uses the input table. */
  table: string;
  /** Identity column of `table`; empty for keyless junction tables (nothing to rename). */
  keyColumn: string;
  /** Forward hops: the referencing column on the PARENT. Reverse hops: the referencing column on `table`. */
  linkColumn: string;
  /** "forward" follows the parent's is_reference; "reverse" finds rows pointing back at the parent. */
  direction: "forward" | "reverse";
  /** When false the reference is left pointing at the original row instead of being cloned. */
  selected: boolean;
  /** Overrides the node-level nameTemplate for this table only. */
  nameTemplate?: string;
  children: DeepCloneTreeNode[];
}

/** Forces a single column of a single cloned table to a literal value. */
export interface DeepCloneOverride {
  table: string;
  column: string;
  value: string;
}

/** One dimension of the variant product, e.g. "shield" with _shielded / _unshielded. */
export interface DeepCloneVariantAxis {
  id: string;
  name: string;
  values: Array<{
    id: string;
    suffix: string;
    overrides: DeepCloneOverride[];
  }>;
}

export interface DeepCloneNodeData extends NodeData {
  inputType: "TableSelection";
  outputType: "TableSelection";
  connectedTableName?: string;
  columnNames: string[];
  DBNameToDBVersions?: Record<string, DBVersion[]>;
  /** Root of the clone plan; root.table matches connectedTableName. */
  cloneTree?: DeepCloneTreeNode;
  /** Supports {original}, {selfOriginal} and {variant}. Defaults to "{original}{variant}". */
  nameTemplate: string;
  useModdersPrefix: boolean;
  /**
   * Captured from the author's settings and saved with the flow, so a game-start run on someone
   * else's machine produces the author's keys rather than that machine's prefix (usually empty).
   */
  moddersPrefix: string;
  variantAxes: DeepCloneVariantAxis[];
  columnOverrides: DeepCloneOverride[];
  generateLoc: boolean;
  /** Also clone every row that referenced a renamed key, re-pointed at the new key. */
  autoFollowReferences: boolean;
}
