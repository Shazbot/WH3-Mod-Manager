import React, { memo, useCallback, useContext, useEffect, useRef, useState } from "react";
import "../index.css";
import { useAppDispatch, useAppSelector } from "../hooks";
import {
  toggleMod,
  enableAll,
  disableAllMods,
  setModLoadOrder,
  resetModLoadOrder,
  setModRowsSortingType,
  setModLoadOrderRelativeTo,
  resetModLoadOrderAll,
} from "../appSlice";
import { Alert, Tooltip } from "flowbite-react";
import { getFilteredMods, sortByNameAndLoadOrder } from "../modSortingHelpers";
import { FloatingOverlay } from "@floating-ui/react";
import ModDropdown from "./ModDropdown";
import { isModAlwaysEnabled } from "../modsHelpers";
import * as modRowSorting from "../utility/modRowSorting";
import { SortingType } from "../utility/modRowSorting";
import ModRow from "./ModRow";
import localizationContext from "../localizationContext";

let currentDragTarget: Element;
let dropOutlineElement: HTMLDivElement;
let isBottomDrop = false;
let idOfDragged = "";

const onDragEnd = (e?: React.DragEvent<HTMLDivElement>) => {
  console.log("onDragEnd");

  // console.log("on drag end height", rowsParentRef.current?.clientHeight);
  // console.log("on drag end height", rowsParentRef.current?.getBoundingClientRect());
  // console.log("on drag end height", rowsParentRef.current?.scrollTop);
  console.log("on drag end SCR 1", document.scrollingElement?.scrollTop);

  // const ghost = document.getElementById("drop-ghost");
  // if (ghost && ghost.parentElement) {
  //   ghost.parentElement.removeChild(ghost);
  // }

  // console.log("idOfDragged");
  console.log(idOfDragged);
  // console.log("111");
  let oldTop = -1;
  const originalElement = (idOfDragged != "" && document.getElementById(idOfDragged)) || null;
  // // console.log("orig", !!originalElement, !!originalElement?.parentElement);
  // // if (!originalElement || !originalElement.parentElement) return;
  // const oldTop = originalElement?.getBoundingClientRect().top;
  // console.log(originalElement?.getBoundingClientRect(), oldTop);
  // console.log(originalElement?.offsetTop);
  if (originalElement && originalElement.children[1]) {
    console.log("first child rect", originalElement?.children[1].getBoundingClientRect());

    oldTop = originalElement.children[1].getBoundingClientRect().top;
  }

  [...document.getElementsByClassName("row-bg-color-manually")].forEach((element) => {
    element.classList.remove("row-bg-color-manually");
  });

  const body = document.getElementById("body");
  if (body) body.classList.remove("disable-row-hover");
  // e.stopPropagation();

  setTimeout(() => {
    const modsGrid = document.getElementById("modsGrid");
    if (modsGrid) {
      const ghosts = modsGrid.getElementsByClassName("drop-ghost");
      for (const ghost of ghosts) {
        if (!ghost.classList.contains("hidden")) {
          //     console.log("found one");
          //     console.log(e?.clientY);
          //     console.log(ghost.getBoundingClientRect());
          ghost.classList.add("hidden");
        }
      }
    }

    setTimeout(() => {
      const originalElement = (idOfDragged != "" && document.getElementById(idOfDragged)) || null;
      // // console.log("orig", !!originalElement, !!originalElement?.parentElement);
      // // if (!originalElement || !originalElement.parentElement) return;
      // const oldTop = originalElement?.getBoundingClientRect().top;
      // console.log(originalElement?.getBoundingClientRect(), oldTop);
      // console.log(originalElement?.offsetTop);
      if (oldTop != -1 && originalElement && originalElement.children[1]) {
        console.log("first child rect AFTER", originalElement?.children[1].getBoundingClientRect());
        const newTop = originalElement.children[1].getBoundingClientRect().top;

        document.getElementById("mod-rows-scroll")?.scrollBy(0, newTop - oldTop);
      }

      // console.log("on drag end SCR 2", document.scrollingElement?.scrollTop);
      // const newTop = originalElement?.getBoundingClientRect().top;
      // console.log("oldtop", oldTop, "newtop", newTop);
      // if (oldTop && newTop) {
      //   window.scrollBy(0, newTop - oldTop);
      //   console.log("scrolled by", newTop - oldTop);
      // }
    }, 50);
  }, 100);
};

