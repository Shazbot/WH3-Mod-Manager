import { buildAbilityTooltipDataForEffects } from "../abilityTooltips";
import { effectiveAbilityRows } from "./data";
import type { AbilitiesTableRows, AbilityTableRow } from "./types";

const asNumber = (value: string | undefined) => {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asBool = (value: string | undefined) => value === "true" || value === "1";

const rows = (tables: AbilitiesTableRows, table: string) => effectiveAbilityRows(table, tables[table]);
const byKey = (source: AbilityTableRow[], keyField: string) =>
  Object.fromEntries(source.map((row) => [row[keyField] ?? "", row]).filter(([key]) => !!key));

export const buildAbilityTooltipForKey = (
  tables: AbilitiesTableRows,
  getLoc: (key: string) => string | undefined,
  abilityKey: string,
) => {
  const unitAbilitiesByKey: Record<string, { key: string; iconName: string; type: string; sourceType: string; overpowerOption?: string }> = {};
  for (const row of rows(tables, "unit_abilities_tables")) {
    const key = row.key ?? "";
    if (!key) continue;
    unitAbilitiesByKey[key] = {
      key,
      iconName: row.icon_name ?? "",
      type: row.type ?? "",
      sourceType: row.source_type ?? "",
      overpowerOption: row.overpower_option || undefined,
    };
  }

  const unitSpecialAbilitiesByKey: Record<
    string,
    {
      key: string;
      targetInterceptRange: number;
      rechargeTime: number;
      activeTime: number;
      effectRange: number;
      affectSelf: boolean;
      numEffectedFriendlyUnits: number;
      numEffectedEnemyUnits: number;
      targetFriends: boolean;
      targetEnemies: boolean;
      targetSelf: boolean;
      manaCost: number;
      miscastChance: number;
      minRange: number;
      activatedProjectile?: string;
      bombardment?: string;
      vortex?: string;
    }
  > = {};
  for (const row of rows(tables, "unit_special_abilities_tables")) {
    const key = row.key ?? "";
    if (!key) continue;
    unitSpecialAbilitiesByKey[key] = {
      key,
      targetInterceptRange: asNumber(row.target_intercept_range),
      rechargeTime: asNumber(row.recharge_time),
      activeTime: asNumber(row.active_time),
      effectRange: asNumber(row.effect_range),
      affectSelf: asBool(row.affect_self),
      numEffectedFriendlyUnits: asNumber(row.num_effected_friendly_units),
      numEffectedEnemyUnits: asNumber(row.num_effected_enemy_units),
      targetFriends: asBool(row.target_friends),
      targetEnemies: asBool(row.target_enemies),
      targetSelf: asBool(row.target_self),
      manaCost: asNumber(row.mana_cost),
      miscastChance: asNumber(row.miscast_chance),
      minRange: asNumber(row.min_range),
      activatedProjectile: row.activated_projectile || undefined,
      bombardment: row.bombardment || undefined,
      vortex: row.vortex || undefined,
    };
  }

  const bombardmentsByKey: Record<string, { key: string; numProjectiles: number; projectileType: string }> = {};
  for (const row of rows(tables, "projectile_bombardments_tables")) {
    const key = row.bombardment_key ?? "";
    if (!key) continue;
    bombardmentsByKey[key] = {
      key,
      numProjectiles: asNumber(row.num_projectiles),
      projectileType: row.projectile_type ?? "",
    };
  }

  const projectilesByKey: Record<
    string,
    { key: string; damage: number; apDamage: number; projectileNumber: number; explosionType?: string; spawnedVortex?: string }
  > = {};
  for (const row of rows(tables, "projectiles_tables")) {
    const key = row.key ?? "";
    if (!key) continue;
    projectilesByKey[key] = {
      key,
      damage: asNumber(row.damage),
      apDamage: asNumber(row.ap_damage),
      projectileNumber: asNumber(row.projectile_number),
      explosionType: row.explosion_type || undefined,
      spawnedVortex: row.spawned_vortex || undefined,
    };
  }

  const explosionsByKey: Record<
    string,
    { key: string; detonationDamage: number; detonationDamageAp: number; detonationRadius: number; detonationDuration: number }
  > = {};
  for (const row of rows(tables, "projectiles_explosions_tables")) {
    const key = row.key ?? "";
    if (!key) continue;
    explosionsByKey[key] = {
      key,
      detonationDamage: asNumber(row.detonation_damage),
      detonationDamageAp: asNumber(row.detonation_damage_ap),
      detonationRadius: asNumber(row.detonation_radius),
      detonationDuration: asNumber(row.detonation_duration),
    };
  }

  const vortexesByKey: Record<
    string,
    { key: string; damage: number; damageAp: number; duration: number; goalRadius: number; startRadius: number; movementSpeed: number; numVortexes: number }
  > = {};
  for (const row of rows(tables, "battle_vortexs_tables")) {
    const key = row.vortex_key ?? "";
    if (!key) continue;
    vortexesByKey[key] = {
      key,
      damage: asNumber(row.damage),
      damageAp: asNumber(row.damage_ap),
      duration: asNumber(row.duration),
      goalRadius: asNumber(row.goal_radius),
      startRadius: asNumber(row.start_radius),
      movementSpeed: asNumber(row.movement_speed),
      numVortexes: asNumber(row.num_vortexes),
    };
  }

  const abilityToPhaseIds: Record<string, string[]> = {};
  for (const row of rows(tables, "special_ability_to_special_ability_phase_junctions_tables")) {
    const ability = row.special_ability ?? "";
    const phase = row.phase ?? "";
    if (!ability || !phase) continue;
    (abilityToPhaseIds[ability] ||= []).push(phase);
  }

  const phasesById: Record<
    string,
    { id: string; damageAmount: number; maxDamagedEntities: number; hpChangeFrequency: number; duration: number; fatigueChangeRatio: number; affectsAllies: boolean; affectsEnemies: boolean }
  > = {};
  for (const row of rows(tables, "special_ability_phases_tables") {
    const id = row.id ?? "";
    if (!id) continue;
    phasesById[id] = {
      id,
      damageAmount: asNumber(row.damage_amount),
      maxDamagedEntities: asNumber(row.max_damaged_entities),
      hpChangeFrequency: asNumber(row.hp_change_frequency),
      duration: asNumber(row.duration),
      fatigueChangeRatio: asNumber(row.fatigue_change_ratio),
      affectsAllies: asBool(row.affects_allies),
      affectsEnemies: asBool(row.affects_enemies),
    };
  }

  const phaseStatEffectsByPhaseId: Record<string, { stat: string; value: number; how: string }[]> = {};
  for (const row of rows(tables, "special_ability_phase_stat_effects_tables") {
    const phase = row.phase ?? "";
    if (!phase) continue;
    (phaseStatEffectsByPhaseId[phase] ||= []).push({
      stat: row.stat ?? "",
      value: asNumber(row.value),
      how: row.how ?? "",
    });
  }

  const uiUnitStatIconsByStat: Record<string, string> = {};
  for (const row of rows(tables, "ui_unit_stats_tables")) {
    if (row.key && row.icon) uiUnitStatIconsByStat[row.key] = row.icon;
  }

  let kvDirectDamageMinUnary = 0;
  let kvDirectDamageLarge = 0;
  for (const row of rows(tables, "_kv_unit_ability_scaling_rules_tables")) {
    if (row.key === "direct_damage_damage_scale_min_unary") kvDirectDamageMinUnary = asNumber(row.value);
    if (row.key === "direct_damage_large") kvDirectDamageLarge = asNumber(row.value);
  }

  const abilityToAdditionalUiEffectKeys: Record<string, string[]> = {};
  for (const row of rows(tables, "unit_abilities_to_additional_ui_effects_juncs_tables")) {
    if (row.ability && row.effect) (abilityToAdditionalUiEffectKeys\›İË˜Xš[]WHH×JKœ\Ú
›İË™Y™™Xİ
NÂˆBˆÛÛœİY][Û˜[ZQY™™XİĞRÙ^Nˆ™XÛÜ™İš[™ËÈÙ^Nˆİš[™ÎÈÛÜÜ™\ˆ[X™\ÈY™™Xİİ]Nˆİš[™ÈOˆHßNÂˆ›Üˆ
ÛÛœİ›İÈÙˆ›İÜÊX›\Ë[š]ØXš[]Y\×ØY][Û˜[İZWÙY™™Xİ×İX›\ÈŠJHÂˆYˆ
\›İËšÙ^JHÛÛ[YNÂˆY][Û˜[ZQY™™XİĞRÙ^VÜ›İËšÙ^WHHÈÙ^Nˆ›İËšÙ^KÛÜÜ™\ˆ\Ó[X™\Š›İËœÛÜÛÜ™\ŠKY™™Xİİ]Nˆ›İË™Y™™XİÜİ]HÏÈˆˆNÂˆB‚ˆÛÛœİXš[]UÑÜ›İ\Ù^\Îˆ™XÛÜ™İš[™Ëİš[™Ö×OˆHßNÂˆ›Üˆ
ÛÛœİ›İÈÙˆ›İÜÊX›\ËœÜXÚX[ØXš[]WÙÜ›İ\×İ×İ[š]ØXš[]Y\×Ú[˜İ[Ûœ×İX›\ÈŠJHÂˆYˆ
›İË[š]ÜÜXÚX[ØXš[]Y\È	‰ˆ›İËœÜXÚX[ØXš[]WÙÜ›İ\ÊHÂˆ
Xš[]UÑÜ›İ\Ù^\ÖÜ›İË[š]ÜÜXÚX[ØXš[]Y\×HH×JKœ\Ú
›İËœÜXÚX[ØXš[]WÙÜ›İ\ÊNÂˆBˆBˆÛÛœİÜXÚX[Xš[]QÜ›İ\ĞRÙ^Nˆ™XÛÜ™İš[™ËÈÙ^Nˆİš[™ÎÈXÛÛ”]ˆİš[™ÈOˆHßNÂˆ›Üˆ
ÛÛœİ›İÈÙˆ›İÜÊX›\ËœÜXÚX[ØXš[]WÙÜ›İ\×İX›\ÈŠHÂˆYˆ
\›İË˜Xš[]WÙÜ›İ\
HÛÛ[YNÂˆÜXÚX[Xš[]QÜ›İ\ĞRÙ^VÜ›İË˜Xš[]WÙÜ›İ\HHÈÙ^Nˆ›İË˜Xš[]WÙÜ›İ\XÛÛ”]ˆ›İËšXÛÛ—Ü]ÏÈˆˆNÂˆB‚ˆÛÛœİXš[]UĞ]]ÑXXİ]˜]Q›YÜÎˆ™XÛÜ™İš[™Ëİš[™Ö×OˆHßNÂˆ›Üˆ
ÛÛœİ›İÈÙˆ›İÜÊX›\ËœÜXÚX[ØXš[]Wİ×Ø]]×ÙXXİ]˜]WÙ›YÜ×İX›\ÈŠJHÂˆYˆ
›İËœÜXÚX[ØXš[]H	‰ˆ›İË™XXİ]˜]WÙ›YÊHÂˆ
Xš[]UĞ]]ÑXXİ]˜]Q›YÜÖÜ›İËœÜXÚX[ØXš[]WHH×JKœ\Ú
›İË™XXİ]˜]WÙ›YÊNÂˆBˆB‚ˆÛÛœİŞ[]XÑY™™XİH—×İÚ[WØXš[]WÜ™]šY]××ÈÂˆÛÛœİ™\İ[HZ[Xš[]UÛÛ\]Q›Ü‘Y™™XİÊÂˆY™™XİÙ^\ÎˆÜŞ[]XÑY™™XİKˆY™™XİÕ[š]Xš[]Q[˜X›\ÎˆÈÜŞ[]XÑY™™XİNˆŞÈ[š]Xš[]RÙ^NˆXš[]RÙ^K›Û\Õ˜[YRYˆ™[˜X›HˆWHKˆ[š]Xš[]Y\ĞRÙ^Kˆ[š]ÜXÚX[Xš[]Y\ĞRÙ^Kˆ›ÛX˜\™Y[ĞRÙ^Kˆ›Ú™Xİ[\ĞRÙ^Kˆ^ÜÚ[ÛœĞRÙ^Kˆ›Ü^\ĞRÙ^KˆXš[]UÔ\ÙRYËˆ\Ù\ĞRYˆ\ÙTİ]Y™™XİĞT\ÙRYˆZU[š]İ]XÛÛœĞTİ]ˆİ‘\™Xİ[XYÙSZ[•[˜\Kˆİ‘\™Xİ[XYÙS\™ÙKˆXš[]UĞY][Û˜[ZQY™™XİÙ^\ËˆY][Û˜[ZQY™™XİĞRÙ^KˆXš[]UÑÜ›İ\Ù^\ËˆÜXÚX[Xš[]QÜ›İ\ĞRÙ^KˆXš[]UĞ]]ÑXXİ]˜]Q›YÜËˆÙ]ØËˆJNÂ‚ˆ™]\›ˆÂˆÛÛ\ˆ™\İ[˜Xš[]UÛÛ\ĞRÙ^VØXš[]RÙ^WKˆXÛÛ”]ÕÓØYˆ™\İ[šXÛÛ”]ÕÓØYˆNÂŸNÂ