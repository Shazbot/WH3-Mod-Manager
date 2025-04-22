import React, { useCallback, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/src/hooks";
import { FaSquare, FaCheckSquare, FaMinusSquare, FaArrowRight } from "react-icons/fa";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "./DBDuplicationStyles.css";
import { IconBaseProps } from "react-icons";
import hash from "object-hash";
import { chunkTableIntoRows } from "./viewerHelpers";
import { dataFromBackend, doneRequests, packDataStore } from "./packDataStore";
import {
  getDBNameFromString,
  getDBPackedFilePath,
  getDBVersion,
  tableNameWithDBPrefix,
} from "@/src/utility/packFileHelpers";
import { AmendedSchemaField, PackedFile } from "@/src/packFileTypes";
import { Tooltip } from "flowbite-react";
import Queue from "@/src/utility/queue";

interface ITreeNode {
  name: string;
  children: ITreeNode[];
}

const DBDuplication = React.memo(() => {
  const dispatch = useAppDispatch();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const packsData = useAppSelector((state) => state.app.packsData);
  // important to reload the component
  useAppSelector((state) => state.app.referencesHash);
  const deepCloneTarget = useAppSelector((state) => state.app.deepCloneTarget);
  const packPath = currentDBTableSelection?.packPath ?? "data.pack";

  const [selectedNodesByName, setSelectedNodesByName] = useState<string[]>([]);
  const [expandedNodesByName, setExpandedNodesByName] = useState<string[]>([]);
  const [nodeNameToRenameValue, setNodeNameToRenameValue] = useState<Record<string, string>>({});

  if (!currentDBTableSelection) {
    console.log("NO currentDBTableSelection");
    return <></>;
  }

  console.log("currentDBTableSelection", currentDBTableSelection);

  if (!packsData[packPath]) {
    console.log("NO packsData for,", packPath, " NOT RENDERING");
    return <></>;
  }

  if (!deepCloneTarget) {
    console.log("NO DEEP CLONE TARGET, NOT RENDERING");
    return <></>;
  }

  const packData = packsData[packPath];
  if (!packData) {
    console.log("no packData");
    return <></>;
  }

  const packedFilePath = getDBPackedFilePath(currentDBTableSelection);

  if (!packData.packedFiles) {
    console.log("No packed files!");
    return <></>;
  }
  let packFile = packData.packedFiles[packedFilePath];
  if (!packFile) {
    // check case where we have just the pack file name as instead of full path (e.g. 'data.pack')
    for (const [iterPackedFilePath, iterPackedFile] of Object.entries(packData.packedFiles)) {
      if (iterPackedFilePath.startsWith(`${packedFilePath}`)) {
        packFile = iterPackedFile;
      }
    }

    if (!packFile) {
      console.log("no packFile found:", packedFilePath);
      return <></>;
    }
  }
  const currentSchema = packFile.tableSchema;
  if (!currentSchema) {
    console.log("NO current schema");
    return <></>;
  }
  if (!packFile.schemaFields) {
    console.log("NO packFile schemaFields");
    return <></>;
  }

  const rows = chunkTableIntoRows(packFile.schemaFields, currentSchema);
  const toClone = rows[deepCloneTarget.row][deepCloneTarget.col];
  const schema = currentSchema;

  const field = schema.fields[deepCloneTarget.col];
  const folder: ITreeNode = {
    name: field.name,
    children: [] as ITreeNode[],
  };

  const refsToGet: TableReferenceRequest[] = [];
  const allTreeChildren: string[] = [];

  const refsQueue = new Queue<[acc: DBCell[], packFile: PackedFile, dbCell: DBCell, treeParent: ITreeNode]>();

  type DBCell = [tableName: string, tableColumnName: string, resolveKeyValue: string];
  const addRefsRecursively = (acc: DBCell[], packFile: PackedFile, dbCell: DBCell, treeParent: ITreeNode) => {
    const [tableName, tableColumnName, resolvedKeyValue] = dbCell;
    // console.log("addRefsRecursively for", tableName, tableColumnName, resolvedKeyValue, packFile.name);
    const dbVersion = getDBVersion(packFile, dataFromBackend.DBNameToDBVersions);
    if (!dbVersion || !packFile.schemaFields) {
      console.log("NO dbversion", dbVersion, !!packFile.schemaFields);
      return;
    }
    const rows = chunkTableIntoRows(packFile.schemaFields, dbVersion);

    // if (tableName == "land_units_tables") {
    //   console.log("land rows:", rows);
    // }

    for (const row of rows) {
      const cellWithKey = row.find((cell) => cell.name == tableColumnName);
      if (!cellWithKey) continue;
      if (cellWithKey.resolvedKeyValue != resolvedKeyValue) continue;

      // console.log("FOUND ROW FOR", tableName, tableColumnName, resolvedKeyValue);

      const isRowSelected = selectedNodesByName.includes(
        `${tableName} ${tableColumnName} : ${resolvedKeyValue}`
      );

      if (isRowSelected) {
        console.log("ALREADY SELECTED", `${tableName} ${tableColumnName} : ${resolvedKeyValue}`);
        const references =
          dataFromBackend.DBFieldsReferencedBy[tableName] &&
          dataFromBackend.DBFieldsReferencedBy[tableName][tableColumnName];

        if (references) {
          console.log("REFERENCES FOR", tableName, tableColumnName, references);
          for (const [refTableName, refTableColumnName] of references) {
            addNewCellFromReference(
              acc,
              treeParent,
              refTableName,
              refTableColumnName,
              resolvedKeyValue,
              true
            );
          }
        }
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
          // const newTableName = tableName;
          // const newTableColumnName = tableColumnName;

          addNewCellFromReference(acc, treeParent, newTableName, newTableColumnName, cell.resolvedKeyValue);
        }
      }
    }
  };

  const addNewCellFromReference = (
    acc: DBCell[],
    treeParent: ITreeNode,
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

    const newPackFile = packDataStore[packData.packPath].packedFiles.find(
      (pf) =>
        getDBNameFromString(pf.name) == newTableName &&
        pf.schemaFields
          ?.filter((sF) => (sF as AmendedSchemaField).name == newTableColumnName)
          .some((sF) => (sF as AmendedSchemaField).resolvedKeyValue == resolvedKeyValue)
    );

    if (!newPackFile || !newPackFile.schemaFields) {
      addToRefsToGet(newTableName, newTableColumnName, resolvedKeyValue);
      return;
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
      const dbVersion = getDBVersion(newPackFile, dataFromBackend.DBNameToDBVersions);
      if (!dbVersion) {
        console.log("NO dbVersion for", newPackFile.name);
        return;
      }
      const rows = chunkTableIntoRows(newPackFile.schemaFields, dbVersion);

      const row = rows.find(
        (row) => row.find((cell) => cell.name == newTableColumnName)?.resolvedKeyValue == resolvedKeyValue
      );

      if (!row) {
        console.log("no row:", newPackFile.name, newTableColumnName, resolvedKeyValue);
        if (newTableColumnName == "unit") console.log(dbVersion);
        return;
      }
      if (row) {
        const referencedColumns = dataFromBackend.referencedColums[newTableName];
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
    treeParent: ITreeNode,
    newTableName: string,
    newTableColumnName: string,
    resolvedKeyValue: string
  ) => {
    // console.log("addNewChildNode", newTableName, newTableColumnName, resolvedKeyValue, treeParent.name);
    const newChild = {
      name: `${newTableName} ${newTableColumnName} : ${resolvedKeyValue}`,
      children: [],
    } as ITreeNode;
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

  const addToRefsToGet = (newTableName: string, tableColumnName: string, resolvedKeyValue: string) => {
    if (
      !doneRequests[packData.packPath]?.some(
        (doneTableName) => tableNameWithDBPrefix(doneTableName) == tableNameWithDBPrefix(newTableName)
      ) &&
      !refsToGet.some(
        (refToGet) =>
          refToGet.key == resolvedKeyValue &&
          refToGet.tableName == newTableName &&
          refToGet.tableColumnName == tableColumnName
      )
    )
      refsToGet.push({
        key: resolvedKeyValue,
        tableName: newTableName,
        tableColumnName: tableColumnName,
      });
  };

  console.log(
    "packDataStore:",
    packDataStore[packData.packPath]?.packedFiles
      ?.filter((pf) => pf.name.startsWith("db\\") && pf.schemaFields)
      .map((pf) => pf.name)
  );

  const childrenToAdd: [pf: PackedFile, dbCell: DBCell, newChild: ITreeNode][] = [];

  const rootNode = {
    name: `${currentDBTableSelection.dbName} ${field.name} : ${toClone.resolvedKeyValue}`,
    children: [],
  } as ITreeNode;
  folder.children.push(rootNode);
  allTreeChildren.push(rootNode.name);

  const refsToUse = rows[deepCloneTarget.row].reduce((acc, currentField, currentFieldIndex) => {
    if (!schema.fields[currentFieldIndex].is_reference) return acc;
    const [tableName, tableColumnName] = schema.fields[currentFieldIndex].is_reference;

    if (!packDataStore[packData.packPath]) {
      console.log(`no ${packData.packPath} in packDataStore`);
      return acc;
    }
    const pf = packDataStore[packData.packPath].packedFiles.find(
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
      } as ITreeNode;

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
      console.log("no pf for", tableName, tableColumnName, currentField.resolvedKeyValue);
    }

    return acc;
  }, [] as [string, string, string][]);

  // root node value
  refsToUse.push([currentDBTableSelection.dbName, field.name, toClone.resolvedKeyValue]);

  for (const [packFile, dbCell, newChild] of childrenToAdd) {
    refsQueue.enqueue([refsToUse, packFile, dbCell, newChild]);
    // addRefsRecursively(refsToUse, packFile, dbCell, newChild);
  }

  while (!refsQueue.isEmpty()) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    addRefsRecursively(...refsQueue.dequeue()!);
  }

  const data = flattenTree(folder);
  // console.log("data is", data);
  console.log("EXPANDED NODES ARE", selectedNodesByName);

  const nodeNameToRef = refsToUse.reduce((acc, [tableName, tableColumnName, resolvedKeyValue]) => {
    const name = `${tableName} ${tableColumnName} : ${resolvedKeyValue}`;
    acc[name] = [tableName, tableColumnName, resolvedKeyValue];
    return acc;
  }, {} as Record<string, [string, string, string]>);
  nodeNameToRef[rootNode.name] = [currentDBTableSelection.dbName, field.name, toClone.resolvedKeyValue];

  const defaultNodeNameToRenameValue = data.reduce((acc, current) => {
    acc[current.name] = (nodeNameToRef[current.name] && nodeNameToRef[current.name][2]) || "";
    return acc;
  }, {} as Record<string, string>);

  // for (const expandedNodeName of Object.values(selectedNodesByName)) {
  //   if (nodeNameToRef[expandedNodeName]) {
  //     const [tableName, tableColumnName, resolvedKeyValue] = nodeNameToRef[expandedNodeName];
  //     refsToUse.push([tableName, tableColumnName, resolvedKeyValue]);
  //   }
  // }

  refsToGet.push(
    ...rows[deepCloneTarget.row].reduce((acc, currentField, currentFieldIndex) => {
      if (!schema.fields[currentFieldIndex].is_reference) return acc;
      const [tableName, tableColumnName] = schema.fields[currentFieldIndex].is_reference;

      if (
        doneRequests[packData.packPath]?.some(
          (doneTableName) => tableNameWithDBPrefix(doneTableName) == tableNameWithDBPrefix(tableName)
        )
      )
        return acc;

      console.log("GET", tableNameWithDBPrefix(tableName));
      // console.log("packdatastore for", packData.packPath, !!packDataStore[packData.packPath]);

      // packDataStore[packData.packPath]?.packedFiles
      //   .filter((pf) => pf.schemaFields)
      //   .forEach((pf) => {
      //     // console.log(pf.name);
      //     // console.log(
      //     //   "comparing",
      //     //   getDBNameFromString(pf.name),
      //     //   "to",
      //     //   tableName,
      //     //   "it's",
      //     //   getDBNameFromString(pf.name) == tableName
      //     // );
      //     return (
      //       getDBNameFromString(pf.name) == tableName &&
      //       pf.name.includes("dio_vo_actor_groups_tabl") &&
      //       pf.schemaFields
      //         ?.filter((sF) => (sF as AmendedSchemaField).name == tableColumnName)
      //         .forEach((sF) => {
      //           console.log(
      //             "in",
      //             pf.name,
      //             "for",
      //             tableName,
      //             "val is",
      //             (sF as AmendedSchemaField).resolvedKeyValue
      //           );
      //         })
      //     );
      //   });

      // console.log(
      //   "packdata with schemas for",
      //   packData.packPath,
      //   "are",
      //   packDataStore[packData.packPath]?.packedFiles.filter((pF) => pF.schemaFields).map((pF) => pF.name)
      // );

      if (
        !packDataStore[packData.packPath] ||
        !packDataStore[packData.packPath].packedFiles.some(
          (pf) =>
            getDBNameFromString(pf.name) == tableName &&
            pf.schemaFields
              ?.filter((sF) => (sF as AmendedSchemaField).name == tableColumnName)
              .some((sF) => (sF as AmendedSchemaField).resolvedKeyValue == currentField.resolvedKeyValue)
        )
      )
        if (
          !acc.some(
            (refToGet) =>
              refToGet.key == currentField.resolvedKeyValue &&
              refToGet.tableName == tableName &&
              refToGet.tableColumnName == tableColumnName
          ) &&
          !refsToGet.some(
            (refToGet) =>
              refToGet.key == currentField.resolvedKeyValue &&
              refToGet.tableName == tableName &&
              refToGet.tableColumnName == tableColumnName
          )
        )
          acc.push({
            key: currentField.resolvedKeyValue,
            tableName,
            tableColumnName,
          } as TableReferenceRequest);
      return acc;
    }, [] as TableReferenceRequest[])
  );

  for (const expandedNodeName of Object.values(selectedNodesByName)) {
    if (!nodeNameToRef[expandedNodeName]) continue;

    const [tableName, tableColumnName, resolvedKeyValue] = nodeNameToRef[expandedNodeName];
    if (
      !doneRequests[packData.packPath]?.some(
        (doneTableName) => tableNameWithDBPrefix(doneTableName) == tableNameWithDBPrefix(tableName)
      ) &&
      !refsToGet.some(
        (refToGet) =>
          refToGet.key == resolvedKeyValue &&
          refToGet.tableName == tableName &&
          refToGet.tableColumnName == tableColumnName
      )
    )
      refsToGet.push({ tableName, tableColumnName, key: resolvedKeyValue });

    const node = data.find((node) => node.name == expandedNodeName);
    node?.children
      .map((childId) => data.find((node) => node.id == childId))
      .filter((node): node is INode => !!node)
      .map((node) => nodeNameToRef[node.name])
      .filter((nodeRef): nodeRef is [string, string, string] => !!nodeRef)
      .forEach((nodeRef) => {
        const [tableName, tableColumnName, resolvedKeyValue] = nodeRef;
        // console.log("ADD CHILD", tableName, tableColumnName, resolvedKeyValue);
        if (
          !refsToGet.some(
            (refToGet) =>
              refToGet.key == resolvedKeyValue &&
              refToGet.tableName == tableName &&
              refToGet.tableColumnName == tableColumnName
          ) &&
          !doneRequests[packData.packPath]?.some(
            (doneTableName) => tableNameWithDBPrefix(doneTableName) == tableNameWithDBPrefix(tableName)
          )
        )
          refsToGet.push({
            key: resolvedKeyValue,
            tableName,
            tableColumnName,
          } as TableReferenceRequest);
      });
  }

  // console.log("doneRequests:", doneRequests[packPath]);
  console.log("refsToGet", refsToGet);
  if (refsToGet.length > 0) {
    // console.log("packDataStore for this pack is ", packDataStore[packPath]);
    window.api?.getTableReferences(packData.packPath, refsToGet, !packDataStore[packPath]);
  }

  console.log("tryign to amend", rows[deepCloneTarget.row][deepCloneTarget.col]);

  // console.log(`currentPackData.data is ${currentPackData.data}`);
  // console.log("packDataStore", packDataStore);
  // if (packDataStore[packPath]) console.log(packDataStore[packPath].packedFiles.map((pf) => pf.name));

  const storedData = packDataStore[packPath];
  if (!storedData) {
    console.log("NO stored data for", packPath);
    return <></>;
  }

  const getParentNodeNames = (acc: string[], node: INode) => {
    const nodeName = data.find((iterNode) => iterNode.id == node.id)?.name;
    if (nodeName && !acc.some((iterNodeName) => iterNodeName == nodeName)) acc.push(nodeName);
    if (node.parent) getParentNodeNames(acc, data.find((iterNode) => iterNode.id == node.parent) as INode);
    return acc;
  };

  const onTreeExpand = (props: ITreeViewOnSelectProps) => {
    console.log("expanded", props.element.name);
    const currentName = props.element.name;
    // const expandedByName = Array.from(props.treeState.selectedIds.values())
    //   .map((id) => data.find((node) => node.id == id)?.name)
    //   .filter((name): name is string => !!name);

    let newselectedNodesByName = [...selectedNodesByName];
    if (selectedNodesByName.includes(currentName))
      newselectedNodesByName = newselectedNodesByName.filter((name) => name != currentName);
    else newselectedNodesByName.push(currentName);

    for (const nodeName of [...newselectedNodesByName]) {
      const node = data.find((node) => node.name == nodeName);
      if (node) {
        const parentNodesNames = getParentNodeNames([], node);
        for (const parentNodeName of parentNodesNames) {
          if (!newselectedNodesByName.includes(parentNodeName)) newselectedNodesByName.push(parentNodeName);
        }
      }
    }
  };

  const onNodeExpanded = (nodeName: string) => {
    console.log("toggled", nodeName);
    const currentName = nodeName;
    // const expandedByName = Array.from(props.treeState.selectedIds.values())
    //   .map((id) => data.find((node) => node.id == id)?.name)
    //   .filter((name): name is string => !!name);

    let newExpandedNodesByName = [...expandedNodesByName];
    if (expandedNodesByName.includes(currentName))
      newExpandedNodesByName = newExpandedNodesByName.filter((name) => name != currentName);
    else newExpandedNodesByName.push(currentName);

    for (const nodeName of [...newExpandedNodesByName]) {
      const node = data.find((node) => node.name == nodeName);
      if (node) {
        const parentNodesNames = getParentNodeNames([], node);
        for (const parentNodeName of parentNodesNames) {
          if (!newExpandedNodesByName.includes(parentNodeName)) newExpandedNodesByName.push(parentNodeName);
        }
      }
    }

    setExpandedNodesByName(newExpandedNodesByName);
  };

  const onNodeToggled = (nodeName: string) => {
    console.log("toggled", nodeName);
    const currentName = nodeName;
    // const expandedByName = Array.from(props.treeState.selectedIds.values())
    //   .map((id) => data.find((node) => node.id == id)?.name)
    //   .filter((name): name is string => !!name);

    let newselectedNodesByName = [...selectedNodesByName];
    if (selectedNodesByName.includes(currentName))
      newselectedNodesByName = newselectedNodesByName.filter((name) => name != currentName);
    else newselectedNodesByName.push(currentName);

    for (const nodeName of [...newselectedNodesByName]) {
      const node = data.find((node) => node.name == nodeName);
      if (node) {
        const parentNodesNames = getParentNodeNames([], node);
        for (const parentNodeName of parentNodesNames) {
          if (!newselectedNodesByName.includes(parentNodeName)) newselectedNodesByName.push(parentNodeName);
        }
      }
    }

    console.log("SELECTED NODES ARE NOW:", newselectedNodesByName);
    setSelectedNodesByName(newselectedNodesByName);
  };

  const selectedIds = [...selectedNodesByName, rootNode.name]
    .map((name) => data.find((node) => node.name == name)?.id)
    .filter((id): id is number => !!id);

  const expandedIds = [...expandedNodesByName, rootNode.name]
    .map((name) => data.find((node) => node.name == name)?.id)
    .filter((id): id is number => !!id);

  const onFilterChange = (e: React.ChangeEvent<HTMLInputElement>, nodeName: string) => {
    console.log("textbox change:", e.target.value, nodeName);
    nodeNameToRenameValue[nodeName] = e.target.value;
    setNodeNameToRenameValue(structuredClone(nodeNameToRenameValue));
    e.stopPropagation();
    e.preventDefault();
  };

  const onFocusChange = (e: React.FocusEvent<HTMLInputElement, Element>, node: INode) => {
    console.log("new focus:", e.relatedTarget?.tagName);
    if (e.relatedTarget?.tagName == "INPUT") return;
    e.target.focus();
  };

  const onInputClick = (e: React.MouseEvent<HTMLInputElement, MouseEvent>): void => {
    e.stopPropagation();
    e.preventDefault();
  };

  const needsWarningBorder = (nodeName: string) => {
    if (!selectedNodesByName.includes(nodeName)) return false;

    return (
      !nodeNameToRenameValue[nodeName] ||
      nodeNameToRenameValue[nodeName] == defaultNodeNameToRenameValue[nodeName]
    );
  };

  const isSavingPossible = () => {
    // const selecedNodesWithRootNode = [...selectedNodesByName, rootNode.name];

    for (const node of selectedNodesByName) {
      console.log("node is", node, nodeNameToRef[node], nodeNameToRenameValue[node]);
    }

    return !selectedNodesByName.some(
      (nodeName) =>
        !nodeNameToRenameValue[nodeName] ||
        nodeNameToRenameValue[nodeName] == defaultNodeNameToRenameValue[nodeName] ||
        nodeNameToRenameValue[nodeName] == ""
    );
  };

  const onSave = () => {
    console.log("SAVING");

    // const selecedNodesWithRootNode = [...selectedNodesByName, rootNode.name];

    if (!isSavingPossible()) {
      console.log("Cannot save with default value");
      return;
    }

    window.api?.executeDBDuplication(
      packData.packPath,
      selectedNodesByName,
      nodeNameToRef,
      nodeNameToRenameValue
    );

    // dispatch(setDeepCloneTarget(undefined));

    for (const node of selectedNodesByName) {
      console.log("node is", node, nodeNameToRef[node]);
    }
  };

  return (
    <>
      <div className="absolute right-8 top-24">
        <button
          id="continueGame"
          className={`bg-green-600 border-green-500 border-2 hover:bg-green-700 text-white font-medium text-sm px-4 rounded h-8 w-24 m-auto ${
            (!isSavingPossible() &&
              "bg-opacity-50 hover:bg-opacity-50 text-opacity-50 hover:text-opacity-50 cursor-not-allowed") ||
            ""
          }`}
          onClick={() => onSave()}
          disabled={!isSavingPossible()}
        >
          <div className="make-tooltip-w-full">
            <Tooltip placement="left" content={"TODO"}>
              <span className="ml-[-25%]">{"Save"}</span>
            </Tooltip>
          </div>
        </button>
      </div>
      <div>Cloning {toClone.resolvedKeyValue}</div>
      <div className="checkbox dark:text-gray-300">
        <TreeView
          key={hash(folder) + hash(selectedNodesByName)}
          data={data}
          aria-label="Checkbox tree"
          onSelect={(props) => onTreeExpand(props)}
          selectedIds={selectedIds}
          expandedIds={expandedIds}
          nodeRenderer={({
            element,
            isBranch,
            isExpanded,
            isSelected,
            isHalfSelected,
            getNodeProps,
            level,
            handleSelect,
            handleExpand,
          }) => {
            return (
              <div
                onClick={(e) => {
                  // handleSelect(e);
                  onNodeExpanded(element.name);
                  e.stopPropagation();
                }}
                // {...getNodeProps({ onClick: handleExpand })}
                style={{ marginLeft: 40 * (level - 1) }}
                className="flex items-center"
              >
                {isBranch && <ArrowIcon isOpen={isExpanded} />}
                <CheckBoxIcon
                  className={`checkbox-icon scale-125 ${!isBranch && "!ml-[26px]"}`}
                  onClick={(e) => {
                    // handleSelect(e);
                    onNodeToggled(element.name);
                    e.stopPropagation();
                  }}
                  variant={isHalfSelected ? "some" : isSelected ? "all" : "none"}
                />
                <span className="name">{element.name}</span>
                <span className="flex items-center">
                  <span className="text-slate-100 ml-4">
                    <FaArrowRight></FaArrowRight>
                  </span>
                  <span className="relative">
                    <input
                      onClick={(e) => onInputClick(e)}
                      onBlur={(e) => onFocusChange(e, element)}
                      id="filterInput"
                      type="text"
                      onChange={(e) => onFilterChange(e, element.name)}
                      defaultValue={
                        nodeNameToRenameValue[element.name] ?? defaultNodeNameToRenameValue[element.name]
                      }
                      className={`ml-4 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 ${
                        needsWarningBorder(element.name) ? "!border-yellow-300" : ""
                      }`}
                    ></input>
                  </span>
                </span>
              </div>
            );
          }}
        />
      </div>
    </>
  );
});

const ArrowIcon = ({ isOpen, className }: { isOpen: boolean; className?: string }) => {
  const baseClass = "arrow";
  const classes = cx(
    baseClass,
    { [`${baseClass}--closed`]: !isOpen },
    { [`${baseClass}--open`]: isOpen },
    className
  );
  return <IoMdArrowDropright className={classes} />;
};

type CheckBoxItemProps = { variant: string } & IconBaseProps;
const CheckBoxIcon = ({ variant, ...rest }: CheckBoxItemProps) => {
  switch (variant) {
    case "all":
      return <FaCheckSquare {...rest} />;
    case "none":
      return <FaSquare {...rest} />;
    case "some":
      return <FaMinusSquare {...rest} />;
    default:
      return null;
  }
};

export default DBDuplication;
