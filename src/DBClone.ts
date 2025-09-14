import { findNodeInTree, findParentOfNode } from "./components/viewer/viewerHelpers";
import appData from "./appData";
import { getLocsTrie, readModsByPath } from "./ipcMainListeners";
import { chunkSchemaIntoRows, getPacksTableData } from "./packFileSerializer";
import {
  AmendedSchemaField,
  DBVersion,
  LocVersion,
  PackedFile,
  LocFields,
  FIELD_TYPE,
  Pack,
} from "./packFileTypes";
import {
  DBNameToDBVersions as gameToDBNameToDBVersions,
  gameToDBFieldsReferencedBy,
  gameToReferences,
  getReferencesForGame,
  gameToDBFieldsThatReference,
  tablesToIgnore,
  gameToTablesWithNumericIds,
} from "./schema";
import { getDBNameFromString, getDBPackedFilePath, getDBVersion } from "./utility/packFileHelpers";
import Queue from "./utility/queue";
import { gameToPackWithDBTablesName } from "./supportedGames";
import { format } from "date-fns";
import * as fs from "fs";
import Trie from "./utility/trie";

const wasPackAlreadyRead = (newPackPath: string, tableToRead: string) => {
  const packData = appData.packsData.find((pack) => pack.path == newPackPath);
  if (!packData) return false;

  return packData.packedFiles.some(
    (packedFile) =>
      packedFile.name.startsWith(tableToRead) && packedFile.schemaFields && packedFile.schemaFields.length > 0
  );
};

const wasPackAlreadyReadAll = (newPackPath: string, tablesToRead: string[]) => {
  const packData = appData.packsData.find((pack) => pack.path == newPackPath);
  if (!packData) return false;

  for (const tableToRead of tablesToRead) {
    if (
      !packData.packedFiles.some(
        (packedFile) =>
          packedFile.name.startsWith(tableToRead) &&
          packedFile.schemaFields &&
          packedFile.schemaFields.length > 0
      )
    ) {
      return false;
    }
  }

  return true;
};

