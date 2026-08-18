import { describe, expect, it } from "vitest";

import { ANCILLARY_TABLES, buildAncillariesData, dedupeRowsByKey } from "../src/ancillariesData/data";
import type { AncillariesTableRows } from "../src/ancillariesData/types";

const emptyTables = (): AncillariesTableRows =>
  Object.fromEntries(ANCILLARY_TABLES.map((table) => [table, []])) as AncillariesTableRows;

const LOC: Record<string, string> = {
  ancillaries_onscreen_name_anc_sword: "Sword of Testing",
  ancillaries_explanation_text_anc_sword: "It is sharp.",
  ancillaries_colour_text_anc_sword: "Forged in a unit test.",
  ancillaries_categories_onscreen_name_weapon: "Weapon",
  ancillaries_categories_onscreen_name_talisman: "Talisman",
  ancillaries_subcategories_onscreen_name_rune: "Rune",
  effects_description_effect_melee: "+%n melee attack",
  effects_description_effect_leadership: "%+n leadership",
  effects_description_effect_resist: "+%n% magic resistance",
};
const getLoc = (key: string) => LOC[key];

/** A minimal but complete set of rows: two categories, one subcategory, two ancillaries. */
const fixtureTables = (): AncillariesTableRows => {
  const tables = emptyTables();
  tables.ancillaries_categories_tables = [
    { category: "talisman", icon_name: "equipment_items_talisman", sort_order: "2" },
    { category: "weapon", icon_name: "equipment_items_weapon", sort_order: "1" },
  ];
  tables.ancillaries_subcategories_tables = [{ subcategory: "rune" }];
  tables.ancillary_types_tables = [
    { type: "type_sword", ui_icon: "ui/campaign ui/ancillaries/sword.png" },
    { type: "type_charm", ui_icon: "" },
  ];
  tables.ancillaries_tables = [
    { key: "anc_sword", type: "type_sword", category: "weapon", subcategory: "" },
    { key: "anc_charm", type: "type_charm", category: "talisman", subcategory: "rune" },
  ];
  tables.ancillary_info_tables = [{ ancillary: "anc_sword" }, { ancillary: "anc_charm" }];
  tables.effects_tables = [
    { effect: "effect_melee", icon: "melee.png", is_positive_value_good: "true" },
    { effect: "effect_leadership", icon: "", is_positive_value_good: "true" },
    { effect: "effect_resist", icon: "resist.png", is_positive_value_good: "true" },
    { effect: "effect_unused", icon: "", is_positive_value_good: "false" },
  ];
  tables.ancillary_to_effects_tables = [
    { ancillary: "anc_sword", effect: "effect_melee", effect_scope: "character_to_character_own", value: "12" },
    { ancillary: "anc_sword", effect: "effect_leadership", effect_scope: "character_to_character_own", value: "5" },
    { ancillary: "anc_charm", effect: "effect_resist", effect_scope: "character_to_force_own", value: "50" },
  ];
  return tables;
};

