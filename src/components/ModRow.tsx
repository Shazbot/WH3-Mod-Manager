import { faCamera, faEraser, faFileArchive, faGrip } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { CSSProperties, memo, useCallback, useContext, useMemo } from "react";
import { useAppSelector } from "../hooks";
import { Tooltip } from "flowbite-react";
import classNames from "classnames";
import { formatDistanceToNow } from "date-fns";
import { isSubbedTimeSort, SortingType } from "../utility/modRowSorting";
import localizationContext from "../localizationContext";
import { Icons } from "./icons";
import { CellMeasurerChildProps } from "react-virtualized/dist/es/CellMeasurer";

const FontAwesomeIconMemo = memo(FontAwesomeIcon);

type ModRowProps = {
  mod: Mod;
  index: number;
  onRowHoverStart: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
  onRowHoverEnd: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, setAfterMod?: boolean) => void;
  onDrag: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  onModToggled: (mod: Mod) => void;
  onModRightClick: (e: React.MouseEvent<HTMLDivElement, MouseEvent>, mod: Mod) => void;
  onCustomizeModClicked: (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => void;
  onCustomizeModRightClick: (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => void;
  onFlowOptionsClicked: (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => void;
  onRemoveModOrder: (mod: Mod) => void;
  loadOrder: number;
  isEnabledInMergedMod: boolean;
  isAlwaysEnabled: boolean;
  sortingType: SortingType;
  currentTab: MainWindowTab;
  isLast: boolean;
  style: CSSProperties;
  gridClass: string;
  registerChild: CellMeasurerChildProps["registerChild"];
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
    style,
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
    isLast,
    sortingType,
    currentTab,
    onCustomizeModClicked,
    onCustomizeModRightClick,
    onFlowOptionsClicked,
    gridClass,
    registerChild,
  }: ModRowProps) => {
    const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);
    const isDev = useAppSelector((state) => state.app.isDev);
    const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);
    const customizableMods = useAppSelector((state) => state.app.customizableMods);
    const packDataOverwrites = useAppSelector((state) => state.app.packDataOverwrites);

    const getGhostClass = useCallback(() => {
      if (isAuthorEnabled && areThumbnailsEnabled) return "grid-column-8";
      if (isAuthorEnabled) return "grid-column-7";
      if (areThumbnailsEnabled) return "grid-column-7";
      return "grid-column-6";
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

    const timeColumnValue = useMemo(
      () =>
        (isSubbedTimeSort(sortingType) &&
          mod.subbedTime != null &&
          mod.subbedTime != -1 &&
          formatLastChanged(mod.subbedTime)) ||
        (mod.lastChanged && formatLastChanged(mod.lastChanged)) ||
        (mod.lastChangedLocal && formatLastChanged(mod.lastChangedLocal)) ||
        "",
      [sortingType, mod.lastChanged, mod.lastChangedLocal, mod.subbedTime]
    );

    return (
      <div
        className={`relative grid row-div-paddings row-hover-highlight ${gridClass}`}
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
        style={style}
        ref={registerChild}
      >
        <div onDrop={(e) => onDrop(e)} className={"drop-ghost h-10 hidden " + getGhostClass()}></div>
        <div className="flex justify-center items-center" onContextMenu={() => onRemoveModOrder(mod)}>
          {mod.loadOrder == undefined && <span>{index + 1}</span>}
          {mod.loadOrder != undefined && (
            <>
              <span className="text-blue-500 font-bold">{mod.loadOrder + 1}</span>
            </>
          )}
        </div>
        <div className="relative grid" onDragStart={(e) => onDragStart(e)}>
          {(currentTab != "enabledMods" && (
            <span className="make-tooltip-inline absolute self-center tooltip-width-20">
              <Tooltip
                placement="right"
                style="light"
                content={
                  <span className="text-slate-200">
                    Mod order can only be changed in the Enabled Mods tab. List of tabs is located in the
                    top-left of the window. You can also use the Ctrl+2 shortcut.
                  </span>
                }
              >
                <div
                  className="hidden absolute left-0 self-center cursor-not-allowed first:p-0 z-10"
                  id={`drag-icon-${mod.name}`}
                >
                  <FontAwesomeIconMemo opacity={0.5} icon={faGrip} />
                </div>
              </Tooltip>
            </span>
          )) || (
            <div
              draggable="true"
              className="hidden absolute left-0 self-center cursor-grab first:p-0 z-10"
              id={`drag-icon-${mod.name}`}
            >
              <FontAwesomeIconMemo icon={faGrip} />
            </div>
          )}
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
              onChange={() => onModToggled(mod)}
            ></input>
          </form>
        </div>
        <div
          onContextMenu={(e) => onModRightClick(e, mod)}
          className={"flex place-items-center grid-area-autohide " + (areThumbnailsEnabled ? "" : "hidden")}
        >
          <label className="cursor-pointer" htmlFor={mod.workshopId + "enabled"}>
            {areThumbnailsEnabled && (
              <img
                className="max-w-[6rem] aspect-square"
                src={((isDev || mod.imgPath === "") && require("../assets/modThumbnail.png")) || mod.imgPath}
              ></img>
            )}
          </label>
        </div>
        <div className="flex place-items-center w-min-[0px]" onContextMenu={(e) => onModRightClick(e, mod)}>
          <label
            className="max-w-full inline-block break-words cursor-pointer"
            htmlFor={mod.workshopId + "enabled"}
          >
            <span
              className={classNames("break-all", "flex", "items-center", {
                ["text-orange-500"]: mod.isInData && !mod.isSymbolicLink,
                ["text-blue-400"]: mod.isSymbolicLink,
                ["text-amber-400"]: mod.isInModding,
              })}
            >
              {mod.isDeleted && (
                <Tooltip
                  placement="bottom"
                  content="Failed fetching steam workshop page, mod was deleted from the workshop or is hidden."
                >
                  <span className="text-red-800">
                    <FontAwesomeIconMemo fill="red" icon={faEraser} />
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
                    <FontAwesomeIconMemo fill="red" icon={faCamera} />
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
                    <FontAwesomeIconMemo icon={faFileArchive} />
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
                    <Icons.Collection className="inline h-4 overflow-visible" />
                  </span>
                </Tooltip>
              )}
              {mod.name.replace(".pack", "")}
            </span>
          </label>
        </div>
        <div className="flex place-items-center" onContextMenu={(e) => onModRightClick(e, mod)}>
          <label className="cursor-pointer" htmlFor={mod.workshopId + "enabled"}>
            {decodeHTML(decodeHTML(mod.humanName) ?? "")}
          </label>
        </div>
        <div
          onContextMenu={(e) => onModRightClick(e, mod)}
          className={"flex place-items-center grid-area-autohide " + (isAuthorEnabled ? "" : "hidden")}
        >
          <label className="cursor-pointer" htmlFor={mod.workshopId + "enabled"}>
            <span className="break-all">{decodeHTML(decodeHTML(mod.author) ?? "")}</span>
          </label>
        </div>
        <div
          className="flex place-items-center grid-area-autohide"
          onContextMenu={(e) => onModRightClick(e, mod)}
        >
          <label
            style={{ height: areThumbnailsEnabled ? "28px" : "24px" }}
            className="cursor-pointer"
            htmlFor={mod.workshopId + "enabled"}
          >
            {timeColumnValue}
          </label>
        </div>
        <div className="flex place-items-center justify-center gap-2">
          {customizableMods[mod.path] &&
            customizableMods[mod.path].some((file) => file.startsWith("db\\")) && (
              <Icons.Gear
                onClick={(e) => {
                  onCustomizeModClicked(e, mod);
                }}
                onContextMenu={(e) => onCustomizeModRightClick(e, mod)}
                className="bigger-gear-icon cursor-pointer transition-all duration-200 hover:opacity-70 hover:scale-110"
                color={(packDataOverwrites[mod.path] && "#1c64f2") || "white"}
              />
            )}
          {customizableMods[mod.path] &&
            customizableMods[mod.path].some((file) => file.startsWith("whmmflows\\")) && (
              <Icons.SettingsKnobs
                onClick={(e) => {
                  onFlowOptionsClicked(e, mod);
                }}
                className="bigger-gear-icon cursor-pointer transition-all duration-200 hover:opacity-70 hover:scale-110"
                color={(packDataOverwrites[mod.path] && "#1c64f2") || "white"}
              />
            )}
        </div>
        {isLast && (
          <div onDrop={(e) => onDrop(e, true)} className={"drop-ghost h-10 hidden " + getGhostClass()}></div>
        )}
      </div>
    );
  }
);
export default ModRow;
