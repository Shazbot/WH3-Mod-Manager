import React, { useImperativeHandle } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "@silevis/reactgrid/styles.css";
import { getDBNameFromString, getDBSubnameFromString } from "../../utility/packFileHelpers";
import { selectDBTable, selectFlowFile } from "../../appSlice";
import { gameToPackWithDBTablesName } from "../../supportedGames";

type PackTablesTreeViewProps = {
  tableFilter: string;
};

export type PackTablesTreeViewHandle = {
  openNewFlowDialog: () => void;
};

const PackTablesTreeView = React.memo(
  React.forwardRef<PackTablesTreeViewHandle, PackTablesTreeViewProps>((props: PackTablesTreeViewProps, ref) => {
  const dispatch = useAppDispatch();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const currentGame = useAppSelector((state) => state.app.currentGame);

  const packsData = useAppSelector((state) => state.app.packsData);
  const unsavedPacksData = useAppSelector((state) => state.app.unsavedPacksData);

  // Context menu state
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [isNewFlowDialogOpen, setIsNewFlowDialogOpen] = React.useState(false);
  const [newFlowName, setNewFlowName] = React.useState("");

  useImperativeHandle(ref, () => ({
    openNewFlowDialog: () => {
      setContextMenu(null);
      setIsNewFlowDialogOpen(true);
    },
  }));

  const packPath =
    currentDBTableSelection?.packPath ?? (gameToPackWithDBTablesName[currentGame] || "db.pack");
  const packData = packsData[packPath];

  // const packData = currentPackData.data;
  if (!packData) {
    console.log("PackTablesTreeView: no pack data");
    return <></>;
  }

  // console.log("TreeView packsData:", packData);

  type TreeData = { name: string; children?: TreeData[] };
  const result = packData.tables
    .toSorted((firstPackFileName, secondPackFileName) => {
      return firstPackFileName.localeCompare(secondPackFileName);
    })
    .reduce(
      (map, packFileName) => {
        const dbName = getDBNameFromString(packFileName);
        const dbSubname = getDBSubnameFromString(packFileName);

        if (dbName && dbSubname) {
          if (typeof map.children === "undefined") {
            map.children = [];
          }
          map.children = map.children || [];
          const existingNode = map.children.find((node) => node.name == dbName);
          if (existingNode) existingNode.children?.push({ name: dbSubname, children: [] });
          else map.children.push({ name: dbName, children: [{ name: dbSubname, children: [] }] });
        }
        return map;
      },
      { name: "", children: [] } as TreeData
    );

  const unsavedFiles = unsavedPacksData[packPath];
  if (unsavedFiles) {
    for (const unsavedFile of unsavedFiles.toReversed()) {
      result.children?.splice(0, 0, { name: unsavedFile.name, children: [] });
    }
  }

  for (const flowFile of packData.tables.filter((pf) => pf.startsWith("whmmflows\\"))) {
    if (unsavedFiles && unsavedFiles.some((unsavedFile) => unsavedFile.name == flowFile)) continue;

    result.children?.splice(0, 0, { name: flowFile, children: [] });
  }

  // console.log(result);
  const data = flattenTree(result);

  const onTreeSelect = (props: ITreeViewOnSelectProps) => {
    // console.log("ON TREE SELECT");
    // console.log(props);

    if (props.element.name.startsWith("whmmflows\\")) {
      dispatch(selectFlowFile(props.element.name));
      return;
    }

    if (
      props.isSelected &&
      props.element.parent &&
      props.element.children &&
      props.element.children.length < 1
    ) {
      const parentLeaf = data.find((leaf) => leaf.id == props.element.parent);
      if (parentLeaf) {
        const packPath = packData.packPath;
        const dbName = parentLeaf.name;
        const dbSubname = props.element.name;
        console.log(`SENT GET PACK DATA ${packPath + " " + dbName + " " + dbSubname}}`);
        window.api?.getPackData(packPath, { dbName, dbSubname });
        dispatch(selectFlowFile(undefined));
        dispatch(
          selectDBTable({
            packPath: packData.packPath,
            dbName: parentLeaf.name,
            dbSubname: props.element.name,
          })
        );
      }
    }
  };

  const ArrowIcon = ({ isOpen, className }: { isOpen: boolean; className: string }) => {
    const baseClass = "arrow";
    const classes = cx(
      baseClass,
      { [`${baseClass}--closed`]: !isOpen },
      { [`${baseClass}--open`]: isOpen },
      { [`rotate-90`]: isOpen },
      className,
      "w-4",
      "h-4"
    );
    return (
      <span className="w-4 h-4">
        <IoMdArrowDropright size={"100%"} className={classes} />
      </span>
    );
  };

  const areNodeChildrenShown = (element: INode): boolean => {
    const elementData = data.find((node) => node.id == element.id);
    if (!elementData) return true;
    if (elementData.children.length == 0) return false;

    const childNodes = elementData.children
      .map((childId) => data.find((node) => node.id == childId))
      .filter((id) => id != null);

    const res = childNodes.reduce((isShown, currentNode) => {
      if (!currentNode) return isShown;
      return isShown || currentNode.name.includes(props.tableFilter) || areNodeChildrenShown(currentNode);
    }, false);

    return res;
  };

  const isAnyNodeParentShown = (element: INode): boolean => {
    const elementData = data.find((node) => node.id == element.id);
    if (!elementData) return true;
    if (elementData.parent == null) return false;

    let isParentFiltered = false;
    const parentNode = data.find((node) => node.id == element.parent);
    if (parentNode)
      isParentFiltered = parentNode.name.includes(props.tableFilter) || isAnyNodeParentShown(parentNode);

    return isParentFiltered;
  };

  const isTreeNodeFiltered = (element: INode): boolean => {
    if (props.tableFilter == "") return false;

    return !(
      element.name.includes(props.tableFilter) ||
      areNodeChildrenShown(element) ||
      isAnyNodeParentShown(element)
    );
  };

  // Handle right-click to show context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  // Close context menu when clicking outside
  React.useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [contextMenu]);

  // Handle "Add New Flow" action
  const handleAddNewFlow = () => {
    setContextMenu(null);
    setIsNewFlowDialogOpen(true);
  };

  // Handle new flow creation
  const handleCreateNewFlow = async () => {
    if (!newFlowName.trim()) {
      alert("Please enter a valid flow name");
      return;
    }

    // Create an empty flow structure
    const emptyFlow = {
      version: "1.0",
      timestamp: Date.now(),
      nodes: [],
      connections: [],
      metadata: {
        nodeCount: 0,
        connectionCount: 0,
      },
    };

    const flowData = JSON.stringify(emptyFlow, null, 2);

    try {
      const result = await window.api?.saveNodeFlow(newFlowName, flowData, packData.packPath);
      if (result?.success) {
        console.log("Flow created successfully at:", result.filePath);
        // alert(`Flow "${newFlowName}" created successfully!`);
      } else {
        console.error("Failed to create flow:", result?.error);
        // alert(`Failed to create flow: ${result?.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error creating flow:", error);
      // alert(`Error creating flow: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    setIsNewFlowDialogOpen(false);
    setNewFlowName("");
  };

  // console.log("TREE DATA is", data);

  return (
    <div onContextMenu={handleContextMenu} className="relative">
      <TreeView
        data={data}
        aria-label="Controlled expanded node tree"
        onSelect={(props) => onTreeSelect(props)}
        nodeRenderer={({
          element,
          isBranch,
          isExpanded,
          isDisabled,
          getNodeProps,
          level,
          handleExpand,
          handleSelect,
        }) => {
          return (
            <div
              {...getNodeProps({ onClick: handleExpand })}
              style={{
                marginLeft: 40 * (level - 1),
                opacity: isDisabled ? 0.5 : 1,
              }}
              className={
                "flex items-center [&:not(:first-child)]:mt-2 hover:overflow-visible cursor-default " +
                (isTreeNodeFiltered(element) ? "hidden" : "")
              }
            >
              {isBranch && <ArrowIcon className="" isOpen={isExpanded} />}
              <span onClick={(e) => handleSelect(e)} className="relative">
                {/* <span onClick={(e) => handleSelect(e)} className="absolute">
                  {element.name}
                </span> */}
                {element.name}
              </span>
            </div>
          );
        }}
      />

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[150px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={handleAddNewFlow}
            className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm"
          >
            Add New Flow
          </button>
        </div>
      )}

      {/* New Flow Dialog */}
      {isNewFlowDialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-white mb-4">Create New Flow</h2>

            <div className="mb-4">
              <label className="block text-white text-sm font-medium mb-2">Flow Name</label>
              <input
                type="text"
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateNewFlow();
                  } else if (e.key === "Escape") {
                    setIsNewFlowDialogOpen(false);
                    setNewFlowName("");
                  }
                }}
                className="w-full p-2 bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-400"
                placeholder="Enter flow name..."
                autoFocus
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setIsNewFlowDialogOpen(false);
                  setNewFlowName("");
                }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNewFlow}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  })
);

export default PackTablesTreeView;