export const buildDBReferenceTree = async (
  packPath: string,
  currentDBTableSelection: DBTableSelection,
  deepCloneTarget: { row: number; col: number },
  existingRefs: DBCell[],
  selectedNodesByName: IViewerTreeNodeWithData[],
  existingTree?: IViewerTreeNodeWithData
): Promise<IViewerTreeNodeWithData | undefined> => {
  console.log("ENTER buildDBReferenceTree");
  console.log("args:", packPath, currentDBTableSelection, deepCloneTarget, selectedNodesByName);
  const DBNameToDBVersions = gameToDBNameToDBVersions[appData.currentGame];
  const DBFieldsReferencedBy = gameToDBFieldsReferencedBy[appData.currentGame];
  const tableToreferencedColumns = gameToReferences[appData.currentGame];
  const packedFilePath = getDBPackedFilePath(currentDBTableSelection);

  const gameFolderPaths = appData.gamesToGameFolderPaths[appData.currentGame];
  if (!gameFolderPaths || !gameFolderPaths.dataFolder) return;

  const nodePath = await import("path");
  const dataPackPath = nodePath.join(
    gameFolderPaths.dataFolder,
    gameToPackWithDBTablesName[appData.currentGame]
  );

  const isCurrentPackDataPack = nodePath.relative(packPath, dataPackPath) == "";

  const isStartingSearchIndirect = selectedNodesByName.length > 0;

  console.log("isStartingSearchIndirect:", isStartingSearchIndirect);
  console.log("isCurrentPackDataPack:", isCurrentPackDataPack);

  const packsWithReadLocsByPackPath = [] as string[];

  let existingPack = appData.packsData.find((pack) => pack.path == packPath);
  if (!existingPack) {
    await readModsByPath([packPath], { skipParsingTables: true }, true);

    existingPack = appData.packsData.find((pack) => pack.path == packPath);
    if (!existingPack) {
      console.log("buildDBReferenceTree: no existingPack");
      return;
    }
  }

  if (!isCurrentPackDataPack) {
    let tablesToReadInDataPack = existingPack.packedFiles
      .filter((pf) => pf.schemaFields && pf.name.startsWith("db\\"))
      .map((pf) => `db\\${getDBNameFromString(pf.name)}`);

    tablesToReadInDataPack = Array.from(new Set(tablesToReadInDataPack));
    console.log("tables to read from data pack:", tablesToReadInDataPack);

    if (!wasPackAlreadyReadAll(dataPackPath, tablesToReadInDataPack)) {
      await readModsByPath([dataPackPath], { tablesToRead: tablesToReadInDataPack }, true);
      const existingDataPack = appData.packsData.find((pack) => pack.path == dataPackPath);
      if (existingDataPack) {
        getPacksTableData([existingDataPack], tablesToReadInDataPack);
      }
    }
  }

  let packFile = existingPack.packedFiles.find(
    (pf) => pf.name == `db\\${currentDBTableSelection.dbName}\\${currentDBTableSelection.dbSubname}`
  );
  if (!packFile && currentDBTableSelection.dbSubname == "") {
    packFile = existingPack.packedFiles.find((pf) =>
      pf.name.startsWith(`db\\${currentDBTableSelection.dbName}\\`)
    );
  }
  if (!packFile) {
    // check case where we have just the pack file name as instead of full path (e.g. 'data.pack')
    for (const [iterPackedFilePath, iterPackedFile] of Object.entries(existingPack.packedFiles)) {
      if (iterPackedFilePath.startsWith(`${packedFilePath}`)) {
        packFile = iterPackedFile;
      }
    }

    if (!packFile) {
      console.log("buildDBReferenceTree: no packFile found:", packedFilePath);
      return;
    }
  }

  const schema = packFile.tableSchema;
  if (!schema) {
    console.log("buildDBReferenceTree: NO current schema, try to get it");

    const tableToRead = packFile.name;
    console.log(
      "packsWithReadLocsByPackPath.includes()",
      packPath,
      packsWithReadLocsByPackPath.includes(packPath)
    );
    await readModsByPath([packPath], {
      readLocs: !packsWithReadLocsByPackPath.includes(packPath),
      tablesToRead: [tableToRead],
    });
    if (!packsWithReadLocsByPackPath.includes(packPath)) {
      packsWithReadLocsByPackPath.push(packPath);
    }
    const checkP = appData.packsData.find((pack) => pack.path == packPath);
    if (!checkP) {
      console.log("NO CHECKP");
      return;
    }
    const locs = checkP.packedFiles.find((pf) => pf.name.endsWith(".loc"));
    console.log("locs:", locs);
    // console.log("checkP.packedFiles", checkP.packedFiles);

    getPacksTableData([existingPack], [currentDBTableSelection]);
    return await buildDBReferenceTree(
      packPath,
      currentDBTableSelection,
      deepCloneTarget,
      existingRefs,
      selectedNodesByName,
      existingTree
    );
  }
  if (!packFile.schemaFields) {
    console.log("buildDBReferenceTree: NO packFile schemaFields");
    return;
  }

  const rows = chunkSchemaIntoRows(packFile.schemaFields, schema) as AmendedSchemaField[][];

  let toClone = null as AmendedSchemaField | null;
  if (deepCloneTarget.row == -1 || deepCloneTarget.col == -1) {
    const tableToKeyColumns = await getReferencesForGame(appData.currentGame);
    const tableKeyColumns = tableToKeyColumns[currentDBTableSelection.dbName];
    if (!tableKeyColumns || tableKeyColumns.length == 0) {
      console.log("ERROR: no key columns from for table", currentDBTableSelection.dbName);
      return;
    }
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < schema.fields.length; j++) {
        const field = schema.fields[j];
        if (tableKeyColumns.indexOf(field.name) > -1) {
          if (rows[i][j].resolvedKeyValue == selectedNodesByName[0].value) {
            toClone = rows[i][j];
            deepCloneTarget.row = i;
            deepCloneTarget.col = j;
            break;
          }
        }
        if (toClone) break;
      }
    }
  } else {
    toClone = rows[deepCloneTarget.row][deepCloneTarget.col];
  }
  if (!toClone) {
    console.log("ERROR: cannot resolve toClone", deepCloneTarget);
    return;
  }

  console.log("toClone is", toClone);

  const getRef = async (newTableName: string, pack: Pack) => {
    console.log("DBClone: getting ref", newTableName);
    const tableToRead = `db\\${newTableName}`;

    const packPath = pack.path;

    if (!wasPackAlreadyRead(packPath, tableToRead)) {
      await readModsByPath([packPath], {
        readLocs: !packsWithReadLocsByPackPath.includes(packPath),
        tablesToRead: [tableToRead],
      });

      if (!packsWithReadLocsByPackPath.includes(packPath)) {
        packsWithReadLocsByPackPath.push(packPath);
      }
    }

    const newPack = appData.packsData.find((pack) => pack.path == packPath);
    if (!newPack) {
      console.log("DBClone: readModsByPath failed, no pack in appData.packsData for pack", packPath);
      return;
    }
    const tableDataResult = getPacksTableData([newPack], [tableToRead]);
    if (!tableDataResult) {
      console.log("DBClone: getPacksTableData failed");
    } else {
      console.log(
        "tableDataResult:",
        tableDataResult.map((tdr) => Object.keys(tdr.packedFiles))
      );
    }

    // await readModsByPath([existingPack.path], false, true, false, false, [`tablesToRead`]);
  };

  // console.log("found row is", rows[deepCloneTarget.row]);

  // get refs that are in the base DB row
  if (!isStartingSearchIndirect) {
    const row = rows[deepCloneTarget.row];
    for (let i = 0; i < row.length; i++) {
      if (!schema.fields[i].is_reference) continue;
      const [tableName] = schema.fields[i].is_reference;

      await getRef(tableName, existingPack);
    }
  }
  // rows[deepCloneTarget.row].reduce((acc, currentField, currentFieldIndex) => {
  //   if (!schema.fields[currentFieldIndex].is_reference) return acc;
  //   const [tableName, tableColumnName] = schema.fields[currentFieldIndex].is_reference;

  //   await getRef(tableName)
  //   return acc;
  // }, [] as TableReferenceRequest[]);

  const field = schema.fields[deepCloneTarget.col];
  const tree: IViewerTreeNodeWithData = {
    name: field.name,
    children: [] as IViewerTreeNodeWithData[],
    tableName: "",
    columnName: "",
    value: "",
  };

  const allTreeChildren: string[] = [];

  const refsQueue = new Queue<
    [
      acc: DBCell[],
      packFile: PackedFile,
      dbCell: DBCell,
      treeParent: IViewerTreeNodeWithData,
      isIndirect: boolean
    ]
  >();

  const addRefsRecursively = async (
    acc: DBCell[],
    packFile: PackedFile,
    dbCell: DBCell,
    treeParent: IViewerTreeNodeWithData,
    isIndirectRefSearch: boolean
  ) => {
    const [tableName, tableColumnName, resolvedKeyValue] = dbCell;
    console.log("addRefsRecursively for", tableName, tableColumnName, resolvedKeyValue, packFile.name);
    const dbVersion = packFile.tableSchema || getDBVersion(packFile, DBNameToDBVersions);
    if (!dbVersion || !packFile.schemaFields) {
      console.log("NO dbversion", dbVersion, !!packFile.schemaFields);
      return;
    }
    const rows = chunkSchemaIntoRows(packFile.schemaFields, dbVersion);

    for (const row of rows as AmendedSchemaField[][]) {
      const cellWithKey = row.find((cell) => cell.name == tableColumnName) as AmendedSchemaField;
      if (!cellWithKey) continue;
      if (cellWithKey.resolvedKeyValue != resolvedKeyValue) continue;

      console.log("FOUND ROW FOR", tableName, tableColumnName, resolvedKeyValue);

      if (isIndirectRefSearch) {
        const references =
          DBFieldsReferencedBy[tableName] && DBFieldsReferencedBy[tableName][tableColumnName];

        if (references) {
          console.log("REFERENCES FOR", tableName, tableColumnName, references);
          for (const [refTableName, refTableColumnName] of references) {
            if (tablesToIgnore.includes(refTableName)) continue;

            console.log("REFERENCE:", refTableName, refTableColumnName, resolvedKeyValue);

            if (existingTree) {
              const parentOfParentNode = findParentOfNode(
                existingTree,
                treeParent.name
              ) as IViewerTreeNodeWithData;

              // are we looking up the reference to the parent in the tree, if so we can skip it
              if (parentOfParentNode.tableName == refTableName) {
                console.log(
                  "parentOfParentNode points to the same table, skipping this refence:",
                  parentOfParentNode.name
                );
                continue;
              }
            }

            await addNewCellFromReference(
              acc,
              treeParent,
              refTableName,
              refTableColumnName,
              resolvedKeyValue,
              true
            );
          }
        }
        return;
      }

      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        if (i >= dbVersion.fields.length) continue;
        const field = dbVersion.fields[i];

        if (!field || !field.is_reference || field.is_reference.length == 0) continue;
        // if (cell.name == tableColumnName) {
        //   console.log("cell:", cell.resolvedKeyValue, resolvedKeyValue);
        // }
        // if (cell.resolvedKeyValue == resolvedKeyValue) {
        //   console.log("resolvedKeyValue:", cell.name, tableColumnName);
        // }
        if (cell.name != tableColumnName) {
          const newTableName = field.is_reference[0];
          const newTableColumnName = field.is_reference[1];

          console.log(
            "ELSE addNewCellFromReference:",
            newTableName,
            newTableColumnName,
            cell.resolvedKeyValue
          );
          await addNewCellFromReference(
            acc,
            treeParent,
            newTableName,
            newTableColumnName,
            cell.resolvedKeyValue,
            false
          );
        }
      }
    }
  };

  const tryGetPackWithReference = async (
    pack: Pack,
    newTableName: string,
    newTableColumnName: string,
    resolvedKeyValue: string
  ) => {
    console.log("tryGetPackWithReference:", pack.path, newTableName, newTableColumnName, resolvedKeyValue);

    let newPackFile = pack.packedFiles.find(
      (pf) =>
        getDBNameFromString(pf.name) == newTableName &&
        pf.schemaFields
          ?.filter((sF) => (sF as AmendedSchemaField).name == newTableColumnName)
          .some((sF) => (sF as AmendedSchemaField).resolvedKeyValue == resolvedKeyValue)
    );

    if (!newPackFile || !newPackFile.schemaFields) {
      console.log("CALLING getRef");
      await getRef(newTableName, pack);

      newPackFile = pack.packedFiles.find(
        (pf) =>
          getDBNameFromString(pf.name) == newTableName &&
          pf.schemaFields
            ?.filter((sF) => (sF as AmendedSchemaField).name == newTableColumnName)
            .some((sF) => (sF as AmendedSchemaField).resolvedKeyValue == resolvedKeyValue)
      );

      return newPackFile;
    }

    return newPackFile;
  };

  const addNewCellFromReference = async (
    acc: DBCell[],
    treeParent: IViewerTreeNodeWithData,
    newTableName: string,
    newTableColumnName: string,
    resolvedKeyValue: string,
    isIndirectReference: boolean
  ) => {
    // if (!isIndirectReference) {
    if (
      acc.some(
        (dbCell) =>
          dbCell[0] == newTableName && dbCell[1] == newTableColumnName && dbCell[2] == resolvedKeyValue
      )
    )
      return;

    acc.push([newTableName, newTableColumnName, resolvedKeyValue]);
    // }
    // console.log("SEARCH", newTableName, newTableColumnName, resolvedKeyValue);

    let newPackFile = await tryGetPackWithReference(
      existingPack,
      newTableName,
      newTableColumnName,
      resolvedKeyValue
    );

    if (!newPackFile || !newPackFile.schemaFields) {
      console.log(
        "tryGetPackWithReference with existingPack FAILED, isCurrentPackDataPack:",
        isCurrentPackDataPack
      );
      if (!isCurrentPackDataPack) {
        const dataPack = appData.packsData.find((pack) => pack.path == dataPackPath);
        if (dataPack) {
          newPackFile = await tryGetPackWithReference(
            dataPack,
            newTableName,
            newTableColumnName,
            resolvedKeyValue
          );
        }
      }

      if (!newPackFile || !newPackFile.schemaFields) {
        console.log(
          "DBClone: couldn't get ref:",
          newPackFile?.name,
          newTableName,
          newTableColumnName,
          resolvedKeyValue
        );
        return;
      }
    }

    // return addNewChildNode(acc, newPackFile, treeParent, newTableName, newTableColumnName, resolvedKeyValue);

    if (!isIndirectReference) {
      return addNewChildNode(
        acc,
        newPackFile,
        treeParent,
        newTableName,
        newTableColumnName,
        resolvedKeyValue,
        false
      );
    }

    if (newPackFile.schemaFields) {
      const dbVersion = newPackFile.tableSchema || getDBVersion(newPackFile, DBNameToDBVersions);
      if (!dbVersion) {
        console.log("NO dbVersion for", newPackFile.name);
        return;
      }
      const rows = chunkSchemaIntoRows(newPackFile.schemaFields, dbVersion) as AmendedSchemaField[][];

      const row = rows.find(
        (row) => row.find((cell) => cell.name == newTableColumnName)?.resolvedKeyValue == resolvedKeyValue
      );

      if (!row) {
        console.log("no row:", newPackFile.name, newTableColumnName, resolvedKeyValue);
        // if (newTableColumnName == "unit") console.log(dbVersion);
        return;
      }
      if (row) {
        const referencedColumns = tableToreferencedColumns[newTableName] || [];
        // if (!referencedColumns || referencedColumns.length == 0) {
        //   console.log("referencedColumns NOT USABLE");
        //   return;
        // }
        // if (referencedColumns.length > 1) {
        //   console.log("MORE THAN ONE REFERENCED COLUMN");
        //   return;
        // }
        // const referencedColumn = referencedColumns[0];
        console.log("referenced columns are:", referencedColumns);

        if (referencedColumns.length == 0) {
          addNewChildNode(
            acc,
            newPackFile,
            treeParent,
            newTableName,
            newTableColumnName,
            resolvedKeyValue,
            true
          );
        } else {
          for (const referencedColumn of referencedColumns) {
            const resolvedKeyValueOfColumnKey = row.find(
              (cell) => cell.name == referencedColumn
            )?.resolvedKeyValue;
            if (!resolvedKeyValueOfColumnKey) {
              console.log("no resoldevedKeyValueOfColumnKey");
              return;
            }

            console.log("for column", referencedColumn, "key is", resolvedKeyValueOfColumnKey);

            if (
              acc.some(
                (dbCell) =>
                  dbCell[0] == newTableName &&
                  dbCell[1] == referencedColumn &&
                  dbCell[2] == resolvedKeyValueOfColumnKey
              )
            ) {
              console.log("SKIPPING, this ref already exists");
              continue;
            }

            acc.push([newTableName, referencedColumn, resolvedKeyValueOfColumnKey]);

            console.log(
              "adding new referenced node:",
              newPackFile.name,
              newTableName,
              referencedColumn,
              resolvedKeyValueOfColumnKey
            );
            logUsedRefs(acc);
            // await addNewCellFromReference(
            //   acc,
            //   treeParent,
            //   newTableName,
            //   referencedColumn,
            //   resolvedKeyValueOfColumnKey
            // );

            addNewChildNode(
              acc,
              newPackFile,
              treeParent,
              newTableName,
              referencedColumn,
              resolvedKeyValueOfColumnKey,
              false
            );
          }
        }
      } else {
        console.log("NO row FOUND");
      }
    } else {
      console.log("NO schemaFields");
    }
  };

  const addNewChildNode = (
    acc: DBCell[],
    newPackFile: PackedFile,
    treeParent: IViewerTreeNodeWithData,
    newTableName: string,
    newTableColumnName: string,
    resolvedKeyValue: string,
    isIndirectRefSearch: boolean
  ) => {
    console.log("addNewChildNode", newTableName, newTableColumnName, resolvedKeyValue, treeParent.name);
    const newChild = {
      name: `${newTableName} ${newTableColumnName} : ${resolvedKeyValue}`,
      children: [],
      tableName: newTableName,
      columnName: newTableColumnName,
      value: resolvedKeyValue,
    } as IViewerTreeNodeWithData;
    if (
      !treeParent.children.some((node) => node.name == newChild.name) &&
      !allTreeChildren.includes(newChild.name)
    ) {
      treeParent.children.push(newChild);
      allTreeChildren.push(newChild.name);
      // console.log("enqueue 1:", acc);
      if (!isIndirectRefSearch) {
        console.log("ENQUEUE", newTableName, newTableColumnName, resolvedKeyValue);
        refsQueue.enqueue([
          acc,
          newPackFile,
          [newTableName, newTableColumnName, resolvedKeyValue],
          newChild,
          isIndirectRefSearch,
        ]);
      }
      // addRefsRecursively(acc, newPackFile, [newTableName, newTableColumnName, resolvedKeyValue], newChild);
    } else {
      console.log("not adding tree child, it alreadyexists");
    }
  };

  // console.log(
  //   "packDataStore:",
  //   packDataStore[packData.packPath]?.packedFiles
  //     ?.filter((pf) => pf.name.startsWith("db\\") && pf.schemaFields)
  //     .map((pf) => pf.name)
  // );

  const childrenToAdd: [pf: PackedFile, dbCell: DBCell, newChild: IViewerTreeNodeWithData][] = [];

  const rootNode = {
    name: `${currentDBTableSelection.dbName} ${field.name} : ${toClone.resolvedKeyValue}`,
    children: [],
    tableName: currentDBTableSelection.dbName,
    columnName: field.name,
    value: toClone.resolvedKeyValue,
  } as IViewerTreeNodeWithData;
  tree.children.push(rootNode);
  allTreeChildren.push(rootNode.name);

  // the starting refs we'll add to the queue, these will be then recursed from to find new refs
  let refsToUse = [] as DBCell[];
  if (isStartingSearchIndirect) {
    refsToUse = [[currentDBTableSelection.dbName, field.name, toClone.resolvedKeyValue] as DBCell]; // if it's an indirect ref search just add the root node
  } else {
    // otherwise it's a normal ref search and we add all the direct references in the starting DB row
    const row = rows[deepCloneTarget.row];
    for (let currentFieldIndex = 0; currentFieldIndex < row.length; currentFieldIndex++) {
      const currentField = row[currentFieldIndex];

      // rows[deepCloneTarget.row].reduce((acc, currentField, currentFieldIndex) => {
      if (selectedNodesByName.length > 0) continue;
      if (!schema.fields[currentFieldIndex].is_reference) continue;
      const [tableName, tableColumnName] = schema.fields[currentFieldIndex].is_reference;

      const packsToGet = [] as Pack[];
      const packToGetCurrent = appData.packsData.find((pack) => pack.path == packPath);

      if (!packToGetCurrent) {
        console.log(`no ${packPath} in packDataStore`);
        continue;
      }

      packsToGet.push(packToGetCurrent);

      if (!isCurrentPackDataPack) {
        const packToGet = appData.packsData.find((pack) => pack.path == dataPackPath);

        if (!packToGet) {
          console.log(`no ${packPath} in packDataStore`);
          continue;
        }

        if (
          packToGet.packedFiles.find((pf) => getDBNameFromString(pf.name) == tableName && !pf.schemaFields)
        ) {
          const tableToRead = `db\\${tableName}`;
          console.log("reading from data pack:", tableToRead);

          if (!wasPackAlreadyRead(packToGet.path, tableToRead)) {
            await readModsByPath([packToGet.path], { tablesToRead: [tableToRead] }, true);
            getPacksTableData([packToGet], [tableToRead]);
          }
        }

        packsToGet.push(packToGet);
      }

      for (const packToGet of packsToGet) {
        const pf = packToGet.packedFiles.find(
          (pf) =>
            getDBNameFromString(pf.name) == tableName &&
            pf.schemaFields
              ?.filter((sF) => (sF as AmendedSchemaField).name == tableColumnName)
              .some((sF) => (sF as AmendedSchemaField).resolvedKeyValue == currentField.resolvedKeyValue)
        );
        if (pf) {
          const dbCell: DBCell = [tableName, tableColumnName, currentField.resolvedKeyValue];
          console.log("acc push:", tableName, tableColumnName, currentField.resolvedKeyValue);
          refsToUse.push([tableName, tableColumnName, currentField.resolvedKeyValue]);
          const newChild = {
            name: `${tableName} ${tableColumnName} : ${currentField.resolvedKeyValue}`,
            children: [],
            tableName,
            columnName: tableColumnName,
            value: currentField.resolvedKeyValue,
          } as IViewerTreeNodeWithData;

          if (
            !rootNode.children.some((node) => node.name == newChild.name) &&
            !allTreeChildren.includes(newChild.name)
          ) {
            rootNode.children.push(newChild);
            allTreeChildren.push(newChild.name);
            childrenToAdd.push([pf, dbCell, newChild]);
            // addRefsRecursively(acc, pf, dbCell, newChild);
          }
        } else {
          console.log("DBClone: no pf for", tableName, tableColumnName, currentField.resolvedKeyValue);
          console.log(
            "packsToGet:",
            packsToGet.map((pack) => pack.name)
          );
        }
      }
    }
  }

  // root node value
  refsToUse.push([currentDBTableSelection.dbName, field.name, toClone.resolvedKeyValue]);

  // already existing refs
  for (const existingRef of existingRefs) {
    if (
      !refsToUse.some(
        (dbCell) => dbCell[0] == existingRef[0] && dbCell[1] == existingRef[1] && dbCell[2] == existingRef[2]
      )
    )
      refsToUse.push(existingRef);
  }

  for (const [packFile, dbCell, newChild] of childrenToAdd) {
    // console.log("enqueue 2:", refsToUse);
    refsQueue.enqueue([refsToUse, packFile, dbCell, newChild, false]);
    // addRefsRecursively(refsToUse, packFile, dbCell, newChild);
  }

  if (selectedNodesByName.length > 0) {
    const selectedNodeByName = selectedNodesByName[0];
    const dbCell: DBCell = [
      selectedNodeByName.tableName,
      selectedNodeByName.columnName,
      selectedNodeByName.value,
    ];
    // console.log("enqueue 3:", refsToUse);
    refsQueue.enqueue([refsToUse, packFile, dbCell, rootNode, true]);
  }

  console.log(
    "refsQueue at START:",
    refsQueue.queue.map((rq) => rq[0])
  );

  while (!refsQueue.isEmpty()) {
    // console.log(
    //   "refsQueue:",
    //   refsQueue.queue.map((rq) => rq[0])
    // );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await addRefsRecursively(...refsQueue.dequeue()!);
  }

  console.log("biuldDBReferenceTree result:", tree);

  return tree;
};

