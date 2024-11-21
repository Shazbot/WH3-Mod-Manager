import { diff } from "deep-object-diff";
import appData from "../appData";
import { getDBVersionByTableName, resolveKeyValue, chunkSchemaIntoRows } from "../packFileSerializer";
import { Pack, PackTableReferences, PackName, DBRefOrigin, DBField } from "../packFileTypes";
import { gameToReferences, gameToDBFieldsThatReference, DBNameToDBVersions } from "../schema";
import { getDBName } from "../utility/packFileHelpers";
import { binarySearchIncludes, insertIntoPresortedArray } from "../utility/packFileSorting";
import { appendScriptToFileChecksRegistry, appendToFileChecksRegistry } from "./fileSyntaxChecks";
import { appendToAddListenerRegistry } from "./scriptFileListenerNames";
import { appendToUniqueIdKeysRegistry } from "./uniqueDBTableIndices";
import equals from "fast-deep-equal";
import * as fs from "fs";

export const refSorting = (a: DBRefOrigin, b: DBRefOrigin): number => {
  const f = a.targetDBFileName.localeCompare(b.targetDBFileName);
  if (f !== 0) return f;
  const c = a.targetFieldName.localeCompare(b.targetFieldName);
  if (c !== 0) return c;
  const e = a.value.localeCompare(b.value);
  if (e !== 0) return e;
  const d = a.originFieldName.localeCompare(b.originFieldName);
  if (d !== 0) return d;
  const g = a.originDBFileName.localeCompare(b.originDBFileName);
  if (g !== 0) return d;
  return a.originFileSuffix.localeCompare(b.originFileSuffix);
};

