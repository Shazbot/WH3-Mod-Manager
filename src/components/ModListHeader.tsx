import React, { memo, useContext } from "react";
import { Tooltip } from "flowbite-react";
import { GoClock, GoGear, GoImage, GoListOrdered, GoTypography } from "react-icons/go";
import { IconType } from "react-icons";
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
  /** Whether the list holds a data mod; the compact name column skips that sort when it does not. */
  hasDataMods: boolean;
  areThumbnailsEnabled: boolean;
  isAuthorEnabled: boolean;
  sortingType: SortingType;
  /** The second argument is the shift-click that sorts both panes of the dual layout by one column. */
  setSortingType: (sortingType: SortingType, isSortingBothPanes?: boolean) => void;
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
    hasDataMods,
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

    /*
     * The compact layout stacks the title, the pack name and the author into one cell, so its one name
     * column has to cover all three - and the data mods sort the wide layout hangs off the pack column.
     * Right clicking steps through them, left clicking reverses whichever is current, and the active one
     * is named next to the icon: the column is otherwise indistinguishable between the four.
     */
    const nameSortingLabels: Partial<Record<SortingType, string>> = {
      [SortingType.HumanName]: localized.name,
      [SortingType.PackName]: localized.pack,
      [SortingType.Author]: localized.author,
      [SortingType.IsDataPack]: localized.dataPacks,
    };
    const nameSortingField = modRowSorting.getNameSortingField(sortingType);
    const nameSortingLabel = (nameSortingField !== undefined && nameSortingLabels[nameSortingField]) || undefined;

    /**
     * The panes are half the width the single list gets, so their columns are named with icons instead of
     * words. The wording still goes out as the accessible name and the hover title, which matters more
     * once the visible label is gone. The active sort column is tinted rather than emboldened, since font
     * weight does nothing to an SVG.
     */
    const columnLabel = (label: string, Icon: IconType, isActiveSort: boolean, wideClassName = "") =>
      (isCompact && (
        <span
          className={`inline-flex items-center cursor-pointer transition-opacity ${
            isActiveSort ? "text-blue-400 opacity-100" : "opacity-60 hover:opacity-100"
          }`}
          // Each pane sorts on its own, so the way to sort both by one column has to be said somewhere.
          title={`${label}\n${localized.sortBothPanes || "Shift click: sort both lists."}`}
        >
          <Icon size="1.25rem" aria-hidden />
          <span className="sr-only">{label}</span>
        </span>
      )) || <span className={`cursor-pointer ${wideClassName} ${isActiveSort ? "font-semibold" : ""}`}>{label}</span>;

    const orderHeader = (
      <div
        // Onboarding points at this cell, and the dual layout would otherwise render the id twice.
        id={isInsidePane ? undefined : "sortHeader"}
        className={`flex place-items-center w-full justify-center z-[11] rounded-tl-xl ${headerClass}`}
        onClick={(event) => setSortingType(SortingType.Ordered, event.shiftKey)}
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
            {columnLabel(localized.order, GoListOrdered, modRowSorting.isOrderSort(sortingType), "text-center w-full")}
          </Tooltip>
        </span>
      </div>
    );

    const lastUpdatedHeader = (
      <div
        className={`flex place-items-center ${isCompact ? "justify-center " : "pl-1 grid-area-autohide "}${headerClass}`}
        onClick={(event) => setSortingType(SortingType.LastUpdated, event.shiftKey)}
        onContextMenu={(event) => setSortingType(SortingType.SubbedTime, event.shiftKey)}
      >
        {(modRowSorting.isLastUpdatedSort(sortingType) || modRowSorting.isSubbedTimeSort(sortingType)) &&
          modRowSorting.getSortingArrow(sortingType)}
        <Tooltip placement="left" style="light" content={localized.sortBySubscribedDate}>
          {columnLabel(
            (modRowSorting.isSubbedTimeSort(sortingType) && localized.subscriptionTime) || localized.lastUpdated,
            GoClock,
            modRowSorting.isLastUpdatedSort(sortingType) || modRowSorting.isSubbedTimeSort(sortingType),
          )}
        </Tooltip>
        {/* The compact column is a clock either way, so the sort it is on has to be said in words. The
            wide layout already spells it out in the column label itself. */}
        {isCompact && modRowSorting.isSubbedTimeSort(sortingType) && (
          <span className="ml-1 truncate text-xs text-blue-400" aria-hidden>
            {localized.subbedTimeShort || "sub"}
          </span>
        )}
      </div>
    );

    const configHeader = (
      <div
        className={`flex place-items-center justify-center rounded-tr-xl ${isCompact ? "" : "pl-1 "}${headerClass}`}
        onClick={(event) => setSortingType(SortingType.IsCustomizable, event.shiftKey)}
      >
        {modRowSorting.isCustomizableSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
        {(isCompact &&
          columnLabel(
            localized.configurationColumn || "Configuration",
            GoGear,
            modRowSorting.isCustomizableSort(sortingType),
          )) || (
          <span className={`cursor-pointer ${modRowSorting.isCustomizableSort(sortingType) && "font-semibold"}`}>
            <GoGear></GoGear>
          </span>
        )}
      </div>
    );

    if (isCompact) {
      return (
        <>
          {orderHeader}
          {areThumbnailsEnabled && (
            <div
              className={`flex place-items-center justify-center cursor-default ${headerClass}`}
              title={localized.thumbnail}
            >
              {/* Not a sort control, so it stays muted and does not react to hover. */}
              <GoImage className="opacity-60" size="1.25rem" aria-hidden />
              <span className="sr-only">{localized.thumbnail}</span>
            </div>
          )}
          <div
            className={`flex place-items-center justify-center min-w-0 ${headerClass}`}
            onClick={(event) => setSortingType(nameSortingField ?? SortingType.HumanName, event.shiftKey)}
            onContextMenu={(event) =>
              setSortingType(modRowSorting.getNextNameSortingType(sortingType, hasDataMods), event.shiftKey)
            }
          >
            {nameSortingField !== undefined && modRowSorting.getSortingArrow(sortingType)}
            <Tooltip
              placement="bottom"
              style="light"
              content={
                <>
                  <div>{localized.switchNameSortColumn || "Right click to switch what this column sorts by"}</div>
                  <div>
                    {modRowSorting
                      .getNameSortingCycle(hasDataMods)
                      .map((sortingTypeInCycle) => nameSortingLabels[sortingTypeInCycle])
                      .join(" \u2192 ")}
                  </div>
                </>
              }
            >
              {columnLabel(nameSortingLabel ?? localized.name, GoTypography, nameSortingField !== undefined)}
            </Tooltip>
            {nameSortingLabel && (
              <span className="ml-1 truncate text-xs text-blue-400" aria-hidden>
                {nameSortingLabel}
              </span>
            )}
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
          onClick={(event) => setSortingType(SortingType.IsEnabled, event.shiftKey)}
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
          onClick={(event) => setSortingType(SortingType.PackName, event.shiftKey)}
          onContextMenu={(event) => setSortingType(SortingType.IsDataPack, event.shiftKey)}
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
          onClick={(event) => setSortingType(SortingType.HumanName, event.shiftKey)}
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
          onClick={(event) => setSortingType(SortingType.Author, event.shiftKey)}
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
