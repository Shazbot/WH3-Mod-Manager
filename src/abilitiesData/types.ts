import type { DBVersion } from "../packFileTypes";

export type AbilityRowSourceKind = "vanilla" | "mod" | "pending";

export type AbilityTableRow = Record<string, string> & {
  __sourcePackPath?: string;
  __sourcePackName?: string;
  __sourceKind?: AbilityRowSourceKind;
  /** Original effective row when a pending override shadows a vanilla/mod row. */
  __baseSourcePackPath?: string;
  __baseSourcePackName?: string;
  __baseSourceKind?: Exclude<AbilityRowSourceKind, "pending">;
};

export type AbilitiesTableRows = Record<string, AbilityTableRow[]>;

export interface AbilityCatalogEntry {
  key: string;
  name: string;
  description: string;
  sourceType: string;
  sourceTypeName: string;
  type: string;
  typeName: string;
  passive: boolean;
  hidden: boolean;
  hasSpecialAbility: boolean;
  loreGroups: string[];
  contributingPackPaths: string[];
  contributingModPaths: string[];
  hasPendingEdits: boolean;
  searchText: string;
}

export interface AbilityCatalog {
  entries: AbilityCatalogEntry[];
  sourceTypes: Array<{ key: string; name: string }>;
  mechanicalTypes: Array<{ key: string; name: string }>;
  tableSchemas: Record<string, DBVersion>;
  moddersPrefix: string;
}

export interface AbilityCatalogResponse {
  success: boolean;
  catalog?: AbilityCatalog;
  error?: string;
}

export interface AbilityRowView {
  table: string;
  values: Record<string, string>;
  sourcePackPath?: string;
  sourcePackName?: string;
  sourceKind?: AbilityRowSourceKind;
}

export interface AbilityPhaseDetail {
  junction: AbilityRowView;
  phase?: AbilityRowView;
  statEffects: AbilityRowView[];
  phaseReferenceCount: number;
}

export interface AbilityPayloadPart {
  kind: "bombardment" | "projectile" | "explosion" | "vortex";
  row: AbilityRowView;
  keyField: string;
  referenceCount: number;
}

export interface AbilityPayloadRoot {
  kind: "bombardment" | "projectile" | "vortex";
  specialAbilityField: "bombardment" | "activated_projectile" | "vortex";
  parts: AbilityPayloadPart[];
}

export interface AbilityConditionDetail {
  invalidTargets: AbilityRowView[];
  invalidUsage: AbilityRowView[];
  autoDeactivate: AbilityRowView[];
  intensity?: AbilityRowView;
}

export interface AbilityUsedByDetail {
  landUnits: AbilityRowView[];
  armyAbilities: AbilityRowView[];
  enablingEffects: AbilityRowView[];
  groups: AbilityRowView[];
  supersededAbilities: AbilityRowView[];
}

export interface AbilityDetail {
  key: string;
  name: string;
  description: string;
  overviewRow: AbilityRowView;
  specialAbilityRow?: AbilityRowView;
  phases: AbilityPhaseDetail[];
  payloadRoots: AbilityPayloadRoot[];
  conditions: AbilityConditionDetail;
  usedBy: AbilityUsedByDetail;
  relatedRows: Record<string, AbilityRowView[]>;
  tooltip?: AbilityTooltipData;
  icons: Record<string, string>;
}

export interface AbilityDetailResponse {
  success: boolean;
  detail?: AbilityDetail;
  error?: string;
}
