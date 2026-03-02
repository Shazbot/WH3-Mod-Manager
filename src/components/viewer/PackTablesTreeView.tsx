import React, { useEffect, useImperativeHandle, useMemo } from "react";
import { useAppSelector } from "../../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "@silevis/reactgrid/styles.css";
import { getDBNameFromString, getDBSubnameFromString } from "../../utility/packFileHelpers";
import { gameToPackWithDBTablesName } from "../../supportedGames";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";
import type { PackedFile } from "../../packFileTypes";

type PackTablesTreeViewProps = {
  tableFilter: string;
  onOpenDBTable: (selection: DBTableSelection, options?: { forceNewTab?: boolean }) => void;
  onOpenFlowFile: (
    selection: { flowFile: string; packPath: string },
    options?: { forceNewTab?: boolean },
  ) => void;
};

	type TreeData = { name: string; children?: TreeData[] };

	export type PackTablesTreeViewHandle = {
	  openNewFlowDialog: () => void;
	};

	const PackTablesTreeView = React.memo(
	  React.forwardRef<PackTablesTreeViewHandle, PackTablesTreeViewProps>((props: PackTablesTreeViewProps, ref) => {
	    const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
	    const currentGame = useAppSelector((state) => state.app.currentGame);
	    const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);
    const selectCurrentPackUnsavedFiles = useMemo(makeSelectCurrentPackUnsavedFiles, []);

    const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
    const [isNewFlowDialogOpen, setIsNewFlowDialogOpen] = React.useState(false);
    const [newFlowName, setNewFlowName] = React.useState("");
    const pendingOpenTimeoutRef = React.useRef<number | null>(null);
    const [selectedNodeIds, setSelectedNodeIds] = React.useState<Array<string | number>>([]);
    const lastLabelSelectionModeRef = React.useRef<"single" | "shift" | "ctrl" | null>(null);
    const [isExportingSelection, setIsExportingSelection] = React.useState(false);

    useImperativeHandle(ref, () => ({
      openNewFlowDialog: () => {
        setContextMenu(null);
        setIsNewFlowDialogOpen(true);
      },
    }));

    const packPath =
      currentDBTableSelection?.packPath ?? (gameToPackWithDBTablesName[currentGame] || "db.pack");
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

    // Clean up stale selectedNodeIds when tree data changes
    useEffect(() => {
      const validIds = new Set(data.map((node) => node.id));
      setSelectedNodeIds((prevSelectedIds) =>
        (() => {
          const nextSelectedIds = prevSelectedIds.filter((selectedId) => validIds.has(selectedId));
          const isSameSelection =
            nextSelectedIds.length === prevSelectedIds.length &&
            nextSelectedIds.every((selectedId, index) => selectedId === prevSelectedIds[index]);
          return isSameSelection ? prevSelectedIds : nextSelectedIds;
        })(),
      );
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

    const getDBSelectionForElement = (element: INode) => {
      if (element.children && element.children.length > 0) return;

      // Root-level DB entries (e.g. unsaved files) may contain the full path in the node name.
      const rootLevelDBName = getDBNameFromString(element.name);
      const rootLevelDBSubname = getDBSubnameFromString(element.name);
      if (rootLevelDBName && rootLevelDBSubname) {
        return {
          packPath: packData!.packPath,
          dbName: rootLevelDBName,
          dbSubname: rootLevelDBSubname,
        } as DBTableSelection;
      }

      if (!element.parent) return;
      const parentLeaf = nodeById.get(element.parent);
      if (!parentLeaf || !parentLeaf.name) return;
      return {
        packPath: packData!.packPath,
        dbName: parentLeaf.name,
        dbSubname: element.name,
      } as DBTableSelection;
    };

    const getPackedFileForDBSelection = (selection: DBTableSelection): PackedFile | undefined => {
      if (!packData?.packedFiles) return undefined;
      const packedFilePath = `db\\${selection.dbName}\\${selection.dbSubname}`;
      if (packData.packedFiles[packedFilePath]) {
        return packData.packedFiles[packedFilePath];
      }

      for (const [iterPackedFilePath, iterPackedFile] of Object.entries(packData.packedFiles)) {
        if (iterPackedFilePath.startsWith(packedFilePath)) {
          return iterPackedFile;
        }
      }

      return undefined;
    };

    const sanitizeTsvCell = (value: unknown) =>
      String(value ?? "")
        .replace(/\t/g, " ")
        .replace(/\r?\n/g, " ");

    const buildTsvContentForDBSelection = (selection: DBTableSelection) => {
      const packedFile = getPackedFileForDBSelection(selection);
      if (!packedFile?.schemaFields || !packedFile.tableSchema) return;

      const schema = packedFile.tableSchema;
      if (!schema.fields?.length) return;

      const rows =
        packedFile.schemaFields.reduce<any[][]>((resultArray, item, index) => {
          const chunkIndex = Math.floor(index / schema.fields.length);
          if (!resultArray[chunkIndex]) resultArray[chunkIndex] = [];
          resultArray[chunkIndex].push(item);
          return resultArray;
        }, []) || [];

      const columnNames = schema.fields.map((field) => field.name);
      const packedFilePathForward = `db/${selection.dbName}/${selection.dbSubname}`;
      const version = packedFile.version ?? schema.version ?? 0;

      const tsvLines: string[] = [];
      tsvLines.push(columnNames.join("\t"));
      tsvLines.push(`#${selection.dbName};${version};${packedFilePathForward}`);

      for (const row of rows) {
        const rowValues = row.map((cell: any) => {
          if (cell?.type === "Boolean") return sanitizeTsvCell(cell?.resolvedKeyValue != "0");
          if (cell?.type === "OptionalStringU8" && cell?.resolvedKeyValue === "0") return "";
          return sanitizeTsvCell(cell?.resolvedKeyValue);
        });
        tsvLines.push(rowValues.join("\t"));
      }

      return tsvLines.join("\n");
    };

	    const selectedDBTableSelections = useMemo(() => {
	      if (!packData) return [];
	      if (!contextMenu && !isExportingSelection) return [];

	      const dedupedSelections = new Map<string, DBTableSelection>();
	      for (const selectedId of selectedNodeIds) {
	        const node = nodeById.get(selectedId);
	        if (!node) continue;
	        const selection = getDBSelectionForElement(node);
	        if (!selection) continue;
	        dedupedSelections.set(`${selection.packPath}|${selection.dbName}|${selection.dbSubname}`, selection);
	      }

	      return Array.from(dedupedSelections.values()).filter((selection) => {
	        const packedFile = getPackedFileForDBSelection(selection);
	        return Boolean(packedFile?.schemaFields && packedFile?.tableSchema);
	      });
	    // eslint-disable-next-line react-hooks/exhaustive-deps
	    }, [selectedNodeIds, nodeById, packData, contextMenu, isExportingSelection]);

	    const getDescendantLeafIds = (element: INode): Array<string | number> => {
	      const result: Array<string | number> = [];
	      const stack: INode[] = [element];

	      while (stack.length > 0) {
	        const currentNode = stack.pop();
	        if (!currentNode) break;

	        const children = currentNode.children;
	        if (!children || children.length === 0) {
	          if (currentNode.id !== 0) {
	            result.push(currentNode.id as string | number);
	          }
	          continue;
	        }

	        // Keep traversal stable-ish by pushing in reverse.
	        for (let i = children.length - 1; i >= 0; i--) {
	          const childNode = nodeById.get(children[i]);
	          if (childNode) stack.push(childNode);
	        }
	      }

	      return result;
	    };

    const addIdsToSelection = (idsToAdd: Array<string | number>) => {
      if (idsToAdd.length === 0) return;
      setSelectedNodeIds((prevSelectedIds) => {
        const nextSelectedIds = new Set(prevSelectedIds);
        idsToAdd.forEach((id) => nextSelectedIds.add(id));
        return [...nextSelectedIds];
      });
    };

    const toggleIdsInSelection = (idsToToggle: Array<string | number>) => {
      if (idsToToggle.length === 0) return;
      setSelectedNodeIds((prevSelectedIds) => {
        const nextSelectedIds = new Set(prevSelectedIds);
        const allAlreadySelected = idsToToggle.every((id) => nextSelectedIds.has(id));
        if (allAlreadySelected) {
          idsToToggle.forEach((id) => nextSelectedIds.delete(id));
        } else {
          idsToToggle.forEach((id) => nextSelectedIds.add(id));
        }
        return [...nextSelectedIds];
      });
    };

	    const onTreeSelect = (selectionProps: ITreeViewOnSelectProps) => {
	      if (lastLabelSelectionModeRef.current === "single") {
	        setSelectedNodeIds([selectionProps.element.id as string | number]);
	      } else if (lastLabelSelectionModeRef.current == null) {
	        setSelectedNodeIds([...selectionProps.treeState.selectedIds]);
	      }
	      lastLabelSelectionModeRef.current = null;

      if (!packData) return;

      if (selectionProps.element.name.startsWith("whmmflows\\")) {
        if (pendingOpenTimeoutRef.current != null) {
          window.clearTimeout(pendingOpenTimeoutRef.current);
        }
        pendingOpenTimeoutRef.current = window.setTimeout(() => {
          pendingOpenTimeoutRef.current = null;
          props.onOpenFlowFile({ flowFile: selectionProps.element.name, packPath: packData.packPath });
        }, 180);
        return;
      }

      if (
        selectionProps.isSelected &&
        selectionProps.element.parent &&
        selectionProps.element.children &&
        selectionProps.element.children.length < 1
      ) {
        const dbSelection = getDBSelectionForElement(selectionProps.element);
        if (dbSelection) {
          if (pendingOpenTimeoutRef.current != null) {
            window.clearTimeout(pendingOpenTimeoutRef.current);
          }
          pendingOpenTimeoutRef.current = window.setTimeout(() => {
            pendingOpenTimeoutRef.current = null;
            props.onOpenDBTable(dbSelection);
          }, 180);
        }
      }
    };

    const handleOpenInNewTab = (element: INode) => {
      if (!packData) return;
      if (pendingOpenTimeoutRef.current != null) {
        window.clearTimeout(pendingOpenTimeoutRef.current);
        pendingOpenTimeoutRef.current = null;
      }
      if (element.name.startsWith("whmmflows\\")) {
        props.onOpenFlowFile({ flowFile: element.name, packPath: packData.packPath }, { forceNewTab: true });
        return;
      }

      const dbSelection = getDBSelectionForElement(element);
      if (dbSelection) {
        props.onOpenDBTable(dbSelection, { forceNewTab: true });
      }
    };

    // Cleanup pending timeout on unmount
    useEffect(() => {
      return () => {
        if (pendingOpenTimeoutRef.current != null) {
          window.clearTimeout(pendingOpenTimeoutRef.current);
        }
      };
    }, []);

    const ArrowIcon = ({ isOpen, className }: { isOpen: boolean; className: string }) => {
      const baseClass = "arrow";
      const classes = cx(
        baseClass,
        { [`${baseClass}--closed`]: !isOpen },
        { [`${baseClass}--open`]: isOpen },
        { [`rotate-90`]: isOpen },
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

    // Close context menu when clicking outside
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

    const handleExportSelectedAsTSV = async () => {
      if (selectedDBTableSelections.length === 0 || isExportingSelection) return;

      setContextMenu(null);
      setIsExportingSelection(true);
      try {
        const outputDirectory = await window.api?.selectDirectory();
        if (!outputDirectory) return;

        const exportFiles = selectedDBTableSelections
          .map((selection) => {
            const content = buildTsvContentForDBSelection(selection);
            if (!content) return undefined;
            return {
              relativePath: `db/${selection.dbName}/${selection.dbSubname}.tsv`,
              content,
            };
          })
          .filter((file): file is { relativePath: string; content: string } => Boolean(file));

        if (exportFiles.length === 0) {
          alert("No exportable DB tables selected");
          return;
        }

        const result = await window.api?.writeTextFilesToDirectory(outputDirectory, exportFiles);

        if (!result?.success) {
          alert(`Failed to export TSV files: ${result?.error || "Unknown error"}`);
          return;
        }

        alert(`Exported ${exportFiles.length} TSV file(s) to: ${outputDirectory}`);
      } catch (error) {
        console.error("Error exporting selected tables as TSV:", error);
        alert(`Error exporting TSV files: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
        setIsExportingSelection(false);
      }
    };

    const handleCreateNewFlow = async () => {
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
        const result = await window.api?.saveNodeFlow(newFlowName, flowData, packData!.packPath);
        if (result?.success) {
          console.log("Flow created successfully at:", result.filePath);
        } else {
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
      <div onContextMenu={handleContextMenu} className="relative select-none">
        <TreeView
          data={data}
          aria-label="Controlled expanded node tree"
          multiSelect={true}
          selectedIds={selectedNodeIds}
          onSelect={(props) => onTreeSelect(props)}
          nodeRenderer={({
            element,
            isBranch,
            isExpanded,
            isSelected,
            isDisabled,
            getNodeProps,
            level,
            handleExpand,
            handleSelect,
	          }) => {
	            const handleLabelClick = (e: React.MouseEvent<HTMLSpanElement>) => {
	              // Prevent click bubbling to ancestor branch wrappers; otherwise clicking a child can toggle/select its parents.
	              e.stopPropagation();
	              if (e.shiftKey) {
	                lastLabelSelectionModeRef.current = "shift";
	                e.preventDefault();
	                if (pendingOpenTimeoutRef.current != null) {
	                  window.clearTimeout(pendingOpenTimeoutRef.current);
	                  pendingOpenTimeoutRef.current = null;
	                }

                const idsToSelect = isBranch
                  ? getDescendantLeafIds(element)
                  : [element.id as string | number];
                addIdsToSelection(idsToSelect);
                lastLabelSelectionModeRef.current = null;
                return;
              }

	              if (e.ctrlKey || e.metaKey) {
	                lastLabelSelectionModeRef.current = "ctrl";
	                e.preventDefault();
	                if (pendingOpenTimeoutRef.current != null) {
	                  window.clearTimeout(pendingOpenTimeoutRef.current);
	                  pendingOpenTimeoutRef.current = null;
	                }

                const idsToToggle = isBranch
                  ? getDescendantLeafIds(element)
                  : [element.id as string | number];
                toggleIdsInSelection(idsToToggle);
                lastLabelSelectionModeRef.current = null;
                return;
	              }

	              lastLabelSelectionModeRef.current = "single";
	              setSelectedNodeIds([element.id as string | number]);
	              handleSelect(e);
	              if (isBranch) {
	                handleExpand(e);
	              }
	            };

	            return (
	              <div
	                {...getNodeProps({
	                  onClick: (e) => {
	                    e.stopPropagation();
	                    handleExpand(e);
	                  },
	                })}
	                style={{
	                  marginLeft: 40 * (level - 1),
	                  opacity: isDisabled ? 0.5 : 1,
	                }}
                className={
                  "flex items-center [&:not(:first-child)]:mt-2 hover:overflow-visible cursor-pointer rounded " +
                  (isSelected ? "bg-gray-700/60 " : "") +
                  "hover:underline " +
                  (isTreeNodeFiltered(element) ? "hidden" : "")
                }
              >
                {isBranch && <ArrowIcon className="" isOpen={isExpanded} />}
                <span
                  onClick={handleLabelClick}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleOpenInNewTab(element);
                  }}
                  className="relative select-none"
                >
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
            {selectedDBTableSelections.length > 0 && (
              <button
                onClick={handleExportSelectedAsTSV}
                disabled={isExportingSelection}
                className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm disabled:opacity-50"
              >
                {isExportingSelection
                  ? "Exporting TSV..."
                  : `Export ${selectedDBTableSelections.length} file${
                      selectedDBTableSelections.length === 1 ? "" : "s"
                    } as TSV`}
              </button>
            )}
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
  }),
);

export default PackTablesTreeView;
