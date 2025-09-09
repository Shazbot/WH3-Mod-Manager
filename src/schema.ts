// Schema files are now loaded lazily on-demand
import { DBFieldName, DBFileName, DBVersion } from "./packFileTypes";
import { SupportedGames } from "./supportedGames";
import { perfMonitor } from "./utility/performanceMonitor";
import { decompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as path from "path";

// Schema cache to avoid reloading
const schemaCache = new Map<SupportedGames, any>();
const processedSchemasCache = new Map<SupportedGames, Record<string, DBVersion[]>>();
const processedReferencesExtension = new Map<SupportedGames, boolean>();

// Promise caches to prevent concurrent duplicate requests
const schemaLoadingPromises = new Map<SupportedGames, Promise<any>>();
const schemaProcessingPromises = new Map<SupportedGames, Promise<Record<string, DBVersion[]>>>();
const referencesProcessingPromises = new Map<SupportedGames, Promise<void>>();
const dbFieldsProcessingPromises = new Map<SupportedGames, Promise<void>>();
const dbFieldsReferencedByProcessingPromises = new Map<SupportedGames, Promise<void>>();

export const DBNameToDBVersions: Record<SupportedGames, Record<string, DBVersion[]>> = {
  wh2: {},
  wh3: {},
  threeKingdoms: {},
  attila: {},
  troy: {},
  pharaoh: {},
  dynasties: {},
  rome2: {},
  shogun2: {},
};

const orderByVersion = (firstVersion: DBVersion, secondVersion: DBVersion) =>
  secondVersion.version - firstVersion.version;

// Schema loading functions
const getSchemaFileName = (game: SupportedGames): string => {
  const schemaMap: Record<SupportedGames, string> = {
    wh3: "schema_wh3.json.zst",
    wh2: "schema_wh2.json.zst",
    threeKingdoms: "schema_3k.json.zst",
    attila: "schema_att.json.zst",
    troy: "schema_troy.json.zst",
    pharaoh: "schema_ph.json.zst",
    dynasties: "schema_ph_dyn.json.zst",
    rome2: "schema_rome2.json.zst",
    shogun2: "schema_sho2.json.zst",
  };
  return schemaMap[game];
};

const loadSchemaForGame = async (game: SupportedGames): Promise<any> => {
  if (schemaCache.has(game)) {
    return schemaCache.get(game);
  }

  // Check if there's already a loading promise for this game
  if (schemaLoadingPromises.has(game)) {
    return schemaLoadingPromises.get(game);
  }

  const startTime = performance.now();
  const loadingPromise = (async () => {
    try {
      const schemaFileName = getSchemaFileName(game);
      const compressedBuffer = fs.readFileSync(path.join(__dirname, `../schema/${schemaFileName}`));

      const decompressedBuffer = await decompress(compressedBuffer);

      // Parse JSON from decompressed buffer
      const schemaData = JSON.parse(Buffer.from(decompressedBuffer).toString("utf8"));

      schemaCache.set(game, schemaData);
      perfMonitor.trackSchemaLoad(game, startTime);
      return schemaData;
    } catch (error) {
      console.log(`Failed to load schema for game ${game}:`, error);
      return { definitions: {} };
    } finally {
      // Clean up the promise from the map once it's resolved
      schemaLoadingPromises.delete(game);
    }
  })();

  schemaLoadingPromises.set(game, loadingPromise);
  return loadingPromise;
};

const processSchemaForGame = async (game: SupportedGames): Promise<Record<string, DBVersion[]>> => {
  if (processedSchemasCache.has(game)) {
    return processedSchemasCache.get(game)!;
  }

  // Check if there's already a processing promise for this game
  if (schemaProcessingPromises.has(game)) {
    return schemaProcessingPromises.get(game)!;
  }

  const processingPromise = (async () => {
    try {
      const schema = await loadSchemaForGame(game);
      const definitions = (schema as { definitions: any }).definitions as any;
      const processedSchema: Record<string, DBVersion[]> = {};

      for (const table_name in definitions) {
        processedSchema[table_name] = definitions[table_name];
        processedSchema[table_name].sort(orderByVersion);
      }

      processedSchemasCache.set(game, processedSchema);
      DBNameToDBVersions[game] = processedSchema;

      // imported is_reference[0] is for example "building_levels", we make it "building_levels_tables"
      for (const versions of Object.values(DBNameToDBVersions[game])) {
        for (const version of versions) {
          for (const field of version.fields) {
            if (field.is_reference && field.is_reference.length > 0) {
              field.is_reference[0] = `${field.is_reference[0]}_tables`;
            }
          }
        }
      }
      return processedSchema;
    } finally {
      // Clean up the promise from the map once it's resolved
      schemaProcessingPromises.delete(game);
    }
  })();

  schemaProcessingPromises.set(game, processingPromise);
  return processingPromise;
};

// Initialize schema for a game lazily
export const initializeSchemaForGame = async (game: SupportedGames): Promise<void> => {
  if (Object.keys(DBNameToDBVersions[game]).length === 0) {
    await processSchemaForGame(game);
  }
};

// Get schema data for a specific game (lazy loaded)
export const getSchemaForGame = async (game: SupportedGames): Promise<Record<string, DBVersion[]>> => {
  await initializeSchemaForGame(game);
  return DBNameToDBVersions[game];
};

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
  shogun2: {},
};

