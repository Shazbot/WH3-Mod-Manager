import { resolveTextReplacements, stripLocImgTags } from "./skills";

type AbilityTooltipBuildParams = {
  effectKeys: string[];
  effectToUnitAbilityEnables: Record<string, AbilityEnableMapping[]>;
  unitAbilitiesByKey: Record<
    string,
    {
      key: string;
      iconName: string;
      type: string;
      sourceType: string;
      overpowerOption?: string;
    }
  >;
  unitSpecialAbilitiesByKey: Record<
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
  >;
  bombardmentsByKey: Record<
    string,
    {
      key: string;
      numProjectiles: number;
      projectileType: string;
    }
  >;
  projectilesByKey: Record<
    string,
    {
      key: string;
      damage: number;
      apDamage: number;
      projectileNumber: number;
      explosionType?: string;
      spawnedVortex?: string;
    }
  >;
  explosionsByKey: Record<
    string,
    {
      key: string;
      detonationDamage: number;
      detonationDamageAp: number;
      detonationRadius: number;
      detonationDuration: number;
    }
  >;
  vortexesByKey: Record<
    string,
    {
      key: string;
      damage: number;
      damageAp: number;
      duration: number;
      goalRadius: number;
      startRadius: number;
      movementSpeed: number;
      numVortexes: number;
    }
  >;
  abilityToPhaseIds: Record<string, string[]>;
  phasesById: Record<
    string,
    {
      id: string;
      damageAmount: number;
      maxDamagedEntities: number;
      hpChangeFrequency: number;
      duration: number;
      fatigueChangeRatio: number;
      affectsAllies: boolean;
      affectsEnemies: boolean;
    }
  >;
  phaseStatEffectsByPhaseId: Record<
    string,
    {
      stat: string;
      value: number;
      how: string;
    }[]
  >;
  uiUnitStatIconsByStat: Record<string, string>;
  kvDirectDamageMinUnary: number;
  kvDirectDamageLarge: number;
  abilityToAdditionalUiEffectKeys: Record<string, string[]>;
  additionalUiEffectsByKey: Record<
    string,
    {
      key: string;
      sortOrder: number;
      effectState: string;
    }
  >;
  abilityToGroupKeys: Record<string, string[]>;
  specialAbilityGroupsByKey: Record<
    string,
    {
      key: string;
      iconPath: string;
    }
  >;
  abilityToAutoDeactivateFlags: Record<string, string[]>;
  getLoc: (locId: string) => string | undefined;
};

const asNumber = (value: string | number | undefined): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asOptionalPositive = (value: number): number | undefined => (value > 0 ? value : undefined);
const asBool = (value: string | boolean | number | undefined): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (!value) return false;
  return value.toString().toLowerCase() === "true" || value === "1";
};

const toPercent = (numerator: number, denominator: number) =>
  denominator > 0 ? Math.round((numerator / denominator) * 100) : undefined;

const normalizeUiPath = (value: string | undefined, appendPngWhenMissing = true) => {
  if (!value) return undefined;
  let normalized = value.trim().replaceAll("/", "\\").replaceAll(/\\+/g, "\\");
  if (!normalized) return undefined;
  if (appendPngWhenMissing && !/\.(png|jpg|jpeg|dds)$/i.test(normalized)) {
    normalized += ".png";
  }
  return normalized.toLowerCase();
};

const extractIconPathFromLoc = (localizedText: string | undefined) => {
  if (!localizedText) return undefined;
  const match = localizedText.match(/\[\[img:(.*?)\]\]\[\[\/img\]\]/i);
  if (!match || !match[1]) return undefined;
  return normalizeUiPath(match[1], true);
};

const localize = (
  locId: string,
  getLoc: (locId: string) => string | undefined,
  fallback = "",
  stripIcons = true,
): string => {
  const loc = getLoc(locId);
  if (!loc) return fallback;
  let text = resolveTextReplacements(loc, getLoc) || loc;
  if (stripIcons) text = stripLocImgTags(text) || text;
  return text;
};

const selectLoreGroupKey = (groupKeys: string[]) =>
  groupKeys.find((groupKey) => groupKey.toLowerCase().includes("lore")) || groupKeys[0];

