import { describe, expect, it } from "vitest";

import { buildBuildingsData, BUILDINGS_TABLES } from "../src/buildingsData/data";
import { NO_SET_KEY, resolveRegionBuildings } from "../src/buildingsData/derive";
import { applyNewRowsToBuiltData } from "../src/buildingsData/applyEdits";
import {
  applyNewRowsToBuildingsData,
  buildingsEditReducer,
  emptyBuildingsEditState,
  findKeyCollisions,
  LOC_TABLE,
  newRowsByTable,
  takeNumericId,
  type BuildingsEditState,
} from "../src/buildingsData/edits";
import {
  addBuildingChainRows,
  addBuildingLevelRows,
  addGarrisonRows,
  addRecruitableUnitRows,
  canAddBuildingBelow,
  canMoveBuilding,
  canMoveBuildingChain,
  cloneCaiRows,
  disableBuildingRows,
  excludeFromSetRows,
  levelsToShiftForBuildingBelow,
  moveBuildingChainRows,
  moveBuildingRows,
} from "../src/buildingsData/editActions";
import type { BuildingsTableRows, BuildingsTile } from "../src/buildingsData/types";

const noLoc = () => undefined;
const CAMPAIGN = "camp";
const REGION = "region_x";

const baseTables = (): BuildingsTableRows => ({
  building_chains_tables: [{ key: "chain_a", building_superchain: "super_a" }],
  building_levels_tables: [{ level_name: "a_1", chain: "chain_a", level: "0", visible_in_ui: "true" }],
  building_culture_variants_tables: [
    { building: "a_1", culture: "emp", subculture: "", faction: "", disables: "false" },
  ],
  building_sets_tables: [{ key: "set_one", sort_order: "1", show_in_ui: "true" }],
  building_set_to_building_junctions_tables: [
    { building_chain: "chain_a", building_level: "", building_set: "set_one", exclude: "false" },
  ],
  cultures_tables: [{ key: "emp" }],
  cultures_subcultures_tables: [{ subculture: "emp_sub", culture: "emp" }],
  factions_tables: [{ key: "emp_faction", subculture: "emp_sub" }],
  regions_tables: [{ key: REGION }],
  campaigns_tables: [{ campaign_name: CAMPAIGN }],
  start_pos_region_slot_templates_tables: [
    { campaign: CAMPAIGN, id: "1", region: REGION, slot_template: "tmpl", slot_type: "secondary" },
  ],
  slot_template_permitted_building_chains_tables: [
    { slot_template: "tmpl", chain: "chain_a", chain_set: "", super_chain: "", remove: "false" },
  ],
});

const data = () => buildBuildingsData(baseTables(), noLoc);

const withRows = (state: BuildingsEditState, rows: ReturnType<typeof addBuildingLevelRows>, groupId?: string) =>
  buildingsEditReducer(state, { type: "addRows", rows, groupId });

const query = { campaign: CAMPAIGN, region: REGION, culture: "emp" };

