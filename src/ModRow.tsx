import React, { useState } from "react";
import "./index.css";
import { useAppDispatch, useAppSelector } from "./hooks";
import { toggleMod, enableAll, disableAll, setModLoadOrder, resetModLoadOrder } from "./appSlice";
import classNames from "classnames";
import { Alert, Tooltip } from "flowbite-react";
import { ArrowNarrowDownIcon, ArrowNarrowUpIcon } from "@heroicons/react/solid";
import { formatDistanceToNow } from "date-fns";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGrip } from "@fortawesome/free-solid-svg-icons";
import sortNamesWithLoadOrder from "./sortNamesWithLoadOrder";
import { FloatingOverlay } from "@floating-ui/react-dom-interactions";
import ModDropdown from "./ModDropdown";

enum SortingType {
  PackName,
  PackNameReverse,
  HumanName,
  HumanNameReverse,
  IsEnabled,
  IsEnabledReverse,
  LastUpdated,
  LastUpdatedReverse,
  Ordered,
  OrderedReverse,
}

export default function ModRow() {
  const dispatch = useAppDispatch();
  const filter = useAppSelector((state) => state.app.filter);
  const hiddenMods = useAppSelector((state) => state.app.hiddenMods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);

  const [sortingType, setSortingType] = useState<SortingType>(SortingType.Ordered);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [contextMenuMod, setContextMenuMod] = useState<Mod>();

  let mods: Mod[] = [];

  const orderedMods = sortNamesWithLoadOrder(useAppSelector((state) => state.app.currentPreset.mods));

  switch (sortingType) {
    case SortingType.Ordered:
    case SortingType.OrderedReverse:
      mods = useAppSelector((state) =>
        [...state.app.currentPreset.mods].sort(
          (firstMod, secondMod) => orderedMods.indexOf(firstMod) - orderedMods.indexOf(secondMod)
        )
      );
      if (sortingType == SortingType.OrderedReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.PackName:
    case SortingType.PackNameReverse:
      mods = useAppSelector((state) =>
        [...state.app.currentPreset.mods].sort((firstMod, secondMod) =>
          firstMod.name.localeCompare(secondMod.name)
        )
      );
      if (sortingType == SortingType.PackNameReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.HumanName:
    case SortingType.HumanNameReverse:
      mods = useAppSelector((state) =>
        [...state.app.currentPreset.mods].sort((firstMod, secondMod) =>
          firstMod.humanName.localeCompare(secondMod.humanName)
        )
      );
      if (sortingType == SortingType.HumanNameReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.IsEnabled:
    case SortingType.IsEnabledReverse:
      mods = useAppSelector((state) =>
        [...state.app.currentPreset.mods].sort((firstMod, secondMod) =>
          firstMod.isEnabled == secondMod.isEnabled ? 0 : firstMod.isEnabled ? -1 : 1
        )
      );
      if (sortingType == SortingType.IsEnabledReverse) {
        mods = mods.reverse();
      }
      break;
    case SortingType.LastUpdated:
    case SortingType.LastUpdatedReverse:
      mods = useAppSelector((state) =>
        [...state.app.currentPreset.mods].sort((firstMod, secondMod) => {
          if (firstMod.lastChanged === undefined && secondMod.lastChanged === undefined) return 0;
          if (firstMod.lastChanged === undefined) return 1;
          if (secondMod.lastChanged === undefined) return -1;
          return secondMod.lastChanged - firstMod.lastChanged;
        })
      );
      if (sortingType == SortingType.LastUpdatedReverse) {
        mods = mods.reverse();
      }
      break;
  }

  if (filter !== "") {
    const lowercaseFilter = filter.toLowerCase();
    mods = mods.filter(
      (mod) =>
        mod.name.toLowerCase().includes(lowercaseFilter) ||
        mod.humanName.toLowerCase().includes(lowercaseFilter)
    );
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
    // const value = target.type === "checkbox" ? target.checked : target.value;
    // console.log("%s %s", name, value);
    const mod = mods.find((mod) => mod.workshopId == name);
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

  const onOrderedSort = () => {
    setSortingType((prevState) => {
      return prevState === SortingType.Ordered ? SortingType.OrderedReverse : SortingType.Ordered;
    });
  };
  const onEnabledSort = () => {
    setSortingType((prevState) => {
      return prevState === SortingType.IsEnabled ? SortingType.IsEnabledReverse : SortingType.IsEnabled;
    });
  };
  const onPackSort = () => {
    setSortingType((prevState) => {
      return prevState === SortingType.PackName ? SortingType.PackNameReverse : SortingType.PackName;
    });
  };
  const onNameSort = () => {
    setSortingType((prevState) => {
      return prevState === SortingType.HumanName ? SortingType.HumanNameReverse : SortingType.HumanName;
    });
  };
  const onLastUpdatedSort = () => {
    setSortingType((prevState) => {
      return prevState === SortingType.LastUpdated ? SortingType.LastUpdatedReverse : SortingType.LastUpdated;
    });
  };

  const afterDrop = (originalId: string, droppedOnId: string) => {
    // console.log(`dragged id with ${originalId}`);
    // console.log(`DROPPED ONTO ${droppedOnId}`);

    if (originalId === droppedOnId) return;

    const droppedOnElement = document.getElementById(droppedOnId);
    const index = [...droppedOnElement.parentElement.children].indexOf(droppedOnElement) - 6;

    const originalElement = document.getElementById(originalId);
    const originalElementindex = [...originalElement.parentElement.children].indexOf(originalElement) - 6;

    const loadOrder = index > originalElementindex ? index : index + 1;
    const originalOrder = originalElementindex + (index > originalElementindex ? 2 : 1);

    if (originalElementindex < index && index - originalElementindex < 3) return;

    // console.log(originalElementindex);
    // console.log(`index is ${index}`);

    dispatch(setModLoadOrder({ modName: originalId, loadOrder, originalOrder }));
  };

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // console.log("DRAG START");
    const t = e.target as HTMLDivElement;
    t.classList.add("opacity-50");

    e.dataTransfer.effectAllowed = "move";
    // console.log(`setting data ${t.id}`);
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
    // console.log("onDragEnter");
    const t = e.currentTarget as HTMLDivElement;
    // console.log(t.id);
    t.classList.add("opacity-50");

    const ghost = document.getElementById("drop-ghost");
    if (ghost) {
      t.parentElement.removeChild(ghost);
    }

    const newE = document.createElement("div");
    newE.id = "drop-ghost";
    newE.dataset.rowId = t.id;
    newE.classList.add("drop-ghost");

    t.parentElement.insertBefore(newE, t);
    newE.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    newE.addEventListener("drop", (e) => {
      e.preventDefault();
      // console.log(`DROPPEND ON GHOST`);
      const rowId = (e.currentTarget as HTMLElement).dataset.rowId;
      // console.log(`dragged id with ${e.dataTransfer.getData("text/plain")}`);
      // console.log(`rowId is ${rowId}`);
      afterDrop(e.dataTransfer.getData("text/plain"), rowId);
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

    const t = e.currentTarget as HTMLDivElement;
    // console.log(`DROPPED ONTO ${t.id}`);

    afterDrop(e.dataTransfer.getData("text/plain"), t.id);
    // e.stopPropagation();
  };

  const onRowHoverStart = (e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
    if (sortingType !== SortingType.Ordered) return;

    const element = e.currentTarget as HTMLDivElement;
    // console.log(`finding drag-icon-${element.id}`);
    const dragIcon = document.getElementById(`drag-icon-${element.id}`);
    // Array.from(element.parentElement.children).forEach((child) => {
    //   if (child.id.startsWith("drag-icon")) {
    dragIcon.classList.remove("hidden");

    // dragIcon.classList.add("inline");
    // }
    // });
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
      <div className="grid grid-mods pt-1.5 grida parent" id="modsGrid">
        <div
          id="sortHeader"
          className="flex place-items-center grid-area-enabled w-full justify-center z-40"
          onClick={() => onOrderedSort()}
          onContextMenu={onOrderRightClick}
        >
          {(sortingType === SortingType.Ordered && (
            <ArrowNarrowDownIcon className="inline h-4"></ArrowNarrowDownIcon>
          )) ||
            (sortingType === SortingType.OrderedReverse && (
              <ArrowNarrowUpIcon className="inline h-4"></ArrowNarrowUpIcon>
            )) || <></>}
          <Tooltip
            placement="right"
            content="Mods with lower order have priority, don't change unless you really know what you're doing, right click on mod to reset or here to reset all"
          >
            <span className="text-center w-full">Order</span>
          </Tooltip>
        </div>
        <div
          className="flex place-items-center grid-area-enabled w-full justify-center z-40"
          onClick={() => onEnabledSort()}
          onContextMenu={onEnabledRightClick}
        >
          <Tooltip placement="right" content="Right click to enable or disable all mods">
            {(sortingType === SortingType.IsEnabled && (
              <ArrowNarrowDownIcon className="inline h-4"></ArrowNarrowDownIcon>
            )) ||
              (sortingType === SortingType.IsEnabledReverse && (
                <ArrowNarrowUpIcon className="inline h-4"></ArrowNarrowUpIcon>
              )) || <></>}
            <span className="text-center w-full">Enabled</span>
          </Tooltip>
        </div>
        <div className="flex grid-area-packName place-items-center pl-1" onClick={() => onPackSort()}>
          {(sortingType === SortingType.PackName && (
            <ArrowNarrowDownIcon className="inline h-4"></ArrowNarrowDownIcon>
          )) ||
            (sortingType === SortingType.PackNameReverse && (
              <ArrowNarrowUpIcon className="inline h-4"></ArrowNarrowUpIcon>
            )) || <></>}
          Pack
        </div>

        <div className="flex grid-area-humanName place-items-center pl-1" onClick={() => onNameSort()}>
          {(sortingType === SortingType.HumanName && (
            <ArrowNarrowDownIcon className="inline h-4"></ArrowNarrowDownIcon>
          )) ||
            (sortingType === SortingType.HumanNameReverse && (
              <ArrowNarrowUpIcon className="inline h-4"></ArrowNarrowUpIcon>
            )) || <></>}
          Name
        </div>
        <div
          className="flex grid-area-lastUpdated place-items-center pl-1"
          onClick={() => onLastUpdatedSort()}
        >
          {(sortingType === SortingType.LastUpdated && (
            <ArrowNarrowDownIcon className="inline h-4"></ArrowNarrowDownIcon>
          )) ||
            (sortingType === SortingType.LastUpdatedReverse && (
              <ArrowNarrowUpIcon className="inline h-4"></ArrowNarrowUpIcon>
            )) || <></>}
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
                className="grid-area-enabled relative grid"
                onDragEnd={(e) => onDragEnd(e)}
                onDragStart={(e) => onDragStart(e)}
              >
                <div
                  draggable="true"
                  className="hidden absolute left-0 self-center cursor-grab"
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
                className="flex place-items-center grid-area-packName w-min-[0px]"
                onContextMenu={(e) => onModRightClick(e, mod)}
              >
                <label className="max-w-full inline-block break-words" htmlFor={mod.workshopId + "enabled"}>
                  <span className={classNames("break-all", { ["text-orange-500"]: mod.isInData })}>
                    {mod.name.replace(".pack", "")}
                  </span>
                </label>
              </div>
              <div
                className="flex place-items-center grid-area-humanName"
                onContextMenu={(e) => onModRightClick(e, mod)}
              >
                <label htmlFor={mod.workshopId + "enabled"}>{mod.humanName}</label>
              </div>
              <div className="flex place-items-center grid-area-lastUpdated">
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
