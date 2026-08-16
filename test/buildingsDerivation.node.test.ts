import { describe, expect, it } from "vitest";

import { buildBuildingsData } from "../src/buildingsData/data";
import { expandChainSet, NO_SET_KEY, resolveRegionBuildings, toRoman } from "../src/buildingsData/derive";
import type { BuildingsRegionQuery, BuildingsTableRows, BuiltBuildingsData } from "../src/buildingsData/types";

const noLoc = () => undefined;

const CAMPAIGN = "camp";
const REGION = "region_x";

/** A minimal but complete world: one superchain, three chains, and levels for each. */
const baseTables = (): BuildingsTableRows => ({
  building_chains_tables: [
    { key: "chain_a", building_superchain: "super_a", optional_sort_order: "1" },
    { key: "chain_b", building_superchain: "super_a", optional_sort_order: "2" },
    { key: "chain_c", building_superchain: "super_c", optional_sort_order: "3" },
  ],
  building_levels_tables: [
    { level_name: "a_1", chain: "chain_a", level: "0", visible_in_ui: "true" },
    { level_name: "a_2", chain: "chain_a", level: "1", visible_in_ui: "true" },
    { level_name: "b_1", chain: "chain_b", level: "0", visible_in_ui: "true" },
    { level_name: "c_1", chain: "chain_c", level: "0", visible_in_ui: "true" },
  ],
  building_culture_variants_tables: [
    { building: "a_1", culture: "emp", subculture: "", faction: "", disables: "false" },
    { building: "a_2", culture: "emp", subculture: "", faction: "", disables: "false" },
    { building: "b_1", culture: "emp", subculture: "", faction: "", disables: "false" },
    { building: "c_1", culture: "emp", subculture: "", faction: "", disables: "false" },
  ],
  building_sets_tables: [
    { key: "set_one", sort_order: "1", colour_r: "10", colour_g: "20", colour_b: "30", show_in_ui: "true" },
    { key: "set_two", sort_order: "2", colour_r: "40", colour_g: "50", colour_b: "60", show_in_ui: "true" },
  ],
  building_set_to_building_junctions_tables: [
    { building_chain: "chain_a", building_level: "", building_set: "set_one", exclude: "false" },
    { building_chain: "chain_b", building_level: "", building_set: "set_one", exclude: "false" },
    { building_chain: "chain_c", building_level: "", building_set: "set_two", exclude: "false" },
  ],
  cultures_tables: [{ key: "emp" }, { key: "dwf" }],
  cultures_subcultures_tables: [
    { subculture: "emp_sub", culture: "emp" },
    { subculture: "dwf_sub", culture: "dwf" },
  ],
  factions_tables: [
    { key: "emp_faction", subculture: "emp_sub" },
    { key: "dwf_faction", subculture: "dwf_sub" },
  ],
  settlement_types_tables: [{ key: "capital" }, { key: "minor" }],
  regions_tables: [{ key: REGION }],
  campaigns_tables: [{ campaign_name: CAMPAIGN }],
  // Secondary, because that is where ordinary buildings live and their level 0 is a real tier. The
  // ruin tests override this with a primary slot.
  start_pos_region_slot_templates_tables: [
    { campaign: CAMPAIGN, id: "1", region: REGION, slot_template: "tmpl_main", slot_type: "secondary" },
  ],
  slot_template_permitted_building_chains_tables: [
    { slot_template: "tmpl_main", chain: "chain_a", chain_set: "", super_chain: "", remove: "false" },
    { slot_template: "tmpl_main", chain: "chain_b", chain_set: "", super_chain: "", remove: "false" },
    { slot_template: "tmpl_main", chain: "chain_c", chain_set: "", super_chain: "", remove: "false" },
  ],
});

const build = (patch: Partial<BuildingsTableRows> = {}): BuiltBuildingsData =>
  buildBuildingsData({ ...baseTables(), ...patch }, noLoc);

const query = (overrides: Partial<BuildingsRegionQuery> = {}): BuildingsRegionQuery => ({
  campaign: CAMPAIGN,
  region: REGION,
  culture: "emp",
  ...overrides,
});

const chainKeysIn = (view: ReturnType<typeof resolveRegionBuildings>) =>
  view.bands.flatMap((band) => band.columns.map((column) => column.chainKey)).sort();

const levelKeysIn = (view: ReturnType<typeof resolveRegionBuildings>) =>
  view.bands.flatMap((band) => band.columns.flatMap((column) => column.tiles.map((tile) => tile.levelKey))).sort();

describe("toRoman", () => {
  it("renders the tiers the panel shows", () => {
    expect([1, 2, 3, 4, 5, 9].map(toRoman)).toEqual(["I", "II", "III", "IV", "V", "IX"]);
  });

  it("returns empty for anything below one", () => {
    expect(toRoman(0)).toBe("");
    expect(toRoman(Number.NaN)).toBe("");
  });
});

