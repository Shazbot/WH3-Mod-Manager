import React, { memo, useCallback, useRef } from "react";
import type { BuildingsTile } from "../../buildingsData/types";

export type BuildingTileProps = {
  tile: BuildingsTile;
  gridRow: number;
  gridColumn: number;
  /** The band's `r, g, b`, used for the border so a tile reads as part of its set. */
  colour: string;
  registerRef?: (levelKey: string, element: HTMLElement | null) => void;
  onContextMenu?: (tile: BuildingsTile, event: React.MouseEvent) => void;
  onHover?: (tile: BuildingsTile | undefined, element: HTMLElement | undefined) => void;
};

/** Portraits fan across the tile's top edge; beyond this they collapse into a `+N`. */
const MAX_VISIBLE_PORTRAITS = 4;

/**
 * Portrait geometry, as a fraction of the tile so it tracks the zoom variable.
 *
 * Sized off `--building-tile` rather than percentages because both the overlap margin and the right
 * overhang have to be exact fractions of the *card* width, and a percentage would resolve against
 * the strip instead.
 */
/** Unit cards are 60x130, and the box has to match or `object-cover` crops the art. */
const PORTRAIT_ASPECT = 130 / 60;
const PORTRAIT_WIDTH = 0.364;
const PORTRAIT_HEIGHT = PORTRAIT_WIDTH * PORTRAIT_ASPECT;
/** How much of each card its right-hand neighbour leaves showing. */
const PORTRAIT_VISIBLE_FRACTION = 1 / 3;
/** How far the rightmost card's right edge sits past the tile's, as a fraction of a card. */
const PORTRAIT_RIGHT_OVERHANG = 0.8;
/** How much of the card sits above the tile's top border, as a fraction of its height. */
const PORTRAIT_TOP_OVERHANG = 0.4;

const portraitStyle = (index: number): React.CSSProperties => ({
  width: `calc(var(--building-tile) * ${PORTRAIT_WIDTH})`,
  height: `calc(var(--building-tile) * ${PORTRAIT_HEIGHT})`,
  // Each card sits on top of the one before it, hiding all but the left third.
  marginLeft:
    index === 0 ? undefined : `calc(var(--building-tile) * ${-(1 - PORTRAIT_VISIBLE_FRACTION) * PORTRAIT_WIDTH})`,
  zIndex: index + 1,
});

/**
 * The strip hangs off the tile's top-right corner: past the right border by a fraction of a card's
 * width, and above the top border by a fraction of its height.
 */
const portraitStripStyle: React.CSSProperties = {
  right: `calc(var(--building-tile) * ${-PORTRAIT_RIGHT_OVERHANG * PORTRAIT_WIDTH})`,
  top: `calc(var(--building-tile) * ${-PORTRAIT_TOP_OVERHANG * PORTRAIT_HEIGHT})`,
};

const BuildingTile = memo(
  ({ tile, gridRow, gridColumn, colour, registerRef, onContextMenu, onHover }: BuildingTileProps) => {
    const elementRef = useRef<HTMLButtonElement | null>(null);

    const setRef = useCallback(
      (element: HTMLButtonElement | null) => {
        elementRef.current = element;
        registerRef?.(tile.levelKey, element);
      },
      [registerRef, tile.levelKey],
    );

    const handleContextMenu = useCallback(
      (event: React.MouseEvent) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(tile, event);
      },
      [onContextMenu, tile],
    );

    const handleEnter = useCallback(() => onHover?.(tile, elementRef.current ?? undefined), [onHover, tile]);
    const handleLeave = useCallback(() => onHover?.(undefined, undefined), [onHover]);

    const extraPortraits = tile.recruitable.length - MAX_VISIBLE_PORTRAITS;

    return (
      <button
        ref={setRef}
        type="button"
        onContextMenu={handleContextMenu}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
        style={{
          gridRow,
          gridColumn,
          width: "var(--building-tile)",
          height: "var(--building-tile)",
          borderColor: `rgba(${colour}, 0.85)`,
          // The strip overhangs the tile by slightly more than the column gap, so without this the
          // tile to the right - a later sibling - paints its background over the last card's edge.
          // Below the hover lift in buildings.css, which still has to win.
          zIndex: tile.recruitable.length > 0 ? 2 : undefined,
        }}
        className={`buildingTile group relative self-center justify-self-center rounded-sm border-2 bg-gray-900/70 ${
          tile.isExistingInRegion ? "shadow-[inset_0_0_10px_rgba(255,215,120,0.45)]" : ""
        } ${!tile.visibleInUi || tile.hasNoVariant || tile.isRuin ? "opacity-60 grayscale" : ""}`}
      >
        {tile.iconUrl ? (
          <img className="absolute inset-[8%] h-[84%] w-[84%] object-contain" src={tile.iconUrl} alt="" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[0.55rem] leading-tight text-gray-500">
            no icon
          </span>
        )}

        <span className="absolute bottom-0.5 left-1 text-[0.6rem] font-bold text-gray-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
          {tile.romanNumeral}
        </span>

        {tile.recruitable.length > 0 && (
          <span style={portraitStripStyle} className="absolute flex flex-row items-center">
            {tile.recruitable
              .slice(0, MAX_VISIBLE_PORTRAITS)
              .map((unit, index) =>
                unit.cardUrl ? (
                  <img
                    key={unit.unitKey}
                    src={unit.cardUrl}
                    alt=""
                    title={unit.localizedName}
                    style={portraitStyle(index)}
                    className="relative shrink-0 rounded-[1px] border border-amber-900/80 object-cover drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                  />
                ) : (
                  <span
                    key={unit.unitKey}
                    title={unit.localizedName}
                    style={portraitStyle(index)}
                    className="relative shrink-0 rounded-[1px] border border-amber-900/80 bg-amber-600/80"
                  />
                ),
              )}
            {/* Overlaid rather than appended, so the last *card* keeps the strip's right edge. */}
            {extraPortraits > 0 && (
              <span
                style={{ zIndex: MAX_VISIBLE_PORTRAITS + 1 }}
                className="absolute bottom-0 right-0 rounded-sm bg-black/75 px-[2px] text-[0.5rem] leading-none text-amber-300"
              >
                +{extraPortraits}
              </span>
            )}
          </span>
        )}

        {tile.instanceLimit != undefined && tile.instanceLimit > 0 && (
          <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-[3px] text-[0.5rem] leading-tight text-sky-300 group-hover:hidden">
            {tile.instanceLimit}
          </span>
        )}

        {/* Revealed on hover, matching the in-game tile: turns top-left, cost bottom-right. */}
        <span className="absolute left-0.5 top-0.5 hidden rounded bg-black/80 px-[3px] text-[0.55rem] leading-tight text-gray-100 group-hover:block">
          {tile.createTime}t
        </span>
        <span className="absolute bottom-0.5 right-0.5 hidden rounded bg-black/80 px-[3px] text-[0.55rem] leading-tight text-amber-300 group-hover:block">
          {tile.createCost}
        </span>
      </button>
    );
  },
);

export default BuildingTile;
