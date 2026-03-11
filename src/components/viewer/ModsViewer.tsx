import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import PackTablesTreeView, { PackTablesTreeViewHandle } from "./PackTablesTreeView";
import PackTablesTableView from "./PackTablesTableView";
import { Resizable } from "re-resizable";
import debounce from "just-debounce-it";
import localizationContext from "../../localizationContext";
import { gameToPackWithDBTablesName } from "../../supportedGames";
import { Modal } from "@/src/flowbite";
import DBDuplication from "@/src/components/viewer/DBDuplication";
import { selectDBTable, selectFlowFile, setDeepCloneTarget, setPacksData } from "@/src/appSlice";
import NodeEditor from "../NodeEditor";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";
import { getPackNameFromPath } from "@/src/utility/packFileHelpers";

type ViewerTabKind = "db" | "flow";

type ViewerTab = {
  id: string;
  fileKey: string;
  title: string;
  kind: ViewerTabKind;
  packPath: string;
  dbName?: string;
  dbSubname?: string;
  flowFile?: string;
};

type ViewerTabCandidate = Omit<ViewerTab, "id">;

const hasDBSelectionTarget = (selection?: DBTableSelection): selection is DBTableSelection =>
  Boolean(selection?.packPath && selection.dbName && selection.dbSubname);

const getEmptyPackSelectionPath = (selection?: DBTableSelection): string | undefined =>
  selection?.packPath && !selection.dbName && !selection.dbSubname ? selection.packPath : undefined;

