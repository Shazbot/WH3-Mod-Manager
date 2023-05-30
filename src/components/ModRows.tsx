import React, { useCallback, useState } from "react";
import "../index.css";
import { useAppDispatch, useAppSelector } from "../hooks";
import { toggleMod, enableAll, disableAllMods, setModLoadOrder, resetModLoadOrder } from "../appSlice";
import { Alert, Tooltip } from "flowbite-react";
import { getFilteredMods, sortByNameAndLoadOrder } from "../modSortingHelpers";
import { FloatingOverlay } from "@floating-ui/react";
import ModDropdown from "./ModDropdown";
import { isModAlwaysEnabled } from "../modsHelpers";
import * as modRowSorting from "../utility/modRowSorting";
import { SortingType } from "../utility/modRowSorting";
import ModRow from "./ModRow";

let currentDragTarget: Element;
let dropOutlineElement: HTMLDivElement;
let isBottomDrop = false;

const onDragEnd = (e?: React.DragEvent<HTMLDivElement>) => {
  console.log("onDragEnd");

  const ghost = document.getElementById("drop-ghost");
  if (ghost && ghost.parentElement) {
    ghost.parentElement.removeChild(ghost);
  }

  [...document.getElementsByClassName("row-bg-color-manually")].forEach((element) => {
    element.classList.remove("row-bg-color-manually");
  });

  const body = document.getElementById("body");
  if (body) body.classList.remove("disable-row-hover");
  // e.stopPropagation();
};

