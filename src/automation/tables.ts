import { LocVersion, type DBField, type DBVersion, type Field, type SCHEMA_FIELD_TYPE } from "../packFileTypes";
import { parseDBTablePath, resolveParsedDBVersion } from "../utility/packFileHelpers";
import { parseDbTable, parseLocTable, readDbTablePreamble, type ParsedDbTable } from "../packCore";
import { AutomationError } from "./errors";
import { normalizeInternalPackPath } from "./filesystem";

export type JsonCell = string | number | boolean | null;
export type TableRow = Record<string, JsonCell>;

export interface TableFilter {
  field: string;
  op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "contains";
  value: JsonCell | JsonCell[];
}

export interface TableSort {
  field: string;
  direction: "asc" | "desc";
}

export type TableSchemaProvider = (game: "wh3") => Promise<Record<string, DBVersion[]>>;

export interface LoadedTable {
  packedPath: string;
  parsed: ParsedDbTable;
  isLoc: boolean;
}

const numericTypes = new Set<SCHEMA_FIELD_TYPE>(["ColourRGB", "F32", "I16", "I32", "I64", "F64"]);
const stringTypes = new Set<SCHEMA_FIELD_TYPE>(["StringU8", "StringU16", "OptionalStringU8"]);

const resolveField = (schema: DBVersion, fieldName: string): { index: number; field: DBField } => {
  const matches = schema.fields.flatMap((field, index) => (field.name === fieldName ? [{ index, field }] : []));
  if (matches.length !== 1) {
    throw new AutomationError(
      "INVALID_ARGUMENT",
      matches.length === 0 ? `Unknown table field: ${fieldName}` : `Ambiguous table field name: ${fieldName}`,
    );
  }
  return matches[0];
};

const defaultJsonValue = (field: DBField): JsonCell | undefined => {
  const value = field.default_value;
  switch (field.field_type) {
    case "Boolean":
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      return undefined;
    case "OptionalStringU8":
      return value === "" ? null : value;
    case "StringU8":
    case "StringU16":
      return value;
    case "I64":
      return /^-?\d+$/.test(value) ? value : undefined;
    case "I16":
    case "I32":
    case "ColourRGB":
    case "F32":
    case "F64": {
      if (value.trim() === "") return undefined;
      const number = Number(value);
      return Number.isFinite(number) ? number : undefined;
    }
  }
};

export const validateCellValue = (field: DBField, value: unknown): JsonCell => {
  switch (field.field_type) {
    case "Boolean":
      if (typeof value !== "boolean") break;
      return value;
    case "OptionalStringU8":
      if (value === null) return null;
      if (typeof value === "string") return validateStringU8(field, value);
      break;
    case "StringU8":
      if (typeof value === "string") return validateStringU8(field, value);
      break;
    case "StringU16":
      if (typeof value === "string") return value;
      break;
    case "I64":
      if (typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value)) {
        const integer = BigInt(value);
        if (integer >= -(1n << 63n) && integer <= (1n << 63n) - 1n) return integer.toString(10);
      }
      break;
    case "I16":
      if (typeof value === "number" && Number.isInteger(value) && value >= -32768 && value <= 32767) return value;
      break;
    case "I32":
    case "ColourRGB":
      if (typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)
        return value;
      break;
    case "F32":
      if (typeof value === "number" && Number.isFinite(value) && Number.isFinite(Math.fround(value))) return value;
      break;
    case "F64":
      if (typeof value === "number" && Number.isFinite(value)) return value;
      break;
  }
  throw new AutomationError("VALIDATION", `Value for field ${field.name} does not match ${field.field_type}`, {
    field: field.name,
    fieldType: field.field_type,
    value,
  });
};

const validateStringU8 = (field: DBField, value: string): string => {
  if (Buffer.byteLength(value, "utf8") > 0xffff) {
    throw new AutomationError(
      "VALIDATION",
      `Field ${field.name} requires a UTF-8 StringU8 value of at most 65535 bytes`,
    );
  }
  return value;
};

export const fieldsFromJsonValue = (field: DBField, rawValue: unknown, allowDefault = false): Field[] => {
  let value = rawValue;
  if (value === undefined && allowDefault) value = defaultJsonValue(field);
  if (value === undefined) {
    throw new AutomationError("VALIDATION", `Missing required value for field ${field.name}`, { field: field.name });
  }
  const validated = validateCellValue(field, value);
  switch (field.field_type) {
    case "Boolean":
      return [{ type: "UInt8", val: (validated as boolean) ? 1 : 0 }];
    case "OptionalStringU8":
      return validated === null
        ? [{ type: "Int8", val: 0 }]
        : [
            { type: "Int8", val: 1 },
            { type: "Int16", val: Buffer.byteLength(validated as string, "utf8") },
            { type: "String", val: validated as string },
          ];
    case "StringU8":
      return [
        { type: "Int16", val: Buffer.byteLength(validated as string, "utf8") },
        { type: "String", val: validated as string },
      ];
    case "StringU16":
      if (Buffer.byteLength(validated as string, "utf8") > 0xffff) {
        throw new AutomationError("VALIDATION", `Field ${field.name} exceeds the StringU16 length limit`);
      }
      return [{ type: "String", val: validated as string }];
    case "I64":
      return [{ type: "I64", val: validated as string }];
    case "I16":
      return [{ type: "I16", val: validated as number }];
    case "I32":
    case "ColourRGB":
      return [{ type: "I32", val: validated as number }];
    case "F32":
      return [{ type: "F32", val: validated as number }];
    case "F64":
      return [{ type: "F64", val: validated as number }];
  }
};

