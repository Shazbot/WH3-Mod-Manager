import { describe, expect, it } from "vitest";
import * as path from "node:path";

import { resolveExportOutputPath } from "../src/utility/exportPaths";

describe("export output paths", () => {
  it("keeps normal paths under the base and rejects traversal", () => {
    expect(resolveExportOutputPath("/tmp/export", "db/table/data.tsv")).toBe(
      path.resolve("/tmp/export", "db/table/data.tsv"),
    );
    expect(resolveExportOutputPath("/tmp/export", "../outside.txt")).toBeUndefined();
    expect(resolveExportOutputPath("/tmp/export", "db/../../outside.txt")).toBeUndefined();
  });
});
