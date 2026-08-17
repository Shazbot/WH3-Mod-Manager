import { faCamera, faEraser, faFileArchive } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { CSSProperties, memo, useContext, useMemo } from "react";
import { Tooltip } from "flowbite-react";
import classNames from "classnames";
import { formatDistanceToNow } from "date-fns";
import { isSubbedTimeSort, SortingType } from "../utility/modRowSorting";
import localizationContext from "../localizationContext";
import { Icons } from "./icons";
import { CellMeasurerChildProps } from "react-virtualized/dist/es/CellMeasurer";
import CustomModFolderIcon from "./CustomModFolderIcon";
import { BsArrowDownUp } from "react-icons/bs";
import { ModListLayout } from "../utility/frontend/modListLayout";

const FontAwesomeIconMemo = memo(FontAwesomeIcon);

type ModRowProps = {
  mod: Mod;
  loadOrderIndex: number;
  onRowHoverStart: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
  onRowHoverEnd: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
  onSetLoadOrderMode: (mod: Mod) => void;
  onSelectLoadOrderPosition: (position: number) => void;
  onModToggled: (mod: Mod) => void;
  onModRightClick: (e: React.MouseEvent<HTMLDivElement, MouseEvent>, mod: Mod) => void;
  onCustomizeModClicked: (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => void;
  onCustomizeModRightClick: (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => void;
  onFlowOptionsClicked: (e: React.MouseEvent<HTMLOrSVGElement, MouseEvent>, mod: Mod) => void;
  onRemoveModOrder: (mod: Mod) => void;
  isEnabledInMergedMod: boolean;
  isAlwaysEnabled: boolean;
  areThumbnailsEnabled: boolean;
  isAuthorEnabled: boolean;
  ghostClass: string;
  thumbnailSrc: string;
  decodedHumanName: string;
  decodedAuthor: string;
  customFolderPath?: string;
  hasDbCustomization: boolean;
  hasFlowCustomization: boolean;
  hasPackDataOverwrite: boolean;
  sortingType: SortingType;
  /** Whether this list lets the user pick a new load order position for the row. */
  canReorder: boolean;
  /** False where the row's position in the list says nothing about the order the game will load in. */
  showPositionIndex: boolean;
  layout: ModListLayout;
  /** The compact layout only shows the configuration column on the enabled-mods pane. */
  showConfigColumn: boolean;
  isLast: boolean;
  rowIndex: number;
  activeLoadOrderPosition: number;
  isLoadOrderPlacementMode: boolean;
  isLoadOrderPlacementSource: boolean;
  isRecentlyReordered: boolean;
  style: CSSProperties;
  gridClass: string;
  registerChild: CellMeasurerChildProps["registerChild"];
};

const formatLastChanged = (lastChanged: number) => {
  try {
    return formatDistanceToNow(lastChanged).replace("about ", "~") + " ago";
  } catch (e) {
    console.error(e);
  }
  return "";
};

type PackNameProps = Pick<ModRowProps, "mod" | "isEnabledInMergedMod" | "customFolderPath">;

/**
 * The pack name plus the badges that qualify it. Shared because the compact layout stacks this under the
 * human name instead of giving it a column of its own.
 */
const PackName = ({ mod, isEnabledInMergedMod, customFolderPath }: PackNameProps) => {
  const localization: Record<string, string> = useContext(localizationContext);

  return (
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
                  {(mergedModData.humanName && mergedModData.humanName != "" && mergedModData.humanName) ||
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
              <p>You can leave it enabled, but this mod will be ignored since it's inside the merged mod</p>
            </>
          }
        >
          <span className="text-gray-300">
            <Icons.Collection className="inline h-4 overflow-visible" />
          </span>
        </Tooltip>
      )}
      {mod.name.replace(".pack", "")}
      <CustomModFolderIcon folderPath={customFolderPath} />
    </span>
  );
};

type ConfigIconsProps = Pick<
  ModRowProps,
  | "mod"
  | "hasDbCustomization"
  | "hasFlowCustomization"
  | "hasPackDataOverwrite"
  | "onCustomizeModClicked"
  | "onCustomizeModRightClick"
  | "onFlowOptionsClicked"
>;

const ConfigIcons = ({
  mod,
  hasDbCustomization,
  hasFlowCustomization,
  hasPackDataOverwrite,
  onCustomizeModClicked,
  onCustomizeModRightClick,
  onFlowOptionsClicked,
}: ConfigIconsProps) => (
  <>
    {hasDbCustomization && (
      <Icons.Gear
        onClick={(e) => {
          onCustomizeModClicked(e, mod);
        }}
        onContextMenu={(e) => onCustomizeModRightClick(e, mod)}
        className="bigger-gear-icon cursor-pointer transition-all duration-200 hover:opacity-70 hover:scale-110"
        color={(hasPackDataOverwrite && "#1c64f2") || "white"}
      />
    )}
    {hasFlowCustomization && (
      <Icons.SettingsKnobs
        onClick={(e) => {
          onFlowOptionsClicked(e, mod);
        }}
        className="bigger-gear-icon cursor-pointer transition-all duration-200 hover:opacity-70 hover:scale-110"
        color={(hasPackDataOverwrite && "#1c64f2") || "white"}
      />
    )}
  </>
);