describe("expandChainSet", () => {
  it("inherits the parent set's chains and lets the child remove them", () => {
    const data = build({
      building_chain_sets_tables: [{ key: "parent" }, { key: "child", parent_set: "parent" }],
      building_chain_set_items_tables: [
        { set: "parent", chain: "chain_a", super_chain: "", remove: "false" },
        { set: "parent", chain: "chain_b", super_chain: "", remove: "false" },
        { set: "child", chain: "chain_b", super_chain: "", remove: "true" },
        { set: "child", chain: "chain_c", super_chain: "", remove: "false" },
      ],
    });
    expect([...expandChainSet(data, "child")].sort()).toEqual(["chain_a", "chain_c"]);
    expect([...expandChainSet(data, "parent")].sort()).toEqual(["chain_a", "chain_b"]);
  });

  it("expands a super_chain item into every chain under it", () => {
    const data = build({
      building_chain_sets_tables: [{ key: "set" }],
      building_chain_set_items_tables: [{ set: "set", chain: "", super_chain: "super_a", remove: "false" }],
    });
    expect([...expandChainSet(data, "set")].sort()).toEqual(["chain_a", "chain_b"]);
  });

  it("survives a set that lists itself as its own parent", () => {
    const data = build({
      building_chain_sets_tables: [{ key: "loop", parent_set: "loop" }],
      building_chain_set_items_tables: [{ set: "loop", chain: "chain_a", super_chain: "", remove: "false" }],
    });
    expect([...expandChainSet(data, "loop")]).toEqual(["chain_a"]);
  });
});

describe("resolveRegionBuildings: chains from slot templates", () => {
  it("takes chains only from the selected campaign and region", () => {
    const data = build({
      start_pos_region_slot_templates_tables: [
        { campaign: CAMPAIGN, id: "1", region: REGION, slot_template: "tmpl_main", slot_type: "primary" },
        { campaign: "other_camp", id: "2", region: REGION, slot_template: "tmpl_other", slot_type: "primary" },
      ],
      slot_template_permitted_building_chains_tables: [
        { slot_template: "tmpl_main", chain: "chain_a", chain_set: "", super_chain: "", remove: "false" },
        { slot_template: "tmpl_other", chain: "chain_c", chain_set: "", super_chain: "", remove: "false" },
      ],
    });
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toEqual(["chain_a"]);
  });

  it("expands a super_chain permission", () => {
    const data = build({
      slot_template_permitted_building_chains_tables: [
        { slot_template: "tmpl_main", chain: "", chain_set: "", super_chain: "super_a", remove: "false" },
      ],
    });
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toEqual(["chain_a", "chain_b"]);
  });

  it("expands a chain_set permission through its parent set", () => {
    const data = build({
      building_chain_sets_tables: [{ key: "parent" }, { key: "child", parent_set: "parent" }],
      building_chain_set_items_tables: [
        { set: "parent", chain: "chain_a", super_chain: "", remove: "false" },
        { set: "child", chain: "chain_c", super_chain: "", remove: "false" },
      ],
      slot_template_permitted_building_chains_tables: [
        { slot_template: "tmpl_main", chain: "", chain_set: "child", super_chain: "", remove: "false" },
      ],
    });
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toEqual(["chain_a", "chain_c"]);
  });

  it("applies remove rows after every add, whatever order they appear in", () => {
    const data = build({
      slot_template_permitted_building_chains_tables: [
        { slot_template: "tmpl_main", chain: "chain_b", chain_set: "", super_chain: "", remove: "true" },
        { slot_template: "tmpl_main", chain: "", chain_set: "", super_chain: "super_a", remove: "false" },
      ],
    });
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toEqual(["chain_a"]);
  });

  it("picks up chains from the superchain junction table", () => {
    const data = build({
      slot_template_permitted_building_chains_tables: [],
      slot_template_to_building_superchain_junctions_tables: [
        { id: "1", slot_template: "tmpl_main", building_superchain: "super_c" },
      ],
    });
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toEqual(["chain_c"]);
  });

  it("records why each chain is in the view", () => {
    const view = resolveRegionBuildings(build(), query());
    const column = view.bands.flatMap((band) => band.columns).find((entry) => entry.chainKey === "chain_a");
    expect(column?.sources).toEqual(["slot_template:tmpl_main"]);
  });

  it("adds only the selected faction's foreign slot-set templates", () => {
    const data = build({
      slot_template_permitted_building_chains_tables: [
        { slot_template: "tmpl_main", chain: "chain_a", chain_set: "", super_chain: "", remove: "false" },
        { slot_template: "tmpl_foreign", chain: "chain_c", chain_set: "", super_chain: "", remove: "false" },
      ],
      slot_set_items_tables: [
        { id: "11", slot_set: "foreign_set", slot_template: "tmpl_foreign", slot_type: "secondary" },
      ],
      start_pos_region_foreign_slots_tables: [
        { campaign: CAMPAIGN, region: REGION, faction: "emp_faction", slot_set: "foreign_set" },
      ],
    });

    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toEqual(["chain_a"]);
    expect(chainKeysIn(resolveRegionBuildings(data, query({ faction: "dwf_faction" })))).toEqual(["chain_a"]);

    const selected = resolveRegionBuildings(data, query({ faction: "emp_faction" }));
    expect(chainKeysIn(selected)).toEqual(["chain_a", "chain_c"]);
    const foreignTile = selected.bands
      .flatMap((band) => band.columns.flatMap((column) => column.tiles))
      .find((tile) => tile.chainKey === "chain_c");
    expect(foreignTile?.isForeignSlot).toBe(true);
    expect(selected.slotTemplates).toContainEqual(
      expect.objectContaining({ slotTemplate: "tmpl_foreign", isForeignSlot: true }),
    );
  });

  it("never shows legacy wh_main_horde chains", () => {
    const tables = baseTables();
    tables.building_chains_tables.push({ key: "wh_main_horde_legacy", building_superchain: "super_horde" });
    tables.building_levels_tables.push({
      level_name: "horde_1",
      chain: "wh_main_horde_legacy",
      level: "0",
      visible_in_ui: "true",
    });
    tables.building_culture_variants_tables.push({
      building: "horde_1",
      culture: "",
      subculture: "",
      faction: "",
      disables: "false",
    });
    tables.building_set_to_building_junctions_tables.push({
      building_chain: "wh_main_horde_legacy",
      building_level: "",
      building_set: "set_one",
      exclude: "false",
    });
    tables.slot_template_permitted_building_chains_tables.push({
      slot_template: "tmpl_main",
      chain: "wh_main_horde_legacy",
      chain_set: "",
      super_chain: "",
      remove: "false",
    });

    expect(chainKeysIn(resolveRegionBuildings(buildBuildingsData(tables, noLoc), query()))).not.toContain(
      "wh_main_horde_legacy",
    );
  });
});