export function findPackTableReferencesOptimized(packsData: Pack[], onPackChecked?: OnPackChecked) {
  const packsTableReferences: Record<string, PackTableReferences> = {};
  console.time("findPackTableReferencesOptimized");
  const tablesToReferenceFieldNames = gameToReferences[appData.currentGame];
  const tablesAndDBFieldsThatReference = gameToDBFieldsThatReference[appData.currentGame];

  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    if (onPackChecked) onPackChecked(i, packsData.length - 1, pack.name, "", "MissingKeys");
    const packTableReferences: PackTableReferences = { ownKeys: {}, refs: {}, refOrigins: {} };
    packsTableReferences[pack.name] = packTableReferences;

    for (const packFile of pack.packedFiles) {
      if (packFile.name.endsWith(".lua") && packFile.text) {
        appendToAddListenerRegistry(pack, packFile.name, packFile.text);
        appendScriptToFileChecksRegistry(pack, packFile);
      }

      if (
        (packFile.name.endsWith(".xml") ||
          packFile.name.endsWith(".xml.material") ||
          packFile.name.endsWith(".variantmeshdefinition") ||
          packFile.name.endsWith(".wsmodel")) &&
        packFile.text
      ) {
        appendToFileChecksRegistry(pack, packFile);
      }

      if (!packFile.schemaFields) {
        continue;
      }

      try {
        const dbName = getDBName(packFile);
        if (!dbName) {
          console.log("findPackTableReferences: cannot find db name for", packFile.name);
          continue;
        }

        const dbversion = getDBVersionByTableName(packFile, dbName);

        if (!dbversion) {
          console.log("findPackTableReferences: cannot find dbversion for", packFile.name);
          continue;
        }

        const chunkedSchemaIntoRows = chunkSchemaIntoRows(packFile.schemaFields || [], dbversion);

        appendToUniqueIdKeysRegistry(pack, packFile.name, dbName, dbversion, chunkedSchemaIntoRows);

        for (let i = 0; i < chunkedSchemaIntoRows.length; i++) {
          for (let j = 0; j < chunkedSchemaIntoRows[i].length; j++) {
            const dbField = dbversion.fields[j];
            if (
              tablesToReferenceFieldNames[dbName] &&
              tablesToReferenceFieldNames[dbName].includes(dbField.name)
            ) {
              packTableReferences.ownKeys[dbName] = packTableReferences.ownKeys[dbName] || {};
              packTableReferences.ownKeys[dbName][dbField.name] =
                packTableReferences.ownKeys[dbName][dbField.name] || [];

              const resolvedKeyValue = resolveKeyValue(
                dbField.field_type,
                chunkedSchemaIntoRows[i][j].fields
              );

              if (
                resolvedKeyValue != "" &&
                !binarySearchIncludes(packTableReferences.ownKeys[dbName][dbField.name], resolvedKeyValue)
              )
                packTableReferences.ownKeys[dbName][dbField.name] = insertIntoPresortedArray(
                  packTableReferences.ownKeys[dbName][dbField.name],
                  resolvedKeyValue
                );
            }

            if (
              // don't build refs for vanilla Packs
              !appData.vanillaPacks.some((vanillaPack) => vanillaPack.name == pack.name) &&
              tablesAndDBFieldsThatReference[dbName] &&
              tablesAndDBFieldsThatReference[dbName][dbField.name]
            ) {
              const [dbNameReferenceTo, dbFieldNameReferenceTo] =
                tablesAndDBFieldsThatReference[dbName][dbField.name];
              packTableReferences.refs[dbNameReferenceTo] = packTableReferences.refs[dbNameReferenceTo] || {};
              packTableReferences.refs[dbNameReferenceTo][dbFieldNameReferenceTo] =
                packTableReferences.refs[dbNameReferenceTo][dbFieldNameReferenceTo] || [];

              let resolvedKeyValue = "";
              try {
                resolvedKeyValue = resolveKeyValue(dbField.field_type, chunkedSchemaIntoRows[i][j].fields);
              } catch (e) {
                console.log(dbField);
                console.log(
                  pack.name,
                  packFile.name,
                  dbName,
                  dbField.name,
                  chunkedSchemaIntoRows[i][j].fields
                );
                continue;
                // throw e;
              }

              if (resolvedKeyValue != "")
                if (binarySearchIncludes(appData.vanillaPacksDBFileNames, dbNameReferenceTo)) {
                  // if it's an Assembly Kit table ignore it
                  if (
                    !binarySearchIncludes(
                      packTableReferences.refs[dbNameReferenceTo][dbFieldNameReferenceTo],
                      resolvedKeyValue
                    )
                  )
                    packTableReferences.refs[dbNameReferenceTo][dbFieldNameReferenceTo] =
                      insertIntoPresortedArray(
                        packTableReferences.refs[dbNameReferenceTo][dbFieldNameReferenceTo],
                        resolvedKeyValue
                      );

                  const newRefOrigin = {
                    originDBFileName: dbName,
                    targetDBFileName: dbNameReferenceTo,
                    value: resolvedKeyValue,
                    originFieldName: dbField.name,
                    targetFieldName: dbFieldNameReferenceTo,
                    originFileSuffix: packFile.name,
                  };

                  packTableReferences.refOrigins[dbNameReferenceTo] =
                    packTableReferences.refOrigins[dbNameReferenceTo] || [];

                  if (
                    !packTableReferences.refOrigins[dbNameReferenceTo].some(
                      (refOrigin) =>
                        refOrigin.originDBFileName === newRefOrigin.originDBFileName &&
                        refOrigin.targetDBFileName === newRefOrigin.targetDBFileName &&
                        refOrigin.value === newRefOrigin.value &&
                        refOrigin.originFieldName === newRefOrigin.originFieldName &&
                        refOrigin.targetFieldName === newRefOrigin.targetFieldName &&
                        refOrigin.originFileSuffix === newRefOrigin.originFileSuffix
                    )
                  )
                    packTableReferences.refOrigins[dbNameReferenceTo].push(newRefOrigin);
                } else {
                  // console.log("NOT IN VANILLA PACKS:", dbNameReferenceTo);
                }
            }
          }
        }

        // console.log("FOUND CONFLICT");
        // console.log(pack.name, packTwo.name, packFile.name, packTwoFile.name, v1);
      } catch (e) {
        console.log(e);
      }
    }
  }

  const foundMissingRefs: Record<PackName, DBRefOrigin[]> = {};
  for (const [packName, packTableReferences] of Object.entries(packsTableReferences)) {
    // don't check vanilla packs for missing refs
    if (appData.vanillaPacks.some((vanillaPack) => vanillaPack.name == packName)) continue;

    for (const [dbFileName, dbFieldNameToRefKeys] of Object.entries(packTableReferences.refs)) {
      for (const [dbFieldName, refKeys] of Object.entries(dbFieldNameToRefKeys)) {
        let reference: DBField | undefined = undefined;
        // console.log("dbFileName:", dbFileName);
        for (const version of DBNameToDBVersions[appData.currentGame][dbFileName]) {
          reference = version.fields.find((field) => field.name == dbFieldName);
          if (reference) break;
        }
        if (!reference) {
          console.log("couldn't find reference for", dbFileName, dbFieldName);
          continue;
        }

        // console.log("dbFieldName is", dbFieldName);
        // console.log("ref is", reference.is_reference);
        const dbFileNameToSearch = dbFileName;
        const dbFieldNameToSearch = dbFieldName;

        // console.log("searching for", dbFileNameToSearch, dbFieldNameToSearch);

        // if it's an Assembly Kit table ignore it
        if (!binarySearchIncludes(appData.vanillaPacksDBFileNames, dbFileNameToSearch)) continue;

        for (const refKey of refKeys) {
          let foundRef = false;
          for (const packTableReferenceForRefSearch of Object.values(packsTableReferences)) {
            foundRef =
              packTableReferenceForRefSearch.ownKeys[dbFileNameToSearch] &&
              binarySearchIncludes(
                packTableReferenceForRefSearch.ownKeys[dbFileNameToSearch][dbFieldNameToSearch],
                refKey
              );

            if (foundRef) {
              // console.log(
              //   "FOUND",
              //   packName,
              //   dbFileName,
              //   refKey,
              //   "IN",
              //   dbFileNameToSearch,
              //   dbFieldNameToSearch
              // );
              break;
            }
          }
          if (!foundRef) {
            // console.log(
            //   `DIDN'T FIND ${refKey} IN ${dbFileNameToSearch} ${dbFieldNameToSearch}, source is ${dbFieldName} from ${dbFileName}`
            // );

            if (packTableReferences.refOrigins[dbFileNameToSearch]) {
              const refs = packTableReferences.refOrigins[dbFileNameToSearch].filter(
                (refOrigin) =>
                  refOrigin.targetDBFileName === dbFileNameToSearch &&
                  refOrigin.value === refKey &&
                  refOrigin.targetFieldName === dbFieldNameToSearch
              );
              for (const ref of refs) {
                foundMissingRefs[packName] = foundMissingRefs[packName] || [];
                foundMissingRefs[packName].push(ref);
                // console.log(
                //   `MISSING ${refKey} referenced in ${ref.originDBFileName}, column: ${ref.originFieldName}`
                // );
              }
            }
          }
        }
      }
    }
  }

  console.timeEnd("findPackTableReferencesOptimized");

  return foundMissingRefs;
}

