import type {
  UnitViewerCalculatedStats,
  UnitViewerConstants,
  UnitViewerContext,
  UnitViewerEntity,
  UnitViewerFatigue,
  UnitViewerMissileStats,
  UnitViewerMissileWeapon,
  UnitViewerUnitModel,
} from "./types";

const UNIT_SIZE_SCALAR = { small: 0.25, medium: 0.5, large: 0.75, ultra: 1 } as const;

const roundTwo = (value: number) => Math.round(value * 100) / 100;
const normalizeCaste = (value: string) => value.toLowerCase().replace(/[ _-]/g, "");

const getFatigueMultiplier = (constants: UnitViewerConstants, fatigue: UnitViewerFatigue, stat: string) =>
  constants.fatigueEffects[fatigue]?.[stat] ?? 1;

const getRankedStat = (
  unit: UnitViewerUnitModel,
  constants: UnitViewerConstants,
  rank: number,
  stat: string,
  base: number,
) => {
  const caste = normalizeCaste(unit.caste);
  if (caste === "lord" || caste === "hero" || unit.isRenown || rank <= 0) return base;
  const bonus = constants.experienceBonuses.find((entry) => entry.stat === stat);
  if (!bonus) return base;
  return Math.round(base + Math.pow(base, bonus.growthRate) * bonus.growthScalar * rank);
};

const getActiveEntity = (unit: UnitViewerUnitModel): UnitViewerEntity =>
  unit.mountEntity || unit.engineEntity || unit.articulatedEntity || unit.baseEntity;

const getEntityCount = (unit: UnitViewerUnitModel, scalar: number) => {
  const caste = normalizeCaste(unit.caste);
  let count = unit.numMen;
  if (unit.engineEntity) count = unit.numEngines;
  else if (unit.mountEntity) {
    count = ["meleecavalry", "missilecavalry", "warbeast"].includes(caste) ? unit.numMen : unit.numMounts;
  }
  return Math.max(1, Math.ceil(count * scalar));
};

const getHealth = (unit: UnitViewerUnitModel, scalar: number) => {
  const caste = normalizeCaste(unit.caste);
  const men = unit.numMen;
  const manHp = unit.baseEntity.hitPoints;
  const bonusHp = unit.bonusHitPoints;
  const mounts = unit.numMounts;
  const mountHp = unit.mountEntity?.hitPoints || 0;
  const engines = unit.numEngines;
  const engineHp = unit.engineEntity?.hitPoints || 0;
  const engineType = normalizeCaste(unit.engineEntity?.type || "");
  const articulatedHp = unit.articulatedEntity?.hitPoints || 0;
  let health: number;

  if (engines > 0) {
    if (caste === "warmachine" && normalizeCaste(unit.baseEntity.type) === "man" && engineType !== "chariot") {
      health = men * (manHp + bonusHp) + engines * (engineHp + bonusHp);
    } else if (caste === "chariot") {
      health = men * manHp + mounts * engines * mountHp + engines * (engineHp + bonusHp) + engines * articulatedHp;
    } else {
      health = men * manHp + mounts * mountHp + engines * (engineHp + bonusHp) + engines * articulatedHp;
    }
  } else if (mounts > 0 && unit.mountEntity) {
    health = ["meleecavalry", "missilecavalry", "warbeast"].includes(caste)
      ? men * manHp + men * (mountHp + bonusHp)
      : men * manHp + mounts * (mountHp + bonusHp);
  } else {
    health = men * (manHp + bonusHp);
  }

  return Math.round(health * scalar);
};

const getSizeScale = (
  constants: UnitViewerConstants,
  context: UnitViewerContext,
  stat: string,
  isSingleEntity: boolean,
) => {
  const row = constants.sizeScaling.find((entry) => entry.size === context.unitSize && entry.stat === stat);
  if (!row) return 1;
  return isSingleEntity ? row.singleEntityValue : row.multiEntityValue;
};

