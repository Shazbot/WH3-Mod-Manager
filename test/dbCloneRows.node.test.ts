import { describe, expect, it } from "vitest";

import { dbClonePackedFilesToBuildingsRows } from "../src/buildingsData/dbCloneRows";
import { LOC_TABLE } from "../src/buildingsData/edits";
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
});
