import React, { CSSProperties, useState } from "react";
import "./../index.css";
import { useAppDispatch, useAppSelector } from "../hooks";
import { toggleMod, enableAll, disableAll } from "../appSlice";
import classNames from "classnames";
import { Alert, Tooltip } from "flowbite-react";
import { ArrowNarrowDownIcon, ArrowNarrowUpIcon } from "@heroicons/react/solid";
import { formatDistanceToNow } from "date-fns";
import isDev from "electron-is-dev";
import { NonceProvider } from "react-select";

enum SortingType {
  PackName,
  PackNameReverse,
  HumanName,
  HumanNameReverse,
  IsEnabled,
  IsEnabledReverse,
  LastUpdated,
  LastUpdatedReverse,
}

export default function ModRow() {
  const dispatch = useAppDispatch();
  const filter = useAppSelector((state) => state.app.filter);

  const [sortingType, setSortingType] = useState<SortingType>(SortingType.PackName);

  let mods: Mod[] = [];

  switch (sortingType) {
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
        [...state.app.currentPreset.mods].sort(
          (firstMod, secondMod) => secondMod.lastChanged - firstMod.lastChanged
        )
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
    const value = target.type === "checkbox" ? target.checked : target.value;
    const name = target.name;
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

  const handleStyle: CSSProperties = {
    backgroundColor: "green",
    width: "1rem",
    height: "1rem",
    //display: "inline-block",
    marginRight: "0.75rem",
    cursor: "move",
    display: "none",
  };

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    console.log("DRAG START");
    const t = e.target as HTMLDivElement;
    t.classList.add("opacity-50");
  };

  const onDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    console.log("DRAG START");
    const t = e.target as HTMLDivElement;
    t.classList.add("opacity-100");
  };

  const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    console.log("onDragEnter");
    const t = e.target as HTMLDivElement;
    t.classList.add("opacity-50");
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    console.log("onDragLeave");
    const t = e.target as HTMLDivElement;
    t.classList.add("opacity-100");
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    console.log("onDragOver");
    e.preventDefault();
    return false;
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    console.log("onDrop");
  };

  return (
    <div className="dark:text-slate-300">
      <div className="grid grid-mods pt-1.5 grida parent">
        <div
          className="flex place-items-center grid-area-enabled w-full justify-center"
          onClick={() => onEnabledSort()}
          onContextMenu={onEnabledRightClick}
        >
          <Tooltip content="Right click to enable or disable all mods">
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
          .map((mod, index) => (
            <div className="row hover:bg-slate-300" key={mod.name}>
              <div className="grid-area-enabled">
                <form className="grid place-items-center h-full">
                  <input
                    type="checkbox"
                    name={mod.workshopId}
                    id={mod.workshopId}
                    checked={mod.isEnabled}
                    onChange={(event) => onModToggled(event)}
                  ></input>
                </form>
              </div>
              <div className="flex place-items-center grid-area-packName w-min-[0px]">
                <div
                  style={handleStyle}
                  draggable="true"
                  onDragEnd={(e) => onDragEnd(e)}
                  onDragStart={(e) => onDragStart(e)}
                  onDragEnter={(e) => onDragEnter(e)}
                  onDragLeave={(e) => onDragLeave(e)}
                  onDragOver={(e) => onDragOver(e)}
                  onDrop={(e) => onDrop(e)}
                />
                <label className="max-w-full inline-block break-words" htmlFor={mod.workshopId}>
                  <span className={classNames({ ["text-orange-500"]: mod.isInData })}>
                    {mod.name.replace(".pack", "")}
                  </span>
                </label>
              </div>
              <div className="flex place-items-center grid-area-humanName">
                <label htmlFor={mod.workshopId}>{mod.humanName}</label>
              </div>
              <div className="flex place-items-center grid-area-lastUpdated">
                <label htmlFor={mod.workshopId}>{formatDistanceToNow(mod.lastChanged) + " ago"}</label>
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
