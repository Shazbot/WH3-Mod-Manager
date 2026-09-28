import { toVariantMeshDefinitionPath } from "./paths";

export type CharacterArtSetRow = {
  artSetId: string;
  culture: string;
  subculture: string;
  faction: string;
};

export type CharacterArtRow = {
  id: string;
  level: number;
  age: number;
  season: string;
  uniform: string;
};

export type CharacterSubtypeOverrideRow = {
  subtype: string;
  subculture: string;
  associatedUnitOverride: string;
  agent: string;
};

export type CharacterPermissionUniformRow = {
  faction: string;
  uniform: string;
};

export type ResolvedCharacterBattleArt = {
  faction: string;
  subculture: string;
  culture: string;
  variantName: string;
  artSetId: string;
  variantMeshPath: string;
};

export type ResolveCharacterBattleArtInput = {
  caste: string;
  /** Agent subtype keys are the identity used by campaign character art tables. */
  agentSubtypeKeys?: readonly string[];
  /** Legacy inputs retained for callers that have not precomputed subtype keys yet. */
  mainUnitKeys?: readonly string[];
  agentSubtypeToAssociatedUnit?: ReadonlyMap<string, string>;
  agentSubtypeSubcultureOverrides?: readonly CharacterSubtypeOverrideRow[];
  /** Custom-battle uniforms remain keyed by main unit and faction in the source table. */
  permissionUniforms?: readonly CharacterPermissionUniformRow[];
  availableFactions: Iterable<string>;
  availableSubcultures: Iterable<string>;
  factionToSubculture?: ReadonlyMap<string, string>;
  subcultureToCulture: ReadonlyMap<string, string>;
  campaignCharacterArtSetsBySubtype: ReadonlyMap<string, readonly CharacterArtSetRow[]>;
  campaignCharacterArtsByArtSet: ReadonlyMap<string, readonly CharacterArtRow[]>;
  agentUniformByName: ReadonlyMap<string, { filename: string; battleFilename: string }>;
  variantsByName: ReadonlyMap<string, string>;
};

export type ResolveAgentSubtypeKeysInput = {
  mainUnitKeys: readonly string[];
  availableSubcultures: Iterable<string>;
  agentSubtypeToAssociatedUnit: ReadonlyMap<string, string>;
  agentSubtypeSubcultureOverrides: readonly CharacterSubtypeOverrideRow[];
};

/**
 * Finds the agent subtype identities associated with one or more main-unit rows.
 *
 * This relationship is deliberately kept outside the VMD resolver: campaign art is keyed by
 * agent_subtype, while custom-battle permissions are keyed by main unit. Keeping the two inputs
 * separate prevents an alternate hero/lord main-unit key from being mistaken for an agent subtype.
 */
export const resolveAgentSubtypeKeys = ({
  mainUnitKeys,
  availableSubcultures,
  agentSubtypeToAssociatedUnit,
  agentSubtypeSubcultureOverrides,
}: ResolveAgentSubtypeKeysInput): string[] => {
  const mainUnits = new Set(mainUnitKeys.filter(Boolean));
  if (mainUnits.size === 0) return [];

  const subcultureSet = new Set(Array.from(availableSubcultures).filter(Boolean));
  const subtypes = new Set<string>();
  for (const [subtype, associatedUnit] of agentSubtypeToAssociatedUnit) {
    if (associatedUnit && mainUnits.has(associatedUnit)) subtypes.add(subtype);
  }
  for (const override of agentSubtypeSubcultureOverrides) {
    if (
      override.associatedUnitOverride
      && mainUnits.has(override.associatedUnitOverride)
      && (!override.subculture || subcultureSet.size === 0 || subcultureSet.has(override.subculture))
    ) {
      subtypes.add(override.subtype);
    }
  }
  return Array.from(subtypes);
};

const normalizeOptionalVariantKey = (value: string | undefined) => {
  const trimmed = value?.trim() || "";
  return trimmed && trimmed !== "." ? trimmed : undefined;
};

