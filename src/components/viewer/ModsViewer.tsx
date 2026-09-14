import React, { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "react-redux";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faFile, faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import PackTablesTreeView, { CopyIntoSource, PackTablesTreeViewHandle, ViewerPackTarget } from "./PackTablesTreeView";
import ImportConflictsModal from "./ImportConflictsModal";
import PackFileView from "./PackFileView";
import PackTablesTableView, {
  type GoToReferenceRequest,
  type ReferenceNavigationRequest,
  type SearchNavigationRequest,
} from "./PackTablesTableView";
import { Resizable } from "re-resizable";
import debounce from "just-debounce-it";
import localizationContext from "../../localizationContext";
import { gameToPackWithDBTablesName, vanillaPackNames } from "../../supportedGames";
import { Modal } from "@/src/flowbite";
import DBDuplication from "@/src/components/viewer/DBDuplication";
import {
  removePackData,
  requestFlowFileReload,
  selectDBTable,
  selectFlowFile,
  setDeepCloneTarget,
  setPacksData,
} from "@/src/appSlice";
import NodeEditor from "../NodeEditor";
import type { RootState } from "../../store";
import type { PackedFile } from "@/src/packFileTypes";
import type { ShowViewerDialog } from "./viewerDialogs";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";
import {
  DEFAULT_DB_TABLE_ROOT,
  UNUSED_DB_TABLE_ROOT,
  getDBGroupName,
  getDBPackedFilePath,
  getPackNameFromPath,
  parseDBTablePath,
} from "@/src/utility/packFileHelpers";
import { clearPackDataStoreForPack } from "./packDataStore";
import { clearPreparedTableForPack } from "./tablePrepCache";
import { getDefaultSaveAsPackName, getPackFileInventory, getPreferredTreeTab, hasLoadedDBTable } from "./viewerHelpers";
import GlobalSearchPanel from "./GlobalSearchPanel";
import LoadOrderRulesView from "./LoadOrderRulesView";
import OpenPackDialog from "./OpenPackDialog";
import { isLoadOrderRulesPackedFilePath } from "@/src/utility/loadOrderRulesFile";
import { getVisibleRecentPackCount, MAX_RECENT_PACKS, sanitizeRecentPackPaths } from "@/src/utility/recentPackPaths";
import { useKeepMountedOnceActive } from "../useKeepMountedOnceActive";
import type { GlobalSearchDbResult, GlobalSearchLocResult, GlobalSearchResult } from "@/src/globalSearch/types";

type ViewerTabKind = "db" | "flow" | "file" | "loadOrderRules";

type ViewerTab = {
  id: string;
  fileKey: string;
  title: string;
  kind: ViewerTabKind;
  packPath: string;
  dbName?: string;
  dbSubname?: string;
  /** Absent means the live "db" folder, matching DBTable. */
  dbFolder?: string;
  flowFile?: string;
  filePath?: string;
};

type ViewerTabCandidate = Omit<ViewerTab, "id">;

type PackTab = { packPath: string; openTabs: ViewerTab[]; activeTabId: string | null };
type TableHistoryEntry = { tabId: string; tab: ViewerTab };
type TableHistoryState = { entries: TableHistoryEntry[]; index: number };
type CopyOverwriteRequest = {
  source: CopyIntoSource;
  targetPackPath: string;
  openAfterCopy: boolean;
  filePath: string;
};
type CopyTableNameRequest = {
  source: CopyIntoSource;
  targetPackPath: string;
  openAfterCopy: boolean;
  tableName: string;
  filePath: string;
  exactFileExists: boolean;
};
const EMPTY_TABS: ViewerTab[] = [];
const EMPTY_PACK_TARGETS: ViewerPackTarget[] = [];
const MAX_TABLE_HISTORY_ENTRIES = 100;
const DEFAULT_RECENT_PACK_ROW_HEIGHT = 36;
const RECENT_PACK_MENU_BOTTOM_MARGIN = 8;
/** Two 1 px borders plus Tailwind's py-1 (4 px on each side). */
const RECENT_PACK_MENU_VERTICAL_CHROME = 10;
/** Below this the modder File button cannot show its label inside the sidebar's width. */
const TOOLBAR_ICON_ONLY_SIDEBAR_WIDTH = 300;

const copyPackPathKey = (value: string) => value.replaceAll("/", "\\").toLowerCase();

const getRenamedDBTablePath = (filePath: string, tableName: string): string | undefined => {
  const parsed = parseDBTablePath(filePath);
  const trimmedTableName = tableName.trim();
  if (
    !parsed ||
    (parsed.dbFolder !== DEFAULT_DB_TABLE_ROOT && parsed.dbFolder !== UNUSED_DB_TABLE_ROOT) ||
    !trimmedTableName ||
    /[\\/]/.test(trimmedTableName)
  ) {
    return undefined;
  }

  return `${parsed.dbFolder}\\${trimmedTableName}\\${parsed.dbSubname}`;
};

const getDBTableNameForCopy = (filePath: string): string | undefined => {
  const parsed = parseDBTablePath(filePath);
  if (!parsed || (parsed.dbFolder !== DEFAULT_DB_TABLE_ROOT && parsed.dbFolder !== UNUSED_DB_TABLE_ROOT))
    return undefined;
  return parsed.dbName;
};

const hasDBSelectionTarget = (selection?: DBTableSelection): selection is DBTableSelection =>
  Boolean(selection?.packPath && selection.dbName && selection.dbSubname);

const getPackFileName = (packPath: string) => packPath.split(/[\\/]/).pop() ?? packPath;

const getTabPackedFilePath = (tab: ViewerTab): string | undefined => {
  if (tab.kind === "db" && tab.dbName && tab.dbSubname) {
    return getDBPackedFilePath({
      packPath: tab.packPath,
      dbFolder: tab.dbFolder,
      dbName: tab.dbName,
      dbSubname: tab.dbSubname,
    });
  }
  if (tab.kind === "flow") return tab.flowFile;
  if (tab.kind === "file") return tab.filePath;
  return undefined;
};

const getReferenceTargetSelection = (
  request: GoToReferenceRequest,
  targetPackPath: string,
  packsDataByPath: Record<string, PackViewData>,
  unsavedPacksDataByPath: Record<string, PackedFile[]>,
  preferredFolder = request.sourceDBFolder ?? DEFAULT_DB_TABLE_ROOT,
): DBTableSelection | undefined => {
  const sourcePackData = packsDataByPath[targetPackPath];
  const candidatePaths = [
    ...(sourcePackData?.tables ?? []),
    ...Object.keys(sourcePackData?.packedFiles ?? {}),
    ...(unsavedPacksDataByPath[targetPackPath] ?? []).map((file) => file.name),
  ];
  const targetTables = [...new Set(candidatePaths)]
    .map((path) => parseDBTablePath(path))
    .filter((parsed): parsed is NonNullable<typeof parsed> => parsed?.dbName === request.targetTableName);
  const sameFolderTables = targetTables.filter((table) => table.dbFolder === preferredFolder);
  const availableTables = sameFolderTables.length > 0 ? sameFolderTables : targetTables;
  if (availableTables.length === 0) return undefined;

  const selectedTable =
    availableTables.find((table) => table.dbSubname === request.sourceDBSubname) ??
    availableTables.find((table) => table.dbSubname === "data__") ??
    availableTables[0];

  return {
    packPath: targetPackPath,
    dbFolder: selectedTable.dbFolder,
    dbName: request.targetTableName,
    dbSubname: selectedTable.dbSubname,
  };
};

const findLoadedPackPathByName = (
  packsDataByPath: Record<string, PackViewData>,
  packName: string,
): string | undefined => {
  const normalizedPackName = packName.toLowerCase();
  return Object.entries(packsDataByPath).find(
    ([packPath, packData]) =>
      packData.packName?.toLowerCase() === normalizedPackName ||
      getPackFileName(packPath).toLowerCase() === normalizedPackName,
  )?.[0];
};

const ModsViewer = memo(() => {
  const dispatch = useAppDispatch();
  const viewerStore = useStore<RootState>();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const currentFlowFileSelection = useAppSelector((state) => state.app.currentFlowFileSelection);
  const currentFlowFilePackPath = useAppSelector((state) => state.app.currentFlowFilePackPath);
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  // Use currentFlowFilePackPath if a flow file is selected, otherwise use DB table pack path.
  // This is only the Redux fallback for the content pane; pack tabs own the active path once opened.
  const reduxFallbackPackPath =
    currentFlowFilePackPath ??
    currentDBTableSelection?.packPath ??
    (gameToPackWithDBTablesName[currentGame] || "db.pack");
  const deepCloneTarget = useAppSelector((state) => state.app.deepCloneTarget);
  const startArgs = useAppSelector((state) => state.app.startArgs);
  const packsDataByPath = useAppSelector((state) => state.app.packsData);
  const unsavedPacksDataByPath = useAppSelector((state) => state.app.unsavedPacksData);
  const deletedPackFilePathsByPath = useAppSelector((state) => state.app.deletedPackFilePaths);
  const recentPackPaths = useAppSelector((state) => state.app.recentPackPaths);
  const dbPackName = gameToPackWithDBTablesName[currentGame] || "db.pack";
  const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);
  const selectCurrentPackUnsavedFiles = useMemo(makeSelectCurrentPackUnsavedFiles, []);

  const [isOpen, setIsOpen] = React.useState(true);
  const [isSaveAsModalOpen, setIsSaveAsModalOpen] = React.useState(false);
  const [saveAsPackName, setSaveAsPackName] = React.useState("");
  const [saveAsDirectory, setSaveAsDirectory] = React.useState<string | undefined>(undefined);
  const [isSaveAsProcessing, setIsSaveAsProcessing] = React.useState(false);
  /** Path of the pack Save As would replace, while we ask whether to. */
  const [overwriteConfirmPath, setOverwriteConfirmPath] = React.useState<string | null>(null);
  const [isNewPackModalOpen, setIsNewPackModalOpen] = React.useState(false);
  const [newPackName, setNewPackName] = React.useState("");
  const [isNewPackProcessing, setIsNewPackProcessing] = React.useState(false);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const [isOpenPackDialogOpen, setIsOpenPackDialogOpen] = useState(false);
  const [isRecentPacksOpen, setIsRecentPacksOpen] = useState(false);
  const [visibleRecentPackCount, setVisibleRecentPackCount] = useState(MAX_RECENT_PACKS);
  const [packCloseConfirmPath, setPackCloseConfirmPath] = useState<string | null>(null);
  const [copyOverwriteRequest, setCopyOverwriteRequest] = useState<CopyOverwriteRequest | null>(null);
  const [importConflictRequest, setImportConflictRequest] = useState<PackImportConflictRequest | null>(null);
  const [isImportProcessing, setIsImportProcessing] = useState(false);
  const [copyTableNameRequest, setCopyTableNameRequest] = useState<CopyTableNameRequest | null>(null);
  const [copyTableName, setCopyTableName] = useState("");
  const [isCopyProcessing, setIsCopyProcessing] = useState(false);
  const [packTabs, setPackTabs] = useState<PackTab[]>([]);
  const [activePackPath, setActivePackPath] = useState<string | null>(null);
  const [referenceNavigation, setReferenceNavigation] = useState<ReferenceNavigationRequest | undefined>(undefined);
  const referenceNavigationIdRef = useRef(0);
  const pendingReferenceNavigationRef = useRef<{ requestId: number; request: GoToReferenceRequest } | undefined>(
    undefined,
  );
  // Written synchronously so a handler can create a pack tab and open a file tab in it in one tick,
  // before setActivePackPath has been applied.
  const activePackPathRef = useRef<string | null>(null);
  const activatePackTab = useCallback((packPath: string | null) => {
    activePackPathRef.current = packPath;
    setActivePackPath(packPath);
  }, []);
  const activePackTab = useMemo(
    () => packTabs.find((packTab) => packTab.packPath === activePackPath) ?? null,
    [packTabs, activePackPath],
  );
  const openTabs = activePackTab?.openTabs ?? EMPTY_TABS;
  const activeTabId = activePackTab?.activeTabId ?? null;
  const isDBPackOpen = packTabs.some((packTab) => {
    const packName = packsDataByPath[packTab.packPath]?.packName ?? getPackFileName(packTab.packPath);
    return packName.toLowerCase() === dbPackName.toLowerCase();
  });
  const setOpenTabs = useCallback((action: React.SetStateAction<ViewerTab[]>) => {
    const targetPackPath = activePackPathRef.current;
    if (!targetPackPath) return;
    setPackTabs((prev) =>
      prev.map((packTab) =>
        packTab.packPath !== targetPackPath
          ? packTab
          : { ...packTab, openTabs: typeof action === "function" ? action(packTab.openTabs) : action },
      ),
    );
  }, []);
  const setActiveTabId = useCallback((tabId: string | null) => {
    const targetPackPath = activePackPathRef.current;
    if (!targetPackPath) return;
    setPackTabs((prev) =>
      prev.map((packTab) => (packTab.packPath === targetPackPath ? { ...packTab, activeTabId: tabId } : packTab)),
    );
  }, []);
  const [messageDialog, setMessageDialog] = useState<{ title: string; message: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const activeTab = useMemo(() => openTabs.find((tab) => tab.id === activeTabId) ?? null, [openTabs, activeTabId]);
  const activeViewerPackPath = activePackPath ?? reduxFallbackPackPath;
  const currentPackData = useAppSelector((state) => selectCurrentPackData(state, activeViewerPackPath));
  const unsavedFiles = useAppSelector((state) => selectCurrentPackUnsavedFiles(state, activeViewerPackPath));
  const packOpenRequest = useAppSelector((state) => state.app.packOpenRequest);
  const packFileInventory = useMemo(
    () => (currentPackData ? getPackFileInventory(currentPackData, unsavedFiles) : undefined),
    [currentPackData, unsavedFiles],
  );
  const availableRecentPackPaths = useMemo(
    () => sanitizeRecentPackPaths(recentPackPaths, vanillaPackNames),
    [recentPackPaths],
  );

  const preferredTreeTabCacheRef = useRef<
    Record<
      string,
      {
        packData: PackViewData | undefined;
        unsavedFiles: PackedFile[] | undefined;
        openTabs: ViewerTab[];
        activeTabId: string | null;
        preferredTab: "db" | "files";
      }
    >
  >({});
  // Choosing the tree's sub-tab scans a pack's whole file list, so it is cached per pack against the
  // inputs it actually reads. A plain memo over the three maps would rescan every open pack whenever
  // any one of them changed, which is once per table edit.
  const preferredTreeTabByPackPath = useMemo(() => {
    const cache = preferredTreeTabCacheRef.current;
    const preferredTabs: Record<string, "db" | "files"> = {};

    for (const packTab of packTabs) {
      const packData = packsDataByPath[packTab.packPath];
      const unsavedFiles = unsavedPacksDataByPath[packTab.packPath];
      const cached = cache[packTab.packPath];
      if (
        cached &&
        cached.packData === packData &&
        cached.unsavedFiles === unsavedFiles &&
        cached.openTabs === packTab.openTabs &&
        cached.activeTabId === packTab.activeTabId
      ) {
        preferredTabs[packTab.packPath] = cached.preferredTab;
        continue;
      }

      const preferredTab = getPreferredTreeTab(packTab, packsDataByPath, unsavedPacksDataByPath);
      cache[packTab.packPath] = {
        packData,
        unsavedFiles,
        openTabs: packTab.openTabs,
        activeTabId: packTab.activeTabId,
        preferredTab,
      };
      preferredTabs[packTab.packPath] = preferredTab;
    }

    return preferredTabs;
  }, [packTabs, packsDataByPath, unsavedPacksDataByPath]);

  const treeViewRefs = useRef<Record<string, PackTablesTreeViewHandle | null>>({});
  const treeViewRefCallbacksRef = useRef<Record<string, React.RefCallback<PackTablesTreeViewHandle>>>({});
  const viewerRootRef = useRef<HTMLDivElement>(null);
  const sidebarResizableRef = useRef<Resizable>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const recentPackMenuRef = useRef<HTMLDivElement>(null);
  const recentPackFirstButtonRef = useRef<HTMLButtonElement>(null);
  const [isSidebarNarrow, setIsSidebarNarrow] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  // Hidden rather than unmounted once it has been opened, so closing and reopening keeps the query,
  // the options and the results that are already in. Nothing is paid for until the first open.
  const isGlobalSearchMounted = useKeepMountedOnceActive(isGlobalSearchOpen);
  /**
   * A result whose pack the viewer has not loaded yet, held until it arrives.
   *
   * Opening a tab is not enough for such a pack: the content pane shows "Loading pack…" until
   * packsData carries it, and only requestOpenModInViewer makes main read and push it.
   */
  const pendingSearchNavigationRef = useRef<{ packPath: string; apply: () => void } | null>(null);
  const searchNavigationIdRef = useRef(0);
  const [searchNavigation, setSearchNavigation] = useState<SearchNavigationRequest | undefined>(undefined);
  const saveAsPackNameInputRef = useRef<HTMLInputElement>(null);
  const newPackNameInputRef = useRef<HTMLInputElement>(null);
  const copyTableNameInputRef = useRef<HTMLInputElement>(null);
  const tabIdCounterRef = useRef(0);
  const tableHistoryRef = useRef<TableHistoryState>({ entries: [], index: -1 });
  const lastActionRef = useRef<{ key: string; at: number; openedNew: boolean; tabId?: string } | null>(null);
  const lastHandledPackOpenNonceRef = useRef(0);
  const didRunTestDBCloneRef = useRef(false);
  const lastObservedPackOpenNonceRef = useRef(0);
  const pendingPackOpenRequestsRef = useRef<PackOpenRequest[]>([]);
  /** Do not re-open the default table after the user deliberately closes the pack's last tab. */
  const suppressDefaultTableOpenForPackPathsRef = useRef(new Set<string>());
  const [packOpenRequestVersion, setPackOpenRequestVersion] = useState(0);
  const lastSelectionKeyRef = useRef<string | null>(null);
  const lastProcessedSelectionRequestKeyRef = useRef<string | null>(null);
  const suppressSelectionToTabSyncRef = useRef(false);
  const currentDBTableSelectionRef = useRef(currentDBTableSelection);
  const currentFlowFileSelectionRef = useRef(currentFlowFileSelection);
  const currentFlowFilePackPathRef = useRef(currentFlowFilePackPath);

  const localized: Record<string, string> = useContext(localizationContext);

  const showDialog = useCallback<ShowViewerDialog>(
    (message, options) => {
      setMessageDialog({ title: options?.title ?? localized.viewerMessage ?? "Message", message });
    },
    [localized.viewerMessage],
  );

  /** For outcomes worth confirming but not worth a click to dismiss, like a successful save. */
  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  const getTreeViewRef = useCallback((packPath: string) => {
    const existingCallback = treeViewRefCallbacksRef.current[packPath];
    if (existingCallback) return existingCallback;

    const callback: React.RefCallback<PackTablesTreeViewHandle> = (handle) => {
      treeViewRefs.current[packPath] = handle;
    };
    treeViewRefCallbacksRef.current[packPath] = callback;
    return callback;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    currentDBTableSelectionRef.current = currentDBTableSelection;
    currentFlowFileSelectionRef.current = currentFlowFileSelection;
    currentFlowFilePackPathRef.current = currentFlowFilePackPath;
  }, [currentDBTableSelection, currentFlowFilePackPath, currentFlowFileSelection]);

  // Focus on the Save As pack name input when modal opens
  useEffect(() => {
    if (isSaveAsModalOpen && saveAsPackNameInputRef.current) {
      window.focus();
      setTimeout(() => {
        saveAsPackNameInputRef.current?.focus();
        // The field arrives prefilled with the open pack's name, so select it: typing replaces it,
        // and clicking puts the caret where you clicked.
        saveAsPackNameInputRef.current?.select();
      }, 0);
    }
  }, [isSaveAsModalOpen]);

  // Focus on the New Pack name input when modal opens
  useEffect(() => {
    if (isNewPackModalOpen && newPackNameInputRef.current) {
      window.focus();
      setTimeout(() => {
        newPackNameInputRef.current?.focus();
      }, 0);
    }
  }, [isNewPackModalOpen]);

  useEffect(() => {
    if (!copyTableNameRequest || !copyTableNameInputRef.current) return;
    window.focus();
    setTimeout(() => {
      copyTableNameInputRef.current?.focus();
      copyTableNameInputRef.current?.select();
    }, 0);
  }, [copyTableNameRequest]);

  useEffect(() => {
    if (!isFileMenuOpen) return;

    const dismissFileMenu = (event: MouseEvent) => {
      if (fileMenuRef.current?.contains(event.target as Node)) return;
      setIsFileMenuOpen(false);
    };
    const closeFileMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsFileMenuOpen(false);
      fileMenuButtonRef.current?.focus();
    };

    document.addEventListener("mousedown", dismissFileMenu, true);
    document.addEventListener("keydown", closeFileMenuOnEscape);
    return () => {
      document.removeEventListener("mousedown", dismissFileMenu, true);
      document.removeEventListener("keydown", closeFileMenuOnEscape);
    };
  }, [isFileMenuOpen]);

  useEffect(() => {
    if (!isFileMenuOpen) setIsRecentPacksOpen(false);
  }, [isFileMenuOpen]);

  useLayoutEffect(() => {
    if (!isRecentPacksOpen || availableRecentPackPaths.length === 0) return;

    const updateVisibleRecentPackCount = () => {
      const menuTop = recentPackMenuRef.current?.getBoundingClientRect().top ?? 0;
      const rowHeight =
        recentPackFirstButtonRef.current?.getBoundingClientRect().height || DEFAULT_RECENT_PACK_ROW_HEIGHT;
      const availableHeight = Math.max(
        0,
        window.innerHeight - menuTop - RECENT_PACK_MENU_BOTTOM_MARGIN - RECENT_PACK_MENU_VERTICAL_CHROME,
      );
      setVisibleRecentPackCount(getVisibleRecentPackCount(availableHeight, rowHeight));
    };

    updateVisibleRecentPackCount();
    window.addEventListener("resize", updateVisibleRecentPackCount);
    return () => window.removeEventListener("resize", updateVisibleRecentPackCount);
  }, [availableRecentPackPaths.length, isRecentPacksOpen]);

  useEffect(() => {
    if (!isFeaturesForModdersEnabled) setIsFileMenuOpen(false);
  }, [isFeaturesForModdersEnabled]);

  const [dbTableFilter, setDBTableFilter] = useState("");
  const [dbTableFilterInput, setDBTableFilterInput] = useState("");

  const onFilterChangeDebounced = useMemo(
    () =>
      debounce((value: string) => {
        setDBTableFilter(value);
      }, 250),
    [],
  );

  useEffect(() => {
    return () => {
      (onFilterChangeDebounced as unknown as { cancel?: () => void }).cancel?.();
    };
  }, [onFilterChangeDebounced]);

  const clearFilter = () => {
    (onFilterChangeDebounced as unknown as { cancel?: () => void }).cancel?.();
    setDBTableFilterInput("");
    setDBTableFilter("");
  };

  const createTabId = useCallback(() => `tab-${Date.now()}-${++tabIdCounterRef.current}`, []);

  const recordTableHistory = useCallback((tab: ViewerTab) => {
    // Flows and packed files belong in the history too. Leaving them out kept the pointer on the
    // table shown before them, so the first Back from one landed two tables away and they could
    // never be returned to. A db tab with no table is the empty "select a file" placeholder, which
    // is not somewhere to navigate back to.
    if (tab.kind === "db" && (!tab.dbName || !tab.dbSubname)) return;

    const history = tableHistoryRef.current;
    const currentEntry = history.entries[history.index];
    if (currentEntry?.tabId === tab.id && currentEntry.tab.fileKey === tab.fileKey) return;

    const nextEntries = history.entries.slice(0, history.index + 1);
    nextEntries.push({ tabId: tab.id, tab: { ...tab } });

    if (nextEntries.length > MAX_TABLE_HISTORY_ENTRIES) nextEntries.shift();
    tableHistoryRef.current = {
      entries: nextEntries,
      index: nextEntries.length - 1,
    };
  }, []);

  const removeTableHistoryEntries = useCallback((shouldRemove: (entry: TableHistoryEntry) => boolean) => {
    const history = tableHistoryRef.current;
    const currentEntry = history.entries[history.index];
    const nextEntries = history.entries.filter((entry) => !shouldRemove(entry));
    if (nextEntries.length === history.entries.length) return;

    const preservedIndex = currentEntry ? nextEntries.indexOf(currentEntry) : -1;
    // With the current entry gone, closing a tab falls back to its left-hand neighbour, so the
    // pointer follows it left. Leaving it where it was would park it on what is now a forward
    // entry, which puts that entry out of reach of both Back and Forward.
    const fallbackIndex = Math.max(-1, Math.min(history.index - 1, nextEntries.length - 1));
    tableHistoryRef.current = {
      entries: nextEntries,
      index: preservedIndex >= 0 ? preservedIndex : fallbackIndex,
    };
  }, []);

  const activatePackTabFromUser = useCallback(
    (packPath: string) => {
      const packTab = packTabs.find((candidate) => candidate.packPath === packPath);
      const activeTab = packTab?.openTabs.find((tab) => tab.id === packTab.activeTabId);
      if (activeTab) recordTableHistory(activeTab);
      activatePackTab(packPath);
    },
    [activatePackTab, packTabs, recordTableHistory],
  );

  const activateViewerTabFromUser = useCallback(
    (tabId: string) => {
      const tab = openTabs.find((candidate) => candidate.id === tabId);
      if (tab) recordTableHistory(tab);
      setActiveTabId(tabId);
    },
    [openTabs, recordTableHistory, setActiveTabId],
  );

  const buildDbTabCandidate = useCallback((selection: DBTableSelection): ViewerTabCandidate => {
    const packLabel = getPackNameFromPath(selection.packPath) ?? selection.packPath;
    // The folder belongs in both: without it a spare copy and the live table are the same tab, and
    // the titles would be indistinguishable even if they were not.
    const groupName = getDBGroupName(selection.dbFolder || DEFAULT_DB_TABLE_ROOT, selection.dbName);
    return {
      fileKey: `db|${selection.packPath}|${getDBPackedFilePath(selection)}`,
      title: `${groupName}/${selection.dbSubname}${packLabel ? ` | ${packLabel}` : ""}`,
      kind: "db",
      packPath: selection.packPath,
      dbFolder: selection.dbFolder,
      dbName: selection.dbName,
      dbSubname: selection.dbSubname,
    };
  }, []);

  const buildFlowTabCandidate = useCallback(
    (flowFile: string, packPath: string): ViewerTabCandidate => {
      const packLabel = getPackNameFromPath(packPath) ?? packPath;
      const shortFlowName = flowFile.replace(/^whmmflows[\\/]/, "");
      const flowLabel = shortFlowName ? `${localized.viewerFlowPrefix || "Flow:"}${shortFlowName}` : flowFile;
      return {
        fileKey: `flow|${packPath}|${flowFile}`,
        title: `${flowLabel}${packLabel ? ` | ${packLabel}` : ""}`,
        kind: "flow",
        packPath,
        flowFile,
      };
    },
    [localized.viewerFlowPrefix],
  );

  const buildPackedFileTabCandidate = useCallback(
    (filePath: string, packPath: string): ViewerTabCandidate => {
      const packLabel = getPackNameFromPath(packPath) ?? packPath;
      const shortFileName = filePath.split(/[\\/]/).pop() ?? filePath;

      // The rules file is text on disk but gets its own two column editor, the same way a flow is
      // json on disk but opens in the node editor.
      if (isLoadOrderRulesPackedFilePath(filePath)) {
        const rulesLabel = localized.viewerLoadOrderRulesTitle || "Load Order Rules";
        return {
          fileKey: `loadOrderRules|${packPath}`,
          title: `${rulesLabel}${packLabel ? ` | ${packLabel}` : ""}`,
          kind: "loadOrderRules",
          packPath,
          filePath,
        };
      }

      return {
        fileKey: `file|${packPath}|${filePath}`,
        title: `${shortFileName}${packLabel ? ` | ${packLabel}` : ""}`,
        kind: "file",
        packPath,
        filePath,
      };
    },
    [localized.viewerLoadOrderRulesTitle],
  );

  const openOrActivatePackTab = useCallback(
    (packPath: string) => {
      setPackTabs((prev) =>
        prev.some((packTab) => packTab.packPath === packPath)
          ? prev
          : [...prev, { packPath, openTabs: [], activeTabId: null }],
      );
      activatePackTab(packPath);
    },
    [activatePackTab],
  );

  const openOrActivateTab = useCallback(
    (candidate: ViewerTabCandidate, options: { forceNewTab?: boolean } = {}) => {
      // Routing to the candidate's pack first means every decision below has to read that pack's
      // tabs, not the ones still closed over from whichever pack was active a moment ago.
      if (activePackPathRef.current !== candidate.packPath) openOrActivatePackTab(candidate.packPath);
      const targetPackTab = packTabs.find((packTab) => packTab.packPath === candidate.packPath) ?? null;
      const targetOpenTabs = targetPackTab?.openTabs ?? EMPTY_TABS;
      const targetActiveTabId = targetPackTab?.activeTabId ?? null;
      const now = Date.now();
      const lastAction = lastActionRef.current;
      const actionKey = `${candidate.packPath}|${candidate.fileKey}`;
      const isJustOpenedSame =
        lastAction && lastAction.key === actionKey && lastAction.openedNew && now - lastAction.at < 350;

      // Effects can be replayed before React commits the state update (notably under StrictMode).
      // Treat an immediate repeat of the same open request as the same tab, regardless of whether
      // the request came from the tree's double-click path or the default-table opener.
      if (isJustOpenedSame && lastAction?.tabId) {
        setActiveTabId(lastAction.tabId);
        return;
      }

      // Reuse existing tab with same fileKey instead of always creating a new one
      if (options.forceNewTab) {
        const existingTab =
          targetOpenTabs.find((tab) => tab.fileKey === candidate.fileKey && tab.id !== targetActiveTabId) ??
          targetOpenTabs.find((tab) => tab.fileKey === candidate.fileKey);
        if (existingTab) {
          setActiveTabId(existingTab.id);
          lastActionRef.current = { key: actionKey, at: now, openedNew: false, tabId: existingTab.id };
          recordTableHistory({ ...existingTab, ...candidate });
          return;
        }
      }

      let openedNew = false;
      let tabToActivate: ViewerTab;

      if (options.forceNewTab || !targetActiveTabId) {
        const newTab: ViewerTab = { id: createTabId(), ...candidate };
        openedNew = true;
        tabToActivate = newTab;
        setOpenTabs((prevTabs) => [...prevTabs, newTab]);
      } else {
        const activeTabIndex = targetOpenTabs.findIndex((tab) => tab.id === targetActiveTabId);
        if (activeTabIndex < 0) {
          const newTab: ViewerTab = { id: createTabId(), ...candidate };
          openedNew = true;
          tabToActivate = newTab;
          setOpenTabs((prevTabs) => [...prevTabs, newTab]);
        } else {
          tabToActivate = { ...targetOpenTabs[activeTabIndex], ...candidate };
          setOpenTabs((prevTabs) => prevTabs.map((tab) => (tab.id === tabToActivate.id ? tabToActivate : tab)));
        }
      }

      setActiveTabId(tabToActivate.id);
      lastActionRef.current = { key: actionKey, at: now, openedNew, tabId: tabToActivate.id };
      recordTableHistory(tabToActivate);
      if (tabToActivate.kind === "db" && tabToActivate.dbName && tabToActivate.dbSubname) {
        const selection = {
          dbFolder: tabToActivate.dbFolder,
          dbName: tabToActivate.dbName,
          dbSubname: tabToActivate.dbSubname,
          packPath: tabToActivate.packPath,
        };
        const isLoaded = hasLoadedDBTable(
          packsDataByPath[tabToActivate.packPath],
          unsavedPacksDataByPath[tabToActivate.packPath] ?? [],
          selection,
        );
        if (!isLoaded) {
          window.api?.getPackData(tabToActivate.packPath, selection);
        }
      }
    },
    [
      createTabId,
      openOrActivatePackTab,
      packTabs,
      packsDataByPath,
      recordTableHistory,
      setActiveTabId,
      setOpenTabs,
      unsavedPacksDataByPath,
    ],
  );

  const handleOpenDBTable = useCallback(
    (selection: DBTableSelection, options?: { forceNewTab?: boolean }) => {
      if (!hasDBSelectionTarget(selection)) return;
      openOrActivateTab(buildDbTabCandidate(selection), options);
    },
    [buildDbTabCandidate, openOrActivateTab],
  );

  const restoreTableHistoryEntry = useCallback(
    (entry: TableHistoryEntry): boolean => {
      const targetPackTab = packTabs.find((packTab) => packTab.packPath === entry.tab.packPath);
      const targetTab = targetPackTab?.openTabs.find((tab) => tab.id === entry.tabId);
      if (!targetPackTab || !targetTab) return false;

      // The entry holds a whole tab, so it replaces rather than merges: merging would leave the
      // flowFile or filePath of whatever the tab holds now on a tab restored to a table.
      const restoredTab = { ...entry.tab, id: entry.tabId };
      activatePackTab(entry.tab.packPath);
      setPackTabs((prevPackTabs) =>
        prevPackTabs.map((packTab) => {
          if (packTab.packPath !== entry.tab.packPath) return packTab;
          return {
            ...packTab,
            openTabs: packTab.openTabs.map((tab) => (tab.id === entry.tabId ? restoredTab : tab)),
            activeTabId: entry.tabId,
          };
        }),
      );

      if (restoredTab.kind === "db" && restoredTab.dbName && restoredTab.dbSubname) {
        const selection = {
          dbFolder: restoredTab.dbFolder,
          dbName: restoredTab.dbName,
          dbSubname: restoredTab.dbSubname,
          packPath: restoredTab.packPath,
        };
        const isLoaded = hasLoadedDBTable(
          packsDataByPath[restoredTab.packPath],
          unsavedPacksDataByPath[restoredTab.packPath] ?? [],
          selection,
        );
        if (!isLoaded) window.api?.getPackData(restoredTab.packPath, selection);
      }

      return true;
    },
    [activatePackTab, packTabs, packsDataByPath, unsavedPacksDataByPath],
  );

  const navigateTableHistory = useCallback(
    (direction: -1 | 1) => {
      const history = tableHistoryRef.current;
      let nextIndex = history.index + direction;

      while (nextIndex >= 0 && nextIndex < history.entries.length) {
        const entry = history.entries[nextIndex];
        if (entry && restoreTableHistoryEntry(entry)) {
          history.index = nextIndex;
          return;
        }
        nextIndex += direction;
      }
    },
    [restoreTableHistoryEntry],
  );

  const handleGoToReference = useCallback(
    (request: GoToReferenceRequest) => {
      const requestId = ++referenceNavigationIdRef.current;
      const navigateToTarget = (target: DBTableSelection) => {
        pendingReferenceNavigationRef.current = undefined;
        setReferenceNavigation({
          requestId,
          target,
          targetColumnName: request.targetColumnName,
          value: request.value,
        });
        handleOpenDBTable(target);
      };

      const target = getReferenceTargetSelection(
        request,
        request.sourcePackPath,
        packsDataByPath,
        unsavedPacksDataByPath,
      );
      if (target) {
        navigateToTarget(target);
        return;
      }

      const dbPackPath = findLoadedPackPathByName(packsDataByPath, dbPackName);
      if (dbPackPath) {
        const vanillaTarget = getReferenceTargetSelection(
          request,
          dbPackPath,
          packsDataByPath,
          unsavedPacksDataByPath,
          DEFAULT_DB_TABLE_ROOT,
        );
        if (vanillaTarget) {
          navigateToTarget(vanillaTarget);
          return;
        }
      }

      pendingReferenceNavigationRef.current = { requestId, request };
      window.api?.requestOpenModInViewer(dbPackName);
    },
    [dbPackName, handleOpenDBTable, packsDataByPath, unsavedPacksDataByPath],
  );

  const handleReferenceNavigationHandled = useCallback((requestId: number) => {
    setReferenceNavigation((current) => (current?.requestId === requestId ? undefined : current));
  }, []);

  const handleSearchNavigationHandled = useCallback((requestId: number) => {
    setSearchNavigation((current) => (current?.requestId === requestId ? undefined : current));
  }, []);

  useEffect(() => {
    const pending = pendingReferenceNavigationRef.current;
    if (!pending) return;

    const dbPackPath = findLoadedPackPathByName(packsDataByPath, dbPackName);
    if (!dbPackPath) return;

    const target = getReferenceTargetSelection(
      pending.request,
      dbPackPath,
      packsDataByPath,
      unsavedPacksDataByPath,
      DEFAULT_DB_TABLE_ROOT,
    );
    if (!target) {
      pendingReferenceNavigationRef.current = undefined;
      return;
    }

    pendingReferenceNavigationRef.current = undefined;
    setReferenceNavigation({
      requestId: pending.requestId,
      target,
      targetColumnName: pending.request.targetColumnName,
      value: pending.request.value,
    });
    handleOpenDBTable(target);
  }, [dbPackName, handleOpenDBTable, packsDataByPath, unsavedPacksDataByPath]);

  const handleOpenFlowFile = useCallback(
    (selection: { flowFile: string; packPath: string }, options?: { forceNewTab?: boolean }) => {
      openOrActivateTab(buildFlowTabCandidate(selection.flowFile, selection.packPath), options);
      // Picking a flow here means "show me what is in the pack", which is how you get its saved
      // contents back after replacing the graph in place. Landing on the flow the editor already
      // holds moves neither the tab nor the selection, whether it opens in this tab or another one,
      // so the reload has to be asked for rather than left to those changing.
      dispatch(requestFlowFileReload());
    },
    [buildFlowTabCandidate, dispatch, openOrActivateTab],
  );

  const handleOpenPackedFile = useCallback(
    (selection: { filePath: string; packPath: string }, options?: { forceNewTab?: boolean }) => {
      openOrActivateTab(buildPackedFileTabCandidate(selection.filePath, selection.packPath), options);
    },
    [buildPackedFileTabCandidate, openOrActivateTab],
  );

  const isPackLoaded = useCallback(
    (packPath: string) =>
      Object.keys(packsDataByPath).some((loadedPath) => copyPackPathKey(loadedPath) === copyPackPathKey(packPath)),
    [packsDataByPath],
  );

  /** Applies a selection now when its pack is loaded, or asks main for the pack and applies it then. */
  const navigateToPack = useCallback(
    (packPath: string, apply: () => void) => {
      if (isPackLoaded(packPath)) {
        apply();
        return;
      }
      pendingSearchNavigationRef.current = { packPath, apply };
      window.api?.requestOpenModInViewer(packPath);
    },
    [isPackLoaded],
  );

  useEffect(() => {
    const pending = pendingSearchNavigationRef.current;
    if (!pending || !isPackLoaded(pending.packPath)) return;
    pendingSearchNavigationRef.current = null;
    pending.apply();
  }, [isPackLoaded, packsDataByPath]);

  const handleOpenGlobalSearchDbResult = useCallback(
    (result: GlobalSearchDbResult | GlobalSearchLocResult) => {
      const target =
        result.kind === "db"
          ? {
              packPath: result.packPath,
              dbName: result.dbName,
              dbSubname: result.dbSubname,
              dbFolder: result.dbFolder,
            }
          : (() => {
              const parsed = parseDBTablePath(result.filePath.replaceAll("/", "\\"));
              return parsed ? { packPath: result.packPath, ...parsed } : undefined;
            })();
      if (!target) return;

      const navigation: SearchNavigationRequest = {
        requestId: ++searchNavigationIdRef.current,
        target,
        ...(result.kind === "db" ? { rowIndex: result.rowIndex } : { rowKey: result.key }),
      };

      navigateToPack(result.packPath, () => {
        setSearchNavigation(navigation);
        handleOpenDBTable(target);
      });
    },
    [handleOpenDBTable, navigateToPack],
  );

  const handleOpenGlobalSearchFileResult = useCallback(
    (result: Exclude<GlobalSearchResult, GlobalSearchDbResult | GlobalSearchLocResult>) => {
      navigateToPack(result.packPath, () =>
        handleOpenPackedFile({ packPath: result.packPath, filePath: result.filePath }),
      );
    },
    [handleOpenPackedFile, navigateToPack],
  );

  useEffect(() => {
    if (!isOpen) return;
    const root = viewerRootRef.current;
    if (!root) return;

    const isHistoryMouseButton = (event: MouseEvent) => event.button === 3 || event.button === 4;
    const consumeHistoryMouseButton = (event: MouseEvent) => {
      if (!isHistoryMouseButton(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (!isHistoryMouseButton(event)) return;
      consumeHistoryMouseButton(event);
      navigateTableHistory(event.button === 3 ? -1 : 1);
    };

    // XButton1/XButton2 are reported as buttons 3 and 4. Capture the event before a child control or
    // Electron's default page navigation can consume it, while auxclick/mouseup only suppress the
    // browser action so one physical click cannot navigate twice.
    root.addEventListener("mousedown", handleMouseDown, true);
    root.addEventListener("auxclick", consumeHistoryMouseButton, true);
    root.addEventListener("mouseup", consumeHistoryMouseButton, true);
    return () => {
      root.removeEventListener("mousedown", handleMouseDown, true);
      root.removeEventListener("auxclick", consumeHistoryMouseButton, true);
      root.removeEventListener("mouseup", consumeHistoryMouseButton, true);
    };
  }, [isOpen, navigateTableHistory]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+Shift+F, the search-across-files chord every editor uses. It toggles: the same
      // keystroke puts the dock away, and the panel keeps its state while hidden.
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      setIsGlobalSearchOpen((isPanelOpen) => !isPanelOpen);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const globalSearchOpenPacks = useMemo(
    () =>
      packTabs.map((packTab) => ({
        packPath: packTab.packPath,
        label: packsDataByPath[packTab.packPath]?.packName ?? getPackNameFromPath(packTab.packPath) ?? packTab.packPath,
      })),
    [packTabs, packsDataByPath],
  );

  const getTargetPackFileNames = useCallback(
    async (targetPackPath: string): Promise<Set<string> | undefined> => {
      const targetPackDataPath = Object.keys(packsDataByPath).find(
        (packPath) => copyPackPathKey(packPath) === copyPackPathKey(targetPackPath),
      );
      const targetUnsavedDataPath = Object.keys(unsavedPacksDataByPath).find(
        (packPath) => copyPackPathKey(packPath) === copyPackPathKey(targetPackPath),
      );
      const targetPackData = targetPackDataPath ? packsDataByPath[targetPackDataPath] : undefined;
      const targetUnsavedFiles = targetUnsavedDataPath
        ? unsavedPacksDataByPath[targetUnsavedDataPath] || []
        : undefined;

      if (targetPackData || targetUnsavedFiles) {
        return new Set([
          ...(targetPackData?.tables || []),
          ...Object.keys(targetPackData?.packedFiles || {}),
          ...(targetUnsavedFiles || []).map((file) => file.name),
        ]);
      }

      if (!window.api?.getPackFilesList) return undefined;
      return new Set(await window.api.getPackFilesList(targetPackPath));
    },
    [packsDataByPath, unsavedPacksDataByPath],
  );

  const handleCopyInto = useCallback(
    async (
      source: CopyIntoSource,
      targetPackPath: string,
      openAfterCopy: boolean,
      overwriteExisting = false,
      destinationFilePath?: string,
    ) => {
      setIsCopyProcessing(true);
      try {
        const sourceTableName = getDBTableNameForCopy(source.filePath);
        if (sourceTableName && !overwriteExisting) {
          const targetFileNames = await getTargetPackFileNames(targetPackPath);
          if (targetFileNames) {
            const hasTableName = (tableName: string) =>
              [...targetFileNames].some((filePath) => {
                const targetTableName = getDBTableNameForCopy(filePath);
                return targetTableName?.toLowerCase() === tableName.toLowerCase();
              });

            if (destinationFilePath) {
              const destinationTableName = getDBTableNameForCopy(destinationFilePath);
              if (destinationTableName && hasTableName(destinationTableName)) {
                showDialog(
                  (
                    localized.viewerTableDestinationExists ||
                    'The destination already contains a table named "{{name}}"'
                  ).replace("{{name}}", destinationTableName),
                  { title: localized.viewerTableAlreadyExists || "Table Already Exists" },
                );
                return;
              }
            }

            const hasSameTableName = !destinationFilePath && hasTableName(sourceTableName);
            if (hasSameTableName) {
              setCopyTableNameRequest({
                source,
                targetPackPath,
                openAfterCopy,
                tableName: sourceTableName,
                filePath: source.filePath,
                exactFileExists: [...targetFileNames].some(
                  (filePath) => copyPackPathKey(filePath) === copyPackPathKey(source.filePath),
                ),
              });
              setCopyTableName(sourceTableName);
              return;
            }
          }
        }

        let result:
          | {
              success: boolean;
              targetPackPath?: string;
              filePath?: string;
              overwriteRequired?: boolean;
              tableNameRequired?: boolean;
              tableName?: string;
              error?: string;
            }
          | undefined;

        if (source.kind === "dbRows") {
          if (!source.rows || !source.tableSchema) {
            result = {
              success: false,
              error: localized.viewerSelectedRowsNoSchema || "The selected rows do not have a table schema",
            };
          } else {
            const copiedFile: PackedFile = {
              name: destinationFilePath || source.filePath,
              file_size: 0,
              start_pos: -1,
              is_compressed: false,
              schemaFields: source.rows.flat(),
              tableSchema: source.tableSchema,
              version: source.version,
            };
            const saveResult = await window.api?.saveDBTableEdits(targetPackPath, copiedFile);
            result = saveResult?.success
              ? { success: true, targetPackPath, filePath: copiedFile.name }
              : {
                  success: false,
                  error: saveResult?.error || localized.viewerFailedToSaveCopiedRows || "Failed to save copied rows",
                };
          }
        } else if (destinationFilePath) {
          result = await window.api?.copyPackedFileToPack(
            source.packPath,
            source.filePath,
            targetPackPath,
            overwriteExisting,
            destinationFilePath,
          );
        } else {
          result = await window.api?.copyPackedFileToPack(
            source.packPath,
            source.filePath,
            targetPackPath,
            overwriteExisting,
          );
        }

        if (result?.tableNameRequired && !destinationFilePath && !overwriteExisting) {
          setCopyTableNameRequest({
            source,
            targetPackPath,
            openAfterCopy,
            tableName: result.tableName || sourceTableName || "",
            filePath: result.filePath || source.filePath,
            exactFileExists: false,
          });
          setCopyTableName(result.tableName || sourceTableName || "");
          return;
        }
        if (result?.overwriteRequired && !overwriteExisting) {
          setCopyOverwriteRequest({
            source,
            targetPackPath,
            openAfterCopy,
            filePath: result.filePath || source.filePath,
          });
          return;
        }
        if (!result?.success) {
          showDialog(
            (localized.viewerFailedToCopyFile || "Failed to copy {{path}}: {{error}}")
              .replace("{{path}}", source.filePath)
              .replace("{{error}}", result?.error || localized.viewerUnknownError || "Unknown error"),
            { title: localized.viewerCopyFailed || "Copy Failed" },
          );
          return;
        }

        setCopyOverwriteRequest(null);
        setCopyTableNameRequest(null);
        setCopyTableName("");
        if (!openAfterCopy) return;

        const copiedPackPath = result.targetPackPath || targetPackPath;
        const copiedFilePath = result.filePath || destinationFilePath || source.filePath;
        const targetWasAlreadyOpen = packTabs.some((packTab) => packTab.packPath === copiedPackPath);
        if (!targetWasAlreadyOpen && !copiedPackPath.startsWith("memory://")) {
          // This asks the main process to load the destination's file index and register its viewer
          // tab. The local tab is opened immediately below so the copied file can be selected in the
          // same interaction, even while that index is still arriving.
          window.api?.requestOpenModInViewer(copiedPackPath);
        }
        openOrActivatePackTab(copiedPackPath);

        if ((source.kind === "db" || source.kind === "dbRows") && source.dbSelection) {
          const copiedTable = parseDBTablePath(copiedFilePath);
          handleOpenDBTable({
            ...source.dbSelection,
            ...(copiedTable
              ? {
                  dbFolder: copiedTable.dbFolder,
                  dbName: copiedTable.dbName,
                  dbSubname: copiedTable.dbSubname,
                }
              : {}),
            packPath: copiedPackPath,
          });
        } else if (copiedFilePath.startsWith("whmmflows\\")) {
          handleOpenFlowFile({ flowFile: copiedFilePath, packPath: copiedPackPath });
        } else {
          handleOpenPackedFile({ filePath: copiedFilePath, packPath: copiedPackPath });
        }
      } catch (error) {
        console.error("Error copying packed file into another pack:", error);
        showDialog(
          (localized.viewerFailedToCopyFile || "Failed to copy {{path}}: {{error}}")
            .replace("{{path}}", source.filePath)
            .replace(
              "{{error}}",
              error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
            ),
          { title: localized.viewerCopyFailed || "Copy Failed" },
        );
      } finally {
        setIsCopyProcessing(false);
      }
    },
    [
      handleOpenDBTable,
      handleOpenFlowFile,
      handleOpenPackedFile,
      getTargetPackFileNames,
      openOrActivatePackTab,
      packTabs,
      localized,
      showDialog,
    ],
  );

  const handleConfirmCopyOverwrite = useCallback(() => {
    if (!copyOverwriteRequest || isCopyProcessing) return;
    void handleCopyInto(
      copyOverwriteRequest.source,
      copyOverwriteRequest.targetPackPath,
      copyOverwriteRequest.openAfterCopy,
      true,
    );
  }, [copyOverwriteRequest, handleCopyInto, isCopyProcessing]);

  const handleImportConflicts = useCallback(
    async (items: PackImportItem[]) => {
      if (!importConflictRequest || isImportProcessing) return;
      setIsImportProcessing(true);
      try {
        const result = await window.api?.applyPackImportFromDisk?.(importConflictRequest.packPath, items);
        const errors = [
          ...importConflictRequest.plan.errors.map((error) => `${error.diskPath || "Import"}: ${error.message}`),
          ...(result?.errors ?? []).map(
            (error) => `${error.diskPath || localized.viewerImport || "Import"}: ${error.message}`,
          ),
        ];
        if (!result?.success && errors.length === 0) {
          errors.push(localized.viewerImportUnknownError || "Unknown import error");
        }
        if (errors.length > 0) {
          showDialog(
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
          showDialog(
            (localized.viewerImportedSuccess || "Imported {{count}} file(s). Press Save to write the pack.").replace(
              "{{count}}",
              String(result?.importedCount ?? 0),
            ),
            { title: localized.viewerImportComplete || "Import Complete" },
          );
        }
      } catch (error) {
        console.error("Error importing files after conflict confirmation:", error);
        showDialog(
          (localized.viewerErrorImportingPackedFiles || "Error importing packed files: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerImportFailed || "Import Failed" },
        );
      } finally {
        setIsImportProcessing(false);
        setImportConflictRequest(null);
      }
    },
    [importConflictRequest, isImportProcessing, localized, showDialog],
  );

  const handleCopyTableWithNewName = useCallback(() => {
    if (!copyTableNameRequest || isCopyProcessing) return;
    if (copyTableName.trim().toLowerCase() === copyTableNameRequest.tableName.trim().toLowerCase()) {
      showDialog(localized.viewerTableNameUnchanged || "Enter a different table name for the copy", {
        title: localized.viewerTableNameUnchangedTitle || "Table Name Unchanged",
      });
      return;
    }
    const destinationFilePath = getRenamedDBTablePath(copyTableNameRequest.filePath, copyTableName);
    if (!destinationFilePath) {
      showDialog(localized.viewerInvalidTableName || "Enter a valid table name without slashes", {
        title: localized.viewerInvalidTableNameTitle || "Invalid Table Name",
      });
      return;
    }

    void handleCopyInto(
      copyTableNameRequest.source,
      copyTableNameRequest.targetPackPath,
      copyTableNameRequest.openAfterCopy,
      false,
      destinationFilePath,
    );
  }, [copyTableName, copyTableNameRequest, handleCopyInto, isCopyProcessing, localized, showDialog]);

  const handleOverwriteOriginalTable = useCallback(() => {
    if (!copyTableNameRequest || isCopyProcessing || !copyTableNameRequest.exactFileExists) return;
    void handleCopyInto(
      copyTableNameRequest.source,
      copyTableNameRequest.targetPackPath,
      copyTableNameRequest.openAfterCopy,
      true,
    );
  }, [copyTableNameRequest, handleCopyInto, isCopyProcessing]);

  // Keep each target list referentially stable while the user switches packs. The tree views stay
  // mounted so they can retain their expansion and selection, and a fresh array here would defeat
  // their memoization on every active-pack change.
  const otherOpenPacksByPackPath = useMemo(() => {
    const targetsBySourcePath = new Map<string, ViewerPackTarget[]>();

    for (const sourcePackTab of packTabs) {
      targetsBySourcePath.set(
        sourcePackTab.packPath,
        packTabs
          .filter((packTab) => packTab.packPath !== sourcePackTab.packPath)
          .map((packTab) => ({
            packPath: packTab.packPath,
            label:
              packsDataByPath[packTab.packPath]?.packName ?? getPackNameFromPath(packTab.packPath) ?? packTab.packPath,
          })),
      );
    }

    return targetsBySourcePath;
  }, [packTabs, packsDataByPath]);

  const handleCloseTab = useCallback(
    (tabId: string, packPath = activePackPathRef.current) => {
      const targetPackPath = packPath;
      if (!targetPackPath) return;
      const targetPackTab = packTabs.find((packTab) => packTab.packPath === targetPackPath);
      if (targetPackTab?.openTabs.length === 1 && targetPackTab.openTabs[0]?.id === tabId) {
        suppressDefaultTableOpenForPackPathsRef.current.add(targetPackPath);
      }
      removeTableHistoryEntries((entry) => entry.tabId === tabId);
      // Derived inside the updater so a pack opened over IPC between render and click is not clobbered.
      setPackTabs((prevPackTabs) =>
        prevPackTabs.map((packTab) => {
          if (packTab.packPath !== targetPackPath) return packTab;
          const tabIndex = packTab.openTabs.findIndex((tab) => tab.id === tabId);
          if (tabIndex < 0) return packTab;
          const nextOpenTabs = packTab.openTabs.filter((tab) => tab.id !== tabId);
          const nextActiveTabId =
            tabId === packTab.activeTabId
              ? ((nextOpenTabs[tabIndex - 1] ?? nextOpenTabs[tabIndex])?.id ?? null)
              : packTab.activeTabId;
          return { ...packTab, openTabs: nextOpenTabs, activeTabId: nextActiveTabId };
        }),
      );
    },
    [packTabs, removeTableHistoryEntries],
  );

  const handlePackFilePathsRemoved = useCallback(
    (packPath: string, removedPaths: string[]) => {
      const removedKeys = new Set(removedPaths.map((path) => path.replaceAll("/", "\\").toLowerCase()));
      const affectedTabs =
        packTabs
          .find((packTab) => packTab.packPath === packPath)
          ?.openTabs.filter((tab) => {
            const packedFilePath = getTabPackedFilePath(tab);
            return packedFilePath ? removedKeys.has(packedFilePath.replaceAll("/", "\\").toLowerCase()) : false;
          }) ?? [];
      for (const tab of affectedTabs) handleCloseTab(tab.id, packPath);
    },
    [handleCloseTab, packTabs],
  );

  // With no pack tab open, activeViewerPackPath is only the Redux fallback (the game's db pack), which
  // nobody asked to open - saving it is not on offer.
  const hasActivePackTab = activePackPath != undefined;
  const hasUnsavedFiles =
    hasActivePackTab &&
    (unsavedFiles.length > 0 || (deletedPackFilePathsByPath[activeViewerPackPath]?.length ?? 0) > 0);
  // Save As works on any pack that exists on disk, changed or not - it saves a copy. A memory pack
  // has no file to copy, so it needs something unsaved in it before there is anything to write.
  const canSavePackAs = hasActivePackTab && (!activeViewerPackPath.startsWith("memory://") || hasUnsavedFiles);

  useEffect(() => {
    if (!activePackPath) return;
    const activeTab =
      openTabs.find((tab) => tab.id === activeTabId) ??
      ({
        fileKey: `pack|${activePackPath}`,
        kind: "db",
        packPath: activePackPath,
        dbName: "",
        dbSubname: "",
        id: "",
        title: "",
      } as ViewerTab);
    const currentDBSelection = currentDBTableSelectionRef.current;
    const currentFlowSelection = currentFlowFileSelectionRef.current;
    const currentFlowPackPath = currentFlowFilePackPathRef.current;

    if (activeTab.kind === "flow" && activeTab.flowFile) {
      const isAlreadySelected =
        currentFlowSelection === activeTab.flowFile && currentFlowPackPath === activeTab.packPath;
      if (isAlreadySelected) {
        lastSelectionKeyRef.current = activeTab.fileKey;
        return;
      }
      suppressSelectionToTabSyncRef.current = true;
      dispatch(selectFlowFile({ flowFile: activeTab.flowFile, packPath: activeTab.packPath }));
      lastSelectionKeyRef.current = activeTab.fileKey;
      return;
    }

    if (activeTab.kind === "file" && activeTab.filePath) {
      const isAlreadySelected =
        !currentFlowSelection &&
        currentDBSelection?.packPath === activeTab.packPath &&
        !currentDBSelection?.dbName &&
        !currentDBSelection?.dbSubname;
      if (!isAlreadySelected) {
        suppressSelectionToTabSyncRef.current = true;
        if (currentFlowSelection) dispatch(selectFlowFile(undefined));
        dispatch(
          selectDBTable({
            packPath: activeTab.packPath,
            dbName: "",
            dbSubname: "",
          }),
        );
      }
      lastSelectionKeyRef.current = activeTab.fileKey;
      return;
    }

    if (activeTab.kind === "db" && activeTab.packPath && !activeTab.dbName && !activeTab.dbSubname) {
      const isAlreadySelected =
        !currentFlowSelection &&
        currentDBSelection?.packPath === activeTab.packPath &&
        !currentDBSelection?.dbName &&
        !currentDBSelection?.dbSubname;
      if (isAlreadySelected) {
        lastSelectionKeyRef.current = activeTab.fileKey;
        return;
      }
      suppressSelectionToTabSyncRef.current = true;
      if (currentFlowSelection) {
        dispatch(selectFlowFile(undefined));
      }
      dispatch(
        selectDBTable({
          packPath: activeTab.packPath,
          dbName: "",
          dbSubname: "",
        }),
      );
      lastSelectionKeyRef.current = activeTab.fileKey;
      return;
    }

    if (activeTab.dbName && activeTab.dbSubname) {
      const isAlreadySelected =
        !currentFlowSelection &&
        currentDBSelection?.packPath === activeTab.packPath &&
        (currentDBSelection?.dbFolder ?? DEFAULT_DB_TABLE_ROOT) === (activeTab.dbFolder ?? DEFAULT_DB_TABLE_ROOT) &&
        currentDBSelection?.dbName === activeTab.dbName &&
        currentDBSelection?.dbSubname === activeTab.dbSubname;
      if (isAlreadySelected) {
        lastSelectionKeyRef.current = activeTab.fileKey;
        return;
      }
      suppressSelectionToTabSyncRef.current = true;
      if (currentFlowSelection) {
        dispatch(selectFlowFile(undefined));
      }
      dispatch(
        selectDBTable({
          packPath: activeTab.packPath,
          dbFolder: activeTab.dbFolder,
          dbName: activeTab.dbName,
          dbSubname: activeTab.dbSubname,
        }),
      );
      lastSelectionKeyRef.current = activeTab.fileKey;
    }
  }, [activePackPath, activeTabId, openTabs, dispatch]);

  useEffect(() => {
    let selectionRequestKey: string | null = null;
    if (currentFlowFileSelection) {
      const flowPackPath = currentFlowFilePackPath ?? currentDBTableSelection?.packPath ?? reduxFallbackPackPath;
      if (flowPackPath) {
        selectionRequestKey = `flow|${flowPackPath}|${currentFlowFileSelection}`;
      }
    } else if (hasDBSelectionTarget(currentDBTableSelection)) {
      selectionRequestKey = `db|${currentDBTableSelection.packPath}|${
        currentDBTableSelection.dbFolder ?? DEFAULT_DB_TABLE_ROOT
      }|${currentDBTableSelection.dbName}|${currentDBTableSelection.dbSubname}`;
    }

    if (suppressSelectionToTabSyncRef.current) {
      suppressSelectionToTabSyncRef.current = false;
      lastProcessedSelectionRequestKeyRef.current = selectionRequestKey;
      return;
    }

    if (selectionRequestKey === lastProcessedSelectionRequestKeyRef.current) {
      return;
    }

    // A selection aimed at a pack that is not in front belongs to whichever tab owns it, so it waits
    // rather than being recorded as handled - recording it would strand the tab for good, since the
    // key never repeats once activating that pack makes it actionable.
    const selectionPackPath = currentFlowFileSelection
      ? (currentFlowFilePackPath ?? currentDBTableSelection?.packPath ?? reduxFallbackPackPath)
      : currentDBTableSelection?.packPath;
    if (activePackPath && selectionPackPath && selectionPackPath !== activePackPath) return;

    lastProcessedSelectionRequestKeyRef.current = selectionRequestKey;

    if (currentFlowFileSelection) {
      const flowPackPath = currentFlowFilePackPath ?? currentDBTableSelection?.packPath ?? reduxFallbackPackPath;
      if (!flowPackPath) return;
      const candidate = buildFlowTabCandidate(currentFlowFileSelection, flowPackPath);
      if (lastSelectionKeyRef.current === candidate.fileKey) return;
      openOrActivateTab(candidate);
      return;
    }

    if (hasDBSelectionTarget(currentDBTableSelection)) {
      const candidate = buildDbTabCandidate(currentDBTableSelection);
      if (lastSelectionKeyRef.current === candidate.fileKey) return;
      openOrActivateTab(candidate);
      return;
    }
  }, [
    currentFlowFileSelection,
    currentFlowFilePackPath,
    currentDBTableSelection,
    reduxFallbackPackPath,
    activePackPath,
    buildFlowTabCandidate,
    buildDbTabCandidate,
    openOrActivateTab,
  ]);

  useEffect(() => {
    const capturePackOpenRequest = () => {
      const request = viewerStore.getState().app.packOpenRequest;
      if (!request) {
        // removePackData clears a request for the closed path; allow that path to be reopened with
        // the reducer's fresh nonce sequence.
        lastObservedPackOpenNonceRef.current = 0;
        lastHandledPackOpenNonceRef.current = 0;
        return;
      }
      if (request.nonce <= lastObservedPackOpenNonceRef.current) return;
      lastObservedPackOpenNonceRef.current = request.nonce;
      pendingPackOpenRequestsRef.current.push(request);
      setPackOpenRequestVersion((version) => version + 1);
    };

    const unsubscribe = viewerStore.subscribe(capturePackOpenRequest);
    capturePackOpenRequest();
    return unsubscribe;
  }, [viewerStore]);

  useEffect(() => {
    // The selector is retained as a dependency for the initial/fallback path; the store
    // subscription above captures every nonce even when React batches several dispatches together.
    if (packOpenRequest && packOpenRequest.nonce > lastObservedPackOpenNonceRef.current) {
      lastObservedPackOpenNonceRef.current = packOpenRequest.nonce;
      pendingPackOpenRequestsRef.current.push(packOpenRequest);
    }

    const pendingRequests = pendingPackOpenRequestsRef.current.splice(0);
    for (const request of pendingRequests) {
      if (request.nonce <= lastHandledPackOpenNonceRef.current) continue;
      lastHandledPackOpenNonceRef.current = request.nonce;
      openOrActivatePackTab(request.packPath);
    }
  }, [packOpenRequest, packOpenRequestVersion, openOrActivatePackTab]);

  useEffect(() => {
    if (activePackPath) window.api?.setViewerActivePack?.(activePackPath);
  }, [activePackPath]);

  useEffect(() => {
    if (!activePackPath) return;
    if (suppressDefaultTableOpenForPackPathsRef.current.has(activePackPath)) return;
    if (activeTabId) return;
    if (currentFlowFileSelection && currentFlowFilePackPath === activePackPath) return;
    if (hasDBSelectionTarget(currentDBTableSelection) && currentDBTableSelection.packPath === activePackPath) return;

    if (!currentPackData) return;

    const hasDefaultTable = currentPackData.tables.includes("db\\main_units_tables\\data__");
    if (!hasDefaultTable) return;

    handleOpenDBTable({
      packPath: activeViewerPackPath,
      dbName: "main_units_tables",
      dbSubname: "data__",
    });
  }, [
    activePackPath,
    activeTabId,
    currentFlowFilePackPath,
    currentFlowFileSelection,
    currentDBTableSelection,
    currentPackData,
    activeViewerPackPath,
    handleOpenDBTable,
  ]);

  const handleSavePack = useCallback(async () => {
    if (!hasUnsavedFiles) return;

    try {
      const result = await window.api?.savePackWithUnsavedFiles(activeViewerPackPath);
      if (result?.success) {
        console.log("Pack saved successfully:", result.savedPath);
        if (result.replacedOriginal !== false) {
          // The main process invalidates its pack cache and sends the staged files as the new base
          // data. Drop renderer-side parsed/prepared copies too, otherwise reference navigation or a
          // later table switch can still read the pre-save snapshot.
          clearPackDataStoreForPack(activeViewerPackPath);
          clearPreparedTableForPack(activeViewerPackPath);
        }
        // A warning is something to read, so it keeps the dialog; a plain success does not.
        if (result.warning) {
          showDialog(
            `${result.warning}\n\n${(localized.viewerSavedTo || "Saved to: {{path}}").replace("{{path}}", result.savedPath ?? "")}`,
            { title: localized.viewerPackSaved || "Pack Saved" },
          );
        } else {
          showToast(
            (localized.viewerPackSavedTo || "Pack saved to: {{path}}").replace("{{path}}", result.savedPath ?? ""),
          );
        }
      } else {
        console.error("Failed to save pack:", result?.error);
        showDialog(
          (localized.viewerSavePackError || "Failed to save pack: {{error}}").replace(
            "{{error}}",
            result?.error || localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerSaveFailed || "Save Failed" },
        );
      }
    } catch (error) {
      console.error("Error saving pack:", error);
      showDialog(
        (localized.viewerSavePackException || "Error saving pack: {{error}}").replace(
          "{{error}}",
          error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
        ),
        { title: localized.viewerSaveFailed || "Save Failed" },
      );
    }
  }, [activeViewerPackPath, hasUnsavedFiles, localized, showDialog, showToast]);

  const handleSavePackAs = useCallback(async () => {
    // Deliberately not gated on unsaved changes: Save As on an untouched pack saves a copy of it.
    setSaveAsPackName(getDefaultSaveAsPackName(activeViewerPackPath));
    setSaveAsDirectory(undefined);
    setOverwriteConfirmPath(null);
    setIsSaveAsModalOpen(true);

    // The data folder is where the game reads packs from, so it is the useful default. Fetched per
    // open rather than cached because the selected game can change while the viewer stays up.
    const dataFolder = await window.api?.getDataFolder();
    // Only fills a still-empty field: Browse may already have won the race.
    if (dataFolder) setSaveAsDirectory((currentDirectory) => currentDirectory ?? dataFolder);
  }, [activeViewerPackPath]);

  const handleSaveAsConfirm = useCallback(
    async (overwriteExisting = false) => {
      if (!saveAsPackName.trim() || !saveAsDirectory) {
        showDialog(localized.viewerMissingInformation || "Please enter a pack name and select a directory", {
          title: localized.viewerMissingInformationTitle || "Missing Information",
        });
        return;
      }

      setIsSaveAsProcessing(true);

      try {
        const result = await window.api?.savePackAsWithUnsavedFiles(
          activeViewerPackPath,
          saveAsPackName.trim(),
          saveAsDirectory,
          overwriteExisting,
        );
        if (result?.alreadyExists) {
          // Nothing was written; ask before replacing what is there.
          setOverwriteConfirmPath(result.savedPath ?? "");
        } else if (result?.success) {
          console.log("Pack saved as successfully:", result.savedPath);
          setIsSaveAsModalOpen(false);
          setOverwriteConfirmPath(null);
          setSaveAsPackName("");
          setSaveAsDirectory(undefined);
          if (result.warning) {
            showDialog(
              `${result.warning}\n\n${(localized.viewerPackPath || "Pack: {{path}}").replace("{{path}}", result.savedPath ?? "")}`,
              {
                title: localized.viewerPackSaved || "Pack Saved",
              },
            );
          } else {
            showToast(
              (localized.viewerPackSavedTo || "Pack saved to: {{path}}").replace("{{path}}", result.savedPath ?? ""),
            );
          }
        } else {
          console.error("Failed to save pack as:", result?.error);
          showDialog(
            (localized.viewerSavePackAsError || "Failed to save pack as: {{error}}").replace(
              "{{error}}",
              result?.error || localized.viewerUnknownError || "Unknown error",
            ),
            { title: localized.viewerSaveFailed || "Save Failed" },
          );
        }
      } catch (error) {
        console.error("Error saving pack as:", error);
        showDialog(
          (localized.viewerSavePackAsException || "Error saving pack as: {{error}}").replace(
            "{{error}}",
            error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
          ),
          { title: localized.viewerSaveFailed || "Save Failed" },
        );
      } finally {
        setIsSaveAsProcessing(false);
      }
    },
    [activeViewerPackPath, localized, saveAsDirectory, saveAsPackName, showDialog, showToast],
  );

  const handleSelectSaveAsDirectory = useCallback(async () => {
    try {
      const selectedDirectory = await window.api?.selectDirectory(saveAsDirectory);
      if (selectedDirectory) {
        setSaveAsDirectory(selectedDirectory);
      }
      // The folder dialog is parented on this window, but focus can still land on the main window
      // when it closes, leaving the half-filled modal behind another window.
      window.focus();
      saveAsPackNameInputRef.current?.focus();
    } catch (error) {
      console.error("Error selecting directory:", error);
      showDialog(
        (localized.viewerDirectorySelectionError || "Error selecting directory: {{error}}").replace(
          "{{error}}",
          error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
        ),
        { title: localized.viewerDirectorySelectionFailed || "Directory Selection Failed" },
      );
    }
  }, [localized, saveAsDirectory, showDialog]);

  const handleNewPack = () => {
    if (!isFeaturesForModdersEnabled) return;
    setIsFileMenuOpen(false);
    setNewPackName("");
    setIsNewPackModalOpen(true);
  };

  const handleOpenPackDialog = () => {
    setIsFileMenuOpen(false);
    setIsRecentPacksOpen(false);
    setIsOpenPackDialogOpen(true);
  };

  const handleOpenPack = useCallback((packPath: string) => {
    window.api?.requestOpenModInViewer(packPath);
  }, []);

  const handleAddNewFlow = () => {
    setIsFileMenuOpen(false);
    treeViewRefs.current[activePackPath ?? ""]?.openNewFlowDialog();
  };

  const handleAddLoadOrderRules = () => {
    setIsFileMenuOpen(false);
    treeViewRefs.current[activePackPath ?? ""]?.createLoadOrderRulesFile();
  };

  const handleOpenDBPack = () => {
    if (isDBPackOpen) return;
    setIsFileMenuOpen(false);
    window.api?.requestOpenModInViewer(dbPackName);
  };

  const handleOpenRecentPack = useCallback((packPath: string) => {
    setIsRecentPacksOpen(false);
    setIsFileMenuOpen(false);
    window.api?.requestOpenModInViewer(packPath);
  }, []);

  const handleNewPackConfirm = useCallback(async () => {
    if (!newPackName.trim()) {
      showDialog(localized.viewerMissingPackName || "Please enter a pack name", {
        title: localized.viewerMissingName || "Missing Name",
      });
      return;
    }

    setIsNewPackProcessing(true);

    try {
      const packName = newPackName.trim();
      const packPath = `memory://${packName}`;

      const newPackData: PackViewData = {
        packName: packName,
        packPath: packPath,
        tables: [],
        packedFiles: {},
      };

      dispatch(setPacksData([newPackData]));
      openOrActivatePackTab(packPath);

      console.log("Pack created in memory:", packName);
      setIsNewPackModalOpen(false);
      setNewPackName("");
    } catch (error) {
      console.error("Error creating pack:", error);
      showDialog(
        (localized.viewerCreatePackError || "Error creating pack: {{error}}").replace(
          "{{error}}",
          error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
        ),
        { title: localized.viewerCreateFailed || "Create Failed" },
      );
    } finally {
      setIsNewPackProcessing(false);
    }
  }, [dispatch, localized, newPackName, openOrActivatePackTab, showDialog]);

  const closePackTab = useCallback(
    (packPath: string) => {
      const packIndex = packTabs.findIndex((packTab) => packTab.packPath === packPath);
      if (packIndex < 0) return;

      removeTableHistoryEntries((entry) => entry.tab.packPath === packPath);

      // Which neighbour to fall back to is read from this render; the removal itself goes through an
      // updater so a pack opened over IPC while the confirm dialog was up is not clobbered.
      if (activePackPathRef.current === packPath) {
        const remaining = packTabs.filter((packTab) => packTab.packPath !== packPath);
        activatePackTab((remaining[packIndex - 1] ?? remaining[packIndex])?.packPath ?? null);
      }
      setPackTabs((prevPackTabs) => prevPackTabs.filter((packTab) => packTab.packPath !== packPath));

      clearPackDataStoreForPack(packPath);
      clearPreparedTableForPack(packPath);
      // referencesHash is global to the renderer and is refreshed by the next pack data-store update.
      delete preferredTreeTabCacheRef.current[packPath];
      delete treeViewRefs.current[packPath];
      delete treeViewRefCallbacksRef.current[packPath];
      suppressDefaultTableOpenForPackPathsRef.current.delete(packPath);
      dispatch(removePackData(packPath));
      window.api?.viewerClosedPack?.(packPath);
    },
    [activatePackTab, dispatch, packTabs, removeTableHistoryEntries],
  );

  const requestClosePackTab = useCallback(
    (packPath: string) => {
      if (unsavedPacksDataByPath[packPath]?.length || deletedPackFilePathsByPath[packPath]?.length) {
        setPackCloseConfirmPath(packPath);
        return;
      }
      closePackTab(packPath);
    },
    [closePackTab, deletedPackFilePathsByPath, unsavedPacksDataByPath],
  );

  useLayoutEffect(() => {
    const sidebarElement = sidebarResizableRef.current?.resizable;
    const rootElement = viewerRootRef.current;
    if (!sidebarElement || !rootElement || typeof ResizeObserver === "undefined") return;

    const apply = (width: number) => {
      rootElement.style.setProperty("--viewer-sidebar-width", `${width}px`);
      setIsSidebarNarrow(width < TOOLBAR_ICON_ONLY_SIDEBAR_WIDTH);
    };

    apply(sidebarElement.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const borderBoxSize = entry.borderBoxSize;
      const width = borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      if (width != undefined) apply(width);
    });
    observer.observe(sidebarElement);
    return () => observer.disconnect();
  }, [isOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        document.getElementById("dbTableFilter")?.focus();
        e.stopImmediatePropagation();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // only runs when mounted first time
  useEffect(() => {
    if (!currentDBTableSelection) {
      // window.api?.getPackData(activeViewerPackPath, { dbName: "main_units_tables", dbSubname: "data__" });
      // dispatch(
      //   selectDBTable({
      //     packPath: `\\\\${activeViewerPackPath}`,
      //     dbName: "main_units_tables",
      //     dbSubname: "data__",
      //   })
      // );
    }
  }, [currentDBTableSelection]);

  // for testing, automatically opens db.pack main_units_tablesl
  useEffect(() => {
    // startArgs arrives over IPC after mount, so this cannot be a mount-only effect - but it still
    // has to fire once rather than again on every pack switch.
    if (didRunTestDBCloneRef.current) return;
    if (startArgs.includes("-testDBClone")) {
      didRunTestDBCloneRef.current = true;
      window.api?.getPackData(activeViewerPackPath, { dbName: "main_units_tables", dbSubname: "data__" });
      dispatch(
        selectDBTable({
          packPath: `K:\\SteamLibrary\\steamapps\\common\\Total War WARHAMMER III\\data\\db.pack`,
          dbName: "main_units_tables",
          dbSubname: "data__",
        }),
      );
    }
  }, [activeViewerPackPath, dispatch, startArgs]);

  // console.log(`currentPackData.data is ${currentPackData.data}`);

  return (
    <>
      {deepCloneTarget && (
        <Modal
          onClose={() => {
            dispatch(setDeepCloneTarget(undefined));
          }}
          show={isOpen}
          size="6xl"
          position="top-center"
          explicitClasses={["mt-8", "!max-w-7xl", "md:!h-full", "overflow-hidden", "modalDontOverflowWindowHeight"]}
        >
          <Modal.Header>{localized.viewerDeepCloning || "Deep Cloning..."}</Modal.Header>
          <Modal.Body>
            <div className="text-center mt-8">
              <DBDuplication launchSource="modsViewer" />
            </div>
          </Modal.Body>
        </Modal>
      )}

      {/* Open Pack Modal */}
      <OpenPackDialog
        show={isOpenPackDialogOpen}
        currentPackPath={activePackPath}
        onClose={() => setIsOpenPackDialogOpen(false)}
        onOpenPack={handleOpenPack}
      />

      {/* Save As Modal */}
      <Modal onClose={() => setIsSaveAsModalOpen(false)} show={isSaveAsModalOpen} size="md" position="center">
        <Modal.Header>{localized.viewerSavePackAs || "Save Pack As"}</Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {localized.viewerPackNameWithoutExtension || "Pack Name (without .pack extension)"}
              </label>
              <input
                ref={saveAsPackNameInputRef}
                type="text"
                value={saveAsPackName}
                onChange={(e) => setSaveAsPackName(e.target.value)}
                placeholder={localized.viewerPackNamePlaceholder || "e.g. my_custom_pack"}
                className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
                disabled={isSaveAsProcessing}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {localized.viewerSaveLocation || "Save Location"}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={saveAsDirectory || ""}
                  placeholder={
                    localized.viewerSaveLocationLoading || "Loading data folder, or click Browse to pick another"
                  }
                  readOnly
                  className="flex-1 px-3 py-2 bg-gray-700 text-gray-400 border border-gray-600 rounded-lg focus:outline-none"
                />
                <button
                  onClick={handleSelectSaveAsDirectory}
                  disabled={isSaveAsProcessing}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                >
                  {localized.viewerBrowse || "Browse"}
                </button>
              </div>
              {saveAsDirectory && <p className="text-xs text-gray-400 mt-1 truncate">{saveAsDirectory}</p>}
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            onClick={() => setIsSaveAsModalOpen(false)}
            disabled={isSaveAsProcessing}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
          >
            {localized.cancel || "Cancel"}
          </button>
          <button
            // Not passed directly: the click event would arrive as the overwrite argument.
            onClick={() => void handleSaveAsConfirm()}
            disabled={isSaveAsProcessing || !saveAsPackName.trim() || !saveAsDirectory}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaveAsProcessing ? localized.viewerSaving || "Saving..." : localized.save || "Save"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Destination-file overwrite confirmation */}
      <Modal
        onClose={() => {
          if (!isCopyProcessing) setCopyOverwriteRequest(null);
        }}
        show={!!copyOverwriteRequest}
        size="md"
        position="center"
      >
        <Modal.Header>{localized.viewerFileAlreadyExists || "File Already Exists"}</Modal.Header>
        <Modal.Body>
          <div className="text-sm text-gray-200">
            {localized.viewerDestinationContains || "The destination pack already contains:"}
            <div className="mt-2 break-all text-gray-400">{copyOverwriteRequest?.filePath}</div>
            <div className="mt-2 break-all text-gray-400">{copyOverwriteRequest?.targetPackPath}</div>
            <div className="mt-3">{localized.viewerOverwriteCopiedFile || "Overwrite it with the copied file?"}</div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            onClick={() => setCopyOverwriteRequest(null)}
            disabled={isCopyProcessing}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
          >
            {localized.cancel || "Cancel"}
          </button>
          <button
            onClick={handleConfirmCopyOverwrite}
            disabled={isCopyProcessing}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCopyProcessing ? localized.viewerOverwriting || "Overwriting..." : localized.overwrite || "Overwrite"}
          </button>
        </Modal.Footer>
      </Modal>

      <ImportConflictsModal
        request={importConflictRequest}
        isProcessing={isImportProcessing}
        onCancel={() => {
          if (!isImportProcessing) setImportConflictRequest(null);
        }}
        onImport={(items) => void handleImportConflicts(items)}
      />

      {/* Destination table-name prompt for DB tables and copied rows */}
      <Modal
        onClose={() => {
          if (!isCopyProcessing) {
            setCopyTableNameRequest(null);
            setCopyTableName("");
          }
        }}
        show={!!copyTableNameRequest}
        size="md"
        position="center"
      >
        <Modal.Header>{localized.viewerTableAlreadyExists || "Table Already Exists"}</Modal.Header>
        <Modal.Body>
          <div className="space-y-3 text-sm text-gray-200">
            <div>
              {localized.viewerDestinationContainsTable || "The destination pack already contains a table named:"}
              <div className="mt-2 break-all text-gray-400">{copyTableNameRequest?.tableName}</div>
            </div>
            <label className="block">
              <span className="mb-1 block text-gray-300">{localized.viewerTableName || "New table name"}</span>
              <input
                ref={copyTableNameInputRef}
                type="text"
                value={copyTableName}
                onChange={(event) => setCopyTableName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleCopyTableWithNewName();
                }}
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                disabled={isCopyProcessing}
                aria-label={localized.viewerTableName || "New table name"}
              />
            </label>
            <div className="break-all text-xs text-gray-500">
              {(localized.viewerDestination || "Destination: {{path}}").replace(
                "{{path}}",
                copyTableNameRequest?.targetPackPath || "",
              )}
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            onClick={() => {
              setCopyTableNameRequest(null);
              setCopyTableName("");
            }}
            disabled={isCopyProcessing}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
          >
            {localized.cancel || "Cancel"}
          </button>
          {copyTableNameRequest?.exactFileExists && copyTableNameRequest.source.kind === "db" && (
            <button
              onClick={handleOverwriteOriginalTable}
              disabled={isCopyProcessing}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCopyProcessing
                ? localized.viewerCopying || "Copying..."
                : localized.viewerOverwriteOriginal || "Overwrite Original"}
            </button>
          )}
          <button
            onClick={handleCopyTableWithNewName}
            disabled={isCopyProcessing || !copyTableName.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCopyProcessing
              ? localized.viewerCopying || "Copying..."
              : localized.viewerCopyWithNewName || "Copy with New Name"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Overwrite confirmation, shown over the Save As modal so Cancel goes back to it */}
      <Modal onClose={() => setOverwriteConfirmPath(null)} show={!!overwriteConfirmPath} size="md" position="center">
        <Modal.Header>{localized.viewerPackAlreadyExists || "Pack Already Exists"}</Modal.Header>
        <Modal.Body>
          <div className="text-sm text-gray-200">
            {localized.viewerPackExistsAt || "A pack already exists at:"}
            <div className="mt-2 mb-3 break-all text-gray-400">{overwriteConfirmPath}</div>
            {localized.viewerOverwritePackWarning ||
              "Overwrite it? The existing pack will be replaced and cannot be recovered."}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            onClick={() => setOverwriteConfirmPath(null)}
            disabled={isSaveAsProcessing}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
          >
            {localized.cancel || "Cancel"}
          </button>
          <button
            onClick={() => void handleSaveAsConfirm(true)}
            disabled={isSaveAsProcessing}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaveAsProcessing ? localized.viewerOverwriting || "Overwriting..." : localized.overwrite || "Overwrite"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* New Pack Modal */}
      <Modal onClose={() => setIsNewPackModalOpen(false)} show={isNewPackModalOpen} size="md" position="center">
        <Modal.Header>{localized.viewerCreateNewPack || "Create New Pack"}</Modal.Header>
        <Modal.Body>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {localized.viewerPackNameWithoutExtension || "Pack Name (without .pack extension)"}
            </label>
            <input
              ref={newPackNameInputRef}
              type="text"
              value={newPackName}
              onChange={(e) => setNewPackName(e.target.value)}
              placeholder={localized.viewerNewPackNamePlaceholder || "e.g. new_mod_pack"}
              className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
              disabled={isNewPackProcessing}
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            onClick={() => setIsNewPackModalOpen(false)}
            disabled={isNewPackProcessing}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
          >
            {localized.cancel || "Cancel"}
          </button>
          <button
            onClick={handleNewPackConfirm}
            disabled={isNewPackProcessing || !newPackName.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isNewPackProcessing ? localized.viewerCreating || "Creating..." : localized.viewerCreate || "Create"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Discard confirmation for a dirty pack tab */}
      <Modal onClose={() => setPackCloseConfirmPath(null)} show={!!packCloseConfirmPath} size="md" position="center">
        <Modal.Header>{localized.viewerClosePack || "Close Pack"}</Modal.Header>
        <Modal.Body>
          <div className="text-sm text-gray-200">
            {localized.viewerUnsavedChanges || "This pack has unsaved changes. Closing it will discard:"}
            <ul className="mt-2 max-h-48 overflow-auto list-disc list-inside text-gray-400 break-all">
              {(packCloseConfirmPath ? (unsavedPacksDataByPath[packCloseConfirmPath] ?? []) : []).map((file) => (
                <li key={`unsaved-${file.name}`}>
                  {localized.viewerUnsavedPrefix || "Unsaved:"} <span>{file.name}</span>
                </li>
              ))}
              {(packCloseConfirmPath ? (deletedPackFilePathsByPath[packCloseConfirmPath] ?? []) : []).map((path) => (
                <li key={`deleted-${path}`}>
                  {localized.viewerDeletedPrefix || "Deleted:"} <span>{path}</span>
                </li>
              ))}
            </ul>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            onClick={() => setPackCloseConfirmPath(null)}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200"
          >
            {localized.cancel || "Cancel"}
          </button>
          <button
            onClick={() => {
              if (packCloseConfirmPath) closePackTab(packCloseConfirmPath);
              setPackCloseConfirmPath(null);
            }}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors duration-200"
          >
            {localized.viewerDiscardAndClose || "Discard and Close"}
          </button>
        </Modal.Footer>
      </Modal>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <button
            onClick={() => setToast(null)}
            className="pointer-events-auto max-w-[80vw] px-6 py-3 rounded-lg bg-green-700 text-white text-sm shadow-lg break-all text-left"
          >
            {toast}
          </button>
        </div>
      )}

      <Modal onClose={() => setMessageDialog(null)} show={!!messageDialog} size="md" position="center">
        <Modal.Header>{messageDialog?.title ?? localized.viewerMessage ?? "Message"}</Modal.Header>
        <Modal.Body>
          <div className="whitespace-pre-wrap text-sm text-gray-200">{messageDialog?.message}</div>
        </Modal.Body>
        <Modal.Footer>
          <button
            onClick={() => setMessageDialog(null)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200"
          >
            {localized.viewerOk || "OK"}
          </button>
        </Modal.Footer>
      </Modal>

      <div
        ref={viewerRootRef}
        data-testid="mods-viewer-root"
        className="dark:text-gray-300 explicit-height-without-topbar-and-padding-35rem flex flex-col -mt-8"
      >
        {isOpen && (
          <>
            <div className="flex items-center py-1 pr-2 bg-gray-800 border-b border-gray-600">
              {/* Clamped to the sidebar so the strip beside it starts exactly where the table view does. */}
              <div
                className="relative flex items-center shrink-0"
                style={{ width: "var(--viewer-sidebar-width, 17%)" }}
              >
                {isFeaturesForModdersEnabled && (
                  <div ref={fileMenuRef} className="relative shrink-0">
                    <button
                      type="button"
                      ref={fileMenuButtonRef}
                      onClick={() => setIsFileMenuOpen((isOpen) => !isOpen)}
                      title={localized.viewerFile || "File"}
                      aria-label={localized.viewerFile || "File"}
                      aria-haspopup="menu"
                      aria-expanded={isFileMenuOpen}
                      aria-controls="mods-viewer-file-menu"
                      className={
                        (isSidebarNarrow ? "px-2" : "px-3") +
                        " py-1 text-sm bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2 shrink-0"
                      }
                    >
                      <FontAwesomeIcon icon={faFile} className="w-4 h-4" />
                      {!isSidebarNarrow && <span>{localized.viewerFile || "File"}</span>}
                      {!isSidebarNarrow && <FontAwesomeIcon icon={faChevronDown} className="w-3 h-3" />}
                    </button>

                    {isFileMenuOpen && (
                      <div
                        id="mods-viewer-file-menu"
                        role="menu"
                        aria-label={localized.viewerFile || "File"}
                        className="absolute left-0 top-full z-50 mt-1 min-w-[10rem] rounded-md border border-gray-600 bg-gray-800 py-1 shadow-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleNewPack}
                          className="block w-full whitespace-nowrap px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
                        >
                          {localized.viewerNewPack || "New Pack"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleOpenPackDialog}
                          className="block w-full whitespace-nowrap px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
                        >
                          {localized.viewerOpenPack || "Open Pack"}
                        </button>
                        <div
                          className="relative"
                          onMouseLeave={(event) => {
                            const relatedTarget = event.relatedTarget;
                            if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
                            setIsRecentPacksOpen(false);
                          }}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            aria-haspopup="menu"
                            aria-expanded={isRecentPacksOpen}
                            onMouseEnter={() => setIsRecentPacksOpen(true)}
                            onClick={() => setIsRecentPacksOpen(true)}
                            className="block w-full whitespace-nowrap px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
                          >
                            <span className="flex items-center justify-between gap-4">
                              <span>{localized.viewerOpenRecent || "Open Recent"}</span>
                              <span aria-hidden="true">▶</span>
                            </span>
                          </button>
                          {isRecentPacksOpen && (
                            <div
                              ref={recentPackMenuRef}
                              role="menu"
                              aria-label={localized.viewerOpenRecent || "Open Recent"}
                              className="absolute left-full top-0 z-50 min-w-[16rem] max-w-[28rem] overflow-hidden rounded-md border border-gray-600 bg-gray-800 py-1 shadow-xl"
                            >
                              {availableRecentPackPaths.length > 0 ? (
                                availableRecentPackPaths.slice(0, visibleRecentPackCount).map((packPath, index) => (
                                  <button
                                    key={packPath}
                                    ref={index === 0 ? recentPackFirstButtonRef : undefined}
                                    type="button"
                                    role="menuitem"
                                    data-testid={`recent-pack-${index}`}
                                    onClick={() => handleOpenRecentPack(packPath)}
                                    title={packPath}
                                    className="block w-full truncate px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
                                  >
                                    {getPackFileName(packPath)}
                                  </button>
                                ))
                              ) : (
                                <div role="menuitem" aria-disabled="true" className="px-3 py-2 text-sm text-gray-500">
                                  {localized.viewerNoRecentPacks || "No recent packs"}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleAddNewFlow}
                          className="block w-full whitespace-nowrap px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
                        >
                          {localized.viewerAddNewFlow || "Add New Flow"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleAddLoadOrderRules}
                          className="block w-full whitespace-nowrap px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
                        >
                          {localized.viewerAddNewLoadOrderRules || "Add New Load Order Rules"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleOpenDBPack}
                          disabled={isDBPackOpen}
                          className={
                            "block w-full whitespace-nowrap px-3 py-2 text-left text-sm " +
                            (isDBPackOpen ? "cursor-not-allowed text-gray-500" : "text-gray-200 hover:bg-gray-700")
                          }
                        >
                          {localized.viewerOpenDbPack || "open db.pack"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Pack tabs begin exactly at the sidebar's right edge. */}
              <div className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto">
                {packTabs.map((packTab) => {
                  const isActive = packTab.packPath === activePackPath;
                  const packLabel =
                    packsDataByPath[packTab.packPath]?.packName ??
                    getPackNameFromPath(packTab.packPath) ??
                    packTab.packPath;
                  const isDirty =
                    (unsavedPacksDataByPath[packTab.packPath]?.length ?? 0) > 0 ||
                    (deletedPackFilePathsByPath[packTab.packPath]?.length ?? 0) > 0;
                  return (
                    <div
                      key={packTab.packPath}
                      className={
                        "flex items-center gap-1 rounded-md border text-xs shrink-0 " +
                        (isActive
                          ? "bg-gray-700 text-white border-gray-500"
                          : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700/60")
                      }
                    >
                      <button
                        type="button"
                        onClick={() => activatePackTabFromUser(packTab.packPath)}
                        className="px-2 py-1 max-w-[220px] truncate"
                        title={packLabel}
                      >
                        {isDirty && <span aria-hidden="true">• </span>}
                        {packLabel}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          requestClosePackTab(packTab.packPath);
                        }}
                        className="px-1 pr-2 text-gray-400 hover:text-white"
                        aria-label={(localized.viewerCloseTab || "Close {{name}}").replace("{{name}}", packLabel)}
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex shrink-0 items-center ml-2">
                <button
                  type="button"
                  onClick={() => setIsGlobalSearchOpen((isPanelOpen) => !isPanelOpen)}
                  title={`${localized.globalSearch || "Global search"} (Ctrl+Shift+F)`}
                  aria-label={localized.globalSearch || "Global search"}
                  aria-pressed={isGlobalSearchOpen}
                  className={
                    "px-2 py-1 text-sm rounded-lg text-white font-medium shadow-lg transition-colors duration-200 flex items-center gap-2 " +
                    (isGlobalSearchOpen ? "bg-blue-700 hover:bg-blue-600" : "bg-gray-700 hover:bg-gray-600")
                  }
                >
                  <FontAwesomeIcon icon={faMagnifyingGlass} className="w-4 h-4" />
                </button>
              </div>

              {(hasUnsavedFiles || canSavePackAs) && (
                <div className="flex gap-2 shrink-0 ml-2">
                  {hasUnsavedFiles && !activeViewerPackPath.startsWith("memory://") && (
                    <button
                      onClick={handleSavePack}
                      className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                      {localized.viewerSavePack || "Save Pack"}
                    </button>
                  )}
                  {canSavePackAs && (
                    <button
                      onClick={() => void handleSavePackAs()}
                      className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 19l9 2-9-18-9 18 9-2m0 0v-8m0 8l-6-4m6 4l6-4"
                        />
                      </svg>
                      {localized.viewerSaveAs || "Save As"}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-1 min-h-0 w-full h-full overflow-hidden">
              <Resizable
                ref={sidebarResizableRef}
                defaultSize={{
                  width: "17%",
                  height: "100%",
                }}
                maxWidth="100%"
                minWidth="1"
              >
                <div className="h-full flex flex-col">
                  <div className="relative flex-1 min-h-0">
                    {packTabs.map((packTab) => (
                      <div
                        key={packTab.packPath}
                        className={
                          "absolute inset-0 overflow-hidden scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700 " +
                          (packTab.packPath === activePackPath ? "" : "hidden")
                        }
                      >
                        <PackTablesTreeView
                          ref={getTreeViewRef(packTab.packPath)}
                          packPath={packTab.packPath}
                          preferredTab={preferredTreeTabByPackPath[packTab.packPath] ?? "db"}
                          tableFilter={dbTableFilter}
                          showDialog={showDialog}
                          otherOpenPacks={otherOpenPacksByPackPath.get(packTab.packPath) ?? EMPTY_PACK_TARGETS}
                          onCopyInto={handleCopyInto}
                          onImportConflicts={setImportConflictRequest}
                          onPackFilePathsRemoved={handlePackFilePathsRemoved}
                          onOpenDBTable={handleOpenDBTable}
                          onOpenFlowFile={handleOpenFlowFile}
                          onOpenPackedFile={handleOpenPackedFile}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center mt-3">
                    <span className="relative w-full">
                      <input
                        id="dbTableFilter"
                        type="text"
                        placeholder={localized.filter}
                        onChange={(e) => {
                          setDBTableFilterInput(e.target.value);
                          onFilterChangeDebounced(e.target.value);
                        }}
                        value={dbTableFilterInput}
                        className="block bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 w-full px-2 py-1 pr-6 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                      ></input>

                      <span className="absolute right-[0.3rem] top-1/2 -translate-y-1/2 leading-none text-gray-400">
                        <button onClick={() => clearFilter()}>
                          <FontAwesomeIcon icon={faXmark} />
                        </button>
                      </span>
                    </span>
                  </div>
                </div>
              </Resizable>
              <div style={{ width: "100%", minWidth: "1px", height: "100%" }} className="flex flex-col">
                <div className="flex items-center gap-1 border-b border-gray-700 bg-gray-900/60 px-2 py-1 overflow-x-auto">
                  {openTabs.length === 0 ? (
                    <span className="text-xs text-gray-400">{localized.viewerNoFilesOpen || "No files open"}</span>
                  ) : (
                    openTabs.map((tab) => {
                      const isActive = tab.id === activeTabId;
                      return (
                        <div
                          key={tab.id}
                          className={
                            "flex items-center gap-1 rounded-md border text-xs " +
                            (isActive
                              ? "bg-gray-700 text-white border-gray-500"
                              : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700/60")
                          }
                        >
                          <button
                            type="button"
                            onClick={() => activateViewerTabFromUser(tab.id)}
                            className="px-2 py-1 max-w-[220px] truncate"
                            title={tab.title}
                          >
                            {tab.title}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseTab(tab.id);
                            }}
                            className="px-1 pr-2 text-gray-400 hover:text-white"
                            aria-label={(localized.viewerCloseTab || "Close {{name}}").replace("{{name}}", tab.title)}
                          >
                            <FontAwesomeIcon icon={faXmark} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="flex-1 min-h-0">
                  {!activePackPath ? (
                    <div className="h-full flex items-center justify-center text-sm text-gray-400">
                      {localized.viewerSelectPack || "Select a pack to view"}
                    </div>
                  ) : !currentPackData ? (
                    <div className="h-full flex items-center justify-center text-sm text-gray-400">
                      {localized.viewerLoadingPack || "Loading pack…"}
                    </div>
                  ) : activeTab ? (
                    activeTab.kind === "db" && !activeTab.dbName && !activeTab.dbSubname ? (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400">
                        {packFileInventory?.isEmpty
                          ? localized.viewerEmptyPack || "Empty pack. Add a flow or create/edit files to populate it."
                          : localized.viewerSelectFile || "Select a file to view"}
                      </div>
                    ) : activeTab.kind === "flow" && activeTab.flowFile ? (
                      <NodeEditor currentFile={activeTab.flowFile} currentPack={activeTab.packPath} />
                    ) : activeTab.kind === "loadOrderRules" && activeTab.filePath ? (
                      <LoadOrderRulesView
                        packPath={activeTab.packPath}
                        filePath={activeTab.filePath}
                        showDialog={showDialog}
                      />
                    ) : activeTab.kind === "file" && activeTab.filePath ? (
                      <PackFileView
                        packPath={activeTab.packPath}
                        filePath={activeTab.filePath}
                        showDialog={showDialog}
                      />
                    ) : (
                      <PackTablesTableView
                        showDialog={showDialog}
                        otherOpenPacks={otherOpenPacksByPackPath.get(activeTab.packPath) ?? EMPTY_PACK_TARGETS}
                        onCopyInto={handleCopyInto}
                        onGoToReference={handleGoToReference}
                        referenceNavigation={referenceNavigation}
                        onReferenceNavigationHandled={handleReferenceNavigationHandled}
                        searchNavigation={searchNavigation}
                        onSearchNavigationHandled={handleSearchNavigationHandled}
                      />
                    )
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-gray-400">
                      {packFileInventory?.isEmpty
                        ? localized.viewerEmptyPack || "Empty pack. Add a flow or create/edit files to populate it."
                        : localized.viewerSelectFile || "Select a file to view"}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {isGlobalSearchMounted && (
              <Resizable
                defaultSize={{ width: "100%", height: 375 }}
                minHeight={180}
                maxHeight="70%"
                enable={{ top: true }}
                className={"mt-3 shrink-0" + (isGlobalSearchOpen ? "" : " hidden")}
              >
                <GlobalSearchPanel
                  isOpen={isGlobalSearchOpen}
                  openPacks={globalSearchOpenPacks}
                  onOpenDbResult={handleOpenGlobalSearchDbResult}
                  onOpenFileResult={handleOpenGlobalSearchFileResult}
                  onClose={() => setIsGlobalSearchOpen(false)}
                />
              </Resizable>
            )}

            {/* <div className="grid grid-cols-10 dark:text-gray-300">
            <div className="col-span-2 overflow-scroll h-[90vh]">
              <PackTablesTreeView tableFilter={modFilter} />
            </div>
            <div className="col-span-8">
              <PackTablesTableView />
            </div>
          </div> */}
          </>
        )}
      </div>
    </>
  );
});

export default ModsViewer;
