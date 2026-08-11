import type {
  UnitViewerAbility,
  UnitViewerCatalogGroup,
  UnitViewerConstants,
  UnitViewerEntity,
  UnitViewerFatigue,
  UnitViewerMeleeWeapon,
  UnitViewerMissileWeapon,
  UnitViewerProjectile,
  UnitViewerUnitModel,
  UnitViewerUnitSize,
} from "./types";

export type UnitViewerTableRows = Record<string, Array<Record<string, string>>>;

export const UNIT_VIEWER_TABLES = [
  "main_units_tables",
  "land_units_tables",
  "battle_entities_tables",
  "mounts_tables",
  "battlefield_engines_tables",
  "land_unit_articulated_vehicles_tables",
  "unit_armour_types_tables",
  "unit_shield_types_tables",
  "melee_weapons_tables",
  "missile_weapons_tables",
  "projectiles_tables",
  "projectiles_explosions_tables",
  "units_custom_battle_permissions_tables",
  "factions_tables",
  "unit_variants_tables",
  "land_units_to_unit_abilites_junctions_tables",
  "unit_attributes_to_groups_junctions_tables",
  "special_ability_groups_to_units_junctions_tables",
  "special_ability_groups_to_unit_abilities_junctions_tables",
  "unit_abilities_tables",
  "unit_special_abilities_tables",
  "unit_experience_bonuses_tables",
  "unit_stats_land_experience_bonuses_tables",
  "unit_fatigue_effects_tables",
  "unit_stat_to_size_scaling_values_tables",
  "ui_unit_stats_tables",
  "ground_type_to_stat_effects_tables",
  "_kv_morale_tables",
] as const;

const asString = (value: unknown) => (value == null ? "" : String(value));
const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const asBool = (value: unknown) => value === true || value === "true" || value === "1" || value === 1;

const indexRows = (rows: Array<Record<string, string>> | undefined, key: string) => {
  const result = new Map<string, Record<string, string>>();
  for (const row of rows || []) {
    const rowKey = asString(row[key]);
    if (rowKey) result.set(rowKey, row);
  }
  return result;
};

const groupRows = (rows: Array<Record<string, string>> | undefined, key: string) => {
  const result = new Map<string, Array<Record<string, string>>>();
  for (const row of rows || []) {
    const rowKey = asString(row[key]);
    if (!rowKey) continue;
    const group = result.get(rowKey) || [];
    group.push(row);
    result.set(rowKey, group);
  }
  return result;
};

const stripGameMarkup = (value: string) =>
  value
    .replace(/\\n/g, "\n")
    .replace(/\[\[img:.*?\]\]\[\[\/img\]\]/gi, "")
    .replace(/\[\[\/?(?:b|i|col(?::[^\]]+)?)\]\]/gi, "")
    .replace(/\{\{tr:[^}]+\}\}/gi, "")
    .trim();

const splitAttributeText = (value: string, fallback: string) => {
  const [name, ...description] = stripGameMarkup(value).split("||");
  return { name: name || fallback, description: description.join("||") };
};

const getCasteSortOrder = (caste: string) => {
  const normalized = caste.toLowerCase();
  if (normalized === "lord") return 0;
  if (normalized === "hero") return 1;
  return 2;
};

const toEntity = (row: Record<string, string> | undefined): UnitViewerEntity | undefined => {
  if (!row) return undefined;
  return {
    key: asString(row.key),
    type: asString(row.type),
    walkSpeed: asNumber(row.walk_speed),
    runSpeed: asNumber(row.run_speed),
    flySpeed: asNumber(row.fly_speed),
    chargeSpeed: asNumber(row.charge_speed),
    mass: asNumber(row.mass),
    hitPoints: asNumber(row.hit_points),
    size: asString(row.size),
  };
};

const toMeleeWeapon = (row: Record<string, string> | undefined): UnitViewerMeleeWeapon => ({
  key: asString(row?.key),
  baseDamage: asNumber(row?.damage),
  apDamage: asNumber(row?.ap_damage),
  bonusVsLarge: asNumber(row?.bonus_v_large),
  bonusVsInfantry: asNumber(row?.bonus_v_infantry),
  attackInterval: asNumber(row?.melee_attack_interval),
  splashTargetSize: asString(row?.splash_attack_target_size) || undefined,
  splashMaxAttacks: asNumber(row?.splash_attack_max_attacks),
  isMagical: asBool(row?.is_magical),
  ignitionAmount: asNumber(row?.ignition_amount),
});