describe("resolveRegionBuildings: availability", () => {
  const withAvailability = (rows: Array<Record<string, string>>) =>
    build({
      building_chain_availability_sets_tables: [{ building_chain: "chain_a", id: "set_a" }],
      building_chain_availabilities_tables: rows,
    });

  it("leaves a chain with no availability set alone", () => {
    expect(chainKeysIn(resolveRegionBuildings(build(), query()))).toContain("chain_a");
  });

  it("scopes legacy Vampire chains through wh_main_bas_vmp", () => {
    const tables = baseTables();
    const vampireChain = "wh2_main_VAMPIRES_legacy";
    tables.building_chains_tables.push({ key: vampireChain, building_superchain: "super_vmp" });
    tables.building_levels_tables.push({
      level_name: "vmp_1",
      chain: vampireChain,
      level: "0",
      visible_in_ui: "true",
    });
    tables.building_culture_variants_tables.push({
      building: "vmp_1",
      culture: "",
      subculture: "",
      faction: "",
      disables: "false",
    });
    tables.building_set_to_building_junctions_tables.push({
      building_chain: vampireChain,
      building_level: "",
      building_set: "set_one",
      exclude: "false",
    });
    tables.slot_template_permitted_building_chains_tables.push({
      slot_template: "tmpl_main",
      chain: vampireChain,
      chain_set: "",
      super_chain: "",
      remove: "false",
    });
    tables.building_chain_availabilities_tables = [
      { id: "vmp", set_id: "wh_main_bas_vmp", culture: "vmp", sub_culture: "", faction: "", campaign: "" },
    ];
    const data = buildBuildingsData(tables, noLoc);

    expect(chainKeysIn(resolveRegionBuildings(data, query()))).not.toContain(vampireChain);
    expect(chainKeysIn(resolveRegionBuildings(data, query({ culture: "vmp" })))).toContain(vampireChain);
  });

  it("scopes the Rogue Port chain through the Rogue culture availability set", () => {
    const tables = baseTables();
    const roguePortChain = "wh2_main_rogue_port";
    tables.building_chains_tables.push({ key: roguePortChain, building_superchain: "super_rogue" });
    tables.building_levels_tables.push({
      level_name: "rogue_port_1",
      chain: roguePortChain,
      level: "0",
      visible_in_ui: "true",
    });
    tables.building_culture_variants_tables.push({
      building: "rogue_port_1",
      culture: "",
      subculture: "",
      faction: "",
      disables: "false",
    });
    tables.building_set_to_building_junctions_tables.push({
      building_chain: roguePortChain,
      building_level: "",
      building_set: "set_one",
      exclude: "false",
    });
    tables.slot_template_permitted_building_chains_tables.push({
      slot_template: "tmpl_main",
      chain: roguePortChain,
      chain_set: "",
      super_chain: "",
      remove: "false",
    });
    tables.building_chain_availabilities_tables = [
      {
        id: "rogue",
        set_id: "wh2_main_bas_rogue",
        culture: "wh2_main_rogue",
        sub_culture: "",
        faction: "",
        campaign: "",
      },
    ];
    const data = buildBuildingsData(tables, noLoc);

    expect(data.availabilitySetsByChain[roguePortChain]).toContain("wh2_main_bas_rogue");
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).not.toContain(roguePortChain);
    expect(chainKeysIn(resolveRegionBuildings(data, query({ culture: "wh2_main_rogue" })))).toContain(roguePortChain);
  });

  it("keeps a chain whose row names the selected culture", () => {
    const data = withAvailability([
      { id: "1", set_id: "set_a", culture: "emp", sub_culture: "", faction: "", campaign: "" },
    ]);
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toContain("chain_a");
  });

  it("drops a chain whose only row names another culture", () => {
    const data = withAvailability([
      { id: "1", set_id: "set_a", culture: "dwf", sub_culture: "", faction: "", campaign: "" },
    ]);
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).not.toContain("chain_a");
  });

  it("drops a chain whose only row names another campaign", () => {
    const data = withAvailability([
      { id: "1", set_id: "set_a", culture: "", sub_culture: "", faction: "", campaign: "other_camp" },
    ]);
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).not.toContain("chain_a");
  });

  // "none" for subculture means unconstrained, but a row's subculture still has to belong to the
  // culture that *is* selected - otherwise picking Empire would show every faction's chains.
  it("treats an unset subculture filter as permissive within the selected culture", () => {
    const sameCulture = withAvailability([
      { id: "1", set_id: "set_a", culture: "", sub_culture: "emp_sub", faction: "", campaign: "" },
    ]);
    expect(chainKeysIn(resolveRegionBuildings(sameCulture, query()))).toContain("chain_a");

    const otherCulture = withAvailability([
      { id: "1", set_id: "set_a", culture: "", sub_culture: "dwf_sub", faction: "", campaign: "" },
    ]);
    expect(chainKeysIn(resolveRegionBuildings(otherCulture, query()))).not.toContain("chain_a");
  });

  it("narrows to the exact subculture once one is picked", () => {
    const data = withAvailability([
      { id: "1", set_id: "set_a", culture: "", sub_culture: "emp_sub", faction: "", campaign: "" },
    ]);
    expect(chainKeysIn(resolveRegionBuildings(data, query({ subculture: "emp_sub" })))).toContain("chain_a");
    expect(chainKeysIn(resolveRegionBuildings(data, query({ subculture: "dwf_sub" })))).not.toContain("chain_a");
  });

  it("keeps a chain when any one of its rows matches", () => {
    const data = withAvailability([
      { id: "1", set_id: "set_a", culture: "dwf", sub_culture: "", faction: "", campaign: "" },
      { id: "2", set_id: "set_a", culture: "emp", sub_culture: "", faction: "", campaign: "" },
    ]);
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toContain("chain_a");
  });
});

