import { describe, expect, it } from "vitest";

import { computeBoardLayout, countTiles, routeOrthogonal } from "../src/components/buildings/buildingsLayout";
import type { BuildingsRegionView, BuildingsSetBand, BuildingsTile } from "../src/buildingsData/types";

/** `tierRow` is what the layout places by; it defaults to the level so these cases read as before. */
const tile = (levelKey: string, level: number, tierRow = level): BuildingsTile => ({
  levelKey,
  chainKey: "chain",
  setKey: "set",
  level,
  tierRow,
  romanNumeral: "",
  createTime: 0,
  createCost: 0,
  upkeepCost: 0,
  foodCost: 0,
  developmentPointCost: 0,
  onlyInCapital: false,
  factionUnique: false,
  visibleInUi: true,
  variantCount: 0,
  effects: [],
  garrison: [],
  recruitable: [],
  isExistingInRegion: false,
  hasNoVariant: false,
  isSettlementOrPort: false,
  isDuplicatedAcrossSets: false,
  isForeignSlot: false,
  title: levelKey,
});

const band = (setKey: string, columns: Array<{ chainKey: string; tiles: BuildingsTile[] }>): BuildingsSetBand => ({
  setKey,
  localizedName: setKey,
  colourR: 1,
  colourG: 2,
  colourB: 3,
  sortOrder: 0,
  showInUi: true,
  columns: columns.map((column) => ({
    chainKey: column.chainKey,
    localizedName: column.chainKey,
    sortOrder: 0,
    tiles: column.tiles,
    sources: [],
  })),
});

const view = (bands: BuildingsSetBand[]): BuildingsRegionView => ({
  query: { campaign: "c", region: "r" },
  bands,
  edges: [],
  settlementTypeOptions: [],
  settlementTypeDisabled: false,
  disabledLevels: [],
  existingBuildings: [],
  slotTemplates: [],
});

describe("computeBoardLayout", () => {
  it("spans every band over the tallest chain on the board, so the tiers line up", () => {
    const layout = computeBoardLayout(
      view([
        band("tall", [{ chainKey: "a", tiles: [tile("a1", 0), tile("a2", 1), tile("a3", 2)] }]),
        band("short", [{ chainKey: "b", tiles: [tile("b1", 0)] }]),
      ]),
    );
    expect(layout.rowCount).toBe(3);
  });

  it("puts the lowest level on the bottom row", () => {
    const layout = computeBoardLayout(
      view([band("set", [{ chainKey: "a", tiles: [tile("a1", 0), tile("a2", 1), tile("a3", 2)] }])]),
    );
    const rowsByLevelKey = Object.fromEntries(
      layout.bands[0].columns[0].cells.map((cell) => [cell.tile.levelKey, cell.gridRow]),
    );
    expect(rowsByLevelKey).toEqual({ a1: 3, a2: 2, a3: 1 });
  });

  it("keeps a short chain's level I on the same bottom row as a tall one", () => {
    const layout = computeBoardLayout(
      view([
        band("set", [
          { chainKey: "a", tiles: [tile("a1", 0), tile("a2", 1), tile("a3", 2)] },
          { chainKey: "b", tiles: [tile("b1", 0)] },
        ]),
      ]),
    );
    const [tall, short] = layout.bands[0].columns;
    expect(short.cells[0].gridRow).toBe(layout.rowCount);
    expect(tall.cells[0].gridRow).toBe(layout.rowCount);
  });

  it("places a tile by its tier row, not by its own level", () => {
    // A barracks at its own level 0 requiring settlement level 2 lines up with settlement level 2.
    const board = view([
      band("set", [{ chainKey: "chain", tiles: [tile("barracks_1", 0, 2), tile("barracks_2", 1, 3)] }]),
    ]);
    const layout = computeBoardLayout(board);
    expect(layout.rowCount).toBe(4);
    const rows = Object.fromEntries(layout.bands[0].columns[0].cells.map((cell) => [cell.tile.levelKey, cell.gridRow]));
    // rowCount 4: tier 2 -> row 2, tier 3 -> row 1, counting down from the bottom.
    expect(rows).toEqual({ barracks_1: 2, barracks_2: 1 });
  });

  it("lines a settlement tier up with the buildings that require it", () => {
    const board = view([
      band("set", [
        { chainKey: "settlement", tiles: [tile("settlement_2", 2, 1)] },
        { chainKey: "barracks", tiles: [tile("barracks_1", 0, 1)] },
      ]),
    ]);
    const [settlement, barracks] = computeBoardLayout(board).bands[0].columns;
    expect(settlement.cells[0].gridRow).toBe(barracks.cells[0].gridRow);
  });

  it("numbers columns from one within each band", () => {
    const layout = computeBoardLayout(
      view([
        band("one", [
          { chainKey: "a", tiles: [tile("a1", 0)] },
          { chainKey: "b", tiles: [tile("b1", 0)] },
        ]),
        band("two", [{ chainKey: "c", tiles: [tile("c1", 0)] }]),
      ]),
    );
    expect(layout.bands[0].columns.map((column) => column.gridColumn)).toEqual([1, 2]);
    expect(layout.bands[1].columns.map((column) => column.gridColumn)).toEqual([1]);
  });

  it("exposes the band colour as an rgb triple for the CSS variable", () => {
    const layout = computeBoardLayout(view([band("set", [{ chainKey: "a", tiles: [tile("a1", 0)] }])]));
    expect(layout.bands[0].colour).toBe("1, 2, 3");
  });

  it("indexes each level's cell for the arrow overlay", () => {
    const layout = computeBoardLayout(view([band("set", [{ chainKey: "a", tiles: [tile("a1", 0), tile("a2", 1)] }])]));
    expect(layout.cellByLevelKey.a2).toEqual({ setKey: "set", gridRow: 1, gridColumn: 1 });
  });

  it("routes a straight line between tiles stacked in one column", () => {
    const lower = { left: 0, top: 100, right: 60, bottom: 160, centerX: 30 };
    const higher = { left: 0, top: 20, right: 60, bottom: 80, centerX: 30 };
    // Up from the lower tile's top edge to the higher tile's bottom edge.
    expect(routeOrthogonal(lower, higher)).toBe("M 30 100 V 80");
  });

  it("routes orthogonally, never diagonally, across columns", () => {
    const lower = { left: 0, top: 100, right: 60, bottom: 160, centerX: 30 };
    const higher = { left: 200, top: 20, right: 260, bottom: 80, centerX: 230 };
    expect(routeOrthogonal(lower, higher)).toBe("M 30 100 V 90 H 230 V 80");
  });

  it("handles an empty board without dividing by zero", () => {
    const layout = computeBoardLayout(view([]));
    expect(layout.rowCount).toBe(1);
    expect(countTiles(layout)).toBe(0);
  });
});
