import * as wh3Schema from "../schema/schema_wh3.json";
import { SCHEMA_FIELD_TYPE } from "./packFileTypes";

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

export const schema = wh3Schema;
export const DBNameToDBVersions: Record<string, DBVersion[]> = {};

const vf = (schema as { versioned_files: any[] }).versioned_files as any[];
for (const versioned_file of vf) {
  if ("DB" in versioned_file) {
    DBNameToDBVersions[versioned_file.DB[0]] = versioned_file.DB[1];
  }
}