describe("buildingsEditReducer", () => {
  it("assigns one group id to every row of a single action", () => {
    const state = withRows(emptyBuildingsEditState(), [
      { table: "building_levels_tables", origin: "addBuilding", values: { level_name: "x" } },
      { table: "building_culture_variants_tables", origin: "addBuilding", values: { building: "x" } },
    ]);
    const groups = new Set(Object.values(state.rowsById).map((row) => row.groupId));
    expect(groups.size).toBe(1);
    expect(state.order).toHaveLength(2);
  });

  it("edits a single cell without touching its neighbours", () => {
    let state = withRows(emptyBuildingsEditState(), [
      { table: "building_levels_tables", origin: "addBuilding", values: { level_name: "x", create_cost: "100" } },
    ]);
    const id = state.order[0];
    state = buildingsEditReducer(state, { type: "setCell", id, column: "create_cost", value: "250" });
    expect(state.rowsById[id].values).toEqual({ level_name: "x", create_cost: "250" });
  });

  it("ignores an edit to a row that is gone", () => {
    const state = emptyBuildingsEditState();
    expect(buildingsEditReducer(state, { type: "setCell", id: "nope", column: "a", value: "b" })).toBe(state);
  });

  it("removes a whole group, which is how an added building is undone", () => {
    let state = withRows(
      emptyBuildingsEditState(),
      [
        { table: "building_levels_tables", origin: "addBuilding", values: { level_name: "x" } },
        { table: "building_culture_variants_tables", origin: "addBuilding", values: { building: "x" } },
      ],
      "group_one",
    );
    state = withRows(
      state,
      [{ table: "building_levels_tables", origin: "addBuilding", values: { level_name: "y" } }],
      "group_two",
    );

    state = buildingsEditReducer(state, { type: "removeGroup", groupId: "group_one" });
    expect(state.order).toHaveLength(1);
    expect(Object.values(state.rowsById)[0].values.level_name).toBe("y");
  });

  it("keeps insertion order when grouping by table", () => {
    let state = withRows(emptyBuildingsEditState(), [
      { table: "building_levels_tables", origin: "addBuilding", values: { level_name: "first" } },
    ]);
    state = withRows(state, [
      { table: "building_levels_tables", origin: "addBuilding", values: { level_name: "second" } },
    ]);
    expect(newRowsByTable(state).building_levels_tables.map((row) => row.values.level_name)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("takeNumericId", () => {
  it("hands out consecutive ids from the seeded cursor", () => {
    const cursors = { building_units_allowed_tables: 41 };
    expect(takeNumericId(cursors, "building_units_allowed_tables")).toBe("41");
    expect(takeNumericId(cursors, "building_units_allowed_tables")).toBe("42");
    expect(cursors.building_units_allowed_tables).toBe(43);
  });

  it("starts at zero for a table it has never seen", () => {
    expect(takeNumericId({}, "whatever_tables")).toBe("0");
  });
});

describe("numeric-id cursor seeding", () => {
  it("seeds an empty edit session from the catalog", () => {
    const state = buildingsEditReducer(emptyBuildingsEditState(), {
      type: "seedNumericIdCursors",
      numericIdCursors: { building_units_allowed_tables: 42 },
    });
    expect(takeNumericId({ ...state.numericIdCursors }, "building_units_allowed_tables")).toBe("42");
  });

  it("does not renumber IDs after pending rows exist", () => {
    const pending = buildingsEditReducer(emptyBuildingsEditState({ building_units_allowed_tables: 42 }), {
      type: "addRows",
      rows: addRecruitableUnitRows(
        { levelKey: "a_1", unitKey: "spearmen" },
        {
          building_units_allowed_tables: 42,
        },
      ),
      numericIdCursors: { building_units_allowed_tables: 43 },
    });
    const refreshed = buildingsEditReducer(pending, {
      type: "seedNumericIdCursors",
      numericIdCursors: { building_units_allowed_tables: 100 },
    });
    expect(refreshed).toBe(pending);
    expect(refreshed.numericIdCursors.building_units_allowed_tables).toBe(43);
  });
});

describe("addBuildingLevelRows", () => {
  const input = {
    levelKey: "my_barracks_2",
    chainKey: "chain_a",
    level: 1,
    setKey: "set_one",
    culture: "emp",
    subculture: "",
    faction: "",
    title: "My Barracks",
    createTime: 2,
    createCost: 500,
    upkeepCost: 50,
    upgradeFromLevelKey: "a_1",
  };

  it("writes the level, the variant, the upgrade and the name loc", () => {
    const rows = addBuildingLevelRows(input, {});
    const tables = rows.map((row) => row.table);
    expect(tables).toContain("building_levels_tables");
    expect(tables).toContain("building_culture_variants_tables");
    expect(tables).toContain("building_upgrades_junction_tables");
    expect(tables).toContain(LOC_TABLE);
  });

  it("skips the set junction when the chain is already bound to that set", () => {
    const rows = addBuildingLevelRows({ ...input, isChainAlreadyInSet: true }, {});
    expect(rows.some((row) => row.table === "building_set_to_building_junctions_tables")).toBe(false);
  });

  it("writes the set junction when the chain is not bound to it", () => {
    const rows = addBuildingLevelRows({ ...input, setKey: "set_two" }, {});
    const junction = rows.find((row) => row.table === "building_set_to_building_junctions_tables");
    expect(junction?.values).toMatchObject({ building_chain: "chain_a", building_set: "set_two", exclude: "false" });
  });

  it("writes the upgrade from the existing building to the new one", () => {
    const rows = addBuildingLevelRows(input, {});
    const upgrade = rows.find((row) => row.table === "building_upgrades_junction_tables");
    expect(upgrade?.values).toEqual({ from: "a_1", to: "my_barracks_2" });
  });

  it("writes the reverse upgrade when adding a lower level", () => {
    const rows = addBuildingLevelRows({ ...input, upgradeFromLevelKey: undefined, upgradeToLevelKey: "a_2" }, {});
    expect(rows.find((row) => row.table === "building_upgrades_junction_tables")?.values).toEqual({
      from: "my_barracks_2",
      to: "a_2",
    });
  });

  it("inserts a lower level at the old level and shifts the existing row up", () => {
    const rows = addBuildingLevelRows(
      {
        ...input,
        levelKey: "my_barracks_1",
        level: 0,
        upgradeFromLevelKey: undefined,
        upgradeToLevelKey: "a_1",
        shiftedLevelRows: [
          {
            levelKey: "a_1",
            level: 0,
            values: { level_name: "a_1", chain: "chain_a", level: "0", create_time: "7" },
          },
        ],
      },
      {},
    );
    expect(
      rows
        .filter((row) => row.table === "building_levels_tables")
        .map((row) => ({ key: row.values.level_name, level: row.values.level })),
    ).toEqual([
      { key: "my_barracks_1", level: "0" },
      { key: "a_1", level: "1" },
    ]);
    expect(rows.find((row) => row.values.level_name === "a_1")?.values.create_time).toBe("7");
    expect(rows.find((row) => row.values.level_name === "a_1")?.origin).toBe("shiftBuildingLevel");
  });

  it("copies effects onto the new building, under the same group as everything else", () => {
    const rows = addBuildingLevelRows(
      {
        ...input,
        effects: [
          { effectKey: "eff_growth", scope: "building_to_building_own", value: 4 },
          { effectKey: "eff_order", scope: "region_to_region_own", value: -2 },
        ],
      },
      {},
    );
    const effects = rows.filter((row) => row.table === "building_effects_junction_tables");
    expect(effects).toHaveLength(2);
    expect(effects[0].values).toEqual({
      building: "my_barracks_2",
      effect: "eff_growth",
      effect_scope: "building_to_building_own",
      value: "4",
    });
    // Negative values survive: an effect that subtracts is as ordinary as one that adds.
    expect(effects[1].values.value).toBe("-2");
    expect(effects.every((row) => row.origin === "addBuilding")).toBe(true);
  });

  it("copies recruitment and garrison rows with fresh numeric ids", () => {
    const cursors = {
      building_units_allowed_tables: 41,
      building_level_armed_citizenry_junctions_tables: 73,
    };
    const rows = addBuildingLevelRows(
      {
        ...input,
        recruitableUnits: [{ unitKey: "spearmen", faction: "emp_faction", xp: 3 }, { unitKey: "archers" }],
        garrisonUnitGroups: ["group_a", "group_a", "group_b"],
      },
      cursors,
    );

    expect(rows.filter((row) => row.table === "building_units_allowed_tables").map((row) => row.values)).toEqual([
      {
        key: "41",
        building: "my_barracks_2",
        unit: "spearmen",
        XP: "3",
        faction: "emp_faction",
        enabled: "true",
      },
      {
        key: "42",
        building: "my_barracks_2",
        unit: "archers",
        XP: "0",
        faction: "",
        enabled: "true",
      },
    ]);
    expect(
      rows.filter((row) => row.table === "building_level_armed_citizenry_junctions_tables").map((row) => row.values),
    ).toEqual([
      { id: "73", building_level: "my_barracks_2", unit_group: "group_a" },
      { id: "74", building_level: "my_barracks_2", unit_group: "group_b" },
    ]);
    expect(cursors).toEqual({
      building_units_allowed_tables: 43,
      building_level_armed_citizenry_junctions_tables: 75,
    });
    expect(
      rows
        .filter(
          (row) =>
            row.table === "building_units_allowed_tables" ||
            row.table === "building_level_armed_citizenry_junctions_tables",
        )
        .every((row) => row.origin === "addBuilding"),
    ).toBe(true);
  });

  it("writes no effect rows when the copy is declined", () => {
    expect(addBuildingLevelRows(input, {}).some((row) => row.table === "building_effects_junction_tables")).toBe(false);
  });

  it("omits the upgrade row when nothing upgrades into it", () => {
    const rows = addBuildingLevelRows({ ...input, upgradeFromLevelKey: undefined }, {});
    expect(rows.some((row) => row.table === "building_upgrades_junction_tables")).toBe(false);
  });

  it("uses the loc key the variant's localised_key_order produces", () => {
    const rows = addBuildingLevelRows(input, {});
    const loc = rows.find((row) => row.table === LOC_TABLE);
    expect(loc?.values.key).toBe("building_culture_variants_name_my_barracks_2emp");
    expect(loc?.values.text).toBe("My Barracks");
  });

  it("only writes description locs when there are descriptions", () => {
    expect(addBuildingLevelRows(input, {}).filter((row) => row.table === LOC_TABLE)).toHaveLength(1);
    const withText = addBuildingLevelRows({ ...input, shortDescription: "short", longDescription: "long" }, {});
    expect(withText.filter((row) => row.table === LOC_TABLE)).toHaveLength(3);
  });
});

describe("canAddBuildingBelow", () => {
  const tile = { chainKey: "chain_a", level: 1, tierRow: 1 } as const;
  const view = (
    tiles: Array<{ chainKey: string; level: number; tierRow: number; levelRowValues?: Record<string, string> }>,
  ) => ({ bands: [{ columns: [{ chainKey: "chain_a", tiles }] }] }) as Parameters<typeof canAddBuildingBelow>[1];

  it("allows a lower board row when this is the chain's lowest row", () => {
    expect(canAddBuildingBelow(tile, view([{ chainKey: "chain_a", level: 1, tierRow: 1 }]))).toBe(true);
  });

  it("allows a level-0 secondary building whose primary requirement places it above row zero", () => {
    expect(
      canAddBuildingBelow(
        { chainKey: "chain_a", level: 0, tierRow: 4 },
        view([{ chainKey: "chain_a", level: 0, tierRow: 4 }]),
      ),
    ).toBe(true);
  });

  it("does not allow a level below tier zero", () => {
    expect(
      canAddBuildingBelow(
        { chainKey: "chain_a", level: 1, tierRow: 0 },
        view([{ chainKey: "chain_a", level: 1, tierRow: 0 }]),
      ),
    ).toBe(false);
    expect(
      canAddBuildingBelow(
        { chainKey: "chain_a", level: 0, tierRow: 0 },
        view([{ chainKey: "chain_a", level: 0, tierRow: 0 }]),
      ),
    ).toBe(false);
  });

  it("does not allow a lower row when any other building in the chain is below it", () => {
    expect(
      canAddBuildingBelow(
        tile,
        view([
          { chainKey: "chain_a", level: 0, tierRow: 0 },
          { chainKey: "chain_a", level: 1, tierRow: 1 },
        ]),
      ),
    ).toBe(false);
  });

  it("uses the primary requirement row rather than the database level", () => {
    expect(
      canAddBuildingBelow(
        { chainKey: "chain_a", level: 0, tierRow: 4 },
        view([
          { chainKey: "chain_a", level: 0, tierRow: 2 },
          { chainKey: "chain_a", level: 0, tierRow: 4 },
        ]),
      ),
    ).toBe(false);
  });

  it("ignores lower levels belonging to another chain", () => {
    expect(
      canAddBuildingBelow(
        tile,
        view([
          { chainKey: "chain_b", level: 0, tierRow: 0 },
          { chainKey: "chain_a", level: 1, tierRow: 1 },
        ]),
      ),
    ).toBe(true);
  });

  it("collects each existing level at and above the insertion point once", () => {
    expect(
      levelsToShiftForBuildingBelow(
        { chainKey: "chain_a", level: 0 },
        view([
          {
            chainKey: "chain_a",
            levelKey: "a_0",
            level: 0,
            tierRow: 4,
            levelRowValues: { level_name: "a_0", chain: "chain_a", level: "0" },
          },
          {
            chainKey: "chain_a",
            levelKey: "a_1",
            level: 1,
            tierRow: 5,
            levelRowValues: { level_name: "a_1", chain: "chain_a", level: "1" },
          },
          {
            chainKey: "chain_a",
            levelKey: "a_1",
            level: 1,
            tierRow: 5,
            levelRowValues: { level_name: "a_1", chain: "chain_a", level: "1" },
          },
          { chainKey: "chain_b", level: 0, tierRow: 4 },
        ]),
      ).map((row) => row.levelKey),
    ).toEqual(["a_1", "a_0"]);
  });
});

describe("building movement actions", () => {
  const tile = (levelKey: string, tierRow: number, requirement = tierRow + 1): BuildingsTile =>
    ({
      levelKey,
      chainKey: "chain_a",
      level: 0,
      tierRow,
      isSettlementOrPort: false,
      levelRowValues: {
        level_name: levelKey,
        chain: "chain_a",
        level: "0",
        primary_slot_building_building_level_requirement: `${requirement}`,
      },
    }) as BuildingsTile;
  const view = (tiles: BuildingsTile[]) =>
    ({ bands: [{ columns: [{ chainKey: "chain_a", tiles }] }] }) as Parameters<typeof canMoveBuilding>[1];

  it("moves one building to the adjacent empty row and preserves its other columns", () => {
    const rows = moveBuildingRows(tile("a_1", 2), "lower");
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toMatchObject({
      level_name: "a_1",
      chain: "chain_a",
      level: "0",
      primary_slot_building_building_level_requirement: "2",
    });
  });

  it("does not offer a single-building move into an occupied row", () => {
    const selected = tile("a_2", 2);
    const other = tile("a_1", 1);
    expect(canMoveBuilding(selected, view([selected, other]), "lower")).toBe(false);
    expect(canMoveBuilding(selected, view([selected, other]), "higher")).toBe(true);
  });

  it("honours the bottom and five-requirement upper bounds", () => {
    const bottom = tile("a_1", 0, 0);
    const top = tile("a_5", 4, 5);
    expect(canMoveBuilding(bottom, view([bottom]), "lower")).toBe(false);
    expect(canMoveBuilding(top, view([top]), "higher")).toBe(false);
    expect(moveBuildingRows(top, "higher")).toEqual([]);
  });

  it("moves every distinct level in a chain while ignoring duplicate set bindings", () => {
    const first = tile("a_1", 1);
    const second = tile("a_2", 3, 4);
    const duplicateFirst = tile("a_1", 1);
    const chainView = view([first, second, duplicateFirst]);

    expect(canMoveBuildingChain(first, chainView, "higher")).toBe(true);
    expect(moveBuildingChainRows(first, chainView, "higher").map((row) => row.values)).toEqual([
      {
        level_name: "a_1",
        chain: "chain_a",
        level: "0",
        primary_slot_building_building_level_requirement: "3",
      },
      {
        level_name: "a_2",
        chain: "chain_a",
        level: "0",
        primary_slot_building_building_level_requirement: "5",
      },
    ]);
  });

  it("does not move primary or port chains with the secondary-tier requirement column", () => {
    const primary = { ...tile("settlement_1", 1), isSettlementOrPort: true };
    expect(canMoveBuilding(primary, view([primary]), "higher")).toBe(false);
    expect(moveBuildingRows(primary, "higher")).toEqual([]);
  });
});

describe("removal actions", () => {
  it("expresses removal as a disables variant for the exact culture tuple", () => {
    const rows = disableBuildingRows({
      levelKey: "a_1",
      culture: "emp",
      subculture: "emp_sub",
      faction: "emp_faction",
    });
    expect(rows[0].values).toMatchObject({
      building: "a_1",
      culture: "emp",
      subculture: "emp_sub",
      faction: "emp_faction",
      disables: "true",
    });
  });

  it("expresses band removal as an exclude junction", () => {
    expect(excludeFromSetRows({ chainKey: "chain_a", setKey: "set_one" })[0].values).toMatchObject({
      building_chain: "chain_a",
      building_set: "set_one",
      exclude: "true",
    });
  });

  it("actually hides the building once the disables row is applied", () => {
    const state = withRows(
      emptyBuildingsEditState(),
      disableBuildingRows({ levelKey: "a_1", culture: "emp", subculture: "", faction: "" }),
    );
    const effective = applyNewRowsToBuildingsData(baseTables(), state, (tables) => buildBuildingsData(tables, noLoc));
    const view = resolveRegionBuildings(effective, query);
    expect(view.bands).toHaveLength(0);
    expect(view.disabledLevels.map((entry) => entry.levelKey)).toEqual(["a_1"]);
  });
});

describe("numeric-id actions", () => {
  it("allocates a key for a recruitable unit", () => {
    const cursors = { building_units_allowed_tables: 7 };
    const rows = addRecruitableUnitRows({ levelKey: "a_1", unitKey: "spearmen" }, cursors);
    expect(rows[0].values).toMatchObject({ key: "7", building: "a_1", unit: "spearmen", enabled: "true" });
    expect(cursors.building_units_allowed_tables).toBe(8);
  });

  it("allocates an id for a garrison junction", () => {
    const cursors = { building_level_armed_citizenry_junctions_tables: 3 };
    expect(addGarrisonRows({ levelKey: "a_1", unitGroup: "group" }, cursors)[0].values.id).toBe("3");
  });
});

describe("applyNewRowsToBuildingsData", () => {
  it("puts a new building on the board", () => {
    const state = withRows(
      emptyBuildingsEditState(),
      addBuildingLevelRows(
        {
          levelKey: "a_2",
          chainKey: "chain_a",
          level: 1,
          setKey: "set_one",
          culture: "emp",
          subculture: "",
          faction: "",
          title: "Second",
          createTime: 1,
          createCost: 100,
          upkeepCost: 10,
          upgradeFromLevelKey: "a_1",
        },
        {},
      ),
    );
    const effective = applyNewRowsToBuildingsData(baseTables(), state, (tables) => buildBuildingsData(tables, noLoc));
    const view = resolveRegionBuildings(effective, query);
    const levels = view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles.map((t) => t.levelKey)));
    expect(levels.sort()).toEqual(["a_1", "a_2"]);
    expect(view.edges).toContainEqual(
      expect.objectContaining({ fromLevelKey: "a_1", toLevelKey: "a_2", isImplicit: false }),
    );
  });

  it("leaves the loc pseudo-table out of the rebuilt tables", () => {
    const state = withRows(emptyBuildingsEditState(), [
      { table: LOC_TABLE, origin: "addBuilding", values: { key: "k", text: "v" } },
    ]);
    applyNewRowsToBuildingsData(baseTables(), state, (tables) => {
      expect(tables[LOC_TABLE]).toBeUndefined();
      return buildBuildingsData(tables, noLoc);
    });
  });

  it("applies every Buildings source table except start_pos tables", () => {
    const baseTablesByName: BuildingsTableRows = Object.fromEntries(
      BUILDINGS_TABLES.map((table) => [table, [{ marker: `base:${table}` }]]),
    );
    const state = buildingsEditReducer(emptyBuildingsEditState(), {
      type: "addRows",
      rows: BUILDINGS_TABLES.map((table) => ({ table, origin: "clone" as const, values: { marker: `new:${table}` } })),
    });

    applyNewRowsToBuildingsData(baseTablesByName, state, (effectiveTables) => {
      for (const table of BUILDINGS_TABLES) {
        const markers = effectiveTables[table].map((row) => row.marker);
        if (table.startsWith("start_pos_")) expect(markers).toEqual([`base:${table}`]);
        else expect(markers).toEqual([`base:${table}`, `new:${table}`]);
      }
      return buildBuildingsData(effectiveTables, noLoc);
    });
  });

  it("does not mutate the base tables", () => {
    const base = baseTables();
    const before = base.building_levels_tables.length;
    const state = withRows(emptyBuildingsEditState(), [
      { table: "building_levels_tables", origin: "addBuilding", values: { level_name: "z", chain: "chain_a" } },
    ]);
    applyNewRowsToBuildingsData(base, state, (tables) => buildBuildingsData(tables, noLoc));
    expect(base.building_levels_tables).toHaveLength(before);
  });
});

describe("findKeyCollisions", () => {
  it("flags a new row that would silently override a vanilla one", () => {
    const state = withRows(emptyBuildingsEditState(), [
      { table: "building_levels_tables", origin: "manual", values: { level_name: "a_1", chain: "chain_a" } },
    ]);
    expect(findKeyCollisions(baseTables(), state)).toEqual([
      { id: state.order[0], table: "building_levels_tables", key: "a_1" },
    ]);
  });

  it("says nothing about a row with a fresh key", () => {
    const state = withRows(emptyBuildingsEditState(), [
      { table: "building_levels_tables", origin: "manual", values: { level_name: "brand_new", chain: "chain_a" } },
    ]);
    expect(findKeyCollisions(baseTables(), state)).toEqual([]);
  });

  it("uses the whole composite key, not just the first column", () => {
    const state = withRows(emptyBuildingsEditState(), [
      {
        table: "building_culture_variants_tables",
        origin: "manual",
        // Same building as vanilla but a different culture, so it is an addition, not an override.
        values: { building: "a_1", culture: "dwf", subculture: "", faction: "" },
      },
    ]);
    expect(findKeyCollisions(baseTables(), state)).toEqual([]);
  });
});

// The main process releases the raw rows after building, so the board's re-derivation goes through
// this rather than through applyNewRowsToBuildingsData.
describe("applyNewRowsToBuiltData", () => {
  const addRows = (rows: Parameters<typeof buildingsEditReducer>[1] extends { rows: infer R } ? R : never) =>
    buildingsEditReducer(emptyBuildingsEditState(), { type: "addRows", rows });

  it("returns the same object when there is nothing pending", () => {
    const base = data();
    expect(applyNewRowsToBuiltData(base, emptyBuildingsEditState())).toBe(base);
  });

  it("puts an added building on the board, with its upgrade arrow and name", () => {
    const state = addRows(
      addBuildingLevelRows(
        {
          levelKey: "a_2",
          chainKey: "chain_a",
          level: 1,
          setKey: "set_one",
          isChainAlreadyInSet: true,
          culture: "emp",
          subculture: "",
          faction: "",
          title: "My Second",
          createTime: 1,
          createCost: 100,
          upkeepCost: 10,
          upgradeFromLevelKey: "a_1",
        },
        {},
      ),
    );
    const view = resolveRegionBuildings(applyNewRowsToBuiltData(data(), state), query);
    const tiles = view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles));
    expect(tiles.map((tile) => tile.levelKey).sort()).toEqual(["a_1", "a_2"]);
    expect(tiles.find((tile) => tile.levelKey === "a_2")?.title).toBe("My Second");
    expect(view.edges).toContainEqual(
      expect.objectContaining({ fromLevelKey: "a_1", toLevelKey: "a_2", isImplicit: false }),
    );
  });

  it("uses a cloned building set's name, colour, order and visibility on the board", () => {
    const state = addRows([
      {
        table: "building_sets_tables",
        origin: "clone",
        values: {
          key: "memory_set",
          icon: "memory.png",
          sort_order: "7",
          colour_hex: "123456",
          show_in_ui: "true",
        },
      },
      {
        table: "building_set_to_building_junctions_tables",
        origin: "clone",
        values: { building_chain: "chain_a", building_level: "", building_set: "memory_set", exclude: "false" },
      },
      {
        table: LOC_TABLE,
        origin: "clone",
        values: { key: "building_sets_onscreen_name_memory_set", text: "Memory Set" },
      },
    ]);

    const view = resolveRegionBuildings(applyNewRowsToBuiltData(data(), state), query);
    expect(view.bands.find((band) => band.setKey === "memory_set")).toEqual(
      expect.objectContaining({
        localizedName: "Memory Set",
        colourR: 0x12,
        colourG: 0x34,
        colourB: 0x56,
        sortOrder: 7,
        showInUi: true,
      }),
    );
  });

  it("expands cloned chain-set parents and items when deciding which chains the board offers", () => {
    const base = buildBuildingsData({ ...baseTables(), slot_template_permitted_building_chains_tables: [] }, noLoc);
    const state = addRows([
      {
        table: "building_chain_sets_tables",
        origin: "clone",
        values: { key: "memory_parent", parent_set: "" },
      },
      {
        table: "building_chain_sets_tables",
        origin: "clone",
        values: { key: "memory_child", parent_set: "memory_parent" },
      },
      {
        table: "building_chain_set_items_tables",
        origin: "clone",
        values: { set: "memory_parent", chain: "chain_a", super_chain: "", remove: "false" },
      },
      {
        table: "slot_template_permitted_building_chains_tables",
        origin: "clone",
        values: { slot_template: "tmpl", chain: "", chain_set: "memory_child", super_chain: "", remove: "false" },
      },
    ]);

    const view = resolveRegionBuildings(applyNewRowsToBuiltData(base, state), query);
    expect(view.bands.flatMap((band) => band.columns.map((column) => column.chainKey))).toEqual(["chain_a"]);
  });

  it("hides a building a pending disables row covers", () => {
    const state = addRows(disableBuildingRows({ levelKey: "a_1", culture: "emp", subculture: "", faction: "" }));
    const view = resolveRegionBuildings(applyNewRowsToBuiltData(data(), state), query);
    expect(view.bands).toHaveLength(0);
    expect(view.disabledLevels.map((entry) => entry.levelKey)).toEqual(["a_1"]);
  });

  it("moves a chain out of its band on a pending exclude row", () => {
    const state = addRows(excludeFromSetRows({ chainKey: "chain_a", setKey: "set_one" }));
    const built = applyNewRowsToBuiltData(data(), state);
    // Its only band gone, the chain has nowhere to be drawn - which is what excluding it means, and
    // why the board goes empty unless the unbanded toggle is on.
    expect(resolveRegionBuildings(built, query).bands).toEqual([]);
    expect(
      resolveRegionBuildings(built, { ...query, includeUnbandedLevels: true }).bands.map((band) => band.setKey),
    ).toEqual([NO_SET_KEY]);
  });

  it("adds a pending recruitable unit to the tile", () => {
    const state = addRows(addRecruitableUnitRows({ levelKey: "a_1", unitKey: "new_unit" }, {}));
    const view = resolveRegionBuildings(applyNewRowsToBuiltData(data(), state), query);
    const tile = view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles))[0];
    expect(tile.recruitable.map((unit) => unit.unitKey)).toEqual(["new_unit"]);
  });

  it("adds a pending garrison group to the tile", () => {
    const base = buildBuildingsData(
      {
        ...baseTables(),
        main_units_tables: [{ unit: "garrison_unit", land_unit: "garrison_land" }],
        armed_citizenry_units_to_unit_groups_junctions_tables: [
          { id: "1", unit_group: "garrison_group", unit: "garrison_unit", priority: "1" },
        ],
      },
      noLoc,
    );
    const state = addRows(addGarrisonRows({ levelKey: "a_1", unitGroup: "garrison_group" }, {}));
    const view = resolveRegionBuildings(applyNewRowsToBuiltData(base, state), query);
    const tile = view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles))[0];
    expect(tile.garrison.map((unit) => unit.unitKey)).toEqual(["garrison_unit"]);
  });

  it("does not mutate the dataset it was given", () => {
    const base = data();
    const beforeLevels = Object.keys(base.levelsByKey).length;
    const beforeUpgrades = base.upgrades.length;
    const state = addRows(
      addBuildingLevelRows(
        {
          levelKey: "a_2",
          chainKey: "chain_a",
          level: 1,
          culture: "emp",
          subculture: "",
          faction: "",
          title: "t",
          createTime: 1,
          createCost: 1,
          upkeepCost: 1,
          upgradeFromLevelKey: "a_1",
        },
        {},
      ),
    );
    applyNewRowsToBuiltData(base, state);
    expect(Object.keys(base.levelsByKey)).toHaveLength(beforeLevels);
    expect(base.upgrades).toHaveLength(beforeUpgrades);
    expect(base.levelKeysByChain.chain_a).toEqual(["a_1"]);
  });
});

