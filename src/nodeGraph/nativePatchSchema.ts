import type { SCHEMA_FIELD_TYPE } from "../packFileTypes";

export type NativePatchTableSchemas = Record<string, Array<{ name: string; type: SCHEMA_FIELD_TYPE }>>;
export const NATIVE_PATCH_SCHEMA_HANDLE_PREFIX = "output-schema:";

export const isNativePatchSchemaConnection = (
  source: { type?: string } | undefined,
  sourceHandle: string | null | undefined,
): boolean => source?.type === "nativepatch" && !!sourceHandle?.startsWith(NATIVE_PATCH_SCHEMA_HANDLE_PREFIX);

export const nativePatchColumnsToSchema = (columns: Array<{ name: string; type: string }>) =>
  columns.map(({ name, type }) => {
    // I64 covers the entire unsigned u32 range, which the DB schema has no native type for.
    const schemaType: Record<string, SCHEMA_FIELD_TYPE> = {
      ascii: "StringU8",
      bool: "Boolean",
      u32: "I64",
      i32: "I32",
      f32: "F32",
    };
    if (!schemaType[type]) throw new Error(`Unsupported native patch table column type '${type}'`);
    return { name, type: schemaType[type] };
  });
