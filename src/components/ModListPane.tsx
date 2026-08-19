import React, {
  CSSProperties,
  memo,
  RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { AutoSizer, CellMeasurer, CellMeasurerCache, List, WindowScroller } from "react-virtualized";
import { MeasuredCellParent } from "react-virtualized/dist/es/CellMeasurer";
import { GridCoreProps } from "react-virtualized/dist/es/Grid";
import ModRow from "./ModRow";
import ModListHeader from "./ModListHeader";
import { SortingType } from "../utility/modRowSorting";
import ModListCategoryHeader from "./ModListCategoryHeader";
import { ModListLayout, ModListRow } from "../utility/frontend/modListLayout";

/**
 * How tall a row is before CellMeasurer has measured it. The thumbnail drives the height when it is on;
 * otherwise it is three stacked lines of text. Keyed to the density variables in index.css.
 */
const compactRowFloors: Record<ModListDensity, { withThumbnails: number; textOnly: number }> = {
  compact: { withThumbnails: 80, textOnly: 72 },
  comfortable: { withThumbnails: 104, textOnly: 96 },
  roomy: { withThumbnails: 128, textOnly: 112 },
};

/** The row handlers, bundled so they can be forwarded through the pane without ten more props. */
export type ModRowCallbacks = {
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
};

export type ModListPaneHandle = {
  /** Scrolls the outer container so a virtualized row that is not mounted yet gets rendered. */
  scrollRowIntoView: (index: number) => void;
};

type ModListPaneProps = {
  /** The rows to render, category headings included when the list is grouped. */
  rowData: ModListRow[];
  /** The element this list scrolls inside: the page container, or the pane's own scroller in dual layout. */
  scrollElement: HTMLElement | null;
  listRef: RefObject<List>;
  paneHandleRef?: RefObject<ModListPaneHandle>;
  gridId?: string;
  layout: ModListLayout;
  showConfigColumn: boolean;
  isInsidePane: boolean;
  /** Whether the list holds a data mod; the compact name column skips that sort when it does not. */
  hasDataMods: boolean;
  density: ModListDensity;
  /** Whether this list lets the user pick a new load order position for a row. */
  canReorder: boolean;
  /** False where the row's position in the list says nothing about the order the game will load in. */
  showPositionIndex: boolean;
  gridClass: string;
  ghostClass: string;
  areThumbnailsEnabled: boolean;
  isAuthorEnabled: boolean;
  sortingType: SortingType;
  /** The second argument is the shift-click that sorts both panes of the dual layout by one column. */
  setSortingType: (sortingType: SortingType, isSortingBothPanes?: boolean) => void;
  onOrderRightClick: () => void;
  onEnabledRightClick: () => void;
  loadOrderIndexByModName: Map<string, number>;
  loadOrderModName: string | undefined;
  activeLoadOrderPosition: number;
  isLoadOrderPlacementMode: boolean;
  recentlyReorderedModNames: Set<string>;
  callbacks: ModRowCallbacks;
  /** Collapses or expands one category. Absent on a list that is not grouped. */
  onCategoryToggled?: (category: string) => void;
  /** Enables or disables every mod of one category. */
  onCategoryRightClick?: (category: string) => void;
  /** The colours the categories were given in the categories tab, so the headings match them. */
  categoryColors?: Record<string, string>;
};

/**
 * One virtualized mod list: sticky headers plus the rows, sharing a single CSS grid so the two line up.
 *
 * `WindowScroller` drives the list from an outer scroll container rather than a scrollbar of its own,
 * which is what lets the headers stay sticky above `autoHeight` rows. Pointing it at a pane's own
 * scroller instead of the page container is the only difference between the single and dual layouts.
 */
const ModListPane = memo(
  ({
    rowData,
    scrollElement,
    listRef,
    paneHandleRef,
    gridId,
    layout,
    showConfigColumn,
    isInsidePane,
    hasDataMods,
    density,
    canReorder,
    showPositionIndex,
    gridClass,
    ghostClass,
    areThumbnailsEnabled,
    isAuthorEnabled,
    sortingType,
    setSortingType,
    onOrderRightClick,
    onEnabledRightClick,
    loadOrderIndexByModName,
    loadOrderModName,
    activeLoadOrderPosition,
    isLoadOrderPlacementMode,
    recentlyReorderedModNames,
    callbacks,
    onCategoryToggled,
    onCategoryRightClick,
    categoryColors,
  }: ModListPaneProps) => {
    const isCompact = layout === "compact";
    const listWrapperRef = useRef<HTMLDivElement | null>(null);

    const cache = useMemo(
      () =>
        new CellMeasurerCache({
          fixedWidth: true,
          defaultHeight: 32,
          minHeight: 32,
        }),
      [],
    );

    // Anything that changes how tall a row is has to invalidate the measurements, including entering
    // load order placement mode, which adds a drop placeholder to every row.
    useEffect(() => {
      cache.clearAll();
      listRef.current?.recomputeRowHeights();
    }, [
      areThumbnailsEnabled,
      cache,
      density,
      isAuthorEnabled,
      isCompact,
      isLoadOrderPlacementMode,
      listRef,
      rowData,
      showConfigColumn,
    ]);

    useImperativeHandle(
      paneHandleRef,
      () => ({
        scrollRowIntoView: (index: number) => {
          const list = listRef.current;
          const wrapper = listWrapperRef.current;
          if (!list || !wrapper || !scrollElement || index < 0) return;

          // The list reports offsets against its own content box, so translate through where that content
          // sits inside the scroll container.
          const wrapperOffset =
            wrapper.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
          const currentListScrollTop = Math.max(0, scrollElement.scrollTop - wrapperOffset);
          const nextListScrollTop = list.getOffsetForRow({ alignment: "auto", index });
          scrollElement.scrollTop += nextListScrollTop - currentListScrollTop;
        },
      }),
      [listRef, scrollElement],
    );

    const compactFloor = compactRowFloors[density];
    const compactRowHeight = areThumbnailsEnabled ? compactFloor.withThumbnails : compactFloor.textOnly;
    // CellMeasurer still measures the real height; these only floor it and seed the scrollbar.
    const minRowHeight = isCompact ? compactRowHeight : areThumbnailsEnabled ? 112 - 8 : 0;
    const estimatedRowSize = isCompact ? compactRowHeight : areThumbnailsEnabled ? 104 : 32;

    const rowHeight = useCallback(
      ({ index }: { index: number }) => {
        const measured = cache.rowHeight({ index });
        // The floor exists to keep a mod row from collapsing before it is measured; a category heading is
        // a single line of text and would be padded out to a mod's height by it.
        return rowData[index]?.kind === "categoryHeader" ? measured : Math.max(minRowHeight, measured);
      },
      [cache, minRowHeight, rowData],
    );

    const Row = ({
      index,
      key,
      parent,
      style,
    }: {
      index: number;
      parent: React.Component<GridCoreProps> & MeasuredCellParent;
      key: string;
      style: CSSProperties;
    }) => {
      const row = rowData[index];
      if (!row) return <></>;

      if (row.kind === "categoryHeader") {
        return (
          <CellMeasurer cache={cache} index={index} key={key} parent={parent}>
            {({ registerChild }) => (
              <ModListCategoryHeader
                {...{
                  style,
                  category: row.category,
                  modCount: row.modCount,
                  notEnabledCount: row.notEnabledCount,
                  isCollapsed: row.isCollapsed,
                  color: categoryColors?.[row.category],
                  onCategoryToggled,
                  onCategoryRightClick,
                  registerChild,
                }}
              />
            )}
          </CellMeasurer>
        );
      }

      return (
        <CellMeasurer cache={cache} index={index} key={key} parent={parent}>
          {({ registerChild }) => (
            <ModRow
              key={key}
              {...{
                style,
                loadOrderIndex: loadOrderIndexByModName.get(row.mod.name) ?? index,
                rowIndex: index,
                gridClass,
                mod: row.mod,
                ...callbacks,
                activeLoadOrderPosition,
                isLoadOrderPlacementMode,
                isLoadOrderPlacementSource: row.mod.name === loadOrderModName,
                isRecentlyReordered: recentlyReorderedModNames.has(row.mod.name),
                sortingType,
                canReorder,
                showPositionIndex,
                layout,
                showConfigColumn,
                isLast: rowData.length == index + 1,
                isAlwaysEnabled: row.isAlwaysEnabled,
                isEnabledInMergedMod: row.isEnabledInMergedMod,
                areThumbnailsEnabled,
                isAuthorEnabled,
                ghostClass,
                thumbnailSrc: row.thumbnailSrc,
                decodedHumanName: row.decodedHumanName,
                decodedAuthor: row.decodedAuthor,
                customFolderPath: row.customFolderPath,
                hasDbCustomization: row.hasDbCustomization,
                hasFlowCustomization: row.hasFlowCustomization,
                hasPackDataOverwrite: row.hasPackDataOverwrite,
                registerChild,
              }}
            ></ModRow>
          )}
        </CellMeasurer>
      );
    };

    return (
      <div
        className={`grid pt-1.5 ${(isCompact && `mod-list-compact mod-list-${density}`) || ""} ${gridClass}`}
        id={gridId}
        /*
         * Shift clicking a column header sorts both panes by it. Shift is also how the browser extends a
         * text selection to whatever was clicked, which paints every row between the last caret position
         * and the header blue - swallowing the mousedown is what keeps the shortcut from doing that.
         */
        onMouseDownCapture={(event) => {
          if (event.shiftKey && (event.target as HTMLElement).closest(".mod-row-header")) event.preventDefault();
        }}
      >
        <ModListHeader
          {...{
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
          }}
        />

        {scrollElement && (
          <WindowScroller scrollElement={scrollElement}>
            {({ height, isScrolling, onChildScroll, scrollTop, registerChild }) => (
              // AutoSizer measures its own parentNode, which is the grid container above, so the list gets
              // the full grid width instead of the first column's track.
              <AutoSizer disableHeight>
                {({ width }) => (
                  <div
                    ref={(element) => {
                      listWrapperRef.current = element;
                      (registerChild as unknown as (element: HTMLDivElement | null) => void)(element);
                    }}
                  >
                    <List
                      ref={listRef}
                      autoHeight
                      height={height || 500}
                      width={width}
                      scrollTop={scrollTop}
                      isScrolling={isScrolling}
                      onScroll={onChildScroll}
                      rowHeight={rowHeight}
                      rowRenderer={Row}
                      estimatedRowSize={estimatedRowSize}
                      rowCount={rowData.length}
                      overscanRowCount={areThumbnailsEnabled ? 6 : 12}
                      deferredMeasurementCache={cache}
                    />
                  </div>
                )}
              </AutoSizer>
            )}
          </WindowScroller>
        )}
      </div>
    );
  },
);

export default ModListPane;