describe("pending effects", () => {
  const withEffects = () =>
    buildBuildingsData(
      {
        ...baseTables(),
        effects_tables: [{ effect: "eff_growth", icon: "growth.png" }],
        building_effects_junction_tables: [
          { building: "a_1", effect: "eff_growth", effect_scope: "building_to_building_own", value: "2" },
        ],
      },
      // The only loc the effect formatter needs.
      (key) => (key === "effects_description_eff_growth" ? "+%n growth" : undefined),
    );

  const effectOn = (levelKey: string, value: number) => {
    const state = buildingsEditReducer(emptyBuildingsEditState(), {
      type: "addRows",
      rows: [
        {
          table: "building_effects_junction_tables",
          origin: "addBuilding",
          values: {
            building: levelKey,
            effect: "eff_growth",
            effect_scope: "building_to_building_own",
            value: `${value}`,
          },
        },
      ],
    });
    return applyNewRowsToBuiltData(withEffects(), state).effectsByLevel[levelKey]?.at(-1);
  };

  it("localizes a pending effect instead of showing its raw key", () => {
    // Was `localizedKey: effectKey`, so a copied effect read as "eff_growth" with no icon.
    expect(effectOn("a_1", 5)?.localizedKey).toBe("+5 growth");
  });

  it("substitutes the pending row's own value, not the one it was copied from", () => {
    expect(effectOn("a_1", 9)?.localizedKey).toBe("+9 growth");
  });

  it("carries the icon through, so the tile can resolve its URL", () => {
    expect(effectOn("a_1", 5)?.icon).toBe("growth.png");
  });

  it("overrides an effect the building already has rather than listing it twice", () => {
    // How "change a vanilla effect's value" is expressed: a pack cannot edit a row, but the table
    // keys on (building, effect), so a row naming the same pair replaces it.
    const state = buildingsEditReducer(emptyBuildingsEditState(), {
      type: "addRows",
      rows: [
        {
          table: "building_effects_junction_tables",
          origin: "manual",
          values: {
            building: "a_1",
            effect: "eff_growth",
            effect_scope: "building_to_building_own",
            value: "7",
          },
        },
      ],
    });
    const effects = applyNewRowsToBuiltData(withEffects(), state).effectsByLevel.a_1;
    expect(effects).toHaveLength(1);
    expect(effects[0].value).toBe(7);
    expect(effects[0].localizedKey).toBe("+7 growth");
  });

  it("falls back to the key for an effect no building uses", () => {
    const state = buildingsEditReducer(emptyBuildingsEditState(), {
      type: "addRows",
      rows: [
        {
          table: "building_effects_junction_tables",
          origin: "manual",
          values: { building: "a_1", effect: "eff_unknown", effect_scope: "s", value: "1" },
        },
      ],
    });
    const effect = applyNewRowsToBuiltData(withEffects(), state).effectsByLevel.a_1?.at(-1);
    expect(effect?.localizedKey).toBe("eff_unknown");
    expect(effect?.icon).toBeUndefined();
  });
});

