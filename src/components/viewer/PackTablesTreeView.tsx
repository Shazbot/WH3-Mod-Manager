import React, { useEffect, useImperativeHandle, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "@silevis/reactgrid/styles.css";
import { getDBNameFromString, getDBSubnameFromString } from "../../utility/packFileHelpers";
import { selectDBTable, selectFlowFile } from "../../appSlice";
import { gameToPackWithDBTablesName } from "../../supportedGames";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";

type PackTablesTreeViewProps = {
  tableFilter: string;
};

type TreeData = { name: string; children?: TreeData[] };

export type PackTablesTreeViewHandle = {
  openNewFlowDialog: () => void;
};

const PackTablesTreeView = React.memo(
  React.forwardRef<PackTablesTreeViewHandle, PackTablesTreeViewProps>((props: PackTablesTreeViewProps, ref) => {
    const dispatch = useAppDispatch();
    const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
    const currentGame = useAppSelector((state) => state.app.currentGame);

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
    const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);
    const selectCurrentPackUnsavedFiles = useMemo(makeSelectCurrentPackUnsavedFiles, []);
    const packData = useAppSelector((state) => selectCurrentPackData(state, packPath));
    const unsavedFiles = useAppSelector((state) => selectCurrentPackUnsavedFiles(state, packPath));

    const data = useMemo(() => {
      if (!packData) {
        return flattenTree({ name: "", children: [] });
      }

      const sortedPackTables = packData.tables.toSorted((first, second) => first.localeCompare(second));
      const root: TreeData = { name: "", children: [] };
      const dbNodes = new Map<string, TreeData>();

      for (const packFileName of sortedPackTables) {
        const dbName = getDBNameFromString(packFileName);
        const dbSubname = getDBSubnameFromString(packFileName);
        if (!dbName || !dbSubname) continue;

        let dbNode = dbNodes.get(dbName);
        if (!dbNode) {
          dbNode = { name: dbName, children: [] };
          dbNodes.set(dbName, dbNode);
          root.children?.push(dbNode);
        }
        dbNode.children?.push({ name: dbSubname, children: [] });
      }

      if (unsavedFiles.length > 0) {
        for (const unsavedFile of unsavedFiles.toReversed()) {
          root.children?.splice(0, 0, { name: unsavedFile.name, children: [] });
        }
      }

      const unsavedFlowNames = new Set(unsavedFiles.map((unsavedFile) => unsavedFile.name));
      const flowFiles = packData.tables.filter((tableName) => tableName.startsWith("whmmflows\\"));
      for (const flowFile of flowFiles) {
        if (unsavedFlowNames.has(flowFile)) continue;
        root.children?.splice(0, 0, { name: flowFile, children: [] });
      }

      return flattenTree(root);
    }, [packData, unsavedFiles]);

    const nodeById = useMemo(() => {
      const idToNode = new Map<INode["id"], INode>();
      for (const node of data) {
        idToNode.set(node.id, node);
      }
      return idToNode;
    }, [data]);

    const normalizedFilter = props.tableFilter.toLowerCase().trim();

    const hiddenNodeIds = useMemo(() => {
      if (normalizedFilter === "") return new Set<INode["id"]>();

      const matchedIds: Array<INode["id"]> = [];
      for (const node of data) {
        if (node.name.toLowerCase().includes(normalizedFilter)) {
          matchedIds.push(node.id);
        }
      }

      const visibleNodeIds = new Set<INode["id"]>();
      const traversedDescendants = new Set<INode["id"]>();

      for (const matchedId of matchedIds) {
        let iterNode: INode | undefined = nodeById.get(matchedId);
        while (iterNode) {
          visibleNodeIds.add(iterNode.id);
          if (iterNode.parent == null) break;
          iterNode = nodeById.get(iterNode.parent);
        }

        const stack = [matchedId];
        while (stack.length > 0) {
          const currentId = stack.pop();
          if (currentId == null || traversedDescendants.has(currentId)) continue;
          traversedDescendants.add(currentId);
          visibleNodeIds.add(currentId);

          const currentNode = nodeById.get(currentId);
          if (!currentNode) continue;

          for (const childId of currentNode.children) {
            stack.push(childId);
          }
        }
      }

      const hiddenNodes = new Set<INode["id"]>();
      for (const node of data) {
        if (!visibleNodeIds.has(node.id)) {
          hiddenNodes.add(node.id);
        }
      }

      return hiddenNodes;
    }, [data, nodeById, normalizedFilter]);

    const onTreeSelect = (selectionProps: ITreeViewOnSelectProps) => {
      if (!packData) return;

      if (selectionProps.element.name.startsWith("whmmflows\\")) {
        dispatch(selectFlowFile({ flowFile: selectionProps.element.name, packPath: packData.packPath }));
        return;
      }

      if (
        !selectionProps.isSelected ||
        selectionProps.element.parent == null ||
        !selectionProps.element.children ||
        selectionProps.element.children.length > 0
      ) {
        return;
      }

      const parentLeaf = nodeById.get(selectionProps.element.parent);
      if (!parentLeaf) return;

      const dbName = parentLeaf.name;
      const dbSubname = selectionProps.element.name;
      const nextSelection: DBTableSelection = {
        packPath: packData.packPath,
        dbName,
        dbSubname,
      };

      const isSameSelection =
        currentDBTableSelection?.packPath === nextSelection.packPath &&
        currentDBTableSelection?.dbName === nextSelection.dbName &&
        currentDBTableSelection?.dbSubname === nextSelection.dbSubname;

      if (isSameSelection) return;

      const tablePathPrefix = `db\\${dbName}\\${dbSubname}`;
      const hasLoadedTable =
        !!packData.packedFiles &&
        Object.keys(packData.packedFiles).some((packedFilePath) => packedFilePath.startsWith(tablePathPrefix));

      if (!hasLoadedTable) {
        window.api?.getPackData(nextSelection.packPath, { dbName, dbSubname });
      }
      dispatch(selectFlowFile(undefined));
      dispatch(selectDBTable(nextSelection));
    };

    const ArrowIcon = ({ isOpen, className }: { isOpen: boolean; className: string }) => {
      const baseClass = "arrow";
      const classes = cx(
        baseClass,
        { [`${baseClass}--closed`]: !isOpen },
        { [`${baseClass}--open`]: isOpen },
        { "rotate-90": isOpen },
        className,
        "w-4",
        "h-4",
      );
      return (
        <span className="w-4 h-4">
          <IoMdArrowDropright size={"100%"} className={classes} />
        </span>
      );
    };

    const isTreeNodeFiltered = (element: INode): boolean => {
      if (normalizedFilter === "") return false;
      return hiddenNodeIds.has(element.id);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
      const handleClick = () => setContextMenu(null);
      if (contextMenu) {
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
      }
    }, [contextMenu]);

    const handleAddNewFlow = () => {
      setContextMenu(null);
      setIsNewFlowDialogOpen(true);
    };

    const handleCreateNewFlow = async () => {
      if (!packData) return;

      if (!newFlowName.trim()) {
        alert("Please enter a valid flow name");
        return;
      }

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
        if (!result?.success) {
          console.error("Failed to create flow:", result?.error);
        }
      } catch (error) {
        console.error("Error creating flow:", error);
      }

      setIsNewFlowDialogOpen(false);
      setNewFlowName("");
    };

    if (!packData) {
      return <></>;
    }

    return (
      <div onContextMenu={handleContextMenu} className="relative">
        <TreeView
          data={data}
          aria-label="Controlled expanded node tree"
          onSelect={(selectionProps) => onTreeSelect(selectionProps)}
          nodeRenderer={({ element, isBranch, isExpanded, isDisabled, getNodeProps, level, handleExpand, handleSelect }) => {
            return (
              <div
                {...getNodeProps({ onClick: handleExpand })}
                style={{
                  marginLeft: 40 * (level - 1),
                  opacity: isDisabled ? 0.5 : 1,
                }}
                className={
                  "flex items-center [&:not(:first-child)]:mt-2 hover:overflow-visible hover:underline cursor-pointer " +
                  (isTreeNodeFiltered(element) ? "hidden" : "")
                }
              >
                {isBranch && <ArrowIcon className="" isOpen={isExpanded} />}
                <span onClick={(e) => handleSelect(e)} className="relative">
                  {element.name}
                </span>
              </div>
            );
          }}
        />

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
  }),
);

export default PackTablesTreeView;
