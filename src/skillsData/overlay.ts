import { AmendedSchemaField } from "../packFileTypes";
import { SkillsDataCacheCore } from "./cache";

export type GetTableRowDataFn = (
  packsTableData: PackViewData[],
  tableName: string,
  rowDataExtractor: (schemaFieldRow: AmendedSchemaField[]) => void,
) => void;

export const applyModOverlayToSkillsDataCore = (
  core: SkillsDataCacheCore,
  modPacksTableData: PackViewData[],
  getTableRowDataFn: GetTableRowDataFn,
) => {
  const parseNumber = (value: string | undefined) => {
    if (value == undefined || value === "") return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const parseBool = (value: string | undefined) => value == "true" || value == "1";

  getTableRowDataFn(modPacksTableData, "effects_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
    const icon = schemaFieldRow.find((sF) => sF.name == "icon")?.resolvedKeyValue;
    const isPositive = schemaFieldRow.find((sF) => sF.name == "is_positive_value_good")?.resolvedKeyValue;
    const priority = schemaFieldRow.find((sF) => sF.name == "priority")?.resolvedKeyValue;
    if (!key || !icon || !isPositive || !priority) return;
    core.effectsToEffectData[key] = { key, icon, isPositive, priority };
  });

  getTableRowDataFn(modPacksTableData, "character_skill_node_sets_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    const agentSubtype = schemaFieldRow.find((sF) => sF.name == "agent_subtype_key")?.resolvedKeyValue;
    if (!key || !agentSubtype) return;
    const updated = {
      key,
      agentSubtype,
      agentKey: schemaFieldRow.find((sF) => sF.name == "agent_key")?.resolvedKeyValue || "",
      campaignKey: schemaFieldRow.find((sF) => sF.name == "campaign_key")?.resolvedKeyValue || "",
      factionKey: schemaFieldRow.find((sF) => sF.name == "faction_key")?.resolvedKeyValue || "",
      subculture: schemaFieldRow.find((sF) => sF.name == "subculture")?.resolvedKeyValue || "",
      forArmy: schemaFieldRow.find((sF) => sF.name == "for_army")?.resolvedKeyValue || "false",
      forNavy: schemaFieldRow.find((sF) => sF.name == "for_navy")?.resolvedKeyValue || "false",
    };
    const existingIndex = core.subtypeAndSets.findIndex((entry) => entry.key == key);
    if (existingIndex >= 0) {
      core.subtypeAndSets.splice(existingIndex, 1, updated);
    } else {
      core.subtypeAndSets.push(updated);
    }
  });

  const rebuiltSubtypesToSet: Record<string, string[]> = {};
  for (const subtypeAndSet of core.subtypeAndSets) {
    rebuiltSubtypesToSet[subtypeAndSet.agentSubtype] = rebuiltSubtypesToSet[subtypeAndSet.agentSubtype] || [];
    if (!rebuiltSubtypesToSet[subtypeAndSet.agentSubtype].includes(subtypeAndSet.key)) {
      rebuiltSubtypesToSet[subtypeAndSet.agentSubtype].push(subtypeAndSet.key);
    }
  }
  core.subtypesToSet = rebuiltSubtypesToSet;

  const setToNodesDisables: Record<string, string[]> = {};
  getTableRowDataFn(modPacksTableData, "character_skill_node_set_items_tables", (schemaFieldRow) => {
    const set = schemaFieldRow.find((sF) => sF.name == "set")?.resolvedKeyValue;
    const node = schemaFieldRow.find((sF) => sF.name == "item")?.resolvedKeyValue;
    const modDisabled = schemaFieldRow.find((sF) => sF.name == "mod_disabled")?.resolvedKeyValue;
    if (!set || !node || modDisabled == undefined) return;

    core.setToNodes[set] = core.setToNodes[set] || [];
    if (!core.setToNodes[set].includes(node)) {
      core.setToNodes[set].push(node);
    }
    if (modDisabled != "0") {
      setToNodesDisables[set] = setToNodesDisables[set] || [];
      if (!setToNodesDisables[set].includes(node)) setToNodesDisables[set].push(node);
    }
  });
  for (const [set, nodesToDisable] of Object.entries(setToNodesDisables)) {
    core.setToNodes[set] = (core.setToNodes[set] || []).filter((node) => !nodesToDisable.includes(node));
  }

  getTableRowDataFn(modPacksTableData, "character_skill_node_links_tables", (schemaFieldRow) => {
    const childKey = schemaFieldRow.find((sF) => sF.name == "child_key")?.resolvedKeyValue;
    const parentKey = schemaFieldRow.find((sF) => sF.name == "parent_key")?.resolvedKeyValue;
    const linkType = schemaFieldRow.find((sF) => sF.name == "link_type")?.resolvedKeyValue;
    const parentLinkPosition = schemaFieldRow.find((sF) => sF.name == "parent_link_position")?.resolvedKeyValue;
    const childLinkPosition = schemaFieldRow.find((sF) => sF.name == "child_link_position")?.resolvedKeyValue;
    if (
      !childKey ||
      !parentKey ||
      !parentLinkPosition ||
      !childLinkPosition ||
      !(linkType == "REQUIRED" || linkType == "SUBSET_REQUIRED")
    ) {
      return;
    }
    core.nodeLinks[parentKey] = core.nodeLinks[parentKey] || [];
    if (
      !core.nodeLinks[parentKey].some(
        (iterLink) =>
          iterLink.child == childKey &&
          iterLink.linkType == linkType &&
          iterLink.parentLinkPosition == parentLinkPosition &&
          iterLink.childLinkPosition == childLinkPosition,
      )
    ) {
      core.nodeLinks[parentKey].push({
        child: childKey,
        parentLinkPosition,
        childLinkPosition,
        linkType,
      });
    }
  });

  getTableRowDataFn(modPacksTableData, "character_skill_nodes_tables", (schemaFieldRow) => {
    const node = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    const skill = schemaFieldRow.find((sF) => sF.name == "character_skill_key")?.resolvedKeyValue;
    const tier = schemaFieldRow.find((sF) => sF.name == "tier")?.resolvedKeyValue;
    const indent = schemaFieldRow.find((sF) => sF.name == "indent")?.resolvedKeyValue;
    const factionKey = schemaFieldRow.find((sF) => sF.name == "faction_key")?.resolvedKeyValue;
    const subculture = schemaFieldRow.find((sF) => sF.name == "subculture")?.resolvedKeyValue;
    const requiredNumParents = schemaFieldRow.find((sF) => sF.name == "required_num_parents")?.resolvedKeyValue;
    const visibleInUI = schemaFieldRow.find((sF) => sF.name == "visible_in_ui")?.resolvedKeyValue as
      | "0"
      | "1"
      | undefined;
    if (
      !node ||
      !skill ||
      tier == undefined ||
      indent == undefined ||
      factionKey == undefined ||
      subculture == undefined ||
      requiredNumParents == undefined ||
      (visibleInUI != "0" && visibleInUI != "1")
    ) {
      return;
    }
    core.nodeToSkill[node] = {
      node,
      skill,
      tier,
      indent,
      visibleInUI,
      factionKey,
      subculture,
      requiredNumParents: Number.parseInt(requiredNumParents),
    };
  });

  getTableRowDataFn(modPacksTableData, "character_skills_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    const iconPath = schemaFieldRow.find((sF) => sF.name == "image_path")?.resolvedKeyValue;
    const unlockRank = schemaFieldRow.find((sF) => sF.name == "unlocked_at_rank")?.resolvedKeyValue;
    if (!key || !iconPath || unlockRank == undefined) return;
    const updated = {
      key,
      iconPath,
      maxLevel: 1,
      unlockRank: Number(unlockRank),
    };
    const existingIndex = core.skills.findIndex((skill) => skill.key == key);
    if (existingIndex >= 0) {
      core.skills.splice(existingIndex, 1, updated);
    } else {
      core.skills.push(updated);
    }
  });

  getTableRowDataFn(modPacksTableData, "character_skill_nodes_skill_locks_tables", (schemaFieldRow) => {
    const skill = schemaFieldRow.find((sF) => sF.name == "character_skill")?.resolvedKeyValue;
    const skillNode = schemaFieldRow.find((sF) => sF.name == "character_skill_node")?.resolvedKeyValue;
    const level = schemaFieldRow.find((sF) => sF.name == "level")?.resolvedKeyValue;
    if (!skill || !skillNode || level == undefined) return;
    core.nodeToSkillLocks[skillNode] = core.nodeToSkillLocks[skillNode] || [];
    const levelAsNumber = Number(level);
    if (!core.nodeToSkillLocks[skillNode].some((iterSkillLevel) => iterSkillLevel[0] == skill && iterSkillLevel[1] == levelAsNumber)) {
      core.nodeToSkillLocks[skillNode].push([skill, levelAsNumber]);
    }
  });

  getTableRowDataFn(modPacksTableData, "character_skill_level_to_effects_junctions_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "character_skill_key")?.resolvedKeyValue;
    const effectScope = schemaFieldRow.find((sF) => sF.name == "effect_scope")?.resolvedKeyValue;
    const level = schemaFieldRow.find((sF) => sF.name == "level")?.resolvedKeyValue;
    const value = schemaFieldRow.find((sF) => sF.name == "value")?.resolvedKeyValue;
    const effectKey = schemaFieldRow.find((sF) => sF.name == "effect_key")?.resolvedKeyValue;
    if (!key || !effectScope || level == undefined || value == undefined || !effectKey) return;
    core.skillsToEffects[key] = core.skillsToEffects[key] || [];
    const newEffect = {
      key,
      effectScope,
      level: Number(level),
      value,
      effectKey,
      iconData: "",
      icon: core.effectsToEffectData[effectKey]?.icon,
      priority: core.effectsToEffectData[effectKey]?.priority,
    };
    if (
      !core.skillsToEffects[key].some(
        (iter) =>
          iter.effectKey == newEffect.effectKey &&
          iter.effectScope == newEffect.effectScope &&
          iter.level == newEffect.level &&
          iter.value == newEffect.value,
      )
    ) {
      core.skillsToEffects[key].push(newEffect);
    }
  });

  for (const skillKey of Object.keys(core.skillsToEffects)) {
    let maxLevel = 1;
    for (const effect of core.skillsToEffects[skillKey]) {
      if (effect.level > maxLevel) maxLevel = effect.level;
    }
    const skill = core.skills.find((iterSkill) => iterSkill.key == skillKey);
    if (skill) skill.maxLevel = maxLevel;
  }

  getTableRowDataFn(modPacksTableData, "effect_bonus_value_unit_ability_junctions_tables", (schemaFieldRow) => {
    const effect = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
    const bonusValueId = schemaFieldRow.find((sF) => sF.name == "bonus_value_id")?.resolvedKeyValue;
    const unitAbilityKey = schemaFieldRow.find((sF) => sF.name == "unit_ability")?.resolvedKeyValue;
    if (!effect || !bonusValueId || !unitAbilityKey) return;
    if (!bonusValueId.startsWith("enable")) return;
    core.effectToUnitAbilityEnables[effect] = core.effectToUnitAbilityEnables[effect] || [];
    if (
      !core.effectToUnitAbilityEnables[effect].some(
        (iterEntry) => iterEntry.unitAbilityKey == unitAbilityKey && iterEntry.bonusValueId == bonusValueId,
      )
    ) {
      core.effectToUnitAbilityEnables[effect].push({ unitAbilityKey, bonusValueId });
    }
  });

  getTableRowDataFn(modPacksTableData, "unit_abilities_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    const iconName = schemaFieldRow.find((sF) => sF.name == "icon_name")?.resolvedKeyValue;
    const type = schemaFieldRow.find((sF) => sF.name == "type")?.resolvedKeyValue;
    const sourceType = schemaFieldRow.find((sF) => sF.name == "source_type")?.resolvedKeyValue;
    const overpowerOption = schemaFieldRow.find((sF) => sF.name == "overpower_option")?.resolvedKeyValue;
    if (!key || !iconName || !type || !sourceType) return;
    core.unitAbilitiesByKey[key] = {
      key,
      iconName,
      type,
      sourceType,
      overpowerOption: overpowerOption || undefined,
    };
  });

  getTableRowDataFn(modPacksTableData, "unit_special_abilities_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    if (!key) return;
    core.unitSpecialAbilitiesByKey[key] = {
      key,
      targetInterceptRange: parseNumber(schemaFieldRow.find((sF) => sF.name == "target_intercept_range")?.resolvedKeyValue),
      rechargeTime: parseNumber(schemaFieldRow.find((sF) => sF.name == "recharge_time")?.resolvedKeyValue),
      activeTime: parseNumber(schemaFieldRow.find((sF) => sF.name == "active_time")?.resolvedKeyValue),
      effectRange: parseNumber(schemaFieldRow.find((sF) => sF.name == "effect_range")?.resolvedKeyValue),
      affectSelf: parseBool(schemaFieldRow.find((sF) => sF.name == "affect_self")?.resolvedKeyValue),
      numEffectedFriendlyUnits: parseNumber(
        schemaFieldRow.find((sF) => sF.name == "num_effected_friendly_units")?.resolvedKeyValue,
      ),
      numEffectedEnemyUnits: parseNumber(
        schemaFieldRow.find((sF) => sF.name == "num_effected_enemy_units")?.resolvedKeyValue,
      ),
      targetFriends: parseBool(schemaFieldRow.find((sF) => sF.name == "target_friends")?.resolvedKeyValue),
      targetEnemies: parseBool(schemaFieldRow.find((sF) => sF.name == "target_enemies")?.resolvedKeyValue),
      targetSelf: parseBool(schemaFieldRow.find((sF) => sF.name == "target_self")?.resolvedKeyValue),
      manaCost: parseNumber(schemaFieldRow.find((sF) => sF.name == "mana_cost")?.resolvedKeyValue),
      miscastChance: parseNumber(schemaFieldRow.find((sF) => sF.name == "miscast_chance")?.resolvedKeyValue),
      minRange: parseNumber(schemaFieldRow.find((sF) => sF.name == "min_range")?.resolvedKeyValue),
      activatedProjectile:
        schemaFieldRow.find((sF) => sF.name == "activated_projectile")?.resolvedKeyValue || undefined,
      bombardment: schemaFieldRow.find((sF) => sF.name == "bombardment")?.resolvedKeyValue || undefined,
      vortex: schemaFieldRow.find((sF) => sF.name == "vortex")?.resolvedKeyValue || undefined,
    };
  });

  getTableRowDataFn(modPacksTableData, "projectile_bombardments_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "bombardment_key")?.resolvedKeyValue;
    const projectileType = schemaFieldRow.find((sF) => sF.name == "projectile_type")?.resolvedKeyValue;
    if (!key || !projectileType) return;
    core.bombardmentsByKey[key] = {
      key,
      projectileType,
      numProjectiles: parseNumber(schemaFieldRow.find((sF) => sF.name == "num_projectiles")?.resolvedKeyValue),
    };
  });

  getTableRowDataFn(modPacksTableData, "projectiles_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    if (!key) return;
    core.projectilesByKey[key] = {
      key,
      damage: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage")?.resolvedKeyValue),
      apDamage: parseNumber(schemaFieldRow.find((sF) => sF.name == "ap_damage")?.resolvedKeyValue),
      projectileNumber: parseNumber(schemaFieldRow.find((sF) => sF.name == "projectile_number")?.resolvedKeyValue),
      explosionType: schemaFieldRow.find((sF) => sF.name == "explosion_type")?.resolvedKeyValue || undefined,
      spawnedVortex: schemaFieldRow.find((sF) => sF.name == "spawned_vortex")?.resolvedKeyValue || undefined,
    };
  });

  getTableRowDataFn(modPacksTableData, "projectiles_explosions_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    if (!key) return;
    core.explosionsByKey[key] = {
      key,
      detonationDamage: parseNumber(schemaFieldRow.find((sF) => sF.name == "detonation_damage")?.resolvedKeyValue),
      detonationDamageAp: parseNumber(schemaFieldRow.find((sF) => sF.name == "detonation_damage_ap")?.resolvedKeyValue),
      detonationRadius: parseNumber(schemaFieldRow.find((sF) => sF.name == "detonation_radius")?.resolvedKeyValue),
      detonationDuration: parseNumber(schemaFieldRow.find((sF) => sF.name == "detonation_duration")?.resolvedKeyValue),
    };
  });

  getTableRowDataFn(modPacksTableData, "battle_vortexs_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "vortex_key")?.resolvedKeyValue;
    if (!key) return;
    core.vortexesByKey[key] = {
      key,
      damage: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage")?.resolvedKeyValue),
      damageAp: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage_ap")?.resolvedKeyValue),
      duration: parseNumber(schemaFieldRow.find((sF) => sF.name == "duration")?.resolvedKeyValue),
      goalRadius: parseNumber(schemaFieldRow.find((sF) => sF.name == "goal_radius")?.resolvedKeyValue),
      startRadius: parseNumber(schemaFieldRow.find((sF) => sF.name == "start_radius")?.resolvedKeyValue),
      movementSpeed: parseNumber(schemaFieldRow.find((sF) => sF.name == "movement_speed")?.resolvedKeyValue),
      numVortexes: parseNumber(schemaFieldRow.find((sF) => sF.name == "num_vortexes")?.resolvedKeyValue),
    };
  });

  getTableRowDataFn(modPacksTableData, "special_ability_to_special_ability_phase_junctions_tables", (schemaFieldRow) => {
    const abilityKey = schemaFieldRow.find((sF) => sF.name == "special_ability")?.resolvedKeyValue;
    const phaseId = schemaFieldRow.find((sF) => sF.name == "phase")?.resolvedKeyValue;
    if (!abilityKey || !phaseId) return;
    core.abilityToPhaseIds[abilityKey] = core.abilityToPhaseIds[abilityKey] || [];
    if (!core.abilityToPhaseIds[abilityKey].includes(phaseId)) {
      core.abilityToPhaseIds[abilityKey].push(phaseId);
    }
  });

  getTableRowDataFn(modPacksTableData, "special_ability_phases_tables", (schemaFieldRow) => {
    const id = schemaFieldRow.find((sF) => sF.name == "id")?.resolvedKeyValue;
    if (!id) return;
    core.phasesById[id] = {
      id,
      damageAmount: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage_amount")?.resolvedKeyValue),
      maxDamagedEntities: parseNumber(
        schemaFieldRow.find((sF) => sF.name == "max_damaged_entities")?.resolvedKeyValue,
      ),
      hpChangeFrequency: parseNumber(
        schemaFieldRow.find((sF) => sF.name == "hp_change_frequency")?.resolvedKeyValue,
      ),
      duration: parseNumber(schemaFieldRow.find((sF) => sF.name == "duration")?.resolvedKeyValue),
      fatigueChangeRatio: parseNumber(
        schemaFieldRow.find((sF) => sF.name == "fatigue_change_ratio")?.resolvedKeyValue,
      ),
      affectsAllies: parseBool(schemaFieldRow.find((sF) => sF.name == "affects_allies")?.resolvedKeyValue),
      affectsEnemies: parseBool(schemaFieldRow.find((sF) => sF.name == "affects_enemies")?.resolvedKeyValue),
    };
  });

  getTableRowDataFn(modPacksTableData, "special_ability_phase_stat_effects_tables", (schemaFieldRow) => {
    const phase = schemaFieldRow.find((sF) => sF.name == "phase")?.resolvedKeyValue;
    const stat = schemaFieldRow.find((sF) => sF.name == "stat")?.resolvedKeyValue;
    const how = schemaFieldRow.find((sF) => sF.name == "how")?.resolvedKeyValue;
    if (!phase || !stat || !how) return;
    core.phaseStatEffectsByPhaseId[phase] = core.phaseStatEffectsByPhaseId[phase] || [];
    const value = parseNumber(schemaFieldRow.find((sF) => sF.name == "value")?.resolvedKeyValue);
    const existing = core.phaseStatEffectsByPhaseId[phase].find(
      (iterEffect) => iterEffect.stat == stat && iterEffect.how == how,
    );
    if (existing) {
      existing.value = value;
    } else {
      core.phaseStatEffectsByPhaseId[phase].push({ stat, value, how });
    }
  });

  getTableRowDataFn(modPacksTableData, "ui_unit_stats_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    const icon = schemaFieldRow.find((sF) => sF.name == "icon")?.resolvedKeyValue;
    if (!key || !icon) return;
    core.uiUnitStatIconsByStat[key] = icon;
  });

  getTableRowDataFn(modPacksTableData, "_kv_unit_ability_scaling_rules_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    const value = parseNumber(schemaFieldRow.find((sF) => sF.name == "value")?.resolvedKeyValue);
    if (key == "direct_damage_damage_scale_min_unary") core.kvDirectDamageMinUnary = value;
    if (key == "direct_damage_large") core.kvDirectDamageLarge = value;
  });

  getTableRowDataFn(modPacksTableData, "unit_abilities_to_additional_ui_effects_juncs_tables", (schemaFieldRow) => {
    const ability = schemaFieldRow.find((sF) => sF.name == "ability")?.resolvedKeyValue;
    const effect = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
    if (!ability || !effect) return;
    core.abilityToAdditionalUiEffectKeys[ability] = core.abilityToAdditionalUiEffectKeys[ability] || [];
    if (!core.abilityToAdditionalUiEffectKeys[ability].includes(effect)) {
      core.abilityToAdditionalUiEffectKeys[ability].push(effect);
    }
  });

  getTableRowDataFn(modPacksTableData, "unit_abilities_additional_ui_effects_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
    if (!key) return;
    core.additionalUiEffectsByKey[key] = {
      key,
      sortOrder: parseNumber(schemaFieldRow.find((sF) => sF.name == "sort_order")?.resolvedKeyValue),
      effectState: schemaFieldRow.find((sF) => sF.name == "effect_state")?.resolvedKeyValue?.toString() || "",
    };
  });

  getTableRowDataFn(modPacksTableData, "special_ability_to_auto_deactivate_flags_tables", (schemaFieldRow) => {
    const ability = schemaFieldRow.find((sF) => sF.name == "special_ability")?.resolvedKeyValue;
    const deactivateFlag = schemaFieldRow.find((sF) => sF.name == "deactivate_flag")?.resolvedKeyValue;
    if (!ability || !deactivateFlag) return;
    core.abilityToAutoDeactivateFlags[ability] = core.abilityToAutoDeactivateFlags[ability] || [];
    if (!core.abilityToAutoDeactivateFlags[ability].includes(deactivateFlag)) {
      core.abilityToAutoDeactivateFlags[ability].push(deactivateFlag);
    }
  });

  getTableRowDataFn(modPacksTableData, "special_ability_groups_to_unit_abilities_junctions_tables", (schemaFieldRow) => {
    const group = schemaFieldRow.find((sF) => sF.name == "special_ability_groups")?.resolvedKeyValue;
    const ability = schemaFieldRow.find((sF) => sF.name == "unit_special_abilities")?.resolvedKeyValue;
    if (!ability || !group) return;
    core.abilityToGroupKeys[ability] = core.abilityToGroupKeys[ability] || [];
    if (!core.abilityToGroupKeys[ability].includes(group)) {
      core.abilityToGroupKeys[ability].push(group);
    }
  });

  getTableRowDataFn(modPacksTableData, "special_ability_groups_tables", (schemaFieldRow) => {
    const key = schemaFieldRow.find((sF) => sF.name == "ability_group")?.resolvedKeyValue;
    const iconPath = schemaFieldRow.find((sF) => sF.name == "icon_path")?.resolvedKeyValue;
    if (!key || !iconPath) return;
    core.specialAbilityGroupsByKey[key] = { key, iconPath };
  });
};
