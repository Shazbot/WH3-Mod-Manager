import React, { memo } from "react";
import BuildingTile from "./BuildingTile";
import type { BoardBand } from "./buildingsLayout";
import type { BuildingsTile } from "../../buildingsData/types";

export type BuildingSetBandProps = {
  band: BoardBand;
  /** Shared by every band so the tiers read as continuous rows across the whole board. */
  rowCount: number;
  buildingFrameUrl?: string;
  registerTileRef?: (levelKey: string, element: HTMLElement | null) => void;
  onTileContextMenu?: (tile: BuildingsTile, event: React.MouseEvent) => void;
  onBandContextMenu?: (setKey: string, setName: string, event: React.MouseEvent) => void;
  onTileHover?: (tile: BuildingsTile | undefined, element: HTMLElement | undefined) => void;
};

/**
 * One building set: its chains as columns, tinted with the set's own colour and labelled at the
 * bottom, the way the game's construction panel does it.
 */
const BuildingSetBand = memo(
  ({
    band,
    rowCount,
    buildingFrameUrl,
    registerTileRef,
    onTileContextMenu,
    onBandContextMenu,
    onTileHover,
  }: BuildingSetBandProps) => (
    <section
      className="buildingSetBand flex shrink-0 flex-col"
      style={{ ["--building-band-colour" as string]: band.colour }}
    >
      <div
        className="grid flex-1 content-end gap-x-[var(--building-column-gap)] gap-y-[var(--building-gap)] px-[calc(var(--building-gap)*2)] pt-[var(--building-gap)]"
        style={{
          gridTemplateColumns: `repeat(${band.columnCount}, var(--building-tile))`,
          gridTemplateRows: `repeat(${rowCount}, var(--building-tile))`,
        }}
      >
        {band.columns.flatMap((column) =>
          column.cells.map((cell) => (
            <BuildingTile
              key={`${column.chainKey}:${cell.tile.levelKey}`}
              tile={cell.tile}
              gridRow={cell.gridRow}
              gridColumn={cell.gridColumn}
              colour={band.colour}
              buildingFrameUrl={buildingFrameUrl}
              registerRef={registerTileRef}
              onContextMenu={onTileContextMenu}
              onHover={onTileHover}
            />
          )),
        )}
      </div>
      <div
        className="buildingSetLabel mt-[var(--building-gap)] truncate px-2 py-1 text-center text-[0.7rem] font-medium"
        title={band.setKey}
        onContextMenu={(event) => {
          if (!onBandContextMenu) return;
          event.preventDefault();
          onBandContextMenu(band.setKey, band.localizedName, event);
        }}
      >
        {band.localizedName}
      </div>
    </section>
  ),
);

export default BuildingSetBand;
