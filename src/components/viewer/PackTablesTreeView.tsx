import React, { useContext, useEffect, useImperativeHandle, useMemo } from "react";
import { Modal } from "../../flowbite";
import { setUnsavedPacksData } from "../../appSlice";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, {
  INode,
  ITreeViewOnExpandProps,
  ITreeViewOnSelectProps,
  flattenTree,
} from "react-accessible-treeview";
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
import { getAutoExpandedDBGroupIds, getLoneTableToOpen, getSingleChildBranchIds } from "../../utility/dbTreeExpansion";
import { gameToPackWithDBTablesName, vanillaPackNames } from "../../supportedGames";
import selectStyle from "../../styles/selectStyle";
import { dataFromBackend } from "./packDataStore";
import type { ShowViewerDialog } from "./viewerDialogs";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";
import type { AmendedSchemaField, DBVersion, PackedFile } from "../../packFileTypes";
import { isOpenablePackedFilePath } from "../../utility/packFileViewing";
import CopyIntoSubmenu from "./CopyIntoSubmenu";
import ContextMenuSubmenu from "./ContextMenuSubmenu";
import PackFileRenameModal from "./PackFileRenameModal";
import type { ExistingPackFilePaths } from "../../utility/packImportPlan";
import type { PackFileRenameEntry } from "../../utility/packFileRenamePlan";
import { getPackFolderPaths, getParentPackFolder } from "../../utility/packFolderPaths";
import { clearPackDataStoreForPack } from "./packDataStore";
import { clearPreparedTableForPackedFile } from "./tablePrepCache";
import localizationContext from "../../localizationContext";
import {
  isLoadOrderRulesPackedFilePath,
  LOAD_ORDER_RULES_PACKED_FILE_PATH,
  serializeLoadOrderRuleRows,
} from "../../utility/loadOrderRulesFile";

type PackTablesTreeViewProps = {
  packPath: string;
  preferredTab: "db" | "files";
  tableFilter: string;
  showDialog: ShowViewerDialog;
  otherOpenPacks?: ViewerPackTarget[];
  onCopyInto?: (source: CopyIntoSource, targetPackPath: string, openAfterCopy: boolean) => void | Promise<void>;
  onImportConflicts?: (request: PackImportConflictRequest) => void;
  onPackFilePathsRemoved?: (packPath: string, removedPaths: string[]) => void;
  onOpenDBTable: (selection: DBTableSelection, options?: { forceNewTab?: boolean }) => void;
  onOpenFlowFile: (selection: { flowFile: string; packPath: string }, options?: { forceNewTab?: boolean }) => void;
  onOpenPackedFile: (selection: { filePath: string; packPath: string }, options?: { forceNewTab?: boolean }) => void;
};

type TreeData = { id?: string | number; name: string; children?: TreeData[]; isBranch?: boolean };
type TableOption = { value: string; label: string };
type TreeTab = "db" | "files";
type ExpandedIdsByTreeTab = Partial<Record<TreeTab, Array<INode["id"]>>>;
type ContextMenuTreeTab = TreeTab | "empty";
const PACK_TREE_INDENT_PX = 20;
const PACK_TREE_MARKER_SIZE_CLASS = "w-4 h-4";
type TreeContextTarget =
  | { kind: "db"; packPath: string; filePath: string; selection: DBTableSelection }
  | { kind: "file"; packPath: string; filePath: string }
  | { kind: "folder"; packPath: string; folderPath: string };

const EMPTY_DELETED_PACK_FILE_PATHS: string[] = [];

