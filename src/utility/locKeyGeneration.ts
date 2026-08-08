import { AmendedSchemaField, DBVersion } from "../packFileTypes";

/**
 * Strips the trailing "_tables" that loc keys never include, e.g.
 * "main_units_tables" -> "main_units".
 */
export const getTableNameWithoutTablesSuffix = (tableName: string): string => {
  const indexOfTableSuffix = tableName.lastIndexOf("_tables");
  return indexOfTableSuffix > -1 ? tableName.substring(0, indexOfTableSuffix) : tableName;
};

/**
 * Works out which of a table's columns, and in which order, make up the value part of its loc keys.
 *
 * Prefers the schema's explicit localised_key_order. Failing that it falls back to the single
 * column other tables reference (referencedColumns), and failing that to the first is_key field.
 * Returns column indices into tableSchema.fields, or an empty array when no key can be determined.
 */
export const getLocKeyColumns = (tableSchema: DBVersion, referencedColumns: string[] = []): number[] => {
  if (tableSchema.localised_key_order && tableSchema.localised_key_order.length > 0) {
    return tableSchema.localised_key_order;
  }

  const keyColumn =
    referencedColumns.length == 1
      ? referencedColumns[0]
      : tableSchema.fields.find((field) => field.is_key)?.name;
  if (!keyColumn) return [];

  const keyFieldIndex = tableSchema.fields.findIndex((field) => field.name == keyColumn);
  return keyFieldIndex > -1 ? [keyFieldIndex] : [];
};

/**
 * Builds the loc key for one row and one localised field, e.g.
 * "main_units_onscreen_name_emp_spearmen".
 */
export const buildLocKey = (
  tableName: string,
  locFieldName: string,
  row: AmendedSchemaField[],
  keyColumns: number[],
): string => {
  let locKey = `${getTableNameWithoutTablesSuffix(tableName)}_${locFieldName}_`;
  for (const keyOrder of keyColumns) {
    locKey += row[keyOrder]?.resolvedKeyValue ?? "";
  }
  return locKey;
};
