import { describe, expect, it } from "vitest";
import { buildAbilitiesCatalogEntries, buildAbilityDetail } from "../src/abilitiesData/data";
import { abilityEditReducer, emptyAbilityEditState } from "../src/abilitiesData/edits";
import { cloneAbilityRows, copyAbilityPayloadRows } from "../src/abilitiesData/clone";
import type { AbilitiesTableRows } from "../src/abilitiesData/types";

const source = (values: Record<string, string>, pack = "db.pack", kind: "vanilla" | "mod" = "vanilla") => ({
  ...values,
  __sourcePackPath: pack,
  __sourcePackName: pack,
  __sourceKind: kind,
});

const tables: AbilitiesTableRows = {
  unit_abilities_tables: [source({ key: "ability", source_type: "spell", type: "wh_type_augment", icon_name: "ability" })],
  unit_special_abilities_tables: [source({ key: "ability", passive: "false", activated_projectile: "shared_projectile", unique_id: "1" })],
  special_ability_to_special_ability_phase_junctions_tables: [source({ special_ability: "ability", phase: "shared_phase", order: "1", target_self: "true", target_friends: "false", target_enemies: "false" })],
  special_ability_phases_tables: [source({ id: "shared_phase", duration: "10" })],
  special_ability_phase_stat_effects_tables: [source({ phase: "shared_phase", stat: "stat_melee_attack", value: "10", how: "add" })],
  projectiles_tables: [source({ key: "shared_projectile", damage: "10", ap_damage: "5", projectile_number: "1", explosion_type: "shared_explosion" })],
  projectiles_explosions_tables: [source({ key: "shared_explosion", detonation_damage: "20", detonation_damage_ap: "10" })],
  projectile_bombardments_tables: [],
  battle_vortexs_tables: [],
  special_ability_groups_to_unit_abilities_junctions_tables: [],
  special_ability_groups_tables: [],
  unit_abilities_to_additional_ui_effects_juncs_tables: [],
  unit_abilities_additional_ui_effects_tables: [],
  special_ability_to_invalid_target_flags_tables: [],
  special_ability_to_invalid_usage_flags_tables: [],
  special_ability_to_auto_deactivate_flags_tables: [],
  special_ability_intensity_settings_tables: [],
  land_units_to_unit_abilites_junctions_tables: [],
  army_special_abilities_tables: [],
  effect_bonus_value_unit_ability_junctions_tables: [],
  unit_ability_superseded_abilities_set_elements_tables: [],
};

const locs: Record<string, string> = {
  unit_abilities_onscreen_name_ability: "Test Ability",
  unit_abilities_tooltip_text_ability: "Description",
  unit_ability_source_types_name_spell: "Spell",
  unit_ability_types_onscreen_name_wh_type_augment: "Augment",
};
const getLoc = (key: string) => locs[key];

describe("abilities data", () => {
  it("composes the catalog and detail graph", () => {
    const entries = buildAbilitiesCatalogEntries(tables, getLoc);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ key: "ability", name: "Test Ability", sourceTypeName: "Spell", typeName: "Augment" });

    const detail = buildAbilityDetail(tables, getLoc, "ability")!;
    expect(detail.phases[0].statEffects[0].values.value).toBe("10");
    expect(detail.payloadRoots[0].parts.map((part) => part.kind)).toEqual(["projectile", "explosion"]);
  });

  it("upserts the same keyed override instead of duplicating it", () => {
    let state = emptyAbilityEditState();
    state = abilityEditReducer(state, { type: "upsertRows", rows: [{ table: "unit_abilities_tables", origin: "override", values: { key: "ability", icon_name: "one" } }] });
    state = abilityEditReducer(state, { type: "upsertRows", rows: [{ table: "unit_abilities_tables", origin: "override", values: { key: "ability", icon_name: "two" } }] });
    expect(state.order).toHaveLength(1);
    expect(state.rowsById[state.order[0]].values.icon_name).toBe("two");
  });

  it("clones phases but not unit/army/effect assignments", () => {
    const detail = buildAbilityDetail(tables, getLoc, "ability")!;
    const rows = cloneAbilityRows(detail, "ability_copy", "Ability Copy");
    expect(rows.find((row) => row.table === "unit_abilities_tables")?.values.key).toBe("ability_copy");
    expect(rows.find((row) => row.table === "special_ability_phases_tables")?.values.id).toBe("ability_copy_phase_1");
    expect(rows.some((row) => row.table === "land_units_to_unit_abilites_junctions_tables")).toBe(false);
    expect(rows.some((row) => row.table === "army_special_abilities_tables")).toBe(false);
    expect(rows.some((row) => row.table === "effect_bonus_value_unit_ability_junctions_tables")).toBe(false);
  });

  it("copies and rewires a projectile payload chain", () => {
    const detail = buildAbilityDetail(tables, getLoc, "ability")!;
    const rows = copyAbilityPayloadRows(detail, detail.payloadRoots[0]);
    expect(rows.find((row) => row.table === "projectiles_tables")?.values.key).toBe("ability_projectile");
    expect(rows.find((row) => row.table === "projectiles_explosions_tables")?.values.key).toBe("ability_explosion");
    expect(rows.find((row) => row.table === "unit_special_abilities_tables")?.values.activated_projectile).toBe("ability_projectile");
  });
});
