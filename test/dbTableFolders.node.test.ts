import { describe, expect, it } from "vitest";

import {
  DB_TABLE_ROOTS,
  DEFAULT_DB_TABLE_ROOT,
  UNUSED_DB_TABLE_ROOT,
  getDBGroupName,
  getDBPackedFilePath,
  groupDBTablePaths,
  isLocPackedFilePath,
  parseDBGroupName,
  parseDBTablePath,
  parseLiveDBTablePath,
} from "../src/utility/packFileHelpers";

const LIVE = "db\\main_units_tables\\pj_my_table";
const SPARE = "unusedtables\\main_units_tables\\pj_my_tablex";

describe("parseDBTablePath", () => {
  it("splits a live table path", () => {
    expect(parseDBTablePath(LIVE)).toEqual({
      dbFolder: "db",
      dbName: "main_units_tables",
      dbSubname: "pj_my_table",
    });
  });

  it("splits a spare kept outside db\\", () => {
    expect(parseDBTablePath(SPARE)).toEqual({
      dbFolder: "unusedtables",
      dbName: "main_units_tables",
      dbSubname: "pj_my_tablex",
    });
  });

  it("keeps a nested subname whole, as the old regex did", () => {
    expect(parseDBTablePath("db\\main_units_tables\\sub\\folder\\data__")?.dbSubname).toBe(
      "sub\\folder\\data__",
    );
  });

  it("rejects anything that is not a table file", () => {
    expect(parseDBTablePath("script\\campaign\\mod.lua")).toBeUndefined();
    expect(parseDBTablePath("ui\\units\\icons\\emp.png")).toBeUndefined();
    // A table folder with no file under it.
    expect(parseDBTablePath("db\\main_units_tables")).toBeUndefined();
    expect(parseDBTablePath("db\\")).toBeUndefined();
  });

  it("rejects a root that is not on the list, which is the point of fixed roots", () => {
    expect(parseDBTablePath("backup\\main_units_tables\\old")).toBeUndefined();
    expect(parseDBTablePath("anymod\\weird_tables\\file")).toBeUndefined();
  });

  it("does not treat a folder merely starting with a root name as that root", () => {
    expect(parseDBTablePath("dbx\\main_units_tables\\x")).toBeUndefined();
  });
});

describe("parseLiveDBTablePath", () => {
  it("sees only what the game loads", () => {
    expect(parseLiveDBTablePath(LIVE)?.dbName).toBe("main_units_tables");
    // A spare is inert: not loaded by the game, so not a live table.
    expect(parseLiveDBTablePath(SPARE)).toBeUndefined();
  });
});

describe("getDBPackedFilePath", () => {
  const packPath = "C:\\game\\data\\my_mod.pack";

  it("round-trips both folders", () => {
    for (const path of [LIVE, SPARE]) {
      const parsed = parseDBTablePath(path);
      expect(getDBPackedFilePath({ packPath, ...parsed } as never)).toBe(path);
    }
  });

  it("treats a selection with no folder as the live table, so old state still resolves", () => {
    expect(
      getDBPackedFilePath({ packPath, dbName: "main_units_tables", dbSubname: "pj_my_table" } as never),
    ).toBe(LIVE);
  });
});

describe("getDBGroupName / parseDBGroupName", () => {
  it("leaves a live table's label bare, so nothing looks different from before", () => {
    expect(getDBGroupName(DEFAULT_DB_TABLE_ROOT, "main_units_tables")).toBe("main_units_tables");
  });

  it("shows the folder for a spare", () => {
    expect(getDBGroupName("unusedtables", "main_units_tables")).toBe("unusedtables\\main_units_tables");
  });

  it("round-trips", () => {
    for (const [folder, name] of [
      [DEFAULT_DB_TABLE_ROOT, "main_units_tables"],
      ["unusedtables", "land_units_tables"],
    ]) {
      expect(parseDBGroupName(getDBGroupName(folder, name))).toEqual({ dbFolder: folder, dbName: name });
    }
  });
});

