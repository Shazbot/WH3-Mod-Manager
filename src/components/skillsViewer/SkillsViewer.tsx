import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import SkillsTreeView from "./SkillsTreeView";
import SkillsView, { SkillsViewHandle, SkillsViewSnapshot } from "./SkillsView";
import { SkillsDataContext } from "./skillsDataContext";
import { Resizable } from "re-resizable";
import debounce from "just-debounce-it";
import { setIsShowingSkillNodeSetNames, setSkillsData } from "../../appSlice";

type SkillTab = {
  id: string;
  subtype: string;
  subtypeIndex: number;
  skillsData: SkillsData;
  snapshot?: SkillsViewSnapshot;
};

let nextTabId = 1;
const SKILL_NODE_SET_MARKER = "_skill_node_set_";
// Each prefetched tree carries the full icon set, so only the few most recently hovered ones are kept.
const PREFETCHED_TREES_LIMIT = 3;
type SkillSubtypeSelection = { subtype: string; subtypeIndex: number };

const selectionKey = (selection: SkillSubtypeSelection) => `${selection.subtype}:${selection.subtypeIndex}`;

const isMatchingSelection = (selection: SkillSubtypeSelection | null, skillsData: SkillsData) =>
  selection != null &&
  selection.subtype === skillsData.currentSubtype &&
  selection.subtypeIndex === skillsData.currentSubtypeIndex;

