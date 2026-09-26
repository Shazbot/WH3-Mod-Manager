import { describe, expect, it } from "vitest";

import { VanillaPackIndexIdentity, buildVanillaPackIndex } from "../../src/vanillaPackIndex/format";
import {
  selectPackPathsToSearch,
  selectVanillaPacksHoldingFiles,
  selectVanillaPacksHoldingTables,
} from "../../src/vanillaPackIndex/select";

const identity: VanillaPackIndexIdentity = {
  game: "wh3",
  dataFolder: "C:\\games\\wh3\\data",
  manifestSize: 4242,
  manifestMtimeMs: 1700000000000,
  packCount: 4,
};

// Manifest order: data.pack lowest priority, ui_bl.pack highest.
const index = buildVanillaPackIndex(identity, [
  {
    packName: "data.pack",
    fileNames: [
      // A second file of the same family, which db.pack does not carry and so does not override.
      "db\\character_skills_tables\\data__legacy",
      "db\\effects_tables\\data__",
      "ui\\campaign ui\\skills\\shared_icon.png",
    ],
  },
  {
    packName: "db.pack",
    fileNames: [
      "db\\character_skills_tables\\data__",
      "db\\character_skill_nodes_tables\\data__",
      "db\\effects_tables\\data__",
      "db\\technologies_tables\\data__",
    ],
  },
  {
    packName: "ui.pack",
    fileNames: [
      "ui\\campaign ui\\skills\\emp_karl_franz.png",
      "ui\\campaign ui\\effect_bundles\\income.png",
      "ui\\campaign ui\\technologies\\emp_tech.png",
    ],
  },
  {
    packName: "ui_bl.pack",
    fileNames: ["ui\\campaign ui\\skills\\shared_icon.png"],
  },
]);

const dataPack = "C:\\games\\wh3\\data\\data.pack";
const dbPack = "C:\\games\\wh3\\data\\db.pack";
const uiPack = "C:\\games\\wh3\\data\\ui.pack";
const uiBlPack = "C:\\games\\wh3\\data\\ui_bl.pack";
const packPathsInLoadOrder = [dataPack, dbPack, uiPack, uiBlPack];

describe("selectVanillaPacksHoldingFiles", () => {
  it("names only the packs that carry one of the paths", () => {
    expect(
      selectVanillaPacksHoldingFiles(
        index,
        ["ui\\campaign ui\\skills\\emp_karl_franz.png", "ui\\campaign ui\\effect_bundles\\income.png"],
        packPathsInLoadOrder,
      ),
    ).toEqual([uiPack]);
  });

  it("picks the pack that wins a path several carry, not the first one to have it", () => {
    expect(
      selectVanillaPacksHoldingFiles(index, ["ui\\campaign ui\\skills\\shared_icon.png"], packPathsInLoadOrder),
    ).toEqual([uiBlPack]);
  });

  it("returns the packs in load order rather than the order the paths were asked in", () => {
    expect(
      selectVanillaPacksHoldingFiles(
        index,
        ["ui\\campaign ui\\skills\\shared_icon.png", "ui\\campaign ui\\technologies\\emp_tech.png"],
        packPathsInLoadOrder,
      ),
    ).toEqual([uiPack, uiBlPack]);
  });

  it("ignores a path no pack carries instead of failing the rest", () => {
    expect(
      selectVanillaPacksHoldingFiles(
        index,
        ["ui\\campaign ui\\skills\\does_not_exist.png", "ui\\campaign ui\\technologies\\emp_tech.png"],
        packPathsInLoadOrder,
      ),
    ).toEqual([uiPack]);
  });

  it("has nothing to say about paths that are not there at all", () => {
    expect(selectVanillaPacksHoldingFiles(index, ["ui\\nope\\nope.png"], packPathsInLoadOrder)).toEqual([]);
    expect(selectVanillaPacksHoldingFiles(index, [], packPathsInLoadOrder)).toEqual([]);
  });

  it("matches a pack path however it is spelled, not only with the platform's separator", () => {
    expect(
      selectVanillaPacksHoldingFiles(
        index,
        ["ui\\campaign ui\\technologies\\emp_tech.png"],
        ["/games/wh3/data/ui.pack"],
      ),
    ).toEqual(["/games/wh3/data/ui.pack"]);
  });
});

