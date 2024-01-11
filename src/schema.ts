import * as wh3Schema from "../schema/schema_wh3.json";
import * as wh2Schema from "../schema/schema_wh2.json";
import * as threeKingdomsSchema from "../schema/schema_3k.json";
import { SCHEMA_FIELD_TYPE } from "./packFileTypes";
import { SupportedGames } from "./supportedGames";

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

export const DBNameToDBVersions: Record<SupportedGames, Record<string, DBVersion[]>> = {
  wh2: {},
  wh3: {},
  threeKingdoms: {},
};

const wh3Definitions = (wh3Schema as { definitions: any }).definitions as any;
for (const table_name in wh3Definitions) {
  DBNameToDBVersions["wh3"][table_name] = wh3Definitions[table_name];
}

const wh2Definitions = (wh2Schema as { definitions: any }).definitions as any;
for (const table_name in wh2Definitions) {
  DBNameToDBVersions["wh2"][table_name] = wh2Definitions[table_name];
}

const threeKingdomsDefinitions = (threeKingdomsSchema as { definitions: any }).definitions as any;
for (const table_name in threeKingdomsDefinitions) {
  DBNameToDBVersions["threeKingdoms"][table_name] = threeKingdomsDefinitions[table_name];
}
