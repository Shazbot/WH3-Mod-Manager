import { describe, expect, it } from "vitest";

import { calculateUnitViewerStats } from "../src/unitViewer/calculator";
import {
  buildUnitViewerData,
  createLocLookup,
  resolveCharacterExperienceThreshold,
  type UnitViewerTableRows,
} from "../src/unitViewer/data";
import type { UnitViewerConstants, UnitViewerEntity, UnitViewerUnitModel } from "../src/unitViewer/types";

const rider: UnitViewerEntity = {
  key: "rider",
  type: "man",
  walkSpeed: 1.5,
  runSpeed: 3.3,
  flySpeed: 0,
  chargeSpeed: 4.5,
  mass: 100,
  hitPoints: 8,
  size: "medium",
};

const constants: UnitViewerConstants = {
  experienceBonuses: [
    { stat: "stat_melee_attack", growthRate: 0.6, growthScalar: 0.12 },
    { stat: "stat_melee_defence", growthRate: 0.6, growthScalar: 0.12 },
    { stat: "stat_morale", growthRate: 0, growthScalar: 1.06 },
    { stat: "stat_reloading", growthRate: 0, growthScalar: 2 },
  ],
  rankBonuses: Array.from({ length: 10 }, (_, rank) => ({
    rank,
    fatigueModifier: rank >= 9 ? -4 : 0,
    multiplayerFixedCost: rank * 11,
    multiplayerCostMultiplier: 1 + rank * 0.03,
  })),
  fatigueEffects: {
    threshold_exhausted: {
      scalar_speed: 0.85,
      stat_armour: 0.75,
      stat_charge_bonus: 0.7,
      stat_melee_attack: 0.7,
      stat_melee_damage_ap: 0.9,
      stat_melee_defence: 0.9,
      stat_reloading: 0.9,
    },
  },
  fatigueMorale: { threshold_exhausted: -6 },
  sizeScaling: [
    "stat_melee_damage_base",
    "stat_melee_damage_ap",
    "scalar_missile_damage_base",
    "scalar_missile_damage_ap",
    "scalar_missile_explosion_damage_base",
    "scalar_missile_explosion_damage_ap",
  ].flatMap((stat) => [
    { stat, size: "small" as const, singleEntityValue: 0.25, multiEntityValue: 1 },
    { stat, size: "medium" as const, singleEntityValue: 0.5, multiEntityValue: 1 },
    { stat, size: "large" as const, singleEntityValue: 0.75, multiEntityValue: 1 },
    { stat, size: "ultra" as const, singleEntityValue: 1, multiEntityValue: 1 },
  ]),
  statIconPaths: {},
};

const makeUnit = (overrides: Partial<UnitViewerUnitModel>): UnitViewerUnitModel => ({
  key: "unit",
  landUnitKey: "unit",
  name: "Unit",
  caste: "melee_cavalry",
  category: "cavalry",
  numMen: 60,
  multiplayerCost: 1100,
  recruitmentCost: 1100,
  upkeepCost: 275,
  barrierHealth: 0,
  isRenown: false,
  isHighThreat: false,
  canSiege: false,
  canSkirmish: false,
  accuracy: 10,
  armour: 90,
  shieldBlock: 0,
  chargeBonus: 40,
  meleeAttack: 40,
  meleeDefence: 39,
  leadership: 75,
  bonusHitPoints: 100,
  numMounts: 60,
  numEngines: 0,
  reload: 0,
  primaryAmmo: 0,
  secondaryAmmo: 0,
  fireResistance: 0,
  magicResistance: 0,
  physicalResistance: 0,
  missileResistance: 0,
  wardSave: 0,
  groundStatEffectGroup: "large",
  groundStatEffects: [],
  baseEntity: rider,
  mountEntity: { ...rider, key: "horse", runSpeed: 8.4, chargeSpeed: 10.8, mass: 1000 },
  visualParts: [],
  meleeWeapon: {
    key: "weapon",
    baseDamage: 14,
    apDamage: 38,
    bonusVsLarge: 0,
    bonusVsInfantry: 0,
    attackInterval: 4.3,
    splashMaxAttacks: 1,
    isMagical: false,
    ignitionAmount: 0,
  },
  attributes: [],
  abilities: [],
  ...overrides,
});

const freshUltra = { unitSize: "ultra" as const, rank: 0, fatigue: "threshold_fresh" as const };