// TEST METHOD, test the optimized algorithm against the unoptimized one to check for equality
export function findPackTableMissingReferencesAndCompareWithUnoptimizedMethod(
  packsData: Pack[],
  onPackChecked?: OnPackChecked
) {
  const missingRefs1 = findPackTableReferences(packsData, onPackChecked);
  const missingRefs2 = findPackTableMissingReferences(packsData, onPackChecked);

  Object.values(missingRefs1).forEach((refs) => refs.sort(refSorting));
  Object.values(missingRefs2).forEach((refs) => refs.sort(refSorting));
  const areEqual = equals(missingRefs1, missingRefs2);
  console.log("missingRefs1 and missingRefs2 EQUAL:", areEqual);
  const diffData = diff(missingRefs1, missingRefs2);
  if (!areEqual) {
    fs.writeFileSync("findPackTableMissingReferences.json", JSON.stringify(diffData));
    fs.writeFileSync("findPackTableMissingReferencesFIRST.json", JSON.stringify(missingRefs1));
    fs.writeFileSync("findPackTableMissingReferencesSECOND.json", JSON.stringify(missingRefs2));
  }
  return missingRefs1;
}

export function findPackTableMissingReferences(packsData: Pack[], onPackChecked?: OnPackChecked) {
  const missingRefs = findPackTableReferencesOptimized(packsData, onPackChecked);

  Object.values(missingRefs).forEach((refs) => refs.sort(refSorting));

  return missingRefs;
}

