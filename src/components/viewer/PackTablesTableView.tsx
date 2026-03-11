import React, { useCallback, useEffect, useMemo, useRef, memo, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { AgGridReact } from "ag-grid-react";
import type { CellContextMenuEvent, ColDef } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { getDBPackedFilePath } from "../../utility/packFileHelpers";
import { AmendedSchemaField, DBVersion, PackedFile, SCHEMA_FIELD_TYPE } from "../../packFileTypes";
import { setDeepCloneTarget } from "@/src/appSlice";
import { dataFromBackend } from "./packDataStore";
import debounce from "just-debounce-it";
import {
  ColumnWidthHint,
  getPreparedTable,
  PreparedTableData,
  setPreparedTable,
  TableCellValue,
} from "./tablePrepCache";
import { makeSelectCurrentPackData } from "./viewerSelectors";

const BIG_TABLE_ROW_THRESHOLD = 20000;
const BIG_TABLE_CELL_THRESHOLD = 2000000;
const BIG_TABLE_ROW_HEIGHT = 23 + 8;
const NORMAL_TABLE_ROW_HEIGHT = 28 + 8;
const BIG_TABLE_NUMERIC_COL_WIDTH = 96;
const BIG_TABLE_CHECKBOX_COL_WIDTH = 36;
const FIXED_SIZING_ROW_THRESHOLD = 1000;
const TABLE_PREP_CACHE_VERSION = 3;
const TEXT_COLUMN_WIDTH_CHAR_PX = 7;
const TEXT_COLUMN_WIDTH_PADDING_PX = 52;
const TEXT_COLUMN_WIDTH_MIN_PX = 110;
const GRID_CELL_FONT = "400 14px Roboto, Arial, sans-serif";
const GRID_HEADER_FONT = "500 14px Roboto, Arial, sans-serif";

const AG_GRID_MODULES_KEY = "__whmmAgGridModulesRegistered";
const globalAny = globalThis as unknown as Record<string, unknown>;
if (!globalAny[AG_GRID_MODULES_KEY]) {
  ModuleRegistry.registerModules([AllCommunityModule]);
  globalAny[AG_GRID_MODULES_KEY] = true;
}

type RowData = TableCellValue[];

let textMeasureContext: CanvasRenderingContext2D | undefined;

const measureTextWidth = (text: string, font: string): number => {
  if (text.length === 0) return 0;
  if (typeof document === "undefined") {
    return Math.ceil(text.length * TEXT_COLUMN_WIDTH_CHAR_PX);
  }

  if (!textMeasureContext) {
    textMeasureContext = document.createElement("canvas").getContext("2d") ?? undefined;
  }

  if (!textMeasureContext) {
    return Math.ceil(text.length * TEXT_COLUMN_WIDTH_CHAR_PX);
  }

  textMeasureContext.font = font;
  return Math.ceil(textMeasureContext.measureText(text).width);
};

const fieldTypeToCellType = (fieldType: SCHEMA_FIELD_TYPE): "numeric" | "checkbox" | "text" => {
  switch (fieldType) {
    case "I64":
    case "F32":
    case "I32":
    case "I16":
    case "F64":
      return "numeric";
    case "Boolean":
      return "checkbox";
    default:
      return "text";
  }
};

const resolveCellValue = (cell: AmendedSchemaField): TableCellValue => {
  if (cell.type === "Boolean") {
    return cell.resolvedKeyValue !== "0";
  }
  if (cell.type === "OptionalStringU8" && cell.resolvedKeyValue === "0") {
    return "";
  }
  return cell.resolvedKeyValue;
};

const formatFloatDisplayValue = (value: TableCellValue | null | undefined): string => {
  if (typeof value !== "string") return value == null ? "" : String(value);

  const normalizedValue = value.trim();
  if (!/^-?\d+\.0+$/.test(normalizedValue)) return value;

  return normalizedValue.replace(/\.0+$/, "");
};

const buildTableCacheKey = (
  packPath: string,
  packedFilePath: string,
  packFile: PackedFile,
  schema: DBVersion,
): string => {
  return [
    TABLE_PREP_CACHE_VERSION,
    packPath,
    packedFilePath,
    packFile.file_size,
    packFile.start_pos,
    schema.version,
    packFile.schemaFields?.length ?? 0,
  ].join("|");
};

const prepareTableData = (
  packFile: PackedFile,
  currentSchema: DBVersion,
  keyColumnNamesUnderscore: string[],
): PreparedTableData => {
  const schemaFields = (packFile.schemaFields as AmendedSchemaField[] | undefined) || [];
  const columnCount = currentSchema.fields.length;
  const rowCount = columnCount > 0 ? Math.ceil(schemaFields.length / columnCount) : 0;

  const keyColumnNames = currentSchema.fields
    .filter((field) => keyColumnNamesUnderscore.includes(field.name))
    .map((field) => field.name.replaceAll("_", " "));

  const columnHeaders = currentSchema.fields.map((field) => field.name.replaceAll("_", " "));
  const columns = currentSchema.fields.map((field) => ({ type: fieldTypeToCellType(field.field_type) }));
  const keyColumnNameSet = new Set(keyColumnNames);

  const columnFilterOptions = [...columnHeaders]
    .map((header, index) => ({ header, index }))
    .sort((first, second) => {
      const isFirstKey = keyColumnNameSet.has(first.header);
      const isSecondKey = keyColumnNameSet.has(second.header);
      if (isFirstKey === isSecondKey) return first.index - second.index;
      return isFirstKey ? -1 : 1;
    })
    .map(({ header }) => header);

  const chunkedTable: AmendedSchemaField[][] = Array.from({ length: rowCount }, () => []);
  const data: TableCellValue[][] = Array.from({ length: rowCount }, () => new Array(columnCount));
  const lowerCaseColumnValues: string[][] = Array.from({ length: columnCount }, () => new Array(rowCount));
  const textNonEmptyCounts = new Array(columnCount).fill(0);
  const textMaxLengths = new Array(columnCount).fill(0);
  const textWidestValues = new Array<string>(columnCount).fill("");

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    for (let colIndex = 0; colIndex < columnCount; colIndex++) {
      const fieldIndex = rowIndex * columnCount + colIndex;
      const cell = schemaFields[fieldIndex];
      if (!cell) continue;

      chunkedTable[rowIndex].push(cell);
      const cellValue = resolveCellValue(cell);
      data[rowIndex][colIndex] = cellValue;
      lowerCaseColumnValues[colIndex][rowIndex] = String(cell.resolvedKeyValue).toLowerCase();

      if (columns[colIndex]?.type !== "text") continue;
      const valueLength = String(cellValue ?? "").length;
      if (valueLength === 0) continue;

      textNonEmptyCounts[colIndex]++;
      if (valueLength > textMaxLengths[colIndex]) {
        textMaxLengths[colIndex] = valueLength;
        textWidestValues[colIndex] = String(cellValue ?? "");
      }
    }
  }

  const columnWidthHints: Array<ColumnWidthHint | undefined> = columns.map((column, colIndex) => {
    if (column.type !== "text") return undefined;

    const nonEmptyCount = textNonEmptyCounts[colIndex];
    const maxLength = textMaxLengths[colIndex];
    if (nonEmptyCount === 0 || maxLength === 0) {
      return { maxLength: 0, nonEmptyCount: 0, widestValue: "" };
    }

    return { maxLength, nonEmptyCount, widestValue: textWidestValues[colIndex] ?? "" };
  });

  return {
    chunkedTable,
    data,
    columnHeaders,
    columns,
    columnWidthHints,
    columnFilterOptions,
    keyColumnNames,
    lowerCaseColumnValues,
  };
};

const copyTextToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fallback for environments where `navigator.clipboard` is unavailable/blocked.
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "true");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "0";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
};

const AgGridWrapper = memo(
  ({
    rowData,
    columns,
    columnHeaders,
    columnWidthHints,
    onContextMenuCallback,
    keyColumnNamesUnderscore,
    currentSchema,
    isBigTable,
    rowCount,
  }: {
    rowData: RowData[];
    columns: Array<{ type: "numeric" | "checkbox" | "text" }>;
    columnHeaders: string[];
    columnWidthHints: Array<ColumnWidthHint | undefined>;
    onContextMenuCallback: (row: number, col: number) => void;
    keyColumnNamesUnderscore: string[];
    currentSchema: DBVersion;
    isBigTable: boolean;
    rowCount: number;
  }) => {
    const keyColumnSet = useMemo(() => new Set(keyColumnNamesUnderscore), [keyColumnNamesUnderscore]);
    const gridRef = useRef<AgGridReact<RowData>>(null);

    const useFixedSizing = isBigTable || rowCount >= FIXED_SIZING_ROW_THRESHOLD;
    const rowHeight = useFixedSizing ? BIG_TABLE_ROW_HEIGHT : NORMAL_TABLE_ROW_HEIGHT;

    const firstKeyColumnIndex = useMemo(() => {
      if (keyColumnSet.size === 0) return -1;
      return currentSchema.fields.findIndex((field) => keyColumnSet.has(field.name));
    }, [currentSchema.fields, keyColumnSet]);

    const getTextColumnWidth = useCallback(
      (columnIndex: number) => {
        const headerText = columnHeaders[columnIndex] ?? "";
        const hint = columnWidthHints[columnIndex];
        const widestValue = hint?.widestValue ?? "";
        const headerWidth = measureTextWidth(headerText, GRID_HEADER_FONT);
        const contentWidth = measureTextWidth(widestValue, GRID_CELL_FONT);
        const targetWidth = Math.max(headerWidth, contentWidth);
        const widthPx = Math.ceil(targetWidth + TEXT_COLUMN_WIDTH_PADDING_PX);
        return Math.max(TEXT_COLUMN_WIDTH_MIN_PX, widthPx);
      },
      [columnHeaders, columnWidthHints],
    );

    const getColumnWidth = useCallback(
      (columnIndex: number) => {
        const columnType = columns[columnIndex]?.type;
        if (columnType === "checkbox") return BIG_TABLE_CHECKBOX_COL_WIDTH;
        if (columnType === "numeric") return BIG_TABLE_NUMERIC_COL_WIDTH;
        return getTextColumnWidth(columnIndex);
      },
      [columns, getTextColumnWidth],
    );

    const defaultColDef = useMemo<ColDef<RowData>>(
      () => ({
        editable: false,
        sortable: true,
        filter: true,
        resizable: true,
        suppressHeaderMenuButton: true,
        suppressMovable: true,
        // autoHeaderHeight: true,
        // wrapHeaderText: true,
      }),
      [],
    );

    const columnDefs = useMemo<Array<ColDef<RowData>>>(() => {
      const defs: Array<ColDef<RowData>> = [
        {
          headerName: "",
          colId: "__rowIndex",
          width: 64,
          resizable: false,
          pinned: "left",
          suppressMovable: true,
          valueGetter: (p) => (typeof p.node?.rowIndex === "number" ? p.node.rowIndex + 1 : ""),
          cellClass: "text-right tabular-nums",
        },
      ];

      for (let colIndex = 0; colIndex < currentSchema.fields.length; colIndex++) {
        const field = currentSchema.fields[colIndex];
        const colType = columns[colIndex]?.type;
        const isFloatColumn = field?.field_type === "F32" || field?.field_type === "F64";
        const isKey = !!field && keyColumnSet.has(field.name);
        const headerName = (isKey ? "🔑 " : "") + (columnHeaders[colIndex] ?? "");

        const width = getColumnWidth(colIndex);
        defs.push({
          headerName,
          headerTooltip: columnHeaders[colIndex] ?? "",
          colId: String(colIndex),
          width: useFixedSizing || colType === "numeric" || colType === "checkbox" ? width : undefined,
          minWidth: !useFixedSizing && colType === "text" ? width : undefined,
          flex: !useFixedSizing && colType === "text" ? 1 : undefined,
          cellRenderer: colType === "checkbox" ? "agCheckboxCellRenderer" : undefined,
          valueGetter: (p) => p.data?.[colIndex],
          valueFormatter: isFloatColumn ? (p) => formatFloatDisplayValue(p.value) : undefined,
          cellStyle:
            colType === "checkbox"
              ? {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }
              : undefined,
          cellClass:
            colType === "numeric"
              ? "text-right tabular-nums"
              : colType === "checkbox"
                ? "text-center"
                : undefined,
        });
      }

      return defs;
    }, [columnHeaders, columns, currentSchema.fields, getColumnWidth, keyColumnSet, useFixedSizing]);

    const [menuState, setMenuState] = useState<
      | {
          clientX: number;
          clientY: number;
          row: number;
          col: number;
          label: string;
        }
      | undefined
    >(undefined);
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (!menuState) return;

      const onWindowMouseDown = (ev: MouseEvent) => {
        const target = ev.target as Node | null;
        if (target && menuRef.current && menuRef.current.contains(target)) return;
        setMenuState(undefined);
      };
      const onWindowKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") setMenuState(undefined);
      };
      window.addEventListener("mousedown", onWindowMouseDown);
      window.addEventListener("keydown", onWindowKeyDown);
      return () => {
        window.removeEventListener("mousedown", onWindowMouseDown);
        window.removeEventListener("keydown", onWindowKeyDown);
      };
    }, [menuState]);

    const onCellContextMenu = useCallback(
      (ev: CellContextMenuEvent<RowData>) => {
        ev.event?.preventDefault();
        ev.event?.stopPropagation();

        if (keyColumnSet.size === 0) {
          setMenuState(undefined);
          return;
        }

        const displayedRowIndex = ev.node?.rowIndex;
        if (typeof displayedRowIndex !== "number" || displayedRowIndex < 0) {
          setMenuState(undefined);
          return;
        }

        const rawColId = ev.column?.getColId() ?? "";
        const clickedColIndex = rawColId === "__rowIndex" ? -1 : Number(rawColId);
        const clickedField = Number.isFinite(clickedColIndex)
          ? currentSchema.fields[clickedColIndex]
          : undefined;

        const deepCloneColIndex =
          clickedField && keyColumnSet.has(clickedField.name) ? clickedColIndex : firstKeyColumnIndex;

        if (deepCloneColIndex === -1) {
          setMenuState(undefined);
          return;
        }

        const deepCloneValue = ev.data?.[deepCloneColIndex];
        const label = `Deep clone ${deepCloneValue ?? ""}`.trimEnd();
        const mouse = ev.event as MouseEvent | undefined;
        setMenuState({
          clientX: mouse?.clientX ?? 0,
          clientY: mouse?.clientY ?? 0,
          row: displayedRowIndex,
          col: deepCloneColIndex,
          label,
        });
      },
      [currentSchema.fields, firstKeyColumnIndex, keyColumnSet],
    );

    const onKeyDownCapture = useCallback(async (ev: React.KeyboardEvent) => {
      const isCopy = (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "c";
      if (!isCopy) return;

      const api = gridRef.current?.api;
      if (!api) return;

      const focused = api.getFocusedCell();
      if (!focused) return;

      const rowNode = api.getDisplayedRowAtIndex(focused.rowIndex);
      const row = rowNode?.data;
      if (!row) return;

      const colId = focused.column.getColId();
      if (colId === "__rowIndex") return;
      const colIndex = Number(colId);
      if (!Number.isFinite(colIndex)) return;

      const value = row[colIndex];
      await copyTextToClipboard(value == null ? "" : String(value));
      ev.preventDefault();
    }, []);

    return (
      <div
        className="ag-theme-material-dark"
        style={{ height: "100%", width: "100%" }}
        onKeyDownCapture={onKeyDownCapture}
        onMouseDownCapture={(ev) => {
          if (ev.button === 1) ev.stopPropagation();
        }}
        onContextMenu={(ev) => ev.preventDefault()}
      >
        <AgGridReact<RowData>
          ref={gridRef}
          theme="legacy"
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowHeight={rowHeight}
          headerHeight={rowHeight}
          animateRows={false}
          suppressRowHoverHighlight={true}
          onCellContextMenu={onCellContextMenu}
        />

        {menuState && (
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              left: menuState.clientX,
              top: menuState.clientY,
              zIndex: 9999,
              minWidth: 200,
            }}
            className="rounded-md border border-gray-600 bg-gray-800 text-gray-100 shadow-lg overflow-hidden"
            onMouseDownCapture={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-700"
              onClick={() => {
                onContextMenuCallback(menuState.row, menuState.col);
                setMenuState(undefined);
              }}
            >
              {menuState.label}
            </button>
          </div>
        )}
      </div>
    );
  },
);

