import { resolveTextReplacements, stripLocImgTags } from "../skills";
import { ABILITY_TABLE_KEY_COLUMNS, ABILITIES_LOC_TABLE, abilityNewRowsByTable, type AbilityEditState } from "./edits";
import type {
  AbilitiesTableRows,
  AbilityCatalogEntry,
  AbilityDetail,
  AbilityPayloadPart,
  AbilityPayloadRoot,
  AbilityRowView,
  AbilityTableRow,
} from "./types";

const value = (row: Record<string, string> | undefined, key: string) => row?.[key] ?? "";
const truthy = (input: string | undefined) => input === "true" || input === "1";

const rowView = (table: string, row: AbilityTableRow | undefined): AbilityRowView | undefined =>
  row
    ? {
        table,
        values: Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("__"))),
        sourcePackPath: row.__sourcePackPath,
        sourcePackName: row.__sourcePackName,
        sourceKind: row.__sourceKind,
      }
    : undefined;

const identity = (table: string, row: AbilityTableRow) => {
  const columns = ABILITY_TABLE_KEY_COLUMNS[table];
  if (!columns?.length) return JSON.stringify(row);
  return columns.map((column) => row[column] ?? "").join("\u0000");
};

/** Game DB rows are last-pack-wins. Keep that same rule in every editor index. */
export const effectiveAbilityRows = (table: string, rows: AbilityTableRow[] | undefined): AbilityTableRow[] => {
  if (!rows?.length) return [];
  const byKey = new Map<string, AbilityTableRow>();
  for (const row of rows) byKey.set(identity(table, row), row);
  return [...byKey.values()];
};

const index = (rows: AbilityTableRow[], key: string) => new Map(rows.map((row) => [row[key] ?? "", row]));
const group = (rows: AbilityTableRow[], key: string) => {
  const result = new Map<string, AbilityTableRow[]>();
  for (const row of rows) {
    const rowKey = row[key] ?? "";
    if (!rowKey) continue;
    (result.get(rowKey) ?? (result.set(rowKey, []), result.get(rowKey)!)).push(row);
  }
  return result;
};

const localize = (key: string, getLoc: (key: string) => string | undefined, fallback = "") => {
  const found = getLoc(key);
  if (!found) return fallback;
  return stripLocImgTags(resolveTextReplacements(found, getLoc) || found) || fallback;
};

export const getAbilityLocWithPending = (
  baseGetLoc: (key: string) => string | undefined,
  state?: AbilityEditState,
) => {
  if (!state) return baseGetLoc;
  const pending = new Map(
    (abilityNewRowsByTable(state)[ABILITIES_LOC_TABLE] ?? []).map((row) => [row.values.key ?? "", row.values.text ?? ""]),
  );
  return (key: string) => (pending.has(key) ? pending.get(key) : baseGetLoc(key));
};

