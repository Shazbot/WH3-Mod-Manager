import { diff } from "deep-object-diff";
import { getDBVersion, getDBVersionByTableName, matchDBFileRegex } from "../packFileSerializer";
import { Pack, PackTableCollision, PackedFile } from "../packFileTypes";
import { getDBName } from "../utility/packFileHelpers";
import { collator } from "../utility/packFileSorting";
import * as fs from "fs";
import appData from "../appData";

export function findPackTableCollisionsBetweenPacks(
  pack: Pack,
  packTwo: Pack,
  packTableCollisions: PackTableCollision[]
) {
  for (const packFile of pack.packedFiles) {
    if (!packFile.schemaFields) continue;
    if (packFile.name.endsWith(".rpfm_reserved")) continue;

    const dbNameMatch1 = packFile.name.match(matchDBFileRegex);
    // console.log("dbNameMatch1", dbNameMatch1);
    if (dbNameMatch1 == null) continue;
    const dbName1 = dbNameMatch1[1];
    // console.log("dbName1", dbName1);
    if (dbName1 == null) continue;

    for (const packTwoFile of packTwo.packedFiles) {
      if (!packTwoFile.schemaFields) continue;
      if (packTwoFile.name.endsWith(".rpfm_reserved")) continue;

      const dbNameMatch2 = packTwoFile.name.match(matchDBFileRegex);
      // console.log("dbNameMatch2", dbNameMatch2);
      if (dbNameMatch2 == null) continue;
      const dbName2 = dbNameMatch2[1];
      // console.log("dbName2", dbName2);
      if (dbName2 == null) continue;

      try {
        if (dbName1 === dbName2) {
          // console.log("MATCHED", dbName1, dbName2);
          const firstVer = getDBVersion(packFile);
          const secondVer = getDBVersion(packTwoFile);
          // console.log("ver", firstVer, secondVer);
          if (firstVer == null || secondVer == null) continue;

          // console.log("length:");
          // console.log(firstVer.fields.filter((field) => field.is_key).length);
          // console.log(secondVer.fields.filter((field) => field.is_key).length);

          if (firstVer.fields.filter((field) => field.is_key).length > 1) continue;
          if (secondVer.fields.filter((field) => field.is_key).length > 1) continue;
          const firstVerKeyField = firstVer.fields.filter((field) => field.is_key)[0];

          // console.log("key field", firstVerKeyField);

          const v1Keys = packFile.schemaFields.filter((field) => field.isKey);
          // console.log(packFile);
          // console.log(packTwoFile);
          // console.log(v1Keys);
          if (v1Keys.length < 1) continue;
          const v2Keys = packTwoFile.schemaFields.filter((field) => field.isKey);
          // console.log(v2Keys);
          if (v2Keys.length < 1) continue;

          for (let ii = 0; ii < v1Keys.length; ii++) {
            const v1Fields = v1Keys[ii].fields;
            const v1 =
              (v1Fields[1] && v1Fields[1].val != null && v1Fields[1].val.toString()) ||
              v1Fields[0]?.val?.toString();
            for (let jj = 0; jj < v2Keys.length; jj++) {
              const v2Fields = v2Keys[jj].fields;
              const v2 =
                (v2Fields[1] && v2Fields[1].val != null && v2Fields[1].val.toString()) ||
                (v2Fields[0]?.val?.toString() ?? "");

              if (v1 === v2) {
                if (
                  !packTableCollisions.some(
                    (collision) =>
                      collision.firstPackName == pack.name &&
                      collision.secondPackName == packTwo.name &&
                      collision.fileName == packFile.name &&
                      collision.secondFileName == packTwoFile.name &&
                      collision.key == firstVerKeyField.name &&
                      collision.value == v1
                  )
                ) {
                  packTableCollisions.push({
                    firstPackName: pack.name,
                    secondPackName: packTwo.name,
                    fileName: packFile.name,
                    secondFileName: packTwoFile.name,
                    // key: packFile.schemaFields.find((field) => field.isKey).name,
                    key: firstVerKeyField.name,
                    value: v1,
                  });
                }

                if (
                  !packTableCollisions.some(
                    (collision) =>
                      collision.firstPackName == packTwo.name &&
                      collision.secondPackName == pack.name &&
                      collision.fileName == packTwoFile.name &&
                      collision.secondFileName == packFile.name &&
                      collision.key == firstVerKeyField.name &&
                      collision.value == v1
                  )
                ) {
                  packTableCollisions.push({
                    secondPackName: pack.name,
                    firstPackName: packTwo.name,
                    secondFileName: packFile.name,
                    fileName: packTwoFile.name,
                    // key: packFile.schemaFields.find((field) => field.isKey).name,
                    key: firstVerKeyField.name,
                    value: v1,
                  });
                }
                // console.log("FOUND CONFLICT");
                // console.log(pack.name, packTwo.name, packFile.name, packTwoFile.name, v1);
              }
            }
          }
        }
      } catch (e) {
        console.log(e);
      }
    }
  }
}

