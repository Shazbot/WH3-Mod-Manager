import React, { memo, useContext, useEffect, useMemo, useState, useRef } from "react";
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
import { selectDBTable, setDeepCloneTarget, setPacksData } from "@/src/appSlice";
import NodeEditor from "../NodeEditor";

const ModsViewer = memo(() => {
  const dispatch = useAppDispatch();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const currentFlowFileSelection = useAppSelector((state) => state.app.currentFlowFileSelection);
  const currentFlowFilePackPath = useAppSelector((state) => state.app.currentFlowFilePackPath);
  const packsData = useAppSelector((state) => state.app.packsData);
  const unsavedPacksData = useAppSelector((state) => state.app.unsavedPacksData);
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  // Use currentFlowFilePackPath if a flow file is selected, otherwise use DB table pack path
  const packPath =
    currentFlowFilePackPath ??
    currentDBTableSelection?.packPath ??
    (gameToPackWithDBTablesName[currentGame] || "db.pack");
  const deepCloneTarget = useAppSelector((state) => state.app.deepCloneTarget);
  const startArgs = useAppSelector((state) => state.app.startArgs);

  const [isOpen, setIsOpen] = React.useState(true);
  const [isSaveAsModalOpen, setIsSaveAsModalOpen] = React.useState(false);
  const [saveAsPackName, setSaveAsPackName] = React.useState("");
  const [saveAsDirectory, setSaveAsDirectory] = React.useState<string | undefined>(undefined);
  const [isSaveAsProcessing, setIsSaveAsProcessing] = React.useState(false);
  const [isNewPackModalOpen, setIsNewPackModalOpen] = React.useState(false);
  const [newPackName, setNewPackName] = React.useState("");
  const [isNewPackProcessing, setIsNewPackProcessing] = React.useState(false);

  const treeViewRef = useRef<PackTablesTreeViewHandle>(null);
  const saveAsPackNameInputRef = useRef<HTMLInputElement>(null);
  const newPackNameInputRef = useRef<HTMLInputElement>(null);

  const localized: Record<string, string> = useContext(localizationContext);

  // Focus on the Save As pack name input when modal opens
  useEffect(() => {
    if (isSaveAsModalOpen && saveAsPackNameInputRef.current) {
      // First, focus the window itself to ensure the viewer window has focus
      window.focus();
      // Then focus the input after the modal is fully rendered
      setTimeout(() => {
        saveAsPackNameInputRef.current?.focus();
      }, 0);
    }
  }, [isSaveAsModalOpen]);

  // Focus on the New Pack name input when modal opens
  useEffect(() => {
    if (isNewPackModalOpen && newPackNameInputRef.current) {
      // First, focus the window itself to ensure the viewer window has focus
      window.focus();
      // Then focus the input after the modal is fully rendered
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
    [setDBTableFilter]
  );

  const clearFilter = () => {
    setDBTableFilter("");
  };

  const hasUnsavedFiles = useMemo(() => {
    const unsavedFiles = unsavedPacksData[packPath];
    return unsavedFiles && unsavedFiles.length > 0;
  }, [unsavedPacksData, packPath]);

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
        saveAsDirectory
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
      // Create an empty pack in memory with the given name
      const packName = newPackName.trim();
      const packPath = `memory://${packName}`;

      // Create empty PackViewData for the new pack
      const newPackData: PackViewData = {
        packName: packName,
        packPath: packPath,
        tables: [],
        packedFiles: {},
      };

      // Add the new pack to Redux state
      dispatch(setPacksData([newPackData]));

      // Open the new pack in the viewer
      dispatch(
        selectDBTable({
          packPath: packPath,
          dbName: "",
          dbSubname: "",
        })
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
        // e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  });

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
        })
      );
    }
  }, []);

  if (!packsData[packPath]) {
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
            {isFeaturesForModdersEnabled && (
              <div className="flex justify-between items-center p-2 bg-gray-800 border-b border-gray-600">
                <div className="flex gap-2">
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
                  <div className="overflow-auto flex-1">
                    <PackTablesTreeView ref={treeViewRef} tableFilter={dbTableFilter} />
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
              <div style={{ width: "100%", minWidth: "1px", height: "100%" }}>
                {(currentFlowFileSelection && (
                  <NodeEditor currentFile={currentFlowFileSelection} currentPack={packPath} />
                )) || <PackTablesTableView />}
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
