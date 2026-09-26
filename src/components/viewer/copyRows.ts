import type { AmendedSchemaField } from "../../packFileTypes";

export type RowSelectionRange = { startRow: number; endRow: number; startCol: number; endCol: number };

/** Returns every row represented by the selected cell/row ranges, once and in display order. */
export const getSelectedRowIndices = (ranges: RowSelectionRange[], clickedRow: number): number[] => {
  const selectedRows = new Set<number>();
  for (const range of ranges) {
    for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
      selectedRows.add(rowIndex);
    }
  }

  // A context click outside the current selection should act on the row under the pointer, while
  // a click inside a multi-cell selection copies every row represented by that selection.
  if (!selectedRows.has(clickedRow)) return [clickedRow];
  return [...selectedRows].sort((first, second) => first - second);
};

/** Returns only rows represented by a full-width row selection, once and in display order. */
export const getFullySelectedRowIndices = (
  ranges: RowSelectionRange[],
  rowCount: number,
  columnCount: number,
): number[] => {
  if (rowCount <= 0 || columnCount <= 0) return [];

  const selectedRows = new Set<number>();
  for (const range of ranges) {
    if (range.startCol !== 0 || range.endCol !== columnCount - 1) continue;

    const firstRow = Math.max(0, Math.min(range.startRow, range.endRow));
    const lastRow = Math.min(rowCount - 1, Math.max(range.startRow, range.endRow));
    for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex++) {
      selectedRows.add(rowIndex);
    }
  }

  return [...selectedRows].sort((first, second) => first - second);
};

/** Converts selected row indices into complete schema rows, rather than copying only selected cells. */
export const getRowsForCopy = (
  schemaFields: AmendedSchemaField[],
  rowIndices: number[],
  columnCount: number,
): AmendedSchemaField[][] => {
  if (columnCount <= 0) return [];

  return [...new Set(rowIndices)]
    .sort((first, second) => first - second)
    .map((rowIndex) => schemaFields.slice(rowIndex * columnCount, (rowIndex + 1) * columnCount))
    .filter((row) => row.length > 0);
};