export const resolveCharacterBattleArt = ({
  caste,
  agentSubtypeKeys,
  mainUnitKeys,
  agentSubtypeToAssociatedUnit,
  agentSubtypeSubcultureOverrides,
  permissionUniforms = [],
  availableFactions,
  availableSubcultures,
  factionToSubculture,
  subcultureToCulture,
  campaignCharacterArtSetsBySubtype,
  campaignCharacterArtsByArtSet,
  agentUniformByName,
  variantsByName,
}: ResolveCharacterBattleArtInput): ResolvedCharacterBattleArt[] => {
  const normalizedCaste = caste.trim().toLowerCase();
  if (normalizedCaste !== "lord" && normalizedCaste !== "hero") return [];

  const factionSet = new Set(Array.from(availableFactions).filter(Boolean));
  const subcultureSet = new Set(Array.from(availableSubcultures).filter(Boolean));
  const cultureSet = new Set(
    Array.from(subcultureSet)
      .map((subculture) => subcultureToCulture.get(subculture) || "")
      .filter(Boolean),
  );
  const resolvedAgentSubtypeKeys =
    agentSubtypeKeys
    ?? (mainUnitKeys && agentSubtypeToAssociatedUnit && agentSubtypeSubcultureOverrides
      ? resolveAgentSubtypeKeys({
          mainUnitKeys,
          availableSubcultures: subcultureSet,
          agentSubtypeToAssociatedUnit,
          agentSubtypeSubcultureOverrides,
        })
      : []);

  const resolved = new Map<string, ResolvedCharacterBattleArt>();
  const directUniformFactions = new Set<string>();
  const resolveUniform = (uniformName: string, scope: { faction: string; subculture: string; culture: string }, artSetId: string) => {
    if (!uniformName) return;
    const uniform = agentUniformByName.get(uniformName);
    if (!uniform) return;

    const variantName =
      normalizeOptionalVariantKey(uniform.battleFilename)
      ?? normalizeOptionalVariantKey(uniform.filename);
    if (!variantName) return;

    const variantFilename = variantsByName.get(variantName);
    if (!variantFilename?.trim()) return;
    const variantMeshPath = toVariantMeshDefinitionPath(variantFilename);
    if (!variantMeshPath) return;

    const key = `${variantMeshPath.toLowerCase()}\0${scope.faction}\0${scope.subculture}\0${scope.culture}`;
    if (!resolved.has(key)) {
      resolved.set(key, {
        faction: scope.faction,
        subculture: scope.subculture,
        culture: scope.culture,
        variantName,
        artSetId,
        variantMeshPath,
      });
    }
  };

  // Permission uniforms are the most specific battle appearance. They are keyed by the main
  // unit in the DB, but arrive here already associated with the selected character unit.
  for (const permission of permissionUniforms) {
    const faction = permission.faction || "";
    if (faction && factionSet.size > 0 && !factionSet.has(faction)) continue;
    const subculture = factionToSubculture?.get(faction) || "";
    const culture = subcultureToCulture.get(subculture) || "";
    const before = resolved.size;
    resolveUniform(permission.uniform, { faction, subculture, culture }, "");
    if (resolved.size > before) directUniformFactions.add(faction);
  }

  for (const subtype of resolvedAgentSubtypeKeys) {
    for (const artSet of campaignCharacterArtSetsBySubtype.get(subtype) || []) {
      if (artSet.faction && factionSet.size > 0 && !factionSet.has(artSet.faction)) continue;
      if (artSet.subculture && subcultureSet.size > 0 && !subcultureSet.has(artSet.subculture)) continue;
      if (artSet.culture && cultureSet.size > 0 && !cultureSet.has(artSet.culture)) continue;
      if (directUniformFactions.has(artSet.faction)) continue;

      // campaign_character_arts is sorted by the cache merger so its first row is the
      // lowest-level/age baseline appearance for this art set.
      const art = (campaignCharacterArtsByArtSet.get(artSet.artSetId) || [])[0];
      if (!art?.uniform) continue;
      resolveUniform(art.uniform, artSet, artSet.artSetId);
    }
  }

  return Array.from(resolved.values());
};
