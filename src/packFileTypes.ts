export interface SchemaField {
  // name?: string;
  type: SCHEMA_FIELD_TYPE | "Buffer";
  fields: Field[];
  isKey?: boolean;
  //   resolvedKeyValue?: string;
}

export interface AmendedSchemaField extends SchemaField {
  name: string;
  resolvedKeyValue: string;
}

export interface PackedFile {
  name: string;
  file_size: number;
  start_pos: number;
  // is_compressed: number;
  schemaFields?: SchemaField[];
  entryCount?: number;
  version?: number;
  guid?: string;
  tableSchema?: DBVersion;
}

export interface PackHeader {
  header: Buffer;
  byteMask: number;
  refFileCount: number;
  pack_file_index_size: number;
  pack_file_count: number;
  header_buffer: Buffer;
}

export interface Pack {
  name: string;
  path: string;
  packedFiles: PackedFile[];
  packHeader: PackHeader;
  lastChangedLocal: number;
  dependencyPacks?: string[];
  readTables: string[] | "all";
}

export interface PackFileCollision {
  firstPackName: string;
  secondPackName: string;
  fileName: string;
}

export interface PackTableCollision extends PackFileCollision {
  secondFileName: string;
  key: string;
  value: string;
}

export interface PackCollisions {
  packFileCollisions: PackFileCollision[];
  packTableCollisions: PackTableCollision[];
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

export interface DBField {
  name: string;
  field_type: SCHEMA_FIELD_TYPE;
  is_key: boolean;
  default_value: string;
  is_filename: boolean;
  filename_relative_path?: any;
  is_reference: string[];
  lookup?: any;
  description: string;
  ca_order: number;
  is_bitwise: number;
  enum_values: Record<string, unknown>;
  is_part_of_colour?: any;
}

export interface DBVersion {
  version: number;
  fields: DBField[];
}
