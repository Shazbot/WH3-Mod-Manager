import type { SCHEMA_FIELD_TYPE } from "../packFileTypes";

export type UnitViewerTypedValue = string | number | boolean | null;

export interface UnitViewerTypedColumn {
  name: string;
  fieldType: SCHEMA_FIELD_TYPE;
}

/** The GUI's existing DB-row string representation, applied directly to typed cache values. */
export const formatUnitViewerTypedValue = (fieldType: SCHEMA_FIELD_TYPE, value: UnitViewerTypedValue): string => {
  if (fieldType === "I16" || fieldType === "I32" || fieldType === "I64") {
    return Number(value).toFixed(0);
  }
  if (fieldType === "F32" || fieldType === "F64") {
    return Number(value).toFixed(3);
  }
  if (fieldType === "Boolean") {
    return value === true || Number(value) === 1 ? "1" : "0";
  }
  if (fieldType === "OptionalStringU8") {
    if (value === null) return "";
    // In the legacy GUI parser a present empty OptionalStringU8 resolves to its presence byte.
    return value === "" ? "0" : String(value);
  }
  return String(value);
};

/**
 * Builds the records the Unit Viewer already consumes, preserving schema column order and row order.
 * The cache store validates every column name and type before this formatter is called.
 */
export const formatUnitViewerTypedTableRows = (
  columns: readonly UnitViewerTypedColumn[],
  rows: readonly Record<string, UnitViewerTypedValue>[],
): Array<Record<string, string>> =>
  rows.map((row) => {
    const record: Record<string, string> = {};
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(row, column.name)) {
        throw new Error(`Typed Unit Viewer row is missing column ${column.name}`);
      }
      record[column.name] = formatUnitViewerTypedValue(column.fieldType, row[column.name]);
    }
    return record;
  });

/** Vanilla rows precede the existing load-ordered mod rows in every Unit Viewer table. */
export const prependUnitViewerTableRows = (
  vanillaRows: readonly Record<string, string>[],
  modRows: readonly Record<string, string>[],
): Array<Record<string, string>> => [...vanillaRows, ...modRows];
