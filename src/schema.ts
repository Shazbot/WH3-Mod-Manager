import wh3Schema from "../schema/schema_wh3.json";
import wh2Schema from "../schema/schema_wh2.json";
import threeKingdomsSchema from "../schema/schema_3k.json";
import attilaSchema from "../schema/schema_att.json";
import troySchema from "../schema/schema_troy.json";
import pharaohSchema from "../schema/schema_ph.json";
import dynastiesSchema from "../schema/schema_ph_dyn.json";
import { SCHEMA_FIELD_TYPE, DBFieldName, DBFileName } from "./packFileTypes";
import { SupportedGames } from "./supportedGames";

export interface DBField {
  name: string;
  field_type: SCHEMA_FIELD_TYPE;
  is_key: boolean;
  default_value: string;
  is_filename: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filename_relative_path?: any;
  is_reference: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lookup?: any;
  description: string;
  ca_order: number;
  is_bitwise: number;
  enum_values: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  attila: {},
  troy: {},
  pharaoh: {},
  dynasties: {},
  rome2: {},
};

const orderByVersion = (firstVersion: DBVersion, secondVersion: DBVersion) =>
  secondVersion.version - firstVersion.version;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wh3Definitions = (wh3Schema as { definitions: any }).definitions as any;
for (const table_name in wh3Definitions) {
  DBNameToDBVersions["wh3"][table_name] = wh3Definitions[table_name];
  DBNameToDBVersions["wh3"][table_name].sort(orderByVersion);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wh2Definitions = (wh2Schema as { definitions: any }).definitions as any;
for (const table_name in wh2Definitions) {
  DBNameToDBVersions["wh2"][table_name] = wh2Definitions[table_name];
  DBNameToDBVersions["wh2"][table_name].sort(orderByVersion);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const threeKingdomsDefinitions = (threeKingdomsSchema as { definitions: any }).definitions as any;
for (const table_name in threeKingdomsDefinitions) {
  DBNameToDBVersions["threeKingdoms"][table_name] = threeKingdomsDefinitions[table_name];
  DBNameToDBVersions["threeKingdoms"][table_name].sort(orderByVersion);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const attilaDefinitions = (attilaSchema as { definitions: any }).definitions as any;
for (const table_name in attilaDefinitions) {
  DBNameToDBVersions["attila"][table_name] = attilaDefinitions[table_name];
  DBNameToDBVersions["attila"][table_name].sort(orderByVersion);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const troyDefinitions = (troySchema as { definitions: any }).definitions as any;
for (const table_name in troyDefinitions) {
  DBNameToDBVersions["troy"][table_name] = troyDefinitions[table_name];
  DBNameToDBVersions["troy"][table_name].sort(orderByVersion);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pharaohDefinitions = (pharaohSchema as { definitions: any }).definitions as any;
for (const table_name in pharaohDefinitions) {
  DBNameToDBVersions["pharaoh"][table_name] = pharaohDefinitions[table_name];
  DBNameToDBVersions["pharaoh"][table_name].sort(orderByVersion);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynastiesDefinitions = (dynastiesSchema as { definitions: any }).definitions as any;
for (const table_name in dynastiesDefinitions) {
  DBNameToDBVersions["dynasties"][table_name] = dynastiesDefinitions[table_name];
  DBNameToDBVersions["dynasties"][table_name].sort(orderByVersion);
}

// gameToReferences stores all the tables and their keys that are referenced by at least 1 other table field
// these are all the fields that are BEING referenced by other fields
// for example:
// {
//   "wh3": {
//     "agent_ability_categories_tables": ["category"],
//     "unit_abilities_tables": ["key"],
// ...

export const gameToReferences: Record<SupportedGames, Record<string, string[]>> = {
  wh3: {},
  wh2: {},
  threeKingdoms: {},
  attila: {},
  troy: {},
  pharaoh: {},
  dynasties: {},
  rome2: {},
};
for (const [gameName, tableVersions] of Object.entries(DBNameToDBVersions)) {
  for (const versions of Object.values(tableVersions)) {
    for (const version of versions) {
      for (const field of version.fields) {
        if (field.is_reference) {
          const dbFileNameRef = `${field.is_reference[0]}_tables`;
          const dbFieldNameRef = field.is_reference[1];

          // if a table is referenced but doesn't have a schema skip it
          if (!tableVersions[dbFileNameRef]) {
            // if (gameName == "wh3") console.log("REFERENCED TABLE DOESN'T EXIST:", dbFileNameRef);
            continue;
          }

          gameToReferences[gameName as SupportedGames][dbFileNameRef] =
            gameToReferences[gameName as SupportedGames][dbFileNameRef] || [];

          if (!gameToReferences[gameName as SupportedGames][dbFileNameRef].includes(dbFieldNameRef))
            gameToReferences[gameName as SupportedGames][dbFileNameRef].push(dbFieldNameRef);
        }
      }
    }
  }
}

// gameToDBFieldsThatReference stores all the tables and their keys that reference another table field
// these are all the fields that are DOING THE REFERENCING
// for example:
// {
//   "wh3": {
//     "abilities_tables": { "category": ["agent_ability_categories_tables", "category"] },
//     "ability_to_ui_collection_junctions_tables": {
//       "ability": ["unit_abilities_tables", "key"],
//       "collection": ["ability_ui_collections_tables", "ability_collection"]
//     },
//     "achievement_agent_condition_junctions_tables": {
//       "achievement_key": ["achievements_tables", "key"],
//       "condition_key": ["agent_conditions_tables", "condition_key"]
//     },

export const gameToDBFieldsThatReference: Record<
  SupportedGames,
  Record<DBFileName, Record<DBFieldName, string[]>>
> = {
  wh3: {},
  wh2: {},
  threeKingdoms: {},
  attila: {},
  troy: {},
  pharaoh: {},
  dynasties: {},
  rome2: {},
};
for (const [gameName, tableVersions] of Object.entries(DBNameToDBVersions)) {
  for (const [tableName, versions] of Object.entries(tableVersions)) {
    for (const version of versions.toReversed()) {
      for (const field of version.fields) {
        if (field.is_reference) {
          const dbFileNameRef = `${field.is_reference[0]}_tables`;
          const dbFieldNameRef = field.is_reference[1];

          // if a table is referenced but doesn't have a schema skip it
          if (!tableVersions[dbFileNameRef]) {
            // if (gameName == "wh3") console.log("REFERENCED TABLE DOESN'T EXIST:", dbFileNameRef);
            continue;
          }

          gameToDBFieldsThatReference[gameName as SupportedGames][tableName] =
            gameToDBFieldsThatReference[gameName as SupportedGames][tableName] || {};
          gameToDBFieldsThatReference[gameName as SupportedGames][tableName][field.name] = [
            dbFileNameRef,
            dbFieldNameRef,
          ];
        }
      }
    }
  }
}

export const gameToTablesWithNumericIds: Record<SupportedGames, Record<DBFileName, DBFieldName>> = {
  wh3: {},
  wh2: {},
  threeKingdoms: {},
  attila: {},
  troy: {},
  pharaoh: {},
  dynasties: {},
  rome2: {},
};
gameToTablesWithNumericIds.wh3 = {
  //main_units_tables: "", // unused by the game
  warscape_animated_lod_tables: "key",
  culture_settlement_occupation_options_tables: "id",
  campaign_post_battle_captive_options_tables: "id",
  technologies_tables: "unique_index",
  building_units_allowed_tables: "key",
  mercenary_pool_to_groups_junctions_tables: "key",
  faction_set_items_tables: "id",
  campaign_character_arts_tables: "id",
  cdir_events_mission_option_junctions_tables: "id",
  cdir_events_mission_payloads_tables: "id",
  cdir_events_incident_option_junctions_tables: "id",
  cdir_events_incident_payloads_tables: "id",
  cdir_events_dilemma_option_junctions_tables: "id",
  cdir_events_dilemma_payloads_tables: "id",
  army_special_abilities_tables: "unique_id",
  unit_special_abilities_tables: "unique_id",
  campaign_building_level_factorial_effect_junctions_tables: "key",
  campaign_agent_subtype_factorial_effect_junctions_tables: "key",
  armed_citizenry_units_to_unit_groups_junctions_tables: "id",
  building_level_armed_citizenry_junctions_tables: "id",
  slot_set_items_tables: "id",
  names_tables: "id",
  ritual_payload_spawn_mercenaries_tables: "id",
  // battle_set_piece_armies_tables: "", // ref to campaign_character_arts/id
  // units_custom_battle_types_to_factions_tables: "", // ref to units_custom_battle_types/id
  units_custom_battle_types_tables: "id",
  building_chain_availabilities_tables: "id",
  campaign_group_post_battle_casualty_resources_tables: "id",
};

// check gameToTablesWithNumericIds.wh3 tables and keys exist
const wh3DBNameToDBVersions = DBNameToDBVersions.wh3;
for (const [tableName, fieldName] of Object.entries(gameToTablesWithNumericIds.wh3)) {
  const DBVersions = wh3DBNameToDBVersions[tableName];
  if (!DBVersions) {
    console.log("gameToTablesWithNumericIds: TABLE", tableName, "DOESN'T HAVE SCHEMA");
    continue;
  }

  let exists = false;
  for (const version of DBVersions) {
    if (version.fields.find((field) => field.name == fieldName)) {
      exists = true;
      break;
    }
  }
  if (!exists) {
    console.log("gameToTablesWithNumericIds: TABLE", tableName, "DOESN'T HAVE FIELD", fieldName);
  }
}

for (const [gameName, tableVersions] of Object.entries(DBNameToDBVersions)) {
  for (const versions of Object.values(tableVersions)) {
    for (const version of versions) {
      for (const field of version.fields) {
        if (field.is_reference && field.is_reference.length > 0) {
          field.is_reference[0] = `${field.is_reference[0]}_tables`;
        }
      }
    }
  }
}

// import * as fs from "fs";
// fs.writeFileSync("dumps/gameToReferences.json", JSON.stringify(gameToReferences));
// fs.writeFileSync("dumps/gameToDBFieldsThatReference.json", JSON.stringify(gameToDBFieldsThatReference));
