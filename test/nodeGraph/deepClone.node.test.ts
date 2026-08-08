import { describe, expect, it, vi } from "vitest";

import {
  DeepClonePlan,
  LoadedTableFile,
  executeDeepClonePlan,
  expandVariants,
} from "../../src/flowDeepClone";
import { chunkSchemaIntoRows } from "../../src/packFileSerializer";
import type { AmendedSchemaField, DBField, DBVersion, PackedFile } from "../../src/packFileTypes";
import type { DeepCloneTreeNode } from "../../src/nodeGraph/nodes/types";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const createField = (
  name: string,
  options: { isKey?: boolean; reference?: [string, string] } = {},
): DBField =>
  ({
    name,
    field_type: "StringU8",
    is_key: options.isKey ?? false,
    default_value: "",
    is_filename: false,
    is_reference: options.reference ?? [],
    description: "",
    ca_order: 0,
    is_bitwise: 0,
    enum_values: {},
  }) as DBField;

const schemas: Record<string, DBVersion> = {
  main_units_tables: {
    version: 1,
    fields: [
      createField("unit", { isKey: true }),
      createField("land_unit", { reference: ["land_units_tables", "key"] }),
      createField("caste", { reference: ["unit_castes_tables", "caste"] }),
      createField("cost"),
    ],
    localised_fields: [createField("onscreen_name")],
    localised_key_order: [0],
  },
  land_units_tables: {
    version: 1,
    fields: [
      createField("key", { isKey: true }),
      createField("shield"),
      createField("man_entity", { reference: ["unit_stats_land_tables", "key"] }),
    ],
  },
  unit_stats_land_tables: {
    version: 1,
    fields: [createField("key", { isKey: true }), createField("attack")],
  },
  unit_castes_tables: {
    version: 1,
    fields: [createField("caste", { isKey: true }), createField("label")],
  },
  units_to_groupings_tables: {
    version: 1,
    fields: [createField("unit", { reference: ["main_units_tables", "unit"] }), createField("grouping")],
  },
  // Reverse-references main_units_tables but is deliberately absent from the clone tree, so only
  // auto-follow can reach it.
  unit_permissions_tables: {
    version: 1,
    fields: [
      createField("unit", { reference: ["main_units_tables", "unit"] }),
      createField("faction"),
    ],
  },
  // Composite-key junction hanging off land_units_tables, to cover auto-follow on a key renamed
  // deeper in the plan than the root.
  land_units_to_abilities_tables: {
    version: 1,
    fields: [
      createField("land_unit", { isKey: true, reference: ["land_units_tables", "key"] }),
      createField("ability", { isKey: true }),
    ],
  },
  // Identified by a synthetic numeric id rather than by the reference, like
  // building_units_allowed_tables. The regenerated id is what keeps the copy distinct.
  building_units_allowed_tables: {
    version: 1,
    fields: [
      createField("key", { isKey: true }),
      createField("unit", { reference: ["main_units_tables", "unit"] }),
      createField("building"),
    ],
  },
  // Stands in for the DLC ownership junctions that are always skipped.
  ownership_junctions_tables: {
    version: 1,
    fields: [
      createField("unit", { reference: ["main_units_tables", "unit"] }),
      createField("content_pack"),
    ],
  },
};

/** Same inversion schema.ts performs to build gameToDBFieldsReferencedBy. */
const reverseReferencesByTable: Record<string, Record<string, string[][]>> = (() => {
  const index: Record<string, Record<string, string[][]>> = {};
  for (const [tableName, schema] of Object.entries(schemas)) {
    for (const field of schema.fields) {
      if (!field.is_reference || field.is_reference.length < 2) continue;
      const [referencedTable, referencedColumn] = field.is_reference;
      index[referencedTable] = index[referencedTable] || {};
      index[referencedTable][referencedColumn] = index[referencedTable][referencedColumn] || [];
      index[referencedTable][referencedColumn].push([tableName, field.name]);
    }
  }
  return index;
})();

const createRow = (tableName: string, values: string[]): AmendedSchemaField[] =>
  schemas[tableName].fields.map((field, index) => ({
    name: field.name,
    type: "StringU8" as const,
    fields: [{ type: "String" as const, val: values[index] ?? "" }],
    resolvedKeyValue: values[index] ?? "",
    isKey: field.is_key,
  }));