describe("cloneCaiRows", () => {
  const valuesRow = {
    building_chain: "chain_a",
    building_super_chain: "super_a",
    building_instance: "inst_a",
    building_or_building_range_start_inclusive: "a_1",
    building_range_end_inclusive: "a_2",
    cai_construction_system_category: "military",
    score_or_score_start_inclusive: "50",
  };

  const rowsByTable = { cai_construction_system_building_values_tables: [valuesRow] };

  it("rewrites only the columns that name the template chain", () => {
    const rows = cloneCaiRows({ fromChainKey: "chain_a", toChainKey: "chain_new", rowsByTable });
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toMatchObject({
      building_chain: "chain_new",
      // Untouched, because no superchain or instance rewrite was asked for.
      building_super_chain: "super_a",
      building_instance: "inst_a",
      cai_construction_system_category: "military",
      score_or_score_start_inclusive: "50",
    });
  });

  it("rewrites the superchain, instance and level keys when told to", () => {
    const rows = cloneCaiRows({
      fromChainKey: "chain_a",
      toChainKey: "chain_new",
      rowsByTable,
      fromSuperChain: "super_a",
      toSuperChain: "super_new",
      fromInstanceKey: "inst_a",
      toInstanceKey: "inst_new",
      levelKeyMap: { a_1: "new_1", a_2: "new_2" },
    });
    expect(rows[0].values).toMatchObject({
      building_chain: "chain_new",
      building_super_chain: "super_new",
      building_instance: "inst_new",
      building_or_building_range_start_inclusive: "new_1",
      building_range_end_inclusive: "new_2",
    });
  });

  it("leaves a third chain a synergy names pointing where it pointed", () => {
    const rows = cloneCaiRows({
      fromChainKey: "chain_a",
      toChainKey: "chain_new",
      rowsByTable: {
        cai_construction_system_synergies_tables: [
          {
            existing_building_chain_key: "chain_a",
            potential_buiding_chain_key: "chain_other",
            synergy_policy_key: "encourage",
          },
        ],
      },
    });
    expect(rows[0].values).toEqual({
      existing_building_chain_key: "chain_new",
      potential_buiding_chain_key: "chain_other",
      synergy_policy_key: "encourage",
    });
  });

  it("drops a row that names the template nowhere, which would only override vanilla", () => {
    const rows = cloneCaiRows({
      fromChainKey: "chain_a",
      toChainKey: "chain_new",
      rowsByTable: {
        cai_construction_system_synergies_tables: [
          { existing_building_chain_key: "chain_x", potential_buiding_chain_key: "chain_y" },
        ],
      },
    });
    expect(rows).toEqual([]);
  });

  it("tags every row as a clone, so one action can be undone as a unit", () => {
    const rows = cloneCaiRows({ fromChainKey: "chain_a", toChainKey: "chain_new", rowsByTable });
    expect(rows.every((row) => row.origin === "clone")).toBe(true);
  });
});

