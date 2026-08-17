import React, { memo, useContext } from "react";
import { Tooltip } from "flowbite-react";
import { GoGear } from "react-icons/go";
import * as modRowSorting from "../utility/modRowSorting";
import { SortingType } from "../utility/modRowSorting";
import localizationContext from "../localizationContext";
import { ModListLayout } from "../utility/frontend/modListLayout";

type ModListHeaderProps = {
  layout: ModListLayout;
  /** The compact layout only shows the configuration column on the enabled-mods pane. */
  showConfigColumn: boolean;
  /** Sticky headers offset against the page padding unless the list scrolls inside its own pane. */
  isInsidePane: boolean;
  areThumbnailsEnabled: boolean;
  isAuthorEnabled: boolean;
  sortingType: SortingType;
  setSortingType: (sortingType: SortingType) => void;
  onOrderRightClick: () => void;
  onEnabledRightClick: () => void;
};

/**
 * The sticky column headers. They live in the same CSS grid as the rows, so which cells are rendered has
 * to track the row layout exactly.
 */
const ModListHeader = memo(
  ({
    layout,
    showConfigColumn,
    isInsidePane,
    areThumbnailsEnabled,
    isAuthorEnabled,
    sortingType,
    setSortingType,
    onOrderRightClick,
    onEnabledRightClick,
  }: ModListHeaderProps) => {
    const localized: Record<string, string> = useContext(localizationContext);
    const isCompact = layout === "compact";
    const headerClass = "mod-row-header" + (isInsidePane ? " mod-row-header-pane" : "");

    const orderHeader = (
      <div
        // Onboarding points at this cell, and the dual layout would otherwise render the id twice.
        id={isInsidePane ? undefined : "sortHeader"}
        className={`flex place-items-center w-full justify-center z-[11] rounded-tl-xl ${headerClass}`}
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
              className={`text-center w-full cursor-pointer ${modRowSorting.isOrderSort(sortingType) && "font-semibold"}`}
            >
              {localized.order}
            </span>
          </Tooltip>
        </span>
      </div>
    );

    const lastUpdatedHeader = (
      <div
        className={`flex place-items-center pl-1 ${isCompact ? "" : "grid-area-autohide "}${headerClass}`}
        onClick={() => setSortingType(SortingType.LastUpdated)}
        onContextMenu={() => setSortingType(SortingType.SubbedTime)}
      >
        {(modRowSorting.isLastUpdatedSort(sortingType) || modRowSorting.isSubbedTimeSort(sortingType)) &&
          modRowSorting.getSortingArrow(sortingType)}
        <Tooltip placement="left" style="light" content={localized.sortBySubscribedDate}>
          <span
            className={`cursor-pointer ${
              (modRowSorting.isLastUpdatedSort(sortingType) || modRowSorting.isSubbedTimeSort(sortingType)) &&
              "font-semibold"
            }`}
          >
            {(modRowSorting.isSubbedTimeSort(sortingType) && localized.subscriptionTime) || localized.lastUpdated}
          </span>
        </Tooltip>
      </div>
    );

    const configHeader = (
      <div
        className={`flex place-items-center pl-1 rounded-tr-xl justify-center ${headerClass}`}
        onClick={() => setSortingType(SortingType.IsCustomizable)}
      >
        {modRowSorting.isCustomizableSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
        <span className={`cursor-pointer ${modRowSorting.isCustomizableSort(sortingType) && "font-semibold"}`}>
          <GoGear></GoGear>
        </span>
      </div>
    );

    if (isCompact) {
      return (
        <>
          {orderHeader}
          {areThumbnailsEnabled && (
            <div className={`flex place-items-center pl-1 cursor-default ${headerClass}`}>{localized.thumbnail}</div>
          )}
          <div
            className={`flex place-items-center pl-1 ${headerClass}`}
            onClick={() => setSortingType(SortingType.HumanName)}
            onContextMenu={() => setSortingType(SortingType.PackName)}
          >
            {(modRowSorting.isHumanNameSort(sortingType) ||
              modRowSorting.isPackNameSort(sortingType) ||
              modRowSorting.isDataPackSort(sortingType)) &&
              modRowSorting.getSortingArrow(sortingType)}
            <Tooltip placement="bottom" style="light" content={localized.sortByDataPacks}>
              <span
                className={`cursor-pointer ${
                  (modRowSorting.isHumanNameSort(sortingType) ||
                    modRowSorting.isPackNameSort(sortingType) ||
                    modRowSorting.isDataPackSort(sortingType)) &&
                  "font-semibold"
                }`}
              >
                {localized.name}
              </span>
            </Tooltip>
          </div>
          {lastUpdatedHeader}
          {showConfigColumn && configHeader}
        </>
      );
    }

    return (
      <>
        {orderHeader}
        <div
          className={`flex place-items-center w-full justify-center z-10 ${headerClass}`}
          onClick={() => setSortingType(SortingType.IsEnabled)}
          onContextMenu={onEnabledRightClick}
          id="enabledHeader"
        >
          {modRowSorting.isEnabledSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <span className="tooltip-width-15">
            <Tooltip placement="bottom" style="light" content={localized.enableOrDisableAll}>
              <span
                className={`text-center cursor-pointer w-full ${modRowSorting.isEnabledSort(sortingType) && "font-semibold"}`}
              >
                {localized.enabled}
              </span>
            </Tooltip>
          </span>
        </div>
        <div
          className={
            `flex grid-area-autohide place-items-center pl-1 cursor-default ${headerClass} ` +
            (areThumbnailsEnabled ? "" : "hidden")
          }
        >
          {localized.thumbnail}
        </div>
        <div
          className={`flex grid-area-packName place-items-center pl-1 ${headerClass}`}
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
          className={`flex grid-area-humanName place-items-center pl-1 ${headerClass}`}
          onClick={() => setSortingType(SortingType.HumanName)}
        >
          {modRowSorting.isHumanNameSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <span className={`cursor-pointer ${modRowSorting.isHumanNameSort(sortingType) && "font-semibold"}`}>
            {localized.name}
          </span>
        </div>
        <div
          className={
            `flex grid-area-autohide place-items-center pl-1 ${headerClass} ` + (isAuthorEnabled ? "" : "hidden")
          }
          onClick={() => setSortingType(SortingType.Author)}
        >
          {modRowSorting.isAuthorSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <span className={`cursor-pointer ${modRowSorting.isAuthorSort(sortingType) && "font-semibold"}`}>
            {localized.author}
          </span>
        </div>
        {lastUpdatedHeader}
        {configHeader}
      </>
    );
  },
);

export default ModListHeader;
