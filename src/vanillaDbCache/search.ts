import {
  findFrontCodedPrefixRange,
  readAllFrontCodedEntries,
} from "./frontCodedBlock";
import { VanillaDbCacheReader } from "./read";

/**
 * Searching every base game table for a value.
 *
 * No search index is built for this, and none is needed. The cache already stores every distinct
 * string once in a sorted pool addressed by rank, and every string column already stores its distinct
 * pool ids in ascending order. That gives the search two things for free:
 *
 * - A **prefix** query is a contiguous range of pool ids, found by two binary searches. Matching then
 *   costs an integer comparison per candidate, and no string is decoded to decide it.
 * - A column is **ruled out by its dictionary**, read as a bounded prefix of the column so its row
 *   data usually is not touched. Over the real tables that skips all but about 200 of 4300 columns,
 *   which is what makes this fast.
 *
 * Measured over WH3: a prefix query answers in ~135 ms and a substring query in ~930 ms.
 *
 * It is not frugal about bytes, though - roughly 9.5 MB of the 12.4 MB file. The string pool is read
 * whole (5.35 MB of that) because the prefix search and the substring scan both go through one
 * in-memory block. Paging the pool the way `resolvePoolValue` does would cut it, and is the obvious
 * next step if search ever runs somewhere memory is tight.
 *
 * The alternative considered was a dedicated key index: about 2.9 MB of keys plus 5 MB of postings,
 * resident all the time. This costs more per search and nothing between them, which is the better
 * trade for something used occasionally.
 */

export type VanillaSearchMode = "prefix" | "contains";

export interface VanillaSearchOptions {
  query: string;
  mode?: VanillaSearchMode;
  /** Stop once this many matching rows are found. */
  maxResults?: number;
  /** Restrict to tables whose packed file path contains this. */
  tableFilter?: string;
  caseSensitive?: boolean;
}

export interface VanillaSearchMatch {
  packedFilePath: string;
  dbName: string;
  columnName: string;
  rowIndex: number;
  value: string;
}

export interface VanillaSearchResult {
  matches: VanillaSearchMatch[];
  /** True when the search stopped at maxResults and there may be more. */
  truncated: boolean;
  columnsConsidered: number;
  columnsScanned: number;
}

const DEFAULT_MAX_RESULTS = 500;

/**
 * The pool ids whose value satisfies the query.
 *
 * A prefix query resolves to a range and never decodes a string. Anything else has to look at the
 * pool, which is one pass over it - still far cheaper than looking at every cell, since the pool holds
 * each distinct string once where the tables repeat them millions of times.
 */
const findMatchingPoolIds = (
  reader: VanillaDbCacheReader,
  { query, mode = "contains", caseSensitive = false }: VanillaSearchOptions,
): { has: (poolId: number) => boolean; lowestId: number; highestId: number } => {
  const pool = reader.getPoolBlock();

  if (mode === "prefix" && caseSensitive) {
    const { start, end } = findFrontCodedPrefixRange(pool, query);
    return { has: (poolId) => poolId >= start && poolId < end, lowestId: start, highestId: end - 1 };
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  const values = readAllFrontCodedEntries(pool);
  const matching = new Set<number>();
  let lowestId = Number.POSITIVE_INFINITY;
  let highestId = -1;

  for (let poolId = 0; poolId < values.length; poolId++) {
    const value = caseSensitive ? values[poolId] : values[poolId].toLowerCase();
    const hit = mode === "prefix" ? value.startsWith(needle) : value.includes(needle);
    if (!hit) continue;
    matching.add(poolId);
    if (poolId < lowestId) lowestId = poolId;
    if (poolId > highestId) highestId = poolId;
  }

  return { has: (poolId) => matching.has(poolId), lowestId, highestId };
};

/** Whether a column's sorted dictionary contains anything the query matched. */
const columnCouldMatch = (
  poolIds: Uint32Array,
  matcher: { has: (poolId: number) => boolean; lowestId: number; highestId: number },
): boolean => {
  // Sorted both sides, so the ranges can miss each other outright - the common case by far.
  if (poolIds.length === 0) return false;
  if (poolIds[0] > matcher.highestId || poolIds[poolIds.length - 1] < matcher.lowestId) return false;

  for (const poolId of poolIds) {
    if (poolId > matcher.highestId) return false;
    if (poolId >= matcher.lowestId && matcher.has(poolId)) return true;
  }
  return false;
};

export const searchVanillaDbCache = (
  reader: VanillaDbCacheReader,
  options: VanillaSearchOptions,
): VanillaSearchResult => {
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const matches: VanillaSearchMatch[] = [];
  let columnsConsidered = 0;
  let columnsScanned = 0;

  if (options.query === "") return { matches, truncated: false, columnsConsidered, columnsScanned };

  const matcher = findMatchingPoolIds(reader, options);
  if (matcher.highestId < 0) {
    return { matches, truncated: false, columnsConsidered, columnsScanned };
  }

  for (const table of reader.meta.tables) {
    if (options.tableFilter && !table.packedFilePath.includes(options.tableFilter)) continue;

    for (const column of table.columns) {
      const dictionary = reader.getColumnPoolIds(table.packedFilePath, column.name);
      if (!dictionary) continue;
      columnsConsidered++;
      if (!columnCouldMatch(dictionary, matcher)) continue;

      columnsScanned++;
      const perRow = reader.getColumnPoolIdsPerRow(table.packedFilePath, column.name);
      if (!perRow) continue;

      for (let rowIndex = 0; rowIndex < perRow.length; rowIndex++) {
        if (!matcher.has(perRow[rowIndex])) continue;
        matches.push({
          packedFilePath: table.packedFilePath,
          dbName: table.dbName,
          columnName: column.name,
          rowIndex,
          value: reader.resolvePoolValue(perRow[rowIndex]) ?? "",
        });
        if (matches.length >= maxResults) {
          return { matches, truncated: true, columnsConsidered, columnsScanned };
        }
      }
    }
  }

  return { matches, truncated: false, columnsConsidered, columnsScanned };
};