const ModRows = memo(() => {
  const dispatch = useAppDispatch();
  const areModsInOrder = useAppSelector((state) => state.app.currentPreset.version) != undefined;
  const filter = useAppSelector((state) => state.app.filter);
  const hiddenMods = useAppSelector((state) => state.app.hiddenMods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);
  const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);
  const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const sortingType = useAppSelector((state) => state.app.modRowsSortingType);

  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [contextMenuMod, setContextMenuMod] = useState<Mod>();
  const [dropdownReferenceElement, setDropdownReferenceElement] = useState<HTMLDivElement>();

  const localized: Record<string, string> = useContext(localizationContext);

  const rowsParentRef = useRef<HTMLDivElement>(null);

  let presetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const enabledMods = presetMods.filter(
    (iterMod) => iterMod.isEnabled || alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
  );
  if (currentTab == "enabledMods") {
    presetMods = enabledMods;
  }
  const enabledMergeMods = enabledMods.filter((mod) => mod.mergedModsData);

  const modsToOrder = presetMods.filter((iterMod) => {
    const isHidden = hiddenMods.find((mod) => mod.name === iterMod.name);
    const isAlwaysEnabled = alwaysEnabledMods.find((mod) => iterMod.name === mod.name);
    return !isHidden || (isHidden && isAlwaysEnabled);
  });
  const orderedMods = (areModsInOrder && modsToOrder) || sortByNameAndLoadOrder(modsToOrder);

  let mods: Mod[] = modRowSorting.getSortedMods(presetMods, orderedMods, sortingType);

  if (filter !== "") {
    mods = getFilteredMods(mods, filter.toLowerCase(), isAuthorEnabled);
  }

  // duplicates happen when we hot-reload in dev
  const modsWithoutDuplicates: Mod[] = [];
  mods.forEach((mod) => {
    if (!modsWithoutDuplicates.find((modNoDupes) => modNoDupes.name == mod.name))
      modsWithoutDuplicates.push(mod);
  });
  mods = modsWithoutDuplicates;

  const onModToggled = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const target = event.target as HTMLInputElement;
      const name = target.name;
      const mod = mods.find((mod) => mod.workshopId == name);
      if (!mod) return;

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
    },
    [mods]
  );

  const setSortingType = useCallback(
    (newSortingType: SortingType) => {
      dispatch(setModRowsSortingType(modRowSorting.getNewSortType(newSortingType, sortingType)));
    },
    [dispatch, setModRowsSortingType, sortingType]
  );

  const onEnabledRightClick = useCallback(() => {
    if (mods.every((mod) => mod.isEnabled)) {
      dispatch(disableAllMods());
    } else {
      dispatch(enableAll());
    }
  }, [mods]);

  const onOrderRightClick = useCallback(() => {
    dispatch(resetModLoadOrderAll());
  }, [resetModLoadOrderAll]);

  const afterDrop = useCallback((originalId: string, droppedOnId: string) => {
    // console.log(`----DROPPED----`);
    // console.log(`dragged id with ${originalId}`);
    // console.log(`DROPPED ONTO ${droppedOnId}`);

    const droppedOnElement = document.getElementById(droppedOnId);
    if (!droppedOnElement || !droppedOnElement.parentElement) return;

    const index =
      [...droppedOnElement.parentElement.children]
        .filter((ele) => ele.id !== "drop-ghost")
        .indexOf(droppedOnElement) - 8;

    const originalElement = document.getElementById(originalId);
    if (!originalElement || !originalElement.parentElement) return;
    const originalElementindex =
      [...originalElement.parentElement.children]
        .filter((ele) => ele.id !== "drop-ghost")
        .indexOf(originalElement) - 8;

    let loadOrder: number | null = null;

    let prevElement: HTMLDivElement = droppedOnElement.previousElementSibling as HTMLDivElement;
    if (prevElement.id === "drop-ghost") prevElement = prevElement.previousElementSibling as HTMLDivElement;
    const prevElementOnLoadOrder = prevElement.dataset.loadOrder;

    if (prevElementOnLoadOrder != null && prevElement.id !== originalId) {
      loadOrder = Number(prevElementOnLoadOrder) + ((originalElementindex >= index && 1) || 0);

      console.log("PREV ELEMENT LOAD ORDER!");
      console.log("ORIG Y:", originalElementindex);
      console.log("droppedOnElementY Y:", index);
      console.log("OFFSET IS", (originalElementindex >= index && 1) || 0);
      console.log("PREV ELEMENT DROPPED load order is: " + prevElementOnLoadOrder);
      console.log("NEW LOAD ORDER IS", loadOrder);
    }

    const droppedOnLoadOrder = droppedOnElement.dataset.loadOrder;

    if (
      loadOrder == null &&
      droppedOnLoadOrder != null &&
      (prevElement.id !== originalId || Number(droppedOnLoadOrder) !== Number(prevElementOnLoadOrder) + 1)
    ) {
      console.log("NEXT ELEMENT LOAD ORDER!");
      console.log("DROPPED ON LOAD ORDER IS", droppedOnLoadOrder);
      console.log("ORIG Y:", originalElementindex);
      console.log("droppedOnElementY Y:", index);
      loadOrder = Number(droppedOnLoadOrder) + ((originalElementindex < index && -1) || 0);
      console.log("NEW LOAD ORDER IS", loadOrder);
      console.log("OFFSET IS", (originalElementindex < index && -1) || 0);
    }

    if (loadOrder == null) {
      loadOrder = index > originalElementindex ? index : index + 1;
    }

    const originalOrder = originalElementindex + 1;

    // console.log(`index is ${index}`);
    // console.log(`orig index is ${originalElementindex}`);
    // console.log(`loadOrder is ${loadOrder}`);
    // console.log(`originalOrder is ${originalOrder}`);

    dispatch(setModLoadOrder({ modName: originalId, loadOrder, originalOrder }));
  }, []);

  const onDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    console.log("DRAG START");
    const t = e.target as HTMLDivElement;

    e.dataTransfer.effectAllowed = "move";
    // console.log(`setting data ${t.id}`);
    e.dataTransfer.setData("text/plain", t.id.replace("drag-icon-", ""));

    console.log("idOfDragged");
    console.log(t.id.replace("drag-icon-", ""));
    console.log("111");
    console.log(rowsParentRef.current?.clientHeight);
    console.log(rowsParentRef.current?.scrollTop);
    console.log(rowsParentRef.current?.getBoundingClientRect());
    console.log("docu scroll", document.scrollingElement?.scrollTop);
    const originalElement = (idOfDragged != "" && document.getElementById("rowsParent")) || null;
    // console.log("orig", !!originalElement, !!originalElement?.parentElement);
    // if (!originalElement || !originalElement.parentElement) return;
    console.log(originalElement?.getBoundingClientRect());
    console.log(originalElement?.offsetTop);

    const body = document.getElementById("body");
    if (body) body.classList.add("disable-row-hover");

    // console.log(t.id.replace("drag-icon-", ""));
    const row = document.getElementById(t.id.replace("drag-icon-", ""));
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

  const getGhostClass = useCallback(() => {
    if (isAuthorEnabled && areThumbnailsEnabled) return "grid-column-7";
    if (isAuthorEnabled) return "grid-column-6";
    if (areThumbnailsEnabled) return "grid-column-6";
    return "grid-column-5";
  }, [isAuthorEnabled, areThumbnailsEnabled]);

  const onDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer.types.length > 1) return;
      const t = e.currentTarget as HTMLDivElement;

      if (currentDragTarget && t === currentDragTarget.parentElement) return;

      const ghost = document.getElementById("drop-ghost");
      if (!ghost) {
        //   // ghost.parentElement.removeChild(ghost);
        //   const newE = document.createElement("div");
        //   dropOutlineElement = newE;
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
      } else {
        dropOutlineElement = ghost as HTMLDivElement;
        // newE = ghost as HTMLDivElement;
      }

      // console.log("DRAG ENTER");
      currentDragTarget = t.children[0];

      e.stopPropagation();
    },
    [getGhostClass]
  );

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const parent = e.currentTarget;
    const ghosts = parent.getElementsByClassName("drop-ghost");
    for (const ghost of ghosts) {
      // if (!ghost.classList.contains("hidden")) ghost.classList.add("hidden");
    }
    // console.log("onDragLeave");
    // e.stopPropagation();
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // console.log("onDragOver");
    // e.stopPropagation();
    e.preventDefault();
    // return false;
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      console.log("onDrop");
      // console.log(`dragged id with ${e.dataTransfer.getData("text/plain")}`);
      const droppedId = e.dataTransfer.getData("text/plain");
      if (droppedId === "") return;
      idOfDragged = droppedId;

      // if(areModsInOrder) return dispatch(setModLoadOrderRelativeTo())

      console.log("in ondrop droppedID", droppedId);

      const t = e.currentTarget as HTMLDivElement;
      console.log(`DROPPED ONTO ${t.id}`);

      if (droppedId === t.id) return;

      // console.log("isBottomDrop: " + isBottomDrop);
      if (!t.nextElementSibling) return;
      const rowId = (isBottomDrop ? (t.nextElementSibling.nextElementSibling as HTMLElement) : t).id;

      if (areModsInOrder) {
        dispatch(
          setModLoadOrderRelativeTo({
            modNameToChange: droppedId,
            modNameRelativeTo: t.id,
          } as ModLoadOrderRelativeTo)
        );
        return;
      }

      afterDrop(droppedId, rowId);
      // onDragEnd();
      // e.stopPropagation();
    },
    [areModsInOrder]
  );

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
    [currentDragTarget, dropOutlineElement]
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
  }, []);

  const [positionX, setPositionX] = useState<number>(0);
  const [positionY, setPositionY] = useState<number>(0);

  const onModRightClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>, mod: Mod) => {
      if (isDropdownOpen) return;
      setContextMenuMod(mod);

      setPositionX(e.clientX);
      setPositionY(e.clientY);

      if (innerHeight - 300 < e.clientY) {
        setPositionY(e.clientY - 300);
      }

      setIsDropdownOpen(true);
      setDropdownReferenceElement(e.currentTarget);

      e.defaultPrevented = true;
      e.stopPropagation();
    },
    [isDropdownOpen]
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

  const getGridClass = useCallback(() => {
    if (isAuthorEnabled && areThumbnailsEnabled) return "grid-mods-thumbs-author";
    if (isAuthorEnabled) return "grid-mods-author";
    if (areThumbnailsEnabled) return "grid-mods-thumbs";
    return "grid-mods";
  }, [isAuthorEnabled, areThumbnailsEnabled]);

  return (
    <div
      onDragEnd={(e) => onDragEnd(e)}
      className={`dark:text-slate-100 ` + (areThumbnailsEnabled ? "text-lg" : "")}
      id="rowsParent"
      ref={rowsParentRef}
    >
      <FloatingOverlay
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
        ></ModDropdown>
      </FloatingOverlay>
      <div className={"grid pt-1.5 parent " + getGridClass()} id="modsGrid">
        <div
          id="sortHeader"
          className="flex place-items-center w-full justify-center z-[11] mod-row-header rounded-tl-xl"
          onClick={() => setSortingType(SortingType.Ordered)}
          onContextMenu={onOrderRightClick}
        >
          {modRowSorting.isOrderSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
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
              className={`text-center w-full ${modRowSorting.isOrderSort(sortingType) && "font-semibold"}`}
            >
              {localized.order}
            </span>
          </Tooltip>
        </div>
        <div
          className="flex place-items-center w-full justify-center z-10 mod-row-header"
          onClick={() => setSortingType(SortingType.IsEnabled)}
          onContextMenu={onEnabledRightClick}
          id="enabledHeader"
        >
          {modRowSorting.isEnabledSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <Tooltip placement="right" style="light" content={localized.enableOrDisableAll}>
            <span
              className={`text-center w-full ${modRowSorting.isEnabledSort(sortingType) && "font-semibold"}`}
            >
              {localized.enabled}
            </span>
          </Tooltip>
        </div>
        <div
          className={
            "flex grid-area-autohide place-items-center pl-1 mod-row-header " +
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
              className={`${
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
          <span className={`${modRowSorting.isHumanNameSort(sortingType) && "font-semibold"}`}>
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
          <span className={`${modRowSorting.isAuthorSort(sortingType) && "font-semibold"}`}>
            {localized.author}
          </span>
        </div>
        <div
          className="flex grid-area-autohide place-items-center pl-1 mod-row-header rounded-tr-xl"
          onClick={() => setSortingType(SortingType.LastUpdated)}
          onContextMenu={() => setSortingType(SortingType.SubbedTime)}
        >
          {(modRowSorting.isLastUpdatedSort(sortingType) || modRowSorting.isSubbedTimeSort(sortingType)) &&
            modRowSorting.getSortingArrow(sortingType)}
          <Tooltip placement="left" style="light" content={localized.sortBySubscribedDate}>
            <span
              className={`${
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

        {mods
          .filter(
            (mod) =>
              mod.isInData ||
              (!mod.isInData && !mods.find((modOther) => modOther.name == mod.name && modOther.isInData))
          )
          .filter((iterMod) => !hiddenMods.find((mod) => mod.name === iterMod.name))
          .map((mod, i) => (
            <ModRow
              key={mod.path}
              {...{
                index: i,
                mod,
                onRowHoverStart,
                onRowHoverEnd,
                onDrop,
                onDrag,
                onDragStart,
                onDragLeave,
                onDragEnter,
                onDragOver,
                onDragEnd,
                onModToggled,
                onModRightClick,
                onRemoveModOrder,
                sortingType,
                isAlwaysEnabled: alwaysEnabledMods.some((iterMod) => iterMod.name === mod.name),
                isEnabledInMergedMod: enabledMergeMods.some((mergeMod) =>
                  (mergeMod.mergedModsData as MergedModsData[]).some(
                    (mergeModData) => mergeModData.path == mod.path
                  )
                ),
                loadOrder: orderedMods.indexOf(mod) + 1,
              }}
            ></ModRow>
          ))}
      </div>

      <div className="fixed bottom-5 hidden">
        <Alert
          color="success"
          onDismiss={function onDismiss() {
            return alert("Alert dismissed!");
          }}
        >
          <span>
            <span className="font-medium">Info alert!</span> Change a few things up and try submitting again.
          </span>
        </Alert>
      </div>
    </div>
  );
});

export default ModRows;
