import { AmendedSchemaField } from "@/src/packFileTypes";

export type TableCellValue = string | number | boolean;
export type PreparedRowData = Record<string, TableCellValue | string> & { __rowId: string };

export interface ColumnWidthHint {
  maxLength: number;
  nonEmptyCount: number;
  widestValue: string;
}

export interface PreparedTableData {
  chunkedTable: AmendedSchemaField[][];
  data: PreparedRowData[];
  columnHeaders: string[];
  columns: Array<{ type: "numeric" | "checkbox" | "text" }>;
  columnWidthHints: Array<ColumnWidthHint | undefined>;
  columnFilterOptions: string[];
  keyColumnNames: string[];
  lowerCaseColumnValues: string[][];
}

const DEFAULT_PREPARED_TABLE_CACHE_BYTES = 64 * 1024 * 1024;

interface PreparedTableCacheEntry {
  value: PreparedTableData;
  bytes: number;
}

export interface PreparedTableCache {
  get(cacheKey: string): PreparedTableData | undefined;
  set(cacheKey: string, value: PreparedTableData): void;
  delete(cacheKey: string): void;
  keys(): string[];
  stats(): { entries: number; bytes: number };
}

/**
 * Approximate retained heap without rescanning every cell after table preparation. Prepared data
 * keeps row objects, row/column arrays and a lower-case value for every cell in addition to references
 * into the source PackedFile; 96 bytes per cell is a conservative average for those derived objects.
 */
export const estimatePreparedTableBytes = (value: PreparedTableData): number => {
  let bytes = 1024;
  bytes += value.data.length * 48;
  bytes += value.chunkedTable.length * 24;
  bytes += value.lowerCaseColumnValues.reduce((cellCount, column) => cellCount + column.length, 0) * 96;
  for (const header of value.columnHeaders) bytes += 16 + header.length * 2;
  for (const option of value.columnFilterOptions) bytes += 16 + option.length * 2;
  for (const key of value.keyColumnNames) bytes += 16 + key.length * 2;
  for (const hint of value.columnWidthHints) {
    if (hint) bytes += 32 + hint.widestValue.length * 2;
  }

  return bytes;
};

export const createPreparedTableCache = (maxBytes: number): PreparedTableCache => {
  const entries = new Map<string, PreparedTableCacheEntry>();
  let totalBytes = 0;

  return {
    get(cacheKey) {
      const entry = entries.get(cacheKey);
      if (!entry) return undefined;
      entries.delete(cacheKey);
      entries.set(cacheKey, entry);
      return entry.value;
    },
    set(cacheKey, value) {
      const previous = entries.get(cacheKey);
      if (previous) totalBytes -= previous.bytes;
      entries.delete(cacheKey);

      const bytes = estimatePreparedTableBytes(value);
      entries.set(cacheKey, { value, bytes });
      totalBytes += bytes;

      // Retain one oversize table so switching away and straight back is still warm. Adding anything
      // else evicts it because it immediately becomes the least-recently-used entry.
      while (totalBytes > maxBytes && entries.size > 1) {
        const oldestKey = entries.keys().next().value as string | undefined;
        if (oldestKey == undefined) break;
        const oldest = entries.get(oldestKey);
        entries.delete(oldestKey);
        totalBytes -= oldest?.bytes ?? 0;
      }
    },
    delete(cacheKey) {
      const entry = entries.get(cacheKey);
      if (!entry) return;
      entries.delete(cacheKey);
      totalBytes -= entry.bytes;
    },
    keys: () => Array.from(entries.keys()),
    stats: () => ({ entries: entries.size, bytes: totalBytes }),
  };
};

const preparedTableCache = createPreparedTableCache(DEFAULT_PREPARED_TABLE_CACHE_BYTES);

export const getPreparedTable = (cacheKey: string): PreparedTableData | undefined => preparedTableCache.get(cacheKey);

export const setPreparedTable = (cacheKey: string, value: PreparedTableData): void => {
  preparedTableCache.set(cacheKey, value);
};

export const clearPreparedTableForPack = (packPath: string): void => {
  const keys = preparedTableCache.keys();
  for (const key of keys) {
    if (key.startsWith(`${packPath}|`)) {
      preparedTableCache.delete(key);
    }
  }
};

export const clearPreparedTableForPackedFile = (packPath: string, packedFilePath: string): void => {
  const keys = preparedTableCache.keys();
  const cachePrefix = `${packPath}|${packedFilePath}|`;
  for (const key of keys) {
    if (key.startsWith(cachePrefix)) {
      preparedTableCache.delete(key);
    }
  }
};
