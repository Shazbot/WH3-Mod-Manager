import type {
  UnitViewerAbility,
  UnitViewerCatalogGroup,
  UnitViewerUiGroup,
  UnitViewerConstants,
  UnitViewerEntity,
  UnitViewerFatigue,
  UnitViewerMeleeWeapon,
  UnitViewerMissileWeapon,
  UnitViewerProjectile,
  UnitViewerUnitModel,
  UnitViewerUnitSize,
} from "./types";
import { resolveTextReplacements } from "../skills";

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
  "special_ability_to_special_ability_phase_junctions_tables",
  "special_ability_phases_tables",
  "special_ability_phase_stat_effects_tables",
  "unit_abilities_to_additional_ui_effects_juncs_tables",
  "unit_abilities_additional_ui_effects_tables",
  "unit_experience_bonuses_tables",
  "unit_stats_land_experience_bonuses_tables",
  "unit_fatigue_effects_tables",
  "unit_stat_to_size_scaling_values_tables",
  "ui_unit_stats_tables",
  "ui_unit_groupings_tables",
  "ui_unit_group_parents_tables",
  "ground_type_to_stat_effects_tables",
  "_kv_morale_tables",
] as const;

/** Bucket that collects units the game does not assign to a roster group. */
const EXTENDED_ROSTER_GROUP_KEY = "campaign_exclusives";

/** Only used when ui_unit_group_parents has no usable `order` column to sort on. */
const UI_UNIT_GROUP_FALLBACK_ORDER = [
  "commander",
  "heroes_agents",
  "infantry",
  "missile_infantry",
  "cavalry_chariots",
  "missile_cavalry_chariots",
  "monster_beasts",
  "missile_monster_beasts",
  "flying_war_machine",
  "artillery_war_machines",
  "constructs",
];

const UNIT_VIEWER_USED_STAT_ICON_KEYS = new Set([
  "scalar_charge_speed",
  "scalar_missile_damage_ap",
  "scalar_missile_damage_base",
  "scalar_missile_explosion_damage_ap",
  "scalar_missile_explosion_damage_base",
  "scalar_missile_range",
  "scalar_speed",
  "stat_ammo",
  "stat_armour",
  "stat_bonus_vs_infantry",
  "stat_bonus_vs_large",
  "stat_charge_bonus",
  "stat_health",
  "stat_mass",
  "stat_melee_attack",
  "stat_melee_damage_ap",
  "stat_melee_damage_base",
  "stat_melee_defence",
  "stat_missile_block_chance",
  "stat_missile_damage_over_time",
  "stat_morale",
  "stat_reloading",
  "stat_resistance_all",
  "stat_resistance_flame",
  "stat_resistance_magic",
  "stat_resistance_missile",
  "stat_resistance_physical",
  "stat_weapon_damage",
]);

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
    .trim();

const resolveGameText = (value: string, getLoc: (key: string) => string | undefined) =>
  stripGameMarkup(resolveTextReplacements(value, getLoc) || value);