const PackTablesTableView = memo(() => {
  const dispatch = useAppDispatch();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const startArgs = useAppSelector((state) => state.app.startArgs);

  const [keyFilter, setKeyFilter] = useState<string>("");
  const [tableFilterInput, setTableFilterInput] = useState<string>("");
  const [tableFilter, setTableFilter] = useState<string>("");
  const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);

  const setTableFilterDebounced = useMemo(
    () =>
      debounce((value: string) => {
        setTableFilter(value.toLowerCase());
      }, 250),
    [],
  );

  useEffect(() => {
    return () => {
      (setTableFilterDebounced as unknown as { cancel?: () => void }).cancel?.();
    };
  }, [setTableFilterDebounced]);

  useEffect(() => {
    if (!startArgs.includes("-testDBClone")) return;

    const autoDispatchTimer = setTimeout(() => {
      dispatch(setDeepCloneTarget({ row: 3, col: 14 }));
    }, 2000);

    return () => {
      clearTimeout(autoDispatchTimer);
    };
  }, [dispatch, startArgs]);

  const packPath = currentDBTableSelection?.packPath ?? "";
  const packData = useAppSelector((state) => selectCurrentPackData(state, packPath));

  const packedFilePath = useMemo(() => {
    if (!currentDBTableSelection) return "";
    return getDBPackedFilePath(currentDBTableSelection);
  }, [currentDBTableSelection]);

  const packFile = useMemo(() => {
    if (!packData || !packedFilePath || !packData.packedFiles) return undefined;

    const directMatch = packData.packedFiles[packedFilePath];
    if (directMatch) return directMatch;

    for (const [iterPackedFilePath, iterPackedFile] of Object.entries(packData.packedFiles)) {
      if (iterPackedFilePath.startsWith(packedFilePath)) {
        return iterPackedFile;
      }
    }

    return undefined;
  }, [packData, packedFilePath]);

  const currentSchema = packFile?.tableSchema;
  const keyColumnNamesUnderscore = useMemo(() => {
    if (!currentDBTableSelection) return [];
    return dataFromBackend.referencedColums[currentDBTableSelection.dbName] || [];
  }, [currentDBTableSelection]);

  const tableCacheKey = useMemo(() => {
    if (!packFile || !currentSchema || !packedFilePath || !packPath) return "";
    return buildTableCacheKey(packPath, packedFilePath, packFile, currentSchema);
  }, [packPath, packedFilePath, packFile, currentSchema]);

  const preparedTableData = useMemo(() => {
    if (!packFile || !currentSchema || !tableCacheKey) return undefined;

    const cached = getPreparedTable(tableCacheKey);
    if (cached) return cached;

    const prepared = prepareTableData(packFile, currentSchema, keyColumnNamesUnderscore);
    setPreparedTable(tableCacheKey, prepared);
    return prepared;
  }, [tableCacheKey, packFile, currentSchema, keyColumnNamesUnderscore]);

  useEffect(() => {
    if (!preparedTableData || preparedTableData.columnFilterOptions.length === 0) return;
    if (keyFilter !== "" && preparedTableData.columnFilterOptions.includes(keyFilter)) return;
    setKeyFilter(preparedTableData.columnFilterOptions[0]);
  }, [preparedTableData, keyFilter]);

  const onFilterInputChange = (value: string) => {
    setTableFilterInput(value);
    setTableFilterDebounced(value);
  };

  const keyFilterOrDefault = keyFilter !== "" ? keyFilter : (preparedTableData?.columnFilterOptions[0] ?? "");
  const indexOfFilteredColumn = preparedTableData?.columnHeaders.indexOf(keyFilterOrDefault) ?? -1;
  const normalizedTableFilter = tableFilter.trim();
  const rowCount = preparedTableData?.data.length ?? 0;
  const colCount = preparedTableData?.columnHeaders.length ?? 0;
  const isBigTable = rowCount >= BIG_TABLE_ROW_THRESHOLD || rowCount * colCount >= BIG_TABLE_CELL_THRESHOLD;

  const filteredRowIndices = useMemo(() => {
    if (!preparedTableData) return [];
    if (indexOfFilteredColumn === -1 || normalizedTableFilter === "") {
      return preparedTableData.data.map((_row, rowIndex) => rowIndex);
    }

    const lowerCaseColumn = preparedTableData.lowerCaseColumnValues[indexOfFilteredColumn] || [];
    const filteredIndices: number[] = [];
    for (let rowIndex = 0; rowIndex < lowerCaseColumn.length; rowIndex++) {
      const value = lowerCaseColumn[rowIndex];
      if (value && value.includes(normalizedTableFilter)) {
        filteredIndices.push(rowIndex);
      }
    }

    return filteredIndices;
  }, [preparedTableData, indexOfFilteredColumn, normalizedTableFilter]);

  const filteredData = useMemo(() => {
    if (!preparedTableData) return [];
    return filteredRowIndices.map((rowIndex) => preparedTableData.data[rowIndex]);
  }, [preparedTableData, filteredRowIndices]);

  const handleContextMenuCallback = useCallback(
    (row: number, col: number) => {
      const unfilteredRowIndex = filteredRowIndices[row] ?? row;
      dispatch(setDeepCloneTarget({ row: unfilteredRowIndex, col }));
    },
    [dispatch, filteredRowIndices],
  );

  if (!currentDBTableSelection || !packData || !packFile || !currentSchema || !preparedTableData) {
    return <></>;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div id="packTablesTableParent" className="flex-1 min-h-0 w-full overflow-hidden bg-gray-900">
        <AgGridWrapper
          rowData={filteredData}
          columns={preparedTableData.columns}
          columnHeaders={preparedTableData.columnHeaders}
          columnWidthHints={preparedTableData.columnWidthHints}
          onContextMenuCallback={handleContextMenuCallback}
          keyColumnNamesUnderscore={keyColumnNamesUnderscore}
          currentSchema={currentSchema}
          isBigTable={isBigTable}
          rowCount={rowCount}
        />
      </div>
      <div className="mt-3 flex gap-6 shrink-0">
        <select
          value={keyFilterOrDefault}
          onChange={(e) => setKeyFilter(e.target.value)}
          className="px-2 py-1 text-sm border border-gray-300 rounded dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {preparedTableData.columnFilterOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          value={tableFilterInput}
          placeholder={"filter by selected column"}
          onChange={(e) => onFilterInputChange(e.target.value)}
          className="bg-gray-50 w-48 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 focus:outline-none"
        />
      </div>
    </div>
  );
});

export default PackTablesTableView;
