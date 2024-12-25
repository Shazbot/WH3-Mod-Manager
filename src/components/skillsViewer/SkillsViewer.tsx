import React, { memo, useContext, useEffect, useState } from "react";
import { useAppSelector } from "../../hooks";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import SkillsTreeView from "./SkillsTreeView";
import SkillsView from "./SkillsView";
import { Resizable } from "re-resizable";
import debounce from "just-debounce-it";
import localizationContext from "../../localizationContext";

const SkillsViewer = memo(() => {
  const [isOpen, setIsOpen] = useState(true);

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
    // window.api?.getPackData(packPath, { dbName: "main_units_tables", dbSubname: "data__" });
    // dispatch(
    //   selectDBTable({
    //     packPath: `\\\\${packPath}`,
    //     dbName: "main_units_tables",
    //     dbSubname: "data__",
    //   })
    // );
  }, []);

  const skillsData = useAppSelector((state) => state.app.skillsData);

  if (!skillsData) {
    console.log("skillsData missing!");
    return <></>;
  }
  const skills = skillsData.currentSkills; //subtypeToSkills["wh_main_emp_karl_franz"];

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
                height: "85vh",
              }}
              maxWidth="100%"
              minWidth="1"
            >
              <div>
                {/* <div className="overflow-auto hover:-scale-x-100 overflow-y-scroll h-[90vh] hover:overflow-x-visible hover:overflow-y-scroll hover:absolute hover:z-50"> */}
                <div className="overflow-auto  h-[85vh]">
                  {/* <div className="hover:-scale-x-100"> */}
                  <SkillsTreeView tableFilter={dbTableFilter} />
                </div>
                {/* </div> */}
              </div>
            </Resizable>
            <div style={{ width: "100%", minWidth: "1px" }}>{skills && <SkillsView />}</div>
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
            <span className="relative">
              <input
                id="dbTableFilter"
                type="text"
                placeholder="Filter"
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

export default SkillsViewer;
