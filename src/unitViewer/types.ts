export type UnitViewerUnitSize = "small" | "medium" | "large" | "ultra";

export type UnitViewerFatigue =
  | "threshold_fresh"
  | "threshold_active"
  | "threshold_winded"
  | "threshold_tired"
  | "threshold_very_tired"
  | "threshold_exhausted";

export interface UnitViewerContext {
  unitSize: UnitViewerUnitSize;
  rank: number;
  fatigue: UnitViewerFatigue;
}

export interface UnitViewerEntity {
  key: string;
  type: string;
  walkSpeed: number;
  runSpeed: number;
  flySpeed: number;
  chargeSpeed: number;
  mass: number;
  hitPoints: number;
  size: string;
}

export interface UnitViewerMeleeWeapon {
  key: string;
  baseDamage: number;
  apDamage: number;
  bonusVsLarge: number;
  bonusVsInfantry: number;
  attackInterval: number;
  splashTargetSize?: string;
  splashMaxAttacks: number;
  isMagical: boolean;
  ignitionAmount: number;
}

export interface UnitViewerProjectile {
  key: string;
  range: number;
  baseDamage: number;
  apDamage: number;
  projectileNumber: number;
  shotsPerVolley: number;
  burstSize: number;
  baseReloadTime: number;
  bonusVsLarge: number;
  bonusVsInfantry: number;
  explosionBaseDamage: number;
  explosionApDamage: number;
  explosionRadius: number;
  isMagical: boolean;
  ignitionAmount: number;
}

export interface UnitViewerMissileWeapon {
  key: string;
  useSecondaryAmmoPool: boolean;
  projectile: UnitViewerProjectile;
}

export interface UnitViewerAbility {
  key: string;
  passive: boolean;
  isSpell: boolean;
  tooltip: AbilityTooltipData;
}

export interface UnitViewerAttribute {
  key: string;
  name: string;
  description: string;
  iconPath: string;
}

export interface UnitViewerGroundEffect {
  groundType: string;
  stat: string;
  multiplier: number;
}

export interface UnitViewerUnitModel {
  key: string;
  landUnitKey: string;
  name: string;
  caste: string;
  category: string;
  shortDescription: string;
  numMen: number;
  multiplayerCost: number;
  recruitmentCost: number;
  upkeepCost: number;
  barrierHealth: number;
  isRenown: boolean;
  isHighThreat: boolean;
  canSiege: boolean;
  canSkirmish: boolean;
  accuracy: number;
  armour: number;
  shieldBlock: number;
  chargeBonus: number;
  meleeAttack: number;
  meleeDefence: number;
  leadership: number;
  bonusHitPoints: number;
  numMounts: number;
  numEngines: number;
  reload: number;
  primaryAmmo: number;
  secondaryAmmo: number;
  fireResistance: number;
  magicResistance: number;
  physicalResistance: number;
  missileResistance: number;
  wardSave: number;
  groundStatEffectGroup: string;
  groundStatEffects: UnitViewerGroundEffect[];
  baseEntity: UnitViewerEntity;
  mountEntity?: UnitViewerEntity;
  engineEntity?: UnitViewerEntity;
  articulatedEntity?: UnitViewerEntity;
  meleeWeapon: UnitViewerMeleeWeapon;
  primaryMissileWeapon?: UnitViewerMissileWeapon;
  secondaryMissileWeapon?: UnitViewerMissileWeapon;
  unitCardPath?: string;
  attributes: UnitViewerAttribute[];
  abilities: UnitViewerAbility[];
}

export interface UnitViewerExperienceBonus {
  stat: string;
  growthRate: number;
  growthScalar: number;
}

export interface UnitViewerRankBonus {
  rank: number;
  fatigueModifier: number;
  multiplayerFixedCost: number;
  multiplayerCostMultiplier: number;
}

export interface UnitViewerSizeScaling {
  stat: string;
  size: UnitViewerUnitSize;
  singleEntityValue: number;
  multiEntityValue: number;
}

export interface UnitViewerConstants {
  experienceBonuses: UnitViewerExperienceBonus[];
  rankBonuses: UnitViewerRankBonus[];
  fatigueEffects: Partial<Record<UnitViewerFatigue, Record<string, number>>>;
  fatigueMorale: Partial<Record<UnitViewerFatigue, number>>;
  sizeScaling: UnitViewerSizeScaling[];
  statIconPaths: Record<string, string>;
}

export interface UnitViewerMissileStats {
  ammo: number;
  range: number;
  damagePerTenSeconds: number;
  reloadTime: number;
  baseDamage: number;
  apDamage: number;
  explosionBaseDamage: number;
  explosionApDamage: number;
  explosionRadius: number;
  shotsPerVolley: number;
  projectileNumber: number;
  burstSize: number;
  bonusVsLarge: number;
  bonusVsInfantry: number;
}

export interface UnitViewerCalculatedStats {
  entityCount: number;
  multiplayerCost: number;
  recruitmentCost: number;
  upkeepCost: number;
  health: number;
  healthPerEntity: number;
  barrier: number;
  armour: number;
  shieldBlock: number;
  leadership: number;
  speed: number;
  chargeSpeed: number;
  meleeAttack: number;
  meleeDefence: number;
  weaponStrength: number;
  baseDamage: number;
  apDamage: number;
  bonusVsLarge: number;
  bonusVsInfantry: number;
  chargeBonus: number;
  attackInterval: number;
  mass: number;
  fatigueModifier: number;
  primaryMissile?: UnitViewerMissileStats;
  secondaryMissile?: UnitViewerMissileStats;
}

export interface UnitViewerCatalogUnit {
  key: string;
  name: string;
  category: string;
  caste: string;
  subcultureKeys: string[];
  uiGroupKey: string;
  unitCardPath?: string;
}

export interface UnitViewerCatalogGroup {
  key: string;
  name: string;
  units: UnitViewerCatalogUnit[];
}

/** A roster bucket from ui_unit_group_parents (Lords, Missile Infantry, Extended Roster, …). */
export interface UnitViewerUiGroup {
  key: string;
  name: string;
  order: number;
}

export interface UnitViewerCatalogResponse {
  success: boolean;
  sessionId?: string;
  groups?: UnitViewerCatalogGroup[];
  unitGroups?: UnitViewerUiGroup[];
  constants?: UnitViewerConstants;
  statIcons?: Record<string, string>;
  error?: string;
}

export interface UnitViewerDetailsResponse {
  success: boolean;
  unit?: UnitViewerUnitModel;
  icons?: Record<string, string>;
  error?: string;
}

export interface UnitViewerAssetResponse {
  success: boolean;
  base64?: string;
  mimeType?: string;
  resolvedPath?: string;
  error?: string;
}

export interface UnitViewerAssetsResponse {
  success: boolean;
  assets?: Record<string, { base64: string; mimeType: string }>;
  error?: string;
}

/** Reply to a prewarm: which requested paths exist, without the bytes. */
export interface UnitViewerAssetsPrewarmResponse {
  success: boolean;
  resolved?: string[];
  error?: string;
}
