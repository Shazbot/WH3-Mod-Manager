import { describe, expect, it } from "vitest";

import { applyNewRowsToBuiltData } from "../src/buildingsData/applyEdits";
import { buildBuildingsData } from "../src/buildingsData/data";
import {
  dbClonePackedFilesToBuildingsRows,
  filterDuplicateBuildingsCloneRows,
  filterDuplicateDBCloneRows,
} from "../src/buildingsData/dbCloneRows";
import { resolveRegionBuildings } from "../src/buildingsData/derive";
import { buildingsEditReducer, emptyBuildingsEditState, LOC_TABLE } from "../src/buildingsData/edits";
import type { BuildingsTableRows } from "../src/buildingsData/types";
import { LocVersion, type DBVersion, type PackedFile, type SCHEMA_FIELD_TYPE } from "../src/packFileTypes";

const schema: DBVersion = {
  version: 3,
  fields: [
    { name: "key", field_type: "StringU8", is_key: true, default_value: "" },
    { name: "cost", field_type: "I32", is_key: false, default_value: "0" },
  ],
};

const cell = (name: string, value: string, type: SCHEMA_FIELD_TYPE = "StringU8") => ({
  name,
  type,
  resolvedKeyValue: value,
  fields: [],
  isKey: name === "key",
});

describe("DB Clone rows for Buildings", () => {
  it("skips exact rows already pending while retaining changed overrides", () => {
    const existingRows = [
      { table: "example_tables", values: { key: "clone_a", cost: "100" }, origin: "clone" as const },
    ];
    const generatedRows = [
      { table: "example_tables", values: { key: "clone_a", cost: "100" }, origin: "clone" as const },
      { table: "example_tables", values: { key: "clone_a", cost: "200" }, origin: "clone" as const },
      { table: "example_tables", values: { key: "clone_b", cost: "300" }, origin: "clone" as const },
      { table: "example_tables", values: { key: "clone_b", cost: "300" }, origin: "clone" as const },
    ];

    expect(filterDuplicateBuildingsCloneRows(generatedRows, existingRows, { example_tables: schema })).toEqual([
      generatedRows[1],
      generatedRows[2],
    ]);
  });

  it("uses the same duplicate filter for ancillary-shaped pending rows", () => {
    const existingRows = [{ table: "ancillaries_tables", values: { key: "anc_a", type: "type_a" } }];
    const generatedRows = [
      { table: "ancillaries_tables", values: { key: "anc_a", type: "type_a" }, origin: "clone" as const },
      { table: "ancillaries_tables", values: { key: "anc_b", type: "type_a" }, origin: "clone" as const },
    ];

    expect(filterDuplicateDBCloneRows(generatedRows, existingRows, { ancillaries_tables: schema })).toEqual([
      generatedRows[1],
    ]);
  });

  it("converts generated DB and localization files into clone-origin pending rows", () => {
    const packedFiles: PackedFile[] = [
      {
        name: "db\\example_tables\\clone_",
        file_size: 0,
        start_pos: -1,
        tableSchema: schema,
        schemaFields: [
          cell("key", "clone_a"),
          cell("cost", "100", "I32"),
          cell("key", "clone_b"),
          cell("cost", "200", "I32"),
        ],
      },
      {
        name: "text\\db\\clone_.loc",
        file_size: 0,
        start_pos: -1,
        tableSchema: LocVersion,
        schemaFields: [
          cell("key", "building_clone_a"),
          cell("text", "Clone A", "StringU16"),
          cell("tooltip", "false", "Boolean"),
        ],
      },
    ];

    const result = dbClonePackedFilesToBuildingsRows(packedFiles);

    expect(result.tableSchemas).toEqual({ example_tables: schema });
    expect(result.rows).toEqual([
      { table: "example_tables", origin: "clone", values: { key: "clone_a", cost: "100" } },
      { table: "example_tables", origin: "clone", values: { key: "clone_b", cost: "200" } },
      {
        table: LOC_TABLE,
        origin: "clone",
        values: { key: "building_clone_a", text: "Clone A", tooltip: "false" },
      },
    ]);
  });

  it("updates the Board after generated memory rows are added to the Buildings edit state", () => {
    const baseTables: BuildingsTableRows = {
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
      regions_tables: [{ key: "region_x" }],
      campaigns_tables: [{ campaign_name: "camp" }],
      start_pos_region_slot_templates_tables: [
        { campaign: "camp", id: "1", region: "region_x", slot_template: "tmpl", slot_type: "secondary" },
      ],
      slot_template_permitted_building_chains_tables: [
        { slot_template: "tmpl", chain: "chain_a", chain_set: "", super_chain: "", remove: "false" },
      ],
    };
    const levelSchema: DBVersion = {
      version: 1,
      fields: [
        { name: "level_name", field_type: "StringU8", is_key: true, default_value: "" },
        { name: "chain", field_type: "StringU8", is_key: false, default_value: "" },
        { name: "level", field_type: "I32", is_key: false, default_value: "0" },
        { name: "visible_in_ui", field_type: "Boolean", is_key: false, default_value: "true" },
      ],
    };
    const variantSchema: DBVersion = {
      version: 1,
      fields: [
        { name: "building", field_type: "StringU8", is_key: true, default_value: "" },
        { name: "culture", field_type: "StringU8", is_key: true, default_value: "" },
        { name: "subculture", field_type: "StringU8", is_key: true, default_value: "" },
        { name: "faction", field_type: "StringU8", is_key: true, default_value: "" },
        { name: "disables", field_type: "Boolean", is_key: false, default_value: "false" },
        { name: "display_tooltip", field_type: "Boolean", is_key: false, default_value: "true" },
      ],
    };
    const generatedFiles: PackedFile[] = [
      {
        name: "db\\building_levels_tables\\clone_",
        file_size: 0,
        start_pos: -1,
        tableSchema: levelSchema,
        schemaFields: [
          cell("level_name", "a_2"),
          cell("chain", "chain_a"),
          cell("level", "1", "I32"),
          cell("visible_in_ui", "true", "Boolean"),
        ],
      },
      {
        name: "db\\building_culture_variants_tables\\clone_",
        file_size: 0,
        start_pos: -1,
        tableSchema: variantSchema,
        schemaFields: [
          cell("building", "a_2"),
          cell("culture", "emp"),
          cell("subculture", ""),
          cell("faction", ""),
          cell("disables", "false", "Boolean"),
          cell("display_tooltip", "true", "Boolean"),
        ],
      },
      {
        name: "text\\db\\clone_.loc",
        file_size: 0,
        start_pos: -1,
        tableSchema: LocVersion,
        schemaFields: [
          cell("key", "building_culture_variants_name_a_2emp", "StringU16"),
          cell("text", "Memory Clone", "StringU16"),
          cell("tooltip", "false", "Boolean"),
        ],
      },
    ];

    const cloneOutput = dbClonePackedFilesToBuildingsRows(generatedFiles);
    const edits = buildingsEditReducer(emptyBuildingsEditState(), { type: "addRows", rows: cloneOutput.rows });
    const built = applyNewRowsToBuiltData(
      buildBuildingsData(baseTables, () => undefined),
      edits,
    );
    const view = resolveRegionBuildings(built, { campaign: "camp", region: "region_x", culture: "emp" });
    const tiles = view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles));

    expect(tiles.map((tile) => tile.levelKey)).toEqual(["a_1", "a_2"]);
    expect(tiles.find((tile) => tile.levelKey === "a_2")?.title).toBe("Memory Clone");
  });
});
