import { describe, expect, it } from "vitest";

import type { Pack } from "../../src/packFileTypes";
import { createSearchMatcher } from "../../src/globalSearch/matcher";
import { searchPackDb } from "../../src/globalSearch/searchDb";

describe("global search DB engine", () => {
  it("searches the final cell of a complete table", async () => {
    const pack: Pack = {
      name: "mod.pack",
      path: "mod.pack",
      packedFiles: [
        {
          name: "db\\test_tables\\data__",
          file_size: 0,
          start_pos: 0,
          tableSchema: {
            version: 1,
            fields: [
              { name: "first", field_type: "StringU8", is_key: true, default_value: "" },
              { name: "second", field_type: "StringU8", is_key: false, default_value: "" },
            ],
          },
          schemaFields: [
            { type: "StringU8", fields: [{ type: "String", val: "row0-first" }] },
            { type: "StringU8", fields: [{ type: "String", val: "row0-second" }] },
            { type: "StringU8", fields: [{ type: "String", val: "row1-first" }] },
            { type: "StringU8", fields: [{ type: "String", val: "row1-second" }] },
            { type: "StringU8", fields: [{ type: "String", val: "row2-first" }] },
            { type: "StringU8", fields: [{ type: "String", val: "needle-final" }] },
          ],
        },
      ],
      packHeader: {} as Pack["packHeader"],
      lastChangedLocal: 0,
      size: 0,
      readTables: "all",
    };
    const results: Array<{ rowIndex: number; columnName: string }> = [];

    const status = await searchPackDb(pack, {
      request: {
        searchId: "test",
        query: "needle",
        caseSensitive: true,
        regex: false,
        kinds: { db: true, loc: false, text: false, rigidModel: false },
        sources: [],
      },
      matcher: createSearchMatcher("needle", { caseSensitive: true }),
      packLabel: "mod.pack",
      maxResultsPerFile: 20,
      isCanceled: () => false,
      addResult: (result) => {
        if (result.kind === "db") results.push({ rowIndex: result.rowIndex, columnName: result.columnName });
        return "continue";
      },
      markFile: () => undefined,
      markTruncated: () => undefined,
      addWarning: () => undefined,
      addSkipped: () => undefined,
    });

    expect(status).toBe("complete");
    expect(results).toEqual([{ rowIndex: 2, columnName: "second" }]);
  });
});
