import React, { useState } from "react";
import "./index.css";
import { useAppDispatch, useAppSelector } from "./hooks";
import { toggleMod, enableAll, disableAll, setModLoadOrder, resetModLoadOrder } from "./appSlice";
import classNames from "classnames";
import { Alert, Tooltip } from "flowbite-react";
import { formatDistanceToNow } from "date-fns";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGrip, faEraser, faCamera, faFileArchive } from "@fortawesome/free-solid-svg-icons";
import { getFilteredMods, sortByNameAndLoadOrder } from "./modSortingHelpers";
import { FloatingOverlay } from "@floating-ui/react-dom-interactions";
import ModDropdown from "./ModDropdown";
import { isModAlwaysEnabled } from "./modsHelpers";
import * as modRowSorting from "./utility/modRowSorting";
import { SortingType } from "./utility/modRowSorting";
import { HiOutlineCollection } from "react-icons/hi";

export default function ModRow() {
  const dispatch = useAppDispatch();
  const filter = useAppSelector((state) => state.app.filter);
  const hiddenMods = useAppSelector((state) => state.app.hiddenMods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);
  const isDev = useAppSelector((state) => state.app.isDev);
  const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);
  const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);

  const [sortingType, setSortingType] = useState<SortingType>(SortingType.Ordered);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [contextMenuMod, setContextMenuMod] = useState<Mod>();

  const presetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const enabledMods = presetMods.filter(
    (iterMod) => iterMod.isEnabled || alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
  );
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

  const onModToggled = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const target = event.target as HTMLInputElement;
    const name = target.name;
    const mod = mods.find((mod) => mod.workshopId == name);
    if (!mod) return;

    // if always enabled don't allow unchecking
    if (isModAlwaysEnabled(mod, alwaysEnabledMods)) {
      return;
    }

    dispatch(toggleMod(mod));
  };

  const onEnabledRightClick = () => {
    if (mods.every((mod) => mod.isEnabled)) {
      dispatch(disableAll());
    } else {
      dispatch(enableAll());
    }
  };

  const onOrderRightClick = () => {
    dispatch(resetModLoadOrder(mods.filter((mod) => mod.loadOrder !== undefined)));
  };

  const formatLastChanged = (lastChanged: number) => {
    try {
      return formatDistanceToNow(lastChanged).replace("about ", "~") + " ago";
    } catch (e) {
      console.error(e);
    }
    return "";
  };

  let currentDragTarget: Element;
  let newE: HTMLDivElement;
  let isBottomDrop = false;

  const afterDrop = (originalId: string, droppedOnId: string) => {
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
      loadOrder = Number(prevElementOnLoadOrder) + 1;
      // console.log("PREV ELEMENT DROPPED load order is: " + prevElementOnLoadOrder);
    }

    const droppedOnLoadOrder = droppedOnElement.dataset.loadOrder;
    if (
      loadOrder == null &&
      droppedOnLoadOrder != null &&
      (prevElement.id !== originalId || Number(droppedOnLoadOrder) !== Number(prevElementOnLoadOrder) + 1)
    ) {
      loadOrder = Number(droppedOnLoadOrder);
    }

    if (loadOrder == null) {
      loadOrder = index > originalElementindex ? index : index + 1;
    }

    const originalOrder = originalElementindex + (index > originalElementindex ? 1 : 0);

    // console.log(`index is ${index}`);
    // console.log(`orig index is ${originalElementindex}`);
    // console.log(`loadOrder is ${loadOrder}`);
    // console.log(`originalOrder is ${originalOrder}`);

    dispatch(setModLoadOrder({ modName: originalId, loadOrder, originalOrder }));
  };

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // console.log("DRAG START");
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
  };

  const onDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    // console.log("onDragEnd");

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

  const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.length > 1) return;
    const t = e.currentTarget as HTMLDivElement;

    if (currentDragTarget && t === currentDragTarget.parentElement) return;

    const ghost = document.getElementById("drop-ghost");
    if (!ghost) {
      // ghost.parentElement.removeChild(ghost);
      newE = document.createElement("div");
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
      });
    } else {
      newE = ghost as HTMLDivElement;
    }

    // console.log("DRAG ENTER");
    currentDragTarget = t.children[0];

    e.stopPropagation();
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // console.log("onDragLeave");
    // e.stopPropagation();
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // console.log("onDragOver");
    // e.stopPropagation();
    e.preventDefault();
    // return false;
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
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
    // e.stopPropagation();
  };
  const onDrag = (e: React.DragEvent<HTMLDivElement>) => {
    // console.log(e.currentTarget);

    if (e.dataTransfer.types.length > 1) return;

    if (!currentDragTarget) {
      console.log("CURRENT DRAG TARGET MISSING");
      return;
    }
    // if (currentDragTarget.parentElement !== e.currentTarget) return;

    // const newE = document.getElementById("drop-ghost");
    if (!newE) {
      console.log("NEWE MISSING");
      return;
    }

    // if (ghost) {
    //   t.parentElement.removeChild(ghost);
    // }

    // console.log("DRAG ENTER");
    // const tch = t.children[0];
    // console.log(tch.innerHTML);
    // console.log(tch.clientHeight);
    // console.log(tch.getBoundingClientRect());
    const boundingRect = currentDragTarget.getBoundingClientRect();
    // console.log(e.clientX);
    // console.log(e.clientY);
    // const newE = document.createElement("div");
    // newE.id = "drop-ghost";
    // newE.dataset.rowId = t.id;
    // newE.classList.add("drop-ghost");
    // newE.classList.add(getGhostClass());

    // if (e.clientY < boundingRect.top || e.clientY > boundingRect.bottom) return;
    // console.log(currentDragTarget.id);
    const parent = currentDragTarget.parentElement;
    if (!parent || !parent.parentElement) return;

    if (boundingRect.y + boundingRect.height / 2 > e.clientY) {
      isBottomDrop = false;
      parent.parentElement.insertBefore(newE, parent);
      // console.log("inserting before");
    } else {
      isBottomDrop = true;
      parent.parentElement.insertBefore(newE, parent.nextSibling);
      // console.log("inserting after");
    }
  };

  const onRowHoverStart = (e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
    if (sortingType !== SortingType.Ordered) return;

    const element = e.currentTarget as HTMLDivElement;
    const dragIcon = document.getElementById(`drag-icon-${element.id}`);
    if (dragIcon) dragIcon.classList.remove("hidden");
  };

  const onRowHoverEnd = (e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
    const element = e.currentTarget as HTMLDivElement;
    const dragIcon = document.getElementById(`drag-icon-${element.id}`);
    if (dragIcon) dragIcon.classList.add("hidden");
  };

  const onRemoveModOrder = (mod: Mod) => {
    dispatch(resetModLoadOrder([mod]));
  };

  const onModRightClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>, mod: Mod) => {
    if (isDropdownOpen) return;
    setContextMenuMod(mod);

    setPositionX(e.clientX);
    setPositionY(e.clientY);

    if (innerHeight - 300 < e.clientY) {
      setPositionY(e.clientY - 300);
    }

    setIsDropdownOpen(true);

    e.defaultPrevented = true;
    e.stopPropagation();
  };

  const onDropdownOverlayClick = () => {
    if (!document.scrollingElement) return;
    const lastScrollTop = document.scrollingElement.scrollTop;
    setIsDropdownOpen(false);

    setTimeout(() => {
      if (document.scrollingElement) document.scrollingElement.scrollTop = lastScrollTop;
    }, 1);
  };

  const [positionX, setPositionX] = useState<number>(0);
  const [positionY, setPositionY] = useState<number>(0);

  const domParser = new DOMParser();
  const decodeHTML = (encoded: string) => {
    const doc = domParser.parseFromString(encoded, "text/html");
    return doc.documentElement.textContent;
  };

  const getGridClass = () => {
    if (isAuthorEnabled && areThumbnailsEnabled) return "grid-mods-thumbs-author";
    if (isAuthorEnabled) return "grid-mods-author";
    if (areThumbnailsEnabled) return "grid-mods-thumbs";
    return "grid-mods";
  };

  const getGhostClass = () => {
    if (isAuthorEnabled && areThumbnailsEnabled) return "grid-column-7";
    if (isAuthorEnabled) return "grid-column-6";
    if (areThumbnailsEnabled) return "grid-column-6";
    return "grid-column-5";
  };

  return (
    <div className={`dark:text-slate-100 ` + (areThumbnailsEnabled ? "text-lg" : "")} id="rowsParent">
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
            placement="right"
            content="Mods with lower order have priority, don't change unless you really know what you're doing, right click on mod to reset or here to reset all"
          >
            <span className="text-center w-full">Order</span>
          </Tooltip>
        </div>
        <div
          className="flex place-items-center w-full justify-center z-10 mod-row-header"
          onClick={() => modRowSorting.onEnabledSort(setSortingType)}
          onContextMenu={onEnabledRightClick}
          id="enabledHeader"
        >
          {modRowSorting.isEnabledSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <Tooltip placement="right" content="Right click to enable or disable all mods">
            <span className="text-center w-full">Enabled</span>
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
        >
          {modRowSorting.isPackNameSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          Pack
        </div>

        <div
          className="flex grid-area-humanName place-items-center pl-1 mod-row-header"
          onClick={() => modRowSorting.onNameSort(setSortingType)}
        >
          {modRowSorting.isHumanNameSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          Name
        </div>
        <div
          className={
            "flex grid-area-autohide place-items-center pl-1 mod-row-header " +
            (isAuthorEnabled ? "" : "hidden")
          }
          onClick={() => modRowSorting.onAuthorSort(setSortingType)}
        >
          {modRowSorting.isAuthorSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          Author
        </div>
        <div
          className="flex grid-area-autohide place-items-center pl-1 mod-row-header rounded-tr-xl"
          onClick={() => modRowSorting.onLastUpdatedSort(setSortingType)}
        >
          {modRowSorting.isLastUpdatedSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          Last Updated
        </div>

        {mods
          .filter(
            (mod) =>
              mod.isInData ||
              (!mod.isInData && !mods.find((modOther) => modOther.name == mod.name && modOther.isInData))
          )
          .filter((iterMod) => !hiddenMods.find((mod) => mod.name === iterMod.name))
          .map((mod) => (
            <div
              className="row relative"
              key={mod.name}
              onMouseEnter={(e) => onRowHoverStart(e)}
              onMouseLeave={(e) => onRowHoverEnd(e)}
              onDrop={(e) => onDrop(e)}
              onDrag={(e) => onDrag(e)}
              onDragOver={(e) => onDragOver(e)}
              onDragEnter={(e) => onDragEnter(e)}
              onDragLeave={(e) => onDragLeave(e)}
              id={mod.name}
              data-load-order={mod.loadOrder}
            >
              <div className="flex justify-center items-center" onContextMenu={() => onRemoveModOrder(mod)}>
                <span className={mod.loadOrder === undefined ? "" : "text-red-600 font-bold"}>
                  {orderedMods.indexOf(mod) + 1}
                </span>
              </div>
              <div
                className="relative grid"
                onDragEnd={(e) => onDragEnd(e)}
                onDragStart={(e) => onDragStart(e)}
              >
                <div
                  draggable="true"
                  className="hidden absolute left-0 self-center cursor-grab first:p-0 z-10"
                  id={`drag-icon-${mod.name}`}
                >
                  <FontAwesomeIcon icon={faGrip} />
                </div>
                <form
                  className={
                    "grid place-items-center h-full " + (areThumbnailsEnabled ? "bigger-checkbox" : "")
                  }
                >
                  <input
                    style={
                      alwaysEnabledMods.find((iterMod) => iterMod.name === mod.name) && {
                        color: "#6D28D9",
                      }
                    }
                    type="checkbox"
                    name={mod.workshopId}
                    id={mod.workshopId + "enabled"}
                    checked={mod.isEnabled}
                    onChange={(event) => onModToggled(event)}
                  ></input>
                </form>
              </div>
              <div
                onContextMenu={(e) => onModRightClick(e, mod)}
                className={
                  "flex place-items-center grid-area-autohide " + (areThumbnailsEnabled ? "" : "hidden")
                }
              >
                <label htmlFor={mod.workshopId + "enabled"}>
                  <img
                    className="max-w-[6rem] aspect-square"
                    src={
                      ((isDev || mod.imgPath === "") && require("./assets/modThumbnail.png")) || mod.imgPath
                    }
                  ></img>
                </label>
              </div>
              <div
                className="flex place-items-center w-min-[0px]"
                onContextMenu={(e) => onModRightClick(e, mod)}
              >
                <label className="max-w-full inline-block break-words" htmlFor={mod.workshopId + "enabled"}>
                  <span
                    className={classNames("break-all", "flex", "items-center", {
                      ["text-orange-500"]: mod.isInData,
                    })}
                  >
                    {mod.isDeleted && (
                      <Tooltip placement="bottom" content="Mod was deleted from the workshop.">
                        <span className="text-red-800">
                          <FontAwesomeIcon fill="red" icon={faEraser} />
                        </span>
                      </Tooltip>
                    )}
                    {mod.isMovie && (
                      <Tooltip
                        placement="bottom"
                        content={
                          <>
                            <p>Mod is of a movie mod type.</p>
                            <p>Movie mods always have high priority!</p>
                            {mod.isInData && <p>Always enabled since it's located in the WH3/data folder!</p>}
                          </>
                        }
                      >
                        <span className="text-red-800">
                          <FontAwesomeIcon fill="red" icon={faCamera} />
                        </span>
                      </Tooltip>
                    )}
                    {mod.mergedModsData && (
                      <Tooltip
                        placement="bottom"
                        content={
                          <>
                            <p>Mod merges the following mods:</p>
                            {mod.mergedModsData.map((mergedModData) => (
                              <div key={mergedModData.path}>
                                {(mergedModData.humanName &&
                                  mergedModData.humanName != "" &&
                                  mergedModData.humanName) ||
                                  mergedModData.name}
                              </div>
                            ))}
                          </>
                        }
                      >
                        <span className="text-gray-300">
                          <FontAwesomeIcon icon={faFileArchive} />
                        </span>
                      </Tooltip>
                    )}
                    {enabledMergeMods.some((mergeMod) =>
                      (mergeMod.mergedModsData as MergedModsData[]).some(
                        (mergeModData) => mergeModData.path == mod.path
                      )
                    ) && (
                      <Tooltip
                        placement="bottom"
                        content={
                          <>
                            <p>Mod is merged in another enabled pack</p>
                            <p>
                              You can leave it enabled, but this mod will be ignored since it's inside the
                              merged mod
                            </p>
                          </>
                        }
                      >
                        <span className="text-gray-300">
                          <HiOutlineCollection className="inline h-4 overflow-visible"></HiOutlineCollection>
                        </span>
                      </Tooltip>
                    )}
                    {mod.name.replace(".pack", "")}
                  </span>
                </label>
              </div>
              <div className="flex place-items-center" onContextMenu={(e) => onModRightClick(e, mod)}>
                <label htmlFor={mod.workshopId + "enabled"}>
                  {decodeHTML(decodeHTML(mod.humanName) ?? "")}
                </label>
              </div>
              <div
                onContextMenu={(e) => onModRightClick(e, mod)}
                className={"flex place-items-center grid-area-autohide " + (isAuthorEnabled ? "" : "hidden")}
              >
                <label htmlFor={mod.workshopId + "enabled"}>
                  <span className="break-all">{decodeHTML(decodeHTML(mod.author) ?? "")}</span>
                </label>
              </div>
              <div
                className="flex place-items-center grid-area-autohide"
                onContextMenu={(e) => onModRightClick(e, mod)}
              >
                <label htmlFor={mod.workshopId + "enabled"}>
                  {(mod.lastChanged && formatLastChanged(mod.lastChanged)) ||
                    (mod.lastChangedLocal && formatLastChanged(mod.lastChangedLocal)) ||
                    ""}
                </label>
              </div>
            </div>
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
