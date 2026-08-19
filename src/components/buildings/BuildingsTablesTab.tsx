import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { useLocalizations } from "../../localizationContext";
import { LOC_TABLE, type BuildingsEditAction, type BuildingsEditState } from "../../buildingsData/edits";
import { groupIssuesByRow, type BuildingsRowIssue } from "../../buildingsData/validate";
import { parseEditedCellValue } from "../../utility/dbRowCells";
import {
  getNewRowsFullValueColumnWidth,
  isNewRowsFullValueField,
  NEW_ROWS_COLUMN_MIN_WIDTH,
} from "../../utility/newRowsColumnSizing";
import { LocVersion, type DBField, type DBVersion } from "../../packFileTypes";

const AG_GRID_MODULES_KEY = "__whmmAgGridModulesRegistered";
const globalAny = globalThis as unknown as Record<string, unknown>;
if (!globalAny[AG_GRID_MODULES_KEY]) {
  ModuleRegistry.registerModules([AllCommunityModule]);
  globalAny[AG_GRID_MODULES_KEY] = true;
}

export type BuildingsTablesTabProps = {
  state: BuildingsEditState;
  dispatch: (action: BuildingsEditAction) => void;
  onClearAll: () => void;
  tableSchemas: Record<string, DBVersion>;
  rowIssues?: BuildingsRowIssue[];
};

/** One grid row: the edit-model row flattened, plus the two columns the grid adds. */
type GridRow = Record<string, string> & { __rowId: string; __issues: string };

/** Loc rides the same store as db rows, so it needs a schema too - the one the `.loc` writer uses. */
const schemaForTable = (table: string, tableSchemas: Record<string, DBVersion>): DBVersion | undefined =>
  table === LOC_TABLE ? LocVersion : tableSchemas[table];

const columnLabel = (field: DBField) => (field.is_key ? `${field.name} *` : field.name);

const BuildingsTablesTab = memo(({ state, dispatch, onClearAll, tableSchemas, rowIssues }: BuildingsTablesTabProps) => {
  const localized = useLocalizations();
  const tablesWithCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of state.order) {
      const row = state.rowsById[id];
      if (row) counts.set(row.table, (counts.get(row.table) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state]);

  const [selectedTable, setSelectedTable] = useState("");
  // The selected table disappears when its last row is deleted, which would otherwise leave the grid
  // pointed at nothing.
  useEffect(() => {
    if (tablesWithCounts.length === 0) return;
    if (!tablesWithCounts.some(([table]) => table === selectedTable)) setSelectedTable(tablesWithCounts[0][0]);
  }, [selectedTable, tablesWithCounts]);

  const schema = schemaForTable(selectedTable, tableSchemas);
  const issuesByRow = useMemo(() => groupIssuesByRow(rowIssues ?? []), [rowIssues]);
  const tablesWithIssues = useMemo(() => new Set((rowIssues ?? []).map((issue) => issue.table)), [rowIssues]);

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
      ...schema.fields.map<ColDef<GridRow>>((field) => {
        const isFullValueField = isNewRowsFullValueField(field);
        const fullValueColumnWidth = isFullValueField
          ? getNewRowsFullValueColumnWidth(field, rowData)
          : NEW_ROWS_COLUMN_MIN_WIDTH;

        return {
          // Fixed content-sized columns keep identifiers readable; the other columns share whatever
          // width remains in the grid.
          minWidth: fullValueColumnWidth,
          width: isFullValueField ? fullValueColumnWidth : undefined,
          flex: isFullValueField ? undefined : 1,
          field: field.name,
          headerName: columnLabel(field),
          headerTooltip: `${field.field_type}${field.description ? ` - ${field.description}` : ""}`,
          editable: true,
          cellClass: isFullValueField ? "new-rows-full-value" : undefined,
          // A setter rather than `onCellValueChanged`: it runs before the value is committed, so a
          // value the field's type cannot hold is refused outright instead of written and then put
          // back. Same rule the pack grid uses - a coerced value would serialize into something the
          // user never typed.
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
        };
      }),
      {
        field: "__issues",
        headerName: localized.buildingsIssues || "Issues",
        editable: false,
        minWidth: 200,
        flex: 2,
        cellClass: "text-amber-400",
      },
    ];
  }, [dispatch, issuesByRow, localized.buildingsIssues, rowData, schema]);

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
        {localized.buildingsNoNewRows ||
          "No new rows yet. Add a building on the board, or clone one, and its rows show up here."}
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
            <option key={table} value={table} className={tablesWithIssues.has(table) ? "text-yellow-400" : undefined}>
              {table === LOC_TABLE ? localized.buildingsLocalisation || "localisation" : table} ({count})
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={addBlankRow}
          disabled={!schema}
          className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:opacity-50"
        >
          {localized.buildingsAddBlankRow || "Add blank row"}
        </button>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={selectedRowIds.length === 0}
          className="rounded bg-red-800 px-2 py-1 text-xs text-gray-100 hover:bg-red-700 disabled:opacity-50"
        >
          {localized.buildingsDelete || "Delete"} {selectedRowIds.length > 0 ? `${selectedRowIds.length} ` : ""}
          {localized.buildingsSelected || "selected"}
        </button>
        <button
          type="button"
          onClick={onClearAll}
          className="rounded border border-red-600 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
        >
          {localized.buildingsClearPending || "Clear all pending edits"}
        </button>

        {!schema && (
          <span className="text-xs text-red-400">
            {(localized.buildingsNoSchemaFor || "No schema for {{table}}; it cannot be saved.").replace(
              "{{table}}",
              selectedTable,
            )}
          </span>
        )}
        {rowIssues && rowIssues.length > 0 && (
          <span className="ml-auto text-xs text-amber-400">
            {(rowIssues.length === 1
              ? localized.buildingsIssueOneAllTables || "1 issue across all tables"
              : localized.buildingsIssuesOtherAllTables || "{{count}} issues across all tables"
            ).replace("{{count}}", `${rowIssues.length}`)}
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
});

export default BuildingsTablesTab;