describe("selectVanillaPacksHoldingTables", () => {
  it("names every pack carrying a table under the prefix, not only the highest priority one", () => {
    // data.pack's own file of this family is not overridden, so its rows are loaded too and a caller
    // that read db.pack alone would merge a different set.
    expect(selectVanillaPacksHoldingTables(index, ["db\\character_skills_tables\\"], packPathsInLoadOrder)).toEqual([
      dataPack,
      dbPack,
    ]);
  });

  it("leaves out a pack whose every file under the prefix a later pack overrides", () => {
    // Both carry effects_tables\data__ and only db.pack's copy is loaded, so data.pack is no use here.
    expect(selectVanillaPacksHoldingTables(index, ["db\\effects_tables\\"], packPathsInLoadOrder)).toEqual([dbPack]);
  });

  it("unions the packs across prefixes, in load order and without repeats", () => {
    expect(
      selectVanillaPacksHoldingTables(
        index,
        ["db\\technologies_tables\\", "db\\character_skills_tables\\", "db\\character_skill_nodes_tables\\"],
        packPathsInLoadOrder,
      ),
    ).toEqual([dataPack, dbPack]);
  });

  it("leaves out packs that carry none of them", () => {
    expect(selectVanillaPacksHoldingTables(index, ["db\\technologies_tables\\"], packPathsInLoadOrder)).toEqual([
      dbPack,
    ]);
  });

  it("answers empty for a table family the index knows nothing about", () => {
    expect(selectVanillaPacksHoldingTables(index, ["db\\land_units_tables\\"], packPathsInLoadOrder)).toEqual([]);
  });

  it("does not pull in a table family whose name merely extends the one asked for", () => {
    // character_skill_nodes_tables must not answer for character_skill_node_links_tables.
    expect(
      selectVanillaPacksHoldingTables(index, ["db\\character_skill_node_links_tables\\"], packPathsInLoadOrder),
    ).toEqual([]);
  });
});

describe("selectPackPathsToSearch", () => {
  const alphaMod = "C:\\mods\\alpha.pack";
  const betaMod = "C:\\mods\\beta.pack";
  // How an asset walk orders its packs: mods first, then vanilla from highest priority down.
  const packPathsByPriority = [betaMod, alphaMod, uiBlPack, uiPack, dbPack, dataPack];
  const vanillaPackNames = new Set(["data.pack", "db.pack", "ui.pack", "ui_bl.pack"]);

  const search = (filePaths: string[], packPaths = packPathsByPriority) =>
    selectPackPathsToSearch(index, filePaths, packPaths, vanillaPackNames);

  it("keeps every mod and only the vanilla pack that wins the path", () => {
    expect(search(["ui\\campaign ui\\technologies\\emp_tech.png"])).toEqual([betaMod, alphaMod, uiPack]);
  });

  it("opens no vanilla pack at all for a path none of them carries", () => {
    // The case the narrowing exists for: a miss used to cost an index parse of every vanilla pack.
    expect(search(["ui\\campaign ui\\skills\\does_not_exist.png"])).toEqual([betaMod, alphaMod]);
  });

  it("keeps the pack that wins a path several carry, and not the ones it beat", () => {
    expect(search(["ui\\campaign ui\\skills\\shared_icon.png"])).toEqual([betaMod, alphaMod, uiBlPack]);
  });

  it("unions the packs across paths without disturbing the priority order", () => {
    expect(search(["ui\\campaign ui\\technologies\\emp_tech.png", "ui\\campaign ui\\skills\\shared_icon.png"])).toEqual(
      [betaMod, alphaMod, uiBlPack, uiPack],
    );
  });

  it("hands back the whole list when a winning pack is one the caller left out", () => {
    // ui_bl.pack wins shared_icon.png and is not being searched, so whether data.pack's own copy
    // would have answered instead is unknowable here - every pack has to stay in the walk.
    const withoutUiBl = [betaMod, alphaMod, uiPack, dbPack, dataPack];
    expect(search(["ui\\campaign ui\\skills\\shared_icon.png"], withoutUiBl)).toEqual(withoutUiBl);
  });

  it("still searches the mods when there is nothing to look up", () => {
    expect(search([])).toEqual([betaMod, alphaMod]);
  });

  it("matches pack paths spelled with either separator", () => {
    expect(
      search(
        ["ui\\campaign ui\\technologies\\emp_tech.png"],
        ["/mods/alpha.pack", "/games/wh3/data/ui.pack", "/games/wh3/data/db.pack"],
      ),
    ).toEqual(["/mods/alpha.pack", "/games/wh3/data/ui.pack"]);
  });

  it("looks a path up however it is spelled, since the index stores one spelling", () => {
    expect(search(["UI/campaign UI/technologies/EMP_tech.png"])).toEqual([betaMod, alphaMod, uiPack]);
  });
});
