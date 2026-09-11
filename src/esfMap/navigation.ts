import type { EsfMapMarker } from "./types";

const normalizedFactionKey = (value: string | null | undefined) => value?.trim().toLowerCase();

/**
 * Returns the next owned region for repeated faction-focus gestures. A missing or stale previous
 * marker starts at the faction's first region; reaching the end wraps back to the beginning.
 */
export const nextFactionRegionMarker = (
  markers: EsfMapMarker[],
  faction: string,
  previousMarkerId?: number,
): EsfMapMarker | undefined => {
  const key = normalizedFactionKey(faction);
  const factionMarkers = markers.filter((marker) => normalizedFactionKey(marker.ownerFaction) === key);
  if (factionMarkers.length === 0) return undefined;

  const previousIndex = factionMarkers.findIndex((marker) => marker.id === previousMarkerId);
  return factionMarkers[previousIndex < 0 ? 0 : (previousIndex + 1) % factionMarkers.length];
};
