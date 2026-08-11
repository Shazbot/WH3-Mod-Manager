import { describe, expect, it } from "vitest";

import { calculateUnitViewerStats } from "../src/unitViewer/calculator";
import { buildUnitViewerData, type UnitViewerTableRows } from "../src/unitViewer/data";
import type {
  UnitViewerConstants,
  UnitViewerEntity,
  UnitViewerUnitModel,
} from "../src/unitViewer/types";

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
  shortDescription: "",
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
    const engineEntity = { ...rider, key: "engine", type: "artillery", hitPoints: 425, runSpeed: 2, chargeSpeed: 2, mass: 2000 };
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

describe("Unit Viewer catalog", () => {
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
    const built = buildUnitViewerData(tables, (key) => ({
      land_units_onscreen_name_land_a: "Alpha",
      land_units_onscreen_name_land_b: "Beta",
      land_units_onscreen_name_land_c: "Charlie",
      land_units_onscreen_name_land_d: "Delta",
      cultures_subcultures_name_subculture: "Culture",
    })[key]);
    expect(built.groups.map((group) => [group.name, group.units.map((unit) => unit.key)])).toEqual([
      ["Culture", ["unit_d", "unit_c", "unit_a"]],
      ["Unassigned", ["unit_b"]],
    ]);
    expect(built.groups[0].units.map((unit) => unit.caste)).toEqual(["lord", "hero", "melee_infantry"]);
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
    expect(built.constants.experienceBonuses).toEqual([
      { stat: "stat_morale", growthRate: 0, growthScalar: 3 },
    ]);
    expect(built.constants.sizeScaling[0].singleEntityValue).toBe(0.5);
  });
});
