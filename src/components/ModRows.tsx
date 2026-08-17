import React, {
  memo,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../index.css";
import { useAppDispatch, useAppSelector } from "../hooks";
import {
  toggleMod,
  enableAll,
  disableAllMods,
  resetModLoadOrder,
  setModRowsSortingType,
  setModLoadOrderRelativeTo,
  resetModLoadOrderAll,
  setModBeingCustomized,
  removeAllPackDataOverwrites,
} from "../appSlice";
import { getFilteredMods, getLoadOrderInsertionIndex, sortByNameAndLoadOrder } from "../modSortingHelpers";
import { FloatingOverlay } from "@floating-ui/react";
import ModDropdown from "./ModDropdown";
import { isModAlwaysEnabled } from "../modsHelpers";
import * as modRowSorting from "../utility/modRowSorting";
import { SortingType } from "../utility/modRowSorting";
import localizationContext from "../localizationContext";
import ModCustomization from "./ModCustomization";
import UserFlowOptionsModal from "./UserFlowOptionsModal";
import { List } from "react-virtualized";
import hash from "object-hash";
import { getModSourceId, getModSourceKind } from "../modSources";
import { getModThumbnailSrc } from "../utility/frontend/modDisplay";
import ModListPane, { ModListPaneHandle, ModRowCallbacks } from "./ModListPane";
import { getModListGhostClass, getModListGridClass, ModRowDatum } from "../utility/frontend/modListLayout";

const noHiddenModNames = new Set<string>();
const REORDER_HIGHLIGHT_MS = 2400;

const getVisibleMods = (mods: Mod[], hiddenModNames: Set<string>) => {
  const dataPackNames = new Set(mods.filter((mod) => mod.isInData).map((mod) => mod.name));

  return mods.filter((mod) => (mod.isInData || !dataPackNames.has(mod.name)) && !hiddenModNames.has(mod.name));
};

const MemoizedFloatingOverlay = memo(FloatingOverlay);
const domParser = new DOMParser();

const decodeHtml = (encoded: string) => {
  const doc = domParser.parseFromString(encoded, "text/html");
  return doc.documentElement.textContent ?? "";
};

type ModRowsProps = {
  scrollElement: RefObject<HTMLDivElement>;
};

const getLoadOrderRowAnchor = (modName: string) => document.getElementById(`load-order-row-anchor-${modName}`);

type LoadOrderScrollSnapshot = {
  modName: string;
  originalScrollTop: number;
  sourceViewportOffset?: number;
  didAnchorSource: boolean;
};

const ModRows = memo((props: ModRowsProps) => {
  const dispatch = useAppDispatch();
  const filter = useAppSelector((state) => state.app.filter);
  const hiddenModNamesList = useAppSelector((state) => state.app.hiddenModNames);
  const alwaysEnabledModNamesList = useAppSelector((state) => state.app.alwaysEnabledModNames);
  const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);
  const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);
  const isDualModListLayoutEnabled = useAppSelector((state) => state.app.isDualModListLayoutEnabled);
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const sortingType = useAppSelector((state) => state.app.modRowsSortingType);
  const customizableMods = useAppSelector((state) => state.app.customizableMods);
  const packDataOverwrites = useAppSelector((state) => state.app.packDataOverwrites);
  const modBeingCustomized = useAppSelector((state) => state.app.modBeingCustomized);
  const isDev = useAppSelector((state) => state.app.isDev);
  const appFolderPaths = useAppSelector((state) => state.app.appFolderPaths);

  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isFlowOptionsModalOpen, setIsFlowOptionsModalOpen] = useState<boolean>(false);
  const [flowOptionsModSelected, setFlowOptionsModSelected] = useState<Mod | undefined>();
  const [contextMenuMod, setContextMenuMod] = useState<Mod>();
  const [dropdownReferenceElement, setDropdownReferenceElement] = useState<HTMLDivElement>();
  const [loadOrderModName, setLoadOrderModName] = useState<string>();
  const [activeLoadOrderPosition, setActiveLoadOrderPosition] = useState(0);
  const [recentlyReorderedModNames, setRecentlyReorderedModNames] = useState<Set<string>>(new Set());
  const loadOrderScrollSnapshotRef = useRef<LoadOrderScrollSnapshot>();
  const skipInitialPlaceholderScrollRef = useRef(false);
  const pendingLoadOrderAnchorFramesRef = useRef<number[]>([]);
  const reorderHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isCurrentTabEnabledMods = currentTab == "enabledMods";
  /** The two-pane view replaces the single All Mods list; the Enabled Mods tab is unaffected by it. */
  const isDualLayout = isDualModListLayoutEnabled && currentTab == "mods";
  /** Load order placement is available wherever an enabled-only list is on screen. */
  const canReorderLoadOrder = isCurrentTabEnabledMods || isDualLayout;

  const localized: Record<string, string> = useContext(localizationContext);

  const singleListRef = useRef<List>(null);
  const leftListRef = useRef<List>(null);
  const rightListRef = useRef<List>(null);
  const singlePaneHandleRef = useRef<ModListPaneHandle>(null);
  const rightPaneHandleRef = useRef<ModListPaneHandle>(null);
  // Callback refs rather than useRef: the panes only mount in the dual layout and WindowScroller needs a
  // render to happen once the element exists.
  const [leftPaneScroll, setLeftPaneScroll] = useState<HTMLDivElement | null>(null);
  const [rightPaneScroll, setRightPaneScroll] = useState<HTMLDivElement | null>(null);
  /**
   * The page scroller belongs to a parent, so its ref is still empty while this first renders. Mirroring
   * it into state is what gets the list a second render to mount WindowScroller against.
   */
  const [pageScroll, setPageScroll] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPageScroll(props.scrollElement.current);
  }, [props.scrollElement]);

  /** Placement mode always runs in the list that holds the enabled mods. */
  const getReorderScrollElement = useCallback(
    () => (isDualLayout ? rightPaneScroll : pageScroll),
    [isDualLayout, pageScroll, rightPaneScroll],
  );
  const getReorderPaneHandle = useCallback(
    () => (isDualLayout ? rightPaneHandleRef.current : singlePaneHandleRef.current),
    [isDualLayout],
  );

  const currentPresetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const hiddenModNames = useMemo(() => new Set(hiddenModNamesList), [hiddenModNamesList]);
  const alwaysEnabledModNames = useMemo(() => new Set(alwaysEnabledModNamesList), [alwaysEnabledModNamesList]);
  const enabledMods = useMemo(
    () => currentPresetMods.filter((iterMod) => iterMod.isEnabled || alwaysEnabledModNames.has(iterMod.name)),
    [alwaysEnabledModNames, currentPresetMods],
  );
  const canonicalEnabledMods = useMemo(
    () => getVisibleMods(sortByNameAndLoadOrder(enabledMods), noHiddenModNames),
    [enabledMods],
  );
  const presetMods = useMemo(
    () => (currentTab == "enabledMods" ? enabledMods : currentPresetMods),
    [currentPresetMods, currentTab, enabledMods],
  );
  const enabledMergeMods = useMemo(() => enabledMods.filter((mod) => mod.mergedModsData), [enabledMods]);
  const mergedModPaths = useMemo(() => {
    const paths = new Set<string>();
    enabledMergeMods.forEach((mergeMod) => {
      (mergeMod.mergedModsData as MergedModsData[]).forEach((mergeModData) => {
        paths.add(mergeModData.path);
      });
    });
    return paths;
  }, [enabledMergeMods]);

  const modsToOrder = useMemo(
    () => presetMods.filter((iterMod) => !hiddenModNames.has(iterMod.name) || alwaysEnabledModNames.has(iterMod.name)),
    [alwaysEnabledModNames, hiddenModNames, presetMods],
  );
  const orderedMods = useMemo(() => sortByNameAndLoadOrder(modsToOrder), [modsToOrder]);
  const loadOrderIndexByModName = useMemo(
    () => new Map(orderedMods.map((mod, index) => [mod.name, index])),
    [orderedMods],
  );
  /**
   * The dual layout's right pane is the enabled list, so its position numbers have to count over the
   * enabled mods alone the way the Enabled Mods tab does, not over every mod in the preset.
   */
  const enabledLoadOrderIndexByModName = useMemo(() => {
    if (!isDualLayout) return loadOrderIndexByModName;
    const orderedEnabledMods = sortByNameAndLoadOrder(
      enabledMods.filter((mod) => !hiddenModNames.has(mod.name) || alwaysEnabledModNames.has(mod.name)),
    );
    return new Map(orderedEnabledMods.map((mod, index) => [mod.name, index]));
  }, [alwaysEnabledModNames, enabledMods, hiddenModNames, isDualLayout, loadOrderIndexByModName]);

  const unfilteredMods = useMemo(() => {
    const sortedMods = modRowSorting.getSortedMods(presetMods, orderedMods, sortingType, customizableMods);
    if (!isDev) return sortedMods;

    // duplicates happen when we hot-reload in dev
    const seenModNames = new Set<string>();
    return sortedMods.filter((mod) => {
      if (seenModNames.has(mod.name)) return false;
      seenModNames.add(mod.name);
      return true;
    });
  }, [customizableMods, isDev, orderedMods, presetMods, sortingType]);

  const mods = useMemo(
    () =>
      filter !== "" && !loadOrderModName
        ? getFilteredMods(unfilteredMods, filter.toLowerCase(), isAuthorEnabled)
        : unfilteredMods,
    [filter, isAuthorEnabled, loadOrderModName, unfilteredMods],
  );

  const getScrollContainers = useCallback((): HTMLElement[] => {
    if (isDualLayout)
      return [leftPaneScroll, rightPaneScroll].filter((element): element is HTMLDivElement => !!element);
    const pageScroll = document.getElementById("mod-rows-scroll");
    return pageScroll ? [pageScroll] : [];
  }, [isDualLayout, leftPaneScroll, rightPaneScroll]);

  const onModToggled = useCallback(
    (mod: Mod): void => {
      const scrollContainers = getScrollContainers();
      const lastScrollTops = scrollContainers.map((element) => element.scrollTop);

      // if always enabled don't allow unchecking
      if (isModAlwaysEnabled(mod, alwaysEnabledModNamesList)) {
        return;
      }

      dispatch(toggleMod(mod));

      setTimeout(() => {
        scrollContainers.forEach((element, index) => {
          const lastScrollTop = lastScrollTops[index];
          if (lastScrollTop) element.scrollTop = lastScrollTop;
        });
      }, 1);
    },
    [alwaysEnabledModNamesList, dispatch, getScrollContainers],
  );

  const setSortingType = useCallback(
    (newSortingType: SortingType) => {
      dispatch(setModRowsSortingType(modRowSorting.getNewSortType(newSortingType, sortingType)));
    },
    [dispatch, sortingType],
  );

  const onEnabledRightClick = useCallback(() => {
    if (mods.some((mod) => mod.isEnabled)) {
      dispatch(disableAllMods());
    } else {
      dispatch(enableAll());
    }
  }, [dispatch, mods]);

  const onOrderRightClick = useCallback(() => {
    dispatch(resetModLoadOrderAll());
  }, [dispatch]);

  const onRowHoverStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
      if (sortingType !== SortingType.Ordered || loadOrderModName) return;

      const element = e.currentTarget as HTMLDivElement;
      const loadOrderIcon = document.getElementById(`load-order-icon-${element.id}`);
      if (loadOrderIcon) loadOrderIcon.classList.remove("hidden");
    },
    [loadOrderModName, sortingType],
  );

  const onRowHoverEnd = useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
      const element = e.currentTarget as HTMLDivElement;
      if (element.id === loadOrderModName) return;
      const loadOrderIcon = document.getElementById(`load-order-icon-${element.id}`);
      if (loadOrderIcon) loadOrderIcon.classList.add("hidden");
    },
    [loadOrderModName],
  );

  const onRemoveModOrder = useCallback(
    (mod: Mod) => {
      dispatch(resetModLoadOrder([mod]));
    },
    [dispatch],
  );

  const [positionX, setPositionX] = useState<number>(0);
  const [positionY, setPositionY] = useState<number>(0);

  const onModRightClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>, mod: Mod) => {
      if (isDropdownOpen) return;
      setContextMenuMod(mod);

      setPositionX(e.clientX);
      setPositionY(e.clientY);

      setIsDropdownOpen(true);
      setDropdownReferenceElement(e.currentTarget);

      e.preventDefault();
      e.stopPropagation();
    },
    [isDropdownOpen],
  );

  const onCustomizeModClicked = useCallback(
    (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => {
      if (isDropdownOpen) return;
      console.log("onCustomizeModClicked:", mod);
      dispatch(setModBeingCustomized(mod));

      e.preventDefault();
      e.stopPropagation();
    },
    [dispatch, isDropdownOpen],
  );

  const onFlowOptionsClicked = useCallback(
    (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => {
      if (isDropdownOpen) return;
      console.log("onFlowOptionsClicked:", mod);
      setFlowOptionsModSelected(mod);
      setIsFlowOptionsModalOpen(true);

      e.preventDefault();
      e.stopPropagation();
    },
    [isDropdownOpen],
  );

  const onCustomizeModRightClick = useCallback(
    (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => {
      if (isDropdownOpen) return;
      console.log("onCustomizeModRightClick:", mod);
      dispatch(removeAllPackDataOverwrites(mod.path));

      e.preventDefault();
      e.stopPropagation();
    },
    [dispatch, isDropdownOpen],
  );

  const onDropdownOverlayClick = useCallback(() => {
    const scrollContainers = getScrollContainers();
    const lastScrollTops = scrollContainers.map((element) => element.scrollTop);
    setIsDropdownOpen(false);

    setTimeout(() => {
      scrollContainers.forEach((element, index) => {
        element.scrollTop = lastScrollTops[index];
      });
    }, 1);
  }, [getScrollContainers]);

  useEffect(() => {
    const customizableTables = [
      "units_to_groupings_military_permissions_tables",
      // "units_to_exclusive_faction_permissions_tables",
      "building_culture_variants_tables",
      "faction_agent_permitted_subtypes_tables",
      "campaign_group_unique_agents_tables",
    ];
    console.log("window.api?.getCustomizableMods from modsrows");
    window.api?.getCustomizableMods(
      enabledMods.map((mod) => mod.path),
      customizableTables,
      hash(customizableMods),
    );
  }, [enabledMods, customizableMods]);

  const visibleMods = useMemo(
    () => (loadOrderModName && canReorderLoadOrder ? canonicalEnabledMods : getVisibleMods(mods, hiddenModNames)),
    [canReorderLoadOrder, canonicalEnabledMods, hiddenModNames, loadOrderModName, mods],
  );

  const unfilteredVisibleMods = useMemo(
    () =>
      loadOrderModName && canReorderLoadOrder ? canonicalEnabledMods : getVisibleMods(unfilteredMods, hiddenModNames),
    [canReorderLoadOrder, canonicalEnabledMods, hiddenModNames, loadOrderModName, unfilteredMods],
  );

  const onSetLoadOrderMode = useCallback(
    (mod: Mod) => {
      if (!canReorderLoadOrder || sortingType !== SortingType.Ordered) return;
      if (loadOrderModName === mod.name) {
        setLoadOrderModName(undefined);
        return;
      }

      const scrollElement = getReorderScrollElement();
      pendingLoadOrderAnchorFramesRef.current.forEach((frameId) => window.cancelAnimationFrame(frameId));
      pendingLoadOrderAnchorFramesRef.current = [];
      document.querySelectorAll<HTMLElement>("[id^='load-order-icon-']").forEach((icon) => {
        icon.classList.add("hidden");
      });

      const sourceElement = getLoadOrderRowAnchor(mod.name);
      loadOrderScrollSnapshotRef.current = {
        modName: mod.name,
        originalScrollTop: scrollElement?.scrollTop ?? 0,
        sourceViewportOffset:
          scrollElement && sourceElement
            ? sourceElement.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top
            : undefined,
        didAnchorSource: false,
      };
      skipInitialPlaceholderScrollRef.current = true;

      const currentIndex = canonicalEnabledMods.findIndex((visibleMod) => visibleMod.name === mod.name);
      setActiveLoadOrderPosition(Math.max(0, currentIndex));
      setLoadOrderModName(mod.name);
    },
    [canonicalEnabledMods, canReorderLoadOrder, getReorderScrollElement, loadOrderModName, sortingType],
  );

  useLayoutEffect(() => {
    const snapshot = loadOrderScrollSnapshotRef.current;
    if (!snapshot) return;

    const scrollElement = getReorderScrollElement();
    if (!loadOrderModName) {
      pendingLoadOrderAnchorFramesRef.current.forEach((frameId) => window.cancelAnimationFrame(frameId));
      pendingLoadOrderAnchorFramesRef.current = [];
      if (scrollElement) scrollElement.scrollTop = snapshot.originalScrollTop;
      loadOrderScrollSnapshotRef.current = undefined;
      skipInitialPlaceholderScrollRef.current = false;
      return;
    }

    if (snapshot.didAnchorSource || snapshot.modName !== loadOrderModName || snapshot.sourceViewportOffset == null) {
      return;
    }

    const alignSourceRow = () => {
      if (loadOrderScrollSnapshotRef.current !== snapshot) return;
      const currentScrollElement = getReorderScrollElement();
      const sourceElement = getLoadOrderRowAnchor(loadOrderModName);
      if (!currentScrollElement || !sourceElement || snapshot.sourceViewportOffset == null) return;

      const nextViewportOffset =
        sourceElement.getBoundingClientRect().top - currentScrollElement.getBoundingClientRect().top;
      currentScrollElement.scrollTop += nextViewportOffset - snapshot.sourceViewportOffset;
    };

    alignSourceRow();
    const firstFrameId = window.requestAnimationFrame(() => {
      alignSourceRow();
      const secondFrameId = window.requestAnimationFrame(alignSourceRow);
      pendingLoadOrderAnchorFramesRef.current.push(secondFrameId);
    });
    pendingLoadOrderAnchorFramesRef.current.push(firstFrameId);
    snapshot.didAnchorSource = true;
  }, [getReorderScrollElement, loadOrderModName]);

  useLayoutEffect(
    () => () => {
      pendingLoadOrderAnchorFramesRef.current.forEach((frameId) => window.cancelAnimationFrame(frameId));
      pendingLoadOrderAnchorFramesRef.current = [];
      const snapshot = loadOrderScrollSnapshotRef.current;
      const scrollElement = getReorderScrollElement();
      if (snapshot && scrollElement) scrollElement.scrollTop = snapshot.originalScrollTop;
    },
    [getReorderScrollElement],
  );

  const onSelectLoadOrderPosition = useCallback(
    (position: number) => {
      if (!loadOrderModName || unfilteredVisibleMods.length === 0) return;

      const selectedIndex = unfilteredVisibleMods.findIndex((mod) => mod.name === loadOrderModName);
      const modsWithoutSelected = unfilteredVisibleMods.filter((mod) => mod.name !== loadOrderModName);
      const boundedPosition = getLoadOrderInsertionIndex(selectedIndex, position, modsWithoutSelected.length);
      const isLastPosition = boundedPosition === modsWithoutSelected.length;
      const relativeMod = isLastPosition
        ? modsWithoutSelected[modsWithoutSelected.length - 1]
        : modsWithoutSelected[boundedPosition];

      if (relativeMod) {
        setRecentlyReorderedModNames(new Set([loadOrderModName]));
        if (reorderHighlightTimeoutRef.current) clearTimeout(reorderHighlightTimeoutRef.current);
        reorderHighlightTimeoutRef.current = setTimeout(() => {
          setRecentlyReorderedModNames(new Set());
          reorderHighlightTimeoutRef.current = undefined;
        }, REORDER_HIGHLIGHT_MS);
        dispatch(
          setModLoadOrderRelativeTo({
            modNameToChange: loadOrderModName,
            modNameRelativeTo: relativeMod.name,
            visualModList: [...unfilteredVisibleMods],
            setAfterMod: isLastPosition,
          }),
        );
      }
      setLoadOrderModName(undefined);
    },
    [dispatch, loadOrderModName, unfilteredVisibleMods],
  );

  useEffect(
    () => () => {
      if (reorderHighlightTimeoutRef.current) clearTimeout(reorderHighlightTimeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!loadOrderModName) return;
    if (
      !canReorderLoadOrder ||
      sortingType !== SortingType.Ordered ||
      !unfilteredVisibleMods.some((mod) => mod.name === loadOrderModName)
    ) {
      setLoadOrderModName(undefined);
    }
  }, [canReorderLoadOrder, loadOrderModName, sortingType, unfilteredVisibleMods]);

  useEffect(() => {
    if (!loadOrderModName) return;
    const maxPosition = unfilteredVisibleMods.length;
    if (activeLoadOrderPosition > maxPosition) setActiveLoadOrderPosition(maxPosition);
  }, [activeLoadOrderPosition, loadOrderModName, unfilteredVisibleMods.length]);

  useEffect(() => {
    if (!loadOrderModName) return;
    if (skipInitialPlaceholderScrollRef.current) {
      skipInitialPlaceholderScrollRef.current = false;
      return;
    }
    // The rows are virtualized, so the placeholder for a position further down the list does not exist
    // yet. Bring its row into view first, then let scrollIntoView do the fine adjustment.
    getReorderPaneHandle()?.scrollRowIntoView(Math.min(activeLoadOrderPosition, unfilteredVisibleMods.length - 1));
    document.getElementById(`enabled-mod-placeholder-${activeLoadOrderPosition}`)?.scrollIntoView({ block: "nearest" });
  }, [activeLoadOrderPosition, getReorderPaneHandle, loadOrderModName, unfilteredVisibleMods.length]);

  useEffect(() => {
    if (!loadOrderModName) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLoadOrderModName(undefined);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveLoadOrderPosition((previous) => Math.max(0, previous - 1));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveLoadOrderPosition((previous) => Math.min(unfilteredVisibleMods.length, previous + 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        onSelectLoadOrderPosition(activeLoadOrderPosition);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeLoadOrderPosition, loadOrderModName, onSelectLoadOrderPosition, unfilteredVisibleMods.length]);

  const customFolderPathBySourceId = useMemo(
    () => new Map((appFolderPaths.customModFolders || []).map((folder) => [folder.id, folder.path])),
    [appFolderPaths.customModFolders],
  );

  const rowData = useMemo(
    (): ModRowDatum[] =>
      visibleMods.map((mod) => ({
        mod,
        isAlwaysEnabled: alwaysEnabledModNames.has(mod.name),
        isEnabledInMergedMod: mergedModPaths.has(mod.path),
        decodedHumanName: decodeHtml(decodeHtml(mod.humanName) ?? ""),
        decodedAuthor: decodeHtml(decodeHtml(mod.author) ?? ""),
        customFolderPath:
          getModSourceKind(mod) === "custom" ? customFolderPathBySourceId.get(getModSourceId(mod)) : undefined,
        hasDbCustomization: Boolean(customizableMods[mod.path]?.some((file) => file.startsWith("db\\"))),
        hasFlowCustomization: Boolean(customizableMods[mod.path]?.some((file) => file.startsWith("whmmflows\\"))),
        hasPackDataOverwrite: Boolean(packDataOverwrites[mod.path]),
        thumbnailSrc: getModThumbnailSrc(mod, isDev),
      })),
    [
      alwaysEnabledModNames,
      customFolderPathBySourceId,
      customizableMods,
      isDev,
      mergedModPaths,
      packDataOverwrites,
      visibleMods,
    ],
  );

  const disabledRowData = useMemo(
    () => (isDualLayout ? rowData.filter((row) => !row.mod.isEnabled && !row.isAlwaysEnabled) : rowData),
    [isDualLayout, rowData],
  );
  const enabledRowData = useMemo(
    () => (isDualLayout ? rowData.filter((row) => row.mod.isEnabled || row.isAlwaysEnabled) : rowData),
    [isDualLayout, rowData],
  );

  const callbacks = useMemo(
    (): ModRowCallbacks => ({
      onRowHoverStart,
      onRowHoverEnd,
      onSetLoadOrderMode,
      onSelectLoadOrderPosition,
      onModToggled,
      onModRightClick,
      onCustomizeModClicked,
      onCustomizeModRightClick,
      onFlowOptionsClicked,
      onRemoveModOrder,
    }),
    [
      onCustomizeModClicked,
      onCustomizeModRightClick,
      onFlowOptionsClicked,
      onModRightClick,
      onModToggled,
      onRemoveModOrder,
      onRowHoverEnd,
      onRowHoverStart,
      onSelectLoadOrderPosition,
      onSetLoadOrderMode,
    ],
  );

  const sharedPaneProps = {
    areThumbnailsEnabled,
    isAuthorEnabled,
    sortingType,
    setSortingType,
    onOrderRightClick,
    onEnabledRightClick,
    loadOrderModName,
    activeLoadOrderPosition,
    recentlyReorderedModNames,
    callbacks,
  };

  const compactGridOptions = { isAuthorEnabled, areThumbnailsEnabled };

  return (
    <>
      <div
        onContextMenuCapture={(event) => {
          if (!loadOrderModName) return;
          event.preventDefault();
          event.stopPropagation();
          setLoadOrderModName(undefined);
        }}
        className={`dark:text-slate-100 ` + (areThumbnailsEnabled && !isDualLayout ? "text-lg" : "")}
        id="rowsParent"
      >
        <MemoizedFloatingOverlay
          onClick={() => onDropdownOverlayClick()}
          onContextMenu={() => onDropdownOverlayClick()}
          className={`${isDropdownOpen ? "" : "hidden"} z-50 dark`}
          id="modDropdownOverlay"
        >
          <ModDropdown
            isOpen={isDropdownOpen}
            positionX={positionX}
            positionY={positionY}
            mod={contextMenuMod}
            referenceElement={dropdownReferenceElement}
            mods={mods}
          ></ModDropdown>
        </MemoizedFloatingOverlay>
        {modBeingCustomized && modBeingCustomized.path && <ModCustomization />}
        {flowOptionsModSelected && (
          <UserFlowOptionsModal
            isOpen={isFlowOptionsModalOpen}
            onClose={() => setIsFlowOptionsModalOpen(false)}
            mod={flowOptionsModSelected}
          />
        )}

        {(isDualLayout && (
          <div className="grid grid-cols-2 gap-3" id="dualModLists">
            <div className="flex flex-col min-w-0">
              <div
                className="flex items-center justify-between px-2 pb-1 text-sm text-slate-300 cursor-default select-none"
                onContextMenu={onEnabledRightClick}
                title={localized.enableOrDisableAll}
                id="disabledModsPaneCaption"
              >
                <span>{localized.allMods}</span>
                <span className="opacity-60">{disabledRowData.length}</span>
              </div>
              <div
                ref={setLeftPaneScroll}
                id="disabledModsPaneScroll"
                className="dual-mod-list-pane overflow-y-auto scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700"
              >
                <ModListPane
                  {...sharedPaneProps}
                  rowData={disabledRowData}
                  scrollElement={leftPaneScroll}
                  listRef={leftListRef}
                  layout="compact"
                  showConfigColumn={false}
                  isInsidePane
                  canReorder={false}
                  gridClass={getModListGridClass("compact", { ...compactGridOptions, showConfigColumn: false })}
                  ghostClass={getModListGhostClass("compact", { ...compactGridOptions, showConfigColumn: false })}
                  loadOrderIndexByModName={loadOrderIndexByModName}
                  isLoadOrderPlacementMode={false}
                />
              </div>
            </div>

            <div className="flex flex-col min-w-0">
              <div
                className="flex items-center justify-between px-2 pb-1 text-sm text-slate-300 cursor-default select-none"
                id="enabledModsPaneCaption"
              >
                <span>{localized.enabledModsCapitalized}</span>
                <span className="opacity-60">{enabledRowData.length}</span>
              </div>
              <div
                ref={setRightPaneScroll}
                id="enabledModsPaneScroll"
                className="dual-mod-list-pane overflow-y-auto scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700"
              >
                <ModListPane
                  {...sharedPaneProps}
                  rowData={enabledRowData}
                  scrollElement={rightPaneScroll}
                  listRef={rightListRef}
                  paneHandleRef={rightPaneHandleRef}
                  layout="compact"
                  showConfigColumn
                  isInsidePane
                  canReorder
                  gridClass={getModListGridClass("compact", { ...compactGridOptions, showConfigColumn: true })}
                  ghostClass={getModListGhostClass("compact", { ...compactGridOptions, showConfigColumn: true })}
                  loadOrderIndexByModName={enabledLoadOrderIndexByModName}
                  isLoadOrderPlacementMode={!!loadOrderModName}
                />
              </div>
            </div>
          </div>
        )) || (
          <ModListPane
            {...sharedPaneProps}
            rowData={rowData}
            scrollElement={pageScroll}
            listRef={singleListRef}
            paneHandleRef={singlePaneHandleRef}
            gridId="modsGrid"
            layout="wide"
            showConfigColumn
            isInsidePane={false}
            canReorder={canReorderLoadOrder}
            gridClass={getModListGridClass("wide", { ...compactGridOptions, showConfigColumn: true })}
            ghostClass={getModListGhostClass("wide", { ...compactGridOptions, showConfigColumn: true })}
            loadOrderIndexByModName={loadOrderIndexByModName}
            isLoadOrderPlacementMode={canReorderLoadOrder && !!loadOrderModName}
          />
        )}
        {loadOrderModName && (
          <div
            className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-lg border border-blue-600 bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-xl"
            role="status"
          >
            <div className="font-semibold">
              {localized.selectNewLoadOrderPosition || "Select a new load order / position."}
            </div>
            <div className="mt-1 text-xs text-slate-300">
              {localized.cancelLoadOrderPlacementHelp || "Press Esc or right-click to cancel."}
            </div>
          </div>
        )}
      </div>
    </>
  );
});

export default ModRows;
