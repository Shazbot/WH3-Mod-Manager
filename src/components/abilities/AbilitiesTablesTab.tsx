import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { LocVersion, type DBField, type DBVersion } from "../../packFileTypes";
import { parseEditedCellValue } from "../../utility/dbRowCells";
import {
  getNewRowsFullValueColumnWidth,
  isNewRowsFullValueField,
  NEW_ROWS_COLUMN_MIN_WIDTH,
} from "../../utility/newRowsColumnSizing";
import {
  ABILITIES_LOC_TABLE,
  type AbilityEditAction,
  type AbilityEditState,
} from "../../abilitiesData/edits";

const AG_GRID_MODULES_KEY = "__whmmAgGridModulesRegistered";
const globalAny = globalThis as unknown as Record<string, unknown>;
if (!globalAny[AG_GRID_MODULES_KEY]) {
  ModuleRegistry.registerModules([AllCommunityModule]);
  globalAny[AG_GRID_MODULES_KEY] = true;
}

type GridRow = Record<string, string> & { __rowId: string };

const schemaForTable = (table: string, schemas: Record<string, DBVersion>) =>
  table === ABILITIES_LOC_TABLE ? LocVersion : schemas[table];
const label = (field: DBField) => (field.is_key ? `${field.name} *` : field.name);

const AbilitiesTablesTab = memo(
  ({
    state,
    dispatch,
    tableSchemas,
  }: {
    state: AbilityEditState;
    dispatch: (action: AbilityEditAction) => void;
    tableSchemas: Record<string, DBVersion>;
  }) => {
    const tablesWithCounts = useMemo(() => {
      const counts = new Map<string, number>();
      for (const id of state.order) {
        const row = state.rowsById[id];
        if (row) counts.set(row.table, (counts.get(row.table) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [state]);
    const [selectedTable, setSelectedTable] = useState("");
    const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

    useEffect(() => {
      if (!tablesWithCounts.length) return;
      if (!tablesWithCounts.some(([table]) => table === selectedTable)) setSelectedTable(tablesWithCounts[0][0]);
    }, [selectedTable, tablesWithCounts]);

    const schema = schemaForTable(selectedTable, tableSchemas);
    const rowData = useMemo<GridRow[]>(() => {
      if (!schema) return [];
      return state.order
        .map((id) => state.rowsById[id])
        .filter((row) => row?.table === selectedTable)
        .map((row) => {
          const result = { __rowId: row.id } as GridRow;
          for (const field of schema.fields) result[field.name] = row.values[field.name] ?? field.default_value ?? "";
          return result;
        });
    }, [schema, selectedTable, state]);

    const columnDefs = useMemo<Array<ColDef<GridRow>>>(() => {
      if (!schema) return [];
      return schema.fields.map((field) => {
        const isFullValueField = isNewRowsFullValueField(field);
        const width = isFullValueField ? getNewRowsFullValueColumnWidth(field, rowData) : NEW_ROWS_COLUMN_MIN_WIDTH;
        return {
          field: field.name,
          headerName: label(field),
          headerTooltip: `${field.field_type}${field.description ? ` - ${field.description}` : ""}`,
          editable: true,
          minWidth: width,
          width: isFullValueField ? width : undefined,
          flex: isFullValueField ? undefined : 1,
          cellClass: isFullValueField ? "new-rows-full-value" : undefined,
          valueSetter: (params) => {
            const next = String(params.newValue ?? "");
            if (next === String(params.oldValue ?? "") || !parseEditedCellValue(field.field_type, next)) return false;
            params.data[field.name] = next;
            dispatch({ type: "setCell", id: params.data.__rowId, column: field.name, value: next });
            return true;
          },
        } satisfies ColDef<GridRow>;
      });
    }, [dispatch, rowData, schema]);

    const addBlank = useCallback(() => {
      if (!schema || !selectedTable) return;
      const values: Record<string, string> = {};
      for (const field of schema.fields) values[field.name] = field.default_value ?? "";
      dispatch({ type: "addRows", rows: [{ table: selectedTable, values, origin: "manual" }] });
    }, [dispatch, schema, selectedTable]);

    const deleteSelected = useCallback(() => {
      selectedRowIds.forEach((id) => dispatch({ type: "removeRow", id }));
      setSelectedRowIds([]);
    }, [dispatch, selectedRowIds]);

    if (!tablesWithCounts.length) {
      return (
        <div className="px-6 py-4 text-sm text-gray-400">
          No pending rows yet. Edit or clone an ability and every row that will be written appears here.
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          <select
            value={selectedTable}
            onChange={(event) => setSelectedTable(event.target.value)}
            className="rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-100"
          >
            {tablesWithCounts.map(([table, count]) => (
              <option key={table} value={table}>
                {table === ABILITIES_LOC_TABLE ? "localisation" : table} ({count})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!schema}
            onClick={addBlank}
            className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:opacity-50"
          >
            Add blank row
          </button>
          <button
            type="button"
            disabled={!selectedRowIds.length}
            onClick={deleteSelected}
            className="rounded bg-red-800 px-2 py-1 text-xs text-gray-100 hover:bg-red-700 disabled:opacity-50"
          >
            Delete {selectedRowIds.length || ""} selected
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "reset" })}
            className="rounded border border-red-600 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
          >
            Clear all pending edits
          </button>
          {!schema && <span className="text-xs text-red-400">No schema for this table; it cannot be saved.</span>}
        </div>
        <div className="ag-theme-material-dark min-h-0 flex-1">
          <AgGridReact<GridRow>
            theme="legacy"
            rowData={rowData}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.__rowId}
            rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true }}
            onSelectionChanged={(event) => setSelectedRowIds(event.api.getSelectedRows().map((row) => row.__rowId))}
            headerHeight={32}
            rowHeight={30}
            animateRows={false}
            stopEditingWhenCellsLoseFocus={true}
          />
        </div>
      </div>
    );
  },
);

export default AbilitiesTablesTab;