export default function ModRows() {
  const dispatch = useAppDispatch();
  const filter = useAppSelector((state) => state.app.filter);
  const hiddenMods = useAppSelector((state) => state.app.hiddenMods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);
  const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);
  const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);
  const currentTab = useAppSelector((state) => state.app.currentTab);

  const [sortingType, setSortingType] = useState<SortingType>(SortingType.Ordered);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [contextMenuMod, setContextMenuMod] = useState<Mod>();
  const [dropdownReferenceElement, setDropdownReferenceElement] = useState<HTMLDivElement>();

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
  const orderedMods = sortByNameAndLoadOrder(modsToOrder);

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

      const lastScrollTop = document.scrollingElement?.scrollTop;

      // if always enabled don't allow unchecking
      if (isModAlwaysEnabled(mod, alwaysEnabledMods)) {
        return;
      }

      dispatch(toggleMod(mod));

      setTimeout(() => {
        if (lastScrollTop && document.scrollingElement) document.scrollingElement.scrollTop = lastScrollTop;
      }, 1);
    },
    [mods]
  );

  const onEnabledRightClick = useCallback(() => {
    if (mods.every((mod) => mod.isEnabled)) {
      dispatch(disableAllMods());
    } else {
      dispatch(enableAll());
    }
  }, [mods]);

  const onOrderRightClick = useCallback(() => {
    dispatch(resetModLoadOrder(mods.filter((mod) => mod.loadOrder !== undefined)));
  }, [mods, resetModLoadOrder]);

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

    const body = document.getElementById("body");
    if (body) body.classList.add("disable-row-hover");

    // console.log(t.id.replace("drag-icon-", ""));
    const row = document.getElementById(t.id.replace("drag-icon-", ""));
    row?.classList.add("row-bg-color-manually");
    // e.stopPropagation();
  }, []);

  const getGhostClass = useCallback(() => {
    console.log(isAuthorEnabled, areThumbnailsEnabled);
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
        // ghost.parentElement.removeChild(ghost);
        const newE = document.createElement("div");
        dropOutlineElement = newE;
        newE.id = "drop-ghost";
        newE.dataset.rowId = t.id;
        newE.classList.add("drop-ghost");
        newE.classList.add(getGhostClass());
        if (areThumbnailsEnabled) newE.classList.add("h-10");
        else newE.classList.add("h-8");

        newE.addEventListener("dragover", (e) => {
          e.preventDefault();
        });
        newE.addEventListener("drop", (e) => {
          e.preventDefault();
          const draggedId = e.dataTransfer?.getData("text/plain");
          if (!draggedId || draggedId === "") return;

          const currentTarget = e.currentTarget as HTMLElement;
          // console.log("dropped on ghost: " + currentTarget.id);
          // console.log("isBottomDrop: " + isBottomDrop);

          if (!currentTarget.nextElementSibling) return;

          const rowId = currentTarget.nextElementSibling.id;
          afterDrop(draggedId, rowId);
          onDragEnd();
        });
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
    // console.log("onDragLeave");
    // e.stopPropagation();
  }, []);
  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // console.log("onDragOver");
    // e.stopPropagation();
    e.preventDefault();
    // return false;
  }, []);
  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // console.log("onDrop");
    // console.log(`dragged id with ${e.dataTransfer.getData("text/plain")}`);
    const droppedId = e.dataTransfer.getData("text/plain");
    if (droppedId === "") return;

    const t = e.currentTarget as HTMLDivElement;
    // console.log(`DROPPED ONTO ${t.id}`);

    if (droppedId === t.id) return;

    // console.log("isBottomDrop: " + isBottomDrop);
    if (!t.nextElementSibling) return;
    const rowId = (isBottomDrop ? (t.nextElementSibling.nextElementSibling as HTMLElement) : t).id;

    afterDrop(droppedId, rowId);
    onDragEnd();
    // e.stopPropagation();
  }, []);
  const onDrag = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // console.log(e.currentTarget);

      if (e.dataTransfer.types.length > 1) return;

      if (!currentDragTarget) {
        console.log("CURRENT DRAG TARGET MISSING");
        return;
      }
      // if (currentDragTarget.parentElement !== e.currentTarget) return;

      // const newE = document.getElementById("drop-ghost");
      if (!dropOutlineElement) {
        console.log("NEWE MISSING");
        return;
      }

      // TODO investigate, performance issuses
      return;
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
    if (!document.scrollingElement) return;
    const lastScrollTop = document.scrollingElement.scrollTop;
    setIsDropdownOpen(false);

    setTimeout(() => {
      if (document.scrollingElement) document.scrollingElement.scrollTop = lastScrollTop;
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
          onClick={() => modRowSorting.onOrderedSort(setSortingType)}
          onContextMenu={onOrderRightClick}
        >
          {modRowSorting.isOrderSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <Tooltip
            placement="bottom"
            style="light"
            content={
              <>
                <div>Mods with lower order have higher priority.</div>
                <div>Right click on mod number to reset or here to reset all.</div>
                <div className="text-red-600 font-bold">
                  Don't change mod priority unless you really know what you're doing!
                </div>
              </>
            }
          >
            <span
              className={`text-center w-full ${modRowSorting.isOrderSort(sortingType) && "font-semibold"}`}
            >
              Order
            </span>
          </Tooltip>
        </div>
        <div
          className="flex place-items-center w-full justify-center z-10 mod-row-header"
          onClick={() => modRowSorting.onEnabledSort(setSortingType)}
          onContextMenu={onEnabledRightClick}
          id="enabledHeader"
        >
          {modRowSorting.isEnabledSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <Tooltip placement="right" style="light" content="Right click to enable or disable all mods">
            <span
              className={`text-center w-full ${modRowSorting.isEnabledSort(sortingType) && "font-semibold"}`}
            >
              Enabled
            </span>
          </Tooltip>
        </div>
        <div
          className={
            "flex grid-area-autohide place-items-center pl-1 mod-row-header " +
            (areThumbnailsEnabled ? "" : "hidden")
          }
        >
          Thumbnail
        </div>
        <div
          className="flex grid-area-packName place-items-center pl-1 mod-row-header"
          onClick={() => modRowSorting.onPackSort(setSortingType)}
          onContextMenu={() => modRowSorting.onIsDataPackSort(setSortingType)}
        >
          {(modRowSorting.isPackNameSort(sortingType) || modRowSorting.isDataPackSort(sortingType)) &&
            modRowSorting.getSortingArrow(sortingType)}
          <Tooltip placement="right" style="light" content="Right click to switch to sorting by data packs">
            <span
              className={`${
                (modRowSorting.isPackNameSort(sortingType) || modRowSorting.isDataPackSort(sortingType)) &&
                "font-semibold"
              }`}
            >
              {(modRowSorting.isDataPackSort(sortingType) && "Data Packs") || "Pack"}
            </span>
          </Tooltip>
        </div>

        <div
          className="flex grid-area-humanName place-items-center pl-1 mod-row-header"
          onClick={() => modRowSorting.onNameSort(setSortingType)}
        >
          {modRowSorting.isHumanNameSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <span className={`${modRowSorting.isHumanNameSort(sortingType) && "font-semibold"}`}>Name</span>
        </div>
        <div
          className={
            "flex grid-area-autohide place-items-center pl-1 mod-row-header " +
            (isAuthorEnabled ? "" : "hidden")
          }
          onClick={() => modRowSorting.onAuthorSort(setSortingType)}
        >
          {modRowSorting.isAuthorSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <span className={`${modRowSorting.isAuthorSort(sortingType) && "font-semibold"}`}>Author</span>
        </div>
        <div
          className="flex grid-area-autohide place-items-center pl-1 mod-row-header rounded-tr-xl"
          onClick={() => modRowSorting.onLastUpdatedSort(setSortingType)}
          onContextMenu={() => modRowSorting.onSubbedTimeSort(setSortingType)}
        >
          {(modRowSorting.isLastUpdatedSort(sortingType) || modRowSorting.isSubbedTimeSort(sortingType)) &&
            modRowSorting.getSortingArrow(sortingType)}
          <Tooltip
            placement="left"
            style="light"
            content="Right click to switch to sorting by subscribed date"
          >
            <span
              className={`${
                (modRowSorting.isLastUpdatedSort(sortingType) ||
                  modRowSorting.isSubbedTimeSort(sortingType)) &&
                "font-semibold"
              }`}
            >
              {(modRowSorting.isSubbedTimeSort(sortingType) && "Subscription Time") || "Last Updated"}
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
          .map((mod) => (
            <ModRow
              key={mod.path}
              {...{
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
}