describe("Unit Viewer calculations", () => {
  it("matches the reference Questing Knights and Grail Knights card values", () => {
    const questing = calculateUnitViewerStats(makeUnit({}), constants, freshUltra);
    expect(questing).toMatchObject({
      entityCount: 60,
      health: 6960,
      healthPerEntity: 116,
      armour: 90,
      leadership: 75,
      speed: 84,
      chargeSpeed: 108,
      meleeAttack: 40,
      meleeDefence: 39,
      weaponStrength: 52,
      baseDamage: 14,
      apDamage: 38,
      chargeBonus: 40,
      mass: 1000,
    });

    const grail = calculateUnitViewerStats(
      makeUnit({
        key: "wh_main_brt_cav_grail_knights",
        numMen: 48,
        numMounts: 48,
        bonusHitPoints: 136,
        armour: 120,
        shieldBlock: 35,
        leadership: 80,
        meleeAttack: 38,
        meleeDefence: 34,
        chargeBonus: 75,
        multiplayerCost: 1850,
        mountEntity: { ...rider, key: "heavy_horse", runSpeed: 8.4, chargeSpeed: 10.8, mass: 1200 },
        meleeWeapon: {
          ...makeUnit({}).meleeWeapon,
          baseDamage: 18,
          apDamage: 28,
          bonusVsLarge: 18,
          attackInterval: 5.1,
        },
      }),
      constants,
      freshUltra,
    );
    expect(grail).toMatchObject({
      entityCount: 48,
      health: 7296,
      healthPerEntity: 152,
      armour: 120,
      shieldBlock: 35,
      leadership: 80,
      speed: 84,
      chargeSpeed: 108,
      weaponStrength: 46,
      mass: 1200,
    });
  });

  it("matches Organ Gun and Sunmaker engine health and missile calculations", () => {
    const engineEntity = {
      ...rider,
      key: "engine",
      type: "artillery",
      hitPoints: 425,
      runSpeed: 2,
      chargeSpeed: 2,
      mass: 2000,
    };
    const organ = calculateUnitViewerStats(
      makeUnit({
        key: "wh_main_dwf_art_organ_gun",
        caste: "warmachine",
        category: "artillery",
        numMen: 32,
        numMounts: 0,
        mountEntity: undefined,
        numEngines: 4,
        engineEntity,
        bonusHitPoints: 70,
        armour: 40,
        leadership: 64,
        meleeAttack: 16,
        meleeDefence: 20,
        chargeBonus: 2,
        primaryAmmo: 96,
        multiplayerCost: 1000,
        meleeWeapon: { ...makeUnit({}).meleeWeapon, baseDamage: 21, apDamage: 7 },
        primaryMissileWeapon: {
          key: "organ",
          useSecondaryAmmoPool: false,
          projectile: {
            key: "organ_shot",
            range: 300,
            baseDamage: 22,
            apDamage: 68,
            projectileNumber: 1,
            shotsPerVolley: 4,
            burstSize: 1,
            baseReloadTime: 12,
            bonusVsLarge: 0,
            bonusVsInfantry: 0,
            explosionBaseDamage: 0,
            explosionApDamage: 0,
            explosionRadius: 0,
            isMagical: false,
            ignitionAmount: 0,
          },
        },
      }),
      constants,
      freshUltra,
    );
    expect(organ).toMatchObject({ entityCount: 4, health: 4476, healthPerEntity: 1119, speed: 20, mass: 2000 });
    expect(organ.primaryMissile).toMatchObject({ ammo: 24, range: 300, damagePerTenSeconds: 300, reloadTime: 12 });

    const sunmaker = calculateUnitViewerStats(
      makeUnit({
        key: "wh_dlc04_emp_art_sunmaker_0",
        caste: "warmachine",
        category: "artillery",
        numMen: 44,
        numMounts: 0,
        mountEntity: undefined,
        numEngines: 4,
        engineEntity,
        bonusHitPoints: 48,
        reload: 18,
        primaryAmmo: 72,
        primaryMissileWeapon: {
          key: "sunmaker",
          useSecondaryAmmoPool: false,
          projectile: {
            key: "rocket",
            range: 480,
            baseDamage: 30,
            apDamage: 70,
            projectileNumber: 1,
            shotsPerVolley: 9,
            burstSize: 1,
            baseReloadTime: 25,
            bonusVsLarge: 0,
            bonusVsInfantry: 0,
            explosionBaseDamage: 22,
            explosionApDamage: 51,
            explosionRadius: 6,
            isMagical: false,
            ignitionAmount: 1,
          },
        },
      }),
      constants,
      freshUltra,
    );
    expect(sunmaker).toMatchObject({ entityCount: 4, health: 4356, healthPerEntity: 1089 });
    expect(sunmaker.primaryMissile).toMatchObject({ ammo: 8, range: 480, damagePerTenSeconds: 760, reloadTime: 20.5 });
  });

  it("applies rank, vigour, and single-entity unit-size modifiers", () => {
    const ranked = calculateUnitViewerStats(makeUnit({}), constants, {
      unitSize: "ultra",
      rank: 9,
      fatigue: "threshold_exhausted",
    });
    expect(ranked).toMatchObject({
      multiplayerCost: 1496,
      armour: 68,
      leadership: 79,
      speed: 71,
      chargeSpeed: 92,
      meleeAttack: 35,
      meleeDefence: 44,
      apDamage: 34,
      chargeBonus: 28,
      fatigueModifier: -4,
    });
  });
});

describe("Unit Viewer loc lookup", () => {
  const trieOf = (entries: Record<string, string>) => ({
    get: (key: string) => entries[key],
  });

  it("lets a later pack shadow an earlier one, including with an empty override", () => {
    const getLoc = createLocLookup([
      trieOf({ shared: "vanilla", vanilla_only: "kept", blanked: "vanilla text" }),
      undefined,
      trieOf({ shared: "mod", mod_only: "added", blanked: "" }),
    ]);

    expect(getLoc("shared")).toBe("mod");
    expect(getLoc("vanilla_only")).toBe("kept");
    expect(getLoc("mod_only")).toBe("added");
    // An empty override returns "" rather than falling through to the earlier pack. The flattened
    // map used to drop empty values entirely (Trie.getEntries skips falsy ones), so this differs -
    // harmlessly, because every caller falls back with `||`, which treats "" and undefined alike.
    expect(getLoc("blanked")).toBe("");
    expect(getLoc("missing")).toBeUndefined();
  });

  it("reads only the keys it is asked for instead of enumerating every entry", () => {
    const reads: string[] = [];
    const getLoc = createLocLookup([
      {
        get: (key: string) => {
          reads.push(key);
          return key === "wanted" ? "value" : undefined;
        },
      },
    ]);

    expect(getLoc("wanted")).toBe("value");
    expect(getLoc("other")).toBeUndefined();
    expect(reads).toEqual(["wanted", "other"]);
  });

  it.each(["present", "empty", "missing"])("reads a repeated %s key only once per source", (key) => {
    const reads: string[] = [];
    const entries: Record<string, string> = { present: "value", empty: "" };
    const getLoc = createLocLookup([
      {
        get: (key) => {
          reads.push(key);
          return entries[key];
        },
      },
    ]);

    expect(getLoc(key)).toBe(entries[key]);
    expect(getLoc(key)).toBe(entries[key]);
    expect(reads).toEqual([key]);
  });

  it("does not carry cached values or misses into a new lookup", () => {
    const vanilla = { shared: "vanilla", blanked: "vanilla text" };
    const mod: Record<string, string> = { shared: "old mod", blanked: "" };
    const oldLookup = createLocLookup([trieOf(vanilla), trieOf(mod)]);
    expect(oldLookup("shared")).toBe("old mod");
    expect(oldLookup("missing")).toBeUndefined();
    expect(oldLookup("blanked")).toBe("");

    mod.shared = "new mod";
    mod.missing = "new value";
    const newLookup = createLocLookup([trieOf(vanilla), trieOf(mod)]);
    expect(newLookup("shared")).toBe("new mod");
    expect(newLookup("missing")).toBe("new value");
    expect(newLookup("blanked")).toBe("");
    expect(createLocLookup([trieOf(mod), trieOf(vanilla)])("shared")).toBe("vanilla");
  });
});

