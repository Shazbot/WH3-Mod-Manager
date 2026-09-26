import type { EsfMapArea, EsfMapFaction, EsfMapMarker, EsfMapPayload } from "./types";

/** Region key -> owning faction key, or null for an empty region. The shape of the exported map.json. */
export type RegionOwnership = Record<string, string | null>;

/** Only the regions whose owner differs from the startpos. Keyed by the payload's region-key casing. */
export type OwnershipEdits = RegionOwnership;

export interface OwnershipImport {
  edits: OwnershipEdits;
  /** Keys in the file that no region of this campaign carries. */
  unknownRegions: string[];
  /** Faction keys in the file that no faction of the roster carries, kept verbatim in the edits. */
  unknownFactions: string[];
}

const ownerKey = (value: string | null | undefined) => value?.trim().toLowerCase() || undefined;

/** The ownership of every region of the map, in startpos order. */
export const regionOwnership = (map: EsfMapPayload): RegionOwnership =>
  Object.fromEntries(map.markers.map((marker) => [marker.key, marker.ownerFaction ?? null]));

/** Serialises the map's ownership the way the game-folder map.json is written. */
export const formatRegionOwnershipJson = (map: EsfMapPayload): string =>
  `${JSON.stringify(regionOwnership(map), undefined, 2)}\n`;

/**
 * Reads an exported ownership file.
 *
 * Anything but a flat object of strings and nulls is rejected rather than partly applied: a file
 * that is not this shape is far more likely to be the wrong file than a fixable one.
 */
export const parseRegionOwnership = (text: string): { ownership: RegionOwnership } | { error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Expected an object of region keys to faction keys." };
  }

  const ownership: RegionOwnership = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const regionKey = key.trim();
    if (!regionKey) continue;
    if (value === null || value === undefined) {
      ownership[regionKey] = null;
      continue;
    }
    if (typeof value !== "string") {
      return { error: `Region "${regionKey}" has a ${typeof value} owner; expected a faction key or null.` };
    }
    ownership[regionKey] = value.trim() || null;
  }
  return { ownership };
};

/**
 * Turns a parsed ownership file into the edits that would produce it.
 *
 * Regions the campaign does not have are dropped, and regions the file already agrees with the
 * startpos on produce no edit, so an unchanged file imports as zero edits. Faction keys the roster
 * does not know are kept as written: dropping them would silently lose data on a round trip.
 */
export const ownershipEditsFromImport = (
  map: EsfMapPayload,
  imported: RegionOwnership,
  factions: EsfMapFaction[],
): OwnershipImport => {
  const markerByKey = new Map(map.markers.map((marker) => [marker.key.toLowerCase(), marker] as const));
  const factionKeyByLowerKey = new Map(factions.map((faction) => [faction.key.toLowerCase(), faction.key] as const));

  const edits: OwnershipEdits = {};
  const unknownRegions: string[] = [];
  const unknownFactions = new Set<string>();

  for (const [regionKey, owner] of Object.entries(imported)) {
    const marker = markerByKey.get(regionKey.toLowerCase());
    if (!marker) {
      unknownRegions.push(regionKey);
      continue;
    }
    const lowerOwner = ownerKey(owner);
    if (lowerOwner && !factionKeyByLowerKey.has(lowerOwner)) unknownFactions.add(owner!.trim());
    const nextOwner = lowerOwner ? (factionKeyByLowerKey.get(lowerOwner) ?? owner!.trim()) : null;
    if (ownerKey(marker.ownerFaction) === ownerKey(nextOwner)) continue;
    edits[marker.key] = nextOwner;
  }

  return { edits, unknownRegions, unknownFactions: [...unknownFactions] };
};

/**
 * Overlays edited region ownership onto a loaded map.
 *
 * Ownership is denormalised onto both markers and areas, so both are rewritten and the faction
 * region counts recomputed. Untouched markers and areas are returned by identity: an area carries
 * its traced loops, and copying every one of them on each brush stroke is the difference between a
 * responsive canvas and a stuttering one.
 */
export const applyOwnershipEdits = (
  map: EsfMapPayload,
  edits: OwnershipEdits,
  factionsByKey: Map<string, EsfMapFaction>,
): EsfMapPayload => {
  const editedKeys = new Map(Object.entries(edits).map(([regionKey, owner]) => [regionKey.toLowerCase(), owner]));
  if (editedKeys.size === 0) return map;

  const editedOwner = (regionKey: string | undefined) =>
    regionKey === undefined ? undefined : editedKeys.get(regionKey.toLowerCase());

  const markers: EsfMapMarker[] = map.markers.map((marker) => {
    const owner = editedOwner(marker.key);
    if (owner === undefined) return marker;
    const faction = ownerKey(owner) ? factionsByKey.get(ownerKey(owner)!) : undefined;
    return { ...marker, ownerFaction: owner, subculture: faction?.subculture ?? null };
  });

  const areas: EsfMapArea[] = map.areas.map((area) => {
    const owner = editedOwner(area.regionKey);
    return owner === undefined ? area : { ...area, ownerFaction: owner };
  });

  const regionCounts = new Map<string, number>();
  for (const marker of markers) {
    const key = ownerKey(marker.ownerFaction);
    if (!key) continue;
    regionCounts.set(key, (regionCounts.get(key) ?? 0) + 1);
  }
  const factions = map.factions.map((faction) => {
    const regionCount = regionCounts.get(faction.key.toLowerCase()) ?? 0;
    return regionCount === faction.regionCount ? faction : { ...faction, regionCount };
  });

  return {
    ...map,
    markers,
    areas,
    factions,
    ownedRegionCount: markers.filter((marker) => !!ownerKey(marker.ownerFaction)).length,
  };
};
