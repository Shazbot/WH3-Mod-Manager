import React, { useCallback, useState, useRef, DragEvent, useEffect } from "react";
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
import { useAppSelector, useAppDispatch } from "../hooks";
import { DBVersion } from "../packFileTypes";
import { addToast } from "../appSlice";

// Serialization types
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
    columnNames?: string[];
    connectedTableName?: string;
    outputType?: string;
    inputType?: string;
    DBNameToDBVersions?: Record<string, DBVersion[]>;
    groupedTextSelection?: "Text" | "Text Lines";
    selectedReferenceTable?: string;
    referenceTableNames?: string[];
    selectedReverseTable?: string;
    reverseTableNames?: string[];
    indexColumns?: string[];
    lookupColumn?: string;
    joinType?: "inner" | "left" | "nested";
    tablePrefix?: string;
    tablePrefixes?: string[];
    aggregateColumn?: string;
    aggregateType?: "min" | "max" | "sum" | "avg" | "count";
    transformations?: Array<{
      id: string;
      sourceColumn: string;
      transformationType: "none" | "prefix" | "suffix" | "add" | "subtract" | "multiply" | "divide";
      prefix?: string;
      suffix?: string;
      numericValue?: number;
      outputColumnName: string;
    }>;
    outputTables?: Array<{
      handleId: string;
      name: string;
      existingTableName: string;
      columnMapping: string[];
      staticValues?: Record<string, string>;
    }>;
    outputCount?: number;
  };
}

export interface SerializedConnection {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType?: NodeEdgeTypes;
  targetType?: NodeEdgeTypes;
  sourceHandle?: string | null; // Handle ID for multi-output nodes (e.g., "match", "else")
  targetHandle?: string | null; // Handle ID for multi-input nodes
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
  useCurrentPack?: boolean;
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

interface MathMaxNodeData extends NodeData {
  textValue: string;
  inputType: "ChangedColumnSelection";
  outputType: "ChangedColumnSelection";
}

interface MathCeilNodeData extends NodeData {
  inputType: "ChangedColumnSelection";
  outputType: "ChangedColumnSelection";
}

interface MergeChangesNodeData extends NodeData {
  inputType: "ChangedColumnSelection";
  outputType: "ChangedColumnSelection";
  inputCount: number;
}

interface SaveChangesNodeData extends NodeData {
  textValue: string;
  packName: string;
  packedFileName: string;
  inputType: "ChangedColumnSelection" | "Text" | "TableSelection";
}

interface TextSurroundNodeData extends NodeData {
  textValue: string;
  inputType: "Text" | "Text Lines" | "GroupedText";
  outputType: "Text" | "Text Lines";
  groupedTextSelection?: "Text" | "Text Lines";
}

interface AppendTextNodeData extends NodeData {
  beforeText: string;
  afterText: string;
  inputType: "Text" | "Text Lines" | "GroupedText";
  outputType: "Text" | "Text Lines" | "GroupedText";
  groupedTextSelection?: "Text" | "Text Lines";
}

interface TextJoinNodeData extends NodeData {
  textValue: string;
  inputType: "Text Lines" | "GroupedText";
  outputType: "Text";
  groupedTextSelection?: "Text" | "Text Lines";
}

interface GroupedColumnsToTextNodeData extends NodeData {
  pattern: string;
  joinSeparator: string;
  inputType: "GroupedText";
  outputType: "Text";
}

interface PackFilesDropdownNodeData extends NodeData {
  selectedPack: string;
  outputType: "PackFiles";
  useCurrentPack?: boolean;
}

interface AllEnabledModsNodeData extends NodeData {
  outputType: "PackFiles";
  includeBaseGame?: boolean;
}

interface TableSelectionDropdownNodeData extends NodeData {
  selectedTable: string;
  inputType: "PackFiles";
  outputType: "TableSelection";
  tableNames: string[];
}

interface ColumnSelectionDropdownNodeData extends NodeData {
  selectedColumn: string;
  inputType: "TableSelection";
  outputType: "ColumnSelection";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

interface GroupByColumnsNodeData extends NodeData {
  selectedColumn1: string;
  selectedColumn2: string;
  inputType: "TableSelection";
  outputType: "GroupedText";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
  onlyForMultiple?: boolean;
}

interface FilterRow {
  column: string;
  value: string;
  not: boolean;
  operator: "AND" | "OR";
}

interface FilterNodeData extends NodeData {
  filters: FilterRow[];
  inputType: "TableSelection";
  outputType: "TableSelection";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

interface ReferenceTableLookupNodeData extends NodeData {
  selectedReferenceTable: string;
  inputType: "TableSelection";
  outputType: "TableSelection";
  referenceTableNames: string[];
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

interface ReverseReferenceLookupNodeData extends NodeData {
  selectedReverseTable: string;
  inputType: "TableSelection";
  outputType: "TableSelection";
  reverseTableNames: string[];
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

interface IndexTableNodeData extends NodeData {
  indexColumns: string[];
  inputType: "TableSelection";
  outputType: "IndexedTable";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

interface LookupNodeData extends NodeData {
  lookupColumn: string;
  joinType: "inner" | "left" | "nested";
  inputType: "TableSelection";
  indexedInputType: "IndexedTable";
  outputType: "TableSelection" | "NestedTableSelection";
  columnNames: string[]; // Source table columns
  connectedTableName?: string; // Source table name
  indexedTableColumns?: string[]; // Indexed table columns
  indexedTableName?: string; // Indexed table name
  DBNameToDBVersions: Record<string, DBVersion[]>;
  inputCount: 2;
}

interface FlattenNestedNodeData extends NodeData {
  inputType: "NestedTableSelection";
  outputType: "TableSelection";
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

interface ExtractTableNodeData extends NodeData {
  tablePrefix: string;
  inputType: "TableSelection";
  outputType: "TableSelection";
  tablePrefixes: string[];
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

interface AggregateNestedNodeData extends NodeData {
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
  filterOperator?: "equals" | "notEquals" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual";
  filterValue?: string;
}

interface ColumnTransformation {
  id: string; // Unique ID for React key
  sourceColumn: string;
  transformationType: "none" | "prefix" | "suffix" | "add" | "subtract" | "multiply" | "divide";
  prefix?: string;
  suffix?: string;
  numericValue?: number;
  outputColumnName: string;
}

interface OutputTableConfig {
  handleId: string; // e.g., "output-table1"
  name: string; // Display name
  existingTableName: string; // Table schema to use
  columnMapping: string[]; // Which transformation outputs go here
  staticValues?: Record<string, string>; // Static values for columns not in transformations
}

interface GenerateRowsNodeData extends NodeData {
  sourceColumns: string[];
  transformations: ColumnTransformation[];
  outputTables: OutputTableConfig[];
  inputType: "TableSelection";
  outputType: "TableSelection";
  outputCount: number; // 1-4
  columnNames: string[];
  connectedTableName?: string;
  DBNameToDBVersions: Record<string, DBVersion[]>;
}

interface DraggableNodeData {
  type: string;
  label: string;
  description: string;
}

// Flow options interfaces
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

// Custom PackFiles dropdown node component
const PackFilesDropdownNode: React.FC<{ data: PackFilesDropdownNodeData; id: string }> = ({ data, id }) => {
  const allMods = useAppSelector((state) => state.app.currentPreset.mods).toSorted((firstMod, secondMod) => {
    return firstMod.name.localeCompare(secondMod.name);
  });
  const [selectedPack, setSelectedPack] = useState(data.selectedPack || "");
  const [useCurrentPack, setUseCurrentPack] = useState(data.useCurrentPack || false);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedPack(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, selectedPack: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setUseCurrentPack(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, useCurrentPack: newValue },
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
        className="w-full max-w-md p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-cyan-400"
      >
        <option value="">Select a pack...</option>
        {allMods.map((mod) => (
          <option key={mod.name} value={mod.name}>
            {mod.humanName || mod.name}
          </option>
        ))}
      </select>

      <div className="mt-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useCurrentPack}
            onChange={handleCheckboxChange}
            className="w-4 h-4"
          />
          <span className="text-xs text-gray-300">When inside pack use that pack</span>
        </label>
      </div>

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

// Custom AllEnabledMods node component
const AllEnabledModsNode: React.FC<{ data: AllEnabledModsNodeData; id: string }> = ({ data, id }) => {
  const [includeBaseGame, setIncludeBaseGame] = React.useState(data.includeBaseGame !== false);

  const handleCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setIncludeBaseGame(newValue);

    // Update the node data
    const updatedData = { ...data, includeBaseGame: newValue };
    const event_custom = new CustomEvent("nodeDataChanged", {
      detail: { nodeId: id, data: updatedData },
    });
    window.dispatchEvent(event_custom);
  };

  return (
    <div className="bg-gray-700 border-2 border-green-500 rounded-lg p-4 min-w-[250px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-green-500" />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-300 mb-2 p-2 bg-gray-800 rounded border border-green-600">
        This node will use all currently enabled mods
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          id={`includeBaseGame-${id}`}
          checked={includeBaseGame}
          onChange={handleCheckboxChange}
          className="w-4 h-4 cursor-pointer"
        />
        <label htmlFor={`includeBaseGame-${id}`} className="text-xs text-gray-300 cursor-pointer">
          Include Base Game
        </label>
      </div>

      <div className="mt-2 text-xs text-gray-400">Output: PackFiles (All Enabled Mods)</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-green-500"
        data-output-type="PackFiles"
      />
    </div>
  );
};

// Custom TableSelection dropdown node component
const TableSelectionDropdownNode: React.FC<{ data: TableSelectionDropdownNodeData; id: string }> = ({
  data,
  id,
}) => {
  // console.log("tableNames:", data.tableNames);
  const tableNames = data.tableNames || [];
  const [selectedTable, setSelectedTable] = useState(data.selectedTable || "");

  console.log("data.selectedTable is", data.selectedTable, "selectedTable is", selectedTable);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedTable(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, selectedTable: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-orange-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-blue-500"
        data-input-type="PackFiles"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: PackFiles</div>

      <select
        value={selectedTable}
        onChange={handleDropdownChange}
        className="w-full max-w-md p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-orange-400"
      >
        <option value="">Select a table...</option>
        {(tableNames.length > 0 &&
          tableNames.map((tableName) => (
            <option key={tableName} value={tableName}>
              {tableName}
            </option>
          ))) || (
          <option key={selectedTable} value={selectedTable}>
            {selectedTable}
          </option>
        )}
      </select>

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

// Custom PackFiles node component with built-in textbox
const PackFilesNode: React.FC<{ data: PackFilesNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || "");
  const [useCurrentPack, setUseCurrentPack] = useState(data.useCurrentPack || false);

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, textValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setUseCurrentPack(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, useCurrentPack: newValue },
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

      <div className="mt-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useCurrentPack}
            onChange={handleCheckboxChange}
            className="w-4 h-4"
          />
          <span className="text-xs text-gray-300">When inside pack use that pack</span>
        </label>
      </div>

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

// Custom ColumnSelection dropdown node component
const ColumnSelectionDropdownNode: React.FC<{ data: ColumnSelectionDropdownNodeData; id: string }> = ({
  data,
  id,
}) => {
  const [selectedColumn, setSelectedColumn] = useState(data.selectedColumn || "");
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);

  // Sync selectedColumn state with data prop when it changes (e.g., when loading from file)
  React.useEffect(() => {
    if (data.selectedColumn !== undefined && data.selectedColumn !== selectedColumn) {
      setSelectedColumn(data.selectedColumn);
    }
  }, [data.selectedColumn]);

  // Sync columnNames state with data prop when it changes
  React.useEffect(() => {
    if (data.columnNames && data.columnNames.length > 0) {
      setColumnNames(data.columnNames);
    }
  }, [data.columnNames]);

  // Update column names when connected table changes
  React.useEffect(() => {
    console.log(
      `ColumnSelectionDropdownNode ${id}: useEffect triggered, connectedTableName=${
        data.connectedTableName
      }, has DBNameToDBVersions=${!!data.DBNameToDBVersions}`
    );

    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      console.log(
        `ColumnSelectionDropdownNode ${id}: Found ${tableVersions?.length || 0} version(s) for table ${
          data.connectedTableName
        }`
      );

      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        console.log(`ColumnSelectionDropdownNode ${id}: Setting ${fieldNames.length} column names`);
        setColumnNames(fieldNames);

        // Update the node data with new column names
        const updateEvent = new CustomEvent("nodeDataUpdate", {
          detail: { nodeId: id, columnNames: fieldNames },
        });
        window.dispatchEvent(updateEvent);
      }
    } else {
      console.log(`ColumnSelectionDropdownNode ${id}: Missing connectedTableName or DBNameToDBVersions`);
    }
  }, [data.connectedTableName, id]);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedColumn(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, selectedColumn: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-teal-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: TableSelection</div>

      <select
        value={selectedColumn}
        onChange={handleDropdownChange}
        className="w-full max-w-sm p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-teal-400"
      >
        <option value="">Select a column...</option>
        {columnNames.map((columnName) => (
          <option key={columnName} value={columnName}>
            {columnName}
          </option>
        ))}
      </select>

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

// Custom GroupByColumns node component
const GroupByColumnsNode: React.FC<{ data: GroupByColumnsNodeData; id: string }> = ({ data, id }) => {
  const [selectedColumn1, setSelectedColumn1] = useState(data.selectedColumn1 || "");
  const [selectedColumn2, setSelectedColumn2] = useState(data.selectedColumn2 || "");
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);
  const [onlyForMultiple, setOnlyForMultiple] = useState(data.onlyForMultiple || false);

  // Update column names when connected table changes
  React.useEffect(() => {
    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        // Update the node data with new column names
        const updateEvent = new CustomEvent("nodeDataUpdate", {
          detail: { nodeId: id, columnNames: fieldNames },
        });
        window.dispatchEvent(updateEvent);
      }
    }
  }, [data.connectedTableName, id]);

