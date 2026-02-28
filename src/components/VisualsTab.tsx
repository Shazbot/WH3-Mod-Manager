import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "../hooks";
import { Resizable } from "re-resizable";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faChevronRight } from "@fortawesome/free-solid-svg-icons";

type VisualsUnitEntry = {
  unitKey: string;
  faction: string;
  localizedName: string;
  variantName?: string;
  variantMeshPath?: string;
  originPackPath: string;
  originLabel: string;
};

type VisualsViewerTab = {
  id: string;
  label: string;
  filePath: string;
  status: "idle" | "loading" | "ready" | "error";
  text?: string;
  error?: string;
  resolvedPackPath?: string;
  resolvedFileName?: string;
  requestId?: number;
};

type VisualsFileResult = {
  path: string;
  ext: "variantmeshdefinition" | "wsmodel" | "rigid_model_v2";
};

type VisualsAssetEditorContextMenu = {
  x: number;
  y: number;
  targetPath: string;
  preferredPackPath?: string;
};

let nextVisualsTabId = 1;
let nextVisualsRequestId = 1;

const collator = new Intl.Collator("en");
const viewerModelPathRegex = /([A-Za-z0-9_.\-\\/]+?\.(?:variantmeshdefinition|wsmodel|rigid_model_v2))/gi;

const getBaseName = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

const getTabLabel = (path: string) => {
  const base = getBaseName(path);
  return base.length > 48 ? `${base.slice(0, 45)}...` : base;
};

