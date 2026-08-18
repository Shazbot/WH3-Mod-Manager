import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { LOC_TABLE, type AncillariesEditAction, type AncillariesEditState } from "../../ancillariesData/edits";
import { groupIssuesByRow, type AncillariesRowIssue } from "../../ancillariesData/validate";
import { parseEditedCellValue } from "../../utility/dbRowCells";
import { LocVersion, type DBField, type DBVersion } from "../../packFileTypes";

const AG_GRID_MODULES_KEY = "__whmmAgGridModulesRegistered";
const globalAny = globalThis as unknown as Record<string, unknown>;
if (!globalAny[AG_GRID_MODULES_KEY]) {
  ModuleRegistry.registerModules([AllCommunityModule]);
  globalAny[AG_GRID_MODULES_KEY] = true;
}

export type AncillariesTablesTabProps = {
  state: AncillariesEditState;
  dispatch: (action: AncillariesEditAction) => void;
  onClearAll: () => void;
  tableSchemas: Record<string, DBVersion>;
  rowIssues?: AncillariesRowIssue[];
};

/** One grid row: the edit-model row flattened, plus the two columns the grid adds. */
type GridRow = Record<string, string> & { __rowId: string; __issues: string };

/** Loc rides the same store as db rows, so it needs a schema too - the one the `.loc` writer uses. */
const schemaForTable = (table: string, tableSchemas: Record<string, DBVersion>): DBVersion | undefined =>
  table === LOC_TABLE ? LocVersion : tableSchemas[table];

const columnLabel = (field: DBField) => (field.is_key ? `${field.name} *` : field.name);

const AncillariesTablesTab = memo(
  ({ state, dispatch, onClearAll, tableSchemas, rowIssues }: AncillariesTablesTabProps) => {
    const tablesWithCounts = useMemo(() => {
      const counts = new Map<string, number>();
      for (const id of state.order) {
        const row = state.rowsById[id];
        if (row) counts.set(row.table, (counts.get(row.table) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [state]);

    const [selectedTable, setSelectedTable] = useState("");
    // The selected table disappears when its last row is deleted, which would otherwise leave the
    // grid pointed at nothing.
    useEffect(() => {
      if (tablesWithCounts.length === 0) return;
      if (!tablesWithCounts.some(([table]) => table === selectedTable)) setSelectedTable(tablesWithCounts[0][0]);
    }, [selectedTable, tablesWithCounts]);

    const schema = schemaForTable(selectedTable, tableSchemas);
    const issuesByRow = useMemo(() => groupIssuesByRow(rowIssues ?? []), [rowIssues]);

    const rowData = useMemo<GridRow[]>(() => {
      if (!schema) return [];
      return state.order
        .map((id) => state.rowsById[id])
        .filter((row) => row?.table === selectedTable)
        .map((row) => {
          const gridRow = { __rowId: row.id, __issues: (issuesByRow[row.id] ?? []).map((i) => i.message).join(" ") };
          for (const field of schema.fields) {
            (gridRow as Record<string, string>)[field.name] = row.values[field.name] ?? field.default_value ?? "";
          }
          return gridRow as GridRow;
        });
    }, [issuesByRow, schema, selectedTable, state]);

    const columnDefs = useMemo<Array<ColDef<GridRow>>>(() => {
      if (!schema) return [];
      return [
        ...schema.fields.map<ColDef<GridRow>>((field) => ({
          field: field.name,
          headerName: columnLabel(field),
          headerTooltip: `${field.field_type}${field.description ? ` - ${field.description}` : ""}`,
          editable: true,
          minWidth: 120,
          flex: 1,
          // A setter rather than `onCellValueChanged`: it runs before the value is committed, so a
          // value the field's type cannot hold is refused outright instead of written and then put
          // back.
          valueSetter: (params) => {
            const nextValue = String(params.newValue ?? "");
            if (nextValue === String(params.oldValue ?? "")) return false;
            if (!parseEditedCellValue(field.field_type, nextValue)) return false;
            params.data[field.name] = nextValue;
            dispatch({ type: "setCell", id: params.data.__rowId, column: field.name, value: nextValue });
            return true;
          },
          cellClassRules: {
            "text-red-400": (params) =>
              (issuesByRow[params.data?.__rowId ?? ""] ?? []).some((issue) => issue.column === field.name),
          },
        })),
        {
          field: "__issues",
          headerName: "Issues",
          editable: false,
          minWidth: 200,
          flex: 2,
          cellClass: "text-amber-400",
        },
      ];
    }, [dispatch, issuesByRow, schema]);

    const addBlankRow = useCallback(() => {
      if (!schema || !selectedTable) return;
      const values: Record<string, string> = {};
      for (const field of schema.fields) values[field.name] = field.default_value ?? "";
      dispatch({ type: "addRows", rows: [{ table: selectedTable, origin: "manual", values }] });
    }, [dispatch, schema, selectedTable]);

    const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
    const deleteSelected = useCallback(() => {
      for (const id of selectedRowIds) dispatch({ type: "removeRow", id });
      setSelectedRowIds([]);
    }, [dispatch, selectedRowIds]);

    if (tablesWithCounts.length === 0) {
      return (
        <div className="px-6 py-4 text-sm text-gray-400">
          No new rows yet. Edit an ancillary, create one, or clone one, and its rows show up here.
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
                {table === LOC_TABLE ? "localisation" : table} ({count})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={addBlankRow}
            disabled={!schema}
            className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:opacity-50"
          >
            Add blank row
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={selectedRowIds.length === 0}
            className="rounded bg-red-800 px-2 py-1 text-xs text-gray-100 hover:bg-red-700 disabled:opacity-50"
          >
            Delete {selectedRowIds.length > 0 ? `${selectedRowIds.length} ` : ""}selected
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="rounded border border-red-600 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
          >
            Clear all pending edits
          </button>

          {!schema && <span className="text-xs text-red-400">No schema for {selectedTable}; it cannot be saved.</span>}
          {rowIssues && rowIssues.length > 0 && (
            <span className="ml-auto text-xs text-amber-400">
              {rowIssues.length} issue{rowIssues.length === 1 ? "" : "s"} across all tables
            </span>
          )}
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

export default AncillariesTablesTab;