  const handleDropdown1Change = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedColumn1(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, selectedColumn1: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleDropdown2Change = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedColumn2(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, selectedColumn2: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleOnlyForMultipleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setOnlyForMultiple(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, onlyForMultiple: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-fuchsia-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: TableSelection</div>

      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-300 block mb-1">Column 1</label>
          <select
            value={selectedColumn1}
            onChange={handleDropdown1Change}
            className="w-full max-w-sm p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-fuchsia-400"
          >
            <option value="">Select a column...</option>
            {columnNames.map((columnName) => (
              <option key={columnName} value={columnName}>
                {columnName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-300 block mb-1">Column 2</label>
          <select
            value={selectedColumn2}
            onChange={handleDropdown2Change}
            className="w-full max-w-sm p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-fuchsia-400"
          >
            <option value="">Select a column...</option>
            {columnNames.map((columnName) => (
              <option key={columnName} value={columnName}>
                {columnName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label className="flex items-center text-xs text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyForMultiple}
            onChange={handleOnlyForMultipleChange}
            className="mr-2"
          />
          Only For Multiple
        </label>
      </div>

      <div className="mt-2 text-xs text-gray-400">Output: GroupedText</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-fuchsia-500"
        data-output-type="GroupedText"
      />
    </div>
  );
};

// Custom Filter node component that accepts TableSelection input and outputs filtered TableSelection
const FilterNode: React.FC<{ data: FilterNodeData; id: string }> = ({ data, id }) => {
  const [filters, setFilters] = useState<FilterRow[]>(
    data.filters && data.filters.length > 0
      ? data.filters
      : [{ column: "", value: "", not: false, operator: "AND" }]
  );
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);

  // Update column names when connected table changes
  React.useEffect(() => {
    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        // Update the node data with new column names
        const updateEvent = new CustomEvent("nodeDataUpdate", {
          detail: { nodeId: id, columnNames: fieldNames },
        });
        window.dispatchEvent(updateEvent);
      }
    }
  }, [data.connectedTableName, id]);

  const updateFilters = (newFilters: FilterRow[]) => {
    setFilters(newFilters);
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, filters: newFilters },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleAddFilter = () => {
    updateFilters([...filters, { column: "", value: "", not: false, operator: "AND" }]);
  };

  const handleRemoveFilter = (index: number) => {
    const newFilters = filters.filter((_, i) => i !== index);
    updateFilters(
      newFilters.length > 0 ? newFilters : [{ column: "", value: "", not: false, operator: "AND" }]
    );
  };

  const handleFilterChange = (index: number, field: keyof FilterRow, value: any) => {
    const newFilters = [...filters];
    newFilters[index] = { ...newFilters[index], [field]: value };
    updateFilters(newFilters);
  };

  return (
    <div className="bg-gray-700 border-2 border-yellow-500 rounded-lg p-4 min-w-[300px] max-w-[400px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">Input: TableSelection</div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filters.map((filter, index) => (
          <div key={index} className="bg-gray-800 p-2 rounded border border-gray-600">
            <div className="flex items-center gap-2 mb-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filter.not}
                  onChange={(e) => handleFilterChange(index, "not", e.target.checked)}
                  className="w-3 h-3"
                />
                <span className="text-xs text-gray-300">NOT</span>
              </label>
              {filters.length > 1 && (
                <button
                  onClick={() => handleRemoveFilter(index)}
                  className="ml-auto text-red-400 hover:text-red-300 text-xs"
                >
                  Remove
                </button>
              )}
            </div>

            <select
              value={filter.column}
              onChange={(e) => handleFilterChange(index, "column", e.target.value)}
              className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded mb-1 focus:outline-none focus:border-yellow-400"
            >
              <option value="">Select column...</option>
              {columnNames.map((columnName) => (
                <option key={columnName} value={columnName}>
                  {columnName}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={filter.value}
              onChange={(e) => handleFilterChange(index, "value", e.target.value)}
              placeholder="Filter value..."
              className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded mb-1 focus:outline-none focus:border-yellow-400"
            />

            {index < filters.length - 1 && (
              <select
                value={filter.operator}
                onChange={(e) => handleFilterChange(index, "operator", e.target.value as "AND" | "OR")}
                className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-yellow-400"
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handleAddFilter}
        className="mt-2 w-full px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded"
      >
        Add Filter
      </button>

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400">Match:</div>
          <Handle
            type="source"
            position={Position.Right}
            id="match"
            className="w-3 h-3 bg-green-500"
            data-output-type="TableSelection"
            style={{ position: "relative", right: -8, top: 0, transform: "none" }}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400">Else:</div>
          <Handle
            type="source"
            position={Position.Right}
            id="else"
            className="w-3 h-3 bg-red-500"
            data-output-type="TableSelection"
            style={{ position: "relative", right: -8, top: 0, transform: "none" }}
          />
        </div>
      </div>
    </div>
  );
};

// Custom Reference Lookup node component that accepts TableSelection input and outputs filtered TableSelection
const ReferenceTableLookupNode: React.FC<{ data: ReferenceTableLookupNodeData; id: string }> = ({
  data,
  id,
}) => {
  const [selectedReferenceTable, setSelectedReferenceTable] = useState(data.selectedReferenceTable || "");
  const [referenceTableNames, setReferenceTableNames] = useState<string[]>(data.referenceTableNames || []);
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);

  // Update reference table names when connected table changes
  React.useEffect(() => {
    console.log(
      `ReferenceTableLookupNode ${id}: useEffect triggered, connectedTableName=${
        data.connectedTableName
      }, has DBNameToDBVersions=${!!data.DBNameToDBVersions}`
    );

    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      console.log(
        `ReferenceTableLookupNode ${id}: Found ${tableVersions?.length || 0} version(s) for table ${
          data.connectedTableName
        }`
      );

      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        // Find all reference columns (columns that reference other tables)
        const referenceTables = new Set<string>();
        for (const field of tableFields) {
          // Check if this field references another table
          // is_reference is an array where [0] is the referenced table name
          if (field.is_reference && field.is_reference.length > 0 && field.is_reference[0]) {
            referenceTables.add(field.is_reference[0]);
          }
        }

        const refTableArray = Array.from(referenceTables).sort();
        console.log(
          `ReferenceTableLookupNode ${id}: Found ${refTableArray.length} reference table(s):`,
          refTableArray
        );
        setReferenceTableNames(refTableArray);

        // Update the node data with reference table names and column names
        const updateEvent = new CustomEvent("nodeDataUpdate", {
          detail: {
            nodeId: id,
            referenceTableNames: refTableArray,
            columnNames: fieldNames,
          },
        });
        window.dispatchEvent(updateEvent);
      }
    } else {
      console.log(`ReferenceTableLookupNode ${id}: Missing connectedTableName or DBNameToDBVersions`);
    }
  }, [data.connectedTableName, id]);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedReferenceTable(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, selectedReferenceTable: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-purple-500 rounded-lg p-4 min-w-[250px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">Input: TableSelection</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Referenced Table</label>
        <select
          value={selectedReferenceTable}
          onChange={handleDropdownChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
        >
          <option value="">Select referenced table...</option>
          {referenceTableNames.map((tableName) => (
            <option key={tableName} value={tableName}>
              {tableName}
            </option>
          ))}
        </select>
      </div>

      {referenceTableNames.length === 0 && data.connectedTableName && (
        <div className="text-xs text-yellow-300 mb-2 p-2 bg-gray-800 rounded">
          No reference columns found in the input table
        </div>
      )}

      <div className="mt-2 text-xs text-gray-400">Output: TableSelection (Referenced Rows)</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-purple-500"
        data-output-type="TableSelection"
      />
    </div>
  );
};

// Custom ReverseReferenceLookup node component - finds tables that reference the input table
const ReverseReferenceLookupNode: React.FC<{ data: ReverseReferenceLookupNodeData; id: string }> = ({
  data,
  id,
}) => {
  const [selectedReverseTable, setSelectedReverseTable] = useState(data.selectedReverseTable || "");
  const [reverseTableNames, setReverseTableNames] = useState<string[]>(data.reverseTableNames || []);
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);

  // Sync selectedReverseTable state with data prop when it changes (e.g., when loading from file)
  React.useEffect(() => {
    if (data.selectedReverseTable !== undefined && data.selectedReverseTable !== selectedReverseTable) {
      setSelectedReverseTable(data.selectedReverseTable);
    }
  }, [data.selectedReverseTable]);

  // Sync reverseTableNames state with data prop when it changes
  React.useEffect(() => {
    if (data.reverseTableNames && data.reverseTableNames.length > 0) {
      setReverseTableNames(data.reverseTableNames);
    }
  }, [data.reverseTableNames]);

  // Sync columnNames state with data prop when it changes
  React.useEffect(() => {
    if (data.columnNames && data.columnNames.length > 0) {
      setColumnNames(data.columnNames);
    }
  }, [data.columnNames]);

  // Update reverse table names when connected table changes
  React.useEffect(() => {
    console.log(
      `ReverseReferenceLookupNode ${id}: useEffect triggered, connectedTableName=${
        data.connectedTableName
      }, has DBNameToDBVersions=${!!data.DBNameToDBVersions}`
    );

    if (data.connectedTableName && data.DBNameToDBVersions) {
      const inputTableName = data.connectedTableName;
      console.log(`ReverseReferenceLookupNode ${id}: Looking for tables that reference ${inputTableName}`);

      // Find all tables that have fields referencing the input table
      const reverseTables = new Set<string>();
      for (const [tableName, tableVersions] of Object.entries(data.DBNameToDBVersions)) {
        if (tableVersions && tableVersions.length > 0) {
          const tableFields = tableVersions[0].fields || [];
          for (const field of tableFields) {
            // Check if this field references the input table
            if (field.is_reference && field.is_reference.length > 0 && field.is_reference[0] === inputTableName) {
              reverseTables.add(tableName);
              break; // Found at least one reference, no need to check more fields
            }
          }
        }
      }

      const reverseTableArray = Array.from(reverseTables).sort();
      console.log(
        `ReverseReferenceLookupNode ${id}: Found ${reverseTableArray.length} table(s) that reference ${inputTableName}:`,
        reverseTableArray
      );
      setReverseTableNames(reverseTableArray);

      // Set column names from the input table
      const tableVersions = data.DBNameToDBVersions[inputTableName];
      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        // Auto-select the reverse table if there's only one option and nothing is selected
        let autoSelectedTable = data.selectedReverseTable;
        if (!autoSelectedTable && reverseTableArray.length === 1) {
          autoSelectedTable = reverseTableArray[0];
          setSelectedReverseTable(autoSelectedTable);
          console.log(
            `ReverseReferenceLookupNode ${id}: Auto-selected only available table: ${autoSelectedTable}`
          );
        }

        // Update the node data with reverse table names and column names
        const updateEvent = new CustomEvent("nodeDataUpdate", {
          detail: {
            nodeId: id,
            reverseTableNames: reverseTableArray,
            columnNames: fieldNames,
            ...(autoSelectedTable && { selectedReverseTable: autoSelectedTable }),
          },
        });
        window.dispatchEvent(updateEvent);
      }
    } else {
      console.log(`ReverseReferenceLookupNode ${id}: Missing connectedTableName or DBNameToDBVersions`);
    }
  }, [data.connectedTableName, id]);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedReverseTable(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, selectedReverseTable: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-indigo-500 rounded-lg p-4 min-w-[250px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">Input: TableSelection</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Reverse to Table</label>
        <select
          value={selectedReverseTable}
          onChange={handleDropdownChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-indigo-400"
        >
          <option value="">Select table to reverse to...</option>
          {reverseTableNames.map((tableName) => (
            <option key={tableName} value={tableName}>
              {tableName}
            </option>
          ))}
        </select>
      </div>

      {reverseTableNames.length === 0 && data.connectedTableName && (
        <div className="text-xs text-yellow-300 mb-2 p-2 bg-gray-800 rounded">
          No tables reference the input table
        </div>
      )}

      <div className="mt-2 text-xs text-gray-400">Output: TableSelection (Referencing Rows)</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-indigo-500"
        data-output-type="TableSelection"
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

// Custom MathMax node component that accepts ChangedColumnSelection and outputs ChangedColumnSelection
const MathMaxNode: React.FC<{ data: MathMaxNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

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
        className="w-3 h-3 bg-cyan-500"
        data-input-type="ChangedColumnSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: ChangedColumnSelection</div>

      <div>
        <label className="text-xs text-gray-300 block mb-1">Lowest Value</label>
        <input
          type="text"
          value={textValue}
          onChange={handleTextChange}
          placeholder="Enter value (e.g., 100)..."
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
        />
      </div>

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

// Custom MathCeil node component that accepts ChangedColumnSelection and outputs ChangedColumnSelection
const MathCeilNode: React.FC<{ data: MathCeilNodeData; id: string }> = ({ data, id }) => {
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

      <div className="text-xs text-gray-300 italic">Applies Math.ceil() to all values</div>

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

// Custom MergeChanges node component that accepts multiple ChangedColumnSelection inputs
const MergeChangesNode: React.FC<{ data: MergeChangesNodeData; id: string }> = ({ data, id }) => {
  const inputCount = data.inputCount || 2;

  return (
    <div className="bg-gray-700 border-2 border-cyan-500 rounded-lg p-4 min-w-[200px]">
      {/* Multiple input handles */}
      {Array.from({ length: inputCount }).map((_, index) => (
        <Handle
          key={`input-${index}`}
          type="target"
          position={Position.Left}
          id={`input-${index}`}
          style={{ top: `${((index + 1) * 100) / (inputCount + 1)}%` }}
          className="w-3 h-3 bg-cyan-500"
          data-input-type="ChangedColumnSelection"
        />
      ))}

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">Input: {inputCount}x ChangedColumnSelection</div>

      <div className="text-xs text-gray-300 p-2 bg-gray-800 rounded">
        Merges multiple column changes into a single output
      </div>

      <div className="mt-2 text-xs text-gray-400">Output: ChangedColumnSelection (Combined)</div>

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
  const [packName, setPackName] = useState(data.packName || "");
  const [packedFileName, setPackedFileName] = useState(data.packedFileName || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, textValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handlePackNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setPackName(newValue);

    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, packName: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handlePackedFileNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setPackedFileName(newValue);

    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, packedFileName: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-green-500 rounded-lg p-4 min-w-[250px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-cyan-500"
        data-input-type={data.inputType}
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">
        Input: {data.inputType || "ChangedColumnSelection, Text, or TableSelection"}
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-300 block mb-1">Pack name (optional):</label>
          <input
            type="text"
            value={packName}
            onChange={handlePackNameChange}
            placeholder="Leave blank for auto-generated name"
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-green-400"
          />
        </div>

        <div>
          <label className="text-xs text-gray-300 block mb-1">Packed file name (optional):</label>
          <input
            type="text"
            value={packedFileName}
            onChange={handlePackedFileNameChange}
            placeholder="Leave blank for auto-generated name"
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-green-400"
          />
        </div>

        <div>
          <label className="text-xs text-gray-300 block mb-1">Additional config:</label>
          <textarea
            value={textValue}
            onChange={handleTextChange}
            placeholder="Enter additional save configuration..."
            className="w-full h-16 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-green-400"
          />
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">Final save operation</div>
    </div>
  );
};

// Custom TextSurround node component that accepts Text, Text Lines, or GroupedText input and outputs the same type
const TextSurroundNode: React.FC<{ data: TextSurroundNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || "");
  const [groupedTextSelection, setGroupedTextSelection] = useState<"Text" | "Text Lines">(
    data.groupedTextSelection || "Text"
  );

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, textValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleGroupedTextSelectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value as "Text" | "Text Lines";
    setGroupedTextSelection(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    // Also update the outputType to match the selection
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, groupedTextSelection: newValue, outputType: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const isGroupedTextInput = data.inputType === "GroupedText";

  return (
    <div className="bg-gray-700 border-2 border-rose-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-amber-500"
        data-input-type={data.inputType}
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">
        Input: {data.inputType || "Text, Text Lines, or GroupedText"}
      </div>

      {isGroupedTextInput && (
        <div className="mb-2">
          <label className="text-xs text-gray-300 block mb-1">Use from GroupedText:</label>
          <select
            value={groupedTextSelection}
            onChange={handleGroupedTextSelectionChange}
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-rose-400"
          >
            <option value="Text">Text</option>
            <option value="Text Lines">Text Lines</option>
          </select>
        </div>
      )}

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter surround text configuration..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-rose-400"
      />

      <div className="mt-2 text-xs text-gray-400">
        Output: {isGroupedTextInput ? "GroupedText" : data.outputType || "Text or Text Lines"}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-amber-500"
        data-output-type={data.outputType}
      />
    </div>
  );
};

// Custom AppendText node component that accepts Text, Text Lines, or GroupedText input and outputs the same type
const AppendTextNode: React.FC<{ data: AppendTextNodeData; id: string }> = ({ data, id }) => {
  const [beforeText, setBeforeText] = useState(data.beforeText || "");
  const [afterText, setAfterText] = useState(data.afterText || "");
  const [groupedTextSelection, setGroupedTextSelection] = useState<"Text" | "Text Lines">(
    data.groupedTextSelection || "Text"
  );

  const handleBeforeTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setBeforeText(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, beforeText: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleAfterTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setAfterText(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, afterText: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleGroupedTextSelectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value as "Text" | "Text Lines";
    setGroupedTextSelection(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, groupedTextSelection: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const isGroupedTextInput = data.inputType === "GroupedText";

  return (
    <div className="bg-gray-700 border-2 border-purple-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-amber-500"
        data-input-type={data.inputType}
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">
        Input: {data.inputType || "Text, Text Lines, or GroupedText"}
      </div>

      {isGroupedTextInput && (
        <div className="mb-2">
          <label className="text-xs text-gray-300 block mb-1">Use from GroupedText:</label>
          <select
            value={groupedTextSelection}
            onChange={handleGroupedTextSelectionChange}
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
          >
            <option value="Text">Text</option>
            <option value="Text Lines">Text Lines</option>
          </select>
        </div>
      )}

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Before Text:</label>
        <input
          type="text"
          value={beforeText}
          onChange={handleBeforeTextChange}
          placeholder="Text to add before..."
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
        />
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">After Text:</label>
        <input
          type="text"
          value={afterText}
          onChange={handleAfterTextChange}
          placeholder="Text to add after..."
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
        />
      </div>

      <div className="mt-2 text-xs text-gray-400">
        Output: {isGroupedTextInput ? "GroupedText" : data.outputType || "Text or Text Lines"}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-amber-500"
        data-output-type={data.outputType}
      />
    </div>
  );
};

// Custom TextJoin node component that accepts Text Lines or GroupedText input and outputs Text
const TextJoinNode: React.FC<{ data: TextJoinNodeData; id: string }> = ({ data, id }) => {
  const [textValue, setTextValue] = useState(data.textValue || "");
  const [groupedTextSelection, setGroupedTextSelection] = useState<"Text" | "Text Lines">(
    data.groupedTextSelection || "Text Lines"
  );

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, textValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleGroupedTextSelectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value as "Text" | "Text Lines";
    setGroupedTextSelection(newValue);

    // Update the node data by dispatching a custom event that the parent can listen to
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, groupedTextSelection: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const isGroupedTextInput = data.inputType === "GroupedText";

  return (
    <div className="bg-gray-700 border-2 border-sky-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-lime-500"
        data-input-type={data.inputType}
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: {data.inputType || "Text Lines or GroupedText"}</div>

      {isGroupedTextInput && (
        <div className="mb-2">
          <label className="text-xs text-gray-300 block mb-1">Use from GroupedText:</label>
          <select
            value={groupedTextSelection}
            onChange={handleGroupedTextSelectionChange}
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-sky-400"
          >
            <option value="Text">Text</option>
            <option value="Text Lines">Text Lines</option>
          </select>
        </div>
      )}

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Enter join configuration (separator, etc.)..."
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-sky-400"
      />

      <div className="mt-2 text-xs text-gray-400">Output: Text</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-violet-500"
        data-output-type="Text"
      />
    </div>
  );
};

// Custom GroupedColumnsToText node component that accepts GroupedText and outputs formatted Text
const GroupedColumnsToTextNode: React.FC<{ data: GroupedColumnsToTextNodeData; id: string }> = ({
  data,
  id,
}) => {
  const [pattern, setPattern] = useState(data.pattern || "{0}: {1}");
  const [joinSeparator, setJoinSeparator] = useState(data.joinSeparator || "\\n");

  const handlePatternChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setPattern(newValue);

    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, pattern: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleJoinSeparatorChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setJoinSeparator(newValue);

    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, joinSeparator: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-emerald-500 rounded-lg p-4 min-w-[250px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-fuchsia-500"
        data-input-type="GroupedText"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">Input: GroupedText</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          Pattern ({"{0}"} = key, {"{1}"} = values):
        </label>
        <textarea
          value={pattern}
          onChange={handlePatternChange}
          placeholder="{0}: {1}"
          className="w-full h-16 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-emerald-400"
        />
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Join separator (use \n for newline):</label>
        <input
          type="text"
          value={joinSeparator}
          onChange={handleJoinSeparatorChange}
          placeholder="\n"
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-emerald-400"
        />
      </div>

      <div className="mt-2 text-xs text-gray-400">Output: Text</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-violet-500"
        data-output-type="Text"
      />
    </div>
  );
};

// Index Table Node - Creates indexed version of a table by key column(s)
const IndexTableNode: React.FC<{ data: IndexTableNodeData; id: string }> = ({ data, id }) => {
  const [indexColumns, setIndexColumns] = useState<string[]>(data.indexColumns || []);
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);

  // Sync local state with prop changes
  React.useEffect(() => {
    if (data.indexColumns) {
      setIndexColumns(data.indexColumns);
    }
  }, [data.indexColumns]);

  // Update column names when connected table changes
  React.useEffect(() => {
    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        const updateEvent = new CustomEvent("nodeDataUpdate", {
          detail: { nodeId: id, columnNames: fieldNames },
        });
        window.dispatchEvent(updateEvent);

        // Auto-select key columns if no selection exists
        if (indexColumns.length === 0) {
          const keyColumns = tableFields.filter((field) => field.is_key).map((field) => field.name);
          if (keyColumns.length > 0) {
            setIndexColumns(keyColumns);
            const updateEvent2 = new CustomEvent("nodeDataUpdate", {
              detail: { nodeId: id, indexColumns: keyColumns },
            });
            window.dispatchEvent(updateEvent2);
          }
        }
      }
    }
  }, [data.connectedTableName, id]);

  const handleColumnToggle = (columnName: string) => {
    const newIndexColumns = indexColumns.includes(columnName)
      ? indexColumns.filter((col) => col !== columnName)
      : [...indexColumns, columnName];

    setIndexColumns(newIndexColumns);
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, indexColumns: newIndexColumns },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-purple-600 rounded-lg p-4 min-w-[250px] max-w-[300px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">Input: TableSelection</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Index Columns (select multiple):</label>
        <div className="max-h-40 overflow-y-auto bg-gray-800 border border-gray-600 rounded p-2">
          {columnNames.length === 0 ? (
            <div className="text-xs text-gray-500 italic">Connect a table to see columns</div>
          ) : (
            columnNames.map((columnName) => (
              <label key={columnName} className="flex items-center gap-2 cursor-pointer hover:bg-gray-700 p-1 rounded">
                <input
                  type="checkbox"
                  checked={indexColumns.includes(columnName)}
                  onChange={() => handleColumnToggle(columnName)}
                  className="w-3 h-3"
                />
                <span className="text-xs text-white">{columnName}</span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">Selected: {indexColumns.length} column(s)</div>
      <div className="mt-2 text-xs text-gray-400">Output: IndexedTable</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-purple-600"
        data-output-type="IndexedTable"
      />
    </div>
  );
};

// Lookup Node - Performs lookups/joins using indexed tables
const LookupNode: React.FC<{ data: LookupNodeData; id: string }> = ({ data, id }) => {
  const [lookupColumn, setLookupColumn] = useState(data.lookupColumn || "");
  const [joinType, setJoinType] = useState<"inner" | "left" | "nested">(data.joinType || "inner");
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);

  // Sync local state with prop changes
  React.useEffect(() => {
    if (data.lookupColumn !== undefined) setLookupColumn(data.lookupColumn);
    if (data.joinType !== undefined) setJoinType(data.joinType);
  }, [data.lookupColumn, data.joinType]);

  // Ensure outputType is synced with joinType on mount
  React.useEffect(() => {
    const expectedOutputType = joinType === "nested" ? "NestedTableSelection" : "TableSelection";
    if (data.outputType !== expectedOutputType) {
      const updateEvent = new CustomEvent("nodeDataUpdate", {
        detail: { nodeId: id, outputType: expectedOutputType },
      });
      window.dispatchEvent(updateEvent);
    }
  }, [joinType, data.outputType, id]);

  // Ensure inputType and indexedInputType are always correct (fixes connection issues after loading)
  React.useEffect(() => {
    const needsUpdate =
      data.inputType !== "TableSelection" ||
      data.indexedInputType !== "IndexedTable";

    if (needsUpdate) {
      const updateEvent = new CustomEvent("nodeDataUpdate", {
        detail: {
          nodeId: id,
          inputType: "TableSelection",
          indexedInputType: "IndexedTable"
        },
      });
      window.dispatchEvent(updateEvent);
    }
  }, [data.inputType, data.indexedInputType, id]);

  // Update column names when connected table changes
  React.useEffect(() => {
    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        const updateEvent = new CustomEvent("nodeDataUpdate", {
          detail: { nodeId: id, columnNames: fieldNames },
        });
        window.dispatchEvent(updateEvent);
      }
    }
  }, [data.connectedTableName, id]);

  const handleLookupColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setLookupColumn(newValue);
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, lookupColumn: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleJoinTypeChange = (newType: "inner" | "left" | "nested") => {
    setJoinType(newType);
    const newOutputType = newType === "nested" ? "NestedTableSelection" : "TableSelection";
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, joinType: newType, outputType: newOutputType },
    });
    window.dispatchEvent(updateEvent);
  };

  const outputType = joinType === "nested" ? "NestedTableSelection" : "TableSelection";

  return (
    <div className="bg-gray-700 border-2 border-cyan-500 rounded-lg p-4 min-w-[250px] max-w-[300px]">
      <Handle
        type="target"
        position={Position.Left}
        id="input-source"
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
        style={{ top: "30%", position: "absolute", left: -6 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="input-index"
        className="w-3 h-3 bg-purple-600"
        data-input-type="IndexedTable"
        style={{ top: "70%", position: "absolute", left: -6 }}
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">
        <div>Source: TableSelection</div>
        <div>Index: IndexedTable</div>
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Lookup Column:</label>
        <select
          value={lookupColumn}
          onChange={handleLookupColumnChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-cyan-400"
        >
          <option value="">Select column...</option>
          {columnNames.map((columnName) => (
            <option key={columnName} value={columnName}>
              {columnName}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Join Type:</label>
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={joinType === "inner"}
              onChange={() => handleJoinTypeChange("inner")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">Inner Join</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={joinType === "left"}
              onChange={() => handleJoinTypeChange("left")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">Left Join</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={joinType === "nested"}
              onChange={() => handleJoinTypeChange("nested")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">Nested (1-to-many)</span>
          </label>
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">Output: {outputType}</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-cyan-500"
        data-output-type={outputType}
      />
    </div>
  );
};

// Flatten Nested Node - Expands nested table selections into flat rows
const FlattenNestedNode: React.FC<{ data: FlattenNestedNodeData; id: string }> = ({ data, id }) => {
  return (
    <div className="bg-gray-700 border-2 border-gray-400 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-cyan-500"
        data-input-type="NestedTableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">Input: NestedTableSelection</div>

      <div className="text-xs text-gray-300 italic my-3">
        Expands nested arrays into separate flat rows
      </div>

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

// Extract Table Node - Filters columns by prefix and removes prefix
const ExtractTableNode: React.FC<{ data: ExtractTableNodeData; id: string }> = ({ data, id }) => {
  const [tablePrefix, setTablePrefix] = useState(data.tablePrefix || "");
  const [tablePrefixes, setTablePrefixes] = useState<string[]>(data.tablePrefixes || []);

  // Sync local state with prop changes
  React.useEffect(() => {
    if (data.tablePrefix !== undefined) setTablePrefix(data.tablePrefix);
    if (data.tablePrefixes !== undefined) setTablePrefixes(data.tablePrefixes);
  }, [data.tablePrefix, data.tablePrefixes]);

  // Auto-detect prefixes from connected table columns
  React.useEffect(() => {
    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const prefixSet = new Set<string>();

        for (const field of tableFields) {
          const underscoreIndex = field.name.indexOf('_');
          if (underscoreIndex > 0) {
            const prefix = field.name.substring(0, underscoreIndex + 1);
            prefixSet.add(prefix);
          }
        }

        const detectedPrefixes = Array.from(prefixSet);
        setTablePrefixes(detectedPrefixes);

        const updateEvent = new CustomEvent("nodeDataUpdate", {
          detail: { nodeId: id, tablePrefixes: detectedPrefixes },
        });
        window.dispatchEvent(updateEvent);
      }
    }
  }, [data.connectedTableName, id]);

  const handlePrefixChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setTablePrefix(newValue);
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, tablePrefix: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-blue-400 rounded-lg p-4 min-w-[250px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">Input: TableSelection</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Extract Table:</label>
        <select
          value={tablePrefix}
          onChange={handlePrefixChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-400"
        >
          <option value="">Select prefix...</option>
          {tablePrefixes.map((prefix) => (
            <option key={prefix} value={prefix}>
              {prefix}
            </option>
          ))}
        </select>
      </div>

      <div className="text-xs text-gray-300 italic my-2">
        Filters to columns with prefix and removes it
      </div>

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

// Aggregate Nested Node - Performs aggregations on nested arrays
const AggregateNestedNode: React.FC<{ data: AggregateNestedNodeData; id: string }> = ({ data, id }) => {
  const [aggregateColumn, setAggregateColumn] = useState(data.aggregateColumn || "");
  const [aggregateType, setAggregateType] = useState<"min" | "max" | "sum" | "avg" | "count">(
    data.aggregateType || "min"
  );
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);
  const [filterColumn, setFilterColumn] = useState(data.filterColumn || "");
  const [filterOperator, setFilterOperator] = useState<"equals" | "notEquals" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual">(
    data.filterOperator || "equals"
  );
  const [filterValue, setFilterValue] = useState(data.filterValue || "");

  // Sync local state with prop changes
  React.useEffect(() => {
    if (data.aggregateColumn !== undefined) setAggregateColumn(data.aggregateColumn);
    if (data.aggregateType !== undefined) setAggregateType(data.aggregateType);
  }, [data.aggregateColumn, data.aggregateType]);

  // Update column names when connected table changes
  React.useEffect(() => {
    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        const updateEvent = new CustomEvent("nodeDataUpdate", {
          detail: { nodeId: id, columnNames: fieldNames },
        });
        window.dispatchEvent(updateEvent);
      }
    }
  }, [data.connectedTableName, id]);

  const handleColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setAggregateColumn(newValue);
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, aggregateColumn: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleTypeChange = (newType: "min" | "max" | "sum" | "avg" | "count") => {
    setAggregateType(newType);
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, aggregateType: newType },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleFilterColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setFilterColumn(newValue);
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, filterColumn: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleFilterOperatorChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value as "equals" | "notEquals" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual";
    setFilterOperator(newValue);
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, filterOperator: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  const handleFilterValueChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setFilterValue(newValue);
    const updateEvent = new CustomEvent("nodeDataUpdate", {
      detail: { nodeId: id, filterValue: newValue },
    });
    window.dispatchEvent(updateEvent);
  };

  return (
    <div className="bg-gray-700 border-2 border-orange-500 rounded-lg p-4 min-w-[250px] max-w-[300px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-cyan-500"
        data-input-type="NestedTableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">Input: NestedTableSelection</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Aggregate Column:</label>
        <select
          value={aggregateColumn}
          onChange={handleColumnChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-orange-400"
        >
          <option value="">Select column...</option>
          {columnNames.map((columnName) => (
            <option key={columnName} value={columnName}>
              {columnName}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">Aggregation Type:</label>
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "min"}
              onChange={() => handleTypeChange("min")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">MIN (Keep Row)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "max"}
              onChange={() => handleTypeChange("max")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">MAX (Keep Row)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "sum"}
              onChange={() => handleTypeChange("sum")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">SUM</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "avg"}
              onChange={() => handleTypeChange("avg")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">AVG</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "count"}
              onChange={() => handleTypeChange("count")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">COUNT</span>
          </label>
        </div>
      </div>

      <div className="mb-2 border-t border-gray-600 pt-2">
        <label className="text-xs text-gray-300 block mb-1">Filter (Optional):</label>
        <select
          value={filterColumn}
          onChange={handleFilterColumnChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-orange-400 mb-2"
        >
          <option value="">No filter</option>
          {columnNames.map((columnName) => (
            <option key={columnName} value={columnName}>
              {columnName}
            </option>
          ))}
        </select>

        {filterColumn && (
          <>
            <select
              value={filterOperator}
              onChange={handleFilterOperatorChange}
              className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-orange-400 mb-2"
            >
              <option value="equals">=</option>
              <option value="notEquals">≠</option>
              <option value="greaterThan">&gt;</option>
              <option value="lessThan">&lt;</option>
              <option value="greaterThanOrEqual">≥</option>
              <option value="lessThanOrEqual">≤</option>
            </select>

            <input
              type="text"
              value={filterValue}
              onChange={handleFilterValueChange}
              placeholder="Filter value..."
              className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-orange-400"
            />
          </>
        )}
      </div>

      <div className="mt-2 text-xs text-gray-400">Output: NestedTableSelection</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-cyan-500"
        data-output-type="NestedTableSelection"
      />
    </div>
  );
};

const GenerateRowsNode: React.FC<{ data: GenerateRowsNodeData; id: string }> = ({ data, id }) => {
  const [transformations, setTransformations] = useState<ColumnTransformation[]>(
    data.transformations || []
  );
  const [outputTables, setOutputTables] = useState<OutputTableConfig[]>(data.outputTables || []);
  const [outputCount, setOutputCount] = useState<number>(data.outputCount || 2);
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);
  const [tableNames, setTableNames] = useState<string[]>([]);

  // Sync local state with prop changes
  React.useEffect(() => {
    console.log(`[GenerateRows ${id}] Syncing props to state:`, {
      propsTransformations: data.transformations?.length,
      propsOutputTables: data.outputTables?.length,
    });
    if (data.transformations !== undefined) setTransformations(data.transformations);
    if (data.outputTables !== undefined) setOutputTables(data.outputTables);
    if (data.outputCount !== undefined) setOutputCount(data.outputCount);
  }, [data.transformations, data.outputTables, data.outputCount, id]);

  // Extract column names from connected input
  React.useEffect(() => {
    // Use columnNames from data if already provided (from connection propagation)
    // Otherwise fall back to looking up schema from DBNameToDBVersions
    if (data.columnNames && data.columnNames.length > 0) {
      setColumnNames(data.columnNames);
    } else if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const tableFields = tableVersions[0].fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);
      }
    }

    // Extract all available table names from DBNameToDBVersions
    if (data.DBNameToDBVersions) {
      const names = Object.keys(data.DBNameToDBVersions);
      setTableNames(names);
    }
  }, [data.columnNames, data.connectedTableName, data.DBNameToDBVersions]);

  // Sync transformations to node data
  React.useEffect(() => {
    console.log(`[GenerateRows ${id}] Syncing transformations to node.data:`, transformations.length);
    window.dispatchEvent(
      new CustomEvent("nodeDataUpdate", {
        detail: { nodeId: id, transformations },
      })
    );
  }, [transformations, id]);

  // Sync outputTables to node data
  React.useEffect(() => {
    console.log(`[GenerateRows ${id}] Syncing outputTables to node.data:`, outputTables.length);
    window.dispatchEvent(
      new CustomEvent("nodeDataUpdate", {
        detail: { nodeId: id, outputTables, outputCount },
      })
    );
  }, [outputTables, outputCount, id]);

  const addTransformation = () => {
    const newTransformation: ColumnTransformation = {
      id: `trans_${Date.now()}`,
      sourceColumn: columnNames[0] || "",
      transformationType: "none",
      outputColumnName: `output_${transformations.length + 1}`,
    };
    setTransformations([...transformations, newTransformation]);
  };

  const removeTransformation = (transId: string) => {
    setTransformations(transformations.filter((t) => t.id !== transId));
  };

  const updateTransformation = (transId: string, updates: Partial<ColumnTransformation>) => {
    setTransformations(
      transformations.map((t) => (t.id === transId ? { ...t, ...updates } : t))
    );
  };

  const updateOutputCount = (count: number) => {
    setOutputCount(count);

    // Adjust outputTables array to match count
    const newOutputTables = [...outputTables];
    while (newOutputTables.length < count) {
      newOutputTables.push({
        handleId: `output-table${newOutputTables.length + 1}`,
        name: `Table ${newOutputTables.length + 1}`,
        existingTableName: tableNames[0] || "",
        columnMapping: [],
      });
    }
    while (newOutputTables.length > count) {
      newOutputTables.pop();
    }
    setOutputTables(newOutputTables);
  };

  const updateOutputTable = (index: number, updates: Partial<OutputTableConfig>) => {
    const newOutputTables = [...outputTables];
    newOutputTables[index] = { ...newOutputTables[index], ...updates };
    setOutputTables(newOutputTables);
  };

  const toggleColumnInMapping = (outputIndex: number, columnName: string) => {
    const currentMapping = outputTables[outputIndex]?.columnMapping || [];
    const newMapping = currentMapping.includes(columnName)
      ? currentMapping.filter((c) => c !== columnName)
      : [...currentMapping, columnName];

    updateOutputTable(outputIndex, { columnMapping: newMapping });
  };

  const updateStaticValue = (outputIndex: number, columnName: string, value: string) => {
    const currentStaticValues = outputTables[outputIndex]?.staticValues || {};
    const newStaticValues = { ...currentStaticValues, [columnName]: value };
    updateOutputTable(outputIndex, { staticValues: newStaticValues });
  };

  const getAvailableStaticColumns = (outputIndex: number): string[] => {
    const output = outputTables[outputIndex];
    if (!output?.existingTableName || !data.DBNameToDBVersions) return [];

    const versions = data.DBNameToDBVersions[output.existingTableName];
    if (!versions || versions.length === 0) return [];

    const schema = versions[0];
    const allColumns = schema.fields.map((f: any) => f.name);

    // Return columns that are NOT in columnMapping (transformed columns)
    return allColumns.filter((col: string) => !output.columnMapping.includes(col));
  };

  return (
    <div className="bg-gray-700 border-2 border-green-600 rounded-lg p-4 min-w-[300px] max-w-[400px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-sm font-bold text-white mb-3">Generate Rows</div>

      {/* Transformations Section */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-300">Transformations:</label>
          <button
            onClick={addTransformation}
            className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded"
          >
            + Add
          </button>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto">
          {transformations.map((trans) => (
            <div key={trans.id} className="bg-gray-800 p-2 rounded border border-gray-600">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">→ {trans.outputColumnName}</span>
                <button
                  onClick={() => removeTransformation(trans.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  ✕
                </button>
              </div>

              <select
                value={trans.sourceColumn}
                onChange={(e) => updateTransformation(trans.id, { sourceColumn: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
              >
                {columnNames.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>

              <select
                value={trans.transformationType}
                onChange={(e) =>
                  updateTransformation(trans.id, {
                    transformationType: e.target.value as "none" | "prefix" | "suffix" | "add" | "subtract" | "multiply" | "divide",
                  })
                }
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
              >
                <option value="none">None (pass through)</option>
                <option value="prefix">Add Prefix</option>
                <option value="suffix">Add Suffix</option>
                <option value="add">Add Number (+)</option>
                <option value="subtract">Subtract Number (-)</option>
                <option value="multiply">Multiply (*)</option>
                <option value="divide">Divide (/)</option>
              </select>

              {trans.transformationType === "prefix" && (
                <input
                  type="text"
                  placeholder="Prefix..."
                  value={trans.prefix || ""}
                  onChange={(e) => updateTransformation(trans.id, { prefix: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                />
              )}

              {trans.transformationType === "suffix" && (
                <input
                  type="text"
                  placeholder="Suffix..."
                  value={trans.suffix || ""}
                  onChange={(e) => updateTransformation(trans.id, { suffix: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                />
              )}

              {(trans.transformationType === "add" ||
                trans.transformationType === "subtract" ||
                trans.transformationType === "multiply" ||
                trans.transformationType === "divide") && (
                <input
                  type="number"
                  placeholder="Number value..."
                  value={trans.numericValue ?? ""}
                  onChange={(e) => updateTransformation(trans.id, { numericValue: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                />
              )}

              <input
                type="text"
                placeholder="Output column name..."
                value={trans.outputColumnName}
                onChange={(e) =>
                  updateTransformation(trans.id, { outputColumnName: e.target.value })
                }
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
              />
            </div>
          ))}

          {transformations.length === 0 && (
            <div className="text-xs text-gray-500 text-center py-2">No transformations yet</div>
          )}
        </div>
      </div>

      {/* Output Count */}
      <div className="mb-3">
        <label className="text-xs text-gray-300 block mb-1">Number of Outputs:</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((num) => (
            <label key={num} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={outputCount === num}
                onChange={() => updateOutputCount(num)}
                className="w-3 h-3"
              />
              <span className="text-xs text-white">{num}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Output Tables Configuration */}
      <div className="mb-3">
        <label className="text-xs text-gray-300 block mb-2">Output Tables:</label>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {outputTables.map((output, idx) => (
            <div key={output.handleId} className="bg-gray-800 p-2 rounded border border-gray-600">
              <div className="text-xs text-gray-400 mb-1">Output {idx + 1}</div>

              <select
                value={output.existingTableName}
                onChange={(e) =>
                  updateOutputTable(idx, { existingTableName: e.target.value })
                }
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
              >
                <option value="">Select table schema...</option>
                {tableNames.map((tableName) => (
                  <option key={tableName} value={tableName}>
                    {tableName}
                  </option>
                ))}
              </select>

              <div className="text-xs text-gray-400 mb-1">Transformed Columns:</div>
              <div className="max-h-24 overflow-y-auto bg-gray-700 border border-gray-600 rounded p-1 mb-2">
                {transformations.map((trans) => (
                  <label
                    key={trans.id}
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-600 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={output.columnMapping.includes(trans.outputColumnName)}
                      onChange={() => toggleColumnInMapping(idx, trans.outputColumnName)}
                      className="w-3 h-3"
                    />
                    <span className="text-xs text-white">{trans.outputColumnName}</span>
                  </label>
                ))}
                {transformations.length === 0 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    Add transformations first
                  </div>
                )}
              </div>

              <div className="text-xs text-gray-400 mb-1">Static Values (remaining columns):</div>
              <div className="max-h-32 overflow-y-auto bg-gray-700 border border-gray-600 rounded p-1">
                {getAvailableStaticColumns(idx).map((col) => (
                  <div key={col} className="flex items-center gap-1 mb-1">
                    <span className="text-xs text-white w-24 truncate" title={col}>{col}:</span>
                    <input
                      type="text"
                      placeholder="value"
                      value={output.staticValues?.[col] || ""}
                      onChange={(e) => updateStaticValue(idx, col, e.target.value)}
                      className="flex-1 bg-gray-600 border border-gray-500 text-white text-xs rounded px-1 py-0.5"
                    />
                  </div>
                ))}
                {getAvailableStaticColumns(idx).length === 0 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    All columns mapped
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">Outputs: {outputCount} TableSelections</div>

      {/* Output Handles */}
      {outputTables.map((output, idx) => (
        <Handle
          key={output.handleId}
          type="source"
          position={Position.Right}
          id={output.handleId}
          className="w-3 h-3 bg-green-500"
          data-output-type="TableSelection"
          style={{
            top: `${30 + (idx * 60) / (outputCount - 1 || 1)}%`,
            position: "absolute",
            right: -6,
          }}
        />
      ))}
    </div>
  );
};

// Flow Options Modal Component
const FlowOptionsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  options: FlowOption[];
  onOptionsChange: (options: FlowOption[]) => void;
  isGraphEnabled: boolean;
  onGraphEnabledChange: (enabled: boolean) => void;
  graphStartsEnabled: boolean;
  onGraphStartsEnabledChange: (enabled: boolean) => void;
}> = ({
  isOpen,
  onClose,
  options,
  onOptionsChange,
  isGraphEnabled,
  onGraphEnabledChange,
  graphStartsEnabled,
  onGraphStartsEnabledChange,
}) => {
  const dispatch = useAppDispatch();
  const [editingOption, setEditingOption] = useState<FlowOption | null>(null);
  const [isAddingOption, setIsAddingOption] = useState(false);
  const [newOptionType, setNewOptionType] = useState<"textbox" | "range" | "checkbox">("textbox");

  const [formData, setFormData] = useState({
    id: "",
    name: "",
    description: "",
    value: "",
    placeholder: "",
    min: 0,
    max: 100,
    step: 1,
    checked: false,
  });

  const resetForm = () => {
    setFormData({
      id: "",
      name: "",
      description: "",
      value: "",
      placeholder: "",
      min: 0,
      max: 100,
      step: 1,
      checked: false,
    });
    setEditingOption(null);
    setIsAddingOption(false);
  };

  const handleAddOption = () => {
    if (!formData.id.trim() || !formData.name.trim()) return;

    // Check for duplicate IDs
    if (options.some((opt) => opt.id === formData.id.trim())) {
      dispatch(
        addToast({
          type: "warning",
          messages: [`Option ID "${formData.id}" already exists. Please use a unique ID.`],
          startTime: Date.now(),
        })
      );
      return;
    }

    const newOption: FlowOption =
      newOptionType === "textbox"
        ? {
            id: formData.id.trim(),
            type: "textbox",
            name: formData.name,
            description: formData.description || undefined,
            value: formData.value,
            placeholder: formData.placeholder || undefined,
          }
        : newOptionType === "range"
        ? {
            id: formData.id.trim(),
            type: "range",
            name: formData.name,
            description: formData.description || undefined,
            value: Number(formData.value) || formData.min,
            min: formData.min,
            max: formData.max,
            step: formData.step,
          }
        : {
            id: formData.id.trim(),
            type: "checkbox",
            name: formData.name,
            description: formData.description || undefined,
            value: formData.checked,
          };

    onOptionsChange([...options, newOption]);
    resetForm();
  };

  const handleEditOption = (option: FlowOption) => {
    setEditingOption(option);
    setFormData({
      id: option.id,
      name: option.name,
      description: option.description || "",
      value:
        option.type === "textbox" ? option.value : option.type === "range" ? option.value.toString() : "",
      placeholder: option.type === "textbox" ? option.placeholder || "" : "",
      min: option.type === "range" ? option.min : 0,
      max: option.type === "range" ? option.max : 100,
      step: option.type === "range" ? option.step : 1,
      checked: option.type === "checkbox" ? option.value : false,
    });
    setNewOptionType(option.type);
  };

  const handleUpdateOption = () => {
    if (!editingOption || !formData.id.trim() || !formData.name.trim()) return;

    // Check for duplicate IDs (only if ID changed)
    if (formData.id.trim() !== editingOption.id) {
      if (options.some((opt) => opt.id === formData.id.trim())) {
        dispatch(
          addToast({
            type: "warning",
            messages: [`Option ID "${formData.id}" already exists. Please use a unique ID.`],
            startTime: Date.now(),
          })
        );
        return;
      }
    }

    const updatedOption: FlowOption =
      editingOption.type === "textbox"
        ? {
            ...editingOption,
            id: formData.id.trim(),
            name: formData.name,
            description: formData.description || undefined,
            value: formData.value,
            placeholder: formData.placeholder || undefined,
          }
        : editingOption.type === "range"
        ? {
            ...editingOption,
            id: formData.id.trim(),
            name: formData.name,
            description: formData.description || undefined,
            value: Number(formData.value) || editingOption.min,
            min: formData.min,
            max: formData.max,
            step: formData.step,
          }
        : {
            ...editingOption,
            id: formData.id.trim(),
            name: formData.name,
            description: formData.description || undefined,
            value: formData.checked,
          };

    onOptionsChange(options.map((opt) => (opt.id === editingOption.id ? updatedOption : opt)));
    resetForm();
  };

  const handleDeleteOption = (optionId: string) => {
    onOptionsChange(options.filter((opt) => opt.id !== optionId));
  };

  const handleOptionValueChange = (optionId: string, newValue: string | number | boolean) => {
    onOptionsChange(
      options.map((opt) => (opt.id === optionId ? ({ ...opt, value: newValue } as FlowOption) : opt))
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Flow Options</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">
            ×
          </button>
        </div>

        {/* Global Graph Toggle */}
        <div className="mb-6 p-4 bg-gray-700 rounded-lg border-2 border-indigo-500">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isGraphEnabled}
              onChange={(e) => onGraphEnabledChange(e.target.checked)}
              className="w-5 h-5"
            />
            <div>
              <span className="text-white font-semibold text-lg">User Can Disable Flow</span>
              <p className="text-gray-300 text-sm">
                If enabled the user options will have a checkbox that disables or enables the whole flow.
              </p>
            </div>
          </label>

          {/* Default state checkbox - only shown when global toggle is enabled */}
          {isGraphEnabled && (
            <div className="mt-3 ml-8 pl-4 border-l-2 border-indigo-400">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={graphStartsEnabled}
                  onChange={(e) => onGraphStartsEnabledChange(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-gray-300 text-sm">Flow starts enabled by default</span>
              </label>
            </div>
          )}
        </div>

        {/* Current Options */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3">Current Options</h3>
          {options.length === 0 ? (
            <p className="text-gray-400 text-sm">No options configured yet.</p>
          ) : (
            <div className="space-y-3">
              {options.map((option) => (
                <div key={option.id} className="bg-gray-700 rounded p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="text-white font-medium">{option.name}</h4>
                      <p className="text-blue-300 text-xs font-mono mt-1">{`{{${option.id}}}`}</p>
                      {option.description && (
                        <p className="text-gray-300 text-sm mt-1">{option.description}</p>
                      )}
                      <span className="inline-block bg-gray-600 text-xs px-2 py-1 rounded mt-1">
                        {option.type}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditOption(option)}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteOption(option.id)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Option Value Input */}
                  {option.type === "textbox" ? (
                    <input
                      type="text"
                      value={option.value}
                      onChange={(e) => handleOptionValueChange(option.id, e.target.value)}
                      placeholder={option.placeholder}
                      className="w-full p-2 bg-gray-600 text-white rounded text-sm"
                    />
                  ) : option.type === "range" ? (
                    <div>
                      <input
                        type="range"
                        min={option.min}
                        max={option.max}
                        step={option.step}
                        value={option.value}
                        onChange={(e) => handleOptionValueChange(option.id, Number(e.target.value))}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-gray-300 mt-1">
                        <span>{option.min}</span>
                        <span className="font-medium">{option.value}</span>
                        <span>{option.max}</span>
                      </div>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={option.value}
                        onChange={(e) => handleOptionValueChange(option.id, e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-gray-300">{option.value ? "Checked" : "Unchecked"}</span>
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add/Edit Option Form */}
        {(isAddingOption || editingOption) && (
          <div className="mb-6 bg-gray-700 rounded p-4">
            <h3 className="text-lg font-semibold text-white mb-3">
              {editingOption ? "Edit Option" : "Add New Option"}
            </h3>

            {!editingOption && (
              <div className="mb-4">
                <label className="block text-white text-sm font-medium mb-2">Option Type</label>
                <select
                  value={newOptionType}
                  onChange={(e) => setNewOptionType(e.target.value as "textbox" | "range" | "checkbox")}
                  className="w-full p-2 bg-gray-600 text-white rounded"
                >
                  <option value="textbox">Textbox</option>
                  <option value="range">Range Slider</option>
                  <option value="checkbox">Checkbox</option>
                </select>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-white text-sm font-medium mb-2">
                ID * <span className="text-gray-400 text-xs">(use in nodes as {`{{id}}`})</span>
              </label>
              <input
                type="text"
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                className="w-full p-2 bg-gray-600 text-white rounded"
                placeholder="e.g. damageMultiplier"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-white text-sm font-medium mb-2">Display Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-2 bg-gray-600 text-white rounded"
                  placeholder="Damage Multiplier"
                />
              </div>
              <div>
                <label className="block text-white text-sm font-medium mb-2">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full p-2 bg-gray-600 text-white rounded"
                  placeholder="Optional description"
                />
              </div>
            </div>

            {newOptionType === "textbox" ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-white text-sm font-medium mb-2">Default Value</label>
                  <input
                    type="text"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-white text-sm font-medium mb-2">Placeholder</label>
                  <input
                    type="text"
                    value={formData.placeholder}
                    onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
              </div>
            ) : newOptionType === "range" ? (
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-white text-sm font-medium mb-2">Min</label>
                  <input
                    type="number"
                    value={formData.min}
                    onChange={(e) => setFormData({ ...formData, min: Number(e.target.value) })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-white text-sm font-medium mb-2">Max</label>
                  <input
                    type="number"
                    value={formData.max}
                    onChange={(e) => setFormData({ ...formData, max: Number(e.target.value) })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-white text-sm font-medium mb-2">Step</label>
                  <input
                    type="number"
                    value={formData.step}
                    onChange={(e) => setFormData({ ...formData, step: Number(e.target.value) })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                    step="0.1"
                    min="0.1"
                  />
                </div>
                <div>
                  <label className="block text-white text-sm font-medium mb-2">Default</label>
                  <input
                    type="number"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.checked}
                    onChange={(e) => setFormData({ ...formData, checked: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-white text-sm font-medium">
                    Default: {formData.checked ? "Checked" : "Unchecked"}
                  </span>
                </label>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={editingOption ? handleUpdateOption : handleAddOption}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                {editingOption ? "Update" : "Add"} Option
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add Option Button */}
        {!isAddingOption && !editingOption && (
          <button
            onClick={() => setIsAddingOption(true)}
            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded font-medium"
          >
            Add New Option
          </button>
        )}
      </div>
    </div>
  );
};

interface NodeTypeSection {
  title: string;
  nodes: { type: FlowNodeType; label: string; description: string }[];
}

const nodeTypeSections: NodeTypeSection[] = [
  {
    title: "Pack Files",
    nodes: [
      {
        type: "packedfiles",
        label: "Pack Textbox Input",
        description: "Node with textbox that outputs PackFiles",
      },
      {
        type: "packfilesdropdown",
        label: "Pack Dropdown Input",
        description: "Node with dropdown for pack selection",
      },
      {
        type: "allenabledmods",
        label: "All Enabled Mods",
        description: "Outputs all currently enabled mods as PackFiles",
      },
    ],
  },
  {
    title: "Table Selection",
    nodes: [
      {
        type: "tableselection",
        label: "Table Textbox Input",
        description: "Accepts PackFiles input, outputs TableSelection",
      },
      {
        type: "tableselectiondropdown",
        label: "Table Dropdown Input",
        description: "Node with dropdown for table selection",
      },
      {
        type: "filter",
        label: "Filter",
        description: "Filter table rows with AND/OR conditions",
      },
      {
        type: "referencelookup",
        label: "Reference Lookup",
        description: "Lookup rows in referenced tables based on input table references",
      },
      {
        type: "reversereferencelookup",
        label: "Reverse Reference Lookup",
        description: "Find rows in tables that reference the input table",
      },
    ],
  },
  {
    title: "Column Selection",
    nodes: [
      {
        type: "columnselection",
        label: "Column Textbox Input",
        description: "Accepts TableSelection input, outputs ColumnSelection",
      },
      {
        type: "columnselectiondropdown",
        label: "Column Dropdown Input",
        description: "Node with dropdown for column selection",
      },
      {
        type: "groupbycolumns",
        label: "Group By Columns",
        description: "Accepts TableSelection, two column dropdowns, outputs GroupedText",
      },
    ],
  },
  {
    title: "Processing",
    nodes: [
      {
        type: "numericadjustment",
        label: "Numeric Adjustment",
        description: "Accepts ColumnSelection input, outputs ChangedColumnSelection",
      },
      {
        type: "mathmax",
        label: "Math Max",
        description: "Accepts ChangedColumnSelection, applies Math.max(value, input)",
      },
      {
        type: "mathceil",
        label: "Math Ceil",
        description: "Accepts ChangedColumnSelection, applies Math.ceil() to round up",
      },
      {
        type: "mergechanges",
        label: "Merge Changes",
        description: "Merges multiple ChangedColumnSelection inputs into one output",
      },
      {
        type: "savechanges",
        label: "Save Changes",
        description: "Accepts ChangedColumnSelection input and saves the changes",
      },
    ],
  },
  {
    title: "Text",
    nodes: [
      {
        type: "textsurround",
        label: "Text Surround",
        description: "Accepts Text or Text Lines, outputs same type with surrounding text",
      },
      {
        type: "appendtext",
        label: "Append Text",
        description: "Accepts Text, Text Lines, or GroupedText, adds text before and after",
      },
      {
        type: "textjoin",
        label: "Text Join",
        description: "Accepts Text Lines input, outputs joined Text",
      },
      {
        type: "groupedcolumnstotext",
        label: "Grouped Columns to Text",
        description: "Formats GroupedText using pattern and join separator",
      },
    ],
  },
  {
    title: "Table Operations",
    nodes: [
      {
        type: "indextable",
        label: "Index Table",
        description: "Creates indexed version of table by key column(s) for fast lookups",
      },
      {
        type: "lookup",
        label: "Lookup (Join)",
        description: "Performs lookups/joins using indexed tables (inner/left/nested)",
      },
      {
        type: "flattennested",
        label: "Flatten Nested",
        description: "Expands nested table selections into flat rows",
      },
      {
        type: "extracttable",
        label: "Extract Table",
        description: "Filters columns by prefix and removes prefix",
      },
      {
        type: "aggregatenested",
        label: "Aggregate Nested",
        description: "Performs aggregations (min/max/sum/avg/count) on nested arrays",
      },
      {
        type: "generaterows",
        label: "Generate Rows",
        description: "Creates new table rows with transformations and multiple outputs",
      },
    ],
  },
];

// Backend graph execution service
const executeGraphInBackend = async (
  nodes: Node[],
  edges: Edge[],
  currentPackName?: string,
  flowOptions?: FlowOption[]
): Promise<{
  success: boolean;
  executionResults: Map<string, NodeExecutionResult>;
  totalExecuted: number;
  successCount: number;
  failureCount: number;
  error?: string;
}> => {
  try {
    // Generate a unique flow execution ID for this run
    // All save changes nodes will use this to save to the same pack file
    const flowExecutionId = new Date().toISOString().slice(0, 19).replace(/:/g, "-").replace("T", "_");

    // Handle useCurrentPack flag - replace pack selection with current pack
    const processedNodes = nodes.map((node) => {
      let nodeData = { ...node.data };
      let modified = false;

      // Add flow execution ID to save changes nodes so they all save to the same pack
      if (node.type === "savechanges") {
        nodeData.flowExecutionId = flowExecutionId;
        modified = true;
      }

      // Handle useCurrentPack
      if (currentPackName && (node.data as any)?.useCurrentPack === true) {
        // For packfilesdropdown nodes, set selectedPack to current pack
        if (node.type === "packfilesdropdown") {
          nodeData.selectedPack = currentPackName;
          console.log(`Node ${node.id}: Using current pack "${currentPackName}" (useCurrentPack enabled)`);
          modified = true;
        }
        // For packedfiles nodes, set textValue to current pack
        else if (node.type === "packedfiles") {
          nodeData.textValue = currentPackName;
          console.log(`Node ${node.id}: Using current pack "${currentPackName}" (useCurrentPack enabled)`);
          modified = true;
        }
      }

      // Handle flow option replacements in all text fields
      if (flowOptions && flowOptions.length > 0) {
        // Fields that might contain option placeholders
        const textFields = [
          "textValue",
          "pattern",
          "beforeText",
          "afterText",
          "joinSeparator",
          "packName",
          "packedFileName",
        ];

        for (const fieldName of textFields) {
          const fieldValue = (nodeData as any)?.[fieldName];
          if (typeof fieldValue === "string" && fieldValue) {
            let modifiedValue = fieldValue;

            for (const option of flowOptions) {
              const placeholder = `{{${option.id}}}`;
              if (modifiedValue.includes(placeholder)) {
                modifiedValue = modifiedValue.replace(
                  new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
                  String(option.value)
                );
                console.log(
                  `Node ${node.id}: Replaced ${placeholder} with "${option.value}" in ${fieldName}`
                );
                modified = true;
              }
            }

            if (modifiedValue !== fieldValue) {
              (nodeData as any)[fieldName] = modifiedValue;
            }
          }
        }
      }

      return modified ? { ...node, data: nodeData } : node;
    });

    // Convert nodes and edges to serialized format for backend
    const serializedNodes = processedNodes.map((node) => {
      // Debug: Check generaterows node before serialization
      if (node.type === "generaterows") {
        console.log(`[SERIALIZE] GenerateRows node ${node.id} BEFORE serialization:`);
        console.log(`  transformationsLength: ${((node.data as any)?.transformations || []).length}`);
        console.log(`  transformations:`, JSON.stringify((node.data as any)?.transformations));
        console.log(`  outputTablesLength: ${((node.data as any)?.outputTables || []).length}`);
        console.log(`  outputTables:`, JSON.stringify((node.data as any)?.outputTables));
      }

      return {
      id: node.id,
      type: node.type || "default",
      data: {
        label: node.data?.label ? String(node.data.label) : "",
        type: node.data?.type ? String(node.data.type) : "",
        textValue: (node.data as any)?.textValue ? String((node.data as any).textValue) : "",
        selectedPack: (node.data as any)?.selectedPack ? String((node.data as any).selectedPack) : "",
        selectedTable: (node.data as any)?.selectedTable ? String((node.data as any).selectedTable) : "",
        selectedColumn: (node.data as any)?.selectedColumn ? String((node.data as any).selectedColumn) : "",
        selectedColumn1: (node.data as any)?.selectedColumn1
          ? String((node.data as any).selectedColumn1)
          : "",
        selectedColumn2: (node.data as any)?.selectedColumn2
          ? String((node.data as any).selectedColumn2)
          : "",
        selectedReferenceTable: (node.data as any)?.selectedReferenceTable
          ? String((node.data as any).selectedReferenceTable)
          : "",
        selectedReverseTable: (node.data as any)?.selectedReverseTable
          ? String((node.data as any).selectedReverseTable)
          : "",
        packName: (node.data as any)?.packName ? String((node.data as any).packName) : "",
        packedFileName: (node.data as any)?.packedFileName ? String((node.data as any).packedFileName) : "",
        pattern: (node.data as any)?.pattern ? String((node.data as any).pattern) : "",
        joinSeparator: (node.data as any)?.joinSeparator ? String((node.data as any).joinSeparator) : "",
        groupedTextSelection: (node.data as any)?.groupedTextSelection
          ? String((node.data as any).groupedTextSelection)
          : "",
        beforeText: (node.data as any)?.beforeText ? String((node.data as any).beforeText) : "",
        afterText: (node.data as any)?.afterText ? String((node.data as any).afterText) : "",
        includeBaseGame: (node.data as any)?.includeBaseGame,
        inputCount: (node.data as any)?.inputCount,
        flowExecutionId: (node.data as any)?.flowExecutionId
          ? String((node.data as any).flowExecutionId)
          : "",
        useCurrentPack: (node.data as any)?.useCurrentPack
          ? Boolean((node.data as any).useCurrentPack)
          : false,
        onlyForMultiple: (node.data as any)?.onlyForMultiple
          ? Boolean((node.data as any).onlyForMultiple)
          : false,
        filters: (node.data as any)?.filters || [],
        columnNames: (node.data as any)?.columnNames || [],
        connectedTableName: (node.data as any)?.connectedTableName
          ? String((node.data as any).connectedTableName)
          : "",
        outputType: (node.data as any)?.outputType,
        inputType: (node.data as any)?.inputType,
        indexColumns: (node.data as any)?.indexColumns || [],
        lookupColumn: (node.data as any)?.lookupColumn ? String((node.data as any).lookupColumn) : "",
        joinType: (node.data as any)?.joinType || "inner",
        tablePrefix: (node.data as any)?.tablePrefix ? String((node.data as any).tablePrefix) : "",
        tablePrefixes: (node.data as any)?.tablePrefixes || [],
        aggregateColumn: (node.data as any)?.aggregateColumn
          ? String((node.data as any).aggregateColumn)
          : "",
        aggregateType: (node.data as any)?.aggregateType || "min",
        filterColumn: (node.data as any)?.filterColumn ? String((node.data as any).filterColumn) : "",
        filterOperator: (node.data as any)?.filterOperator || "equals",
        filterValue: (node.data as any)?.filterValue ? String((node.data as any).filterValue) : "",
        transformations: (node.data as any)?.transformations || [],
        outputTables: (node.data as any)?.outputTables || [],
        outputCount: (node.data as any)?.outputCount,
        DBNameToDBVersions: (node.data as any)?.DBNameToDBVersions || {},
      },
    };
    });

    // Debug: Check what was serialized for generaterows nodes
    serializedNodes.forEach(sNode => {
      if (sNode.type === "generaterows") {
        console.log(`[SERIALIZE] GenerateRows node ${sNode.id} AFTER serialization:`);
        console.log(`  transformationsLength: ${(sNode.data.transformations || []).length}`);
        console.log(`  transformations:`, JSON.stringify(sNode.data.transformations));
        console.log(`  outputTablesLength: ${(sNode.data.outputTables || []).length}`);
        console.log(`  outputTables:`, JSON.stringify(sNode.data.outputTables));
      }
    });

    const serializedConnections = edges.map((edge) => ({
      id: edge.id || `${edge.source}-${edge.target}`,
      sourceId: edge.source || "",
      targetId: edge.target || "",
      sourceType: (nodes.find((n) => n.id === edge.source)?.data as any)?.outputType,
      targetType: (nodes.find((n) => n.id === edge.target)?.data as any)?.inputType,
      sourceHandle: edge.sourceHandle, // Include source handle ID for multi-output nodes
      targetHandle: edge.targetHandle, // Include target handle ID for multi-input nodes
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
  allenabledmods: AllEnabledModsNode,
  tableselection: TableSelectionNode,
  tableselectiondropdown: TableSelectionDropdownNode,
  columnselection: ColumnSelectionNode,
  columnselectiondropdown: ColumnSelectionDropdownNode,
  groupbycolumns: GroupByColumnsNode,
  filter: FilterNode,
  referencelookup: ReferenceTableLookupNode,
  reversereferencelookup: ReverseReferenceLookupNode,
  numericadjustment: NumericAdjustmentNode,
  mathmax: MathMaxNode,
  mathceil: MathCeilNode,
  mergechanges: MergeChangesNode,
  savechanges: SaveChangesNode,
  textsurround: TextSurroundNode,
  appendtext: AppendTextNode,
  textjoin: TextJoinNode,
  groupedcolumnstotext: GroupedColumnsToTextNode,
  indextable: IndexTableNode,
  lookup: LookupNode,
  flattennested: FlattenNestedNode,
  extracttable: ExtractTableNode,
  aggregatenested: AggregateNestedNode,
  generaterows: GenerateRowsNode,
};

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

let nodeId = 0;
const getNodeId = () => `node_${nodeId++}`;

const NodeSidebar: React.FC<{
  onDragStart: (event: DragEvent, nodeType: DraggableNodeData) => void;
}> = ({ onDragStart }) => {
  return (
    <div className="w-64 height-without-topbar-and-padding bg-gray-800 border-r border-gray-600 p-4 overflow-y-auto">
      <h3 className="font-bold text-lg mb-4 text-white">Node Types</h3>
      <div className="space-y-4">
        {nodeTypeSections.map((section) => (
          <div key={section.title} className="space-y-2">
            <h4 className="font-semibold text-sm text-gray-300 uppercase tracking-wide border-b border-gray-600 pb-1">
              {section.title}
            </h4>
            <div className="space-y-2">
              {section.nodes.map((nodeType) => (
                <div
                  key={nodeType.type}
                  draggable
                  onDragStart={(event) => onDragStart(event, nodeType)}
                  className="p-3 bg-gray-700 border border-gray-600 rounded-lg cursor-move hover:bg-gray-600 shadow-sm transition-colors duration-150"
                >
                  <div className="font-medium text-sm text-white">{nodeType.label}</div>
                  <div className="text-xs text-gray-300 mt-1">{nodeType.description}</div>
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

const NodeEditor: React.FC<NodeEditorProps> = ({ currentFile, currentPack }: NodeEditorProps) => {
  const dispatch = useAppDispatch();
  const unsavedPacksData = useAppSelector((state) => state.app.unsavedPacksData);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  const [DBNameToDBVersions, setDBNameToDBVersions] = useState<Record<string, DBVersion[]> | undefined>(
    undefined
  );

  // Flow options state
  const [flowOptions, setFlowOptions] = useState<FlowOption[]>([]);
  const [isFlowOptionsModalOpen, setIsFlowOptionsModalOpen] = useState(false);
  const [isGraphEnabled, setIsGraphEnabled] = useState(false);
  const [graphStartsEnabled, setGraphStartsEnabled] = useState(true);

  // Keep the ref updated with current nodes
  React.useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  React.useEffect(() => {
    console.log("getDBNameToDBVersions");
    window.api?.getDBNameToDBVersions().then((data) => {
      // console.log("getDBNameToDBVersions:", Object.keys(data));
      setDBNameToDBVersions(data);
    });
  }, []);

  // Listen for node data updates from child components
  React.useEffect(() => {
    const handleNodeDataUpdate = (event: CustomEvent) => {
      const {
        nodeId,
        textValue,
        selectedPack,
        selectedTable,
        selectedColumn,
        selectedColumn1,
        selectedColumn2,
        columnNames,
        groupedTextSelection,
        outputType,
        pattern,
        joinSeparator,
        packName,
        packedFileName,
        beforeText,
        afterText,
        useCurrentPack,
        onlyForMultiple,
        filters,
        selectedReferenceTable,
        referenceTableNames,
        selectedReverseTable,
        reverseTableNames,
        indexColumns,
        lookupColumn,
        joinType,
        tablePrefix,
        tablePrefixes,
        aggregateColumn,
        aggregateType,
        filterColumn,
        filterOperator,
        filterValue,
        transformations,
        outputTables,
        outputCount,
        inputType,
        indexedInputType,
      } = event.detail;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                textValue: textValue !== undefined ? textValue : node.data.textValue,
                selectedPack: selectedPack !== undefined ? selectedPack : node.data.selectedPack,
                selectedTable: selectedTable !== undefined ? selectedTable : node.data.selectedTable,
                selectedColumn: selectedColumn !== undefined ? selectedColumn : node.data.selectedColumn,
                selectedColumn1: selectedColumn1 !== undefined ? selectedColumn1 : node.data.selectedColumn1,
                selectedColumn2: selectedColumn2 !== undefined ? selectedColumn2 : node.data.selectedColumn2,
                columnNames: columnNames !== undefined ? columnNames : node.data.columnNames,
                groupedTextSelection:
                  groupedTextSelection !== undefined ? groupedTextSelection : node.data.groupedTextSelection,
                outputType: outputType !== undefined ? outputType : node.data.outputType,
                pattern: pattern !== undefined ? pattern : node.data.pattern,
                joinSeparator: joinSeparator !== undefined ? joinSeparator : node.data.joinSeparator,
                packName: packName !== undefined ? packName : node.data.packName,
                packedFileName: packedFileName !== undefined ? packedFileName : node.data.packedFileName,
                beforeText: beforeText !== undefined ? beforeText : node.data.beforeText,
                afterText: afterText !== undefined ? afterText : node.data.afterText,
                useCurrentPack: useCurrentPack !== undefined ? useCurrentPack : node.data.useCurrentPack,
                onlyForMultiple: onlyForMultiple !== undefined ? onlyForMultiple : node.data.onlyForMultiple,
                filters: filters !== undefined ? filters : node.data.filters,
                selectedReferenceTable:
                  selectedReferenceTable !== undefined
                    ? selectedReferenceTable
                    : node.data.selectedReferenceTable,
                referenceTableNames:
                  referenceTableNames !== undefined ? referenceTableNames : node.data.referenceTableNames,
                selectedReverseTable:
                  selectedReverseTable !== undefined
                    ? selectedReverseTable
                    : node.data.selectedReverseTable,
                reverseTableNames:
                  reverseTableNames !== undefined ? reverseTableNames : node.data.reverseTableNames,
                indexColumns: indexColumns !== undefined ? indexColumns : node.data.indexColumns,
                lookupColumn: lookupColumn !== undefined ? lookupColumn : node.data.lookupColumn,
                joinType: joinType !== undefined ? joinType : node.data.joinType,
                tablePrefix: tablePrefix !== undefined ? tablePrefix : node.data.tablePrefix,
                tablePrefixes: tablePrefixes !== undefined ? tablePrefixes : node.data.tablePrefixes,
                aggregateColumn: aggregateColumn !== undefined ? aggregateColumn : node.data.aggregateColumn,
                aggregateType: aggregateType !== undefined ? aggregateType : node.data.aggregateType,
                filterColumn: filterColumn !== undefined ? filterColumn : node.data.filterColumn,
                filterOperator: filterOperator !== undefined ? filterOperator : node.data.filterOperator,
                filterValue: filterValue !== undefined ? filterValue : node.data.filterValue,
                transformations: transformations !== undefined ? transformations : node.data.transformations,
                outputTables: outputTables !== undefined ? outputTables : node.data.outputTables,
                outputCount: outputCount !== undefined ? outputCount : node.data.outputCount,
                inputType: inputType !== undefined ? inputType : node.data.inputType,
                indexedInputType: indexedInputType !== undefined ? indexedInputType : node.data.indexedInputType,
              },
            };
          }
          return node;
        })
      );

      // If a reference lookup node's selectedReferenceTable changed, update connected nodes
      if (selectedReferenceTable !== undefined) {
        const sourceNode = nodes.find((n) => n.id === nodeId);
        if (sourceNode && sourceNode.type === "referencelookup") {
          // Find all edges where this node is the source
          const connectedEdges = edges.filter((e) => e.source === nodeId);

          // Update all connected target nodes with the new table info
          if (selectedReferenceTable && DBNameToDBVersions) {
            const tableVersions = DBNameToDBVersions[selectedReferenceTable];
            if (tableVersions && tableVersions.length > 0) {
              const tableFields = tableVersions[0].fields || [];
              const fieldNames = tableFields.map((field) => field.name);

              connectedEdges.forEach((edge) => {
                setNodes((nds) =>
                  nds.map((node) => {
                    if (
                      node.id === edge.target &&
                      (node.type === "columnselectiondropdown" ||
                        node.type === "groupbycolumns" ||
                        node.type === "filter" ||
                        node.type === "referencelookup")
                    ) {
                      console.log(
                        `Updating ${node.type} node ${node.id} with reference table: ${selectedReferenceTable}`
                      );
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          connectedTableName: selectedReferenceTable,
                          columnNames: fieldNames,
                        },
                      };
                    }
                    return node;
                  })
                );
              });
            }
          }
        }
      }

      // If a reverse reference lookup node's selectedReverseTable changed, update connected nodes
      if (selectedReverseTable !== undefined) {
        const sourceNode = nodes.find((n) => n.id === nodeId);
        if (sourceNode && sourceNode.type === "reversereferencelookup") {
          // Find all edges where this node is the source
          const connectedEdges = edges.filter((e) => e.source === nodeId);

          // Update all connected target nodes with the new table info
          if (selectedReverseTable && DBNameToDBVersions) {
            const tableVersions = DBNameToDBVersions[selectedReverseTable];
            if (tableVersions && tableVersions.length > 0) {
              const tableFields = tableVersions[0].fields || [];
              const fieldNames = tableFields.map((field) => field.name);

              connectedEdges.forEach((edge) => {
                setNodes((nds) =>
                  nds.map((node) => {
                    if (
                      node.id === edge.target &&
                      (node.type === "columnselectiondropdown" ||
                        node.type === "groupbycolumns" ||
                        node.type === "filter" ||
                        node.type === "referencelookup" ||
                        node.type === "reversereferencelookup")
                    ) {
                      console.log(
                        `Updating ${node.type} node ${node.id} with reverse table: ${selectedReverseTable}`
                      );
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          connectedTableName: selectedReverseTable,
                          columnNames: fieldNames,
                        },
                      };
                    }
                    return node;
                  })
                );
              });
            }
          }
        }
      }
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
      } else if (sourceNode.type === "allenabledmods" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as AllEnabledModsNodeData).outputType;
      } else if (sourceNode.type === "tableselection" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as TableSelectionNodeData).outputType;
      } else if (sourceNode.type === "tableselectiondropdown" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as TableSelectionDropdownNodeData).outputType;
      } else if (sourceNode.type === "columnselection" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as ColumnSelectionNodeData).outputType;
      } else if (sourceNode.type === "columnselectiondropdown" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as ColumnSelectionDropdownNodeData).outputType;
      } else if (sourceNode.type === "numericadjustment" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as NumericAdjustmentNodeData).outputType;
      } else if (sourceNode.type === "mathmax" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as MathMaxNodeData).outputType;
      } else if (sourceNode.type === "mathceil" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as MathCeilNodeData).outputType;
      } else if (sourceNode.type === "mergechanges" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as MergeChangesNodeData).outputType;
      } else if (sourceNode.type === "groupbycolumns" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as GroupByColumnsNodeData).outputType;
      } else if (sourceNode.type === "filter" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as FilterNodeData).outputType;
      } else if (sourceNode.type === "referencelookup" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as ReferenceTableLookupNodeData).outputType;
      } else if (sourceNode.type === "reversereferencelookup" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as ReverseReferenceLookupNodeData).outputType;
      } else if (sourceNode.type === "textsurround" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as TextSurroundNodeData).outputType;
      } else if (sourceNode.type === "appendtext" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as AppendTextNodeData).outputType;
      } else if (sourceNode.type === "textjoin" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as TextJoinNodeData).outputType;
      } else if (sourceNode.type === "groupedcolumnstotext" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as GroupedColumnsToTextNodeData).outputType;
      } else if (sourceNode.type === "indextable" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as IndexTableNodeData).outputType;
      } else if (sourceNode.type === "lookup" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as LookupNodeData).outputType;
      } else if (sourceNode.type === "flattennested" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as FlattenNestedNodeData).outputType;
      } else if (sourceNode.type === "extracttable" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as ExtractTableNodeData).outputType;
      } else if (sourceNode.type === "aggregatenested" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as AggregateNestedNodeData).outputType;
      } else if (sourceNode.type === "generaterows" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as GenerateRowsNodeData).outputType;
      }

      // Get input type from target node
      let targetInputType: NodeEdgeTypes | undefined;
      if (targetNode.type === "tableselection" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as TableSelectionNodeData).inputType;
      } else if (targetNode.type === "tableselectiondropdown" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as TableSelectionDropdownNodeData).inputType;
      } else if (targetNode.type === "columnselection" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as ColumnSelectionNodeData).inputType;
      } else if (targetNode.type === "columnselectiondropdown" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as ColumnSelectionDropdownNodeData).inputType;
      } else if (targetNode.type === "groupbycolumns" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as GroupByColumnsNodeData).inputType;
      } else if (targetNode.type === "filter" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as FilterNodeData).inputType;
      } else if (targetNode.type === "referencelookup" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as ReferenceTableLookupNodeData).inputType;
      } else if (targetNode.type === "reversereferencelookup" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as ReverseReferenceLookupNodeData).inputType;
      } else if (targetNode.type === "numericadjustment" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as NumericAdjustmentNodeData).inputType;
      } else if (targetNode.type === "mathmax" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as MathMaxNodeData).inputType;
      } else if (targetNode.type === "mathceil" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as MathCeilNodeData).inputType;
      } else if (targetNode.type === "mergechanges" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as MergeChangesNodeData).inputType;
      } else if (targetNode.type === "savechanges" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as SaveChangesNodeData).inputType;
      } else if (targetNode.type === "textsurround" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as TextSurroundNodeData).inputType;
      } else if (targetNode.type === "appendtext" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as AppendTextNodeData).inputType;
      } else if (targetNode.type === "textjoin" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as TextJoinNodeData).inputType;
      } else if (targetNode.type === "groupedcolumnstotext" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as GroupedColumnsToTextNodeData).inputType;
      } else if (targetNode.type === "indextable" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as IndexTableNodeData).inputType;
      } else if (targetNode.type === "lookup" && targetNode.data) {
        // Lookup node has two inputs - need to check the target handle ID
        const targetHandle = params.targetHandle;
        if (targetHandle === "input-source") {
          targetInputType = (targetNode.data as unknown as LookupNodeData).inputType;
        } else if (targetHandle === "input-index") {
          targetInputType = (targetNode.data as unknown as LookupNodeData).indexedInputType;
        }
      } else if (targetNode.type === "flattennested" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as FlattenNestedNodeData).inputType;
      } else if (targetNode.type === "extracttable" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as ExtractTableNodeData).inputType;
      } else if (targetNode.type === "aggregatenested" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as AggregateNestedNodeData).inputType;
      } else if (targetNode.type === "generaterows" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as GenerateRowsNodeData).inputType;
      }

      // Allow connection only if types are compatible
      // Special case for textsurround: it accepts "Text", "Text Lines", or "GroupedText"
      const isTextSurroundCompatible =
        targetNode.type === "textsurround" &&
        (sourceOutputType === "Text" ||
          sourceOutputType === "Text Lines" ||
          sourceOutputType === "GroupedText");

      // Special case for appendtext: it accepts "Text", "Text Lines", or "GroupedText"
      const isAppendTextCompatible =
        targetNode.type === "appendtext" &&
        (sourceOutputType === "Text" ||
          sourceOutputType === "Text Lines" ||
          sourceOutputType === "GroupedText");

      // Special case for textjoin: it accepts "Text Lines" or "GroupedText"
      const isTextJoinCompatible =
        targetNode.type === "textjoin" &&
        (sourceOutputType === "Text Lines" || sourceOutputType === "GroupedText");

      // Special case for savechanges: it accepts "ChangedColumnSelection", "Text", or "TableSelection"
      const isSaveChangesCompatible =
        targetNode.type === "savechanges" &&
        (sourceOutputType === "ChangedColumnSelection" ||
         sourceOutputType === "Text" ||
         sourceOutputType === "TableSelection");

      if (
        (sourceOutputType && targetInputType && sourceOutputType === targetInputType) ||
        isTextSurroundCompatible ||
        isAppendTextCompatible ||
        isTextJoinCompatible ||
        isSaveChangesCompatible
      ) {
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

        // Update textsurround node input/output types to match connected source
        if (targetNode.type === "textsurround" && sourceOutputType) {
          setNodes((nds) =>
            nds.map((node) => {
              if (node.id === params.target) {
                // For GroupedText input, output is also GroupedText
                // For other types (Text, Text Lines), output matches input
                const outputType = sourceOutputType;

                return {
                  ...node,
                  data: {
                    ...node.data,
                    inputType: sourceOutputType,
                    outputType: outputType,
                  },
                };
              }
              return node;
            })
          );
        }

        // Update appendtext node input/output types to match connected source
        if (targetNode.type === "appendtext" && sourceOutputType) {
          setNodes((nds) =>
            nds.map((node) => {
              if (node.id === params.target) {
                // Output type matches input type
                const outputType = sourceOutputType;

                return {
                  ...node,
                  data: {
                    ...node.data,
                    inputType: sourceOutputType,
                    outputType: outputType,
                  },
                };
              }
              return node;
            })
          );
        }

        // Update textjoin node input type when connected to GroupedText
        if (targetNode.type === "textjoin" && sourceOutputType === "GroupedText") {
          setNodes((nds) =>
            nds.map((node) => {
              if (node.id === params.target) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    inputType: "GroupedText",
                  },
                };
              }
              return node;
            })
          );
        }

        // Update savechanges node input type to match connected source
        if (targetNode.type === "savechanges" && sourceOutputType) {
          setNodes((nds) =>
            nds.map((node) => {
              if (node.id === params.target) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    inputType: sourceOutputType,
                  },
                };
              }
              return node;
            })
          );
        }

        // Update column selection dropdown nodes when connected to table selection nodes
        if (
          (targetNode.type === "columnselectiondropdown" ||
            targetNode.type === "groupbycolumns" ||
            targetNode.type === "filter" ||
            targetNode.type === "referencelookup" ||
            targetNode.type === "reversereferencelookup" ||
            targetNode.type === "indextable" ||
            targetNode.type === "lookup" ||
            targetNode.type === "extracttable" ||
            targetNode.type === "aggregatenested" ||
            targetNode.type === "generaterows") &&
          (sourceNode.type === "tableselection" || sourceNode.type === "tableselectiondropdown")
        ) {
          const tableName =
            sourceNode.type === "tableselectiondropdown"
              ? (sourceNode.data as unknown as TableSelectionDropdownNodeData).selectedTable
              : undefined; // For tableselection, we'd need to parse the textValue

          if (tableName && DBNameToDBVersions) {
            const tableVersions = DBNameToDBVersions[tableName];
            if (tableVersions && tableVersions.length > 0) {
              const tableFields = tableVersions[0].fields || [];
              const fieldNames = tableFields.map((field) => field.name);

              setNodes((nds) =>
                nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        columnNames: fieldNames,
                        connectedTableName: tableName,
                        DBNameToDBVersions: DBNameToDBVersions,
                      },
                    };
                  }
                  return node;
                })
              );
            }
          }
        }

        // Update filter nodes when connected to another filter node (chaining filters)
        if (targetNode.type === "filter" && sourceNode.type === "filter") {
          const sourceFilterData = sourceNode.data as unknown as FilterNodeData;

          // Propagate the connectedTableName and DBNameToDBVersions from source filter to target filter
          if (sourceFilterData.connectedTableName && sourceFilterData.DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: sourceFilterData.columnNames || [],
                      connectedTableName: sourceFilterData.connectedTableName,
                      DBNameToDBVersions: sourceFilterData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update reference lookup nodes when connected to filter or reference lookup nodes (chaining)
        if (
          targetNode.type === "referencelookup" &&
          (sourceNode.type === "filter" || sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
        ) {
          const sourceData =
            sourceNode.type === "filter"
              ? (sourceNode.data as unknown as FilterNodeData)
              : sourceNode.type === "referencelookup"
              ? (sourceNode.data as unknown as ReferenceTableLookupNodeData)
              : (sourceNode.data as unknown as ReverseReferenceLookupNodeData);

          // Propagate the connectedTableName and DBNameToDBVersions from source to target
          if (sourceData.connectedTableName && sourceData.DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: sourceData.columnNames || [],
                      connectedTableName: sourceData.connectedTableName,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update reverse reference lookup nodes when connected to filter or reference lookup nodes (chaining)
        if (
          targetNode.type === "reversereferencelookup" &&
          (sourceNode.type === "filter" || sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
        ) {
          const sourceData =
            sourceNode.type === "filter"
              ? (sourceNode.data as unknown as FilterNodeData)
              : sourceNode.type === "referencelookup"
              ? (sourceNode.data as unknown as ReferenceTableLookupNodeData)
              : (sourceNode.data as unknown as ReverseReferenceLookupNodeData);

          // Propagate the connectedTableName and DBNameToDBVersions from source to target
          if (sourceData.connectedTableName && sourceData.DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: sourceData.columnNames || [],
                      connectedTableName: sourceData.connectedTableName,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update lookup nodes when source or index input is connected
        if (targetNode.type === "lookup") {
          const targetLookupData = targetNode.data as unknown as LookupNodeData;

          // Handle index input (from indextable)
          if (params.targetHandle === "input-index" && sourceNode.type === "indextable") {
            const sourceIndexData = sourceNode.data as unknown as IndexTableNodeData;

            if (sourceIndexData.connectedTableName && sourceIndexData.DBNameToDBVersions) {
              setNodes((nds) =>
                nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        // Store indexed table columns for nested joins
                        indexedTableColumns: sourceIndexData.columnNames || [],
                        indexedTableName: sourceIndexData.connectedTableName,
                        DBNameToDBVersions: sourceIndexData.DBNameToDBVersions,
                      },
                    };
                  }
                  return node;
                })
              );
            }
          }

          // Handle source input (from various table nodes)
          if (params.targetHandle === "input-source" &&
              (sourceNode.type === "tableselection" || sourceNode.type === "tableselectiondropdown" ||
               sourceNode.type === "filter" || sourceNode.type === "referencelookup" ||
               sourceNode.type === "reversereferencelookup" || sourceNode.type === "lookup" ||
               sourceNode.type === "extracttable" || sourceNode.type === "flattennested" ||
               sourceNode.type === "generaterows")) {

            const sourceData = sourceNode.data as any;

            if (sourceData.connectedTableName && sourceData.DBNameToDBVersions) {
              setNodes((nds) =>
                nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        columnNames: sourceData.columnNames || [],
                        connectedTableName: sourceData.connectedTableName,
                        DBNameToDBVersions: sourceData.DBNameToDBVersions,
                      },
                    };
                  }
                  return node;
                })
              );
            }
          }
        }

        // Update extracttable nodes when connected to lookup or flattennested
        if (targetNode.type === "extracttable" &&
            (sourceNode.type === "lookup" || sourceNode.type === "flattennested")) {
          const sourceData = sourceNode.data as any;

          if (sourceData.DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: sourceData.columnNames || [],
                      connectedTableName: sourceData.connectedTableName,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update aggregatenested nodes when connected to lookup
        if (targetNode.type === "aggregatenested" && sourceNode.type === "lookup") {
          const sourceData = sourceNode.data as unknown as LookupNodeData;

          if (sourceData.DBNameToDBVersions) {
            // For nested joins, use indexed table columns (the nested data)
            // For inner/left joins, use source table columns (the flat joined data)
            const columnsToUse = sourceData.joinType === "nested"
              ? (sourceData.indexedTableColumns || sourceData.columnNames || [])
              : (sourceData.columnNames || []);
            const tableNameToUse = sourceData.joinType === "nested"
              ? (sourceData.indexedTableName || sourceData.connectedTableName)
              : sourceData.connectedTableName;

            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: columnsToUse,
                      connectedTableName: tableNameToUse,
                      sourceTableColumns: sourceData.columnNames || [],
                      sourceTableName: sourceData.connectedTableName,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update flattennested nodes when connected to lookup or aggregatenested
        if (targetNode.type === "flattennested" &&
            (sourceNode.type === "lookup" || sourceNode.type === "aggregatenested")) {
          const sourceData = sourceNode.data as any;

          if (sourceData.DBNameToDBVersions) {
            // For aggregatenested with min/max, combine source and indexed table columns
            // For sum/avg/count, use source columns + aggregate column
            let columnsToUse = sourceData.columnNames || [];
            if (sourceNode.type === "aggregatenested" && sourceData.sourceTableColumns) {
              const aggregateType = sourceData.aggregateType;
              if (aggregateType === "min" || aggregateType === "max") {
                // Min/max keeps the full row, so combine source + indexed columns
                // FlattenNested will prefix these, so we need to prefix them here too
                const sourceTableName = sourceData.sourceTableName || "";
                const indexedTableName = sourceData.connectedTableName || "";
                const prefixedSourceColumns = (sourceData.sourceTableColumns || []).map(
                  (col: string) => `${sourceTableName}_${col}`
                );
                const prefixedIndexedColumns = (sourceData.columnNames || []).map(
                  (col: string) => `${indexedTableName}_${col}`
                );
                columnsToUse = [...prefixedSourceColumns, ...prefixedIndexedColumns];
              } else {
                // Sum/avg/count creates a new column, so use source columns + aggregate column
                const aggregateColumn = sourceData.aggregateColumn;
                const aggregateColumnName = `${aggregateColumn}_${aggregateType}`;
                const sourceTableName = sourceData.sourceTableName || "";
                const prefixedSourceColumns = (sourceData.sourceTableColumns || []).map(
                  (col: string) => `${sourceTableName}_${col}`
                );
                columnsToUse = [...prefixedSourceColumns, aggregateColumnName];
              }
            }

            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: columnsToUse,
                      connectedTableName: sourceData.connectedTableName,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update generaterows nodes when connected to any table source
        if (targetNode.type === "generaterows" &&
            (sourceNode.type === "tableselection" || sourceNode.type === "tableselectiondropdown" ||
             sourceNode.type === "filter" || sourceNode.type === "referencelookup" ||
             sourceNode.type === "reversereferencelookup" || sourceNode.type === "lookup" ||
             sourceNode.type === "extracttable" || sourceNode.type === "flattennested")) {
          const sourceData = sourceNode.data as any;

          if (sourceData.connectedTableName && sourceData.DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: sourceData.columnNames || [],
                      connectedTableName: sourceData.connectedTableName,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update filter nodes when connected to new table operation nodes
        if (targetNode.type === "filter" &&
            (sourceNode.type === "lookup" || sourceNode.type === "extracttable" ||
             sourceNode.type === "flattennested" || sourceNode.type === "generaterows")) {
          const sourceData = sourceNode.data as any;

          if (sourceData.connectedTableName && sourceData.DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: sourceData.columnNames || [],
                      connectedTableName: sourceData.connectedTableName,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update reference lookup nodes when connected to new table operation nodes
        if (targetNode.type === "referencelookup" &&
            (sourceNode.type === "lookup" || sourceNode.type === "extracttable" ||
             sourceNode.type === "flattennested" || sourceNode.type === "generaterows")) {
          const sourceData = sourceNode.data as any;

          if (sourceData.connectedTableName && sourceData.DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: sourceData.columnNames || [],
                      connectedTableName: sourceData.connectedTableName,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update reverse reference lookup nodes when connected to new table operation nodes
        if (targetNode.type === "reversereferencelookup" &&
            (sourceNode.type === "lookup" || sourceNode.type === "extracttable" ||
             sourceNode.type === "flattennested" || sourceNode.type === "generaterows")) {
          const sourceData = sourceNode.data as any;

          if (sourceData.connectedTableName && sourceData.DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: sourceData.columnNames || [],
                      connectedTableName: sourceData.connectedTableName,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }

        // Update filter nodes when connected to reference lookup or reverse reference lookup nodes
        if (targetNode.type === "filter" && (sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")) {
          if (sourceNode.type === "referencelookup") {
            const sourceData = sourceNode.data as unknown as ReferenceTableLookupNodeData;

            // Propagate the reference table info to the filter node
            if (sourceData.selectedReferenceTable && sourceData.DBNameToDBVersions) {
              // Get column names from the selected reference table (OUTPUT table), not the input table
              const tableVersions = sourceData.DBNameToDBVersions[sourceData.selectedReferenceTable];
              let columnNamesToUse: string[] = [];
              if (tableVersions && tableVersions.length > 0) {
                const tableFields = tableVersions[0].fields || [];
                columnNamesToUse = tableFields.map((field) => field.name);
              }

              setNodes((nds) =>
                nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        columnNames: columnNamesToUse,
                        connectedTableName: sourceData.selectedReferenceTable,
                        DBNameToDBVersions: sourceData.DBNameToDBVersions,
                      },
                    };
                  }
                  return node;
                })
              );
            }
          } else if (sourceNode.type === "reversereferencelookup") {
            const sourceData = sourceNode.data as unknown as ReverseReferenceLookupNodeData;

            // Propagate the reverse reference table info to the filter node
            if (sourceData.selectedReverseTable && sourceData.DBNameToDBVersions) {
              // Get column names from the selected reverse table (OUTPUT table)
              const tableVersions = sourceData.DBNameToDBVersions[sourceData.selectedReverseTable];
              let columnNamesToUse: string[] = [];
              if (tableVersions && tableVersions.length > 0) {
                const tableFields = tableVersions[0].fields || [];
                columnNamesToUse = tableFields.map((field) => field.name);
              }

              setNodes((nds) =>
                nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        columnNames: columnNamesToUse,
                        connectedTableName: sourceData.selectedReverseTable,
                        DBNameToDBVersions: sourceData.DBNameToDBVersions,
                      },
                    };
                  }
                  return node;
                })
              );
            }
          }
        }

        // Update column selection dropdown and groupbycolumns when connected to filter or reference lookup nodes
        if (
          (targetNode.type === "columnselectiondropdown" || targetNode.type === "groupbycolumns") &&
          (sourceNode.type === "filter" || sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
        ) {
          const sourceData =
            sourceNode.type === "filter"
              ? (sourceNode.data as unknown as FilterNodeData)
              : sourceNode.type === "referencelookup"
              ? (sourceNode.data as unknown as ReferenceTableLookupNodeData)
              : (sourceNode.data as unknown as ReverseReferenceLookupNodeData);

          // For reference lookup nodes, use the selected reference table instead of the input table
          let tableNameToUse = sourceData.connectedTableName;
          let columnNamesToUse = sourceData.columnNames || [];

          if (sourceNode.type === "referencelookup") {
            const refLookupData = sourceData as ReferenceTableLookupNodeData;
            if (refLookupData.selectedReferenceTable && sourceData.DBNameToDBVersions) {
              tableNameToUse = refLookupData.selectedReferenceTable;

              // Get column names from the selected reference table
              const tableVersions = sourceData.DBNameToDBVersions[tableNameToUse];
              if (tableVersions && tableVersions.length > 0) {
                const tableFields = tableVersions[0].fields || [];
                columnNamesToUse = tableFields.map((field) => field.name);
              }
            }
          } else if (sourceNode.type === "reversereferencelookup") {
            const revLookupData = sourceData as ReverseReferenceLookupNodeData;
            if (revLookupData.selectedReverseTable && sourceData.DBNameToDBVersions) {
              tableNameToUse = revLookupData.selectedReverseTable;

              // Get column names from the selected reverse table
              const tableVersions = sourceData.DBNameToDBVersions[tableNameToUse];
              if (tableVersions && tableVersions.length > 0) {
                const tableFields = tableVersions[0].fields || [];
                columnNamesToUse = tableFields.map((field) => field.name);
              }
            }
          }

          // Propagate the table info to the target node
          if (tableNameToUse && sourceData.DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === params.target) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      columnNames: columnNamesToUse,
                      connectedTableName: tableNameToUse,
                      DBNameToDBVersions: sourceData.DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }
      }
      // If types don't match or are undefined, the connection is rejected silently
    },
    [setEdges, DBNameToDBVersions, setNodes]
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
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
            useCurrentPack: false,
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
            useCurrentPack: false,
          } as PackFilesDropdownNodeData,
        };
      } else if (nodeData.type === "allenabledmods") {
        // Create AllEnabledMods node with special data structure
        newNode = {
          id: getNodeId(),
          type: "allenabledmods",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            outputType: "PackFiles" as NodeEdgeTypes,
            includeBaseGame: true,
          } as AllEnabledModsNodeData,
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
      } else if (nodeData.type === "tableselectiondropdown") {
        // Create TableSelection dropdown node with special data structure
        newNode = {
          id: getNodeId(),
          type: "tableselectiondropdown",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            selectedTable: "",
            inputType: "PackFiles" as NodeEdgeTypes,
            outputType: "TableSelection" as NodeEdgeTypes,
            tableNames: Object.keys(DBNameToDBVersions || {}).toSorted((firstTableName, secondTableName) => {
              return firstTableName.localeCompare(secondTableName);
            }),
          } as TableSelectionDropdownNodeData,
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
      } else if (nodeData.type === "columnselectiondropdown") {
        // Create ColumnSelection dropdown node with special data structure
        newNode = {
          id: getNodeId(),
          type: "columnselectiondropdown",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            selectedColumn: "",
            inputType: "TableSelection" as NodeEdgeTypes,
            outputType: "ColumnSelection" as NodeEdgeTypes,
            columnNames: [],
            DBNameToDBVersions,
          } as ColumnSelectionDropdownNodeData,
        };
      } else if (nodeData.type === "groupbycolumns") {
        // Create GroupByColumns node with special data structure
        newNode = {
          id: getNodeId(),
          type: "groupbycolumns",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            selectedColumn1: "",
            selectedColumn2: "",
            inputType: "TableSelection" as NodeEdgeTypes,
            outputType: "GroupedText" as NodeEdgeTypes,
            columnNames: [],
            DBNameToDBVersions,
          } as GroupByColumnsNodeData,
        };
      } else if (nodeData.type === "filter") {
        // Create Filter node with special data structure
        newNode = {
          id: getNodeId(),
          type: "filter",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            filters: [{ column: "", value: "", not: false, operator: "AND" }],
            inputType: "TableSelection" as NodeEdgeTypes,
            outputType: "TableSelection" as NodeEdgeTypes,
            columnNames: [],
            DBNameToDBVersions,
          } as FilterNodeData,
        };
      } else if (nodeData.type === "referencelookup") {
        // Create Reference Lookup node with special data structure
        newNode = {
          id: getNodeId(),
          type: "referencelookup",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            selectedReferenceTable: "",
            inputType: "TableSelection" as NodeEdgeTypes,
            outputType: "TableSelection" as NodeEdgeTypes,
            referenceTableNames: [],
            columnNames: [],
            DBNameToDBVersions,
          } as ReferenceTableLookupNodeData,
        };
      } else if (nodeData.type === "reversereferencelookup") {
        // Create Reverse Reference Lookup node with special data structure
        newNode = {
          id: getNodeId(),
          type: "reversereferencelookup",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            selectedReverseTable: "",
            inputType: "TableSelection" as NodeEdgeTypes,
            outputType: "TableSelection" as NodeEdgeTypes,
            reverseTableNames: [],
            columnNames: [],
            DBNameToDBVersions,
          } as ReverseReferenceLookupNodeData,
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
      } else if (nodeData.type === "mathmax") {
        // Create MathMax node with special data structure
        newNode = {
          id: getNodeId(),
          type: "mathmax",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: "",
            inputType: "ChangedColumnSelection" as NodeEdgeTypes,
            outputType: "ChangedColumnSelection" as NodeEdgeTypes,
          } as MathMaxNodeData,
        };
      } else if (nodeData.type === "mathceil") {
        // Create MathCeil node with special data structure
        newNode = {
          id: getNodeId(),
          type: "mathceil",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            inputType: "ChangedColumnSelection" as NodeEdgeTypes,
            outputType: "ChangedColumnSelection" as NodeEdgeTypes,
          } as MathCeilNodeData,
        };
      } else if (nodeData.type === "mergechanges") {
        // Create MergeChanges node with special data structure
        newNode = {
          id: getNodeId(),
          type: "mergechanges",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            inputType: "ChangedColumnSelection" as NodeEdgeTypes,
            outputType: "ChangedColumnSelection" as NodeEdgeTypes,
            inputCount: 2,
          } as MergeChangesNodeData,
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
            packName: "",
            packedFileName: "",
            inputType: "ChangedColumnSelection" as NodeEdgeTypes,
          } as SaveChangesNodeData,
        };
      } else if (nodeData.type === "textsurround") {
        // Create TextSurround node with special data structure
        newNode = {
          id: getNodeId(),
          type: "textsurround",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: "",
            inputType: "Text" as NodeEdgeTypes,
            outputType: "Text" as NodeEdgeTypes,
          } as TextSurroundNodeData,
        };
      } else if (nodeData.type === "appendtext") {
        // Create AppendText node with special data structure
        newNode = {
          id: getNodeId(),
          type: "appendtext",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            beforeText: "",
            afterText: "",
            inputType: "Text" as NodeEdgeTypes,
            outputType: "Text" as NodeEdgeTypes,
          } as AppendTextNodeData,
        };
      } else if (nodeData.type === "textjoin") {
        // Create TextJoin node with special data structure
        newNode = {
          id: getNodeId(),
          type: "textjoin",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            textValue: "",
            inputType: "Text Lines" as NodeEdgeTypes,
            outputType: "Text" as NodeEdgeTypes,
          } as TextJoinNodeData,
        };
      } else if (nodeData.type === "groupedcolumnstotext") {
        // Create GroupedColumnsToText node with special data structure
        newNode = {
          id: getNodeId(),
          type: "groupedcolumnstotext",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            pattern: "{0}: {1}",
            joinSeparator: "\\n",
            inputType: "GroupedText" as NodeEdgeTypes,
            outputType: "Text" as NodeEdgeTypes,
          } as GroupedColumnsToTextNodeData,
        };
      } else if (nodeData.type === "indextable") {
        newNode = {
          id: getNodeId(),
          type: "indextable",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            indexColumns: [],
            inputType: "TableSelection" as NodeEdgeTypes,
            outputType: "IndexedTable" as NodeEdgeTypes,
            columnNames: [],
            connectedTableName: "",
            DBNameToDBVersions: {},
          } as IndexTableNodeData,
        };
      } else if (nodeData.type === "lookup") {
        newNode = {
          id: getNodeId(),
          type: "lookup",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            lookupColumn: "",
            joinType: "inner",
            inputType: "TableSelection" as NodeEdgeTypes,
            indexedInputType: "IndexedTable" as NodeEdgeTypes,
            outputType: "TableSelection" as NodeEdgeTypes,
            columnNames: [],
            connectedTableName: "",
            indexedTableColumns: [],
            indexedTableName: "",
            DBNameToDBVersions: {},
            inputCount: 2,
          } as LookupNodeData,
        };
      } else if (nodeData.type === "flattennested") {
        newNode = {
          id: getNodeId(),
          type: "flattennested",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            inputType: "NestedTableSelection" as NodeEdgeTypes,
            outputType: "TableSelection" as NodeEdgeTypes,
            columnNames: [],
            connectedTableName: "",
            DBNameToDBVersions: {},
          } as FlattenNestedNodeData,
        };
      } else if (nodeData.type === "extracttable") {
        newNode = {
          id: getNodeId(),
          type: "extracttable",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            tablePrefix: "",
            inputType: "TableSelection" as NodeEdgeTypes,
            outputType: "TableSelection" as NodeEdgeTypes,
            tablePrefixes: [],
            columnNames: [],
            connectedTableName: "",
            DBNameToDBVersions: {},
          } as ExtractTableNodeData,
        };
      } else if (nodeData.type === "aggregatenested") {
        newNode = {
          id: getNodeId(),
          type: "aggregatenested",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            aggregateColumn: "",
            aggregateType: "min",
            inputType: "NestedTableSelection" as NodeEdgeTypes,
            outputType: "NestedTableSelection" as NodeEdgeTypes,
            columnNames: [],
            connectedTableName: "",
            filterColumn: "",
            filterOperator: "equals" as const,
            filterValue: "",
            DBNameToDBVersions: {},
          } as AggregateNestedNodeData,
        };
      } else if (nodeData.type === "generaterows") {
        newNode = {
          id: getNodeId(),
          type: "generaterows",
          position,
          data: {
            label: nodeData.label,
            type: nodeData.type,
            sourceColumns: [],
            transformations: [],
            outputTables: [
              {
                handleId: "output-table1",
                name: "Table 1",
                existingTableName: "",
                columnMapping: [],
              },
              {
                handleId: "output-table2",
                name: "Table 2",
                existingTableName: "",
                columnMapping: [],
              },
            ],
            inputType: "TableSelection" as NodeEdgeTypes,
            outputType: "TableSelection" as NodeEdgeTypes,
            outputCount: 2,
            columnNames: [],
            connectedTableName: "",
            DBNameToDBVersions: {},
          } as GenerateRowsNodeData,
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
    [reactFlowInstance, setNodes, DBNameToDBVersions]
  );

  const onDragStart = (event: DragEvent, nodeType: DraggableNodeData) => {
    event.dataTransfer.setData("application/reactflow", JSON.stringify(nodeType));
    event.dataTransfer.effectAllowed = "move";
  };

  const serializeNodeGraph = useCallback((): SerializedNodeGraph => {
    const serializedNodes: SerializedNode[] = nodes.map((node) => {
      const serialized = {
        id: node.id,
        type: node.type as FlowNodeType,
        position: node.position,
        data: {
          label: String(node.data?.label || ""),
          type: String(node.data?.type || "") as FlowNodeType,
          textValue: String((node.data as any)?.textValue || ""),
          selectedPack: String((node.data as any)?.selectedPack || ""),
          selectedTable: String((node.data as any)?.selectedTable || ""),
          selectedColumn: String((node.data as any)?.selectedColumn || ""),
          selectedColumn1: String((node.data as any)?.selectedColumn1 || ""),
          selectedColumn2: String((node.data as any)?.selectedColumn2 || ""),
          columnNames: (node.data as any)?.columnNames || [],
          connectedTableName: String((node.data as any)?.connectedTableName || ""),
          outputType: (node.data as any)?.outputType,
          inputType: (node.data as any)?.inputType,
          groupedTextSelection: (node.data as any)?.groupedTextSelection,
          filters: (node.data as any)?.filters,
          selectedReferenceTable: String((node.data as any)?.selectedReferenceTable || ""),
          referenceTableNames: (node.data as any)?.referenceTableNames || [],
          selectedReverseTable: String((node.data as any)?.selectedReverseTable || ""),
          reverseTableNames: (node.data as any)?.reverseTableNames || [],
          packName: String((node.data as any)?.packName || ""),
          packedFileName: String((node.data as any)?.packedFileName || ""),
          pattern: String((node.data as any)?.pattern || ""),
          joinSeparator: String((node.data as any)?.joinSeparator || ""),
          beforeText: String((node.data as any)?.beforeText || ""),
          afterText: String((node.data as any)?.afterText || ""),
          includeBaseGame: (node.data as any)?.includeBaseGame,
          inputCount: (node.data as any)?.inputCount,
          useCurrentPack: (node.data as any)?.useCurrentPack,
          onlyForMultiple: (node.data as any)?.onlyForMultiple,
          indexColumns: (node.data as any)?.indexColumns || [],
          lookupColumn: String((node.data as any)?.lookupColumn || ""),
          joinType: (node.data as any)?.joinType || "inner",
          tablePrefix: String((node.data as any)?.tablePrefix || ""),
          tablePrefixes: (node.data as any)?.tablePrefixes || [],
          aggregateColumn: String((node.data as any)?.aggregateColumn || ""),
          aggregateType: (node.data as any)?.aggregateType || "min",
          filterColumn: String((node.data as any)?.filterColumn || ""),
          filterOperator: (node.data as any)?.filterOperator || "equals",
          filterValue: String((node.data as any)?.filterValue || ""),
          transformations: (node.data as any)?.transformations || [],
          outputTables: (node.data as any)?.outputTables || [],
          outputCount: (node.data as any)?.outputCount || 2,
        },
      };

      if (node.type === "groupbycolumns") {
        console.log(`Serializing groupbycolumns node ${node.id}:`, {
          selectedColumn1: serialized.data.selectedColumn1,
          selectedColumn2: serialized.data.selectedColumn2,
          onlyForMultiple: serialized.data.onlyForMultiple,
          rawData: node.data,
        });
      }

      return serialized;
    });

    const serializedConnections: SerializedConnection[] = edges.map((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);

      return {
        id: edge.id || `${edge.source}-${edge.target}`,
        sourceId: edge.source || "",
        targetId: edge.target || "",
        sourceType: (sourceNode?.data as any)?.outputType,
        targetType: (targetNode?.data as any)?.inputType,
        sourceHandle: edge.sourceHandle, // Preserve source handle for multi-output nodes
        targetHandle: edge.targetHandle, // Preserve target handle for multi-input nodes
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
      options: flowOptions,
      isGraphEnabled,
      graphStartsEnabled,
    };
  }, [nodes, edges, flowOptions, isGraphEnabled, graphStartsEnabled]);

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
            position: serializedNode.position ?? { x: 0, y: 0 },
            data: serializedNode.data,
          };

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

          console.log("ser type:", node.data.type);

          // Debug: Check if generaterows node has transformations when loaded
          if (node.type === "generaterows") {
            console.log(`[LOAD] GenerateRows node ${node.id} loaded with:`, {
              hasTransformations: !!(serializedNode.data as any)?.transformations,
              transformationsLength: ((serializedNode.data as any)?.transformations || []).length,
              hasOutputTables: !!(serializedNode.data as any)?.outputTables,
              outputTablesLength: ((serializedNode.data as any)?.outputTables || []).length,
              transformations: (serializedNode.data as any)?.transformations,
              outputTables: (serializedNode.data as any)?.outputTables,
            });
          }
          if (
            node.data.type === "columnselectiondropdown" ||
            node.data.type === "tableselectiondropdown" ||
            node.data.type === "groupbycolumns" ||
            node.data.type === "filter" ||
            node.data.type === "referencelookup" ||
            node.data.type === "reversereferencelookup" ||
            node.data.type === "indextable" ||
            node.data.type === "lookup" ||
            node.data.type === "extracttable" ||
            node.data.type === "aggregatenested" ||
            node.data.type === "generaterows"
          ) {
            console.log("ser type!!!:", DBNameToDBVersions);
            node.data.DBNameToDBVersions = DBNameToDBVersions;
            if (node.data.type === "tableselectiondropdown") {
              node.data.tableNames = Object.keys(DBNameToDBVersions || {}).toSorted(
                (firstTableName, secondTableName) => {
                  return firstTableName.localeCompare(secondTableName);
                }
              );
            }
          }
          return node;
        });

