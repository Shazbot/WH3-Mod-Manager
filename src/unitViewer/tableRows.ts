import type { SCHEMA_FIELD_TYPE } from "../packFileTypes";
import {
  formatVanillaDbTypedTableRows,
  formatVanillaDbTypedValue,
  type VanillaDbTypedColumn,
  type VanillaDbTypedValue,
} from "../vanillaDbCache/tableRows";

export type UnitViewerTypedValue = VanillaDbTypedValue;
export type UnitViewerTypedColumn = VanillaDbTypedColumn;

export const formatUnitViewerTypedValue = (fieldType: SCHEMA_FIELD_TYPE, value: UnitViewerTypedValue): string =>
  formatVanillaDbTypedValue(fieldType, value);

export const formatUnitViewerTypedTableRows = (
  columns: readonly UnitViewerTypedColumn[],
  rows: readonly Record<string, UnitViewerTypedValue>[],
): Array<Record<string, string>> => formatVanillaDbTypedTableRows(columns, rows, "Unit Viewer");

/** Vanilla rows precede the existing load-ordered mod rows in every Unit Viewer table. */
export const prependUnitViewerTableRows = (
  vanillaRows: readonly Record<string, string>[],
  modRows: readonly Record<string, string>[],
): Array<Record<string, string>> => [...vanillaRows, ...modRows];
