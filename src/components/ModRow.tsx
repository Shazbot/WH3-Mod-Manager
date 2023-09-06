import { faCamera, faEraser, faFileArchive, faGrip } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { memo, useCallback, useContext, useEffect, useState } from "react";
import { useAppSelector } from "../hooks";
import { Tooltip } from "flowbite-react";
import classNames from "classnames";
import { HiOutlineCollection } from "react-icons/hi";
import { formatDistanceToNow } from "date-fns";
import { isSubbedTimeSort, SortingType } from "../utility/modRowSorting";
import localizationContext from "../localizationContext";

type ModRowProps = {
  mod: Mod;
  index: number;
  onRowHoverStart: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
  onRowHoverEnd: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrag: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  onModToggled: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onModRightClick: (e: React.MouseEvent<HTMLDivElement, MouseEvent>, mod: Mod) => void;
  onRemoveModOrder: (mod: Mod) => void;
  loadOrder: number;
  isEnabledInMergedMod: boolean;
  isAlwaysEnabled: boolean;
  sortingType: SortingType;
};

const domParser = new DOMParser();
const decodeHTML = (encoded: string) => {
  const doc = domParser.parseFromString(encoded, "text/html");
  return doc.documentElement.textContent;
};

const formatLastChanged = (lastChanged: number) => {
  try {
    return formatDistanceToNow(lastChanged).replace("about ", "~") + " ago";
  } catch (e) {
    console.error(e);
  }
  return "";
};

const ModRow = memo(
  ({
    index,
    mod,
    onRowHoverStart,
    onRowHoverEnd,
    onDrop,
    onDrag,
    onDragStart,
    onDragLeave,
    onDragEnter,
    onDragOver,
    onModToggled,
    onModRightClick,
    onRemoveModOrder,
    isAlwaysEnabled,
    isEnabledInMergedMod,
    loadOrder,
    sortingType,
  }: ModRowProps) => {
    const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);
    const isDev = useAppSelector((state) => state.app.isDev);
    const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);

    const getGhostClass = useCallback(() => {
      if (isAuthorEnabled && areThumbnailsEnabled) return "grid-column-7";
      if (isAuthorEnabled) return "grid-column-6";
      if (areThumbnailsEnabled) return "grid-column-6";
      return "grid-column-5";
    }, [isAuthorEnabled, areThumbnailsEnabled]);

    // const [translated, setTranslated] = useState<Record<string, string>>({});
    const localization: Record<string, string> = useContext(localizationContext);

    // useEffect(() => {
    //   const forTranslation = {
    //     priorityTooltipOne: {},
    //     priorityTooltipTwo: {},
    //     priorityTooltipThree: {},
    //   };
    //   window.api?.translateAll(forTranslation).then((translated) => {
    //     setTranslated(translated);
    //   });
    // }, []);

    const timeColumnValue =
      (isSubbedTimeSort(sortingType) &&
        mod.subbedTime != null &&
        mod.subbedTime != -1 &&
        formatLastChanged(mod.subbedTime)) ||
      (mod.lastChanged && formatLastChanged(mod.lastChanged)) ||
      (mod.lastChangedLocal && formatLastChanged(mod.lastChangedLocal)) ||
      "";

    return (
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
        <div className={"drop-ghost h-10 hidden " + getGhostClass()}></div>
        <div className="flex justify-center items-center" onContextMenu={() => onRemoveModOrder(mod)}>
          <span className={mod.loadOrder === undefined ? "" : "text-red-600 font-bold"}>{loadOrder}</span>
        </div>
        <div className="relative grid" onDragStart={(e) => onDragStart(e)}>
          <div
            draggable="true"
            className="hidden absolute left-0 self-center cursor-grab first:p-0 z-10"
            id={`drag-icon-${mod.name}`}
          >
            <FontAwesomeIcon icon={faGrip} />
          </div>
          <form
            className={"grid place-items-center h-full " + (areThumbnailsEnabled ? "bigger-checkbox" : "")}
          >
            <input
              style={
                (isAlwaysEnabled && {
                  color: "#6D28D9",
                }) ||
                {}
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
          className={"flex place-items-center grid-area-autohide " + (areThumbnailsEnabled ? "" : "hidden")}
        >
          <label htmlFor={mod.workshopId + "enabled"}>
            <img
              className="max-w-[6rem] aspect-square"
              src={((isDev || mod.imgPath === "") && require("../assets/modThumbnail.png")) || mod.imgPath}
            ></img>
          </label>
        </div>
        <div className="flex place-items-center w-min-[0px]" onContextMenu={(e) => onModRightClick(e, mod)}>
          <label className="max-w-full inline-block break-words" htmlFor={mod.workshopId + "enabled"}>
            <span
              className={classNames("break-all", "flex", "items-center", {
                ["text-orange-500"]: mod.isInData,
                ["text-blue-400"]: mod.isSymbolicLink,
              })}
            >
              {mod.isDeleted && (
                <Tooltip
                  placement="bottom"
                  content="Failed fetching steam workshop page, mod was deleted from the workshop or is hidden."
                >
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
                      <p>{localization.movieModOne}</p>
                      <p>{localization.movieModTwo}</p>
                      {mod.isInData && <p>{localization.movieModThree}</p>}
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
              {isEnabledInMergedMod && (
                <Tooltip
                  placement="bottom"
                  content={
                    <>
                      <p>Mod is merged in another enabled pack</p>
                      <p>
                        You can leave it enabled, but this mod will be ignored since it's inside the merged
                        mod
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
          <label htmlFor={mod.workshopId + "enabled"}>{decodeHTML(decodeHTML(mod.humanName) ?? "")}</label>
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
          <label htmlFor={mod.workshopId + "enabled"}>{timeColumnValue}</label>
        </div>
        {/* <div className="drop-ghost grid-column-7 h-10 hidden"></div> */}
      </div>
    );
  }
);
export default ModRow;
