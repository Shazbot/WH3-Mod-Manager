import React, { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/src/hooks";
import { FaSquare, FaCheckSquare, FaMinusSquare, FaArrowRight } from "react-icons/fa";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "./DBDuplicationStyles.css";
import { IconBaseProps } from "react-icons";
import hash from "object-hash";
import { chunkTableIntoRows } from "./viewerHelpers";
import { packDataStore } from "./packDataStore";
import { getDBPackedFilePath } from "@/src/utility/packFileHelpers";
import { Tooltip } from "flowbite-react";

const findNodeInTree = (
  tree: IViewerTreeNodeWithData | IViewerTreeNode,
  targetName: string
): IViewerTreeNodeWithData | IViewerTreeNode | null => {
  if (tree.name === targetName) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNodeInTree(child, targetName);
      if (found) return found;
    }
  }
  return null;
};

const DBDuplication = React.memo(() => {
  const dispatch = useAppDispatch();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const packsData = useAppSelector((state) => state.app.packsData);
  // important to reload the component
  useAppSelector((state) => state.app.referencesHash);
  const deepCloneTarget = useAppSelector((state) => state.app.deepCloneTarget);
  const packPath = currentDBTableSelection?.packPath ?? "db.pack";

  const [selectedNodesByName, setSelectedNodesByName] = useState<string[]>([]);
  const [expandedNodesByName, setExpandedNodesByName] = useState<string[]>([]);
  const [nodeNameToRenameValue, setNodeNameToRenameValue] = useState<Record<string, string>>({});
  const [treeData, setTreeData] = useState<IViewerTreeNodeWithData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Dispatch event to get indirect references for newly expanded node
  const getIndirectReferences = async (
    newDBTableSelection: DBTableSelection,
    newSelectedNode: IViewerTreeNodeWithData,
    treeData: IViewerTreeNodeWithData
  ) => {
    try {
      const indirectRefsResult = await window.api?.buildDBReferenceTree(
        packPath,
        newDBTableSelection,
        { row: -1, col: -1 },
        [newSelectedNode] // Only get references for this specific node
      );

      if (indirectRefsResult) {
        if (!treeData) {
          console.log("ERROR: no treedata for indirect references");
          return;
        }
        console.log("Indirect references received:", indirectRefsResult);
        // Append the references to existing tree data under the correct node
        const targetNode = findNodeInTree(treeData, newSelectedNode.name);
        if (targetNode && indirectRefsResult.children) {
          if (indirectRefsResult.children.length == 0) return;

          // Merge new children into existing node
          indirectRefsResult.children[0].children.forEach((newChild) => {
            if (!targetNode.children.some((existingChild) => existingChild.name === newChild.name)) {
              (newChild as IViewerTreeNode).isIndirectRef = true;
              targetNode.children.push(newChild);
            }
          });
          setTreeData({ ...treeData }); // Trigger re-render
        }
      } else {
        console.log("ERROR: no indirectRefsResult");
      }
    } catch (error) {
      console.error("Failed to get indirect references:", error);
    }
  };

  // Fetch tree data from backend
  useEffect(() => {
    if (!currentDBTableSelection || !deepCloneTarget) return;

    const buildTree = async () => {
      setIsLoading(true);
      try {
        const treeNodeResult = await window.api?.buildDBReferenceTree(
          packPath,
          {
            dbName: currentDBTableSelection.dbName,
            dbSubname: currentDBTableSelection.dbSubname,
            packPath: currentDBTableSelection.packPath,
          } as DBTableSelection,
          deepCloneTarget,
          []
        );

        if (treeNodeResult) {
          console.log("buildDBReferenceTree RECIEVED", treeNodeResult);
          console.log(
            "currentDBTableSelection:",
            currentDBTableSelection,
            "deepCloneTarget:",
            deepCloneTarget,
            "selectedNodesByName:",
            selectedNodesByName,
            "packPath:",
            packPath
          );
          setTreeData(treeNodeResult);

          if (treeNodeResult.children.length == 0) return;
          const rootNodeData = treeNodeResult.children[0] as IViewerTreeNodeWithData;
          const rootNodeSelection = {
            dbName: rootNodeData.tableName,
            dbSubname: "",
            packPath,
          } as DBTableSelection;
          console.log("get indirect refs");
          getIndirectReferences(rootNodeSelection, rootNodeData, treeNodeResult);
        }
      } catch (error) {
        console.error("Failed to build reference tree:", error);
      } finally {
        setIsLoading(false);
      }
    };

    buildTree();
  }, [currentDBTableSelection, deepCloneTarget, packPath]);
  // }, [currentDBTableSelection, deepCloneTarget, selectedNodesByName, packPath]);

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

  const allTreeChildren: string[] = [];

  console.log(
    "packDataStore:",
    packDataStore[packData.packPath]?.packedFiles
      ?.filter((pf) => pf.name.startsWith("db\\") && pf.schemaFields)
      .map((pf) => pf.name)
  );

  const rootNode = {
    name: `${currentDBTableSelection.dbName} ${field.name} : ${toClone.resolvedKeyValue}`,
    children: [],
  } as ITreeNode;
  folder.children.push(rootNode);
  allTreeChildren.push(rootNode.name);

  if (!treeData) return <></>;

  const data = flattenTree(treeData);

  const nodeNameToData = data.reduce((acc, current) => {
    const treeNode = findNodeInTree(treeData, current.name);
    if (treeNode) {
      acc[current.name] = treeNode as IViewerTreeNodeWithData;
    }
    return acc;
  }, {} as Record<string, IViewerTreeNodeWithData>);

  // console.log("data is", data);
  console.log("SELECTED NODES ARE", selectedNodesByName);
  console.log("EXPANDED NODES ARE", expandedNodesByName);

  nodeNameToData[rootNode.name] = {
    name: rootNode.name,
    children: [],
    tableName: currentDBTableSelection.dbName,
    columnName: field.name,
    value: toClone.resolvedKeyValue,
  };

  const defaultNodeNameToRenameValue = data.reduce((acc, current) => {
    acc[current.name] = (nodeNameToData[current.name] && nodeNameToData[current.name].value) || "";
    return acc;
  }, {} as Record<string, string>);

  console.log("tryign to amend", rows[deepCloneTarget.row][deepCloneTarget.col]);

  // console.log(`currentPackData.data is ${currentPackData.data}`);
  console.log("packDataStore", packDataStore);
  if (packDataStore[packPath]) console.log(packDataStore[packPath].packedFiles.map((pf) => pf.name));

  const getParentNodeNames = (acc: string[], node: INode) => {
    const nodeName = data.find((iterNode) => iterNode.id == node.id)?.name;
    if (nodeName && !acc.some((iterNodeName) => iterNodeName == nodeName)) acc.push(nodeName);
    if (node.parent) getParentNodeNames(acc, data.find((iterNode) => iterNode.id == node.parent) as INode);
    return acc;
  };

  const onTreeSelect = (props: ITreeViewOnSelectProps) => {
    console.log("selected tree node", props.element.name);
    console.log("selectedNodesByName:", selectedNodesByName);
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

    // setSelectedNodesByName(newselectedNodesByName);
  };

  const onNodeExpanded = (nodeName: string) => {
    console.log("expanded tree node", nodeName);
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
    console.log("toggled node", nodeName);
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

    for (const newSelectedNode of newselectedNodesByName) {
      const newNodeData = nodeNameToData[newSelectedNode];
      const newDBTableSelection = {
        dbName: newNodeData.tableName,
        dbSubname: "",
        packPath,
      } as DBTableSelection;

      console.log("find indirect refs for", newSelectedNode);

      getIndirectReferences(newDBTableSelection, newNodeData, treeData);
    }
  };

  const selectedIds = [...selectedNodesByName, rootNode.name]
    .map((name) => data.find((node) => node.name == name)?.id)
    .filter((id): id is number => !!id);

  const expandedIds = [...expandedNodesByName, rootNode.name]
    .map((name) => data.find((node) => node.name == name)?.id)
    .filter((id): id is number => !!id);

  console.log("expandedIds:", expandedIds);

  const onFilterChange = (e: React.ChangeEvent<HTMLInputElement>, nodeName: string) => {
    console.log("textbox change:", e.target.value, nodeName);
    nodeNameToRenameValue[nodeName] = e.target.value;
    setNodeNameToRenameValue(structuredClone(nodeNameToRenameValue));
    e.stopPropagation();
    e.preventDefault();
  };

  const onFocusChange = (e: React.FocusEvent<HTMLInputElement, Element>, node: INode) => {
    // console.log("new focus:", e.relatedTarget?.tagName);
    // if (e.relatedTarget?.tagName == "INPUT") return;
    // e.target.focus();
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
    return true;
    // const selecedNodesWithRootNode = [...selectedNodesByName, rootNode.name];

    for (const node of selectedNodesByName) {
      console.log("node is", node, nodeNameToData[node], nodeNameToRenameValue[node]);
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
      nodeNameToData,
      nodeNameToRenameValue,
      defaultNodeNameToRenameValue
    );

    // dispatch(setDeepCloneTarget(undefined));

    for (const node of selectedNodesByName) {
      console.log("node is", node, nodeNameToData[node]);
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
          key={
            hash(folder) +
            hash(selectedNodesByName) +
            hash(expandedNodesByName) +
            hash(expandedIds) +
            hash(selectedIds)
          }
          data={data}
          aria-label="Checkbox tree"
          onSelect={(props) => onTreeSelect(props)}
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
                <span
                  className={`name ${nodeNameToData[element.name].isIndirectRef ? "text-amber-500" : ""}`}
                >
                  {element.name}
                </span>
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
