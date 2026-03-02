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

interface DBCloneExecutionContext {
  isCanceled?: () => boolean;
  report?: (progress: DBDuplicationProgress) => void;
}

interface DBIndirectReferenceCacheEntry {
  createdAt: number;
  valueToTargets: Map<string, Set<string>>;
}

export interface DBIndirectReferenceCacheContext {
  packByPath: Map<string, Pack>;
  tableFilesByPackAndTable: Map<string, PackedFile[]>;
  rowsByPackedFile: WeakMap<PackedFile, AmendedSchemaField[][]>;
  columnIndexesByPackedFile: WeakMap<PackedFile, Map<string, number>>;
  reverseRefIndexByKey: Map<string, DBIndirectReferenceCacheEntry>;
  reverseRefTtlMs: number;
  maxReverseRefEntries: number;
}

const invalidFileNameChars = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

const hasInvalidFileNameChar = (value: string) => {
  for (const char of value) {
    if (invalidFileNameChars.has(char)) return true;
    if (char.charCodeAt(0) <= 31) return true;
  }
  return false;
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

  const getSelectedPackFile = (packToSearch: Pack) => {
    let selectedPackFile = packToSearch.packedFiles.find(
      (pf) => pf.name == `db\\${currentDBTableSelection.dbName}\\${currentDBTableSelection.dbSubname}`
    );
    if (!selectedPackFile && currentDBTableSelection.dbSubname == "") {
      selectedPackFile = packToSearch.packedFiles.find((pf) =>
        pf.name.startsWith(`db\\${currentDBTableSelection.dbName}\\`)
      );
    }
    if (!selectedPackFile) {
      // check case where we have just the pack file name as instead of full path (e.g. 'data.pack')
      for (const [iterPackedFilePath, iterPackedFile] of Object.entries(packToSearch.packedFiles)) {
        if (iterPackedFilePath.startsWith(`${packedFilePath}`)) {
          selectedPackFile = iterPackedFile;
          break;
        }
      }
    }
    return selectedPackFile;
  };

  let packFile = getSelectedPackFile(existingPack);
  if (!packFile) {
    console.log("buildDBReferenceTree: no packFile found:", packedFilePath);
    return;
  }

  let schema = packFile.tableSchema;
  if (!schema) {
    console.log("buildDBReferenceTree: NO current schema, try to get it");
    await readModsByPath([packPath], {
      tablesToRead: [packFile.name],
      readLocs: false,
    });

    const refreshedPack = appData.packsData.find((pack) => pack.path == packPath);
    if (!refreshedPack) {
      console.log("buildDBReferenceTree: failed to refresh pack");
      return;
    }

    existingPack = refreshedPack;
    getPacksTableData([existingPack], [packFile.name]);
    packFile = getSelectedPackFile(existingPack);
    if (!packFile) {
      console.log("buildDBReferenceTree: no packFile found after refresh:", packedFilePath);
      return;
    }

    schema = packFile.tableSchema;
    if (!schema) {
      console.log("buildDBReferenceTree: still no schema after refresh");
      return;
    }
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
              ) as IViewerTreeNodeWithData | undefined;

              // are we looking up the reference to the parent in the tree, if so we can skip it
              if (parentOfParentNode?.tableName == refTableName) {
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

export const buildDBIndirectReferences = async (
  packPath: string,
  selectedNode: IViewerTreeNodeWithData,
  existingRefs: DBCell[],
  cacheContext?: DBIndirectReferenceCacheContext
): Promise<IViewerTreeNodeWithData[]> => {
  const DBFieldsReferencedBy = gameToDBFieldsReferencedBy[appData.currentGame];
  const tableToreferencedColumns = gameToReferences[appData.currentGame];

  const references = DBFieldsReferencedBy[selectedNode.tableName]?.[selectedNode.columnName];
  if (!references || references.length == 0) return [];

  const gameFolderPaths = appData.gamesToGameFolderPaths[appData.currentGame];
  if (!gameFolderPaths || !gameFolderPaths.dataFolder) return [];

  const nodePath = await import("path");
  const dataPackPath = nodePath.join(
    gameFolderPaths.dataFolder,
    gameToPackWithDBTablesName[appData.currentGame]
  );
  const isCurrentPackDataPack = nodePath.relative(packPath, dataPackPath) == "";
  const currentGame = appData.currentGame;

  const packByPath = cacheContext?.packByPath ?? new Map<string, Pack>();
  const tableFilesByPackAndTable = cacheContext?.tableFilesByPackAndTable ?? new Map<string, PackedFile[]>();
  const rowsByPackedFile = cacheContext?.rowsByPackedFile ?? new WeakMap<PackedFile, AmendedSchemaField[][]>();
  const columnIndexesByPackedFile = cacheContext?.columnIndexesByPackedFile ?? new WeakMap<PackedFile, Map<string, number>>();
  const reverseRefIndexByKey = cacheContext?.reverseRefIndexByKey ?? new Map<string, DBIndirectReferenceCacheEntry>();
  const reverseRefTtlMs = cacheContext?.reverseRefTtlMs ?? 5 * 60 * 1000;
  const maxReverseRefEntries = cacheContext?.maxReverseRefEntries ?? 32;

  const getCellLookupKey = (tableName: string, columnName: string, value: string) => {
    return `${tableName}|${columnName}|${value}`;
  };

  const getPackByPath = async (targetPackPath: string) => {
    const cachedPack = packByPath.get(targetPackPath);
    if (cachedPack) return cachedPack;

    let targetPack = appData.packsData.find((pack) => pack.path == targetPackPath);
    if (!targetPack) {
      await readModsByPath([targetPackPath], { skipParsingTables: true }, true);
      targetPack = appData.packsData.find((pack) => pack.path == targetPackPath);
    }
    if (targetPack) {
      packByPath.set(targetPackPath, targetPack);
    }
    return targetPack;
  };

  const getRowsForPackedFile = (packedFile: PackedFile) => {
    const existingRows = rowsByPackedFile.get(packedFile);
    if (existingRows) return existingRows;
    if (!packedFile.schemaFields || !packedFile.tableSchema) return [] as AmendedSchemaField[][];

    const rows = chunkSchemaIntoRows(packedFile.schemaFields, packedFile.tableSchema) as AmendedSchemaField[][];
    rowsByPackedFile.set(packedFile, rows);
    return rows;
  };

  const getColumnIndexForPackedFile = (packedFile: PackedFile, columnName: string) => {
    let columnLookup = columnIndexesByPackedFile.get(packedFile);
    if (!columnLookup) {
      columnLookup = new Map<string, number>();
      if (packedFile.tableSchema) {
        packedFile.tableSchema.fields.forEach((field, index) => {
          columnLookup?.set(field.name, index);
        });
      }
      columnIndexesByPackedFile.set(packedFile, columnLookup);
    }
    return columnLookup.get(columnName) ?? -1;
  };

  const getTableFilesForPackAndTable = async (targetPackPath: string, tableName: string) => {
    const cacheKey = `${currentGame}|${targetPackPath}|${tableName}`;
    const cachedFiles = tableFilesByPackAndTable.get(cacheKey);
    if (cachedFiles) return cachedFiles;

    const targetPack = await getPackByPath(targetPackPath);
    if (!targetPack) {
      tableFilesByPackAndTable.set(cacheKey, []);
      return [] as PackedFile[];
    }

    const tableToRead = `db\\${tableName}`;
    if (!wasPackAlreadyRead(targetPackPath, tableToRead)) {
      await readModsByPath([targetPackPath], { tablesToRead: [tableToRead] }, true);
    }

    const refreshedPack = appData.packsData.find((pack) => pack.path == targetPackPath);
    if (!refreshedPack) {
      tableFilesByPackAndTable.set(cacheKey, []);
      return [] as PackedFile[];
    }

    getPacksTableData([refreshedPack], [tableToRead]);
    packByPath.set(targetPackPath, refreshedPack);

    const tableFiles = refreshedPack.packedFiles.filter(
      (packedFile) =>
        packedFile.name.startsWith(`db\\${tableName}\\`) && packedFile.schemaFields && packedFile.tableSchema
    );
    tableFilesByPackAndTable.set(cacheKey, tableFiles);
    return tableFiles;
  };

  const ensureReverseIndexEntryFitsCache = () => {
    while (reverseRefIndexByKey.size > maxReverseRefEntries) {
      const oldestKey = reverseRefIndexByKey.keys().next().value as string | undefined;
      if (!oldestKey) break;
      reverseRefIndexByKey.delete(oldestKey);
    }
  };

  const getReverseRefIndexCacheKey = (refTableName: string, refTableColumnName: string) => {
    return `${currentGame}|${packPath}|${refTableName}|${refTableColumnName}`;
  };

  const encodeTarget = (columnName: string, value: string) => `${columnName}|${value}`;
  const decodeTarget = (encodedTarget: string) => {
    const delimiterIndex = encodedTarget.indexOf("|");
    if (delimiterIndex < 0) return undefined;
    return [encodedTarget.slice(0, delimiterIndex), encodedTarget.slice(delimiterIndex + 1)] as const;
  };

  const getReverseRefIndex = async (refTableName: string, refTableColumnName: string) => {
    const cacheKey = getReverseRefIndexCacheKey(refTableName, refTableColumnName);
    const cachedIndex = reverseRefIndexByKey.get(cacheKey);
    if (cachedIndex) {
      const isExpired = Date.now() - cachedIndex.createdAt > reverseRefTtlMs;
      if (!isExpired) {
        reverseRefIndexByKey.delete(cacheKey);
        reverseRefIndexByKey.set(cacheKey, cachedIndex);
        return cachedIndex.valueToTargets;
      }
      reverseRefIndexByKey.delete(cacheKey);
    }

    const referencedColumns = tableToreferencedColumns[refTableName] || [];
    const valueToTargets = new Map<string, Set<string>>();
    const packPathsToSearch = isCurrentPackDataPack ? [packPath] : [packPath, dataPackPath];

    for (const targetPackPath of packPathsToSearch) {
      const tableFiles = await getTableFilesForPackAndTable(targetPackPath, refTableName);
      for (const tableFile of tableFiles) {
        const refColumnIndex = getColumnIndexForPackedFile(tableFile, refTableColumnName);
        if (refColumnIndex < 0) continue;

        const referencedColumnIndexes = referencedColumns
          .map((columnName) => [columnName, getColumnIndexForPackedFile(tableFile, columnName)] as const)
          .filter(([, columnIndex]) => columnIndex >= 0);

        const rows = getRowsForPackedFile(tableFile);
        for (const row of rows) {
          const refCell = row[refColumnIndex];
          if (!refCell) continue;

          const existingTargets = valueToTargets.get(refCell.resolvedKeyValue) ?? new Set<string>();
          if (referencedColumnIndexes.length == 0) {
            existingTargets.add(encodeTarget(refTableColumnName, refCell.resolvedKeyValue));
          } else {
            for (const [referencedColumnName, referencedColumnIndex] of referencedColumnIndexes) {
              const referencedCell = row[referencedColumnIndex];
              if (!referencedCell) continue;
              existingTargets.add(encodeTarget(referencedColumnName, referencedCell.resolvedKeyValue));
            }
          }
          valueToTargets.set(refCell.resolvedKeyValue, existingTargets);
        }
      }
    }

    reverseRefIndexByKey.set(cacheKey, { createdAt: Date.now(), valueToTargets });
    ensureReverseIndexEntryFitsCache();
    return valueToTargets;
  };

  const selectedPack = await getPackByPath(packPath);
  if (!selectedPack) return [];
  if (!isCurrentPackDataPack) {
    await getPackByPath(dataPackPath);
  }

  const seenRefs = new Set(existingRefs.map(([tableName, columnName, value]) => getCellLookupKey(tableName, columnName, value)));
  const seenNodeNames = new Set<string>();
  const newNodes = [] as IViewerTreeNodeWithData[];

  const addNewNode = (tableName: string, columnName: string, value: string) => {
    const refKey = getCellLookupKey(tableName, columnName, value);
    if (seenRefs.has(refKey)) return;
    seenRefs.add(refKey);

    const nodeName = `${tableName} ${columnName} : ${value}`;
    if (seenNodeNames.has(nodeName)) return;
    seenNodeNames.add(nodeName);

    newNodes.push({
      name: nodeName,
      children: [],
      tableName,
      columnName,
      value,
      isIndirectRef: true,
    });
  };

  for (const [refTableName, refTableColumnName] of references) {
    if (tablesToIgnore.includes(refTableName)) continue;
    const valueToTargets = await getReverseRefIndex(refTableName, refTableColumnName);
    const targets = valueToTargets.get(selectedNode.value);
    if (!targets) continue;

    for (const encodedTarget of targets) {
      const decodedTarget = decodeTarget(encodedTarget);
      if (!decodedTarget) continue;
      const [targetColumn, targetValue] = decodedTarget;
      addNewNode(refTableName, targetColumn, targetValue);
    }
  }

  return newNodes;
};

export async function executeDBDuplication(
  packPath: string,
  nodesNamesToDuplicate: string[],
  nodeNameToRef: Record<string, IViewerTreeNodeWithData>,
  nodeNameToRenameValue: Record<string, string>,
  defaultNodeNameToRenameValue: Record<string, string>,
  treeData: IViewerTreeNodeWithData,
  DBCloneSaveOptions: DBCloneSaveOptions,
  executionContext?: DBCloneExecutionContext
): Promise<DBCloneExecutionResult> {
  try {
    const isCanceled = () => executionContext?.isCanceled?.() ?? false;
    const report = (
      stage: DBDuplicationProgress["stage"],
      message?: string,
      current?: number,
      total?: number
    ) => {
      executionContext?.report?.({ stage, message, current, total });
    };

    report("validating", "Preparing clone");
    if (isCanceled()) {
      report("canceled", "Canceled");
      return { ok: false, error: "Canceled" };
    }

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
        return { ok: false, error: `Could not read selected pack: ${packPath}` };
      }
    }

    const nodePath = await import("path");

    const gameFolderPaths = appData.gamesToGameFolderPaths[appData.currentGame];
    if (!gameFolderPaths || !gameFolderPaths.dataFolder) {
      return { ok: false, error: "No data folder configured for current game" };
    }
    const dataPackPath = nodePath.join(
      gameFolderPaths.dataFolder,
      gameToPackWithDBTablesName[appData.currentGame]
    );
    const isCurrentPackDataPack = nodePath.relative(packPath, dataPackPath) == "";
    const packPathsForCollisionChecks = isCurrentPackDataPack ? [packPath] : [packPath, dataPackPath];

    const validateOptionalFileName = (value: string, label: string) => {
      if (value == "") return undefined;
      if (value.trim() != value) return `${label} cannot start or end with whitespace`;
      if (value.includes("..")) return `${label} cannot include '..'`;
      if (hasInvalidFileNameChar(value)) {
        return `${label} contains invalid characters (< > : " / \\ | ? * or control characters)`;
      }
      return undefined;
    };

    const invalidPackedFileName = validateOptionalFileName(DBCloneSaveOptions.savePackedFileName, "Table base name");
    if (invalidPackedFileName) {
      report("error", invalidPackedFileName);
      return { ok: false, error: invalidPackedFileName };
    }
    const invalidPackFileName = validateOptionalFileName(DBCloneSaveOptions.savePackFileName, "Pack file name");
    if (invalidPackFileName) {
      report("error", invalidPackFileName);
      return { ok: false, error: invalidPackFileName };
    }

    const getOrReadPackByPath = async (targetPackPath: string) => {
      let targetPack = appData.packsData.find((iterPack) => iterPack.path == targetPackPath);
      if (!targetPack) {
        await readModsByPath([targetPackPath], { skipParsingTables: true }, true);
        targetPack = appData.packsData.find((iterPack) => iterPack.path == targetPackPath);
      }
      return targetPack;
    };

    const getCellLookupKey = (tableName: string, columnName: string, value: string) => {
      return `${tableName}|${columnName}|${value}`;
    };

    const packPathsToSearchDB = isCurrentPackDataPack ? [packPath] : [packPath, dataPackPath];
    const packByPathCache = new Map<string, Pack>();
    packByPathCache.set(packPath, pack);

    const tableFilesByPackAndTable = new Map<string, PackedFile[]>();
    const rowsByPackedFile = new WeakMap<PackedFile, AmendedSchemaField[][]>();
    const columnIndexesByPackedFile = new WeakMap<PackedFile, Map<string, number>>();

    const getPackFromCacheOrRead = async (targetPackPath: string) => {
      const cachedPack = packByPathCache.get(targetPackPath);
      if (cachedPack) return cachedPack;
      const readPack = await getOrReadPackByPath(targetPackPath);
      if (readPack) {
        packByPathCache.set(targetPackPath, readPack);
      }
      return readPack;
    };

    const getTableFilesForPackAndTable = async (targetPackPath: string, tableName: string) => {
      const cacheKey = `${targetPackPath}|${tableName}`;
      const existingCache = tableFilesByPackAndTable.get(cacheKey);
      if (existingCache) return existingCache;

      const tableToRead = `db\\${tableName}`;
      const targetPack = await getPackFromCacheOrRead(targetPackPath);
      if (!targetPack) {
        tableFilesByPackAndTable.set(cacheKey, []);
        return [];
      }

      if (!wasPackAlreadyRead(targetPackPath, tableToRead)) {
        await readModsByPath([targetPackPath], { tablesToRead: [tableToRead] }, true);
      }

      const refreshedPack = appData.packsData.find((iterPack) => iterPack.path == targetPackPath);
      if (!refreshedPack) {
        tableFilesByPackAndTable.set(cacheKey, []);
        return [];
      }

      getPacksTableData([refreshedPack], [tableToRead]);
      packByPathCache.set(targetPackPath, refreshedPack);
      if (targetPackPath == packPath) {
        pack = refreshedPack;
      }

      const tableFiles = refreshedPack.packedFiles.filter(
        (packedFile) =>
          packedFile.name.startsWith(`db\\${tableName}\\`) && packedFile.schemaFields && packedFile.tableSchema
      );
      tableFilesByPackAndTable.set(cacheKey, tableFiles);
      return tableFiles;
    };

    const getTableFilesAcrossSearchPacks = async (tableName: string) => {
      const tableFiles = [] as PackedFile[];
      for (const targetPackPath of packPathsToSearchDB) {
        const files = await getTableFilesForPackAndTable(targetPackPath, tableName);
        tableFiles.push(...files);
      }
      return tableFiles;
    };

    const getRowsForPackedFile = (packedFile: PackedFile) => {
      const rowsCache = rowsByPackedFile.get(packedFile);
      if (rowsCache) return rowsCache;
      if (!packedFile.schemaFields || !packedFile.tableSchema) return [] as AmendedSchemaField[][];

      const rows = chunkSchemaIntoRows(packedFile.schemaFields, packedFile.tableSchema) as AmendedSchemaField[][];
      rowsByPackedFile.set(packedFile, rows);
      return rows;
    };

    const getColumnIndexForPackedFile = (packedFile: PackedFile, columnName: string) => {
      let columnIndexLookup = columnIndexesByPackedFile.get(packedFile);
      if (!columnIndexLookup) {
        columnIndexLookup = new Map<string, number>();
        if (packedFile.tableSchema) {
          packedFile.tableSchema.fields.forEach((field, index) => {
            columnIndexLookup?.set(field.name, index);
          });
        }
        columnIndexesByPackedFile.set(packedFile, columnIndexLookup);
      }
      return columnIndexLookup.get(columnName) ?? -1;
    };

    const tableColumnValuesCache = new Map<string, Set<string>>();
    const getExistingValuesForTableColumn = async (tableName: string, columnName: string) => {
      const cacheKey = `${tableName}|${columnName}`;
      const existingCache = tableColumnValuesCache.get(cacheKey);
      if (existingCache) return existingCache;

      const existingValues = new Set<string>();
      for (const targetPackPath of packPathsForCollisionChecks) {
        if (isCanceled()) {
          report("canceled", "Canceled");
          return existingValues;
        }

        const tableFiles = await getTableFilesForPackAndTable(targetPackPath, tableName);
        for (const tableFile of tableFiles) {
          const columnIndex = getColumnIndexForPackedFile(tableFile, columnName);
          if (columnIndex < 0) continue;

          const rows = getRowsForPackedFile(tableFile);
          for (const row of rows) {
            const cell = row[columnIndex];
            if (!cell) continue;
            existingValues.add(cell.resolvedKeyValue);
          }
        }
      }

      tableColumnValuesCache.set(cacheKey, existingValues);
      return existingValues;
    };

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
    const toSaveWithSchemaByName = new Map<string, SavePackedFileDataWithSchema>();

    const numericIdTables = gameToTablesWithNumericIds[appData.currentGame];

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
    const nodeRefSet = new Set<string>();
    const addNodeRefToHandle = (node: IViewerTreeNodeWithData) => {
      const key = getCellLookupKey(node.tableName, node.columnName, node.value);
      if (nodeRefSet.has(key)) return false;
      nodeRefSet.add(key);
      nodeRefsToHandle.push(node);
      return true;
    };

    const nodesToDuplicate = [] as IViewerTreeNodeWithData[];
    for (const nodeName of nodesNamesToDuplicate) {
      const node = nodeNameToRef[nodeName];
      if (!node) continue;
      nodesToDuplicate.push(node);
    }
    const selectedNodeLookupKeys = new Set(
      nodesToDuplicate.map((node) => getCellLookupKey(node.tableName, node.columnName, node.value))
    );
    for (const nodeNameToDupe of nodesNamesToDuplicate) {
      const nodeToDupe = findNodeInTree(treeData, nodeNameToDupe) as IViewerTreeNodeWithData;
      if (!nodeToDupe) {
        console.log("CANNOT FIND NODE", nodeNameToDupe);
        continue;
      }
      addNodeRefToHandle(nodeToDupe);
    }

    const renamedValueGroups = new Map<string, Set<string>>();
    for (const nodeToDuplicate of nodesToDuplicate) {
      if (nodeToDuplicate.isIndirectRef) continue;

      const newValue =
        nodeNameToRenameValue[nodeToDuplicate.name] != null
          ? nodeNameToRenameValue[nodeToDuplicate.name]
          : defaultNodeNameToRenameValue[nodeToDuplicate.name];

      if (!newValue || newValue.trim() == "") {
        const errorMessage = `Missing rename value for ${nodeToDuplicate.name}`;
        report("error", errorMessage);
        return { ok: false, error: errorMessage };
      }
      if (newValue == nodeToDuplicate.value) {
        const errorMessage = `Rename value for ${nodeToDuplicate.name} must differ from original key`;
        report("error", errorMessage);
        return { ok: false, error: errorMessage };
      }

      const groupKey = `${nodeToDuplicate.tableName}|${nodeToDuplicate.columnName}`;
      const valuesInGroup = renamedValueGroups.get(groupKey) ?? new Set<string>();
      if (valuesInGroup.has(newValue)) {
        const errorMessage = `Duplicate rename value '${newValue}' for ${nodeToDuplicate.tableName}.${nodeToDuplicate.columnName}`;
        report("error", errorMessage);
        return { ok: false, error: errorMessage };
      }
      valuesInGroup.add(newValue);
      renamedValueGroups.set(groupKey, valuesInGroup);
    }

    report("validating", "Checking key collisions", 0, renamedValueGroups.size);
    let collisionGroupIndex = 0;
    for (const [groupKey, valuesToCheck] of renamedValueGroups.entries()) {
      if (isCanceled()) {
        report("canceled", "Canceled");
        return { ok: false, error: "Canceled" };
      }

      collisionGroupIndex += 1;
      const [tableName, columnName] = groupKey.split("|");
      report("validating", `Checking ${tableName}.${columnName}`, collisionGroupIndex, renamedValueGroups.size);

      const existingValues = await getExistingValuesForTableColumn(tableName, columnName);
      if (isCanceled()) {
        report("canceled", "Canceled");
        return { ok: false, error: "Canceled" };
      }
      for (const valueToCheck of valuesToCheck) {
        if (existingValues.has(valueToCheck)) {
          const errorMessage = `Key collision: ${tableName}.${columnName} already contains '${valueToCheck}'`;
          report("error", errorMessage);
          return { ok: false, error: errorMessage };
        }
      }
    }

    const DBFieldsReferencedBy = gameToDBFieldsReferencedBy[appData.currentGame];
    const tableToreferencedColumns = gameToReferences[appData.currentGame];
    const reverseRefIndexByRefTableColumn = new Map<string, Map<string, Set<string>>>();
    const encodeIndirectRefTarget = (columnName: string, value: string) => `${columnName}|${value}`;
    const decodeIndirectRefTarget = (encoded: string) => {
      const indexOfSeparator = encoded.indexOf("|");
      if (indexOfSeparator < 0) return undefined;
      return [encoded.slice(0, indexOfSeparator), encoded.slice(indexOfSeparator + 1)] as const;
    };

    const getReverseRefIndex = async (refTableName: string, refTableColumnName: string) => {
      const cacheKey = `${refTableName}|${refTableColumnName}`;
      const existingCache = reverseRefIndexByRefTableColumn.get(cacheKey);
      if (existingCache) return existingCache;

      const valueToTargets = new Map<string, Set<string>>();
      const referencedColumns = tableToreferencedColumns[refTableName] || [];
      const tableFiles = await getTableFilesAcrossSearchPacks(refTableName);

      for (const tableFile of tableFiles) {
        const refColumnIndex = getColumnIndexForPackedFile(tableFile, refTableColumnName);
        if (refColumnIndex < 0) continue;

        const referencedColumnIndexes = referencedColumns
          .map((columnName) => [columnName, getColumnIndexForPackedFile(tableFile, columnName)] as const)
          .filter(([, columnIndex]) => columnIndex >= 0);

        const rows = getRowsForPackedFile(tableFile);
        for (const row of rows) {
          const refCell = row[refColumnIndex];
          if (!refCell) continue;

          const existingTargets = valueToTargets.get(refCell.resolvedKeyValue) ?? new Set<string>();
          if (referencedColumnIndexes.length == 0) {
            existingTargets.add(encodeIndirectRefTarget(refTableColumnName, refCell.resolvedKeyValue));
          } else {
            for (const [columnName, columnIndex] of referencedColumnIndexes) {
              const referencedCell = row[columnIndex];
              if (!referencedCell) continue;
              existingTargets.add(encodeIndirectRefTarget(columnName, referencedCell.resolvedKeyValue));
            }
          }
          valueToTargets.set(refCell.resolvedKeyValue, existingTargets);
        }
      }

      reverseRefIndexByRefTableColumn.set(cacheKey, valueToTargets);
      return valueToTargets;
    };

    report("discovering_indirect", "Discovering indirect references", 0, nodeRefsToHandle.length);
    const indirectSearchQueue = [...nodeRefsToHandle];
    const processedIndirectNodes = new Set<string>();
    while (indirectSearchQueue.length > 0) {
      const currentNode = indirectSearchQueue.shift();
      if (!currentNode) continue;
      if (isCanceled()) {
        report("canceled", "Canceled");
        return { ok: false, error: "Canceled" };
      }

      const nodeKey = getCellLookupKey(currentNode.tableName, currentNode.columnName, currentNode.value);
      if (processedIndirectNodes.has(nodeKey)) continue;
      processedIndirectNodes.add(nodeKey);
      report(
        "discovering_indirect",
        `Processing ${currentNode.tableName}.${currentNode.columnName}`,
        processedIndirectNodes.size,
        Math.max(processedIndirectNodes.size, processedIndirectNodes.size + indirectSearchQueue.length)
      );

      const references = DBFieldsReferencedBy[currentNode.tableName]?.[currentNode.columnName];
      if (!references || references.length == 0) continue;

      for (const [refTableName, refTableColumnName] of references) {
        if (tablesToIgnore.includes(refTableName)) continue;

        const valueToTargets = await getReverseRefIndex(refTableName, refTableColumnName);
        const indirectTargets = valueToTargets.get(currentNode.value);
        if (!indirectTargets || indirectTargets.size == 0) continue;

        for (const indirectTarget of indirectTargets) {
          const decodedTarget = decodeIndirectRefTarget(indirectTarget);
          if (!decodedTarget) continue;
          const [columnName, value] = decodedTarget;
          const newIndirectNode = {
            name: `${refTableName} ${columnName} : ${value}`,
            children: [],
            tableName: refTableName,
            columnName,
            value,
            isIndirectRef: true,
          } as IViewerTreeNodeWithData;
          const newIndirectNodeKey = getCellLookupKey(newIndirectNode.tableName, newIndirectNode.columnName, newIndirectNode.value);
          if (!selectedNodeLookupKeys.has(newIndirectNodeKey)) continue;
          if (addNodeRefToHandle(newIndirectNode)) {
            indirectSearchQueue.push(newIndirectNode);
          }
        }
      }
    }

    const { typeToBuffer, getFieldSize } = await import("./packFileSerializer");
    const DBFieldsThatReference = gameToDBFieldsThatReference[appData.currentGame];
    const originalValueLookup = {} as Record<string, Record<string, Record<string, string>>>;

    const newNodesToDuplicate = [] as IViewerTreeNodeWithData[];
    const newNodesToDuplicateSet = new Set<string>();
    const generatedNumericIdsByTableField = new Map<string, Set<string>>();

    const createUniqueNumericId = async (tableName: string, fieldType: string, fieldName: string) => {
      const cacheKey = `${tableName}|${fieldName}`;
      let usedNumericIds = generatedNumericIdsByTableField.get(cacheKey);
      if (!usedNumericIds) {
        usedNumericIds = new Set(await getExistingValuesForTableColumn(tableName, fieldName));
        generatedNumericIdsByTableField.set(cacheKey, usedNumericIds);
      }

      for (let attempt = 0; attempt < 1000; attempt++) {
        let newNumericId = Math.random() * (2 ** 15 - 1);
        if (fieldType == "I32" || fieldType == "F32") {
          newNumericId = Math.random() * (2 ** 31 - 1);
        }
        if (fieldType == "I64" || fieldType == "F64") {
          newNumericId = Math.random() * (2 ** 63 - 1);
        }

        const newNumericIdAsString = Math.floor(newNumericId).toString();
        if (!usedNumericIds.has(newNumericIdAsString)) {
          usedNumericIds.add(newNumericIdAsString);
          return newNumericIdAsString;
        }
      }

      return undefined;
    };

    const mergeRowsIntoSaveOutput = (
      tableName: string,
      packedFile: PackedFile,
      clonedRows: AmendedSchemaField[][],
      rowsSize: number
    ) => {
      if (!packedFile.tableSchema || rowsSize == 0 || clonedRows.length == 0) return;

      const newPFName = `db\\${tableName}\\${packedFileBaseName}`;
      const existingOutput = toSaveWithSchemaByName.get(newPFName);
      const flattenedRows = clonedRows.flat();
      if (!existingOutput) {
        let fileSize = rowsSize;
        if (packedFile.version) fileSize += 8;
        fileSize += 5;

        const newOutput = {
          name: newPFName,
          schemaFields: flattenedRows,
          file_size: fileSize,
          version: packedFile.version,
          tableSchema: packedFile.tableSchema,
        } as SavePackedFileDataWithSchema;
        toSaveWithSchema.push(newOutput);
        toSaveWithSchemaByName.set(newPFName, newOutput);
        return;
      }

      existingOutput.schemaFields.push(...flattenedRows);
      existingOutput.file_size += rowsSize;
    };

    const handleRefs = async (
      nodeRefsToHandle: IViewerTreeNodeWithData[],
      nodesToDuplicate: IViewerTreeNodeWithData[]
    ) => {
      const renameValueByCellKey = new Map<string, string>();
      for (const nodeToDupe of nodesToDuplicate) {
        const newValue =
          nodeNameToRenameValue[nodeToDupe.name] != null
            ? nodeNameToRenameValue[nodeToDupe.name]
            : defaultNodeNameToRenameValue[nodeToDupe.name];
        if (newValue == null) continue;
        renameValueByCellKey.set(getCellLookupKey(nodeToDupe.tableName, nodeToDupe.columnName, nodeToDupe.value), newValue);
      }

      const tableNamesToHandle = Array.from(new Set(nodeRefsToHandle.map((node) => node.tableName)));

      for (let tableIndex = 0; tableIndex < tableNamesToHandle.length; tableIndex++) {
        if (isCanceled()) {
          report("canceled", "Canceled");
          return { canceled: true as const };
        }

        const tableName = tableNamesToHandle[tableIndex];
        report("cloning", `Cloning ${tableName}`, tableIndex + 1, tableNamesToHandle.length);
        const referencesForCurrentTable = DBFieldsThatReference[tableName];
        const packedFiles = await getTableFilesAcrossSearchPacks(tableName);

        for (const packedFile of packedFiles) {
          if (!packedFile.schemaFields || !packedFile.tableSchema) continue;

          const rows = getRowsForPackedFile(packedFile);
          const rowsToSave = [] as AmendedSchemaField[][];
          const rowsToSaveBothKeyAndRefToSave = [] as AmendedSchemaField[][];

          const numericIdFieldName = numericIdTables[tableName];
          const numericIdFieldIndex =
            numericIdFieldName != null ? getColumnIndexForPackedFile(packedFile, numericIdFieldName) : -1;
          const numericIdField =
            numericIdFieldIndex >= 0 && packedFile.tableSchema.fields[numericIdFieldIndex]
              ? packedFile.tableSchema.fields[numericIdFieldIndex]
              : undefined;

          for (const row of rows) {
            let clonedReferenceField = false;
            let clonedRow = null as AmendedSchemaField[] | null;

            for (let i = 0; i < row.length; i++) {
              const cell = row[i];
              if (!referencesForCurrentTable) continue;

              const reference = referencesForCurrentTable[cell.name];
              if (!reference) continue;

              const replacementKey = getCellLookupKey(reference[0], reference[1], cell.resolvedKeyValue);
              const newValue = renameValueByCellKey.get(replacementKey);
              if (newValue == null) continue;

              originalValueLookup[tableName] = originalValueLookup[tableName] ?? {};
              originalValueLookup[tableName][cell.name] = originalValueLookup[tableName][cell.name] ?? {};
              originalValueLookup[tableName][cell.name][cell.resolvedKeyValue] = newValue;

              const newNodeLookupKey = getCellLookupKey(tableName, cell.name, cell.resolvedKeyValue);
              if (!newNodesToDuplicateSet.has(newNodeLookupKey)) {
                const newNode = {
                  name: `${tableName} ${cell.name} : ${cell.resolvedKeyValue}`,
                  children: [],
                  isIndirectRef: false,
                  tableName,
                  columnName: cell.name,
                  value: cell.resolvedKeyValue,
                } as IViewerTreeNodeWithData;
                newNodesToDuplicateSet.add(newNodeLookupKey);
                newNodesToDuplicate.push(newNode);
                if (!nodeNameToRenameValue[newNode.name]) nodeNameToRenameValue[newNode.name] = newValue;
              }

              clonedRow = clonedRow || structuredClone(row);
              const cellToReplaceValue = clonedRow[i];
              const field = packedFile.tableSchema.fields[i];
              if (!field) continue;

              cellToReplaceValue.fields = [{ type: "Buffer", val: await typeToBuffer(field.field_type, newValue) }];
              cellToReplaceValue.resolvedKeyValue = newValue;
              clonedReferenceField = true;
              rowsToSave.push(clonedRow);
            }

            for (let i = 0; i < row.length; i++) {
              const cell = row[i];
              const newValue = renameValueByCellKey.get(getCellLookupKey(tableName, cell.name, cell.resolvedKeyValue));
              if (newValue == null) continue;

              clonedRow = clonedRow || structuredClone(row);
              const cellToReplaceValue = clonedRow[i];
              const field = packedFile.tableSchema.fields[i];
              if (!field) continue;

              originalValueLookup[tableName] = originalValueLookup[tableName] ?? {};
              originalValueLookup[tableName][cell.name] = originalValueLookup[tableName][cell.name] ?? {};
              originalValueLookup[tableName][cell.name][cell.resolvedKeyValue] = newValue;

              cellToReplaceValue.fields = [{ type: "Buffer", val: await typeToBuffer(field.field_type, newValue) }];
              cellToReplaceValue.resolvedKeyValue = newValue;

              if (clonedReferenceField) {
                rowsToSaveBothKeyAndRefToSave.push(clonedRow);
              } else {
                rowsToSave.push(clonedRow);
              }
            }

            if (numericIdField && clonedRow && numericIdFieldIndex >= 0) {
              const field = clonedRow[numericIdFieldIndex];
              const newNumericIdAsString = await createUniqueNumericId(
                tableName,
                numericIdField.field_type,
                numericIdField.name
              );
              if (!newNumericIdAsString) {
                throw new Error(`Could not generate unique numeric id for ${tableName}.${numericIdField.name}`);
              }

              field.fields = [
                {
                  type: "Buffer",
                  val: await typeToBuffer(numericIdField.field_type, newNumericIdAsString),
                },
              ];
              field.resolvedKeyValue = newNumericIdAsString;
            }
          }

          const clonedRows =
            rowsToSaveBothKeyAndRefToSave.length > 0 ? rowsToSaveBothKeyAndRefToSave : rowsToSave;
          let rowsSize = 0;
          for (const clonedRow of clonedRows) {
            for (let i = 0; i < clonedRow.length; i++) {
              const field = packedFile.tableSchema.fields[i];
              rowsSize += getFieldSize(clonedRow[i].resolvedKeyValue, field.field_type);
            }
          }

          mergeRowsIntoSaveOutput(tableName, packedFile, clonedRows, rowsSize);
        }
      }

      return { canceled: false as const };
    };

    const firstPassResult = await handleRefs(nodeRefsToHandle, nodesToDuplicate);
    if (firstPassResult.canceled) return { ok: false, error: "Canceled" };

    const indirectRefsToHandle = [] as IViewerTreeNodeWithData[];
    const indirectRefsToHandleSet = new Set<string>();
    for (const node of nodeRefsToHandle.filter((node) => node.isIndirectRef)) {
      const indirectChildren = getIndirectChildrenNodes(node);
      for (const indirectChild of indirectChildren) {
        const indirectChildNode = indirectChild as IViewerTreeNodeWithData;
        const key = getCellLookupKey(indirectChildNode.tableName, indirectChildNode.columnName, indirectChildNode.value);
        if (!selectedNodeLookupKeys.has(key)) continue;
        if (indirectRefsToHandleSet.has(key)) continue;
        indirectRefsToHandleSet.add(key);
        indirectRefsToHandle.push(indirectChildNode);
      }
    }

    if (indirectRefsToHandle.length > 0) {
      const secondPassResult = await handleRefs(indirectRefsToHandle, newNodesToDuplicate);
      if (secondPassResult.canceled) return { ok: false, error: "Canceled" };
    }

    const locs = [] as string[];
    const origLocToNewLoc = {} as Record<string, string>;
    report("localizing", "Generating localization keys", 0, toSaveWithSchema.length);

    for (let tableIndex = 0; tableIndex < toSaveWithSchema.length; tableIndex++) {
      if (isCanceled()) {
        report("canceled", "Canceled");
        return { ok: false, error: "Canceled" };
      }
      report("localizing", "Generating localization keys", tableIndex + 1, toSaveWithSchema.length);
      const pf = toSaveWithSchema[tableIndex];
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
    if (!dataPath) return { ok: false, error: "No data folder configured for current game" };

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
      return { ok: false, error: "Could not read locale packs for localization keys" };
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

    report("localizing", "Building localization rows", 0, locs.length);
    for (let locIndex = 0; locIndex < locs.length; locIndex++) {
      if (isCanceled()) {
        report("canceled", "Canceled");
        return { ok: false, error: "Canceled" };
      }
      report("localizing", "Building localization rows", locIndex + 1, locs.length);
      const loc = locs[locIndex];
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
    if (isCanceled()) {
      report("canceled", "Canceled");
      return { ok: false, error: "Canceled" };
    }
    report("writing", "Writing pack file");
    await writePack(sortedToSave, newPackPath, existingPack);
    if (isCanceled()) {
      report("canceled", "Canceled after write started");
      return { ok: false, error: "Canceled (too late to stop writing)" };
    }
    report("done", "Clone completed");
    return { ok: true, outputPackPath: newPackPath };
  } catch (e) {
    console.log(e);
    executionContext?.report?.({
      stage: "error",
      message: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: `DB duplication failed: ${e instanceof Error ? e.message : String(e)}` };
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