describe("resolveRegionBuildings: recruitment unlocks", () => {
  it("shows a unit only on the first level in a chain that unlocks it", () => {
    const data = build({
      building_units_allowed_tables: [
        { key: "1", building: "a_1", unit: "spearmen", faction: "" },
        { key: "2", building: "a_2", unit: "spearmen", faction: "" },
        { key: "3", building: "a_2", unit: "halberdiers", faction: "" },
        { key: "4", building: "b_1", unit: "spearmen", faction: "" },
      ],
    });
    const tiles = resolveRegionBuildings(data, query()).bands.flatMap((band) =>
      band.columns.flatMap((column) => column.tiles),
    );
    const recruitmentOf = (levelKey: string) =>
      tiles.find((tile) => tile.levelKey === levelKey)?.recruitable.map((unit) => unit.unitKey);

    expect(recruitmentOf("a_1")).toEqual(["spearmen"]);
    expect(recruitmentOf("a_2")).toEqual(["halberdiers"]);
    expect(recruitmentOf("b_1")).toEqual(["spearmen"]);
  });
});

describe("resolveRegionBuildings: settlement types", () => {
  const withBindings = () =>
    build({
      settlement_type_to_building_chains_junctions_tables: [
        { building_chain: "chain_a", settlement_type: "capital", exclude: "false" },
        { building_chain: "chain_b", settlement_type: "minor", exclude: "false" },
        { building_chain: "chain_b", settlement_type: "capital", exclude: "true" },
      ],
    });

  it("offers the settlement types the visible chains bind to", () => {
    const view = resolveRegionBuildings(withBindings(), query());
    expect(view.settlementTypeOptions.map((option) => option.key)).toEqual(["capital", "minor"]);
  });

  it("offers nothing when no visible chain binds to a settlement type", () => {
    expect(resolveRegionBuildings(build(), query()).settlementTypeOptions).toEqual([]);
  });

  it("keeps only chains assigned to the chosen type", () => {
    const view = resolveRegionBuildings(withBindings(), query({ settlementType: "capital" }));
    // chain_b is excluded from capital and chain_c has no settlement-type assignment.
    expect(chainKeysIn(view)).toEqual(["chain_a"]);
  });

  it("adds the region's own settlement type to the options", () => {
    const data = build({
      start_pos_regions_tables: [{ id: "1", region: REGION, campaign: CAMPAIGN }],
      start_pos_settlements_tables: [{ settlement_id: "s", region: "1", settlement_type: "minor" }],
    });
    expect(resolveRegionBuildings(data, query()).settlementTypeOptions.map((option) => option.key)).toEqual(["minor"]);
  });
});

