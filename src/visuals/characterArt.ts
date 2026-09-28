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
  mainUnitKeys: readonly string[];
  availableFactions: Iterable<string>;
  availableSubcultures: Iterable<string>;
  subcultureToCulture: ReadonlyMap<string, string>;
  agentSubtypeToAssociatedUnit: ReadonlyMap<string, string>;
  agentSubtypeSubcultureOverrides: readonly CharacterSubtypeOverrideRow[];
  campaignCharacterArtSetsBySubtype: ReadonlyMap<string, readonly CharacterArtSetRow[]>;
  campaignCharacterArtsByArtSet: ReadonlyMap<string, readonly CharacterArtRow[]>;
  agentUniformByName: ReadonlyMap<string, { filename: string; battleFilename: string }>;
  variantsByName: ReadonlyMap<string, string>;
};

const normalizeOptionalVariantKey = (value: string | undefined) => {
  const trimmed = value?.trim() || "";
  return trimmed && trimmed !== "." ? trimmed : undefined;
};

export const resolveCharacterBattleArt = ({
  caste,
  mainUnitKeys,
  availableFactions,
  availableSubcultures,
  subcultureToCulture,
  agentSubtypeToAssociatedUnit,
  agentSubtypeSubcultureOverrides,
  campaignCharacterArtSetsBySubtype,
  campaignCharacterArtsByArtSet,
  agentUniformByName,
  variantsByName,
}: ResolveCharacterBattleArtInput): ResolvedCharacterBattleArt[] => {
  const normalizedCaste = caste.trim().toLowerCase();
  if (normalizedCaste !== "lord" && normalizedCaste !== "hero") return [];

  const mainUnits = new Set(mainUnitKeys.filter(Boolean));
  if (mainUnits.size === 0) return [];

  const factionSet = new Set(Array.from(availableFactions).filter(Boolean));
  const subcultureSet = new Set(Array.from(availableSubcultures).filter(Boolean));
  const cultureSet = new Set(
    Array.from(subcultureSet)
      .map((subculture) => subcultureToCulture.get(subculture) || "")
      .filter(Boolean),
  );

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

  const resolved = new Map<string, ResolvedCharacterBattleArt>();
  for (const subtype of subtypes) {
    for (const artSet of campaignCharacterArtSetsBySubtype.get(subtype) || []) {
      if (artSet.faction && factionSet.size > 0 && !factionSet.has(artSet.faction)) continue;
      if (artSet.subculture && subcultureSet.size > 0 && !subcultureSet.has(artSet.subculture)) continue;
      if (artSet.culture && cultureSet.size > 0 && !cultureSet.has(artSet.culture)) continue;

      // campaign_character_arts is sorted by the cache merger so its first row is the
      // lowest-level/age baseline appearance for this art set.
      const art = (campaignCharacterArtsByArtSet.get(artSet.artSetId) || [])[0];
      if (!art?.uniform) continue;
      const uniform = agentUniformByName.get(art.uniform);
      if (!uniform) continue;

      const variantName =
        normalizeOptionalVariantKey(uniform.battleFilename)
        ?? normalizeOptionalVariantKey(uniform.filename);
      if (!variantName) continue;

      const variantFilename = variantsByName.get(variantName);
      if (!variantFilename?.trim()) continue;
      const variantMeshPath = toVariantMeshDefinitionPath(variantFilename);
      if (!variantMeshPath) continue;

      const key = `${variantMeshPath.toLowerCase()}\0${artSet.faction}\0${artSet.subculture}\0${artSet.culture}`;
      if (!resolved.has(key)) {
        resolved.set(key, {
          faction: artSet.faction,
          subculture: artSet.subculture,
          culture: artSet.culture,
          variantName,
          artSetId: artSet.artSetId,
          variantMeshPath,
        });
      }
    }
  }

  return Array.from(resolved.values());
};
