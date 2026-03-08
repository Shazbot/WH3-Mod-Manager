import React, {
  CSSProperties,
  memo,
  RefObject,
  useCallback,
  useContext,
  useEffect,
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
import { getFilteredMods, sortByNameAndLoadOrder } from "../modSortingHelpers";
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

const getVisibleMods = (mods: Mod[], hiddenModNames: Set<string>) => {
  const dataPackNames = new Set(mods.filter((mod) => mod.isInData).map((mod) => mod.name));

  return mods.filter((mod) => (mod.isInData || !dataPackNames.has(mod.name)) && !hiddenModNames.has(mod.name));
};

const MemoizedFloatingOverlay = memo(FloatingOverlay);

type ModRowsProps = {
  scrollElement: RefObject<HTMLDivElement>;
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
  const modBeingCustomized = useAppSelector((state) => state.app.modBeingCustomized);
  const isDev = useAppSelector((state) => state.app.isDev);

  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isFlowOptionsModalOpen, setIsFlowOptionsModalOpen] = useState<boolean>(false);
  const [flowOptionsModSelected, setFlowOptionsModSelected] = useState<Mod | undefined>();
  // const [modBeingCustomized, setModBeingCustomized] = useState<Mod>();
  const [contextMenuMod, setContextMenuMod] = useState<Mod>();
  const [dropdownReferenceElement, setDropdownReferenceElement] = useState<HTMLDivElement>();

  const isCurrentTabEnabledMods = currentTab == "enabledMods";

  const localized: Record<string, string> = useContext(localizationContext);

  const rowsParentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<List>(null);
  const currentDragTargetRef = useRef<Element>();
  const draggedModIdRef = useRef("");

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

  let mods: Mod[] = modRowSorting.getSortedMods(presetMods, orderedMods, sortingType, customizableMods);

  if (isDev) {
    // duplicates happen when we hot-reload in dev
    const modsWithoutDuplicates: Mod[] = [];
    mods.forEach((mod) => {
      if (!modsWithoutDuplicates.find((modNoDupes) => modNoDupes.name == mod.name))
        modsWithoutDuplicates.push(mod);
    });
    mods = modsWithoutDuplicates;
  }

  const unfilteredMods = mods;
  if (filter !== "") {
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

  const onDragEnd = useCallback(() => {
    const draggedModId = draggedModIdRef.current;
    let oldTop = -1;
    const originalElement = draggedModId !== "" ? document.getElementById(draggedModId) : null;
    if (originalElement && originalElement.children[1]) {
      oldTop = originalElement.children[1].getBoundingClientRect().top;
    }

    [...document.getElementsByClassName("row-bg-color-manually")].forEach((element) => {
      element.classList.remove("row-bg-color-manually");
    });

    const body = document.getElementById("body");
    if (body) body.classList.remove("disable-row-hover");

    setTimeout(() => {
      const modsGrid = document.getElementById("modsGrid");
      if (modsGrid) {
        const ghosts = modsGrid.getElementsByClassName("drop-ghost");
        for (const ghost of ghosts) {
          if (!ghost.classList.contains("hidden")) {
            ghost.classList.add("hidden");
          }
        }
      }

      setTimeout(() => {
        const draggedElement = draggedModId !== "" ? document.getElementById(draggedModId) : null;
        if (oldTop != -1 && draggedElement && draggedElement.children[1]) {
          const newTop = draggedElement.children[1].getBoundingClientRect().top;
          document.getElementById("mod-rows-scroll")?.scrollBy(0, newTop - oldTop);
        }
        draggedModIdRef.current = "";
      }, 50);
    }, 100);
  }, []);

  const onDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    console.log("DRAG START");
    const t = e.target as HTMLDivElement;
    const draggedModId = t.id.replace("drag-icon-", "");

    e.dataTransfer.effectAllowed = "move";
    // console.log(`setting data ${t.id}`);
    e.dataTransfer.setData("text/plain", draggedModId);
    draggedModIdRef.current = draggedModId;

    console.log("idOfDragged");
    console.log(draggedModId);
    console.log("111");
    console.log(rowsParentRef.current?.clientHeight);
    console.log(rowsParentRef.current?.scrollTop);
    console.log(rowsParentRef.current?.getBoundingClientRect());
    console.log("docu scroll", document.scrollingElement?.scrollTop);
    const originalElement = document.getElementById("rowsParent");
    // console.log("orig", !!originalElement, !!originalElement?.parentElement);
    // if (!originalElement || !originalElement.parentElement) return;
    console.log(originalElement?.getBoundingClientRect());
    console.log(originalElement?.offsetTop);

    const body = document.getElementById("body");
    if (body) body.classList.add("disable-row-hover");

    // console.log(t.id.replace("drag-icon-", ""));
    const row = document.getElementById(draggedModId);
    row?.classList.add("row-bg-color-manually");

    // const elTop = t.offsetTop;
    // const viewportHeight = window.innerHeight;

    const viewportOffset = t.parentElement?.getBoundingClientRect();
    const oldTop = viewportOffset?.top;
    // these are relative to the viewport, i.e. the window

    setTimeout(() => {
      const modsGrid = document.getElementById("modsGrid");
      if (modsGrid) {
        const ghosts = modsGrid.getElementsByClassName("drop-ghost");
        for (const ghost of ghosts) {
          if (ghost.classList.contains("hidden")) ghost.classList.remove("hidden");
        }
      }
      setTimeout(() => {
        const newTop = t.parentElement?.getBoundingClientRect().top;
        if (oldTop && newTop) document.getElementById("mod-rows-scroll")?.scrollBy(0, newTop - oldTop);

        // t.parentElement?.scrollIntoView({ block: "center" });
      }, 50);
    }, 50);
  }, []);

  const onDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer.types.length > 1) return;
      const t = e.currentTarget as HTMLDivElement;

      if (currentDragTargetRef.current && t === currentDragTargetRef.current.parentElement) return;

      if (!document.getElementById("drop-ghost")) {
        //   // ghost.parentElement.removeChild(ghost);
        //   const newE = document.createElement("div");
        //   newE.id = "drop-ghost";
        //   newE.dataset.rowId = t.id;
        //   newE.classList.add("drop-ghost");
        //   newE.classList.add(getGhostClass());
        //   if (areThumbnailsEnabled) newE.classList.add("h-10");
        //   else newE.classList.add("h-8");
        //   newE.addEventListener("dragover", (e) => {
        //     e.preventDefault();
        //   });
        //   newE.addEventListener("drop", (e) => {
        //     e.preventDefault();
        //     const draggedId = e.dataTransfer?.getData("text/plain");
        //     if (!draggedId || draggedId === "") return;
        //     const currentTarget = e.currentTarget as HTMLElement;
        //     // console.log("dropped on ghost: " + currentTarget.id);
        //     // console.log("isBottomDrop: " + isBottomDrop);
        //     if (!currentTarget.nextElementSibling) return;
        //     const rowId = currentTarget.nextElementSibling.id;
        //     afterDrop(draggedId, rowId);
        //     onDragEnd();
        //   });
      }

      // console.log("DRAG ENTER");
      currentDragTargetRef.current = t.children[0];

      e.stopPropagation();
    },
    []
  );

  const onDragLeave = useCallback(() => {
    // console.log("onDragLeave");
    // e.stopPropagation();
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // console.log("onDragOver");
    // e.stopPropagation();
    e.preventDefault();
    // return false;
  }, []);

  const onDrop = useCallback((visualModList: Mod[]) => {
    return (e: React.DragEvent<HTMLDivElement>, setAfterMod = false) => {
      try {
        console.log("onDrop");
        // console.log(`dragged id with ${e.dataTransfer.getData("text/plain")}`);
        const droppedId = e.dataTransfer.getData("text/plain");
        if (droppedId === "") return;
        draggedModIdRef.current = droppedId;

        console.log("in ondrop droppedID", droppedId);

        const t = e.currentTarget as HTMLDivElement;
        console.log(`DROPPED ONTO ${t.id}`);
        // console.log(`DROPPED ONTO`, t);

        if (t.classList.contains("drop-ghost")) {
          console.log("dropped onto ghost");
          // if (!t.parentElement || t.parentElement?.id != droppedId) return;
          if (!t.parentElement) return;

          // console.log("droppend on top ghost");
          // console.log("first", t.parentElement?.id);
          // console.log("first", droppedId);
          // console.log(22);
          // console.log("nextElementSibling:", t.parentElement?.nextElementSibling);
          // console.log(2233);
          const modNameRelativeTo = t.parentElement?.id;
          if (modNameRelativeTo) {
            e.preventDefault();
            e.stopPropagation();
            dispatch(
              setModLoadOrderRelativeTo({
                modNameToChange: droppedId,
                modNameRelativeTo,
                visualModList,
                setAfterMod,
              } as ModLoadOrderRelativeTo)
            );
          }
          return;
        }

        if (droppedId === t.id) return;
        // console.log("isBottomDrop: " + isBottomDrop);
        // if (!t.nextElementSibling) return;
        dispatch(
          setModLoadOrderRelativeTo({
            modNameToChange: droppedId,
            modNameRelativeTo: t.id,
            visualModList,
            setAfterMod,
          } as ModLoadOrderRelativeTo)
        );
      } catch (e) {
        console.log(e);
      }
      // onDragEnd();
      // e.stopPropagation();
    };
  }, [dispatch]);

  const onDrag = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (e.clientY < 150) {
        const yRatio = e.clientY / 150;
        document.getElementById("mod-rows-scroll")?.scrollBy(0, -(20 * yRatio + 60 * (1 - yRatio)));
      }

      if (e.clientY > innerHeight - 75) {
        const yRatio = (e.clientY - (innerHeight - 75)) / 75;
        document.getElementById("mod-rows-scroll")?.scrollBy(0, 60 * yRatio + 20 * (1 - yRatio));
      }
    },
    []
  );

  const onRowHoverStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
      if (sortingType !== SortingType.Ordered) return;

      const element = e.currentTarget as HTMLDivElement;
      const dragIcon = document.getElementById(`drag-icon-${element.id}`);
      if (dragIcon) dragIcon.classList.remove("hidden");
    },
    [sortingType]
  );

  const onRowHoverEnd = useCallback((e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
    const element = e.currentTarget as HTMLDivElement;
    const dragIcon = document.getElementById(`drag-icon-${element.id}`);
    if (dragIcon) dragIcon.classList.add("hidden");
  }, []);

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

  const visibleMods = useMemo(() => getVisibleMods(mods, hiddenModNames), [hiddenModNames, mods]);

  const unfilteredVisibleMods = useMemo(
    () => getVisibleMods(unfilteredMods, hiddenModNames),
    [hiddenModNames, unfilteredMods]
  );

  const rowData = useMemo(
    () =>
      visibleMods.map((mod) => ({
        mod,
        isAlwaysEnabled: alwaysEnabledModNames.has(mod.name),
        isEnabledInMergedMod: mergedModPaths.has(mod.path),
      })),
    [alwaysEnabledModNames, mergedModPaths, visibleMods]
  );

  const onDropWithVisibleMods = useCallback(() => {
    return onDrop(unfilteredVisibleMods);
  }, [unfilteredVisibleMods, onDrop]);

  const onDropMemoized = useMemo(() => onDropWithVisibleMods(), [onDropWithVisibleMods]);
  // eslint-disable-next-line @typescript-eslint/no-empty-function
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
              index,
              gridClass,
              mod: row.mod,
              onRowHoverStart,
              onRowHoverEnd,
              onDrop: isCurrentTabEnabledMods ? onDropMemoized : emptyFunc,
              onDrag,
              onDragStart,
              onDragLeave,
              onDragEnter,
              onDragOver,
              onDragEnd,
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
        onDragEnd={onDragEnd}
        className={`dark:text-slate-100 ` + (areThumbnailsEnabled ? "text-lg" : "")}
        id="rowsParent"
        ref={rowsParentRef}
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
            visibleMods={unfilteredVisibleMods}
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
            rowData.map(({ mod, isAlwaysEnabled, isEnabledInMergedMod }, i) => (
              <ModRow
                key={mod.path}
                {...{
                  index: i,
                  mod,
                  onRowHoverStart,
                  onRowHoverEnd,
                  onDrop: isCurrentTabEnabledMods ? onDropMemoized : emptyFunc,
                  onDrag,
                  onDragStart,
                  onDragLeave,
                  onDragEnter,
                  onDragOver,
                  onDragEnd,
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
                  style: {},
                  gridClass,
                  registerChild: emptyFunc,
                }}
              ></ModRow>
            ))}
        </div>
      </div>
    </>
  );
});

export default ModRows;