const makeIndexes = (tables: AbilitiesTableRows) => {
  const rows = (table: string) => effectiveAbilityRows(table, tables[table]);
  const unitAbilities = rows("unit_abilities_tables");
  const specialAbilities = rows("unit_special_abilities_tables");
  const phaseLinks = rows("special_ability_to_special_ability_phase_junctions_tables");
  const phases = rows("special_ability_phases_tables");
  const phaseStats = rows("special_ability_phase_stat_effects_tables");
  const groupLinks = rows("special_ability_groups_to_unit_abilities_junctions_tables");
  const groups = rows("special_ability_groups_tables");
  const additionalLinks = rows("unit_abilities_to_additional_ui_effects_juncs_tables");
  const additional = rows("unit_abilities_additional_ui_effects_tables");
  const invalidTargets = rows("special_ability_to_invalid_target_flags_tables");
  const invalidUsage = rows("special_ability_to_invalid_usage_flags_tables");
  const autoDeactivate = rows("special_ability_to_auto_deactivate_flags_tables");
  const intensity = rows("special_ability_intensity_settings_tables");
  const landUnits = rows("land_units_to_unit_abilites_junctions_tables");
  const armyAbilities = rows("army_special_abilities_tables");
  const enablingEffects = rows("effect_bonus_value_unit_ability_junctions_tables");
  const supersededElements = rows("unit_ability_superseded_abilities_set_elements_tables");
  const projectiles = rows("projectiles_tables");
  const explosions = rows("projectiles_explosions_tables");
  const bombardments = rows("projectile_bombardments_tables");
  const vortexes = rows("battle_vortexs_tables");

  const phasesByAbility = group(phaseLinks, "special_ability");
  const statsByPhase = group(phaseStats, "phase");
  const groupsByAbility = group(groupLinks, "unit_special_abilities");
  const additionalByAbility = group(additionalLinks, "ability");
  const invalidTargetsByAbility = group(invalidTargets, "special_ability");
  const invalidUsageByAbility = group(invalidUsage, "special_ability");
  const autoDeactivateByAbility = group(autoDeactivate, "special_ability");
  const landUnitsByAbility = group(landUnits, "ability");
  const armyByAbility = group(armyAbilities, "unit_special_ability");
  const effectsByAbility = group(enablingEffects, "unit_ability");
  const supersededBySet = group(supersededElements, "set_key");

  const phaseReferenceCount = new Map<string, number>();
  for (const link of phaseLinks) {
    const phase = link.phase ?? "";
    if (phase) phaseReferenceCount.set(phase, (phaseReferenceCount.get(phase) ?? 0) + 1);
  }
  const projectileReferenceCount = new Map<string, number>();
  const explosionReferenceCount = new Map<string, number>();
  const bombardmentReferenceCount = new Map<string, number>();
  const vortexReferenceCount = new Map<string, number>();
  for (const ability of specialAbilities) {
    const projectile = ability.activated_projectile;
    const bombardment = ability.bombardment;
    const vortex = ability.vortex;
    if (projectile) projectileReferenceCount.set(projectile, (projectileReferenceCount.get(projectile) ?? 0) + 1);
    if (bombardment) bombardmentReferenceCount.set(bombardment, (bombardmentReferenceCount.get(bombardment) ?? 0) + 1);
    if (vortex) vortexReferenceCount.set(vortex, (vortexReferenceCount.get(vortex) ?? 0) + 1);
  }
  for (const bombardment of bombardments) {
    if (bombardment.projectile_type)
      projectileReferenceCount.set(
        bombardment.projectile_type,
        (projectileReferenceCount.get(bombardment.projectile_type) ?? 0) + 1,
      );
  }
  for (const projectile of projectiles) {
    if (projectile.explosion_type)
      explosionReferenceCount.set(
        projectile.explosion_type,
        (explosionReferenceCount.get(projectile.explosion_type) ?? 0) + 1,
      );
    if (projectile.spawned_vortex)
      vortexReferenceCount.set(projectile.spawned_vortex, (vortexReferenceCount.get(projectile.spawned_vortex) ?? 0) + 1);
  }

  return {
    unitAbilities,
    unitAbilityByKey: index(unitAbilities, "key"),
    specialAbilityByKey: index(specialAbilities, "key"),
    phaseById: index(phases, "id"),
    phasesByAbility,
    statsByPhase,
    groupsByAbility,
    groupByKey: index(groups, "ability_group"),
    additionalByAbility,
    additionalByKey: index(additional, "key"),
    invalidTargetsByAbility,
    invalidUsageByAbility,
    autoDeactivateByAbility,
    intensityByAbility: index(intensity, "ability"),
    landUnitsByAbility,
    armyByAbility,
    effectsByAbility,
    supersededBySet,
    projectileByKey: index(projectiles, "key"),
    explosionByKey: index(explosions, "key"),
    bombardmentByKey: index(bombardments, "bombardment_key"),
    vortexByKey: index(vortexes, "vortex_key"),
    phaseReferenceCount,
    projectileReferenceCount,
    explosionReferenceCount,
    bombardmentReferenceCount,
    vortexReferenceCount,
  };
};

const addSource = (set: Set<string>, row: AbilityTableRow | undefined) => {
  if (row?.__sourcePackPath) set.add(row.__sourcePackPath);
  if (row?.__baseSourcePackPath) set.add(row.__baseSourcePackPath);
};