const createTableFile = (tableName: string, rows: string[][]): LoadedTableFile => ({
  tableName,
  packedFile: {
    name: `db\\${tableName}\\data__`,
    file_size: 0,
    start_pos: 0,
    version: 1,
    tableSchema: schemas[tableName],
    schemaFields: rows.flatMap((values) => createRow(tableName, values)),
  } as PackedFile,
  packName: "test.pack",
  packPath: "C:\\test.pack",
});

/** emp_spearmen -> emp_spearmen_land -> emp_spearmen_stats, caste "melee_infantry", one grouping row. */
const createTableFiles = (): Record<string, LoadedTableFile> => ({
  main_units_tables: createTableFile("main_units_tables", [
    ["emp_spearmen", "emp_spearmen_land", "melee_infantry", "500"],
    ["other_unit", "other_land", "melee_infantry", "300"],
    // Shares emp_spearmen_land with the clone source. Reachable from the renamed land_units key, but
    // it is an unrelated unit and must never be emitted.
    ["emp_spearmen_veteran", "emp_spearmen_land", "melee_infantry", "700"],
  ]),
  land_units_tables: createTableFile("land_units_tables", [
    ["emp_spearmen_land", "0", "emp_spearmen_stats"],
    ["other_land", "0", "other_stats"],
  ]),
  unit_stats_land_tables: createTableFile("unit_stats_land_tables", [
    ["emp_spearmen_stats", "12"],
    ["other_stats", "9"],
  ]),
  unit_castes_tables: createTableFile("unit_castes_tables", [["melee_infantry", "Melee Infantry"]]),
  units_to_groupings_tables: createTableFile("units_to_groupings_tables", [
    ["emp_spearmen", "empire_core"],
  ]),
  unit_permissions_tables: createTableFile("unit_permissions_tables", [
    ["emp_spearmen", "emp_empire"],
    ["emp_spearmen", "emp_secessionists"],
    ["other_unit", "emp_empire"],
  ]),
  ownership_junctions_tables: createTableFile("ownership_junctions_tables", [
    ["emp_spearmen", "base_game"],
  ]),
  land_units_to_abilities_tables: createTableFile("land_units_to_abilities_tables", [
    ["emp_spearmen_land", "wall_defence"],
    ["other_land", "charge_defence"],
  ]),
  building_units_allowed_tables: createTableFile("building_units_allowed_tables", [
    ["12345", "emp_spearmen", "emp_barracks"],
  ]),
});

const createCloneTree = (options: { cloneCaste?: boolean } = {}): DeepCloneTreeNode => ({
  table: "main_units_tables",
  keyColumn: "unit",
  linkColumn: "",
  direction: "forward",
  selected: true,
  children: [
    {
      table: "land_units_tables",
      keyColumn: "key",
      linkColumn: "land_unit",
      direction: "forward",
      selected: true,
      children: [
        {
          table: "unit_stats_land_tables",
          keyColumn: "key",
          linkColumn: "man_entity",
          direction: "forward",
          selected: true,
          children: [],
        },
      ],
    },
    {
      table: "unit_castes_tables",
      keyColumn: "caste",
      linkColumn: "caste",
      direction: "forward",
      selected: options.cloneCaste ?? false,
      children: [],
    },
    {
      table: "units_to_groupings_tables",
      keyColumn: "",
      linkColumn: "unit",
      direction: "reverse",
      selected: true,
      children: [],
    },
  ],
});

const createPlan = (overrides: Partial<DeepClonePlan> = {}): DeepClonePlan => ({
  cloneTree: createCloneTree(),
  nameTemplate: "my_new_unit{variant}",
  useModdersPrefix: false,
  moddersPrefix: "",
  variantAxes: [],
  columnOverrides: [],
  generateLoc: false,
  autoFollowReferences: false,
  ...overrides,
});

