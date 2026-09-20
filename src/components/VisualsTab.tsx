import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toggleIsVisualsHideDuplicatesEnabled, toggleIsVisualsSortByCultureEnabled } from "../appSlice";
import { useAppDispatch, useAppSelector } from "../hooks";
import { useLocalizations } from "../localizationContext";
import { compileVisualsUnitFilter } from "../visuals/unitFilter";
import { useDeferredWhileInactive } from "./useDeferredWhileInactive";
import { Resizable } from "re-resizable";
import { AutoSizer, CellMeasurer, CellMeasurerCache, List, type ListRowProps } from "react-virtualized";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import VisualsModelPreview from "./VisualsModelPreview";

type VisualsUnitEntry = {
  unitKey: string;
  faction: string;
  localizedName: string;
  variantName?: string;
  variantMeshPath?: string;
  originPackPath: string;
  originLabel: string;
  cultureKey?: string;
  cultureName?: string;
  cultures?: Array<{ key: string; name: string }>;
  caste?: string;
};

type VisualsCultureGroup = {
  key: string;
  label: string;
  castes: Array<{
    key: string;
    label: string;
    units: VisualsUnitEntry[];
  }>;
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

type VisualsViewerMode = "preview" | "source";

type VisualsFileResult = {
  path: string;
  ext: "variantmeshdefinition" | "wsmodel" | "rigid_model_v2" | "xml.material";
};

type VisualsListRow =
  | { kind: "unit"; key: string; unit: VisualsUnitEntry }
  | { kind: "culture"; key: string; cultureKey: string; label: string; count: number; isCollapsed: boolean }
  | {
      kind: "caste";
      key: string;
      cultureKey: string;
      casteKey: string;
      label: string;
      count: number;
      isCollapsed: boolean;
    }
  | { kind: "origin"; key: string; label: string; count: number; isCollapsed: boolean };

type VisualsAssetEditorContextMenu = {
  x: number;
  y: number;
  targetPath: string;
  preferredPackPath?: string;
};

const ALL_VISUALS_PACKS_VALUE = "all";
const VANILLA_VISUALS_PACK_VALUE = "vanilla";
const UNASSIGNED_CULTURE_KEY = "__unassigned";
const UNKNOWN_CASTE_KEY = "__unknown";
const VISUALS_FILE_PAGE_SIZE = 1000;

type VisualsPackOption = {
  value: string;
  label: string;
};

let nextVisualsTabId = 1;
let nextVisualsRequestId = 1;

const collator = new Intl.Collator("en");
const viewerModelPathRegex = /([A-Za-z0-9_.\-\\/]+?\.(?:variantmeshdefinition|wsmodel|rigid_model_v2|xml\.material))/gi;

const getBaseName = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

const getTabLabel = (path: string) => {
  const base = getBaseName(path);
  return base.length > 48 ? `${base.slice(0, 45)}...` : base;
};

const getCasteSortOrder = (caste: string) => {
  const normalized = caste.toLowerCase();
  if (normalized === "lord") return 0;
  if (normalized === "hero") return 1;
  return 2;
};

const getVariantFileKey = (path: string) => path.replace(/\//g, "\\").replace(/\\+/g, "\\").trim().toLowerCase();

const getVisualsFileKey = (path: string) => {
  const normalizedPath = getVariantFileKey(path);
  if (!normalizedPath.endsWith(".variantmeshdefinition")) return normalizedPath;
  return `variantmeshes\\variantmeshdefinitions\\${getBaseName(normalizedPath)}`;
};

const isOpenableVisualsFile = (file: VisualsFileResult) =>
  file.ext === "variantmeshdefinition" || file.ext === "wsmodel" || file.ext === "xml.material";

const isXmlMaterialPath = (path: string) => path.toLowerCase().endsWith(".xml.material");

const isAssetEditorOpenablePath = (path: string) => !isXmlMaterialPath(path);

const formatCasteLabel = (caste: string) =>
  caste.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Unknown caste";

export type VisualsTabProps = {
  /** False while the tab is mounted but hidden, so data refreshes and measurements wait for visibility. */
  isActive?: boolean;
};

const VisualsTab = memo(({ isActive = true }: VisualsTabProps) => {
  const dispatch = useAppDispatch();
  const localized = useLocalizations();
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const isSortByCultureEnabled = useAppSelector((state) => state.app.isVisualsSortByCultureEnabled);
  const isHideDuplicatesEnabled = useAppSelector((state) => state.app.isVisualsHideDuplicatesEnabled);
  const currentPresetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const enabledMods = useMemo(() => currentPresetMods.filter((mod) => mod.isEnabled), [currentPresetMods]);

  const [isLeftOpen] = useState(true);
  const [units, setUnits] = useState<VisualsUnitEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoadingUnits, setIsLoadingUnits] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [unitFilterInput, setUnitFilterInput] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [packFilter, setPackFilter] = useState(ALL_VISUALS_PACKS_VALUE);
  const [isGroupedByOrigin, setIsGroupedByOrigin] = useState(false);
  const [collapsedOriginGroups, setCollapsedOriginGroups] = useState<Record<string, boolean>>({});
  const [collapsedCultureGroups, setCollapsedCultureGroups] = useState<Record<string, boolean>>({});
  const [collapsedCasteGroups, setCollapsedCasteGroups] = useState<Record<string, boolean>>({});
  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);
  const [viewerMessage, setViewerMessage] = useState<string | null>(null);

  const [tabs, setTabs] = useState<VisualsViewerTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [viewerMode, setViewerMode] = useState<VisualsViewerMode>("preview");

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
  const optionsMenuRef = useRef<HTMLDivElement>(null);
  const unitListRef = useRef<List | null>(null);
  const fileListRef = useRef<List | null>(null);
  const unitListWidthRef = useRef(0);
  const fileListWidthRef = useRef(0);
  const unitListCache = useMemo(
    () => new CellMeasurerCache({ fixedWidth: true, defaultHeight: 56, minHeight: 28 }),
    [],
  );
  const fileListCache = useMemo(
    () => new CellMeasurerCache({ fixedWidth: true, defaultHeight: 48, minHeight: 28 }),
    [],
  );

  useEffect(() => {
    if (!isOptionsMenuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (optionsMenuRef.current?.contains(event.target as Node)) return;
      setIsOptionsMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOptionsMenuOpen]);

  const enabledModsKey = useMemo(
    () =>
      enabledMods
        .map((mod) => `${mod.path}|${mod.loadOrder ?? ""}|${mod.name}`)
        .sort()
        .join("||"),
    [enabledMods],
  );
  const enabledModsKeyToRequest = useDeferredWhileInactive(isActive, enabledModsKey);
  const enabledModsRef = useRef(enabledMods);
  enabledModsRef.current = enabledMods;

  useEffect(() => {
    const timer = setTimeout(() => {
      setUnitFilter(unitFilterInput.trim());
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
    if (!isFeaturesForModdersEnabled || !isActive) return;

    let isCancelled = false;

    const run = async () => {
      setIsLoadingUnits(true);
      setUnitsError(null);
      setViewerMessage(null);
      try {
        const result = await window.api?.getVisualsUnitsData(enabledModsRef.current);
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
  }, [enabledModsKeyToRequest, isActive, isFeaturesForModdersEnabled]);

  const compiledUnitFilter = useMemo(() => compileVisualsUnitFilter(unitFilter), [unitFilter]);

  const packOptions = useMemo<VisualsPackOption[]>(() => {
    const optionsByPath = new Map<string, VisualsPackOption>();
    for (const unit of units) {
      if (unit.originLabel.toLowerCase() === "vanilla" || !unit.originPackPath) continue;
      if (!optionsByPath.has(unit.originPackPath)) {
        optionsByPath.set(unit.originPackPath, {
          value: unit.originPackPath,
          label: unit.originLabel || getBaseName(unit.originPackPath),
        });
      }
    }

    return Array.from(optionsByPath.values()).sort((first, second) => collator.compare(first.label, second.label));
  }, [units]);

  useEffect(() => {
    if (packFilter === ALL_VISUALS_PACKS_VALUE || packFilter === VANILLA_VISUALS_PACK_VALUE) return;
    if (!packOptions.some((option) => option.value === packFilter)) {
      setPackFilter(ALL_VISUALS_PACKS_VALUE);
    }
  }, [packFilter, packOptions]);

  const packFilteredUnits = useMemo(() => {
    if (packFilter === ALL_VISUALS_PACKS_VALUE) return units;
    if (packFilter === VANILLA_VISUALS_PACK_VALUE) {
      return units.filter((entry) => entry.originLabel.toLowerCase() === "vanilla");
    }
    return units.filter((entry) => entry.originPackPath === packFilter);
  }, [packFilter, units]);

  const filteredUnits = useMemo(() => {
    if (!compiledUnitFilter.regex) return packFilteredUnits;
    return packFilteredUnits.filter((entry) => {
      const haystack = `${entry.localizedName} ${entry.unitKey} ${entry.faction} ${entry.variantName || ""}`;
      return compiledUnitFilter.regex!.test(haystack);
    });
  }, [compiledUnitFilter.regex, packFilteredUnits]);

  const hasActiveVisualsFilter = unitFilter.length > 0 || packFilter !== ALL_VISUALS_PACKS_VALUE;

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

  const cultureGroupedUnits = useMemo<VisualsCultureGroup[]>(() => {
    const groups = new Map<string, { label: string; units: VisualsUnitEntry[] }>();
    for (const unit of filteredUnits) {
      const cultures = unit.cultures?.length
        ? unit.cultures
        : [
            {
              key: unit.cultureKey || UNASSIGNED_CULTURE_KEY,
              name:
                unit.cultureName || (unit.cultureKey === UNASSIGNED_CULTURE_KEY ? "Unassigned" : unit.cultureKey || ""),
            },
          ];
      for (const culture of cultures) {
        const key = culture.key || UNASSIGNED_CULTURE_KEY;
        const label = culture.name || (key === UNASSIGNED_CULTURE_KEY ? "Unassigned" : key);
        const group = groups.get(key);
        if (group) {
          if (!group.units.includes(unit)) group.units.push(unit);
        } else groups.set(key, { label, units: [unit] });
      }
    }

    return Array.from(groups.entries())
      .sort(([firstKey, first], [secondKey, second]) => {
        if (firstKey === UNASSIGNED_CULTURE_KEY && secondKey !== UNASSIGNED_CULTURE_KEY) return 1;
        if (secondKey === UNASSIGNED_CULTURE_KEY && firstKey !== UNASSIGNED_CULTURE_KEY) return -1;
        return collator.compare(first.label, second.label) || collator.compare(firstKey, secondKey);
      })
      .map(([key, group]) => {
        const casteGroups = new Map<string, { label: string; units: VisualsUnitEntry[] }>();
        for (const unit of group.units) {
          const caste = unit.caste?.trim() || "";
          const casteKey = caste || UNKNOWN_CASTE_KEY;
          const casteLabel = caste ? formatCasteLabel(caste) : "Unknown caste";
          const casteGroup = casteGroups.get(casteKey);
          if (casteGroup) casteGroup.units.push(unit);
          else casteGroups.set(casteKey, { label: casteLabel, units: [unit] });
        }

        return {
          key,
          label: group.label,
          castes: Array.from(casteGroups.entries())
            .sort(([firstKey, first], [secondKey, second]) => {
              const casteOrder = getCasteSortOrder(firstKey) - getCasteSortOrder(secondKey);
              return casteOrder || collator.compare(first.label, second.label) || collator.compare(firstKey, secondKey);
            })
            .map(([casteKey, caste]) => ({
              key: casteKey,
              label: caste.label,
              units: (() => {
                const sortedUnits = [...caste.units].sort(unitComparator);
                if (!isHideDuplicatesEnabled || !["lord", "hero"].includes(casteKey.toLowerCase())) {
                  return sortedUnits;
                }

                const seenVariantFiles = new Set<string>();
                return sortedUnits.filter((unit) => {
                  if (!unit.variantMeshPath) return true;
                  const variantFileKey = getVariantFileKey(unit.variantMeshPath);
                  if (!variantFileKey || seenVariantFiles.has(variantFileKey)) return false;
                  seenVariantFiles.add(variantFileKey);
                  return true;
                });
              })(),
            })),
        };
      });
  }, [filteredUnits, isHideDuplicatesEnabled, unitComparator]);

  const visualsListRows = useMemo<VisualsListRow[]>(() => {
    if (isSortByCultureEnabled) {
      const rows: VisualsListRow[] = [];
      for (const culture of cultureGroupedUnits) {
        const cultureUnitCount = culture.castes.reduce((count, caste) => count + caste.units.length, 0);
        const isCultureCollapsed = !hasActiveVisualsFilter && (collapsedCultureGroups[culture.key] ?? true);
        rows.push({
          kind: "culture",
          key: `culture:${culture.key}`,
          cultureKey: culture.key,
          label: culture.label,
          count: cultureUnitCount,
          isCollapsed: isCultureCollapsed,
        });
        if (isCultureCollapsed) continue;

        for (const caste of culture.castes) {
          const isCasteCollapsed =
            !hasActiveVisualsFilter && (collapsedCasteGroups[`${culture.key}|${caste.key}`] ?? true);
          rows.push({
            kind: "caste",
            key: `culture:${culture.key}|caste:${caste.key}`,
            cultureKey: culture.key,
            casteKey: caste.key,
            label: caste.label,
            count: caste.units.length,
            isCollapsed: isCasteCollapsed,
          });
          if (isCasteCollapsed) continue;

          rows.push(
            ...caste.units.map((unit) => ({
              kind: "unit" as const,
              key: `culture:${culture.key}|caste:${caste.key}|${unit.unitKey}|${unit.faction}`,
              unit,
            })),
          );
        }
      }
      return rows;
    }

    if (!isGroupedByOrigin || !groupedUnits) {
      return filteredUnits.map((unit) => ({
        kind: "unit",
        key: `unit:${unit.unitKey}|${unit.faction}|${unit.variantName || ""}`,
        unit,
      }));
    }

    return groupedUnits.flatMap((group) => {
      const isCollapsed = hasActiveVisualsFilter ? false : !!collapsedOriginGroups[group.label];
      return [
        {
          kind: "origin" as const,
          key: `origin:${group.label}`,
          label: group.label,
          count: group.units.length,
          isCollapsed,
        },
        ...(isCollapsed
          ? []
          : group.units.map((unit) => ({
              kind: "unit" as const,
              key: `origin:${group.label}|${unit.unitKey}|${unit.faction}|${unit.variantName || ""}`,
              unit,
            }))),
      ];
    });
  }, [
    collapsedCasteGroups,
    collapsedCultureGroups,
    collapsedOriginGroups,
    cultureGroupedUnits,
    filteredUnits,
    groupedUnits,
    hasActiveVisualsFilter,
    isGroupedByOrigin,
    isSortByCultureEnabled,
  ]);

  useEffect(() => {
    unitListCache.clearAll();
    unitListRef.current?.recomputeRowHeights();
  }, [unitListCache, visualsListRows]);

  useEffect(() => {
    fileListCache.clearAll();
    fileListRef.current?.recomputeRowHeights();
  }, [fileListCache, fileResults]);

  useLayoutEffect(() => {
    if (!isActive) return;

    const refreshVisibleLists = () => {
      unitListWidthRef.current = 0;
      fileListWidthRef.current = 0;
      unitListCache.clearAll();
      fileListCache.clearAll();
      unitListRef.current?.recomputeRowHeights();
      fileListRef.current?.recomputeRowHeights();
    };

    refreshVisibleLists();
    if (typeof window.requestAnimationFrame !== "function") return;
    const frameId = window.requestAnimationFrame(refreshVisibleLists);
    return () => window.cancelAnimationFrame(frameId);
  }, [fileListCache, isActive, unitListCache]);

  const toggleOriginGroupCollapsed = (label: string) => {
    setCollapsedOriginGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const toggleCultureGroupCollapsed = (cultureKey: string) => {
    setCollapsedCultureGroups((prev) => ({ ...prev, [cultureKey]: !(prev[cultureKey] ?? true) }));
  };

  const toggleCasteGroupCollapsed = (cultureKey: string, casteKey: string) => {
    const groupKey = `${cultureKey}|${casteKey}`;
    setCollapsedCasteGroups((prev) => ({ ...prev, [groupKey]: !(prev[groupKey] ?? true) }));
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const isActiveTabSourceOnly = !!activeTab && isXmlMaterialPath(activeTab.filePath);

  const openVisualsFileTab = async (filePath: string, mode: "current" | "new") => {
    if (!filePath) {
      setViewerMessage("No visual file path is available for this entry.");
      return;
    }
    if (isXmlMaterialPath(filePath)) setViewerMode("source");

    const fileKey = getVisualsFileKey(filePath);
    const existingTab = tabs.find((tab) =>
      [tab.filePath, tab.resolvedFileName]
        .filter(Boolean)
        .some((tabFilePath) => getVisualsFileKey(tabFilePath!) === fileKey),
    );
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setViewerMessage(null);
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
            error: result?.error || "Failed to read visual file",
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
    const result = await window.api?.searchVisualsFiles(sessionId, fileQuery, nextOffset, VISUALS_FILE_PAGE_SIZE);
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
    openVisualsFileTab(unit.variantMeshPath, "current");
  };

  const onUnitDoubleClick = (unit: VisualsUnitEntry) => {
    if (!unit.variantMeshPath) {
      setViewerMessage(
        `No variantmeshdefinition resolved for ${unit.localizedName}${unit.faction ? ` (${unit.faction})` : ""}.`,
      );
      return;
    }
    openVisualsFileTab(unit.variantMeshPath, "new");
  };

  const onFileSingleClick = (file: VisualsFileResult) => {
    if (!isOpenableVisualsFile(file)) return;
    openVisualsFileTab(file.path, "current");
  };

  const onFileDoubleClick = (file: VisualsFileResult) => {
    if (!isOpenableVisualsFile(file)) return;
    openVisualsFileTab(file.path, "new");
  };

  const renderFileListRow = ({ index, key, parent, style }: ListRowProps) => {
    const file = fileResults[index];
    if (!file) return null;

    const isOpenableInVisuals = isOpenableVisualsFile(file);
    const canOpenInAssetEditor = isAssetEditorOpenablePath(file.path);
    return (
      <CellMeasurer cache={fileListCache} columnIndex={0} index={index} key={key} parent={parent}>
        {({ registerChild }) => (
          <div
            ref={registerChild}
            style={{ ...style, width: "100%" }}
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
                ? `Click to open, double-click for new tab, right-click for ${canOpenInAssetEditor ? "AssetEditor" : "copy options"}`
                : canOpenInAssetEditor
                  ? "Right-click to open in AssetEditor"
                  : "Right-click for copy options"
            }
          >
            <div
              className={`text-xs uppercase ${
                file.ext === "variantmeshdefinition"
                  ? "text-green-400"
                  : file.ext === "wsmodel"
                    ? "text-sky-400"
                    : file.ext === "rigid_model_v2"
                      ? "text-violet-400"
                      : "text-gray-400"
              }`}
            >
              {file.ext}
            </div>
            <div className="text-sm break-all">{file.path}</div>
          </div>
        )}
      </CellMeasurer>
    );
  };

  const openAssetEditorContextMenu = (event: React.MouseEvent, targetPath?: string, preferredPackPath?: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!targetPath) {
      setViewerMessage("No resolved file path is available for AssetEditor.");
      return;
    }
    setAssetEditorContextMenu({ x: event.clientX, y: event.clientY, targetPath, preferredPackPath });
  };

  const sendToAssetEditor = async (targetPath: string, mode: "new" | "existing", preferredPackPath?: string) => {
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
    setViewerMessage(`Sent to AssetEditor (${mode === "existing" ? "existing" : "new"} tab): ${resolvedFile}`);
  };

  const onAssetEditorContextAction = async (mode: "new" | "existing") => {
    if (!assetEditorContextMenu) return;
    const { targetPath, preferredPackPath } = assetEditorContextMenu;
    setAssetEditorContextMenu(null);
    await sendToAssetEditor(targetPath, mode, preferredPackPath);
  };

  const onCopyAssetPathContextAction = (copyName: boolean) => {
    if (!assetEditorContextMenu) return;
    const { targetPath } = assetEditorContextMenu;
    setAssetEditorContextMenu(null);
    window.api?.putPathInClipboard(copyName ? getBaseName(targetPath) : targetPath);
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
            return (
              <React.Fragment key={`line-${lineIndex}`}>
                {line + (lineIndex < lines.length - 1 ? "\n" : "")}
              </React.Fragment>
            );
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
            const isWsmodel = pathExt.endsWith(".wsmodel");
            const isXmlMaterial = pathExt.endsWith(".xml.material");
            const pathPrefix = line.slice(Math.max(0, matchStart - 32), matchStart);
            const isClickableInVisuals =
              isXmlMaterial ||
              (isVariantMeshDefinition &&
                line.includes("VARIANT_MESH_REFERENCE") &&
                pathPrefix.includes('definition="')) ||
              (isWsmodel && pathPrefix.includes('model="'));

            if (matchStart > lastIndex) parts.push(line.slice(lastIndex, matchStart));
            if (isClickableInVisuals) {
              parts.push(
                <button
                  key={`ref-${lineIndex}-${matchStart}`}
                  className="text-blue-300 underline hover:text-blue-200"
                  onClick={() => openVisualsFileTab(pathValue, "new")}
                  onContextMenu={(event) => openAssetEditorContextMenu(event, pathValue, preferredPackPath)}
                  title={`Open referenced ${isXmlMaterial ? "xml.material" : isVariantMeshDefinition ? "variantmeshdefinition" : "wsmodel"} in a new tab (${isAssetEditorOpenablePath(pathValue) ? "right-click for AssetEditor" : "right-click for copy options"})`}
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

  const renderUnitRow = (unit: VisualsUnitEntry) => {
    const hasPath = !!unit.variantMeshPath;
    return (
      <div
        className={`px-3 py-2 border-b border-gray-700 cursor-pointer hover:bg-gray-700 ${
          !hasPath ? "opacity-70" : ""
        }`}
        onClick={(event) => {
          event.preventDefault();
          if (unitClickTimer.current) clearTimeout(unitClickTimer.current);
          unitClickTimer.current = setTimeout(() => {
            unitClickTimer.current = null;
            onUnitSingleClick(unit);
          }, 220);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
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
        {unit.variantName && <div className="text-xs text-gray-500 break-all">variant: {unit.variantName}</div>}
        {!unit.variantMeshPath && <div className="text-xs text-red-300">No resolved variantmeshdefinition</div>}
      </div>
    );
  };

  const renderUnitListRow = ({ index, key, parent, style }: ListRowProps) => {
    const row = visualsListRows[index];
    if (!row) return null;

    const measuredStyle = { ...style, width: "100%" };
    return (
      <CellMeasurer cache={unitListCache} columnIndex={0} index={index} key={key} parent={parent}>
        {({ registerChild }) => (
          <div ref={registerChild} style={measuredStyle}>
            {row.kind === "unit" && renderUnitRow(row.unit)}
            {row.kind === "culture" && (
              <button
                type="button"
                aria-expanded={!row.isCollapsed}
                className="flex h-full w-full items-center border-b border-gray-700 bg-gray-850 px-3 py-2 text-left text-xs uppercase tracking-wide text-gray-300 hover:bg-gray-700"
                onClick={() => toggleCultureGroupCollapsed(row.cultureKey)}
              >
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`mr-2 transition-transform duration-150 ${row.isCollapsed ? "" : "rotate-90"}`}
                />
                {row.label} ({row.count})
              </button>
            )}
            {row.kind === "caste" && (
              <button
                type="button"
                aria-expanded={!row.isCollapsed}
                className="flex h-full w-full items-center border-b border-gray-700 bg-gray-900/60 px-5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-400 hover:bg-gray-700"
                onClick={() => toggleCasteGroupCollapsed(row.cultureKey, row.casteKey)}
              >
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`mr-2 transition-transform duration-150 ${row.isCollapsed ? "" : "rotate-90"}`}
                />
                {row.label} ({row.count})
              </button>
            )}
            {row.kind === "origin" && (
              <button
                type="button"
                className="h-full w-full border-b border-gray-700 bg-gray-850 px-3 py-2 text-left text-xs uppercase tracking-wide text-gray-300 hover:bg-gray-700"
                title={row.label}
                onClick={() => toggleOriginGroupCollapsed(row.label)}
              >
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`mr-2 transition-transform duration-150 ${row.isCollapsed ? "" : "rotate-90"}`}
                />
                {row.label} ({row.count})
              </button>
            )}
          </div>
        )}
      </CellMeasurer>
    );
  };

  if (!isFeaturesForModdersEnabled) {
    return <div className="text-gray-300 p-4">Visuals tab is available only when Modders features are enabled.</div>;
  }

  return (
    <div className="flex explicit-height-without-topbar-and-padding min-h-0 flex-col text-white max-w-[140rem] mx-auto pr-4">
      <div className="flex items-center gap-4 mb-2 text-sm bg-gray-800/60 border border-gray-700 rounded px-3 py-2">
        <div className="flex items-center gap-2">
          <label htmlFor="visuals-unit-filter" className="text-gray-300">
            Unit filter (regex)
          </label>
          <input
            id="visuals-unit-filter"
            type="text"
            value={unitFilterInput}
            onChange={(e) => setUnitFilterInput(e.target.value)}
            placeholder="Regex for unit name / key / variant"
            aria-invalid={!!compiledUnitFilter.error}
            title={compiledUnitFilter.error || "Case-insensitive regular expression"}
            className={`bg-gray-700 border rounded px-2 py-1 text-white min-w-[20rem] ${compiledUnitFilter.error ? "border-red-500" : "border-gray-600"}`}
          />
          {compiledUnitFilter.error && (
            <span className="max-w-64 truncate text-xs text-red-300" title={compiledUnitFilter.error}>
              Invalid regex
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="visuals-pack-filter" className="text-gray-300">
            Pack
          </label>
          <select
            id="visuals-pack-filter"
            value={packFilter}
            onChange={(event) => setPackFilter(event.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white min-w-[12rem]"
          >
            <option value={ALL_VISUALS_PACKS_VALUE}>All packs</option>
            <option value={VANILLA_VISUALS_PACK_VALUE}>Vanilla</option>
            {packOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-gray-300">
          <input type="checkbox" checked={isFilePanelOpen} onChange={() => setIsFilePanelOpen((prev) => !prev)} />
          Show all visual files
        </label>
        <label className="flex items-center gap-2 text-gray-300">
          <input type="checkbox" checked={isGroupedByOrigin} onChange={() => setIsGroupedByOrigin((prev) => !prev)} />
          Group by source
        </label>
        <div className="relative" ref={optionsMenuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={isOptionsMenuOpen}
            onClick={() => setIsOptionsMenuOpen((currentValue) => !currentValue)}
            className="rounded border border-gray-600 bg-gray-700 px-3 py-1 text-white hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            {localized.options || "Options"}
          </button>
          {isOptionsMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-[250] mt-1 w-48 rounded-lg border border-gray-700 bg-gray-800 p-1 text-left shadow-lg"
            >
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={isSortByCultureEnabled}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-gray-700"
                onClick={() => dispatch(toggleIsVisualsSortByCultureEnabled())}
              >
                <input type="checkbox" readOnly checked={isSortByCultureEnabled} className="pointer-events-none" />
                {localized.visualsSortByCulture || "Sort by culture"}
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={isHideDuplicatesEnabled}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-gray-700"
                onClick={() => dispatch(toggleIsVisualsHideDuplicatesEnabled())}
              >
                <input type="checkbox" readOnly checked={isHideDuplicatesEnabled} className="pointer-events-none" />
                {localized.visualsHideDuplicates || "Hide duplicates"}
              </button>
            </div>
          )}
        </div>
        <span className="text-gray-400">
          {isLoadingUnits ? "Loading..." : `${filteredUnits.length}/${packFilteredUnits.length} units`}
        </span>
      </div>

      {unitsError && <div className="mb-2 rounded bg-red-900/60 border border-red-700 px-3 py-2">{unitsError}</div>}
      {viewerMessage && (
        <div className="mb-2 rounded bg-amber-900/40 border border-amber-700 px-3 py-2 text-amber-200">
          {viewerMessage}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        {isLeftOpen && (
          <Resizable defaultSize={{ width: "26%", height: "100%" }} minWidth="220px" maxWidth="50%">
            <div className="h-full min-h-0 overflow-hidden rounded border border-gray-700 bg-gray-800">
              {isLoadingUnits && units.length === 0 ? (
                <div className="p-3 text-gray-300">Loading unit list...</div>
              ) : (
                <AutoSizer
                  onResize={({ width }) => {
                    if (unitListWidthRef.current === width) return;
                    unitListWidthRef.current = width;
                    unitListCache.clearAll();
                    unitListRef.current?.recomputeRowHeights();
                  }}
                >
                  {({ height, width }) => (
                    <List
                      ref={unitListRef}
                      width={width}
                      height={height}
                      rowCount={visualsListRows.length}
                      rowHeight={unitListCache.rowHeight}
                      rowRenderer={renderUnitListRow}
                      estimatedRowSize={56}
                      overscanRowCount={12}
                      deferredMeasurementCache={unitListCache}
                    />
                  )}
                </AutoSizer>
              )}
            </div>
          </Resizable>
        )}

        <div
          style={{ flex: 1, minWidth: "1px", minHeight: 0, display: "flex", flexDirection: "column" }}
          className="ml-3 min-h-0"
        >
          <div className="flex bg-gray-800 border border-gray-700 rounded-t overflow-x-auto min-h-[36px]">
            {tabs.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">Open a unit or visual file to view it</div>
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`flex items-center px-3 py-1 cursor-pointer border-r border-gray-700 text-sm whitespace-nowrap ${
                    tab.id === activeTabId
                      ? "bg-gray-700 text-white border-b-2 border-blue-400"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                  onClick={() => {
                    setActiveTabId(tab.id);
                    if (isXmlMaterialPath(tab.filePath)) setViewerMode("source");
                  }}
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

          <div className="flex min-h-0 flex-1 flex-col border border-t-0 border-gray-700 rounded-b bg-gray-900 overflow-hidden">
            {!activeTab && (
              <div className="p-4 text-gray-400">
                Single-click opens in the current tab. Double-click opens in a new tab. Links open in a new tab.
              </div>
            )}
            {activeTab && (
              <>
                <div className="shrink-0 px-3 py-2 border-b border-gray-700 text-xs text-gray-400 break-all">
                  <div>{activeTab.filePath}</div>
                  {activeTab.resolvedPackPath && <div>pack: {activeTab.resolvedPackPath}</div>}
                </div>
                <div className="flex shrink-0 border-b border-gray-700 bg-gray-800">
                  <button
                    type="button"
                    aria-pressed={viewerMode === "preview"}
                    className={`border-r border-gray-700 px-3 py-1.5 text-xs font-medium ${
                      viewerMode === "preview"
                        ? "bg-gray-700 text-white border-b-2 border-blue-400"
                        : "text-gray-400 hover:bg-gray-700 hover:text-white"
                    }`}
                    onClick={() => setViewerMode("preview")}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewerMode === "source"}
                    className={`border-r border-gray-700 px-3 py-1.5 text-xs font-medium ${
                      viewerMode === "source"
                        ? "bg-gray-700 text-white border-b-2 border-blue-400"
                        : "text-gray-400 hover:bg-gray-700 hover:text-white"
                    }`}
                    onClick={() => setViewerMode("source")}
                  >
                    Source
                  </button>
                </div>
                <div className="relative min-h-0 flex-1">
                  <div className={`absolute inset-0 ${viewerMode === "preview" ? "" : "hidden"}`}>
                    {isActiveTabSourceOnly ? (
                      <div className="flex h-full items-center justify-center p-4 text-sm text-gray-400">
                        Preview is unavailable for material files. Select Source to inspect the file.
                      </div>
                    ) : (
                      <VisualsModelPreview
                        assetPath={activeTab.filePath}
                        isActive={isActive}
                        variantMeshSessionId={sessionId ?? undefined}
                        variantMeshSessionType="visuals"
                      />
                    )}
                  </div>
                  <div
                    className={`absolute inset-0 overflow-auto bg-gray-900 ${viewerMode === "source" ? "" : "hidden"}`}
                  >
                    {activeTab.status === "loading" && <div className="p-4 text-gray-300">Loading file...</div>}
                    {activeTab.status === "error" && (
                      <div className="p-4 text-red-300">{activeTab.error || "Failed to load file"}</div>
                    )}
                    {activeTab.status === "ready" &&
                      activeTab.text != null &&
                      renderVariantMeshText(activeTab.text, activeTab.resolvedPackPath)}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {isFilePanelOpen && (
          <Resizable defaultSize={{ width: "25%", height: "100%" }} minWidth="220px" maxWidth="45%" className="ml-3">
            <div className="h-full min-h-0 border border-gray-700 bg-gray-800 rounded flex flex-col min-w-0">
              <div className="p-2 border-b border-gray-700">
                <input
                  type="text"
                  value={fileQueryInput}
                  onChange={(e) => setFileQueryInput(e.target.value)}
                  placeholder="Search variantmesh/wsmodel/rigid_model_v2/xml.material"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                />
                <div className="text-xs text-gray-400 mt-1">
                  {isFileSearchLoading ? "Searching..." : `${fileResults.length}/${fileResultsTotal} results`}
                </div>
                {fileSearchError && <div className="text-xs text-red-300 mt-1">{fileSearchError}</div>}
              </div>

              <div className="min-h-0 flex-1">
                {fileResults.length > 0 && (
                  <AutoSizer
                    onResize={({ width }) => {
                      if (fileListWidthRef.current === width) return;
                      fileListWidthRef.current = width;
                      fileListCache.clearAll();
                      fileListRef.current?.recomputeRowHeights();
                    }}
                  >
                    {({ height, width }) => (
                      <List
                        ref={fileListRef}
                        width={width}
                        height={height}
                        rowCount={fileResults.length}
                        rowHeight={fileListCache.rowHeight}
                        rowRenderer={renderFileListRow}
                        estimatedRowSize={48}
                        overscanRowCount={12}
                        deferredMeasurementCache={fileListCache}
                      />
                    )}
                  </AutoSizer>
                )}
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
          {isAssetEditorOpenablePath(assetEditorContextMenu.targetPath) && (
            <>
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
              <div className="my-1 border-t border-gray-700" />
            </>
          )}
          <button
            type="button"
            className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm"
            onClick={() => onCopyAssetPathContextAction(true)}
          >
            Copy Name to Clipboard
          </button>
          <button
            type="button"
            className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm"
            onClick={() => onCopyAssetPathContextAction(false)}
          >
            Copy Full Path to Clipboard
          </button>
        </div>
      )}
    </div>
  );
});

export default VisualsTab;
