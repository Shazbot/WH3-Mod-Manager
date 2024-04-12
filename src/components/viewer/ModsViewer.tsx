import React, { useContext, useEffect, useState } from "react";
import { useAppSelector } from "../../hooks";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import PackTablesTreeView from "./PackTablesTreeView";
import PackTablesTableView from "./PackTablesTableView";
import { Resizable } from "re-resizable";
import debounce from "just-debounce-it";
import localizationContext from "../../localizationContext";

const ModsViewer = React.memo(() => {
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const packsData = useAppSelector((state) => state.app.packsData);
  const packPath = currentDBTableSelection?.packPath ?? "db.pack";

  const [isOpen, setIsOpen] = React.useState(true);

  const localized: Record<string, string> = useContext(localizationContext);

  const [dbTableFilter, setDBTableFilter] = useState("");
  const debouncedFilterChange = debounce((val: string) => setDBTableFilter(val), 150);
  const onFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    debouncedFilterChange(e.target.value);
  };

  const clearFilter = () => {
    setDBTableFilter("");
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

  if (!packsData[packPath]) {
    console.log(`ModsViewer: no ${packPath} in packsData`);
    return <></>;
  }

  // console.log(`currentPackData.data is ${currentPackData.data}`);

  return (
    <div className="dark:text-gray-300">
      {isOpen && (
        <>
          <div
            style={{
              width: "100%",
              display: "flex",
            }}
          >
            <Resizable
              defaultSize={{
                width: "17%",
                height: "90vh",
              }}
              maxWidth="100%"
              minWidth="1"
            >
              <div>
                {/* <div className="overflow-auto hover:-scale-x-100 overflow-y-scroll h-[90vh] hover:overflow-x-visible hover:overflow-y-scroll hover:absolute hover:z-50"> */}
                <div className="overflow-auto  h-[90vh]">
                  {/* <div className="hover:-scale-x-100"> */}
                  <PackTablesTreeView tableFilter={dbTableFilter} />
                </div>
                {/* </div> */}
              </div>
            </Resizable>
            <div style={{ width: "100%", minWidth: "1px" }}>
              <PackTablesTableView />
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

          <div className="flex items-center">
            <span className="text-slate-100">{localized.filter}</span>
            <span className="relative">
              <input
                id="dbTableFilter"
                type="text"
                onChange={(e) => onFilterChange(e)}
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
        </>
      )}
    </div>
  );
});

export default ModsViewer;