const runClone = async (
  plan: DeepClonePlan,
  options: { locTexts?: Record<string, string> } = {},
) => {
  const tableFiles = createTableFiles();
  // Only the emp_spearmen row is the clone source; the second row stands in for unrelated data.
  const rootFile = createTableFile("main_units_tables", [
    ["emp_spearmen", "emp_spearmen_land", "melee_infantry", "500"],
  ]);

  return executeDeepClonePlan([rootFile], plan, {
    loadTable: async (tableName) => (tableFiles[tableName] ? [tableFiles[tableName]] : []),
    getRows: (packedFile) =>
      chunkSchemaIntoRows(packedFile.schemaFields!, packedFile.tableSchema!) as AmendedSchemaField[][],
    lookupLocText: (locKey) => options.locTexts?.[locKey],
    referencedColumnsByTable: {},
    numericIdFieldByTable: {},
    reverseReferencesByTable,
    tablesToIgnore: ["ownership_junctions_tables"],
  });
};

const getTable = (result: Awaited<ReturnType<typeof runClone>>, tableName: string) =>
  result.tables.find((table) => table.tableName === tableName);

const cellValue = (row: AmendedSchemaField[], columnName: string) =>
  row.find((cell) => cell.name === columnName)?.resolvedKeyValue;

describe("expandVariants", () => {
  it("returns a single empty variant when there are no axes", () => {
    expect(expandVariants([])).toEqual([{ suffix: "", overrides: [] }]);
  });

  it("produces the cartesian product of the axes, concatenating suffixes in axis order", () => {
    const variants = expandVariants([
      {
        id: "shield",
        name: "shield",
        values: [
          { id: "a", suffix: "_shielded", overrides: [] },
          { id: "b", suffix: "_unshielded", overrides: [] },
        ],
      },
      {
        id: "tier",
        name: "tier",
        values: [
          { id: "c", suffix: "_t1", overrides: [] },
          { id: "d", suffix: "_t2", overrides: [] },
        ],
      },
    ]);

    expect(variants.map((variant) => variant.suffix)).toEqual([
      "_shielded_t1",
      "_shielded_t2",
      "_unshielded_t1",
      "_unshielded_t2",
    ]);
  });
});