const buildProjectile = (
  projectileRow: Record<string, string> | undefined,
  explosions: Map<string, Record<string, string>>,
): UnitViewerProjectile | undefined => {
  if (!projectileRow) return undefined;
  const explosion = explosions.get(asString(projectileRow.explosion_type));
  return {
    key: asString(projectileRow.key),
    range: asNumber(projectileRow.effective_range),
    baseDamage: asNumber(projectileRow.damage),
    apDamage: asNumber(projectileRow.ap_damage),
    projectileNumber: Math.max(1, asNumber(projectileRow.projectile_number)),
    shotsPerVolley: Math.max(1, asNumber(projectileRow.shots_per_volley)),
    burstSize: Math.max(1, asNumber(projectileRow.burst_size)),
    baseReloadTime: asNumber(projectileRow.base_reload_time),
    bonusVsLarge: asNumber(projectileRow.bonus_v_large),
    bonusVsInfantry: asNumber(projectileRow.bonus_v_infantry),
    explosionBaseDamage: asNumber(explosion?.detonation_damage),
    explosionApDamage: asNumber(explosion?.detonation_damage_ap),
    explosionRadius: asNumber(explosion?.detonation_radius),
    isMagical: asBool(projectileRow.is_magical) || asBool(explosion?.is_magical),
    ignitionAmount: asNumber(projectileRow.ignition_amount) || asNumber(explosion?.ignition_amount),
  };
};

const buildMissileWeapon = (
  key: string,
  weapons: Map<string, Record<string, string>>,
  projectiles: Map<string, Record<string, string>>,
  explosions: Map<string, Record<string, string>>,
): UnitViewerMissileWeapon | undefined => {
  const weapon = weapons.get(key);
  if (!weapon) return undefined;
  const projectile = buildProjectile(projectiles.get(asString(weapon.default_projectile)), explosions);
  if (!projectile) return undefined;
  return {
    key,
    useSecondaryAmmoPool: asBool(weapon.use_secondary_ammo_pool),
    projectile,
  };
};

const normalizeIconPath = (iconName: string) => {
  if (!iconName) return undefined;
  const withExtension = /\.(png|jpg|jpeg|webp)$/i.test(iconName) ? iconName : `${iconName}.png`;
  return `ui\\battle ui\\ability_icons\\${withExtension}`.toLowerCase();
};

