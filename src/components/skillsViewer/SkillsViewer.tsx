import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useAppSelector } from "../../hooks";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import SkillsTreeView from "./SkillsTreeView";
import SkillsView, { SkillsViewHandle, SkillsViewSnapshot } from "./SkillsView";
import { Resizable } from "re-resizable";
import debounce from "just-debounce-it";

type SkillTab = {
  id: string;
  subtype: string;
  subtypeIndex: number;
  skillsData: SkillsData;
  label: string;
  snapshot?: SkillsViewSnapshot;
};

let nextTabId = 1;

const SkillsViewer = memo(() => {
  const [isOpen, setIsOpen] = useState(true);
  const [dbTableFilter, setDBTableFilter] = useState("");
  const [tabs, setTabs] = useState<SkillTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const pendingNewTab = useRef<{ subtype: string; subtypeIndex: number } | null>(null);
  const skillsViewRef = useRef<SkillsViewHandle>(null);

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
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const skillsData = useAppSelector((state) => state.app.skillsData);

  // Snapshot the current tab before switching away
  const snapshotCurrentTab = useCallback(() => {
    if (activeTabId && skillsViewRef.current) {
      const snapshot = skillsViewRef.current.getSnapshot();
      setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, snapshot } : tab)));
    }
  }, [activeTabId]);

  const switchTab = useCallback(
    (newTabId: string) => {
      if (newTabId === activeTabId) return;
      snapshotCurrentTab();
      setActiveTabId(newTabId);
    },
    [activeTabId, snapshotCurrentTab],
  );

  // When Redux skillsData updates, route it to the correct tab
  useEffect(() => {
    if (!skillsData || !skillsData.currentSkills) return;

    const pending = pendingNewTab.current;
    if (pending) {
      // Double-click: snapshot current tab, then create a new tab
      pendingNewTab.current = null;
      snapshotCurrentTab();
      const id = `tab_${nextTabId++}`;
      const label = skillsData.subtypesToLocalizedNames?.[pending.subtype] || pending.subtype;
      const indexSuffix =
        skillsData.subtypeToNumSets[pending.subtype] > 1 ? ` ${pending.subtypeIndex + 1}` : "";
      const newTab: SkillTab = {
        id,
        subtype: pending.subtype,
        subtypeIndex: pending.subtypeIndex,
        skillsData,
        label: label + indexSuffix,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(id);
    } else if (tabs.length === 0) {
      // First load: create the initial tab
      const id = `tab_${nextTabId++}`;
      const label =
        skillsData.subtypesToLocalizedNames?.[skillsData.currentSubtype] || skillsData.currentSubtype;
      const indexSuffix =
        skillsData.subtypeToNumSets[skillsData.currentSubtype] > 1
          ? ` ${skillsData.currentSubtypeIndex + 1}`
          : "";
      const newTab: SkillTab = {
        id,
        subtype: skillsData.currentSubtype,
        subtypeIndex: skillsData.currentSubtypeIndex,
        skillsData,
        label: label + indexSuffix,
      };
      setTabs([newTab]);
      setActiveTabId(id);
    } else if (activeTabId) {
      // Single-click: update the active tab's data (clear snapshot since data changed)
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          const label =
            skillsData.subtypesToLocalizedNames?.[skillsData.currentSubtype] || skillsData.currentSubtype;
          const indexSuffix =
            skillsData.subtypeToNumSets[skillsData.currentSubtype] > 1
              ? ` ${skillsData.currentSubtypeIndex + 1}`
              : "";
          return {
            ...tab,
            subtype: skillsData.currentSubtype,
            subtypeIndex: skillsData.currentSubtypeIndex,
            skillsData,
            label: label + indexSuffix,
            snapshot: undefined,
          };
        }),
      );
    }
  }, [skillsData]);

  const onTreeDoubleClick = useCallback((subtype: string, subtypeIndex: number) => {
    console.log("Double clicked", subtype);
    pendingNewTab.current = { subtype, subtypeIndex };
    window.api?.getSkillsForSubtype(subtype, subtypeIndex);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId && next.length > 0) {
          const newIdx = Math.min(idx, next.length - 1);
          setActiveTabId(next[newIdx].id);
        } else if (next.length === 0) {
          setActiveTabId(null);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // console.log("SkillsViewer tabs:", tabs);
  return (
    <div className="dark:text-gray-300">
      {isOpen && (
        <>
          <div style={{ width: "100%", display: "flex" }}>
            <Resizable defaultSize={{ width: "17%", height: "85vh" }} maxWidth="100%" minWidth="1">
              <div>
                <div className="overflow-auto h-[85vh] scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700">
                  <SkillsTreeView tableFilter={dbTableFilter} onDoubleClick={onTreeDoubleClick} />
                </div>
              </div>
            </Resizable>
            <div style={{ width: "100%", minWidth: "1px", display: "flex", flexDirection: "column" }}>
              {tabs.length > 0 && (
                <div className="flex bg-gray-800 overflow-x-auto" style={{ minHeight: "32px" }}>
                  {tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={`flex items-center px-3 py-1 cursor-pointer border-r border-gray-700 text-sm whitespace-nowrap ${
                        tab.id === activeTabId
                          ? "bg-gray-700 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-750 hover:text-gray-300"
                      }`}
                      onClick={() => switchTab(tab.id)}
                    >
                      <span className="mr-2 max-w-[200px] overflow-hidden text-ellipsis">{tab.subtype}</span>
                      {tabs.length > 1 && (
                        <button
                          className="text-gray-500 hover:text-white ml-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                          }}
                        >
                          <FontAwesomeIcon icon={faXmark} size="xs" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ flex: 1 }}>
                {activeTab && (
                  <SkillsView
                    key={activeTab.id}
                    ref={skillsViewRef}
                    skillsData={activeTab.skillsData}
                    initialSnapshot={activeTab.snapshot}
                  />
                )}
              </div>
            </div>
          </div>

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
