import React, { useEffect, useImperativeHandle, useMemo } from "react";
import { setUnsavedPacksData } from "@/src/appSlice";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import Select, { SingleValue } from "react-select";
import cx from "classnames";
import "@silevis/reactgrid/styles.css";
import {
  DEFAULT_DB_TABLE_ROOT,
  UNUSED_DB_TABLE_ROOT,
  getDBPackedFilePath,
  groupDBTablePaths,
  parseDBGroupName,
  parseDBTablePath,
} from "../../utility/packFileHelpers";
import { getAutoExpandedDBGroupIds } from "../../utility/dbTreeExpansion";
import { gameToPackWithDBTablesName, vanillaPackNames } from "../../supportedGames";
import selectStyle from "../../styles/selectStyle";
import { dataFromBackend } from "./packDataStore";
import type { ShowViewerDialog } from "./viewerDialogs";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";
import type { DBVersion, PackedFile } from "../../packFileTypes";
import { isOpenablePackedFilePath } from "@/src/utility/packFileViewing";

type PackTablesTreeViewProps = {
  packPath: string;
  preferredTab: "db" | "files";
  tableFilter: string;
  showDialog: ShowViewerDialog;
  onOpenDBTable: (selection: DBTableSelection, options?: { forceNewTab?: boolean }) => void;
  onOpenFlowFile: (
    selection: { flowFile: string; packPath: string },
    options?: { forceNewTab?: boolean },
  ) => void;
  onOpenPackedFile: (
    selection: { filePath: string; packPath: string },
    options?: { forceNewTab?: boolean },
  ) => void;
};

type TreeData = { name: string; children?: TreeData[] };
type TableOption = { value: string; label: string };

export type PackTablesTreeViewHandle = {
  openNewFlowDialog: () => void;
};

const isDBPackedFileName = (packFileName: string): boolean => parseDBTablePath(packFileName) != undefined;

const HelpBadge: React.FC<{ text: string }> = ({ text }) => (
  <span
    className="px-1 text-[10px] leading-none text-gray-300 border border-gray-500 rounded-full cursor-help select-none"
    title={text}
  >
    ?
  </span>
);

const buildPathTree = (filePaths: string[]): TreeData => {
  const root: TreeData = { name: "", children: [] };

  for (const filePath of filePaths) {
    const segments = filePath.split(/[\\/]/).filter(Boolean);
    let currentNode = root;
    for (const segment of segments) {
      let nextNode = currentNode.children?.find((child) => child.name === segment);
      if (!nextNode) {
        nextNode = { name: segment, children: [] };
        currentNode.children?.push(nextNode);
      }
      currentNode = nextNode;
    }
  }

  const sortChildren = (node: TreeData) => {
    node.children?.sort((first, second) => first.name.localeCompare(second.name));
    node.children?.forEach(sortChildren);
  };

  sortChildren(root);
  return root;
};

const buildNodeById = (data: INode[]) => {
  const idToNode = new Map<INode["id"], INode>();
  for (const node of data) {
    idToNode.set(node.id, node);
  }
  return idToNode;
};

const buildHiddenNodeIds = (data: INode[], nodeById: Map<INode["id"], INode>, normalizedFilter: string) => {
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
};

const getDescendantLeafIds = (element: INode, nodeById: Map<INode["id"], INode>): Array<string | number> => {
  const result: Array<string | number> = [];
  const stack: INode[] = [element];

  while (stack.length > 0) {
    const currentNode = stack.pop();
    if (!currentNode) break;

    if (!currentNode.children || currentNode.children.length === 0) {
      if (currentNode.id !== 0) {
        result.push(currentNode.id as string | number);
      }
      continue;
    }

    for (let i = currentNode.children.length - 1; i >= 0; i--) {
      const childNode = nodeById.get(currentNode.children[i]);
      if (childNode) stack.push(childNode);
    }
  }

  return result;
};

const getNodeFullPath = (element: INode, nodeById: Map<INode["id"], INode>): string => {
  const segments: string[] = [];
  let iterNode: INode | undefined = element;

  while (iterNode && iterNode.id !== 0) {
    if (iterNode.name) {
      segments.unshift(iterNode.name);
    }
    if (iterNode.parent == null) break;
    iterNode = nodeById.get(iterNode.parent);
  }

  return segments.join("\\");
};