describe("resolveRegionBuildings: culture variants", () => {
  it("hides a level whose variants all belong to another culture", () => {
    const data = build({
      building_culture_variants_tables: [
        { building: "a_1", culture: "dwf", subculture: "", faction: "", disables: "false" },
      ],
    });
    expect(levelKeysIn(resolveRegionBuildings(data, query()))).not.toContain("a_1");
  });

  it("hides a level with no culture variant row at all, which the game draws nothing for", () => {
    const data = build({ building_culture_variants_tables: [] });
    expect(resolveRegionBuildings(data, query()).bands).toEqual([]);
  });

  it("shows it greyed when the toggle is on", () => {
    const data = build({ building_culture_variants_tables: [] });
    const view = resolveRegionBuildings(data, query({ includeLevelsWithoutVariant: true }));
    const tile = view.bands
      .flatMap((band) => band.columns.flatMap((column) => column.tiles))
      .find((entry) => entry.levelKey === "a_1");
    expect(tile?.hasNoVariant).toBe(true);
  });

  it("removes a level a disables row covers, and says which row did it", () => {
    const data = build({
      building_culture_variants_tables: [
        { building: "a_1", culture: "emp", subculture: "", faction: "", disables: "true" },
        { building: "a_2", culture: "emp", subculture: "", faction: "", disables: "false" },
      ],
    });
    const view = resolveRegionBuildings(data, query());
    expect(levelKeysIn(view)).not.toContain("a_1");
    expect(view.disabledLevels.map((entry) => entry.levelKey)).toEqual(["a_1"]);
    expect(view.disabledLevels[0].variant.culture).toBe("emp");
  });

  // wh_main_emp_worship_1 in vanilla: a plain Empire variant plus disabling rows for Middenland and
  // Talabecland. The game shows it for every other Empire faction, so a disabling row must only bite
  // when the query pins the faction it names.
  it("ignores a faction-specific disables row while no faction is picked", () => {
    const data = build({
      building_culture_variants_tables: [
        { building: "a_1", culture: "emp", subculture: "", faction: "", disables: "false" },
        { building: "a_1", culture: "emp", subculture: "", faction: "emp_faction", disables: "true" },
      ],
    });
    expect(levelKeysIn(resolveRegionBuildings(data, query()))).toContain("a_1");
    expect(resolveRegionBuildings(data, query()).disabledLevels).toEqual([]);
  });

  it("applies that same row once its faction is picked", () => {
    const data = build({
      building_culture_variants_tables: [
        { building: "a_1", culture: "emp", subculture: "", faction: "", disables: "false" },
        { building: "a_1", culture: "emp", subculture: "", faction: "emp_faction", disables: "true" },
      ],
    });
    const view = resolveRegionBuildings(data, query({ faction: "emp_faction" }));
    expect(levelKeysIn(view)).not.toContain("a_1");
    expect(view.disabledLevels.map((entry) => entry.levelKey)).toEqual(["a_1"]);
  });

  it("never displays a disabling row as the building's variant", () => {
    const data = build({
      building_culture_variants_tables: [
        { building: "a_1", culture: "emp", subculture: "", faction: "", icon: "shown", disables: "false" },
        { building: "a_1", culture: "emp", subculture: "", faction: "emp_faction", icon: "hidden", disables: "true" },
      ],
    });
    const view = resolveRegionBuildings(data, query());
    const tile = view.bands
      .flatMap((band) => band.columns.flatMap((column) => column.tiles))
      .find((entry) => entry.levelKey === "a_1");
    expect(tile?.variant?.icon).toBe("shown");
  });

  it("picks the most specific matching variant", () => {
    const data = build({
      building_culture_variants_tables: [
        { building: "a_1", culture: "emp", subculture: "", faction: "", icon: "culture" },
        { building: "a_1", culture: "emp", subculture: "emp_sub", faction: "", icon: "subculture" },
        { building: "a_1", culture: "", subculture: "", faction: "", icon: "generic" },
      ],
    });
    const view = resolveRegionBuildings(data, query({ subculture: "emp_sub" }));
    const tile = view.bands
      .flatMap((band) => band.columns.flatMap((column) => column.tiles))
      .find((entry) => entry.levelKey === "a_1");
    expect(tile?.variant?.icon).toBe("subculture");
    expect(tile?.variantCount).toBe(3);
  });
});