export async function executeDBDuplication(
  packPath: string,
  nodesNamesToDuplicate: string[],
  nodeNameToRef: Record<string, IViewerTreeNodeWithData>,
  nodeNameToRenameValue: Record<string, string>,
  defaultNodeNameToRenameValue: Record<string, string>,
  treeData: IViewerTreeNodeWithData,
  DBCloneSaveOptions: DBCloneSaveOptions
): Promise<void> {
  try {
    const timestamp = format(new Date(), "ddMMyy_HHmmss");
    const packedFileBaseName =
      DBCloneSaveOptions.savePackedFileName != ""
        ? DBCloneSaveOptions.savePackedFileName
        : `dbclone_${timestamp}_`;

    let pack = appData.packsData.find((pack) => pack.path == packPath);
    if (!pack) {
      console.log("executeDBDuplication: pack not found, trying to read it");
      await readModsByPath([packPath], { skipParsingTables: true }, true);
      pack = appData.packsData.find((pack) => pack.path == packPath);
      if (!pack) {
        console.log("executeDBDuplication: pack not found");
        return;
      }
    }

    const nodePath = await import("path");

    const gameFolderPaths = appData.gamesToGameFolderPaths[appData.currentGame];
    if (!gameFolderPaths || !gameFolderPaths.dataFolder) return;
    const dataPackPath = nodePath.join(
      gameFolderPaths.dataFolder,
      gameToPackWithDBTablesName[appData.currentGame]
    );
    const isCurrentPackDataPack = nodePath.relative(packPath, dataPackPath) == "";

    interface SavePackedFileDataWithSchema {
      name: string;
      schemaFields: AmendedSchemaField[];
      file_size: number;
      version?: number;
      tableSchema: DBVersion;
    }
    interface SavePackedFileDataWithBuffer {
      name: string;
      file_size: number;
      buffer?: Buffer;
    }

    const toSaveWithSchema = [] as SavePackedFileDataWithSchema[];

    const numericIdTables = gameToTablesWithNumericIds[appData.currentGame];

    console.log("to duplicate", nodesNamesToDuplicate);
    console.log("nodeNameToRenameValue:", nodeNameToRenameValue);

    const getIndirectChildrenNodes = (node: IViewerTreeNodeWithData) => {
      const getIndirectChildrenNodesIter = (
        acc: IViewerTreeNodeWithData[],
        node: IViewerTreeNodeWithData
      ) => {
        for (const child of node.children as IViewerTreeNodeWithData[]) {
          if (child.isIndirectRef && !acc.includes(child)) {
            acc.push(child);
            acc.push(...getIndirectChildrenNodesIter(acc, child));
          }
        }

        return acc;
      };

      return getIndirectChildrenNodesIter([], node);
    };

    const nodeRefsToHandle = [] as IViewerTreeNodeWithData[];
    for (const nodeNameToDupe of nodesNamesToDuplicate) {
      const nodeToDupe = findNodeInTree(treeData, nodeNameToDupe) as IViewerTreeNodeWithData;
      if (!nodeToDupe) {
        console.log("CANNOT FIND NODE", nodeNameToDupe);
        continue;
      }

      for (const node of [nodeToDupe, ...nodeToDupe.children]) {
        if (!nodeRefsToHandle.some((nodeIter) => nodeIter.name == node.name)) {
          nodeRefsToHandle.push(node as IViewerTreeNodeWithData);
        }
      }
    }

    const nodesToDuplicate = [] as IViewerTreeNodeWithData[];
    for (const nodeName of nodesNamesToDuplicate) {
      const node = nodeNameToRef[nodeName];
      if (!node) continue;

      nodesToDuplicate.push(node);
    }

    const { typeToBuffer, getFieldSize } = await import("./packFileSerializer");

    console.log(
      "nodesToDuplicate:",
      nodesToDuplicate.map(
        (node) =>
          `tableName: ${node.tableName}, column: ${node.columnName}, node.name: ${node.name}, node.value: ${node.value}`
      )
    );

    console.log(
      "nodeRefsToHandle:",
      nodeRefsToHandle.map(
        (node) =>
          `tableName: ${node.tableName}, column: ${node.columnName}, node.name: ${node.name}, node.value: ${node.value}`
      )
    );

    const originalValueLookup = {} as Record<string, Record<string, Record<string, string>>>;

    const newNodesToDuplicate = [] as IViewerTreeNodeWithData[];

    const handleRefs = async (
      nodeRefsToHandle: IViewerTreeNodeWithData[],
      nodesToDuplicate: IViewerTreeNodeWithData[]
    ) => {
      for (const node of nodeRefsToHandle) {
        const { tableName, columnName } = node;
        const resolvedKeyValue = node.value;

        console.log(
          "nodeRefsToHandle: tableName",
          tableName,
          "columnName",
          columnName,
          "resolvedKeyValue",
          resolvedKeyValue
        );

        const packedFiles = pack.packedFiles.filter((existingPackedFile) =>
          existingPackedFile.name.startsWith(`db\\${tableName}\\`)
        );

        if (!isCurrentPackDataPack) {
          const dataPack = appData.packsData.find((pack) => pack.path == dataPackPath);

          if (dataPack) {
            packedFiles.push(
              ...dataPack.packedFiles.filter((existingPackedFile) =>
                existingPackedFile.name.startsWith(`db\\${tableName}\\`)
              )
            );
          }
        }

        console.log("num packedFiles:", packedFiles.length);
        console.log(
          "packedFiles:",
          packedFiles.map((pf) => pf.name)
        );

        for (const packedFile of packedFiles) {
          if (!packedFile.schemaFields) {
            console.log("packedFile.schemaFields not found");
            continue;
          }

          const currentSchema = packedFile.tableSchema;
          if (!currentSchema) {
            console.log("currentSchema not found");
            continue;
          }

          const DBFieldsThatReference = gameToDBFieldsThatReference[appData.currentGame];
          const referencesForCurrentTable = DBFieldsThatReference[tableName];

          const rows = chunkSchemaIntoRows(packedFile.schemaFields, currentSchema) as AmendedSchemaField[][];

          const rowsToSave = [] as AmendedSchemaField[][];
          const rowsToSaveBothKeyAndRefToSave = [] as AmendedSchemaField[][];
          for (const row of rows) {
            // we do 2 passes on a row, first to clone references, and then keys
            // if we do both passes in a single row we use that row for the final pack
            let clonedReferenceField = false;

            let clonedRow = null as AmendedSchemaField[] | null;
            for (let i = 0; i < row.length; i++) {
              const cell = row[i];

              if (referencesForCurrentTable) {
                const reference = referencesForCurrentTable[cell.name];
                if (!reference) continue;
                // console.log("FOUND REFERENCE:", cell.name, reference);

                const replacement = nodesToDuplicate.find(
                  (nodeToDupe) =>
                    nodeToDupe.tableName == reference[0] &&
                    nodeToDupe.columnName == reference[1] &&
                    nodeToDupe.value == cell.resolvedKeyValue
                );
                if (!replacement) continue;

                const newValue =
                  nodeNameToRenameValue[replacement.name] != null
                    ? nodeNameToRenameValue[replacement.name]
                    : defaultNodeNameToRenameValue[replacement.name];

                originalValueLookup[tableName] = originalValueLookup[tableName] ?? {};
                originalValueLookup[tableName][cell.name] = originalValueLookup[tableName][cell.name] ?? {};
                originalValueLookup[tableName][cell.name][cell.resolvedKeyValue] = newValue;

                const newNode = {
                  name: `${tableName} ${cell.name} : ${cell.resolvedKeyValue}`,
                  children: [],
                  isIndirectRef: false,

                  tableName: tableName,
                  columnName: cell.name,
                  value: cell.resolvedKeyValue,
                } as IViewerTreeNodeWithData;

                if (
                  !newNodesToDuplicate.some(
                    (nodeIter) =>
                      nodeIter.tableName == newNode.tableName &&
                      nodeIter.columnName == newNode.columnName &&
                      nodeIter.value == cell.resolvedKeyValue
                  )
                ) {
                  // add this for the second pass where we handle indirect children of indirect nodes
                  newNodesToDuplicate.push(newNode);

                  console.log("newNodesToDuplicate ADD:", newNode.name, "new value:", newValue);

                  if (!nodeNameToRenameValue[newNode.name]) nodeNameToRenameValue[newNode.name] = newValue;
                }

                console.log(
                  "FOUND REPLACEMENT REF",
                  tableName,
                  cell.name,
                  cell.resolvedKeyValue,
                  "new value:",
                  newValue
                );

                clonedRow = clonedRow || structuredClone(row);
                const cellToReplaceValue = clonedRow[i];

                const field = packedFile.tableSchema?.fields[i];

                if (!field) {
                  console.log("Field not found!");
                  continue;
                }

                cellToReplaceValue.fields = [
                  { type: "Buffer", val: await typeToBuffer(field?.field_type, newValue) },
                ];
                cellToReplaceValue.resolvedKeyValue = newValue;

                clonedReferenceField = true;
                rowsToSave.push(clonedRow);
              }
            }

            for (let i = 0; i < row.length; i++) {
              const cell = row[i];

              const nodeToDupe = nodesToDuplicate.find(
                (nodeToDupe) =>
                  nodeToDupe.tableName == tableName &&
                  nodeToDupe.columnName == cell.name &&
                  nodeToDupe.value == cell.resolvedKeyValue
              );
              if (nodeToDupe) {
                clonedRow = clonedRow || structuredClone(row);
                const cellToReplaceValue = clonedRow[i];

                const field = packedFile.tableSchema?.fields[i];

                if (!field) {
                  console.log("Field not found!");
                  continue;
                }

                const newValue =
                  nodeNameToRenameValue[nodeToDupe.name] != null
                    ? nodeNameToRenameValue[nodeToDupe.name]
                    : defaultNodeNameToRenameValue[nodeToDupe.name];

                console.log("nodeToDupe.name:", nodeToDupe.name);
                console.log(
                  "FOUND KEY REPLACEMENT KEY",
                  tableName,
                  cell.name,
                  cell.resolvedKeyValue,
                  "new value:",
                  newValue
                );

                originalValueLookup[tableName] = originalValueLookup[tableName] ?? {};
                originalValueLookup[tableName][cell.name] = originalValueLookup[tableName][cell.name] ?? {};
                originalValueLookup[tableName][cell.name][cell.resolvedKeyValue] = newValue;

                cellToReplaceValue.fields = [
                  { type: "Buffer", val: await typeToBuffer(field?.field_type, newValue) },
                ];
                cellToReplaceValue.resolvedKeyValue = newValue;

                if (clonedReferenceField) {
                  rowsToSaveBothKeyAndRefToSave.push(clonedRow);
                } else {
                  rowsToSave.push(clonedRow);
                }
              }
            }

            if (numericIdTables[tableName] && clonedRow) {
              const numericIdField = packedFile.tableSchema?.fields.find(
                (field) => field.name == numericIdTables[tableName]
              );
              if (numericIdField) {
                const numericIdFieldIndex = packedFile.tableSchema?.fields.indexOf(numericIdField);
                if (numericIdFieldIndex) {
                  const field = clonedRow[numericIdFieldIndex];

                  let newNumericId = Math.random() * (2 ** 15 - 1);
                  if (numericIdField.field_type == "I32" || numericIdField.field_type == "F32") {
                    newNumericId = Math.random() * (2 ** 31 - 1);
                  }
                  if (numericIdField.field_type == "I64" || numericIdField.field_type == "F64") {
                    newNumericId = Math.random() * (2 ** 63 - 1);
                  }

                  const newNumericIdAsString = Math.floor(newNumericId).toString();

                  console.log("NEW NUMERIC:", newNumericIdAsString);

                  field.fields = [
                    {
                      type: "Buffer",
                      val: await typeToBuffer(numericIdField.field_type, newNumericIdAsString),
                    },
                  ];
                  field.resolvedKeyValue = newNumericIdAsString;
                }
              }
            }
          }

          // const clonedRow = rowWithBothKeyAndRefToSave ?? rowToSave;
          const clonedRows =
            rowsToSaveBothKeyAndRefToSave.length > 0 ? rowsToSaveBothKeyAndRefToSave : rowsToSave;

          let packFileSize = 0;
          for (const clonedRow of clonedRows) {
            if (clonedRow && packedFile.tableSchema) {
              for (let i = 0; i < clonedRow.length; i++) {
                const field = packedFile.tableSchema.fields[i];
                // console.log(
                //   "field size of",
                //   clonedRow[i].name,
                //   field.field_type.toString(),
                //   clonedRow[i].resolvedKeyValue,
                //   "is",
                //   getFieldSize(clonedRow[i].resolvedKeyValue, field.field_type)
                // );
                packFileSize += getFieldSize(clonedRow[i].resolvedKeyValue, field.field_type);
              }
            }
          }

          console.log(
            "clonedRows.length:",
            clonedRows.length,
            "packFileSize:",
            packFileSize,
            "tableName:",
            tableName
          );

          if (packFileSize != 0 && packedFile.tableSchema) {
            const version = packedFile.version;
            if (version) packFileSize += 8; // size of version data

            packFileSize += 5; // number of rows + 1 unknown byte

            const newPFName = `db\\${tableName}\\${packedFileBaseName}`;
            if (!toSaveWithSchema.some((pf) => pf.name == newPFName)) {
              toSaveWithSchema.push({
                name: newPFName,
                schemaFields: clonedRows.flat(),
                file_size: packFileSize,
                version: packedFile.version,
                tableSchema: packedFile.tableSchema,
              });
            } else {
              console.log("PACKED FILE ALREADY EXISTS IN TOSAVE:", newPFName);
            }
          }
        }
      }
    };

    await handleRefs(nodeRefsToHandle, nodesToDuplicate);

    const indirectRefsToHandle = [] as IViewerTreeNodeWithData[];
    for (const node of nodeRefsToHandle.filter((node) => node.isIndirectRef)) {
      const indirectChildren = getIndirectChildrenNodes(node);
      for (const indirectChild of indirectChildren) {
        if (!indirectRefsToHandle.some((nodeIter) => nodeIter.name == indirectChild.name)) {
          indirectRefsToHandle.push(indirectChild as IViewerTreeNodeWithData);
        }
      }
    }

    console.log("nodesToDuplicate:", nodesToDuplicate);
    console.log("newNodesToDuplicate:", newNodesToDuplicate);
    console.log("indirectRefsToHandle:", indirectRefsToHandle);
    console.log("nodeNameToRenameValue:", nodeNameToRenameValue);
    // second pass that handles indirect children of indirect nodes
    await handleRefs(indirectRefsToHandle, newNodesToDuplicate);

    const locs = [] as string[];
    const origLocToNewLoc = {} as Record<string, string>;

    for (const pf of toSaveWithSchema) {
      const tableName = getDBNameFromString(pf.name);
      if (!tableName) {
        console.log("ERROR: no tableName");
        continue;
      }
      console.log(tableName, pf.tableSchema.localised_fields, pf.tableSchema.localised_key_order);

      if (!pf.tableSchema.localised_fields || pf.tableSchema.localised_fields.length < 1) continue;

      const tableToreferencedColumns = gameToReferences[appData.currentGame];
      const referencedColumns = tableToreferencedColumns[tableName] || [];

      let keyColumn = undefined as undefined | string;

      if (referencedColumns && referencedColumns.length == 1) {
        keyColumn = referencedColumns[0];
      }

      if (!keyColumn) {
        keyColumn = pf.tableSchema.fields.find((field) => field.is_key)?.name;
      }

      if (!keyColumn) {
        console.log("CANNOT FIND keyColumn for", tableName);
      }

      let tableNameNoSuffix = tableName;
      const indexOfTableSuffix = tableName.lastIndexOf("_tables");
      if (indexOfTableSuffix > -1) tableNameNoSuffix = tableName.substring(0, indexOfTableSuffix);

      let keyColumns = [] as number[];

      if (pf.tableSchema.localised_key_order && pf.tableSchema.localised_key_order.length > 0) {
        keyColumns = pf.tableSchema.localised_key_order;
      } else {
        const keyField = pf.tableSchema.fields.findIndex((field) => field.name == keyColumn);
        if (keyField > -1) keyColumns = [keyField];
      }

      for (const locFieldName of pf.tableSchema.localised_fields) {
        const newLocNoValue = `${tableNameNoSuffix}_${locFieldName.name}_`;

        const rows = chunkSchemaIntoRows(pf.schemaFields, pf.tableSchema) as AmendedSchemaField[][];
        for (const row of rows) {
          let newLoc = newLocNoValue;
          let newLocLookup = newLocNoValue;
          for (const keyOrder of keyColumns) {
            newLoc = newLoc + row[keyOrder].resolvedKeyValue;
            // console.log("keyOrder is", keyOrder, row[keyOrder].name);

            if (originalValueLookup[tableName][row[keyOrder].name]) {
              for (const [origValue, newValue] of Object.entries(
                originalValueLookup[tableName][row[keyOrder].name]
              )) {
                if (newValue == row[keyOrder].resolvedKeyValue) {
                  newLocLookup += origValue;
                  break;
                }
              }
            } else {
              newLocLookup += row[keyOrder].resolvedKeyValue;
            }
            // newLocLookup.push(newLocLookup);
          }
          console.log("newLoc:", newLoc);
          origLocToNewLoc[newLoc] = newLocLookup;
          locs.push(newLoc);
        }
      }
    }

    // const schema = await getSchemaForGame(appData.currentGame);
    // for (const [tableName, dbversions] of Object.entries(schema)) {
    //   if (dbversions.length < 1) continue;
    //   const version = dbversions[0];

    //   if (!version.localised_fields || version.localised_fields.length < 1) continue;

    //   if (!version.localised_key_order || version.localised_key_order.length < 1) {
    //     console.log("missing localised_key_order:", tableName);
    //   }

    //   if (version.localised_key_order && version.localised_key_order.length > 1) {
    //     console.log("localised_key_order length >1:", tableName);
    //   }
    // }

    const dataPath = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataPath) return;

    const localePath = nodePath.join(dataPath, "local_en.pack");

    const packPathsWithLocs = isCurrentPackDataPack ? [localePath] : [localePath, packPath];
    const localePacks = await readModsByPath(
      packPathsWithLocs,
      {
        skipParsingTables: true,
        readLocs: true,
      },
      true
    );
    if (!localePacks || localePacks.length < 1) {
      console.log("ERROR: couldn't read local_en.pack");
      return;
    }

    console.log("originalValueLookup:", originalValueLookup);
    console.log("origLocToNewLoc:", origLocToNewLoc);
    console.log(
      "localePacks:",
      localePacks.map((pack) => pack.name)
    );

    const locsTries = localePacks
      .map((localePack) => getLocsTrie(localePack))
      .filter((trie) => trie) as Trie<string>[];
    type locsTriesType = typeof locsTries;

    const getLocFromTries = (locKey: string, locsTries: locsTriesType) => {
      for (const locTrie of locsTries) {
        const locValue = locTrie.get(locKey);
        if (locValue) {
          return locValue;
        }
      }
    };

    const locFields = [] as AmendedSchemaField[];
    let locFileSize = 0;

    for (const loc of locs) {
      console.log(
        "LOC for",
        loc,
        origLocToNewLoc[loc],
        origLocToNewLoc[loc] ? getLocFromTries(origLocToNewLoc[loc], locsTries) ?? "" : ""
      );

      const origLoc = origLocToNewLoc[loc] ? getLocFromTries(origLocToNewLoc[loc], locsTries) ?? "" : "";

      const fields = [
        { type: "Buffer" as FIELD_TYPE, val: await typeToBuffer("StringU16", loc) },
        {
          type: "Buffer" as FIELD_TYPE,
          val: await typeToBuffer("StringU16", origLoc),
        },
        { type: "Buffer" as FIELD_TYPE, val: await typeToBuffer("Boolean", "0") },
      ];

      const currentLocSize =
        getFieldSize(loc, "StringU16") + getFieldSize(origLoc, "StringU16") + getFieldSize("0", "Boolean");

      locFileSize += currentLocSize;

      console.log("currentLocSize:", loc, currentLocSize);

      for (let i = 0; i < LocFields.length; i++) {
        const locField = LocFields[i];

        locFields.push({
          name: locField.name,
          resolvedKeyValue: loc,
          type: "Buffer",
          fields: [fields[i]],
          isKey: locField.is_key,
        });
      }
    }

    toSaveWithSchema.push({
      name: `text\\db\\${packedFileBaseName}.loc`,
      schemaFields: locFields,
      file_size: locFileSize + 14,
      version: 1,
      tableSchema: LocVersion,
    });

    console.log("DONE BEFORE toSave");

    // console.log("toSave", toSave);

    const { writePack } = await import("./packFileSerializer");

    const toSave = toSaveWithSchema as (SavePackedFileDataWithSchema | SavePackedFileDataWithBuffer)[];

    const packFileBaseName =
      DBCloneSaveOptions.savePackFileName != ""
        ? DBCloneSaveOptions.savePackFileName
        : `dbclone_${timestamp}`;

    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string;
    const newPackPath = nodePath.join(dataFolder, `${packFileBaseName}.pack`);

    let existingPack = undefined as Pack | undefined;
    if (DBCloneSaveOptions.isAppendSave && fs.existsSync(newPackPath)) {
      const existingPacks = await readModsByPath([newPackPath], { skipParsingTables: true }, true);
      existingPack = existingPacks[0];

      if (existingPack) {
        // existingPacks = await readModsByPath(
        //   [newPackPath],
        //   { filesToRead: existingPack.packedFiles.map((pf) => pf.name) },
        //   true
        // );
        // existingPack = existingPacks[0];
      }
      if (existingPack) {
        for (const packedFileToAdd of existingPack.packedFiles) {
          let duplicatePackedFile = null;
          do {
            duplicatePackedFile = toSave.find((inToSave) => inToSave.name == packedFileToAdd.name);
            if (duplicatePackedFile) {
              const lastIndexOfDot = duplicatePackedFile.name.lastIndexOf(".");
              if (lastIndexOfDot != -1) {
                duplicatePackedFile.name =
                  duplicatePackedFile.name.slice(0, lastIndexOfDot) +
                  "_" +
                  duplicatePackedFile.name.slice(lastIndexOfDot);
              } else {
                duplicatePackedFile.name += "_";
              }
            }
          } while (duplicatePackedFile);

          // if (packedFileToAdd.schemaFields && packedFileToAdd.tableSchema) {
          //   toSave.push({
          //     name: packedFileToAdd.name,
          //     schemaFields: packedFileToAdd.schemaFields as AmendedSchemaField[],
          //     file_size: packedFileToAdd.file_size,
          //     version: packedFileToAdd.version,
          //     tableSchema: packedFileToAdd.tableSchema,
          //   } as SavePackedFileDataWithSchema);
          // } else if (packedFileToAdd.buffer) {
          //   toSave.push({
          //     name: packedFileToAdd.name,
          //     file_size: packedFileToAdd.file_size,
          //     buffer: packedFileToAdd.buffer,
          //   } as SavePackedFileDataWithBuffer);
          // } else {
          //   console.log("CANNOT APPEND DBCLONE PACK WITH", packedFileToAdd.name);
          // }
        }
      }
    }

    const sortedToSave = toSave.toSorted((firstPf, secondPf) => {
      return firstPf.name.localeCompare(secondPf.name);
    });
    await writePack(sortedToSave, newPackPath, existingPack);
  } catch (e) {
    console.log(e);
  }
}

function logUsedRefs(acc: DBCell[]) {
  console.log("current used refs:");
  for (const cell of acc) {
    const [tableName, tableColumnName, resolveKeyValue] = cell;
    console.log(tableName, tableColumnName, resolveKeyValue);
  }
  console.log("current used refs DONE =======================");
}
