import React, { memo, useContext, useEffect, useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import PackTablesTreeView from "./PackTablesTreeView";
import PackTablesTableView from "./PackTablesTableView";
import { Resizable } from "re-resizable";
import debounce from "just-debounce-it";
import localizationContext from "../../localizationContext";
import { gameToPackWithDBTablesName } from "../../supportedGames";
import { Modal } from "@/src/flowbite";
import DBDuplication from "@/src/components/viewer/DBDuplication";
import { selectDBTable, setDeepCloneTarget } from "@/src/appSlice";
import NodeEditor from "../NodeEditor";

const ModsViewer = memo(() => {
  const dispatch = useAppDispatch();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const currentFlowFileSelection = useAppSelector((state) => state.app.currentFlowFileSelection);
  const packsData = useAppSelector((state) => state.app.packsData);
  const unsavedPacksData = useAppSelector((state) => state.app.unsavedPacksData);
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const packPath =
    currentDBTableSelection?.packPath ?? (gameToPackWithDBTablesName[currentGame] || "db.pack");
  const deepCloneTarget = useAppSelector((state) => state.app.deepCloneTarget);
  const startArgs = useAppSelector((state) => state.app.startArgs);

  const [isOpen, setIsOpen] = React.useState(true);

  const localized: Record<string, string> = useContext(localizationContext);

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
        alert(`Pack saved successfully to: ${result.savedPath}`);
      } else {
        console.error("Failed to save pack:", result?.error);
        alert(`Failed to save pack: ${result?.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error saving pack:", error);
      alert(`Error saving pack: ${error instanceof Error ? error.message : "Unknown error"}`);
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

      <div className="dark:text-gray-300">
        {isOpen && (
          <>
            {/* Save Pack Button */}
            {hasUnsavedFiles && (
              <div className="flex justify-end p-2 bg-gray-800 border-b border-gray-600">
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
              </div>
            )}

            <div
              style={{
                width: "100%",
                display: "flex",
              }}
            >
              <Resizable
                defaultSize={{
                  width: "17%",
                  height: "85vh",
                }}
                maxWidth="100%"
                minWidth="1"
              >
                <div>
                  {/* <div className="overflow-auto hover:-scale-x-100 overflow-y-scroll h-[90vh] hover:overflow-x-visible hover:overflow-y-scroll hover:absolute hover:z-50"> */}
                  <div className="overflow-auto  h-[85vh]">
                    {/* <div className="hover:-scale-x-100"> */}
                    <PackTablesTreeView tableFilter={dbTableFilter} />
                  </div>
                  {/* </div> */}
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
              <div style={{ width: "100%", minWidth: "1px" }}>
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