        // Convert serialized connections back to ReactFlow edges
        const loadedEdges: Edge[] = serializedGraph.connections.map((serializedConnection) => ({
          id: serializedConnection.id,
          source: serializedConnection.sourceId,
          target: serializedConnection.targetId,
          sourceHandle: serializedConnection.sourceHandle, // Restore source handle for multi-output nodes
          targetHandle: serializedConnection.targetHandle, // Restore target handle for multi-input nodes
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

        // Populate DBNameToDBVersions for nodes that need it
        setTimeout(() => {
          if (DBNameToDBVersions) {
            setNodes((nds) =>
              nds.map((node) => {
                // Add DBNameToDBVersions to nodes that need it
                if (
                  node.type === "filter" ||
                  node.type === "referencelookup" ||
                  node.type === "reversereferencelookup" ||
                  node.type === "columnselectiondropdown" ||
                  node.type === "groupbycolumns" ||
                  node.type === "indextable" ||
                  node.type === "lookup" ||
                  node.type === "extracttable" ||
                  node.type === "aggregatenested" ||
                  node.type === "generaterows"
                ) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      DBNameToDBVersions: DBNameToDBVersions,
                    },
                  };
                }
                return node;
              })
            );
          }
        }, 0);

        // Load flow options if they exist
        if ((serializedGraph as any).options) {
          setFlowOptions((serializedGraph as any).options);
        }
        if ((serializedGraph as any).isGraphEnabled !== undefined) {
          setIsGraphEnabled((serializedGraph as any).isGraphEnabled);
        }
        if ((serializedGraph as any).graphStartsEnabled !== undefined) {
          setGraphStartsEnabled((serializedGraph as any).graphStartsEnabled);
        }

