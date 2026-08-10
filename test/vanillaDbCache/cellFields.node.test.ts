import { describe, expect, it } from "vitest";

import {
  buildNumericCellFields,
  buildStringCellFields,
  isStringCellType,
  readNumericCell,
  readOptionalPresentByte,
  readStringCell,
} from "../../src/vanillaDbCache/cellFields";
import type { Field, SCHEMA_FIELD_TYPE } from "../../src/packFileTypes";

/**
 * The shapes parseTypeBuffer produces, written out by hand. If the reader ever changes, these are what
 * should fail - the round trips below would happily agree with themselves while both being wrong.
 */
const parsedCells: Array<{ fieldType: SCHEMA_FIELD_TYPE; fields: Field[] }> = [
  { fieldType: "Boolean", fields: [{ type: "UInt8", val: 1 }] },
  { fieldType: "ColourRGB", fields: [{ type: "I32", val: 0x336699 }] },
  { fieldType: "I16", fields: [{ type: "I16", val: -300 }] },
  { fieldType: "I32", fields: [{ type: "I32", val: 70000 }] },
  { fieldType: "I64", fields: [{ type: "I64", val: 8_000_000_000 }] },
  { fieldType: "F32", fields: [{ type: "F32", val: 0.5 }] },
  { fieldType: "F64", fields: [{ type: "F64", val: 0.1 }] },
  { fieldType: "StringU16", fields: [{ type: "String", val: "Épée" }] },
  {
    fieldType: "StringU8",
    fields: [
      { type: "Int16", val: 5 },
      { type: "String", val: "hello" },
    ],
  },
  {
    fieldType: "OptionalStringU8",
    fields: [
      { type: "Int8", val: 1 },
      { type: "Int16", val: 3 },
      { type: "String", val: "abc" },
    ],
  },
  { fieldType: "OptionalStringU8", fields: [{ type: "Int8", val: 0 }] },
];

const rebuild = (fieldType: SCHEMA_FIELD_TYPE, fields: Field[]): Field[] =>
  isStringCellType(fieldType)
    ? buildStringCellFields(fieldType, readStringCell(fieldType, fields), readOptionalPresentByte(fields))
    : buildNumericCellFields(fieldType, readNumericCell(fields));

describe("cell fields", () => {
  it("rebuilds every field type to exactly the shape parseTypeBuffer produced", () => {
    for (const { fieldType, fields } of parsedCells) {
      expect(rebuild(fieldType, fields), fieldType).toEqual(fields);
    }
  });

  it("classifies which types hold strings", () => {
    expect(["StringU8", "StringU16", "OptionalStringU8"].every(isStringCellType)).toBe(true);
    expect(["Boolean", "ColourRGB", "I16", "I32", "I64", "F32", "F64"].some(isStringCellType)).toBe(false);
  });

  it("keeps a boolean byte that is neither 0 nor 1", () => {
    // readUInt8 stores whatever was there; normalising it to a bool would change the data.
    expect(rebuild("Boolean", [{ type: "UInt8", val: 7 }])).toEqual([{ type: "UInt8", val: 7 }]);
  });

  it("keeps an absent optional string's presence byte as it was", () => {
    // Only 1 makes parseTypeBuffer read a string, so any other byte has to survive as itself.
    for (const presentByte of [0, 2, 255]) {
      expect(rebuild("OptionalStringU8", [{ type: "Int8", val: presentByte }])).toEqual([
        { type: "Int8", val: presentByte },
      ]);
    }
  });

  it("tells an absent optional string from a present but empty one", () => {
    const absent: Field[] = [{ type: "Int8", val: 0 }];
    const presentEmpty: Field[] = [
      { type: "Int8", val: 1 },
      { type: "Int16", val: 0 },
      { type: "String", val: "" },
    ];

    // Both read as "", so only the presence byte separates them - and it must.
    expect(readStringCell("OptionalStringU8", absent)).toBe("");
    expect(readStringCell("OptionalStringU8", presentEmpty)).toBe("");
    expect(rebuild("OptionalStringU8", absent)).toEqual(absent);
    expect(rebuild("OptionalStringU8", presentEmpty)).toEqual(presentEmpty);
  });

  it("recomputes the StringU8 length from the string", () => {
    expect(buildStringCellFields("StringU8", "abcdef", 0)).toEqual([
      { type: "Int16", val: 6 },
      { type: "String", val: "abcdef" },
    ]);
  });

  it("gives StringU16 a single field, since its length prefix is dropped on read", () => {
    expect(buildStringCellFields("StringU16", "wide", 0)).toEqual([{ type: "String", val: "wide" }]);
  });

  it("refuses to build a numeric cell for a string type", () => {
    expect(() => buildNumericCellFields("StringU8", 1)).toThrow();
  });
});