const PackTablesTreeView = React.memo(
  React.forwardRef<PackTablesTreeViewHandle, PackTablesTreeViewProps>((props: PackTablesTreeViewProps, ref) => {
    const dispatch = useAppDispatch();
    const currentGame = useAppSelector((state) => state.app.currentGame);
    const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);
    const selectCurrentPackUnsavedFiles = useMemo(makeSelectCurrentPackUnsavedFiles, []);

    const [activeTreeTab, setActiveTreeTab] = React.useState<"db" | "files">(props.preferredTab);
    const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; treeTab: "db" | "files" } | null>(
      null,
    );
    const [isNewFlowDialogOpen, setIsNewFlowDialogOpen] = React.useState(false);
    const [newFlowName, setNewFlowName] = React.useState("");
    const [isNewTableDialogOpen, setIsNewTableDialogOpen] = React.useState(false);
    const [newTableName, setNewTableName] = React.useState("");
    const [newTableSuffix, setNewTableSuffix] = React.useState("");
    /** Create the table parked outside db\, where the game will not load it. */
    const [newTableIsUnused, setNewTableIsUnused] = React.useState(false);
    const [availableTableVersions, setAvailableTableVersions] = React.useState<Record<string, DBVersion[]>>({});
    const [defaultTableVersions, setDefaultTableVersions] = React.useState<Record<string, number>>({});
    const [isLoadingNewTableOptions, setIsLoadingNewTableOptions] = React.useState(false);
    const [isCreatingNewTable, setIsCreatingNewTable] = React.useState(false);
    const pendingOpenTimeoutRef = React.useRef<number | null>(null);
    const [dbSelectedNodeIds, setDbSelectedNodeIds] = React.useState<Array<string | number>>([]);
    const [fileSelectedNodeIds, setFileSelectedNodeIds] = React.useState<Array<string | number>>([]);
    const lastLabelSelectionModeRef = React.useRef<"single" | "shift" | "ctrl" | null>(null);
    const [isExportingSelection, setIsExportingSelection] = React.useState(false);

    useEffect(() => {
      setActiveTreeTab(props.preferredTab);
    }, [props.packPath, props.preferredTab]);

    useImperativeHandle(ref, () => ({
      openNewFlowDialog: () => {
        setContextMenu(null);
        setActiveTreeTab("files");
        setIsNewFlowDialogOpen(true);
      },
    }));

    const packPath = props.packPath || (gameToPackWithDBTablesName[currentGame] || "db.pack");
    const packData = useAppSelector((state) => selectCurrentPackData(state, packPath));
    const unsavedFiles = useAppSelector((state) => selectCurrentPackUnsavedFiles(state, packPath));
    const isVanillaPackOpen = packData ? vanillaPackNames.includes(packData.packName) : false;

    const vanillaTableOptions = useMemo<TableOption[]>(
      () =>
        Object.keys(availableTableVersions)
          .toSorted((first, second) => first.localeCompare(second))
          .map((tableName) => ({ value: tableName, label: tableName })),
      [availableTableVersions],
    );

    const selectedNewTableOption = useMemo(
      () => vanillaTableOptions.find((option) => option.value === newTableName) ?? null,
      [newTableName, vanillaTableOptions],
    );

    const selectedNewTableSchema = useMemo(() => {
      if (!newTableName) return undefined;
      const versions = availableTableVersions[newTableName];
      if (!versions || versions.length === 0) return undefined;
      const defaultVersion = defaultTableVersions[newTableName];
      return versions.find((version) => version.version === defaultVersion) || versions[0];
    }, [availableTableVersions, defaultTableVersions, newTableName]);

    const dbData = useMemo(() => {
      if (!packData) {
        return flattenTree({ name: "", children: [] });
      }

      const root: TreeData = { name: "", children: [] };
      const dbEntriesByName = groupDBTablePaths([
        ...packData.tables,
        ...unsavedFiles.toReversed().map((unsavedFile) => unsavedFile.name),
      ]);

      for (const groupName of [...dbEntriesByName.keys()].toSorted((first, second) =>
        first.localeCompare(second),
      )) {
        const subnames = dbEntriesByName.get(groupName);
        root.children?.push({
          name: groupName,
          children: [...(subnames || [])]
            .toSorted((first, second) => first.localeCompare(second))
            .map((dbSubname) => ({ name: dbSubname, children: [] })),
        });
      }

      return flattenTree(root);
    }, [packData, unsavedFiles]);

    const fileData = useMemo(() => {
      if (!packData) {
        return flattenTree({ name: "", children: [] });
      }

      const fileNames = new Set<string>();
      for (const packFileName of packData.tables) {
        if (!isDBPackedFileName(packFileName)) {
          fileNames.add(packFileName);
        }
      }
      for (const unsavedFile of unsavedFiles) {
        if (!isDBPackedFileName(unsavedFile.name)) {
          fileNames.add(unsavedFile.name);
        }
      }

      return flattenTree(buildPathTree(Array.from(fileNames).toSorted((first, second) => first.localeCompare(second))));
    }, [packData, unsavedFiles]);

    const dbNodeById = useMemo(() => buildNodeById(dbData), [dbData]);
    const dbDefaultExpandedIds = useMemo(() => getAutoExpandedDBGroupIds(dbData), [dbData]);
    const fileNodeById = useMemo(() => buildNodeById(fileData), [fileData]);
    const safeDbSelectedNodeIds = useMemo(
      () => dbSelectedNodeIds.filter((selectedId) => dbNodeById.has(selectedId)),
      [dbNodeById, dbSelectedNodeIds],
    );
    const safeFileSelectedNodeIds = useMemo(
      () => fileSelectedNodeIds.filter((selectedId) => fileNodeById.has(selectedId)),
      [fileNodeById, fileSelectedNodeIds],
    );

    useEffect(() => {
      const validIds = new Set(dbData.map((node) => node.id));
      setDbSelectedNodeIds((prevSelectedIds) =>
        (() => {
          const nextSelectedIds = prevSelectedIds.filter((selectedId) => validIds.has(selectedId));
          const isSameSelection =
            nextSelectedIds.length === prevSelectedIds.length &&
            nextSelectedIds.every((selectedId, index) => selectedId === prevSelectedIds[index]);
          return isSameSelection ? prevSelectedIds : nextSelectedIds;
        })(),
      );
    }, [dbData]);

    useEffect(() => {
      const validIds = new Set(fileData.map((node) => node.id));
      setFileSelectedNodeIds((prevSelectedIds) =>
        (() => {
          const nextSelectedIds = prevSelectedIds.filter((selectedId) => validIds.has(selectedId));
          const isSameSelection =
            nextSelectedIds.length === prevSelectedIds.length &&
            nextSelectedIds.every((selectedId, index) => selectedId === prevSelectedIds[index]);
          return isSameSelection ? prevSelectedIds : nextSelectedIds;
        })(),
      );
    }, [fileData]);

    const normalizedFilter = props.tableFilter.toLowerCase().trim();

    const dbHiddenNodeIds = useMemo(
      () => buildHiddenNodeIds(dbData, dbNodeById, normalizedFilter),
      [dbData, dbNodeById, normalizedFilter],
    );
    const fileHiddenNodeIds = useMemo(
      () => buildHiddenNodeIds(fileData, fileNodeById, normalizedFilter),
      [fileData, fileNodeById, normalizedFilter],
    );

    const getDBSelectionForElement = (element: INode) => {
      if (element.children && element.children.length > 0) return;

      // Root-level DB entries (e.g. unsaved files) may contain the full path in the node name.
      const rootLevelTable = parseDBTablePath(element.name);
      if (rootLevelTable) {
        return {
          packPath: packData!.packPath,
          dbFolder: rootLevelTable.dbFolder,
          dbName: rootLevelTable.dbName,
          dbSubname: rootLevelTable.dbSubname,
        } as DBTableSelection;
      }

      if (!element.parent) return;
      const parentLeaf = dbNodeById.get(element.parent);
      if (!parentLeaf || !parentLeaf.name) return;
      const { dbFolder, dbName } = parseDBGroupName(parentLeaf.name);
      return {
        packPath: packData!.packPath,
        dbFolder,
        dbName,
        dbSubname: element.name,
      } as DBTableSelection;
    };

    const getPackedFilePathForElement = (element: INode) => {
      if (element.children && element.children.length > 0) return;
      return getNodeFullPath(element, fileNodeById);
    };

    const getPackedFileForDBSelection = (selection: DBTableSelection): PackedFile | undefined => {
      const packedFilePath = getDBPackedFilePath(selection);
      const unsavedFile =
        unsavedFiles.find((file) => file.name === packedFilePath) ||
        unsavedFiles.find((file) => file.name.startsWith(packedFilePath));
      if (unsavedFile) {
        return unsavedFile;
      }

      if (!packData?.packedFiles) return undefined;
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
      // The header path tells an importer where the table came from, so it has to name the real
      // folder - a spare exported as db/... would be re-imported over the live table.
      const packedFilePathForward = getDBPackedFilePath(selection).replaceAll("\\", "/");
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
      if ((!contextMenu || contextMenu.treeTab !== "db") && !isExportingSelection) return [];

      const dedupedSelections = new Map<string, DBTableSelection>();
      for (const selectedId of dbSelectedNodeIds) {
        const node = dbNodeById.get(selectedId);
        if (!node) continue;
        const selection = getDBSelectionForElement(node);
        if (!selection) continue;
        dedupedSelections.set(`${selection.packPath}|${getDBPackedFilePath(selection)}`, selection);
      }

      return Array.from(dedupedSelections.values()).filter((selection) => {
        const packedFile = getPackedFileForDBSelection(selection);
        return Boolean(packedFile?.schemaFields && packedFile?.tableSchema);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dbSelectedNodeIds, dbNodeById, packData, unsavedFiles, contextMenu, isExportingSelection]);

    const addIdsToSelection = (
      idsToAdd: Array<string | number>,
      setSelectedNodeIds: React.Dispatch<React.SetStateAction<Array<string | number>>>,
    ) => {
      if (idsToAdd.length === 0) return;
      setSelectedNodeIds((prevSelectedIds) => {
        const nextSelectedIds = new Set(prevSelectedIds);
        idsToAdd.forEach((id) => nextSelectedIds.add(id));
        return [...nextSelectedIds];
      });
    };

    const toggleIdsInSelection = (
      idsToToggle: Array<string | number>,
      setSelectedNodeIds: React.Dispatch<React.SetStateAction<Array<string | number>>>,
    ) => {
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

    const onDBTreeSelect = (selectionProps: ITreeViewOnSelectProps) => {
      if (lastLabelSelectionModeRef.current === "single") {
        setDbSelectedNodeIds([selectionProps.element.id as string | number]);
      } else if (lastLabelSelectionModeRef.current == null) {
        setDbSelectedNodeIds([...selectionProps.treeState.selectedIds]);
      }
      lastLabelSelectionModeRef.current = null;

      if (!selectionProps.isSelected) return;

      const dbSelection = getDBSelectionForElement(selectionProps.element);
      if (!dbSelection) return;
      if (pendingOpenTimeoutRef.current != null) {
        window.clearTimeout(pendingOpenTimeoutRef.current);
      }
      pendingOpenTimeoutRef.current = window.setTimeout(() => {
        pendingOpenTimeoutRef.current = null;
        props.onOpenDBTable(dbSelection);
      }, 180);
    };

    const onFileTreeSelect = (selectionProps: ITreeViewOnSelectProps) => {
      if (lastLabelSelectionModeRef.current === "single") {
        setFileSelectedNodeIds([selectionProps.element.id as string | number]);
      } else if (lastLabelSelectionModeRef.current == null) {
        setFileSelectedNodeIds([...selectionProps.treeState.selectedIds]);
      }
      lastLabelSelectionModeRef.current = null;

      if (!packData || !selectionProps.isSelected) return;

      const filePath = getPackedFilePathForElement(selectionProps.element);
      if (!filePath) return;
      if (pendingOpenTimeoutRef.current != null) {
        window.clearTimeout(pendingOpenTimeoutRef.current);
      }
      pendingOpenTimeoutRef.current = window.setTimeout(() => {
        pendingOpenTimeoutRef.current = null;
        if (filePath.startsWith("whmmflows\\")) {
          props.onOpenFlowFile({ flowFile: filePath, packPath: packData.packPath });
          return;
        }
        if (!isOpenablePackedFilePath(filePath)) return;
        props.onOpenPackedFile({ filePath, packPath: packData.packPath });
      }, 180);
    };

    const handleOpenInNewTab = (element: INode, treeTab: "db" | "files") => {
      if (!packData) return;
      if (pendingOpenTimeoutRef.current != null) {
        window.clearTimeout(pendingOpenTimeoutRef.current);
        pendingOpenTimeoutRef.current = null;
      }
      if (treeTab === "files") {
        const filePath = getPackedFilePathForElement(element);
        if (!filePath) return;
        if (filePath.startsWith("whmmflows\\")) {
          props.onOpenFlowFile({ flowFile: filePath, packPath: packData.packPath }, { forceNewTab: true });
          return;
        }
        if (!isOpenablePackedFilePath(filePath)) return;
        props.onOpenPackedFile({ filePath, packPath: packData.packPath }, { forceNewTab: true });
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

    const isTreeNodeFiltered = (element: INode, treeTab: "db" | "files"): boolean => {
      if (normalizedFilter === "") return false;
      return treeTab === "db" ? dbHiddenNodeIds.has(element.id) : fileHiddenNodeIds.has(element.id);
    };

    const handleContextMenu = (e: React.MouseEvent, treeTab: "db" | "files") => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, treeTab });
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
      setActiveTreeTab("files");
      setIsNewFlowDialogOpen(true);
    };

    const closeNewTableDialog = () => {
      setIsNewTableDialogOpen(false);
      setNewTableName("");
      setNewTableSuffix("");
      setNewTableIsUnused(false);
      setIsCreatingNewTable(false);
    };

    const handleAddNewTable = async () => {
      setContextMenu(null);
      setIsLoadingNewTableOptions(true);
      try {
        const [dbNameToDBVersions, nextDefaultTableVersions] = await Promise.all([
          window.api?.getDBNameToDBVersions(),
          window.api?.getDefaultTableVersions(),
        ]);

        const resolvedTableVersions =
          dbNameToDBVersions && Object.keys(dbNameToDBVersions).length > 0
            ? dbNameToDBVersions
            : dataFromBackend.DBNameToDBVersions;

        const tableNames = Object.keys(resolvedTableVersions).toSorted((first, second) =>
          first.localeCompare(second),
        );
        if (tableNames.length === 0) {
          props.showDialog("No vanilla DB tables are available for this game", { title: "No Tables" });
          return;
        }

        setAvailableTableVersions(resolvedTableVersions);
        setDefaultTableVersions(nextDefaultTableVersions || {});
        setNewTableName((currentValue) =>
          currentValue && resolvedTableVersions[currentValue] ? currentValue : tableNames[0],
        );
        setNewTableSuffix("");
        setIsNewTableDialogOpen(true);
      } catch (error) {
        console.error("Error loading vanilla DB table definitions:", error);
        props.showDialog(
          `Failed to load vanilla DB table definitions: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          { title: "Error" },
        );
      } finally {
        setIsLoadingNewTableOptions(false);
      }
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
              relativePath: `${getDBPackedFilePath(selection).replaceAll("\\", "/")}.tsv`,
              content,
            };
          })
          .filter((file): file is { relativePath: string; content: string } => Boolean(file));

        if (exportFiles.length === 0) {
          props.showDialog("No exportable DB tables selected", { title: "Nothing To Export" });
          return;
        }

        const result = await window.api?.writeTextFilesToDirectory(outputDirectory, exportFiles);

        if (!result?.success) {
          props.showDialog(`Failed to export TSV files: ${result?.error || "Unknown error"}`, {
            title: "Export Failed",
          });
          return;
        }

        props.showDialog(`Exported ${exportFiles.length} TSV file(s) to: ${outputDirectory}`, {
          title: "Export Complete",
        });
      } catch (error) {
        console.error("Error exporting selected tables as TSV:", error);
        props.showDialog(`Error exporting TSV files: ${error instanceof Error ? error.message : "Unknown error"}`, {
          title: "Export Failed",
        });
      } finally {
        setIsExportingSelection(false);
      }
    };

    const handleCreateNewFlow = async () => {
      if (!newFlowName.trim()) {
        props.showDialog("Please enter a valid flow name", { title: "Missing Name" });
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

    const handleCreateNewTable = async () => {
      if (!packData) return;

      const trimmedTableName = newTableName.trim();
      const trimmedSuffix = newTableSuffix.trim();
      if (!trimmedTableName) {
        props.showDialog("Please choose a table", { title: "Missing Table" });
        return;
      }
      if (!trimmedSuffix) {
        props.showDialog("Please enter the table name suffix", { title: "Missing Suffix" });
        return;
      }
      if (/[\\/]/.test(trimmedSuffix)) {
        props.showDialog("Enter only the xxx portion of db/table_name/xxx", { title: "Invalid Suffix" });
        return;
      }

      const schema = selectedNewTableSchema;
      if (!schema) {
        props.showDialog(`No schema found for ${trimmedTableName}`, { title: "Schema Missing" });
        return;
      }

      const dbFolder = newTableIsUnused ? UNUSED_DB_TABLE_ROOT : DEFAULT_DB_TABLE_ROOT;
      const packedFileName = `${dbFolder}\\${trimmedTableName}\\${trimmedSuffix}`;
      const alreadyExistsInPack =
        packData.tables.includes(packedFileName) ||
        Boolean(packData.packedFiles?.[packedFileName]) ||
        unsavedFiles.some((file) => file.name === packedFileName);
      if (alreadyExistsInPack) {
        props.showDialog(`A table already exists at ${packedFileName.replaceAll("\\", "/")}`, {
          title: "Table Exists",
        });
        return;
      }

      setIsCreatingNewTable(true);
      try {
        const nextPackedFile: PackedFile = {
          name: packedFileName,
          file_size: 0,
          start_pos: 0,
          schemaFields: [],
          version: schema.version,
          tableSchema: schema,
        };

        const result = await window.api?.saveDBTableEdits(packData.packPath, nextPackedFile);
        if (!result?.success) {
          throw new Error(result?.error || "Failed to create DB table");
        }

        dispatch(
          setUnsavedPacksData({
            packPath: packData.packPath,
            unsavedFileData: [nextPackedFile],
          }),
        );
        props.onOpenDBTable({
          packPath: packData.packPath,
          dbFolder,
          dbName: trimmedTableName,
          dbSubname: trimmedSuffix,
        });
        closeNewTableDialog();
      } catch (error) {
        console.error("Error creating DB table:", error);
        props.showDialog(`Failed to create DB table: ${error instanceof Error ? error.message : "Unknown error"}`, {
          title: "Create Failed",
        });
        setIsCreatingNewTable(false);
      }
    };

    const renderTree = (
      treeTab: "db" | "files",
      data: INode[],
      selectedIds: Array<string | number>,
      setSelectedNodeIds: React.Dispatch<React.SetStateAction<Array<string | number>>>,
      nodeById: Map<INode["id"], INode>,
      onSelect: (selectionProps: ITreeViewOnSelectProps) => void,
      defaultExpandedIds?: Array<string | number>,
    ) => (
      <TreeView
        key={`${treeTab}|${packPath}|${data.length}`}
        data={data}
        aria-label={treeTab === "db" ? "DB files tree" : "Packed files tree"}
        defaultExpandedIds={defaultExpandedIds}
        multiSelect={true}
        selectedIds={selectedIds}
        onSelect={onSelect}
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
            e.stopPropagation();
            if (e.shiftKey) {
              lastLabelSelectionModeRef.current = "shift";
              e.preventDefault();
              if (pendingOpenTimeoutRef.current != null) {
                window.clearTimeout(pendingOpenTimeoutRef.current);
                pendingOpenTimeoutRef.current = null;
              }

              const idsToSelect = isBranch
                ? getDescendantLeafIds(element, nodeById)
                : [element.id as string | number];
              addIdsToSelection(idsToSelect, setSelectedNodeIds);
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
                ? getDescendantLeafIds(element, nodeById)
                : [element.id as string | number];
              toggleIdsInSelection(idsToToggle, setSelectedNodeIds);
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
                (isTreeNodeFiltered(element, treeTab) ? "hidden" : "")
              }
            >
              {isBranch && <ArrowIcon className="" isOpen={isExpanded} />}
              <span
                onClick={handleLabelClick}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleOpenInNewTab(element, treeTab);
                }}
                className="relative select-none"
              >
                {element.name}
              </span>
            </div>
          );
        }}
      />
    );

    if (!packData) {
      return <></>;
    }

    return (
      <div onContextMenu={(e) => handleContextMenu(e, activeTreeTab)} className="relative select-none h-full min-h-full">
        <div className="sticky top-0 z-10 flex border-b border-gray-700 bg-gray-900/95 mb-2">
          <button
            type="button"
            onClick={() => setActiveTreeTab("db")}
            className={
              "px-3 py-2 text-xs font-medium border-b-2 " +
              (activeTreeTab === "db"
                ? "text-white border-blue-500 bg-gray-800/80"
                : "text-gray-400 border-transparent hover:text-white hover:bg-gray-800/60")
            }
          >
            DB Tables
          </button>
          <button
            type="button"
            onClick={() => setActiveTreeTab("files")}
            className={
              "px-3 py-2 text-xs font-medium border-b-2 " +
              (activeTreeTab === "files"
                ? "text-white border-blue-500 bg-gray-800/80"
                : "text-gray-400 border-transparent hover:text-white hover:bg-gray-800/60")
            }
          >
            Files
          </button>
        </div>

        {activeTreeTab === "db"
          ? renderTree(
              "db",
              dbData,
              safeDbSelectedNodeIds,
              setDbSelectedNodeIds,
              dbNodeById,
              onDBTreeSelect,
              dbDefaultExpandedIds,
            )
          : renderTree(
              "files",
              fileData,
              safeFileSelectedNodeIds,
              setFileSelectedNodeIds,
              fileNodeById,
              onFileTreeSelect,
            )}

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[150px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {!isVanillaPackOpen && contextMenu.treeTab === "files" && (
              <button
                onClick={handleAddNewFlow}
                className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm"
              >
                Add New Flow
              </button>
            )}
            {!isVanillaPackOpen && contextMenu.treeTab === "db" && (
              <button
                onClick={handleAddNewTable}
                disabled={isLoadingNewTableOptions}
                className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm disabled:opacity-50"
              >
                {isLoadingNewTableOptions ? "Loading Tables..." : "Add New Table"}
              </button>
            )}
            {contextMenu.treeTab === "db" && selectedDBTableSelections.length > 0 && (
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

        {isNewTableDialogOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold text-white mb-4">Create New DB Table</h2>

              <div className="mb-4">
                <label className="block text-white text-sm font-medium mb-2">Vanilla Table</label>
                <Select
                  options={vanillaTableOptions}
                  value={selectedNewTableOption}
                  onChange={(option: SingleValue<TableOption>) => setNewTableName(option?.value ?? "")}
                  styles={{
                    ...selectStyle,
                    menuPortal: (base) => ({
                      ...base,
                      zIndex: 70,
                    }),
                    menu: (base) => ({
                      ...selectStyle.menu(base),
                      zIndex: 70,
                    }),
                  }}
                  placeholder="Search tables..."
                  isClearable={false}
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                />
              </div>

              <div className="mb-2">
                <label className="block text-white text-sm font-medium mb-2">Table Suffix</label>
                <input
                  type="text"
                  value={newTableSuffix}
                  onChange={(e) => setNewTableSuffix(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCreateNewTable();
                    } else if (e.key === "Escape") {
                      closeNewTableDialog();
                    }
                  }}
                  className="w-full p-2 bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-400"
                  placeholder="xxx"
                  autoFocus
                />
              </div>

              <div className="mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newTableIsUnused}
                    onChange={(event) => setNewTableIsUnused(event.target.checked)}
                    className="w-4 h-4 shrink-0"
                  />
                  <span className="text-sm text-white">Create it under {UNUSED_DB_TABLE_ROOT}/</span>
                  <HelpBadge
                    text={
                      `The game only reads tables out of db/, so a table kept in ${UNUSED_DB_TABLE_ROOT}/ is inert: ` +
                      "it does not load, does not override anything, and is not reported as a conflict with other mods.\n\n" +
                      "Use it to keep a variant beside the live table - a reworked balance pass, a version for a " +
                      "different submod - and edit it here like any other table.\n\n" +
                      "A flow can copy it over the live table with the Move Or Copy Files node, so which variant " +
                      "ships becomes a flow option rather than a manual file swap."
                    }
                  />
                </label>
              </div>

              <div className="mb-4 text-sm text-gray-300">
                <div>
                  Path:{" "}
                  {newTableName
                    ? `${newTableIsUnused ? UNUSED_DB_TABLE_ROOT : DEFAULT_DB_TABLE_ROOT}/${newTableName}/${newTableSuffix || "xxx"}`
                    : `${newTableIsUnused ? UNUSED_DB_TABLE_ROOT : DEFAULT_DB_TABLE_ROOT}/.../xxx`}
                </div>
                <div>Version: {selectedNewTableSchema?.version ?? "Unknown"}</div>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={closeNewTableDialog}
                  disabled={isCreatingNewTable}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateNewTable}
                  disabled={!newTableName || isCreatingNewTable}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                >
                  {isCreatingNewTable ? "Creating..." : "Create"}
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
