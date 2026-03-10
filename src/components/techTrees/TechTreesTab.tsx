import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { Resizable } from "re-resizable";
import { Modal } from "../../flowbite/components/Modal/index";
import TechTreeCanvas from "./TechTreeCanvas";
import { useAppSelector } from "../../hooks";

let nextTabId = 1;

type TechTab = {
  id: string;
  setKey: string;
  label: string;
  isBlank?: boolean;
  templateSetKey?: string;
};

const TechTreesTab = memo(() => {
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const pendingSingleClickTimeoutRef = useRef<number | null>(null);
  const [isLoadingSets, setIsLoadingSets] = useState(false);
  const [nodeSets, setNodeSets] = useState<TechnologyNodeSetSummary[]>([]);
  const [setFilter, setSetFilter] = useState("");
  const [tabs, setTabs] = useState<TechTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isNewNodeSetModalOpen, setIsNewNodeSetModalOpen] = useState(false);
  const [newNodeSetName, setNewNodeSetName] = useState("");

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

  useEffect(
    () => () => {
      if (pendingSingleClickTimeoutRef.current !== null) {
        window.clearTimeout(pendingSingleClickTimeoutRef.current);
      }
    },
    [],
  );

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
              ? {
                  ...tab,
                  setKey: nodeSet.key,
                  label: nodeSet.localizedName || nodeSet.key,
                  isBlank: false,
                  templateSetKey: undefined,
                }
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

  const queueOpenSetInActiveTab = useCallback(
    (nodeSet: TechnologyNodeSetSummary) => {
      if (pendingSingleClickTimeoutRef.current !== null) {
        window.clearTimeout(pendingSingleClickTimeoutRef.current);
      }
      pendingSingleClickTimeoutRef.current = window.setTimeout(() => {
        openSetInActiveTab(nodeSet);
        pendingSingleClickTimeoutRef.current = null;
      }, 220);
    },
    [openSetInActiveTab],
  );

  const handleNodeSetDoubleClick = useCallback(
    (nodeSet: TechnologyNodeSetSummary) => {
      if (pendingSingleClickTimeoutRef.current !== null) {
        window.clearTimeout(pendingSingleClickTimeoutRef.current);
        pendingSingleClickTimeoutRef.current = null;
      }
      openSetInNewTab(nodeSet);
    },
    [openSetInNewTab],
  );

  const createBlankTreeInNewTab = useCallback((nodeSetName: string) => {
    const templateSetKey = tabs.find((tab) => tab.id === activeTabId && !tab.isBlank)?.setKey || nodeSets[0]?.key;
    if (!templateSetKey) return;
    const id = `tab_${nextTabId++}`;
    setTabs((prev) => [
      ...prev,
      {
        id,
        setKey: nodeSetName,
        label: nodeSetName,
        isBlank: true,
        templateSetKey,
      },
    ]);
    setActiveTabId(id);
  }, [activeTabId, nodeSets, tabs]);

  const openNewNodeSetModal = useCallback(() => {
    setNewNodeSetName("");
    setIsNewNodeSetModalOpen(true);
  }, []);

  const trimmedNewNodeSetName = newNodeSetName.trim();
  const newNodeSetNameExists = useMemo(
    () =>
      trimmedNewNodeSetName !== "" &&
      (nodeSets.some((nodeSet) => nodeSet.key === trimmedNewNodeSetName) ||
        tabs.some((tab) => tab.isBlank && tab.setKey === trimmedNewNodeSetName)),
    [nodeSets, tabs, trimmedNewNodeSetName],
  );

  const confirmCreateNewNodeSet = useCallback(() => {
    if (!trimmedNewNodeSetName || newNodeSetNameExists) return;
    createBlankTreeInNewTab(trimmedNewNodeSetName);
    setIsNewNodeSetModalOpen(false);
  }, [createBlankTreeInNewTab, newNodeSetNameExists, trimmedNewNodeSetName]);

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
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Technology Node Sets</div>
            <button
              type="button"
              onClick={openNewNodeSetModal}
              disabled={!isFeaturesForModdersEnabled || isLoadingSets || nodeSets.length < 1}
              className="rounded bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              New
            </button>
          </div>
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
                  onClick={() => queueOpenSetInActiveTab(nodeSet)}
                  onDoubleClick={() => handleNodeSetDoubleClick(nodeSet)}
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
                display: tab.id === activeTabId ? "block" : "none",
                pointerEvents: tab.id === activeTabId ? "auto" : "none",
              }}
            >
              <TechTreeCanvas setKey={tab.setKey} isBlank={!!tab.isBlank} templateSetKey={tab.templateSetKey} />
            </div>
          ))}
          {tabs.length === 0 && !isLoadingSets && (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              Select a technology set to view its tree.
            </div>
          )}
        </div>
      </div>
      <Modal onClose={() => setIsNewNodeSetModalOpen(false)} show={isNewNodeSetModalOpen} size="md" position="center">
        <Modal.Header>New Technology Node Set</Modal.Header>
        <Modal.Body>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-300">
              Node Set Name
              <input
                type="text"
                value={newNodeSetName}
                onChange={(event) => setNewNodeSetName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    confirmCreateNewNodeSet();
                  }
                }}
                className="mt-2 w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                placeholder="Enter new technology node set key"
                autoFocus
              />
            </label>
            {newNodeSetNameExists && (
              <p className="text-sm text-red-400">That technology node set already exists.</p>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            onClick={() => setIsNewNodeSetModalOpen(false)}
            className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmCreateNewNodeSet}
            disabled={!trimmedNewNodeSetName || newNodeSetNameExists}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create
          </button>
        </Modal.Footer>
      </Modal>
    </div>
  );
});

export default TechTreesTab;