const resolveAbilityFromEnableMapping = (
  mapping: AbilityEnableMapping,
  unitAbilitiesByKey: AbilityTooltipBuildParams["unitAbilitiesByKey"],
) => {
  const baseAbility = unitAbilitiesByKey[mapping.unitAbilityKey];
  const isOvercastEnable = /^enable_over/i.test(mapping.bonusValueId);
  if (!isOvercastEnable || !baseAbility?.overpowerOption) return mapping.unitAbilityKey;
  return baseAbility.overpowerOption;
};

const getBonusValuePresentation = (how: string, value: number, key: string) => {
  if (how === "mult") {
    const deltaPctRaw = (value - 1) * 100;
    const deltaPct = Number.isInteger(deltaPctRaw) ? deltaPctRaw : Math.round(deltaPctRaw * 100) / 100;
    const sign = deltaPct > 0 ? "+" : "";
    return {
      valueText: `${sign}${deltaPct}%`,
      numericValue: deltaPct,
      valueSuffix: "%",
    };
  }

  const rounded = Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  if (key.startsWith("scalar_")) {
    const sign = rounded > 0 ? "+" : "";
    return {
      valueText: `${sign}${rounded}%`,
      numericValue: rounded,
      valueSuffix: "%",
    };
  }

  const sign = rounded > 0 ? "+" : "";
  return {
    valueText: `${sign}${rounded}`,
    numericValue: rounded,
    valueSuffix: "",
  };
};

const resolveAffectedUnitsText = (
  ability: AbilityTooltipBuildParams["unitSpecialAbilitiesByKey"][string],
  phases: AbilityTooltipBuildParams["phasesById"],
  phaseIds: string[],
) => {
  const hasExplicitTargeting =
    ability.targetFriends ||
    ability.targetEnemies ||
    ability.targetSelf ||
    ability.affectSelf ||
    ability.numEffectedFriendlyUnits !== 0 ||
    ability.numEffectedEnemyUnits !== 0;
  const phaseData = phaseIds.map((phaseId) => phases[phaseId]).filter((phase) => !!phase);
  const affectsAlliesFromPhase = phaseData.some((phase) => asBool(phase.affectsAllies));
  const affectsEnemiesFromPhase = phaseData.some((phase) => asBool(phase.affectsEnemies));
  const affectsAllies =
    ability.targetFriends ||
    ability.numEffectedFriendlyUnits !== 0 ||
    (!hasExplicitTargeting && affectsAlliesFromPhase);
  const affectsEnemies =
    ability.targetEnemies ||
    ability.numEffectedEnemyUnits !== 0 ||
    (!hasExplicitTargeting && affectsEnemiesFromPhase);
  if (!affectsAllies && !affectsEnemies) return undefined;
  const groupLabel = affectsAllies && affectsEnemies ? "all units" : affectsAllies ? "allies" : "enemies";
  const count = affectsEnemies && !affectsAllies ? ability.numEffectedEnemyUnits : ability.numEffectedFriendlyUnits;
  const scopeLabel = count < 0 ? "range(all)" : `range(${count})`;
  return `Affects ${groupLabel} in ${scopeLabel}`;
};

const resolveEnabledIfText = (
  abilityKey: string,
  abilityToAutoDeactivateFlags: AbilityTooltipBuildParams["abilityToAutoDeactivateFlags"],
  getLoc: AbilityTooltipBuildParams["getLoc"],
) => {
  const flags = abilityToAutoDeactivateFlags[abilityKey] || [];
  if (flags.length === 0) return undefined;

  const localizedFlags = Array.from(
    new Set(
      flags
        .map((flag) => {
          const altDescription = localize(
            `special_ability_invalid_usage_flags_alt_description_${flag}`,
            getLoc,
            "",
            true,
          );
          if (altDescription) return altDescription;
          return localize(`special_ability_invalid_usage_flags_flag_description_${flag}`, getLoc, "", true);
        })
        .filter((entry) => !!entry),
    ),
  );

  if (localizedFlags.length === 0) return undefined;
  return localizedFlags.join(", ");
};

