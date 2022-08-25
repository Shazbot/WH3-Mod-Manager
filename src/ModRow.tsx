import React, { useState } from "react";
import "./index.css";
import { useAppDispatch, useAppSelector } from "./hooks";
import { toggleMod, enableAll, disableAll, setModLoadOrder, resetModLoadOrder } from "./appSlice";
import classNames from "classnames";
import { Alert, Tooltip } from "flowbite-react";
import { formatDistanceToNow } from "date-fns";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGrip, faEraser } from "@fortawesome/free-solid-svg-icons";
import { getFilteredMods, sortByNameAndLoadOrder } from "./modSortingHelpers";
import { FloatingOverlay } from "@floating-ui/react-dom-interactions";
import ModDropdown from "./ModDropdown";
import { isModAlwaysEnabled } from "./modsHelpers";
import * as modRowSorting from "./utility/modRowSorting";
import { SortingType } from "./utility/modRowSorting";

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

  const afterDrop = (originalId: string, droppedOnId: string) => {
    // console.log(`dragged id with ${originalId}`);
    // console.log(`DROPPED ONTO ${droppedOnId}`);

    if (originalId === droppedOnId) return;

    const droppedOnElement = document.getElementById(droppedOnId);
    if (!droppedOnElement) return;
    const index = [...droppedOnElement.parentElement.children].indexOf(droppedOnElement) - 8;

    const originalElement = document.getElementById(originalId);
    if (!originalElement) return;
    const originalElementindex = [...originalElement.parentElement.children].indexOf(originalElement) - 8;

    const loadOrder = index > originalElementindex ? index : index + 1;
    const originalOrder = originalElementindex + (index > originalElementindex ? 2 : 1);

    if (originalElementindex < index && index - originalElementindex < 3) return;

    // console.log(`index is ${index}`);
    // console.log(`orig index is ${originalElementindex}`);
    // console.log(`loadOrder is ${loadOrder}`);
    // console.log(`originalOrder is ${originalOrder}`);

    dispatch(setModLoadOrder({ modName: originalId, loadOrder, originalOrder }));
  };

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // console.log("DRAG START");
    const t = e.target as HTMLDivElement;
    t.classList.add("opacity-50");

    e.dataTransfer.effectAllowed = "move";
    console.log(`setting data ${t.id}`);
    e.dataTransfer.setData("text/plain", t.id.replace("drag-icon-", ""));

    const body = document.getElementById("body");
    body.classList.add("disable-row-hover");

    console.log(t.id.replace("drag-icon-", ""));
    const row = document.getElementById(t.id.replace("drag-icon-", ""));
    row?.classList.add("row-bg-color-manually");
    // e.stopPropagation();
  };

  const onDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    // console.log("onDragEnd");
    const t = e.target as HTMLDivElement;
    t.classList.add("opacity-100");

    const ghost = document.getElementById("drop-ghost");
    if (ghost) {
      ghost.parentElement.removeChild(ghost);
    }

    [...document.getElementsByClassName("row-bg-color-manually")].forEach((element) => {
      element.classList.remove("row-bg-color-manually");
    });

    const body = document.getElementById("body");
    body.classList.remove("disable-row-hover");
    // e.stopPropagation();
  };

  const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.length > 1) return;
    const t = e.currentTarget as HTMLDivElement;
    t.classList.add("opacity-50");

    const ghost = document.getElementById("drop-ghost");
    if (ghost) {
      t.parentElement.removeChild(ghost);
    }

    const newE = document.createElement("div");
    newE.id = "drop-ghost";
    newE.dataset.rowId = t.id;
    newE.classList.add("drop-ghost");
    newE.classList.add(getGhostClass());

    t.parentElement.insertBefore(newE, t);
    newE.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    newE.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData("text/plain");
      if (draggedId === "") return;
      const rowId = (e.currentTarget as HTMLElement).dataset.rowId;
      // console.log(`dragged id with ${e.dataTransfer.getData("text/plain")}`);
      // console.log(`rowId is ${rowId}`);
      afterDrop(draggedId, rowId);
    });
    e.stopPropagation();
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // console.log("onDragLeave");
    const t = e.target as HTMLDivElement;
    t.classList.add("opacity-100");
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

    afterDrop(droppedId, t.id);
    // e.stopPropagation();
  };

  const onRowHoverStart = (e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
    if (sortingType !== SortingType.Ordered) return;

    const element = e.currentTarget as HTMLDivElement;
    const dragIcon = document.getElementById(`drag-icon-${element.id}`);
    dragIcon.classList.remove("hidden");
  };

  const onRowHoverEnd = (e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
    const element = e.currentTarget as HTMLDivElement;
    const dragIcon = document.getElementById(`drag-icon-${element.id}`);
    dragIcon.classList.add("hidden");
  };

  const onRemoveModOrder = (mod: Mod) => {
    dispatch(resetModLoadOrder([mod]));
  };

  const onModRightClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>, mod: Mod) => {
    if (isDropdownOpen) return;
    setContextMenuMod(mod);

    setPositionX(e.clientX);
    setPositionY(e.clientY);

    if (innerHeight - 120 < e.clientY) {
      setPositionY(e.clientY - 120);
    }

    setIsDropdownOpen(true);

    e.defaultPrevented = true;
    e.stopPropagation();
  };

  const onDropdownOverlayClick = () => {
    setIsDropdownOpen(false);
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
    <div className={`dark:text-slate-100`} id="rowsParent">
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
              onDragOver={(e) => onDragOver(e)}
              onDragEnter={(e) => onDragEnter(e)}
              onDragLeave={(e) => onDragLeave(e)}
              id={mod.name}
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
                  className="hidden absolute left-0 self-center cursor-grab first:p-0"
                  id={`drag-icon-${mod.name}`}
                >
                  <FontAwesomeIcon icon={faGrip} />
                </div>
                <form className="grid place-items-center h-full">
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
                    {mod.name.replace(".pack", "")}
                  </span>
                </label>
              </div>
              <div className="flex place-items-center" onContextMenu={(e) => onModRightClick(e, mod)}>
                <label htmlFor={mod.workshopId + "enabled"}>{decodeHTML(decodeHTML(mod.humanName))}</label>
              </div>
              <div
                onContextMenu={(e) => onModRightClick(e, mod)}
                className={"flex place-items-center grid-area-autohide " + (isAuthorEnabled ? "" : "hidden")}
              >
                <label htmlFor={mod.workshopId + "enabled"}>
                  <span className="break-all">{decodeHTML(decodeHTML(mod.author))}</span>
                </label>
              </div>
              <div
                className="flex place-items-center grid-area-autohide"
                onContextMenu={(e) => onModRightClick(e, mod)}
              >
                <label htmlFor={mod.workshopId + "enabled"}>
                  {formatDistanceToNow(mod.lastChanged).replace("about ", "~") + " ago"}
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