export function getCollisionsBetweenSameTables(
  packFileOne: PackedFile,
  packFileTwo: PackedFile,
  packOne: Pack,
  packTwo: Pack,
  packTableCollisions: PackTableCollision[],
  dbNameOne?: string,
  dbNameTwo?: string
) {
  if (!packFileOne.schemaFields) return;
  if (!packFileTwo.schemaFields) return;

  // console.log("MATCHED", dbName1, dbName2);
  const firstVer =
    (dbNameOne && getDBVersionByTableName(packFileOne, dbNameOne)) || getDBVersion(packFileOne);
  const secondVer =
    (dbNameTwo && getDBVersionByTableName(packFileTwo, dbNameTwo)) || getDBVersion(packFileTwo);
  // console.log("ver", firstVer, secondVer);
  if (firstVer == null || secondVer == null) return;

  // console.log("length:");
  // console.log(firstVer.fields.filter((field) => field.is_key).length);
  // console.log(secondVer.fields.filter((field) => field.is_key).length);

  if (firstVer.fields.filter((field) => field.is_key).length > 1) return;
  if (secondVer.fields.filter((field) => field.is_key).length > 1) return;
  const firstVerKeyField = firstVer.fields.filter((field) => field.is_key)[0];

  // console.log("key field", firstVerKeyField);

  const v1Keys = packFileOne.schemaFields.filter((field) => field.isKey);
  // console.log(packFile);
  // console.log(packTwoFile);
  // console.log(v1Keys);
  if (v1Keys.length < 1) return;
  const v2Keys = packFileTwo.schemaFields.filter((field) => field.isKey);
  // console.log(v2Keys);
  if (v2Keys.length < 1) return;

  for (let ii = 0; ii < v1Keys.length; ii++) {
    const v1Fields = v1Keys[ii].fields;
    const v1 =
      (v1Fields[1] && v1Fields[1].val != null && v1Fields[1].val.toString()) || v1Fields[0]?.val?.toString();
    for (let jj = 0; jj < v2Keys.length; jj++) {
      const v2Fields = v2Keys[jj].fields;
      const v2 =
        (v2Fields[1] && v2Fields[1].val != null && v2Fields[1].val.toString()) ||
        (v2Fields[0]?.val?.toString() ?? "");

      if (v1 === v2) {
        if (
          !packTableCollisions.some(
            (collision) =>
              collision.firstPackName == packOne.name &&
              collision.secondPackName == packTwo.name &&
              collision.fileName == packFileOne.name &&
              collision.secondFileName == packFileTwo.name &&
              collision.key == firstVerKeyField.name &&
              collision.value == v1
          )
        ) {
          packTableCollisions.push({
            firstPackName: packOne.name,
            secondPackName: packTwo.name,
            fileName: packFileOne.name,
            secondFileName: packFileTwo.name,
            // key: packFile.schemaFields.find((field) => field.isKey).name,
            key: firstVerKeyField.name,
            value: v1,
          });
        }

        if (
          !packTableCollisions.some(
            (collision) =>
              collision.firstPackName == packTwo.name &&
              collision.secondPackName == packOne.name &&
              collision.fileName == packFileTwo.name &&
              collision.secondFileName == packFileOne.name &&
              collision.key == firstVerKeyField.name &&
              collision.value == v1
          )
        ) {
          packTableCollisions.push({
            secondPackName: packOne.name,
            firstPackName: packTwo.name,
            secondFileName: packFileOne.name,
            fileName: packFileTwo.name,
            // key: packFile.schemaFields.find((field) => field.isKey).name,
            key: firstVerKeyField.name,
            value: v1,
          });
        }
        // console.log("FOUND CONFLICT");
        // console.log(pack.name, packTwo.name, packFile.name, packTwoFile.name, v1);
      }
    }
  }
}