const ModsViewer = memo(() => {
  const dispatch = useAppDispatch();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const currentFlowFileSelection = useAppSelector((state) => state.app.currentFlowFileSelection);
  const currentFlowFilePackPath = useAppSelector((state) => state.app.currentFlowFilePackPath);
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  // Use currentFlowFilePackPath if a flow file is selected, otherwise use DB table pack path
  const packPath =
    currentFlowFilePackPath ??
    currentDBTableSelection?.packPath ??
    (gameToPackWithDBTablesName[currentGame] || "db.pack");
  const deepCloneTarget = useAppSelector((state) => state.app.deepCloneTarget);
  const startArgs = useAppSelector((state) => state.app.startArgs);
  const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);
  const selectCurrentPackUnsavedFiles = useMemo(makeSelectCurrentPackUnsavedFiles, []);
  const currentPackData = useAppSelector((state) => selectCurrentPackData(state, packPath));
  const unsavedFiles = useAppSelector((state) => selectCurrentPackUnsavedFiles(state, packPath));

  const [isOpen, setIsOpen] = React.useState(true);
  const [isSaveAsModalOpen, setIsSaveAsModalOpen] = React.useState(false);
  const [saveAsPackName, setSaveAsPackName] = React.useState("");
  const [saveAsDirectory, setSaveAsDirectory] = React.useState<string | undefined>(undefined);
  const [isSaveAsProcessing, setIsSaveAsProcessing] = React.useState(false);
  const [isNewPackModalOpen, setIsNewPackModalOpen] = React.useState(false);
  const [newPackName, setNewPackName] = React.useState("");
  const [isNewPackProcessing, setIsNewPackProcessing] = React.useState(false);
  const [openTabs, setOpenTabs] = useState<ViewerTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const treeViewRef = useRef<PackTablesTreeViewHandle>(null);
  const saveAsPackNameInputRef = useRef<HTMLInputElement>(null);
  const newPackNameInputRef = useRef<HTMLInputElement>(null);
  const tabIdCounterRef = useRef(0);
  const lastActionRef = useRef<{ fileKey: string; at: number; openedNew: boolean; tabId?: string } | null>(
    null,
  );
  const lastSelectionKeyRef = useRef<string | null>(null);
  const suppressSelectionToTabSyncRef = useRef(false);

  const localized: Record<string, string> = useContext(localizationContext);

  // Focus on the Save As pack name input when modal opens
  useEffect(() => {
    if (isSaveAsModalOpen && saveAsPackNameInputRef.current) {
      window.focus();
      setTimeout(() => {
        saveAsPackNameInputRef.current?.focus();
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

  const [dbTableFilter, setDBTableFilter] = useState("");

  const onFilterChangeDebounced = useMemo(
    () =>
      debounce((value: string) => {
        setDBTableFilter(value);
      }, 250),
    [setDBTableFilter],
  );

  const clearFilter = () => {
    setDBTableFilter("");
  };

  const createTabId = useCallback(() => `tab-${Date.now()}-${++tabIdCounterRef.current}`, []);

  const buildDbTabCandidate = useCallback((selection: DBTableSelection): ViewerTabCandidate => {
    const packLabel = getPackNameFromPath(selection.packPath) ?? selection.packPath;
    return {
      fileKey: `db|${selection.packPath}|${selection.dbName}|${selection.dbSubname}`,
      title: `${selection.dbName}/${selection.dbSubname}${packLabel ? ` | ${packLabel}` : ""}`,
      kind: "db",
      packPath: selection.packPath,
      dbName: selection.dbName,
      dbSubname: selection.dbSubname,
    };
  }, []);

  const buildEmptyPackTabCandidate = useCallback((packPath: string): ViewerTabCandidate => {
    const packLabel = getPackNameFromPath(packPath) ?? packPath;
    return {
      fileKey: `pack|${packPath}`,
      title: packLabel,
      kind: "db",
      packPath,
      dbName: "",
      dbSubname: "",
    };
  }, []);

  const buildFlowTabCandidate = useCallback((flowFile: string, packPath: string): ViewerTabCandidate => {
    const packLabel = getPackNameFromPath(packPath) ?? packPath;
    const shortFlowName = flowFile.replace(/^whmmflows[\\/]/, "");
    const flowLabel = shortFlowName ? `Flow:${shortFlowName}` : flowFile;
    return {
      fileKey: `flow|${packPath}|${flowFile}`,
      title: `${flowLabel}${packLabel ? ` | ${packLabel}` : ""}`,
      kind: "flow",
      packPath,
      flowFile,
    };
  }, []);

  const openOrActivateTab = useCallback(
    (candidate: ViewerTabCandidate, options: { forceNewTab?: boolean } = {}) => {
      const now = Date.now();
      const lastAction = lastActionRef.current;
      const isJustOpenedSame =
        lastAction && lastAction.fileKey === candidate.fileKey && lastAction.openedNew && now - lastAction.at < 350;

      if (options.forceNewTab && isJustOpenedSame && lastAction?.tabId) {
        setActiveTabId(lastAction.tabId);
        return;
      }

      // Reuse existing tab with same fileKey instead of always creating a new one
      if (options.forceNewTab) {
        const existingTab =
          openTabs.find((tab) => tab.fileKey === candidate.fileKey && tab.id !== activeTabId) ??
          openTabs.find((tab) => tab.fileKey === candidate.fileKey);
        if (existingTab) {
          setActiveTabId(existingTab.id);
          lastActionRef.current = { fileKey: candidate.fileKey, at: now, openedNew: false, tabId: existingTab.id };
          return;
        }
      }

      let openedNew = false;
      let tabToActivate: ViewerTab;

      if (options.forceNewTab || !activeTabId) {
        const newTab: ViewerTab = { id: createTabId(), ...candidate };
        openedNew = true;
        tabToActivate = newTab;
        setOpenTabs([...openTabs, newTab]);
      } else {
        const activeTabIndex = openTabs.findIndex((tab) => tab.id === activeTabId);
        if (activeTabIndex < 0) {
          const newTab: ViewerTab = { id: createTabId(), ...candidate };
          openedNew = true;
          tabToActivate = newTab;
          setOpenTabs([...openTabs, newTab]);
        } else {
          tabToActivate = { ...openTabs[activeTabIndex], ...candidate };
          const nextTabs = [...openTabs];
          nextTabs[activeTabIndex] = tabToActivate;
          setOpenTabs(nextTabs);
        }
      }

      setActiveTabId(tabToActivate.id);
      lastActionRef.current = { fileKey: candidate.fileKey, at: now, openedNew, tabId: tabToActivate.id };
      if (tabToActivate.kind === "db" && tabToActivate.dbName && tabToActivate.dbSubname) {
        window.api?.getPackData(tabToActivate.packPath, {
          dbName: tabToActivate.dbName,
          dbSubname: tabToActivate.dbSubname,
        });
      }
    },
    [activeTabId, createTabId, openTabs],
  );

  const handleOpenDBTable = useCallback(
    (selection: DBTableSelection, options?: { forceNewTab?: boolean }) => {
      if (!hasDBSelectionTarget(selection)) return;
      openOrActivateTab(buildDbTabCandidate(selection), options);
    },
    [buildDbTabCandidate, openOrActivateTab],
  );

  const handleOpenFlowFile = useCallback(
    (selection: { flowFile: string; packPath: string }, options?: { forceNewTab?: boolean }) => {
      openOrActivateTab(buildFlowTabCandidate(selection.flowFile, selection.packPath), options);
    },
    [buildFlowTabCandidate, openOrActivateTab],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setOpenTabs((prevTabs) => {
        const tabIndex = prevTabs.findIndex((tab) => tab.id === tabId);
        if (tabIndex < 0) return prevTabs;
        const nextTabs = prevTabs.filter((tab) => tab.id !== tabId);

        if (tabId === activeTabId) {
          const nextActive = nextTabs[tabIndex - 1] ?? nextTabs[tabIndex] ?? null;
          setActiveTabId(nextActive?.id ?? null);
        }

        return nextTabs;
      });
    },
    [activeTabId],
  );

  const hasUnsavedFiles = unsavedFiles.length > 0;
  const activeTab = useMemo(() => openTabs.find((tab) => tab.id === activeTabId) ?? null, [openTabs, activeTabId]);

  useEffect(() => {
    if (!activeTabId) return;
    const activeTab = openTabs.find((tab) => tab.id === activeTabId);
    if (!activeTab) return;

    if (activeTab.kind === "flow" && activeTab.flowFile) {
      const isAlreadySelected =
        currentFlowFileSelection === activeTab.flowFile && currentFlowFilePackPath === activeTab.packPath;
      if (isAlreadySelected) {
        lastSelectionKeyRef.current = activeTab.fileKey;
        return;
      }
      suppressSelectionToTabSyncRef.current = true;
      dispatch(selectFlowFile({ flowFile: activeTab.flowFile, packPath: activeTab.packPath }));
      lastSelectionKeyRef.current = activeTab.fileKey;
      return;
    }

    if (activeTab.kind === "db" && activeTab.packPath && !activeTab.dbName && !activeTab.dbSubname) {
      const isAlreadySelected =
        !currentFlowFileSelection &&
        currentDBTableSelection?.packPath === activeTab.packPath &&
        !currentDBTableSelection?.dbName &&
        !currentDBTableSelection?.dbSubname;
      if (isAlreadySelected) {
        lastSelectionKeyRef.current = activeTab.fileKey;
        return;
      }
      suppressSelectionToTabSyncRef.current = true;
      if (currentFlowFileSelection) {
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
        !currentFlowFileSelection &&
        currentDBTableSelection?.packPath === activeTab.packPath &&
        currentDBTableSelection?.dbName === activeTab.dbName &&
        currentDBTableSelection?.dbSubname === activeTab.dbSubname;
      if (isAlreadySelected) {
        lastSelectionKeyRef.current = activeTab.fileKey;
        return;
      }
      suppressSelectionToTabSyncRef.current = true;
      if (currentFlowFileSelection) {
        dispatch(selectFlowFile(undefined));
      }
      dispatch(
        selectDBTable({
          packPath: activeTab.packPath,
          dbName: activeTab.dbName,
          dbSubname: activeTab.dbSubname,
        }),
      );
      lastSelectionKeyRef.current = activeTab.fileKey;
    }
  }, [
    activeTabId,
    openTabs,
    dispatch,
    currentFlowFileSelection,
    currentFlowFilePackPath,
    currentDBTableSelection,
  ]);

  useEffect(() => {
    if (suppressSelectionToTabSyncRef.current) {
      suppressSelectionToTabSyncRef.current = false;
      return;
    }

    if (currentFlowFileSelection) {
      const flowPackPath = currentFlowFilePackPath ?? currentDBTableSelection?.packPath ?? packPath;
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

    const emptyPackPath = getEmptyPackSelectionPath(currentDBTableSelection);
    if (emptyPackPath) {
      const candidate = buildEmptyPackTabCandidate(emptyPackPath);
      if (lastSelectionKeyRef.current === candidate.fileKey) return;
      openOrActivateTab(candidate);
    }
  }, [
    currentFlowFileSelection,
    currentFlowFilePackPath,
    currentDBTableSelection,
    packPath,
    buildEmptyPackTabCandidate,
    buildFlowTabCandidate,
    buildDbTabCandidate,
    openOrActivateTab,
  ]);

  useEffect(() => {
    if (activeTabId) return;
    if (currentFlowFileSelection) return;
    if (hasDBSelectionTarget(currentDBTableSelection)) return;

    if (!currentPackData) return;

    const hasDefaultTable = currentPackData.tables.includes("db\\main_units_tables\\data__");
    if (!hasDefaultTable) return;

    handleOpenDBTable({
      packPath,
      dbName: "main_units_tables",
      dbSubname: "data__",
    });
  }, [
    activeTabId,
    currentFlowFileSelection,
    currentDBTableSelection,
    currentPackData,
    packPath,
    handleOpenDBTable,
  ]);

  const handleSavePack = async () => {
    if (!hasUnsavedFiles) return;

    try {
      const result = await window.api?.savePackWithUnsavedFiles(packPath);
      if (result?.success) {
        console.log("Pack saved successfully:", result.savedPath);
        const message = result.warning
          ? `${result.warning}\n\nSaved to: ${result.savedPath}`
          : `Pack saved successfully to: ${result.savedPath}`;
        alert(message);
      } else {
        console.error("Failed to save pack:", result?.error);
        alert(`Failed to save pack: ${result?.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error saving pack:", error);
      alert(`Error saving pack: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleSavePackAs = () => {
    if (!hasUnsavedFiles) return;
    setSaveAsPackName("");
    setSaveAsDirectory(undefined);
    setIsSaveAsModalOpen(true);
  };

  const handleSaveAsConfirm = async () => {
    if (!saveAsPackName.trim() || !saveAsDirectory) {
      alert("Please enter a pack name and select a directory");
      return;
    }

    setIsSaveAsProcessing(true);

    try {
      const result = await window.api?.savePackAsWithUnsavedFiles(
        packPath,
        saveAsPackName.trim(),
        saveAsDirectory,
      );
      if (result?.success) {
        console.log("Pack saved as successfully:", result.savedPath);
        alert(`Pack saved successfully to: ${result.savedPath}`);
        setIsSaveAsModalOpen(false);
        setSaveAsPackName("");
        setSaveAsDirectory(undefined);
      } else {
        console.error("Failed to save pack as:", result?.error);
        alert(`Failed to save pack as: ${result?.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error saving pack as:", error);
      alert(`Error saving pack as: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsSaveAsProcessing(false);
    }
  };

  const handleSelectSaveAsDirectory = async () => {
    try {
      const selectedDirectory = await window.api?.selectDirectory();
      if (selectedDirectory) {
        setSaveAsDirectory(selectedDirectory);
      }
    } catch (error) {
      console.error("Error selecting directory:", error);
      alert(`Error selecting directory: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleNewPack = () => {
    if (!isFeaturesForModdersEnabled) return;
    setNewPackName("");
    setIsNewPackModalOpen(true);
  };

  const handleNewPackConfirm = async () => {
    if (!newPackName.trim()) {
      alert("Please enter a pack name");
      return;
    }

    setIsNewPackProcessing(true);

    try {
      const packName = newPackName.trim();
      const packPath = `memory://${packName}`;
      const emptyPackTabCandidate = buildEmptyPackTabCandidate(packPath);

      const newPackData: PackViewData = {
        packName: packName,
        packPath: packPath,
        tables: [],
        packedFiles: {},
      };

      dispatch(setPacksData([newPackData]));
      openOrActivateTab(emptyPackTabCandidate, { forceNewTab: true });
      dispatch(selectFlowFile(undefined));

      dispatch(
        selectDBTable({
          packPath: packPath,
          dbName: "",
          dbSubname: "",
        }),
      );

      console.log("Pack created in memory:", packName);
      setIsNewPackModalOpen(false);
      setNewPackName("");
    } catch (error) {
      console.error("Error creating pack:", error);
      alert(`Error creating pack: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsNewPackProcessing(false);
    }
  };

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
      // window.api?.getPackData(packPath, { dbName: "main_units_tables", dbSubname: "data__" });
      // dispatch(
      //   selectDBTable({
      //     packPath: `\\\\${packPath}`,
      //     dbName: "main_units_tables",
      //     dbSubname: "data__",
      //   })
      // );
    }
  }, []);

  // for testing, automatically opens db.pack main_units_tablesl
  useEffect(() => {
    if (startArgs.includes("-testDBClone")) {
      window.api?.getPackData(packPath, { dbName: "main_units_tables", dbSubname: "data__" });
      dispatch(
        selectDBTable({
          packPath: `K:\\SteamLibrary\\steamapps\\common\\Total War WARHAMMER III\\data\\db.pack`,
          dbName: "main_units_tables",
          dbSubname: "data__",
        }),
      );
    }
  }, []);

  if (!currentPackData) {
    console.log(`ModsViewer: no ${packPath} in packsData`);
    return <></>;
  }

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
          explicitClasses={[
            "mt-8",
            "!max-w-7xl",
            "md:!h-full",
            "overflow-hidden",
            "modalDontOverflowWindowHeight",
          ]}
        >
          <Modal.Header>Deep Cloning...</Modal.Header>
          <Modal.Body>
            <div className="text-center mt-8">
              <DBDuplication />
            </div>
          </Modal.Body>
        </Modal>
      )}

      {/* Save As Modal */}
      <Modal onClose={() => setIsSaveAsModalOpen(false)} show={isSaveAsModalOpen} size="md" position="center">
        <Modal.Header>Save Pack As</Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Pack Name (without .pack extension)
              </label>
              <input
                ref={saveAsPackNameInputRef}
                type="text"
                value={saveAsPackName}
                onChange={(e) => setSaveAsPackName(e.target.value)}
                placeholder="e.g. my_custom_pack"
                className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
                disabled={isSaveAsProcessing}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Save Location</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={saveAsDirectory || ""}
                  placeholder="Click Browse to select directory"
                  readOnly
                  className="flex-1 px-3 py-2 bg-gray-700 text-gray-400 border border-gray-600 rounded-lg focus:outline-none"
                />
                <button
                  onClick={handleSelectSaveAsDirectory}
                  disabled={isSaveAsProcessing}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                >
                  Browse
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
            Cancel
          </button>
          <button
            onClick={handleSaveAsConfirm}
            disabled={isSaveAsProcessing || !saveAsPackName.trim() || !saveAsDirectory}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaveAsProcessing ? "Saving..." : "Save"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* New Pack Modal */}
      <Modal
        onClose={() => setIsNewPackModalOpen(false)}
        show={isNewPackModalOpen}
        size="md"
        position="center"
      >
        <Modal.Header>Create New Pack</Modal.Header>
        <Modal.Body>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Pack Name (without .pack extension)
            </label>
            <input
              ref={newPackNameInputRef}
              type="text"
              value={newPackName}
              onChange={(e) => setNewPackName(e.target.value)}
              placeholder="e.g. new_mod_pack"
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
            Cancel
          </button>
          <button
            onClick={handleNewPackConfirm}
            disabled={isNewPackProcessing || !newPackName.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isNewPackProcessing ? "Creating..." : "Create"}
          </button>
        </Modal.Footer>
      </Modal>

      <div className="dark:text-gray-300 explicit-height-without-topbar-and-padding flex flex-col">
        {isOpen && (
          <>
            {/* Toolbar */}
            {(isFeaturesForModdersEnabled || hasUnsavedFiles) && (
              <div className="flex justify-between items-center p-2 bg-gray-800 border-b border-gray-600">
                <div className="flex gap-2">
                  {isFeaturesForModdersEnabled && (
                    <>
                      <button
                        onClick={handleNewPack}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New Pack
                      </button>

                      <button
                        onClick={() => treeViewRef.current?.openNewFlowDialog()}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add New Flow
                      </button>
                    </>
                  )}
                </div>

                {hasUnsavedFiles && (
                  <div className="flex gap-2">
                    {!packPath.startsWith("memory://") && (
                      <button
                        onClick={handleSavePack}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                        Save Pack
                      </button>
                    )}
                    <button
                      onClick={handleSavePackAs}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 19l9 2-9-18-9 18 9-2m0 0v-8m0 8l-6-4m6 4l6-4"
                        />
                      </svg>
                      Save As
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-1 w-full h-full overflow-hidden">
              <Resizable
                defaultSize={{
                  width: "17%",
                  height: "100%",
                }}
                maxWidth="100%"
                minWidth="1"
              >
                <div className="h-full flex flex-col">
                  <div className="overflow-auto flex-1 scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700">
                  <PackTablesTreeView
                    ref={treeViewRef}
                    tableFilter={dbTableFilter}
                    onOpenDBTable={handleOpenDBTable}
                    onOpenFlowFile={handleOpenFlowFile}
                  />
                  </div>

                  <div className="flex items-center mt-3">
                    <span className="text-slate-100">{localized.filter}</span>
                    <span className="relative">
                      <input
                        id="dbTableFilter"
                        type="text"
                        onChange={(e) => onFilterChangeDebounced(e.target.value)}
                        defaultValue={dbTableFilter}
                        className="ml-2 block bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                      ></input>

                      <span className="absolute right-[0.3rem] top-[0.6rem] text-gray-400">
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
                    <span className="text-xs text-gray-400">No files open</span>
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
                            onClick={() => setActiveTabId(tab.id)}
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
                            aria-label={`Close ${tab.title}`}
                          >
                            <FontAwesomeIcon icon={faXmark} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="flex-1 min-h-0">
                  {activeTab ? (
                    (activeTab.kind === "db" && !activeTab.dbName && !activeTab.dbSubname ? (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400">
                        Empty pack. Add a flow or create/edit files to populate it.
                      </div>
                    ) : currentFlowFileSelection && (
                      <NodeEditor currentFile={currentFlowFileSelection} currentPack={packPath} />
                    )) || <PackTablesTableView />
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-gray-400">
                      Select a file to view
                    </div>
                  )}
                </div>
              </div>
            </div>

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
