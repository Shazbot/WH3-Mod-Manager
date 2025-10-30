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
import { useAppSelector } from "../hooks";
import { DBVersion } from "../packFileTypes";

// Serialization types
export interface SerializedNode {
  id: string;
  type: string;
  position: XYPosition;
  data: {
    label: string;
    type: FlowNodeType;
    textValue?: string;
    selectedPack?: string;
    selectedTable?: string;
    selectedColumn?: string;
    selectedColumn1?: string;
    selectedColumn2?: string;
    columnNames?: string[];
    connectedTableName?: string;
    outputType?: NodeEdgeTypes;
    inputType?: NodeEdgeTypes;
    tableNames?: string[];
    filters?: string;
    DBNameToDBVersions?: Record<string, DBVersion[]>;
    groupedTextSelection?: "Text" | "Text Lines";
  };
}

export interface SerializedConnection {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType?: NodeEdgeTypes;
  targetType?: NodeEdgeTypes;
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

interface SaveChangesNodeData extends NodeData {
  textValue: string;
  packName: string;
  packedFileName: string;
  inputType: "ChangedColumnSelection" | "Text";
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
  return (
    <div className="bg-gray-700 border-2 border-green-500 rounded-lg p-4 min-w-[200px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-green-500" />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-300 mb-2 p-2 bg-gray-800 rounded border border-green-600">
        This node will use all currently enabled mods
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
  console.log("tableNames:", data.tableNames);
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
  }, [data.connectedTableName, data.DBNameToDBVersions, id]);

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