const splitAttributeText = (
  value: string,
  fallback: string,
  getLoc: (key: string) => string | undefined,
) => {
  const [name, ...description] = resolveGameText(value, getLoc).split("||");
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

const getBonusValuePresentation = (how: string, value: number, key: string) => {
  if (how === "mult") {
    const rawPercentage = (value - 1) * 100;
    const percentage = Number.isInteger(rawPercentage)
      ? rawPercentage
      : Math.round(rawPercentage * 100) / 100;
    return {
      valueText: `${percentage > 0 ? "+" : ""}${percentage}%`,
      numericValue: percentage,
      valueSuffix: "%",
    };
  }

  const rounded = Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  const suffix = key.startsWith("scalar_") ? "%" : "";
  return {
    valueText: `${rounded > 0 ? "+" : ""}${rounded}${suffix}`,
    numericValue: rounded,
    valueSuffix: suffix,
  };
};

const buildAbility = (
  key: string,
  isSpell: boolean,
  abilities: Map<string, Record<string, string>>,
  specialAbilities: Map<string, Record<string, string>>,
  abilityPhases: Map<string, Array<Record<string, string>>>,
  phases: Map<string, Record<string, string>>,
  phaseStatEffects: Map<string, Array<Record<string, string>>>,
  uiUnitStats: Map<string, Record<string, string>>,
  additionalEffectsByAbility: Map<string, Array<Record<string, string>>>,
  additionalEffects: Map<string, Record<string, string>>,
  getLoc: (key: string) => string | undefined,
): UnitViewerAbility | undefined => {
  const ability = abilities.get(key);
  const special = specialAbilities.get(key);
  if (!ability && !special) return undefined;
  const type = asString(ability?.type);
  const sourceType = asString(ability?.source_type);
  const phaseIds = Array.from(
    new Set((abilityPhases.get(key) || []).map((row) => asString(row.phase)).filter(Boolean)),
  );
  const bonuses: AbilityTooltipBonusData[] = [];
  for (const phaseId of phaseIds) {
    for (const effect of phaseStatEffects.get(phaseId) || []) {
      const stat = asString(effect.stat);
      const how = asString(effect.how);
      if (!stat || !how) continue;
      const value = asNumber(effect.value);
      const presentation = getBonusValuePresentation(how, value, stat);
      bonuses.push({
        key: `${phaseId}:${stat}:${how}`,
        compareKey: `${stat}:${how}`,
        label: resolveGameText(
          getLoc(`unit_stat_localisations_onscreen_name_${stat}`) || stat,
          getLoc,
        ),
        valueText: presentation.valueText,
        numericValue: presentation.numericValue,
        valueSuffix: presentation.valueSuffix,
        isPositive: (how === "mult" && value >= 1) || (how !== "mult" && value >= 0),
        iconPath: normalizeUiPath(asString(uiUnitStats.get(stat)?.icon)) || undefined,
      });
    }

    const fatigueChangeRatio = asNumber(phases.get(phaseId)?.fatigue_change_ratio);
    if (fatigueChangeRatio !== 0) {
      const fatiguePerSecond = Math.round(fatigueChangeRatio * 100);
      bonuses.push({
        key: `${phaseId}:fatigue_change_ratio`,
        compareKey: "fatigue_change_ratio",
        label: resolveGameText(
          getLoc("random_localisation_strings_string_fatigue") || "Vigour per second",
          getLoc,
        ),
        valueText: `${fatiguePerSecond > 0 ? "+" : ""}${fatiguePerSecond}%`,
        numericValue: fatiguePerSecond,
        valueSuffix: "%",
        isPositive: fatiguePerSecond >= 0,
      });
    }
  }
  const additionalUiEffects = Array.from(
    new Set(
      (additionalEffectsByAbility.get(key) || [])
        .map((row) => asString(row.effect))
        .filter(Boolean),
    ),
  )
    .map((effectKey) => {
      const effect = additionalEffects.get(effectKey);
      return {
        key: effectKey,
        text: resolveGameText(
          getLoc(`unit_abilities_additional_ui_effects_localised_text_${effectKey}`) || effectKey,
          getLoc,
        ),
        sortOrder: effect ? asNumber(effect.sort_order) : undefined,
        effectState: asString(effect?.effect_state) || undefined,
      };
    })
    .sort((first, second) => (first.sortOrder || 0) - (second.sortOrder || 0));
  return {
    key,
    passive: asBool(special?.passive),
    isSpell,
    tooltip: {
      key,
      name: resolveGameText(getLoc(`unit_abilities_onscreen_name_${key}`) || key, getLoc),
      description: resolveGameText(getLoc(`unit_abilities_tooltip_text_${key}`) || "", getLoc),
      sourceTypeName: resolveGameText(
        getLoc(`unit_ability_source_types_name_${sourceType}`) || sourceType,
        getLoc,
      ),
      loreGroupName: "",
      abilityTypeName: resolveGameText(
        getLoc(`unit_ability_types_onscreen_name_${type}`) || type,
        getLoc,
      ),
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
      bonuses,
      additionalUiEffects,
    },
  };
};

export interface BuiltUnitViewerData {
  groups: UnitViewerCatalogGroup[];
  unitGroups: UnitViewerUiGroup[];
  units: Map<string, UnitViewerUnitModel>;
  constants: UnitViewerConstants;
  iconPathsByUnit: Map<string, string[]>;
  statIcons: Record<string, string>;
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
  const abilityPhases = groupRows(
    tables.special_ability_to_special_ability_phase_junctions_tables,
    "special_ability",
  );
  const phases = indexRows(tables.special_ability_phases_tables, "id");
  const phaseStatEffects = new Map<string, Array<Record<string, string>>>();
  for (const row of tables.special_ability_phase_stat_effects_tables || []) {
    const phase = asString(row.phase);
    const stat = asString(row.stat);
    const how = asString(row.how);
    if (!phase || !stat || !how) continue;
    const effects = phaseStatEffects.get(phase) || [];
    const existingIndex = effects.findIndex(
      (effect) => asString(effect.stat) === stat && asString(effect.how) === how,
    );
    if (existingIndex >= 0) effects[existingIndex] = row;
    else effects.push(row);
    phaseStatEffects.set(phase, effects);
  }
  const additionalEffectsByAbility = groupRows(
    tables.unit_abilities_to_additional_ui_effects_juncs_tables,
    "ability",
  );
  const additionalEffects = indexRows(tables.unit_abilities_additional_ui_effects_tables, "key");
  const groundEffectsByGroup = groupRows(tables.ground_type_to_stat_effects_tables, "affected_group");
  const uiUnitStats = indexRows(tables.ui_unit_stats_tables, "key");
  const uiUnitGroupings = indexRows(tables.ui_unit_groupings_tables, "key");
  const uiUnitGroupParents = indexRows(tables.ui_unit_group_parents_tables, "key");

  const experienceBonusRows = indexRows(tables.unit_experience_bonuses_tables, "stat");
  const rankBonusRows = indexRows(tables.unit_stats_land_experience_bonuses_tables, "xp_level");
  const usedStatIconKeys = new Set(UNIT_VIEWER_USED_STAT_ICON_KEYS);
  for (const effects of phaseStatEffects.values()) {
    for (const effect of effects) {
      const stat = asString(effect.stat);
      if (stat) usedStatIconKeys.add(stat);
    }
  }
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
        .filter(([key, iconPath]) => usedStatIconKeys.has(key) && !!iconPath),
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
  const uiGroupKeyByUnit = new Map<string, string>();
  const collator = new Intl.Collator("en");

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
        buildAbility(
          abilityKey,
          spellAbilityKeys.includes(abilityKey),
          abilities,
          specialAbilities,
          abilityPhases,
          phases,
          phaseStatEffects,
          uiUnitStats,
          additionalEffectsByAbility,
          additionalEffects,
          getLoc,
        ),
      )
      .filter((ability): ability is UnitViewerAbility => !!ability)
      .sort(
        (first, second) =>
          collator.compare(first.tooltip.name, second.tooltip.name) ||
          collator.compare(first.key, second.key),
      );
    const attributeRows = attributesByGroup.get(asString(land.attribute_group)) || [];
    const unitAttributes = attributeRows
      .map((row) => {
        const attributeKey = asString(row.attribute);
        const localized = splitAttributeText(
          getLoc(`unit_attributes_bullet_text_${attributeKey}`) || "",
          attributeKey,
          getLoc,
        );
        return {
          key: attributeKey,
          ...localized,
          iconPath: normalizeIconPath(attributeKey)!,
        };
      })
      .sort(
        (first, second) =>
          collator.compare(first.name, second.name) || collator.compare(first.key, second.key),
      );
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
      name: resolveGameText(getLoc(`land_units_onscreen_name_${landUnitKey}`) || key, getLoc),
      caste: asString(main.caste),
      category: asString(land.category),
      shortDescription: resolveGameText(
        getLoc(`land_units_short_description_text_${landUnitKey}`) || "",
        getLoc,
      ),
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
        groundType: resolveGameText(
          getLoc(`ground_types_onscreen_name_${asString(row.ground_type)}`) || asString(row.ground_type),
          getLoc,
        ),
        stat: resolveGameText(
          getLoc(`unit_stat_localisations_onscreen_name_${asString(row.affected_stat)}`) ||
            asString(row.affected_stat),
          getLoc,
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
      ].filter((path): path is string => !!path))),
    );

    const parentGroupKey = asString(
      uiUnitGroupings.get(asString(main.ui_unit_group_land))?.parent_group,
    );
    uiGroupKeyByUnit.set(
      key,
      uiUnitGroupParents.has(parentGroupKey) ? parentGroupKey : EXTENDED_ROSTER_GROUP_KEY,
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

  const unitGroups: UnitViewerUiGroup[] = Array.from(new Set(uiGroupKeyByUnit.values()))
    .map((key) => ({
      key,
      name:
        key === EXTENDED_ROSTER_GROUP_KEY && !uiUnitGroupParents.has(key)
          ? "Extended Roster"
          : resolveGameText(getLoc(`ui_unit_group_parents_onscreen_name_${key}`) || key, getLoc),
      order: asNumber(uiUnitGroupParents.get(key)?.order),
    }))
    .sort((first, second) => {
      const extendedFirst = first.key === EXTENDED_ROSTER_GROUP_KEY ? 1 : 0;
      const extendedSecond = second.key === EXTENDED_ROSTER_GROUP_KEY ? 1 : 0;
      const fallbackFirst = UI_UNIT_GROUP_FALLBACK_ORDER.indexOf(first.key);
      const fallbackSecond = UI_UNIT_GROUP_FALLBACK_ORDER.indexOf(second.key);
      return (
        extendedFirst - extendedSecond ||
        first.order - second.order ||
        (fallbackFirst < 0 ? UI_UNIT_GROUP_FALLBACK_ORDER.length : fallbackFirst) -
          (fallbackSecond < 0 ? UI_UNIT_GROUP_FALLBACK_ORDER.length : fallbackSecond) ||
        collator.compare(first.name, second.name)
      );
    });

  const groups: UnitViewerCatalogGroup[] = Array.from(subcultureToUnits.entries())
    .map(([key, unitKeys]) => ({
      key,
      name:
        key === "__unassigned"
          ? "Unassigned"
          : resolveGameText(getLoc(`cultures_subcultures_name_${key}`) || key, getLoc),
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
          uiGroupKey: uiGroupKeyByUnit.get(unit.key) || EXTENDED_ROSTER_GROUP_KEY,
          unitCardPath: unit.unitCardPath,
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

  return { groups, unitGroups, units, constants, iconPathsByUnit, statIcons: {} };
};