const normalizeUiPath = (path: string) => path.replace(/\//g, "\\").replace(/\\+/g, "\\").toLowerCase();

const buildAbility = (
  key: string,
  isSpell: boolean,
  abilities: Map<string, Record<string, string>>,
  specialAbilities: Map<string, Record<string, string>>,
  getLoc: (key: string) => string | undefined,
): UnitViewerAbility | undefined => {
  const ability = abilities.get(key);
  const special = specialAbilities.get(key);
  if (!ability && !special) return undefined;
  const type = asString(ability?.type);
  const sourceType = asString(ability?.source_type);
  return {
    key,
    passive: asBool(special?.passive),
    isSpell,
    tooltip: {
      key,
      name: stripGameMarkup(getLoc(`unit_abilities_onscreen_name_${key}`) || key),
      description: stripGameMarkup(getLoc(`unit_abilities_tooltip_text_${key}`) || ""),
      sourceTypeName: stripGameMarkup(
        getLoc(`unit_ability_source_types_name_${sourceType}`) || sourceType,
      ),
      loreGroupName: "",
      abilityTypeName: stripGameMarkup(getLoc(`unit_ability_types_onscreen_name_${type}`) || type),
      overpowerOption: asString(ability?.overpower_option) || undefined,
      iconPath: normalizeIconPath(asString(ability?.icon_name)),
      stats: {
        range: asNumber(special?.target_intercept_range) > 0 ? asNumber(special?.target_intercept_range) : undefined,
        cooldown: asNumber(special?.recharge_time) > 0 ? asNumber(special?.recharge_time) : undefined,
        duration: asNumber(special?.active_time) > 0 ? asNumber(special?.active_time) : undefined,
        effectRange: asNumber(special?.effect_range) > 0 ? asNumber(special?.effect_range) : undefined,
        womCost: asNumber(special?.mana_cost) > 0 ? asNumber(special?.mana_cost) : undefined,
        miscastChance: asNumber(special?.miscast_chance) > 0 ? asNumber(special?.miscast_chance) * 100 : undefined,
        minRange: asNumber(special?.min_range) > 0 ? asNumber(special?.min_range) : undefined,
      },
      bonuses: [],
      additionalUiEffects: [],
    },
  };
};

export interface BuiltUnitViewerData {
  groups: UnitViewerCatalogGroup[];
  units: Map<string, UnitViewerUnitModel>;
  constants: UnitViewerConstants;
  iconPathsByUnit: Map<string, string[]>;
}

export const buildUnitViewerData = (
  tables: UnitViewerTableRows,
  getLoc: (key: string) => string | undefined,
): BuiltUnitViewerData => {
  const landUnits = indexRows(tables.land_units_tables, "key");
  const entities = indexRows(tables.battle_entities_tables, "key");
  const mounts = indexRows(tables.mounts_tables, "key");
  const engines = indexRows(tables.battlefield_engines_tables, "key");
  const articulated = indexRows(tables.land_unit_articulated_vehicles_tables, "key");
  const armour = indexRows(tables.unit_armour_types_tables, "key");
  const shields = indexRows(tables.unit_shield_types_tables, "key");
  const meleeWeapons = indexRows(tables.melee_weapons_tables, "key");
  const missileWeapons = indexRows(tables.missile_weapons_tables, "key");
  const projectiles = indexRows(tables.projectiles_tables, "key");
  const explosions = indexRows(tables.projectiles_explosions_tables, "key");
  const factions = indexRows(tables.factions_tables, "key");
  const unitVariants = groupRows(tables.unit_variants_tables, "unit");
  const permissions = groupRows(tables.units_custom_battle_permissions_tables, "unit");
  const directAbilities = groupRows(tables.land_units_to_unit_abilites_junctions_tables, "land_unit");
  const attributesByGroup = groupRows(tables.unit_attributes_to_groups_junctions_tables, "attribute_group");
  const abilityGroupsByUnit = groupRows(tables.special_ability_groups_to_units_junctions_tables, "unit");
  const abilitiesByGroup = groupRows(
    tables.special_ability_groups_to_unit_abilities_junctions_tables,
    "special_ability_groups",
  );
  const abilities = indexRows(tables.unit_abilities_tables, "key");
  const specialAbilities = indexRows(tables.unit_special_abilities_tables, "key");
  const groundEffectsByGroup = groupRows(tables.ground_type_to_stat_effects_tables, "affected_group");
  const uiUnitStats = indexRows(tables.ui_unit_stats_tables, "key");

  const experienceBonusRows = indexRows(tables.unit_experience_bonuses_tables, "stat");
  const rankBonusRows = indexRows(tables.unit_stats_land_experience_bonuses_tables, "xp_level");
  const sizeScalingRows = new Map<string, Record<string, string>>();
  for (const row of tables.unit_stat_to_size_scaling_values_tables || []) {
    sizeScalingRows.set(`${asString(row.stat)}|${asString(row.size)}`, row);
  }

  const constants: UnitViewerConstants = {
    experienceBonuses: Array.from(experienceBonusRows.values()).map((row) => ({
      stat: asString(row.stat),
      growthRate: asNumber(row.growth_rate),
      growthScalar: asNumber(row.growth_scalar),
    })),
    rankBonuses: Array.from(rankBonusRows.values()).map((row) => ({
      rank: asNumber(row.xp_level),
      fatigueModifier: asNumber(row.fatigue),
      multiplayerFixedCost: asNumber(row.mp_fixed_cost),
      multiplayerCostMultiplier: asNumber(row.mp_experience_cost_multiplier) || 1,
    })),
    fatigueEffects: {},
    fatigueMorale: {},
    sizeScaling: Array.from(sizeScalingRows.values()).map((row) => ({
      stat: asString(row.stat),
      size: asString(row.size) as UnitViewerUnitSize,
      singleEntityValue: asNumber(row.single_entity_value) || 1,
      multiEntityValue: asNumber(row.multi_entity_value) || 1,
    })),
    statIconPaths: Object.fromEntries(
      Array.from(uiUnitStats.values())
        .map((row) => [asString(row.key), normalizeUiPath(asString(row.icon))] as const)
        .filter(([, iconPath]) => !!iconPath),
    ),
  };
  for (const row of tables.unit_fatigue_effects_tables || []) {
    const fatigue = asString(row.fatigue_level) as UnitViewerFatigue;
    constants.fatigueEffects[fatigue] ||= {};
    constants.fatigueEffects[fatigue]![asString(row.stat)] = asNumber(row.value);
  }
  const moraleByKey = indexRows(tables._kv_morale_tables, "key");
  for (const fatigue of [
    "threshold_fresh",
    "threshold_active",
    "threshold_winded",
    "threshold_tired",
    "threshold_very_tired",
    "threshold_exhausted",
  ] as UnitViewerFatigue[]) {
    const moraleKey = `ume_concerned_${fatigue.replace("threshold_", "")}`;
    constants.fatigueMorale[fatigue] = asNumber(moraleByKey.get(moraleKey)?.value);
  }

  const units = new Map<string, UnitViewerUnitModel>();
  const iconPathsByUnit = new Map<string, string[]>();
  const subcultureToUnits = new Map<string, Set<string>>();

  for (const main of indexRows(tables.main_units_tables, "unit").values()) {
    const key = asString(main.unit);
    const landUnitKey = asString(main.land_unit);
    const land = landUnits.get(landUnitKey);
    if (!key || !land) continue;
    const baseEntity = toEntity(entities.get(asString(land.man_entity)));
    if (!baseEntity) continue;
    const mount = mounts.get(asString(land.mount));
    const engine = engines.get(asString(land.engine));
    const articulatedVehicle = articulated.get(asString(land.articulated_record));
    const mountEntity = toEntity(entities.get(asString(mount?.entity)));
    const engineEntity = toEntity(entities.get(asString(engine?.battle_entity)));
    const articulatedEntity = toEntity(entities.get(asString(articulatedVehicle?.articulated_entity)));
    const directAbilityKeys = (directAbilities.get(landUnitKey) || []).map((row) => asString(row.ability));
    const spellGroupRows = [
      ...(abilityGroupsByUnit.get(landUnitKey) || []),
      ...(key === landUnitKey ? [] : abilityGroupsByUnit.get(key) || []),
    ];
    const spellAbilityKeys = spellGroupRows
      .flatMap((row) => abilitiesByGroup.get(asString(row.ability_group)) || [])
      .map((row) => asString(row.unit_special_abilities));
    const unitAbilities = Array.from(new Set([...directAbilityKeys, ...spellAbilityKeys]))
      .map((abilityKey) =>
        buildAbility(abilityKey, spellAbilityKeys.includes(abilityKey), abilities, specialAbilities, getLoc),
      )
      .filter((ability): ability is UnitViewerAbility => !!ability);
    const attributeRows = attributesByGroup.get(asString(land.attribute_group)) || [];
    const unitAttributes = attributeRows.map((row) => {
      const attributeKey = asString(row.attribute);
      const localized = splitAttributeText(
        getLoc(`unit_attributes_bullet_text_${attributeKey}`) || "",
        attributeKey,
      );
      return {
        key: attributeKey,
        ...localized,
        iconPath: normalizeIconPath(attributeKey)!,
      };
    });
    const variantRows = (unitVariants.get(landUnitKey) || []).toReversed();
    const variant = variantRows.find((row) => !asString(row.faction)) || variantRows[0];
    const unitCardName = asString(variant?.unit_card) || key;
    const generalPortrait = (permissions.get(key) || [])
      .toReversed()
      .map((permission) => asString(permission.general_portrait))
      .find(Boolean);
    const unitCardPath = generalPortrait
      ? generalPortrait.replace(/\//g, "\\").replace(/portholes/gi, "units").toLowerCase()
      : `ui\\units\\icons\\${unitCardName}.png`.toLowerCase();
    const engineMissileKey = asString(engine?.missile_weapon);
    const landMissileKey = asString(land.primary_missile_weapon);
    const missileCandidates = [engineMissileKey, landMissileKey]
      .filter((candidate, index, all) => !!candidate && all.indexOf(candidate) === index)
      .map((candidate) => buildMissileWeapon(candidate, missileWeapons, projectiles, explosions))
      .filter((candidate): candidate is UnitViewerMissileWeapon => !!candidate);
    const primaryMissileWeapon = missileCandidates.find((candidate) => !candidate.useSecondaryAmmoPool);
    const secondaryMissileWeapon = missileCandidates.find((candidate) => candidate.useSecondaryAmmoPool);

    const model: UnitViewerUnitModel = {
      key,
      landUnitKey,
      name: stripGameMarkup(getLoc(`land_units_onscreen_name_${landUnitKey}`) || key),
      caste: asString(main.caste),
      category: asString(land.category),
      shortDescription: stripGameMarkup(getLoc(`land_units_short_description_text_${landUnitKey}`) || ""),
      numMen: asNumber(main.num_men),
      multiplayerCost: asNumber(main.multiplayer_cost),
      recruitmentCost: asNumber(main.recruitment_cost),
      upkeepCost: asNumber(main.upkeep_cost),
      barrierHealth: asNumber(main.barrier_health),
      isRenown: asBool(main.is_renown),
      isHighThreat: asBool(main.is_high_threat),
      canSiege: asBool(main.can_siege),
      canSkirmish: asBool(land.can_skirmish),
      accuracy: asNumber(land.accuracy),
      armour: asNumber(armour.get(asString(land.armour))?.armour_value),
      shieldBlock: asNumber(
        shields.get(asString(land.shield))?.missile_block_chance ??
          shields.get(asString(land.shield))?.parry_chance,
      ),
      chargeBonus: asNumber(land.charge_bonus),
      meleeAttack: asNumber(land.melee_attack),
      meleeDefence: asNumber(land.melee_defence),
      leadership: asNumber(land.morale),
      bonusHitPoints: asNumber(land.bonus_hit_points),
      numMounts: asNumber(land.num_mounts),
      numEngines: asNumber(land.num_engines),
      reload: asNumber(land.reload),
      primaryAmmo: asNumber(land.primary_ammo),
      secondaryAmmo: asNumber(land.secondary_ammo),
      fireResistance: asNumber(land.damage_mod_flame),
      magicResistance: asNumber(land.damage_mod_magic),
      physicalResistance: asNumber(land.damage_mod_physical),
      missileResistance: asNumber(land.damage_mod_missile),
      wardSave: asNumber(land.damage_mod_all),
      groundStatEffectGroup: asString(land.ground_stat_effect_group),
      groundStatEffects: (groundEffectsByGroup.get(asString(land.ground_stat_effect_group)) || []).map((row) => ({
        groundType: stripGameMarkup(
          getLoc(`ground_types_onscreen_name_${asString(row.ground_type)}`) || asString(row.ground_type),
        ),
        stat: stripGameMarkup(
          getLoc(`unit_stat_localisations_onscreen_name_${asString(row.affected_stat)}`) ||
            asString(row.affected_stat),
        ),
        multiplier: asNumber(row.multiplier),
      })),
      baseEntity,
      mountEntity,
      engineEntity,
      articulatedEntity,
      meleeWeapon: toMeleeWeapon(meleeWeapons.get(asString(land.primary_melee_weapon))),
      primaryMissileWeapon,
      secondaryMissileWeapon,
      unitCardPath,
      attributes: unitAttributes,
      abilities: unitAbilities,
    };
    units.set(key, model);
    iconPathsByUnit.set(
      key,
      Array.from(new Set([
        ...unitAbilities.map((ability) => ability.tooltip.iconPath),
        ...unitAttributes.map((attribute) => attribute.iconPath),
        ...Object.values(constants.statIconPaths),
      ].filter((path): path is string => !!path))),
    );

    const subcultures = new Set<string>();
    for (const permission of permissions.get(key) || []) {
      const subculture = asString(factions.get(asString(permission.faction))?.subculture);
      if (subculture) subcultures.add(subculture);
    }
    if (subcultures.size === 0) subcultures.add("__unassigned");
    for (const subculture of subcultures) {
      const unitKeys = subcultureToUnits.get(subculture) || new Set<string>();
      unitKeys.add(key);
      subcultureToUnits.set(subculture, unitKeys);
    }
  }

  const collator = new Intl.Collator("en");
  const groups: UnitViewerCatalogGroup[] = Array.from(subcultureToUnits.entries())
    .map(([key, unitKeys]) => ({
      key,
      name:
        key === "__unassigned"
          ? "Unassigned"
          : stripGameMarkup(getLoc(`cultures_subcultures_name_${key}`) || key),
      units: Array.from(unitKeys)
        .map((unitKey) => units.get(unitKey)!)
        .filter(Boolean)
        .map((unit) => ({
          key: unit.key,
          name: unit.name,
          category: unit.category,
          caste: unit.caste,
          subcultureKeys: Array.from(subcultureToUnits.entries())
            .filter(([, keys]) => keys.has(unit.key))
            .map(([subculture]) => subculture),
        }))
        .sort((first, second) =>
          getCasteSortOrder(first.caste) - getCasteSortOrder(second.caste) ||
          collator.compare(first.name, second.name) ||
          collator.compare(first.key, second.key),
        ),
    }))
    .sort((first, second) => {
      if (first.key === "__unassigned") return 1;
      if (second.key === "__unassigned") return -1;
      return collator.compare(first.name, second.name);
    });

  return { groups, units, constants, iconPathsByUnit };
};