const calculateMissile = (
  weapon: UnitViewerMissileWeapon | undefined,
  unit: UnitViewerUnitModel,
  constants: UnitViewerConstants,
  context: UnitViewerContext,
  entityCount: number,
): UnitViewerMissileStats | undefined => {
  if (!weapon) return undefined;
  const projectile = weapon.projectile;
  const isSingleEntity = entityCount === 1;
  const baseDamage = Math.round(
    projectile.baseDamage * getSizeScale(constants, context, "scalar_missile_damage_base", isSingleEntity),
  );
  const apDamage = Math.round(
    projectile.apDamage * getSizeScale(constants, context, "scalar_missile_damage_ap", isSingleEntity),
  );
  const explosionBaseDamage = Math.round(
    projectile.explosionBaseDamage *
      getSizeScale(constants, context, "scalar_missile_explosion_damage_base", isSingleEntity),
  );
  const explosionApDamage = Math.round(
    projectile.explosionApDamage *
      getSizeScale(constants, context, "scalar_missile_explosion_damage_ap", isSingleEntity),
  );
  const rankedReload = getRankedStat(unit, constants, context.rank, "stat_reloading", unit.reload);
  const reloadBonus = Math.round(rankedReload * getFatigueMultiplier(constants, context.fatigue, "stat_reloading"));
  const reloadTime = Math.max(0.01, projectile.baseReloadTime * (1 - reloadBonus / 100));
  const ammoPool = weapon.useSecondaryAmmoPool ? unit.secondaryAmmo : unit.primaryAmmo;
  const shotsPerVolley = projectile.shotsPerVolley || 1;
  const totalDamage = baseDamage + apDamage + explosionBaseDamage + explosionApDamage;

  return {
    ammo: Math.round(ammoPool / shotsPerVolley),
    range: projectile.range,
    damagePerTenSeconds: Math.round(
      (totalDamage * shotsPerVolley * projectile.projectileNumber * projectile.burstSize * 10) / reloadTime,
    ),
    reloadTime: roundTwo(reloadTime),
    baseDamage,
    apDamage,
    explosionBaseDamage,
    explosionApDamage,
    explosionRadius: projectile.explosionRadius,
    shotsPerVolley,
    projectileNumber: projectile.projectileNumber,
    burstSize: projectile.burstSize,
    bonusVsLarge: projectile.bonusVsLarge,
    bonusVsInfantry: projectile.bonusVsInfantry,
  };
};

export const calculateUnitViewerStats = (
  unit: UnitViewerUnitModel,
  constants: UnitViewerConstants,
  context: UnitViewerContext,
): UnitViewerCalculatedStats => {
  const scalar = UNIT_SIZE_SCALAR[context.unitSize];
  const entityCount = getEntityCount(unit, scalar);
  const health = getHealth(unit, scalar);
  const activeEntity = getActiveEntity(unit);
  const rankBonus = constants.rankBonuses.find((entry) => entry.rank === context.rank);
  const rankedLeadership = getRankedStat(unit, constants, context.rank, "stat_morale", unit.leadership);
  const rankedMeleeAttack = getRankedStat(unit, constants, context.rank, "stat_melee_attack", unit.meleeAttack);
  const rankedMeleeDefence = getRankedStat(unit, constants, context.rank, "stat_melee_defence", unit.meleeDefence);
  const isSingleEntity = entityCount === 1;
  const baseDamage = Math.round(
    unit.meleeWeapon.baseDamage * getSizeScale(constants, context, "stat_melee_damage_base", isSingleEntity),
  );
  const apDamage = Math.round(
    unit.meleeWeapon.apDamage *
      getSizeScale(constants, context, "stat_melee_damage_ap", isSingleEntity) *
      getFatigueMultiplier(constants, context.fatigue, "stat_melee_damage_ap"),
  );
  const caste = normalizeCaste(unit.caste);
  const multiplayerCost =
    caste === "lord" || caste === "hero" || unit.isRenown || !rankBonus
      ? unit.multiplayerCost
      : Math.round(unit.multiplayerCost * rankBonus.multiplayerCostMultiplier + rankBonus.multiplayerFixedCost);
  const fatigueMorale = constants.fatigueMorale[context.fatigue] || 0;

  return {
    entityCount,
    multiplayerCost,
    recruitmentCost: unit.recruitmentCost,
    upkeepCost: unit.upkeepCost,
    health,
    healthPerEntity: Math.round(health / entityCount),
    barrier: Math.round(unit.barrierHealth * scalar),
    armour: Math.round(unit.armour * getFatigueMultiplier(constants, context.fatigue, "stat_armour")),
    shieldBlock: unit.shieldBlock,
    leadership: Math.round(rankedLeadership + fatigueMorale),
    speed: Math.round(
      10 *
        (activeEntity.flySpeed || activeEntity.runSpeed) *
        getFatigueMultiplier(constants, context.fatigue, "scalar_speed"),
    ),
    chargeSpeed: Math.round(
      10 * activeEntity.chargeSpeed * getFatigueMultiplier(constants, context.fatigue, "scalar_speed"),
    ),
    meleeAttack: Math.round(rankedMeleeAttack * getFatigueMultiplier(constants, context.fatigue, "stat_melee_attack")),
    meleeDefence: Math.round(
      rankedMeleeDefence * getFatigueMultiplier(constants, context.fatigue, "stat_melee_defence"),
    ),
    weaponStrength: baseDamage + apDamage,
    baseDamage,
    apDamage,
    bonusVsLarge: unit.meleeWeapon.bonusVsLarge,
    bonusVsInfantry: unit.meleeWeapon.bonusVsInfantry,
    chargeBonus: Math.round(unit.chargeBonus * getFatigueMultiplier(constants, context.fatigue, "stat_charge_bonus")),
    attackInterval: unit.meleeWeapon.attackInterval,
    mass: Math.round(activeEntity.mass),
    fatigueModifier: rankBonus?.fatigueModifier || 0,
    primaryMissile: calculateMissile(unit.primaryMissileWeapon, unit, constants, context, entityCount),
    secondaryMissile: calculateMissile(unit.secondaryMissileWeapon, unit, constants, context, entityCount),
  };
};
