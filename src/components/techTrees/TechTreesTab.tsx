import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { Resizable } from "re-resizable";
import TechTreeCanvas from "./TechTreeCanvas";

let nextTabId = 1;

type TechTab = {
  id: string;
  setKey: string;
  label: string;
};

const TechTreesTab = memo(() => {
  const [isLoadingSets, setIsLoadingSets] = useState(false);
  const [nodeSets, setNodeSets] = useState<TechnologyNodeSetSummary[]>([]);
  const [setFilter, setSetFilter] = useState("");
  const [tabs, setTabs] = useState<TechTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  useEffect(() => {
    const loadNodeSets = async () => {
      setIsLoadingSets(true);
      try {
        const fetchedSets = await window.api?.getTechnologyNodeSets();
        if (!fetchedSets) return;
        setNodeSets(fetchedSets);
        if (fetchedSets.length > 0) {
          const id = `tab_${nextTabId++}`;
          const firstSet = fetchedSets[0];
          setTabs([{ id, setKey: firstSet.key, label: firstSet.localizedName || firstSet.key }]);
          setActiveTabId(id);
        }
      } finally {
        setIsLoadingSets(false);
      }
    };
    loadNodeSets();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        document.getElementById("techTreeSetFilter")?.focus();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const filteredNodeSets = useMemo(() => {
    const normalizedFilter = setFilter.trim().toLowerCase();
    if (!normalizedFilter) return nodeSets;
    return nodeSets.filter((nodeSet) => {
      const label = (nodeSet.localizedName || nodeSet.key).toLowerCase();
      return label.includes(normalizedFilter) || nodeSet.key.toLowerCase().includes(normalizedFilter);
    });
  }, [nodeSets, setFilter]);

  const openSetInActiveTab = useCallback(
    (nodeSet: TechnologyNodeSetSummary) => {
      if (!activeTabId) {
        const id = `tab_${nextTabId++}`;
        setTabs([{ id, setKey: nodeSet.key, label: nodeSet.localizedName || nodeSet.key }]);
        setActiveTabId(id);
      } else {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTabId
              ? { ...tab, setKey: nodeSet.key, label: nodeSet.localizedName || nodeSet.key }
              : tab,
          ),
        );
      }
    },
    [activeTabId],
  );

  const openSetInNewTab = useCallback((nodeSet: TechnologyNodeSetSummary) => {
    const id = `tab_${nextTabId++}`;
    setTabs((prev) => [...prev, { id, setKey: nodeSet.key, label: nodeSet.localizedName || nodeSet.key }]);
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId && next.length > 0) {
          setActiveTabId(next[Math.min(idx, next.length - 1)].id);
        } else if (next.length === 0) {
          setActiveTabId(null);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const activeSetKey = tabs.find((t) => t.id === activeTabId)?.setKey;

  return (
    <div className="flex h-[86vh] text-gray-200">
      {/* Left sidebar */}
      <Resizable
        defaultSize={{ width: 300, height: "100%" }}
        maxWidth="50%"
        minWidth={150}
        enable={{ right: true, left: false, top: false, bottom: false, topLeft: false, topRight: false, bottomLeft: false, bottomRight: false }}
      >
        <div className="h-full border-r border-gray-700 p-3 overflow-hidden flex flex-col">
          <div className="text-sm font-semibold mb-2">Technology Node Sets</div>
          <input
            id="techTreeSetFilter"
            type="text"
            value={setFilter}
            onChange={(event) => setSetFilter(event.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm mb-2"
            placeholder="Search sets... (Ctrl+F)"
          />
          <div className="overflow-auto text-sm flex-1 space-y-1 pr-1 scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700">
            {isLoadingSets && <div className="dots-loader mx-auto mt-4" />}
            {!isLoadingSets &&
              filteredNodeSets.map((nodeSet) => (
                <button
                  type="button"
                  key={nodeSet.key}
                  onClick={() => openSetInActiveTab(nodeSet)}
                  onDoubleClick={() => openSetInNewTab(nodeSet)}
                  className={`w-full text-left px-2 py-1.5 rounded border ${
                    activeSetKey === nodeSet.key
                      ? "bg-blue-900/50 border-blue-500"
                      : "bg-gray-900/30 border-gray-800 hover:bg-gray-800/50"
                  }`}
                  title={nodeSet.key}
                >
                  <div className="font-medium">{nodeSet.localizedName || nodeSet.key}</div>
                  {nodeSet.localizedName && (
                    <div className="text-xs opacity-70">{nodeSet.key}</div>
                  )}
                  {(nodeSet.factionKey || nodeSet.subculture) && (
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {nodeSet.factionKey && (
                        <span className="text-[10px] bg-gray-700 rounded px-1 opacity-70">
                          {nodeSet.factionKey}
                        </span>
                      )}
                      {nodeSet.subculture && (
                        <span className="text-[10px] bg-gray-700 rounded px-1 opacity-70">
                          {nodeSet.subculture}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              ))}
          </div>
        </div>
      </Resizable>

      {/* Right: tab bar + canvases */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Tab bar */}
        {tabs.length > 0 && (
          <div className="flex bg-gray-800 overflow-x-auto shrink-0" style={{ minHeight: "32px" }}>
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex shrink-0 items-center px-3 py-1 cursor-pointer border-r border-gray-700 text-sm whitespace-nowrap ${
                  tab.id === activeTabId
                    ? "bg-gray-700 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-750 hover:text-gray-300"
                }`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span className="mr-2" title={tab.setKey}>
                  {tab.label}
                </span>
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

        {/* Canvas area — all tabs stay mounted, only active is visible */}
        <div className="flex-1 relative min-h-0">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{
                visibility: tab.id === activeTabId ? "visible" : "hidden",
                pointerEvents: tab.id === activeTabId ? "auto" : "none",
              }}
            >
              <TechTreeCanvas setKey={tab.setKey} />
            </div>
          ))}
          {tabs.length === 0 && !isLoadingSets && (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              Select a technology set to view its tree.
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default TechTreesTab;