describe("Unit Viewer catalog", () => {
  it("sorts attributes and active and passive abilities by localized name", () => {
    const tables: UnitViewerTableRows = {
      main_units_tables: [{ unit: "unit", land_unit: "land", num_men: "1" }],
      land_units_tables: [
        {
          key: "land",
          man_entity: "entity",
          primary_melee_weapon: "weapon",
          attribute_group: "attributes",
        },
      ],
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      unit_attributes_to_groups_junctions_tables: [
        { attribute_group: "attributes", attribute: "attribute_z" },
        { attribute_group: "attributes", attribute: "attribute_a" },
      ],
      land_units_to_unit_abilites_junctions_tables: [
        { land_unit: "land", ability: "active_z" },
        { land_unit: "land", ability: "passive_z" },
        { land_unit: "land", ability: "active_a" },
        { land_unit: "land", ability: "passive_a" },
      ],
      unit_abilities_tables: [{ key: "active_z" }, { key: "passive_z" }, { key: "active_a" }, { key: "passive_a" }],
      unit_special_abilities_tables: [
        { key: "passive_z", passive: "true" },
        { key: "passive_a", passive: "true" },
      ],
    };
    const built = buildUnitViewerData(
      tables,
      (key) =>
        ({
          unit_attributes_bullet_text_attribute_z: "Zulu Attribute",
          unit_attributes_bullet_text_attribute_a: "Alpha Attribute",
          unit_abilities_onscreen_name_active_z: "Zulu Active",
          unit_abilities_onscreen_name_active_a: "Alpha Active",
          unit_abilities_onscreen_name_passive_z: "Zulu Passive",
          unit_abilities_onscreen_name_passive_a: "Alpha Passive",
        })[key],
    );
    const unit = built.units.get("unit")!;

    expect(unit.attributes.map((attribute) => attribute.name)).toEqual(["Alpha Attribute", "Zulu Attribute"]);
    expect(unit.abilities.filter((ability) => !ability.passive).map((ability) => ability.tooltip.name)).toEqual([
      "Alpha Active",
      "Zulu Active",
    ]);
    expect(unit.abilities.filter((ability) => ability.passive).map((ability) => ability.tooltip.name)).toEqual([
      "Alpha Passive",
      "Zulu Passive",
    ]);
  });

  it("memoizes abilities per spell state within a build and returns independent tooltip values", () => {
    const tables: UnitViewerTableRows = {
      main_units_tables: [
        { unit: "unit_a", land_unit: "land_a", num_men: "1" },
        { unit: "unit_b", land_unit: "land_b", num_men: "1" },
        { unit: "unit_spell", land_unit: "land_spell", num_men: "1" },
      ],
      land_units_tables: [
        { key: "land_a", man_entity: "entity", primary_melee_weapon: "weapon" },
        { key: "land_b", man_entity: "entity", primary_melee_weapon: "weapon" },
        { key: "land_spell", man_entity: "entity", primary_melee_weapon: "weapon" },
      ],
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      land_units_to_unit_abilites_junctions_tables: [
        { land_unit: "land_a", ability: "shared" },
        { land_unit: "land_b", ability: "shared" },
      ],
      special_ability_groups_to_units_junctions_tables: [{ unit: "land_spell", ability_group: "spell_group" }],
      special_ability_groups_to_unit_abilities_junctions_tables: [
        { special_ability_groups: "spell_group", unit_special_abilities: "shared" },
      ],
      unit_abilities_tables: [
        { key: "shared", type: "type", source_type: "source", overpower_option: "option", icon_name: "icon" },
      ],
      unit_special_abilities_tables: [
        { key: "shared", passive: "true", target_intercept_range: "5", recharge_time: "10" },
      ],
      special_ability_to_special_ability_phase_junctions_tables: [{ special_ability: "shared", phase: "phase" }],
      special_ability_phases_tables: [{ id: "phase", fatigue_change_ratio: "0" }],
      special_ability_phase_stat_effects_tables: [{ phase: "phase", stat: "scalar_speed", how: "mult", value: "1.2" }],
      ui_unit_stats_tables: [{ key: "scalar_speed", icon: "stats/speed.png" }],
      unit_abilities_to_additional_ui_effects_juncs_tables: [
        { ability: "shared", effect: "second" },
        { ability: "shared", effect: "first" },
      ],
      unit_abilities_additional_ui_effects_tables: [
        { key: "second", sort_order: "2", effect_state: "enabled" },
        { key: "first", sort_order: "1", effect_state: "disabled" },
      ],
    };
    const firstLocs: Record<string, string> = {
      unit_abilities_onscreen_name_shared: "Shared ability",
      unit_abilities_tooltip_text_shared: "Current description",
      unit_ability_source_types_name_source: "Current source",
      unit_ability_types_onscreen_name_type: "Current type",
      unit_stat_localisations_onscreen_name_scalar_speed: "Speed",
      unit_abilities_additional_ui_effects_localised_text_first: "First effect",
      unit_abilities_additional_ui_effects_localised_text_second: "Second effect",
    };
    const firstLocReads = new Map<string, number>();
    const built = buildUnitViewerData(tables, (key) => {
      firstLocReads.set(key, (firstLocReads.get(key) || 0) + 1);
      return firstLocs[key];
    });
    const first = built.units.get("unit_a")!.abilities[0]!;
    const second = built.units.get("unit_b")!.abilities[0]!;
    const spell = built.units.get("unit_spell")!.abilities[0]!;

    expect(firstLocReads.get("unit_abilities_onscreen_name_shared")).toBe(2);
    expect([first.isSpell, second.isSpell, spell.isSpell]).toEqual([false, false, true]);
    expect(first).toMatchObject({
      key: "shared",
      passive: true,
      isSpell: false,
      tooltip: {
        key: "shared",
        name: "Shared ability",
        description: "Current description",
        sourceTypeName: "Current source",
        loreGroupName: "",
        abilityTypeName: "Current type",
        overpowerOption: "option",
        iconPath: "ui\\battle ui\\ability_icons\\icon.png",
        stats: { range: 5, cooldown: 10 },
        bonuses: [
          {
            key: "phase:scalar_speed:mult",
            compareKey: "scalar_speed:mult",
            label: "Speed",
            valueText: "+20%",
            numericValue: 20,
            valueSuffix: "%",
            isPositive: true,
            iconPath: "stats\\speed.png",
          },
        ],
        additionalUiEffects: [
          { key: "first", text: "First effect", sortOrder: 1, effectState: "disabled" },
          { key: "second", text: "Second effect", sortOrder: 2, effectState: "enabled" },
        ],
      },
    });
    for (const other of [second, spell]) {
      expect(first).not.toBe(other);
      expect(first.tooltip).not.toBe(other.tooltip);
      expect(first.tooltip.stats).not.toBe(other.tooltip.stats);
      expect(first.tooltip.bonuses).not.toBe(other.tooltip.bonuses);
      expect(first.tooltip.bonuses[0]).not.toBe(other.tooltip.bonuses[0]);
      expect(first.tooltip.additionalUiEffects).not.toBe(other.tooltip.additionalUiEffects);
      expect(first.tooltip.additionalUiEffects[0]).not.toBe(other.tooltip.additionalUiEffects[0]);
    }

    first.tooltip.stats.cooldown = 99;
    first.tooltip.bonuses[0]!.label = "Changed speed";
    first.tooltip.additionalUiEffects[0]!.text = "Changed effect";
    expect(second.tooltip.stats.cooldown).toBe(10);
    expect(second.tooltip.bonuses[0]?.label).toBe("Speed");
    expect(second.tooltip.additionalUiEffects[0]?.text).toBe("First effect");
    expect(spell.tooltip.stats.cooldown).toBe(10);
    expect(spell.tooltip.bonuses[0]?.label).toBe("Speed");
    expect(spell.tooltip.additionalUiEffects[0]?.text).toBe("First effect");

    tables.unit_abilities_tables![0]!.type = "updated_type";
    tables.unit_special_abilities_tables![0]!.recharge_time = "15";
    tables.special_ability_phase_stat_effects_tables![0]!.value = "1.4";
    const nextLocs: Record<string, string> = {
      unit_abilities_onscreen_name_shared: "Updated ability",
      unit_abilities_tooltip_text_shared: "Updated description",
      unit_ability_source_types_name_source: "Updated source",
      unit_ability_types_onscreen_name_updated_type: "Updated type",
      unit_stat_localisations_onscreen_name_scalar_speed: "Updated speed",
      unit_abilities_additional_ui_effects_localised_text_first: "Updated first effect",
      unit_abilities_additional_ui_effects_localised_text_second: "Updated second effect",
    };
    const nextLocReads = new Map<string, number>();
    const rebuilt = buildUnitViewerData(tables, (key) => {
      nextLocReads.set(key, (nextLocReads.get(key) || 0) + 1);
      return nextLocs[key];
    });
    const rebuiltAbility = rebuilt.units.get("unit_a")!.abilities[0]!;
    expect(nextLocReads.get("unit_abilities_onscreen_name_shared")).toBe(2);
    expect(rebuiltAbility).toMatchObject({
      tooltip: {
        name: "Updated ability",
        description: "Updated description",
        sourceTypeName: "Updated source",
        abilityTypeName: "Updated type",
        stats: { cooldown: 15 },
        bonuses: [{ label: "Updated speed", numericValue: 40, valueText: "+40%" }],
        additionalUiEffects: [
          { key: "first", text: "Updated first effect" },
          { key: "second", text: "Updated second effect" },
        ],
      },
    });
  });

  it("deduplicates subculture roster rows and retains unassigned main units", () => {
    const tables: UnitViewerTableRows = {
      main_units_tables: [
        { unit: "unit_a", land_unit: "land_a", num_men: "1", caste: "melee_infantry" },
        { unit: "unit_b", land_unit: "land_b", num_men: "1" },
        { unit: "unit_c", land_unit: "land_c", num_men: "1", caste: "hero" },
        { unit: "unit_d", land_unit: "land_d", num_men: "1", caste: "lord" },
      ],
      land_units_tables: [
        { key: "land_a", man_entity: "entity", primary_melee_weapon: "weapon" },
        { key: "land_b", man_entity: "entity", primary_melee_weapon: "weapon" },
        { key: "land_c", man_entity: "entity", primary_melee_weapon: "weapon" },
        { key: "land_d", man_entity: "entity", primary_melee_weapon: "weapon" },
      ],
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      factions_tables: [
        { key: "faction_a", subculture: "subculture" },
        { key: "faction_b", subculture: "subculture" },
      ],
      units_custom_battle_permissions_tables: [
        { unit: "unit_a", faction: "faction_a" },
        { unit: "unit_a", faction: "faction_b" },
        { unit: "unit_c", faction: "faction_a" },
        { unit: "unit_d", faction: "faction_a" },
      ],
    };
    const built = buildUnitViewerData(
      tables,
      (key) =>
        ({
          land_units_onscreen_name_land_a: "Alpha",
          land_units_onscreen_name_land_b: "Beta",
          land_units_onscreen_name_land_c: "Charlie",
          land_units_onscreen_name_land_d: "{{tr:land_units_onscreen_name_shared_delta}}",
          land_units_onscreen_name_shared_delta: "Delta",
          cultures_subcultures_name_subculture: "Culture",
        })[key],
    );
    expect(built.groups.map((group) => [group.name, group.units.map((unit) => unit.key)])).toEqual([
      ["Culture", ["unit_d", "unit_c", "unit_a"]],
      ["Unassigned", ["unit_b"]],
    ]);
    expect(built.groups[0].units.map((unit) => unit.caste)).toEqual(["lord", "hero", "melee_infantry"]);
    expect(built.units.get("unit_d")?.name).toBe("Delta");
  });

  it("derives culture-specific lord subtype and associated-unit choices", () => {
    const tables: UnitViewerTableRows = {
      main_units_tables: [
        { unit: "lord_unit", land_unit: "lord_land", num_men: "1", caste: "lord" },
        { unit: "lord_unit_override", land_unit: "lord_land_override", num_men: "1", caste: "lord" },
      ],
      land_units_tables: [
        { key: "lord_land", man_entity: "entity", primary_melee_weapon: "weapon" },
        { key: "lord_land_override", man_entity: "entity", primary_melee_weapon: "weapon" },
      ],
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      factions_tables: [
        { key: "faction_a", subculture: "subculture_a" },
        { key: "faction_b", subculture: "subculture_b" },
      ],
      units_custom_battle_permissions_tables: [
        { unit: "lord_unit", faction: "faction_a" },
        { unit: "lord_unit_override", faction: "faction_b" },
      ],
      agent_subtypes_tables: [{ key: "lord_subtype", associated_unit_override: "lord_unit" }],
      agent_subtype_subculture_overrides_tables: [
        {
          subtype: "lord_subtype",
          subculture: "subculture_b",
          associated_unit_override: "lord_unit_override",
        },
      ],
    };
    const built = buildUnitViewerData(tables, (key) =>
      key === "agent_subtypes_onscreen_name_override_lord_subtype" ? "Localized Lord" : undefined,
    );

    expect(built.lordOptions).toEqual([
      {
        subtype: "lord_subtype",
        name: "Localized Lord",
        associatedUnit: "lord_unit",
        subcultureKeys: ["subculture_b", "subculture_a"],
        associatedUnitBySubculture: { subculture_b: "lord_unit_override" },
      },
    ]);
  });

  it("buckets units into the game's roster groups and falls back to the extended roster", () => {
    const tables: UnitViewerTableRows = {
      main_units_tables: [
        { unit: "unit_lord", land_unit: "land", num_men: "1", caste: "lord", ui_unit_group_land: "grouping_lord" },
        { unit: "unit_bow", land_unit: "land", num_men: "1", ui_unit_group_land: "grouping_bow" },
        { unit: "unit_spear", land_unit: "land", num_men: "1", ui_unit_group_land: "grouping_spear" },
        { unit: "unit_odd", land_unit: "land", num_men: "1", ui_unit_group_land: "grouping_missing" },
        { unit: "unit_none", land_unit: "land", num_men: "1" },
      ],
      land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon" }],
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      ui_unit_groupings_tables: [
        { key: "grouping_lord", parent_group: "commander" },
        { key: "grouping_bow", parent_group: "missile_infantry" },
        { key: "grouping_spear", parent_group: "infantry" },
        { key: "grouping_missing", parent_group: "not_in_parents" },
      ],
      ui_unit_group_parents_tables: [
        { key: "infantry", order: "20" },
        { key: "missile_infantry", order: "30" },
        { key: "commander", order: "10" },
        { key: "campaign_exclusives", order: "5" },
      ],
      factions_tables: [{ key: "faction", subculture: "subculture" }],
      units_custom_battle_permissions_tables: [
        { unit: "unit_lord", faction: "faction" },
        { unit: "unit_bow", faction: "faction" },
        { unit: "unit_spear", faction: "faction" },
        { unit: "unit_odd", faction: "faction" },
        { unit: "unit_none", faction: "faction" },
      ],
    };
    const built = buildUnitViewerData(
      tables,
      (key) =>
        ({
          ui_unit_group_parents_onscreen_name_commander: "Lords",
          ui_unit_group_parents_onscreen_name_infantry: "Infantry",
          ui_unit_group_parents_onscreen_name_missile_infantry: "Missile Infantry",
          ui_unit_group_parents_onscreen_name_campaign_exclusives: "Extended Roster",
        })[key],
    );

    expect(built.unitGroups.map((unitGroup) => unitGroup.name)).toEqual([
      "Lords",
      "Infantry",
      "Missile Infantry",
      "Extended Roster",
    ]);
    expect(Object.fromEntries(built.groups[0].units.map((unit) => [unit.key, unit.uiGroupKey]))).toEqual({
      unit_lord: "commander",
      unit_bow: "missile_infantry",
      unit_spear: "infantry",
      unit_odd: "campaign_exclusives",
      unit_none: "campaign_exclusives",
    });
    expect(built.groups[0].units[0].unitCardPath).toBe("ui\\units\\icons\\unit_lord.png");
  });

  it("keeps lords in the Lords roster section when UI grouping data puts them under Heroes", () => {
    const tables: UnitViewerTableRows = {
      main_units_tables: [
        {
          unit: "misgrouped_lord",
          land_unit: "land",
          num_men: "1",
          caste: "lord",
          ui_unit_group_land: "grouping_hero",
        },
      ],
      land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon" }],
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      ui_unit_groupings_tables: [
        { key: "grouping_hero", parent_group: "heroes_agents" },
        { key: "grouping_lord", parent_group: "commander" },
      ],
      ui_unit_group_parents_tables: [
        { key: "commander", order: "10" },
        { key: "heroes_agents", order: "20" },
      ],
      factions_tables: [{ key: "faction", subculture: "culture" }],
      units_custom_battle_permissions_tables: [{ unit: "misgrouped_lord", faction: "faction" }],
    };

    const built = buildUnitViewerData(tables, () => undefined);

    expect(Object.fromEntries(built.groups[0].units.map((unit) => [unit.key, unit.uiGroupKey]))).toEqual({
      misgrouped_lord: "commander",
    });
  });

  it("lets later mod rows replace vanilla unit and scalar constants", () => {
    const tables: UnitViewerTableRows = {
      main_units_tables: [
        { unit: "unit", land_unit: "land", num_men: "1", multiplayer_cost: "100" },
        { unit: "unit", land_unit: "land", num_men: "1", multiplayer_cost: "250" },
      ],
      land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon" }],
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      unit_experience_bonuses_tables: [
        { stat: "stat_morale", growth_rate: "0", growth_scalar: "1" },
        { stat: "stat_morale", growth_rate: "0", growth_scalar: "3" },
      ],
      unit_stat_to_size_scaling_values_tables: [
        { stat: "stat_melee_damage_base", size: "small", single_entity_value: "0.25", multi_entity_value: "1" },
        { stat: "stat_melee_damage_base", size: "small", single_entity_value: "0.5", multi_entity_value: "1" },
      ],
    };
    const built = buildUnitViewerData(tables, () => undefined);
    expect(built.units.get("unit")?.multiplayerCost).toBe(250);
    expect(built.constants.experienceBonuses).toEqual([{ stat: "stat_morale", growthRate: 0, growthScalar: 3 }]);
    expect(built.constants.sizeScaling[0].singleEntityValue).toBe(0.5);
  });

  it("resolves rider, mount and engine visual parts", () => {
    const base = {
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      unit_variants_tables: [{ unit: "land", variant: "v_man" }],
      variants_tables: [
        { variant_name: "v_man", variant_filename: "man" },
        { variant_name: "v_horse", variant_filename: "horse", scale: "1.2" },
      ],
    };
    const vmd = (name: string) => `variantmeshes\\variantmeshdefinitions\\${name}.variantmeshdefinition`;
    const build = (extra: UnitViewerTableRows) =>
      buildUnitViewerData(
        {
          ...base,
          main_units_tables: [{ unit: "unit", land_unit: "land", num_men: "1" }],
          ...extra,
        },
        () => undefined,
      ).units.get("unit")?.visualParts;

    expect(
      build({
        land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon", mount: "m" }],
        mounts_tables: [{ key: "m", variant: "v_horse" }],
      }),
    ).toEqual([
      { role: "rider", label: "Rider", variantMeshPath: vmd("man"), count: 1 },
      { role: "mount", label: "Mount", variantMeshPath: vmd("horse"), scale: 1.2, count: 1 },
    ]);
    expect(
      build({
        land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon", engine: "e" }],
        battlefield_engines_tables: [
          {
            key: "e",
            variant: "",
            model: "emp_mortar",
            rider_attachment_point: "ap_crew",
            draught_attachment_point: "",
          },
        ],
      }),
    ).toEqual([
      { role: "crew", label: "Crew", variantMeshPath: vmd("man"), count: 1 },
      { role: "engine", label: "Engine", variantMeshPath: vmd("emp_mortar"), riderAttachmentPoint: "ap_crew" },
    ]);
    const wagonParts = build({
      land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon", engine: "e" }],
      land_units_to_battle_personalities_junctions_tables: [
        { land_unit: "land", battle_personality: "p1", riders_attachment_point: "ap_crewposition_1" },
        { land_unit: "land", battle_personality: "p2", riders_attachment_point: "ap_crewposition_2" },
        { land_unit: "land", battle_personality: "missing", riders_attachment_point: "ap_crewposition_3" },
      ],
      battle_personalities_tables: [
        { key: "p1", variant: "v_gunner", man_animations_table: "crew_tbl" },
        { key: "p2", variant: "v_gunner" },
      ],
      variants_tables: [
        { variant_name: "v_man", variant_filename: "man" },
        { variant_name: "v_gunner", variant_filename: "gunner" },
      ],
      battlefield_engines_tables: [
        { key: "e", variant: "", model: "emp_war_wagon", draught_attachment_point: "ap_draughtposition" },
      ],
      warscape_animated_lod_tables: [
        {
          filename: "warmachines/chariot/emp_war_wagon/emp_war_wagon_01_lod1.wsmodel",
          range: "60",
          animated: "emp_war_wagon",
        },
        {
          filename: "warmachines/chariot/emp_war_wagon/emp_war_wagon_01.wsmodel",
          range: "0",
          animated: "emp_war_wagon",
        },
      ],
    });
    expect(wagonParts?.find((part) => part.role === "crew")).toMatchObject({
      variantMeshPath: vmd("gunner"),
      count: 2,
      animationTable: "crew_tbl",
    });
    expect(wagonParts?.find((part) => part.role === "engine")).toMatchObject({
      variantMeshPath: "warmachines\\chariot\\emp_war_wagon\\emp_war_wagon_01.wsmodel",
      draughtAttachmentPoint: "ap_draughtposition",
      techAnimPaths: ["warmachines\\chariot\\emp_war_wagon\\tech\\emp_war_wagon_01.anim"],
      engineRiders: [
        { attachmentPoint: "ap_crewposition_1", variantMeshPath: vmd("gunner"), animationTable: "crew_tbl" },
        { attachmentPoint: "ap_crewposition_2", variantMeshPath: vmd("gunner") },
      ],
    });
  });

  it("skips placeholder seat props and prefers the engine's tech folder", () => {
    const vmd = (name: string) => `variantmeshes\\variantmeshdefinitions\\${name}.variantmeshdefinition`;
    const parts = buildUnitViewerData(
      {
        main_units_tables: [{ unit: "cannon", land_unit: "cannon", num_men: "3" }],
        land_units_tables: [{ key: "cannon", man_entity: "entity", primary_melee_weapon: "weapon", engine: "e" }],
        battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
        melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
        unit_variants_tables: [{ unit: "cannon", variant: "v_crew" }],
        land_units_to_battle_personalities_junctions_tables: [
          { battle_personality: "smokestack", land_unit: "cannon", riders_attachment_point: "ap_funnel" },
        ],
        battle_personalities_tables: [{ key: "smokestack", variant: "dummy_variant" }],
        variants_tables: [
          { variant_name: "v_crew", variant_filename: "crew" },
          { variant_name: "dummy_variant", variant_filename: "dummy_variant" },
        ],
        battlefield_engines_tables: [
          {
            key: "e",
            model: "magma",
            rider_attachment_point: "ap_crewposition",
            tech_folder: "warmachines/engines/chd_deathshrieker/tech/",
          },
        ],
        warscape_animated_lod_tables: [
          {
            filename: "warmachines/engines/chd_magma_cannon/chd_magma_cannon_01.wsmodel",
            range: "0",
            animated: "magma",
          },
        ],
      },
      () => undefined,
    ).units.get("cannon")?.visualParts;
    expect(parts?.find((part) => part.role === "crew")).toMatchObject({ variantMeshPath: vmd("crew"), count: 3 });
    const engine = parts?.find((part) => part.role === "engine");
    expect(engine?.engineRiders).toBeUndefined();
    expect(engine?.techAnimPaths).toEqual([
      "warmachines\\engines\\chd_deathshrieker\\tech\\chd_magma_cannon_01.anim",
      "warmachines\\engines\\chd_deathshrieker\\tech\\chd_deathshrieker_01.anim",
      "warmachines\\engines\\chd_deathshrieker\\tech\\chd_deathshrieker.anim",
      "warmachines\\engines\\chd_magma_cannon\\tech\\chd_magma_cannon_01.anim",
    ]);
  });

  it("uses the mount as the preview model when the unit's own VMD is a placeholder", () => {
    const unit = buildUnitViewerData(
      {
        main_units_tables: [{ unit: "skullcannon", land_unit: "skullcannon", num_men: "2" }],
        land_units_tables: [
          { key: "skullcannon", man_entity: "entity", primary_melee_weapon: "weapon", mount: "m", num_mounts: "1" },
        ],
        battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
        melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
        unit_variants_tables: [{ unit: "skullcannon", variant: "dummy_variant" }],
        mounts_tables: [{ key: "m", variant: "v_cannon" }],
        variants_tables: [
          { variant_name: "dummy_variant", variant_filename: "dummy_variant" },
          { variant_name: "v_cannon", variant_filename: "dae_skullcannon" },
        ],
      },
      () => undefined,
    ).units.get("skullcannon");
    const cannon = "variantmeshes\\variantmeshdefinitions\\dae_skullcannon.variantmeshdefinition";
    expect(unit?.variantMeshPath).toBe(cannon);
    expect(unit?.visualParts?.map((part) => [part.role, part.variantMeshPath])).toEqual([["mount", cannon]]);
    expect(unit?.painterVariantContext).toBeUndefined();
  });

  it("seats personality riders on a ridden monster mount without an engine", () => {
    const vmd = (name: string) => `variantmeshes\\variantmeshdefinitions\\${name}.variantmeshdefinition`;
    const parts = buildUnitViewerData(
      {
        main_units_tables: [{ unit: "tusk", land_unit: "tusk", num_men: "1" }],
        land_units_tables: [{ key: "tusk", man_entity: "entity", primary_melee_weapon: "weapon", mount: "m" }],
        battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
        melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
        unit_variants_tables: [{ unit: "tusk", variant: "v_front" }],
        mounts_tables: [{ key: "m", variant: "v_tusk", animation: "tusk_tbl" }],
        land_units_to_battle_personalities_junctions_tables: [
          { battle_personality: "front", land_unit: "tusk", riders_attachment_point: "ap_thundertusk_rider_01" },
          { battle_personality: "back", land_unit: "tusk", riders_attachment_point: "ap_thundertusk_rider_02" },
        ],
        battle_personalities_tables: [
          { key: "front", variant: "v_front", man_animations_table: "front_tbl" },
          { key: "back", variant: "v_back", man_animations_table: "back_tbl" },
        ],
        variants_tables: [
          { variant_name: "v_front", variant_filename: "rider_front" },
          { variant_name: "v_back", variant_filename: "rider_back" },
          {
            variant_name: "v_tusk",
            variant_filename: "ogr_thundertusk",
            tech_folder: "VariantMeshes/wh_variantmodels/hq3b/ogr/ogr_thundertusk/tech/",
          },
        ],
      },
      () => undefined,
    ).units.get("tusk")?.visualParts;
    expect(parts?.find((part) => part.role === "crew")).toMatchObject({
      variantMeshPath: vmd("rider_front"),
      count: 2,
      animationTable: "front_tbl",
    });
    const mount = parts?.find((part) => part.role === "mount");
    expect(mount?.engineRiders?.map((rider) => rider.attachmentPoint)).toEqual([
      "ap_thundertusk_rider_01",
      "ap_thundertusk_rider_02",
    ]);
    expect(mount?.techAnimPaths).toContain(
      "variantmeshes\\wh_variantmodels\\hq3b\\ogr\\ogr_thundertusk\\tech\\ogr_thundertusk_01.anim",
    );
  });

  it("labels custom battle mount variants from their composite localization key", () => {
    const tables: UnitViewerTableRows = {
      main_units_tables: [
        { unit: "base_unit", land_unit: "land", num_men: "1" },
        { unit: "mounted_unit", land_unit: "land", num_men: "1" },
      ],
      land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon" }],
      battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
      melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      units_custom_battle_mounts_tables: [{ base_unit: "base_unit", mounted_unit: "mounted_unit" }],
    };
    const built = buildUnitViewerData(tables, (key) =>
      key === "units_custom_battle_mounts_mount_name_base_unitmounted_unit" ? "On Horseback" : undefined,
    );

    expect(built.units.get("base_unit")?.mountName).toBeUndefined();
    expect(built.units.get("mounted_unit")?.mountName).toBe("On Horseback");
    expect(built.groups.flatMap((group) => group.units).find((unit) => unit.key === "mounted_unit")?.mountName).toBe(
      "On Horseback",
    );
  });

  it("carries a unit's source pack into the catalog", () => {
    const built = buildUnitViewerData(
      {
        main_units_tables: [{ unit: "unit", land_unit: "land", num_men: "1" }],
        land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon" }],
        battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
        melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
      },
      () => undefined,
      new Map([["unit", "/mods/example.pack"]]),
    );

    expect(built.groups[0].units[0].originPackPath).toBe("/mods/example.pack");
  });

  it("resolves the selected unit's variant mesh definition path", () => {
    const built = buildUnitViewerData(
      {
        main_units_tables: [{ unit: "unit", land_unit: "land", num_men: "1" }],
        land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon" }],
        battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "100" }],
        melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
        unit_variants_tables: [
          {
            unit: "land",
            faction: "",
            name: "unit_variant_name",
            variant: "unit_variant",
            unit_card: "unit_card",
          },
        ],
        factions_tables: [
          {
            key: "faction_a",
            subculture: "subculture_a",
            uniform_colour_primary: "11189196",
            uniform_colour_secondary: "1122867",
            uniform_colour_tertiary: "4478310",
          },
          {
            key: "faction_b",
            subculture: "subculture_b",
            uniform_colour_primary: "14544639",
            uniform_colour_secondary: "6715272",
            uniform_colour_tertiary: "10070715",
          },
          {
            key: "faction_a_minor",
            subculture: "subculture_a",
            uniform_colour_primary: "15987699",
            uniform_colour_secondary: "8598323",
            uniform_colour_tertiary: "16777215",
          },
          {
            key: "unrelated_faction",
            subculture: "subculture_other",
            uniform_colour_primary: "16711680",
            uniform_colour_secondary: "65280",
            uniform_colour_tertiary: "255",
          },
        ],
        unit_variants_colours_tables: [
          {
            unit_variant: "land",
            faction: "faction_a",
            subculture: "",
            soldier_type: "soldier",
            primary_colour_r: "16",
            primary_colour_g: "16",
            primary_colour_b: "16",
            secondary_colour_r: "32",
            secondary_colour_g: "32",
            secondary_colour_b: "32",
            tertiary_colour_r: "48",
            tertiary_colour_g: "48",
            tertiary_colour_b: "48",
          },
          {
            unit_variant: "land",
            faction: "",
            subculture: "subculture_b",
            soldier_type: "soldier",
            primary_colour_r: "64",
            primary_colour_g: "64",
            primary_colour_b: "64",
            secondary_colour_r: "80",
            secondary_colour_g: "80",
            secondary_colour_b: "80",
            tertiary_colour_r: "96",
            tertiary_colour_g: "96",
            tertiary_colour_b: "96",
          },
          {
            unit_variant: "land",
            faction: "",
            subculture: "",
            soldier_type: "mount",
            primary_colour_r: "112",
            primary_colour_g: "112",
            primary_colour_b: "112",
            secondary_colour_r: "128",
            secondary_colour_g: "128",
            secondary_colour_b: "128",
            tertiary_colour_r: "144",
            tertiary_colour_g: "144",
            tertiary_colour_b: "144",
          },
        ],
        variants_tables: [
          {
            variant_name: "unit_variant",
            tech_folder: "tech",
            variant_filename: "units\\human",
            low_poly_filename: "low\\human",
            mount_scale: "1.0000",
            scale: "1.0500",
            scale_variation: "0.0500",
            super_low_poly_filename: "imposter\\human",
          },
        ],
        units_custom_battle_permissions_tables: [
          { unit: "unit", faction: "faction_b" },
          { unit: "unit", faction: "faction_a" },
        ],
      },
      () => undefined,
    );

    expect(built.units.get("unit")?.variantMeshPath).toBe(
      "variantmeshes\\variantmeshdefinitions\\units\\human.variantmeshdefinition",
    );
    expect(built.groups[0].units[0].variantMeshPath).toBe(
      "variantmeshes\\variantmeshdefinitions\\units\\human.variantmeshdefinition",
    );
    expect(built.units.get("unit")?.painterVariantContext).toEqual({
      unitKey: "land",
      faction: "",
      variantName: "unit_variant",
      unitVariantName: "unit_variant_name",
      unitCard: "unit_card",
      variantDetails: {
        techFolder: "tech",
        variantFilename: "units\\human",
        lowPolyFilename: "low\\human",
        mountScale: "1.0000",
        scale: "1.0500",
        scaleVariation: "0.0500",
        superLowPolyFilename: "imposter\\human",
      },
      availableFactions: ["faction_a", "faction_b"],
      factionColours: [
        {
          faction: "faction_a",
          subculture: "subculture_a",
          primary: "#aabbcc",
          secondary: "#112233",
          tertiary: "#445566",
        },
        {
          faction: "faction_a_minor",
          subculture: "subculture_a",
          primary: "#f3f3f3",
          secondary: "#833333",
          tertiary: "#ffffff",
        },
        {
          faction: "faction_b",
          subculture: "subculture_b",
          primary: "#ddeeff",
          secondary: "#667788",
          tertiary: "#99aabb",
        },
      ],
      unitVariantColours: [
        {
          faction: "faction_a",
          subculture: "",
          soldierType: "soldier",
          primary: "#101010",
          secondary: "#202020",
          tertiary: "#303030",
        },
        {
          faction: "",
          subculture: "subculture_b",
          soldierType: "soldier",
          primary: "#404040",
          secondary: "#505050",
          tertiary: "#606060",
        },
        {
          faction: "",
          subculture: "",
          soldierType: "mount",
          primary: "#707070",
          secondary: "#808080",
          tertiary: "#909090",
        },
      ],
    });
  });

  it("keeps faction color filtering, ordering and per-unit objects independent", () => {
    const colours = {
      uniform_colour_primary: "16711680",
      uniform_colour_secondary: "65280",
      uniform_colour_tertiary: "255",
    };
    const built = buildUnitViewerData(
      {
        main_units_tables: ["restricted", "unrestricted", "other"].map((unit) => ({ unit, land_unit: "land" })),
        land_units_tables: [{ key: "land", man_entity: "entity" }],
        battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100" }],
        unit_variants_tables: [{ unit: "land", variant: "variant" }],
        variants_tables: [{ variant_name: "variant", variant_filename: "units/human" }],
        factions_tables: [
          { key: "faction_z", subculture: "other", ...colours },
          { key: "faction_invalid", subculture: "selected", ...colours, uniform_colour_tertiary: "" },
          { key: "faction_explicit", subculture: "", ...colours },
          { key: "faction_a", subculture: "selected", ...colours },
        ],
        units_custom_battle_permissions_tables: [
          { unit: "restricted", faction: "faction_a" },
          { unit: "restricted", faction: "faction_explicit" },
        ],
      },
      () => undefined,
    );
    const restricted = built.units.get("restricted")?.painterVariantContext?.factionColours;
    const unrestricted = built.units.get("unrestricted")?.painterVariantContext?.factionColours;
    const other = built.units.get("other")?.painterVariantContext?.factionColours;
    expect(restricted?.map((colour) => colour.faction)).toEqual(["faction_a", "faction_explicit"]);
    expect(unrestricted?.map((colour) => colour.faction)).toEqual(["faction_a", "faction_explicit", "faction_z"]);
    expect(other).toEqual(unrestricted);
    expect(other).not.toBe(unrestricted);
    expect(other?.[0]).not.toBe(unrestricted?.[0]);
    unrestricted![0].primary = "#000000";
    expect(other?.[0].primary).toBe("#ff0000");
  });

  it("resolves character XP with campaign and agent-specific rows taking precedence", () => {
    const built = buildUnitViewerData(
      {
        character_experience_skill_tiers_tables: [
          { agent_key: "", skill_rank: "4", experience_threshold: "1000", for_army: "false", for_navy: "false" },
          { agent_key: "general", skill_rank: "4", experience_threshold: "1500", for_army: "true", for_navy: "false" },
          {
            agent_key: "general",
            skill_rank: "4",
            experience_threshold: "2000",
            optional_campaign_key: "campaign_a",
            for_army: "true",
            for_navy: "false",
          },
        ],
        faction_agent_permitted_subtypes_tables: [
          { faction: "faction_a", agent: "general", subtype: "lord_a", mod_disabled: "false" },
        ],
      },
      () => undefined,
    );

    expect(
      resolveCharacterExperienceThreshold(built.characterExperience, {
        faction: "faction_a",
        subtype: "lord_a",
        campaign: "campaign_a",
        rank: 4,
        forArmy: true,
      }),
    ).toBe(2000);
    expect(
      resolveCharacterExperienceThreshold(built.characterExperience, {
        faction: "faction_a",
        subtype: "lord_a",
        campaign: "campaign_b",
        rank: 4,
        forArmy: true,
      }),
    ).toBe(1500);
    expect(
      resolveCharacterExperienceThreshold(built.characterExperience, {
        rank: 4,
        forArmy: false,
      }),
    ).toBe(1000);
  });
});
