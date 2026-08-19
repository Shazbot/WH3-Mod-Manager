import React, { memo, useContext } from "react";
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
     * One tooltip per column, and it is the native one.
     *
     * A compact column is an icon, so it has to name itself; a wide one is already labelled in the header
     * and only adds what it does. The shift that sorts both panes at once is worth saying wherever there
     * are two panes to sort. A column with nothing to add gets no tooltip rather than an empty one.
     */
    const columnTitle = (columnName: string, ...details: (string | undefined)[]) => {
      const lines = [
        (isCompact && columnName) || undefined,
        ...details,
        (isCompact && (localized.sortBothPanes || "Shift click: sort both lists.")) || undefined,
      ].filter((line) => line);
      return lines.length > 0 ? lines.join("\n") : undefined;
    };

    /** What right clicking a column that sorts by more than one thing steps through. */
    const sortCycleLines = (cycleLabels: (string | undefined)[]) => [
      localized.switchSortColumn || "Right click to switch what this column sorts by",
      cycleLabels.filter((label) => label).join(" \u2192 "),
    ];

    /**
     * The panes are half the width the single list gets, so their columns are named with icons instead of
     * words. The wording still goes out as the accessible name, and to the hover tooltip below - it used
     * to be a native title as well, which the browser drew on top of that tooltip. The active sort column
     * is tinted rather than emboldened, since font weight does nothing to an SVG.
     */
    const columnLabel = (label: string, Icon: IconType, isActiveSort: boolean, wideClassName = "") =>
      (isCompact && (
        <span
          className={`inline-flex items-center cursor-pointer transition-opacity ${
            isActiveSort ? "text-blue-400 opacity-100" : "opacity-60 hover:opacity-100"
          }`}
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
        title={columnTitle(
          localized.order,
          localized.priorityTooltipOne,
          localized.priorityTooltipTwo,
          localized.priorityTooltipThree,
        )}
      >
        {modRowSorting.isOrderSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
        {columnLabel(localized.order, GoListOrdered, modRowSorting.isOrderSort(sortingType), "text-center w-full")}
      </div>
    );

    const timeSortingLabels: Partial<Record<SortingType, string>> = {
      [SortingType.LastUpdated]: localized.lastUpdated,
      [SortingType.SubbedTime]: localized.subscriptionTime,
    };
    const timeSortingField = modRowSorting.getTimeSortingField(sortingType);
    const timeColumnName =
      (modRowSorting.isSubbedTimeSort(sortingType) && localized.subscriptionTime) || localized.lastUpdated;
    const timeCycleLines = sortCycleLines(
      modRowSorting.getTimeSortingCycle().map((sortingTypeInCycle) => timeSortingLabels[sortingTypeInCycle]),
    );

    const lastUpdatedHeader = (
      <div
        className={`flex place-items-center ${isCompact ? "justify-center " : "pl-1 grid-area-autohide "}${headerClass}`}
        // Right clicking swaps the date, left clicking reverses whichever one the column is on.
        onClick={(event) => setSortingType(timeSortingField ?? SortingType.LastUpdated, event.shiftKey)}
        onContextMenu={(event) => setSortingType(modRowSorting.getNextTimeSortingType(sortingType), event.shiftKey)}
        title={columnTitle(timeColumnName, ...timeCycleLines)}
      >
        {timeSortingField !== undefined && modRowSorting.getSortingArrow(sortingType)}
        {columnLabel(timeColumnName, GoClock, timeSortingField !== undefined)}
        {/* The compact column is a clock either way, so the sort it is on has to be said in words. The
            wide layout already spells it out in the column label itself. */}
        {isCompact && modRowSorting.isSubbedTimeSort(sortingType) && (
          <span className="ml-1 truncate text-xs text-blue-400 cursor-pointer" aria-hidden>
            {localized.subbedTimeShort || "sub"}
          </span>
        )}
      </div>
    );

    const configHeader = (
      <div
        className={`flex place-items-center justify-center rounded-tr-xl ${isCompact ? "" : "pl-1 "}${headerClass}`}
        onClick={(event) => setSortingType(SortingType.IsCustomizable, event.shiftKey)}
        title={columnTitle(localized.configurationColumn || "Configuration")}
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
            title={columnTitle(
              nameSortingLabel ?? localized.name,
              ...sortCycleLines(
                modRowSorting
                  .getNameSortingCycle(hasDataMods)
                  .map((sortingTypeInCycle) => nameSortingLabels[sortingTypeInCycle]),
              ),
            )}
          >
            {nameSortingField !== undefined && modRowSorting.getSortingArrow(sortingType)}
            {columnLabel(nameSortingLabel ?? localized.name, GoTypography, nameSortingField !== undefined)}
            {nameSortingLabel && (
              // Part of the control rather than a caption beside it: the cell around it is what sorts, so
              // the marker takes the same cursor as the icon.
              <span className="ml-1 truncate text-xs text-blue-400 cursor-pointer" aria-hidden>
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
          title={columnTitle(localized.enabled, localized.enableOrDisableAll)}
        >
          {modRowSorting.isEnabledSort(sortingType) && modRowSorting.getSortingArrow(sortingType)}
          <span
            className={`text-center cursor-pointer w-full ${modRowSorting.isEnabledSort(sortingType) && "font-semibold"}`}
          >
            {localized.enabled}
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
          title={columnTitle(localized.pack, localized.sortByDataPacks)}
        >
          {(modRowSorting.isPackNameSort(sortingType) || modRowSorting.isDataPackSort(sortingType)) &&
            modRowSorting.getSortingArrow(sortingType)}
          <span
            className={`cursor-pointer ${
              (modRowSorting.isPackNameSort(sortingType) || modRowSorting.isDataPackSort(sortingType)) &&
              "font-semibold"
            }`}
          >
            {(modRowSorting.isDataPackSort(sortingType) && localized.dataPacks) || localized.pack}
          </span>
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
