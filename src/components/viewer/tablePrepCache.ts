import { AmendedSchemaField } from "@/src/packFileTypes";

export type TableCellValue = string | number | boolean;

export interface ColumnWidthHint {
  p90Length: number;
  maxLength: number;
  nonEmptyCount: number;
}

export interface PreparedTableData {
  chunkedTable: AmendedSchemaField[][];
  data: TableCellValue[][];
  columnHeaders: string[];
  columns: Array<{ type: "numeric" | "checkbox" | "text" }>;
  columnWidthHints: Array<ColumnWidthHint | undefined>;
  columnFilterOptions: string[];
  keyColumnNames: string[];
  lowerCaseColumnValues: string[][];
}

const MAX_CACHE_ENTRIES = 8;
const preparedTableCache = new Map<string, PreparedTableData>();

const bumpEntry = (cacheKey: string, value: PreparedTableData) => {
  preparedTableCache.delete(cacheKey);
  preparedTableCache.set(cacheKey, value);
};

export const getPreparedTable = (cacheKey: string): PreparedTableData | undefined => {
  const value = preparedTableCache.get(cacheKey);
  if (!value) return undefined;

  bumpEntry(cacheKey, value);
  return value;
};

export const setPreparedTable = (cacheKey: string, value: PreparedTableData): void => {
  bumpEntry(cacheKey, value);

  while (preparedTableCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = preparedTableCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    preparedTableCache.delete(oldestKey);
  }
};

export const clearPreparedTableForPack = (packPath: string): void => {
  const keys = Array.from(preparedTableCache.keys());
  for (const key of keys) {
    if (key.startsWith(`${packPath}|`)) {
      preparedTableCache.delete(key);
    }
  }
};

export const clearPreparedTableForPackedFile = (packPath: string, packedFilePath: string): void => {
  const keys = Array.from(preparedTableCache.keys());
  const cachePrefix = `${packPath}|${packedFilePath}|`;
  for (const key of keys) {
    if (key.startsWith(cachePrefix)) {
      preparedTableCache.delete(key);
    }
  }
};