const VisualsTab = memo(() => {
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const enabledMods = useAppSelector((state) => state.app.currentPreset.mods.filter((mod) => mod.isEnabled));

  const [isLeftOpen] = useState(true);
  const [units, setUnits] = useState<VisualsUnitEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoadingUnits, setIsLoadingUnits] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [unitFilterInput, setUnitFilterInput] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [isGroupedByOrigin, setIsGroupedByOrigin] = useState(false);
  const [collapsedOriginGroups, setCollapsedOriginGroups] = useState<Record<string, boolean>>({});
  const [viewerMessage, setViewerMessage] = useState<string | null>(null);

  const [tabs, setTabs] = useState<VisualsViewerTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const [isFilePanelOpen, setIsFilePanelOpen] = useState(false);
  const [fileQueryInput, setFileQueryInput] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [fileResults, setFileResults] = useState<VisualsFileResult[]>([]);
  const [fileResultsTotal, setFileResultsTotal] = useState(0);
  const [isFileSearchLoading, setIsFileSearchLoading] = useState(false);
  const [fileSearchError, setFileSearchError] = useState<string | null>(null);
  const [assetEditorContextMenu, setAssetEditorContextMenu] = useState<VisualsAssetEditorContextMenu | null>(null);

  const unitClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabledModsKey = enabledMods
    .map((mod) => `${mod.path}|${mod.loadOrder ?? ""}|${mod.name}`)
    .sort()
    .join("||");

  useEffect(() => {
    const timer = setTimeout(() => {
      setUnitFilter(unitFilterInput.trim().toLowerCase());
    }, 120);
    return () => clearTimeout(timer);
  }, [unitFilterInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFileQuery(fileQueryInput.trim().toLowerCase());
    }, 120);
    return () => clearTimeout(timer);
  }, [fileQueryInput]);

  useEffect(() => {
    if (!isFeaturesForModdersEnabled) return;

    let isCancelled = false;

    const run = async () => {
      setIsLoadingUnits(true);
      setUnitsError(null);
      setViewerMessage(null);
      try {
        const result = await window.api?.getVisualsUnitsData(enabledMods);
        if (isCancelled) return;
        if (!result?.success || !result.sessionId || !result.units) {
          setUnits([]);
          setSessionId(null);
          setUnitsError(result?.error || "Failed to load visuals units data");
          setTabs([]);
          setActiveTabId(null);
          setFileResults([]);
          setFileResultsTotal(0);
          return;
        }

        setUnits(result.units);
        setSessionId(result.sessionId);
        setTabs([]);
        setActiveTabId(null);
        setFileResults([]);
        setFileResultsTotal(0);
      } catch (error) {
        if (isCancelled) return;
        setUnits([]);
        setSessionId(null);
        setUnitsError(error instanceof Error ? error.message : "Failed to load visuals units data");
      } finally {
        if (!isCancelled) setIsLoadingUnits(false);
      }
    };

    run();

    return () => {
      isCancelled = true;
    };
  }, [enabledModsKey, isFeaturesForModdersEnabled]);

  const filteredUnits = useMemo(() => {
    if (!unitFilter) return units;
    return units.filter((entry) => {
      const haystack = `${entry.localizedName} ${entry.unitKey} ${entry.faction} ${entry.variantName || ""}`.toLowerCase();
      return haystack.includes(unitFilter);
    });
  }, [units, unitFilter]);

  const unitComparator = useMemo(() => {
    return (first: VisualsUnitEntry, second: VisualsUnitEntry) => {
      const nameDiff = collator.compare(first.localizedName, second.localizedName);
      if (nameDiff !== 0) return nameDiff;
      const keyDiff = collator.compare(first.unitKey, second.unitKey);
      if (keyDiff !== 0) return keyDiff;
      return collator.compare(first.faction || "", second.faction || "");
    };
  }, []);

  const groupedUnits = useMemo(() => {
    if (!isGroupedByOrigin) return null;

    const groups = new Map<string, VisualsUnitEntry[]>();
    for (const unit of filteredUnits) {
      const label = unit.originLabel || "Unknown";
      const existing = groups.get(label);
      if (existing) existing.push(unit);
      else groups.set(label, [unit]);
    }

    const sortedLabels = Array.from(groups.keys()).sort((first, second) => {
      const firstLower = first.toLowerCase();
      const secondLower = second.toLowerCase();
      if (firstLower === "vanilla" && secondLower !== "vanilla") return -1;
      if (secondLower === "vanilla" && firstLower !== "vanilla") return 1;
      return collator.compare(first, second);
    });

    return sortedLabels.map((label) => ({
      label,
      units: [...(groups.get(label) || [])].sort(unitComparator),
    }));
  }, [filteredUnits, isGroupedByOrigin, unitComparator]);

  const toggleOriginGroupCollapsed = (label: string) => {
    setCollapsedOriginGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;

  const openVariantMeshTab = async (filePath: string, mode: "current" | "new") => {
    if (!filePath) {
      setViewerMessage("No variantmeshdefinition path is available for this entry.");
      return;
    }
    if (!sessionId) {
      setViewerMessage("Visuals session is not ready yet.");
      return;
    }

    setViewerMessage(null);

    const requestId = nextVisualsRequestId++;
    let targetTabId = activeTabId;

    if (mode === "new" || !activeTabId || tabs.length === 0) {
      targetTabId = `visuals_tab_${nextVisualsTabId++}`;
      const newTab: VisualsViewerTab = {
        id: targetTabId,
        label: getTabLabel(filePath),
        filePath,
        status: "loading",
        requestId,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(targetTabId);
    } else {
      const currentId = activeTabId;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === currentId
            ? {
                ...tab,
                label: getTabLabel(filePath),
                filePath,
                status: "loading",
                text: undefined,
                error: undefined,
                resolvedPackPath: undefined,
                resolvedFileName: undefined,
                requestId,
              }
            : tab,
        ),
      );
      targetTabId = currentId;
    }

    const result = await window.api?.readVariantMeshDefinition(sessionId, filePath);

    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== targetTabId || tab.requestId !== requestId) return tab;
        if (!result?.success || !result.text) {
          return {
            ...tab,
            status: "error",
            error: result?.error || "Failed to read variantmeshdefinition",
          };
        }
        return {
          ...tab,
          status: "ready",
          text: result.text,
          error: undefined,
          resolvedPackPath: result.resolved?.packPath,
          resolvedFileName: result.resolved?.fileName,
        };
      }),
    );
  };

  const loadFileResultsPage = async (nextOffset: number, append = false) => {
    if (!sessionId || !isFilePanelOpen) return;

    setIsFileSearchLoading(true);
    setFileSearchError(null);
    const result = await window.api?.searchVisualsFiles(sessionId, fileQuery, nextOffset, 200);
    if (!result?.success || !result.results) {
      setIsFileSearchLoading(false);
      setFileSearchError(result?.error || "Failed to search files");
      if (!append) {
        setFileResults([]);
        setFileResultsTotal(0);
      }
      return;
    }

    setFileResults((prev) => (append ? [...prev, ...result.results!] : result.results!));
    setFileResultsTotal(result.total || result.results.length);
    setIsFileSearchLoading(false);
  };

  useEffect(() => {
    if (!isFilePanelOpen || !sessionId) return;
    loadFileResultsPage(0, false);
  }, [isFilePanelOpen, sessionId, fileQuery]);

  useEffect(() => {
    if (!assetEditorContextMenu) return;

    const onDocumentClick = () => setAssetEditorContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAssetEditorContextMenu(null);
    };

    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [assetEditorContextMenu]);

  const onUnitSingleClick = (unit: VisualsUnitEntry) => {
    if (!unit.variantMeshPath) {
      setViewerMessage(
        `No variantmeshdefinition resolved for ${unit.localizedName}${unit.faction ? ` (${unit.faction})` : ""}.`,
      );
      return;
    }
    openVariantMeshTab(unit.variantMeshPath, "current");
  };

  const onUnitDoubleClick = (unit: VisualsUnitEntry) => {
    if (!unit.variantMeshPath) {
      setViewerMessage(
        `No variantmeshdefinition resolved for ${unit.localizedName}${unit.faction ? ` (${unit.faction})` : ""}.`,
      );
      return;
    }
    openVariantMeshTab(unit.variantMeshPath, "new");
  };

  const onFileSingleClick = (file: VisualsFileResult) => {
    if (file.ext !== "variantmeshdefinition") return;
    openVariantMeshTab(file.path, "current");
  };

  const onFileDoubleClick = (file: VisualsFileResult) => {
    if (file.ext !== "variantmeshdefinition") return;
    openVariantMeshTab(file.path, "new");
  };

  const openAssetEditorContextMenu = (
    event: React.MouseEvent,
    targetPath?: string,
    preferredPackPath?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!targetPath) {
      setViewerMessage("No resolved file path is available for AssetEditor.");
      return;
    }
    setAssetEditorContextMenu({ x: event.clientX, y: event.clientY, targetPath, preferredPackPath });
  };

  const sendToAssetEditor = async (
    targetPath: string,
    mode: "new" | "existing",
    preferredPackPath?: string,
  ) => {
    if (!sessionId) {
      setViewerMessage("Visuals session is not ready yet.");
      return;
    }

    setViewerMessage(null);
    const result = await window.api?.openInAssetEditor(sessionId, targetPath, mode, preferredPackPath);
    if (!result?.success) {
      const details = [result?.error, result?.response?.error, result?.response?.normalizedPath]
        .filter(Boolean)
        .join(" | ");
      setViewerMessage(details || "Failed to send AssetEditor open request.");
      return;
    }

    const resolvedFile = result.resolved?.fileName || targetPath;
    setViewerMessage(
      `Sent to AssetEditor (${mode === "existing" ? "existing" : "new"} tab): ${resolvedFile}`,
    );
  };

  const onAssetEditorContextAction = async (mode: "new" | "existing") => {
    if (!assetEditorContextMenu) return;
    const { targetPath, preferredPackPath } = assetEditorContextMenu;
    setAssetEditorContextMenu(null);
    await sendToAssetEditor(targetPath, mode, preferredPackPath);
  };

  const closeTab = (tabId: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === tabId);
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      if (tabId === activeTabId) {
        if (nextTabs.length === 0) {
          setActiveTabId(null);
        } else {
          setActiveTabId(nextTabs[Math.max(0, Math.min(index, nextTabs.length - 1))].id);
        }
      }
      return nextTabs;
    });
  };

  const renderVariantMeshText = (text: string, preferredPackPath?: string) => {
    const lines = text.split(/\r?\n/);

    return (
      <pre className="m-0 p-3 whitespace-pre-wrap break-words font-mono text-sm text-gray-200">
        {lines.map((line, lineIndex) => {
          if (!viewerModelPathRegex.test(line)) {
            viewerModelPathRegex.lastIndex = 0;
            return <React.Fragment key={`line-${lineIndex}`}>{line + (lineIndex < lines.length - 1 ? "\n" : "")}</React.Fragment>;
          }
          viewerModelPathRegex.lastIndex = 0;

          const parts: React.ReactNode[] = [];
          let lastIndex = 0;
          let match: RegExpExecArray | null = null;
          while ((match = viewerModelPathRegex.exec(line)) !== null) {
            const [fullMatch, pathValue] = match;
            const matchStart = match.index;
            const pathEnd = matchStart + fullMatch.length;
            const pathExt = pathValue.toLowerCase();
            const isVariantMeshDefinition = pathExt.endsWith(".variantmeshdefinition");
            const isClickableInVisuals =
              isVariantMeshDefinition &&
              line.includes("VARIANT_MESH_REFERENCE") &&
              line.slice(Math.max(0, matchStart - 32), matchStart).includes('definition="');

            if (matchStart > lastIndex) parts.push(line.slice(lastIndex, matchStart));
            if (isClickableInVisuals) {
              parts.push(
                <button
                  key={`ref-${lineIndex}-${matchStart}`}
                  className="text-blue-300 underline hover:text-blue-200"
                  onClick={() => openVariantMeshTab(pathValue, "new")}
                  onContextMenu={(event) => openAssetEditorContextMenu(event, pathValue, preferredPackPath)}
                  title="Open referenced variantmeshdefinition in a new tab (right-click for AssetEditor)"
                  type="button"
                >
                  {pathValue}
                </button>,
              );
            } else {
              parts.push(
                <span
                  key={`path-${lineIndex}-${matchStart}`}
                  className="text-sky-200 underline decoration-dotted cursor-context-menu"
                  onContextMenu={(event) => openAssetEditorContextMenu(event, pathValue, preferredPackPath)}
                  title="Right-click to open in AssetEditor"
                >
                  {pathValue}
                </span>,
              );
            }

            lastIndex = pathEnd;
          }

          if (lastIndex < line.length) parts.push(line.slice(lastIndex));
          if (lineIndex < lines.length - 1) parts.push("\n");

          return <React.Fragment key={`line-${lineIndex}`}>{parts}</React.Fragment>;
        })}
      </pre>
    );
  };

  if (!isFeaturesForModdersEnabled) {
    return <div className="text-gray-300 p-4">Visuals tab is available only when Modders features are enabled.</div>;
  }

  return (
    <div className="text-white max-w-[140rem] mx-auto pr-4">
      <div className="flex items-center gap-4 mb-2 text-sm bg-gray-800/60 border border-gray-700 rounded px-3 py-2">
        <div className="flex items-center gap-2">
          <label htmlFor="visuals-unit-filter" className="text-gray-300">
            Unit filter
          </label>
          <input
            id="visuals-unit-filter"
            type="text"
            value={unitFilterInput}
            onChange={(e) => setUnitFilterInput(e.target.value)}
            placeholder="Search unit key / name / faction"
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white min-w-[20rem]"
          />
        </div>
        <label className="flex items-center gap-2 text-gray-300">
          <input type="checkbox" checked={isFilePanelOpen} onChange={() => setIsFilePanelOpen((prev) => !prev)} />
          Show all model files
        </label>
        <label className="flex items-center gap-2 text-gray-300">
          <input
            type="checkbox"
            checked={isGroupedByOrigin}
            onChange={() => setIsGroupedByOrigin((prev) => !prev)}
          />
          Group by source
        </label>
        <span className="text-gray-400">
          {isLoadingUnits ? "Loading..." : `${filteredUnits.length}/${units.length} units`}
        </span>
      </div>

      {unitsError && <div className="mb-2 rounded bg-red-900/60 border border-red-700 px-3 py-2">{unitsError}</div>}
      {viewerMessage && (
        <div className="mb-2 rounded bg-amber-900/40 border border-amber-700 px-3 py-2 text-amber-200">
          {viewerMessage}
        </div>
      )}

      <div style={{ width: "100%", display: "flex", minHeight: "82vh" }}>
        {isLeftOpen && (
          <Resizable defaultSize={{ width: "26%", height: "82vh" }} minWidth="220px" maxWidth="50%">
            <div className="h-[82vh] border border-gray-700 bg-gray-800 rounded overflow-auto">
              {isLoadingUnits && units.length === 0 ? (
                <div className="p-3 text-gray-300">Loading unit list...</div>
              ) : (
                (!isGroupedByOrigin || !groupedUnits
                  ? filteredUnits.map((unit) => {
                      const rowKey = `${unit.unitKey}|${unit.faction}`;
                      const hasPath = !!unit.variantMeshPath;
                      return (
                        <div
                          key={rowKey}
                          className={`px-3 py-2 border-b border-gray-700 cursor-pointer hover:bg-gray-700 ${
                            !hasPath ? "opacity-70" : ""
                          }`}
                          onClick={(e) => {
                            e.preventDefault();
                            if (unitClickTimer.current) clearTimeout(unitClickTimer.current);
                            unitClickTimer.current = setTimeout(() => {
                              unitClickTimer.current = null;
                              onUnitSingleClick(unit);
                            }, 220);
                          }}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            if (unitClickTimer.current) {
                              clearTimeout(unitClickTimer.current);
                              unitClickTimer.current = null;
                            }
                            onUnitDoubleClick(unit);
                          }}
                          onContextMenu={(event) => openAssetEditorContextMenu(event, unit.variantMeshPath)}
                          title={unit.variantMeshPath || "No variantmeshdefinition resolved"}
                        >
                          <div className="text-sm">{unit.localizedName}</div>
                          <div className="text-xs text-gray-400 break-all">
                            {unit.unitKey}
                            {unit.faction ? ` | faction: ${unit.faction}` : ""}
                          </div>
                          {unit.variantName && (
                            <div className="text-xs text-gray-500 break-all">variant: {unit.variantName}</div>
                          )}
                          {!unit.variantMeshPath && (
                            <div className="text-xs text-red-300">No resolved variantmeshdefinition</div>
                          )}
                        </div>
                      );
                    })
                  : groupedUnits.flatMap((group) => {
                      const isCollapsed = !!collapsedOriginGroups[group.label];
                      const headerKey = `header:${group.label}`;
                      const header = (
                        <button
                          key={headerKey}
                          type="button"
                          className="w-full text-left px-3 py-2 border-b border-gray-700 bg-gray-850 text-xs uppercase tracking-wide text-gray-300 hover:bg-gray-700"
                          title={group.label}
                          onClick={() => toggleOriginGroupCollapsed(group.label)}
                        >
                          <FontAwesomeIcon
                            icon={faChevronRight}
                            className={`mr-2 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                          />
                          {group.label} ({group.units.length})
                        </button>
                      );

                      const rows = isCollapsed ? [] : group.units.map((unit) => {
                        const rowKey = `${group.label}|${unit.unitKey}|${unit.faction}`;
                        const hasPath = !!unit.variantMeshPath;
                        return (
                          <div
                            key={rowKey}
                            className={`px-3 py-2 border-b border-gray-700 cursor-pointer hover:bg-gray-700 ${
                              !hasPath ? "opacity-70" : ""
                            }`}
                            onClick={(e) => {
                              e.preventDefault();
                              if (unitClickTimer.current) clearTimeout(unitClickTimer.current);
                              unitClickTimer.current = setTimeout(() => {
                                unitClickTimer.current = null;
                                onUnitSingleClick(unit);
                              }, 220);
                            }}
                            onDoubleClick={(e) => {
                              e.preventDefault();
                              if (unitClickTimer.current) {
                                clearTimeout(unitClickTimer.current);
                                unitClickTimer.current = null;
                              }
                              onUnitDoubleClick(unit);
                            }}
                            onContextMenu={(event) => openAssetEditorContextMenu(event, unit.variantMeshPath)}
                            title={unit.variantMeshPath || "No variantmeshdefinition resolved"}
                          >
                            <div className="text-sm">{unit.localizedName}</div>
                            <div className="text-xs text-gray-400 break-all">
                              {unit.unitKey}
                              {unit.faction ? ` | faction: ${unit.faction}` : ""}
                            </div>
                            {unit.variantName && (
                              <div className="text-xs text-gray-500 break-all">variant: {unit.variantName}</div>
                            )}
                            {!unit.variantMeshPath && (
                              <div className="text-xs text-red-300">No resolved variantmeshdefinition</div>
                            )}
                          </div>
                        );
                      });

                      return [header, ...rows];
                    })
              ))}
            </div>
          </Resizable>
        )}

        <div style={{ flex: 1, minWidth: "1px", display: "flex", flexDirection: "column" }} className="ml-3">
          <div className="flex bg-gray-800 border border-gray-700 rounded-t overflow-x-auto min-h-[36px]">
            {tabs.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">Open a unit to view its variantmeshdefinition</div>
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`flex items-center px-3 py-1 cursor-pointer border-r border-gray-700 text-sm whitespace-nowrap ${
                    tab.id === activeTabId ? "bg-gray-700 text-white border-b-2 border-blue-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                  title={tab.filePath}
                >
                  <span className="mr-2 max-w-[260px] overflow-hidden text-ellipsis">{tab.label}</span>
                  {tabs.length > 1 && (
                    <button
                      type="button"
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
              ))
            )}
          </div>

          <div className="flex-1 border border-t-0 border-gray-700 rounded-b bg-gray-900 overflow-auto h-[82vh]">
            {!activeTab && (
              <div className="p-4 text-gray-400">
                Single-click opens in the current tab. Double-click opens in a new tab.
              </div>
            )}
            {activeTab && (
              <>
                <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-400 break-all">
                  <div>{activeTab.filePath}</div>
                  {activeTab.resolvedPackPath && <div>pack: {activeTab.resolvedPackPath}</div>}
                </div>
                {activeTab.status === "loading" && <div className="p-4 text-gray-300">Loading file...</div>}
                {activeTab.status === "error" && (
                  <div className="p-4 text-red-300">{activeTab.error || "Failed to load file"}</div>
                )}
                {activeTab.status === "ready" &&
                  activeTab.text != null &&
                  renderVariantMeshText(activeTab.text, activeTab.resolvedPackPath)}
              </>
            )}
          </div>
        </div>

        {isFilePanelOpen && (
          <Resizable defaultSize={{ width: "25%", height: "82vh" }} minWidth="220px" maxWidth="45%" className="ml-3">
            <div className="h-[82vh] border border-gray-700 bg-gray-800 rounded flex flex-col min-w-0">
              <div className="p-2 border-b border-gray-700">
                <input
                  type="text"
                  value={fileQueryInput}
                  onChange={(e) => setFileQueryInput(e.target.value)}
                  placeholder="Search variantmesh/wsmodel/rigid_model_v2"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                />
                <div className="text-xs text-gray-400 mt-1">
                  {isFileSearchLoading ? "Searching..." : `${fileResults.length}/${fileResultsTotal} results`}
                </div>
                {fileSearchError && <div className="text-xs text-red-300 mt-1">{fileSearchError}</div>}
              </div>

              <div className="flex-1 overflow-auto">
                {fileResults.map((file) => {
                  const isOpenableInVisuals = file.ext === "variantmeshdefinition";
                  return (
                    <div
                      key={file.path}
                      className={`px-3 py-2 border-b border-gray-700 ${
                        isOpenableInVisuals ? "cursor-pointer hover:bg-gray-700" : "cursor-default opacity-80"
                      }`}
                      onClick={(e) => {
                        if (!isOpenableInVisuals) return;
                        e.preventDefault();
                        if (fileClickTimer.current) clearTimeout(fileClickTimer.current);
                        fileClickTimer.current = setTimeout(() => {
                          fileClickTimer.current = null;
                          onFileSingleClick(file);
                        }, 220);
                      }}
                      onDoubleClick={(e) => {
                        if (!isOpenableInVisuals) return;
                        e.preventDefault();
                        if (fileClickTimer.current) {
                          clearTimeout(fileClickTimer.current);
                          fileClickTimer.current = null;
                        }
                        onFileDoubleClick(file);
                      }}
                      onContextMenu={(event) => openAssetEditorContextMenu(event, file.path)}
                      title={
                        isOpenableInVisuals
                          ? "Click to open, double-click for new tab, right-click for AssetEditor"
                          : "Right-click to open in AssetEditor"
                      }
                    >
                      <div className={`text-xs uppercase ${
                        file.ext === "variantmeshdefinition" ? "text-green-400" :
                        file.ext === "wsmodel" ? "text-sky-400" :
                        file.ext === "rigid_model_v2" ? "text-violet-400" :
                        "text-gray-400"
                      }`}>{file.ext}</div>
                      <div className="text-sm break-all">{file.path}</div>
                    </div>
                  );
                })}
              </div>

              {fileResults.length < fileResultsTotal && (
                <button
                  type="button"
                  className="m-2 px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm disabled:opacity-60"
                  disabled={isFileSearchLoading}
                  onClick={() => loadFileResultsPage(fileResults.length, true)}
                >
                  {isFileSearchLoading ? "Loading..." : "Load more"}
                </button>
              )}
            </div>
          </Resizable>
        )}
      </div>

      {assetEditorContextMenu && (
        <div
          className="fixed bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[240px]"
          style={{ top: assetEditorContextMenu.y, left: assetEditorContextMenu.x }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm"
            onClick={() => {
              void onAssetEditorContextAction("new");
            }}
          >
            Open In New AssetEd Tab
          </button>
          <button
            type="button"
            className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm"
            onClick={() => {
              void onAssetEditorContextAction("existing");
            }}
          >
            Open In Existing AssetEd Tab
          </button>
        </div>
      )}
    </div>
  );
});

export default VisualsTab;
