import { describe, expect, it } from "vitest";

import {
  createPreparedTableCache,
  estimatePreparedTableBytes,
  PreparedTableData,
} from "../src/components/viewer/tablePrepCache";

const preparedTable = (value: string): PreparedTableData => ({
  chunkedTable: [[]],
  data: [{ __rowId: "0", c0: value }],
  columnHeaders: ["key"],
  columns: [{ type: "text" }],
  columnWidthHints: [{ maxLength: value.length, nonEmptyCount: 1, widestValue: value }],
  columnFilterOptions: ["key"],
  keyColumnNames: ["key"],
  lowerCaseColumnValues: [[value.toLowerCase()]],
});

describe("prepared viewer table cache", () => {
  it("retains several small tables when they fit the byte budget", () => {
    const first = preparedTable("first");
    const second = preparedTable("second");
    const cache = createPreparedTableCache(estimatePreparedTableBytes(first) + estimatePreparedTableBytes(second));

    cache.set("first", first);
    cache.set("second", second);

    expect(cache.stats().entries).toBe(2);
    expect(cache.get("first")).toBe(first);
    expect(cache.get("second")).toBe(second);
  });

  it("evicts the least-recently-used tables by retained bytes", () => {
    const first = preparedTable("a".repeat(100));
    const second = preparedTable("b".repeat(100));
    const third = preparedTable("c".repeat(100));
    const twoTableBudget = estimatePreparedTableBytes(first) + estimatePreparedTableBytes(second);
    const cache = createPreparedTableCache(twoTableBudget);

    cache.set("first", first);
    cache.set("second", second);
    expect(cache.get("first")).toBe(first);
    cache.set("third", third);

    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")).toBe(first);
    expect(cache.get("third")).toBe(third);
    expect(cache.stats().bytes).toBeLessThanOrEqual(twoTableBudget);
  });

  it("retains one oversize hot table instead of thrashing on every revisit", () => {
    const table = preparedTable("large table");
    const cache = createPreparedTableCache(1);

    cache.set("large", table);

    expect(cache.get("large")).toBe(table);
    expect(cache.stats().entries).toBe(1);
  });
});