describe("buildAncillariesData", () => {
  it("orders categories by sort_order and localizes them", () => {
    const data = buildAncillariesData(fixtureTables(), getLoc);
    expect(data.categories.map((category) => category.key)).toEqual(["weapon", "talisman"]);
    expect(data.categories[0].localizedName).toBe("Weapon");
    expect(data.categories[0].iconName).toBe("equipment_items_weapon");
  });

  it("sorts ancillaries by category order, then subcategory, then name", () => {
    const data = buildAncillariesData(fixtureTables(), getLoc);
    // weapon sorts before talisman, so the sword comes first despite its name.
    expect(data.ancillaries.map((ancillary) => ancillary.key)).toEqual(["anc_sword", "anc_charm"]);
    expect(data.ancillaries[0].localizedName).toBe("Sword of Testing");
    // A key with no loc entry falls back to the key rather than rendering blank.
    expect(data.ancillaries[1].localizedName).toBe("anc_charm");
  });

  it("keeps an empty subcategory as its own bucket rather than dropping the row", () => {
    const data = buildAncillariesData(fixtureTables(), getLoc);
    expect(data.ancillaries.find((ancillary) => ancillary.key === "anc_sword")?.subcategory).toBe("");
    expect(data.ancillaries.find((ancillary) => ancillary.key === "anc_charm")?.subcategory).toBe("rune");
  });

  it("resolves the icon through ancillaries.type -> ancillary_types.ui_icon, normalising slashes", () => {
    const data = buildAncillariesData(fixtureTables(), getLoc);
    expect(data.ancillaries.find((ancillary) => ancillary.key === "anc_sword")?.iconPath).toBe(
      "ui\\campaign ui\\ancillaries\\sword.png",
    );
    // A type row with no ui_icon is still a known type, but contributes no icon.
    expect(data.typeKeys).toContain("type_charm");
    expect(data.typeIcons.type_charm).toBeUndefined();
  });

  it("substitutes the effect value into %n, %+n and %n%", () => {
    const data = buildAncillariesData(fixtureTables(), getLoc);
    const sword = data.effectsByAncillary.anc_sword.map((effect) => effect.localizedKey);
    expect(sword).toContain("+12 melee attack");
    expect(sword).toContain("+5 leadership");
    expect(data.effectsByAncillary.anc_charm[0].localizedKey).toBe("+50% magic resistance");
  });

  it("names only the effects an ancillary uses and derives their preferred scope", () => {
    const data = buildAncillariesData(fixtureTables(), getLoc);
    const melee = data.effects.find((effect) => effect.key === "effect_melee");
    expect(melee?.usedByAncillaries).toBe(true);
    expect(melee?.preferredScope).toBe("character_to_character_own");

    const unused = data.effects.find((effect) => effect.key === "effect_unused");
    expect(unused?.usedByAncillaries).toBe(false);
    // Left as a bare key rather than inflating the cache with 15k descriptions.
    expect(unused?.localizedName).toBe("effect_unused");
  });

  it("collects the effect_scope values the junction table actually uses", () => {
    const data = buildAncillariesData(fixtureTables(), getLoc);
    expect(data.effectScopes).toEqual(["character_to_character_own", "character_to_force_own"]);
  });

  it("lets a later row override an earlier one with the same key", () => {
    const tables = fixtureTables();
    // Rows arrive vanilla-first then mods in load order, so appending is what a mod override is.
    tables.ancillaries_tables.push({ key: "anc_sword", type: "type_charm", category: "talisman", subcategory: "rune" });
    const data = buildAncillariesData(tables, getLoc, { anc_sword: "C:\\mods\\overrides.pack" });

    const sword = data.ancillaries.find((ancillary) => ancillary.key === "anc_sword");
    expect(sword?.category).toBe("talisman");
    expect(sword?.originPackPath).toBe("C:\\mods\\overrides.pack");
    // One row survives per key, not two.
    expect(data.ancillaries.filter((ancillary) => ancillary.key === "anc_sword")).toHaveLength(1);
  });

  it("keys ancillary_to_effects on (ancillary, effect) so an override replaces scope and value", () => {
    const tables = fixtureTables();
    tables.ancillary_to_effects_tables.push({
      ancillary: "anc_sword",
      effect: "effect_melee",
      effect_scope: "character_to_force_own",
      value: "99",
    });
    const data = buildAncillariesData(tables, getLoc);

    const melee = data.effectsByAncillary.anc_sword.filter((effect) => effect.effectKey === "effect_melee");
    expect(melee).toHaveLength(1);
    expect(melee[0].value).toBe(99);
    expect(melee[0].scope).toBe("character_to_force_own");
  });
});

describe("dedupeRowsByKey", () => {
  it("collapses on the composite key, keeping the last row", () => {
    const rows = [
      { ancillary: "a", effect: "e1", value: "1" },
      { ancillary: "a", effect: "e2", value: "2" },
      { ancillary: "a", effect: "e1", value: "3" },
    ];
    expect(dedupeRowsByKey("ancillary_to_effects_tables", rows)).toEqual([
      { ancillary: "a", effect: "e1", value: "3" },
      { ancillary: "a", effect: "e2", value: "2" },
    ]);
  });

  it("leaves rows alone for a table it has no key columns for", () => {
    const rows = [{ anything: "1" }, { anything: "1" }];
    expect(dedupeRowsByKey("not_a_known_table", rows)).toHaveLength(2);
  });
});