export function findPackTableCollisionsBetweenPacksOptimized(
  pack: Pack,
  packTwo: Pack,
  packTableCollisions: PackTableCollision[]
) {
  let i = 0,
    j = 0;

  while (i < pack.packedFiles.length && j < packTwo.packedFiles.length) {
    const packFile = pack.packedFiles[i];
    const packTwoFile = packTwo.packedFiles[j];

    if (!packFile.schemaFields) {
      i++;
      continue;
    }

    if (!packTwoFile.schemaFields) {
      j++;
      continue;
    }

    const dbNameOne = getDBName(packFile);
    if (!dbNameOne) {
      i++;
      continue;
    }

    const dbNameTwo = getDBName(packTwoFile);
    if (!dbNameTwo) {
      j++;
      continue;
    }

    const compared = collator.compare(dbNameOne, dbNameTwo);
    switch (compared) {
      case -1:
        i++;
        break;
      case 1:
        j++;
        break;
      case 0:
        {
          const allSameTablesFirstPack = [packFile];
          const allSameTablesSecondPack = [packTwoFile];

          for (let ii = i + 1; ii < pack.packedFiles.length; ii++) {
            const nextTableFirstPack = pack.packedFiles[ii];
            if (nextTableFirstPack.schemaFields && getDBName(nextTableFirstPack) === dbNameOne) {
              allSameTablesFirstPack.push(nextTableFirstPack);
              i++;
            } else break;
          }

          for (let jj = j + 1; jj < packTwo.packedFiles.length; jj++) {
            const nextTableSecondPack = packTwo.packedFiles[jj];
            if (nextTableSecondPack.schemaFields && getDBName(nextTableSecondPack) === dbNameTwo) {
              allSameTablesSecondPack.push(nextTableSecondPack);
              j++;
            } else break;
          }

          i++;
          j++;
          try {
            for (const sameTableFirstPack of allSameTablesFirstPack) {
              for (const sameTableSecondPack of allSameTablesSecondPack) {
                getCollisionsBetweenSameTables(
                  sameTableFirstPack,
                  sameTableSecondPack,
                  pack,
                  packTwo,
                  packTableCollisions,
                  dbNameOne,
                  dbNameTwo
                );
              }
            }
          } catch (e) {
            console.log(e);
          }
        }
        break;
    }
  }
}

export function removeFromPackTableCollisions(
  packTableCollisions: PackTableCollision[],
  removedPackName: string
) {
  return packTableCollisions.filter((collision) => {
    return collision.firstPackName != removedPackName && collision.secondPackName != removedPackName;
  });
}

export function appendPackTableCollisions(
  packsData: Pack[],
  packTableCollisions: PackTableCollision[],
  newPack: Pack
) {
  console.time("appendPackTableCollisions");
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    if (pack === newPack) continue;
    if (pack.name === newPack.name) continue;
    if (appData.allVanillaPackNames.includes(pack.name) || appData.allVanillaPackNames.includes(newPack.name))
      continue;

    findPackTableCollisionsBetweenPacks(pack, newPack, packTableCollisions);
  }
  console.timeEnd("appendPackTableCollisions");

  return packTableCollisions;
}

