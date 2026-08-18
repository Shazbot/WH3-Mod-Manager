import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useLocalizations } from "../../localizationContext";
import BuildingSetBand from "./BuildingSetBand";
import BuildingUpgradeArrows from "./BuildingUpgradeArrows";
import { computeBoardLayout } from "./buildingsLayout";
import type { BuildingsRegionView, BuildingsTile } from "../../buildingsData/types";
import "./buildings.css";

export type BuildingsBoardProps = {
  view: BuildingsRegionView;
  /** Multiplies the base tile size. The arrows read real pixels off the DOM, so no scale(). */
  zoom: number;
  onTileContextMenu?: (tile: BuildingsTile, event: React.MouseEvent) => void;
  onBandContextMenu?: (setKey: string, setName: string, event: React.MouseEvent) => void;
  onTileHover?: (tile: BuildingsTile | undefined, element: HTMLElement | undefined) => void;
};

/* What used to be the 125% zoom, which is the size the panel is meant to read at. */
const BASE_TILE_PX = 96;
const BASE_ROW_GAP_PX = 27;
const BASE_COLUMN_GAP_PX = 27;
/** A mouse reporting `deltaMode: 1` gives lines, not pixels. */
const WHEEL_LINE_PX = 16;

const BuildingsBoard = memo(
  ({ view, zoom, onTileContextMenu, onBandContextMenu, onTileHover }: BuildingsBoardProps) => {
    const localized = useLocalizations();
    const layout = useMemo(() => computeBoardLayout(view), [view]);
    const boardRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const tileElements = useRef(new Map<string, HTMLElement>());

    /**
     * The board is one long row of bands, so a plain wheel should walk along it.
     *
     * A native listener rather than `onWheel`: React registers wheel at the root as passive, which
     * makes `preventDefault` a no-op there, and without it the page scrolls as well as the board.
     * Re-runs when the board first appears, since the empty state renders no scroll container.
     */
    useEffect(() => {
      const element = scrollRef.current;
      if (!element) return;

      const onWheel = (event: WheelEvent) => {
        // The browser's own zoom gesture, and a trackpad swipe that is already horizontal.
        if (event.ctrlKey || event.metaKey) return;
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        if (event.deltaY === 0) return;
        // Nothing to scroll sideways: let it through so an outer scroller can still use it.
        if (element.scrollWidth <= element.clientWidth) return;

        const delta =
          event.deltaMode === 1
            ? event.deltaY * WHEEL_LINE_PX
            : event.deltaMode === 2
              ? event.deltaY * element.clientWidth
              : event.deltaY;
        element.scrollLeft += delta;
        event.preventDefault();
      };

      element.addEventListener("wheel", onWheel, { passive: false });
      return () => element.removeEventListener("wheel", onWheel);
    }, [layout.bands.length]);

    const registerTileRef = useCallback((levelKey: string, element: HTMLElement | null) => {
      if (element) tileElements.current.set(levelKey, element);
      else tileElements.current.delete(levelKey);
    }, []);

    if (layout.bands.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-sm text-gray-400">
          {localized.buildingsNoMatches || "No buildings match these filters."}
        </div>
      );
    }

    return (
      <div
        ref={scrollRef}
        className="max-h-full w-full overflow-auto scrollbar scrollbar-track-gray-800 scrollbar-thumb-blue-800"
      >
        <div
          ref={boardRef}
          className="buildingsBoard relative flex w-max items-stretch"
          style={{
            ["--building-tile" as string]: `${Math.round(BASE_TILE_PX * zoom)}px`,
            ["--building-gap" as string]: `${Math.max(4, Math.round(BASE_ROW_GAP_PX * zoom))}px`,
            ["--building-column-gap" as string]: `${Math.max(4, Math.round(BASE_COLUMN_GAP_PX * zoom))}px`,
          }}
        >
          {layout.bands.map((band) => (
            <BuildingSetBand
              key={band.setKey}
              band={band}
              rowCount={layout.rowCount}
              buildingFrameUrl={view.buildingFrameUrl}
              registerTileRef={registerTileRef}
              onTileContextMenu={onTileContextMenu}
              onBandContextMenu={onBandContextMenu}
              onTileHover={onTileHover}
            />
          ))}
          <BuildingUpgradeArrows
            edges={layout.edges}
            tileElements={tileElements}
            containerRef={boardRef}
            layoutToken={`${view.query.region}|${view.query.culture}|${zoom}|${layout.bands.length}`}
          />
        </div>
      </div>
    );
  },
);

export default BuildingsBoard;