export const jsonValueFromCell = (fieldType: SCHEMA_FIELD_TYPE, fields: Field[]): JsonCell => {
  switch (fieldType) {
    case "Boolean":
      return fields[0]?.val === 1;
    case "OptionalStringU8":
      return fields[0]?.val === 1 ? String(fields[2]?.val ?? "") : null;
    case "StringU8":
      return String(fields[1]?.val ?? "");
    case "StringU16":
      return String(fields[0]?.val ?? "");
    case "I64":
      return String(fields[0]?.val ?? "0");
    case "F32":
    case "I16":
    case "I32":
    case "F64":
    case "ColourRGB": {
      const value = Number(fields[0]?.val ?? 0);
      if ((fieldType === "F32" || fieldType === "F64") && !Number.isFinite(value)) {
        throw new AutomationError("UNSUPPORTED", `Non-finite ${fieldType} value cannot be represented in JSON`, {
          fieldType,
          value: String(value),
        });
      }
      return value;
    }
  }
};

export const loadPackedTable = async (
  packedPathInput: string,
  buffer: Buffer,
  schemaProvider: TableSchemaProvider,
): Promise<LoadedTable> => {
  const packedPath = normalizeInternalPackPath(packedPathInput);
  if (packedPath.toLowerCase().endsWith(".loc")) {
    try {
      return { packedPath, parsed: parseLocTable(buffer), isLoc: true };
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError(
        "VALIDATION",
        `Invalid LOC table ${packedPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const parsedPath = parseDBTablePath(packedPath.toLowerCase());
  if (!parsedPath || parsedPath.dbName.toLowerCase() === "db" || parsedPath.dbName === "") {
    throw new AutomationError("INVALID_ARGUMENT", `Packed path is not a DB table or LOC file: ${packedPath}`);
  }
  const schemaMap = await schemaProvider("wh3");
  if (Object.keys(schemaMap).length === 0) {
    throw new AutomationError("UNSUPPORTED", "Bundled WH3 DB schema is unavailable");
  }
  const versions = schemaMap[parsedPath.dbName];
  if (!versions || versions.length === 0) {
    throw new AutomationError("UNSUPPORTED", `No bundled schema exists for table ${parsedPath.dbName}`);
  }
  let preamble: ReturnType<typeof readDbTablePreamble>;
  try {
    preamble = readDbTablePreamble(buffer);
  } catch (error) {
    throw new AutomationError(
      "VALIDATION",
      `Invalid DB preamble ${packedPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const schema =
    preamble.version === undefined
      ? resolveParsedDBVersion(undefined, versions)
      : versions.find((candidate) => candidate.version === preamble.version);
  if (!schema) {
    throw new AutomationError(
      "UNSUPPORTED",
      preamble.version === undefined
        ? `No compatible unversioned schema exists for table ${parsedPath.dbName}`
        : `No exact supported schema version ${preamble.version} exists for table ${parsedPath.dbName}`,
      { table: parsedPath.dbName, version: preamble.version },
    );
  }
  try {
    return { packedPath, parsed: parseDbTable(buffer, schema, { game: "wh3" }), isLoc: false };
  } catch (error) {
    if (error instanceof AutomationError) throw error;
    throw new AutomationError(
      "VALIDATION",
      `Invalid DB table ${packedPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const tableRowsToJson = (table: ParsedDbTable, selectedColumns?: readonly string[]): TableRow[] => {
  const columns = selectedColumns ?? table.schema.fields.map((field) => field.name);
  for (const name of columns) resolveField(table.schema, name);
  return table.rows.map((row) => {
    const result: TableRow = {};
    for (const columnName of columns) {
      const { index, field } = resolveField(table.schema, columnName);
      result[field.name] = jsonValueFromCell(field.field_type, row.cells[index].fields);
    }
    return result;
  });
};

const compareValues = (fieldType: SCHEMA_FIELD_TYPE, left: JsonCell, right: JsonCell): number => {
  if (left === null || right === null) return left === right ? 0 : left === null ? -1 : 1;
  if (fieldType === "I64") {
    const a = BigInt(left as string);
    const b = BigInt(right as string);
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (numericTypes.has(fieldType)) {
    const a = Number(left);
    const b = Number(right);
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (typeof left === "boolean" && typeof right === "boolean") return left === right ? 0 : left ? 1 : -1;
  const a = String(left);
  const b = String(right);
  return a === b ? 0 : a < b ? -1 : 1;
};

export const validateFilters = (schema: DBVersion, filters: readonly TableFilter[] = []): TableFilter[] =>
  filters.map((filter) => {
    const { field } = resolveField(schema, filter.field);
    if (filter.op === "contains") {
      if (!stringTypes.has(field.field_type) || typeof filter.value !== "string") {
        throw new AutomationError("VALIDATION", `contains requires a string field and string value (${field.name})`);
      }
      return filter;
    }
    if (filter.op === "in") {
      if (!Array.isArray(filter.value))
        throw new AutomationError("VALIDATION", `in requires an array value (${field.name})`);
      return { ...filter, value: filter.value.map((value) => validateCellValue(field, value)) };
    }
    if (Array.isArray(filter.value))
      throw new AutomationError("VALIDATION", `${filter.op} requires a scalar (${field.name})`);
    if (
      ["lt", "lte", "gt", "gte"].includes(filter.op) &&
      ((!numericTypes.has(field.field_type) && !stringTypes.has(field.field_type)) || field.field_type === "Boolean")
    ) {
      throw new AutomationError("VALIDATION", `${filter.op} is unsupported for ${field.field_type} (${field.name})`);
    }
    if (["lt", "lte", "gt", "gte"].includes(filter.op) && filter.value === null) {
      throw new AutomationError("VALIDATION", `${filter.op} does not accept null (${field.name})`);
    }
    return { ...filter, value: validateCellValue(field, filter.value) };
  });

export const queryTableRows = (
  table: Pick<ParsedDbTable, "schema">,
  rows: readonly Readonly<TableRow>[],
  filters: readonly TableFilter[] = [],
  sort: readonly TableSort[] = [],
): Readonly<TableRow>[] => {
  const validatedFilters = validateFilters(table.schema, filters);
  const validatedSort = sort.map((item) => {
    const fieldInfo = resolveField(table.schema, item.field);
    if (fieldInfo.field.field_type === "Boolean") {
      throw new AutomationError("VALIDATION", `Sorting is unsupported for Boolean field ${fieldInfo.field.name}`);
    }
    return { ...item, fieldInfo };
  });
  const filtered = rows.filter((row) =>
    validatedFilters.every((filter) => {
      const { field } = resolveField(table.schema, filter.field);
      const value = row[field.name];
      if (filter.op === "contains") return typeof value === "string" && value.includes(filter.value as string);
      if (filter.op === "in")
        return (filter.value as JsonCell[]).some(
          (candidate) => compareValues(field.field_type, value, candidate) === 0,
        );
      const order = compareValues(field.field_type, value, filter.value as JsonCell);
      switch (filter.op) {
        case "eq":
          return order === 0;
        case "ne":
          return order !== 0;
        case "lt":
          return order < 0;
        case "lte":
          return order <= 0;
        case "gt":
          return order > 0;
        case "gte":
          return order >= 0;
      }
    }),
  );
  if (validatedSort.length === 0) return filtered;
  return filtered
    .map((row, index) => ({ row, index }))
    .toSorted((a, b) => {
      for (const item of validatedSort) {
        const order = compareValues(
          item.fieldInfo.field.field_type,
          a.row[item.fieldInfo.field.name],
          b.row[item.fieldInfo.field.name],
        );
        if (order !== 0) return item.direction === "asc" ? order : -order;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
};

export const enforceUniqueSchemaKeys = (table: ParsedDbTable, rows: readonly TableRow[]): void => {
  const keyFields = table.schema.fields.filter((field) => field.is_key);
  if (keyFields.length === 0) return;
  const seen = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify(keyFields.map((field) => row[field.name]));
    if (seen.has(key))
      throw new AutomationError("CONFLICT", "Resulting table contains duplicate schema key", {
        keyFields: keyFields.map((field) => field.name),
        key,
      });
    seen.add(key);
  }
};

export const makeRowFields = (schema: DBVersion, row: Record<string, unknown>, allowDefaults: boolean): Field[][] => {
  const knownNames = new Set(schema.fields.map((field) => field.name));
  const unknown = Object.keys(row).filter((key) => !knownNames.has(key));
  if (unknown.length > 0)
    throw new AutomationError("INVALID_ARGUMENT", `Unknown table field(s): ${unknown.join(", ")}`, { fields: unknown });
  return schema.fields.map((field) => fieldsFromJsonValue(field, row[field.name], allowDefaults));
};

export const applyRecordToCells = (
  schema: DBVersion,
  existingCells: readonly { fields: Field[]; bytes: Buffer }[],
  values: Record<string, unknown>,
): Array<{ fields: Field[] } | { bytes: Buffer }> => {
  const knownNames = new Set(schema.fields.map((field) => field.name));
  const unknown = Object.keys(values).filter((key) => !knownNames.has(key));
  if (unknown.length > 0)
    throw new AutomationError("INVALID_ARGUMENT", `Unknown table field(s): ${unknown.join(", ")}`, { fields: unknown });
  return schema.fields.map((field, index) =>
    Object.prototype.hasOwnProperty.call(values, field.name)
      ? { fields: fieldsFromJsonValue(field, values[field.name]) }
      : { bytes: existingCells[index].bytes },
  );
};
