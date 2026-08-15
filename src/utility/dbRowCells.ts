/**
 * Turning values into the cell shape a DB row is made of.
 *
 * Lifted verbatim out of `PackTablesTableView`, which had them private, so the buildings panel can
 * build new rows with exactly the same encoding the grid uses - one place to be right about the
 * `OptionalStringU8` empty-vs-set flag, the `StringU8` length prefix and the rest.
 */
import type { AmendedSchemaField, DBVersion, Field, SCHEMA_FIELD_TYPE } from "../packFileTypes";

/** A cell's value as the grid and the buildings edit model both hold it. */
export type TableCellValue = string | number | boolean;

const buildFieldValues = (fieldType: SCHEMA_FIELD_TYPE, value: string | number | boolean): Field[] => {
  switch (fieldType) {
    case "Boolean":
      return [{ type: "UInt8", val: value ? 1 : 0 }];
    case "StringU16":
      return [{ type: "String", val: String(value) }];
    case "StringU8": {
      const stringValue = String(value);
      return [
        { type: "Int16", val: stringValue.length },
        { type: "String", val: stringValue },
      ];
    }
    case "OptionalStringU8": {
      const stringValue = String(value);
      if (stringValue === "") {
        return [{ type: "Int8", val: 0 }];
      }
      return [
        { type: "Int8", val: 1 },
        { type: "Int16", val: stringValue.length },
        { type: "String", val: stringValue },
      ];
    }
    case "F32":
      return [{ type: "F32", val: Number(value) }];
    case "I32":
    case "ColourRGB":
      return [{ type: "I32", val: Number(value) }];
    case "I16":
      return [{ type: "I16", val: Number(value) }];
    case "F64":
      return [{ type: "F64", val: Number(value) }];
    case "I64":
      return [{ type: "I64", val: Number(value) }];
    default:
      return [{ type: "String", val: String(value) }];
  }
};

export const parseEditedCellValue = (
  fieldType: SCHEMA_FIELD_TYPE,
  value: unknown,
): { value: TableCellValue; resolvedKeyValue: string; fields: Field[] } | undefined => {
  switch (fieldType) {
    case "Boolean": {
      if (typeof value === "boolean") {
        return {
          value,
          resolvedKeyValue: value ? "1" : "0",
          fields: buildFieldValues(fieldType, value),
        };
      }

      const normalized = String(value ?? "")
        .trim()
        .toLowerCase();
      if (["1", "true", "yes"].includes(normalized)) {
        return {
          value: true,
          resolvedKeyValue: "1",
          fields: buildFieldValues(fieldType, true),
        };
      }
      if (["0", "false", "no"].includes(normalized)) {
        return {
          value: false,
          resolvedKeyValue: "0",
          fields: buildFieldValues(fieldType, false),
        };
      }
      return undefined;
    }
    case "StringU16":
    case "StringU8": {
      const nextValue = String(value ?? "");
      return {
        value: nextValue,
        resolvedKeyValue: nextValue,
        fields: buildFieldValues(fieldType, nextValue),
      };
    }
    case "OptionalStringU8": {
      const nextValue = String(value ?? "");
      return {
        value: nextValue,
        resolvedKeyValue: nextValue === "" ? "0" : nextValue,
        fields: buildFieldValues(fieldType, nextValue),
      };
    }
    case "I16":
    case "I32":
    case "I64":
    case "ColourRGB": {
      const normalized = String(value ?? "").trim();
      if (!/^-?\d+$/.test(normalized)) return undefined;
      const parsedValue = Number(normalized);
      return {
        value: parsedValue,
        resolvedKeyValue: normalized,
        fields: buildFieldValues(fieldType, parsedValue),
      };
    }
    case "F32":
    case "F64": {
      const normalized = String(value ?? "").trim();
      if (normalized === "") return undefined;
      const parsedValue = Number(normalized);
      if (!Number.isFinite(parsedValue)) return undefined;
      return {
        value: parsedValue,
        resolvedKeyValue: normalized,
        fields: buildFieldValues(fieldType, parsedValue),
      };
    }
    default:
      return undefined;
  }
};

export const buildDefaultCellValue = (
  fieldName: string,
  fieldType: SCHEMA_FIELD_TYPE,
  defaultValue: string,
  isKey: boolean,
): AmendedSchemaField => {
  const normalizedDefaultValue = defaultValue ?? "";

  switch (fieldType) {
    case "Boolean": {
      const normalized = normalizedDefaultValue.trim().toLowerCase();
      const nextValue = ["1", "true", "yes"].includes(normalized);
      return {
        name: fieldName,
        type: fieldType,
        isKey,
        resolvedKeyValue: nextValue ? "1" : "0",
        fields: buildFieldValues(fieldType, nextValue),
      };
    }
    case "OptionalStringU8": {
      const nextValue = normalizedDefaultValue === "0" ? "" : normalizedDefaultValue;
      return {
        name: fieldName,
        type: fieldType,
        isKey,
        resolvedKeyValue: nextValue === "" ? "0" : nextValue,
        fields: buildFieldValues(fieldType, nextValue),
      };
    }
    case "I16":
    case "I32":
    case "I64":
    case "ColourRGB":
    case "F32":
    case "F64": {
      const normalized = normalizedDefaultValue.trim();
      const parsedNumber = normalized === "" ? 0 : Number(normalized);
      const nextValue = Number.isFinite(parsedNumber) ? parsedNumber : 0;
      const resolvedKeyValue = normalized !== "" && Number.isFinite(parsedNumber) ? normalized : "0";
      return {
        name: fieldName,
        type: fieldType,
        isKey,
        resolvedKeyValue,
        fields: buildFieldValues(fieldType, nextValue),
      };
    }
    case "StringU8":
    case "StringU16":
    default:
      return {
        name: fieldName,
        type: fieldType,
        isKey,
        resolvedKeyValue: normalizedDefaultValue,
        fields: buildFieldValues(fieldType, normalizedDefaultValue),
      };
  }
};

export const buildDefaultRowSchemaFields = (schema: DBVersion): AmendedSchemaField[] => {
  return schema.fields.map((field) =>
    buildDefaultCellValue(field.name, field.field_type, field.default_value, field.is_key),
  );
};

/**
 * A cell from a string, for callers that only have text - the buildings edit model keeps every value
 * as a string so one editing path serves both the board and the table grid.
 *
 * Falls back to the field's default when the text is not valid for the type, so a bad value can
 * never produce a row that fails to serialize.
 */
export const buildCellFromString = (
  field: { name: string; field_type: SCHEMA_FIELD_TYPE; default_value: string; is_key: boolean },
  value: string | undefined,
): AmendedSchemaField => {
  if (value != undefined) {
    const parsed = parseEditedCellValue(field.field_type, value);
    if (parsed) {
      return {
        name: field.name,
        type: field.field_type,
        isKey: field.is_key,
        resolvedKeyValue: parsed.resolvedKeyValue,
        fields: parsed.fields,
      };
    }
  }
  return buildDefaultCellValue(field.name, field.field_type, field.default_value, field.is_key);
};

/** The row a table's schema describes, every cell at its default. */
export const buildRowFromValues = (schema: DBVersion, values: Record<string, string>): AmendedSchemaField[] =>
  schema.fields.map((field) => buildCellFromString(field, values[field.name]));