describe("numeric id cursors", () => {
  it("carries advanced cursors onto the state, so two actions cannot allocate the same id", () => {
    let state = emptyBuildingsEditState({ building_units_allowed_tables: 7 });

    const firstCursors = { ...state.numericIdCursors };
    const first = addRecruitableUnitRows({ levelKey: "a_1", unitKey: "unit_one" }, firstCursors);
    state = buildingsEditReducer(state, { type: "addRows", rows: first, numericIdCursors: firstCursors });

    const secondCursors = { ...state.numericIdCursors };
    const second = addRecruitableUnitRows({ levelKey: "a_1", unitKey: "unit_two" }, secondCursors);
    state = buildingsEditReducer(state, { type: "addRows", rows: second, numericIdCursors: secondCursors });

    const keys = Object.values(state.rowsById)
      .filter((row) => row.table === "building_units_allowed_tables")
      .map((row) => row.values.key);
    expect(keys).toEqual(["7", "8"]);
  });

  it("leaves the cursors alone when an action allocated nothing", () => {
    const state = emptyBuildingsEditState({ building_units_allowed_tables: 7 });
    const next = buildingsEditReducer(state, {
      type: "addRows",
      rows: [{ table: "building_levels_tables", origin: "manual", values: { level_name: "x" } }],
    });
    expect(next.numericIdCursors).toEqual({ building_units_allowed_tables: 7 });
  });
});

