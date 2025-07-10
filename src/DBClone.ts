import appData from "./appData";
import { readModsByPath } from "./ipcMainListeners";
import { chunkSchemaIntoRows, getPacksTableData, readPack } from "./packFileSerializer";
import { AmendedSchemaField, DBVersion, PackedFile } from "./packFileTypes";
import {
  DBNameToDBVersions as gameToDBNameToDBVersions,
  gameToDBFieldsReferencedBy,
  gameToReferences,
  getReferencesForGame,
} from "./schema";
import { getDBNameFromString, getDBPackedFilePath, getDBVersion } from "./utility/packFileHelpers";
import Queue from "./utility/queue";

export const buildDBReferenceTree = async (
  packPath: string,
  currentDBTableSelection: DBTableSelection,
  deepCloneTarget: { row: number; col: number },
  selectedNodesByName: IViewerTreeNodeWithData[]
): Promise<IViewerTreeNodeWithData | undefined> => {
  console.log("ENTER buildDBReferenceTree");
  console.log("args:", packPath, currentDBTableSelection, deepCloneTarget, selectedNodesByName);
  const DBNameToDBVersions = gameToDBNameToDBVersions[appData.currentGame];
  const DBFieldsReferencedBy = gameToDBFieldsReferencedBy[appData.currentGame];
  const tableToreferencedColumns = gameToReferences[appData.currentGame];
  const packedFilePath = getDBPackedFilePath(currentDBTableSelection);

  const existingPack = appData.packsData.find((pack) => pack.path == packPath);
  if (!existingPack) {
    console.log("buildDBReferenceTree: no existingPack");
    return;
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
    await readModsByPath([packPath], false, true, false, false, [tableToRead]);
    getPacksTableData([existingPack], [currentDBTableSelection]);
    return await buildDBReferenceTree(
      packPath,
      currentDBTableSelection,
      deepCloneTarget,
      selectedNodesByName
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

  const getRef = async (newTableName: string) => {
    console.log("DBClone: getting ref", newTableName);
    const tableToRead = `db\\${newTableName}`;
    await readModsByPath([packPath], false, true, false, false, [tableToRead]);

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

  console.log("found row is", rows[deepCloneTarget.row]);
  const row = rows[deepCloneTarget.row];
  for (let i = 0; i < row.length; i++) {
    if (!schema.fields[i].is_reference) continue;
    const [tableName] = schema.fields[i].is_reference;

    await getRef(tableName);
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
    [acc: DBCell[], packFile: PackedFile, dbCell: DBCell, treeParent: IViewerTreeNodeWithData]
  >();

  type DBCell = [tableName: string, tableColumnName: string, resolveKeyValue: string];
  const addRefsRecursively = async (
    acc: DBCell[],
    packFile: PackedFile,
    dbCell: DBCell,
    treeParent: IViewerTreeNodeWithData
  ) => {
    const [tableName, tableColumnName, resolvedKeyValue] = dbCell;
    console.log("addRefsRecursively for", tableName, tableColumnName, resolvedKeyValue, packFile.name);
    const dbVersion = getDBVersion(packFile, DBNameToDBVersions);
    if (!dbVersion || !packFile.schemaFields) {
      console.log("NO dbversion", dbVersion, !!packFile.schemaFields);
      return;
    }
    const rows = chunkSchemaIntoRows(packFile.schemaFields, dbVersion);

    // if (tableName == "land_units_tables") {
    //   console.log("land rows:", rows);
    // }

    for (const row of rows as AmendedSchemaField[][]) {
      const cellWithKey = row.find((cell) => cell.name == tableColumnName) as AmendedSchemaField;
      if (!cellWithKey) continue;
      if (cellWithKey.resolvedKeyValue != resolvedKeyValue) continue;

      console.log("FOUND ROW FOR", tableName, tableColumnName, resolvedKeyValue);

      console.log(
        "isRowSelected check:",
        selectedNodesByName,
        `${tableName} ${tableColumnName} : ${resolvedKeyValue}`
      );
      const isRowSelected = selectedNodesByName.some(
        (selectedNode) => selectedNode.name == `${tableName} ${tableColumnName} : ${resolvedKeyValue}`
      );

      if (isRowSelected) {
        console.log("ALREADY SELECTED", `${tableName} ${tableColumnName} : ${resolvedKeyValue}`);
        const references =
          DBFieldsReferencedBy[tableName] && DBFieldsReferencedBy[tableName][tableColumnName];

        if (references) {
          console.log("REFERENCES FOR", tableName, tableColumnName, references);
          for (const [refTableName, refTableColumnName] of references) {
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
      } else {
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
            // const newTableName = tableName;
            // const newTableColumnName = tableColumnName;

            addNewCellFromReference(acc, treeParent, newTableName, newTableColumnName, cell.resolvedKeyValue);
          }
        }
      }
    }
  };

  const addNewCellFromReference = async (
    acc: DBCell[],
    treeParent: IViewerTreeNodeWithData,
    newTableName: string,
    newTableColumnName: string,
    resolvedKeyValue: string,
    isIndirectReference?: boolean
  ) => {
    if (!isIndirectReference) {
      if (
        acc.some(
          (dbCell) =>
            dbCell[0] == newTableName && dbCell[1] == newTableColumnName && dbCell[2] == resolvedKeyValue
        )
      )
        return;

      acc.push([newTableName, newTableColumnName, resolvedKeyValue]);
    }
    // console.log("SEARCH", newTableName, newTableColumnName, resolvedKeyValue);

    let newPackFile = existingPack.packedFiles.find(
      (pf) =>
        getDBNameFromString(pf.name) == newTableName &&
        pf.schemaFields
          ?.filter((sF) => (sF as AmendedSchemaField).name == newTableColumnName)
          .some((sF) => (sF as AmendedSchemaField).resolvedKeyValue == resolvedKeyValue)
    );

    if (!newPackFile || !newPackFile.schemaFields) {
      await getRef(newTableName);

      newPackFile = existingPack.packedFiles.find(
        (pf) =>
          getDBNameFromString(pf.name) == newTableName &&
          pf.schemaFields
            ?.filter((sF) => (sF as AmendedSchemaField).name == newTableColumnName)
            .some((sF) => (sF as AmendedSchemaField).resolvedKeyValue == resolvedKeyValue)
      );

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
      // addToRefsToGet(newTableName, newTableColumnName, resolvedKeyValue);
      // return;
    }

    if (!isIndirectReference) {
      return addNewChildNode(
        acc,
        newPackFile,
        treeParent,
        newTableName,
        newTableColumnName,
        resolvedKeyValue
      );
    }

    if (newPackFile.schemaFields) {
      const dbVersion = getDBVersion(newPackFile, DBNameToDBVersions);
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
        if (newTableColumnName == "unit") console.log(dbVersion);
        return;
      }
      if (row) {
        const referencedColumns = tableToreferencedColumns[newTableName];
        if (!referencedColumns || referencedColumns.length == 0) {
          console.log("referencedColumns NOT USABLE");
          return;
        }
        if (referencedColumns.length > 1) {
          console.log("MORE THAN ONE REFERENCED COLUMN");
          return;
        }
        const referencedColumn = referencedColumns[0];
        const resolvedKeyValueOfColumnKey = row.find(
          (cell) => cell.name == referencedColumn
        )?.resolvedKeyValue;
        if (!resolvedKeyValueOfColumnKey) {
          console.log("no resoldevedKeyValueOfColumnKey");
          return;
        }

        if (
          acc.some(
            (dbCell) =>
              dbCell[0] == newTableName &&
              dbCell[1] == referencedColumn &&
              dbCell[2] == resolvedKeyValueOfColumnKey
          )
        )
          return;

        acc.push([newTableName, referencedColumn, resolvedKeyValueOfColumnKey]);

        addNewChildNode(
          acc,
          newPackFile,
          treeParent,
          newTableName,
          referencedColumn,
          resolvedKeyValueOfColumnKey
        );
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
    resolvedKeyValue: string
  ) => {
    // console.log("addNewChildNode", newTableName, newTableColumnName, resolvedKeyValue, treeParent.name);
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
      refsQueue.enqueue([acc, newPackFile, [newTableName, newTableColumnName, resolvedKeyValue], newChild]);
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

  const refsToUse = rows[deepCloneTarget.row].reduce((acc, currentField, currentFieldIndex) => {
    if (selectedNodesByName.length > 0) return acc;
    if (!schema.fields[currentFieldIndex].is_reference) return acc;
    const [tableName, tableColumnName] = schema.fields[currentFieldIndex].is_reference;

    const packToGet = appData.packsData.find((pack) => pack.path == packPath);
    // if (!packDataStore[packData.packPath]) {
    //   console.log(`no ${packData.packPath} in packDataStore`);
    //   return acc;
    // }
    if (!packToGet) {
      console.log(`no ${packPath} in packDataStore`);
      return acc;
    }

    const pf = packToGet.packedFiles.find(
      (pf) =>
        getDBNameFromString(pf.name) == tableName &&
        pf.schemaFields
          ?.filter((sF) => (sF as AmendedSchemaField).name == tableColumnName)
          .some((sF) => (sF as AmendedSchemaField).resolvedKeyValue == currentField.resolvedKeyValue)
    );
    if (pf) {
      const dbCell: DBCell = [tableName, tableColumnName, currentField.resolvedKeyValue];
      acc.push([tableName, tableColumnName, currentField.resolvedKeyValue]);
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
    }

    return acc;
  }, [] as [string, string, string][]);

  // root node value
  refsToUse.push([currentDBTableSelection.dbName, field.name, toClone.resolvedKeyValue]);

  for (const [packFile, dbCell, newChild] of childrenToAdd) {
    refsQueue.enqueue([refsToUse, packFile, dbCell, newChild]);
    // addRefsRecursively(refsToUse, packFile, dbCell, newChild);
  }

  if (selectedNodesByName.length > 0) {
    const selectedNodeByName = selectedNodesByName[0];
    const dbCell: DBCell = [
      selectedNodeByName.tableName,
      selectedNodeByName.columnName,
      selectedNodeByName.value,
    ];
    refsQueue.enqueue([refsToUse, packFile, dbCell, rootNode]);
  }

  console.log(
    "refsQueue at START:",
    refsQueue.queue.map((rq) => rq[0])
  );

  while (!refsQueue.isEmpty()) {
    console.log(
      "refsQueue:",
      refsQueue.queue.map((rq) => rq[0])
    );
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
  defaultNodeNameToRenameValue: Record<string, string>
): Promise<void> {
  const pack = appData.packsData.find((pack) => pack.path == packPath);
  if (!pack) {
    console.log("executeDBDuplication: pack not found");
    return;
  }

  const toSave = [] as {
    name: string;
    schemaFields: AmendedSchemaField[];
    file_size: number;
    version?: number;
    tableSchema: DBVersion;
  }[];

  console.log("to duplicate", nodesNamesToDuplicate);

  for (const node of nodesNamesToDuplicate) {
    const { tableName, columnName } = nodeNameToRef[node];
    const resolvedKeyValue = nodeNameToRef[node].value;

    console.log("tableName", tableName, "columnName", columnName, "resolvedKeyValue", resolvedKeyValue);

    const packedFiles = pack.packedFiles.filter((existingPackedFile) =>
      existingPackedFile.name.startsWith(`db\\${tableName}\\`)
    );

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

      const rows = chunkSchemaIntoRows(packedFile.schemaFields, currentSchema) as AmendedSchemaField[][];
      for (const row of rows) {
        const cellWithKey = row.find((cell) => cell.name == columnName);
        if (!cellWithKey) {
          console.log("cellWithKey not found");
          continue;
        }
        if (cellWithKey.resolvedKeyValue != resolvedKeyValue) continue;

        console.log("found row match at index", rows.indexOf(row));

        const clonedRow = structuredClone(row);
        const cellToReplaceValue = clonedRow.find(
          (cell) => cell.name == columnName && cell.resolvedKeyValue == resolvedKeyValue
        );
        if (!cellToReplaceValue) {
          console.log("cellToReplaceValue not found");
          continue;
        }

        const cellIndex = row.findIndex((cellIter) => cellIter == cellWithKey);
        if (!packedFile.tableSchema) {
          console.log("packedFile.tableSchema not found");
          continue;
        }

        const field = packedFile.tableSchema?.fields[cellIndex];

        if (!field) {
          console.log("Field not found!");
          continue;
        }

        const { typeToBuffer, getFieldSize } = await import("./packFileSerializer");

        const newValue =
          nodeNameToRenameValue[node] != null
            ? nodeNameToRenameValue[node]
            : defaultNodeNameToRenameValue[node];
        console.log("parse field:", field, nodeNameToRenameValue[node]);

        cellToReplaceValue.fields = [
          { type: "Buffer", val: await typeToBuffer(field?.field_type, newValue) },
        ];
        cellToReplaceValue.resolvedKeyValue = newValue;

        let packFileSize = 0;
        for (let i = 0; i < clonedRow.length; i++) {
          const field = packedFile.tableSchema.fields[i];
          console.log(
            "field size of",
            clonedRow[i].name,
            field.field_type.toString(),
            clonedRow[i].resolvedKeyValue,
            "is",
            getFieldSize(clonedRow[i].resolvedKeyValue, field.field_type)
          );
          packFileSize += getFieldSize(clonedRow[i].resolvedKeyValue, field.field_type);
        }

        const version = packedFile.version;
        if (version) packFileSize += 8; // size of version data

        packFileSize += 5; // number of rows + 1 unknown byte

        toSave.push({
          name: `db\\${tableName}\\test`,
          schemaFields: clonedRow,
          file_size: packFileSize,
          version: packedFile.version,
          tableSchema: packedFile.tableSchema,
        });
      }
    }
  }

  console.log("toSave", toSave);

  const { writePack } = await import("./packFileSerializer");
  const nodePath = await import("path");

  await writePack(
    toSave,
    nodePath.join(appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string, "test.pack")
  );
}