const collectContributors = (key: string, ix: ReturnType<typeof makeIndexes>) => {
  const paths = new Set<string>();
  const ua = ix.unitAbilityByKey.get(key);
  const special = ix.specialAbilityByKey.get(key);
  addSource(paths, ua);
  addSource(paths, special);
  for (const link of ix.phasesByAbility.get(key) ?? []) {
    addSource(paths, link);
    const phase = ix.phaseById.get(link.phase ?? "");
    addSource(paths, phase);
    for (const stat of ix.statsByPhase.get(link.phase ?? "") ?? []) addSource(paths, stat);
  }
  for (const link of ix.groupsByAbility.get(key) ?? []) {
    addSource(paths, link);
    addSource(paths, ix.groupByKey.get(link.special_ability_groups ?? ""));
  }
  for (const link of ix.additionalByAbility.get(key) ?? []) {
    addSource(paths, link);
    addSource(paths, ix.additionalByKey.get(link.effect ?? ""));
  }
  for (const row of ix.invalidTargetsByAbility.get(key) ?? []) addSource(paths, row);
  for (const row of ix.invalidUsageByAbility.get(key) ?? []) addSource(paths, row);
  for (const row of ix.autoDeactivateByAbility.get(key) ?? []) addSource(paths, row);
  addSource(paths, ix.intensityByAbility.get(key));
  for (const row of ix.landUnitsByAbility.get(key) ?? []) addSource(paths, row);
  for (const row of ix.armyByAbility.get(key) ?? []) addSource(paths, row);
  for (const row of ix.effectsByAbility.get(key) ?? []) addSource(paths, row);
  if (ua?.superseded_abilities_set) {
    for (const row of ix.supersededBySet.get(ua.superseded_abilities_set) ?? []) addSource(paths, row);
  }
  if (special?.activated_projectile) {
    const projectile = ix.projectileByKey.get(special.activated_projectile);
    addSource(paths, projectile);
    addSource(paths, ix.explosionByKey.get(projectile?.explosion_type ?? ""));
    addSource(paths, ix.vortexByKey.get(projectile?.spawned_vortex ?? ""));
  }
  if (special?.bombardment) {
    const bombardment = ix.bombardmentByKey.get(special.bombardment);
    addSource(paths, bombardment);
    const projectile = ix.projectileByKey.get(bombardment?.projectile_type ?? "");
    addSource(paths, projectile);
    addSource(paths, ix.explosionByKey.get(projectile?.explosion_type ?? ""));
    addSource(paths, ix.vortexByKey.get(projectile?.spawned_vortex ?? ""));
  }
  if (special?.vortex) addSource(paths, ix.vortexByKey.get(special.vortex));
  return [...paths];
};

