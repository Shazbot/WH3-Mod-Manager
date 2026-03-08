import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";

import { useAppSelector } from "../../hooks";
import { useLocalizations } from "../../localizationContext";
import { SCHEMA_FIELD_TYPE } from "../../packFileTypes";
import { SupportedGames } from "../../supportedGames";
import { getTableVersion } from "../connectionRules";
import {
  dispatchNodeDataUpdate,
  nodeEditorDebugLog,
  stopWheelPropagation,
  useDefaultTableVersions,
} from "./shared";
import type {
  AddColumnTransformation,
  AddNewColumnNodeData,
  AggregateNestedNodeData,
  AllEnabledModsNodeData,
  AppendTextNodeData,
  ColumnSelectionDropdownNodeData,
  ColumnSelectionNodeData,
  ColumnTransformation,
  CustomRowsInputNodeData,
  CustomSchemaNodeData,
  DeduplicateNodeData,
  DumpToTSVNodeData,
  ExtractTableNodeData,
  FilterNodeData,
  FilterRow,
  FlattenNestedNodeData,
  GenerateRowsNodeData,
  GetCounterColumnNodeData,
  GroupByAggregation,
  GroupByColumnsNodeData,
  GroupByNodeData,
  GroupedColumnsToTextNodeData,
  IndexTableNodeData,
  LookupNodeData,
  MathCeilNodeData,
  MathMaxNodeData,
  MultiFilterNodeData,
  MultiFilterSplitValue,
  MergeChangesNodeData,
  NumericAdjustmentNodeData,
  OutputTableConfig,
  PackFilesDropdownNodeData,
  PackFilesNodeData,
  ReadTSVFromPackNodeData,
  ReferenceTableLookupNodeData,
  ReverseReferenceLookupNodeData,
  SaveChangesNodeData,
  TableSelectionDropdownNodeData,
  TableSelectionNodeData,
  TextJoinNodeData,
  TextSurroundNodeData,
} from "./types";

const collator = new Intl.Collator("en");

