import { describe, expect, it } from "vitest";

import { collectVanillaDbTableRowsInPackOrder } from "../../src/vanillaDbCache/tableRows";

describe("typed Buildings source rows", () => {
  it("keeps physical table order, vanilla pack order, and each row's source path", () => {
    const dbPackPath = "K:/game/data/db.pack";
    const overridePackPath = "K:/game/data/extra_vanilla.pack";
    const prefix = "db\\building_levels_tables\\";
    const rows = collectVanillaDbTableRowsInPackOrder(
      "building_levels_tables",
      [dbPackPath, overridePackPath],
      "k:/GAME/data/DB.PACK",
      {
        tablePathsByPrefix: new Map([[prefix, ["db\\building_levels_tables\\a", "db\\building_levels_tables\\b"]]]),
        rowsByPackedFilePath: new Map([
          ["db\\building_levels_tables\\a", [{ level_name: "first" }]],
          ["db\\building_levels_tables\\b", [{ level_name: "second" }]],
        ]),
      },
      new Map([[overridePackPath, [{ level_name: "override" }]]]),
    );

    expect(rows).toEqual([
      { row: { level_name: "first" }, packPath: dbPackPath },
      { row: { level_name: "second" }, packPath: dbPackPath },
      { row: { level_name: "override" }, packPath: overridePackPath },
    ]);
  });

  it("keeps non-database pack order when no typed cache contribution is available", () => {
    const firstPackPath = "/game/data/first.pack";
    const secondPackPath = "/game/data/second.pack";
    expect(
      collectVanillaDbTableRowsInPackOrder(
        "building_levels_tables",
        [secondPackPath, firstPackPath],
        undefined,
        undefined,
        new Map([
          [firstPackPath, [{ level_name: "first" }]],
          [secondPackPath, [{ level_name: "second" }]],
        ]),
      ),
    ).toEqual([
      { row: { level_name: "second" }, packPath: secondPackPath },
      { row: { level_name: "first" }, packPath: firstPackPath },
    ]);
  });
});
