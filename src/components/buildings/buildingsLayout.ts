/**
 * Grid maths for the buildings board. Pure, so it can be unit-tested without a DOM.
 *
 * The in-game panel lays the building sets out side by side across the width of the screen, each
 * labelled at the bottom, with every chain inside a set as one column and that chain's levels
 * stacked bottom-up. Crucially the axis is shared by the whole panel, not per set, so the tiers read
 * as continuous horizontal rows - which is why `rowCount` here is global rather than per band.
 *
 * The row a tile lands on is `tile.tierRow`, worked out in the derivation, not its own level: the
 * axis is the *primary settlement tier*, so a secondary building lines up with the settlement level
 * it requires. See `BuildingsTile.tierRow`.
 */
import type {
  BuildingsRegionView,
  BuildingsSetBand,
  BuildingsTile,
  BuildingsUpgradeEdge,
} from "../../buildingsData/types";

export interface BoardCell {
  tile: BuildingsTile;
  /** 1-based CSS grid row, counted so the lowest level lands on the bottom row. */
  gridRow: number;
  /** 1-based CSS grid column within its band. */
  gridColumn: number;
}

export interface BoardColumn {
  chainKey: string;
  localizedName: string;
  /** 1-based CSS grid column the chain starts at, within its band. */
  gridColumn: number;
  /**
   * How many grid columns the chain occupies: the most tiles any one of its tiers holds.
   *
   * Normally 1. A chain that branches has two or more alternatives on the same tier - vanilla's
   * `wh3_main_underdeep_dwf_grudges` upgrades into either `_2` or the "grudges off" `_2_a`, and
   * `wh3_main_minor_cult_the_cabal` offers nine - and they cannot share one cell.
   */
  width: number;
  cells: BoardCell[];
  sources: string[];
}

export interface BoardBand {
  setKey: string;
  localizedName: string;
  colour: string;
  columns: BoardColumn[];
  columnCount: number;
}

export interface BoardLayout {
  bands: BoardBand[];
  /** Rows every band spans, so the tiers line up across the whole board. */
  rowCount: number;
  edges: BuildingsUpgradeEdge[];
  /** Cell lookup by level key, for the arrow overlay. Duplicated tiles keep their first cell. */
  cellByLevelKey: Record<string, { setKey: string; gridRow: number; gridColumn: number }>;
}

const bandColour = (band: BuildingsSetBand) => `${band.colourR}, ${band.colourG}, ${band.colourB}`;

export const computeBoardLayout = (view: BuildingsRegionView): BoardLayout => {
  let highestRow = 0;
  for (const band of view.bands) {
    for (const column of band.columns) {
      for (const tile of column.tiles) if (tile.tierRow > highestRow) highestRow = tile.tierRow;
    }
  }
  const rowCount = highestRow + 1;

  const cellByLevelKey: BoardLayout["cellByLevelKey"] = {};
  const bands: BoardBand[] = view.bands.map((band) => {
    // A chain is normally one grid column, so this usually counts up by one per chain. A branching
    // chain claims as many as its widest tier needs, and the ones after it shift right.
    let nextGridColumn = 1;
    const columns: BoardColumn[] = band.columns.map((column) => {
      const tilesByTier = new Map<number, BuildingsTile[]>();
      for (const tile of column.tiles) {
        const tier = tilesByTier.get(tile.tierRow) ?? [];
        tier.push(tile);
        tilesByTier.set(tile.tierRow, tier);
      }
      const width = Math.max(1, ...[...tilesByTier.values()].map((tier) => tier.length));
      const gridColumn = nextGridColumn;
      nextGridColumn += width;

      const cells = column.tiles.map((tile) => {
        // Tier rows are 0-based from the bottom; CSS rows are 1-based and grow downwards, so tier 0
        // lands on rowCount.
        const gridRow = rowCount - tile.tierRow;
        const tier = tilesByTier.get(tile.tierRow) ?? [tile];
        // A narrower tier is centred under the widest one, so the trunk of a branching chain sits
        // between its branches rather than hugging the left edge.
        const cellColumn = gridColumn + Math.floor((width - tier.length) / 2) + tier.indexOf(tile);
        if (!cellByLevelKey[tile.levelKey]) {
          cellByLevelKey[tile.levelKey] = { setKey: band.setKey, gridRow, gridColumn: cellColumn };
        }
        return { tile, gridRow, gridColumn: cellColumn };
      });
      return {
        chainKey: column.chainKey,
        localizedName: column.localizedName,
        gridColumn,
        width,
        cells,
        sources: column.sources,
      };
    });
    return {
      setKey: band.setKey,
      localizedName: band.localizedName,
      colour: bandColour(band),
      columns,
      columnCount: Math.max(nextGridColumn - 1, 1),
    };
  });

  return { bands, rowCount, edges: view.edges, cellByLevelKey };
};

/** A tile's box, in the board container's own coordinates. */
export interface TileBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
}

/**
 * An orthogonal path from the lower building's top edge to the higher building's bottom edge.
 *
 * Within a chain the two are stacked in the same column, which is the straight-line case. Across
 * chains or bands the arrow leaves the source going up, tracks sideways along the midpoint, and
 * comes back up into the target - never diagonal, so it reads as the game's connectors do.
 */
export const routeOrthogonal = (from: TileBox, to: TileBox): string => {
  const startX = Math.round(from.centerX);
  const startY = Math.round(from.top);
  const endX = Math.round(to.centerX);
  const endY = Math.round(to.bottom);

  if (Math.abs(startX - endX) <= 1) return `M ${startX} ${startY} V ${endY}`;

  const midY = Math.round((startY + endY) / 2);
  return `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
};

export const countTiles = (layout: BoardLayout) =>
  layout.bands.reduce(
    (total, band) => total + band.columns.reduce((bandTotal, column) => bandTotal + column.cells.length, 0),
    0,
  );
