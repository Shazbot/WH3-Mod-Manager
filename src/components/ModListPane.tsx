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
import { ModListLayout, ModRowDatum } from "../utility/frontend/modListLayout";

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
  rowData: ModRowDatum[];
  /** The element this list scrolls inside: the page container, or the pane's own scroller in dual layout. */
  scrollElement: HTMLElement | null;
  listRef: RefObject<List>;
  paneHandleRef?: RefObject<ModListPaneHandle>;
  gridId?: string;
  layout: ModListLayout;
  showConfigColumn: boolean;
  isInsidePane: boolean;
  /** Whether this list lets the user pick a new load order position for a row. */
  canReorder: boolean;
  /** False where the row's position in the list says nothing about the order the game will load in. */
  showPositionIndex: boolean;
  gridClass: string;
  ghostClass: string;
  areThumbnailsEnabled: boolean;
  isAuthorEnabled: boolean;
  sortingType: SortingType;
  setSortingType: (sortingType: SortingType) => void;
  onOrderRightClick: () => void;
  onEnabledRightClick: () => void;
  loadOrderIndexByModName: Map<string, number>;
  loadOrderModName: string | undefined;
  activeLoadOrderPosition: number;
  isLoadOrderPlacementMode: boolean;
  recentlyReorderedModNames: Set<string>;
  callbacks: ModRowCallbacks;
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

    const minRowHeight = isCompact ? (areThumbnailsEnabled ? 72 : 56) : areThumbnailsEnabled ? 112 - 8 : 0;
    const estimatedRowSize = isCompact ? (areThumbnailsEnabled ? 72 : 56) : areThumbnailsEnabled ? 104 : 32;

    const rowHeight = useCallback(
      ({ index }: { index: number }) => Math.max(minRowHeight, cache.rowHeight({ index })),
      [cache, minRowHeight],
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
      <div className={"grid pt-1.5 " + gridClass} id={gridId}>
        <ModListHeader
          {...{
            layout,
            showConfigColumn,
            isInsidePane,
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