export const PackFilesDropdownNode: React.FC<{ data: PackFilesDropdownNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const currentGame = useAppSelector((state) => state.app.currentGame);

  // Get base game pack name
  const baseGamePackNames: Record<SupportedGames, string> = {
    wh2: "data.pack",
    wh3: "db.pack",
    threeKingdoms: "database.pack",
    attila: "data.pack",
    troy: "data.pack",
    pharaoh: "data.pack",
    dynasties: "data_db.pack",
    rome2: "data_rome2.pack",
    shogun2: "data.exe",
  };
  const baseGamePack = baseGamePackNames[currentGame];

  const modsFromState = useAppSelector((state) => state.app.currentPreset.mods);

  // Add base game pack if not already in the list
  const modsWithBaseGame = modsFromState.some((mod) => mod.name === baseGamePack)
    ? modsFromState.slice()
    : [{ name: baseGamePack, humanName: baseGamePack, path: "" }, ...modsFromState];

  const allMods = modsWithBaseGame.sort((firstMod, secondMod) => {
    // Keep base game pack first
    if (firstMod.name === baseGamePack) return -1;
    if (secondMod.name === baseGamePack) return 1;

    // Sort rest alphabetically by display name
    const firstName = firstMod.humanName || firstMod.name;
    const secondName = secondMod.humanName || secondMod.name;
    return collator.compare(firstName, secondName);
  });

  const [selectedPack, setSelectedPack] = useState(data.selectedPack || "");
  const [useCurrentPack, setUseCurrentPack] = useState(data.useCurrentPack || false);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedPack(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, selectedPack: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setUseCurrentPack(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, useCurrentPack: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
        <option value="">{localized.nodeEditorSelectPack || "Select a pack..."}</option>
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
          <span className="text-xs text-gray-300">
            {localized.nodeEditorWhenInsidePackUseThatPack || "When inside pack use that pack"}
          </span>
        </label>
      </div>

      <div className="mt-2 text-xs text-gray-400">{localized.nodeEditorOutput || "Output:"} PackFiles</div>

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
export const AllEnabledModsNode: React.FC<{ data: AllEnabledModsNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [includeBaseGame, setIncludeBaseGame] = React.useState(data.includeBaseGame !== false);

  // Sync state when data.includeBaseGame changes (e.g., when loading a saved graph)
  React.useEffect(() => {
    setIncludeBaseGame(data.includeBaseGame !== false);
  }, [data.includeBaseGame]);

  const handleCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setIncludeBaseGame(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, includeBaseGame: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  return (
    <div className="bg-gray-700 border-2 border-green-500 rounded-lg p-4 min-w-[250px]">
      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-300 mb-2 p-2 bg-gray-800 rounded border border-green-600">
        {localized.nodeEditorAllEnabledModsDescription || "This node will use all currently enabled mods"}
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
          {localized.nodeEditorIncludeBaseGame || "Include Base Game"}
        </label>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} PackFiles (
        {localized.nodeEditorAllEnabledMods || "All Enabled Mods"})
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

// Custom TableSelection dropdown node component
export const TableSelectionDropdownNode: React.FC<{ data: TableSelectionDropdownNodeData; id: string }> = ({
  data,
  id,
}) => {
  const localized = useLocalizations();
  // nodeEditorDebugLog("tableNames:", data.tableNames);
  const tableNames = data.tableNames || [];
  const [selectedTable, setSelectedTable] = useState(data.selectedTable || "");

  nodeEditorDebugLog("data.selectedTable is", data.selectedTable, "selectedTable is", selectedTable);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedTable(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, selectedTable: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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

      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} PackFiles</div>

      <select
        value={selectedTable}
        onChange={handleDropdownChange}
        className="w-full max-w-md p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-orange-400"
      >
        <option value="">{localized.nodeEditorSelectTable || "Select a table..."}</option>
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

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} TableSelection
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

// Custom PackFiles node component with built-in textbox
export const PackFilesNode: React.FC<{ data: PackFilesNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [textValue, setTextValue] = useState(data.textValue || "");
  const [useCurrentPack, setUseCurrentPack] = useState(data.useCurrentPack || false);

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, textValue: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setUseCurrentPack(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, useCurrentPack: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  return (
    <div className="bg-gray-700 border-2 border-blue-500 rounded-lg p-4 min-w-[200px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-blue-500" />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder={localized.nodeEditorEnterPackFilesConfiguration || "Enter pack files configuration..."}
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
          <span className="text-xs text-gray-300">
            {localized.nodeEditorWhenInsidePackUseThatPack || "When inside pack use that pack"}
          </span>
        </label>
      </div>

      <div className="mt-2 text-xs text-gray-400">{localized.nodeEditorOutput || "Output:"} PackFiles</div>

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
export const TableSelectionNode: React.FC<{ data: TableSelectionNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, textValue: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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

      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} PackFiles</div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder={localized.nodeEditorEnterTableSelectionCriteria || "Enter table selection criteria..."}
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-purple-400"
      />

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} TableSelection
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
export const ColumnSelectionNode: React.FC<{ data: ColumnSelectionNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, textValue: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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

      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} TableSelection</div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder={localized.nodeEditorEnterColumnSelectionCriteria || "Enter column selection criteria..."}
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-emerald-400"
      />

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} ColumnSelection
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

// Custom ColumnSelection dropdown node component
export const ColumnSelectionDropdownNode: React.FC<{ data: ColumnSelectionDropdownNodeData; id: string }> = ({
  data,
  id,
}) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
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
    if (data.connectedTableName && data.DBNameToDBVersions) {
      // If columnNames were explicitly provided by the connection handler (e.g. from a generaterows
      // node with a specific tableVersion), trust them rather than re-deriving from defaultTableVersions.
      if (data.columnNames && data.columnNames.length > 0) {
        setColumnNames(data.columnNames);
        return;
      }

      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(data.connectedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        // Update the node data with new column names
        const updateEvent = {
          detail: { nodeId: id, columnNames: fieldNames },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);
      }
    }
  }, [data.connectedTableName, data.columnNames, id]);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedColumn(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, selectedColumn: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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

      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} TableSelection</div>

      <select
        value={selectedColumn}
        onChange={handleDropdownChange}
        className="w-full max-w-sm p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-teal-400"
      >
        <option value="">{localized.nodeEditorSelectColumn || "Select a column..."}</option>
        {columnNames.map((columnName) => (
          <option key={columnName} value={columnName}>
            {columnName}
          </option>
        ))}
      </select>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} ColumnSelection
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

// Custom GroupByColumns node component
export const GroupByColumnsNode: React.FC<{ data: GroupByColumnsNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
  const [selectedColumn1, setSelectedColumn1] = useState(data.selectedColumn1 || "");
  const [selectedColumn2, setSelectedColumn2] = useState(data.selectedColumn2 || "");
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);
  const [onlyForMultiple, setOnlyForMultiple] = useState(data.onlyForMultiple || false);

  // Update column names when connected table changes
  React.useEffect(() => {
    if (data.columnNames && data.columnNames.length > 0) {
      setColumnNames(data.columnNames);
      return;
    }
    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(data.connectedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        // Update the node data with new column names
        const updateEvent = {
          detail: { nodeId: id, columnNames: fieldNames },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);
      }
    }
  }, [data.connectedTableName, data.columnNames, id]);

  const handleDropdown1Change = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedColumn1(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, selectedColumn1: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleDropdown2Change = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedColumn2(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, selectedColumn2: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleOnlyForMultipleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setOnlyForMultiple(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, onlyForMultiple: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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

      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} TableSelection</div>

      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-300 block mb-1">
            {localized.nodeEditorColumn1 || "Column 1"}
          </label>
          <select
            value={selectedColumn1}
            onChange={handleDropdown1Change}
            className="w-full max-w-sm p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-fuchsia-400"
          >
            <option value="">{localized.nodeEditorSelectColumn || "Select a column..."}</option>
            {columnNames.map((columnName) => (
              <option key={columnName} value={columnName}>
                {columnName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-300 block mb-1">
            {localized.nodeEditorColumn2 || "Column 2"}
          </label>
          <select
            value={selectedColumn2}
            onChange={handleDropdown2Change}
            className="w-full max-w-sm p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-fuchsia-400"
          >
            <option value="">{localized.nodeEditorSelectColumn || "Select a column..."}</option>
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
          {localized.nodeEditorOnlyForMultiple || "Only For Multiple"}
        </label>
      </div>

      <div className="mt-2 text-xs text-gray-400">{localized.nodeEditorOutput || "Output:"} GroupedText</div>

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
export const FilterNode: React.FC<{ data: FilterNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
  const [filters, setFilters] = useState<FilterRow[]>(
    data.filters && data.filters.length > 0
      ? data.filters
      : [{ column: "", value: "", not: false, operator: "AND" }],
  );
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);

  // Update column names from data.columnNames (set by connection) or from connected table metadata
  React.useEffect(() => {
    // First priority: use columnNames from data (set by connection propagation)
    if (data.columnNames && data.columnNames.length > 0) {
      setColumnNames(data.columnNames);
      return;
    }

    // Fallback: use connectedTableName metadata
    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(data.connectedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        // Update the node data with new column names
        const updateEvent = {
          detail: { nodeId: id, columnNames: fieldNames },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);
      }
    }
  }, [data.columnNames, data.connectedTableName, id]);

  const updateFilters = (newFilters: FilterRow[]) => {
    setFilters(newFilters);
    const updateEvent = {
      detail: { nodeId: id, filters: newFilters },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleAddFilter = () => {
    updateFilters([...filters, { column: "", value: "", not: false, operator: "AND" }]);
  };

  const handleRemoveFilter = (index: number) => {
    const newFilters = filters.filter((_, i) => i !== index);
    updateFilters(
      newFilters.length > 0 ? newFilters : [{ column: "", value: "", not: false, operator: "AND" }],
    );
  };

  const handleFilterChange = (index: number, field: keyof FilterRow, value: FilterRow[keyof FilterRow]) => {
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
      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} TableSelection</div>

      <div
        className="space-y-2 max-h-96 overflow-y-auto scrollable-node-content"
        onWheel={stopWheelPropagation}
      >
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
                <span className="text-xs text-gray-300">{localized.nodeEditorNot || "NOT"}</span>
              </label>
              {filters.length > 1 && (
                <button
                  onClick={() => handleRemoveFilter(index)}
                  className="ml-auto text-red-400 hover:text-red-300 text-xs"
                >
                  {localized.remove || "Remove"}
                </button>
              )}
            </div>

            <div className="mb-1">
              <label className="text-xs text-gray-400 block mb-1">
                {localized.nodeEditorColumnLabel || "Column:"}
              </label>
              {columnNames.length > 0 ? (
                <select
                  value={filter.column}
                  onChange={(e) => handleFilterChange(index, "column", e.target.value)}
                  className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-yellow-400"
                >
                  <option value="">{localized.nodeEditorSelectColumnShort || "Select column..."}</option>
                  {columnNames.map((columnName) => (
                    <option key={columnName} value={columnName}>
                      {columnName}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={filter.column}
                  onChange={(e) => handleFilterChange(index, "column", e.target.value)}
                  placeholder={localized.nodeEditorEnterColumnName || "Enter column name..."}
                  className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-yellow-400"
                />
              )}
            </div>

            <input
              type="text"
              value={filter.value}
              onChange={(e) => handleFilterChange(index, "value", e.target.value)}
              placeholder={localized.nodeEditorFilterValue || "Filter value..."}
              className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded mb-1 focus:outline-none focus:border-yellow-400"
            />

            {index < filters.length - 1 && (
              <select
                value={filter.operator}
                onChange={(e) => handleFilterChange(index, "operator", e.target.value as "AND" | "OR")}
                className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-yellow-400"
              >
                <option value="AND">{localized.nodeEditorAnd || "AND"}</option>
                <option value="OR">{localized.nodeEditorOr || "OR"}</option>
              </select>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handleAddFilter}
        className="mt-2 w-full px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded"
      >
        {localized.nodeEditorAddFilter || "Add Filter"}
      </button>

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400">{localized.nodeEditorMatchLabel || "Match:"}</div>
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
          <div className="text-xs text-gray-400">{localized.nodeEditorElseLabel || "Else:"}</div>
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
export const ReferenceTableLookupNode: React.FC<{ data: ReferenceTableLookupNodeData; id: string }> = ({
  data,
  id,
}) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
  const [selectedReferenceTable, setSelectedReferenceTable] = useState(data.selectedReferenceTable || "");
  const [referenceTableNames, setReferenceTableNames] = useState<string[]>(data.referenceTableNames || []);
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);
  const [includeBaseGame, setIncludeBaseGame] = useState(data.includeBaseGame !== false);

  // Update reference table names when connected table changes
  React.useEffect(() => {
    nodeEditorDebugLog(
      `ReferenceTableLookupNode ${id}: useEffect triggered, connectedTableName=${
        data.connectedTableName
      }, has DBNameToDBVersions=${!!data.DBNameToDBVersions}`,
    );

    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      nodeEditorDebugLog(
        `ReferenceTableLookupNode ${id}: Found ${tableVersions?.length || 0} version(s) for table ${
          data.connectedTableName
        }`,
      );

      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(data.connectedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
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
        nodeEditorDebugLog(
          `ReferenceTableLookupNode ${id}: Found ${refTableArray.length} reference table(s):`,
          refTableArray,
        );
        setReferenceTableNames(refTableArray);

        // Update the node data with reference table names and column names
        const updateEvent = {
          detail: {
            nodeId: id,
            referenceTableNames: refTableArray,
            columnNames: fieldNames,
          },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);
      }
    } else {
      nodeEditorDebugLog(`ReferenceTableLookupNode ${id}: Missing connectedTableName or DBNameToDBVersions`);
    }
  }, [data.connectedTableName, id]);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedReferenceTable(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, selectedReferenceTable: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleIncludeBaseGameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setIncludeBaseGame(newValue);

    const updateEvent = {
      detail: { nodeId: id, includeBaseGame: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} TableSelection</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorReferencedTable || "Referenced Table"}
        </label>
        <select
          value={selectedReferenceTable}
          onChange={handleDropdownChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
        >
          <option value="">
            {localized.nodeEditorSelectReferencedTable || "Select referenced table..."}
          </option>
          {referenceTableNames.map((tableName) => (
            <option key={tableName} value={tableName}>
              {tableName}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2">
        <label className="flex items-center text-xs text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={includeBaseGame}
            onChange={handleIncludeBaseGameChange}
            className="mr-2 w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-400"
          />
          {localized.nodeEditorIncludeBaseGameData || "Include base game data"}
        </label>
      </div>

      {referenceTableNames.length === 0 && data.connectedTableName && (
        <div className="text-xs text-yellow-300 mb-2 p-2 bg-gray-800 rounded">
          {localized.nodeEditorNoReferenceColumnsFound || "No reference columns found in the input table"}
        </div>
      )}

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} TableSelection (
        {localized.nodeEditorReferencedRows || "Referenced Rows"})
      </div>

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
export const ReverseReferenceLookupNode: React.FC<{ data: ReverseReferenceLookupNodeData; id: string }> = ({
  data,
  id,
}) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
  const [selectedReverseTable, setSelectedReverseTable] = useState(data.selectedReverseTable || "");
  const [reverseTableNames, setReverseTableNames] = useState<string[]>(data.reverseTableNames || []);
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);
  const [includeBaseGame, setIncludeBaseGame] = useState(data.includeBaseGame !== false);

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
    nodeEditorDebugLog(
      `ReverseReferenceLookupNode ${id}: useEffect triggered, connectedTableName=${
        data.connectedTableName
      }, has DBNameToDBVersions=${!!data.DBNameToDBVersions}`,
    );

    if (data.connectedTableName && data.DBNameToDBVersions) {
      const inputTableName = data.connectedTableName;
      nodeEditorDebugLog(`ReverseReferenceLookupNode ${id}: Looking for tables that reference ${inputTableName}`);

      // Find all tables that have fields referencing the input table
      const reverseTables = new Set<string>();
      for (const [tableName, tableVersions] of Object.entries(data.DBNameToDBVersions)) {
        if (tableVersions && tableVersions.length > 0) {
          const selectedVersion = getTableVersion(tableName, tableVersions, defaultTableVersions);
          const tableFields = selectedVersion?.fields || [];
          for (const field of tableFields) {
            // Check if this field references the input table
            if (
              field.is_reference &&
              field.is_reference.length > 0 &&
              field.is_reference[0] === inputTableName
            ) {
              reverseTables.add(tableName);
              break; // Found at least one reference, no need to check more fields
            }
          }
        }
      }

      const reverseTableArray = Array.from(reverseTables).sort();
      nodeEditorDebugLog(
        `ReverseReferenceLookupNode ${id}: Found ${reverseTableArray.length} table(s) that reference ${inputTableName}:`,
        reverseTableArray,
      );
      setReverseTableNames(reverseTableArray);

      // Set column names from the input table
      const tableVersions = data.DBNameToDBVersions[inputTableName];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(inputTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        // Auto-select the reverse table if there's only one option and nothing is selected
        let autoSelectedTable = data.selectedReverseTable;
        if (!autoSelectedTable && reverseTableArray.length === 1) {
          autoSelectedTable = reverseTableArray[0];
          setSelectedReverseTable(autoSelectedTable);
          nodeEditorDebugLog(
            `ReverseReferenceLookupNode ${id}: Auto-selected only available table: ${autoSelectedTable}`,
          );
        }

        // Update the node data with reverse table names and column names
        const updateEvent = {
          detail: {
            nodeId: id,
            reverseTableNames: reverseTableArray,
            columnNames: fieldNames,
            ...(autoSelectedTable && { selectedReverseTable: autoSelectedTable }),
          },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);
      }
    } else {
      nodeEditorDebugLog(`ReverseReferenceLookupNode ${id}: Missing connectedTableName or DBNameToDBVersions`);
    }
  }, [data.connectedTableName, id]);

  const handleDropdownChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedReverseTable(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, selectedReverseTable: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleIncludeBaseGameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setIncludeBaseGame(newValue);

    const updateEvent = {
      detail: { nodeId: id, includeBaseGame: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} TableSelection</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorReverseToTable || "Reverse to Table"}
        </label>
        <select
          value={selectedReverseTable}
          onChange={handleDropdownChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-indigo-400"
        >
          <option value="">
            {localized.nodeEditorSelectReverseTable || "Select table to reverse to..."}
          </option>
          {reverseTableNames.map((tableName) => (
            <option key={tableName} value={tableName}>
              {tableName}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2">
        <label className="flex items-center text-xs text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={includeBaseGame}
            onChange={handleIncludeBaseGameChange}
            className="mr-2 w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-400"
          />
          {localized.nodeEditorIncludeBaseGameData || "Include base game data"}
        </label>
      </div>

      {reverseTableNames.length === 0 && data.connectedTableName && (
        <div className="text-xs text-yellow-300 mb-2 p-2 bg-gray-800 rounded">
          {localized.nodeEditorNoReverseTablesFound || "No tables reference the input table"}
        </div>
      )}

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} TableSelection (
        {localized.nodeEditorReferencingRows || "Referencing Rows"})
      </div>

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
export const NumericAdjustmentNode: React.FC<{ data: NumericAdjustmentNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, textValue: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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

      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"} ColumnSelection
      </div>

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder={
          localized.nodeEditorEnterFormulaUsingX ||
          "Enter formula using x as input (e.g., x + 10, x * 1.5, x^2 + 3*x - 5)..."
        }
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-yellow-400"
      />

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} ChangedColumnSelection
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

// Custom MathMax node component that accepts ChangedColumnSelection and outputs ChangedColumnSelection
export const MathMaxNode: React.FC<{ data: MathMaxNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [textValue, setTextValue] = useState(data.textValue || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    const updateEvent = {
      detail: { nodeId: id, textValue: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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

      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"} ChangedColumnSelection
      </div>

      <div>
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorLowestValue || "Lowest Value"}
        </label>
        <input
          type="text"
          value={textValue}
          onChange={handleTextChange}
          placeholder={localized.nodeEditorEnterValueExample100 || "Enter value (e.g., 100)..."}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
        />
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} ChangedColumnSelection
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

// Custom MathCeil node component that accepts ChangedColumnSelection and outputs ChangedColumnSelection
export const MathCeilNode: React.FC<{ data: MathCeilNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  return (
    <div className="bg-gray-700 border-2 border-green-500 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-cyan-500"
        data-input-type="ChangedColumnSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>

      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"} ChangedColumnSelection
      </div>

      <div className="text-xs text-gray-300 italic">
        {localized.nodeEditorAppliesMathCeil || "Applies Math.ceil() to all values"}
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} ChangedColumnSelection
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

// Custom MergeChanges node component that accepts multiple ChangedColumnSelection inputs
export const MergeChangesNode: React.FC<{ data: MergeChangesNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
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
      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"} {inputCount}x ChangedColumnSelection
      </div>

      <div className="text-xs text-gray-300 p-2 bg-gray-800 rounded">
        {localized.nodeEditorMergeChangesDescription || "Merges multiple column changes into a single output"}
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} ChangedColumnSelection (
        {localized.nodeEditorCombined || "Combined"})
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

// Custom SaveChanges node component that accepts ChangedColumnSelection input
export const SaveChangesNode: React.FC<{ data: SaveChangesNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [textValue, setTextValue] = useState(data.textValue || "");
  const [packName, setPackName] = useState(data.packName || "");
  const [packedFileName, setPackedFileName] = useState(data.packedFileName || "");

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    const updateEvent = {
      detail: { nodeId: id, textValue: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handlePackNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setPackName(newValue);

    const updateEvent = {
      detail: { nodeId: id, packName: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handlePackedFileNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setPackedFileName(newValue);

    const updateEvent = {
      detail: { nodeId: id, packedFileName: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
        {localized.nodeEditorInput || "Input:"}{" "}
        {data.inputType ||
          localized.nodeEditorSaveChangesInputFallbackTypes ||
          "ChangedColumnSelection, Text, or TableSelection"}
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-300 block mb-1">
            {localized.nodeEditorPackNameOptional || "Pack name (optional):"}
          </label>
          <input
            type="text"
            value={packName}
            onChange={handlePackNameChange}
            placeholder={
              localized.nodeEditorLeaveBlankForAutoGeneratedName || "Leave blank for auto-generated name"
            }
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-green-400"
          />
        </div>

        <div>
          <label className="text-xs text-gray-300 block mb-1">
            {localized.nodeEditorPackedFileNameOptional || "Packed file name (optional):"}
          </label>
          <input
            type="text"
            value={packedFileName}
            onChange={handlePackedFileNameChange}
            placeholder={
              localized.nodeEditorLeaveBlankForAutoGeneratedName || "Leave blank for auto-generated name"
            }
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-green-400"
          />
        </div>

        <div>
          <label className="text-xs text-gray-300 block mb-1">
            {localized.nodeEditorAdditionalConfig || "Additional config:"}
          </label>
          <textarea
            value={textValue}
            onChange={handleTextChange}
            placeholder={
              localized.nodeEditorEnterAdditionalSaveConfiguration || "Enter additional save configuration..."
            }
            className="w-full h-16 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-green-400"
          />
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorFinalSaveOperation || "Final save operation"}
      </div>
    </div>
  );
};

// Custom GetCounterColumn node component
export const GetCounterColumnNode: React.FC<{ data: GetCounterColumnNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
  const [selectedTable, setSelectedTable] = useState(data.selectedTable || "");
  const [selectedColumn, setSelectedColumn] = useState(data.selectedColumn || "");
  const [newColumnName, setNewColumnName] = useState(data.newColumnName || "");
  const [tableNames, setTableNames] = useState<string[]>(data.tableNames || []);
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);
  const [inputColumnNames, setInputColumnNames] = useState<string[]>([]);

  // Sync state with data prop changes
  React.useEffect(() => {
    if (data.selectedTable !== undefined) setSelectedTable(data.selectedTable);
    if (data.selectedColumn !== undefined) setSelectedColumn(data.selectedColumn);
    if (data.newColumnName !== undefined) setNewColumnName(data.newColumnName);
    if (data.tableNames !== undefined) setTableNames(data.tableNames);
    if (data.columnNames !== undefined) setColumnNames(data.columnNames);
  }, [data.selectedTable, data.selectedColumn, data.newColumnName, data.tableNames, data.columnNames]);

  // Update column names when selected table changes
  React.useEffect(() => {
    if (selectedTable && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[selectedTable];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(selectedTable, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        // Filter to only numeric columns
        const numericFields = tableFields.filter(
          (field) =>
            field.field_type === "I32" ||
            field.field_type === "I64" ||
            field.field_type === "F32" ||
            field.field_type === "F64",
        );
        const fieldNames = numericFields.map((field) => field.name);
        setColumnNames(fieldNames);

        const updateEvent = {
          detail: { nodeId: id, columnNames: fieldNames },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);
      }
    }
  }, [selectedTable, data.DBNameToDBVersions, id]);

  const handleTableChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedTable(newValue);
    setSelectedColumn(""); // Reset column selection when table changes

    const updateEvent = {
      detail: { nodeId: id, selectedTable: newValue, selectedColumn: "" },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedColumn(newValue);

    const updateEvent = {
      detail: { nodeId: id, selectedColumn: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleNewColumnNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setNewColumnName(newValue);
    setInputColumnNames([newValue]);

    const updateEvent = {
      detail: { nodeId: id, newColumnName: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  // Sync inputColumnNames to node data whenever it changes (to persist when saved)
  React.useEffect(() => {
    if (
      inputColumnNames.length > 0 &&
      JSON.stringify(inputColumnNames) !== JSON.stringify(data.inputColumnNames)
    ) {
      nodeEditorDebugLog(`[GetCounterColumn ${id}] Syncing inputColumnNames to node data:`, inputColumnNames);
      dispatchNodeDataUpdate(data, { nodeId: id, inputColumnNames },);
    }
  }, [inputColumnNames, id]);

  return (
    <div className="bg-gray-700 border-2 border-teal-600 rounded-lg p-4 min-w-[250px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-blue-500"
        data-input-type="PackFiles"
      />

      <div className="text-white font-medium text-sm mb-2">
        {data.label || localized.nodeEditorGetCounterColumn || "Get Counter Column"}
      </div>

      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} PackFiles</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorTableLabel || "Table:"}
        </label>
        <select
          value={selectedTable}
          onChange={handleTableChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-teal-400"
        >
          <option value="">{localized.nodeEditorSelectTable || "Select a table..."}</option>
          {tableNames.map((tableName) => (
            <option key={tableName} value={tableName}>
              {tableName}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorNumericColumnLabel || "Numeric Column:"}
        </label>
        <select
          value={selectedColumn}
          onChange={handleColumnChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-teal-400"
          disabled={!selectedTable}
        >
          <option value="">{localized.nodeEditorSelectColumn || "Select a column..."}</option>
          {columnNames.map((columnName) => (
            <option key={columnName} value={columnName}>
              {columnName}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorNewColumnNameLabel || "New Column Name:"}
        </label>
        <input
          type="text"
          value={newColumnName}
          onChange={handleNewColumnNameChange}
          placeholder={localized.nodeEditorCounterValueExample || "e.g., counter_value"}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-teal-400"
        />
      </div>

      <div className="text-xs text-gray-300 italic my-2">
        {localized.nodeEditorCollectsValuesDescription ||
          "Collects values from selected column across all tables"}
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} TableSelection
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

// Custom DumpToTSV node component that exports table data to TSV file
export const DumpToTSVNode: React.FC<{ data: DumpToTSVNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [filename, setFilename] = useState(data.filename || "");
  const [openInWindows, setOpenInWindows] = useState(!!data.openInWindows);

  const handleFilenameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setFilename(newValue);

    const updateEvent = {
      detail: { nodeId: id, filename: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  return (
    <div className="bg-gray-700 border-2 border-blue-500 rounded-lg p-4 min-w-[250px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection,ChangedColumnSelection"
      />

      <div className="text-white font-medium text-sm mb-2">
        {data.label || localized.nodeEditorDumpToTSV || "Dump to TSV"}
      </div>

      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"} TableSelection / ChangedColumnSelection
      </div>

      <div>
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorFilenameOptional || "Filename (optional):"}
        </label>
        <input
          type="text"
          value={filename}
          onChange={handleFilenameChange}
          placeholder={
            localized.nodeEditorLeaveBlankForAutoGeneratedName || "Leave blank for auto-generated name"
          }
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-400"
        />
      </div>

      <div className="mt-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={openInWindows}
            onChange={(event) => {
              const newValue = event.target.checked;
              setOpenInWindows(newValue);

              const updateEvent = {
                detail: { nodeId: id, openInWindows: newValue },
              };
              dispatchNodeDataUpdate(data, updateEvent.detail);
            }}
            className="w-4 h-4"
          />
          <span className="text-xs text-gray-300">
            {localized.nodeEditorOpenFileInWindows || "Open file in Windows"}
          </span>
        </label>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorExportsToTSVForInspection || "Exports to TSV for inspection"}
      </div>
    </div>
  );
};

// Custom TextSurround node component that accepts Text, Text Lines, or GroupedText input and outputs the same type
export const TextSurroundNode: React.FC<{ data: TextSurroundNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [textValue, setTextValue] = useState(data.textValue || "");
  const [groupedTextSelection, setGroupedTextSelection] = useState<"Text" | "Text Lines">(
    data.groupedTextSelection || "Text",
  );

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, textValue: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleGroupedTextSelectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value as "Text" | "Text Lines";
    setGroupedTextSelection(newValue);

    // Update the node data through the editor action bridge
    // Also update the outputType to match the selection
    const updateEvent = {
      detail: { nodeId: id, groupedTextSelection: newValue, outputType: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
        {localized.nodeEditorInput || "Input:"}{" "}
        {data.inputType || localized.nodeEditorTextInputTypeFallback || "Text, Text Lines, or GroupedText"}
      </div>

      {isGroupedTextInput && (
        <div className="mb-2">
          <label className="text-xs text-gray-300 block mb-1">
            {localized.nodeEditorUseFromGroupedText || "Use from GroupedText:"}
          </label>
          <select
            value={groupedTextSelection}
            onChange={handleGroupedTextSelectionChange}
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-rose-400"
          >
            <option value="Text">{localized.nodeEditorText || "Text"}</option>
            <option value="Text Lines">{localized.nodeEditorTextLines || "Text Lines"}</option>
          </select>
        </div>
      )}

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder={
          localized.nodeEditorEnterSurroundTextConfiguration || "Enter surround text configuration..."
        }
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-rose-400"
      />

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"}{" "}
        {isGroupedTextInput
          ? localized.nodeEditorGroupedText || "GroupedText"
          : data.outputType === "Text Lines"
            ? localized.nodeEditorTextLines || "Text Lines"
            : data.outputType === "Text"
              ? localized.nodeEditorText || "Text"
              : data.outputType || localized.nodeEditorTextOrTextLines || "Text or Text Lines"}
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
export const AppendTextNode: React.FC<{ data: AppendTextNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [beforeText, setBeforeText] = useState(data.beforeText || "");
  const [afterText, setAfterText] = useState(data.afterText || "");
  const [groupedTextSelection, setGroupedTextSelection] = useState<"Text" | "Text Lines">(
    data.groupedTextSelection || "Text",
  );

  const handleBeforeTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setBeforeText(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, beforeText: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleAfterTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setAfterText(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, afterText: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleGroupedTextSelectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value as "Text" | "Text Lines";
    setGroupedTextSelection(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, groupedTextSelection: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
        {localized.nodeEditorInput || "Input:"}{" "}
        {data.inputType || localized.nodeEditorTextInputTypeFallback || "Text, Text Lines, or GroupedText"}
      </div>

      {isGroupedTextInput && (
        <div className="mb-2">
          <label className="text-xs text-gray-300 block mb-1">
            {localized.nodeEditorUseFromGroupedText || "Use from GroupedText:"}
          </label>
          <select
            value={groupedTextSelection}
            onChange={handleGroupedTextSelectionChange}
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
          >
            <option value="Text">{localized.nodeEditorText || "Text"}</option>
            <option value="Text Lines">{localized.nodeEditorTextLines || "Text Lines"}</option>
          </select>
        </div>
      )}

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorBeforeTextLabel || "Before Text:"}
        </label>
        <input
          type="text"
          value={beforeText}
          onChange={handleBeforeTextChange}
          placeholder={localized.nodeEditorTextToAddBefore || "Text to add before..."}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
        />
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorAfterTextLabel || "After Text:"}
        </label>
        <input
          type="text"
          value={afterText}
          onChange={handleAfterTextChange}
          placeholder={localized.nodeEditorTextToAddAfter || "Text to add after..."}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-purple-400"
        />
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"}{" "}
        {isGroupedTextInput
          ? localized.nodeEditorGroupedText || "GroupedText"
          : data.outputType === "Text Lines"
            ? localized.nodeEditorTextLines || "Text Lines"
            : data.outputType === "Text"
              ? localized.nodeEditorText || "Text"
              : data.outputType || localized.nodeEditorTextOrTextLines || "Text or Text Lines"}
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
export const TextJoinNode: React.FC<{ data: TextJoinNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [textValue, setTextValue] = useState(data.textValue || "");
  const [groupedTextSelection, setGroupedTextSelection] = useState<"Text" | "Text Lines">(
    data.groupedTextSelection || "Text Lines",
  );

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setTextValue(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, textValue: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleGroupedTextSelectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value as "Text" | "Text Lines";
    setGroupedTextSelection(newValue);

    // Update the node data through the editor action bridge
    const updateEvent = {
      detail: { nodeId: id, groupedTextSelection: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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

      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"}{" "}
        {data.inputType || localized.nodeEditorTextLinesOrGroupedText || "Text Lines or GroupedText"}
      </div>

      {isGroupedTextInput && (
        <div className="mb-2">
          <label className="text-xs text-gray-300 block mb-1">
            {localized.nodeEditorUseFromGroupedText || "Use from GroupedText:"}
          </label>
          <select
            value={groupedTextSelection}
            onChange={handleGroupedTextSelectionChange}
            className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-sky-400"
          >
            <option value="Text">{localized.nodeEditorText || "Text"}</option>
            <option value="Text Lines">{localized.nodeEditorTextLines || "Text Lines"}</option>
          </select>
        </div>
      )}

      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder={
          localized.nodeEditorEnterJoinConfiguration || "Enter join configuration (separator, etc.)..."
        }
        className="w-full h-20 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-sky-400"
      />

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} {localized.nodeEditorText || "Text"}
      </div>

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
export const GroupedColumnsToTextNode: React.FC<{ data: GroupedColumnsToTextNodeData; id: string }> = ({
  data,
  id,
}) => {
  const localized = useLocalizations();
  const [pattern, setPattern] = useState(data.pattern || "{0}: {1}");
  const [joinSeparator, setJoinSeparator] = useState(data.joinSeparator || "\\n");

  const handlePatternChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setPattern(newValue);

    const updateEvent = {
      detail: { nodeId: id, pattern: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleJoinSeparatorChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setJoinSeparator(newValue);

    const updateEvent = {
      detail: { nodeId: id, joinSeparator: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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

      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"} {localized.nodeEditorGroupedText || "GroupedText"}
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorPatternKeyValuesLabel || "Pattern ({0} = key, {1} = values):"}
        </label>
        <textarea
          value={pattern}
          onChange={handlePatternChange}
          placeholder="{0}: {1}"
          className="w-full h-16 p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded resize-none focus:outline-none focus:border-emerald-400"
        />
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorJoinSeparatorUseNewlineLabel || "Join separator (use \\n for newline):"}
        </label>
        <input
          type="text"
          value={joinSeparator}
          onChange={handleJoinSeparatorChange}
          placeholder="\n"
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-emerald-400"
        />
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} {localized.nodeEditorText || "Text"}
      </div>

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
export const IndexTableNode: React.FC<{ data: IndexTableNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
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
        const selectedVersion = getTableVersion(data.connectedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];

        // Prefer explicitly-provided columnNames (e.g. from generaterows with a specific tableVersion)
        const fieldNames =
          data.columnNames && data.columnNames.length > 0
            ? data.columnNames
            : tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        const updateEvent = {
          detail: { nodeId: id, columnNames: fieldNames },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);

        // Auto-select key columns if no selection exists (uses schema metadata regardless)
        if (indexColumns.length === 0) {
          const keyColumns = tableFields.filter((field) => field.is_key).map((field) => field.name);
          if (keyColumns.length > 0) {
            setIndexColumns(keyColumns);
            const updateEvent2 = {
              detail: { nodeId: id, indexColumns: keyColumns },
            };
            dispatchNodeDataUpdate(data, updateEvent2.detail);
          }
        }
      }
    }
  }, [data.connectedTableName, data.columnNames, id]);

  const handleColumnToggle = (columnName: string) => {
    const newIndexColumns = indexColumns.includes(columnName)
      ? indexColumns.filter((col) => col !== columnName)
      : [...indexColumns, columnName];

    setIndexColumns(newIndexColumns);
    const updateEvent = {
      detail: { nodeId: id, indexColumns: newIndexColumns },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
      <div className="text-xs text-gray-400 mb-2">{localized.nodeEditorInput || "Input:"} TableSelection</div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorIndexColumnsSelectMultipleLabel || "Index Columns (select multiple):"}
        </label>
        <div
          className="max-h-40 overflow-y-auto bg-gray-800 border border-gray-600 rounded p-2 scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {columnNames.length === 0 ? (
            <div className="text-xs text-gray-500 italic">
              {localized.nodeEditorConnectTableToSeeColumns || "Connect a table to see columns"}
            </div>
          ) : (
            columnNames.map((columnName) => (
              <label
                key={columnName}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-700 p-1 rounded"
              >
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

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorSelectedLabel || "Selected:"} {indexColumns.length}{" "}
        {localized.nodeEditorColumnsCountSuffix || "column(s)"}
      </div>
      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} {localized.nodeEditorIndexedTable || "IndexedTable"}
      </div>

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
export const LookupNode: React.FC<{ data: LookupNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
  const [lookupColumn, setLookupColumn] = useState(data.lookupColumn || "");
  const [indexJoinColumn, setIndexJoinColumn] = useState(data.indexJoinColumn || data.indexColumns?.[0] || "");
  const [joinType, setJoinType] = useState<"inner" | "left" | "nested" | "cross">(data.joinType || "inner");
  const [columnNames, setColumnNames] = useState<string[]>(
    data.columnNames ? Array.from(new Set(data.columnNames)) : [],
  );
  const [sourceColumnNames, setSourceColumnNames] = useState<string[]>([]);
  const [indexedColumnNames, setIndexedColumnNames] = useState<string[]>([]);
  const [isIndexedTableInput, setIsIndexedTableInput] = useState(true);
  const [schemaWarning, setSchemaWarning] = useState<string>("");

  // Sync local state with prop changes
  React.useEffect(() => {
    if (data.lookupColumn !== undefined) setLookupColumn(data.lookupColumn);
    if (data.joinType !== undefined) setJoinType(data.joinType);
    if (data.indexJoinColumn !== undefined) {
      setIndexJoinColumn(data.indexJoinColumn);
    } else if (data.indexColumns && data.indexColumns.length > 0) {
      // Fallback: use first element of indexColumns if indexJoinColumn not set
      setIndexJoinColumn(data.indexColumns[0]);
    }
  }, [data.lookupColumn, data.joinType, data.indexJoinColumn, data.indexColumns]);

  // Detect whether the input-index connection is from IndexedTable or TableSelection
  React.useEffect(() => {
    // Check if we have indexColumns set (indicates TableSelection input with auto-indexing)
    const hasIndexColumns = !!(data.indexColumns && data.indexColumns.length > 0);
    // Or check if indexedInputType is explicitly TableSelection
    const inputTypeIsTableSelection = data.indexedInputType === "TableSelection";

    setIsIndexedTableInput(!hasIndexColumns && !inputTypeIsTableSelection);
  }, [data.indexColumns, data.indexedInputType]);

  // Ensure outputType is synced with joinType on mount
  React.useEffect(() => {
    const expectedOutputType = joinType === "nested" ? "NestedTableSelection" : "TableSelection";
    if (data.outputType !== expectedOutputType) {
      const updateEvent = {
        detail: { nodeId: id, outputType: expectedOutputType },
      };
      dispatchNodeDataUpdate(data, updateEvent.detail);
    }
  }, [joinType, data.outputType, id]);

  // Ensure inputType is always correct, but allow indexedInputType to be either IndexedTable or TableSelection
  React.useEffect(() => {
    const needsUpdate = data.inputType !== "TableSelection";

    if (needsUpdate) {
      const updateEvent = {
        detail: {
          nodeId: id,
          inputType: "TableSelection",
        },
      };
      dispatchNodeDataUpdate(data, updateEvent.detail);
    }
  }, [data.inputType, id]);

  // Track source table column names (from input-source connection)
  React.useEffect(() => {
    // Prefer sourceInputColumns (from connection) over everything else
    // This ensures we get the actual output columns from the connected node,
    // including new columns from addnewcolumn, transformations, etc.
    if (data.sourceInputColumns && data.sourceInputColumns.length > 0) {
      setSourceColumnNames(data.sourceInputColumns);
      return;
    }

    // Fallback to schema-based extraction for direct table connections
    const inputColumns = data.columnNames;

    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(data.connectedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setSourceColumnNames(fieldNames);
      } else if (inputColumns && inputColumns.length > 0) {
        // For synthetic tables, just use the input columns directly
        setSourceColumnNames(inputColumns);
      }
    } else if (inputColumns && inputColumns.length > 0) {
      // If no DBNameToDBVersions at all, use input columns as-is
      setSourceColumnNames(inputColumns);
    }
  }, [data.connectedTableName, data.sourceInputColumns]);

  // Track indexed table column names (from input-index connection)
  React.useEffect(() => {
    // Use indexedTableColumns if already provided from connection (new way - TableSelection)
    if (data.indexedTableColumns && data.indexedTableColumns.length > 0) {
      setIndexedColumnNames(data.indexedTableColumns);
      return;
    }

    // Use indexedTableColumnNames if already provided from connection (old way - IndexedTable)
    if (data.indexedTableColumnNames && data.indexedTableColumnNames.length > 0) {
      setIndexedColumnNames(data.indexedTableColumnNames);
      return;
    }

    // Otherwise look up from indexedTableName using DBNameToDBVersions
    const indexedTableName = data.indexedTableName || data.connectedIndexTableName;
    if (indexedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[indexedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(indexedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setIndexedColumnNames(fieldNames);
        return;
      }
    }

    // Fallback: extract from columnNames by removing the source table prefix
    // This handles the case where we loaded from JSON and lost the metadata
    if (
      indexedColumnNames.length === 0 &&
      data.columnNames &&
      data.columnNames.length > 0 &&
      data.connectedTableName
    ) {
      const sourcePrefix = `${data.connectedTableName}_`;
      // Get columns that don't have the source prefix (these are from the indexed table)
      const indexedColsWithPrefix = data.columnNames.filter(
        (col: string) => !col.startsWith(sourcePrefix) && !col.startsWith("agg_"),
      );

      if (indexedColsWithPrefix.length > 0) {
        // Extract the table name from the first column
        // Pattern: tablename_columnname where tablename ends with _tables
        const firstCol = indexedColsWithPrefix[0];
        const tableMatch = firstCol.match(/^(.+?_tables)_/);
        if (tableMatch) {
          const extractedTableName = tableMatch[1];
          // Update indexedTableName if not already set
          if (!data.indexedTableName) {
            const updateEvent = {
              detail: { nodeId: id, indexedTableName: extractedTableName },
            };
            dispatchNodeDataUpdate(data, updateEvent.detail);
          }
        }

        // Strip the table prefix from each column
        const indexedCols = indexedColsWithPrefix.map((col: string) => {
          const match = col.match(/^.+?_tables_(.+)$/);
          return match ? match[1] : col;
        });

        setIndexedColumnNames(indexedCols);
      }
    }
  }, [
    data.connectedIndexTableName,
    data.indexedTableColumnNames,
    data.indexedTableColumns,
    data.indexedTableName,
    data.columnNames,
    data.connectedTableName,
    indexedColumnNames.length,
  ]);

  // Compute output column names based on join type
  React.useEffect(() => {
    let newColumns: string[] = [];

    if (joinType === "nested") {
      // For nested joins, output columns are just source columns (lookup is nested)
      if (sourceColumnNames.length > 0) {
        newColumns = sourceColumnNames;
      }
    } else {
      // For inner/left/cross joins, output is prefixed source + prefixed indexed columns
      if (sourceColumnNames.length > 0 && indexedColumnNames.length > 0) {
        const sourceTableName = data.connectedTableName || "source";
        const indexedTableName = data.indexedTableName || data.connectedIndexTableName || "indexed";

        const prefixedSourceColumns = sourceColumnNames.map((col) => `${sourceTableName}_${col}`);
        const prefixedIndexedColumns = indexedColumnNames.map((col) => `${indexedTableName}_${col}`);
        newColumns = [...prefixedSourceColumns, ...prefixedIndexedColumns];
      } else if (sourceColumnNames.length > 0) {
        // Fallback: just use source columns if indexed not available yet
        newColumns = sourceColumnNames;
      }
    }

    // Only update if the columns have actually changed
    if (newColumns.length > 0) {
      // Deduplicate columns to prevent accumulation
      const uniqueColumns = Array.from(new Set(newColumns));

      const columnsChanged =
        uniqueColumns.length !== columnNames.length ||
        uniqueColumns.some((col, idx) => col !== columnNames[idx]);

      if (columnsChanged) {
        setColumnNames(uniqueColumns);
        const updateEvent = {
          detail: { nodeId: id, columnNames: uniqueColumns },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);
      }
    }
  }, [
    sourceColumnNames,
    indexedColumnNames,
    joinType,
    data.connectedTableName,
    data.indexedTableName,
    data.connectedIndexTableName,
    columnNames,
    id,
  ]);

  // Validate schema relationships and show warning if no foreign key reference exists
  React.useEffect(() => {
    // Clear warning if we don't have all the required information
    if (!lookupColumn || !indexJoinColumn || !data.connectedTableName || !data.DBNameToDBVersions) {
      setSchemaWarning("");
      return;
    }

    const indexedTableName = data.indexedTableName || data.connectedIndexTableName;
    if (!indexedTableName) {
      setSchemaWarning("");
      return;
    }

    // Look up the source table schema
    const sourceTableVersions = data.DBNameToDBVersions[data.connectedTableName];
    if (!sourceTableVersions || sourceTableVersions.length === 0) {
      setSchemaWarning("");
      return;
    }

    const defaultVersion = getTableVersion(
      data.connectedTableName,
      sourceTableVersions,
      defaultTableVersions,
    );
    const version = defaultVersion ?? sourceTableVersions[0];
    // Find the lookup column in the source table schema
    const lookupField = version.fields?.find((field) => field.name === lookupColumn);
    if (!lookupField) {
      setSchemaWarning("");
      return;
    }

    // Check if the lookup column has a reference to the indexed table
    // is_reference format: [table1, column1, table2, column2, ...]
    if (lookupField.is_reference && lookupField.is_reference.length > 0) {
      // Parse the reference pairs
      let hasValidReference = false;
      let hasTableReference = false;
      const referencedColumns: string[] = [];

      for (let i = 0; i < lookupField.is_reference.length; i += 2) {
        const refTable = lookupField.is_reference[i];
        const refColumn = lookupField.is_reference[i + 1];

        if (refTable === indexedTableName) {
          hasTableReference = true;
          referencedColumns.push(refColumn);
          if (refColumn === indexJoinColumn) {
            hasValidReference = true;
          }
        }
      }

      if (!hasValidReference) {
        if (hasTableReference) {
          const template =
            localized.nodeEditorWarningColumnReferencesTableButNotColumn ||
            'Warning: Column "{{lookupColumn}}" references table "{{indexedTableName}}", but not column "{{indexJoinColumn}}". Expected reference columns: {{referencedColumns}}';
          setSchemaWarning(
            template
              .replace("{{lookupColumn}}", lookupColumn)
              .replace("{{indexedTableName}}", indexedTableName)
              .replace("{{indexJoinColumn}}", indexJoinColumn)
              .replace("{{referencedColumns}}", referencedColumns.join(", ")),
          );
        } else {
          const template =
            localized.nodeEditorWarningColumnDoesNotHaveSchemaReferenceToTable ||
            'Warning: Column "{{lookupColumn}}" does not have a schema reference to table "{{indexedTableName}}". This join may produce unexpected results.';
          setSchemaWarning(
            template
              .replace("{{lookupColumn}}", lookupColumn)
              .replace("{{indexedTableName}}", indexedTableName),
          );
        }
      } else {
        setSchemaWarning(""); // Valid reference found
      }
    } else {
      const template =
        localized.nodeEditorWarningColumnDoesNotHaveAnySchemaReferences ||
        'Warning: Column "{{lookupColumn}}" does not have any schema references. This join may produce unexpected results.';
      setSchemaWarning(template.replace("{{lookupColumn}}", lookupColumn));
    }
  }, [
    lookupColumn,
    indexJoinColumn,
    data.connectedTableName,
    data.indexedTableName,
    data.connectedIndexTableName,
    data.DBNameToDBVersions,
    localized,
  ]);

  const handleLookupColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setLookupColumn(newValue);
    const updateEvent = {
      detail: { nodeId: id, lookupColumn: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleIndexJoinColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setIndexJoinColumn(newValue);
    const updateEvent = {
      detail: { nodeId: id, indexJoinColumn: newValue, indexColumns: [newValue] },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleJoinTypeChange = (newType: "inner" | "left" | "nested" | "cross") => {
    setJoinType(newType);
    const newOutputType = newType === "nested" ? "NestedTableSelection" : "TableSelection";
    const updateEvent = {
      detail: { nodeId: id, joinType: newType, outputType: newOutputType },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
        <div>{localized.nodeEditorSourceLabel || "Source:"} TableSelection</div>
        <div>
          {localized.nodeEditorIndexLabel || "Index:"}{" "}
          {isIndexedTableInput ? localized.nodeEditorIndexedTable || "IndexedTable" : "TableSelection"}
        </div>
      </div>

      {joinType !== "cross" && (
        <>
          {isIndexedTableInput ? (
            // Single dropdown for IndexedTable input (old way)
            <div className="mb-2">
              <label className="text-xs text-gray-300 block mb-1">
                {localized.nodeEditorLookupColumnLabel || "Lookup Column:"}
              </label>
              <select
                value={lookupColumn}
                onChange={handleLookupColumnChange}
                className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-cyan-400"
              >
                <option value="">{localized.nodeEditorSelectColumnShort || "Select column..."}</option>
                {sourceColumnNames.map((columnName) => (
                  <option key={columnName} value={columnName}>
                    {columnName}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            // Two dropdowns for TableSelection input (new way)
            <>
              <div className="mb-2">
                <label className="text-xs text-gray-300 block mb-1">
                  {localized.nodeEditorSourceColumnLabel || "Source Column:"}
                </label>
                <select
                  value={lookupColumn}
                  onChange={handleLookupColumnChange}
                  className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-cyan-400"
                >
                  <option value="">{localized.nodeEditorSelectColumnShort || "Select column..."}</option>
                  {sourceColumnNames.map((columnName) => (
                    <option key={columnName} value={columnName}>
                      {columnName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-2">
                <label className="text-xs text-gray-300 block mb-1">
                  {localized.nodeEditorIndexColumnLabel || "Index Column:"}
                </label>
                <select
                  value={indexJoinColumn}
                  onChange={handleIndexJoinColumnChange}
                  className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-cyan-400"
                >
                  <option value="">{localized.nodeEditorSelectColumnShort || "Select column..."}</option>
                  {indexedColumnNames.map((columnName) => (
                    <option key={columnName} value={columnName}>
                      {columnName}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </>
      )}

      {schemaWarning && (
        <div className="mb-3 p-2 bg-yellow-900 border border-yellow-600 rounded text-xs text-yellow-200">
          {schemaWarning}
        </div>
      )}

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorJoinTypeLabel || "Join Type:"}
        </label>
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={joinType === "inner"}
              onChange={() => handleJoinTypeChange("inner")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">{localized.nodeEditorInnerJoin || "Inner Join"}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={joinType === "left"}
              onChange={() => handleJoinTypeChange("left")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">{localized.nodeEditorLeftJoin || "Left Join"}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={joinType === "nested"}
              onChange={() => handleJoinTypeChange("nested")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">
              {localized.nodeEditorNestedJoin || "Nested (1-to-many)"}
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={joinType === "cross"}
              onChange={() => handleJoinTypeChange("cross")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">
              {localized.nodeEditorCrossJoin || "Cross Join (Cartesian Product)"}
            </span>
          </label>
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"}{" "}
        {outputType === "NestedTableSelection"
          ? localized.nodeEditorNestedTableSelection || "NestedTableSelection"
          : localized.nodeEditorTableSelection || "TableSelection"}
      </div>

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
export const FlattenNestedNode: React.FC<{ data: FlattenNestedNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  return (
    <div className="bg-gray-700 border-2 border-gray-400 rounded-lg p-4 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-cyan-500"
        data-input-type="NestedTableSelection"
      />

      <div className="text-white font-medium text-sm mb-2">{data.label}</div>
      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"}{" "}
        {localized.nodeEditorNestedTableSelection || "NestedTableSelection"}
      </div>

      <div className="text-xs text-gray-300 italic my-3">
        {localized.nodeEditorFlattenNestedDescription || "Expands nested arrays into separate flat rows"}
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} {localized.nodeEditorTableSelection || "TableSelection"}
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

// Extract Table Node - Filters columns by prefix and removes prefix
export const ExtractTableNode: React.FC<{ data: ExtractTableNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [tablePrefix, setTablePrefix] = useState(data.tablePrefix || "");
  const [tablePrefixes, setTablePrefixes] = useState<string[]>(data.tablePrefixes || []);

  // Sync local state with prop changes
  React.useEffect(() => {
    if (data.tablePrefix !== undefined) setTablePrefix(data.tablePrefix);
    if (data.tablePrefixes !== undefined) setTablePrefixes(data.tablePrefixes);
  }, [data.tablePrefix, data.tablePrefixes]);

  // Auto-detect prefixes from connected table columns
  React.useEffect(() => {
    // Analyze the actual column names to detect table prefixes
    if (data.columnNames && data.columnNames.length > 0) {
      const prefixSet = new Set<string>();

      for (const columnName of data.columnNames) {
        // Look for pattern like "tablename_columnname"
        // Extract everything up to and including "_tables_"
        const match = columnName.match(/^(.+?_tables)_/);
        if (match) {
          prefixSet.add(match[1]);
        }
      }

      const detectedPrefixes = Array.from(prefixSet).sort();

      // Only update if the prefixes have changed
      if (JSON.stringify(detectedPrefixes) !== JSON.stringify(tablePrefixes)) {
        setTablePrefixes(detectedPrefixes);

        const updateEvent = {
          detail: { nodeId: id, tablePrefixes: detectedPrefixes },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);
      }
    }
  }, [data.columnNames, id, tablePrefixes]);

  const handlePrefixChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setTablePrefix(newValue);
    const updateEvent = {
      detail: { nodeId: id, tablePrefix: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"} {localized.nodeEditorTableSelection || "TableSelection"}
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorExtractTableLabel || "Extract Table:"}
        </label>
        <select
          value={tablePrefix}
          onChange={handlePrefixChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-400"
        >
          <option value="">{localized.nodeEditorSelectPrefix || "Select prefix..."}</option>
          {tablePrefixes.map((prefix) => (
            <option key={prefix} value={prefix}>
              {prefix}
            </option>
          ))}
        </select>
      </div>

      <div className="text-xs text-gray-300 italic my-2">
        {localized.nodeEditorExtractTableDescription || "Filters to columns with prefix and removes it"}
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} {localized.nodeEditorTableSelection || "TableSelection"}
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

// Aggregate Nested Node - Performs aggregations on nested arrays
export const AggregateNestedNode: React.FC<{ data: AggregateNestedNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
  const [aggregateColumn, setAggregateColumn] = useState(data.aggregateColumn || "");
  const [aggregateType, setAggregateType] = useState<"min" | "max" | "sum" | "avg" | "count">(
    data.aggregateType || "min",
  );
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);
  const [filterColumn, setFilterColumn] = useState(data.filterColumn || "");
  const [filterOperator, setFilterOperator] = useState<
    "equals" | "notEquals" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual"
  >(data.filterOperator || "equals");
  const [filterValue, setFilterValue] = useState(data.filterValue || "");

  // Sync local state with prop changes
  React.useEffect(() => {
    if (data.aggregateColumn !== undefined) setAggregateColumn(data.aggregateColumn);
    if (data.aggregateType !== undefined) setAggregateType(data.aggregateType);
  }, [data.aggregateColumn, data.aggregateType]);

  // Update column names when connected table changes
  React.useEffect(() => {
    if (data.columnNames && data.columnNames.length > 0) {
      setColumnNames(data.columnNames);
      return;
    }
    if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(data.connectedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);

        const updateEvent = {
          detail: { nodeId: id, columnNames: fieldNames },
        };
        dispatchNodeDataUpdate(data, updateEvent.detail);
      }
    }
  }, [data.connectedTableName, data.columnNames, id]);

  const handleColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setAggregateColumn(newValue);
    const updateEvent = {
      detail: { nodeId: id, aggregateColumn: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleTypeChange = (newType: "min" | "max" | "sum" | "avg" | "count") => {
    setAggregateType(newType);
    const updateEvent = {
      detail: { nodeId: id, aggregateType: newType },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleFilterColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setFilterColumn(newValue);
    const updateEvent = {
      detail: { nodeId: id, filterColumn: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleFilterOperatorChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value as
      | "equals"
      | "notEquals"
      | "greaterThan"
      | "lessThan"
      | "greaterThanOrEqual"
      | "lessThanOrEqual";
    setFilterOperator(newValue);
    const updateEvent = {
      detail: { nodeId: id, filterOperator: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
  };

  const handleFilterValueChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setFilterValue(newValue);
    const updateEvent = {
      detail: { nodeId: id, filterValue: newValue },
    };
    dispatchNodeDataUpdate(data, updateEvent.detail);
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
      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"}{" "}
        {localized.nodeEditorNestedTableSelection || "NestedTableSelection"}
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorAggregateColumnLabel || "Aggregate Column:"}
        </label>
        <select
          value={aggregateColumn}
          onChange={handleColumnChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-orange-400"
        >
          <option value="">{localized.nodeEditorSelectColumnShort || "Select column..."}</option>
          {columnNames.map((columnName) => (
            <option key={columnName} value={columnName}>
              {columnName}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorAggregationTypeLabel || "Aggregation Type:"}
        </label>
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "min"}
              onChange={() => handleTypeChange("min")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">
              {localized.nodeEditorAggregationMinKeepRow || "MIN (Keep Row)"}
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "max"}
              onChange={() => handleTypeChange("max")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">
              {localized.nodeEditorAggregationMaxKeepRow || "MAX (Keep Row)"}
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "sum"}
              onChange={() => handleTypeChange("sum")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">{localized.nodeEditorAggregationSum || "SUM"}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "avg"}
              onChange={() => handleTypeChange("avg")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">{localized.nodeEditorAggregationAvg || "AVG"}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={aggregateType === "count"}
              onChange={() => handleTypeChange("count")}
              className="w-3 h-3"
            />
            <span className="text-xs text-white">{localized.nodeEditorAggregationCount || "COUNT"}</span>
          </label>
        </div>
      </div>

      <div className="mb-2 border-t border-gray-600 pt-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorFilterOptionalLabel || "Filter (Optional):"}
        </label>
        <select
          value={filterColumn}
          onChange={handleFilterColumnChange}
          className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-orange-400 mb-2"
        >
          <option value="">{localized.nodeEditorNoFilter || "No filter"}</option>
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
              placeholder={localized.nodeEditorFilterValue || "Filter value..."}
              className="w-full p-2 text-sm bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-orange-400"
            />
          </>
        )}
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"}{" "}
        {localized.nodeEditorNestedTableSelection || "NestedTableSelection"}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-cyan-500"
        data-output-type="NestedTableSelection"
      />
    </div>
  );
};

type GroupByAggregationDraft = GroupByAggregation & { id: string };
type GroupByAggregationInput = GroupByAggregation & { id?: string };

export const GroupByNode: React.FC<{ data: GroupByNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [groupByColumns, setGroupByColumns] = useState<string[]>(data.groupByColumns || []);
  const incomingAggregations = data.aggregations as GroupByAggregationInput[] | undefined;
  const [aggregations, setAggregations] = useState<GroupByAggregationDraft[]>(
    incomingAggregations?.map((agg, idx) => ({
      ...agg,
      id: agg.id || `agg_${idx}`,
    })) || [],
  );
  // inputColumnNames: columns available from the connected node (for dropdowns)
  const [inputColumnNames, setInputColumnNames] = useState<string[]>([]);

  // Sync local state with prop changes (but prevent feedback loops)
  React.useEffect(() => {
    if (
      data.groupByColumns !== undefined &&
      JSON.stringify(data.groupByColumns) !== JSON.stringify(groupByColumns)
    ) {
      setGroupByColumns(data.groupByColumns);
    }
  }, [data.groupByColumns]);

  React.useEffect(() => {
    if (incomingAggregations !== undefined) {
      // Compare without IDs to prevent loops (we strip IDs when sending to parent)
      const currentWithoutIds = aggregations.map(({ id, ...rest }) => rest);
      const incomingWithoutIds = incomingAggregations.map(({ id, ...rest }) => rest);

      if (JSON.stringify(currentWithoutIds) !== JSON.stringify(incomingWithoutIds)) {
        setAggregations(
          incomingAggregations.map((agg, idx) => ({
            ...agg,
            id: agg.id || aggregations[idx]?.id || `agg_${idx}`,
          })),
        );
      }
    }
  }, [aggregations, incomingAggregations]);

  // Extract INPUT column names from connected node (not the calculated output columns)
  React.useEffect(() => {
    // Check if we have explicit inputColumnNames from the saved data or connection
    const dataInputColumns = data.inputColumnNames;
    if (dataInputColumns && dataInputColumns.length > 0) {
      // Only update if they're different from current state
      if (JSON.stringify(dataInputColumns) !== JSON.stringify(inputColumnNames)) {
        nodeEditorDebugLog(`[GroupBy ${id}] Setting inputColumnNames from data:`, dataInputColumns);
        setInputColumnNames(dataInputColumns);
      }
    }
    // Otherwise, if inputColumnNames is empty, try to extract from columnNames
    else if (inputColumnNames.length === 0 && data.columnNames && data.columnNames.length > 0) {
      // Filter out aggregation output columns (those starting with "agg_")
      // to get the actual input columns from the connected node
      const inputCols = data.columnNames.filter((col: string) => !col.startsWith("agg_"));

      if (inputCols.length > 0) {
        nodeEditorDebugLog(`[GroupBy ${id}] Extracting inputColumnNames from columnNames:`, inputCols);
        setInputColumnNames(inputCols);
      }
    }
  }, [data.columnNames, data.inputColumnNames, inputColumnNames, id]);

  // Sync groupByColumns to node data
  React.useEffect(() => {
    dispatchNodeDataUpdate(data, { nodeId: id, groupByColumns },);
  }, [groupByColumns, id]);

  // Sync aggregations to node data
  React.useEffect(() => {
    const aggregationsWithoutId = aggregations.map(({ id, ...rest }) => rest);
    dispatchNodeDataUpdate(data, { nodeId: id, aggregations: aggregationsWithoutId },);
  }, [aggregations, id]);

  // Sync inputColumnNames to node data whenever it changes (to persist when saved)
  React.useEffect(() => {
    if (
      inputColumnNames.length > 0 &&
      JSON.stringify(inputColumnNames) !== JSON.stringify(data.inputColumnNames)
    ) {
      nodeEditorDebugLog(`[GroupBy ${id}] Syncing inputColumnNames to node data:`, inputColumnNames);
      dispatchNodeDataUpdate(data, { nodeId: id, inputColumnNames },);
    }
  }, [inputColumnNames, id]);

  // Calculate and propagate output column names based on groupByColumns and aggregations
  React.useEffect(() => {
    // Output columns = group by columns + aggregation output names
    const outputColumnNames = [...groupByColumns, ...aggregations.map((agg) => agg.outputName)];

    const outputChanged = JSON.stringify(outputColumnNames) !== JSON.stringify(data.columnNames);

    // Only update if output columns changed
    if (outputChanged) {
      dispatchNodeDataUpdate(data, { nodeId: id, columnNames: outputColumnNames },);
    }
  }, [groupByColumns, aggregations, id, data.columnNames]);

  const toggleGroupByColumn = (columnName: string) => {
    setGroupByColumns((prev) =>
      prev.includes(columnName) ? prev.filter((c) => c !== columnName) : [...prev, columnName],
    );
  };

  const addAggregation = () => {
    const newAggregation = {
      id: `agg_${Date.now()}`,
      sourceColumn: inputColumnNames[0] || "",
      operation: "max" as const,
      outputName: `agg_${aggregations.length + 1}`,
    };
    setAggregations([...aggregations, newAggregation]);
  };

  const removeAggregation = (aggId: string) => {
    setAggregations(aggregations.filter((a) => a.id !== aggId));
  };

  const updateAggregation = (
    aggId: string,
    updates: Partial<{
      sourceColumn: string;
      operation: "max" | "min" | "sum" | "avg" | "count" | "first" | "last";
      outputName: string;
      defaultValue: string;
    }>,
  ) => {
    setAggregations(aggregations.map((a) => (a.id === aggId ? { ...a, ...updates } : a)));
  };

  return (
    <div className="bg-gray-700 border-2 border-purple-500 rounded-lg p-4 min-w-[300px] max-w-[400px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-sm font-bold text-white mb-3">
        {localized.nodeEditorGroupByTitle || "Group By"}
      </div>

      {/* Group By Columns Section */}
      <div className="mb-3">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorGroupByColumnsLabel || "Group By Columns:"}
        </label>
        <div
          className="max-h-32 overflow-y-auto bg-gray-800 border border-gray-600 rounded p-2 scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {inputColumnNames.length === 0 ? (
            <div className="text-xs text-gray-500">
              {localized.nodeEditorNoColumnsAvailable || "No columns available"}
            </div>
          ) : (
            inputColumnNames.map((columnName) => (
              <label key={columnName} className="flex items-center gap-2 cursor-pointer mb-1">
                <input
                  type="checkbox"
                  checked={groupByColumns.includes(columnName)}
                  onChange={() => toggleGroupByColumn(columnName)}
                  className="w-3 h-3"
                />
                <span className="text-xs text-white">{columnName}</span>
              </label>
            ))
          )}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {localized.nodeEditorSelectedLabel || "Selected:"} {groupByColumns.length}
        </div>
      </div>

      {/* Aggregations Section */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-300">
            {localized.nodeEditorAggregationsLabel || "Aggregations:"}
          </label>
          <button
            onClick={addAggregation}
            className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded"
          >
            + {localized.add || "Add"}
          </button>
        </div>

        <div
          className="space-y-2 max-h-64 overflow-y-auto scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {aggregations.map((agg) => (
            <div key={agg.id} className="bg-gray-800 p-2 rounded border border-gray-600">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">
                  {localized.nodeEditorAggregationLabel || "Aggregation"}
                </span>
                <button
                  onClick={() => removeAggregation(agg.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  ✕
                </button>
              </div>

              <select
                value={agg.sourceColumn}
                onChange={(e) => updateAggregation(agg.id, { sourceColumn: e.target.value })}
                className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded mb-1"
              >
                <option value="">{localized.nodeEditorSelectColumnShort || "Select column..."}</option>
                {inputColumnNames.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>

              <select
                value={agg.operation}
                onChange={(e) =>
                  updateAggregation(agg.id, {
                    operation: e.target.value as "max" | "min" | "sum" | "avg" | "count" | "first" | "last",
                  })
                }
                className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded mb-1"
              >
                <option value="max">{localized.nodeEditorAggregationOpMax || "MAX"}</option>
                <option value="min">{localized.nodeEditorAggregationOpMin || "MIN"}</option>
                <option value="sum">{localized.nodeEditorAggregationOpSum || "SUM"}</option>
                <option value="avg">{localized.nodeEditorAggregationOpAvg || "AVG"}</option>
                <option value="count">{localized.nodeEditorAggregationOpCount || "COUNT"}</option>
                <option value="first">{localized.nodeEditorAggregationOpFirst || "FIRST"}</option>
                <option value="last">{localized.nodeEditorAggregationOpLast || "LAST"}</option>
              </select>

              <input
                type="text"
                value={agg.outputName}
                onChange={(e) => updateAggregation(agg.id, { outputName: e.target.value })}
                placeholder={localized.nodeEditorOutputColumnNamePlaceholder || "Output column name..."}
                className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded mb-1"
              />

              <input
                type="text"
                value={agg.defaultValue || ""}
                onChange={(e) => updateAggregation(agg.id, { defaultValue: e.target.value })}
                placeholder={
                  localized.nodeEditorDefaultValueIfNoRowsMatchPlaceholder ||
                  "Default value (if no rows match)..."
                }
                className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} {localized.nodeEditorTableSelection || "TableSelection"}
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

export const DeduplicateNode: React.FC<{ data: DeduplicateNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [dedupeByColumns, setDedupeByColumns] = useState<string[]>(data.dedupeByColumns || []);
  const [dedupeAgainstVanilla, setDedupeAgainstVanilla] = useState<boolean>(
    data.dedupeAgainstVanilla || false,
  );

  // inputColumnNames: columns available from the connected node (for dropdowns)
  const [inputColumnNames, setInputColumnNames] = useState<string[]>([]);

  // Sync local state with prop changes (but prevent feedback loops)
  React.useEffect(() => {
    if (
      data.dedupeByColumns !== undefined &&
      JSON.stringify(data.dedupeByColumns) !== JSON.stringify(dedupeByColumns)
    ) {
      setDedupeByColumns(data.dedupeByColumns);
    }
  }, [data.dedupeByColumns]);

  React.useEffect(() => {
    if (data.dedupeAgainstVanilla !== undefined && data.dedupeAgainstVanilla !== dedupeAgainstVanilla) {
      setDedupeAgainstVanilla(data.dedupeAgainstVanilla);
    }
  }, [data.dedupeAgainstVanilla]);

  // Extract INPUT column names from connected node (not the calculated output columns)
  React.useEffect(() => {
    // Check if we have explicit inputColumnNames from the saved data or connection
    const dataInputColumns = data.inputColumnNames;
    if (dataInputColumns && dataInputColumns.length > 0) {
      // Only update if they're different from current state
      if (JSON.stringify(dataInputColumns) !== JSON.stringify(inputColumnNames)) {
        nodeEditorDebugLog(`[DeduplicateNode ${id}] Setting inputColumnNames from data:`, dataInputColumns);
        setInputColumnNames(dataInputColumns);
      }
    }
    // Otherwise, if inputColumnNames is empty, try to extract from columnNames
    else if (inputColumnNames.length === 0 && data.columnNames && data.columnNames.length > 0) {
      // Filter out aggregation output columns (those starting with "agg_")
      // to get the actual input columns from the connected node
      const inputCols = data.columnNames.filter((col: string) => !col.startsWith("agg_"));

      if (inputCols.length > 0) {
        nodeEditorDebugLog(`[DeduplicateNode ${id}] Extracting inputColumnNames from columnNames:`, inputCols);
        setInputColumnNames(inputCols);
      }
    }
  }, [data.columnNames, data.inputColumnNames, inputColumnNames, id]);

  // Sync dedupeByColumns to node data
  React.useEffect(() => {
    dispatchNodeDataUpdate(data, { nodeId: id, dedupeByColumns },);
  }, [dedupeByColumns, id]);

  // Sync dedupeAgainstVanilla to node data
  React.useEffect(() => {
    dispatchNodeDataUpdate(data, { nodeId: id, dedupeAgainstVanilla },);
  }, [dedupeAgainstVanilla, id]);

  // Sync inputColumnNames to node data whenever it changes (to persist when saved)
  React.useEffect(() => {
    if (
      inputColumnNames.length > 0 &&
      JSON.stringify(inputColumnNames) !== JSON.stringify(data.inputColumnNames)
    ) {
      nodeEditorDebugLog(`[DeduplicateNode ${id}] Syncing inputColumnNames to node data:`, inputColumnNames);
      dispatchNodeDataUpdate(data, { nodeId: id, inputColumnNames },);
    }
  }, [inputColumnNames, id]);

  // Propagate output column names - Deduplicate keeps ALL columns, just removes duplicate rows
  // Unlike GroupBy which reduces columns, Deduplicate passes through all input columns
  React.useEffect(() => {
    // Output columns = all input columns (deduplicate doesn't reduce columns)
    const outputColumnNames = [...inputColumnNames];

    const outputChanged =
      outputColumnNames.length > 0 && JSON.stringify(outputColumnNames) !== JSON.stringify(data.columnNames);

    // Only update if output columns changed and we have input columns
    if (outputChanged) {
      dispatchNodeDataUpdate(data, { nodeId: id, columnNames: outputColumnNames },);
    }
  }, [inputColumnNames, id, data.columnNames]);

  const toggleDedupeByColumn = (columnName: string) => {
    setDedupeByColumns((prev) =>
      prev.includes(columnName) ? prev.filter((c) => c !== columnName) : [...prev, columnName],
    );
  };

  const handleDedupeAgainstVanillaChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDedupeAgainstVanilla(event.target.checked);
  };

  return (
    <div className="bg-gray-700 border-2 border-purple-500 rounded-lg p-4 min-w-[300px] max-w-[400px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-sm font-bold text-white mb-3">
        {localized.nodeEditorDeduplicateByTitle || "Deduplicate By"}
      </div>

      {/* Group By Columns Section */}
      <div className="mb-3">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorDeduplicateByColumnsLabel || "Deduplicate By Columns:"}
        </label>
        <div
          className="max-h-32 overflow-y-auto bg-gray-800 border border-gray-600 rounded p-2 scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {inputColumnNames.length === 0 ? (
            <div className="text-xs text-gray-500">
              {localized.nodeEditorNoColumnsAvailable || "No columns available"}
            </div>
          ) : (
            inputColumnNames.map((columnName) => (
              <label key={columnName} className="flex items-center gap-2 cursor-pointer mb-1">
                <input
                  type="checkbox"
                  checked={dedupeByColumns.includes(columnName)}
                  onChange={() => toggleDedupeByColumn(columnName)}
                  className="w-3 h-3"
                />
                <span className="text-xs text-white">{columnName}</span>
              </label>
            ))
          )}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {localized.nodeEditorSelectedLabel || "Selected:"} {dedupeByColumns.length}
        </div>
      </div>

      {/* Against Vanilla Data Checkbox */}
      <div className="mb-3">
        <label className="flex items-center text-xs text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={dedupeAgainstVanilla}
            onChange={handleDedupeAgainstVanillaChange}
            className="mr-2 w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-400"
          />
          {localized.nodeEditorAgainstVanillaData || "Against vanilla data"}
        </label>
        <div className="text-xs text-gray-500 mt-1 ml-6">
          {localized.nodeEditorRemoveRowsThatExistInVanilla ||
            "Remove rows that exist in vanilla, keep modded rows"}
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} TableSelection
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

export const GenerateRowsNode: React.FC<{ data: GenerateRowsNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
  const [transformations, setTransformations] = useState<ColumnTransformation[]>(data.transformations || []);
  const [outputTables, setOutputTables] = useState<OutputTableConfig[]>(data.outputTables || []);
  const [outputCount, setOutputCount] = useState<number>(data.outputCount || 2);
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [customSchemaColumns, setCustomSchemaColumns] = useState<string[]>(data.customSchemaColumns || []);

  // Sync local state with prop changes
  React.useEffect(() => {
    nodeEditorDebugLog(`[GenerateRows ${id}] Syncing props to state:`, {
      propsTransformations: data.transformations?.length,
      propsOutputTables: data.outputTables?.length,
    });
    if (data.transformations !== undefined) setTransformations(data.transformations);
    if (data.outputTables !== undefined) setOutputTables(data.outputTables);
    if (data.outputCount !== undefined) setOutputCount(data.outputCount);
  }, [data.transformations, data.outputTables, data.outputCount, id]);

  // Sync custom schema columns from connected CustomSchema node
  React.useEffect(() => {
    if (data.customSchemaColumns) {
      setCustomSchemaColumns(data.customSchemaColumns);
    }
  }, [data.customSchemaColumns]);

  // Note: columnMapping is no longer used - transformations are automatically included
  // based on their targetTableHandleId. Keeping the field for backward compatibility.

  // Extract column names from connected input
  React.useEffect(() => {
    // Prefer inputColumnNames (from connection) over everything else
    // This ensures we get the actual columns from the connected source,
    // including new columns from addnewcolumn, transformations, etc.
    if (data.inputColumnNames && data.inputColumnNames.length > 0) {
      setColumnNames(data.inputColumnNames);
    } else if (data.columnNames && data.columnNames.length > 0) {
      // Use columnNames from data if already provided (from connection propagation)
      setColumnNames(data.columnNames);
    } else if (data.connectedTableName && data.DBNameToDBVersions) {
      // Otherwise fall back to looking up schema from DBNameToDBVersions
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(data.connectedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);
      }
    }

    // Extract all available table names from DBNameToDBVersions
    if (data.DBNameToDBVersions) {
      const names = Object.keys(data.DBNameToDBVersions);
      setTableNames(names);
    }
  }, [data.inputColumnNames, data.columnNames, data.connectedTableName, data.DBNameToDBVersions]);

  // Sync transformations to node data
  React.useEffect(() => {
    nodeEditorDebugLog(`[GenerateRows ${id}] Syncing transformations to node.data:`, transformations.length);
    dispatchNodeDataUpdate(data, { nodeId: id, transformations },);
  }, [transformations, id]);

  // Sync outputTables to node data
  React.useEffect(() => {
    nodeEditorDebugLog(`[GenerateRows ${id}] Syncing outputTables to node.data:`, outputTables.length);
    dispatchNodeDataUpdate(data, { nodeId: id, outputTables, outputCount },);
  }, [outputTables, outputCount, id]);

  const addTransformation = () => {
    const newTransformation: ColumnTransformation = {
      id: `trans_${Date.now()}`,
      sourceColumn: columnNames[0] || "",
      transformationType: "none",
      outputColumnName: `output_${transformations.length + 1}`,
      targetTableHandleId: outputTables[0]?.handleId || "",
    };
    setTransformations([...transformations, newTransformation]);
  };

  const removeTransformation = (transId: string) => {
    setTransformations(transformations.filter((t) => t.id !== transId));
  };

  const moveTransformationUp = (transId: string) => {
    const index = transformations.findIndex((t) => t.id === transId);
    if (index <= 0) return; // Already at top or not found

    const newTransformations = [...transformations];
    [newTransformations[index - 1], newTransformations[index]] = [
      newTransformations[index],
      newTransformations[index - 1],
    ];
    setTransformations(newTransformations);
  };

  const moveTransformationDown = (transId: string) => {
    const index = transformations.findIndex((t) => t.id === transId);
    if (index < 0 || index >= transformations.length - 1) return; // Already at bottom or not found

    const newTransformations = [...transformations];
    [newTransformations[index], newTransformations[index + 1]] = [
      newTransformations[index + 1],
      newTransformations[index],
    ];
    setTransformations(newTransformations);
  };

  const updateTransformation = (transId: string, updates: Partial<ColumnTransformation>) => {
    setTransformations(transformations.map((t) => (t.id === transId ? { ...t, ...updates } : t)));
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

  // Note: toggleColumnInMapping removed - columnMapping is no longer used
  // Transformations are automatically included based on targetTableHandleId

  const updateStaticValue = (outputIndex: number, columnName: string, value: string) => {
    const currentStaticValues = outputTables[outputIndex]?.staticValues || {};
    const newStaticValues = { ...currentStaticValues, [columnName]: value };
    updateOutputTable(outputIndex, { staticValues: newStaticValues });
  };

  const getAvailableStaticColumns = (outputIndex: number): string[] => {
    const output = outputTables[outputIndex];
    if (!output?.existingTableName) return [];

    // Handle custom schema case
    if (output.existingTableName === "__custom_schema__") {
      // Get transformed column names for this table
      const transformedColumns = new Set(
        transformations
          .filter((trans) => trans.targetTableHandleId === output.handleId)
          .map((trans) => trans.outputColumnName),
      );

      // Return custom schema columns that are NOT transformed
      return customSchemaColumns.filter((col: string) => !transformedColumns.has(col));
    }

    if (!data.DBNameToDBVersions) return [];

    const versions = data.DBNameToDBVersions[output.existingTableName];
    if (!versions || versions.length === 0) return [];

    const schema =
      (output.tableVersion !== undefined
        ? versions.find((v) => v.version === output.tableVersion)
        : undefined) ??
      getTableVersion(output.existingTableName, versions, defaultTableVersions) ??
      versions[0];
    const allColumns = schema.fields.map((field) => field.name);

    // Get transformed column names for this table
    const transformedColumns = new Set(
      transformations
        .filter((trans) => trans.targetTableHandleId === output.handleId)
        .map((trans) => trans.outputColumnName),
    );

    // Return columns that are NOT transformed (remaining columns need static values)
    return allColumns.filter((col: string) => !transformedColumns.has(col));
  };

  return (
    <div className="bg-gray-700 border-2 border-green-600 rounded-lg p-4 min-w-[300px] max-w-[400px]">
      {/* Main TableSelection input */}
      <Handle
        type="target"
        position={Position.Left}
        id="input-table"
        className="w-3 h-3 bg-orange-500"
        style={{ top: "50%" }}
        data-input-type="TableSelection"
      />

      <div className="text-sm font-bold text-white mb-3">
        {localized.nodeEditorGenerateRowsTitle || "Generate Rows"}
      </div>

      {/* Transformations Section */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-300">
            {localized.nodeEditorTransformationsLabel || "Transformations:"}
          </label>
          <button
            onClick={addTransformation}
            className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded"
          >
            + {localized.add || "Add"}
          </button>
        </div>

        <div
          className="space-y-2 max-h-60 overflow-y-auto scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {transformations.map((trans, transIndex) => {
            // Build available source columns for this transformation
            // Include original columns + output columns from previous transformations
            const availableSourceColumns = [
              ...columnNames,
              ...transformations
                .slice(0, transIndex)
                .map((t) => t.outputColumnName)
                .filter((name) => name && name.trim() !== ""),
            ];

            return (
              <div key={trans.id} className="bg-gray-800 p-2 rounded border border-gray-600">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400">→ {trans.outputColumnName}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveTransformationUp(trans.id)}
                      disabled={transIndex === 0}
                      className={`text-xs ${
                        transIndex === 0
                          ? "text-gray-600 cursor-not-allowed"
                          : "text-blue-400 hover:text-blue-300"
                      }`}
                      title={localized.nodeEditorMoveUp || "Move up"}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveTransformationDown(trans.id)}
                      disabled={transIndex === transformations.length - 1}
                      className={`text-xs ${
                        transIndex === transformations.length - 1
                          ? "text-gray-600 cursor-not-allowed"
                          : "text-blue-400 hover:text-blue-300"
                      }`}
                      title={localized.nodeEditorMoveDown || "Move down"}
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => removeTransformation(trans.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                      title={localized.remove || "Remove"}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <select
                  value={trans.sourceColumn}
                  onChange={(e) => updateTransformation(trans.id, { sourceColumn: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                >
                  <option value="">
                    {localized.nodeEditorSelectSourceColumn || "Select source column..."}
                  </option>
                  {columnNames.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                  {transformations
                    .slice(0, transIndex)
                    .filter((t) => t.outputColumnName && t.outputColumnName.trim() !== "")
                    .map((t) => (
                      <option key={t.outputColumnName} value={t.outputColumnName}>
                        {t.outputColumnName} (
                        {localized.nodeEditorFromTransformation || "from transformation"})
                      </option>
                    ))}
                </select>

                <select
                  value={trans.transformationType}
                  onChange={(e) =>
                    updateTransformation(trans.id, {
                      transformationType: e.target.value as
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
                        | "filternotequal",
                    })
                  }
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                >
                  <option value="none">
                    {localized.nodeEditorTransformationNonePassThrough || "None (pass through)"}
                  </option>
                  <option value="prefix">
                    {localized.nodeEditorTransformationAddPrefix || "Add Prefix"}
                  </option>
                  <option value="suffix">
                    {localized.nodeEditorTransformationAddSuffix || "Add Suffix"}
                  </option>
                  <option value="add">
                    {localized.nodeEditorTransformationAddNumber || "Add Number (+)"}
                  </option>
                  <option value="subtract">
                    {localized.nodeEditorTransformationSubtractNumber || "Subtract Number (-)"}
                  </option>
                  <option value="multiply">
                    {localized.nodeEditorTransformationMultiply || "Multiply (*)"}
                  </option>
                  <option value="divide">{localized.nodeEditorTransformationDivide || "Divide (/)"}</option>
                  <option value="counter">
                    {localized.nodeEditorTransformationCounterUniqueSequential ||
                      "Counter (unique sequential)"}
                  </option>
                  <option value="counter_range">
                    {localized.nodeEditorTransformationCounterCustomRange || "Counter (custom range)"}
                  </option>
                  <option value="filterequal">
                    {localized.nodeEditorTransformationFilterRowsEqual ||
                      "Filter Rows: Equal (skip if equal)"}
                  </option>
                  <option value="filternotequal">
                    {localized.nodeEditorTransformationFilterRowsNotEqual ||
                      "Filter Rows: Not Equal (skip if not equal)"}
                  </option>
                </select>

                {trans.transformationType === "prefix" && (
                  <input
                    type="text"
                    placeholder={localized.nodeEditorPrefixPlaceholder || "Prefix..."}
                    value={trans.prefix || ""}
                    onChange={(e) => updateTransformation(trans.id, { prefix: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  />
                )}

                {trans.transformationType === "suffix" && (
                  <input
                    type="text"
                    placeholder={localized.nodeEditorSuffixPlaceholder || "Suffix..."}
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
                    placeholder={localized.nodeEditorNumberValuePlaceholder || "Number value..."}
                    value={trans.numericValue ?? ""}
                    onChange={(e) =>
                      updateTransformation(trans.id, { numericValue: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  />
                )}

                {trans.transformationType === "counter" && (
                  <input
                    type="number"
                    placeholder={
                      localized.nodeEditorStartNumberDefault10000Placeholder ||
                      "Start number (default: 10000)..."
                    }
                    value={trans.startNumber ?? ""}
                    onChange={(e) =>
                      updateTransformation(trans.id, { startNumber: parseInt(e.target.value) || undefined })
                    }
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  />
                )}

                {trans.transformationType === "counter_range" && (
                  <div className="space-y-1">
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorRangeStartPlaceholder || "Start (e.g., 1 or {{startOption}})"
                      }
                      value={trans.rangeStart ?? ""}
                      onChange={(e) => updateTransformation(trans.id, { rangeStart: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
                    />
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorRangeEndPlaceholder || "End (e.g., 10 or {{endOption}})"
                      }
                      value={trans.endNumber ?? ""}
                      onChange={(e) => updateTransformation(trans.id, { endNumber: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
                    />
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorRangeIncrementPlaceholder ||
                        "Increment (e.g., 1 or {{incOption}})"
                      }
                      value={trans.rangeIncrement ?? "1"}
                      onChange={(e) => updateTransformation(trans.id, { rangeIncrement: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
                    />
                    <div className="text-xs text-gray-500">
                      {localized.nodeEditorGeneratesRowsFromStartToEnd || "Generates rows from start to end"}
                    </div>
                  </div>
                )}

                {(trans.transformationType === "filterequal" ||
                  trans.transformationType === "filternotequal") && (
                  <input
                    type="text"
                    placeholder={localized.nodeEditorFilterValue || "Filter value..."}
                    value={trans.filterValue || ""}
                    onChange={(e) => updateTransformation(trans.id, { filterValue: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  />
                )}

                <input
                  type="text"
                  placeholder={localized.nodeEditorOutputColumnNamePlaceholder || "Output column name..."}
                  value={trans.outputColumnName}
                  onChange={(e) => updateTransformation(trans.id, { outputColumnName: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                />

                <select
                  value={trans.targetTableHandleId}
                  onChange={(e) => updateTransformation(trans.id, { targetTableHandleId: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
                >
                  <option value="">
                    {localized.nodeEditorSelectTargetTable || "Select target table..."}
                  </option>
                  {outputTables.map((table) => (
                    <option key={table.handleId} value={table.handleId}>
                      {table.name || table.handleId}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          {transformations.length === 0 && (
            <div className="text-xs text-gray-500 text-center py-2">
              {localized.nodeEditorNoTransformationsYet || "No transformations yet"}
            </div>
          )}
        </div>
      </div>

      {/* Output Count */}
      <div className="mb-3">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorNumberOfOutputsLabel || "Number of Outputs:"}
        </label>
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
        <label className="text-xs text-gray-300 block mb-2">
          {localized.nodeEditorOutputTablesLabel || "Output Tables:"}
        </label>
        <div
          className="space-y-2 max-h-48 overflow-y-auto scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {outputTables.map((output, idx) => (
            <div key={output.handleId} className="bg-gray-800 p-2 rounded border border-gray-600">
              <div className="text-xs text-gray-400 mb-1">
                {localized.nodeEditorOutputItem || "Output"} {idx + 1}
              </div>

              <select
                value={output.existingTableName}
                onChange={(e) =>
                  updateOutputTable(idx, { existingTableName: e.target.value, tableVersion: undefined })
                }
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
              >
                <option value="">{localized.nodeEditorSelectTableSchema || "Select table schema..."}</option>
                {customSchemaColumns.length > 0 && (
                  <option value="__custom_schema__" className="text-purple-400">
                    {localized.nodeEditorCustomSchemaConnected || "Custom Schema (connected)"}
                  </option>
                )}
                {tableNames.map((tableName) => (
                  <option key={tableName} value={tableName}>
                    {tableName}
                  </option>
                ))}
              </select>

              {(() => {
                const versions =
                  output.existingTableName && data.DBNameToDBVersions
                    ? data.DBNameToDBVersions[output.existingTableName]
                    : undefined;
                if (!versions || versions.length <= 1) return null;
                const activeVersion =
                  output.tableVersion !== undefined
                    ? output.tableVersion
                    : (getTableVersion(output.existingTableName, versions, defaultTableVersions)?.version ??
                      versions[0].version);
                return (
                  <select
                    value={activeVersion}
                    onChange={(e) => updateOutputTable(idx, { tableVersion: Number(e.target.value) })}
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  >
                    {versions.map((v) => (
                      <option key={v.version} value={v.version}>
                        {localized.version || "Version"} {v.version} ({v.fields?.length ?? 0}{" "}
                        {localized.columns || "Columns"})
                      </option>
                    ))}
                  </select>
                );
              })()}

              <div className="text-xs text-gray-400 mb-1">
                {localized.nodeEditorTransformedColumnsLabel || "Transformed Columns:"}
              </div>
              <div
                className="max-h-24 overflow-y-auto bg-gray-700 border border-gray-600 rounded p-1 mb-2 scrollable-node-content"
                onWheel={stopWheelPropagation}
              >
                {transformations
                  .filter((trans) => trans.targetTableHandleId === output.handleId)
                  .map((trans) => (
                    <div key={trans.id} className="flex items-center gap-2 p-1">
                      <span className="text-xs text-green-400">✓</span>
                      <span className="text-xs text-white">{trans.outputColumnName}</span>
                    </div>
                  ))}
                {transformations.filter((trans) => trans.targetTableHandleId === output.handleId).length ===
                  0 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    {localized.nodeEditorNoTransformationsForThisTable || "No transformations for this table"}
                  </div>
                )}
              </div>

              <div className="text-xs text-gray-400 mb-1">
                {localized.nodeEditorStaticValuesRemainingColumnsLabel ||
                  "Static Values (remaining columns):"}
              </div>
              <div
                className="max-h-32 overflow-y-auto bg-gray-700 border border-gray-600 rounded p-1 scrollable-node-content"
                onWheel={stopWheelPropagation}
              >
                {getAvailableStaticColumns(idx).map((col) => (
                  <div key={col} className="flex items-center gap-1 mb-1">
                    <span className="text-xs text-white w-24 truncate" title={col}>
                      {col}:
                    </span>
                    <input
                      type="text"
                      placeholder={localized.nodeEditorValuePlaceholder || "value"}
                      value={output.staticValues?.[col] || ""}
                      onChange={(e) => updateStaticValue(idx, col, e.target.value)}
                      className="flex-1 bg-gray-600 border border-gray-500 text-white text-xs rounded px-1 py-0.5"
                    />
                  </div>
                ))}
                {getAvailableStaticColumns(idx).length === 0 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    {localized.nodeEditorAllColumnsMapped || "All columns mapped"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutputsLabel || "Outputs:"} {outputCount}{" "}
        {localized.nodeEditorTableSelections || "TableSelections"}
      </div>

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

// Schema-only variant of GenerateRows - accepts only CustomSchema input
export const GenerateRowsSchemaNode: React.FC<{ data: GenerateRowsNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [transformations, setTransformations] = useState<ColumnTransformation[]>(data.transformations || []);
  const [outputTables, setOutputTables] = useState<OutputTableConfig[]>(data.outputTables || []);
  const [outputCount, setOutputCount] = useState<number>(data.outputCount || 1);
  const [customSchemaColumns, setCustomSchemaColumns] = useState<string[]>(data.customSchemaColumns || []);

  // Sync local state with prop changes
  React.useEffect(() => {
    if (data.transformations !== undefined) setTransformations(data.transformations);
    if (data.outputTables !== undefined) setOutputTables(data.outputTables);
    if (data.outputCount !== undefined) setOutputCount(data.outputCount);
  }, [data.transformations, data.outputTables, data.outputCount]);

  // Sync custom schema columns from connected CustomSchema node
  React.useEffect(() => {
    if (data.customSchemaColumns) {
      setCustomSchemaColumns(data.customSchemaColumns);
    }
  }, [data.customSchemaColumns]);

  // Sync transformations to node data
  React.useEffect(() => {
    dispatchNodeDataUpdate(data, { nodeId: id, transformations },);
  }, [transformations, id]);

  // Sync outputTables to node data
  React.useEffect(() => {
    dispatchNodeDataUpdate(data, { nodeId: id, outputTables, outputCount },);
  }, [outputTables, outputCount, id]);

  const addTransformation = () => {
    const newTransformation: ColumnTransformation = {
      id: `trans_${Date.now()}`,
      sourceColumn: "",
      transformationType: "counter_range",
      outputColumnName: customSchemaColumns[0] || `output_${transformations.length + 1}`,
      targetTableHandleId: outputTables[0]?.handleId || "",
      rangeStart: "0",
      endNumber: "10",
      rangeIncrement: "1",
    };
    setTransformations([...transformations, newTransformation]);
  };

  const removeTransformation = (transId: string) => {
    setTransformations(transformations.filter((t) => t.id !== transId));
  };

  const updateTransformation = (transId: string, updates: Partial<ColumnTransformation>) => {
    setTransformations(transformations.map((t) => (t.id === transId ? { ...t, ...updates } : t)));
  };

  const updateOutputCount = (count: number) => {
    setOutputCount(count);

    const newOutputTables = [...outputTables];
    while (newOutputTables.length < count) {
      newOutputTables.push({
        handleId: `output-table${newOutputTables.length + 1}`,
        name: `Table ${newOutputTables.length + 1}`,
        existingTableName: "__custom_schema__",
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

  const updateStaticValue = (outputIndex: number, columnName: string, value: string) => {
    const currentStaticValues = outputTables[outputIndex]?.staticValues || {};
    const newStaticValues = { ...currentStaticValues, [columnName]: value };
    updateOutputTable(outputIndex, { staticValues: newStaticValues });
  };

  const getAvailableStaticColumns = (outputIndex: number): string[] => {
    const output = outputTables[outputIndex];
    if (!output) return [];

    // Get transformed column names for this table
    const transformedColumns = new Set(
      transformations
        .filter((trans) => trans.targetTableHandleId === output.handleId)
        .map((trans) => trans.outputColumnName),
    );

    // Return custom schema columns that are NOT transformed
    return customSchemaColumns.filter((col: string) => !transformedColumns.has(col));
  };

  return (
    <div className="bg-gray-700 border-2 border-purple-600 rounded-lg p-4 min-w-[300px] max-w-[400px]">
      {/* Custom Schema input only */}
      <Handle
        type="target"
        position={Position.Left}
        id="input-schema"
        className="w-3 h-3 bg-purple-500"
        style={{ top: "50%" }}
        data-input-type="CustomSchema"
      />

      <div className="text-sm font-bold text-white mb-3">
        {localized.nodeEditorGenerateRowsSchemaTitle || "Generate Rows (Schema)"}
      </div>
      <div className="text-xs text-gray-400 mb-2">
        <span className="text-purple-400">●</span>{" "}
        {localized.nodeEditorRequiresCustomSchemaInput || "Requires Custom Schema input"}
      </div>

      {customSchemaColumns.length === 0 && (
        <div className="text-xs text-yellow-400 mb-2 p-2 bg-yellow-900/30 rounded">
          {localized.nodeEditorConnectCustomSchemaToDefineColumns ||
            "Connect a Custom Schema node to define columns"}
        </div>
      )}

      {/* Transformations Section */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-300">
            {localized.nodeEditorTransformationsLabel || "Transformations:"}
          </label>
          <button
            onClick={addTransformation}
            className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded"
          >
            + {localized.add || "Add"}
          </button>
        </div>

        <div
          className="space-y-2 max-h-60 overflow-y-auto scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {transformations.map((trans, transIndex) => {
            // Build available source columns (from previous transformations)
            const availableSourceColumns = transformations
              .slice(0, transIndex)
              .map((t) => t.outputColumnName)
              .filter((name) => name && name.trim() !== "");

            return (
              <div key={trans.id} className="bg-gray-800 p-2 rounded border border-gray-600">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400">→ {trans.outputColumnName}</span>
                  <button
                    onClick={() => removeTransformation(trans.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                    title={localized.remove || "Remove"}
                  >
                    ✕
                  </button>
                </div>

                <select
                  value={trans.transformationType}
                  onChange={(e) =>
                    updateTransformation(trans.id, {
                      transformationType: e.target.value as ColumnTransformation["transformationType"],
                    })
                  }
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                >
                  <option value="counter_range">
                    {localized.nodeEditorTransformationCounterCustomRange || "Counter (custom range)"}
                  </option>
                  <option value="none">
                    {localized.nodeEditorTransformationNoneUseSource || "None (use source)"}
                  </option>
                  <option value="prefix">
                    {localized.nodeEditorTransformationAddPrefix || "Add Prefix"}
                  </option>
                  <option value="suffix">
                    {localized.nodeEditorTransformationAddSuffix || "Add Suffix"}
                  </option>
                  <option value="add">
                    {localized.nodeEditorTransformationAddNumber || "Add Number (+)"}
                  </option>
                  <option value="subtract">
                    {localized.nodeEditorTransformationSubtractNumber || "Subtract Number (-)"}
                  </option>
                  <option value="multiply">
                    {localized.nodeEditorTransformationMultiply || "Multiply (*)"}
                  </option>
                  <option value="divide">{localized.nodeEditorTransformationDivide || "Divide (/)"}</option>
                </select>

                {trans.transformationType !== "counter_range" && (
                  <select
                    value={trans.sourceColumn}
                    onChange={(e) => updateTransformation(trans.id, { sourceColumn: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  >
                    <option value="">{localized.nodeEditorSelectSource || "Select source..."}</option>
                    {availableSourceColumns.map((col) => (
                      <option key={col} value={col}>
                        {col} ({localized.nodeEditorFromTransformation || "from transformation"})
                      </option>
                    ))}
                  </select>
                )}

                {trans.transformationType === "prefix" && (
                  <input
                    type="text"
                    placeholder={localized.nodeEditorPrefixPlaceholder || "Prefix..."}
                    value={trans.prefix || ""}
                    onChange={(e) => updateTransformation(trans.id, { prefix: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  />
                )}

                {trans.transformationType === "suffix" && (
                  <input
                    type="text"
                    placeholder={localized.nodeEditorSuffixPlaceholder || "Suffix..."}
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
                    placeholder={localized.nodeEditorNumberValuePlaceholder || "Number value..."}
                    value={trans.numericValue ?? ""}
                    onChange={(e) =>
                      updateTransformation(trans.id, { numericValue: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  />
                )}

                {trans.transformationType === "counter_range" && (
                  <div className="space-y-1">
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorRangeStartPlaceholder || "Start (e.g., 1 or {{startOption}})"
                      }
                      value={trans.rangeStart ?? ""}
                      onChange={(e) => updateTransformation(trans.id, { rangeStart: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
                    />
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorRangeEndPlaceholder || "End (e.g., 10 or {{endOption}})"
                      }
                      value={trans.endNumber ?? ""}
                      onChange={(e) => updateTransformation(trans.id, { endNumber: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
                    />
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorRangeIncrementPlaceholder ||
                        "Increment (e.g., 1 or {{incOption}})"
                      }
                      value={trans.rangeIncrement ?? "1"}
                      onChange={(e) => updateTransformation(trans.id, { rangeIncrement: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
                    />
                    <div className="text-xs text-gray-500">
                      {localized.nodeEditorGeneratesRowsFromStartToEnd || "Generates rows from start to end"}
                    </div>
                  </div>
                )}

                <input
                  type="text"
                  placeholder={localized.nodeEditorOutputColumnNamePlaceholder || "Output column name..."}
                  value={trans.outputColumnName}
                  onChange={(e) => updateTransformation(trans.id, { outputColumnName: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                />

                <select
                  value={trans.targetTableHandleId}
                  onChange={(e) => updateTransformation(trans.id, { targetTableHandleId: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
                >
                  <option value="">
                    {localized.nodeEditorSelectTargetTable || "Select target table..."}
                  </option>
                  {outputTables.map((table) => (
                    <option key={table.handleId} value={table.handleId}>
                      {table.name || table.handleId}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          {transformations.length === 0 && (
            <div className="text-xs text-gray-500 text-center py-2">
              {localized.nodeEditorNoTransformationsYet || "No transformations yet"}
            </div>
          )}
        </div>
      </div>

      {/* Output Count */}
      <div className="mb-3">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorNumberOfOutputsLabel || "Number of Outputs:"}
        </label>
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
        <label className="text-xs text-gray-300 block mb-2">
          {localized.nodeEditorOutputTablesLabel || "Output Tables:"}
        </label>
        <div
          className="space-y-2 max-h-48 overflow-y-auto scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {outputTables.map((output, idx) => (
            <div key={output.handleId} className="bg-gray-800 p-2 rounded border border-gray-600">
              <div className="text-xs text-purple-400 mb-1">
                {localized.nodeEditorOutputItem || "Output"} {idx + 1} (
                {localized.nodeEditorCustomSchema || "Custom Schema"})
              </div>

              <div className="text-xs text-gray-400 mb-1">
                {localized.nodeEditorTransformedColumnsLabel || "Transformed Columns:"}
              </div>
              <div
                className="max-h-24 overflow-y-auto bg-gray-700 border border-gray-600 rounded p-1 mb-2 scrollable-node-content"
                onWheel={stopWheelPropagation}
              >
                {transformations
                  .filter((trans) => trans.targetTableHandleId === output.handleId)
                  .map((trans) => (
                    <div key={trans.id} className="flex items-center gap-2 p-1">
                      <span className="text-xs text-green-400">✓</span>
                      <span className="text-xs text-white">{trans.outputColumnName}</span>
                    </div>
                  ))}
                {transformations.filter((trans) => trans.targetTableHandleId === output.handleId).length ===
                  0 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    {localized.nodeEditorNoTransformationsForThisTable || "No transformations for this table"}
                  </div>
                )}
              </div>

              <div className="text-xs text-gray-400 mb-1">
                {localized.nodeEditorStaticValuesRemainingColumnsLabel ||
                  "Static Values (remaining columns):"}
              </div>
              <div
                className="max-h-32 overflow-y-auto bg-gray-700 border border-gray-600 rounded p-1 scrollable-node-content"
                onWheel={stopWheelPropagation}
              >
                {getAvailableStaticColumns(idx).map((col) => (
                  <div key={col} className="flex items-center gap-1 mb-1">
                    <span className="text-xs text-white w-24 truncate" title={col}>
                      {col}:
                    </span>
                    <input
                      type="text"
                      placeholder={localized.nodeEditorValuePlaceholder || "value"}
                      value={output.staticValues?.[col] || ""}
                      onChange={(e) => updateStaticValue(idx, col, e.target.value)}
                      className="flex-1 bg-gray-600 border border-gray-500 text-white text-xs rounded px-1 py-0.5"
                    />
                  </div>
                ))}
                {getAvailableStaticColumns(idx).length === 0 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    {localized.nodeEditorAllColumnsMapped || "All columns mapped"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutputsLabel || "Outputs:"} {outputCount}{" "}
        {localized.nodeEditorTableSelections || "TableSelections"}
      </div>

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

export const AddNewColumnNode: React.FC<{ data: AddNewColumnNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const defaultTableVersions = useDefaultTableVersions();
  const [transformations, setTransformations] = useState<AddColumnTransformation[]>(
    data.transformations || [],
  );
  const [columnNames, setColumnNames] = useState<string[]>(data.columnNames || []);

  // Sync local state with prop changes
  React.useEffect(() => {
    if (data.transformations !== undefined) setTransformations(data.transformations);
  }, [data.transformations]);

  // Extract column names from connected input
  React.useEffect(() => {
    if (data.columnNames && data.columnNames.length > 0) {
      setColumnNames(data.columnNames);
    } else if (data.connectedTableName && data.DBNameToDBVersions) {
      const tableVersions = data.DBNameToDBVersions[data.connectedTableName];
      if (tableVersions && tableVersions.length > 0) {
        const selectedVersion = getTableVersion(data.connectedTableName, tableVersions, defaultTableVersions);
        const tableFields = selectedVersion?.fields || [];
        const fieldNames = tableFields.map((field) => field.name);
        setColumnNames(fieldNames);
      }
    }
  }, [data.columnNames, data.connectedTableName, data.DBNameToDBVersions]);

  // Sync transformations to node data and update output column names
  React.useEffect(() => {
    // Calculate extended column names (original + new columns from transformations)
    // Use inputColumnNames (from source) as base, not data.columnNames (which may already include previous new columns)
    const originalColumns = data.inputColumnNames || data.columnNames || [];
    const newColumns = transformations
      .filter((t) => t.transformationType !== "filterequal" && t.transformationType !== "filternotequal")
      .map((t) => t.outputColumnName)
      .filter((name) => name && name.trim() !== "");

    const extendedColumnNames = [...originalColumns, ...newColumns];

    dispatchNodeDataUpdate(data, {
          nodeId: id,
          transformations,
          columnNames: extendedColumnNames,
        },);
  }, [transformations, id, data.inputColumnNames, data.columnNames]);

  const addTransformation = () => {
    const newTransformation: AddColumnTransformation = {
      id: `trans_${Date.now()}`,
      sourceColumn: columnNames[0] || "",
      transformationType: "none",
      outputColumnName: `new_column_${transformations.length + 1}`,
    };
    setTransformations([...transformations, newTransformation]);
  };

  const removeTransformation = (transId: string) => {
    setTransformations(transformations.filter((t) => t.id !== transId));
  };

  const moveTransformationUp = (transId: string) => {
    const index = transformations.findIndex((t) => t.id === transId);
    if (index <= 0) return;

    const newTransformations = [...transformations];
    [newTransformations[index - 1], newTransformations[index]] = [
      newTransformations[index],
      newTransformations[index - 1],
    ];
    setTransformations(newTransformations);
  };

  const moveTransformationDown = (transId: string) => {
    const index = transformations.findIndex((t) => t.id === transId);
    if (index < 0 || index >= transformations.length - 1) return;

    const newTransformations = [...transformations];
    [newTransformations[index], newTransformations[index + 1]] = [
      newTransformations[index + 1],
      newTransformations[index],
    ];
    setTransformations(newTransformations);
  };

  const updateTransformation = (transId: string, updates: Partial<AddColumnTransformation>) => {
    setTransformations(transformations.map((t) => (t.id === transId ? { ...t, ...updates } : t)));
  };

  return (
    <div className="bg-gray-700 border-2 border-cyan-600 rounded-lg p-4 min-w-[300px] max-w-[400px]">
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-orange-500"
        data-input-type="TableSelection"
      />

      <div className="text-sm font-bold text-white mb-3">
        {data.label || localized.nodeEditorNodeAddNewColumnLabel || "Add New Column"}
      </div>

      {/* Transformations Section */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-300">
            {localized.nodeEditorNewColumnsLabel || "New Columns:"}
          </label>
          <button
            onClick={addTransformation}
            className="text-xs bg-cyan-600 hover:bg-cyan-700 text-white px-2 py-1 rounded"
          >
            + {localized.nodeEditorAddColumn || "Add Column"}
          </button>
        </div>

        <div
          className="space-y-2 max-h-96 overflow-y-auto scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {transformations.map((trans, transIndex) => {
            // Build available source columns for this transformation
            // Include original INPUT columns (not including new columns from transformations)
            // + output columns from PREVIOUS transformations only
            const inputColumns = data.inputColumnNames || columnNames || [];
            const previousTransformationColumns = transformations
              .slice(0, transIndex)
              .map((t) => t.outputColumnName)
              .filter((name) => name && name.trim() !== "");

            return (
              <div key={trans.id} className="bg-gray-800 p-2 rounded border border-gray-600">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400">→ {trans.outputColumnName}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveTransformationUp(trans.id)}
                      disabled={transIndex === 0}
                      className={`text-xs ${
                        transIndex === 0
                          ? "text-gray-600 cursor-not-allowed"
                          : "text-blue-400 hover:text-blue-300"
                      }`}
                      title={localized.nodeEditorMoveUp || "Move up"}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveTransformationDown(trans.id)}
                      disabled={transIndex === transformations.length - 1}
                      className={`text-xs ${
                        transIndex === transformations.length - 1
                          ? "text-gray-600 cursor-not-allowed"
                          : "text-blue-400 hover:text-blue-300"
                      }`}
                      title={localized.nodeEditorMoveDown || "Move down"}
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => removeTransformation(trans.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                      title={localized.remove || "Remove"}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <select
                  value={trans.sourceColumn}
                  onChange={(e) => updateTransformation(trans.id, { sourceColumn: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                >
                  <option value="">
                    {localized.nodeEditorSelectSourceColumn || "Select source column..."}
                  </option>
                  {inputColumns.map((col: string) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                  {previousTransformationColumns.map((colName) => (
                    <option key={colName} value={colName}>
                      {colName} ({localized.nodeEditorFromTransformation || "from transformation"})
                    </option>
                  ))}
                </select>

                <select
                  value={trans.transformationType}
                  onChange={(e) =>
                    updateTransformation(trans.id, {
                      transformationType: e.target.value as
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
                        | "filternotequal",
                    })
                  }
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                >
                  <option value="none">
                    {localized.nodeEditorTransformationNonePassThrough || "None (pass through)"}
                  </option>
                  <option value="prefix">
                    {localized.nodeEditorTransformationAddPrefix || "Add Prefix"}
                  </option>
                  <option value="suffix">
                    {localized.nodeEditorTransformationAddSuffix || "Add Suffix"}
                  </option>
                  <option value="add">
                    {localized.nodeEditorTransformationAddNumber || "Add Number (+)"}
                  </option>
                  <option value="subtract">
                    {localized.nodeEditorTransformationSubtractNumber || "Subtract Number (-)"}
                  </option>
                  <option value="multiply">
                    {localized.nodeEditorTransformationMultiply || "Multiply (*)"}
                  </option>
                  <option value="divide">{localized.nodeEditorTransformationDivide || "Divide (/)"}</option>
                  <option value="rename_whole">
                    {localized.nodeEditorTransformationRenameWhole || "Rename (whole text with new value)"}
                  </option>
                  <option value="rename_substring">
                    {localized.nodeEditorTransformationRenameSubstring ||
                      "Rename (if substring present replace with substring)"}
                  </option>
                  <option value="replace_substring_whole">
                    {localized.nodeEditorTransformationReplaceIfContainsWhole ||
                      "Replace if contains (replace whole value if substring found)"}
                  </option>
                  <option value="regex_replace">
                    {localized.nodeEditorTransformationRegexReplace || "Regex Replace"}
                  </option>
                  <option value="filterequal">
                    {localized.nodeEditorTransformationFilterRowsEqual ||
                      "Filter Rows: Equal (skip if equal)"}
                  </option>
                  <option value="filternotequal">
                    {localized.nodeEditorTransformationFilterRowsNotEqual ||
                      "Filter Rows: Not Equal (skip if not equal)"}
                  </option>
                </select>

                {trans.transformationType === "prefix" && (
                  <input
                    type="text"
                    placeholder={localized.nodeEditorPrefixPlaceholder || "Prefix..."}
                    value={trans.prefix || ""}
                    onChange={(e) => updateTransformation(trans.id, { prefix: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  />
                )}

                {trans.transformationType === "suffix" && (
                  <input
                    type="text"
                    placeholder={localized.nodeEditorSuffixPlaceholder || "Suffix..."}
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
                    placeholder={localized.nodeEditorNumberValuePlaceholder || "Number value..."}
                    value={trans.numericValue ?? ""}
                    onChange={(e) =>
                      updateTransformation(trans.id, { numericValue: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  />
                )}

                {trans.transformationType === "rename_whole" && (
                  <>
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorMatchValueExactPlaceholder || "Match value (exact match)..."
                      }
                      value={trans.matchValue || ""}
                      onChange={(e) => updateTransformation(trans.id, { matchValue: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                    />
                    <input
                      type="text"
                      placeholder={localized.nodeEditorReplaceWithPlaceholder || "Replace with..."}
                      value={trans.replaceValue || ""}
                      onChange={(e) => updateTransformation(trans.id, { replaceValue: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                    />
                  </>
                )}

                {trans.transformationType === "rename_substring" && (
                  <>
                    <input
                      type="text"
                      placeholder={localized.nodeEditorFindSubstringPlaceholder || "Find substring..."}
                      value={trans.findSubstring || ""}
                      onChange={(e) => updateTransformation(trans.id, { findSubstring: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                    />
                    <input
                      type="text"
                      placeholder={localized.nodeEditorReplaceWithPlaceholder || "Replace with..."}
                      value={trans.replaceValue || ""}
                      onChange={(e) => updateTransformation(trans.id, { replaceValue: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                    />
                  </>
                )}

                {trans.transformationType === "replace_substring_whole" && (
                  <>
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorIfContainsSubstringPlaceholder || "If contains substring..."
                      }
                      value={trans.findSubstring || ""}
                      onChange={(e) => updateTransformation(trans.id, { findSubstring: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                    />
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorReplaceEntireValueWithPlaceholder ||
                        "Replace entire value with..."
                      }
                      value={trans.replaceValue || ""}
                      onChange={(e) => updateTransformation(trans.id, { replaceValue: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                    />
                  </>
                )}

                {trans.transformationType === "regex_replace" && (
                  <>
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorRegexPatternPlaceholder ||
                        "Regex pattern (e.g., wh_(\\w+)_emp)..."
                      }
                      value={trans.regexPattern || ""}
                      onChange={(e) => updateTransformation(trans.id, { regexPattern: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                    />
                    <input
                      type="text"
                      placeholder={
                        localized.nodeEditorRegexReplacementPlaceholder ||
                        "Replacement (supports $1, $2, etc.)..."
                      }
                      value={trans.regexReplacement || ""}
                      onChange={(e) => updateTransformation(trans.id, { regexReplacement: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                    />
                  </>
                )}

                {(trans.transformationType === "filterequal" ||
                  trans.transformationType === "filternotequal") && (
                  <input
                    type="text"
                    placeholder={localized.nodeEditorFilterValue || "Filter value..."}
                    value={trans.filterValue || ""}
                    onChange={(e) => updateTransformation(trans.id, { filterValue: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1 mb-1"
                  />
                )}

                <input
                  type="text"
                  placeholder={localized.nodeEditorOutputColumnNamePlaceholder || "Output column name..."}
                  value={trans.outputColumnName}
                  onChange={(e) => updateTransformation(trans.id, { outputColumnName: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
                />
              </div>
            );
          })}

          {transformations.length === 0 && (
            <div className="text-xs text-gray-500 text-center py-2">
              {localized.nodeEditorNoColumnsYetClickAddColumn || "No columns yet - click Add Column"}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"}{" "}
        {localized.nodeEditorAllOriginalColumnsPlusNew || "All original columns +"}{" "}
        {
          transformations.filter((t) => !["filterequal", "filternotequal"].includes(t.transformationType))
            .length
        }{" "}
        {localized.nodeEditorNewLowercase || "new"}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-cyan-500"
        data-output-type="TableSelection"
        style={{
          position: "absolute",
          right: -6,
          top: "50%",
        }}
      />
    </div>
  );
};

// Custom Schema node component
export const CustomSchemaNode: React.FC<{ data: CustomSchemaNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [columns, setColumns] = useState<Array<CustomSchemaColumnWithId>>(data.schemaColumns || []);

  React.useEffect(() => {
    if (data.schemaColumns) {
      setColumns(data.schemaColumns);
    }
  }, [data.schemaColumns]);

  const addColumn = () => {
    const newColumn = {
      id: `col_${Date.now()}`,
      name: "",
      type: "StringU8" as SCHEMA_FIELD_TYPE,
    } as CustomSchemaColumnWithId;
    const newColumns = [...columns, newColumn];
    setColumns(newColumns);

    dispatchNodeDataUpdate(data, { nodeId: id, schemaColumns: newColumns },);
  };

  const removeColumn = (colId: string) => {
    const newColumns = columns.filter((col) => col.id !== colId);
    setColumns(newColumns);

    dispatchNodeDataUpdate(data, { nodeId: id, schemaColumns: newColumns },);
  };

  const updateColumn = (colId: string, field: "name" | "type", value: string) => {
    const newColumns = columns.map((col) => (col.id === colId ? { ...col, [field]: value } : col));
    setColumns(newColumns);

    dispatchNodeDataUpdate(data, { nodeId: id, schemaColumns: newColumns },);
  };

  return (
    <div className="bg-gray-700 border-2 border-purple-600 rounded-lg p-4 min-w-[300px] max-w-[400px]">
      <div className="text-white font-medium text-sm mb-2">
        {data.label || localized.nodeEditorNodeCustomSchemaLabel || "Custom Schema"}
      </div>
      <div className="text-xs text-gray-400 mb-3">
        {localized.nodeEditorNodeCustomSchemaDescription ||
          "Define custom table schema with column names and types"}
      </div>

      <div className="space-y-2 mb-3 max-h-64 overflow-y-auto scrollable-node-content">
        {columns.map((col) => (
          <div key={col.id} className="bg-gray-800 p-2 rounded">
            <div className="flex gap-2 mb-1">
              <input
                type="text"
                placeholder={localized.nodeEditorColumnNamePlaceholder || "Column name"}
                value={col.name}
                onChange={(e) => updateColumn(col.id, "name", e.target.value)}
                className="flex-1 p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded"
              />
              <button
                onClick={() => removeColumn(col.id)}
                className="px-2 bg-red-600 hover:bg-red-700 text-white text-xs rounded"
              >
                ×
              </button>
            </div>
            <select
              value={col.type}
              onChange={(e) => updateColumn(col.id, "type", e.target.value as SCHEMA_FIELD_TYPE)}
              className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded"
            >
              <option value="StringU8">StringU8 (String)</option>
              <option value="StringU16">StringU16 (Long String)</option>
              <option value="OptionalStringU8">OptionalStringU8</option>
              <option value="I32">I32 (Integer)</option>
              <option value="I64">I64 (Long Integer)</option>
              <option value="I16">I16 (Short Integer)</option>
              <option value="F32">F32 (Float)</option>
              <option value="F64">F64 (Double)</option>
              <option value="Boolean">Boolean</option>
              <option value="ColourRGB">ColourRGB</option>
            </select>
          </div>
        ))}
      </div>

      <button
        onClick={addColumn}
        className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded font-medium"
      >
        {localized.nodeEditorAddColumn || "Add Column"}
      </button>

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} {localized.nodeEditorCustomSchema || "Custom Schema"}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-purple-500"
        data-output-type="CustomSchema"
      />
    </div>
  );
};

// Read TSV From Pack node component
export const ReadTSVFromPackNode: React.FC<{ data: ReadTSVFromPackNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [tsvFileName, setTsvFileName] = useState(data.tsvFileName || "");
  const [schemaColumns, setSchemaColumns] = useState<Array<{ name: string; type: SCHEMA_FIELD_TYPE }>>(
    data.schemaColumns || [],
  );
  const [tableName, setTableName] = useState<string>(data.tableName || "");

  React.useEffect(() => {
    if (data.tsvFileName !== undefined) setTsvFileName(data.tsvFileName);
    if (data.schemaColumns !== undefined) setSchemaColumns(data.schemaColumns);
    if (data.tableName !== undefined) setTableName(data.tableName);
  }, [data.tsvFileName, data.schemaColumns, data.tableName]);

  const handleFileNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setTsvFileName(newValue);

    dispatchNodeDataUpdate(data, { nodeId: id, tsvFileName: newValue },);
  };

  return (
    <div className="bg-gray-700 border-2 border-indigo-600 rounded-lg p-4 min-w-[250px]">
      <Handle
        type="target"
        position={Position.Left}
        id="input-schema"
        className="w-3 h-3 bg-purple-500"
        data-input-type="CustomSchema"
        style={{ top: "30%", position: "absolute", left: -6 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="input-packs"
        className="w-3 h-3 bg-blue-500"
        data-input-type="PackFiles"
        style={{ top: "70%", position: "absolute", left: -6 }}
      />

      <div className="text-white font-medium text-sm mb-2">
        {data.label || localized.nodeEditorNodeReadTSVFromPackLabel || "Read TSV From Pack"}
      </div>
      <div className="text-xs text-gray-400 mb-2">
        <div>
          {localized.nodeEditorSchemaLabel || "Schema:"} {localized.nodeEditorCustomSchema || "CustomSchema"}
        </div>
        <div>
          {localized.nodeEditorPacksLabel || "Packs:"} {localized.nodeEditorPackFiles || "PackFiles"}
        </div>
      </div>

      <input
        type="text"
        placeholder={
          localized.nodeEditorFullTsvFilePathPlaceholder || "Full TSV file path (e.g., my_data/data.tsv)"
        }
        value={tsvFileName}
        onChange={handleFileNameChange}
        className="w-full p-2 mb-2 text-sm bg-gray-600 text-white border border-gray-500 rounded"
      />

      <div className="mb-3">
        <label className="text-xs text-gray-400 block mb-1">
          {localized.nodeEditorTableNameOptionalLabel || "Table Name (optional):"}
        </label>
        <input
          type="text"
          placeholder={localized.nodeEditorAutoGeneratedIfEmptyPlaceholder || "Auto-generated if empty"}
          value={tableName}
          onChange={(e) => {
            const newName = e.target.value;
            setTableName(newName);
            dispatchNodeDataUpdate(data, { nodeId: id, tableName: newName },);
          }}
          className="w-full p-1.5 text-xs bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-indigo-400"
        />
      </div>

      {schemaColumns.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-400 mb-1">
            {(localized.nodeEditorExpectedColumnsCount || "Expected columns ({{count}}):").replace(
              "{{count}}",
              String(schemaColumns.length),
            )}
          </div>
          <div className="max-h-32 overflow-y-auto bg-gray-800 rounded p-2 scrollable-node-content">
            {schemaColumns.map((col, idx) => (
              <div key={idx} className="text-xs text-gray-300">
                • {col.name} ({col.type})
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} {localized.nodeEditorTableSelection || "TableSelection"}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-teal-500"
        data-output-type="TableSelection"
      />
    </div>
  );
};

// Custom Rows Input node component
export const CustomRowsInputNode: React.FC<{ data: CustomRowsInputNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const [customRows, setCustomRows] = useState<Array<Record<string, string>>>(data.customRows || []);
  const [schemaColumns, setSchemaColumns] = useState<Array<{ name: string; type: SCHEMA_FIELD_TYPE }>>(
    data.schemaColumns || [],
  );
  const [tableName, setTableName] = useState<string>(data.tableName || "");

  React.useEffect(() => {
    if (data.customRows !== undefined) setCustomRows(data.customRows);
    if (data.schemaColumns !== undefined) setSchemaColumns(data.schemaColumns);
    if (data.tableName !== undefined) setTableName(data.tableName);
  }, [data.customRows, data.schemaColumns, data.tableName]);

  const addRow = () => {
    const newRow: Record<string, string> = {};
    schemaColumns.forEach((col) => {
      newRow[col.name] = "";
    });
    const newRows = [...customRows, newRow];
    setCustomRows(newRows);

    dispatchNodeDataUpdate(data, { nodeId: id, customRows: newRows },);
  };

  const removeRow = (rowIdx: number) => {
    const newRows = customRows.filter((_, idx) => idx !== rowIdx);
    setCustomRows(newRows);

    dispatchNodeDataUpdate(data, { nodeId: id, customRows: newRows },);
  };

  const updateCell = (rowIdx: number, colName: string, value: string) => {
    const newRows = customRows.map((row, idx) => (idx === rowIdx ? { ...row, [colName]: value } : row));
    setCustomRows(newRows);

    dispatchNodeDataUpdate(data, { nodeId: id, customRows: newRows },);
  };

  return (
    <div className="bg-gray-700 border-2 border-indigo-600 rounded-lg p-4 min-w-[350px] max-w-[500px]">
      <Handle
        type="target"
        position={Position.Left}
        id="input-schema"
        className="w-3 h-3 bg-purple-500"
        data-input-type="CustomSchema"
      />

      <div className="text-white font-medium text-sm mb-2">
        {data.label || localized.nodeEditorNodeCustomRowsInputLabel || "Custom Rows Input"}
      </div>
      <div className="text-xs text-gray-400 mb-2">
        {localized.nodeEditorInput || "Input:"} {localized.nodeEditorCustomSchema || "CustomSchema"}
      </div>

      <div className="mb-3">
        <label className="text-xs text-gray-400 block mb-1">
          {localized.nodeEditorTableNameOptionalLabel || "Table Name (optional):"}
        </label>
        <input
          type="text"
          placeholder={localized.nodeEditorAutoGeneratedIfEmptyPlaceholder || "Auto-generated if empty"}
          value={tableName}
          onChange={(e) => {
            const newName = e.target.value;
            setTableName(newName);
            dispatchNodeDataUpdate(data, { nodeId: id, tableName: newName },);
          }}
          className="w-full p-1.5 text-xs bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-indigo-400"
        />
      </div>

      {schemaColumns.length === 0 ? (
        <div className="text-xs text-gray-500 p-3 bg-gray-800 rounded mb-3">
          {localized.nodeEditorConnectCustomSchemaToDefineColumns ||
            "Connect a Custom Schema node to define columns"}
        </div>
      ) : (
        <>
          <div className="mb-3 max-h-64 overflow-y-auto scrollable-node-content">
            {customRows.map((row, rowIdx) => (
              <div key={rowIdx} className="bg-gray-800 p-2 rounded mb-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-400">
                    {(localized.nodeEditorRowNumber || "Row {{rowNumber}}").replace(
                      "{{rowNumber}}",
                      String(rowIdx + 1),
                    )}
                  </span>
                  <button
                    onClick={() => removeRow(rowIdx)}
                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded"
                  >
                    {localized.remove || "Remove"}
                  </button>
                </div>
                {schemaColumns.map((col) => (
                  <div key={col.name} className="mb-1">
                    <label className="text-xs text-gray-400">{col.name}:</label>
                    <input
                      type="text"
                      placeholder={col.type}
                      value={row[col.name] || ""}
                      onChange={(e) => updateCell(rowIdx, col.name, e.target.value)}
                      className="w-full p-1 text-xs bg-gray-700 text-white border border-gray-600 rounded"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>

          <button
            onClick={addRow}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded font-medium"
          >
            {localized.nodeEditorAddRow || "Add Row"}
          </button>
        </>
      )}

      <div className="mt-2 text-xs text-gray-400">
        {localized.nodeEditorOutput || "Output:"} {localized.nodeEditorTableSelection || "TableSelection"}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-teal-500"
        data-output-type="TableSelection"
      />
    </div>
  );
};

export const MultiFilterNode: React.FC<{ data: MultiFilterNodeData; id: string }> = ({ data, id }) => {
  const localized = useLocalizations();
  const updateNodeInternals = useUpdateNodeInternals();
  const [selectedColumn, setSelectedColumn] = useState(data.selectedColumn || "");
  const [splitValues, setSplitValues] = useState<MultiFilterSplitValue[]>(data.splitValues || []);
  const columnNames = data.columnNames || [];
  const nodeRef = React.useRef<HTMLDivElement>(null);
  const rowRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const [handlePositions, setHandlePositions] = React.useState<Map<string, number>>(new Map());

  // Sync state when data changes (e.g., when loading saved graph)
  React.useEffect(() => {
    if (data.selectedColumn !== undefined && data.selectedColumn !== selectedColumn) {
      setSelectedColumn(data.selectedColumn);
    }
    if (data.splitValues && Array.isArray(data.splitValues) && data.splitValues.length > 0) {
      const currentKey = JSON.stringify(splitValues);
      const newKey = JSON.stringify(data.splitValues);
      if (currentKey !== newKey) {
        setSplitValues(data.splitValues);
      }
    }
  }, [data]);

  // Update handle positions when rows change
  React.useLayoutEffect(() => {
    const updatePositions = () => {
      if (!nodeRef.current) return;

      const newPositions = new Map<string, number>();

      splitValues.forEach((split, index) => {
        const rowElement = rowRefs.current.get(split.id);
        if (rowElement && nodeRef.current) {
          // Calculate position using offsetTop which is relative to offsetParent
          let top = rowElement.offsetTop;
          let current: HTMLElement | null = rowElement.offsetParent as HTMLElement;

          // Walk up the tree summing offsetTops until we hit the node container
          while (current && current !== nodeRef.current && nodeRef.current.contains(current)) {
            top += current.offsetTop;
            current = current.offsetParent as HTMLElement;
          }

          // Add half the row height to get to the center
          const rowCenter = top + rowElement.offsetHeight / 2;

          // Subtract half the handle size to center the handle itself
          const handleSize = 12; // w-3 h-3

          // Additional adjustment - empirically determined offset
          const adjustment = 6;
          const topPosition = rowCenter - handleSize / 2 + adjustment;

          newPositions.set(split.id, topPosition);
        }
      });

      setHandlePositions(newPositions);
      updateNodeInternals(id);
    };

    // Delay to ensure DOM is fully rendered
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(updatePositions);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [splitValues]);

  // Update React Flow internals when split values change (handles added/removed/enabled)
  React.useEffect(() => {
    updateNodeInternals(id);
  }, [splitValues, id, updateNodeInternals]);

  React.useEffect(() => {
    updateNodeInternals(id);
  });

  const handleColumnChange = (column: string) => {
    setSelectedColumn(column);
    dispatchNodeDataUpdate(data, { nodeId: id, selectedColumn: column },);
  };

  const addSplitValue = () => {
    const newValue = {
      id: `split_${Date.now()}`,
      value: "",
      enabled: true,
    };
    const newSplitValues = [...splitValues, newValue];
    setSplitValues(newSplitValues);
    dispatchNodeDataUpdate(data, { nodeId: id, splitValues: newSplitValues },);
  };

  const removeSplitValue = (splitId: string) => {
    const newSplitValues = splitValues.filter((s) => s.id !== splitId);
    setSplitValues(newSplitValues);
    dispatchNodeDataUpdate(data, { nodeId: id, splitValues: newSplitValues },);
  };

  const updateSplitValue = (splitId: string, updates: Partial<{ value: string; enabled: boolean }>) => {
    const newSplitValues = splitValues.map((s) => (s.id === splitId ? { ...s, ...updates } : s));
    setSplitValues(newSplitValues);
    dispatchNodeDataUpdate(data, { nodeId: id, splitValues: newSplitValues },);
  };

  return (
    <div
      ref={nodeRef}
      className="bg-gray-800 border-2 border-purple-500 rounded-lg p-4 min-w-[280px] max-w-[350px] relative overflow-visible"
    >
      <Handle type="target" position={Position.Left} id="input" className="w-3 h-3" />

      <div className="text-sm font-bold text-white mb-3">
        {data.label || localized.nodeEditorMultiFilterSplitByValueTitle || "Multi-Filter: Split by Value"}
      </div>

      {/* Column Selector */}
      <div className="mb-3">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorSplitColumnLabel || "Split Column:"}
        </label>
        <select
          value={selectedColumn}
          onChange={(e) => handleColumnChange(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded p-1"
        >
          <option value="">{localized.nodeEditorSelectColumnShort || "Select column..."}</option>
          {columnNames.map((col: string) => (
            <option key={col} value={col}>
              {col}
            </option>
          ))}
        </select>
      </div>

      {/* Split Values List */}
      <div className="mb-2">
        <label className="text-xs text-gray-300 block mb-1">
          {localized.nodeEditorSplitValuesLabel || "Split Values:"}
        </label>
        <div
          className="space-y-1 max-h-48 overflow-y-auto bg-gray-700 border border-gray-600 rounded p-2 scrollable-node-content"
          onWheel={stopWheelPropagation}
        >
          {splitValues.map((split) => {
            return (
              <div
                key={split.id}
                ref={(el) => {
                  if (el) {
                    rowRefs.current.set(split.id, el);
                  } else {
                    rowRefs.current.delete(split.id);
                  }
                }}
                className="flex items-center gap-1 bg-gray-800 p-1 rounded"
              >
                <input
                  type="checkbox"
                  checked={split.enabled}
                  onChange={(e) => updateSplitValue(split.id, { enabled: e.target.checked })}
                  className="w-3 h-3"
                />
                <input
                  type="text"
                  value={split.value}
                  onChange={(e) => updateSplitValue(split.id, { value: e.target.value })}
                  placeholder={localized.nodeEditorValueEllipsisPlaceholder || "Value..."}
                  className="flex-1 bg-gray-700 border border-gray-600 text-white text-xs rounded px-1 py-0.5"
                />
                <button
                  onClick={() => removeSplitValue(split.id)}
                  className="text-xs text-red-400 hover:text-red-300 px-1"
                >
                  ✕
                </button>
              </div>
            );
          })}
          {splitValues.length === 0 && (
            <div className="text-xs text-gray-500 text-center py-2">
              {localized.nodeEditorNoSplitValuesYet || "No split values yet"}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={addSplitValue}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs rounded p-1"
      >
        + {localized.nodeEditorAddValue || "Add Value"}
      </button>

      {/* Output Handles - positioned at node edge, aligned with split values */}
      {splitValues.map((split) => {
        const handleId = split.id; // Use stable split.id instead of split.value
        const showHandle = split.enabled && split.value.trim() !== "";

        if (!showHandle) return null;

        const topPosition = handlePositions.get(split.id);
        if (topPosition === undefined) return null;

        return (
          <Handle
            key={split.id}
            type="source"
            position={Position.Right}
            id={handleId}
            className="w-3 h-3 bg-purple-500"
            data-output-type="TableSelection"
            style={{
              position: "absolute",
              right: -6,
              top: `${topPosition}px`,
            }}
          />
        );
      })}
    </div>
  );
};