const SkillsViewer = memo(() => {
  const [filterInputValue, setFilterInputValue] = useState("");
  const [dbTableFilter, setDBTableFilter] = useState("");
  const [tabs, setTabs] = useState<SkillTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const pendingNewTab = useRef<SkillSubtypeSelection | null>(null);
  const pendingActiveTab = useRef<SkillSubtypeSelection | null>(null);
  // The tab a single click last replaced, kept so a double-click can give it back. It has none when the click opened
  // the first tab.
  const replacedTab = useRef<{ selectionKey: string; previous?: SkillTab } | null>(null);
  const routedSkillsData = useRef<SkillsData | null>(null);
  // Trees loaded on hover, by selection key, so a click can show one without waiting on main.
  const prefetchedTrees = useRef(new Map<string, Promise<SkillsData | undefined>>());
  const servedFromPrefetch = useRef<SkillsData | null>(null);
  const skillsViewRef = useRef<SkillsViewHandle>(null);
  const dispatch = useAppDispatch();
  const debouncedFilterChange = useRef(debounce((val: string) => setDBTableFilter(val), 150));

  const onFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    setFilterInputValue(nextValue);
    debouncedFilterChange.current(nextValue);
  }, []);

  const clearFilter = () => {
    debouncedFilterChange.current.cancel();
    setFilterInputValue("");
    setDBTableFilter("");
  };

  useEffect(() => () => debouncedFilterChange.current.cancel(), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        document.getElementById("dbTableFilter")?.focus();
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const skillsData = useAppSelector((state) => state.app.skillsData);
  const localized = useAppSelector((state) => state.app.currentLocalization);
  const isShowingSkillNodeSetNames = useAppSelector((state) => state.app.isShowingSkillNodeSetNames);
  const isLocalizingSubtypes = useAppSelector((state) => state.app.isLocalizingSubtypes);

  const getTabLabel = useCallback(
    (tab: SkillTab) => {
      if (isShowingSkillNodeSetNames) {
        const fullSetKey = tab.skillsData.subtypesToSet?.[tab.subtype]?.[tab.subtypeIndex] ?? tab.subtype;
        const markerIndex = fullSetKey.indexOf(SKILL_NODE_SET_MARKER);
        const hasPrefix = markerIndex > 0;
        const suffixStart = markerIndex + SKILL_NODE_SET_MARKER.length;
        const hasSuffix = suffixStart < fullSetKey.length;
        if (hasPrefix && hasSuffix) {
          return {
            display: fullSetKey.slice(suffixStart),
            tooltip: fullSetKey,
          };
        }
        return {
          display: fullSetKey,
          tooltip: fullSetKey,
        };
      }

      const subtypeName = isLocalizingSubtypes
        ? (tab.skillsData.subtypesToLocalizedNames[tab.subtype] ?? tab.subtype)
        : tab.subtype;
      const indexSuffix = (tab.skillsData.subtypeToNumSets[tab.subtype] ?? 0) > 1 ? ` ${tab.subtypeIndex + 1}` : "";
      return {
        display: `${subtypeName}${indexSuffix}`,
        tooltip: undefined,
      };
    },
    [isShowingSkillNodeSetNames, isLocalizingSubtypes],
  );

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
    // Switching tabs re-runs this effect. Only a new response is routed, or the tab switched to would be overwritten.
    if (skillsData === routedSkillsData.current) return;
    routedSkillsData.current = skillsData;
    // Main cannot say whether it pushed a requested tree or a rebuild, and a rebuild makes the prefetched trees
    // stale, so any push from main drops them.
    if (skillsData !== servedFromPrefetch.current) prefetchedTrees.current = new Map();

    const pending = pendingNewTab.current;
    const pendingActive = pendingActiveTab.current;
    // Double-click: snapshot current tab, then create a new tab. With no tab open, a single click opens one too.
    const isPendingNewTab = isMatchingSelection(pending, skillsData);
    const newTabSelection = isPendingNewTab
      ? pending
      : !activeTabId && isMatchingSelection(pendingActive, skillsData)
        ? pendingActive
        : null;
    if (newTabSelection) {
      if (isPendingNewTab) pendingNewTab.current = null;
      else replacedTab.current = { selectionKey: selectionKey(newTabSelection) };
      pendingActiveTab.current = null;
      snapshotCurrentTab();
      const id = `tab_${nextTabId++}`;
      const newTab: SkillTab = {
        id,
        subtype: newTabSelection.subtype,
        subtypeIndex: newTabSelection.subtypeIndex,
        skillsData,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(id);
      return;
    }

    if (pendingActive && isMatchingSelection(pendingActive, skillsData)) {
      pendingActiveTab.current = null;
      const replaced = tabs.find((tab) => tab.id === activeTabId);
      if (replaced) {
        const snapshot = skillsViewRef.current?.getSnapshot();
        replacedTab.current = { selectionKey: selectionKey(pendingActive), previous: { ...replaced, snapshot } };
      }
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          return {
            ...tab,
            subtype: skillsData.currentSubtype,
            subtypeIndex: skillsData.currentSubtypeIndex,
            skillsData,
            snapshot: undefined,
          };
        }),
      );
      return;
    } else if (tabs.length === 0) {
      // First load: create the initial tab
      const id = `tab_${nextTabId++}`;
      const newTab: SkillTab = {
        id,
        subtype: skillsData.currentSubtype,
        subtypeIndex: skillsData.currentSubtypeIndex,
        skillsData,
      };
      setTabs([newTab]);
      setActiveTabId(id);
      return;
    }

    if (pendingNewTab.current || pendingActiveTab.current) {
      return;
    }

    if (activeTabId) {
      // Single-click: update the active tab's data (clear snapshot since data changed)
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          return {
            ...tab,
            subtype: skillsData.currentSubtype,
            subtypeIndex: skillsData.currentSubtypeIndex,
            skillsData,
            snapshot: undefined,
          };
        }),
      );
    }
  }, [activeTabId, skillsData, snapshotCurrentTab, tabs]);

  const onTreeHover = useCallback((subtype: string, subtypeIndex: number) => {
    const trees = prefetchedTrees.current;
    const key = selectionKey({ subtype, subtypeIndex });
    if (!window.api || trees.has(key)) return;
    if (trees.size >= PREFETCHED_TREES_LIMIT) {
      // A Map keeps insertion order, so the first key is the oldest.
      const oldestKey = trees.keys().next().value;
      if (oldestKey !== undefined) trees.delete(oldestKey);
    }
    const prefetch = window.api.prefetchSkillsForSubtype(subtype, subtypeIndex).catch(() => undefined);
    trees.set(key, prefetch);
    prefetch.then((data) => {
      if (!data && trees.get(key) === prefetch) trees.delete(key);
    });
  }, []);

  // Uses the hover prefetch when there is one, and asks main otherwise.
  const requestTree = useCallback(
    (subtype: string, subtypeIndex: number) => {
      const key = selectionKey({ subtype, subtypeIndex });
      const prefetch = prefetchedTrees.current.get(key);
      if (!prefetch) {
        window.api?.getSkillsForSubtype(subtype, subtypeIndex);
        return;
      }
      window.api?.setSkillsSelection(subtype, subtypeIndex);
      prefetch.then((data) => {
        // A rebuild may have cleared it while it was loading.
        if (!data || prefetchedTrees.current.get(key) !== prefetch) {
          window.api?.getSkillsForSubtype(subtype, subtypeIndex);
          return;
        }
        // Another tree may have been picked while it was loading.
        const isStillPending = [pendingActiveTab.current, pendingNewTab.current].some(
          (pending) => pending && selectionKey(pending) === key,
        );
        if (!isStillPending) return;
        // A copy, so a tree shown from the prefetch before still counts as a new response.
        const served = { ...data };
        servedFromPrefetch.current = served;
        dispatch(setSkillsData(served));
      });
    },
    [dispatch],
  );

  const onTreeSelect = useCallback(
    (subtype: string, subtypeIndex: number) => {
      pendingActiveTab.current = { subtype, subtypeIndex };
      requestTree(subtype, subtypeIndex);
    },
    [requestTree],
  );

  const onTreeDoubleClick = useCallback((subtype: string, subtypeIndex: number, firstClickSelected: boolean) => {
    // The first click of a double-click already loads the tree into the active tab, so single clicks never wait to
    // rule out a double-click. The double-click moves that tree to a new tab and gives the active tab back its tree.
    const key = selectionKey({ subtype, subtypeIndex });
    const pendingActive = pendingActiveTab.current;
    const firstClickPending =
      firstClickSelected && pendingActive && selectionKey(pendingActive) === key ? pendingActive : null;
    const replaced = replacedTab.current;
    if (firstClickSelected && !firstClickPending && replaced?.selectionKey === key) {
      replacedTab.current = null;
      const previous = replaced.previous;
      // The first click opened its own tab, so there is nothing to move.
      if (!previous) return;
      const restoredTab = { ...previous, id: `tab_${nextTabId++}` };
      // The loaded tree keeps its tab id so its view stays mounted.
      setTabs((prev) => {
        const current = prev.find((tab) => tab.id === previous.id);
        if (!current || selectionKey(current) !== key) return prev;
        return [...prev.map((tab) => (tab === current ? restoredTab : tab)), current];
      });
      return;
    }

    if (firstClickPending) {
      // Its response has not arrived yet, so it is routed to a new tab instead.
      pendingNewTab.current = firstClickPending;
      pendingActiveTab.current = null;
      return;
    }
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
      <div style={{ width: "100%", display: "flex" }}>
        <Resizable defaultSize={{ width: "17%", height: "85vh" }} maxWidth="100%" minWidth="1">
          <div>
            <div className="overflow-auto h-[85vh] scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700">
              <SkillsTreeView
                tableFilter={dbTableFilter}
                onSelect={onTreeSelect}
                onHover={onTreeHover}
                onDoubleClick={onTreeDoubleClick}
                isSelectionCleared={tabs.length === 0}
              />
            </div>
          </div>
        </Resizable>
        <div style={{ width: "100%", minWidth: "1px", display: "flex", flexDirection: "column" }}>
          {tabs.length > 0 && (
            <div className="flex bg-gray-800 overflow-x-auto" style={{ minHeight: "32px" }}>
              {tabs.map((tab) => {
                const tabLabel = getTabLabel(tab);
                return (
                  <div
                    key={tab.id}
                    className={`flex shrink-0 items-center px-3 py-1 cursor-pointer border-r border-gray-700 text-sm whitespace-nowrap ${
                      tab.id === activeTabId
                        ? "bg-gray-700 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-750 hover:text-gray-300"
                    }`}
                    onClick={() => switchTab(tab.id)}
                    onMouseDown={(e) => {
                      // Keeps the middle button from starting autoscroll.
                      if (e.button === 1) e.preventDefault();
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) closeTab(tab.id);
                    }}
                  >
                    <span className="mr-2" title={tabLabel.tooltip}>
                      {tabLabel.display}
                    </span>
                    <button
                      className="text-gray-500 hover:text-white ml-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                    >
                      <FontAwesomeIcon icon={faXmark} size="xs" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ flex: 1 }}>
            {activeTab && (
              <SkillsDataContext.Provider value={activeTab.skillsData}>
                <SkillsView
                  key={activeTab.id}
                  ref={skillsViewRef}
                  skillsData={activeTab.skillsData}
                  initialSnapshot={activeTab.snapshot}
                />
              </SkillsDataContext.Provider>
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
            value={filterInputValue}
            className="ml-2 block bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
          ></input>
          <span className="absolute right-[0.3rem] top-[0.6rem] text-gray-400">
            <button onClick={() => clearFilter()}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </span>
        </span>
        <label htmlFor="isShowingSkillNodeSetNamesCheckbox" className="ml-4 flex items-center text-sm">
          <input
            id="isShowingSkillNodeSetNamesCheckbox"
            type="checkbox"
            checked={!!isShowingSkillNodeSetNames}
            onChange={() => dispatch(setIsShowingSkillNodeSetNames(!isShowingSkillNodeSetNames))}
          ></input>
          <span className="ml-2">
            {localized.showSkillNodeSetNames || "Show Skill Node Set Names"}
          </span>
        </label>
      </div>
    </div>
  );
});

export default SkillsViewer;