describe("resolveRegionBuildings: set bands", () => {
  it("orders bands by sort order and tints them from the set's colour", () => {
    const view = resolveRegionBuildings(build(), query());
    expect(view.bands.map((band) => band.setKey)).toEqual(["set_one", "set_two"]);
    expect(view.bands[0].colourR).toBe(10);
  });

  // The chain's binding wins over the level's own. Verified against the game: every
  // wh_main_emp_forges_* level is bound to the hidden wh3_dlc25_set_emp_military_support while its
  // chain is bound to the visible wh_main_set_empire_military_support, and the game draws the
  // chain's. See test/buildingsAltdorf.node.test.ts.
  it("lets the chain binding beat a level binding", () => {
    const data = build({
      building_set_to_building_junctions_tables: [
        { building_chain: "chain_a", building_level: "", building_set: "set_one", exclude: "false" },
        { building_chain: "", building_level: "a_2", building_set: "set_two", exclude: "false" },
      ],
    });
    const view = resolveRegionBuildings(data, query());
    const bandOf = (levelKey: string) =>
      view.bands.find((band) => band.columns.some((column) => column.tiles.some((tile) => tile.levelKey === levelKey)))
        ?.setKey;
    expect(bandOf("a_1")).toBe("set_one");
    expect(bandOf("a_2")).toBe("set_one");
  });

  it("falls back to a level binding when the chain has none", () => {
    const data = build({
      building_set_to_building_junctions_tables: [
        { building_chain: "", building_level: "a_2", building_set: "set_two", exclude: "false" },
      ],
    });
    const view = resolveRegionBuildings(data, { ...query(), includeUnbandedLevels: true });
    const bandOf = (levelKey: string) =>
      view.bands.find((band) => band.columns.some((column) => column.tiles.some((tile) => tile.levelKey === levelKey)))
        ?.setKey;
    expect(bandOf("a_2")).toBe("set_two");
    expect(bandOf("a_1")).toBe(NO_SET_KEY);
  });

  it("places a secondary building on the primary tier it requires", () => {
    const data = build({
      building_levels_tables: [
        {
          level_name: "a_1",
          chain: "chain_a",
          level: "0",
          visible_in_ui: "true",
          primary_slot_building_building_level_requirement: "2",
        },
        {
          level_name: "a_2",
          chain: "chain_a",
          level: "1",
          visible_in_ui: "true",
          primary_slot_building_building_level_requirement: "3",
        },
        { level_name: "b_1", chain: "chain_b", level: "0", visible_in_ui: "true" },
        { level_name: "c_1", chain: "chain_c", level: "0", visible_in_ui: "true" },
      ],
    });
    const tiles = resolveRegionBuildings(data, query()).bands.flatMap((band) =>
      band.columns.flatMap((column) => column.tiles),
    );
    const rowOf = (levelKey: string) => tiles.find((tile) => tile.levelKey === levelKey)?.tierRow;
    // Board rows are zero-based: requirements 2 and 3 occupy rows 1 and 2.
    expect(rowOf("a_1")).toBe(1);
    expect(rowOf("a_2")).toBe(2);
  });

  it("falls back to row 0 when the requirement column is missing rather than to NaN", () => {
    // A BuiltBuildingsData restored from a cache written before the column existed has it undefined,
    // and an undefined tier row becomes a NaN grid row, which piles every tile into one cell.
    const data = build();
    for (const level of Object.values(data.levelsByKey)) {
      (level as { primarySlotLevelRequirement?: number }).primarySlotLevelRequirement = undefined;
    }
    const tiles = resolveRegionBuildings(data, query()).bands.flatMap((band) =>
      band.columns.flatMap((column) => column.tiles),
    );
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => Number.isFinite(tile.tierRow))).toBe(true);
  });

  it("leaves out a chain whose levels name only other cultures", () => {
    // `wh_main_horde_chaos_trolls` in the real data: reachable from the generic secondary chain set,
    // no availability row, but its levels' variants name Chaos and nothing else.
    const data = build({
      building_culture_variants_tables: [
        { building: "a_1", culture: "", subculture: "", faction: "", disables: "false" },
        { building: "a_2", culture: "dwf", subculture: "", faction: "", disables: "false" },
        { building: "b_1", culture: "emp", subculture: "", faction: "", disables: "false" },
        { building: "c_1", culture: "emp", subculture: "", faction: "", disables: "false" },
      ],
    });
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toEqual(["chain_b", "chain_c"]);
    expect(chainKeysIn(resolveRegionBuildings(data, query({ includeOtherCultureChains: true })))).toContain("chain_a");
  });

  it("keeps a chain that names this culture on any one of its levels", () => {
    const data = build({
      building_culture_variants_tables: [
        { building: "a_1", culture: "dwf", subculture: "", faction: "", disables: "false" },
        { building: "a_2", culture: "emp", subculture: "", faction: "", disables: "false" },
        { building: "b_1", culture: "emp", subculture: "", faction: "", disables: "false" },
        { building: "c_1", culture: "emp", subculture: "", faction: "", disables: "false" },
      ],
    });
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toContain("chain_a");
  });

  it("keeps a culture-agnostic chain, which the game does draw", () => {
    // `wh_main_emp_resource_pottery` and the Altdorf imperial palace leave `culture` empty.
    const data = build({
      building_culture_variants_tables: [
        { building: "a_1", culture: "", subculture: "", faction: "", disables: "false" },
        { building: "a_2", culture: "", subculture: "", faction: "", disables: "false" },
        { building: "b_1", culture: "emp", subculture: "", faction: "", disables: "false" },
        { building: "c_1", culture: "emp", subculture: "", faction: "", disables: "false" },
      ],
    });
    expect(chainKeysIn(resolveRegionBuildings(data, query()))).toContain("chain_a");
  });

  it("leaves a level in no set out, since the panel has no band to draw it in", () => {
    const data = build({
      building_set_to_building_junctions_tables: [
        { building_chain: "", building_level: "a_2", building_set: "set_two", exclude: "false" },
      ],
    });
    const levelKeys = resolveRegionBuildings(data, query()).bands.flatMap((band) =>
      band.columns.flatMap((column) => column.tiles.map((tile) => tile.levelKey)),
    );
    expect(levelKeys).toContain("a_2");
    expect(levelKeys).not.toContain("a_1");
  });

  it("drops a set an exclude row names", () => {
    const data = build({
      building_set_to_building_junctions_tables: [
        { building_chain: "chain_a", building_level: "", building_set: "set_one", exclude: "false" },
        { building_chain: "chain_a", building_level: "", building_set: "set_one", exclude: "true" },
      ],
    });
    // Nothing claims chain_a any more, so its levels have no band; the toggle is what keeps them.
    const view = resolveRegionBuildings(data, { ...query(), includeUnbandedLevels: true });
    const band = view.bands.find((entry) => entry.columns.some((column) => column.chainKey === "chain_a"));
    expect(band?.setKey).toBe(NO_SET_KEY);
    expect(resolveRegionBuildings(data, query()).bands).toEqual([]);
  });

  it("hides a set marked show_in_ui false unless the toggle is on", () => {
    const data = build({
      building_sets_tables: [
        { key: "set_one", sort_order: "1", colour_r: "0", colour_g: "0", colour_b: "0", show_in_ui: "false" },
        { key: "set_two", sort_order: "2", colour_r: "0", colour_g: "0", colour_b: "0", show_in_ui: "true" },
      ],
    });
    expect(resolveRegionBuildings(data, query()).bands.map((band) => band.setKey)).toEqual(["set_two"]);
    expect(resolveRegionBuildings(data, query({ includeHiddenSets: true })).bands.map((band) => band.setKey)).toEqual([
      "set_one",
      "set_two",
    ]);
  });
});