describe("addBuildingChainRows", () => {
  const input = {
    chainKey: "custom_chain",
    superChain: "super_a",
    culture: "emp",
    subculture: "",
    faction: "",
    campaign: CAMPAIGN,
    slotTemplates: ["tmpl"],
  };

  it("writes the chain, the availability trio and a slot permission", () => {
    const tables = addBuildingChainRows(input, {}).map((row) => row.table);
    expect(tables).toEqual([
      "building_chains_tables",
      "building_chain_availability_set_ids_tables",
      "building_chain_availability_sets_tables",
      "building_chain_availabilities_tables",
      "slot_template_permitted_building_chains_tables",
    ]);
  });

  it("ties the availability rows together through one set id", () => {
    const rows = addBuildingChainRows(input, {});
    const setId = rows.find((row) => row.table === "building_chain_availability_set_ids_tables")!.values.id;
    expect(rows.find((row) => row.table === "building_chain_availability_sets_tables")!.values).toMatchObject({
      building_chain: "custom_chain",
      id: setId,
    });
    expect(rows.find((row) => row.table === "building_chain_availabilities_tables")!.values).toMatchObject({
      set_id: setId,
      culture: "emp",
    });
  });

  it("allocates the availability id from the cursor", () => {
    const cursors = { building_chain_availabilities_tables: 900 };
    const rows = addBuildingChainRows(input, cursors);
    expect(rows.find((row) => row.table === "building_chain_availabilities_tables")!.values.id).toBe("900");
    expect(cursors.building_chain_availabilities_tables).toBe(901);
  });

  it("writes one permission per slot template and dedupes repeats", () => {
    const rows = addBuildingChainRows({ ...input, slotTemplates: ["tmpl", "tmpl", "other"] }, {});
    const permissions = rows.filter((row) => row.table === "slot_template_permitted_building_chains_tables");
    expect(permissions.map((row) => row.values.slot_template)).toEqual(["tmpl", "other"]);
    expect(permissions[0].values).toMatchObject({ chain: "custom_chain", remove: "false" });
  });

  it("binds settlement types only when asked", () => {
    expect(
      addBuildingChainRows(input, {}).some(
        (row) => row.table === "settlement_type_to_building_chains_junctions_tables",
      ),
    ).toBe(false);
    const bound = addBuildingChainRows({ ...input, settlementTypes: ["capital"] }, {});
    expect(
      bound.find((row) => row.table === "settlement_type_to_building_chains_junctions_tables")!.values,
    ).toMatchObject({ building_chain: "custom_chain", settlement_type: "capital", exclude: "false" });
  });

  it("puts a whole new chain on the board once it has a level and a band", () => {
    const cursors: Record<string, number> = {};
    const rows = [
      ...addBuildingChainRows(input, cursors),
      ...addBuildingLevelRows(
        {
          levelKey: "custom_chain_1",
          chainKey: "custom_chain",
          level: 0,
          setKey: "set_one",
          culture: "emp",
          subculture: "",
          faction: "",
          title: "Custom",
          createTime: 1,
          createCost: 100,
          upkeepCost: 0,
          isChainAlreadyInSet: false,
        },
        cursors,
      ),
    ];
    const state = buildingsEditReducer(emptyBuildingsEditState(), { type: "addRows", rows });
    const view = resolveRegionBuildings(applyNewRowsToBuiltData(data(), state), query);
    const chains = view.bands.flatMap((band) => band.columns.map((column) => column.chainKey));
    expect(chains).toContain("custom_chain");
  });
});
