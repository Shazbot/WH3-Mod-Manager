import React, {
  CSSProperties,
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
import { Tooltip } from "flowbite-react";
import {
  getFilteredMods,
  getLoadOrderInsertionIndex,
  sortByNameAndLoadOrder,
} from "../modSortingHelpers";
import { FloatingOverlay } from "@floating-ui/react";
import ModDropdown from "./ModDropdown";
import { isModAlwaysEnabled } from "../modsHelpers";
import * as modRowSorting from "../utility/modRowSorting";
import { SortingType } from "../utility/modRowSorting";
import ModRow from "./ModRow";
import localizationContext from "../localizationContext";
import { GoGear } from "react-icons/go";
import ModCustomization from "./ModCustomization";
import UserFlowOptionsModal from "./UserFlowOptionsModal";
import { WindowScroller, AutoSizer, List, CellMeasurerCache, CellMeasurer } from "react-virtualized";
import { MeasuredCellParent } from "react-virtualized/dist/es/CellMeasurer";
import { GridCoreProps } from "react-virtualized/dist/es/Grid";
import hash from "object-hash";
import { getModSourceId, getModSourceKind } from "../modSources";

const defaultModThumbnailSrc = require("../assets/modThumbnail.png");

const noHiddenModNames = new Set<string>();
const REORDER_HIGHLIGHT_MS = 2400;

const getVisibleMods = (mods: Mod[], hiddenModNames: Set<string>) => {
  const dataPackNames = new Set(mods.filter((mod) => mod.isInData).map((mod) => mod.name));

  return mods.filter((mod) => (mod.isInData || !dataPackNames.has(mod.name)) && !hiddenModNames.has(mod.name));
};

const MemoizedFloatingOverlay = memo(FloatingOverlay);
const domParser = new DOMParser();

const getGhostClass = (isAuthorEnabled: boolean, areThumbnailsEnabled: boolean) => {
  if (isAuthorEnabled && areThumbnailsEnabled) return "grid-column-8";
  if (isAuthorEnabled) return "grid-column-7";
  if (areThumbnailsEnabled) return "grid-column-7";
  return "grid-column-6";
};

const decodeHtml = (encoded: string) => {
  const doc = domParser.parseFromString(encoded, "text/html");
  return doc.documentElement.textContent ?? "";
};

type ModRowsProps = {
  scrollElement: RefObject<HTMLDivElement>;
};

const getLoadOrderRowAnchor = (modName: string) =>
  document.getElementById(`load-order-row-anchor-${modName}`);

type LoadOrderScrollSnapshot = {
  modName: string;
  originalScrollTop: number;
  sourceViewportOffset?: number;
  didAnchorSource: boolean;
};

const ModRows = memo((props: ModRowsProps) => {
  const dispatch = useAppDispatch();
  const filter = useAppSelector((state) => state.app.filter);
  const hiddenMods = useAppSelector((state) => state.app.hiddenMods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);
  const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);
  const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);
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
  // const [modBeingCustomized, setModBeingCustomized] = useState<Mod>();
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

  const localized: Record<string, string> = useContext(localizationContext);

  const listRef = useRef<List>(null);

  const currentPresetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const hiddenModNames = useMemo(() => new Set(hiddenMods.map((mod) => mod.name)), [hiddenMods]);
  const alwaysEnabledModNames = useMemo(
    () => new Set(alwaysEnabledMods.map((mod) => mod.name)),
    [alwaysEnabledMods]
  );
  const enabledMods = useMemo(
    () =>
      currentPresetMods.filter((iterMod) => iterMod.isEnabled || alwaysEnabledModNames.has(iterMod.name)),
    [alwaysEnabledModNames, currentPresetMods]
  );
  const canonicalEnabledMods = useMemo(
    () => getVisibleMods(sortByNameAndLoadOrder(enabledMods), noHiddenModNames),
    [enabledMods]
  );
  const presetMods = currentTab == "enabledMods" ? enabledMods : currentPresetMods;
  const enabledMergeMods = enabledMods.filter((mod) => mod.mergedModsData);
  const mergedModPaths = useMemo(() => {
    const paths = new Set<string>();
    enabledMergeMods.forEach((mergeMod) => {
      (mergeMod.mergedModsData as MergedModsData[]).forEach((mergeModData) => {
        paths.add(mergeModData.path);
      });
    });
    return paths;
  }, [enabledMergeMods]);

  const modsToOrder = presetMods.filter(
    (iterMod) => !hiddenModNames.has(iterMod.name) || alwaysEnabledModNames.has(iterMod.name)
  );
  const orderedMods = sortByNameAndLoadOrder(modsToOrder);
  const loadOrderIndexByModName = new Map(orderedMods.map((mod, index) => [mod.name, index]));

  let mods: Mod[] = modRowSorting.getSortedMods(presetMods, orderedMods, sortingType, customizableMods);

  if (isDev) {
    // duplicates happen when we hot-reload in dev
    const seenModNames = new Set<string>();
    mods = mods.filter((mod) => {
      if (seenModNames.has(mod.name)) return false;
      seenModNames.add(mod.name);
      return true;
    });
  }

  const unfilteredMods = mods;
  if (filter !== "" && !loadOrderModName) {
    mods = getFilteredMods(mods, filter.toLowerCase(), isAuthorEnabled);
  }

  const onModToggled = useCallback((mod: Mod): void => {
    const modRowsScroll = document.getElementById("mod-rows-scroll");
    const lastScrollTop = modRowsScroll?.scrollTop;

    // if always enabled don't allow unchecking
    if (isModAlwaysEnabled(mod, alwaysEnabledMods)) {
      return;
    }

    dispatch(toggleMod(mod));

    setTimeout(() => {
      if (lastScrollTop && modRowsScroll) modRowsScroll.scrollTop = lastScrollTop;
    }, 1);
  }, [alwaysEnabledMods, dispatch]);

  const setSortingType = useCallback(
    (newSortingType: SortingType) => {
      dispatch(setModRowsSortingType(modRowSorting.getNewSortType(newSortingType, sortingType)));
    },
    [dispatch, sortingType]
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
    [loadOrderModName, sortingType]
  );

  const onRowHoverEnd = useCallback((e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
    const element = e.currentTarget as HTMLDivElement;
    if (element.id === loadOrderModName) return;
    const loadOrderIcon = document.getElementById(`load-order-icon-${element.id}`);
    if (loadOrderIcon) loadOrderIcon.classList.add("hidden");
  }, [loadOrderModName]);

  const onRemoveModOrder = useCallback((mod: Mod) => {
    dispatch(resetModLoadOrder([mod]));
  }, [dispatch]);

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
    [isDropdownOpen]
  );

  const onCustomizeModClicked = useCallback((e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => {
    if (isDropdownOpen) return;
    console.log("onCustomizeModClicked:", mod);
    dispatch(setModBeingCustomized(mod));

    e.preventDefault();
    e.stopPropagation();
  }, [dispatch, isDropdownOpen]);

  const onFlowOptionsClicked = useCallback((e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => {
    if (isDropdownOpen) return;
    console.log("onFlowOptionsClicked:", mod);
    setFlowOptionsModSelected(mod);
    setIsFlowOptionsModalOpen(true);

    e.preventDefault();
    e.stopPropagation();
  }, [isDropdownOpen]);

  const onCustomizeModRightClick = useCallback(
    (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => {
      if (isDropdownOpen) return;
      console.log("onCustomizeModRightClick:", mod);
      dispatch(removeAllPackDataOverwrites(mod.path));

      e.preventDefault();
      e.stopPropagation();
    },
    [dispatch, isDropdownOpen]
  );

  const onDropdownOverlayClick = useCallback(() => {
    const modRowsScroll = document.getElementById("mod-rows-scroll");
    if (!modRowsScroll) return;
    const lastScrollTop = modRowsScroll.scrollTop;
    setIsDropdownOpen(false);

    setTimeout(() => {
      if (modRowsScroll) modRowsScroll.scrollTop = lastScrollTop;
    }, 1);
  }, []);

  const gridClass = useMemo(() => {
    if (isAuthorEnabled && areThumbnailsEnabled) return "grid-mods-thumbs-author";
    if (isAuthorEnabled) return "grid-mods-author";
    if (areThumbnailsEnabled) return "grid-mods-thumbs";
    return "grid-mods";
  }, [isAuthorEnabled, areThumbnailsEnabled]);
  const ghostClass = useMemo(
    () => getGhostClass(isAuthorEnabled, areThumbnailsEnabled),
    [areThumbnailsEnabled, isAuthorEnabled]
  );

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
      hash(customizableMods)
    );
  }, [enabledMods, customizableMods]);

  const visibleMods = useMemo(
    () =>
      loadOrderModName && isCurrentTabEnabledMods
        ? canonicalEnabledMods
        : getVisibleMods(mods, hiddenModNames),
    [canonicalEnabledMods, hiddenModNames, isCurrentTabEnabledMods, loadOrderModName, mods]
  );

  const unfilteredVisibleMods = useMemo(
    () =>
      loadOrderModName && isCurrentTabEnabledMods
        ? canonicalEnabledMods
        : getVisibleMods(unfilteredMods, hiddenModNames),
    [canonicalEnabledMods, hiddenModNames, isCurrentTabEnabledMods, loadOrderModName, unfilteredMods]
  );

  const onSetLoadOrderMode = useCallback(
    (mod: Mod) => {
      if (!isCurrentTabEnabledMods || sortingType !== SortingType.Ordered) return;
      if (loadOrderModName === mod.name) {
        setLoadOrderModName(undefined);
        return;
      }

      const scrollElement = props.scrollElement.current;
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
    [canonicalEnabledMods, isCurrentTabEnabledMods, loadOrderModName, props.scrollElement, sortingType]
  );

  useLayoutEffect(() => {
    const snapshot = loadOrderScrollSnapshotRef.current;
    if (!snapshot) return;

    const scrollElement = props.scrollElement.current;
    if (!loadOrderModName) {
      pendingLoadOrderAnchorFramesRef.current.forEach((frameId) => window.cancelAnimationFrame(frameId));
      pendingLoadOrderAnchorFramesRef.current = [];
      if (scrollElement) scrollElement.scrollTop = snapshot.originalScrollTop;
      loadOrderScrollSnapshotRef.current = undefined;
      skipInitialPlaceholderScrollRef.current = false;
      return;
    }

    if (
      snapshot.didAnchorSource ||
      snapshot.modName !== loadOrderModName ||
      snapshot.sourceViewportOffset == null
    ) {
      return;
    }

    const alignSourceRow = () => {
      if (loadOrderScrollSnapshotRef.current !== snapshot) return;
      const currentScrollElement = props.scrollElement.current;
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
  }, [loadOrderModName, props.scrollElement]);

  useLayoutEffect(
    () => () => {
      pendingLoadOrderAnchorFramesRef.current.forEach((frameId) => window.cancelAnimationFrame(frameId));
      pendingLoadOrderAnchorFramesRef.current = [];
      const snapshot = loadOrderScrollSnapshotRef.current;
      const scrollElement = props.scrollElement.current;
      if (snapshot && scrollElement) scrollElement.scrollTop = snapshot.originalScrollTop;
    },
    [props.scrollElement],
  );

  const onSelectLoadOrderPosition = useCallback(
    (position: number) => {
      if (!loadOrderModName || unfilteredVisibleMods.length === 0) return;

      const selectedIndex = unfilteredVisibleMods.findIndex((mod) => mod.name === loadOrderModName);
      const modsWithoutSelected = unfilteredVisibleMods.filter((mod) => mod.name !== loadOrderModName);
      const boundedPosition = getLoadOrderInsertionIndex(
        selectedIndex,
        position,
        modsWithoutSelected.length,
      );
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
          })
        );
      }
      setLoadOrderModName(undefined);
    },
    [dispatch, loadOrderModName, unfilteredVisibleMods]
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
      !isCurrentTabEnabledMods ||
      sortingType !== SortingType.Ordered ||
      !unfilteredVisibleMods.some((mod) => mod.name === loadOrderModName)
    ) {
      setLoadOrderModName(undefined);
    }
  }, [isCurrentTabEnabledMods, loadOrderModName, sortingType, unfilteredVisibleMods]);

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
    document
      .getElementById(`enabled-mod-placeholder-${activeLoadOrderPosition}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeLoadOrderPosition, loadOrderModName]);

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
        setActiveLoadOrderPosition((previous) =>
          Math.min(unfilteredVisibleMods.length, previous + 1)
        );
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
    () =>
      visibleMods.map((mod) => ({
        mod,
        isAlwaysEnabled: alwaysEnabledModNames.has(mod.name),
        isEnabledInMergedMod: mergedModPaths.has(mod.path),
        decodedHumanName: decodeHtml(decodeHtml(mod.humanName) ?? ""),
        decodedAuthor: decodeHtml(decodeHtml(mod.author) ?? ""),
        customFolderPath:
          getModSourceKind(mod) === "custom"
            ? customFolderPathBySourceId.get(getModSourceId(mod))
            : undefined,
        hasDbCustomization: Boolean(customizableMods[mod.path]?.some((file) => file.startsWith("db\\"))),
        hasFlowCustomization: Boolean(
          customizableMods[mod.path]?.some((file) => file.startsWith("whmmflows\\"))
        ),
        hasPackDataOverwrite: Boolean(packDataOverwrites[mod.path]),
        thumbnailSrc: (isDev || mod.imgPath === "") ? defaultModThumbnailSrc : mod.imgPath,
      })),
    [
      alwaysEnabledModNames,
      customFolderPathBySourceId,
      customizableMods,
      isDev,
      mergedModPaths,
      packDataOverwrites,
      visibleMods,
    ]
  );

  const emptyFunc = useCallback(() => {}, []);

  const cache = useMemo(
    () =>
      new CellMeasurerCache({
        fixedWidth: true,
        defaultHeight: 32,
        minHeight: 32,
      }),
    []
  );

  useEffect(() => {
    cache.clearAll();
    listRef.current?.recomputeRowHeights();
  }, [areThumbnailsEnabled, cache, isAuthorEnabled, visibleMods]);

  const Row = ({
    index,
    key,
    parent,
    style,
  }: {
    index: number;
    parent: React.Component<GridCoreProps> & MeasuredCellParent;
    key: string;
    style: CSSProperties;
  }) => {
    const row = rowData[index];
    return row ? (
      <CellMeasurer cache={cache} index={index} key={key} parent={parent}>
        {({ registerChild }) => (
          <ModRow
            key={key}
            {...{
              style,
              loadOrderIndex: loadOrderIndexByModName.get(row.mod.name) ?? index,
              rowIndex: index,
              gridClass,
              mod: row.mod,
              onRowHoverStart,
              onRowHoverEnd,
              onSetLoadOrderMode,
              onSelectLoadOrderPosition,
              activeLoadOrderPosition,
              isLoadOrderPlacementMode: isCurrentTabEnabledMods && !!loadOrderModName,
              isLoadOrderPlacementSource: row.mod.name === loadOrderModName,
              isRecentlyReordered: recentlyReorderedModNames.has(row.mod.name),
              onModToggled,
              onModRightClick,
              onCustomizeModClicked,
              onCustomizeModRightClick,
              onFlowOptionsClicked,
              onRemoveModOrder,
              sortingType,
              currentTab,
              isLast: rowData.length == index + 1,
              isAlwaysEnabled: row.isAlwaysEnabled,
              isEnabledInMergedMod: row.isEnabledInMergedMod,
              areThumbnailsEnabled,
              isAuthorEnabled,
              ghostClass,
              thumbnailSrc: row.thumbnailSrc,
              decodedHumanName: row.decodedHumanName,
              decodedAuthor: row.decodedAuthor,
              customFolderPath: row.customFolderPath,
              hasDbCustomization: row.hasDbCustomization,
              hasFlowCustomization: row.hasFlowCustomization,
              hasPackDataOverwrite: row.hasPackDataOverwrite,
              registerChild,
            }}
          ></ModRow>
        )}
      </CellMeasurer>
    ) : (
      <></>
    );
  };

  return (
    <>
      <div
        onContextMenuCapture={(event) => {
          if (!loadOrderModName) return;
          event.preventDefault();
          event.stopPropagation();
          setLoadOrderModName(undefined);
        }}
        className={`dark:text-slate-100 ` + (areThumbnailsEnabled ? "text-lg" : "")}
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

        <div className={"grid pt-1.5 parent " + gridClass} id="modsGrid">
          <div
            id="sortHeader"
            className="flex place-items-center w-full justify-center z-[11] mod-row-header rounded-tl-xl"
            onClick={() => setSortingType(SortingType.Ordered)}
            onContextMenu={onOrderRightClick}
          >
            {modRowSorting.isOrderSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
            <span className="tooltip-width-20">
              <Tooltip
                placement="bottom"
                style="light"
                content={
                  <>
                    <div>{localized.priorityTooltipOne}</div>
                    <div>{localized.priorityTooltipTwo}</div>
                    <div className="text-red-600 font-bold">{localized.priorityTooltipThree}</div>
                  </>
                }
              >
                <span
                  className={`text-center w-full cursor-pointer ${
                    modRowSorting.isOrderSort(sortingType) && "font-semibold"
                  }`}
                >
                  {localized.order}
                </span>
              </Tooltip>
            </span>
          </div>
          <div
            className="flex place-items-center w-full justify-center z-10 mod-row-header"
            onClick={() => setSortingType(SortingType.IsEnabled)}
            onContextMenu={onEnabledRightClick}
            id="enabledHeader"
          >
            {modRowSorting.isEnabledSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
            <span className="tooltip-width-15">
              <Tooltip placement="bottom" style="light" content={localized.enableOrDisableAll}>
                <span
                  className={`text-center cursor-pointer w-full ${
                    modRowSorting.isEnabledSort(sortingType) && "font-semibold"
                  }`}
                >
                  {localized.enabled}
                </span>
              </Tooltip>
            </span>
          </div>
          <div
            className={
              "flex grid-area-autohide place-items-center pl-1 mod-row-header cursor-default " +
              (areThumbnailsEnabled ? "" : "hidden")
            }
          >
            {localized.thumbnail}
          </div>
          <div
            className="flex grid-area-packName place-items-center pl-1 mod-row-header"
            onClick={() => setSortingType(SortingType.PackName)}
            onContextMenu={() => setSortingType(SortingType.IsDataPack)}
          >
            {(modRowSorting.isPackNameSort(sortingType) || modRowSorting.isDataPackSort(sortingType)) &&
              modRowSorting.getSortingArrow(sortingType)}
            <Tooltip placement="right" style="light" content={localized.sortByDataPacks}>
              <span
                className={`cursor-pointer ${
                  (modRowSorting.isPackNameSort(sortingType) || modRowSorting.isDataPackSort(sortingType)) &&
                  "font-semibold"
                }`}
              >
                {(modRowSorting.isDataPackSort(sortingType) && localized.dataPacks) || localized.pack}
              </span>
            </Tooltip>
          </div>
          <div
            className="flex grid-area-humanName place-items-center pl-1 mod-row-header"
            onClick={() => setSortingType(SortingType.HumanName)}
          >
            {modRowSorting.isHumanNameSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
            <span
              className={`cursor-pointer ${modRowSorting.isHumanNameSort(sortingType) && "font-semibold"}`}
            >
              {localized.name}
            </span>
          </div>
          <div
            className={
              "flex grid-area-autohide place-items-center pl-1 mod-row-header " +
              (isAuthorEnabled ? "" : "hidden")
            }
            onClick={() => setSortingType(SortingType.Author)}
          >
            {modRowSorting.isAuthorSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
            <span className={`cursor-pointer ${modRowSorting.isAuthorSort(sortingType) && "font-semibold"}`}>
              {localized.author}
            </span>
          </div>
          <div
            className="flex grid-area-autohide place-items-center pl-1 mod-row-header"
            onClick={() => setSortingType(SortingType.LastUpdated)}
            onContextMenu={() => setSortingType(SortingType.SubbedTime)}
          >
            {(modRowSorting.isLastUpdatedSort(sortingType) || modRowSorting.isSubbedTimeSort(sortingType)) &&
              modRowSorting.getSortingArrow(sortingType)}
            <Tooltip placement="left" style="light" content={localized.sortBySubscribedDate}>
              <span
                className={`cursor-pointer ${
                  (modRowSorting.isLastUpdatedSort(sortingType) ||
                    modRowSorting.isSubbedTimeSort(sortingType)) &&
                  "font-semibold"
                }`}
              >
                {(modRowSorting.isSubbedTimeSort(sortingType) && localized.subscriptionTime) ||
                  localized.lastUpdated}
              </span>
            </Tooltip>
          </div>
          <div
            className="flex place-items-center pl-1 mod-row-header rounded-tr-xl justify-center"
            onClick={() => setSortingType(SortingType.IsCustomizable)}
          >
            {modRowSorting.isCustomizableSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
            <span
              className={`cursor-pointer ${modRowSorting.isCustomizableSort(sortingType) && "font-semibold"}`}
            >
              <GoGear></GoGear>
            </span>
          </div>

          {currentTab == "mods" && props.scrollElement.current && (
            <WindowScroller scrollElement={props.scrollElement.current as Element}>
              {({ height, isScrolling, onChildScroll, scrollTop, registerChild }) => (
                <AutoSizer disableHeight>
                  {({ width }) => (
                    // @ts-expect-error react-virtualized is outdated and registerChild complains about wrong type
                    <div ref={registerChild}>
                      <List
                        ref={listRef}
                        autoHeight
                        height={height || 500}
                        width={width}
                        scrollTop={scrollTop}
                        isScrolling={isScrolling}
                        onScroll={onChildScroll}
                        // rowHeight={areThumbnailsEnabled ? 112 - 8 : 32}
                        rowHeight={({ index }: { index: number }) =>
                          areThumbnailsEnabled
                            ? Math.max(112 - 8, cache.rowHeight({ index }))
                            : cache.rowHeight({ index })
                        }
                        rowRenderer={Row}
                        estimatedRowSize={areThumbnailsEnabled ? 104 : 32}
                        rowCount={visibleMods.length}
                        overscanRowCount={areThumbnailsEnabled ? 6 : 12}
                        deferredMeasurementCache={cache}
                      />
                    </div>
                  )}
                </AutoSizer>
              )}
            </WindowScroller>
          )}
          {currentTab == "enabledMods" &&
            rowData.map(
              (
                {
                  mod,
                  isAlwaysEnabled,
                  isEnabledInMergedMod,
                  thumbnailSrc,
                  decodedHumanName,
                  decodedAuthor,
                  customFolderPath,
                  hasDbCustomization,
                  hasFlowCustomization,
                  hasPackDataOverwrite,
                },
                i
              ) => (
              <ModRow
                key={mod.path}
                {...{
                  loadOrderIndex: loadOrderIndexByModName.get(mod.name) ?? i,
                  rowIndex: i,
                  mod,
                  onRowHoverStart,
                  onRowHoverEnd,
                  onSetLoadOrderMode,
                  onSelectLoadOrderPosition,
                  activeLoadOrderPosition,
                  isLoadOrderPlacementMode: !!loadOrderModName,
                  isLoadOrderPlacementSource: mod.name === loadOrderModName,
                  isRecentlyReordered: recentlyReorderedModNames.has(mod.name),
                  onModToggled,
                  onModRightClick,
                  onCustomizeModClicked,
                  onCustomizeModRightClick,
                  onFlowOptionsClicked,
                  onRemoveModOrder,
                  sortingType,
                  currentTab,
                  isLast: rowData.length == i + 1,
                  isAlwaysEnabled,
                  isEnabledInMergedMod,
                  areThumbnailsEnabled,
                  isAuthorEnabled,
                  ghostClass,
                  thumbnailSrc,
                  decodedHumanName,
                  decodedAuthor,
                  customFolderPath,
                  hasDbCustomization,
                  hasFlowCustomization,
                  hasPackDataOverwrite,
                  style: {},
                  gridClass: "row",
                  registerChild: emptyFunc,
                }}
              ></ModRow>
            ))}
        </div>
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