const processReferencesForGame = async (game: SupportedGames): Promise<void> => {
  // Check if there's already a processing promise for this game
  if (referencesProcessingPromises.has(game)) {
    return referencesProcessingPromises.get(game)!;
  }

  const processingPromise = (async () => {
    try {
      const tableVersions = await getSchemaForGame(game);

      for (const versions of Object.values(tableVersions)) {
        for (const version of versions) {
          for (const field of version.fields) {
            if (field.is_reference) {
              const dbFileNameRef = field.is_reference[0];
              const dbFieldNameRef = field.is_reference[1];

              if (!tableVersions[dbFileNameRef]) {
                continue;
              }

              gameToReferences[game][dbFileNameRef] = gameToReferences[game][dbFileNameRef] || [];

              if (!gameToReferences[game][dbFileNameRef].includes(dbFieldNameRef))
                gameToReferences[game][dbFileNameRef].push(dbFieldNameRef);
            }
          }
        }
      }
    } finally {
      // Clean up the promise from the map once it's resolved
      referencesProcessingPromises.delete(game);
    }
  })();

  referencesProcessingPromises.set(game, processingPromise);
  return processingPromise;
};

export const getReferencesForGame = async (game: SupportedGames): Promise<Record<string, string[]>> => {
  if (Object.keys(gameToReferences[game]).length === 0) {
    await processReferencesForGame(game);
  }
  return gameToReferences[game];
};

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
  shogun2: {},
};

const processDBFieldsThatReferenceForGame = async (game: SupportedGames): Promise<void> => {
  // Check if there's already a processing promise for this game
  if (dbFieldsProcessingPromises.has(game)) {
    return dbFieldsProcessingPromises.get(game)!;
  }

  const processingPromise = (async () => {
    try {
      const tableVersions = await getSchemaForGame(game);

      for (const [tableName, versions] of Object.entries(tableVersions)) {
        for (const version of versions.toReversed()) {
          for (const field of version.fields) {
            if (field.is_reference) {
              const dbFileNameRef = field.is_reference[0];
              const dbFieldNameRef = field.is_reference[1];

              if (!tableVersions[dbFileNameRef]) {
                continue;
              }

              gameToDBFieldsThatReference[game][tableName] =
                gameToDBFieldsThatReference[game][tableName] || {};
              gameToDBFieldsThatReference[game][tableName][field.name] = [dbFileNameRef, dbFieldNameRef];
            }
          }
        }
      }
    } finally {
      // Clean up the promise from the map once it's resolved
      dbFieldsProcessingPromises.delete(game);
    }
  })();

  dbFieldsProcessingPromises.set(game, processingPromise);
  return processingPromise;
};

export const getDBFieldsThatReferenceForGame = async (
  game: SupportedGames
): Promise<Record<DBFileName, Record<DBFieldName, string[]>>> => {
  if (Object.keys(gameToDBFieldsThatReference[game]).length === 0) {
    await processDBFieldsThatReferenceForGame(game);
  }
  return gameToDBFieldsThatReference[game];
};

export const gameToDBFieldsReferencedBy: Record<
  SupportedGames,
  Record<DBFileName, Record<DBFieldName, string[][]>>
> = {
  wh3: {},
  wh2: {},
  threeKingdoms: {},
  attila: {},
  troy: {},
  pharaoh: {},
  dynasties: {},
  rome2: {},
  shogun2: {},
};

const processDBFieldsReferencedByForGame = async (game: SupportedGames): Promise<void> => {
  // Check if there's already a processing promise for this game
  if (dbFieldsReferencedByProcessingPromises.has(game)) {
    return dbFieldsReferencedByProcessingPromises.get(game)!;
  }

  const processingPromise = (async () => {
    try {
      const dbFieldsThatReference = await getDBFieldsThatReferenceForGame(game);

      for (const [tableName, dbFieldToReference] of Object.entries(dbFieldsThatReference)) {
        for (const [dbFieldName, references] of Object.entries(dbFieldToReference)) {
          const [referencedTableName, referencedFieldName] = references;
          gameToDBFieldsReferencedBy[game][referencedTableName] =
            gameToDBFieldsReferencedBy[game][referencedTableName] || {};

          if (!gameToDBFieldsReferencedBy[game][referencedTableName][referencedFieldName])
            gameToDBFieldsReferencedBy[game][referencedTableName][referencedFieldName] = [];

          if (
            !gameToDBFieldsReferencedBy[game][referencedTableName][referencedFieldName].some(
              (reference) => reference[0] == tableName && reference[1] == dbFieldName
            )
          ) {
            gameToDBFieldsReferencedBy[game][referencedTableName][referencedFieldName].push([
              tableName,
              dbFieldName,
            ]);
          }
        }
      }
    } finally {
      // Clean up the promise from the map once it's resolved
      dbFieldsReferencedByProcessingPromises.delete(game);
    }
  })();

  dbFieldsReferencedByProcessingPromises.set(game, processingPromise);
  return processingPromise;
};