        // Recreate onconnection callbacks for all edges
        setTimeout(() => {
          loadedEdges.forEach((edge) => {
            const sourceNode = loadedNodes.find((n) => n.id === edge.source);
            const targetNode = loadedNodes.find((n) => n.id === edge.target);

            if (!sourceNode || !targetNode) return;

            // Update column selection dropdown and groupbycolumns nodes when connected to table selection nodes
            if (
              (targetNode.type === "columnselectiondropdown" ||
                targetNode.type === "groupbycolumns" ||
                targetNode.type === "filter" ||
                targetNode.type === "referencelookup" ||
                targetNode.type === "reversereferencelookup") &&
              (sourceNode.type === "tableselection" || sourceNode.type === "tableselectiondropdown")
            ) {
              const tableName =
                sourceNode.type === "tableselectiondropdown"
                  ? (sourceNode.data as unknown as TableSelectionDropdownNodeData).selectedTable
                  : undefined;

              if (tableName && DBNameToDBVersions) {
                const tableVersions = DBNameToDBVersions[tableName];
                if (tableVersions && tableVersions.length > 0) {
                  const tableFields = tableVersions[0].fields || [];
                  const fieldNames = tableFields.map((field) => field.name);

                  setNodes((nds) =>
                    nds.map((node) => {
                      if (node.id === targetNode.id) {
                        return {
                          ...node,
                          data: {
                            ...node.data,
                            columnNames: fieldNames,
                            connectedTableName: tableName,
                          },
                        };
                      }
                      return node;
                    })
                  );
                }
              }
            }

            // Update reference lookup nodes when connected to filter or reference lookup nodes
            if (
              targetNode.type === "referencelookup" &&
              (sourceNode.type === "filter" || sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
            ) {
              const sourceData =
                sourceNode.type === "filter"
                  ? (sourceNode.data as unknown as FilterNodeData)
                  : sourceNode.type === "referencelookup"
                  ? (sourceNode.data as unknown as ReferenceTableLookupNodeData)
                  : (sourceNode.data as unknown as ReverseReferenceLookupNodeData);

              if (sourceData.connectedTableName && sourceData.DBNameToDBVersions) {
                setNodes((nds) =>
                  nds.map((node) => {
                    if (node.id === targetNode.id) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          columnNames: sourceData.columnNames || [],
                          connectedTableName: sourceData.connectedTableName,
                          DBNameToDBVersions: sourceData.DBNameToDBVersions,
                        },
                      };
                    }
                    return node;
                  })
                );
              }
            }

            // Update reverse reference lookup nodes when connected to filter or reference lookup nodes
            if (
              targetNode.type === "reversereferencelookup" &&
              (sourceNode.type === "filter" || sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
            ) {
              const sourceData =
                sourceNode.type === "filter"
                  ? (sourceNode.data as unknown as FilterNodeData)
                  : sourceNode.type === "referencelookup"
                  ? (sourceNode.data as unknown as ReferenceTableLookupNodeData)
                  : (sourceNode.data as unknown as ReverseReferenceLookupNodeData);

              if (sourceData.connectedTableName && sourceData.DBNameToDBVersions) {
                setNodes((nds) =>
                  nds.map((node) => {
                    if (node.id === targetNode.id) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          columnNames: sourceData.columnNames || [],
                          connectedTableName: sourceData.connectedTableName,
                          DBNameToDBVersions: sourceData.DBNameToDBVersions,
                        },
                      };
                    }
                    return node;
                  })
                );
              }
            }

