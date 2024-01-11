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

export const locFields: DBField[] = [
  {
    name: "key",
    field_type: "StringU16",
    default_value: "",
    is_key: true,
    is_filename: false,
    is_reference: [],
    description: "",
    ca_order: 0,
    is_bitwise: 0,
    enum_values: {},
  },
  {
    name: "text",
    field_type: "StringU16",
    default_value: "",
    is_key: true,
    is_filename: false,
    is_reference: [],
    description: "",
    ca_order: 0,
    is_bitwise: 0,
    enum_values: {},
  },
  {
    name: "tooltip",
    field_type: "Boolean",
    default_value: "false",
    is_key: true,
    is_filename: false,
    is_reference: [],
    description: "",
    ca_order: 0,
    is_bitwise: 0,
    enum_values: {},
  },
];

export const LocVersion: DBVersion = {
  version: 1,
  fields: locFields,
};

export const schema = wh3Schema;
export const DBNameToDBVersions: Record<string, DBVersion[]> = {};

const vf = (schema as { definitions: any }).definitions as any;
for (const table_name in vf) {
  DBNameToDBVersions[table_name] = vf[table_name];
}