  console.log(
    `GroupByColumnsNode ${id}: selectedColumn1=${selectedColumn1}, selectedColumn2=${selectedColumn2}`
  );

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
  }, [data.connectedTableName, data.DBNameToDBVersions, id]);

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
  }, [data.connectedTableName, data.DBNameToDBVersions, id]);

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

      <div className="mt-2 text-xs text-gray-400">Output: TableSelection (Filtered)</div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-yellow-500"
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
        Input: {data.inputType || "ChangedColumnSelection or Text"}
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
      alert(`Option ID "${formData.id}" already exists. Please use a unique ID.`);
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
        alert(`Option ID "${formData.id}" already exists. Please use a unique ID.`);
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
                      {option.description && <p className="text-gray-300 text-sm mt-1">{option.description}</p>}
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
        label: "Textbox Input",
        description: "Node with textbox that outputs PackFiles",
      },
      {
        type: "packfilesdropdown",
        label: "Dropdown Input",
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
        label: "Textbox Input",
        description: "Accepts PackFiles input, outputs TableSelection",
      },
      {
        type: "tableselectiondropdown",
        label: "Dropdown Input",
        description: "Node with dropdown for table selection",
      },
      {
        type: "filter",
        label: "Filter",
        description: "Filter table rows with AND/OR conditions",
      },
    ],
  },
  {
    title: "Column Selection",
    nodes: [
      {
        type: "columnselection",
        label: "Textbox Input",
        description: "Accepts TableSelection input, outputs ColumnSelection",
      },
      {
        type: "columnselectiondropdown",
        label: "Dropdown Input",
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
    // Handle useCurrentPack flag - replace pack selection with current pack
    const processedNodes = nodes.map((node) => {
      let nodeData = { ...node.data };
      let modified = false;

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
        const textFields = ['textValue', 'pattern', 'beforeText', 'afterText', 'joinSeparator', 'packName', 'packedFileName'];

        for (const fieldName of textFields) {
          const fieldValue = (nodeData as any)?.[fieldName];
          if (typeof fieldValue === 'string' && fieldValue) {
            let modifiedValue = fieldValue;

            for (const option of flowOptions) {
              const placeholder = `{{${option.id}}}`;
              if (modifiedValue.includes(placeholder)) {
                modifiedValue = modifiedValue.replace(
                  new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"),
                  String(option.value)
                );
                console.log(`Node ${node.id}: Replaced ${placeholder} with "${option.value}" in ${fieldName}`);
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
    const serializedNodes = processedNodes.map((node) => ({
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
        packName: (node.data as any)?.packName ? String((node.data as any).packName) : "",
        packedFileName: (node.data as any)?.packedFileName ? String((node.data as any).packedFileName) : "",
        pattern: (node.data as any)?.pattern ? String((node.data as any).pattern) : "",
        joinSeparator: (node.data as any)?.joinSeparator ? String((node.data as any).joinSeparator) : "",
        groupedTextSelection: (node.data as any)?.groupedTextSelection
          ? String((node.data as any).groupedTextSelection)
          : "",
        beforeText: (node.data as any)?.beforeText ? String((node.data as any).beforeText) : "",
        afterText: (node.data as any)?.afterText ? String((node.data as any).afterText) : "",
        useCurrentPack: (node.data as any)?.useCurrentPack
          ? Boolean((node.data as any).useCurrentPack)
          : false,
        filters: (node.data as any)?.filters || [],
        columnNames: (node.data as any)?.columnNames || [],
        connectedTableName: (node.data as any)?.connectedTableName
          ? String((node.data as any).connectedTableName)
          : "",
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
  allenabledmods: AllEnabledModsNode,
  tableselection: TableSelectionNode,
  tableselectiondropdown: TableSelectionDropdownNode,
  columnselection: ColumnSelectionNode,
  columnselectiondropdown: ColumnSelectionDropdownNode,
  groupbycolumns: GroupByColumnsNode,
  filter: FilterNode,
  numericadjustment: NumericAdjustmentNode,
  savechanges: SaveChangesNode,
  textsurround: TextSurroundNode,
  appendtext: AppendTextNode,
  textjoin: TextJoinNode,
  groupedcolumnstotext: GroupedColumnsToTextNode,
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
      console.log("getDBNameToDBVersions:", Object.keys(data));
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
        filters,
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
                filters: filters !== undefined ? filters : node.data.filters,
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
      } else if (sourceNode.type === "groupbycolumns" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as GroupByColumnsNodeData).outputType;
      } else if (sourceNode.type === "filter" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as FilterNodeData).outputType;
      } else if (sourceNode.type === "textsurround" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as TextSurroundNodeData).outputType;
      } else if (sourceNode.type === "appendtext" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as AppendTextNodeData).outputType;
      } else if (sourceNode.type === "textjoin" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as TextJoinNodeData).outputType;
      } else if (sourceNode.type === "groupedcolumnstotext" && sourceNode.data) {
        sourceOutputType = (sourceNode.data as unknown as GroupedColumnsToTextNodeData).outputType;
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
      } else if (targetNode.type === "numericadjustment" && targetNode.data) {
        targetInputType = (targetNode.data as unknown as NumericAdjustmentNodeData).inputType;
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

      // Special case for savechanges: it accepts "ChangedColumnSelection" or "Text"
      const isSaveChangesCompatible =
        targetNode.type === "savechanges" &&
        (sourceOutputType === "ChangedColumnSelection" || sourceOutputType === "Text");

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

        // Update column selection dropdown nodes when connected to table selection nodes
        if (
          (targetNode.type === "columnselectiondropdown" ||
            targetNode.type === "groupbycolumns" ||
            targetNode.type === "filter") &&
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
        type: node.type || ("default" as FlowNodeType),
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
        },
      };

      if (node.type === "groupbycolumns") {
        console.log(`Serializing groupbycolumns node ${node.id}:`, {
          selectedColumn1: serialized.data.selectedColumn1,
          selectedColumn2: serialized.data.selectedColumn2,
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

          console.log("ser type:", node.data.type);
          if (
            node.data.type === "columnselectiondropdown" ||
            node.data.type === "tableselectiondropdown" ||
            node.data.type === "groupbycolumns"
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
                targetNode.type === "filter") &&
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
        alert("Failed to load the node graph file. Please check the file format.");
      }
    },
    [setNodes, setEdges, DBNameToDBVersions, setFlowOptions, setIsGraphEnabled, setGraphStartsEnabled]
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
        alert(`Flow saved successfully!`);
      } else {
        console.error("Failed to save flow:", result?.error);
        alert(`Failed to save flow: ${result?.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error saving flow:", error);
      alert(`Error saving flow: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [currentFile, currentPack, serializeNodeGraph]);

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
          alert(`Failed to load file: ${result?.error || "Unknown error"}`);
        }
      } catch (error) {
        console.error("Error loading file:", error);
        alert(`Error loading file: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    };

    loadFileContent();
  }, [currentFile, currentPack, unsavedPacksData, loadNodeGraph]);

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