describe("groupDBTablePaths", () => {
  it("keeps a spare and the live table in separate groups", () => {
    const groups = groupDBTablePaths([LIVE, SPARE, "script\\mod.lua"]);

    // The bug this guards: grouping by table name alone merged these into one entry, and editing
    // the spare then wrote over the live table.
    expect([...groups.keys()].toSorted()).toEqual([
      "main_units_tables",
      "unusedtables\\main_units_tables",
    ]);
    expect([...(groups.get("main_units_tables") ?? [])]).toEqual(["pj_my_table"]);
    expect([...(groups.get("unusedtables\\main_units_tables") ?? [])]).toEqual(["pj_my_tablex"]);
  });

  it("still gathers several subnames of one table into one group", () => {
    const groups = groupDBTablePaths(["db\\land_units_tables\\a", "db\\land_units_tables\\b"]);

    expect(groups.size).toBe(1);
    expect([...(groups.get("land_units_tables") ?? [])].toSorted()).toEqual(["a", "b"]);
  });

  it("ignores non-table files", () => {
    expect(groupDBTablePaths(["script\\mod.lua", "ui\\x.png"]).size).toBe(0);
  });
});

describe("viewer tab identity", () => {
  const packPath = "C:\\game\\data\\my_mod.pack";
  // Mirrors buildDbTabCandidate in ModsViewer: without the folder in the key the two share a tab.
  const fileKey = (path: string) =>
    `db|${packPath}|${getDBPackedFilePath({ packPath, ...parseDBTablePath(path) } as never)}`;

  it("gives the spare and the live table different tabs", () => {
    expect(fileKey(LIVE)).not.toBe(fileKey(SPARE));
  });
});

describe("creating a table outside db\\", () => {
  it("puts the unused root on the recognised list, or a created table would be invisible", () => {
    // The create-table modal writes to UNUSED_DB_TABLE_ROOT; if it is not also a recognised root the
    // new table saves fine and then never shows up in the tree.
    expect(DB_TABLE_ROOTS).toContain(UNUSED_DB_TABLE_ROOT);
    expect(DB_TABLE_ROOTS).toContain(DEFAULT_DB_TABLE_ROOT);
  });

  it("recognises the path the modal builds, for either choice", () => {
    for (const dbFolder of [DEFAULT_DB_TABLE_ROOT, UNUSED_DB_TABLE_ROOT]) {
      const created = `${dbFolder}\\main_units_tables\\pj_new`;

      expect(parseDBTablePath(created)).toEqual({
        dbFolder,
        dbName: "main_units_tables",
        dbSubname: "pj_new",
      });
    }
  });

  it("lets a spare sit alongside a live table of the same name without clashing", () => {
    const live = `${DEFAULT_DB_TABLE_ROOT}\\main_units_tables\\pj_new`;
    const spare = `${UNUSED_DB_TABLE_ROOT}\\main_units_tables\\pj_new`;

    // Same table, same suffix - the modal's "already exists" check compares full paths, so both can
    // be created, and the tree keeps them apart.
    expect(live).not.toBe(spare);
    expect(groupDBTablePaths([live, spare]).size).toBe(2);
  });
});

describe("loc files as tables", () => {
  const LOC = "text\\db\\my_mod.loc";

  it("reads a loc's own folder as its table folder, so it needs no special casing", () => {
    expect(parseDBTablePath(LOC)).toEqual({
      dbFolder: "text",
      dbName: "db",
      dbSubname: "my_mod.loc",
    });
  });

  it("round-trips back to the same path", () => {
    const packPath = "C:\\game\\data\\my_mod.pack";
    expect(getDBPackedFilePath({ packPath, ...parseDBTablePath(LOC) } as never)).toBe(LOC);
  });

  it("handles a loc only one folder deep, where the folder part is empty", () => {
    const shallow = "text\\my_mod.loc";
    const parsed = parseDBTablePath(shallow);

    expect(parsed).toEqual({ dbFolder: "", dbName: "text", dbSubname: "my_mod.loc" });
    // An empty folder must not be mistaken for "no folder given", which would mean db\.
    expect(getDBPackedFilePath({ packPath: "p", ...parsed } as never)).toBe(shallow);
  });

  it("leaves a loc at the pack root alone rather than inventing a folder", () => {
    expect(parseDBTablePath("my_mod.loc")).toBeUndefined();
  });

  it("groups locs by their folder, apart from the db tables", () => {
    const groups = groupDBTablePaths([LIVE, LOC]);

    expect([...groups.keys()].toSorted()).toEqual(["main_units_tables", "text\\db"]);
  });

  it("still does not count as a table the game loads, so locs are not collision-checked here", () => {
    expect(parseLiveDBTablePath(LOC)).toBeUndefined();
  });

  it("recognises the extension whatever the casing", () => {
    expect(isLocPackedFilePath("text\\db\\x.LOC")).toBe(true);
    expect(isLocPackedFilePath("text\\db\\x.locx")).toBe(false);
    expect(isLocPackedFilePath("db\\main_units_tables\\x")).toBe(false);
  });
});
