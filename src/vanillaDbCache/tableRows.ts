import * as nodePath from "path";

import type { SCHEMA_FIELD_TYPE } from "../packFileTypes";
import type { VanillaDbCacheTypedRead } from "./store";

export type VanillaDbTypedValue = string | number | boolean | null;

export interface VanillaDbTypedColumn {
  name: string;
  fieldType: SCHEMA_FIELD_TYPE;
}

export interface FormattedVanillaDbRows {
  rowsByPackedFilePath: Map<string, Array<Record<string, string>>>;
  tablePathsByPrefix: Map<string, string[]>;
}

export interface VanillaDbSourceTableRow {
  row: Record<string, string>;
  packPath: string;
}

const packPathKey = (packPath: string) => nodePath.resolve(packPath).toLowerCase();

/**
 * Combines cached db.pack rows with rows from other selected vanilla packs, retaining each row's
 * physical source pack and the current vanilla pack/table/row order.
 */
export const collectVanillaDbTableRowsInPackOrder = (
  tableName: string,
  orderedPackPaths: readonly string[],
  typedVanillaPackPath: string | undefined,
  typedVanillaRows: FormattedVanillaDbRows | undefined,
  legacyRowsByPackPath: ReadonlyMap<string, readonly Record<string, string>[]>,
): VanillaDbSourceTableRow[] => {
  const prefix = `db\\${tableName}\\`;
  const typedVanillaPackKey = typedVanillaPackPath ? packPathKey(typedVanillaPackPath) : undefined;
  const rows: VanillaDbSourceTableRow[] = [];
  for (const packPath of orderedPackPaths) {
    if (typedVanillaRows && typedVanillaPackKey && packPathKey(packPath) === typedVanillaPackKey) {
      for (const tablePath of typedVanillaRows.tablePathsByPrefix.get(prefix) ?? []) {
        for (const row of typedVanillaRows.rowsByPackedFilePath.get(tablePath) ?? []) {
          rows.push({ row, packPath });
        }
      }
      continue;
    }
    for (const row of legacyRowsByPackPath.get(packPath) ?? []) rows.push({ row, packPath });
  }
  return rows;
};

/** The string representation the GUI gets from resolving one typed cache cell. */
export const formatVanillaDbTypedValue = (fieldType: SCHEMA_FIELD_TYPE, value: VanillaDbTypedValue): string => {
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
    // The legacy cell resolver returns the presence byte for a present empty optional string.
    return value === "" ? "0" : String(value);
  }
  return String(value);
};

/**
 * Formats a complete table before a caller uses it. Missing columns throw so callers can discard
 * the whole typed candidate and take their existing pack-reading fallback.
 */
export const formatVanillaDbTypedTableRows = (
  columns: readonly VanillaDbTypedColumn[],
  rows: readonly Record<string, VanillaDbTypedValue>[],
  consumer = "vanilla DB",
): Array<Record<string, string>> =>
  rows.map((row) => {
    const record: Record<string, string> = {};
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(row, column.name)) {
        throw new Error(`Typed ${consumer} row is missing column ${column.name}`);
      }
      record[column.name] = formatVanillaDbTypedValue(column.fieldType, row[column.name]);
    }
    return record;
  });

/**
 * Uses a typed read only when every row can be formatted. A miss or formatting error runs the
 * caller's complete fallback, so no partial typed rows can escape.
 */
export const formatVanillaDbTypedRowsOrFallback = <T>(
  typedRows: VanillaDbCacheTypedRead | undefined,
  format: (typedRows: VanillaDbCacheTypedRead) => T,
  fallback: () => T,
  onFormatError?: (error: unknown) => void,
): T => {
  if (!typedRows) return fallback();
  try {
    return format(typedRows);
  } catch (error) {
    onFormatError?.(error);
    return fallback();
  }
};
