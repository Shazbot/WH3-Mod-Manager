import { describe, expect, it } from "vitest";

import { buildVanillaPackIndex } from "../src/vanillaPackIndex/format";
import {
  getVanillaPackNamesForDBTable,
  isDBCloneTableIgnored,
  toDBTablePrefix,
} from "../src/utility/dbCloneTableRouting";

const index = buildVanillaPackIndex(
  {
    game: "wh3",
    dataFolder: "C:\\game\\data",
    manifestSize: 1,
    manifestMtimeMs: 1,
    packCount: 3,
  },
  [
    {
      packName: "db.pack",
      fileNames: ["db\\main_units_tables\\data__", "db\\shared_tables\\data__"],
    },
    {
      packName: "dlc.pack",
      fileNames: ["db\\dlc_units_tables\\data__", "db\\main_units_tables_extra\\data__", "db\\shared_tables\\data__"],
    },
    {
      packName: "local.pack",
      fileNames: ["text\\db\\local.loc"],
    },
  ],
);

describe("DB clone vanilla table routing", () => {
  it("ignores every start_pos table because DB Clone cannot create rows in them", () => {
    expect(isDBCloneTableIgnored("start_pos_regions_tables")).toBe(true);
    expect(isDBCloneTableIgnored("start_pos_region_slot_templates_tables")).toBe(true);
    expect(isDBCloneTableIgnored("db\\start_pos_settlements_tables\\data__")).toBe(true);
    expect(isDBCloneTableIgnored("start_position_tables")).toBe(false);
    expect(isDBCloneTableIgnored("main_units_tables")).toBe(false);
  });

  it("normalizes bare table names without matching longer table names", () => {
    expect(toDBTablePrefix("main_units_tables")).toBe("db\\main_units_tables\\");
    expect(toDBTablePrefix("db\\main_units_tables")).toBe("db\\main_units_tables\\");
  });

  it("opens only the vanilla pack that wins files for the requested table", () => {
    expect(getVanillaPackNamesForDBTable(index, "main_units_tables")).toEqual(["db.pack"]);
    expect(getVanillaPackNamesForDBTable(index, "dlc_units_tables")).toEqual(["dlc.pack"]);
    expect(getVanillaPackNamesForDBTable(index, "shared_tables")).toEqual(["dlc.pack"]);
  });

  it("returns no packs when the index proves the table is absent", () => {
    expect(getVanillaPackNamesForDBTable(index, "missing_tables")).toEqual([]);
  });
});
