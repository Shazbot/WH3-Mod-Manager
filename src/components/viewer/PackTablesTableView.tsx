import React, { useCallback, useEffect, useMemo, useRef, memo, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { AgGridReact } from "ag-grid-react";
import type {
  CellContextMenuEvent,
  CellMouseDownEvent,
  CellMouseOverEvent,
  CellValueChangedEvent,
  ColDef,
  ColumnHeaderClickedEvent,
} from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { getDBPackedFilePath, getPackNameFromPath } from "../../utility/packFileHelpers";
import { AmendedSchemaField, DBVersion, Field, PackedFile, SCHEMA_FIELD_TYPE } from "../../packFileTypes";
import { setDeepCloneTarget, setPacksData } from "@/src/appSlice";
import { dataFromBackend } from "./packDataStore";
import debounce from "just-debounce-it";
import {
  clearPreparedTableForPackedFile,
  ColumnWidthHint,
  getPreparedTable,
  PreparedTableData,
  setPreparedTable,
  TableCellValue,
} from "./tablePrepCache";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";
import { vanillaPackNames } from "@/src/supportedGames";

const BIG_TABLE_ROW_THRESHOLD = 20000;
const BIG_TABLE_CELL_THRESHOLD = 2000000;
const BIG_TABLE_ROW_HEIGHT = 23 + 8;
const NORMAL_TABLE_ROW_HEIGHT = 28 + 8;
const BIG_TABLE_NUMERIC_COL_WIDTH = 96;
const BIG_TABLE_CHECKBOX_COL_WIDTH = 36;
const FIXED_SIZING_ROW_THRESHOLD = 1000;
const TABLE_PREP_CACHE_VERSION = 3;
const ROW_INDEX_COLUMN_MIN_WIDTH = 50;
const ROW_INDEX_COLUMN_PADDING_PX = 20;
const SELECTION_AUTO_SCROLL_EDGE_PX = 32;
const SELECTION_AUTO_SCROLL_MAX_STEP_PX = 24;
const ROW_INDEX_GRID_CELL_FONT = "400 17.6px Roboto, Arial, sans-serif";
const TEXT_COLUMN_WIDTH_CHAR_PX = 7;
const TEXT_COLUMN_WIDTH_PADDING_PX = 52;
const TEXT_COLUMN_WIDTH_MIN_PX = 110;
const GRID_CELL_FONT = "400 14px Roboto, Arial, sans-serif";
const GRID_HEADER_FONT = "500 14px Roboto, Arial, sans-serif";
const KEY_HEADER_ICON_WIDTH_PX = 22;
const COLUMN_HEADER_DISPLAY_NAMES: Record<string, string> = {
  "additional building requirement": "building req.",
  "campaign cap": "camp. cap",
  "create time": "creation time",
  "multiplayer cap": "MP cap",
  "multiplayer cost": "MP cost",
  "num men": "men",
  "num ships": "ships",
};

const AG_GRID_MODULES_KEY = "__whmmAgGridModulesRegistered";
const globalAny = globalThis as unknown as Record<string, unknown>;
if (!globalAny[AG_GRID_MODULES_KEY]) {
  ModuleRegistry.registerModules([AllCommunityModule]);
  globalAny[AG_GRID_MODULES_KEY] = true;
}

type RowData = TableCellValue[];
type SelectionRange = { startRow: number; endRow: number; startCol: number; endCol: number };
type DragSelectionState = {
  mode: "cells" | "row";
  anchorRow: number;
  anchorCol: number;
  baseRanges: SelectionRange[];
};

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

const buildFieldValues = (fieldType: SCHEMA_FIELD_TYPE, value: string | number | boolean): Field[] => {
  switch (fieldType) {
    case "Boolean":
      return [{ type: "UInt8", val: value ? 1 : 0 }];
    case "StringU16":
      return [{ type: "String", val: String(value) }];
    case "StringU8": {
      const stringValue = String(value);
      return [
        { type: "Int16", val: stringValue.length },
        { type: "String", val: stringValue },
      ];
    }
    case "OptionalStringU8": {
      const stringValue = String(value);
      if (stringValue === "") {
        return [{ type: "Int8", val: 0 }];
      }
      return [
        { type: "Int8", val: 1 },
        { type: "Int16", val: stringValue.length },
        { type: "String", val: stringValue },
      ];
    }
    case "F32":
      return [{ type: "F32", val: Number(value) }];
    case "I32":
    case "ColourRGB":
      return [{ type: "I32", val: Number(value) }];
    case "I16":
      return [{ type: "I16", val: Number(value) }];
    case "F64":
      return [{ type: "F64", val: Number(value) }];
    case "I64":
      return [{ type: "I64", val: Number(value) }];
    default:
      return [{ type: "String", val: String(value) }];
  }
};

const parseEditedCellValue = (
  fieldType: SCHEMA_FIELD_TYPE,
  value: unknown,
): { value: TableCellValue; resolvedKeyValue: string; fields: Field[] } | undefined => {
  switch (fieldType) {
    case "Boolean": {
      if (typeof value === "boolean") {
        return {
          value,
          resolvedKeyValue: value ? "1" : "0",
          fields: buildFieldValues(fieldType, value),
        };
      }

      const normalized = String(value ?? "")
        .trim()
        .toLowerCase();
      if (["1", "true", "yes"].includes(normalized)) {
        return {
          value: true,
          resolvedKeyValue: "1",
          fields: buildFieldValues(fieldType, true),
        };
      }
      if (["0", "false", "no"].includes(normalized)) {
        return {
          value: false,
          resolvedKeyValue: "0",
          fields: buildFieldValues(fieldType, false),
        };
      }
      return undefined;
    }
    case "StringU16":
    case "StringU8": {
      const nextValue = String(value ?? "");
      return {
        value: nextValue,
        resolvedKeyValue: nextValue,
        fields: buildFieldValues(fieldType, nextValue),
      };
    }
    case "OptionalStringU8": {
      const nextValue = String(value ?? "");
      return {
        value: nextValue,
        resolvedKeyValue: nextValue === "" ? "0" : nextValue,
        fields: buildFieldValues(fieldType, nextValue),
      };
    }
    case "I16":
    case "I32":
    case "I64":
    case "ColourRGB": {
      const normalized = String(value ?? "").trim();
      if (!/^-?\d+$/.test(normalized)) return undefined;
      const parsedValue = Number(normalized);
      return {
        value: parsedValue,
        resolvedKeyValue: normalized,
        fields: buildFieldValues(fieldType, parsedValue),
      };
    }
    case "F32":
    case "F64": {
      const normalized = String(value ?? "").trim();
      if (normalized === "") return undefined;
      const parsedValue = Number(normalized);
      if (!Number.isFinite(parsedValue)) return undefined;
      return {
        value: parsedValue,
        resolvedKeyValue: normalized,
        fields: buildFieldValues(fieldType, parsedValue),
      };
    }
    default:
      return undefined;
  }
};

const getDisplayColumnHeader = (headerName: string): string => {
  return COLUMN_HEADER_DISPLAY_NAMES[headerName] ?? headerName;
};

const getHeaderMinWidth = (headerName: string, hasKeyIcon: boolean): number => {
  const minHeaderWidth = TEXT_COLUMN_WIDTH_MIN_PX * 1;
  if (headerName.length === 0) return minHeaderWidth;

  const words = headerName.split(/\s+/).filter(Boolean);
  const longestWordWidth = words.reduce((maxWidth, word) => {
    return Math.max(maxWidth, measureTextWidth(word, GRID_HEADER_FONT));
  }, 0);
  const fullHeaderWidth = measureTextWidth(headerName, GRID_HEADER_FONT);
  const twoLineWidth = Math.ceil(fullHeaderWidth / 2);
  const iconWidth = hasKeyIcon ? KEY_HEADER_ICON_WIDTH_PX : 0;

  return Math.max(
    minHeaderWidth,
    Math.ceil(Math.max(longestWordWidth, twoLineWidth) + TEXT_COLUMN_WIDTH_PADDING_PX + iconWidth),
  );
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

const normalizeSelectionRange = (startRow: number, startCol: number, endRow: number, endCol: number): SelectionRange => ({
  startRow: Math.min(startRow, endRow),
  endRow: Math.max(startRow, endRow),
  startCol: Math.min(startCol, endCol),
  endCol: Math.max(startCol, endCol),
});

const appendSelectionRange = (ranges: SelectionRange[], nextRange: SelectionRange): SelectionRange[] => {
  const normalizedRange = normalizeSelectionRange(
    nextRange.startRow,
    nextRange.startCol,
    nextRange.endRow,
    nextRange.endCol,
  );
  const alreadyPresent = ranges.some(
    (range) =>
      range.startRow === normalizedRange.startRow &&
      range.endRow === normalizedRange.endRow &&
      range.startCol === normalizedRange.startCol &&
      range.endCol === normalizedRange.endCol,
  );

  return alreadyPresent ? ranges : [...ranges, normalizedRange];
};

const hasAdditiveSelectionModifier = (event?: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey"> | null): boolean =>
  !!event && (event.shiftKey || event.ctrlKey || event.metaKey);

const getAutoScrollDelta = (pointer: number, start: number, end: number): number => {
  const distanceToStart = pointer - start;
  if (distanceToStart < SELECTION_AUTO_SCROLL_EDGE_PX) {
    const intensity = (SELECTION_AUTO_SCROLL_EDGE_PX - distanceToStart) / SELECTION_AUTO_SCROLL_EDGE_PX;
    return -Math.ceil(SELECTION_AUTO_SCROLL_MAX_STEP_PX * Math.min(Math.max(intensity, 0), 1));
  }

  const distanceToEnd = end - pointer;
  if (distanceToEnd < SELECTION_AUTO_SCROLL_EDGE_PX) {
    const intensity = (SELECTION_AUTO_SCROLL_EDGE_PX - distanceToEnd) / SELECTION_AUTO_SCROLL_EDGE_PX;
    return Math.ceil(SELECTION_AUTO_SCROLL_MAX_STEP_PX * Math.min(Math.max(intensity, 0), 1));
  }

  return 0;
};

const AgGridWrapper = memo(
  ({
    rowData,
    columns,
    columnHeaders,
    columnWidthHints,
    canEditTable,
    onCellValueChangedCallback,
    onContextMenuCallback,
    keyColumnNamesUnderscore,
    currentSchema,
    isBigTable,
    rowCount,
    tableSelectionKey,
  }: {
    rowData: RowData[];
    columns: Array<{ type: "numeric" | "checkbox" | "text" }>;
    columnHeaders: string[];
    columnWidthHints: Array<ColumnWidthHint | undefined>;
    canEditTable: boolean;
    onCellValueChangedCallback: (event: CellValueChangedEvent<RowData>) => void;
    onContextMenuCallback: (row: number, col: number) => void;
    keyColumnNamesUnderscore: string[];
    currentSchema: DBVersion;
    isBigTable: boolean;
    rowCount: number;
    tableSelectionKey: string;
  }) => {
    const keyColumnSet = useMemo(() => new Set(keyColumnNamesUnderscore), [keyColumnNamesUnderscore]);
    const gridRef = useRef<AgGridReact<RowData>>(null);
    const gridRootRef = useRef<HTMLDivElement | null>(null);
    const [selectionRanges, setSelectionRanges] = useState<SelectionRange[]>([]);
    const selectionRangesRef = useRef<SelectionRange[]>([]);
    const dragSelectionRef = useRef<DragSelectionState | null>(null);
    const dragPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
    const autoScrollFrameRef = useRef<number | null>(null);

    const useFixedSizing = isBigTable || rowCount >= FIXED_SIZING_ROW_THRESHOLD;
    const rowHeight = useFixedSizing ? BIG_TABLE_ROW_HEIGHT : NORMAL_TABLE_ROW_HEIGHT;
    const rowIndexColumnWidth = useMemo(() => {
      const maxRowNumberWidth = measureTextWidth(String(Math.max(rowCount, 1)), ROW_INDEX_GRID_CELL_FONT);
      return Math.max(ROW_INDEX_COLUMN_MIN_WIDTH, Math.ceil(maxRowNumberWidth + ROW_INDEX_COLUMN_PADDING_PX));
    }, [rowCount]);

    const firstKeyColumnIndex = useMemo(() => {
      if (keyColumnSet.size === 0) return -1;
      return currentSchema.fields.findIndex((field) => keyColumnSet.has(field.name));
    }, [currentSchema.fields, keyColumnSet]);

    const getTextColumnWidth = useCallback(
      (columnIndex: number) => {
        const headerText = getDisplayColumnHeader(columnHeaders[columnIndex] ?? "");
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
        editable: canEditTable,
        sortable: true,
        filter: true,
        resizable: true,
        suppressHeaderMenuButton: true,
        suppressMovable: true,
        // autoHeaderHeight: true,
        // wrapHeaderText: true,
      }),
      [canEditTable],
    );

    const isCellSelected = useCallback((rowIndex: number, colIndex: number) => {
      return selectionRangesRef.current.some(
        (range) =>
          rowIndex >= range.startRow &&
          rowIndex <= range.endRow &&
          colIndex >= range.startCol &&
          colIndex <= range.endCol,
      );
    }, []);

    const isRowSelected = useCallback(
      (rowIndex: number) => {
        const lastColumnIndex = currentSchema.fields.length - 1;
        if (lastColumnIndex < 0) return false;

        return selectionRangesRef.current.some(
          (range) =>
            rowIndex >= range.startRow &&
            rowIndex <= range.endRow &&
            range.startCol === 0 &&
            range.endCol === lastColumnIndex,
        );
      },
      [currentSchema.fields.length],
    );

    const isColumnSelected = useCallback(
      (colIndex: number) => {
        if (rowCount <= 0) return false;

        return selectionRangesRef.current.some(
          (range) => range.startRow === 0 && range.endRow === rowCount - 1 && colIndex >= range.startCol && colIndex <= range.endCol,
        );
      },
      [rowCount],
    );

    const selectedColumnSignature = useMemo(() => {
      if (rowCount <= 0) return "";

      const selectedColumns = new Set<number>();
      for (const range of selectionRanges) {
        if (range.startRow !== 0 || range.endRow !== rowCount - 1) continue;
        for (let colIndex = range.startCol; colIndex <= range.endCol; colIndex++) {
          selectedColumns.add(colIndex);
        }
      }

      return Array.from(selectedColumns).sort((a, b) => a - b).join(",");
    }, [rowCount, selectionRanges]);

    const columnDefs = useMemo<Array<ColDef<RowData>>>(() => {
      const defs: Array<ColDef<RowData>> = [
        {
          headerName: "",
          colId: "__rowIndex",
          editable: false,
          width: rowIndexColumnWidth,
          minWidth: rowIndexColumnWidth,
          resizable: false,
          pinned: "left",
          sortable: false,
          filter: false,
          suppressMovable: true,
          valueGetter: (p) => (typeof p.node?.rowIndex === "number" ? p.node.rowIndex + 1 : ""),
          cellClass: (p) => {
            const rowIndex = p.node?.rowIndex;
            const classes = ["pack-table-row-index-cell", "text-right", "tabular-nums"];
            if (typeof rowIndex === "number" && isRowSelected(rowIndex)) {
              classes.push("pack-table-row-index-selected");
            }
            return classes;
          },
        },
      ];

      for (let colIndex = 0; colIndex < currentSchema.fields.length; colIndex++) {
        const field = currentSchema.fields[colIndex];
        const colType = columns[colIndex]?.type;
        const isFloatColumn = field?.field_type === "F32" || field?.field_type === "F64";
        const isKey = !!field && keyColumnSet.has(field.name);
        const fullHeaderName = columnHeaders[colIndex] ?? "";
        const displayHeaderName = getDisplayColumnHeader(fullHeaderName);
        const headerName = (isKey ? "🔑 " : "") + displayHeaderName;

        const width = Math.max(getColumnWidth(colIndex), getHeaderMinWidth(displayHeaderName, isKey));
        defs.push({
          headerName,
          headerTooltip: fullHeaderName,
          autoHeaderHeight: true,
          wrapHeaderText: true,
          headerClass: () => {
            const classes = ["pack-table-header"];
            if (colType === "numeric") classes.push("pack-table-header-right");
            if (isColumnSelected(colIndex)) classes.push("pack-table-header-selected");
            return classes;
          },
          colId: String(colIndex),
          editable: canEditTable,
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
          cellClass: (p) => {
            const rowIndex = p.node?.rowIndex;
            const classes: string[] = [];
            if (colType === "numeric") classes.push("text-right", "tabular-nums");
            if (colType === "checkbox") classes.push("text-center");
            if (typeof rowIndex === "number" && isCellSelected(rowIndex, colIndex)) {
              classes.push("pack-table-cell-selected");
            }
            return classes;
          },
        });
      }

      return defs;
    }, [
      columnHeaders,
      columns,
      currentSchema.fields,
      getColumnWidth,
      canEditTable,
      keyColumnSet,
      rowIndexColumnWidth,
      useFixedSizing,
      isCellSelected,
      isColumnSelected,
      isRowSelected,
    ]);

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

    useEffect(() => {
      selectionRangesRef.current = selectionRanges;
      const api = gridRef.current?.api;
      if (!api) return;
      api.refreshCells({ force: true });
    }, [selectionRanges]);

    useEffect(() => {
      gridRef.current?.api?.refreshHeader();
    }, [selectedColumnSignature]);

    useEffect(() => {
      dragSelectionRef.current = null;
      dragPointerRef.current = null;
      if (autoScrollFrameRef.current != null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
      setSelectionRanges([]);
    }, [tableSelectionKey]);

    useEffect(() => {
      const onWindowMouseUp = () => {
        dragSelectionRef.current = null;
        dragPointerRef.current = null;
        if (autoScrollFrameRef.current != null) {
          window.cancelAnimationFrame(autoScrollFrameRef.current);
          autoScrollFrameRef.current = null;
        }
      };

      window.addEventListener("mouseup", onWindowMouseUp);
      return () => {
        window.removeEventListener("mouseup", onWindowMouseUp);
      };
    }, []);

    const updateDragSelection = useCallback(
      (rowIndex: number, colIndex: number) => {
        const dragSelection = dragSelectionRef.current;
        if (!dragSelection) return;
        if (rowIndex < 0 || currentSchema.fields.length === 0) return;

        const nextRange =
          dragSelection.mode === "row"
            ? normalizeSelectionRange(dragSelection.anchorRow, 0, rowIndex, currentSchema.fields.length - 1)
            : normalizeSelectionRange(dragSelection.anchorRow, dragSelection.anchorCol, rowIndex, colIndex);

        setSelectionRanges(appendSelectionRange(dragSelection.baseRanges, nextRange));
      },
      [currentSchema.fields.length],
    );

    const updateDragSelectionFromPoint = useCallback(
      (clientX: number, clientY: number) => {
        const target = document.elementFromPoint(clientX, clientY);
        if (!(target instanceof Element)) return;

        const cellElement = target.closest(".ag-cell[col-id]");
        if (!(cellElement instanceof HTMLElement)) return;

        const rowElement = cellElement.closest(".ag-row[row-index]");
        if (!(rowElement instanceof HTMLElement)) return;

        const rowIndex = Number(rowElement.getAttribute("row-index"));
        if (!Number.isFinite(rowIndex) || rowIndex < 0) return;

        const rawColId = cellElement.getAttribute("col-id") ?? "";
        const colIndex = rawColId === "__rowIndex" ? 0 : Number(rawColId);
        if (!Number.isFinite(colIndex) || colIndex < 0) return;

        updateDragSelection(rowIndex, colIndex);
      },
      [updateDragSelection],
    );

    const stopAutoScroll = useCallback(() => {
      if (autoScrollFrameRef.current != null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    }, []);

    const runAutoScroll = useCallback(() => {
      autoScrollFrameRef.current = null;

      const dragSelection = dragSelectionRef.current;
      const pointer = dragPointerRef.current;
      const root = gridRootRef.current;
      if (!dragSelection || !pointer || !root) return;

      const bodyViewport = root.querySelector(".ag-body-viewport") as HTMLElement | null;
      const centerViewport = root.querySelector(".ag-center-cols-viewport") as HTMLElement | null;
      const horizontalViewport = root.querySelector(".ag-body-horizontal-scroll-viewport") as HTMLElement | null;
      if (!bodyViewport) return;

      const bodyRect = bodyViewport.getBoundingClientRect();
      const deltaY = getAutoScrollDelta(pointer.clientY, bodyRect.top, bodyRect.bottom);
      const deltaX = centerViewport ? getAutoScrollDelta(pointer.clientX, bodyRect.left, bodyRect.right) : 0;

      let didScroll = false;

      if (deltaY !== 0) {
        const nextScrollTop = Math.max(0, bodyViewport.scrollTop + deltaY);
        if (nextScrollTop !== bodyViewport.scrollTop) {
          bodyViewport.scrollTop = nextScrollTop;
          didScroll = true;
        }
      }

      if (deltaX !== 0 && centerViewport) {
        const maxScrollLeft = Math.max(0, centerViewport.scrollWidth - centerViewport.clientWidth);
        const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, centerViewport.scrollLeft + deltaX));
        if (nextScrollLeft !== centerViewport.scrollLeft) {
          centerViewport.scrollLeft = nextScrollLeft;
          if (horizontalViewport) {
            horizontalViewport.scrollLeft = nextScrollLeft;
          }
          didScroll = true;
        }
      }

      if (didScroll) {
        updateDragSelectionFromPoint(pointer.clientX, pointer.clientY);
      }

      autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
    }, [updateDragSelectionFromPoint]);

    const startAutoScroll = useCallback(() => {
      if (autoScrollFrameRef.current != null) return;
      autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
    }, [runAutoScroll]);

    useEffect(() => {
      const onWindowMouseMove = (event: MouseEvent) => {
        if (!dragSelectionRef.current) return;

        if ((event.buttons & 1) !== 1) {
          dragSelectionRef.current = null;
          dragPointerRef.current = null;
          stopAutoScroll();
          return;
        }

        dragPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      };

      window.addEventListener("mousemove", onWindowMouseMove);
      return () => {
        window.removeEventListener("mousemove", onWindowMouseMove);
      };
    }, [stopAutoScroll]);

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

    const onCellMouseDown = useCallback(
      (event: CellMouseDownEvent<RowData>) => {
        const mouseEvent = event.event as MouseEvent | null;
        if (!mouseEvent || mouseEvent.button !== 0) return;

        const rowIndex = event.node?.rowIndex;
        if (typeof rowIndex !== "number" || rowIndex < 0 || currentSchema.fields.length === 0) return;

        const colId = event.column?.getColId() ?? "";
        const isRowHeader = colId === "__rowIndex";
        const colIndex = isRowHeader ? 0 : Number(colId);
        if (!isRowHeader && (!Number.isFinite(colIndex) || colIndex < 0)) return;

        const baseRanges = hasAdditiveSelectionModifier(mouseEvent) ? selectionRangesRef.current : [];
        const nextRange = isRowHeader
          ? normalizeSelectionRange(rowIndex, 0, rowIndex, currentSchema.fields.length - 1)
          : normalizeSelectionRange(rowIndex, colIndex, rowIndex, colIndex);

        dragSelectionRef.current = {
          mode: isRowHeader ? "row" : "cells",
          anchorRow: rowIndex,
          anchorCol: isRowHeader ? 0 : colIndex,
          baseRanges,
        };
        dragPointerRef.current = { clientX: mouseEvent.clientX, clientY: mouseEvent.clientY };
        setSelectionRanges(appendSelectionRange(baseRanges, nextRange));
        startAutoScroll();

        if (isRowHeader) {
          mouseEvent.preventDefault();
        }
      },
      [currentSchema.fields],
    );

    const onCellMouseOver = useCallback(
      (event: CellMouseOverEvent<RowData>) => {
        const dragSelection = dragSelectionRef.current;
        if (!dragSelection) return;

        const mouseEvent = event.event as MouseEvent | null;
        if (!mouseEvent || (mouseEvent.buttons & 1) !== 1) {
          dragSelectionRef.current = null;
          dragPointerRef.current = null;
          stopAutoScroll();
          return;
        }

        dragPointerRef.current = { clientX: mouseEvent.clientX, clientY: mouseEvent.clientY };
        const rowIndex = event.node?.rowIndex;
        if (typeof rowIndex !== "number" || rowIndex < 0) return;

        const colId = event.column?.getColId() ?? "";
        const hoveredColIndex = colId === "__rowIndex" ? dragSelection.anchorCol : Number(colId);
        if (!Number.isFinite(hoveredColIndex) || hoveredColIndex < 0) return;

        updateDragSelection(rowIndex, hoveredColIndex);
      },
      [stopAutoScroll, updateDragSelection],
    );

    const onColumnHeaderClicked = useCallback(
      (event: ColumnHeaderClickedEvent<RowData>) => {
        const clickedColumn = event.column;
        if (!clickedColumn || !("getColId" in clickedColumn)) return;

        const colId = clickedColumn.getColId();
        const colIndex = Number(colId);
        if (!Number.isFinite(colIndex) || colIndex < 0 || rowCount <= 0) return;

        const sourceEvent = (event as ColumnHeaderClickedEvent<RowData> & { sourceEvent?: MouseEvent }).sourceEvent;
        if (!hasAdditiveSelectionModifier(sourceEvent)) return;

        setSelectionRanges((currentRanges) =>
          appendSelectionRange(currentRanges, normalizeSelectionRange(0, colIndex, rowCount - 1, colIndex)),
        );
      },
      [rowCount],
    );

    const onKeyDownCapture = useCallback(async (ev: React.KeyboardEvent) => {
      const isCopy = (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "c";
      if (!isCopy) return;

      const api = gridRef.current?.api;
      if (!api) return;

      if (selectionRangesRef.current.length > 0) {
        const rangeBlocks = selectionRangesRef.current
          .map((range) => {
            const lines: string[] = [];
            for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
              const rowNode = api.getDisplayedRowAtIndex(rowIndex);
              const row = rowNode?.data;
              if (!row) continue;

              const cells: string[] = [];
              for (let colIndex = range.startCol; colIndex <= range.endCol; colIndex++) {
                if (colIndex < 0 || colIndex >= currentSchema.fields.length) {
                  cells.push("");
                  continue;
                }
                const value = row[colIndex];
                cells.push(value == null ? "" : String(value));
              }
              lines.push(cells.join("\t"));
            }

            return lines.join("\n");
          })
          .filter((block) => block !== "");

        if (rangeBlocks.length > 0) {
          await copyTextToClipboard(rangeBlocks.join("\n\n"));
          ev.preventDefault();
          return;
        }
      }

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
    }, [currentSchema.fields.length]);

    return (
      <div
        ref={gridRootRef}
        className="ag-theme-material-dark pack-tables-grid"
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
          onCellMouseDown={onCellMouseDown}
          onCellMouseOver={onCellMouseOver}
          onColumnHeaderClicked={onColumnHeaderClicked}
          onCellContextMenu={onCellContextMenu}
          onCellValueChanged={onCellValueChangedCallback}
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
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const startArgs = useAppSelector((state) => state.app.startArgs);

  const [keyFilter, setKeyFilter] = useState<string>("");
  const [tableFilterInput, setTableFilterInput] = useState<string>("");
  const [tableFilter, setTableFilter] = useState<string>("");
  const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);
  const selectCurrentPackUnsavedFiles = useMemo(makeSelectCurrentPackUnsavedFiles, []);

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
  const unsavedFiles = useAppSelector((state) => selectCurrentPackUnsavedFiles(state, packPath));

  const packedFilePath = useMemo(() => {
    if (!currentDBTableSelection) return "";
    return getDBPackedFilePath(currentDBTableSelection);
  }, [currentDBTableSelection]);

  const selectedPackFile = useMemo(() => {
    if (!packedFilePath) return undefined;

    const unsavedDirectMatch = unsavedFiles.find((file) => file.name === packedFilePath);
    if (unsavedDirectMatch) return unsavedDirectMatch;

    const unsavedPrefixMatch = unsavedFiles.find((file) => file.name.startsWith(packedFilePath));
    if (unsavedPrefixMatch) return unsavedPrefixMatch;

    if (!packData || !packData.packedFiles) return undefined;

    const directMatch = packData.packedFiles[packedFilePath];
    if (directMatch) return directMatch;

    for (const [iterPackedFilePath, iterPackedFile] of Object.entries(packData.packedFiles)) {
      if (iterPackedFilePath.startsWith(packedFilePath)) {
        return iterPackedFile;
      }
    }

    return undefined;
  }, [packData, packedFilePath, unsavedFiles]);

  const [workingPackFile, setWorkingPackFile] = useState<PackedFile | undefined>(undefined);
  const keyColumnNamesUnderscore = useMemo(() => {
    if (!currentDBTableSelection) return [];
    return dataFromBackend.referencedColums[currentDBTableSelection.dbName] || [];
  }, [currentDBTableSelection]);

  const currentSchema = selectedPackFile?.tableSchema;
  const packName = getPackNameFromPath(packPath) ?? packPath;
  const canEditTable = isFeaturesForModdersEnabled && !vanillaPackNames.includes(packName);

  const tableCacheKey = useMemo(() => {
    if (!selectedPackFile || !currentSchema || !packedFilePath || !packPath) return "";
    return buildTableCacheKey(packPath, packedFilePath, selectedPackFile, currentSchema);
  }, [packPath, packedFilePath, selectedPackFile, currentSchema]);

  const preparedTableData = useMemo(() => {
    if (!selectedPackFile || !currentSchema || !tableCacheKey) return undefined;

    const cached = getPreparedTable(tableCacheKey);
    if (cached) return cached;

    const prepared = prepareTableData(selectedPackFile, currentSchema, keyColumnNamesUnderscore);
    setPreparedTable(tableCacheKey, prepared);
    return prepared;
  }, [tableCacheKey, selectedPackFile, currentSchema, keyColumnNamesUnderscore]);

  const [workingPreparedTableData, setWorkingPreparedTableData] = useState<PreparedTableData | undefined>(undefined);

  useEffect(() => {
    setWorkingPackFile(selectedPackFile);
    setWorkingPreparedTableData(preparedTableData);
  }, [selectedPackFile, preparedTableData]);

  const activePackFile = workingPackFile ?? selectedPackFile;
  const activePreparedTableData = workingPreparedTableData ?? preparedTableData;

  useEffect(() => {
    if (!activePreparedTableData || activePreparedTableData.columnFilterOptions.length === 0) return;
    if (keyFilter !== "" && activePreparedTableData.columnFilterOptions.includes(keyFilter)) return;
    setKeyFilter(activePreparedTableData.columnFilterOptions[0]);
  }, [activePreparedTableData, keyFilter]);

  const onFilterInputChange = (value: string) => {
    setTableFilterInput(value);
    setTableFilterDebounced(value);
  };

  const keyFilterOrDefault = keyFilter !== "" ? keyFilter : (activePreparedTableData?.columnFilterOptions[0] ?? "");
  const indexOfFilteredColumn = activePreparedTableData?.columnHeaders.indexOf(keyFilterOrDefault) ?? -1;
  const normalizedTableFilter = tableFilter.trim();
  const rowCount = activePreparedTableData?.data.length ?? 0;
  const colCount = activePreparedTableData?.columnHeaders.length ?? 0;
  const isBigTable = rowCount >= BIG_TABLE_ROW_THRESHOLD || rowCount * colCount >= BIG_TABLE_CELL_THRESHOLD;

  const filteredRowIndices = useMemo(() => {
    if (!activePreparedTableData) return [];
    if (indexOfFilteredColumn === -1 || normalizedTableFilter === "") {
      return activePreparedTableData.data.map((_row, rowIndex) => rowIndex);
    }

    const lowerCaseColumn = activePreparedTableData.lowerCaseColumnValues[indexOfFilteredColumn] || [];
    const filteredIndices: number[] = [];
    for (let rowIndex = 0; rowIndex < lowerCaseColumn.length; rowIndex++) {
      const value = lowerCaseColumn[rowIndex];
      if (value && value.includes(normalizedTableFilter)) {
        filteredIndices.push(rowIndex);
      }
    }

    return filteredIndices;
  }, [activePreparedTableData, indexOfFilteredColumn, normalizedTableFilter]);

  const filteredData = useMemo(() => {
    if (!activePreparedTableData) return [];
    return filteredRowIndices.map((rowIndex) => activePreparedTableData.data[rowIndex]);
  }, [activePreparedTableData, filteredRowIndices]);

  const handleContextMenuCallback = useCallback(
    (row: number, col: number) => {
      const unfilteredRowIndex = filteredRowIndices[row] ?? row;
      dispatch(setDeepCloneTarget({ row: unfilteredRowIndex, col }));
    },
    [dispatch, filteredRowIndices],
  );

  const handleCellValueChangedCallback = useCallback(
    async (event: CellValueChangedEvent<RowData>) => {
      if (!canEditTable || !activePackFile?.schemaFields || !currentSchema || !packData || !activePreparedTableData) {
        return;
      }
      if (event.newValue === event.oldValue) return;

      const displayedRowIndex = event.node?.rowIndex;
      if (typeof displayedRowIndex !== "number" || displayedRowIndex < 0) return;

      const colId = event.column?.getColId() ?? "";
      if (colId === "__rowIndex") return;

      const colIndex = Number(colId);
      if (!Number.isFinite(colIndex) || colIndex < 0) return;

      const unfilteredRowIndex = filteredRowIndices[displayedRowIndex];
      if (unfilteredRowIndex == null) return;

      const fieldDefinition = currentSchema.fields[colIndex];
      if (!fieldDefinition) return;

      const parsedCellValue = parseEditedCellValue(fieldDefinition.field_type, event.newValue);
      if (!parsedCellValue) {
        event.node?.setDataValue(colId, event.oldValue);
        return;
      }

      const previousPackFile = activePackFile;
      const previousPreparedTableData = activePreparedTableData;
      const nextSchemaFields = [...(activePackFile.schemaFields as AmendedSchemaField[])];
      const flatFieldIndex = unfilteredRowIndex * currentSchema.fields.length + colIndex;
      const previousCell = nextSchemaFields[flatFieldIndex] as AmendedSchemaField | undefined;
      if (!previousCell) {
        event.node?.setDataValue(colId, event.oldValue);
        return;
      }

      nextSchemaFields[flatFieldIndex] = {
        ...previousCell,
        fields: parsedCellValue.fields,
        resolvedKeyValue: parsedCellValue.resolvedKeyValue,
      };

      const nextPackFile = {
        ...activePackFile,
        schemaFields: nextSchemaFields,
      } as PackedFile;
      const nextPreparedTableData = prepareTableData(nextPackFile, currentSchema, keyColumnNamesUnderscore);

      clearPreparedTableForPackedFile(packPath, nextPackFile.name);
      setWorkingPackFile(nextPackFile);
      setWorkingPreparedTableData(nextPreparedTableData);
      dispatch(
        setPacksData([
          {
            packName: packData.packName,
            packPath,
            tables: packData.tables,
            packedFiles: {
              [nextPackFile.name]: nextPackFile,
            },
          },
        ]),
      );

      try {
        const result = await window.api?.saveDBTableEdits(packPath, nextPackFile);
        if (!result?.success) {
          throw new Error(result?.error || "Failed to store DB table edits");
        }
      } catch (error) {
        clearPreparedTableForPackedFile(packPath, previousPackFile.name);
        setWorkingPackFile(previousPackFile);
        setWorkingPreparedTableData(previousPreparedTableData);
        dispatch(
          setPacksData([
            {
              packName: packData.packName,
              packPath,
              tables: packData.tables,
              packedFiles: {
                [previousPackFile.name]: previousPackFile,
              },
            },
          ]),
        );
        event.node?.setDataValue(colId, event.oldValue);
        alert(`Failed to save DB table edits: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    },
    [
      activePackFile,
      activePreparedTableData,
      canEditTable,
      currentSchema,
      dispatch,
      filteredRowIndices,
      keyColumnNamesUnderscore,
      packData,
      packPath,
    ],
  );

  if (!currentDBTableSelection || !packData || !activePackFile || !currentSchema || !activePreparedTableData) {
    return <></>;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div id="packTablesTableParent" className="flex-1 min-h-0 w-full overflow-hidden bg-gray-900">
        <AgGridWrapper
          rowData={filteredData}
          columns={activePreparedTableData.columns}
          columnHeaders={activePreparedTableData.columnHeaders}
          columnWidthHints={activePreparedTableData.columnWidthHints}
          canEditTable={canEditTable}
          onCellValueChangedCallback={handleCellValueChangedCallback}
          onContextMenuCallback={handleContextMenuCallback}
          keyColumnNamesUnderscore={keyColumnNamesUnderscore}
          currentSchema={currentSchema}
          isBigTable={isBigTable}
          rowCount={rowCount}
          tableSelectionKey={`${currentDBTableSelection.packPath}|${currentDBTableSelection.dbName}|${currentDBTableSelection.dbSubname}`}
        />
      </div>
      <div className="mt-3 flex gap-6 shrink-0">
        <select
          value={keyFilterOrDefault}
          onChange={(e) => setKeyFilter(e.target.value)}
          className="px-2 py-1 text-sm border border-gray-300 rounded dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {activePreparedTableData.columnFilterOptions.map((option) => (
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
