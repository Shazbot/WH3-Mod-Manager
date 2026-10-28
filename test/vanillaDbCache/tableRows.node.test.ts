import { describe, expect, it, vi } from "vitest";

import {
  collectVanillaDbTableRowsInPackOrder,
  formatVanillaDbTypedRowsOrFallback,
  formatVanillaDbTypedTableRows,
} from "../../src/vanillaDbCache/tableRows";
import type { VanillaDbCacheTypedRead } from "../../src/vanillaDbCache/store";

describe("vanilla DB typed row formatting", () => {
  it("preserves schema column and physical row order with GUI cell formatting", () => {
    expect(
      formatVanillaDbTypedTableRows(
        [
          { name: "number", fieldType: "F32" },
          { name: "flag", fieldType: "Boolean" },
          { name: "empty_optional", fieldType: "OptionalStringU8" },
          { name: "name", fieldType: "StringU8" },
        ],
        [
          { number: 1.23456, flag: true, empty_optional: "", name: "one" },
          { number: 2, flag: false, empty_optional: null, name: "Grüße 🐎" },
        ],
      ),
    ).toEqual([
      { number: "1.235", flag: "1", empty_optional: "0", name: "one" },
      { number: "2.000", flag: "0", empty_optional: "", name: "Grüße 🐎" },
    ]);
  });

  it("runs the complete fallback if any typed row fails formatting", () => {
    const typedRows = { prefixes: [] } as VanillaDbCacheTypedRead;
    const fallback = vi.fn(() => [{ key: "legacy-complete" }]);
    const onFormatError = vi.fn();

    const result = formatVanillaDbTypedRowsOrFallback(
      typedRows,
      () => {
        formatVanillaDbTypedTableRows([{ name: "key", fieldType: "StringU8" }], [{}], "Buildings");
        return [{ key: "partial-typed" }];
      },
      fallback,
      onFormatError,
    );

    expect(result).toEqual([{ key: "legacy-complete" }]);
    expect(fallback).toHaveBeenCalledOnce();
    expect(onFormatError).toHaveBeenCalledOnce();
  });

  it("uses the fallback when the typed cache is unavailable", () => {
    const fallback = vi.fn(() => "legacy");
    expect(formatVanillaDbTypedRowsOrFallback(undefined, () => "typed", fallback)).toBe("legacy");
    expect(fallback).toHaveBeenCalledOnce();
  });
});

describe("vanilla DB source row ordering", () => {
  it("keeps typed database rows and other pack rows in physical pack order", () => {
    const dbPackPath = "K:/game/data/db.pack";
    const otherPackPath = "K:/game/data/extra_vanilla.pack";
    const prefix = "db\\ancillaries_tables\\";
    const rows = collectVanillaDbTableRowsInPackOrder(
      "ancillaries_tables",
      [dbPackPath, otherPackPath],
      "k:/GAME/data/DB.PACK",
      {
        tablePathsByPrefix: new Map([[prefix, ["db\\ancillaries_tables\\a"]]]),
        rowsByPackedFilePath: new Map([["db\\ancillaries_tables\\a", [{ key: "vanilla" }]]]),
      },
      new Map([[otherPackPath, [{ key: "override" }]]]),
    );

    expect(rows).toEqual([
      { row: { key: "vanilla" }, packPath: dbPackPath },
      { row: { key: "override" }, packPath: otherPackPath },
    ]);
  });
});