export function findPackTableReferences(packsData: Pack[], onPackChecked?: OnPackChecked) {
  const packsTableReferences: Record<string, PackTableReferences> = {};
  console.time("packTableReferences");
  const tablesToReferenceFieldNames = gameToReferences[appData.currentGame];
  const tablesAndDBFieldsThatReference = gameToDBFieldsThatReference[appData.currentGame];

  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    const packTableReferences: PackTableReferences = { ownKeys: {}, refs: {}, refOrigins: {} };
    packsTableReferences[pack.name] = packTableReferences;

    for (const packFile of pack.packedFiles) {
      if (!packFile.schemaFields) {
        continue;
      }

      try {
        const dbName = getDBName(packFile);
        if (!dbName) {
          console.log("findPackTableReferences: cannot find db name for", packFile.name);
          continue;
        }

        const dbversion = getDBVersionByTableName(packFile, dbName);

        if (!dbversion) {
          console.log("findPackTableReferences: cannot find dbversion for", packFile.name);
          continue;
        }

        const chunkedSchemaIntoRows = chunkSchemaIntoRows(packFile.schemaFields || [], dbversion);

        for (let i = 0; i < chunkedSchemaIntoRows.length; i++) {
          for (let j = 0; j < chunkedSchemaIntoRows[i].length; j++) {
            const dbField = dbversion.fields[j];
            if (
              tablesToReferenceFieldNames[dbName] &&
              tablesToReferenceFieldNames[dbName].includes(dbField.name)
            ) {
              packTableReferences.ownKeys[dbName] = packTableReferences.ownKeys[dbName] || {};
              packTableReferences.ownKeys[dbName][dbField.name] =
                packTableReferences.ownKeys[dbName][dbField.name] || [];

              const resolvedKeyValue = resolveKeyValue(
                dbField.field_type,
                chunkedSchemaIntoRows[i][j].fields
              );

              if (
                resolvedKeyValue != "" &&
                !packTableReferences.ownKeys[dbName][dbField.name].includes(resolvedKeyValue)
              )
                packTableReferences.ownKeys[dbName][dbField.name].push(resolvedKeyValue);
            }

            if (
              // don't build refs for vanilla Packs
              !appData.vanillaPacks.some((vanillaPack) => vanillaPack.name == pack.name) &&
              tablesAndDBFieldsThatReference[dbName] &&
              tablesAndDBFieldsThatReference[dbName][dbField.name]
            ) {
              const [dbNameReferenceTo, dbFieldNameReferenceTo] =
                tablesAndDBFieldsThatReference[dbName][dbField.name];
              packTableReferences.refs[dbNameReferenceTo] = packTableReferences.refs[dbNameReferenceTo] || {};
              packTableReferences.refs[dbNameReferenceTo][dbFieldNameReferenceTo] =
                packTableReferences.refs[dbNameReferenceTo][dbFieldNameReferenceTo] || [];

              let resolvedKeyValue = "";
              try {
                resolvedKeyValue = resolveKeyValue(dbField.field_type, chunkedSchemaIntoRows[i][j].fields);
              } catch (e) {
                console.log(dbField);
                console.log(
                  pack.name,
                  packFile.name,
                  dbName,
                  dbField.name,
                  chunkedSchemaIntoRows[i][j].fields
                );
                throw e;
              }

              if (resolvedKeyValue != "")
                if (appData.vanillaPacksDBFileNames.includes(dbNameReferenceTo)) {
                  // if it's an Assembly Kit table ignore it
                  if (
                    !packTableReferences.refs[dbNameReferenceTo][dbFieldNameReferenceTo].includes(
                      resolvedKeyValue
                    )
                  )
                    packTableReferences.refs[dbNameReferenceTo][dbFieldNameReferenceTo].push(
                      resolvedKeyValue
                    );

                  const newRefOrigin = {
                    originDBFileName: dbName,
                    targetDBFileName: dbNameReferenceTo,
                    value: resolvedKeyValue,
                    originFieldName: dbField.name,
                    targetFieldName: dbFieldNameReferenceTo,
                    originFileSuffix: packFile.name,
                  };

                  packTableReferences.refOrigins[dbNameReferenceTo] =
                    packTableReferences.refOrigins[dbNameReferenceTo] || [];

                  if (
                    !packTableReferences.refOrigins[dbNameReferenceTo].some(
                      (refOrigin) =>
                        refOrigin.originDBFileName === newRefOrigin.originDBFileName &&
                        refOrigin.targetDBFileName === newRefOrigin.targetDBFileName &&
                        refOrigin.value === newRefOrigin.value &&
                        refOrigin.originFieldName === newRefOrigin.originFieldName &&
                        refOrigin.targetFieldName === newRefOrigin.targetFieldName &&
                        refOrigin.originFileSuffix === newRefOrigin.originFileSuffix
                    )
                  )
                    packTableReferences.refOrigins[dbNameReferenceTo].push(newRefOrigin);
                } else {
                  // console.log("NOT IN VANILLA PACKS:", dbNameReferenceTo);
                }
            }
          }
        }

        // console.log("FOUND CONFLICT");
        // console.log(pack.name, packTwo.name, packFile.name, packTwoFile.name, v1);
      } catch (e) {
        console.log(e);
      }
    }
  }

  const foundMissingRefs: Record<PackName, DBRefOrigin[]> = {};
  for (const [packName, packTableReferences] of Object.entries(packsTableReferences)) {
    // don't check vanilla packs for missing refs
    if (appData.vanillaPacks.some((vanillaPack) => vanillaPack.name == packName)) continue;

    for (const [dbFileName, dbFieldNameToRefKeys] of Object.entries(packTableReferences.refs)) {
      for (const [dbFieldName, refKeys] of Object.entries(dbFieldNameToRefKeys)) {
        let reference: DBField | undefined = undefined;
        // console.log("dbFileName:", dbFileName);
        for (const version of DBNameToDBVersions[appData.currentGame][dbFileName]) {
          reference = version.fields.find((field) => field.name == dbFieldName);
          if (reference) break;
        }
        if (!reference) continue;

        // console.log("dbFieldName is", dbFieldName);
        // console.log("ref is", reference.is_reference);
        // const dbFileNameToSearch = `${reference.is_reference[0]}_tables`;
        // const dbFieldNameToSearch = reference.is_reference[1];
        const dbFileNameToSearch = dbFileName;
        const dbFieldNameToSearch = dbFieldName;

        // if it's an Assembly Kit table ignore it
        if (!appData.vanillaPacksDBFileNames.includes(dbFileNameToSearch)) continue;

        for (const refKey of refKeys) {
          let foundRef = false;
          for (const packTableReferenceForRefSearch of Object.values(packsTableReferences)) {
            foundRef =
              packTableReferenceForRefSearch.ownKeys[dbFileNameToSearch] &&
              !!packTableReferenceForRefSearch.ownKeys[dbFileNameToSearch][dbFieldNameToSearch]?.find(
                (ownKeyInOtherPack) => ownKeyInOtherPack == refKey
              );
            if (foundRef) {
              // console.log(
              //   "FOUND",
              //   packName,
              //   dbFileName,
              //   refKey,
              //   "IN",
              //   dbFileNameToSearch,
              //   dbFieldNameToSearch
              // );
              break;
            }
          }
          if (!foundRef) {
            // console.log(
            //   `DIDN'T FIND ${refKey} IN ${dbFileNameToSearch} ${dbFieldNameToSearch}, source is ${dbFieldName} from ${dbFileName}`
            // );

            if (packTableReferences.refOrigins[dbFileNameToSearch]) {
              const refs = packTableReferences.refOrigins[dbFileNameToSearch].filter(
                (refOrigin) =>
                  refOrigin.targetDBFileName === dbFileNameToSearch &&
                  refOrigin.value === refKey &&
                  refOrigin.targetFieldName === dbFieldNameToSearch
              );
              for (const ref of refs) {
                foundMissingRefs[packName] = foundMissingRefs[packName] || [];
                foundMissingRefs[packName].push(ref);
                // console.log(
                //   `MISSING ${refKey} referenced in ${ref.originDBFileName}, column: ${ref.originFieldName}`
                // );
              }
            }
          }
        }
      }
    }
  }

  console.timeEnd("packTableReferences");
  return foundMissingRefs;
}
