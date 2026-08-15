import { describe, expect, it } from "vitest";

import { buildFactionOptions, firstRegionForCampaign } from "../src/components/buildings/BuildingsFilters";
import type { BuildingsCatalog, BuildingsFactionOption } from "../src/buildingsData/types";

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

    expect(options.map((option) => option.value)).toEqual([
      "unique",
      "ordinary_a",
      "ordinary_b",
      "rebel",
      "quest",
    ]);
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
});
