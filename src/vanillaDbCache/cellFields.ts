import { Field, SCHEMA_FIELD_TYPE } from "../packFileTypes";

/**
 * Conversion between the `Field[]` shapes `parseTypeBuffer` produces and the plain values the column
 * codecs store.
 *
 * This is the fidelity contract of the whole cache. A decoded cell has to be indistinguishable from
 * one `readPack` produced, because consumers read `fields[0].val`, `fields[1].val` and so on directly,
 * and `resolveKeyValue` picks a different element depending on the type. Getting a shape subtly wrong
 * would not throw - it would hand back plausible wrong values.
 *
 * The shapes, from `parseTypeBuffer`:
 *
 * | field type          | fields                                                        |
 * |---------------------|---------------------------------------------------------------|
 * | `Boolean`           | `[{UInt8, byte}]`                                             |
 * | `ColourRGB`         | `[{I32, n}]`                                                  |
 * | `I16` `I32` `I64`   | `[{I16\|I32\|I64, n}]`                                        |
 * | `F32` `F64`         | `[{F32\|F64, n}]`                                             |
 * | `StringU16`         | `[{String, s}]` - the length prefix is dropped on read        |
 * | `StringU8`          | `[{Int16, length}, {String, s}]`                              |
 * | `OptionalStringU8`  | `[{Int8, 1}, {Int16, length}, {String, s}]` when present,      |
 * |                     | `[{Int8, byte}]` otherwise                                    |
 */

/** Types whose value is a string. Everything else is a single number. */
export const isStringCellType = (fieldType: SCHEMA_FIELD_TYPE): boolean =>
  fieldType === "StringU8" || fieldType === "StringU16" || fieldType === "OptionalStringU8";

const ENCODABLE_FIELD_TYPES = new Set<string>([
  "Boolean",
  "ColourRGB",
  "F32",
  "F64",
  "I16",
  "I32",
  "I64",
  "OptionalStringU8",
  "StringU8",
  "StringU16",
]);

/**
 * Whether a field type can be stored at all.
 *
 * Schemas carry types the pack reader has no case for - `OptionalI32` appears in the WH3 schema - and
 * `parseTypeBuffer` throws on those, leaving the row it was midway through misaligned. A table with
 * one is left out of the cache rather than stored from cells that were never read correctly.
 */
export const isEncodableCellType = (fieldType: SCHEMA_FIELD_TYPE): boolean =>
  ENCODABLE_FIELD_TYPES.has(fieldType);

/** The byte that says whether an OptionalStringU8 carries a string. Only 1 means it does. */
export const OPTIONAL_STRING_PRESENT = 1;

const numericFieldType = (fieldType: SCHEMA_FIELD_TYPE): Field["type"] => {
  switch (fieldType) {
    case "Boolean":
      return "UInt8";
    case "ColourRGB":
      return "I32";
    case "I16":
      return "I16";
    case "I32":
      return "I32";
    case "I64":
      return "I64";
    case "F32":
      return "F32";
    case "F64":
      return "F64";
    default:
      throw new Error(`Not a numeric DB field type: ${fieldType}`);
  }
};

export const readNumericCell = (fields: Field[]): number => Number(fields[0]?.val ?? 0);

/**
 * The string a cell holds, or "" when it holds none.
 *
 * An absent OptionalStringU8 and one holding an empty string both read as "", which is safe because
 * the present byte is stored separately and decides which shape gets rebuilt.
 */
export const readStringCell = (fieldType: SCHEMA_FIELD_TYPE, fields: Field[]): string => {
  if (fieldType === "StringU16") return String(fields[0]?.val ?? "");
  if (fieldType === "StringU8") return String(fields[1]?.val ?? "");
  return fields[0]?.val === OPTIONAL_STRING_PRESENT ? String(fields[2]?.val ?? "") : "";
};

/** The raw presence byte of an OptionalStringU8, which is not always 0 or 1. */
export const readOptionalPresentByte = (fields: Field[]): number => Number(fields[0]?.val ?? 0);

export const buildNumericCellFields = (fieldType: SCHEMA_FIELD_TYPE, value: number): Field[] => [
  { type: numericFieldType(fieldType), val: value },
];

/**
 * `presentByte` is only consulted for OptionalStringU8.
 *
 * The StringU8 length field is recomputed from the string rather than stored: `parseTypeBuffer` reads
 * exactly `length` bytes and decodes them as ascii, which yields one character per byte, so the two
 * can never disagree.
 */
export const buildStringCellFields = (
  fieldType: SCHEMA_FIELD_TYPE,
  value: string,
  presentByte: number,
): Field[] => {
  if (fieldType === "StringU16") return [{ type: "String", val: value }];
  if (fieldType === "StringU8") {
    return [
      { type: "Int16", val: value.length },
      { type: "String", val: value },
    ];
  }
  if (presentByte !== OPTIONAL_STRING_PRESENT) return [{ type: "Int8", val: presentByte }];
  return [
    { type: "Int8", val: OPTIONAL_STRING_PRESENT },
    { type: "Int16", val: value.length },
    { type: "String", val: value },
  ];
};
