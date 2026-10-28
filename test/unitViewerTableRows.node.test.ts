import { describe, expect, it } from "vitest";

import {
  formatUnitViewerTypedTableRows,
  formatUnitViewerTypedValue,
  prependUnitViewerTableRows,
} from "../src/unitViewer/tableRows";

describe("Unit Viewer typed table rows", () => {
  it("matches the GUI string formatting for typed DB values", () => {
    expect(formatUnitViewerTypedValue("F32", 1.23456)).toBe("1.235");
    expect(formatUnitViewerTypedValue("F64", -0)).toBe("0.000");
    expect(formatUnitViewerTypedValue("I16", -32768)).toBe("-32768");
    expect(formatUnitViewerTypedValue("I32", 2147483647)).toBe("2147483647");
    // The legacy GUI resolver goes through Number for I64 and therefore intentionally rounds here.
    expect(formatUnitViewerTypedValue("I64", "9007199254740993")).toBe("9007199254740992");
    expect(formatUnitViewerTypedValue("Boolean", true)).toBe("1");
    expect(formatUnitViewerTypedValue("Boolean", false)).toBe("0");
    expect(formatUnitViewerTypedValue("OptionalStringU8", null)).toBe("");
    expect(formatUnitViewerTypedValue("OptionalStringU8", "")).toBe("0");
    expect(formatUnitViewerTypedValue("OptionalStringU8", "empty-proof")).toBe("empty-proof");
    expect(formatUnitViewerTypedValue("StringU8", "Grüße 🐎")).toBe("Grüße 🐎");
    expect(formatUnitViewerTypedValue("StringU16", "")).toBe("");
    expect(formatUnitViewerTypedValue("ColourRGB", 16711680)).toBe("16711680");
  });

  it("keeps column and row order, then prepends vanilla rows before mod rows", () => {
    const records = formatUnitViewerTypedTableRows(
      [
        { name: "second", fieldType: "I32" },
        { name: "first", fieldType: "StringU8" },
      ],
      [
        { second: 2, first: "vanilla-a" },
        { second: 3, first: "vanilla-b" },
      ],
    );
    const mods = [{ second: "4", first: "mod" }];

    expect(Object.keys(records[0])).toEqual(["second", "first"]);
    expect(prependUnitViewerTableRows(records, mods)).toEqual([
      { second: "2", first: "vanilla-a" },
      { second: "3", first: "vanilla-b" },
      { second: "4", first: "mod" },
    ]);
  });

  it("rejects a typed row that omits a schema column", () => {
    expect(() => formatUnitViewerTypedTableRows([{ name: "key", fieldType: "StringU8" }], [{}])).toThrow(
      "Typed Unit Viewer row is missing column key",
    );
  });
});
