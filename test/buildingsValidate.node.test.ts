import { describe, expect, it } from "vitest";

import { buildBuildingsData } from "../src/buildingsData/data";
import {
  buildingsEditReducer,
  emptyBuildingsEditState,
  LOC_TABLE,
  type BuildingsEditState,
} from "../src/buildingsData/edits";
import { addBuildingLevelRows } from "../src/buildingsData/editActions";
import { groupIssuesByRow, validateNewRows } from "../src/buildingsData/validate";
import type { BuildingsTableRows } from "../src/buildingsData/types";

const noLoc = () => undefined;

const baseTables = (): BuildingsTableRows => ({
  building_chains_tables: [{ key: "chain_a", building_superchain: "super_a" }],
  building_levels_tables: [{ level_name: "a_1", chain: "chain_a", level: "0", visible_in_ui: "true" }],
  building_sets_tables: [{ key: "set_one", sort_order: "1", show_in_ui: "true" }],
  building_instances_tables: [{ key: "inst_one", num_instances: "1" }],
});

const base = () => buildBuildingsData(baseTables(), noLoc);

type Draft = Parameters<typeof buildingsEditReducer>[1] extends { rows: infer R } ? R : never;

const stateWith = (rows: Draft, previous: BuildingsEditState = emptyBuildingsEditState()) =>
  buildingsEditReducer(previous, { type: "addRows", rows });

describe("validateNewRows", () => {
  it("passes a row whose references all resolve", () => {
    const state = stateWith([
      {
        table: "building_culture_variants_tables",
        origin: "addBuilding",
        values: { building: "a_1", culture: "emp", subculture: "", faction: "" },
      },
    ]);
    expect(validateNewRows(base(), state)).toEqual([]);
  });

  it("flags a reference to a level that does not exist", () => {
    const state = stateWith([
      {
        table: "building_upgrades_junction_tables",
        origin: "addBuilding",
        values: { from: "a_1", to: "a_2" },
      },
    ]);
    const issues = validateNewRows(base(), state);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "danglingReference", column: "to" });
    expect(issues[0].message).toContain("a_2");
  });

  it("accepts a reference to a level another pending row defines", () => {
    let state = stateWith([
      {
        table: "building_levels_tables",
        origin: "addBuilding",
        values: { level_name: "a_2", chain: "chain_a", level: "1" },
      },
    ]);
    state = stateWith(
      [{ table: "building_upgrades_junction_tables", origin: "addBuilding", values: { from: "a_1", to: "a_2" } }],
      state,
    );
    expect(validateNewRows(base(), state)).toEqual([]);
  });

  it("flags a new level whose key already exists, because that overrides rather than adds", () => {
    const state = stateWith([
      {
        table: "building_levels_tables",
        origin: "addBuilding",
        values: { level_name: "a_1", chain: "chain_a", level: "0" },
      },
    ]);
    const issues = validateNewRows(base(), state);
    expect(issues.map((issue) => issue.kind)).toEqual(["overridesExisting"]);
  });

  it("does not call a new level with a fresh key an override", () => {
    const state = stateWith([
      {
        table: "building_levels_tables",
        origin: "addBuilding",
        values: { level_name: "a_9", chain: "chain_a", level: "3" },
      },
    ]);
    expect(validateNewRows(base(), state)).toEqual([]);
  });

  it("flags an empty key column", () => {
    const state = stateWith([
      { table: "building_levels_tables", origin: "manual", values: { level_name: "", chain: "chain_a" } },
    ]);
    const issues = validateNewRows(base(), state);
    expect(issues.map((issue) => issue.kind)).toEqual(["missingKey"]);
    expect(issues[0].column).toBe("level_name");
  });

  it("flags a second row that repeats an earlier row's key", () => {
    const state = stateWith([
      { table: "building_levels_tables", origin: "manual", values: { level_name: "a_7", chain: "chain_a" } },
      { table: "building_levels_tables", origin: "manual", values: { level_name: "a_7", chain: "chain_a" } },
    ]);
    const issues = validateNewRows(base(), state);
    expect(issues.map((issue) => issue.kind)).toEqual(["duplicateKey"]);
    // The complaint lands on the later row, which is the one that has to change.
    expect(issues[0].rowId).toBe(state.order[1]);
  });

  it("does not treat different composite keys in one table as duplicates", () => {
    const state = stateWith([
      {
        table: "building_culture_variants_tables",
        origin: "manual",
        values: { building: "a_1", culture: "emp", subculture: "", faction: "" },
      },
      {
        table: "building_culture_variants_tables",
        origin: "manual",
        values: { building: "a_1", culture: "dwf", subculture: "", faction: "" },
      },
    ]);
    expect(validateNewRows(base(), state)).toEqual([]);
  });

  it("leaves an empty non-key reference alone, since empty means 'any' in these junctions", () => {
    const state = stateWith([
      {
        table: "building_set_to_building_junctions_tables",
        origin: "manual",
        values: { building_chain: "chain_a", building_level: "", building_set: "set_one", exclude: "false" },
      },
    ]);
    expect(validateNewRows(base(), state)).toEqual([]);
  });

  it("checks the set and instance universes too", () => {
    const state = stateWith([
      {
        table: "building_set_to_building_junctions_tables",
        origin: "manual",
        values: { building_chain: "chain_b", building_level: "", building_set: "set_two", exclude: "false" },
      },
      {
        table: "building_levels_tables",
        origin: "manual",
        values: { level_name: "a_8", chain: "chain_a", building_instance_key: "inst_two" },
      },
    ]);
    const issues = validateNewRows(base(), state);
    expect(
      issues
        .filter((issue) => issue.kind === "danglingReference")
        .map((issue) => issue.column)
        .sort(),
    ).toEqual(["building_chain", "building_instance_key", "building_set"]);
  });

  it("keys loc rows on `key`, so a repeated loc key is caught", () => {
    const state = stateWith([
      { table: LOC_TABLE, origin: "manual", values: { key: "some_key", text: "One" } },
      { table: LOC_TABLE, origin: "manual", values: { key: "some_key", text: "Two" } },
    ]);
    expect(validateNewRows(base(), state).map((issue) => issue.kind)).toEqual(["duplicateKey"]);
  });

  it("reports nothing for a building added the normal way onto an existing chain", () => {
    const cursors: Record<string, number> = {};
    const state = stateWith(
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
          createTime: 2,
          createCost: 500,
          upkeepCost: 50,
          upgradeFromLevelKey: "a_1",
          isChainAlreadyInSet: true,
        },
        cursors,
      ),
      emptyBuildingsEditState(),
    );
    expect(validateNewRows(base(), state)).toEqual([]);
  });
});

describe("groupIssuesByRow", () => {
  it("collects every issue a row has under its id", () => {
    const state = stateWith([
      { table: "building_levels_tables", origin: "manual", values: { level_name: "", chain: "missing_chain" } },
    ]);
    const grouped = groupIssuesByRow(validateNewRows(base(), state));
    expect(Object.keys(grouped)).toEqual([state.order[0]]);
    expect(grouped[state.order[0]].map((issue) => issue.kind).sort()).toEqual(["danglingReference", "missingKey"]);
  });

  it("is empty when there is nothing to report", () => {
    expect(groupIssuesByRow([])).toEqual({});
  });
});
