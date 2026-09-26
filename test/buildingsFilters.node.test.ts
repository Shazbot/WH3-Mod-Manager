import { describe, expect, it } from "vitest";

import {
  boardModeQueryPatch,
  buildCultureOptions,
  buildFactionOptions,
  firstRegionForCampaign,
  foreignSlotTypeQueryPatch,
  sortLocalizedOptions,
} from "../src/components/buildings/BuildingsFilters";
import type {
  BuildingsCatalog,
  BuildingsFactionOption,
  BuildingsOption,
  BuildingsForeignSlotTypeOption,
  BuildingsRegionQuery,
} from "../src/buildingsData/types";

const catalog = {
  regions: [
    { key: "shared", localizedName: "Shared", campaigns: [] },
    { key: "chaos", localizedName: "Chaos", campaigns: ["chaos_campaign"] },
  ],
} as BuildingsCatalog;

describe("firstRegionForCampaign", () => {
  it("selects a valid region immediately when the campaign changes", () => {
    expect(firstRegionForCampaign(catalog, "chaos_campaign")).toBe("chaos");
  });

  it("returns an empty key when the campaign has no regions", () => {
    const scoped = {
      ...catalog,
      regions: [{ key: "chaos", localizedName: "Chaos", campaigns: ["chaos_campaign"] }],
    } as BuildingsCatalog;
    expect(firstRegionForCampaign(scoped, "other_campaign")).toBe("");
  });
});

describe("buildFactionOptions", () => {
  const faction = (
    key: string,
    localizedName: string,
    militaryGroup: string,
    flags: Partial<Pick<BuildingsFactionOption, "isQuestFaction" | "isRebel">> = {},
  ): BuildingsFactionOption => ({
    key,
    localizedName,
    militaryGroup,
    culture: "culture",
    subculture: "subculture",
    isQuestFaction: false,
    isRebel: false,
    ...flags,
  });

  it("puts unique military groups first, rebels next to last, and quests last", () => {
    const options = buildFactionOptions([
      faction("ordinary_b", "Beta", "shared"),
      faction("quest", "A Quest", "one_off", { isQuestFaction: true }),
      faction("unique", "Zulu", "one_off"),
      faction("rebel", "A Rebel", "one_off", { isRebel: true }),
      faction("ordinary_a", "Alpha", "shared"),
    ]);

    expect(options.map((option) => option.value)).toEqual(["unique", "ordinary_a", "ordinary_b", "rebel", "quest"]);
    expect(options.find((option) => option.value === "rebel")?.tone).toBe("rebel");
    expect(options.find((option) => option.value === "quest")?.tone).toBe("quest");
  });

  it("ignores quest and rebel factions when deciding whether a military group is unique", () => {
    const options = buildFactionOptions([
      faction("ordinary_shared", "Alpha", "shared"),
      faction("ordinary_shared_b", "Beta", "shared"),
      faction("ordinary_unique", "Zulu", "special"),
      faction("quest", "Quest", "special", { isQuestFaction: true }),
      faction("rebel", "Rebel", "special", { isRebel: true }),
    ]);

    expect(options.map((option) => option.value)).toEqual([
      "ordinary_unique",
      "ordinary_shared",
      "ordinary_shared_b",
      "rebel",
      "quest",
    ]);
  });

  it("puts factions without localized names after localized factions", () => {
    const options = buildFactionOptions([
      faction("missing_z", "missing_z", "shared"),
      faction("localized", "Localized faction", "shared"),
      faction("missing_a", "missing_a", "shared"),
    ]);

    expect(options.map((option) => option.value)).toEqual(["localized", "missing_a", "missing_z"]);
  });
});

describe("sortLocalizedOptions", () => {
  it("sorts localized values first and unresolved keys last", () => {
    expect(
      sortLocalizedOptions([
        { key: "missing_z", localizedName: "missing_z" },
        { key: "localized_b", localizedName: "Beta" },
        { key: "missing_a", localizedName: "missing_a" },
        { key: "localized_a", localizedName: "Alpha" },
      ]).map((option) => option.key),
    ).toEqual(["localized_a", "localized_b", "missing_a", "missing_z"]);
  });
});