describe("resolveRegionBuildings: upgrade edges", () => {
  it("points an explicit junction from the lower level to the higher, whichever column it is in", () => {
    const forwards = build({ building_upgrades_junction_tables: [{ from: "a_1", to: "a_2" }] });
    const backwards = build({ building_upgrades_junction_tables: [{ from: "a_2", to: "a_1" }] });
    for (const data of [forwards, backwards]) {
      const edge = resolveRegionBuildings(data, query()).edges.find((entry) => !entry.isImplicit);
      expect(edge).toMatchObject({ fromLevelKey: "a_1", toLevelKey: "a_2" });
    }
  });

  it("adds implicit edges between consecutive levels of a chain", () => {
    const view = resolveRegionBuildings(build(), query());
    expect(view.edges).toContainEqual({ fromLevelKey: "a_1", toLevelKey: "a_2", isImplicit: true });
  });

  it("does not add an implicit edge where an explicit one already covers the pair", () => {
    const data = build({ building_upgrades_junction_tables: [{ from: "a_2", to: "a_1" }] });
    const edges = resolveRegionBuildings(data, query()).edges.filter(
      (entry) => entry.fromLevelKey === "a_1" && entry.toLevelKey === "a_2",
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].isImplicit).toBe(false);
  });

  it("ignores an edge whose other end is not on the board", () => {
    const data = build({ building_upgrades_junction_tables: [{ from: "a_1", to: "not_visible" }] });
    expect(resolveRegionBuildings(data, query()).edges.every((edge) => !edge.raw)).toBe(true);
  });

  // Every row of vanilla's building_downgrade_junctions_tables maps a level to itself, so reading
  // arrows from it drew self-edges. The upgrade paths live in building_upgrades_junction_tables.
  it("ignores the self-referential rows the downgrade table is full of", () => {
    const data = build({ building_upgrades_junction_tables: [{ from: "a_1", to: "a_1" }] });
    expect(resolveRegionBuildings(data, query()).edges.every((edge) => !edge.raw)).toBe(true);
  });

  it("does not read arrows out of the downgrade table", () => {
    const data = build({ building_downgrade_junctions_tables: [{ from: "b_1", to: "c_1" }] });
    const edges = resolveRegionBuildings(data, query()).edges.filter((edge) => !edge.isImplicit);
    expect(edges).toEqual([]);
  });
});