const ModRow = memo(
  ({
    loadOrderIndex,
    mod,
    style,
    onRowHoverStart,
    onRowHoverEnd,
    onSetLoadOrderMode,
    onSelectLoadOrderPosition,
    onModToggled,
    onModRightClick,
    onRemoveModOrder,
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
    isLast,
    rowIndex,
    activeLoadOrderPosition,
    isLoadOrderPlacementMode,
    isLoadOrderPlacementSource,
    isRecentlyReordered,
    sortingType,
    canReorder,
    showPositionIndex,
    layout,
    showConfigColumn,
    onCustomizeModClicked,
    onCustomizeModRightClick,
    onFlowOptionsClicked,
    gridClass,
    registerChild,
  }: ModRowProps) => {
    const localization: Record<string, string> = useContext(localizationContext);

    const timeColumnValue = useMemo(
      () =>
        (isSubbedTimeSort(sortingType) &&
          mod.subbedTime != null &&
          mod.subbedTime != -1 &&
          formatLastChanged(mod.subbedTime)) ||
        (mod.lastChanged && formatLastChanged(mod.lastChanged)) ||
        (mod.lastChangedLocal && formatLastChanged(mod.lastChangedLocal)) ||
        "",
      [sortingType, mod.lastChanged, mod.lastChangedLocal, mod.subbedTime],
    );

    const isCompact = layout === "compact";
    const checkboxId = mod.workshopId + "enabled";

    // A pinned load order is worth showing wherever the mod appears, since it survives being disabled and
    // is honoured again on re-enable. The derived index is only meaningful in a list whose order is the
    // one the game will use, so the dual layout's disabled pane leaves the cell blank instead.
    const loadOrderNumber =
      (mod.loadOrder != undefined && <span className="text-blue-500 font-bold">{mod.loadOrder + 1}</span>) ||
      (showPositionIndex && <span>{loadOrderIndex + 1}</span>) ||
      null;

    const reorderButton = (
      <button
        type="button"
        className={`${isLoadOrderPlacementSource ? "" : "hidden"} absolute left-0 self-center cursor-pointer first:p-0 z-10`}
        id={`load-order-icon-${mod.name}`}
        title={localization.setLoadOrderMode || "Set load order"}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSetLoadOrderMode(mod);
        }}
      >
        <BsArrowDownUp />
      </button>
    );

    const placementGhost = (position: number) => (
      <button
        type="button"
        id={`enabled-mod-placeholder-${position}`}
        aria-label={`${localization.selectNewLoadOrderPosition || "Select new load order / position"} ${position + 1}`}
        className={
          `drop-ghost h-10 cursor-pointer transition-colors hover:bg-blue-700/40 hover:opacity-100 ${ghostClass} ` +
          (activeLoadOrderPosition === position ? "bg-blue-700/40" : "opacity-70")
        }
        onClick={() => onSelectLoadOrderPosition(position)}
      ></button>
    );

    return (
      <div
        className={`relative grid row-div-paddings ${isCompact ? "row-div-paddings-compact" : ""} ${
          isLoadOrderPlacementMode ? "" : "row-hover-highlight"
        } ${gridClass} ${
          isLoadOrderPlacementSource ? "row-bg-color-manually" : ""
        } ${isRecentlyReordered ? "recently-reordered-row" : ""}`}
        key={mod.name}
        onMouseEnter={(e) => onRowHoverStart(e)}
        onMouseLeave={(e) => onRowHoverEnd(e)}
        id={mod.name}
        data-load-order={mod.loadOrder}
        style={style}
        ref={registerChild}
      >
        {isLoadOrderPlacementMode && placementGhost(rowIndex)}

        {(isCompact && (
          <>
            {/*
             * The compact layout has no enabled column, so the checkbox stays in the DOM purely as the
             * target every cell's <label htmlFor> points at - that is what makes clicking a row move the
             * mod between the two lists.
             */}
            <div
              id={`load-order-row-anchor-${mod.name}`}
              className="relative flex justify-center items-center"
              onContextMenu={() => onRemoveModOrder(mod)}
            >
              {loadOrderNumber}
              {canReorder && reorderButton}
              <input
                className="sr-only"
                type="checkbox"
                name={mod.workshopId}
                id={checkboxId}
                checked={mod.isEnabled}
                disabled={isLoadOrderPlacementMode}
                onChange={() => onModToggled(mod)}
              ></input>
            </div>

            {areThumbnailsEnabled && (
              <div onContextMenu={(e) => onModRightClick(e, mod)} className="flex place-items-center">
                <label className="cursor-pointer" htmlFor={checkboxId}>
                  <img className="max-w-[4rem] aspect-square" src={thumbnailSrc} decoding="async"></img>
                </label>
              </div>
            )}

            <div className="flex flex-col justify-center min-w-0" onContextMenu={(e) => onModRightClick(e, mod)}>
              <label className="cursor-pointer min-w-0 leading-tight" htmlFor={checkboxId}>
                <span
                  className={classNames("block", "truncate", "font-medium", {
                    ["text-violet-400"]: isAlwaysEnabled,
                  })}
                  title={decodedHumanName}
                >
                  {decodedHumanName}
                </span>
                {isAuthorEnabled && decodedAuthor && (
                  <span className="block truncate text-sm opacity-75" title={decodedAuthor}>
                    {decodedAuthor}
                  </span>
                )}
                <span className="block truncate text-sm opacity-90" title={mod.name}>
                  <PackName mod={mod} isEnabledInMergedMod={isEnabledInMergedMod} customFolderPath={customFolderPath} />
                </span>
              </label>
            </div>

            <div className="flex place-items-center" onContextMenu={(e) => onModRightClick(e, mod)}>
              <label className="cursor-pointer text-sm leading-tight" htmlFor={checkboxId}>
                {timeColumnValue}
              </label>
            </div>

            {showConfigColumn && (
              <div className="flex place-items-center justify-center gap-2">
                <ConfigIcons
                  {...{
                    mod,
                    hasDbCustomization,
                    hasFlowCustomization,
                    hasPackDataOverwrite,
                    onCustomizeModClicked,
                    onCustomizeModRightClick,
                    onFlowOptionsClicked,
                  }}
                />
              </div>
            )}
          </>
        )) || (
          <>
            <div
              id={`load-order-row-anchor-${mod.name}`}
              className="flex justify-center items-center"
              onContextMenu={() => onRemoveModOrder(mod)}
            >
              {loadOrderNumber}
            </div>
            <div className="relative grid">
              {(!canReorder && (
                <span className="make-tooltip-inline absolute self-center tooltip-width-20">
                  <Tooltip
                    placement="right"
                    style="light"
                    content={
                      <span className="text-slate-200">
                        Mod order can only be changed in the Enabled Mods tab. List of tabs is located in the top-left
                        of the window. You can also use the Ctrl+2 shortcut.
                      </span>
                    }
                  >
                    <div
                      className="hidden absolute left-0 self-center cursor-not-allowed first:p-0 z-10"
                      id={`load-order-icon-${mod.name}`}
                    >
                      <BsArrowDownUp opacity={0.5} />
                    </div>
                  </Tooltip>
                </span>
              )) ||
                reorderButton}
              <form className={"grid place-items-center h-full " + (areThumbnailsEnabled ? "bigger-checkbox" : "")}>
                <input
                  style={
                    (isAlwaysEnabled && {
                      color: "#6D28D9",
                    }) ||
                    {}
                  }
                  type="checkbox"
                  name={mod.workshopId}
                  id={checkboxId}
                  checked={mod.isEnabled}
                  disabled={isLoadOrderPlacementMode}
                  onChange={() => onModToggled(mod)}
                ></input>
              </form>
            </div>
            <div
              onContextMenu={(e) => onModRightClick(e, mod)}
              className={"flex place-items-center grid-area-autohide " + (areThumbnailsEnabled ? "" : "hidden")}
            >
              <label className="cursor-pointer" htmlFor={checkboxId}>
                {areThumbnailsEnabled && (
                  <img className="max-w-[6rem] aspect-square" src={thumbnailSrc} decoding="async"></img>
                )}
              </label>
            </div>
            <div className="flex place-items-center w-min-[0px]" onContextMenu={(e) => onModRightClick(e, mod)}>
              <label className="max-w-full inline-block break-words cursor-pointer" htmlFor={checkboxId}>
                <PackName mod={mod} isEnabledInMergedMod={isEnabledInMergedMod} customFolderPath={customFolderPath} />
              </label>
            </div>
            <div className="flex place-items-center" onContextMenu={(e) => onModRightClick(e, mod)}>
              <label className="cursor-pointer" htmlFor={checkboxId}>
                {decodedHumanName}
              </label>
            </div>
            <div
              onContextMenu={(e) => onModRightClick(e, mod)}
              className={"flex place-items-center grid-area-autohide " + (isAuthorEnabled ? "" : "hidden")}
            >
              <label className="cursor-pointer" htmlFor={checkboxId}>
                <span className="break-all">{decodedAuthor}</span>
              </label>
            </div>
            <div className="flex place-items-center grid-area-autohide" onContextMenu={(e) => onModRightClick(e, mod)}>
              <label
                style={{ height: areThumbnailsEnabled ? "28px" : "24px" }}
                className="cursor-pointer"
                htmlFor={checkboxId}
              >
                {timeColumnValue}
              </label>
            </div>
            <div className="flex place-items-center justify-center gap-2">
              <ConfigIcons
                {...{
                  mod,
                  hasDbCustomization,
                  hasFlowCustomization,
                  hasPackDataOverwrite,
                  onCustomizeModClicked,
                  onCustomizeModRightClick,
                  onFlowOptionsClicked,
                }}
              />
            </div>
          </>
        )}

        {isLast && isLoadOrderPlacementMode && placementGhost(rowIndex + 1)}
      </div>
    );
  },
);
export default ModRow;
