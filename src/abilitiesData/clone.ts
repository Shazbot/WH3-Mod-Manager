import { ABILITIES_LOC_TABLE, type AbilityNewRow } from "./edits";
import type { AbilityDetail, AbilityPayloadRoot, AbilityRowView } from "./types";

export type StagedAbilityRow = Omit<AbilityNewRow, "id" | "groupId">;

const cloneValues = (row: AbilityRowView | undefined) => ({ ...(row?.values ?? {}) });

/** Deterministic positive id derived from the new database key. */
const uniqueIdFor = (key: string, salt = "") => {
  let hash = 2166136261;
  for (const char of `${key}|${salt}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0) || 1}`;
};

const row = (table: string, values: Record<string, string>, origin: StagedAbilityRow["origin"]): StagedAbilityRow => ({
  table,
  values,
  origin,
});

/**
 * Clone the logical ability definition without assigning the clone to the source units/effects/army.
 * Phases are always copied because they are frequently shared by several abilities.
 */
export const cloneAbilityRows = (
  detail: AbilityDetail,
  newKey: string,
  newName: string,
  newDescription = detail.description,
): StagedAbilityRow[] => {
  const key = newKey.trim();
  if (!key) return [];
  const rows: StagedAbilityRow[] = [];

  const overview = cloneValues(detail.overviewRow);
  overview.key = key;
  overview.overpower_option = "";
  overview.superseded_abilities_set = "";
  rows.push(row("unit_abilities_tables", overview, "clone"));

  if (detail.specialAbilityRow) {
    const special = cloneValues(detail.specialAbilityRow);
    special.key = key;
    if (Object.prototype.hasOwnProperty.call(special, "unique_id")) special.unique_id = uniqueIdFor(key, "special");
    rows.push(row("unit_special_abilities_tables", special, "clone"));
  }

  const phaseIds = new Set<string>();
  detail.phases.forEach((phaseDetail, index) => {
    const oldPhaseId = phaseDetail.phase?.values.id || phaseDetail.junction.values.phase || "";
    let phaseId = oldPhaseId === detail.key && !phaseIds.has(key) ? key : `${key}_phase_${index + 1}`;
    while (phaseIds.has(phaseId)) phaseId = `${phaseId}_copy`;
    phaseIds.add(phaseId);

    if (phaseDetail.phase) {
      const phase = cloneValues(phaseDetail.phase);
      phase.id = phaseId;
      rows.push(row("special_ability_phases_tables", phase, "clone"));
    }
    const junction = cloneValues(phaseDetail.junction);
    junction.special_ability = key;
    junction.phase = phaseId;
    rows.push(row("special_ability_to_special_ability_phase_junctions_tables", junction, "clone"));
    for (const statEffect of phaseDetail.statEffects) {
      const values = cloneValues(statEffect);
      values.phase = phaseId;
      rows.push(row("special_ability_phase_stat_effects_tables", values, "clone"));
    }
  });

  for (const groupLink of detail.usedBy.groups) {
    const values = cloneValues(groupLink);
    values.unit_special_abilities = key;
    rows.push(row(groupLink.table, values, "clone"));
  }
  for (const extra of detail.relatedRows.unit_abilities_to_additional_ui_effects_juncs_tables ?? []) {
    const values = cloneValues(extra);
    values.ability = key;
    rows.push(row(extra.table, values, "clone"));
  }
  for (const condition of [
    ...detail.conditions.invalidTargets,
    ...detail.conditions.invalidUsage,
    ...detail.conditions.autoDeactivate,
  ]) {
    const values = cloneValues(condition);
    values.special_ability = key;
    rows.push(row(condition.table, values, "clone"));
  }
  if (detail.conditions.intensity) {
    const values = cloneValues(detail.conditions.intensity);
    values.ability = key;
    rows.push(row(detail.conditions.intensity.table, values, "clone"));
  }

  rows.push(
    row(ABILITIES_LOC_TABLE, { key: `unit_abilities_onscreen_name_${key}`, text: newName.trim() || key }, "localization"),
    row(ABILITIES_LOC_TABLE, { key: `unit_abilities_tooltip_text_${key}`, text: newDescription }, "localization"),
  );
  return rows;
};

const partByKind = (root: AbilityPayloadRoot, kind: string) => root.parts.find((part) => part.kind === kind);

/** Copy a complete payload chain and rewire only this ability to it. */
export const copyAbilityPayloadRows = (detail: AbilityDetail, root: AbilityPayloadRoot): StagedAbilityRow[] => {
  if (!detail.specialAbilityRow) return [];
  const rows: StagedAbilityRow[] = [];
  const special = cloneValues(detail.specialAbilityRow);
  const prefix = detail.key;

  if (root.kind === "vortex") {
    const vortex = partByKind(root, "vortex");
    if (!vortex) return [];
    const values = cloneValues(vortex.row);
    const key = `${prefix}_vortex`;
    values[vortex.keyField] = key;
    special.vortex = key;
    rows.push(row(vortex.row.table, values, "copyPayload"));
  } else {
    const projectilePart = partByKind(root, "projectile");
    if (!projectilePart) return [];
    const projectile = cloneValues(projectilePart.row);
    const chainPrefix = root.kind === "bombardment" ? `${prefix}_bombardment` : prefix;
    const projectileKey = `${chainPrefix}_projectile`;
    projectile[projectilePart.keyField] = projectileKey;

    const explosionPart = partByKind(root, "explosion");
    if (explosionPart) {
      const explosion = cloneValues(explosionPart.row);
      const explosionKey = `${chainPrefix}_explosion`;
      explosion[explosionPart.keyField] = explosionKey;
      projectile.explosion_type = explosionKey;
      rows.push(row(explosionPart.row.table, explosion, "copyPayload"));
    }
    const vortexPart = partByKind(root, "vortex");
    if (vortexPart) {
      const vortex = cloneValues(vortexPart.row);
      const vortexKey = `${chainPrefix}_projectile_vortex`;
      vortex[vortexPart.keyField] = vortexKey;
      projectile.spawned_vortex = vortexKey;
      rows.push(row(vortexPart.row.table, vortex, "copyPayload"));
    }
    rows.push(row(projectilePart.row.table, projectile, "copyPayload"));

    if (root.kind === "bombardment") {
      const bombardmentPart = partByKind(root, "bombardment");
      if (!bombardmentPart) return [];
      const bombardment = cloneValues(bombardmentPart.row);
      const bombardmentKey = `${prefix}_bombardment`;
      bombardment[bombardmentPart.keyField] = bombardmentKey;
      bombardment.projectile_type = projectileKey;
      special.bombardment = bombardmentKey;
      rows.push(row(bombardmentPart.row.table, bombardment, "copyPayload"));
    } else {
      special.activated_projectile = projectileKey;
    }
  }

  rows.push(row("unit_special_abilities_tables", special, "copyPayload"));
  return rows;
};
