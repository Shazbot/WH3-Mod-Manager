import { Field, SCHEMA_FIELD_TYPE } from "../packFileTypes";

/**
 * Conversion between legacy GUI `Field[]` shapes and exact packCore `Field[]` shapes and the plain
 * values the column codecs store.
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
 * | `I16` `I32` `I64`   | `[{I16\|I32\|I64, n}]` in the GUI; packCore I64 is decimal text |
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
export const isEncodableCellType = (fieldType: SCHEMA_FIELD_TYPE): boolean => ENCODABLE_FIELD_TYPES.has(fieldType);

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

/** Exact signed I64 from packCore; legacy fixture inputs remain accepted only while safe. */
export const readI64Cell = (fields: Field[]): string | number => {
  const value = fields[0]?.val ?? 0;
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError(`I64 Number input must be a safe integer: ${value}`);
  }
  if (typeof value !== "number" && typeof value !== "string") {
    throw new TypeError(`Invalid I64 cell value: ${String(value)}`);
  }
  return value;
};

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
 * The StringU8 length field is recomputed in UTF-8 bytes, matching packCore's exact decoder and the
 * length prefix stored in the source table. StringU16 does not carry a length in this cell shape.
 */
export const buildStringCellFields = (fieldType: SCHEMA_FIELD_TYPE, value: string, presentByte: number): Field[] => {
  if (fieldType === "StringU16") return [{ type: "String", val: value }];
  if (fieldType === "StringU8") {
    return [
      { type: "Int16", val: Buffer.byteLength(value, "utf8") },
      { type: "String", val: value },
    ];
  }
  if (presentByte !== OPTIONAL_STRING_PRESENT) return [{ type: "Int8", val: presentByte }];
  return [
    { type: "Int8", val: OPTIONAL_STRING_PRESENT },
    { type: "Int16", val: Buffer.byteLength(value, "utf8") },
    { type: "String", val: value },
  ];
};