export function findPackTableCollisions(packsData: Pack[], onPackChecked?: OnPackChecked) {
  const packTableCollisions: PackTableCollision[] = [];

  console.time("findPackTableCollisionsBetweenPacksOptimized");
  if (onPackChecked) onPackChecked(0, packsData.length - 1, "", "", "Files");
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    for (let j = i + 1; j < packsData.length; j++) {
      const packTwo = packsData[j];
      if (pack === packTwo) continue;
      if (pack.name === packTwo.name) continue;
      if (
        appData.allVanillaPackNames.includes(pack.name) ||
        appData.allVanillaPackNames.includes(packTwo.name)
      )
        continue;

      findPackTableCollisionsBetweenPacksOptimized(pack, packTwo, packTableCollisions);
    }
    if (onPackChecked) onPackChecked(i, packsData.length - 1, pack.name, "", "Files");
  }
  console.timeEnd("findPackTableCollisionsBetweenPacksOptimized");

  return packTableCollisions;
}

// TEST METHOD, test the optimized algorithm against the unoptimized one to check for equality
export function findPackTableCollisionsAndCompareWithUnoptimizedMethod(
  packsData: Pack[],
  onPackChecked?: OnPackChecked
) {
  const packTableCollisions: PackTableCollision[] = [];
  console.time("findPackTableCollisions1");
  if (onPackChecked) onPackChecked(0, packsData.length - 1, "", "", "Files");
  for (let i = 0; i < packsData.length; i++) {
    const pack = packsData[i];
    for (let j = i + 1; j < packsData.length; j++) {
      const packTwo = packsData[j];
      if (pack === packTwo) continue;
      if (pack.name === packTwo.name) continue;
      if (
        appData.allVanillaPackNames.includes(pack.name) ||
        appData.allVanillaPackNames.includes(packTwo.name)
      )
        continue;

      findPackTableCollisionsBetweenPacks(pack, packTwo, packTableCollisions);
    }
    if (onPackChecked) onPackChecked(i, packsData.length - 1, pack.name, "", "Files");
  }
  console.timeEnd("findPackTableCollisions1");

  const packTableCollisions2: PackTableCollision[] = findPackTableCollisions(packsData, onPackChecked);

  const areCollisionsEqual =
    packTableCollisions.length == packTableCollisions2.length &&
    packTableCollisions.every((collision) =>
      packTableCollisions2.some(
        (collision2) =>
          collision.firstPackName == collision2.firstPackName &&
          collision.secondPackName == collision2.secondPackName &&
          collision.fileName == collision2.fileName &&
          collision.secondFileName == collision2.secondFileName &&
          collision.key == collision2.key &&
          collision.value == collision2.value
      )
    );
  console.log("findPackTableCollisions are EQUAL:", areCollisionsEqual);

  const packTableCollisionsSort = (a: PackTableCollision, b: PackTableCollision) => {
    const fileNameCompare = a.fileName.localeCompare(b.fileName);
    if (fileNameCompare !== 0) return fileNameCompare;
    const secondFileNameCompare = a.secondFileName.localeCompare(b.secondFileName);
    if (secondFileNameCompare !== 0) return secondFileNameCompare;
    const keyCompare = a.key.localeCompare(b.key);
    if (keyCompare !== 0) return keyCompare;

    const secondPackName = a.secondPackName.localeCompare(b.secondPackName);
    if (secondPackName !== 0) return secondPackName;

    const value = a.value.localeCompare(b.value);
    if (value !== 0) return value;

    return a.firstPackName.localeCompare(b.firstPackName);
  };

  packTableCollisions.sort(packTableCollisionsSort);
  packTableCollisions2.sort(packTableCollisionsSort);

  const diffData = diff(packTableCollisions, packTableCollisions2);
  if (!areCollisionsEqual) {
    fs.writeFileSync("findPackTableCollisions.json", JSON.stringify(diffData));
    fs.writeFileSync("findPackTableCollisionsFIRST.json", JSON.stringify(packTableCollisions));
    fs.writeFileSync("findPackTableCollisionsSECOND.json", JSON.stringify(packTableCollisions2));
  }

  return packTableCollisions;
}
