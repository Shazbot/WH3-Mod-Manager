import { describe, expect, it } from "vitest";

import {
  createRootTreeNode,
  expandTreeNode,
  findTemplatesMissingVariant,
  getReferenceOptions,
  getSelectedCloneTables,
  getTableKeyColumn,
  getReverseReferenceIndex,
} from "../../src/nodeGraph/deepCloneTree";
import type { DBField, DBVersion } from "../../src/packFileTypes";

const createField = (name: string, options: { isKey?: boolean; reference?: [string, string] } = {}): DBField =>
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

const DBNameToDBVersions: Record<string, DBVersion[]> = {
  main_units_tables: [
    {
      version: 1,
      fields: [
        createField("unit", { isKey: true }),
        createField("land_unit", { reference: ["land_units_tables", "key"] }),
        createField("caste", { reference: ["unit_castes_tables", "caste"] }),
      ],
    },
  ],
  land_units_tables: [{ version: 1, fields: [createField("key", { isKey: true }), createField("shield")] }],
  unit_castes_tables: [{ version: 1, fields: [createField("caste", { isKey: true })] }],
  units_to_groupings_tables: [
    {
      version: 1,
      fields: [createField("unit", { reference: ["main_units_tables", "unit"] }), createField("grouping")],
    },
  ],
  main_unit_ownership_content_pack_junctions_tables: [
    {
      version: 1,
      fields: [createField("unit", { reference: ["main_units_tables", "unit"] })],
    },
  ],
};

describe("deepCloneTree", () => {
  it("inverts the schema into a reverse reference index", () => {
    const index = getReverseReferenceIndex(DBNameToDBVersions);

    expect(index.main_units_tables.unit).toEqual([
      ["units_to_groupings_tables", "unit"],
      ["main_unit_ownership_content_pack_junctions_tables", "unit"],
    ]);
    expect(index.land_units_tables.key).toEqual([["main_units_tables", "land_unit"]]);
  });

  it("offers both forward and reverse hops, skipping the ignored ownership junctions", () => {
    const options = getReferenceOptions(DBNameToDBVersions, "main_units_tables");

    expect(options).toEqual([
      { table: "land_units_tables", keyColumn: "key", linkColumn: "land_unit", direction: "forward" },
      { table: "unit_castes_tables", keyColumn: "caste", linkColumn: "caste", direction: "forward" },
      // Keyless junction table: nothing references it and it has no is_key field, so there is no
      // key of its own to rename — only its foreign key back at main_units_tables gets rewritten.
      { table: "units_to_groupings_tables", keyColumn: "", linkColumn: "unit", direction: "reverse" },
    ]);
    expect(options.some((option) => option.table === "main_unit_ownership_content_pack_junctions_tables")).toBe(false);
  });

  it("picks the referenced column as the key when there is exactly one", () => {
    const index = getReverseReferenceIndex(DBNameToDBVersions);

    expect(getTableKeyColumn(DBNameToDBVersions, "land_units_tables", index)).toBe("key");
    expect(getTableKeyColumn(DBNameToDBVersions, "main_units_tables", index)).toBe("unit");
    // Nothing references this junction table, so it falls back to its is_key field (it has none).
    expect(getTableKeyColumn(DBNameToDBVersions, "units_to_groupings_tables", index)).toBe("");
  });

  it("does not walk back into a table already on the path", () => {
    const root = expandTreeNode(DBNameToDBVersions, createRootTreeNode(DBNameToDBVersions, "main_units_tables"));
    const landNode = root.children.find((child) => child.table === "land_units_tables")!;

    const expandedLand = expandTreeNode(DBNameToDBVersions, landNode, ["main_units_tables"]);
    expect(expandedLand.children.some((child) => child.table === "main_units_tables")).toBe(false);
  });

  it("preserves an existing child's selection when a node is re-expanded", () => {
    const root = expandTreeNode(DBNameToDBVersions, createRootTreeNode(DBNameToDBVersions, "main_units_tables"));
    root.children[0].selected = true;
    root.children[0].nameTemplate = "custom{variant}";

    const reExpanded = expandTreeNode(DBNameToDBVersions, root);
    expect(reExpanded.children[0].selected).toBe(true);
    expect(reExpanded.children[0].nameTemplate).toBe("custom{variant}");
  });

  it("flags a template that never substitutes the variant suffix", () => {
    const root = expandTreeNode(DBNameToDBVersions, createRootTreeNode(DBNameToDBVersions, "main_units_tables"));
    root.children.find((child) => child.table === "land_units_tables")!.selected = true;

    expect(findTemplatesMissingVariant(root, "my_new_unit")).toEqual(["main_units_tables", "land_units_tables"]);
    expect(findTemplatesMissingVariant(root, "my_new_unit{variant}")).toEqual([]);
  });

  it("flags only the table whose own template override drops the suffix", () => {
    const root = expandTreeNode(DBNameToDBVersions, createRootTreeNode(DBNameToDBVersions, "main_units_tables"));
    const land = root.children.find((child) => child.table === "land_units_tables")!;
    land.selected = true;
    land.nameTemplate = "fixed_land_unit";

    expect(findTemplatesMissingVariant(root, "{original}{variant}")).toEqual(["land_units_tables"]);
  });

  it("ignores unchecked branches and keyless junction nodes", () => {
    const root = expandTreeNode(DBNameToDBVersions, createRootTreeNode(DBNameToDBVersions, "main_units_tables"));
    // Left unchecked, so it is never cloned and its template is irrelevant.
    root.children.find((child) => child.table === "land_units_tables")!.selected = false;
    const junction = root.children.find((child) => child.table === "units_to_groupings_tables")!;
    junction.selected = true;
    junction.keyColumn = "";

    expect(findTemplatesMissingVariant(root, "my_new_unit")).toEqual(["main_units_tables"]);
  });

  it("lists only the tables the plan will actually clone", () => {
    const root = expandTreeNode(DBNameToDBVersions, createRootTreeNode(DBNameToDBVersions, "main_units_tables"));
    root.children.find((child) => child.table === "land_units_tables")!.selected = true;

    expect(getSelectedCloneTables(root)).toEqual(["main_units_tables", "land_units_tables"]);
  });
});