export const buildAbilitiesCatalogEntries = (
  tables: AbilitiesTableRows,
  getLoc: (key: string) => string | undefined,
): AbilityCatalogEntry[] => {
  const ix = makeIndexes(tables);
  return ix.unitAbilities
    .map((ability) => {
      const key = ability.key ?? "";
      const special = ix.specialAbilityByKey.get(key);
      const groupNames = (ix.groupsByAbility.get(key) ?? []).map((link) => {
        const groupKey = link.special_ability_groups ?? "";
        return localize(`special_ability_groups_name_${groupKey}`, getLoc, groupKey);
      });
      const contributingPackPaths = collectContributors(key, ix);
      const contributingModPaths = contributingPackPaths.filter((path) => {
        for (const tableRows of Object.values(tables)) {
          if (
            tableRows.some(
              (row) =>
                (row.__sourcePackPath === path && row.__sourceKind === "mod") ||
                (row.__baseSourcePackPath === path && row.__baseSourceKind === "mod"),
            )
          ) {
            return true;
          }
        }
        return false;
      });
      const name = localize(`unit_abilities_onscreen_name_${key}`, getLoc, key);
      const description = localize(`unit_abilities_tooltip_text_${key}`, getLoc, "");
      const sourceType = ability.source_type ?? "";
      const type = ability.type ?? "";
      const sourceTypeName = localize(`unit_ability_source_types_name_${sourceType}`, getLoc, sourceType);
      const typeName = localize(`unit_ability_types_onscreen_name_${type}`, getLoc, type);
      const searchText = [key, name, description, sourceType, sourceTypeName, type, typeName, ...groupNames]
        .join("\n")
        .toLocaleLowerCase();
      return {
        key,
        name,
        description,
        sourceType,
        sourceTypeName,
        type,
        typeName,
        passive: truthy(special?.passive),
        hidden: truthy(ability.is_hidden_in_ui),
        hasSpecialAbility: !!special,
        loreGroups: groupNames,
        contributingPackPaths,
        contributingModPaths,
        hasPendingEdits: contributingPackPaths.includes("__pending__"),
        searchText,
      };
    })
    .sort((a, b) => a.sourceTypeName.localeCompare(b.sourceTypeName) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
};

const payloadPart = (
  kind: AbilityPayloadPart["kind"],
  table: string,
  row: AbilityTableRow | undefined,
  keyField: string,
  referenceCount: number,
): AbilityPayloadPart | undefined => {
  const view = rowView(table, row);
  return view ? { kind, row: view, keyField, referenceCount } : undefined;
};

const projectileParts = (projectileKey: string, ix: ReturnType<typeof makeIndexes>) => {
  const parts: AbilityPayloadPart[] = [];
  const projectile = ix.projectileByKey.get(projectileKey);
  const projectilePart = payloadPart(
    "projectile",
    "projectiles_tables",
    projectile,
    "key",
    ix.projectileReferenceCount.get(projectileKey) ?? 0,
  );
  if (projectilePart) parts.push(projectilePart);
  if (projectile?.explosion_type) {
    const part = payloadPart(
      "explosion",
      "projectiles_explosions_tables",
      ix.explosionByKey.get(projectile.explosion_type),
      "key",
      ix.explosionReferenceCount.get(projectile.explosion_type) ?? 0,
    );
    if (part) parts.push(part);
  }
  if (projectile?.spawned_vortex) {
    const part = payloadPart(
      "vortex",
      "battle_vortexs_tables",
      ix.vortexByKey.get(projectile.spawned_vortex),
      "vortex_key",
      ix.vortexReferenceCount.get(projectile.spawned_vortex) ?? 0,
    );
    if (part) parts.push(part);
  }
  return parts;
};

export const buildAbilityDetail = (
  tables: AbilitiesTableRows,
  getLoc: (key: string) => string | undefined,
  key: string,
): AbilityDetail | undefined => {
  const ix = makeIndexes(tables);
  const overview = ix.unitAbilityByKey.get(key);
  if (!overview) return undefined;
  const special = ix.specialAbilityByKey.get(key);
  const phases = (ix.phasesByAbility.get(key) ?? [])
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((junction) => ({
      junction: rowView("special_ability_to_special_ability_phase_junctions_tables", junction)!,
      phase: rowView("special_ability_phases_tables", ix.phaseById.get(junction.phase ?? "")),
      statEffects: (ix.statsByPhase.get(junction.phase ?? "") ?? []).map(
        (row) => rowView("special_ability_phase_stat_effects_tables", row)!,
      ),
      phaseReferenceCount: ix.phaseReferenceCount.get(junction.phase ?? "") ?? 0,
    }));

  const payloadRoots: AbilityPayloadRoot[] = [];
  if (special?.activated_projectile) {
    payloadRoots.push({
      kind: "projectile",
      specialAbilityField: "activated_projectile",
      parts: projectileParts(special.activated_projectile, ix),
    });
  }
  if (special?.bombardment) {
    const bombardment = ix.bombardmentByKey.get(special.bombardment);
    const parts: AbilityPayloadPart[] = [];
    const bombardmentPart = payloadPart(
      "bombardment",
      "projectile_bombardments_tables",
      bombardment,
      "bombardment_key",
      ix.bombardmentReferenceCount.get(special.bombardment) ?? 0,
    );
    if (bombardmentPart) parts.push(bombardmentPart);
    if (bombardment?.projectile_type) parts.push(...projectileParts(bombardment.projectile_type, ix));
    payloadRoots.push({ kind: "bombardment", specialAbilityField: "bombardment", parts });
  }
  if (special?.vortex) {
    const part = payloadPart(
      "vortex",
      "battle_vortexs_tables",
      ix.vortexByKey.get(special.vortex),
      "vortex_key",
      ix.vortexReferenceCount.get(special.vortex) ?? 0,
    );
    payloadRoots.push({ kind: "vortex", specialAbilityField: "vortex", parts: part ? [part] : [] });
  }

  const relatedRows: Record<string, AbilityRowView[]> = {};
  const addRelated = (table: string, rows: AbilityTableRow[]) => {
    if (rows.length) relatedRows[table] = rows.map((row) => rowView(table, row)!);
  };
  addRelated("special_ability_groups_to_unit_abilities_junctions_tables", ix.groupsByAbility.get(key) ?? []);
  addRelated("unit_abilities_to_additional_ui_effects_juncs_tables", ix.additionalByAbility.get(key) ?? []);
  addRelated("special_ability_to_invalid_target_flags_tables", ix.invalidTargetsByAbility.get(key) ?? []);
  addRelated("special_ability_to_invalid_usage_flags_tables", ix.invalidUsageByAbility.get(key) ?? []);
  addRelated("special_ability_to_auto_deactivate_flags_tables", ix.autoDeactivateByAbility.get(key) ?? []);
  addRelated("land_units_to_unit_abilites_junctions_tables", ix.landUnitsByAbility.get(key) ?? []);
  addRelated("army_special_abilities_tables", ix.armyByAbility.get(key) ?? []);
  addRelated("effect_bonus_value_unit_ability_junctions_tables", ix.effectsByAbility.get(key) ?? []);

  return {
    key,
    name: localize(`unit_abilities_onscreen_name_${key}`, getLoc, key),
    description: localize(`unit_abilities_tooltip_text_${key}`, getLoc, ""),
    overviewRow: rowView("unit_abilities_tables", overview)!,
    specialAbilityRow: rowView("unit_special_abilities_tables", special),
    phases,
    payloadRoots,
    conditions: {
      invalidTargets: (ix.invalidTargetsByAbility.get(key) ?? []).map(
        (row) => rowView("special_ability_to_invalid_target_flags_tables", row)!,
      ),
      invalidUsage: (ix.invalidUsageByAbility.get(key) ?? []).map(
        (row) => rowView("special_ability_to_invalid_usage_flags_tables", row)!,
      ),
      autoDeactivate: (ix.autoDeactivateByAbility.get(key) ?? []).map(
        (row) => rowView("special_ability_to_auto_deactivate_flags_tables", row)!,
      ),
      intensity: rowView("special_ability_intensity_settings_tables", ix.intensityByAbility.get(key)),
    },
    usedBy: {
      landUnits: (ix.landUnitsByAbility.get(key) ?? []).map((row) => rowView("land_units_to_unit_abilites_junctions_tables", row)!),
      armyAbilities: (ix.armyByAbility.get(key) ?? []).map((row) => rowView("army_special_abilities_tables", row)!),
      enablingEffects: (ix.effectsByAbility.get(key) ?? []).map(
        (row) => rowView("effect_bonus_value_unit_ability_junctions_tables", row)!,
      ),
      groups: (ix.groupsByAbility.get(key) ?? []).map(
        (row) => rowView("special_ability_groups_to_unit_abilities_junctions_tables", row)!,
      ),
      supersededAbilities: overview.superseded_abilities_set
        ? (ix.supersededBySet.get(overview.superseded_abilities_set) ?? []).map(
            (row) => rowView("unit_ability_superseded_abilities_set_elements_tables", row)!,
          )
        : [],
    },
    relatedRows,
    icons: {},
  };
};

export const getAbilitySourceTypes = (entries: AbilityCatalogEntry[]) =>
  [...new Map(entries.map((entry) => [entry.sourceType, { key: entry.sourceType, name: entry.sourceTypeName }])).values()].sort(
    (a, b) => a.name.localeCompare(b.name),
  );

export const getAbilityMechanicalTypes = (entries: AbilityCatalogEntry[]) =>
  [...new Map(entries.map((entry) => [entry.type, { key: entry.type, name: entry.typeName }])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
