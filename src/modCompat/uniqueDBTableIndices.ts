import bs from "binary-search";
import appData from "../appData";
import { resolveKeyValue } from "../packFileSerializer";
import {
  DBFileName,
  UniqueId,
  Pack,
  DBVersion,
  SchemaField,
  PackName,
  UniqueIdsCollision,
} from "../packFileTypes";
import { gameToTablesWithNumericIds } from "../schema";
import { getDBSubnameFromString } from "../utility/packFileHelpers";
import { collator } from "../utility/packFileSorting";

export const packToTablesWithUniqueIds: Record<string, Record<DBFileName, UniqueId[]>> = {};

export const emptyPackToTablesWithUniqueIds = () => {
  for (const packName of Object.keys(packToTablesWithUniqueIds)) {
    delete packToTablesWithUniqueIds[packName];
  }
};

export function appendToUniqueIdKeysRegistry(
  pack: Pack,
  packFileName: string,
  dbName: string,
  dbversion: DBVersion,
  chunkedSchemaIntoRows: SchemaField[][]
) {
  if (appData.currentGame != "wh3") return;

  const tableToFieldName = gameToTablesWithNumericIds[appData.currentGame];

  const fieldName = tableToFieldName[dbName];
  if (!fieldName) return;

  const dbField = dbversion.fields.find((field) => field.name == fieldName);
  if (!dbField) return;

  const fieldIndex = dbversion.fields.indexOf(dbField);

  for (const row of chunkedSchemaIntoRows) {
    const resolvedKeyValue = resolveKeyValue(dbField.field_type, row[fieldIndex].fields);
    packToTablesWithUniqueIds[pack.name] = packToTablesWithUniqueIds[pack.name] || {};
    packToTablesWithUniqueIds[pack.name][dbName] = packToTablesWithUniqueIds[pack.name][dbName] || [];

    const tableRow: string[] = [];
    for (let i = 0; i < row.length; i++) {
      const field = row[i];
      const dbField = dbversion.fields[i];
      tableRow.push(resolveKeyValue(dbField.field_type, field.fields));
    }

    packToTablesWithUniqueIds[pack.name][dbName].push({
      value: resolvedKeyValue,
      tableRow,
      packFileName: getDBSubnameFromString(packFileName) || "",
      packName: pack.name,
    });
  }
}

export function processDuplicateKeysInSameTable(
  tableName: string,
  keyValues: UniqueId[],
  currentGameToTablesWithNumericIds: Record<string, string>,
  packName: string,
  uniqueIdsCollisions: Record<PackName, UniqueIdsCollision[]>
) {
  // CA pack has duplicates here, ignore them
  if (packName == "db.pack" && tableName == "technologies_tables") return;

  // compare for duplicate keys in the same pack
  for (let i = 0; i < keyValues.length - 1; i++) {
    if (keyValues[i].value == keyValues[i + 1].value) {
      const newUniqueIdsCollision = {
        tableName,
        fieldName: currentGameToTablesWithNumericIds[tableName],
        value: keyValues[i],
        firstPackName: packName,
        valueTwo: keyValues[i + 1],
      } as UniqueIdsCollision;
      if (
        !uniqueIdsCollisions[packName].find(
          (collision) =>
            collision.value.value == newUniqueIdsCollision.value.value &&
            collision.value.packFileName == newUniqueIdsCollision.value.packFileName &&
            collision.fieldName == newUniqueIdsCollision.fieldName &&
            collision.tableName == newUniqueIdsCollision.tableName &&
            collision.firstPackName == newUniqueIdsCollision.firstPackName &&
            collision.secondPackName == newUniqueIdsCollision.secondPackName
        )
      ) {
        uniqueIdsCollisions[packName].push(newUniqueIdsCollision);
      }
    }
  }
}

export function processPackToTablesWithUniqueIds() {
  const currentGameToTablesWithNumericIds = gameToTablesWithNumericIds[appData.currentGame];

  const packToTablesWithUniqueIdsSortedKeys = Object.keys(packToTablesWithUniqueIds);
  packToTablesWithUniqueIdsSortedKeys.sort((a, b) => collator.compare(a, b));

  // sort all the key values first
  for (let packIndex = 0; packIndex < packToTablesWithUniqueIdsSortedKeys.length; packIndex++) {
    const packName = packToTablesWithUniqueIdsSortedKeys[packIndex];
    for (const keyValues of Object.values(packToTablesWithUniqueIds[packName])) {
      keyValues.sort((a, b) => collator.compare(a.value, b.value));
    }
  }

  const uniqueIdsCollisions: Record<PackName, UniqueIdsCollision[]> = {};
  for (let packOneIndex = 0; packOneIndex < packToTablesWithUniqueIdsSortedKeys.length; packOneIndex++) {
    const packName = packToTablesWithUniqueIdsSortedKeys[packOneIndex];
    uniqueIdsCollisions[packName] = uniqueIdsCollisions[packName] || [];
    for (const [tableName, keyValues] of Object.entries(packToTablesWithUniqueIds[packName])) {
      processDuplicateKeysInSameTable(
        tableName,
        keyValues,
        currentGameToTablesWithNumericIds,
        packName,
        uniqueIdsCollisions
      );

      for (
        let packTwoIndex = packOneIndex + 1;
        packTwoIndex < packToTablesWithUniqueIdsSortedKeys.length;
        packTwoIndex++
      ) {
        const packTWoName = packToTablesWithUniqueIdsSortedKeys[packTwoIndex];
        uniqueIdsCollisions[packTWoName] = uniqueIdsCollisions[packTWoName] || [];

        const keyValuesInPackTwo = packToTablesWithUniqueIds[packTWoName][tableName];
        if (keyValuesInPackTwo) {
          const keyValuesToSearch =
            keyValues.length < keyValuesInPackTwo.length ? keyValues : keyValuesInPackTwo;
          const keyValuesToSearchOther =
            keyValues.length < keyValuesInPackTwo.length ? keyValuesInPackTwo : keyValues;

          for (let i = 0; i < keyValuesToSearch.length; i++) {
            // if it's a duplicates value skip it
            if (
              i + 1 < keyValuesToSearch.length &&
              keyValuesToSearch[i].value == keyValuesToSearch[i + 1].value
            )
              continue;

            const keyValuesOtherIndex = bs(
              keyValuesToSearchOther,
              keyValuesToSearch[i],
              (a: UniqueId, b: UniqueId) => collator.compare(a.value, b.value)
            );
            if (keyValuesOtherIndex > -1) {
              const newUniqueIdsCollision = {
                tableName,
                fieldName: currentGameToTablesWithNumericIds[tableName],
                value: keyValuesToSearch[i],
                valueTwo: keyValuesToSearchOther[keyValuesOtherIndex],
                firstPackName: packName,
                secondPackName: packTWoName,
              } as UniqueIdsCollision;
              if (
                !uniqueIdsCollisions[packName].find(
                  (collision) =>
                    collision.value.value == newUniqueIdsCollision.value.value &&
                    collision.fieldName == newUniqueIdsCollision.fieldName &&
                    collision.tableName == newUniqueIdsCollision.tableName &&
                    collision.firstPackName == newUniqueIdsCollision.firstPackName &&
                    collision.secondPackName == newUniqueIdsCollision.secondPackName
                )
              ) {
                uniqueIdsCollisions[packName].push(newUniqueIdsCollision);
                uniqueIdsCollisions[packTWoName].push(newUniqueIdsCollision);
              }
            }
          }
        }
      }
    }
  }

  return uniqueIdsCollisions;
}