export type ViewerPackTarget = { packPath: string; label: string };
export type CopyIntoSource = {
  packPath: string;
  filePath: string;
  kind: "db" | "dbRows" | "file";
  dbSelection?: DBTableSelection;
  rows?: AmendedSchemaField[][];
  tableSchema?: DBVersion;
  version?: number;
};
export type PackTablesTreeViewHandle = {
  openNewFlowDialog: () => void;
  createLoadOrderRulesFile: () => void;
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

/**
 * `flattenTree` assigns numeric ids from the node's position in the tree unless a node supplies one.
 * Position-based ids make a data refresh after a file operation point at different nodes, so use the
 * packed path as the node identity instead. This lets the tree retain its expansion state when a
 * sibling is added or removed. Group and leaf prefixes also keep a DB group from colliding with a
 * loc-file group whose displayed path happens to be the same.
 */
const getStableTreeNodeId = (treeTab: TreeTab, path: string, nodeKind: "group" | "leaf" | "path") =>
  `${treeTab}:${nodeKind}:${encodeURIComponent(path.replaceAll("/", "\\"))}`;

const buildPathTree = (filePaths: string[], extraFolders: string[] = []): TreeData => {
  const root: TreeData = { id: 0, name: "", children: [] };

  const addPath = (path: string, isFolder: boolean) => {
    const segments = path.split(/[\\/]/).filter(Boolean);
    let currentNode = root;
    let currentPath = "";
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}\\${segment}` : segment;
      let nextNode = currentNode.children?.find((child) => child.name === segment);
      if (!nextNode) {
        nextNode = { id: getStableTreeNodeId("files", currentPath, "path"), name: segment, children: [] };
        currentNode.children?.push(nextNode);
      }
      if (isFolder && index === segments.length - 1) nextNode.isBranch = true;
      currentNode = nextNode;
    });
  };

  for (const filePath of filePaths) addPath(filePath, false);
  for (const folderPath of extraFolders) addPath(folderPath, true);

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
      if (currentNode.id !== 0 && !currentNode.isBranch) {
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
    const localized: Record<string, string> = useContext(localizationContext);
    const currentGame = useAppSelector((state) => state.app.currentGame);
    const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);
    const selectCurrentPackUnsavedFiles = useMemo(makeSelectCurrentPackUnsavedFiles, []);

    const [activeTreeTab, setActiveTreeTab] = React.useState<"db" | "files">(props.preferredTab);
    const [contextMenu, setContextMenu] = React.useState<{
      x: number;
      y: number;
      treeTab: ContextMenuTreeTab;
      target?: TreeContextTarget;
    } | null>(null);
    const [isNewFlowDialogOpen, setIsNewFlowDialogOpen] = React.useState(false);
    const [newFlowName, setNewFlowName] = React.useState("");
    const [isCreatingNewFlow, setIsCreatingNewFlow] = React.useState(false);
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
    /** A node the tree opened by itself, whose selection should not be read as a click on it. */
    const autoOpenedDbNodeIdRef = React.useRef<INode["id"] | null>(null);
    const [dbSelectedNodeIds, setDbSelectedNodeIds] = React.useState<Array<string | number>>([]);
    const [fileSelectedNodeIds, setFileSelectedNodeIds] = React.useState<Array<string | number>>([]);
    const [createdFoldersByPack, setCreatedFoldersByPack] = React.useState<Record<string, string[]>>({});
    const [expandedIdsByPack, setExpandedIdsByPack] = React.useState<Record<string, ExpandedIdsByTreeTab>>({});
    const lastLabelSelectionModeRef = React.useRef<"single" | "shift" | "ctrl" | null>(null);
    const clearLabelSelectionModeTimeoutRef = React.useRef<number | null>(null);
    const contextMenuRef = React.useRef<HTMLDivElement | null>(null);
    const deleteConfirmButtonRef = React.useRef<HTMLButtonElement | null>(null);
    const [isExportingSelection, setIsExportingSelection] = React.useState(false);
    const [isExportingWholePack, setIsExportingWholePack] = React.useState(false);
    const [isImporting, setIsImporting] = React.useState(false);
    const [deleteConfirm, setDeleteConfirm] = React.useState<string[] | null>(null);
    const [newFolderRequest, setNewFolderRequest] = React.useState<{ parentFolder: string } | null>(null);
    const [newFolderName, setNewFolderName] = React.useState("");
    const [newFolderError, setNewFolderError] = React.useState("");
    const [renameRequest, setRenameRequest] = React.useState<{
      mode: "rename" | "move";
      paths: string[];
    } | null>(null);

    useEffect(() => {
      setActiveTreeTab(props.preferredTab);
    }, [props.packPath, props.preferredTab]);

    useImperativeHandle(ref, () => ({
      openNewFlowDialog: () => {
        setContextMenu(null);
        setActiveTreeTab("files");
        setIsNewFlowDialogOpen(true);
      },
      createLoadOrderRulesFile: () => {
        void handleCreateLoadOrderRules();
      },
    }));

    const packPath = props.packPath || gameToPackWithDBTablesName[currentGame] || "db.pack";
    const packData = useAppSelector((state) => selectCurrentPackData(state, packPath));
    const unsavedFiles = useAppSelector((state) => selectCurrentPackUnsavedFiles(state, packPath));
    const deletedPackFilePaths = useAppSelector(
      (state) => state.app.deletedPackFilePaths[packPath] ?? EMPTY_DELETED_PACK_FILE_PATHS,
    );
    const isVanillaPackOpen = packData ? vanillaPackNames.includes(packData.packName) : false;

    const packFileNames = useMemo(() => {
      if (!packData) return [];

      const deletedKeys = new Set(deletedPackFilePaths.map((path) => path.replaceAll("/", "\\").toLowerCase()));
      const visiblePackFile = (path: string) => !deletedKeys.has(path.replaceAll("/", "\\").toLowerCase());

      return Array.from(
        new Set([
          ...packData.tables.filter(visiblePackFile),
          ...Object.keys(packData.packedFiles || {}).filter(visiblePackFile),
          ...unsavedFiles.map((unsavedFile) => unsavedFile.name),
        ]),
      );
    }, [deletedPackFilePaths, packData, unsavedFiles]);

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

      const root: TreeData = { id: 0, name: "", children: [] };
      const dbEntriesByName = groupDBTablePaths(packFileNames);

      for (const groupName of [...dbEntriesByName.keys()].toSorted((first, second) => first.localeCompare(second))) {
        const subnames = dbEntriesByName.get(groupName);
        root.children?.push({
          id: getStableTreeNodeId("db", groupName, "group"),
          name: groupName,
          children: [...(subnames || [])]
            .toSorted((first, second) => first.localeCompare(second))
            .map((dbSubname) => ({
              id: getStableTreeNodeId("db", `${groupName}\\${dbSubname}`, "leaf"),
              name: dbSubname,
              children: [],
            })),
        });
      }

      return flattenTree(root);
    }, [packData, packFileNames]);

    const fileData = useMemo(() => {
      if (!packData) {
        return flattenTree({ name: "", children: [] });
      }

      const fileNames = new Set<string>();
      for (const packFileName of packFileNames) {
        if (!isDBPackedFileName(packFileName)) {
          fileNames.add(packFileName);
        }
      }

      return flattenTree(
        buildPathTree(
          Array.from(fileNames).toSorted((first, second) => first.localeCompare(second)),
          createdFoldersByPack[packPath] ?? [],
        ),
      );
    }, [createdFoldersByPack, packData, packFileNames, packPath]);

    const dbNodeById = useMemo(() => buildNodeById(dbData), [dbData]);
    const dbDefaultExpandedIds = useMemo(() => getAutoExpandedDBGroupIds(dbData), [dbData]);
    const fileNodeById = useMemo(() => buildNodeById(fileData), [fileData]);
    const hasDBTables = dbData.some((node) => node.id !== 0);
    const hasFiles = fileData.some((node) => node.id !== 0);
    const visibleActiveTreeTab: TreeTab | null =
      (activeTreeTab === "db" && hasDBTables) || (activeTreeTab === "files" && hasFiles)
        ? activeTreeTab
        : hasDBTables
          ? "db"
          : hasFiles
            ? "files"
            : null;
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
      if ((element.children && element.children.length > 0) || element.isBranch) return;
      return getNodeFullPath(element, fileNodeById);
    };

    const getContextTargetPaths = () => {
      if (!packData) return [];

      const treeTab =
        contextMenu?.treeTab === "db" || contextMenu?.treeTab === "files" ? contextMenu.treeTab : visibleActiveTreeTab;
      const pathsByKey = new Map<string, string>();
      const addPath = (path: string | undefined) => {
        if (!path) return;
        const key = path.replaceAll("/", "\\").toLowerCase();
        if (!pathsByKey.has(key)) pathsByKey.set(key, path);
      };

      if (treeTab === "db") {
        for (const selectedId of dbSelectedNodeIds) {
          const node = dbNodeById.get(selectedId);
          if (!node) continue;
          const leafIds =
            node.children && node.children.length > 0 ? getDescendantLeafIds(node, dbNodeById) : [node.id];
          for (const leafId of leafIds) {
            const leaf = dbNodeById.get(leafId);
            const selection = leaf ? getDBSelectionForElement(leaf) : undefined;
            addPath(selection ? getDBPackedFilePath(selection) : undefined);
          }
        }
      } else if (treeTab === "files") {
        for (const selectedId of fileSelectedNodeIds) {
          const node = fileNodeById.get(selectedId);
          if (!node) continue;
          const leafIds =
            node.children && node.children.length > 0 ? getDescendantLeafIds(node, fileNodeById) : [node.id];
          for (const leafId of leafIds) {
            const leaf = fileNodeById.get(leafId);
            addPath(leaf ? getNodeFullPath(leaf, fileNodeById) : undefined);
          }
        }
      }

      const selectedPaths = [...pathsByKey.values()];
      const clickedPath =
        contextMenu?.target?.kind === "folder"
          ? contextMenu.target.folderPath
          : contextMenu?.target
            ? contextMenu.target.filePath
            : undefined;
      const clickedPathKey = clickedPath?.replaceAll("/", "\\").toLowerCase();
      const clickedTargetIsSelected =
        !clickedPathKey ||
        selectedPaths.some((path) => {
          const key = path.replaceAll("/", "\\").toLowerCase();
          return (
            key === clickedPathKey || (contextMenu?.target?.kind === "folder" && key.startsWith(`${clickedPathKey}\\`))
          );
        });
      const pathsToUse =
        clickedTargetIsSelected && selectedPaths.length > 0 ? selectedPaths : clickedPath ? [clickedPath] : [];
      const expandedPaths = new Map<string, string>();
      for (const path of pathsToUse) {
        const key = path.replaceAll("/", "\\").toLowerCase();
        const isClickedFolder = contextMenu?.target?.kind === "folder" && key === clickedPathKey;
        const descendants = isClickedFolder
          ? packFileNames.filter((candidate) => {
              const candidateKey = candidate.replaceAll("/", "\\").toLowerCase();
              return candidateKey.startsWith(`${key}\\`);
            })
          : [];
        if (isClickedFolder && descendants.length === 0) continue;
        for (const expandedPath of descendants.length > 0 ? descendants : [path]) {
          const expandedKey = expandedPath.replaceAll("/", "\\").toLowerCase();
          if (!expandedPaths.has(expandedKey)) expandedPaths.set(expandedKey, expandedPath);
        }
      }
      return [...expandedPaths.values()];
    };

    const selectedExportPaths = useMemo(
      () => getContextTargetPaths(),
      // The selection expansion intentionally follows the context-menu tab and clicked target.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        contextMenu,
        dbNodeById,
        dbSelectedNodeIds,
        fileNodeById,
        fileSelectedNodeIds,
        packData,
        packFileNames,
        visibleActiveTreeTab,
      ],
    );

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

    const cancelPendingOpen = () => {
      if (pendingOpenTimeoutRef.current == null) return;
      window.clearTimeout(pendingOpenTimeoutRef.current);
      pendingOpenTimeoutRef.current = null;
    };

    /**
     * Opens after a short delay so a double click can cancel it and open in a new tab instead.
     *
     * Anything already pending is cancelled only once there is something to replace it with. An
     * element with nothing to open - a group - leaves the queue alone, because selecting a group is
     * how expanding one gets here, and that expansion may have just queued its lone table.
     *
     * `alsoSelect` moves the tree's selection onto the element as it opens. Done here rather than at
     * the call site because the tree fires its own onSelect from an effect, which lands first and
     * would put the selection back where the click was.
     */
    const scheduleOpenForElement = (
      element: INode,
      treeTab: "db" | "files",
      { alsoSelect = false }: { alsoSelect?: boolean } = {},
    ) => {
      if (treeTab === "db") {
        const dbSelection = getDBSelectionForElement(element);
        if (!dbSelection) return;
        cancelPendingOpen();
        pendingOpenTimeoutRef.current = window.setTimeout(() => {
          pendingOpenTimeoutRef.current = null;
          if (alsoSelect) {
            // Selecting it feeds back in as another onSelect for this node. It is already opening,
            // so mark it for onDBTreeSelect to let through without opening it a second time, and
            // treat the events as one plain selection so they do not pick the group back up.
            autoOpenedDbNodeIdRef.current = element.id;
            beginSingleLabelSelection();
            setDbSelectedNodeIds([element.id as string | number]);
          }
          props.onOpenDBTable(dbSelection);
        }, 180);
        return;
      }

      if (!packData) return;
      const filePath = getPackedFilePathForElement(element);
      if (!filePath) return;
      const openPackPath = packData.packPath;
      cancelPendingOpen();
      pendingOpenTimeoutRef.current = window.setTimeout(() => {
        pendingOpenTimeoutRef.current = null;
        if (filePath.startsWith("whmmflows\\")) {
          props.onOpenFlowFile({ flowFile: filePath, packPath: openPackPath });
          return;
        }
        if (!isOpenablePackedFilePath(filePath)) return;
        props.onOpenPackedFile({ filePath, packPath: openPackPath });
      }, 180);
    };

    /**
     * Expanding a table group that holds a single table is only ever a step towards opening that
     * table, so save the second click and open it.
     *
     * Only on the way open - collapsing a group must not open anything - and only when the
     * single-child path ultimately resolves to a table.
     */
    const openLoneChildOnExpand = (
      element: INode,
      willExpand: boolean,
      treeTab: "db" | "files",
      nodeById: Map<INode["id"], INode>,
    ) => {
      if (treeTab !== "db" || !willExpand) return;

      const loneTable = getLoneTableToOpen(element, nodeById);
      if (!loneTable) return;
      // Select the table, not the group that was clicked: the table is what ends up open.
      scheduleOpenForElement(loneTable, treeTab, { alsoSelect: true });
    };

    /**
     * Keep the tree's own expansion state until an expansion happens, then take control so a
     * single-child path can be opened in one click. The tree state already contains the branch the
     * user expanded; add only the unambiguous branch children below it.
     */
    const handleTreeExpand = (
      treeTab: TreeTab,
      expansionProps: ITreeViewOnExpandProps,
      nodeById: Map<INode["id"], INode>,
    ) => {
      const nextExpandedIds = new Set(expansionProps.treeState.expandedIds);
      if (expansionProps.isExpanded) {
        for (const branchId of getSingleChildBranchIds(expansionProps.element, nodeById)) {
          nextExpandedIds.add(branchId);
        }
      }

      const nextIds = [...nextExpandedIds];
      setExpandedIdsByPack((currentByPack) => {
        const currentPack = currentByPack[packPath];
        const currentIds = currentPack?.[treeTab];
        if (currentIds?.length === nextIds.length && currentIds.every((id, index) => id === nextIds[index])) {
          return currentByPack;
        }

        return {
          ...currentByPack,
          [packPath]: {
            ...currentPack,
            [treeTab]: nextIds,
          },
        };
      });
    };

    /**
     * Marks the select events that follow as belonging to one plain click.
     *
     * Cleared on a timeout rather than by the handler, because a single click can produce several
     * select events - one for the node picked up, one for each node put down - and they arrive from
     * an effect, after this returns. Clearing on the first event left the rest to be treated as if
     * the tree had selected them on its own.
     */
    const beginSingleLabelSelection = () => {
      lastLabelSelectionModeRef.current = "single";
      if (clearLabelSelectionModeTimeoutRef.current != null) {
        window.clearTimeout(clearLabelSelectionModeTimeoutRef.current);
      }
      clearLabelSelectionModeTimeoutRef.current = window.setTimeout(() => {
        clearLabelSelectionModeTimeoutRef.current = null;
        lastLabelSelectionModeRef.current = null;
      }, 0);
    };

    /**
     * Folds one of the tree's select events into our own selection state.
     *
     * A plain click means exactly the clicked node, so it replaces the selection and the deselect
     * events that come with it are ignored - taking `element.id` from one of those would select the
     * node being left behind.
     *
     * Only when we did not originate the click do we mirror the tree's own set, which is how
     * keyboard selection arrives. That set is additive: the grid runs with multiSelect on, so the
     * library's plain select adds rather than replaces, and adopting it wholesale is how rows that
     * were merely passed through stay highlighted.
     */
    const applySelectionFromTree = (
      selectionProps: ITreeViewOnSelectProps,
      setSelectedNodeIds: React.Dispatch<React.SetStateAction<Array<string | number>>>,
    ) => {
      if (lastLabelSelectionModeRef.current === "single") {
        if (selectionProps.isSelected) {
          setSelectedNodeIds([selectionProps.element.id as string | number]);
        }
        return;
      }
      if (lastLabelSelectionModeRef.current != null) return;

      setSelectedNodeIds([...selectionProps.treeState.selectedIds]);
    };

    const onDBTreeSelect = (selectionProps: ITreeViewOnSelectProps) => {
      applySelectionFromTree(selectionProps, setDbSelectedNodeIds);

      if (!selectionProps.isSelected) return;
      if (autoOpenedDbNodeIdRef.current === selectionProps.element.id) {
        // This selection is the auto-open moving the highlight onto the table it just opened, not a
        // click on it. Opening again here would read as a second click and land in a new tab.
        autoOpenedDbNodeIdRef.current = null;
        return;
      }
      scheduleOpenForElement(selectionProps.element, "db");
    };

    const onFileTreeSelect = (selectionProps: ITreeViewOnSelectProps) => {
      applySelectionFromTree(selectionProps, setFileSelectedNodeIds);

      if (!packData || !selectionProps.isSelected) return;
      scheduleOpenForElement(selectionProps.element, "files");
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
        if (clearLabelSelectionModeTimeoutRef.current != null) {
          window.clearTimeout(clearLabelSelectionModeTimeoutRef.current);
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
        <span className={`${PACK_TREE_MARKER_SIZE_CLASS} shrink-0`}>
          <IoMdArrowDropright size={"100%"} className={classes} />
        </span>
      );
    };

    const isTreeNodeFiltered = (element: INode, treeTab: "db" | "files"): boolean => {
      if (normalizedFilter === "") return false;
      return treeTab === "db" ? dbHiddenNodeIds.has(element.id) : fileHiddenNodeIds.has(element.id);
    };

    const packPathKey = (value: string) => value.replaceAll("/", "\\").toLowerCase();
    const filePackFileNames = useMemo(
      () => packFileNames.filter((filePath) => !isDBPackedFileName(filePath)),
      [packFileNames],
    );
    const folderPathKeys = useMemo(
      () =>
        new Set([...getPackFolderPaths(filePackFileNames), ...(createdFoldersByPack[packPath] ?? [])].map(packPathKey)),
      [createdFoldersByPack, filePackFileNames, packPath],
    );
    const filePathKeys = useMemo(() => new Set(filePackFileNames.map(packPathKey)), [filePackFileNames]);

    const getTreeNodePath = (
      element: INode,
      treeTab: TreeTab,
      isBranch: boolean,
      nodeById: Map<INode["id"], INode>,
    ) => {
      const nodePath = getNodeFullPath(element, nodeById);
      if (treeTab === "files") return nodePath;
      if (isBranch) {
        const { dbFolder, dbName } = parseDBGroupName(nodePath);
        return `${dbFolder}\\${dbName}`;
      }

      const selection = getDBSelectionForElement(element);
      return selection ? getDBPackedFilePath(selection) : undefined;
    };

    const isContextMenuTarget = (
      element: INode,
      treeTab: TreeTab,
      isBranch: boolean,
      nodeById: Map<INode["id"], INode>,
    ) => {
      const target = contextMenu?.target;
      if (!target || contextMenu?.treeTab !== treeTab) return false;
      if ((target.kind === "folder") !== isBranch) return false;

      const targetPath = target.kind === "folder" ? target.folderPath : target.filePath;
      const nodePath = getTreeNodePath(element, treeTab, isBranch, nodeById);
      return nodePath != undefined && packPathKey(nodePath) === packPathKey(targetPath);
    };

    const handleContextMenu = (e: React.MouseEvent, treeTab: ContextMenuTreeTab, target?: TreeContextTarget) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, treeTab, target });
    };

    const handleCopyIntoPack = (targetPackPath: string, openAfterCopy: boolean) => {
      const target = contextMenu?.target;
      if (
        !target ||
        target.kind === "folder" ||
        !props.onCopyInto ||
        packPathKey(target.packPath) === packPathKey(targetPackPath)
      )
        return;

      const source: CopyIntoSource = {
        packPath: target.packPath,
        filePath: target.filePath,
        kind: target.kind,
        ...(target.kind === "db" ? { dbSelection: target.selection } : {}),
      };
      setContextMenu(null);
      void props.onCopyInto(source, targetPackPath, openAfterCopy);
    };

    const existingPackFilePaths = useMemo<ExistingPackFilePaths>(() => {
      if (!packData) return { pack: [], unsaved: unsavedFiles.map((file) => file.name) };
      const deletedKeys = new Set(deletedPackFilePaths.map((path) => path.replaceAll("/", "\\").toLowerCase()));
      const packPaths = [...packData.tables, ...Object.keys(packData.packedFiles || {})].filter(
        (path) => !deletedKeys.has(path.replaceAll("/", "\\").toLowerCase()),
      );
      return {
        pack: [...new Set(packPaths)],
        unsaved: unsavedFiles.map((file) => file.name),
      };
    }, [deletedPackFilePaths, packData, unsavedFiles]);

    const clearPackFileCaches = (paths: string[]) => {
      clearPackDataStoreForPack(packPath);
      for (const filePath of paths) clearPreparedTableForPackedFile(packPath, filePath);
    };

    const handleDeleteRequest = () => {
      if (selectedExportPaths.length === 0 || isVanillaPackOpen) return;
      setContextMenu(null);
      setDeleteConfirm(selectedExportPaths);
    };

    const handleDeleteConfirm = async () => {
      const paths = deleteConfirm;
      if (!paths) return;
      setDeleteConfirm(null);
      try {
        const result = await window.api?.deletePackedFiles?.(packPath, paths);
        if (!result?.success) {
          props.showDialog(
            (localized.viewerDeletePackedFilesError || "Failed to delete packed files: {{error}}").replace(
              "{{error}}",
              result?.error || localized.viewerUnknownError || "Unknown error",
            ),
            {
              title: localized.viewerDeleteFailed || "Delete Failed",
            },
          );
          return;
        }
        const removedPaths = result.removedPaths ?? paths;
        clearPackFileCaches(removedPaths);
        props.onPackFilePathsRemoved?.(packPath, removedPaths);
      } catch (error) {
        console.error("Error deleting packed files:", error);
        props.showDialog(
          (localized.viewerDeletePackedFilesException || "Error deleting packed files: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerDeleteFailed || "Delete Failed" },
        );
      }
    };

    useEffect(() => {
      if (!deleteConfirm) return;

      const handleDeleteConfirmKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        deleteConfirmButtonRef.current?.click();
      };

      document.addEventListener("keydown", handleDeleteConfirmKeyDown, true);
      return () => document.removeEventListener("keydown", handleDeleteConfirmKeyDown, true);
    }, [deleteConfirm]);

    const handleRenameRequest = (mode: "rename" | "move") => {
      if (selectedExportPaths.length === 0 || isVanillaPackOpen) return;
      setContextMenu(null);
      setRenameRequest({ mode, paths: selectedExportPaths });
    };

    const handleRenameApply = async (entries: PackFileRenameEntry[]) => {
      if (!renameRequest) return;
      try {
        const result = await window.api?.renamePackedFilesInPack?.(packPath, entries);
        if (!result?.success) {
          props.showDialog(
            (localized.viewerRenamePackedFilesError || "Failed to rename packed files: {{error}}").replace(
              "{{error}}",
              result?.error || localized.viewerUnknownError || "Unknown error",
            ),
            { title: localized.viewerRenameFailed || "Rename Failed" },
          );
          return;
        }
        const removedPaths = result.removedPaths ?? entries.map((entry) => entry.originalPath);
        clearPackFileCaches([...removedPaths, ...entries.map((entry) => entry.newPath)]);
        props.onPackFilePathsRemoved?.(packPath, removedPaths);
        setRenameRequest(null);
      } catch (error) {
        console.error("Error renaming packed files:", error);
        props.showDialog(
          (localized.viewerRenamePackedFilesException || "Error renaming packed files: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerRenameFailed || "Rename Failed" },
        );
      }
    };

    /**
     * A click outside the open context menu dismisses it, and does nothing else.
     *
     * On the capture phase at the document, so it runs before React delivers the click to whatever
     * is underneath - otherwise dismissing the menu also selects and opens the node it happened to
     * be covering.
     */
    useEffect(() => {
      if (!contextMenu) return;

      const dismissContextMenu = (event: MouseEvent) => {
        // Not the menu's own buttons, which need their click.
        if (contextMenuRef.current?.contains(event.target as Node)) return;

        event.preventDefault();
        event.stopPropagation();
        setContextMenu(null);
      };

      document.addEventListener("click", dismissContextMenu, true);
      return () => document.removeEventListener("click", dismissContextMenu, true);
    }, [contextMenu]);

    const handleAddNewFlow = () => {
      setContextMenu(null);
      setActiveTreeTab("files");
      setIsNewFlowDialogOpen(true);
    };

    const handleAddNewFolder = () => {
      const target = contextMenu?.target;
      const parentFolder =
        contextMenu?.treeTab === "files"
          ? target?.kind === "folder"
            ? target.folderPath
            : target?.kind === "file"
              ? getParentPackFolder(target.filePath)
              : ""
          : "";
      setContextMenu(null);
      setActiveTreeTab("files");
      setNewFolderRequest({ parentFolder });
      setNewFolderName("");
      setNewFolderError("");
    };

    const handleCreateNewFolder = () => {
      if (!newFolderRequest) return;

      const trimmedName = newFolderName.trim();
      if (!trimmedName) {
        setNewFolderError(localized.viewerEnterFolderName || "Enter a folder name.");
        return;
      }
      if (/[\\/]/.test(trimmedName) || trimmedName === "." || trimmedName === "..") {
        setNewFolderError(localized.viewerInvalidFolderName || "Enter a folder name without path separators.");
        return;
      }

      const parentFolder = newFolderRequest.parentFolder.replaceAll("/", "\\").replace(/^\\+|\\+$/g, "");
      const newPath = parentFolder ? `${parentFolder}\\${trimmedName}` : trimmedName;
      const newPathKey = packPathKey(newPath);
      if (folderPathKeys.has(newPathKey)) {
        setNewFolderError(localized.viewerFolderAlreadyExists || "That folder already exists.");
        return;
      }
      if (filePathKeys.has(newPathKey)) {
        setNewFolderError(localized.viewerFolderConflictsWithFile || "A file already exists at that path.");
        return;
      }

      setCreatedFoldersByPack((currentByPack) => ({
        ...currentByPack,
        [packPath]: [...(currentByPack[packPath] ?? []), newPath],
      }));

      const parentSegments = parentFolder.split("\\").filter(Boolean);
      const parentExpansionIds: Array<string | number> = [];
      let currentParentPath = "";
      for (const segment of parentSegments) {
        currentParentPath = currentParentPath ? `${currentParentPath}\\${segment}` : segment;
        parentExpansionIds.push(getStableTreeNodeId("files", currentParentPath, "path"));
      }
      setExpandedIdsByPack((currentByPack) => {
        const currentPack = currentByPack[packPath];
        const currentFileIds = currentPack?.files ?? [];
        return {
          ...currentByPack,
          [packPath]: {
            ...currentPack,
            files: [...new Set([...currentFileIds, ...parentExpansionIds])],
          },
        };
      });
      setFileSelectedNodeIds([getStableTreeNodeId("files", newPath, "path")]);
      setNewFolderRequest(null);
      setNewFolderName("");
      setNewFolderError("");
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
      setActiveTreeTab("db");
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

        const tableNames = Object.keys(resolvedTableVersions).toSorted((first, second) => first.localeCompare(second));
        if (tableNames.length === 0) {
          props.showDialog(localized.viewerNoVanillaTables || "No vanilla DB tables are available for this game", {
            title: localized.viewerNoTables || "No Tables",
          });
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
          (
            localized.viewerLoadVanillaDefinitionsError || "Failed to load vanilla DB table definitions: {{error}}"
          ).replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerError || "Error" },
        );
      } finally {
        setIsLoadingNewTableOptions(false);
      }
    };

    const showExportResult = (result: PackExportResult | undefined, outputDirectory: string) => {
      if (!result?.success) {
        props.showDialog(
          (localized.viewerFailedToExportPackedFiles || "Failed to export packed files: {{error}}").replace(
            "{{error}}",
            result?.error || localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerExportFailed || "Export Failed" },
        );
        return;
      }

      const skipped = result.skipped ?? [];
      const skippedMessage =
        skipped.length > 0
          ? (localized.viewerExportSkipped || "\nSkipped {{count}} file(s):\n{{files}}")
              .replace("{{count}}", String(skipped.length))
              .replace("{{files}}", skipped.map((entry) => `${entry.name}: ${entry.reason}`).join("\n"))
          : "";
      props.showDialog(
        (localized.viewerExportResult || "Exported {{count}} file(s) to: {{path}}.{{skipped}}")
          .replace("{{count}}", String(result.writtenCount))
          .replace("{{path}}", outputDirectory)
          .replace("{{skipped}}", skippedMessage),
        { title: localized.viewerExportComplete || "Export Complete" },
      );
    };

    const handleExportSelection = async () => {
      if (selectedExportPaths.length === 0 || isExportingSelection || isExportingWholePack) return;

      setContextMenu(null);
      setIsExportingSelection(true);
      try {
        const outputDirectory = await window.api?.selectDirectory();
        if (!outputDirectory) return;
        const result = await window.api?.exportPackedFilesToDirectory?.(packPath, outputDirectory, selectedExportPaths);
        showExportResult(result, outputDirectory);
      } catch (error) {
        console.error("Error exporting selected packed files:", error);
        props.showDialog(
          (localized.viewerErrorExportingPackedFiles || "Error exporting packed files: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerExportFailed || "Export Failed" },
        );
      } finally {
        setIsExportingSelection(false);
      }
    };

    const handleExportWholePack = async () => {
      if (isExportingSelection || isExportingWholePack) return;

      setContextMenu(null);
      setIsExportingWholePack(true);
      try {
        const outputDirectory = await window.api?.selectDirectory();
        if (!outputDirectory) return;
        const result = await window.api?.exportPackedFilesToDirectory?.(packPath, outputDirectory, "all");
        showExportResult(result, outputDirectory);
      } catch (error) {
        console.error("Error exporting whole packed file:", error);
        props.showDialog(
          (localized.viewerErrorExportingPackedFiles || "Error exporting packed files: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerExportFailed || "Export Failed" },
        );
      } finally {
        setIsExportingWholePack(false);
      }
    };

    const applyImportItems = async (items: PackImportItem[], planningErrors: PackImportPlanError[] = []) => {
      setIsImporting(true);
      try {
        const result = await window.api?.applyPackImportFromDisk?.(packPath, items);
        const errors = [
          ...planningErrors.map((error) => `${error.diskPath || localized.viewerImport || "Import"}: ${error.message}`),
          ...(result?.errors ?? []).map(
            (error) => `${error.diskPath || localized.viewerImport || "Import"}: ${error.message}`,
          ),
        ];
        if (!result?.success && errors.length === 0) {
          errors.push(localized.viewerImportUnknownError || "Unknown import error");
        }
        if (errors.length > 0) {
          props.showDialog(
            (
              localized.viewerImportedWithErrors ||
              "Imported {{imported}} file(s), but {{failed}} file(s) failed:\n{{errors}}"
            )
              .replace("{{imported}}", String(result?.importedCount ?? 0))
              .replace("{{failed}}", String(errors.length))
              .replace("{{errors}}", errors.join("\n")),
            { title: localized.viewerImportFinishedWithErrors || "Import Finished With Errors" },
          );
        } else {
          props.showDialog(
            (localized.viewerImportedSuccess || "Imported {{count}} file(s). Press Save to write the pack.").replace(
              "{{count}}",
              String(result?.importedCount ?? 0),
            ),
            { title: localized.viewerImportComplete || "Import Complete" },
          );
        }
      } catch (error) {
        console.error("Error importing packed files:", error);
        props.showDialog(
          (localized.viewerErrorImportingPackedFiles || "Error importing packed files: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerImportFailed || "Import Failed" },
        );
      } finally {
        setIsImporting(false);
      }
    };

    const handleImport = async (kind: "file" | "folder") => {
      if (isImporting) return;

      const targetFolder = contextMenu?.target?.kind === "folder" ? contextMenu.target.folderPath : "";
      setContextMenu(null);
      setIsImporting(true);
      try {
        const sourcePaths =
          kind === "file" ? await window.api?.selectImportFiles?.() : await window.api?.selectImportFolders?.();
        if (!sourcePaths || sourcePaths.length === 0) return;

        const plan = await window.api?.planPackImportFromDisk?.(
          packPath,
          sourcePaths.map((sourcePath) => ({ path: sourcePath, kind })),
          targetFolder,
        );
        if (!plan) {
          props.showDialog(localized.viewerCouldNotPlanImport || "Could not plan the import", {
            title: localized.viewerImportFailed || "Import Failed",
          });
          return;
        }
        if (plan.items.length === 0) {
          const errors = plan.errors.map((error) => `${error.diskPath || "Import"}: ${error.message}`).join("\n");
          props.showDialog(errors || localized.viewerNoFilesToImport || "No files were found to import", {
            title: localized.viewerNothingToImport || "Nothing To Import",
          });
          return;
        }
        if (plan.items.some((item) => item.conflictsWith)) {
          props.onImportConflicts?.({ packPath, plan });
          return;
        }
        await applyImportItems(plan.items, plan.errors);
      } catch (error) {
        console.error("Error planning packed file import:", error);
        props.showDialog(
          (localized.viewerErrorImportingPackedFiles || "Error importing packed files: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerImportFailed || "Import Failed" },
        );
      } finally {
        setIsImporting(false);
      }
    };

    const handleCreateNewFlow = async () => {
      if (isCreatingNewFlow) return;
      if (!newFlowName.trim()) {
        props.showDialog(localized.viewerEnterValidFlowName || "Please enter a valid flow name", {
          title: localized.viewerMissingName || "Missing Name",
        });
        return;
      }

      if (!packData) {
        props.showDialog(localized.viewerPackNotLoaded || "The pack is still loading. Please try again.", {
          title: localized.viewerCreateFailed || "Create Failed",
        });
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

      setIsCreatingNewFlow(true);
      try {
        const result = await window.api?.saveNodeFlow(newFlowName.trim(), flowData, packData.packPath);
        if (!result?.success || !result.filePath) {
          throw new Error(result?.error || localized.viewerFailedToCreateFlow || "Failed to create flow");
        }
        console.log("Flow created successfully at:", result.filePath);
        props.onOpenFlowFile({ flowFile: result.filePath, packPath: packData.packPath });
        setIsNewFlowDialogOpen(false);
        setNewFlowName("");
      } catch (error) {
        console.error("Error creating flow:", error);
        props.showDialog(
          (localized.viewerCreateFlowError || "Failed to create flow: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerCreateFailed || "Create Failed" },
        );
      } finally {
        setIsCreatingNewFlow(false);
      }
    };

    /**
     * Creates the pack's whmm\load_order.whmm and opens it.
     *
     * There is no name dialog because the path is fixed - a pack has one rules file or none - so an
     * existing one is opened rather than silently overwritten.
     */
    const handleCreateLoadOrderRules = async () => {
      setContextMenu(null);
      if (!packData) {
        props.showDialog(localized.viewerPackNotLoaded || "The pack is still loading. Please try again.", {
          title: localized.viewerCreateFailed || "Create Failed",
        });
        return;
      }

      setActiveTreeTab("files");

      const existingName = [
        ...(packData.tables ?? []),
        ...Object.keys(packData.packedFiles ?? {}),
        ...unsavedFiles.map((file) => file.name),
      ].find((fileName) => isLoadOrderRulesPackedFilePath(fileName));
      if (existingName) {
        props.onOpenPackedFile({ filePath: existingName, packPath: packData.packPath });
        return;
      }

      const result = await window.api?.saveTextPackedFileEdits(
        packData.packPath,
        LOAD_ORDER_RULES_PACKED_FILE_PATH,
        serializeLoadOrderRuleRows([]),
      );
      if (!result?.success) {
        props.showDialog(result?.error || localized.viewerCreateFailed || "Create Failed", {
          title: localized.viewerCreateFailed || "Create Failed",
        });
        return;
      }

      props.onOpenPackedFile({ filePath: LOAD_ORDER_RULES_PACKED_FILE_PATH, packPath: packData.packPath });
    };

    const handleCreateNewTable = async () => {
      if (!packData) return;

      const trimmedTableName = newTableName.trim();
      const trimmedSuffix = newTableSuffix.trim();
      if (!trimmedTableName) {
        props.showDialog(localized.viewerChooseTable || "Please choose a table", {
          title: localized.viewerMissingTableTitle || "Missing Table",
        });
        return;
      }
      if (!trimmedSuffix) {
        props.showDialog(localized.viewerEnterTableSuffix || "Please enter the table name suffix", {
          title: localized.viewerMissingSuffixTitle || "Missing Suffix",
        });
        return;
      }
      if (/[\\/]/.test(trimmedSuffix)) {
        props.showDialog(localized.viewerInvalidTableSuffix || "Enter only the xxx portion of db/table_name/xxx", {
          title: localized.viewerInvalidSuffixTitle || "Invalid Suffix",
        });
        return;
      }

      const schema = selectedNewTableSchema;
      if (!schema) {
        props.showDialog(
          (localized.viewerNoSchemaFor || "No schema found for {{table}}").replace("{{table}}", trimmedTableName),
          { title: localized.viewerSchemaMissing || "Schema Missing" },
        );
        return;
      }

      const dbFolder = newTableIsUnused ? UNUSED_DB_TABLE_ROOT : DEFAULT_DB_TABLE_ROOT;
      const packedFileName = `${dbFolder}\\${trimmedTableName}\\${trimmedSuffix}`;
      const alreadyExistsInPack =
        packData.tables.includes(packedFileName) ||
        Boolean(packData.packedFiles?.[packedFileName]) ||
        unsavedFiles.some((file) => file.name === packedFileName);
      if (alreadyExistsInPack) {
        props.showDialog(
          (localized.viewerTableExistsAt || "A table already exists at {{path}}").replace(
            "{{path}}",
            packedFileName.replaceAll("\\", "/"),
          ),
          { title: localized.viewerTableExists || "Table Exists" },
        );
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
          throw new Error(result?.error || localized.viewerFailedToCreateDbTable || "Failed to create DB table");
        }

        dispatch(
          setUnsavedPacksData({
            packPath: packData.packPath,
            // Keep earlier staged edits visible. The IPC handler also merges this file into its
            // authoritative staging list, but this local update can win the render race.
            unsavedFileData: [...unsavedFiles.filter((file) => file.name !== nextPackedFile.name), nextPackedFile],
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
        props.showDialog(
          (localized.viewerCreateDbTableError || "Failed to create DB table: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerCreateFailed || "Create Failed" },
        );
        setIsCreatingNewTable(false);
      }
    };

    const renderTree = (
      treeTab: TreeTab,
      data: INode[],
      selectedIds: Array<string | number>,
      setSelectedNodeIds: React.Dispatch<React.SetStateAction<Array<string | number>>>,
      nodeById: Map<INode["id"], INode>,
      onSelect: (selectionProps: ITreeViewOnSelectProps) => void,
      defaultExpandedIds?: Array<string | number>,
    ) => (
      <TreeView
        key={`${treeTab}|${packPath}|${JSON.stringify(data.map((node) => node.id))}`}
        data={data}
        aria-label={
          treeTab === "db"
            ? localized.viewerDbFilesTree || "DB files tree"
            : localized.viewerPackedFilesTree || "Packed files tree"
        }
        defaultExpandedIds={defaultExpandedIds}
        expandedIds={expandedIdsByPack[packPath]?.[treeTab]?.filter((id) => nodeById.has(id))}
        onExpand={(expansionProps) => handleTreeExpand(treeTab, expansionProps, nodeById)}
        multiSelect={true}
        clickAction="EXCLUSIVE_SELECT"
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

              const idsToSelect = isBranch ? getDescendantLeafIds(element, nodeById) : [element.id as string | number];
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

              const idsToToggle = isBranch ? getDescendantLeafIds(element, nodeById) : [element.id as string | number];
              toggleIdsInSelection(idsToToggle, setSelectedNodeIds);
              lastLabelSelectionModeRef.current = null;
              return;
            }

            if (isBranch) {
              handleExpand(e);
              // A group has nothing useful to select. Matching the arrow's expand-only path avoids
              // a second full tree reconciliation before the expanded children can paint.
              openLoneChildOnExpand(element, !isExpanded, treeTab, nodeById);
              return;
            }

            // Let the tree update its own selection first so the highlight can paint immediately.
            // onSelect mirrors it into our state after that paint; writing both states here made the
            // controlled tree reconcile the entire node set twice for one click.
            beginSingleLabelSelection();
            handleSelect(e);

            // The tree only reports a selection that changed, so clicking the selected node again
            // never reaches onSelect. Opening it from here is what re-reads a flow whose graph was
            // replaced in the editor.
            if (isSelected) scheduleOpenForElement(element, treeTab);
          };

          const isContextTarget = isContextMenuTarget(element, treeTab, isBranch, nodeById);
          const nodePath = getNodeFullPath(element, nodeById).replaceAll("\\", "/");

          return (
            <div
              {...getNodeProps({
                onClick: (e) => {
                  e.stopPropagation();
                  handleExpand(e);
                  openLoneChildOnExpand(element, !isExpanded, treeTab, nodeById);
                },
              })}
              onContextMenu={(e) => {
                e.stopPropagation();
                if (isBranch) {
                  if (treeTab === "files") {
                    handleContextMenu(e, treeTab, {
                      kind: "folder",
                      packPath,
                      folderPath: getNodeFullPath(element, fileNodeById),
                    });
                  } else {
                    const groupPath = getNodeFullPath(element, dbNodeById);
                    const { dbFolder, dbName } = parseDBGroupName(groupPath);
                    handleContextMenu(e, treeTab, {
                      kind: "folder",
                      packPath,
                      folderPath: `${dbFolder}\\${dbName}`,
                    });
                  }
                  return;
                }

                if (treeTab === "db") {
                  const selection = getDBSelectionForElement(element);
                  const filePath = selection ? getDBPackedFilePath(selection) : undefined;
                  handleContextMenu(
                    e,
                    treeTab,
                    selection && filePath ? { kind: "db", packPath, filePath, selection } : undefined,
                  );
                  return;
                }

                const filePath = getPackedFilePathForElement(element);
                handleContextMenu(e, treeTab, filePath ? { kind: "file", packPath, filePath } : undefined);
              }}
              style={{
                marginLeft: PACK_TREE_INDENT_PX * (level - 1),
                opacity: isDisabled ? 0.5 : 1,
              }}
              className={
                "flex items-center [&:not(:first-child)]:mt-2 hover:overflow-visible cursor-pointer rounded " +
                (isBranch ? "font-medium text-gray-200 " : "text-gray-300 ") +
                (isContextTarget ? "bg-blue-700/60 " : isSelected ? "bg-gray-700/60 " : "") +
                "hover:underline " +
                (isTreeNodeFiltered(element, treeTab) ? "hidden" : "")
              }
            >
              {isBranch ? (
                <ArrowIcon className="" isOpen={isExpanded} />
              ) : (
                <span
                  aria-hidden="true"
                  className={`${PACK_TREE_MARKER_SIZE_CLASS} shrink-0 flex items-center justify-center`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500/80" />
                </span>
              )}
              <span
                onClick={handleLabelClick}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleOpenInNewTab(element, treeTab);
                }}
                className="relative select-none"
                title={nodePath}
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

    const showAddNewFlowInContext = Boolean(
      contextMenu &&
      !isVanillaPackOpen &&
      (contextMenu.treeTab === "empty" ||
        (contextMenu.treeTab === "files" && hasFiles) ||
        (contextMenu.treeTab === "db" && hasDBTables && !hasFiles)),
    );
    const showAddNewTableInContext = Boolean(
      contextMenu &&
      !isVanillaPackOpen &&
      (contextMenu.treeTab === "empty" ||
        (contextMenu.treeTab === "db" && hasDBTables) ||
        (contextMenu.treeTab === "files" && hasFiles && !hasDBTables)),
    );
    const showAddNewFolderInContext = Boolean(
      contextMenu && !isVanillaPackOpen && (contextMenu.treeTab === "files" || contextMenu.treeTab === "empty"),
    );
    const showImportInContext = Boolean(contextMenu && !isVanillaPackOpen);
    const showPackFileActionsInContext = Boolean(contextMenu && !isVanillaPackOpen && selectedExportPaths.length > 0);
    const deleteLabel =
      selectedExportPaths.length === 1
        ? localized.viewerDeleteFile || "Delete file"
        : (localized.viewerDeleteFiles || "Delete {{count}} files").replace(
            "{{count}}",
            String(selectedExportPaths.length),
          );
    const renameLabel =
      selectedExportPaths.length === 1
        ? localized.viewerRenameFile || "Rename file…"
        : (localized.viewerRenameFiles || "Rename {{count}} files…").replace(
            "{{count}}",
            String(selectedExportPaths.length),
          );
    const moveLabel =
      selectedExportPaths.length === 1
        ? localized.viewerMoveFile || "Move file…"
        : (localized.viewerMoveFiles || "Move {{count}} files…").replace(
            "{{count}}",
            String(selectedExportPaths.length),
          );
    const importAnchor = contextMenu?.target?.kind === "folder" ? contextMenu.target.folderPath : "";
    const importLabel = (kind: "file" | "folder") => {
      const label =
        kind === "file"
          ? localized.viewerImportFiles || "Import Files"
          : localized.viewerImportFolders || "Import Folders";
      return importAnchor
        ? (localized.viewerImportInto || "{{label}} into {{path}}…")
            .replace("{{label}}", label)
            .replace("{{path}}", importAnchor)
        : `${label}…`;
    };
    const showCopyIntoInContext = Boolean(
      contextMenu?.target && contextMenu.target.kind !== "folder" && props.onCopyInto,
    );
    const showAddInContext = showAddNewFlowInContext || showAddNewTableInContext || showAddNewFolderInContext;

    return (
      <div
        data-testid="pack-tables-tree"
        onContextMenu={(e) => handleContextMenu(e, visibleActiveTreeTab ?? "empty")}
        className="pack-tables-tree relative select-none h-full min-h-full"
      >
        {(hasDBTables || hasFiles) && (
          <div className="sticky top-0 z-10 flex border-b border-gray-700 bg-gray-900/95 mb-2">
            {hasDBTables && (
              <button
                type="button"
                onClick={() => setActiveTreeTab("db")}
                className={
                  "px-3 py-2 text-xs font-medium border-b-2 " +
                  (visibleActiveTreeTab === "db"
                    ? "text-white border-blue-500 bg-gray-800/80"
                    : "text-gray-400 border-transparent hover:text-white hover:bg-gray-800/60")
                }
              >
                {localized.viewerDbTables || "DB Tables"}
              </button>
            )}
            {hasFiles && (
              <button
                type="button"
                onClick={() => setActiveTreeTab("files")}
                className={
                  "px-3 py-2 text-xs font-medium border-b-2 " +
                  (visibleActiveTreeTab === "files"
                    ? "text-white border-blue-500 bg-gray-800/80"
                    : "text-gray-400 border-transparent hover:text-white hover:bg-gray-800/60")
                }
              >
                {localized.files || "Files"}
              </button>
            )}
          </div>
        )}

        {visibleActiveTreeTab === "db"
          ? renderTree(
              "db",
              dbData,
              safeDbSelectedNodeIds,
              setDbSelectedNodeIds,
              dbNodeById,
              onDBTreeSelect,
              dbDefaultExpandedIds,
            )
          : visibleActiveTreeTab === "files"
            ? renderTree(
                "files",
                fileData,
                safeFileSelectedNodeIds,
                setFileSelectedNodeIds,
                fileNodeById,
                onFileTreeSelect,
              )
            : null}

        {/* Context Menu */}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="fixed w-max min-w-[150px] overflow-visible bg-gray-800 border border-gray-600 rounded shadow-lg z-50"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            data-testid="pack-tables-context-menu"
          >
            {showCopyIntoInContext && contextMenu.target && (
              <CopyIntoSubmenu
                sourcePackPath={contextMenu.target.packPath}
                otherOpenPacks={props.otherOpenPacks}
                showDialog={props.showDialog}
                onSelectTarget={handleCopyIntoPack}
              />
            )}
            {showAddInContext && (
              <ContextMenuSubmenu label={localized.add || "Add"}>
                {showAddNewTableInContext && (
                  <button
                    type="button"
                    onClick={handleAddNewTable}
                    disabled={isLoadingNewTableOptions}
                    className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm disabled:opacity-50"
                  >
                    {isLoadingNewTableOptions
                      ? localized.viewerLoadingTables || "Loading Tables..."
                      : localized.viewerAddNewTable || "Add New Table"}
                  </button>
                )}
                {showAddNewFlowInContext && (
                  <button
                    type="button"
                    onClick={handleAddNewFlow}
                    className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm"
                  >
                    {localized.viewerAddNewFlow || "Add New Flow"}
                  </button>
                )}
                {showAddNewFlowInContext && (
                  <button
                    type="button"
                    onClick={() => void handleCreateLoadOrderRules()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm"
                  >
                    {localized.viewerAddNewLoadOrderRules || "Add New Load Order Rules"}
                  </button>
                )}
                {showAddNewFolderInContext && (
                  <button
                    type="button"
                    onClick={handleAddNewFolder}
                    className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm"
                  >
                    {localized.viewerAddNewFolder || "Add New Folder"}
                  </button>
                )}
              </ContextMenuSubmenu>
            )}
            {showAddInContext && showPackFileActionsInContext && (
              <div role="separator" className="my-1 border-t border-gray-700" />
            )}
            {showPackFileActionsInContext && (
              <>
                <button
                  type="button"
                  onClick={() => handleRenameRequest("rename")}
                  className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm"
                >
                  {renameLabel}
                </button>
                <button
                  type="button"
                  onClick={() => handleRenameRequest("move")}
                  className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm"
                >
                  {moveLabel}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteRequest}
                  className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm"
                >
                  {deleteLabel}
                </button>
              </>
            )}
            {showPackFileActionsInContext && showImportInContext && (
              <div role="separator" className="my-1 border-t border-gray-700" />
            )}
            {showImportInContext && (
              <ContextMenuSubmenu label={localized.viewerImport || "Import"}>
                <button
                  type="button"
                  onClick={() => void handleImport("file")}
                  disabled={isImporting}
                  className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm disabled:opacity-50"
                >
                  {isImporting ? localized.viewerImporting || "Importing…" : importLabel("file")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleImport("folder")}
                  disabled={isImporting}
                  className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm disabled:opacity-50"
                >
                  {isImporting ? localized.viewerImporting || "Importing…" : importLabel("folder")}
                </button>
              </ContextMenuSubmenu>
            )}
            <ContextMenuSubmenu label={localized.export || "Export"}>
              {selectedExportPaths.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleExportSelection()}
                  disabled={isExportingSelection || isExportingWholePack}
                  className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm disabled:opacity-50"
                >
                  {isExportingSelection
                    ? localized.viewerExporting || "Exporting…"
                    : localized.viewerExportSelection || "Export Selection…"}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleExportWholePack()}
                disabled={isExportingSelection || isExportingWholePack}
                className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm disabled:opacity-50"
              >
                {isExportingWholePack
                  ? localized.viewerExporting || "Exporting…"
                  : localized.viewerExportWholePack || "Export Whole Pack…"}
              </button>
            </ContextMenuSubmenu>
          </div>
        )}

        <Modal onClose={() => setDeleteConfirm(null)} show={!!deleteConfirm} size="md" position="center">
          <Modal.Header>{localized.viewerDeletePackedFiles || "Delete packed files"}</Modal.Header>
          <Modal.Body>
            <div className="text-sm text-gray-200">
              <p>
                {(
                  localized.viewerDeleteFromPack ||
                  "Delete {{count}} file(s) from this pack? The change will be staged until you save."
                ).replace("{{count}}", String(deleteConfirm?.length ?? 0))}
              </p>
              <ul className="mt-3 max-h-48 list-disc space-y-1 overflow-auto pl-5 text-gray-400 break-all">
                {(deleteConfirm ?? []).slice(0, 5).map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              {(deleteConfirm?.length ?? 0) > 5 && (
                <p className="mt-2 text-xs text-gray-500">
                  {(localized.viewerAndMore || "…and {{count}} more.").replace(
                    "{{count}}",
                    String((deleteConfirm?.length ?? 0) - 5),
                  )}
                </p>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              onClick={() => setDeleteConfirm(null)}
              className="rounded bg-gray-600 px-4 py-2 font-medium text-white hover:bg-gray-500"
            >
              {localized.cancel || "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteConfirm()}
              ref={deleteConfirmButtonRef}
              autoFocus
              className="rounded bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700"
            >
              {localized.delete || "Delete"}
            </button>
          </Modal.Footer>
        </Modal>

        <PackFileRenameModal
          show={!!renameRequest}
          mode={renameRequest?.mode ?? "rename"}
          paths={renameRequest?.paths ?? []}
          existingPaths={existingPackFilePaths}
          extraFolders={createdFoldersByPack[packPath] ?? []}
          onClose={() => setRenameRequest(null)}
          onApply={handleRenameApply}
        />

        <Modal
          onClose={() => {
            setNewFolderRequest(null);
            setNewFolderName("");
            setNewFolderError("");
          }}
          show={!!newFolderRequest}
          size="md"
          position="center"
        >
          <Modal.Header>{localized.viewerCreateNewFolder || "Create New Folder"}</Modal.Header>
          <Modal.Body>
            <form
              data-testid="new-folder-form"
              onSubmit={(event) => {
                event.preventDefault();
                handleCreateNewFolder();
              }}
            >
              <p className="mb-4 break-all text-sm text-gray-300">
                {(localized.viewerNewFolderUnder || "Create a folder under {{path}}.").replace(
                  "{{path}}",
                  newFolderRequest?.parentFolder || localized.viewerPackRoot || "Pack root",
                )}
              </p>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-300">{localized.viewerFolderName || "Folder name"}</span>
                <input
                  aria-label={localized.viewerFolderName || "Folder name"}
                  value={newFolderName}
                  onChange={(event) => {
                    setNewFolderName(event.target.value);
                    setNewFolderError("");
                  }}
                  className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                  autoFocus
                />
              </label>
              {newFolderError && <p className="mt-2 text-xs text-red-300">{newFolderError}</p>}
            </form>
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              onClick={() => {
                setNewFolderRequest(null);
                setNewFolderName("");
                setNewFolderError("");
              }}
              className="rounded bg-gray-600 px-4 py-2 font-medium text-white hover:bg-gray-500"
            >
              {localized.cancel || "Cancel"}
            </button>
            <button
              type="button"
              onClick={handleCreateNewFolder}
              disabled={!newFolderName.trim()}
              className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {localized.viewerCreate || "Create"}
            </button>
          </Modal.Footer>
        </Modal>

        {/* New Flow Dialog */}
        {isNewFlowDialogOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold text-white mb-4">
                {localized.viewerCreateNewFlow || "Create New Flow"}
              </h2>

              <div className="mb-4">
                <label className="block text-white text-sm font-medium mb-2">
                  {localized.viewerFlowName || "Flow Name"}
                </label>
                <input
                  type="text"
                  value={newFlowName}
                  onChange={(e) => setNewFlowName(e.target.value)}
                  disabled={isCreatingNewFlow}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCreateNewFlow();
                    } else if (e.key === "Escape") {
                      setIsNewFlowDialogOpen(false);
                      setNewFlowName("");
                    }
                  }}
                  className="w-full p-2 bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-400"
                  placeholder={localized.viewerFlowNamePlaceholder || "Enter flow name..."}
                  autoFocus
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    if (isCreatingNewFlow) return;
                    setIsNewFlowDialogOpen(false);
                    setNewFlowName("");
                  }}
                  disabled={isCreatingNewFlow}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                >
                  {localized.cancel || "Cancel"}
                </button>
                <button
                  onClick={handleCreateNewFlow}
                  disabled={isCreatingNewFlow || !newFlowName.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  {isCreatingNewFlow ? localized.viewerCreating || "Creating..." : localized.viewerCreate || "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {isNewTableDialogOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold text-white mb-4">
                {localized.viewerCreateNewDbTable || "Create New DB Table"}
              </h2>

              <div className="mb-4">
                <label className="block text-white text-sm font-medium mb-2">
                  {localized.viewerVanillaTable || "Vanilla Table"}
                </label>
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
                  placeholder={localized.viewerSearchTables || "Search tables..."}
                  isClearable={false}
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                />
              </div>

              <div className="mb-2">
                <label className="block text-white text-sm font-medium mb-2">
                  {localized.viewerTableSuffix || "Table Suffix"}
                </label>
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
                  placeholder={localized.viewerTableSuffixPlaceholder || "xxx"}
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
                  <span className="text-sm text-white">
                    {(localized.viewerCreateUnderUnused || "Create it under {{root}}/").replace(
                      "{{root}}",
                      UNUSED_DB_TABLE_ROOT,
                    )}
                  </span>
                  <HelpBadge
                    text={(
                      localized.viewerUnusedTableHelp ||
                      "The game only reads tables out of db/, so a table kept in {{root}}/ is inert: it does not load, does not override anything, and is not reported as a conflict with other mods.\n\nUse it to keep a variant beside the live table - a reworked balance pass, a version for a different submod - and edit it here like any other table.\n\nA flow can copy it over the live table with the Move Or Copy Files node, so which variant ships becomes a flow option rather than a manual file swap."
                    ).replaceAll("{{root}}", UNUSED_DB_TABLE_ROOT)}
                  />
                </label>
              </div>

              <div className="mb-4 text-sm text-gray-300">
                <div>
                  {localized.viewerPath || "Path:"}{" "}
                  {newTableName
                    ? `${newTableIsUnused ? UNUSED_DB_TABLE_ROOT : DEFAULT_DB_TABLE_ROOT}/${newTableName}/${newTableSuffix || "xxx"}`
                    : `${newTableIsUnused ? UNUSED_DB_TABLE_ROOT : DEFAULT_DB_TABLE_ROOT}/.../xxx`}
                </div>
                <div>
                  {localized.viewerVersion || "Version:"}{" "}
                  {selectedNewTableSchema?.version ?? (localized.viewerUnknown || "Unknown")}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={closeNewTableDialog}
                  disabled={isCreatingNewTable}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50"
                >
                  {localized.cancel || "Cancel"}
                </button>
                <button
                  onClick={handleCreateNewTable}
                  disabled={!newTableName || isCreatingNewTable}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                >
                  {isCreatingNewTable ? localized.viewerCreating || "Creating..." : localized.viewerCreate || "Create"}
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