describe("resolveRegionBuildings: existing buildings", () => {
  it("marks the buildings the campaign's start pos places in this region", () => {
    const data = build({
      start_pos_regions_tables: [{ id: "1", region: REGION, campaign: CAMPAIGN }],
      start_pos_settlements_tables: [
        { settlement_id: "s", region: "1", settlement_type: "capital", primary_building: "a_1", building1: "b_1" },
      ],
    });
    const view = resolveRegionBuildings(data, query());
    expect(view.existingBuildings.sort()).toEqual(["a_1", "b_1"]);
    const tile = view.bands
      .flatMap((band) => band.columns.flatMap((column) => column.tiles))
      .find((entry) => entry.levelKey === "a_1");
    expect(tile?.isExistingInRegion).toBe(true);
  });
});

describe("resolveRegionBuildings: ruin levels", () => {
  // A chain offered only by a primary or port slot is the settlement or port itself, and its level 0
  // is the razed state the game's browser does not draw. Ordinary buildings arrive on secondary
  // slots and legitimately start at level 0.
  const primarySlot = () => ({
    start_pos_region_slot_templates_tables: [
      { campaign: CAMPAIGN, id: "1", region: REGION, slot_template: "tmpl_main", slot_type: "primary" },
    ],
  });

  it("hides level 0 of a chain offered only by a primary slot", () => {
    const view = resolveRegionBuildings(build(primarySlot()), query());
    expect(levelKeysIn(view)).not.toContain("a_1");
    expect(levelKeysIn(view)).toContain("a_2");
    const firstDisplayed = view.bands
      .flatMap((band) => band.columns.flatMap((column) => column.tiles))
      .find((tile) => tile.levelKey === "a_2");
    expect(firstDisplayed).toMatchObject({ romanNumeral: "I", isSettlementOrPort: true, tierRow: 0 });
  });

  it("hides level 0 of a chain offered only by a port slot", () => {
    const data = build({
      start_pos_region_slot_templates_tables: [
        { campaign: CAMPAIGN, id: "1", region: REGION, slot_template: "tmpl_main", slot_type: "port" },
      ],
    });
    expect(levelKeysIn(resolveRegionBuildings(data, query()))).not.toContain("a_1");
  });

  it("keeps level 0 on a secondary slot, which is where ordinary buildings live", () => {
    const view = resolveRegionBuildings(build(), query());
    expect(levelKeysIn(view)).toContain("a_1");
    const firstDisplayed = view.bands
      .flatMap((band) => band.columns.flatMap((column) => column.tiles))
      .find((tile) => tile.levelKey === "a_1");
    expect(firstDisplayed).toMatchObject({ romanNumeral: "I", isSettlementOrPort: false, tierRow: 0 });
  });

  it("keeps level 0 when the chain is offered by a secondary slot as well", () => {
    const data = build({
      start_pos_region_slot_templates_tables: [
        { campaign: CAMPAIGN, id: "1", region: REGION, slot_template: "tmpl_main", slot_type: "primary" },
        { campaign: CAMPAIGN, id: "2", region: REGION, slot_template: "tmpl_main", slot_type: "secondary" },
      ],
    });
    expect(levelKeysIn(resolveRegionBuildings(data, query()))).toContain("a_1");
  });

  it("drops a primary chain whose only level is the ruin", () => {
    const data = build({
      ...primarySlot(),
      building_levels_tables: [{ level_name: "only_ruin", chain: "chain_a", level: "0", visible_in_ui: "true" }],
      building_culture_variants_tables: [
        { building: "only_ruin", culture: "", subculture: "", faction: "", disables: "false" },
      ],
    });
    const view = resolveRegionBuildings(data, query());
    expect(view.bands.flatMap((band) => band.columns.map((column) => column.chainKey))).not.toContain("chain_a");
  });

  it("shows them again, marked, when the toggle is on", () => {
    const view = resolveRegionBuildings(build(primarySlot()), query({ includeRuinLevels: true }));
    const tile = view.bands
      .flatMap((band) => band.columns.flatMap((column) => column.tiles))
      .find((entry) => entry.levelKey === "a_1");
    expect(tile?.isRuin).toBe(true);
  });
});

describe("resolveRegionBuildings: hidden levels", () => {
  it("hides a level the table marks invisible unless the toggle is on", () => {
    const data = build({
      building_levels_tables: [
        { level_name: "a_1", chain: "chain_a", level: "0", visible_in_ui: "false" },
        { level_name: "a_2", chain: "chain_a", level: "1", visible_in_ui: "true" },
        { level_name: "b_1", chain: "chain_b", level: "0", visible_in_ui: "true" },
        { level_name: "c_1", chain: "chain_c", level: "0", visible_in_ui: "true" },
      ],
    });
    expect(levelKeysIn(resolveRegionBuildings(data, query()))).not.toContain("a_1");
    expect(levelKeysIn(resolveRegionBuildings(data, query({ includeHiddenInUi: true })))).toContain("a_1");
  });
});