export const getDBFieldsReferencedByForGame = async (
  game: SupportedGames
): Promise<Record<DBFileName, Record<DBFieldName, string[][]>>> => {
  if (Object.keys(gameToDBFieldsReferencedBy[game]).length === 0) {
    await processDBFieldsReferencedByForGame(game);
  }
  return gameToDBFieldsReferencedBy[game];
};

export const gameToTablesWithNumericIds: Record<SupportedGames, Record<DBFileName, DBFieldName>> = {
  wh3: {},
  wh2: {},
  threeKingdoms: {},
  attila: {},
  troy: {},
  pharaoh: {},
  dynasties: {},
  rome2: {},
  shogun2: {},
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

// Validation function for numeric ID tables
export const validateNumericIdTablesForGame = async (game: SupportedGames): Promise<void> => {
  const gameNumericTables = gameToTablesWithNumericIds[game];
  if (!gameNumericTables || Object.keys(gameNumericTables).length === 0) {
    return;
  }

  const dbNameToDBVersions = await getSchemaForGame(game);

  for (const [tableName, fieldName] of Object.entries(gameNumericTables)) {
    const DBVersions = dbNameToDBVersions[tableName];
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
};

// Process reference field names for a specific game
// const processReferenceFieldNames = async (game: SupportedGames): Promise<void> => {
//   if (processedReferencesExtension.get(game)) return;
//   processedReferencesExtension.set(game, true);

//   const tableVersions = await getSchemaForGame(game);

//   for (const versions of Object.values(tableVersions)) {
//     for (const version of versions) {
//       for (const field of version.fields) {
//         if (field.is_reference && field.is_reference.length > 0) {
//           field.is_reference[0] = `${field.is_reference[0]}_tables`;
//         }
//       }
//     }
//   }
// };

// Initialize all schema processing for a game
export const initializeAllSchemaForGame = async (game: SupportedGames): Promise<void> => {
  await initializeSchemaForGame(game);
  // await processReferenceFieldNames(game);
  await processReferencesForGame(game);
  await processDBFieldsThatReferenceForGame(game);
  await processDBFieldsReferencedByForGame(game);
  await validateNumericIdTablesForGame(game);
};

// Preload schema for specific games (call this for commonly used games)
export const preloadSchemaForGames = async (games: SupportedGames[]): Promise<void> => {
  const promises = games.map((game) => initializeAllSchemaForGame(game));
  await Promise.all(promises);
};

// Clear schema cache (useful for testing or memory management)
export const clearSchemaCache = (): void => {
  schemaCache.clear();
  processedSchemasCache.clear();
  processedReferencesExtension.clear();

  // Clear promise caches to prevent stale promises
  schemaLoadingPromises.clear();
  schemaProcessingPromises.clear();
  referencesProcessingPromises.clear();
  dbFieldsProcessingPromises.clear();
  dbFieldsReferencedByProcessingPromises.clear();

  // Reset all game schema objects
  Object.keys(DBNameToDBVersions).forEach((game) => {
    DBNameToDBVersions[game as SupportedGames] = {};
    gameToReferences[game as SupportedGames] = {};
    gameToDBFieldsThatReference[game as SupportedGames] = {};
    gameToDBFieldsReferencedBy[game as SupportedGames] = {};
  });
};

// Get cache status for debugging
export const getSchemaCacheStatus = (): {
  loadedGames: SupportedGames[];
  cacheSize: number;
} => {
  return {
    loadedGames: Array.from(schemaCache.keys()),
    cacheSize: schemaCache.size,
  };
};

export const tablesToIgnore = [
  "main_unit_ownership_content_pack_junctions_tables",
  "allied_recruitment_core_units_tables",
  "agent_subtype_ownership_content_pack_junctions_tables",
];

// import * as fs from "fs";
// fs.writeFileSync("dumps/gameToReferences.json", JSON.stringify(gameToReferences));
// fs.writeFileSync("dumps/gameToDBFieldsThatReference.json", JSON.stringify(gameToDBFieldsThatReference));