describe("Deep clone engine", () => {
  it("clones the selected reference closure and leaves unselected references pointing at the original", async () => {
    const result = await runClone(createPlan());

    expect(result.tables.map((table) => table.tableName).toSorted()).toEqual([
      "land_units_tables",
      "main_units_tables",
      "unit_stats_land_tables",
      "units_to_groupings_tables",
    ]);
    // unit_castes_tables was left unchecked, so it must not be cloned.
    expect(getTable(result, "unit_castes_tables")).toBeUndefined();

    const mainRow = getTable(result, "main_units_tables")!.rows[0];
    expect(cellValue(mainRow, "unit")).toBe("my_new_unit");
    // The land_unit foreign key follows the clone...
    expect(cellValue(mainRow, "land_unit")).toBe("my_new_unit");
    // ...while the caste reference still points at the shared original row.
    expect(cellValue(mainRow, "caste")).toBe("melee_infantry");

    const landRow = getTable(result, "land_units_tables")!.rows[0];
    expect(cellValue(landRow, "key")).toBe("my_new_unit");
    expect(cellValue(landRow, "man_entity")).toBe("my_new_unit");

    expect(cellValue(getTable(result, "unit_stats_land_tables")!.rows[0], "key")).toBe("my_new_unit");
    expect(cellValue(getTable(result, "unit_stats_land_tables")!.rows[0], "attack")).toBe("12");
  });

  it("clones a keyless reverse-reference row and rewrites its foreign key back at the new key", async () => {
    const result = await runClone(createPlan());

    const groupingTable = getTable(result, "units_to_groupings_tables")!;
    expect(groupingTable.rows).toHaveLength(1);
    expect(cellValue(groupingTable.rows[0], "unit")).toBe("my_new_unit");
    expect(cellValue(groupingTable.rows[0], "grouping")).toBe("empire_core");
  });

  it("fans out over two variant axes and lands each override on the right rows", async () => {
    const result = await runClone(
      createPlan({
        variantAxes: [
          {
            id: "shield",
            name: "shield",
            values: [
              {
                id: "shielded",
                suffix: "_shielded",
                overrides: [{ table: "land_units_tables", column: "shield", value: "1" }],
              },
              {
                id: "unshielded",
                suffix: "_unshielded",
                overrides: [{ table: "land_units_tables", column: "shield", value: "0" }],
              },
            ],
          },
          {
            id: "tier",
            name: "tier",
            values: [
              {
                id: "t1",
                suffix: "_t1",
                overrides: [{ table: "main_units_tables", column: "cost", value: "500" }],
              },
              {
                id: "t2",
                suffix: "_t2",
                overrides: [{ table: "main_units_tables", column: "cost", value: "900" }],
              },
            ],
          },
        ],
      }),
    );

    const mainTable = getTable(result, "main_units_tables")!;
    const landTable = getTable(result, "land_units_tables")!;
    const groupingTable = getTable(result, "units_to_groupings_tables")!;

    expect(mainTable.rows).toHaveLength(4);
    expect(landTable.rows).toHaveLength(4);
    expect(groupingTable.rows).toHaveLength(4);

    expect(mainTable.rows.map((row) => cellValue(row, "unit"))).toEqual([
      "my_new_unit_shielded_t1",
      "my_new_unit_shielded_t2",
      "my_new_unit_unshielded_t1",
      "my_new_unit_unshielded_t2",
    ]);

    // Each main_units row points at its own land_units row, not at a shared one.
    for (const row of mainTable.rows) {
      expect(cellValue(row, "land_unit")).toBe(cellValue(row, "unit"));
    }

    const shieldByKey = new Map(
      landTable.rows.map((row) => [cellValue(row, "key"), cellValue(row, "shield")]),
    );
    expect(shieldByKey.get("my_new_unit_shielded_t1")).toBe("1");
    expect(shieldByKey.get("my_new_unit_shielded_t2")).toBe("1");
    expect(shieldByKey.get("my_new_unit_unshielded_t1")).toBe("0");
    expect(shieldByKey.get("my_new_unit_unshielded_t2")).toBe("0");

    const costByKey = new Map(mainTable.rows.map((row) => [cellValue(row, "unit"), cellValue(row, "cost")]));
    expect(costByKey.get("my_new_unit_shielded_t1")).toBe("500");
    expect(costByKey.get("my_new_unit_shielded_t2")).toBe("900");
    expect(costByKey.get("my_new_unit_unshielded_t1")).toBe("500");
    expect(costByKey.get("my_new_unit_unshielded_t2")).toBe("900");
  });

  it("supports {selfOriginal} so each table can keep its own naming", async () => {
    const result = await runClone(
      createPlan({ nameTemplate: "{selfOriginal}_clone{variant}" }),
    );

    expect(cellValue(getTable(result, "main_units_tables")!.rows[0], "unit")).toBe("emp_spearmen_clone");
    expect(cellValue(getTable(result, "land_units_tables")!.rows[0], "key")).toBe(
      "emp_spearmen_land_clone",
    );
    // The foreign key still resolves to the land_units row's own new name.
    expect(cellValue(getTable(result, "main_units_tables")!.rows[0], "land_unit")).toBe(
      "emp_spearmen_land_clone",
    );
  });

  it("applies the modders prefix once and does not double it", async () => {
    const prefixed = await runClone(
      createPlan({ useModdersPrefix: true, moddersPrefix: "abc_" }),
    );
    expect(cellValue(getTable(prefixed, "main_units_tables")!.rows[0], "unit")).toBe("abc_my_new_unit");

    const alreadyPrefixed = await runClone(
      createPlan({
        nameTemplate: "abc_my_new_unit{variant}",
        useModdersPrefix: true,
        moddersPrefix: "abc_",
      }),
    );
    expect(cellValue(getTable(alreadyPrefixed, "main_units_tables")!.rows[0], "unit")).toBe(
      "abc_my_new_unit",
    );
  });

  it("reports a collision when the new key already exists, without failing the clone", async () => {
    const result = await runClone(createPlan({ nameTemplate: "other_unit" }));

    expect(result.collisions).toContain("main_units_tables.unit already contains 'other_unit'");
    expect(getTable(result, "main_units_tables")!.rows).toHaveLength(1);
  });

  it("generates loc rows keyed on the clone and copies the original English text", async () => {
    const result = await runClone(
      createPlan({
        generateLoc: true,
        variantAxes: [
          {
            id: "shield",
            name: "shield",
            values: [
              { id: "a", suffix: "_shielded", overrides: [] },
              { id: "b", suffix: "_unshielded", overrides: [] },
            ],
          },
        ],
      }),
      { locTexts: { "main_units_onscreen_name_emp_spearmen": "Spearmen" } },
    );

    const locTable = getTable(result, "deepclone_loc")!;
    expect(locTable.outputPathPrefix).toBe("text\\db\\");
    expect(locTable.outputPathSuffix).toBe(".loc");
    // One localised field on main_units_tables, two variants.
    expect(locTable.rows).toHaveLength(2);

    const textByKey = new Map(
      locTable.rows.map((row) => [cellValue(row, "key"), cellValue(row, "text")]),
    );
    expect(textByKey.get("main_units_onscreen_name_my_new_unit_shielded")).toBe("Spearmen");
    expect(textByKey.get("main_units_onscreen_name_my_new_unit_unshielded")).toBe("Spearmen");
  });

  it("regenerates synthetic numeric ids instead of copying them from the source row", async () => {
    const tableFiles = createTableFiles();
    const rootFile = createTableFile("main_units_tables", [
      ["emp_spearmen", "emp_spearmen_land", "melee_infantry", "500"],
    ]);

    const result = await executeDeepClonePlan([rootFile], createPlan(), {
      loadTable: async (tableName) => (tableFiles[tableName] ? [tableFiles[tableName]] : []),
      getRows: (packedFile) =>
        chunkSchemaIntoRows(packedFile.schemaFields!, packedFile.tableSchema!) as AmendedSchemaField[][],
      referencedColumnsByTable: {},
      numericIdFieldByTable: { units_to_groupings_tables: "grouping" },
    });

    const groupingValue = cellValue(getTable(result, "units_to_groupings_tables")!.rows[0], "grouping");
    expect(groupingValue).not.toBe("empire_core");
    expect(Number.isNaN(Number(groupingValue))).toBe(false);
  });

  it("does not reach tables outside the clone plan when auto-follow is off", async () => {
    const result = await runClone(createPlan({ autoFollowReferences: false }));

    expect(getTable(result, "unit_permissions_tables")).toBeUndefined();
  });

  it("copies every row referencing a renamed key and re-points it at the new key", async () => {
    const result = await runClone(createPlan({ autoFollowReferences: true }));

    // Two rows referenced emp_spearmen; the third belongs to another unit and must be left alone.
    const permissions = getTable(result, "unit_permissions_tables")!;
    expect(permissions.rows).toHaveLength(2);
    expect(permissions.rows.map((row) => cellValue(row, "unit"))).toEqual([
      "my_new_unit",
      "my_new_unit",
    ]);
    expect(permissions.rows.map((row) => cellValue(row, "faction")).toSorted()).toEqual([
      "emp_empire",
      "emp_secessionists",
    ]);
  });

  it("follows keys renamed deeper in the plan, not just the root key", async () => {
    const result = await runClone(createPlan({ autoFollowReferences: true }));

    // land_units_tables.key is renamed by the tree, so its own junction rows are followed too.
    const abilities = getTable(result, "land_units_to_abilities_tables")!;
    expect(abilities.rows).toHaveLength(1);
    expect(cellValue(abilities.rows[0], "land_unit")).toBe("my_new_unit");
    expect(cellValue(abilities.rows[0], "ability")).toBe("wall_defence");
  });

  it("follows a table identified by a regenerated numeric id", async () => {
    const tableFiles = createTableFiles();
    const rootFile = createTableFile("main_units_tables", [
      ["emp_spearmen", "emp_spearmen_land", "melee_infantry", "500"],
    ]);

    // The reference is not part of this table's identity, but its key is a synthetic numeric id that
    // gets regenerated, so the copy cannot collide with the original.
    const result = await executeDeepClonePlan([rootFile], createPlan({ autoFollowReferences: true }), {
      loadTable: async (tableName) => (tableFiles[tableName] ? [tableFiles[tableName]] : []),
      getRows: (packedFile) =>
        chunkSchemaIntoRows(packedFile.schemaFields!, packedFile.tableSchema!) as AmendedSchemaField[][],
      referencedColumnsByTable: {},
      numericIdFieldByTable: { building_units_allowed_tables: "key" },
      reverseReferencesByTable,
      tablesToIgnore: ["ownership_junctions_tables"],
    });

    const allowed = getTable(result, "building_units_allowed_tables")!;
    expect(allowed.rows).toHaveLength(1);
    expect(cellValue(allowed.rows[0], "unit")).toBe("my_new_unit");
    expect(cellValue(allowed.rows[0], "building")).toBe("emp_barracks");
    expect(cellValue(allowed.rows[0], "key")).not.toBe("12345");
  });

  it("skips a table whose identity would be reused, and says so", async () => {
    // Same table, but without the numeric id registration there is nothing to make the copy unique.
    const result = await runClone(createPlan({ autoFollowReferences: true }));

    expect(getTable(result, "building_units_allowed_tables")).toBeUndefined();
    expect(result.warnings.some((warning) => warning.includes("building_units_allowed_tables"))).toBe(
      true,
    );
  });

  it("skips ignored ownership junction tables", async () => {
    const result = await runClone(createPlan({ autoFollowReferences: true }));

    expect(getTable(result, "ownership_junctions_tables")).toBeUndefined();
  });

  it("follows reverse references that sit unchecked in the tree", async () => {
    // The editor materializes every one-hop reference as an unchecked child, so almost every reverse
    // reference is present-but-unchecked. That is the default state, not a decision to skip it.
    const cloneTree = createCloneTree();
    const groupings = cloneTree.children.find((child) => child.table === "units_to_groupings_tables")!;
    groupings.selected = false;
    cloneTree.children.push({
      table: "unit_permissions_tables",
      keyColumn: "",
      linkColumn: "unit",
      direction: "reverse",
      selected: false,
      children: [],
    });

    const result = await runClone(createPlan({ cloneTree, autoFollowReferences: true }));

    expect(getTable(result, "units_to_groupings_tables")?.rows).toHaveLength(1);
    expect(getTable(result, "unit_permissions_tables")?.rows).toHaveLength(2);
  });

  it("never emits a row that would keep its original key and overwrite the vanilla row", async () => {
    const result = await runClone(createPlan({ autoFollowReferences: true }));

    const mainRows = getTable(result, "main_units_tables")!.rows;
    // emp_spearmen_veteran also points at emp_spearmen_land, so following the renamed land_units key
    // reaches it. Copying it would emit a second wh3-style duplicate under the original key, with a
    // rewritten land_unit - an override of the real unit rather than a clone.
    expect(mainRows.map((row) => cellValue(row, "unit"))).toEqual(["my_new_unit"]);
  });

  it("does not emit a checked reverse table twice when auto-follow also reaches it", async () => {
    const result = await runClone(createPlan({ autoFollowReferences: true }));

    // units_to_groupings_tables is checked in the tree, so the walk already collected its row.
    expect(getTable(result, "units_to_groupings_tables")!.rows).toHaveLength(1);
    // The root row is reachable again through land_units_tables.key; it must not be duplicated.
    expect(getTable(result, "main_units_tables")!.rows).toHaveLength(1);
  });

  it("produces one copy of each referencing row per variant", async () => {
    const result = await runClone(
      createPlan({
        autoFollowReferences: true,
        variantAxes: [
          {
            id: "shield",
            name: "shield",
            values: [
              { id: "a", suffix: "_shielded", overrides: [] },
              { id: "b", suffix: "_unshielded", overrides: [] },
            ],
          },
        ],
      }),
    );

    const permissions = getTable(result, "unit_permissions_tables")!;
    // 2 source rows x 2 variants.
    expect(permissions.rows).toHaveLength(4);
    expect(permissions.rows.map((row) => cellValue(row, "unit")).toSorted()).toEqual([
      "my_new_unit_shielded",
      "my_new_unit_shielded",
      "my_new_unit_unshielded",
      "my_new_unit_unshielded",
    ]);
  });

  it("refuses to run when the variant product exceeds the safety limit", async () => {
    const axes = Array.from({ length: 9 }, (_unused, axisIndex) => ({
      id: `axis_${axisIndex}`,
      name: `axis_${axisIndex}`,
      values: [
        { id: `${axisIndex}a`, suffix: `_${axisIndex}a`, overrides: [] },
        { id: `${axisIndex}b`, suffix: `_${axisIndex}b`, overrides: [] },
      ],
    }));

    await expect(runClone(createPlan({ variantAxes: axes }))).rejects.toThrow(/above the limit/);
  });
});