export const buildAbilityTooltipDataForEffects = (params: AbilityTooltipBuildParams) => {
  const reducedEffectMappings: Record<string, AbilityEnableMapping[]> = {};
  const relevantAbilityKeys = new Set<string>();

  for (const effectKey of params.effectKeys) {
    const mappings = params.effectToUnitAbilityEnables[effectKey];
    if (!mappings || mappings.length === 0) continue;

    for (const mapping of mappings) {
      const resolvedAbilityKey = resolveAbilityFromEnableMapping(mapping, params.unitAbilitiesByKey);
      reducedEffectMappings[effectKey] = reducedEffectMappings[effectKey] || [];
      if (
        !reducedEffectMappings[effectKey].some(
          (iter) => iter.unitAbilityKey === resolvedAbilityKey && iter.bonusValueId === mapping.bonusValueId,
        )
      ) {
        reducedEffectMappings[effectKey].push({
          unitAbilityKey: resolvedAbilityKey,
          bonusValueId: mapping.bonusValueId,
        });
      }
      relevantAbilityKeys.add(resolvedAbilityKey);
    }
  }

  const abilityTooltipsByKey: Record<string, AbilityTooltipData> = {};
  const iconPathsToLoad = new Set<string>();

  const resolveProjectileData = (
    projectileKey: string,
    numProjectilesOverride?: number,
  ): AbilityTooltipProjectileData | undefined => {
    const projectile = params.projectilesByKey[projectileKey];
    if (!projectile) return undefined;

    const projectileTotalDamage = projectile.damage + projectile.apDamage;
    const projectileData: AbilityTooltipProjectileData = {
      key: projectile.key,
      totalDamage: projectileTotalDamage,
      apDamage: projectile.apDamage,
      apPct: toPercent(projectile.apDamage, projectileTotalDamage),
      numProjectiles: asOptionalPositive(numProjectilesOverride ?? projectile.projectileNumber),
    };

    if (projectile.explosionType) {
      const explosion = params.explosionsByKey[projectile.explosionType];
      if (explosion) {
        const explosionTotalDamage = explosion.detonationDamage + explosion.detonationDamageAp;
        projectileData.explosion = {
          key: explosion.key,
          totalDamage: asOptionalPositive(explosionTotalDamage),
          apDamage: asOptionalPositive(explosion.detonationDamageAp),
          apPct: toPercent(explosion.detonationDamageAp, explosionTotalDamage),
          radius: asOptionalPositive(explosion.detonationRadius),
          duration: asOptionalPositive(explosion.detonationDuration),
        };
      }
    }

    if (projectile.spawnedVortex) {
      const vortex = params.vortexesByKey[projectile.spawnedVortex];
      if (vortex) {
        const vortexTotalDamage = vortex.damage + vortex.damageAp;
        projectileData.spawnedVortex = {
          key: vortex.key,
          dps: asOptionalPositive(vortexTotalDamage),
          apDps: asOptionalPositive(vortex.damageAp),
          apPct: toPercent(vortex.damageAp, vortexTotalDamage),
          duration: asOptionalPositive(vortex.duration),
          radius: asOptionalPositive(vortex.goalRadius || vortex.startRadius),
          movementSpeed: asOptionalPositive(vortex.movementSpeed),
          numVortexes: asOptionalPositive(vortex.numVortexes),
        };
      }
    }

    return projectileData;
  };

  for (const abilityKey of relevantAbilityKeys) {
    const unitAbility = params.unitAbilitiesByKey[abilityKey];
    const unitSpecialAbility = params.unitSpecialAbilitiesByKey[abilityKey];
    if (!unitAbility || !unitSpecialAbility) continue;

    const typeLocRaw = params.getLoc(`unit_ability_types_onscreen_name_${unitAbility.type}`) || "";
    const typeIconPath = extractIconPathFromLoc(typeLocRaw);
    const abilityIconPath = normalizeUiPath(`ui\\battle ui\\ability_icons\\${unitAbility.iconName}`);

    const groupKeys = params.abilityToGroupKeys[abilityKey] || [];
    const loreGroupKey = selectLoreGroupKey(groupKeys);
    const loreGroupIconPath = normalizeUiPath(params.specialAbilityGroupsByKey[loreGroupKey]?.iconPath);

    if (abilityIconPath) iconPathsToLoad.add(abilityIconPath);
    if (typeIconPath) iconPathsToLoad.add(typeIconPath);
    if (loreGroupIconPath) iconPathsToLoad.add(loreGroupIconPath);

    const stats = {
      range: asOptionalPositive(unitSpecialAbility.targetInterceptRange),
      cooldown: asOptionalPositive(unitSpecialAbility.rechargeTime),
      duration: asOptionalPositive(unitSpecialAbility.activeTime),
      effectRange:
        unitSpecialAbility.effectRange < 0
          ? Number.POSITIVE_INFINITY
          : asOptionalPositive(unitSpecialAbility.effectRange),
      womCost: asOptionalPositive(unitSpecialAbility.manaCost),
      miscastChance: asOptionalPositive(unitSpecialAbility.miscastChance * 100),
      minRange: asOptionalPositive(unitSpecialAbility.minRange),
    };

    const tooltip: AbilityTooltipData = {
      key: abilityKey,
      name: localize(`unit_abilities_onscreen_name_${abilityKey}`, params.getLoc, abilityKey, true),
      description: localize(`unit_abilities_tooltip_text_${abilityKey}`, params.getLoc, "", true),
      sourceTypeName: localize(
        `unit_ability_source_types_name_${unitAbility.sourceType}`,
        params.getLoc,
        unitAbility.sourceType,
        true,
      ),
      loreGroupName:
        loreGroupKey != undefined
          ? localize(`special_ability_groups_name_${loreGroupKey}`, params.getLoc, loreGroupKey, true)
          : "",
      abilityTypeName:
        localize(`unit_ability_types_onscreen_name_${unitAbility.type}`, params.getLoc, unitAbility.type, true) ||
        unitAbility.type,
      overpowerOption: unitAbility.overpowerOption,
      iconPath: abilityIconPath,
      loreIconPath: loreGroupIconPath,
      typeIconPath,
      stats,
      bonuses: [],
      additionalUiEffects: [],
    };

    if (unitSpecialAbility.activatedProjectile) {
      tooltip.projectile = resolveProjectileData(unitSpecialAbility.activatedProjectile);
    }
    if (!tooltip.projectile && unitSpecialAbility.bombardment) {
      const bombardment = params.bombardmentsByKey[unitSpecialAbility.bombardment];
      if (bombardment) {
        tooltip.projectile = resolveProjectileData(bombardment.projectileType, bombardment.numProjectiles);
      }
    }

    if (unitSpecialAbility.vortex) {
      const vortex = params.vortexesByKey[unitSpecialAbility.vortex];
      if (vortex) {
        const vortexTotalDamage = vortex.damage + vortex.damageAp;
        tooltip.vortex = {
          key: vortex.key,
          dps: asOptionalPositive(vortexTotalDamage),
          apDps: asOptionalPositive(vortex.damageAp),
          apPct: toPercent(vortex.damageAp, vortexTotalDamage),
          duration: asOptionalPositive(vortex.duration),
          radius: asOptionalPositive(vortex.goalRadius || vortex.startRadius),
          movementSpeed: asOptionalPositive(vortex.movementSpeed),
          numVortexes: asOptionalPositive(vortex.numVortexes),
        };
      }
    }

    const phaseIds = params.abilityToPhaseIds[abilityKey] || [];

    const bonuses: AbilityTooltipBonusData[] = [];
    for (const phaseId of phaseIds) {
      const phaseStatEffects = params.phaseStatEffectsByPhaseId[phaseId] || [];
      for (const phaseStatEffect of phaseStatEffects) {
        const statLabel = localize(
          `unit_stat_localisations_onscreen_name_${phaseStatEffect.stat}`,
          params.getLoc,
          phaseStatEffect.stat,
          true,
        );
        const statIconPath = normalizeUiPath(params.uiUnitStatIconsByStat[phaseStatEffect.stat]);
        if (statIconPath) iconPathsToLoad.add(statIconPath);
        const valuePresentation = getBonusValuePresentation(phaseStatEffect.how, phaseStatEffect.value, phaseStatEffect.stat);
        bonuses.push({
          key: `${phaseId}:${phaseStatEffect.stat}:${phaseStatEffect.how}`,
          compareKey: `${phaseStatEffect.stat}:${phaseStatEffect.how}`,
          label: statLabel,
          valueText: valuePresentation.valueText,
          numericValue: valuePresentation.numericValue,
          valueSuffix: valuePresentation.valueSuffix,
          isPositive:
            (phaseStatEffect.how === "mult" && phaseStatEffect.value >= 1) ||
            (phaseStatEffect.how !== "mult" && phaseStatEffect.value >= 0),
          iconPath: statIconPath,
        });
      }

      const phase = params.phasesById[phaseId];
      if (phase && phase.fatigueChangeRatio !== 0) {
        const fatiguePerSecond = Math.round(phase.fatigueChangeRatio * 100);
        const sign = fatiguePerSecond > 0 ? "+" : "";
        bonuses.push({
          key: `${phaseId}:fatigue_change_ratio`,
          compareKey: "fatigue_change_ratio",
          label: localize(
            "random_localisation_strings_string_fatigue",
            params.getLoc,
            "Vigour per second",
            true,
          ),
          valueText: `${sign}${fatiguePerSecond}%`,
          numericValue: fatiguePerSecond,
          valueSuffix: "%",
          isPositive: fatiguePerSecond >= 0,
        });
      }
    }
    tooltip.bonuses = bonuses;
    const isBombardmentAbility =
      !!unitSpecialAbility.bombardment || unitAbility.type.toLowerCase().includes("bombard");
    const isVortexAbility =
      !!unitSpecialAbility.vortex ||
      !!tooltip.projectile?.spawnedVortex ||
      unitAbility.type.toLowerCase().includes("vortex");
    if (!isBombardmentAbility && !isVortexAbility) {
      tooltip.affectedUnitsText = resolveAffectedUnitsText(unitSpecialAbility, params.phasesById, phaseIds);
    }
    tooltip.enabledIfText = resolveEnabledIfText(abilityKey, params.abilityToAutoDeactivateFlags, params.getLoc);

    let minDps: number | undefined;
    let maxDps: number | undefined;
    let directDamageDuration: number | undefined;
    for (const phaseId of phaseIds) {
      const phase = params.phasesById[phaseId];
      if (!phase) continue;
      const damageAmount = asNumber(phase.damageAmount);
      const maxDamagedEntities = asNumber(phase.maxDamagedEntities);
      const hpChangeFrequency = asNumber(phase.hpChangeFrequency);
      if (damageAmount <= 0 || maxDamagedEntities <= 0 || hpChangeFrequency <= 0) continue;
      const currentMax = (damageAmount * maxDamagedEntities * params.kvDirectDamageLarge) / hpChangeFrequency;
      const currentMin = currentMax * params.kvDirectDamageMinUnary;
      minDps = minDps == undefined ? currentMin : Math.min(minDps, currentMin);
      maxDps = maxDps == undefined ? currentMax : Math.max(maxDps, currentMax);
      if (phase.duration > 0) {
        directDamageDuration =
          directDamageDuration == undefined ? phase.duration : Math.max(directDamageDuration, phase.duration);
      }
    }
    if (minDps != undefined && maxDps != undefined) {
      tooltip.directDamage = {
        dpsMin: Math.round(minDps),
        dpsMax: Math.round(maxDps),
        duration: directDamageDuration ? Math.round(directDamageDuration * 100) / 100 : undefined,
      };
      if (!tooltip.stats.duration && directDamageDuration) {
        tooltip.stats.duration = Math.round(directDamageDuration * 100) / 100;
      }
    }

    const additionalUiEffectKeys = params.abilityToAdditionalUiEffectKeys[abilityKey] || [];
    const additionalUiEffects = additionalUiEffectKeys
      .map((effectKey) => {
        const additionalUiEffectData = params.additionalUiEffectsByKey[effectKey];
        const text = localize(
          `unit_abilities_additional_ui_effects_localised_text_${effectKey}`,
          params.getLoc,
          effectKey,
          true,
        );
        return {
          key: effectKey,
          text,
          sortOrder: additionalUiEffectData?.sortOrder,
          effectState: additionalUiEffectData?.effectState,
        } as AbilityTooltipAdditionalUiEffectData;
      })
      .sort((first, second) => (first.sortOrder || 0) - (second.sortOrder || 0));
    tooltip.additionalUiEffects = additionalUiEffects;

    abilityTooltipsByKey[abilityKey] = tooltip;
  }

  return {
    abilityTooltipsByKey,
    reducedEffectToUnitAbilityEnables: reducedEffectMappings,
    iconPathsToLoad: Array.from(iconPathsToLoad),
  };
};