            // Update filter nodes when connected to reference lookup or reverse reference lookup nodes
            if (targetNode.type === "filter" && (sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")) {
              if (sourceNode.type === "referencelookup") {
                const sourceData = sourceNode.data as unknown as ReferenceTableLookupNodeData;

                if (sourceData.selectedReferenceTable && sourceData.DBNameToDBVersions) {
                  // Get column names from the selected reference table (OUTPUT table), not the input table
                  const tableVersions = sourceData.DBNameToDBVersions[sourceData.selectedReferenceTable];
                  let columnNamesToUse: string[] = [];
                  if (tableVersions && tableVersions.length > 0) {
                    const tableFields = tableVersions[0].fields || [];
                    columnNamesToUse = tableFields.map((field) => field.name);
                  }

                  setNodes((nds) =>
                    nds.map((node) => {
                      if (node.id === targetNode.id) {
                        return {
                          ...node,
                          data: {
                            ...node.data,
                            columnNames: columnNamesToUse,
                            connectedTableName: sourceData.selectedReferenceTable,
                            DBNameToDBVersions: sourceData.DBNameToDBVersions,
                          },
                        };
                      }
                      return node;
                    })
                  );
                }
              } else if (sourceNode.type === "reversereferencelookup") {
                const sourceData = sourceNode.data as unknown as ReverseReferenceLookupNodeData;

                if (sourceData.selectedReverseTable && sourceData.DBNameToDBVersions) {
                  // Get column names from the selected reverse table (OUTPUT table)
                  const tableVersions = sourceData.DBNameToDBVersions[sourceData.selectedReverseTable];
                  let columnNamesToUse: string[] = [];
                  if (tableVersions && tableVersions.length > 0) {
                    const tableFields = tableVersions[0].fields || [];
                    columnNamesToUse = tableFields.map((field) => field.name);
                  }

                  setNodes((nds) =>
                    nds.map((node) => {
                      if (node.id === targetNode.id) {
                        return {
                          ...node,
                          data: {
                            ...node.data,
                            columnNames: columnNamesToUse,
                            connectedTableName: sourceData.selectedReverseTable,
                            DBNameToDBVersions: sourceData.DBNameToDBVersions,
                          },
                        };
                      }
                      return node;
                    })
                  );
                }
              }
            }

            // Update filter nodes when connected to filter nodes (chaining)
            if (targetNode.type === "filter" && sourceNode.type === "filter") {
              const sourceFilterData = sourceNode.data as unknown as FilterNodeData;

              if (sourceFilterData.connectedTableName && sourceFilterData.DBNameToDBVersions) {
                setNodes((nds) =>
                  nds.map((node) => {
                    if (node.id === targetNode.id) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          columnNames: sourceFilterData.columnNames || [],
                          connectedTableName: sourceFilterData.connectedTableName,
                          DBNameToDBVersions: sourceFilterData.DBNameToDBVersions,
                        },
                      };
                    }
                    return node;
                  })
                );
              }
            }

            // Update column selection dropdown and groupbycolumns when connected to filter or reference lookup nodes
            if (
              (targetNode.type === "columnselectiondropdown" || targetNode.type === "groupbycolumns") &&
              (sourceNode.type === "filter" || sourceNode.type === "referencelookup" || sourceNode.type === "reversereferencelookup")
            ) {
              const sourceData =
                sourceNode.type === "filter"
                  ? (sourceNode.data as unknown as FilterNodeData)
                  : sourceNode.type === "referencelookup"
                  ? (sourceNode.data as unknown as ReferenceTableLookupNodeData)
                  : (sourceNode.data as unknown as ReverseReferenceLookupNodeData);

              // For reference lookup nodes, use the selected reference table instead of the input table
              let tableNameToUse = sourceData.connectedTableName;
              let columnNamesToUse = sourceData.columnNames || [];

              if (sourceNode.type === "referencelookup") {
                const refLookupData = sourceData as ReferenceTableLookupNodeData;
                if (refLookupData.selectedReferenceTable && sourceData.DBNameToDBVersions) {
                  tableNameToUse = refLookupData.selectedReferenceTable;

                  // Get column names from the selected reference table
                  const tableVersions = sourceData.DBNameToDBVersions[tableNameToUse];
                  if (tableVersions && tableVersions.length > 0) {
                    const tableFields = tableVersions[0].fields || [];
                    columnNamesToUse = tableFields.map((field) => field.name);
                  }
                } else if (
                  (targetNode.data as any).connectedTableName &&
                  (targetNode.data as any).connectedTableName !== sourceData.connectedTableName
                ) {
                  // If the target already has a different connectedTableName from the saved file,
                  // it means it was connected to a reference table, so preserve that data
                  // and infer the selectedReferenceTable for the reference lookup node
                  const targetConnectedTable = (targetNode.data as any).connectedTableName;
                  tableNameToUse = targetConnectedTable;
                  columnNamesToUse = (targetNode.data as any).columnNames || [];

                  // Update the reference lookup node's selectedReferenceTable
                  setNodes((nds) =>
                    nds.map((node) => {
                      if (node.id === sourceNode.id) {
                        return {
                          ...node,
                          data: {
                            ...node.data,
                            selectedReferenceTable: targetConnectedTable,
                          },
                        };
                      }
                      return node;
                    })
                  );
                }
              } else if (sourceNode.type === "reversereferencelookup") {
                const revLookupData = sourceData as ReverseReferenceLookupNodeData;
                if (revLookupData.selectedReverseTable && sourceData.DBNameToDBVersions) {
                  tableNameToUse = revLookupData.selectedReverseTable;

                  // Get column names from the selected reverse table
                  const tableVersions = sourceData.DBNameToDBVersions[tableNameToUse];
                  if (tableVersions && tableVersions.length > 0) {
                    const tableFields = tableVersions[0].fields || [];
                    columnNamesToUse = tableFields.map((field) => field.name);
                  }
                } else if (
                  (targetNode.data as any).connectedTableName &&
                  (targetNode.data as any).connectedTableName !== sourceData.connectedTableName
                ) {
                  // If the target already has a different connectedTableName from the saved file,
                  // preserve that data and infer the selectedReverseTable for the reverse lookup node
                  const targetConnectedTable = (targetNode.data as any).connectedTableName;
                  tableNameToUse = targetConnectedTable;
                  columnNamesToUse = (targetNode.data as any).columnNames || [];

                  // Update the reverse lookup node's selectedReverseTable
                  setNodes((nds) =>
                    nds.map((node) => {
                      if (node.id === sourceNode.id) {
                        return {
                          ...node,
                          data: {
                            ...node.data,
                            selectedReverseTable: targetConnectedTable,
                          },
                        };
                      }
                      return node;
                    })
                  );
                }
              }

              if (tableNameToUse && sourceData.DBNameToDBVersions) {
                setNodes((nds) =>
                  nds.map((node) => {
                    if (node.id === targetNode.id) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          columnNames: columnNamesToUse,
                          connectedTableName: tableNameToUse,
                          DBNameToDBVersions: sourceData.DBNameToDBVersions,
                        },
                      };
                    }
                    return node;
                  })
                );
              }
            }

            // Update table selection dropdown nodes when connected to pack files nodes
            if (
              targetNode.type === "tableselectiondropdown" &&
              (sourceNode.type === "packedfiles" ||
                sourceNode.type === "packfilesdropdown" ||
                sourceNode.type === "allenabledmods")
            ) {
              const selectedPack =
                sourceNode.type === "packfilesdropdown"
                  ? (sourceNode.data as unknown as PackFilesDropdownNodeData).selectedPack
                  : undefined;

              if (selectedPack) {
                // Here you could populate table names based on the selected pack
                // For now, we'll just ensure the connection is recognized
                setNodes((nds) =>
                  nds.map((node) => {
                    if (node.id === targetNode.id) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          // Keep existing tableNames, just ensure data structure is correct
                        },
                      };
                    }
                    return node;
                  })
                );
              }
            }
          });
        }, 100);

        console.log(`Loaded graph with ${loadedNodes.length} nodes and ${loadedEdges.length} connections`);
      } catch (error) {
        console.error("Failed to load node graph:", error);
        dispatch(
          addToast({
            type: "warning",
            messages: ["Failed to load the node graph file. Please check the file format."],
            startTime: Date.now(),
          })
        );
      }
    },
    [
      setNodes,
      setEdges,
      DBNameToDBVersions,
      setFlowOptions,
      setIsGraphEnabled,
      setGraphStartsEnabled,
      dispatch,
    ]
  );

  const loadNodeGraphFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const jsonContent = event.target?.result as string;
        loadNodeGraph(jsonContent);
      };

      reader.readAsText(file);
    },
    [loadNodeGraph]
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        loadNodeGraphFile(file);
      }
      // Clear the input so the same file can be loaded again
      event.target.value = "";
    },
    [loadNodeGraphFile]
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
        console.log("Flow saved successfully to:", result.filePath);
        // alert(`Flow saved successfully!`);
        dispatch(
          addToast({
            type: "success",
            messages: [`Flow saved successfully!`],
            startTime: Date.now(),
          })
        );
      } else {
        console.error("Failed to save flow:", result?.error);
        dispatch(
          addToast({
            type: "warning",
            messages: [`Failed to save flow: ${result?.error || "Unknown error"}`],
            startTime: Date.now(),
          })
        );
      }
    } catch (error) {
      console.error("Error saving flow:", error);
      dispatch(
        addToast({
          type: "warning",
          messages: [`Error saving flow: ${error instanceof Error ? error.message : "Unknown error"}`],
          startTime: Date.now(),
        })
      );
    }
  }, [currentFile, currentPack, serializeNodeGraph, dispatch]);

  // Node execution system
  const executeNodeGraph = useCallback(async () => {
    if (isExecuting) return;

    setIsExecuting(true);
    console.log("Starting node graph execution in backend...");
    console.log("Flow options at execution time:", flowOptions);

    try {
      if (nodes.length === 0) {
        console.error("No nodes found in the graph");
        dispatch(
          addToast({
            type: "warning",
            messages: ["No nodes found. Add nodes to the graph before executing."],
            startTime: Date.now(),
          })
        );
        return;
      }

      // Debug: Check generaterows node data before execution
      const generateRowsNodes = nodes.filter(n => n.type === "generaterows");
      generateRowsNodes.forEach(grNode => {
        console.log(`[PRE-EXECUTION] GenerateRows node ${grNode.id} data:`);
        console.log(`  transformationsLength: ${((grNode.data as any)?.transformations || []).length}`);
        console.log(`  transformations:`, JSON.stringify((grNode.data as any)?.transformations));
        console.log(`  outputTablesLength: ${((grNode.data as any)?.outputTables || []).length}`);
        console.log(`  outputTables:`, JSON.stringify((grNode.data as any)?.outputTables));
      });

      // Execute the entire graph in the backend
      const result = await executeGraphInBackend(nodes, edges, currentPack, flowOptions);

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

      dispatch(
        addToast({
          type: result.successCount === result.totalExecuted ? "success" : "warning",
          messages: [
            `${statusMessage}\n\nExecution Summary (${result.successCount}/${result.totalExecuted} nodes succeeded):\n${summary}\n\nCheck console for detailed results.`,
          ],
          startTime: Date.now(),
        })
      );
    } catch (error) {
      console.error("Error during graph execution:", error);
      dispatch(
        addToast({
          type: "warning",
          messages: [`Graph execution failed: ${error instanceof Error ? error.message : "Unknown error"}`],
          startTime: Date.now(),
        })
      );
    } finally {
      setIsExecuting(false);
    }
  }, [nodes, edges, isExecuting, currentPack, flowOptions, dispatch]);

  useEffect(() => {
    const loadFileContent = async () => {
      if (!currentFile || !currentPack) return;

      // First try to load from unsaved files
      const unsavedFiles = unsavedPacksData[currentPack];
      if (unsavedFiles) {
        const unsavedFile = unsavedFiles.find((file) => file.name == currentFile);
        if (unsavedFile && unsavedFile.text) {
          loadNodeGraph(unsavedFile.text);
          return;
        }
      }

      // If not in unsaved files, read from pack
      try {
        const result = await window.api?.readFileFromPack(currentPack, currentFile);
        if (result?.success && result.text) {
          loadNodeGraph(result.text);
        } else {
          console.error("Failed to read file from pack:", result?.error);
          dispatch(
            addToast({
              type: "warning",
              messages: [`Failed to load file: ${result?.error || "Unknown error"}`],
              startTime: Date.now(),
            })
          );
        }
      } catch (error) {
        console.error("Error loading file:", error);
        dispatch(
          addToast({
            type: "warning",
            messages: [`Error loading file: ${error instanceof Error ? error.message : "Unknown error"}`],
            startTime: Date.now(),
          })
        );
      }
    };

    loadFileContent();
  }, [currentFile, currentPack, unsavedPacksData, loadNodeGraph, dispatch]);

  return (
    <div className="flex">
      <NodeSidebar onDragStart={onDragStart} />
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
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
              Flow Options
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
                Save
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
    </div>
  );
};

export default NodeEditor;