describe("foreignSlotTypeQueryPatch", () => {
  const cult: BuildingsForeignSlotTypeOption = {
    key: "CULT",
    localizedName: "CULT",
    slotTemplates: ["tmpl_cult"],
    cultures: ["kho"],
    subcultures: ["kho_sub"],
    factions: ["kho_faction"],
  };
  const query: BuildingsRegionQuery = {
    campaign: "camp",
    region: "region",
    settlementType: "capital",
    culture: "kho",
    subculture: "kho_sub",
    faction: "kho_faction",
  };

  it("keeps filters the type's own buildings name", () => {
    expect(foreignSlotTypeQueryPatch(cult, query)).toEqual({
      foreignSlotType: "CULT",
      settlementType: undefined,
      culture: "kho",
      subculture: "kho_sub",
      faction: "kho_faction",
    });
  });

  it("drops a subculture and faction the type never mentions", () => {
    expect(foreignSlotTypeQueryPatch(cult, { ...query, subculture: "emp_sub", faction: "emp_faction" })).toMatchObject({
      culture: "kho",
      subculture: undefined,
      faction: undefined,
    });
  });

  it("clears everything hanging off a culture the type never mentions", () => {
    expect(foreignSlotTypeQueryPatch(cult, { ...query, culture: "emp" })).toMatchObject({
      culture: undefined,
      subculture: undefined,
      faction: undefined,
    });
  });

  it("keeps the filters when the type is cleared", () => {
    expect(foreignSlotTypeQueryPatch(undefined, query)).toEqual({
      foreignSlotType: undefined,
      settlementType: undefined,
      culture: "kho",
      subculture: "kho_sub",
      faction: "kho_faction",
    });
  });

  it("uses the mapped culture when selecting a known foreign slot type", () => {
    const underEmpire: BuildingsForeignSlotTypeOption = {
      ...cult,
      key: "UNDEREMPIRE",
      cultures: ["wh2_main_skv_skaven"],
    };

    expect(foreignSlotTypeQueryPatch(underEmpire, query)).toEqual({
      foreignSlotType: "UNDEREMPIRE",
      settlementType: undefined,
      culture: "wh2_main_skv_skaven",
      subculture: undefined,
      faction: undefined,
    });
  });
});

describe("boardModeQueryPatch", () => {
  const slotType = (key: string, cultures: string[] = []): BuildingsForeignSlotTypeOption => ({
    key,
    localizedName: key,
    slotTemplates: [],
    cultures,
    subcultures: [],
    factions: [],
  });

  const modeCatalog = {
    ...catalog,
    foreignSlotTypes: [slotType("CULT", ["kho"]), slotType("UNDEREMPIRE", ["wh2_main_skv_skaven"])],
  } as BuildingsCatalog;

  const query: BuildingsRegionQuery = {
    mode: "normal",
    campaign: "chaos_campaign",
    region: "chaos",
    settlementType: "capital",
    culture: "kho",
  };

  it("lands undercity on the under-empire and its culture", () => {
    expect(boardModeQueryPatch("undercity", query, modeCatalog)).toEqual({
      mode: "undercity",
      foreignSlotType: "UNDEREMPIRE",
      settlementType: undefined,
      culture: "wh2_main_skv_skaven",
      subculture: undefined,
      faction: undefined,
    });
  });

  it("keeps a type already selected when re-entering undercity", () => {
    expect(boardModeQueryPatch("undercity", { ...query, foreignSlotType: "CULT" }, modeCatalog)).toMatchObject({
      mode: "undercity",
      foreignSlotType: "CULT",
    });
  });

  it("falls back to the first type when the install has no under-empire", () => {
    const scoped = { ...modeCatalog, foreignSlotTypes: [slotType("CULT", ["kho"])] } as BuildingsCatalog;
    expect(boardModeQueryPatch("undercity", query, scoped)).toMatchObject({
      mode: "undercity",
      foreignSlotType: "CULT",
    });
  });

  it("clears the filters horde does not draw and leaves the culture alone", () => {
    expect(boardModeQueryPatch("horde", { ...query, foreignSlotType: "CULT" }, modeCatalog)).toEqual({
      mode: "horde",
      foreignSlotType: undefined,
      settlementType: undefined,
    });
  });

  it("restores a region when returning to normal without one", () => {
    expect(boardModeQueryPatch("normal", { ...query, mode: "horde", region: "" }, modeCatalog)).toEqual({
      mode: "normal",
      foreignSlotType: undefined,
      settlementType: undefined,
      region: "chaos",
    });
  });

  it("keeps the region it left when returning to normal", () => {
    expect(
      boardModeQueryPatch("normal", { ...query, mode: "undercity", foreignSlotType: "CULT" }, modeCatalog),
    ).toEqual({ mode: "normal", foreignSlotType: undefined, settlementType: undefined });
  });
});

describe("buildCultureOptions", () => {
  const cultures: BuildingsOption[] = [
    { key: "kho", localizedName: "Khorne" },
    { key: "emp", localizedName: "Empire" },
    { key: "wh_unlocalized", localizedName: "wh_unlocalized" },
  ];

  it("keeps the localized ordering when the board draws something for every culture", () => {
    expect(buildCultureOptions(cultures, new Set()).map((option) => option.value)).toEqual([
      "emp",
      "kho",
      "wh_unlocalized",
    ]);
  });

  it("sorts the cultures with no chains below the rest and tones them", () => {
    const options = buildCultureOptions(cultures, new Set(["emp"]));
    expect(options.map((option) => option.value)).toEqual(["kho", "wh_unlocalized", "emp"]);
    expect(options.map((option) => option.tone)).toEqual([undefined, undefined, "empty"]);
  });

  it("still orders the empty group among itself", () => {
    expect(buildCultureOptions(cultures, new Set(["kho", "emp"])).map((option) => option.value)).toEqual([
      "wh_unlocalized",
      "emp",
      "kho",
    ]);
  });

  it("keeps every culture selectable", () => {
    expect(buildCultureOptions(cultures, new Set(["kho", "emp", "wh_unlocalized"]))).toHaveLength(3);
  });
});
