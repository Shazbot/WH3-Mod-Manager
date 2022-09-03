export interface PackedFile {
  name: string;
  file_size: number;
  start_pos: number;
  is_compressed: number;
  schemaFields: SchemaField[];
  version: number | undefined;
  guid: string | undefined;
}

export interface SchemaField {
  name: string;
  type: SCHEMA_FIELD_TYPE | "Buffer";
  fields: Field[];
  isKey: boolean;
  resolvedKeyValue?: string;
}

export type SCHEMA_FIELD_TYPE =
  | "Boolean"
  | "OptionalStringU8"
  | "StringU8"
  | "F32"
  | "I32"
  | "I64"
  | "F64"
  | "ColourRGB"
  | "StringU16";
export type FIELD_TYPE = "Int16" | "Int8" | "UInt8" | "String" | "Buffer" | "F32" | "I32" | "I64" | "F64";
export type FIELD_VALUE = number | string | Buffer | undefined;

export interface Field {
  type: FIELD_TYPE;
  val: FIELD_VALUE;
}

export interface Pack {
  name: string;
  path: string;
  packedFiles: PackedFile[];
}

export const packsData: Pack[] = [];
