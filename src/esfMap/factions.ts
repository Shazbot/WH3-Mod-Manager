import type { BuiltBuildingsData } from "../buildingsData/types";
import type { EsfMapFaction, EsfMapPayload } from "./types";

/** Converts a factions-table flag folder into the standard campaign flag asset path. */
export const factionFlagPath = (flagsPath: string | undefined): string | undefined => {
  const folder = (flagsPath ?? "").trim().replace(/\//g, "\\").replace(/\\+$/, "");
  if (!folder) return undefined;
  return /\.png$/i.test(folder) ? folder : `${folder}\\mon_64.png`;
};

/** Adds the factions represented by the ESF region owners and their flag asset paths. */
export const addFactionDataToEsfMap = (
  map: EsfMapPayload,
  buildings: BuiltBuildingsData,
  getFlagUrl?: (flagPath: string) => string | undefined,
): EsfMapPayload => {
  const factionsByKey = new Map(buildings.factions.map((faction) => [faction.key.toLowerCase(), faction]));
  const ownerKeyByLowerKey = new Map(
    map.markers
      .map((marker) => marker.ownerFaction?.trim())
      .filter((ownerFaction): ownerFaction is string => !!ownerFaction)
      .map((ownerFaction) => [ownerFaction.toLowerCase(), ownerFaction] as const),
  );
  const regionCounts = new Map<string, number>();
  for (const marker of map.markers) {
    const ownerFaction = marker.ownerFaction?.trim();
    if (!ownerFaction) continue;
    const key = ownerFaction.toLowerCase();
    regionCounts.set(key, (regionCounts.get(key) ?? 0) + 1);
  }

  const factions: EsfMapFaction[] = [...regionCounts.entries()]
    .map(([lowerKey, regionCount]) => {
      const faction = factionsByKey.get(lowerKey);
      const key = faction?.key ?? ownerKeyByLowerKey.get(lowerKey);
      if (!key) return undefined;
      const flagPath = factionFlagPath(faction?.flagPath);
      const flagUrl = flagPath ? getFlagUrl?.(flagPath) : undefined;
      return {
        key,
        label: faction?.localizedName || key,
        ...(flagPath ? { flagPath } : {}),
        ...(flagUrl ? { flagUrl } : {}),
        regionCount,
      };
    })
    .filter((faction): faction is EsfMapFaction => !!faction)
    .sort((first, second) => first.label.localeCompare(second.label) || first.key.localeCompare(second.key));

  return { ...map, factions };
};
