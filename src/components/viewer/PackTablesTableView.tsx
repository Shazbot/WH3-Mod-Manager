import React, { useCallback, useEffect, useMemo, useRef, memo, Suspense, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import "@silevis/reactgrid/styles.css";
import "handsontable/styles/handsontable.min.css";
import "handsontable/styles/ht-theme-main.min.css";
import { getDBPackedFilePath } from "../../utility/packFileHelpers";
import { AmendedSchemaField, DBVersion, PackedFile, SCHEMA_FIELD_TYPE } from "../../packFileTypes";
import { setDeepCloneTarget } from "@/src/appSlice";
import { dataFromBackend } from "./packDataStore";
import debounce from "just-debounce-it";
import Handsontable from "handsontable";
import { HotTableRef } from "@handsontable/react-wrapper";
import { getPreparedTable, PreparedTableData, setPreparedTable, TableCellValue } from "./tablePrepCache";
import { makeSelectCurrentPackData } from "./viewerSelectors";

const DEEP_CLONE_LABEL = "<b>Deep clone</b>";
const BIG_TABLE_ROW_THRESHOLD = 20000;
const BIG_TABLE_CELL_THRESHOLD = 2000000;
const BIG_TABLE_ROW_HEIGHT = 23;
const BIG_TABLE_NUMERIC_COL_WIDTH = 96;
const BIG_TABLE_TEXT_COL_WIDTH = 220;
const BIG_TABLE_CHECKBOX_COL_WIDTH = 36;
const FIXED_SIZING_ROW_THRESHOLD = 1000;
const RENDER_ALL_ROWS_MAX_ROWS = 5000;
const RENDER_ALL_ROWS_MAX_CELLS = 400000;

const LazyHotTable = React.lazy(async () => {
  const [{ HotTable }, { registerAllModules }] = await Promise.all([
    import("@handsontable/react-wrapper"),
    import("handsontable/registry"),
  ]);

  registerAllModules();
  return { default: HotTable };
});

const TableLoadingSpinner = () => (
  <div className="flex items-center justify-center h-96 bg-gray-800">
    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
    <span className="ml-4 text-gray-300">Loading table...</span>
  </div>
);

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

const buildTableCacheKey = (
  packPath: string,
  packedFilePath: string,
  packFile: PackedFile,
  schema: DBVersion,
): string => {
  return [
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

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    for (let colIndex = 0; colIndex < columnCount; colIndex++) {
      const fieldIndex = rowIndex * columnCount + colIndex;
      const cell = schemaFields[fieldIndex];
      if (!cell) continue;

      chunkedTable[rowIndex].push(cell);
      const cellValue = resolveCellValue(cell);
      data[rowIndex][colIndex] = cellValue;
      lowerCaseColumnValues[colIndex][rowIndex] = String(cell.resolvedKeyValue).toLowerCase();
    }
  }

  return {
    chunkedTable,
    data,
    columnHeaders,
    columns,
    columnFilterOptions,
    keyColumnNames,
    lowerCaseColumnValues,
  };
};

const getSelectedCell = (hot: Handsontable): { row: number; col: number } | undefined => {
  const selected = hot.getSelected();
  if (!selected || selected.length !== 1) return undefined;

  const [startRow, startCol, endRow, endCol] = selected[0];
  if (startRow !== endRow || startCol !== endCol) return undefined;
  return { row: startRow, col: startCol };
};

const getDeepCloneCell = (
  hot: Handsontable,
  currentSchema: DBVersion,
  keyColumnNamesUnderscore: Set<string>,
): { row: number; col: number; value: unknown } | undefined => {
  const selectedCell = getSelectedCell(hot);
  if (!selectedCell || keyColumnNamesUnderscore.size === 0) return undefined;

  const { row: selectedRow, col: selectedCol } = selectedCell;
  const selectedField = currentSchema.fields[selectedCol];
  if (selectedField && keyColumnNamesUnderscore.has(selectedField.name)) {
    return {
      row: selectedRow,
      col: selectedCol,
      value: hot.getDataAtCell(selectedRow, selectedCol),
    };
  }

  const firstKeyColumn = currentSchema.fields.findIndex((field) => keyColumnNamesUnderscore.has(field.name));
  if (firstKeyColumn === -1) return undefined;

  return {
    row: selectedRow,
    col: firstKeyColumn,
    value: hot.getDataAtCell(selectedRow, firstKeyColumn),
  };
};

const HandsontableWrapper = memo(
  ({
    data,
    columns,
    columnHeaders,
    hotRef,
    onContextMenuCallback,
    keyColumnNamesUnderscore,
    currentSchema,
    tableHeight,
    isBigTable,
    rowCount,
    colCount,
    viewportColumnRenderingOffset,
    viewportColumnRenderingThreshold,
    renderAllRows,
  }: {
    data: TableCellValue[][];
    columns: Array<{ type: "numeric" | "checkbox" | "text" }>;
    columnHeaders: string[];
    hotRef: React.RefObject<HotTableRef>;
    onContextMenuCallback: (row: number, col: number) => void;
    keyColumnNamesUnderscore: string[];
    currentSchema: DBVersion;
    tableHeight: number;
    isBigTable: boolean;
    rowCount: number;
    colCount: number;
    viewportColumnRenderingOffset: number | "auto";
    viewportColumnRenderingThreshold: number | "auto";
    renderAllRows: boolean;
  }) => {
    const keyColumnSet = useMemo(() => new Set(keyColumnNamesUnderscore), [keyColumnNamesUnderscore]);

    const bigTableColumnWidths = useCallback(
      (columnIndex: number) => {
        const columnType = columns[columnIndex]?.type;
        if (columnType === "checkbox") return BIG_TABLE_CHECKBOX_COL_WIDTH;
        if (columnType === "numeric") return BIG_TABLE_NUMERIC_COL_WIDTH;
        return BIG_TABLE_TEXT_COL_WIDTH;
      },
      [columns],
    );
    const useFixedSizing = isBigTable || rowCount >= FIXED_SIZING_ROW_THRESHOLD;

    const contextMenu = useMemo(() => {
      return {
        items: {
          row_above: {},
          row_below: {},
          about: {
            name() {
              if (!hotRef.current) return DEEP_CLONE_LABEL;
              const hot = hotRef.current.hotInstance as Handsontable;
              if (!hot) return DEEP_CLONE_LABEL;

              const deepCloneCell = getDeepCloneCell(hot, currentSchema, keyColumnSet);
              if (!deepCloneCell) return DEEP_CLONE_LABEL;
              return `<b>Deep clone ${deepCloneCell.value}</b>`;
            },
            hidden() {
              if (!hotRef.current) return true;
              const hot = hotRef.current.hotInstance as Handsontable;
              if (!hot) return true;
              return !getDeepCloneCell(hot, currentSchema, keyColumnSet);
            },
            callback() {
              if (!hotRef.current) return;
              const hot = hotRef.current.hotInstance as Handsontable;
              if (!hot) return;

              const deepCloneCell = getDeepCloneCell(hot, currentSchema, keyColumnSet);
              if (!deepCloneCell) return;

              onContextMenuCallback(hot.toPhysicalRow(deepCloneCell.row), hot.toPhysicalColumn(deepCloneCell.col));
            },
          },
        },
      };
    }, [hotRef, currentSchema, keyColumnSet, onContextMenuCallback]);

    return (
      <Suspense fallback={<TableLoadingSpinner />}>
        <div
          style={{ height: "100%", width: "100%" }}
          onMouseDownCapture={(ev) => {
            if (ev.button === 1) ev.stopPropagation();
          }}
        >
          <LazyHotTable
            ref={hotRef}
            filters={false}
            data={data}
            rowHeaders={true}
            colHeaders={(index) => {
              const field = currentSchema.fields[index];
              if (field && keyColumnSet.has(field.name)) {
                return `🔑 ${columnHeaders[index]}`;
              }
              return columnHeaders[index];
            }}
            columns={columns}
            manualColumnResize={true}
            columnSorting={false}
            manualColumnFreeze={true}
            stretchH="all"
            contextMenu={contextMenu}
            autoRowSize={useFixedSizing ? false : undefined}
            autoColumnSize={useFixedSizing ? false : undefined}
            rowHeights={useFixedSizing ? BIG_TABLE_ROW_HEIGHT : undefined}
            colWidths={useFixedSizing ? bigTableColumnWidths : undefined}
            viewportColumnRenderingOffset={viewportColumnRenderingOffset}
            viewportColumnRenderingThreshold={viewportColumnRenderingThreshold}
            observeDOMVisibility={false}
            renderAllRows={renderAllRows}
            renderAllColumns={false}
            dropdownMenu={false}
            width="100%"
            height={tableHeight}
            licenseKey="non-commercial-and-evaluation"
          />
        </div>
      </Suspense>
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
  const [tableHeight, setTableHeight] = useState<number>(500);

  const hotRef = useRef<HotTableRef>(null);
  const tableParentRef = useRef<HTMLDivElement>(null);
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
    const tableParent = tableParentRef.current;
    if (!tableParent) return;

    let rafId: number | undefined;
    const updateHeight = () => {
      const nextHeight = tableParent.clientHeight;
      if (!nextHeight) return;
      setTableHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      const onResize = () => updateHeight();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    const resizeObserver = new ResizeObserver(() => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = undefined;
        updateHeight();
      });
    });

    resizeObserver.observe(tableParent);

    return () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver.disconnect();
    };
  }, []);

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

  const keyFilterOrDefault =
    keyFilter !== "" ? keyFilter : (preparedTableData?.columnFilterOptions[0] ?? "");
  const indexOfFilteredColumn = preparedTableData?.columnHeaders.indexOf(keyFilterOrDefault) ?? -1;
  const normalizedTableFilter = tableFilter.trim();
  const rowCount = preparedTableData?.data.length ?? 0;
  const colCount = preparedTableData?.columnHeaders.length ?? 0;
  const isBigTable =
    rowCount >= BIG_TABLE_ROW_THRESHOLD || rowCount * colCount >= BIG_TABLE_CELL_THRESHOLD;
  const shouldRenderAllRows =
    !isBigTable &&
    rowCount > 0 &&
    rowCount <= RENDER_ALL_ROWS_MAX_ROWS &&
    rowCount * colCount <= RENDER_ALL_ROWS_MAX_CELLS;
  const nonBigTableColumnWindow = useMemo(
    () => Math.min(colCount, Math.max(12, Math.floor(colCount * 0.45))),
    [colCount],
  );
  const nonBigTableColumnThreshold = useMemo(
    () => Math.min(colCount, Math.max(6, Math.floor(nonBigTableColumnWindow * 0.6))),
    [colCount, nonBigTableColumnWindow],
  );
  const viewportColumnRenderingOffset: number | "auto" = isBigTable ? "auto" : nonBigTableColumnWindow;
  const viewportColumnRenderingThreshold: number | "auto" =
    isBigTable ? "auto" : nonBigTableColumnThreshold;

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
    <div className="flex flex-col h-full">
      <div className="ht-theme-main-dark flex-1 w-full" style={{ height: "100%", overflow: "hidden" }}>
        <div id="packTablesTableParent" ref={tableParentRef} style={{ height: "100%", overflow: "auto" }}>
          <HandsontableWrapper
            data={filteredData}
            columns={preparedTableData.columns}
            columnHeaders={preparedTableData.columnHeaders}
            hotRef={hotRef}
            onContextMenuCallback={handleContextMenuCallback}
            keyColumnNamesUnderscore={keyColumnNamesUnderscore}
            currentSchema={currentSchema}
            tableHeight={tableHeight}
            isBigTable={isBigTable}
            rowCount={rowCount}
            colCount={colCount}
            viewportColumnRenderingOffset={viewportColumnRenderingOffset}
            viewportColumnRenderingThreshold={viewportColumnRenderingThreshold}
            renderAllRows={shouldRenderAllRows}
          />
        </div>
      </div>
      <div className="mt-3 flex gap-6">
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
